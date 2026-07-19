// src/commands/rpg/character.ts
// Full 6-page canvas character profile (Stats/Weapon/Echoes/Kit Levels/
// Constellations/Lore) — see docs/superpowers/specs/2026-07-17-solace-character-card-design.md.

import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { auditSpend } from "../../lib/antiCheat";
import {
  MAX_KIT_LEVEL, KitTrack, TRACK_FIELD, getTrackLevel, kitLevelUpCost,
  getOrCreateCharacterProgress, currentLevelCap,
} from "../../lib/characterProgress";
import {
  resolveSolaceStats, unlockedLoreFragments, MAX_ASCENSION_PHASE,
  solaceAscensionCost, solaceLevelUpCost,
} from "../../lib/solace";
import { renderStatBarsCard, renderSlotGridCard, renderLoreCard } from "../../lib/characterCard";
import { generateWeaponCard } from "../../lib/weaponCard";
import { WEAPON_TYPE_LABEL, FORGED_WEAPONS } from "../../lib/weapons";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";

// Only "solace" exists today — future characters add entries here, and the
// select menu below automatically grows to offer them. No other code in this
// file needs to change when that happens.
const CHARACTERS: Record<string, { label: string; emoji: string; element: string; portraitPath: string }> = {
  solace: { label: "Solace", emoji: "✨", element: "SPECTRO", portraitPath: "assets/Characters/Solace.png" },
};

type Page = "stats" | "weapon" | "echoes" | "kit" | "con" | "lore";
const PAGE_LABEL: Record<Page, string> = {
  stats: "📊  Stats", weapon: "⚔️  Weapon", echoes: "◈  Echoes",
  kit: "⚔️  Kit Levels", con: "📜  Constellations", lore: "📖  Lore",
};
const PAGE_SET = new Set<string>(Object.keys(PAGE_LABEL));
function isPage(value: string): value is Page { return PAGE_SET.has(value); }

const TRACK_LABELS: Record<KitTrack, string> = {
  basic:    "⚔️  Chime Strike",
  skill:    "✦  Attunement",
  ultimate: "⚡  Convergence",
  intro:    "🔷  Intro Skill",
  forte:    "🌟  Forte",
};
const VALID_TRACKS = new Set<string>(Object.keys(TRACK_LABELS));
function isKitTrack(value: string): value is KitTrack {
  return VALID_TRACKS.has(value);
}

// ── Constellations ─────────────────────────────────────────────────────────
const CONSTELLATION_EFFECTS: Record<string, string[]> = {
  solace: [
    "Outro's guaranteed-crit buff also grants the incoming ally +15% ATK for their first action after the swap.",
    "**(Kit change)** Ultimate's heal significantly increased; cleanses 2 debuffs instead of 1.",
    "Switching Attunement Mode (Skill) also grants a team-wide Concerto Energy burst.",
    "**(Kit change)** Intro Skill's heal also grants a shield equal to 30% of the amount healed.",
    "Ultimate's doubled-mode-effect duration extends from 3 turns to 4.",
    "**(Defining)** While one Attunement Mode is active, allies ALSO gain 50% of the other two modes' effects.",
  ],
};
const MAX_CONSTELLATION = 6;

// Simulates spending resonanceRecords/credits one level at a time (per
// solaceLevelUpCost's per-level curve) and returns the highest level reached
// before either resource runs out or the phase cap is hit. Used both to
// render the "Jump to Lv N" button label and, mirrored exactly, inside the
// transaction that actually spends the resources — keep these in sync.
function maxAffordableLevel(currentLevel: number, cap: number, records: number, credits: number): number {
  let level = currentLevel, r = records, c = credits;
  while (level < cap) {
    const cost = solaceLevelUpCost(level);
    if (cost.resonanceRecords > r || cost.credits > c) break;
    r -= cost.resonanceRecords; c -= cost.credits;
    level++;
  }
  return level;
}

function navRows(characterId: string, active: Page): ActionRowBuilder<ButtonBuilder>[] {
  const row1: Page[] = ["stats", "weapon", "echoes"];
  const row2: Page[] = ["kit", "con", "lore"];
  const buildRow = (list: Page[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    list.map(p => new ButtonBuilder()
      .setCustomId(`charnav:${characterId}:${p}`)
      .setLabel(PAGE_LABEL[p])
      .setStyle(active === p ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active === p)),
  );
  return [buildRow(row1), buildRow(row2)];
}

interface PageView {
  embed: EmbedBuilder;
  files: AttachmentBuilder[];
  extraRow?: ActionRowBuilder<ButtonBuilder>;
}

async function buildStatsView(userId: string, characterId: string): Promise<PageView> {
  const char = CHARACTERS[characterId];
  const [progress, stats, dbUser] = await Promise.all([
    getOrCreateCharacterProgress(userId, characterId),
    resolveSolaceStats(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { resonanceRecords: true, credits: true } }),
  ]);
  const cap = currentLevelCap(progress.ascensionPhase);
  const buf = await renderStatBarsCard({
    characterName: char.label, element: char.element,
    subtitle: `Lv ${progress.level}/${cap} · Phase ${progress.ascensionPhase}/${MAX_ASCENSION_PHASE}`,
    portraitPath: char.portraitPath,
    bars: [
      { label: "HP",        value: stats.hp,       max: stats.hp,      displayValue: `${Math.round(stats.hp)}` },
      { label: "ATK",       value: stats.atk,      max: stats.atk * 2, displayValue: `${Math.round(stats.atk)}` },
      { label: "DEF",       value: stats.def,      max: stats.def * 2, displayValue: `${Math.round(stats.def)}` },
      { label: "SPD",       value: stats.spd,      max: stats.spd * 2, displayValue: `${Math.round(stats.spd)}` },
      { label: "Crit Rate", value: stats.critRate, max: 1,             displayValue: `${Math.round(stats.critRate * 100)}%` },
      { label: "Crit DMG",  value: stats.critDmg,  max: 3,             displayValue: `${Math.round(stats.critDmg * 100)}%` },
    ],
  });

  const atCap = progress.level >= cap;
  const isMaxPhase = progress.ascensionPhase >= MAX_ASCENSION_PHASE;
  let actionLabel: string;
  let actionDisabled: boolean;
  const buttons: ButtonBuilder[] = [];
  if (isMaxPhase && atCap) {
    actionLabel = "MAX LEVEL"; actionDisabled = true;
    buttons.push(new ButtonBuilder().setCustomId(`charlvl2:${characterId}`).setLabel(actionLabel)
      .setStyle(ButtonStyle.Primary).setDisabled(true));
  } else if (atCap) {
    actionLabel = `Ascend (Phase ${progress.ascensionPhase + 1})`; actionDisabled = false;
    buttons.push(new ButtonBuilder().setCustomId(`charlvl2:${characterId}`).setLabel(actionLabel)
      .setStyle(ButtonStyle.Success).setDisabled(actionDisabled));
  } else {
    const cost = solaceLevelUpCost(progress.level);
    actionLabel = `Level Up (${cost.resonanceRecords} Records · ${cost.credits} Credits)`;
    actionDisabled = false;
    buttons.push(new ButtonBuilder().setCustomId(`charlvl2:${characterId}`).setLabel(actionLabel)
      .setStyle(ButtonStyle.Primary).setDisabled(actionDisabled));

    // "Jump to max affordable level" — simulates the level-up cost curve
    // against the player's current balance, capped at the phase's level cap,
    // so a big pile of Records/Credits doesn't require clicking Level Up
    // dozens of times one at a time.
    const affordable = maxAffordableLevel(progress.level, cap, dbUser?.resonanceRecords ?? 0, dbUser?.credits ?? 0);
    const gain = affordable - progress.level;
    buttons.push(new ButtonBuilder().setCustomId(`charlvlmax:${characterId}`)
      .setLabel(gain > 0 ? `Jump to Lv ${affordable} (+${gain})` : "Jump to Max (need more)")
      .setStyle(ButtonStyle.Secondary).setDisabled(gain <= 0));
  }
  const extraRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://stats.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Stats" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "stats.png" })], extraRow };
}

async function buildWeaponView(userId: string, characterId: string): Promise<PageView> {
  const char = CHARACTERS[characterId];
  const weapon = await prisma.weapon.findFirst({
    where: { userId, characterId, isEquipped: true },
    select: {
      name: true, weaponType: true, rarity: true, level: true, baseAtk: true,
      subStatType: true, subStatVal: true,
      hiddenSub1Type: true, hiddenSub1Val: true, hiddenSub2Type: true, hiddenSub2Val: true,
      awakened: true, awakenedName: true, awakenedPassive: true, weaponBond: true,
    },
  });

  if (!weapon) {
    const embed = new EmbedBuilder().setColor(0x334155)
      .setDescription(`◈ **${char.label}** has no weapon equipped.\nUse **/equip** with a weapon targeting her loadout.`)
      .setFooter({ text: "CARTETHYIA  ·  Character  ·  Weapon" });
    return { embed, files: [] };
  }

  const weaponDef = FORGED_WEAPONS.find(w => w.name === weapon.name);
  const wishDef = ALL_WISH_WEAPONS.find(w => w.name === weapon.name);
  const maxMult: Record<number, number> = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 };
  const effectiveAtk = Math.round(weapon.baseAtk * (1 + (weapon.level - 1) * ((maxMult[weapon.rarity] ?? 2.5) - 1) / 89));
  const effectiveSub = weapon.subStatVal != null
    ? Math.round((weapon.subStatVal * (1 + (weapon.level - 1) * 0.8 / 89)) * 10) / 10
    : null;
  const h1Val = weapon.level >= 20 && weapon.hiddenSub1Val != null
    ? calcWishSubStat(weapon.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, weapon.level) : null;
  const h2Val = weapon.level >= 50 && weapon.hiddenSub2Val != null
    ? calcWishSubStat(weapon.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, weapon.level) : null;

  const buf = await generateWeaponCard({
    name: weapon.name, weaponType: weapon.weaponType, rarity: weapon.rarity, level: weapon.level,
    baseAtk: weapon.baseAtk, effectiveAtk,
    subStatType: weapon.subStatType ?? null, subStatVal: weapon.subStatVal ?? null, effectiveSub,
    passive: weaponDef?.passive ?? WEAPON_TYPE_LABEL[weapon.weaponType as keyof typeof WEAPON_TYPE_LABEL] ?? "",
    element: char.element, ownerName: char.label, ownerAvatar: char.portraitPath,
    hiddenSub1Type: weapon.hiddenSub1Type ?? null, hiddenSub1Val: h1Val,
    hiddenSub2Type: weapon.hiddenSub2Type ?? null, hiddenSub2Val: h2Val,
    awakened: weapon.awakened, awakenedName: weapon.awakenedName, weaponBond: weapon.weaponBond,
  });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://weapon.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Weapon" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "weapon.png" })] };
}

async function buildEchoesView(userId: string, characterId: string): Promise<PageView> {
  const char = CHARACTERS[characterId];
  const echoes = await prisma.echo.findMany({
    where: { userId, characterId, equippedSlot: { not: null } },
    orderBy: { equippedSlot: "asc" },
  });
  const slots = Array.from({ length: 5 }, (_, slot) => {
    const eq = echoes.find(e => e.equippedSlot === slot);
    return eq
      ? { label: eq.name, sublabel: `Lv ${eq.level}`, filled: true }
      : { label: slot === 0 ? "Main" : `Sub ${slot}`, sublabel: "Empty", filled: false };
  });
  const buf = await renderSlotGridCard({ characterName: char.label, element: char.element, subtitle: "Echoes", slots });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://echoes.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Echoes" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "echoes.png" })] };
}

async function buildKitLevelsView(userId: string, characterId: string): Promise<PageView> {
  const [progress, dbUser] = await Promise.all([
    getOrCreateCharacterProgress(userId, characterId),
    prisma.user.findUnique({ where: { id: userId }, select: { forgingOres: true } }),
  ]);
  const ores = dbUser?.forgingOres ?? 0;
  const char = CHARACTERS[characterId];
  const tracks: KitTrack[] = ["basic", "skill", "ultimate", "intro", "forte"];

  const buf = await renderStatBarsCard({
    characterName: char.label, element: char.element,
    subtitle: `Kit Levels · ${ores} Forging Ores`,
    bars: tracks.map(t => {
      const lvl = getTrackLevel(progress, t);
      return { label: TRACK_LABELS[t].replace(/^\S+\s+/, ""), value: lvl, max: MAX_KIT_LEVEL, displayValue: `Lv ${lvl}/${MAX_KIT_LEVEL}` };
    }),
  });

  const extraRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    tracks.map(t => {
      const lvl = getTrackLevel(progress, t);
      const maxed = lvl >= MAX_KIT_LEVEL;
      const cost = maxed ? 0 : kitLevelUpCost(lvl);
      return new ButtonBuilder()
        .setCustomId(`charlvl:${characterId}:${t}`)
        .setLabel(maxed ? `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (MAX)` : `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (${cost}⛭)`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(maxed || ores < cost);
    }),
  );

  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://kit.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Kit Levels" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "kit.png" })], extraRow };
}

async function buildConstellationsView(userId: string, characterId: string): Promise<PageView> {
  const progress = await getOrCreateCharacterProgress(userId, characterId);
  const char = CHARACTERS[characterId];
  const tiers = CONSTELLATION_EFFECTS[characterId] ?? [];
  const slots = tiers.map((_, i) => {
    const tier = i + 1;
    const unlocked = progress.constellation >= tier;
    return { label: `C${tier}`, sublabel: unlocked ? "Unlocked" : "Locked", filled: unlocked };
  });
  const buf = await renderSlotGridCard({
    characterName: char.label, element: char.element,
    subtitle: `Resonance Chain — C${progress.constellation}/${MAX_CONSTELLATION} · ${progress.constellationTokens} Tokens`,
    slots,
  });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://con.png")
    .setDescription(tiers.map((e, i) => `${progress.constellation >= i + 1 ? "✦" : "◇"} **C${i + 1}** — ${e}`).join("\n\n"))
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Constellations" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "con.png" })] };
}

async function buildLoreView(userId: string, characterId: string): Promise<PageView> {
  const progress = await getOrCreateCharacterProgress(userId, characterId);
  const char = CHARACTERS[characterId];
  const buf = await renderLoreCard({
    characterName: char.label, element: char.element, portraitPath: char.portraitPath,
    fragments: unlockedLoreFragments(progress.ascensionPhase),
  });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://lore.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Lore" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "lore.png" })] };
}

async function buildView(userId: string, characterId: string, page: Page): Promise<PageView> {
  switch (page) {
    case "stats":  return buildStatsView(userId, characterId);
    case "weapon": return buildWeaponView(userId, characterId);
    case "echoes": return buildEchoesView(userId, characterId);
    case "kit":    return buildKitLevelsView(userId, characterId);
    case "con":    return buildConstellationsView(userId, characterId);
    case "lore":   return buildLoreView(userId, characterId);
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("character")
    .setDescription("View and level up your characters.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const dbUser = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { id: true } });
    if (!dbUser) { await replyNotStarted(interaction); return; }

    const select = new StringSelectMenuBuilder()
      .setCustomId("character_cmd_select")
      .setPlaceholder("Choose a character…")
      .addOptions(
        Object.entries(CHARACTERS).map(([value, c]) => ({
          label: `${c.emoji}  ${c.label}`,
          value,
        }))
      );
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const overview = new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("◈  Characters")
      .setDescription("Select a character to view their profile.")
      .setFooter({ text: "CARTETHYIA  ·  Character" });

    await interaction.editReply({ embeds: [overview], components: [selectRow] });

    const collector = interaction.channel?.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id &&
        (i.customId === "character_cmd_select" || i.customId.startsWith("charlvl:") ||
         i.customId.startsWith("charlvl2:") || i.customId.startsWith("charlvlmax:") ||
         i.customId.startsWith("charnav:")),
      time: 5 * 60 * 1000,
    });

    const renderAndReply = async (i: StringSelectMenuInteraction | ButtonInteraction, characterId: string, page: Page) => {
      const view = await buildView(interaction.user.id, characterId, page);
      const components = [selectRow, ...navRows(characterId, page), ...(view.extraRow ? [view.extraRow] : [])];
      await i.update({ embeds: [view.embed], files: view.files, components }).catch(() => {});
    };

    collector?.on("collect", async i => {
      if (i.customId === "character_cmd_select" && i.isStringSelectMenu()) {
        const sel = i as StringSelectMenuInteraction;
        const characterId = sel.values[0];
        if (!CHARACTERS[characterId]) { await sel.deferUpdate().catch(() => {}); return; }
        await renderAndReply(sel, characterId, "stats");
        return;
      }

      if (i.customId.startsWith("charnav:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, page] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || !isPage(page)) {
          await btn.deferUpdate().catch(() => {});
          return;
        }
        await renderAndReply(btn, characterId, page);
        return;
      }

      if (i.customId.startsWith("charlvl2:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId] = btn.customId.split(":");
        if (!CHARACTERS[characterId]) { await btn.deferUpdate().catch(() => {}); return; }

        const progress = await getOrCreateCharacterProgress(interaction.user.id, characterId);
        const cap = currentLevelCap(progress.ascensionPhase);

        try {
          if (progress.level >= cap) {
            if (progress.ascensionPhase >= MAX_ASCENSION_PHASE) { await btn.deferUpdate().catch(() => {}); return; }
            const cost = solaceAscensionCost(progress.ascensionPhase);
            const dbUser2 = await prisma.user.findUnique({
              where: { id: interaction.user.id },
              select: { credits: true, forgingOres: true, paradoxCores: true, starfallShards: true },
            });
            if (!dbUser2 || dbUser2.credits < cost.credits || dbUser2.forgingOres < cost.forgingOres ||
                dbUser2.paradoxCores < cost.paradoxCores || dbUser2.starfallShards < cost.starfallShards) {
              await btn.deferUpdate().catch(() => {}); return;
            }
            await prisma.$transaction(async (tx) => {
              const spend = await tx.user.updateMany({
                where: {
                  id: interaction.user.id,
                  credits: { gte: cost.credits }, forgingOres: { gte: cost.forgingOres },
                  paradoxCores: { gte: cost.paradoxCores }, starfallShards: { gte: cost.starfallShards },
                },
                data: {
                  credits: { decrement: cost.credits }, forgingOres: { decrement: cost.forgingOres },
                  paradoxCores: { decrement: cost.paradoxCores }, starfallShards: { decrement: cost.starfallShards },
                },
              });
              if (spend.count === 0) throw new Error("insufficient-funds-race");
              const ascend = await tx.characterProgress.updateMany({
                where: { userId: interaction.user.id, characterId, ascensionPhase: progress.ascensionPhase },
                data: { ascensionPhase: { increment: 1 } },
              });
              if (ascend.count === 0) throw new Error("already-ascended-race");
            });
            auditSpend(interaction.user.id, {
              credits: cost.credits, forgingOres: cost.forgingOres, paradoxCores: cost.paradoxCores,
            }, "character-ascend");
          } else {
            const cost = solaceLevelUpCost(progress.level);
            const dbUser2 = await prisma.user.findUnique({
              where: { id: interaction.user.id }, select: { resonanceRecords: true, credits: true },
            });
            if (!dbUser2 || dbUser2.resonanceRecords < cost.resonanceRecords || dbUser2.credits < cost.credits) {
              await btn.deferUpdate().catch(() => {}); return;
            }
            await prisma.$transaction(async (tx) => {
              const spend = await tx.user.updateMany({
                where: { id: interaction.user.id, resonanceRecords: { gte: cost.resonanceRecords }, credits: { gte: cost.credits } },
                data: { resonanceRecords: { decrement: cost.resonanceRecords }, credits: { decrement: cost.credits } },
              });
              if (spend.count === 0) throw new Error("insufficient-funds-race");
              const levelUp = await tx.characterProgress.updateMany({
                where: { userId: interaction.user.id, characterId, level: progress.level },
                data: { level: { increment: 1 } },
              });
              if (levelUp.count === 0) throw new Error("already-leveled-race");
            });
            auditSpend(interaction.user.id, { resonanceRecords: cost.resonanceRecords, credits: cost.credits }, "character-level-up");
          }
          await renderAndReply(btn, characterId, "stats");
        } catch (err) {
          console.error("[character] level/ascend transaction failed", err);
          await btn.deferUpdate().catch(() => {});
        }
        return;
      }

      if (i.customId.startsWith("charlvlmax:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId] = btn.customId.split(":");
        if (!CHARACTERS[characterId]) { await btn.deferUpdate().catch(() => {}); return; }

        const [progress, dbUser2] = await Promise.all([
          getOrCreateCharacterProgress(interaction.user.id, characterId),
          prisma.user.findUnique({ where: { id: interaction.user.id }, select: { resonanceRecords: true, credits: true } }),
        ]);
        const cap = currentLevelCap(progress.ascensionPhase);
        const records = dbUser2?.resonanceRecords ?? 0;
        const credits = dbUser2?.credits ?? 0;
        const targetLevel = maxAffordableLevel(progress.level, cap, records, credits);
        if (targetLevel <= progress.level) { await btn.deferUpdate().catch(() => {}); return; }

        // Recompute the exact total spend for the same simulated jump, then
        // spend it all in one guarded transaction — same race-safety pattern
        // as the single-level path (updateMany with a gte/eq guard, roll
        // back on zero matched rows).
        let totalRecords = 0, totalCredits = 0;
        for (let lvl = progress.level; lvl < targetLevel; lvl++) {
          const cost = solaceLevelUpCost(lvl);
          totalRecords += cost.resonanceRecords; totalCredits += cost.credits;
        }

        try {
          await prisma.$transaction(async (tx) => {
            const spend = await tx.user.updateMany({
              where: { id: interaction.user.id, resonanceRecords: { gte: totalRecords }, credits: { gte: totalCredits } },
              data: { resonanceRecords: { decrement: totalRecords }, credits: { decrement: totalCredits } },
            });
            if (spend.count === 0) throw new Error("insufficient-funds-race");
            const levelUp = await tx.characterProgress.updateMany({
              where: { userId: interaction.user.id, characterId, level: progress.level },
              data: { level: targetLevel },
            });
            if (levelUp.count === 0) throw new Error("already-leveled-race");
          });
          auditSpend(interaction.user.id, { resonanceRecords: totalRecords, credits: totalCredits }, "character-level-up-max");
          await renderAndReply(btn, characterId, "stats");
        } catch (err) {
          console.error("[character] max-level-up transaction failed", err);
          await btn.deferUpdate().catch(() => {});
        }
        return;
      }

      if (i.customId.startsWith("charlvl:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, trackRaw] = btn.customId.split(":");

        if (!CHARACTERS[characterId] || !isKitTrack(trackRaw)) {
          await btn.deferUpdate().catch(() => {});
          return;
        }
        const track = trackRaw;

        const [progress, dbUser2] = await Promise.all([
          getOrCreateCharacterProgress(interaction.user.id, characterId),
          prisma.user.findUnique({ where: { id: interaction.user.id }, select: { forgingOres: true } }),
        ]);
        const lvl  = getTrackLevel(progress, track);
        const ores = dbUser2?.forgingOres ?? 0;
        const cost = kitLevelUpCost(lvl);

        if (lvl >= MAX_KIT_LEVEL || ores < cost) {
          await btn.deferUpdate().catch(() => {});
          return;
        }

        try {
          await prisma.$transaction(async (tx) => {
            const spend = await tx.user.updateMany({
              where: { id: interaction.user.id, forgingOres: { gte: cost } },
              data:  { forgingOres: { decrement: cost } },
            });
            if (spend.count === 0) {
              throw new Error("insufficient-funds-race");
            }
            const levelUp = await tx.characterProgress.updateMany({
              where: {
                userId: interaction.user.id, characterId,
                [TRACK_FIELD[track]]: { lt: MAX_KIT_LEVEL },
              },
              data: { [TRACK_FIELD[track]]: { increment: 1 } },
            });
            if (levelUp.count === 0) {
              throw new Error("already-maxed-race");
            }
          });
          auditSpend(interaction.user.id, { forgingOres: cost }, "character-kit-level");
          await renderAndReply(btn, characterId, "kit");
        } catch (err) {
          console.error("[character] kit-level-up transaction failed", err);
          await btn.deferUpdate().catch(() => {});
        }
      }
    });

    collector?.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
