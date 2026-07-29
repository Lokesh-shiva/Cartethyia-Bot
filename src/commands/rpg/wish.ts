import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuInteraction,
  AttachmentBuilder, ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { auditSpend } from "../../lib/antiCheat";
import {
  WISH_WEAPONS_4STAR, WISH_WEAPONS_5STAR, WELLSPRING_WEAPON,
  WishWeapon, calcWishAtk, calcWishSubStat,
} from "../../lib/wishWeapons";
import { getWeaponImagePath } from "../../lib/weapons";
import { CE, getEmojiResolvable } from "../../lib/emojiManager";
import path from "path";
import fs from "fs";
import { CHARACTER_KITS } from "../../lib/characterKit";
import "../../lib/kits";

// Standard-banner 4★ character pool — characters here have no signature
// weapon (that's exactly why they're eligible: a signature weapon like
// Solace's Wellspring is designed as a limited-banner exclusive, so a
// character carrying one stays off the standard pool permanently). A 4★
// pull rolls a real character instead of a weapon this often.
const STANDARD_CHARACTER_POOL: string[] = ["kaelith"];
const STANDARD_CHARACTER_CHANCE = 0.30;

function roll4StarOrCharacter(): { weapon: WishWeapon | null; character?: string } {
  if (STANDARD_CHARACTER_POOL.length > 0 && Math.random() < STANDARD_CHARACTER_CHANCE) {
    const characterId = STANDARD_CHARACTER_POOL[Math.floor(Math.random() * STANDARD_CHARACTER_POOL.length)];
    return { weapon: null, character: characterId };
  }
  return { weapon: roll4Star() };
}

// ── 3★ material rewards ───────────────────────────────────────────────────────
interface MaterialDrop { forgingOres: number; tuningModules: number; credits: number; label: string; }
const MATERIAL_DROPS: MaterialDrop[] = [
  { forgingOres: 4, tuningModules: 0, credits: 400, label: "4× Forging Ores + 400 Credits"       },
  { forgingOres: 3, tuningModules: 1, credits: 200, label: "3× Forging Ores + 1× Tuning Module"  },
  { forgingOres: 2, tuningModules: 2, credits: 0,   label: "2× Forging Ores + 2× Tuning Modules" },
  { forgingOres: 5, tuningModules: 0, credits: 0,   label: "5× Forging Ores"                      },
  { forgingOres: 3, tuningModules: 0, credits: 600, label: "3× Forging Ores + 600 Credits"       },
];
function rollMaterials(): MaterialDrop {
  return MATERIAL_DROPS[Math.floor(Math.random() * MATERIAL_DROPS.length)];
}

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_5_RATE = 0.006;
const BASE_4_RATE = 0.051;
const SOFT_PITY   = 65;
const HARD_PITY   = 80;
const HARD_PITY_4 = 10;

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};
const RARITY_COLOR: Record<number, number> = { 3: 0x4A4A5A, 4: 0x7C3AED, 5: 0xF5A623 };
const RARITY_LABEL: Record<number, string>  = { 3: "◇", 4: "◆", 5: "✦" };

const ANIM_5STAR = path.join(process.cwd(), "assets", "5_star animation.gif");
const ANIM_4STAR = path.join(process.cwd(), "assets", "4_star animation.gif");
const ANIM_3STAR = path.join(process.cwd(), "assets", "3_star animation.gif");

// ── Gacha logic ───────────────────────────────────────────────────────────────
function softPityRate(pity: number): number {
  if (pity < SOFT_PITY) return BASE_5_RATE;
  return Math.min(1, BASE_5_RATE + (pity - SOFT_PITY + 1) * 0.065);
}

function roll5Star(guaranteed: boolean, targetId: string | null): WishWeapon {
  const target = targetId ? WISH_WEAPONS_5STAR.find(w => w.id === targetId) : null;
  if (guaranteed && target) return target;
  if (guaranteed) return WISH_WEAPONS_5STAR[Math.floor(Math.random() * WISH_WEAPONS_5STAR.length)];
  // 50/50 — win = target (or random if no target), lose = random different
  if (Math.random() < 0.5) return target ?? WISH_WEAPONS_5STAR[Math.floor(Math.random() * WISH_WEAPONS_5STAR.length)];
  // Lost coin — random 5★ (may coincidentally match target)
  return WISH_WEAPONS_5STAR[Math.floor(Math.random() * WISH_WEAPONS_5STAR.length)];
}

function roll4Star(): WishWeapon {
  return WISH_WEAPONS_4STAR[Math.floor(Math.random() * WISH_WEAPONS_4STAR.length)];
}

type PullResult =
  | { tier: 5; weapon: WishWeapon; newPity: number; new4Pity: number; newGuaranteed: boolean }
  | { tier: 4; weapon: WishWeapon | null; character?: string; newPity: number; new4Pity: number; newGuaranteed: boolean }
  | { tier: 3; mat: MaterialDrop;  newPity: number; new4Pity: number; newGuaranteed: boolean };

function doSinglePull(wishPity: number, wish4Pity: number, wishGuaranteed: boolean, targetId: string | null): PullResult {
  let newPity       = wishPity + 1;
  let new4Pity      = wish4Pity + 1;
  let newGuaranteed = wishGuaranteed;
  const rate5 = softPityRate(newPity);
  const r     = Math.random();

  if (newPity >= HARD_PITY || r < rate5) {
    const weapon  = roll5Star(newGuaranteed, targetId);
    const target  = targetId ? WISH_WEAPONS_5STAR.find(w => w.id === targetId) : null;
    // Lost 50/50 if: not guaranteed AND weapon isn't the target (or no target, any random counts as win)
    newGuaranteed = !newGuaranteed && target != null && weapon.id !== target.id;
    return { tier: 5, weapon, newPity: 0, new4Pity: 0, newGuaranteed };
  }
  if (new4Pity >= HARD_PITY_4 || r < BASE_5_RATE + BASE_4_RATE) {
    return { tier: 4, ...roll4StarOrCharacter(), newPity, new4Pity: 0, newGuaranteed };
  }
  return { tier: 3, mat: rollMaterials(), newPity, new4Pity, newGuaranteed };
}

// ── Banner embed ──────────────────────────────────────────────────────────────
function bannerEmbed(
  pity: number, wish4Pity: number, guaranteed: boolean,
  keys: number, color: number,
  target: WishWeapon | null, targetImg: string | null,
): EmbedBuilder {
  const targetBlock = target
    ? [
        `**✦  Resonance Target: ${target.name}**`,
        `${"★".repeat(5)}  ·  ${target.type}`,
        ``,
        `\`BASE ATK\`  **${calcWishAtk(target,1)}**`,
        `\`${target.subStatType.replace(/_/g," ")}\`  **+${calcWishSubStat(target.subStatBase,target.subStatScale,1)}%**`,
        `\`? ? ?\`  *(hidden — level up to reveal)*`,
        target.hiddenSub2Type ? `\`? ? ?\`  *(hidden — level up to reveal)*` : "",
        ``,
        `**Passive**`,
        `> ${target.passive}`,
        ``,
        `*${target.lore}*`,
      ].filter(Boolean).join("\n")
    : [
        `**No resonance target set.**`,
        ``,
        `Use the dropdown below to choose which 5★ weapon you're pulling toward.`,
        `On a guaranteed pull, you will receive your chosen weapon.`,
        ``,
        `*Available 5★ weapons:*`,
        WISH_WEAPONS_5STAR.map(w => `◈  **${w.name}**  ·  ${w.type}`).join("\n"),
        STANDARD_CHARACTER_POOL.length > 0
          ? `\n*A 4★ hit can also be a character:*\n` + STANDARD_CHARACTER_POOL.map(id => `${CHARACTER_KITS[id].emoji}  **${CHARACTER_KITS[id].label}**`).join("\n")
          : "",
      ].filter(Boolean).join("\n");

  const e = new EmbedBuilder()
    .setColor(target ? 0xF5A623 : color)
    .setAuthor({ name: "◈  Fracture Resonance  ·  Weapon Banner" })
    .setDescription(targetBlock)
    .addFields(
      { name: "Your Pity",     value: `**${pity}** / ${HARD_PITY}`,     inline: true },
      { name: "4★ Pity",      value: `**${wish4Pity}** / ${HARD_PITY_4}`, inline: true },
      { name: "Fracture Keys", value: `${CE.fk} **${keys}**`,             inline: true },
      {
        name: "Rates",
        value: [
          `5★: **0.6%** base · soft pity **${SOFT_PITY}** · hard pity **${HARD_PITY}**`,
          `4★: **5.1%** base · guaranteed every **10** pulls · **30%** of 4★ hits are a character instead of a weapon`,
          `5★ 50/50: win = **your target** · lose = random 5★ · next pull guaranteed target`,
          guaranteed ? `✦ **Next 5★ is guaranteed your target**` : "",
        ].filter(Boolean).join("\n"),
      },
    )
    .setFooter({ text: "CARTETHYIA  ·  Fracture Resonance" });

  if (target && targetImg) e.setImage("attachment://target.png");
  return e;
}

// ── Suspense animation ────────────────────────────────────────────────────────
const SUSPENSE_5STAR = [
  { title: "◈  Reaching into the fracture...", desc: "*The resonance responds...*",                        color: 0x1E1F2E },
  { title: "✦  Something stirs in the void...", desc: "*A weapon takes shape from the darkness...*",       color: 0x2D1B4E },
  { title: "⚡  The fracture tears open...",    desc: "*Energy crackles — a name is about to surface...*", color: 0x4A0E6B },
];
const SUSPENSE_4STAR = [
  { title: "◈  Reaching into the fracture...", desc: "*The resonance stirs...*",               color: 0x1E1F2E },
  { title: "◆  A resonance takes form...",      desc: "*Something worthy emerges from the glow...*", color: 0x2D1B69 },
];
const SUSPENSE_3STAR = [
  { title: "◈  Reaching into the fracture...", desc: "*The fracture gives something back...*", color: 0x1A1A1A },
];

async function runSuspense(interaction: ChatInputCommandInteraction, tier: 3 | 4 | 5, overrideGifPath?: string): Promise<void> {
  const frames  = tier === 5 ? SUSPENSE_5STAR : tier === 4 ? SUSPENSE_4STAR : SUSPENSE_3STAR;
  const defaultGif = tier === 5 ? ANIM_5STAR  : tier === 4 ? ANIM_4STAR     : ANIM_3STAR;
  const gifPath = overrideGifPath && fs.existsSync(overrideGifPath) ? overrideGifPath : defaultGif;
  const delay   = tier === 5 ? 1400           : tier === 4 ? 1000           : 800;

  for (let i = 0; i < frames.length; i++) {
    const isLast = i === frames.length - 1;
    const files  = isLast ? [new AttachmentBuilder(gifPath, { name: "anim.gif" })] : [];
    const embed  = new EmbedBuilder()
      .setColor(frames[i].color).setTitle(frames[i].title).setDescription(frames[i].desc)
      .setFooter({ text: "CARTETHYIA  ·  Wish" });
    if (isLast) embed.setImage("attachment://anim.gif");
    await interaction.editReply({ embeds: [embed], files, components: [] });
    await new Promise(r => setTimeout(r, delay));
  }
}

// ── Character-banner suspense text (Milestone 4b) — the generic SUSPENSE_5STAR
// text above says "a weapon takes shape," which is wrong for a character pull.
// Wellspring/Standard weapon pulls keep using SUSPENSE_5STAR as-is (it's
// already weapon-appropriate).
const SUSPENSE_CHARACTER_5STAR = [
  { title: "◈  Reaching into the fracture...",  desc: "*The resonance responds...*",                          color: 0x1E1F2E },
  { title: "✦  A presence stirs within the light...", desc: "*Someone is taking shape beyond the veil...*",   color: 0x2D1B4E },
  { title: "⚡  The fracture tears open...",     desc: "*A name is about to answer your call...*",            color: 0x4A0E6B },
];

// ── Reveal-button suspense (Solace + Wellspring 5★ moments only — Standard's
// runSuspense() above is untouched, still fixed-delay auto-advance). Plays
// through the build-up frames on a short delay same as before, but the FINAL
// frame (the looping GIF) stays up indefinitely with a "▶ Reveal" button
// instead of auto-advancing after ~1.4s — lets the GIF actually loop a few
// times before the player chooses to see the result. Falls back to
// auto-revealing after 5 minutes if the player never clicks (never leaves the
// pull stuck forever).
async function runSuspenseWithReveal(
  interaction: ChatInputCommandInteraction,
  frames: { title: string; desc: string; color: number }[],
  gifPath: string,
): Promise<void> {
  // Middle buildup frame shows the generic tier animation (same one Standard's
  // pulls already use) for escalation — text -> generic tension GIF -> the
  // dedicated character/weapon reveal GIF behind the Reveal button.
  const midFrameIdx = frames.length - 2;
  for (let i = 0; i < frames.length - 1; i++) {
    const isMid = i === midFrameIdx && midFrameIdx >= 0;
    const embed = new EmbedBuilder()
      .setColor(frames[i].color).setTitle(frames[i].title).setDescription(frames[i].desc)
      .setFooter({ text: "CARTETHYIA  ·  Wish" });
    const files = isMid ? [new AttachmentBuilder(ANIM_5STAR, { name: "anim.gif" })] : [];
    if (isMid) embed.setImage("attachment://anim.gif");
    await interaction.editReply({ embeds: [embed], files, components: [] });
    await new Promise(r => setTimeout(r, 1400));
  }

  const last = frames[frames.length - 1];
  const embed = new EmbedBuilder()
    .setColor(last.color).setTitle(last.title).setDescription(last.desc)
    .setFooter({ text: "CARTETHYIA  ·  Wish  ·  Click Reveal when ready" })
    .setImage("attachment://anim.gif");
  const revealRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("wish_reveal").setLabel("▶  Reveal").setStyle(ButtonStyle.Success),
  );

  const msg = await interaction.editReply({
    embeds: [embed], components: [revealRow],
    files: [new AttachmentBuilder(gifPath, { name: "anim.gif" })],
  });

  await new Promise<void>(resolve => {
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (b: ButtonInteraction) => b.user.id === interaction.user.id && b.customId === "wish_reveal",
      time: 5 * 60_000, max: 1,
    });
    collector.on("collect", async (btn: ButtonInteraction) => { await btn.deferUpdate(); resolve(); });
    collector.on("end", (col) => { if (col.size === 0) resolve(); });
  });
}

// ── Result embed ──────────────────────────────────────────────────────────────
function resultEmbed(w: WishWeapon, newPity: number, color: number, guaranteed: boolean, lostCoin: boolean): EmbedBuilder {
  const atk  = calcWishAtk(w, 1);
  const sub  = calcWishSubStat(w.subStatBase, w.subStatScale, 1);
  const stars = "★".repeat(w.rarity as number) + "☆".repeat(Math.max(0, 5 - (w.rarity as number)));

  const footer = [
    "Added to your arsenal  ·  /equip to equip",
    w.rarity === 5 && guaranteed   ? "◈ Guaranteed pull" : "",
    w.rarity === 5 && lostCoin     ? "◈ Lost 50/50 — next 5★ guaranteed your target" : "",
    w.rarity === 5 && !lostCoin && !guaranteed ? "◈ Won 50/50" : "",
  ].filter(Boolean).join("  ·  ");

  return new EmbedBuilder()
    .setColor(RARITY_COLOR[w.rarity as number] ?? color)
    .setTitle(`${RARITY_LABEL[w.rarity as number] ?? "◇"}  ${w.name}`)
    .setDescription([
      `${stars}  ·  ${w.type}`,
      ``,
      `\`BASE ATK\`  **${atk}**   \`${w.subStatType.replace(/_/g," ")}\`  **+${sub}%**`,
      `\`${w.hiddenSub1Type.replace(/_/g," ")}\` *(unlocks Lv 20)*${w.hiddenSub2Type ? `   \`${w.hiddenSub2Type.replace(/_/g," ")}\` *(unlocks Lv 50)*` : ""}`,
      ``,
      `> ${w.passive}`,
      ``,
      `*${w.lore}*`,
    ].join("\n"))
    .addFields({ name: "Pity", value: `${newPity} / ${HARD_PITY}`, inline: true })
    .setFooter({ text: footer });
}

// Same rate as /use fractonite's Radiant Key option (100:1) — a single pull
// button on the limited banners auto-tops-up any Radiant Key shortfall from
// Fractonite instead of requiring a separate trip to /use first. Only spends
// exactly as much Fractonite as needed to cover the shortfall; existing
// Radiant Keys are always used first.
const FRACTONITE_PER_RADIANT_KEY = 100;

function resolveKeySpend(radiantKeys: number, fractonite: number, amount: number):
  | { ok: true; radiantKeysToSpend: number; fractoniteToSpend: number }
  | { ok: false; shortMessage: string } {
  if (radiantKeys >= amount) return { ok: true, radiantKeysToSpend: amount, fractoniteToSpend: 0 };
  const shortfall = amount - radiantKeys;
  const fractoniteNeeded = shortfall * FRACTONITE_PER_RADIANT_KEY;
  if (fractonite >= fractoniteNeeded) {
    return { ok: true, radiantKeysToSpend: radiantKeys, fractoniteToSpend: fractoniteNeeded };
  }
  return {
    ok: false,
    shortMessage: `You have **${radiantKeys}** Radiant Key${radiantKeys !== 1 ? "s" : ""} and **${fractonite}** Fractonite — ` +
      `need **${amount}** total (${shortfall} more, costing ${fractoniteNeeded} Fractonite at ${FRACTONITE_PER_RADIANT_KEY}:1). ` +
      `Earn more Fractonite from **/vote**, boss/dungeon/raid wins, or Patreon.`,
  };
}

function weaponCreateData(userId: string, w: WishWeapon) {
  return {
    userId, weaponType: w.type, name: w.name, rarity: w.rarity as number,
    baseAtk: w.baseAtk, subStatType: w.subStatType, subStatVal: w.subStatBase,
    hiddenSub1Type: w.hiddenSub1Type, hiddenSub1Val: w.hiddenSub1Base,
    hiddenSub2Type: w.hiddenSub2Type ?? null, hiddenSub2Val: w.hiddenSub2Base ?? null,
    isEquipped: false,
  };
}

// ── Standard banner (unchanged from before Milestone 4b — pure extraction) ────
type StandardDbUser = {
  element: string; fractureKeys: number; wishPity: number; wish4Pity: number;
  wishGuaranteed: boolean; wishTarget: string | null;
};

async function runStandardBanner(interaction: ChatInputCommandInteraction, dbUser: StandardDbUser) {
    const color    = ELEMENT_HEX[dbUser.element] ?? ELEMENT_HEX.NONE;
    const target   = dbUser.wishTarget ? WISH_WEAPONS_5STAR.find(w => w.id === dbUser.wishTarget) ?? null : null;
    const targetImg = target ? getWeaponImagePath(target.type, target.name) : null;
    const targetFile = targetImg ? [new AttachmentBuilder(targetImg, { name: "target.png" })] : [];

    // ── Target select dropdown ────────────────────────────────────────────────
    const targetSelect = new StringSelectMenuBuilder()
      .setCustomId("wish_set_target")
      .setPlaceholder(target ? `✦ Target: ${target.name}` : "◈ Set your 5★ resonance target…")
      .addOptions(WISH_WEAPONS_5STAR.map(w => ({
        label:       w.name,
        description: `${w.type}  ·  ${w.subStatType.replace(/_/g," ")} +${w.subStatBase}%`,
        value:       w.id,
        default:     w.id === dbUser.wishTarget,
      })));

    const fkEmoji = getEmojiResolvable("cc_fracture", "🗝️");
    const pullRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("wish_x1")
        .setLabel("◈  Pull  ×1  (1)").setEmoji(fkEmoji).setStyle(ButtonStyle.Primary)
        .setDisabled(dbUser.fractureKeys < 1),
      new ButtonBuilder().setCustomId("wish_x10")
        .setLabel("✦  Pull  ×10  (10)").setEmoji(fkEmoji).setStyle(ButtonStyle.Danger)
        .setDisabled(dbUser.fractureKeys < 10),
    );
    const targetRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(targetSelect);

    const msg = await interaction.editReply({
      embeds:     [bannerEmbed(dbUser.wishPity, dbUser.wish4Pity, dbUser.wishGuaranteed, dbUser.fractureKeys, color, target, targetImg)],
      files:      targetFile,
      components: [targetRow, pullRow],
    });

    const collector = msg.createMessageComponentCollector({
      filter: b => b.user.id === interaction.user.id,
      time:   300_000, // 5 min — continuous pulling stays live on the same message, not a one-shot
    });

    const buildPullRow = (fractureKeys: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("wish_x1")
        .setLabel("◈  Pull  ×1  (1)").setEmoji(fkEmoji).setStyle(ButtonStyle.Primary)
        .setDisabled(fractureKeys < 1),
      new ButtonBuilder().setCustomId("wish_x10")
        .setLabel("✦  Pull  ×10  (10)").setEmoji(fkEmoji).setStyle(ButtonStyle.Danger)
        .setDisabled(fractureKeys < 10),
    );

    collector.on("collect", async (intr: ButtonInteraction | StringSelectMenuInteraction) => {
      // ── Set target ──────────────────────────────────────────────────────────
      if (intr.customId === "wish_set_target") {
        const sel = intr as StringSelectMenuInteraction;
        await sel.deferUpdate();
        const chosenId  = sel.values[0];
        const chosen    = WISH_WEAPONS_5STAR.find(w => w.id === chosenId)!;
        await prisma.user.update({ where: { id: interaction.user.id }, data: { wishTarget: chosenId } });

        const freshKeys = (await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { fractureKeys: true, wishPity: true, wish4Pity: true, wishGuaranteed: true } }))!;
        const newImg    = getWeaponImagePath(chosen.type, chosen.name);
        const newFile   = newImg ? [new AttachmentBuilder(newImg, { name: "target.png" })] : [];

        const newTargetSelect = new StringSelectMenuBuilder()
          .setCustomId("wish_set_target")
          .setPlaceholder(`✦ Target: ${chosen.name}`)
          .addOptions(WISH_WEAPONS_5STAR.map(w => ({
            label: w.name, description: `${w.type}  ·  ${w.subStatType.replace(/_/g," ")} +${w.subStatBase}%`,
            value: w.id, default: w.id === chosenId,
          })));

        await sel.editReply({
          embeds:     [bannerEmbed(freshKeys.wishPity, freshKeys.wish4Pity, freshKeys.wishGuaranteed, freshKeys.fractureKeys, color, chosen, newImg)],
          files:      newFile,
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(newTargetSelect), pullRow],
        });
        return;
      }

      // ── Pull ────────────────────────────────────────────────────────────────
      const btn = intr as ButtonInteraction;
      if (btn.customId !== "wish_x1" && btn.customId !== "wish_x10") return;
      await btn.deferUpdate();

      const fresh = await prisma.user.findUnique({
        where:  { id: interaction.user.id },
        select: { fractureKeys: true, wishPity: true, wish4Pity: true, wishGuaranteed: true, wishTarget: true },
      });
      if (!fresh) return;

      const amount   = btn.customId === "wish_x10" ? 10 : 1;
      const targetId = fresh.wishTarget ?? null;

      if (fresh.fractureKeys < amount) {
        await btn.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D).setTitle("◈ Not enough Fracture Keys")
            .setDescription(`You only have **${fresh.fractureKeys}** ${CE.fk} — need **${amount}**.`)],
          files: [], components: [],
        });
        return;
      }

      // ── Single ×1 ──────────────────────────────────────────────────────────
      if (amount === 1) {
        const res = doSinglePull(fresh.wishPity, fresh.wish4Pity, fresh.wishGuaranteed, targetId);
        const { newPity, new4Pity, newGuaranteed } = res;

        let pulledCharacterIsDupe = false;
        if (res.tier === 3) {
          await prisma.user.update({
            where: { id: interaction.user.id },
            data: { fractureKeys: { decrement: 1 }, wishPity: newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed,
                    forgingOres: { increment: res.mat.forgingOres }, tuningModules: { increment: res.mat.tuningModules }, credits: { increment: res.mat.credits } },
          });
        } else if (res.tier === 4 && res.character) {
          const existingProgress = await prisma.characterProgress.findUnique({
            where: { userId_characterId: { userId: interaction.user.id, characterId: res.character } },
          });
          pulledCharacterIsDupe = existingProgress !== null;
          await prisma.$transaction([
            prisma.user.update({ where: { id: interaction.user.id },
              data: { fractureKeys: { decrement: 1 }, wishPity: newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed } }),
            prisma.characterProgress.upsert({
              where:  { userId_characterId: { userId: interaction.user.id, characterId: res.character } },
              create: { userId: interaction.user.id, characterId: res.character },
              update: { constellationTokens: { increment: 1 } },
            }),
          ]);
        } else {
          await prisma.$transaction([
            prisma.user.update({ where: { id: interaction.user.id },
              data: { fractureKeys: { decrement: 1 }, wishPity: newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed } }),
            prisma.weapon.create({ data: weaponCreateData(interaction.user.id, res.weapon!) }),
          ]);
        }
        auditSpend(interaction.user.id, { fractureKeys: 1 }, `wish:1pull:${res.tier}star`);

        await runSuspense(interaction, res.tier);

        const afterKeys = fresh.fractureKeys - 1;
        const continueRow = [targetRow, buildPullRow(afterKeys)];

        if (res.tier === 3) {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x4A4A5A).setTitle("◇  The fracture yields materials")
              .setDescription(`**${res.mat.label}**\n\n*The resonance wasn't strong enough this time.*`)
              .addFields({ name: "Pity", value: `${newPity} / ${HARD_PITY}`, inline: true })
              .setFooter({ text: "CARTETHYIA  ·  Wish  ·  Keep pulling — pity carries over" })],
            files: [], components: continueRow,
          });
        } else if (res.tier === 4 && res.character) {
          const kit = CHARACTER_KITS[res.character];
          const artPath = path.join(process.cwd(), kit.portraitPath);
          const hasArt = fs.existsSync(artPath);
          const files = hasArt ? [new AttachmentBuilder(artPath, { name: "character.png" })] : [];
          const embed = new EmbedBuilder()
            .setColor(RARITY_COLOR[4])
            .setTitle(`◆  ${kit.label}!`)
            .setDescription(`${kit.emoji} **${kit.label}**  ★★★★${pulledCharacterIsDupe ? "  *(duplicate — converted to a Constellation Token)*" : ""}`)
            .addFields({ name: "Pity", value: `${newPity} / ${HARD_PITY}`, inline: true })
            .setFooter({ text: "CARTETHYIA  ·  Wish" });
          if (hasArt) embed.setImage("attachment://character.png");
          await interaction.editReply({ embeds: [embed], files, components: continueRow });
        } else {
          const tgt      = targetId ? WISH_WEAPONS_5STAR.find(w => w.id === targetId) ?? null : null;
          const lostCoin = res.weapon!.rarity === 5 && !fresh.wishGuaranteed && tgt != null && res.weapon!.id !== tgt.id;
          const imgPath  = getWeaponImagePath(res.weapon!.type, res.weapon!.name);
          const files    = imgPath ? [new AttachmentBuilder(imgPath, { name: "weapon.png" })] : [];
          const embed    = resultEmbed(res.weapon!, newPity, color, fresh.wishGuaranteed, lostCoin);
          if (imgPath) embed.setImage("attachment://weapon.png");
          await interaction.editReply({ embeds: [embed], files, components: continueRow });
        }
        return;
      }

      // ── ×10 ────────────────────────────────────────────────────────────────
      let pity = fresh.wishPity, p4 = fresh.wish4Pity, guar = fresh.wishGuaranteed;
      const results: PullResult[] = [];
      for (let i = 0; i < 10; i++) {
        const r = doSinglePull(pity, p4, guar, targetId);
        results.push(r); pity = r.newPity; p4 = r.new4Pity; guar = r.newGuaranteed;
      }
      if (!results.some(r => r.tier >= 4)) {
        results[9] = { tier: 4, weapon: roll4Star(), newPity: pity, new4Pity: 0, newGuaranteed: guar }; p4 = 0;
      }

      const matTotals = { forgingOres: 0, tuningModules: 0, credits: 0 };
      for (const r of results) if (r.tier === 3) {
        matTotals.forgingOres += r.mat.forgingOres; matTotals.tuningModules += r.mat.tuningModules; matTotals.credits += r.mat.credits;
      }
      const weaponResults = results.filter(r => r.tier === 5 || (r.tier === 4 && r.weapon != null)) as
        (Extract<PullResult, { tier: 5 }> | (Extract<PullResult, { tier: 4 }> & { weapon: WishWeapon }))[];
      const characterResults = results.filter(r => r.tier === 4 && r.character != null) as
        (Extract<PullResult, { tier: 4 }> & { character: string })[];
      const star3count       = results.filter(r => r.tier === 3).length;

      // Standard-banner character hits are rare (one 4★ roll in ~3.3), but a
      // ×10 batch could still pull the same character twice — track
      // ownership across the batch the same way the Solace banner does, so
      // the SECOND hit in one pull correctly converts to a token instead of
      // silently no-oping on the upsert.
      const existingOwnership = await prisma.characterProgress.findMany({
        where:  { userId: interaction.user.id, characterId: { in: [...new Set(characterResults.map(r => r.character))] } },
        select: { characterId: true },
      });
      const ownedSet = new Set(existingOwnership.map(p => p.characterId));
      const characterDupes = new Map<string, boolean>(); // per-result dupe flag, keyed by result index via closure below
      const characterCounts = new Map<string, number>(); // total copies pulled this batch, per character
      for (const r of characterResults) {
        const isDupe = ownedSet.has(r.character);
        characterDupes.set(`${results.indexOf(r)}`, isDupe);
        ownedSet.add(r.character); // first copy this batch flips it owned for any later duplicate in the same batch
        characterCounts.set(r.character, (characterCounts.get(r.character) ?? 0) + 1);
      }

      await prisma.$transaction([
        prisma.user.update({ where: { id: interaction.user.id },
          data: { fractureKeys: { decrement: 10 }, wishPity: pity, wish4Pity: p4, wishGuaranteed: guar,
                  forgingOres: { increment: matTotals.forgingOres }, tuningModules: { increment: matTotals.tuningModules }, credits: { increment: matTotals.credits } } }),
        ...weaponResults.map(r => prisma.weapon.create({ data: weaponCreateData(interaction.user.id, r.weapon!) })),
        ...[...characterCounts.entries()].map(([characterId, count]) => {
          const wasOwnedBeforeBatch = existingOwnership.some(p => p.characterId === characterId);
          const dupeCountThisBatch = wasOwnedBeforeBatch ? count : count - 1; // first-ever copy grants ownership, not a token
          return prisma.characterProgress.upsert({
            where:  { userId_characterId: { userId: interaction.user.id, characterId } },
            create: { userId: interaction.user.id, characterId, constellationTokens: dupeCountThisBatch },
            update: { constellationTokens: { increment: dupeCountThisBatch } },
          });
        }),
      ]);
      auditSpend(interaction.user.id, { fractureKeys: 10 }, `wish:10pull:${weaponResults.length}weapons:${characterResults.length}chars`);

      const has5 = results.some(r => r.tier === 5), has4 = results.some(r => r.tier === 4);
      await runSuspense(interaction, has5 ? 5 : has4 ? 4 : 3);

      const star5s    = results.filter(r => r.tier === 5) as Extract<PullResult, { tier:5 }>[];
      const star4s    = results.filter(r => r.tier === 4) as Extract<PullResult, { tier:4 }>[];
      const highlight: (Extract<PullResult, { tier: 5 }> | Extract<PullResult, { tier: 4 }>) | undefined = star5s[0] ?? star4s[0];

      const lines = results.map((r, idx) => {
        if (r.tier === 3) return `◇  *${r.mat.label}*`;
        if (r.tier === 4 && r.character) {
          const kit = CHARACTER_KITS[r.character];
          const isDupe = characterDupes.get(`${idx}`) ?? false;
          return `◆  ${kit.emoji} **${kit.label}**  ★★★★${isDupe ? "  *(dupe → token)*" : ""}`;
        }
        return `${RARITY_LABEL[r.tier]}  **${r.weapon!.name}**  ${"★".repeat(r.tier)}  ·  ${r.weapon!.type}`;
      });

      const summaryEmbed = new EmbedBuilder()
        .setColor(star5s.length ? RARITY_COLOR[5] : star4s.length ? RARITY_COLOR[4] : 0x4A4A5A)
        .setTitle("✦  ×10 Fracture Resonance").setDescription(lines.join("\n"))
        .addFields(
          { name: "✦ 5★", value: `${star5s.length}`, inline: true },
          { name: "◆ 4★", value: `${star4s.length}`, inline: true },
          { name: "Pity",  value: `${pity} / ${HARD_PITY}`, inline: true },
          ...(star3count > 0 ? [{ name: "◇ Materials", value: `${matTotals.forgingOres} Forging Ores · ${matTotals.tuningModules} Tuning Modules · ${matTotals.credits} Credits`, inline: false }] : []),
        )
        .setFooter({ text: "CARTETHYIA  ·  Wish  ·  All weapons added to arsenal  ·  /equip to swap" });

      const highlightCharacterId: string | null = (highlight as any)?.character ?? null;
      const highlightIsCharacter = highlightCharacterId !== null;
      const hlImg = highlightCharacterId
        ? (fs.existsSync(path.join(process.cwd(), CHARACTER_KITS[highlightCharacterId].portraitPath)) ? path.join(process.cwd(), CHARACTER_KITS[highlightCharacterId].portraitPath) : null)
        : (highlight ? getWeaponImagePath(highlight.weapon!.type, highlight.weapon!.name) : null);
      const files = hlImg ? [new AttachmentBuilder(hlImg, { name: highlightIsCharacter ? "character.png" : "weapon.png" })] : [];
      if (hlImg) summaryEmbed.setImage(highlightIsCharacter ? "attachment://character.png" : "attachment://weapon.png");
      await interaction.editReply({ embeds: [summaryEmbed], files, components: [targetRow, buildPullRow(fresh.fractureKeys - 10)] });
    });

    collector.on("end", () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
}

// ── Character banner — "The Rising Overture", featuring Solace (Milestone 4b) ─
type CharacterDbUser = {
  element: string; radiantKeys: number; fractonite: number;
  limitedCharBannerPity: number; limitedCharBanner4Pity: number; limitedCharBannerGuaranteed: boolean;
};

const SOLACE_ART_PATH = path.join(process.cwd(), "assets", "Characters", "Solace.png");
const SOLACE_REVEAL_GIF = path.join(process.cwd(), "assets", "Characters", "Solace_reveal.gif");

// Banner #1 has no standard pool to lose a 50/50 into — every 5★ IS Solace.
// limitedCharBannerGuaranteed is carried in the schema for forward-compat with a
// real banner #2, but is functionally inert here (never flips true, never
// changes the roll) since there's no coin flip to win or lose yet.
//
// 4★ tier: same WISH_WEAPONS_4STAR pool Standard/Wellspring already roll
// from via roll4Star() — a Solace-banner 4★ hit is a real, usable weapon
// (goes into the arsenal via weaponCreateData, exactly like every other
// 4★/5★ weapon drop), not a currency stand-in.

type SolacePullResult =
  | { tier: "5star"; newPity: number; new4Pity: number }
  | { tier: "4star"; weapon: WishWeapon; newPity: number; new4Pity: number }
  | { tier: "3star"; mat: MaterialDrop; newPity: number; new4Pity: number };

function doSingleSolacePull(pity: number, pity4: number): SolacePullResult {
  const newPity  = pity + 1;
  const newPity4 = pity4 + 1;
  const rate5 = softPityRate(newPity);
  const r     = Math.random();

  if (newPity >= HARD_PITY || r < rate5) {
    return { tier: "5star", newPity: 0, new4Pity: 0 };
  }
  if (newPity4 >= HARD_PITY_4 || r < BASE_5_RATE + BASE_4_RATE) {
    return { tier: "4star", weapon: roll4Star(), newPity, new4Pity: 0 };
  }
  return { tier: "3star", mat: rollMaterials(), newPity, new4Pity: newPity4 };
}

function solaceCharacterBannerEmbed(pity: number, keys: number, fractonite: number, color: number, bannerEndsAt?: Date | null): EmbedBuilder {
  const fields = [
    { name: "Your Pity",    value: `**${pity}** / ${HARD_PITY}`, inline: true },
    { name: "Radiant Keys", value: `${CE.rk ?? "🔑"} **${keys}**`, inline: true },
    { name: "Fractonite",   value: `${CE.ft ?? "🔷"} **${fractonite}**`, inline: true },
    { name: "Rates", value: `5★: **0.6%** base · soft pity **${SOFT_PITY}** · hard pity **${HARD_PITY}**\n4★-tier: **5.1%** base · guaranteed every **${HARD_PITY_4}** pulls · a full ×10 miss always yields at least one`, inline: false },
  ];
  if (bannerEndsAt) {
    fields.push({ name: "Banner Ends", value: `<t:${Math.floor(bannerEndsAt.getTime() / 1000)}:R> (<t:${Math.floor(bannerEndsAt.getTime() / 1000)}:f>)`, inline: false });
  }
  return new EmbedBuilder()
    .setColor(0xFCD34D)
    .setAuthor({ name: "✦  The Rising Overture  ·  Character Banner" })
    .setDescription(
      `**Featuring: ✨ Solace**\n\nEvery 5★ pull on this banner is guaranteed Solace — there's no coin flip to lose yet. ` +
      `A duplicate pull converts into a Constellation Token instead of a second copy.\n\n` +
      `-# Short on Radiant Keys? Pulling automatically converts Fractonite to cover the gap (${FRACTONITE_PER_RADIANT_KEY} Fractonite = 1 Key).`
    )
    .addFields(fields)
    .setFooter({ text: "CARTETHYIA  ·  The Rising Overture" });
}

async function runCharacterBanner(interaction: ChatInputCommandInteraction, dbUser: CharacterDbUser) {
  const color = ELEMENT_HEX[dbUser.element] ?? ELEMENT_HEX.NONE;

  const pullRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("solace_x1").setLabel("◈  Pull  ×1  (1)").setStyle(ButtonStyle.Primary)
      .setDisabled(!resolveKeySpend(dbUser.radiantKeys, dbUser.fractonite, 1).ok),
    new ButtonBuilder().setCustomId("solace_x10").setLabel("✦  Pull  ×10  (10)").setStyle(ButtonStyle.Success)
      .setDisabled(!resolveKeySpend(dbUser.radiantKeys, dbUser.fractonite, 10).ok),
  );

  const bannerWindow = await prisma.bannerWindow.findUnique({ where: { id: "banner1" } });
  const hasOverviewArt = fs.existsSync(SOLACE_ART_PATH);
  const overviewEmbed = solaceCharacterBannerEmbed(dbUser.limitedCharBannerPity, dbUser.radiantKeys, dbUser.fractonite, color, bannerWindow?.endsAt);
  if (hasOverviewArt) overviewEmbed.setImage("attachment://solace_banner.png");
  const msg = await interaction.editReply({
    embeds: [overviewEmbed],
    files: hasOverviewArt ? [new AttachmentBuilder(SOLACE_ART_PATH, { name: "solace_banner.png" })] : [],
    components: [pullRow],
  });

  const collector = msg.createMessageComponentCollector({
    filter: b => b.user.id === interaction.user.id, time: 300_000, // 5 min — continuous pulling stays on this message
  });

  const buildSolacePullRow = (radiantKeys: number, fractonite: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("solace_x1").setLabel("◈  Pull  ×1  (1)").setStyle(ButtonStyle.Primary)
      .setDisabled(!resolveKeySpend(radiantKeys, fractonite, 1).ok),
    new ButtonBuilder().setCustomId("solace_x10").setLabel("✦  Pull  ×10  (10)").setStyle(ButtonStyle.Success)
      .setDisabled(!resolveKeySpend(radiantKeys, fractonite, 10).ok),
  );

  collector.on("collect", async (btn: ButtonInteraction) => {
    if (btn.customId !== "solace_x1" && btn.customId !== "solace_x10") return;
    await btn.deferUpdate();

    const fresh = await prisma.user.findUnique({
      where: { id: interaction.user.id },
      select: { radiantKeys: true, fractonite: true, limitedCharBannerPity: true, limitedCharBanner4Pity: true },
    });
    if (!fresh) return;

    const amount = btn.customId === "solace_x10" ? 10 : 1;
    const spend = resolveKeySpend(fresh.radiantKeys, fresh.fractonite, amount);
    if (!spend.ok) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D).setTitle("◈ Not enough Radiant Keys")
          .setDescription(spend.shortMessage)],
        components: [],
      });
      return;
    }

    // Ownership check ONCE up front — can only flip not-owned -> owned mid-batch, never back.
    const existingProgress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId: interaction.user.id, characterId: "solace" } },
    });
    let owned = existingProgress !== null;

    let pity = fresh.limitedCharBannerPity, pity4 = fresh.limitedCharBanner4Pity;
    const rolls: ({ tier: "5star"; isDuplicate: boolean } | { tier: "4star"; weapon: WishWeapon } | { tier: "3star"; mat: MaterialDrop })[] = [];
    let hits = 0, dupes = 0;
    const matTotals = { forgingOres: 0, tuningModules: 0, credits: 0 };
    for (let i = 0; i < amount; i++) {
      const r = doSingleSolacePull(pity, pity4);
      pity = r.newPity; pity4 = r.new4Pity;
      if (r.tier === "5star") {
        hits++;
        const isDuplicate = owned;
        if (isDuplicate) dupes++;
        owned = true;
        rolls.push({ tier: "5star", isDuplicate });
      } else if (r.tier === "4star") {
        rolls.push({ tier: "4star", weapon: r.weapon });
      } else {
        matTotals.forgingOres += r.mat.forgingOres; matTotals.tuningModules += r.mat.tuningModules; matTotals.credits += r.mat.credits;
        rolls.push({ tier: "3star", mat: r.mat });
      }
    }
    // Same safety net as Wellspring's ×10: never let a full 10-pull whiff all
    // the way down to only small materials with nothing 4★-tier or better.
    if (amount === 10 && !rolls.some(r => r.tier === "5star" || r.tier === "4star")) {
      const last = rolls[9] as { tier: "3star"; mat: MaterialDrop };
      matTotals.forgingOres -= last.mat.forgingOres; matTotals.tuningModules -= last.mat.tuningModules; matTotals.credits -= last.mat.credits;
      rolls[9] = { tier: "4star", weapon: roll4Star() };
      pity4 = 0;
    }
    const weaponRolls = rolls.filter((r): r is { tier: "4star"; weapon: WishWeapon } => r.tier === "4star");

    await prisma.$transaction([
      prisma.user.update({
        where: { id: interaction.user.id },
        data: { radiantKeys: { decrement: spend.radiantKeysToSpend }, fractonite: { decrement: spend.fractoniteToSpend },
                limitedCharBannerPity: pity, limitedCharBanner4Pity: pity4,
                forgingOres: { increment: matTotals.forgingOres }, tuningModules: { increment: matTotals.tuningModules }, credits: { increment: matTotals.credits } },
      }),
      ...(hits > 0 ? [prisma.characterProgress.upsert({
        where:  { userId_characterId: { userId: interaction.user.id, characterId: "solace" } },
        create: { userId: interaction.user.id, characterId: "solace" },
        update: { constellationTokens: { increment: dupes } },
      })] : []),
      ...weaponRolls.map(r => prisma.weapon.create({ data: weaponCreateData(interaction.user.id, r.weapon) })),
    ]);
    auditSpend(interaction.user.id, { radiantKeys: spend.radiantKeysToSpend, fractonite: spend.fractoniteToSpend }, `wish:solace:${hits}hits:${dupes}dupes:${weaponRolls.length}weapons`);

    if (hits > 0) {
      await runSuspenseWithReveal(interaction, SUSPENSE_CHARACTER_5STAR, SOLACE_REVEAL_GIF);
    } else {
      await runSuspense(interaction, 3);
    }

    const hasArt = fs.existsSync(SOLACE_ART_PATH);
    const files = hits > 0 && hasArt ? [new AttachmentBuilder(SOLACE_ART_PATH, { name: "solace.png" })] : [];

    const lines: string[] = rolls.map(r =>
      r.tier === "5star"
        ? `✦  **Solace**${r.isDuplicate ? "  *(duplicate — converted to a Constellation Token)*" : ""}`
        : r.tier === "4star"
        ? `◆  **${r.weapon.name}**  ★★★★  ·  ${r.weapon.type}`
        : `◇  *${r.mat.label}*`
    );

    const embed = new EmbedBuilder()
      .setColor(hits > 0 ? 0xFCD34D : 0x4A4A5A)
      .setTitle(hits > 0 ? "✨  The Rising Overture" : "◇  The fracture stirs")
      .setDescription(lines.join("\n") + (hits > 0 ? `\n\n*${dupes} of ${hits} were duplicates → ${dupes} Constellation Token(s).*` : ""))
      .addFields({ name: "Pity", value: `${pity} / ${HARD_PITY}`, inline: true })
      .setFooter({ text: "CARTETHYIA  ·  The Rising Overture" });
    if (files.length) embed.setImage("attachment://solace.png");

    const remainingKeys = fresh.radiantKeys - spend.radiantKeysToSpend;
    const remainingFractonite = fresh.fractonite - spend.fractoniteToSpend;
    await interaction.editReply({ embeds: [embed], files, components: [buildSolacePullRow(remainingKeys, remainingFractonite)] });
  });

  collector.on("end", () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ── Weapon banner — "The Tempered Vow", featuring Wellspring (Milestone 4c) ───
type WeaponBannerDbUser = {
  element: string; radiantKeys: number; fractonite: number; limitedWeaponBannerPity: number;
  limitedWeaponBanner4Pity: number; limitedWeaponBannerGuaranteed: boolean;
};

const WELLSPRING_REVEAL_GIF = path.join(process.cwd(), "assets", "weapons", "Rectifier", "Wellspring_reveal.gif");

// Same tier shape as Standard (3★ materials / 4★ WISH_WEAPONS_4STAR / 5★),
// but the 5★ resolution differs: win the 50/50 -> Wellspring, lose -> a
// random pick from WISH_WEAPONS_5STAR (Standard's 4) as the consolation —
// this is the ONLY place outside her own banner Wellspring can ever drop from,
// and the ONLY place outside Standard the Standard 4 can drop from here.
function rollWellspring5Star(guaranteed: boolean): { weapon: WishWeapon; wonWellspring: boolean } {
  if (guaranteed) return { weapon: WELLSPRING_WEAPON, wonWellspring: true };
  if (Math.random() < 0.5) return { weapon: WELLSPRING_WEAPON, wonWellspring: true };
  return { weapon: WISH_WEAPONS_5STAR[Math.floor(Math.random() * WISH_WEAPONS_5STAR.length)], wonWellspring: false };
}

function doSingleWellspringPull(pity: number, pity4: number, guaranteed: boolean): PullResult {
  let newPity  = pity + 1;
  let new4Pity = pity4 + 1;
  const rate5  = softPityRate(newPity);
  const r      = Math.random();

  if (newPity >= HARD_PITY || r < rate5) {
    const { weapon, wonWellspring } = rollWellspring5Star(guaranteed);
    // Lost the 50/50 if not guaranteed and didn't land Wellspring.
    const newGuaranteed = !guaranteed && !wonWellspring;
    return { tier: 5, weapon, newPity: 0, new4Pity: 0, newGuaranteed };
  }
  if (new4Pity >= HARD_PITY_4 || r < BASE_5_RATE + BASE_4_RATE) {
    return { tier: 4, weapon: roll4Star(), newPity, new4Pity: 0, newGuaranteed: guaranteed };
  }
  return { tier: 3, mat: rollMaterials(), newPity, new4Pity, newGuaranteed: guaranteed };
}

function weaponBannerEmbed(pity: number, pity4: number, guaranteed: boolean, keys: number, fractonite: number, color: number, bannerEndsAt?: Date | null): EmbedBuilder {
  const fields = [
    { name: "Your Pity",    value: `**${pity}** / ${HARD_PITY}`,  inline: true },
    { name: "4★ Pity",     value: `**${pity4}** / ${HARD_PITY_4}`, inline: true },
    { name: "Radiant Keys", value: `${CE.rk ?? "🔑"} **${keys}**`,   inline: true },
    { name: "Fractonite",   value: `${CE.ft ?? "🔷"} **${fractonite}**`, inline: true },
  ];
  if (bannerEndsAt) {
    fields.push({ name: "Banner Ends", value: `<t:${Math.floor(bannerEndsAt.getTime() / 1000)}:R> (<t:${Math.floor(bannerEndsAt.getTime() / 1000)}:f>)`, inline: false });
  }
  return new EmbedBuilder()
    .setColor(0xEC4899)
    .setAuthor({ name: "⚔  The Tempered Vow  ·  Weapon Banner" })
    .setDescription(
      `**Featuring: Wellspring**  ·  Rectifier  ·  ★★★★★\n` +
      `\`BASE ATK\` **${calcWishAtk(WELLSPRING_WEAPON, 1)}**  ·  \`${WELLSPRING_WEAPON.subStatType.replace(/_/g, " ")}\` **+${calcWishSubStat(WELLSPRING_WEAPON.subStatBase, WELLSPRING_WEAPON.subStatScale, 1)}%**\n` +
      `*${WELLSPRING_WEAPON.passive}*\n\n` +
      `5★ 50/50: win = **Wellspring** · lose = random Standard 5★ · next 5★ guaranteed Wellspring.\n\n` +
      (guaranteed ? "✦ **Next 5★ is guaranteed Wellspring**\n\n" : "") +
      `-# Short on Radiant Keys? Pulling automatically converts Fractonite to cover the gap (${FRACTONITE_PER_RADIANT_KEY} Fractonite = 1 Key).`
    )
    .addFields(fields)
    .setFooter({ text: "CARTETHYIA  ·  The Tempered Vow" });
}

async function runWeaponBanner(interaction: ChatInputCommandInteraction, dbUser: WeaponBannerDbUser) {
  const color = ELEMENT_HEX[dbUser.element] ?? ELEMENT_HEX.NONE;

  const pullRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("wellspring_x1").setLabel("◈  Pull  ×1  (1)").setStyle(ButtonStyle.Primary)
      .setDisabled(!resolveKeySpend(dbUser.radiantKeys, dbUser.fractonite, 1).ok),
    new ButtonBuilder().setCustomId("wellspring_x10").setLabel("✦  Pull  ×10  (10)").setStyle(ButtonStyle.Danger)
      .setDisabled(!resolveKeySpend(dbUser.radiantKeys, dbUser.fractonite, 10).ok),
  );

  const bannerWindow = await prisma.bannerWindow.findUnique({ where: { id: "banner1" } });
  const wellspringOverviewArt = getWeaponImagePath(WELLSPRING_WEAPON.type, WELLSPRING_WEAPON.name);
  const overviewEmbed = weaponBannerEmbed(dbUser.limitedWeaponBannerPity, dbUser.limitedWeaponBanner4Pity, dbUser.limitedWeaponBannerGuaranteed, dbUser.radiantKeys, dbUser.fractonite, color, bannerWindow?.endsAt);
  if (wellspringOverviewArt) overviewEmbed.setImage("attachment://wellspring_banner.png");
  const msg = await interaction.editReply({
    embeds: [overviewEmbed],
    files: wellspringOverviewArt ? [new AttachmentBuilder(wellspringOverviewArt, { name: "wellspring_banner.png" })] : [],
    components: [pullRow],
  });

  const collector = msg.createMessageComponentCollector({
    filter: b => b.user.id === interaction.user.id, time: 300_000, // 5 min — continuous pulling stays on this message
  });

  const buildWellspringPullRow = (radiantKeys: number, fractonite: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("wellspring_x1").setLabel("◈  Pull  ×1  (1)").setStyle(ButtonStyle.Primary)
      .setDisabled(!resolveKeySpend(radiantKeys, fractonite, 1).ok),
    new ButtonBuilder().setCustomId("wellspring_x10").setLabel("✦  Pull  ×10  (10)").setStyle(ButtonStyle.Danger)
      .setDisabled(!resolveKeySpend(radiantKeys, fractonite, 10).ok),
  );

  collector.on("collect", async (btn: ButtonInteraction) => {
    if (btn.customId !== "wellspring_x1" && btn.customId !== "wellspring_x10") return;
    await btn.deferUpdate();

    const fresh = await prisma.user.findUnique({
      where: { id: interaction.user.id },
      select: { radiantKeys: true, fractonite: true, limitedWeaponBannerPity: true, limitedWeaponBanner4Pity: true, limitedWeaponBannerGuaranteed: true },
    });
    if (!fresh) return;

    const amount = btn.customId === "wellspring_x10" ? 10 : 1;
    const spend = resolveKeySpend(fresh.radiantKeys, fresh.fractonite, amount);
    if (!spend.ok) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D).setTitle("◈ Not enough Radiant Keys")
          .setDescription(spend.shortMessage)],
        components: [],
      });
      return;
    }

    let pity = fresh.limitedWeaponBannerPity, p4 = fresh.limitedWeaponBanner4Pity, guar = fresh.limitedWeaponBannerGuaranteed;
    const results: PullResult[] = [];
    for (let i = 0; i < amount; i++) {
      const r = doSingleWellspringPull(pity, p4, guar);
      results.push(r); pity = r.newPity; p4 = r.new4Pity; guar = r.newGuaranteed;
    }
    // Same safety net as Standard's ×10 pull: never let a full 10-pull whiff
    // down to pure materials with nothing at 4★ or better.
    if (amount === 10 && !results.some(r => r.tier >= 4)) {
      results[9] = { tier: 4, weapon: roll4Star(), newPity: pity, new4Pity: 0, newGuaranteed: guar };
      p4 = 0;
    }

    const matTotals = { forgingOres: 0, tuningModules: 0, credits: 0 };
    for (const r of results) if (r.tier === 3) {
      matTotals.forgingOres += r.mat.forgingOres; matTotals.tuningModules += r.mat.tuningModules; matTotals.credits += r.mat.credits;
    }
    const weaponResults = results.filter((r): r is Extract<PullResult, { tier: 4 | 5 }> => r.tier >= 4);

    await prisma.$transaction([
      prisma.user.update({ where: { id: interaction.user.id },
        data: { radiantKeys: { decrement: spend.radiantKeysToSpend }, fractonite: { decrement: spend.fractoniteToSpend },
                limitedWeaponBannerPity: pity, limitedWeaponBanner4Pity: p4, limitedWeaponBannerGuaranteed: guar,
                forgingOres: { increment: matTotals.forgingOres }, tuningModules: { increment: matTotals.tuningModules }, credits: { increment: matTotals.credits } } }),
      ...weaponResults.map(r => prisma.weapon.create({ data: weaponCreateData(interaction.user.id, r.weapon!) })),
    ]);
    auditSpend(interaction.user.id, { radiantKeys: spend.radiantKeysToSpend, fractonite: spend.fractoniteToSpend }, `wish:wellspring:${amount}pull:${weaponResults.length}weapons`);

    const has5 = results.some(r => r.tier === 5), has4 = results.some(r => r.tier === 4);
    const wonWellspring = results.some(r => r.tier === 5 && r.weapon === WELLSPRING_WEAPON);
    if (wonWellspring) {
      await runSuspenseWithReveal(interaction, SUSPENSE_5STAR, WELLSPRING_REVEAL_GIF);
    } else {
      await runSuspense(interaction, has5 ? 5 : has4 ? 4 : 3);
    }

    const lines = results.map(r =>
      r.tier === 3
        ? `◇  *${r.mat.label}*`
        : `${RARITY_LABEL[r.tier]}  **${r.weapon!.name}**  ${"★".repeat(r.tier)}  ·  ${r.weapon!.type}`
    );

    const star5s = results.filter(r => r.tier === 5) as Extract<PullResult, { tier: 5 }>[];
    const star4s = results.filter(r => r.tier === 4) as Extract<PullResult, { tier: 4 }>[];
    const highlight = star5s[0] ?? star4s[0];
    const hlImg = highlight ? getWeaponImagePath(highlight.weapon.type, highlight.weapon.name) : null;
    const files = hlImg ? [new AttachmentBuilder(hlImg, { name: "weapon.png" })] : [];

    const embed = new EmbedBuilder()
      .setColor(star5s.length ? RARITY_COLOR[5] : star4s.length ? RARITY_COLOR[4] : 0x4A4A5A)
      .setTitle("⚔  The Tempered Vow").setDescription(lines.join("\n"))
      .addFields(
        { name: "✦ 5★", value: `${star5s.length}`, inline: true },
        { name: "◆ 4★", value: `${star4s.length}`, inline: true },
        { name: "Pity",  value: `${pity} / ${HARD_PITY}`, inline: true },
      )
      .setFooter({ text: "CARTETHYIA  ·  The Tempered Vow  ·  Added to your arsenal  ·  /equip to equip" });
    if (hlImg) embed.setImage("attachment://weapon.png");

    const remainingKeys = fresh.radiantKeys - spend.radiantKeysToSpend;
    const remainingFractonite = fresh.fractonite - spend.fractoniteToSpend;
    await interaction.editReply({ embeds: [embed], files, components: [buildWellspringPullRow(remainingKeys, remainingFractonite)] });
  });

  collector.on("end", () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ── Banner picker (Milestone 4b) ───────────────────────────────────────────────
const command: Command = {
  data: new SlashCommandBuilder()
    .setName("wish")
    .setDescription("Pull from the Fracture Resonance weapon banner.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const dbUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: {
        element: true, fractureKeys: true, wishPity: true, wish4Pity: true, wishGuaranteed: true, wishTarget: true,
        radiantKeys: true, fractonite: true, limitedCharBannerPity: true, limitedCharBanner4Pity: true, limitedCharBannerGuaranteed: true,
        limitedWeaponBannerPity: true, limitedWeaponBanner4Pity: true, limitedWeaponBannerGuaranteed: true,
      },
    });
    if (!dbUser) { await replyNotStarted(interaction); return; }

    const window = await prisma.bannerWindow.findUnique({ where: { id: "banner1" } });
    const now = Date.now();
    const windowActive = !!window && now >= window.startsAt.getTime() && now <= window.endsAt.getTime();

    const color = ELEMENT_HEX[dbUser.element] ?? ELEMENT_HEX.NONE;
    const pickerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("wish_pick_standard").setLabel("◈ Standard").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("wish_pick_character")
        .setLabel(windowActive ? "✦ Limited Character Banner — The Rising Overture" : "✦ Limited Character Banner — Banner ended")
        .setStyle(ButtonStyle.Success).setDisabled(!windowActive),
      new ButtonBuilder().setCustomId("wish_pick_weapon")
        .setLabel(windowActive ? "⚔ Limited Weapon Banner — The Tempered Vow" : "⚔ Limited Weapon Banner — Banner ended")
        .setStyle(ButtonStyle.Danger).setDisabled(!windowActive),
    );

    const pickerHasArt = windowActive && fs.existsSync(SOLACE_ART_PATH);
    const pickerEmbed = new EmbedBuilder()
      .setColor(windowActive ? 0xFCD34D : color)
      .setTitle("◈  Choose a Banner")
      .setDescription(
        "**Standard** — the evergreen weapon pool, spends Fracture Keys.\n\n" +
        "**Limited Character Banner** *(The Rising Overture)* — featuring Solace, spends Radiant Keys.\n\n" +
        "**Limited Weapon Banner** *(The Tempered Vow)* — featuring Wellspring, spends Radiant Keys." +
        (windowActive && window ? `\n\n✦ **Banner ends** <t:${Math.floor(window.endsAt.getTime() / 1000)}:R> (<t:${Math.floor(window.endsAt.getTime() / 1000)}:f>)` : "")
      )
      .setFooter({ text: "CARTETHYIA  ·  Wish" });
    if (pickerHasArt) pickerEmbed.setImage("attachment://solace_picker.png");

    const pickerMsg = await interaction.editReply({
      embeds: [pickerEmbed],
      files: pickerHasArt ? [new AttachmentBuilder(SOLACE_ART_PATH, { name: "solace_picker.png" })] : [],
      components: [pickerRow],
    });

    const pickCollector = pickerMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: b => b.user.id === interaction.user.id,
      time: 60_000, max: 1,
    });

    pickCollector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();
      if (btn.customId === "wish_pick_standard") {
        await runStandardBanner(interaction, dbUser);
      } else if (btn.customId === "wish_pick_character") {
        await runCharacterBanner(interaction, dbUser);
      } else if (btn.customId === "wish_pick_weapon") {
        await runWeaponBanner(interaction, dbUser);
      }
    });

    pickCollector.on("end", (col) => {
      if (col.size === 0) interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
