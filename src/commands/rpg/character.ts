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
import { CHARACTER_KITS, PlayableCharacterKit } from "../../lib/characterKit";
import "../../lib/kits";
import { renderStatBarsCard, renderSlotGridCard, renderLoreCard } from "../../lib/characterCard";
import { generateWeaponCard } from "../../lib/weaponCard";
import { WEAPON_TYPE_LABEL, FORGED_WEAPONS, RARITY_STARS } from "../../lib/weapons";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";
import { invalidateBonusCache } from "../../lib/setBonus";
import { StringSelectMenuOptionBuilder } from "discord.js";
import { ELEMENT_EMOJI, MAIN_STAT_LABELS, calcMainStatValue, formatStatValue, RARITY_STARS as ECHO_RARITY_STARS } from "../../lib/echoes";
import { NAMED_SETS, NamedSetId } from "../../lib/namedSets";
import { echoEmojiResolvable } from "../../lib/emojiManager";
import { Element } from "@prisma/client";
import fs from "fs";
import path from "path";
import { pageSlice, pageCount, buildPageNavRow } from "../../lib/pagination";

// Derived directly from CHARACTER_KITS — adding a character to the kit
// registry automatically makes it selectable here, no separate catalog to
// keep in sync.
const CHARACTERS: Record<string, { label: string; emoji: string; element: string; portraitPath: string }> =
  Object.fromEntries(
    Object.entries(CHARACTER_KITS).map(([id, kit]) => [
      id, { label: kit.label, emoji: kit.emoji, element: kit.element, portraitPath: kit.portraitPath },
    ]),
  );

// Ascension's "shard" currency differs per character (Solace: Starfall
// Shards, Kaelith: Umbral Shards) — PlayableCharacterKit.ascensionCost's
// return type is currently hardcoded to a `starfallShards` field for every
// character (a known interface limitation from when Kaelith's kit was
// built), so kits report their REAL shard cost under an extra, kit-specific
// property alongside a `starfallShards: 0` filler. This map tells the UI
// which property + currency/label to actually read and spend per character.
type ShardDbField = "starfallShards" | "umbralShards";
const ASCENSION_SHARD_CURRENCY: Record<string, { field: string; dbField: ShardDbField; label: string }> = {
  solace:  { field: "starfallShards", dbField: "starfallShards", label: "Starfall Shards" },
  kaelith: { field: "umbralShards",   dbField: "umbralShards",   label: "Umbral Shards"   },
};
function shardInfo(characterId: string) {
  return ASCENSION_SHARD_CURRENCY[characterId] ?? ASCENSION_SHARD_CURRENCY.solace;
}

// Same lookup as gridCard.ts/canvas.ts/echoCard.ts — deliberately duplicated
// rather than shared, per this project's existing convention for these art
// resolvers (see CLAUDE.md's BOSS_ART_FILENAMES gotcha: update all copies
// when adding a boss). Missing here was exactly why the Echoes page rendered
// slot tiles with no art — renderSlotGridCard never got an iconPath.
const BOSS_ART_FILENAMES: Record<string, string> = {
  "Resonant Wraith":      "The Resonant Wraith.png",
  "Tidecaller Sovereign": "Tidecaller Sovereign.png",
  "Fractured Arbiter":    "The Fractured Arbiter.png",
  "Nullfire Construct":   "Nullfire Construct.png",
  "Sable Harbinger":      "Sable Harbinger.png",
  "Auric Colossus":       "Auric Colossus.png",
  "Embercrown Tyrant":    "Embercrown Tyrant.png",
  "Galeborne Phantom":    "Galeborne Phantom.png",
  "Resonant Absolute":    "The Resonant Absolute.png",
  "Ignis Behemoth":       "Ignis Behemoth.png",
  "Permafrost Sovereign": "Permafrost Sovereign.png",
  "Voltaic Aberrant":     "Voltaic Aberrant.png",
  "Tempest Ancient":      "Tempest Ancient.png",
  "Null Ravager":         "Null Ravager.png",
  "Luminal Specter":      "Luminal Specter.png",
  "Cinderbound Colossus": "Cinderbound Colossus.png",
  "Cryoveil Warden":      "Cryoveil Warden.png",
  "Thundercrown Herald":  "Thundercrown Herald.png",
  "Galebound Sovereign":  "Galebound Sovereign.png",
  "Voidmaw Devourer":     "Voidmaw Devourer.png",
  "Lumenwrought Seraph":  "Lumenwrought Seraph.png",
};

function echoArtPath(name: string, cost: number): string | null {
  if (cost === 1 || cost === 3) {
    const sub = path.join(process.cwd(), "assets", "echoes", `${cost}-cost`, `${name}.png`);
    if (fs.existsSync(sub)) return sub;
  }
  if (cost === 4) {
    const bossFile = BOSS_ART_FILENAMES[name] ?? `${name}.png`;
    const bossPath = path.join(process.cwd(), "Bosses", bossFile);
    if (fs.existsSync(bossPath)) return bossPath;
  }
  const snake = path.join(process.cwd(), "assets", "echoes", name.toLowerCase().replace(/\s+/g, "_") + ".png");
  return fs.existsSync(snake) ? snake : null;
}

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
// Constellation text/count now come straight from each kit
// (CHARACTER_KITS[id].constellationEffects / .maxConstellation) — see
// buildConstellationsView — instead of a separate static map that could
// drift out of sync with the kit itself.

// Recommended named echo set per character — shown on the Echoes page so
// players don't have to guess. Solace is Spectro and a healer/support unit;
// Radiant Convergence (also Spectro) stacks +Spectro DMG on every heal-tick
// and its 5pc rewards staying topped-up, which lines up with her kit
// directly instead of fighting it like an offense-oriented set would.
// Kaelith is Havoc; Voidborn Remnant's Frenzy mechanics amplify his own
// stack-detonation damage instead of fighting it.
const RECOMMENDED_SET: Record<string, string> = {
  solace:  "**Radiant Convergence** (Spectro) — her own element, and its heal-on-turn 4pc/5pc mechanics play directly into her support kit instead of fighting it.",
  kaelith: "**Voidborn Remnant** (Havoc) — his own element, and its Frenzy mechanics amplify his stack-detonation damage instead of fighting it.",
};

// Field boss whose guaranteed drop is this character's ascension shard —
// shown as a hint on the Ascend button once the player is short on shards.
const SHARD_FIELD_BOSS: Record<string, string> = {
  solace:  "Luminal Specter",
  kaelith: "Null Ravager",
};

// Simulates spending resonanceRecords/credits one level at a time (per the
// kit's own levelUpCost curve) and returns the highest level reached before
// either resource runs out or the phase cap is hit. Used both to render the
// "Jump to Lv N" button label and, mirrored exactly, inside the transaction
// that actually spends the resources — keep these in sync.
function maxAffordableLevel(kit: PlayableCharacterKit, currentLevel: number, cap: number, records: number, credits: number): number {
  let level = currentLevel, r = records, c = credits;
  while (level < cap) {
    const cost = kit.levelUpCost(level);
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
  const kit = CHARACTER_KITS[characterId];
  const shard = shardInfo(characterId);
  const maxAscensionPhase = kit.ascensionLevelCap.length - 1;
  const [progress, stats, dbUser] = await Promise.all([
    getOrCreateCharacterProgress(userId, characterId),
    kit.resolveStats(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { resonanceRecords: true, credits: true, forgingOres: true, paradoxCores: true, starfallShards: true, umbralShards: true },
    }),
  ]);
  const cap = currentLevelCap(progress.ascensionPhase);
  const buf = await renderStatBarsCard({
    characterName: char.label, element: char.element,
    subtitle: `Lv ${progress.level}/${cap} · Phase ${progress.ascensionPhase}/${maxAscensionPhase}`,
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
  const isMaxPhase = progress.ascensionPhase >= maxAscensionPhase;
  const records = dbUser?.resonanceRecords ?? 0, credits = dbUser?.credits ?? 0;
  const ores = dbUser?.forgingOres ?? 0, cores = dbUser?.paradoxCores ?? 0;
  const shards = ((dbUser as any)?.[shard.dbField] ?? 0) as number;
  let actionLabel: string;
  let balanceLine: string;
  const buttons: ButtonBuilder[] = [];
  if (isMaxPhase && atCap) {
    actionLabel = "MAX LEVEL";
    balanceLine = `**${char.label} is at max level and max ascension.**`;
    buttons.push(new ButtonBuilder().setCustomId(`charlvl2:${characterId}`).setLabel(actionLabel)
      .setStyle(ButtonStyle.Primary).setDisabled(true));
  } else if (atCap) {
    const cost = kit.ascensionCost(progress.ascensionPhase);
    const costShards = ((cost as any)[shard.field] ?? 0) as number;
    const canAfford = credits >= cost.credits && ores >= cost.forgingOres &&
      cores >= cost.paradoxCores && shards >= costShards;
    actionLabel = `Ascend: ${cost.credits}cr · ${cost.forgingOres}fo · ${cost.paradoxCores}pc` +
      (costShards > 0 ? ` · ${costShards}sh` : "");
    balanceLine =
      `**Ascend to Phase ${progress.ascensionPhase + 1}** needs ` +
      `${cost.credits} Credits (have ${credits}) · ${cost.forgingOres} Forging Ores (have ${ores}) · ` +
      `${cost.paradoxCores} Paradox Cores (have ${cores})` +
      (costShards > 0 ? ` · ${costShards} ${shard.label} (have ${shards})` : "") +
      (canAfford ? "\n✅ You can afford this." : "\n❌ Not enough — the button is disabled until you have all of the above.") +
      (costShards > 0 && shards < costShards
        ? `\n-# ${shard.label} drop from the **${SHARD_FIELD_BOSS[characterId] ?? "matching"} field boss** — use **/field-boss** and pick it.`
        : "");
    buttons.push(new ButtonBuilder().setCustomId(`charlvl2:${characterId}`).setLabel(actionLabel)
      .setStyle(ButtonStyle.Success).setDisabled(!canAfford));
  } else {
    const cost = kit.levelUpCost(progress.level);
    const canAfford = records >= cost.resonanceRecords && credits >= cost.credits;
    actionLabel = `Level Up (${cost.resonanceRecords} Records · ${cost.credits} Credits)`;
    balanceLine =
      `**Level Up** needs ${cost.resonanceRecords} Resonance Records (have ${records}) · ` +
      `${cost.credits} Credits (have ${credits})` +
      (canAfford ? "\n✅ You can afford this." : "\n❌ Not enough — the button is disabled until you have both.");
    buttons.push(new ButtonBuilder().setCustomId(`charlvl2:${characterId}`).setLabel(actionLabel)
      .setStyle(ButtonStyle.Primary).setDisabled(!canAfford));

    // "Jump to max affordable level" — simulates the level-up cost curve
    // against the player's current balance, capped at the phase's level cap,
    // so a big pile of Records/Credits doesn't require clicking Level Up
    // dozens of times one at a time.
    const affordable = maxAffordableLevel(kit, progress.level, cap, records, credits);
    const gain = affordable - progress.level;
    buttons.push(new ButtonBuilder().setCustomId(`charlvlmax:${characterId}`)
      .setLabel(gain > 0 ? `Jump to Lv ${affordable} (+${gain})` : "Jump to Max (need more)")
      .setStyle(ButtonStyle.Secondary).setDisabled(gain <= 0));
  }
  const extraRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://stats.png")
    .setDescription(balanceLine)
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

  const equipRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`charequipweapon:${characterId}`).setLabel("⚔️  Equip Weapon").setStyle(ButtonStyle.Secondary),
  );

  if (!weapon) {
    const embed = new EmbedBuilder().setColor(0x334155)
      .setDescription(`◈ **${char.label}** has no weapon equipped.\nClick below to equip one from your arsenal.`)
      .setFooter({ text: "CARTETHYIA  ·  Character  ·  Weapon" });
    return { embed, files: [], extraRow: equipRow };
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
  return { embed, files: [new AttachmentBuilder(buf, { name: "weapon.png" })], extraRow: equipRow };
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
      ? { label: eq.name, sublabel: `Lv ${eq.level}`, filled: true, iconPath: echoArtPath(eq.name, eq.cost) ?? undefined }
      : { label: slot === 0 ? "Main" : `Sub ${slot}`, sublabel: "Empty", filled: false };
  });
  const buf = await renderSlotGridCard({ characterName: char.label, element: char.element, subtitle: "Echoes", slots });
  const recommended = RECOMMENDED_SET[characterId];
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://echoes.png")
    .setDescription(
      (recommended ? `**Recommended set:** ${recommended}\n\n` : "") +
      `-# Pick a slot below to equip an echo.`
    )
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Echoes" });

  const slotRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    Array.from({ length: 5 }, (_, slot) =>
      new ButtonBuilder().setCustomId(`charequipecho:${characterId}:${slot}`)
        .setLabel(slot === 0 ? "Main" : `Sub ${slot}`).setStyle(ButtonStyle.Secondary)),
  );
  return { embed, files: [new AttachmentBuilder(buf, { name: "echoes.png" })], extraRow: slotRow };
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
  const kit = CHARACTER_KITS[characterId];
  const tiers = kit.constellationEffects ?? [];
  const maxConstellation = kit.maxConstellation;
  const slots = tiers.map((_, i) => {
    const tier = i + 1;
    const unlocked = progress.constellation >= tier;
    return { label: `C${tier}`, sublabel: unlocked ? "Unlocked" : "Locked", filled: unlocked };
  });
  const buf = await renderSlotGridCard({
    characterName: char.label, element: char.element,
    subtitle: `Resonance Chain — C${progress.constellation}/${maxConstellation} · ${progress.constellationTokens} Tokens`,
    slots,
  });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://con.png")
    .setDescription(tiers.map((e, i) => `${progress.constellation >= i + 1 ? "✦" : "◇"} **C${i + 1}** — ${e}`).join("\n\n"))
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Constellations" });
  const canUnlock = progress.constellationTokens >= 1 && progress.constellation < maxConstellation;
  const extraRow = canUnlock ? new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`charconunlock:${characterId}`)
      .setLabel(`✦  Unlock C${progress.constellation + 1}  (1 Token)`)
      .setStyle(ButtonStyle.Success),
  ) : undefined;
  return { embed, files: [new AttachmentBuilder(buf, { name: "con.png" })], extraRow };
}

async function buildLoreView(userId: string, characterId: string): Promise<PageView> {
  const progress = await getOrCreateCharacterProgress(userId, characterId);
  const char = CHARACTERS[characterId];
  const kit = CHARACTER_KITS[characterId];
  // Fragment index i (0-based) is unlocked once ascensionPhase >= i — same
  // rule every kit's loreFragments array follows.
  const fragments = kit.loreFragments.map((text, i) => ({ text, unlocked: progress.ascensionPhase >= i }));
  const buf = await renderLoreCard({
    characterName: char.label, element: char.element, portraitPath: char.portraitPath,
    fragments,
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

    // Only characters this player actually owns (a real CharacterProgress row
    // exists) are ever selectable/viewable here — CHARACTERS is a static
    // catalog of every character that COULD exist, not what this player has.
    // Every code path below that checks `CHARACTERS[characterId]` must ALSO
    // check `ownedCharacterIds.has(characterId)`, or a non-owner can browse/
    // page through (and, via the level/kit/ascend buttons, spend currency on)
    // a character they've never pulled.
    const owned = await prisma.characterProgress.findMany({
      where: { userId: interaction.user.id },
      select: { characterId: true },
    });
    const ownedCharacterIds = new Set(owned.map(o => o.characterId));

    if (ownedCharacterIds.size === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x334155)
          .setTitle("◈  Characters")
          .setDescription("You don't own any banner characters yet.\nPull for one on **/wish**'s Limited Character Banner.")
          .setFooter({ text: "CARTETHYIA  ·  Character" })],
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("character_cmd_select")
      .setPlaceholder("Choose a character…")
      .addOptions(
        Object.entries(CHARACTERS)
          .filter(([id]) => ownedCharacterIds.has(id))
          .map(([value, c]) => ({
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
         i.customId.startsWith("charnav:") || i.customId.startsWith("charequipweapon:") ||
         i.customId.startsWith("charequipweaponpick:") || i.customId.startsWith("charequipecho:") ||
         i.customId.startsWith("charequipechopick:") || i.customId.startsWith("charequipechoclear:") ||
         i.customId.startsWith("charequipechofilter:") || i.customId.startsWith("charequipechocostfilter:") ||
         i.customId.startsWith("charconunlock:") || i.customId.startsWith("charequipweaponnav:")),
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
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId)) { await sel.deferUpdate().catch(() => {}); return; }
        await renderAndReply(sel, characterId, "stats");
        return;
      }

      if (i.customId.startsWith("charnav:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, page] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId) || !isPage(page)) {
          await btn.deferUpdate().catch(() => {});
          return;
        }
        await renderAndReply(btn, characterId, page);
        return;
      }

      if (i.customId.startsWith("charlvl2:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId)) { await btn.deferUpdate().catch(() => {}); return; }

        const kit = CHARACTER_KITS[characterId];
        const shard = shardInfo(characterId);
        const maxAscensionPhase = kit.ascensionLevelCap.length - 1;
        const progress = await getOrCreateCharacterProgress(interaction.user.id, characterId);
        const cap = currentLevelCap(progress.ascensionPhase);

        try {
          if (progress.level >= cap) {
            if (progress.ascensionPhase >= maxAscensionPhase) { await btn.deferUpdate().catch(() => {}); return; }
            const cost = kit.ascensionCost(progress.ascensionPhase);
            const costShards = ((cost as any)[shard.field] ?? 0) as number;
            const dbUser2 = await prisma.user.findUnique({
              where: { id: interaction.user.id },
              select: { credits: true, forgingOres: true, paradoxCores: true, starfallShards: true, umbralShards: true },
            });
            const haveShards = ((dbUser2 as any)?.[shard.dbField] ?? 0) as number;
            if (!dbUser2 || dbUser2.credits < cost.credits || dbUser2.forgingOres < cost.forgingOres ||
                dbUser2.paradoxCores < cost.paradoxCores || haveShards < costShards) {
              await btn.deferUpdate().catch(() => {}); return;
            }
            await prisma.$transaction(async (tx) => {
              const spend = await tx.user.updateMany({
                where: {
                  id: interaction.user.id,
                  credits: { gte: cost.credits }, forgingOres: { gte: cost.forgingOres },
                  paradoxCores: { gte: cost.paradoxCores }, [shard.dbField]: { gte: costShards },
                },
                data: {
                  credits: { decrement: cost.credits }, forgingOres: { decrement: cost.forgingOres },
                  paradoxCores: { decrement: cost.paradoxCores }, [shard.dbField]: { decrement: costShards },
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
            const cost = kit.levelUpCost(progress.level);
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
          // The three race-guard messages below mean the guard did its job
          // (balance/level/phase changed between the pre-check and the
          // spend, e.g. a double-click) — not a real error, don't log as
          // one. Re-render instead of a silent no-op.
          const raced = err instanceof Error &&
            ["insufficient-funds-race", "already-ascended-race", "already-leveled-race"].includes(err.message);
          if (!raced) console.error("[character] level/ascend transaction failed", err);
          await renderAndReply(btn, characterId, "stats").catch(() => btn.deferUpdate().catch(() => {}));
        }
        return;
      }

      if (i.customId.startsWith("charconunlock:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId)) { await btn.deferUpdate().catch(() => {}); return; }

        const progress = await getOrCreateCharacterProgress(interaction.user.id, characterId);
        try {
          const unlock = await prisma.characterProgress.updateMany({
            where: {
              userId: interaction.user.id, characterId,
              constellationTokens: { gte: 1 },
              constellation: progress.constellation,
            },
            data: {
              constellationTokens: { decrement: 1 },
              constellation: { increment: 1 },
            },
          });
          if (unlock.count === 0) throw new Error("already-unlocked-race");
          await renderAndReply(btn, characterId, "con");
        } catch (err) {
          // already-unlocked-race means tokens or constellation changed since
          // this page was rendered (double-click, or a wish pull banked a
          // token in between) — not a real error, don't log as one.
          const raced = err instanceof Error && err.message === "already-unlocked-race";
          if (!raced) console.error("[character] constellation-unlock transaction failed", err);
          await renderAndReply(btn, characterId, "con").catch(() => btn.deferUpdate().catch(() => {}));
        }
        return;
      }

      if (i.customId.startsWith("charlvlmax:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId)) { await btn.deferUpdate().catch(() => {}); return; }
        const kit = CHARACTER_KITS[characterId];

        const [progress, dbUser2] = await Promise.all([
          getOrCreateCharacterProgress(interaction.user.id, characterId),
          prisma.user.findUnique({ where: { id: interaction.user.id }, select: { resonanceRecords: true, credits: true } }),
        ]);
        const cap = currentLevelCap(progress.ascensionPhase);
        const records = dbUser2?.resonanceRecords ?? 0;
        const credits = dbUser2?.credits ?? 0;
        const targetLevel = maxAffordableLevel(kit, progress.level, cap, records, credits);
        if (targetLevel <= progress.level) { await btn.deferUpdate().catch(() => {}); return; }

        // Recompute the exact total spend for the same simulated jump, then
        // spend it all in one guarded transaction — same race-safety pattern
        // as the single-level path (updateMany with a gte/eq guard, roll
        // back on zero matched rows).
        let totalRecords = 0, totalCredits = 0;
        for (let lvl = progress.level; lvl < targetLevel; lvl++) {
          const cost = kit.levelUpCost(lvl);
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
          // insufficient-funds-race / already-leveled-race are the guard
          // doing its job (balance/level changed between the affordability
          // check and the spend, e.g. a double-click) — not a real error, so
          // don't log them as one. Re-render instead of a silent no-op so
          // the player sees why nothing happened rather than a dead button.
          const raced = err instanceof Error && (err.message === "insufficient-funds-race" || err.message === "already-leveled-race");
          if (!raced) console.error("[character] max-level-up transaction failed", err);
          await renderAndReply(btn, characterId, "stats").catch(() => btn.deferUpdate().catch(() => {}));
        }
        return;
      }

      const renderWeaponPicker = async (
        target: ButtonInteraction,
        characterId: string, page: number,
      ) => {
        const weapons = await prisma.weapon.findMany({
          where:   { userId: interaction.user.id },
          orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "desc" }],
        });
        if (weapons.length === 0) {
          await target.update({
            embeds: [new EmbedBuilder().setColor(0x334155).setDescription("◈ You don't own any weapons yet.\nUse **/forge** to craft one.")],
            components: [selectRow, ...navRows(characterId, "weapon")],
          }).catch(() => {});
          return;
        }

        const owner = (w: typeof weapons[number]) => w.characterId === "self" ? "Yourself" : (CHARACTERS[w.characterId]?.label ?? w.characterId);
        const count = pageCount(weapons.length);
        const pageWeapons = pageSlice(weapons, page);
        const listText = pageWeapons.map(w => {
          const label = w.awakened && w.awakenedName ? w.awakenedName : w.name;
          return `${w.isEquipped ? "▶" : "◇"}  **${label}**  ${RARITY_STARS[w.rarity]}  ·  Lv${w.level}${w.isEquipped ? `  *(${owner(w)})*` : ""}`;
        }).join("\n");

        const pickSelect = new StringSelectMenuBuilder()
          .setCustomId(`charequipweaponpick:${characterId}`)
          .setPlaceholder("Choose a weapon to equip…")
          .addOptions(pageWeapons.map(w => {
            const label = w.awakened && w.awakenedName ? w.awakenedName : w.name;
            return new StringSelectMenuOptionBuilder()
              .setLabel(`${label}  ${RARITY_STARS[w.rarity]}${w.isEquipped ? `  ← ${owner(w)}` : ""}`)
              .setDescription(`Lv${w.level}${w.characterId !== characterId && w.isEquipped ? "  ⚠ will be unequipped from " + owner(w) : ""}`)
              .setValue(w.id);
          }));

        const components = [
          selectRow, ...navRows(characterId, "weapon"),
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(pickSelect),
          ...(count > 1 ? [buildPageNavRow(`charequipweaponnav:${characterId}:${page}`, page, count)] : []),
        ];

        await target.update({
          embeds: [new EmbedBuilder().setColor(0x6366F1)
            .setDescription(
              `◈ Choose a weapon to equip to **${CHARACTERS[characterId].label}**.\n⚠ Picking one already equipped elsewhere will move it here.\n\n` +
              `**All weapons (${weapons.length}):**\n${listText}`
            )],
          components,
        }).catch(() => {});
      };

      if (i.customId.startsWith("charequipweapon:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId)) { await btn.deferUpdate().catch(() => {}); return; }
        await renderWeaponPicker(btn, characterId, 0);
        return;
      }

      if (i.customId.startsWith("charequipweaponnav:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, pageStr, dir] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId)) { await btn.deferUpdate().catch(() => {}); return; }
        const newPage = Number(pageStr) + (dir === "next" ? 1 : -1);
        await renderWeaponPicker(btn, characterId, newPage);
        return;
      }

      if (i.customId.startsWith("charequipweaponpick:") && i.isStringSelectMenu()) {
        const sel = i as StringSelectMenuInteraction;
        const [, characterId] = sel.customId.split(":");
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId)) { await sel.deferUpdate().catch(() => {}); return; }
        const chosenId = sel.values[0];

        const chosen = await prisma.weapon.findUnique({ where: { id: chosenId } });
        if (!chosen || chosen.userId !== interaction.user.id) { await sel.deferUpdate().catch(() => {}); return; }

        await prisma.weapon.updateMany({ where: { userId: interaction.user.id, characterId, isEquipped: true }, data: { isEquipped: false } });
        await prisma.weapon.update({ where: { id: chosenId }, data: { isEquipped: true, characterId } });
        if (characterId === "self") {
          await prisma.user.update({ where: { id: interaction.user.id }, data: { weaponType: chosen.weaponType } });
        }
        invalidateBonusCache(interaction.user.id, characterId);

        await renderAndReply(sel, characterId, "weapon");
        return;
      }

      const MAX_GRID_POINTS = 12;
      const CLEAR_ECHO = "__clear__";
      const ELEMENT_FILTER_CHOICES = ["ALL", "FUSION", "GLACIO", "ELECTRO", "AERO", "HAVOC", "SPECTRO"];
      const COST_FILTER_CHOICES = ["ALL", "1", "3", "4"];

      // Shared by the initial "Equip" button and both filter dropdowns below
      // — Discord select menus hard-cap at 25 options, and a single element
      // filter alone can still exceed that for a popular element (e.g. every
      // Spectro echo pulled to date). Two independent filter dimensions
      // (element AND cost) combine to narrow far enough in practice; a
      // "showing N of M" hint still covers the rare remaining overflow.
      const renderEchoPicker = async (
        target: ButtonInteraction | StringSelectMenuInteraction,
        characterId: string, slot: number, elementFilter: string, costFilter: string,
      ) => {
        const [currentEcho, allEquipped, unequipped] = await Promise.all([
          prisma.echo.findFirst({ where: { userId: interaction.user.id, characterId, isEquipped: true, equippedSlot: slot } }),
          prisma.echo.findMany({ where: { userId: interaction.user.id, characterId, isEquipped: true }, select: { cost: true, equippedSlot: true } }),
          prisma.echo.findMany({
            where: {
              userId: interaction.user.id, isEquipped: false,
              ...(elementFilter !== "ALL" ? { element: elementFilter as Element } : {}),
              ...(costFilter !== "ALL" ? { cost: Number(costFilter) } : {}),
            },
            orderBy: [{ rarity: "desc" }, { cost: "desc" }, { level: "desc" }],
          }),
        ]);
        const pointsExcludingSlot = allEquipped.filter(e => e.equippedSlot !== slot).reduce((sum, e) => sum + e.cost, 0);
        const slotName = slot === 0 ? "Main Slot" : `Sub Slot ${slot}`;
        const filterKey = `${characterId}:${slot}:${elementFilter}:${costFilter}`;

        const elementSelect = new StringSelectMenuBuilder()
          .setCustomId(`charequipechofilter:${filterKey}`)
          .setPlaceholder(`Element: ${elementFilter === "ALL" ? "All" : elementFilter}`)
          .addOptions(ELEMENT_FILTER_CHOICES.map(el => ({
            label: el === "ALL" ? "All Elements" : `${ELEMENT_EMOJI[el as Element] ?? ""} ${el}`,
            value: el, default: el === elementFilter,
          })));
        const costSelect = new StringSelectMenuBuilder()
          .setCustomId(`charequipechocostfilter:${filterKey}`)
          .setPlaceholder(`Cost: ${costFilter === "ALL" ? "All" : `${costFilter}-cost`}`)
          .addOptions(COST_FILTER_CHOICES.map(c => ({
            label: c === "ALL" ? "All Costs" : `${c}-cost`, value: c, default: c === costFilter,
          })));
        const filterRows = [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(elementSelect),
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(costSelect),
        ];

        if (unequipped.length === 0 && !currentEcho) {
          const activeFilters = [elementFilter !== "ALL" ? elementFilter : null, costFilter !== "ALL" ? `${costFilter}-cost` : null].filter(Boolean);
          await target.update({
            embeds: [new EmbedBuilder().setColor(0x334155).setDescription(
              `◈ You have no unequipped echoes for **${slotName}**${activeFilters.length ? ` matching **${activeFilters.join(" · ")}**` : ""}.\n` +
              (activeFilters.length ? "Try different filters, or " : "") + "Defeat enemies to collect more."
            )],
            components: [selectRow, ...filterRows],
          }).catch(() => {});
          return;
        }

        const opts: { label: string; description: string; value: string; emoji?: any }[] = [];
        if (currentEcho) {
          opts.push({ label: `✕  Clear slot — unequip ${currentEcho.name.slice(0, 40)}`, description: `Remove the current echo from ${slotName}`, value: CLEAR_ECHO, emoji: "🗑️" });
        }
        const shown = unequipped.slice(0, currentEcho ? 24 : 25);
        for (const e of shown) {
          const pts = pointsExcludingSlot + e.cost;
          const overBudget = pts > MAX_GRID_POINTS;
          const mainVal = calcMainStatValue(e.mainStatType, e.level, e.rarity);
          const setInfo = e.setId ? NAMED_SETS[e.setId as NamedSetId] : null;
          opts.push({
            label: `${e.name}  ${ECHO_RARITY_STARS[e.rarity]}  Lv${e.level}  (${e.cost}-cost)${overBudget ? "  ⚠" : ""}`,
            description: `${setInfo ? `✦ ${setInfo.name}  ·  ` : ""}${MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType}: ${formatStatValue(e.mainStatType, mainVal)}${overBudget ? "  — would exceed 12pt" : ""}`.slice(0, 100),
            value: e.id,
            emoji: echoEmojiResolvable(e.name, ELEMENT_EMOJI[e.element as Element]),
          });
        }
        const pickSelect = new StringSelectMenuBuilder()
          .setCustomId(`charequipechopick:${characterId}:${slot}`)
          .setPlaceholder(`Select an echo for ${slotName}…`)
          .addOptions(opts);

        const hasMore = unequipped.length > shown.length;
        await target.update({
          embeds: [new EmbedBuilder().setColor(0x6366F1)
            .setTitle(`◈  ${CHARACTERS[characterId].label} — ${slotName}`)
            .setDescription(
              (currentEcho ? `**Currently equipped:** ${currentEcho.name} (Lv${currentEcho.level})\n` : `**${slotName} is empty.**\n`) +
              `Grid: **${pointsExcludingSlot}** pts used (excl. this slot) / **${MAX_GRID_POINTS}** max.` +
              (hasMore ? `\n\n-# Showing ${shown.length} of ${unequipped.length} — narrow with the filters below.` : "")
            )],
          components: [selectRow, ...filterRows, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(pickSelect)],
        }).catch(() => {});
      };

      if (i.customId.startsWith("charequipecho:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, slotRaw] = btn.customId.split(":");
        const slot = Number(slotRaw);
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId) || !(slot >= 0 && slot <= 4)) {
          await btn.deferUpdate().catch(() => {}); return;
        }
        await renderEchoPicker(btn, characterId, slot, "ALL", "ALL");
        return;
      }

      if (i.customId.startsWith("charequipechofilter:") && i.isStringSelectMenu()) {
        const sel = i as StringSelectMenuInteraction;
        const [, characterId, slotRaw, , costFilter] = sel.customId.split(":");
        const slot = Number(slotRaw);
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId) || !(slot >= 0 && slot <= 4)) {
          await sel.deferUpdate().catch(() => {}); return;
        }
        await renderEchoPicker(sel, characterId, slot, sel.values[0], costFilter);
        return;
      }

      if (i.customId.startsWith("charequipechocostfilter:") && i.isStringSelectMenu()) {
        const sel = i as StringSelectMenuInteraction;
        const [, characterId, slotRaw, elementFilter] = sel.customId.split(":");
        const slot = Number(slotRaw);
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId) || !(slot >= 0 && slot <= 4)) {
          await sel.deferUpdate().catch(() => {}); return;
        }
        await renderEchoPicker(sel, characterId, slot, elementFilter, sel.values[0]);
        return;
      }

      if (i.customId.startsWith("charequipechopick:") && i.isStringSelectMenu()) {
        const sel = i as StringSelectMenuInteraction;
        const [, characterId, slotRaw] = sel.customId.split(":");
        const slot = Number(slotRaw);
        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId) || !(slot >= 0 && slot <= 4)) {
          await sel.deferUpdate().catch(() => {}); return;
        }
        const chosen = sel.values[0];

        if (chosen === CLEAR_ECHO) {
          await prisma.echo.updateMany({ where: { userId: interaction.user.id, characterId, equippedSlot: slot, isEquipped: true }, data: { isEquipped: false, equippedSlot: null } });
          invalidateBonusCache(interaction.user.id, characterId);
          await renderAndReply(sel, characterId, "echoes");
          return;
        }

        const incoming = await prisma.echo.findUnique({ where: { id: chosen } });
        if (!incoming || incoming.userId !== interaction.user.id) { await sel.deferUpdate().catch(() => {}); return; }

        // Re-verify the point budget server-side — never trust the label's
        // ⚠ marker alone, the grid could have changed since this menu rendered.
        const allEquipped = await prisma.echo.findMany({ where: { userId: interaction.user.id, characterId, isEquipped: true }, select: { cost: true, equippedSlot: true } });
        const pointsExcludingSlot = allEquipped.filter(e => e.equippedSlot !== slot).reduce((sum, e) => sum + e.cost, 0);
        if (pointsExcludingSlot + incoming.cost > MAX_GRID_POINTS) {
          await sel.update({
            embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription(`⚠ **Over budget.** Equipping **${incoming.name}** (${incoming.cost}-cost) would use **${pointsExcludingSlot + incoming.cost}/12** points.\n\nUnequip something first.`)],
            components: [selectRow, ...navRows(characterId, "echoes")],
          }).catch(() => {});
          return;
        }

        await prisma.$transaction([
          prisma.echo.updateMany({ where: { userId: interaction.user.id, characterId, equippedSlot: slot, isEquipped: true }, data: { isEquipped: false, equippedSlot: null } }),
          prisma.echo.update({ where: { id: incoming.id }, data: { isEquipped: true, equippedSlot: slot, characterId } }),
        ]);
        invalidateBonusCache(interaction.user.id, characterId);

        await renderAndReply(sel, characterId, "echoes");
        return;
      }

      if (i.customId.startsWith("charlvl:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, trackRaw] = btn.customId.split(":");

        if (!CHARACTERS[characterId] || !ownedCharacterIds.has(characterId) || !isKitTrack(trackRaw)) {
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
          const raced = err instanceof Error &&
            ["insufficient-funds-race", "already-maxed-race"].includes(err.message);
          if (!raced) console.error("[character] kit-level-up transaction failed", err);
          await renderAndReply(btn, characterId, "kit").catch(() => btn.deferUpdate().catch(() => {}));
        }
      }
    });

    collector?.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
