import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import {
  WISH_WEAPONS_4STAR, WISH_WEAPONS_5STAR,
  WishWeapon, calcWishAtk, calcWishSubStat,
} from "../../lib/wishWeapons";
import { getWeaponImagePath } from "../../lib/weapons";

// ── 3★ material rewards ───────────────────────────────────────────────────────
interface MaterialDrop { forgingOres: number; tuningModules: number; credits: number; label: string; }
const MATERIAL_DROPS: MaterialDrop[] = [
  { forgingOres: 4, tuningModules: 0, credits: 400,  label: "4× Forging Ores + 400 Credits"         },
  { forgingOres: 3, tuningModules: 1, credits: 200,  label: "3× Forging Ores + 1× Tuning Module"    },
  { forgingOres: 2, tuningModules: 2, credits: 0,    label: "2× Forging Ores + 2× Tuning Modules"   },
  { forgingOres: 5, tuningModules: 0, credits: 0,    label: "5× Forging Ores"                        },
  { forgingOres: 3, tuningModules: 0, credits: 600,  label: "3× Forging Ores + 600 Credits"         },
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

// Rotate this to change the featured banner weapon
const FEATURED_5STAR = WISH_WEAPONS_5STAR[0]; // Oathbreaker's Edge

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};
const RARITY_COLOR: Record<number, number> = {
  3: 0x818CF8, 4: 0xF59E0B, 5: 0xF43F5E,
};
const RARITY_LABEL: Record<number, string> = {
  3: "◇", 4: "◆", 5: "✦",
};

// ── Gacha logic ───────────────────────────────────────────────────────────────
function softPityRate(pity: number): number {
  if (pity < SOFT_PITY) return BASE_5_RATE;
  return Math.min(1, BASE_5_RATE + (pity - SOFT_PITY + 1) * 0.065);
}

function roll5Star(guaranteed: boolean): WishWeapon {
  if (guaranteed) return FEATURED_5STAR;
  return Math.random() < 0.5
    ? FEATURED_5STAR
    : WISH_WEAPONS_5STAR[Math.floor(Math.random() * WISH_WEAPONS_5STAR.length)];
}

function roll4Star(): WishWeapon {
  return WISH_WEAPONS_4STAR[Math.floor(Math.random() * WISH_WEAPONS_4STAR.length)];
}

type PullResult =
  | { tier: 5; weapon: WishWeapon; newPity: number; new4Pity: number; newGuaranteed: boolean }
  | { tier: 4; weapon: WishWeapon; newPity: number; new4Pity: number; newGuaranteed: boolean }
  | { tier: 3; mat: MaterialDrop;  newPity: number; new4Pity: number; newGuaranteed: boolean };

function doSinglePull(wishPity: number, wish4Pity: number, wishGuaranteed: boolean): PullResult {
  let newPity       = wishPity + 1;
  let new4Pity      = wish4Pity + 1;
  let newGuaranteed = wishGuaranteed;

  const rate5 = softPityRate(newPity);
  const r     = Math.random();

  if (newPity >= HARD_PITY || r < rate5) {
    const weapon  = roll5Star(newGuaranteed);
    newGuaranteed = weapon.id !== FEATURED_5STAR.id;
    return { tier: 5, weapon, newPity: 0, new4Pity: 0, newGuaranteed };
  }
  if (new4Pity >= HARD_PITY_4 || r < BASE_5_RATE + BASE_4_RATE) {
    return { tier: 4, weapon: roll4Star(), newPity, new4Pity: 0, newGuaranteed };
  }
  return { tier: 3, mat: rollMaterials(), newPity, new4Pity, newGuaranteed };
}

// ── Banner info embed (shown before pulling) ──────────────────────────────────
function bannerEmbed(
  pity: number, wish4Pity: number, guaranteed: boolean,
  keys: number, color: number, featuredImg: string | null,
): EmbedBuilder {
  const w    = FEATURED_5STAR;
  const atk  = calcWishAtk(w, 1);
  const sub  = calcWishSubStat(w.subStatBase, w.subStatScale, 1);
  const sub1 = calcWishSubStat(w.hiddenSub1Base, w.hiddenSub1Scale, 1);
  const sub2 = w.hiddenSub2Base != null ? calcWishSubStat(w.hiddenSub2Base, w.hiddenSub2Scale!, 1) : null;
  const stars = "★★★★★";

  const statsBlock = [
    `\`BASE ATK\`  **${atk}**  →  **${calcWishAtk(w, 90)}** at Lv 90`,
    `\`${w.subStatType.replace(/_/g," ")}\`  **+${sub}%**  →  **+${calcWishSubStat(w.subStatBase, w.subStatScale, 90)}%** at Lv 90`,
    `\`${w.hiddenSub1Type.replace(/_/g," ")}\`  *(hidden — reveals at Lv 20)*`,
    sub2 != null ? `\`${w.hiddenSub2Type!.replace(/_/g," ")}\`  *(hidden — reveals at Lv 50)*` : "",
  ].filter(Boolean).join("\n");

  const e = new EmbedBuilder()
    .setColor(0xF43F5E)
    .setAuthor({ name: "◈  Fracture Resonance  ·  Limited Weapon Banner" })
    .setTitle(`✦  ${w.name}`)
    .setDescription([
      `${stars}  ·  ${w.type}`,
      ``,
      `**Stats at Lv 1 → 90:**`,
      statsBlock,
      ``,
      `**Passive**`,
      `> ${w.passive}`,
      ``,
      `*${w.lore}*`,
    ].join("\n"))
    .addFields(
      { name: "Your Pity",   value: `**${pity}** / ${HARD_PITY} pulls since last ✦`, inline: true },
      { name: "4★ Pity",    value: `**${wish4Pity}** / ${HARD_PITY_4}`, inline: true },
      { name: "Fracture Keys", value: `🗝️ **${keys}**`, inline: true },
      {
        name: "Banner info",
        value: [
          `5★ rate: **0.6%** · Soft pity at **${SOFT_PITY}** · Hard pity at **${HARD_PITY}**`,
          `4★ guaranteed every **10** pulls`,
          guaranteed ? `✦ **Your next 5★ is guaranteed featured** *(won 50/50 last time)*` : `5★: **50/50** featured or random`,
        ].join("\n"),
      },
    )
    .setFooter({ text: "CARTETHYIA  ·  Wish  ·  All 4★ weapons also in pool" });

  if (featuredImg) e.setImage("attachment://featured.png");
  return e;
}

// ── Suspense frames ───────────────────────────────────────────────────────────
import path from "path";

const ANIM_5STAR = path.join(process.cwd(), "assets", "5_star animation.gif");
const ANIM_4STAR = path.join(process.cwd(), "assets", "4_star animation.gif");
const ANIM_3STAR = path.join(process.cwd(), "assets", "3_star animation.gif");

const SUSPENSE_5STAR = [
  { title: "◈  Reaching into the fracture...",   desc: "*The resonance responds...*",                        color: 0x1E1F2E },
  { title: "✦  Something stirs in the void...",  desc: "*A weapon takes shape from the darkness...*",        color: 0x2D1B4E },
  { title: "⚡  The fracture tears open...",      desc: "*Energy crackles — a name is about to surface...*", color: 0x4A0E6B },
];
const SUSPENSE_4STAR = [
  { title: "◈  Reaching into the fracture...",   desc: "*The resonance stirs...*",                           color: 0x1E1F2E },
  { title: "◆  A resonance takes form...",        desc: "*Something worthy emerges from the glow...*",       color: 0x2D1B69 },
];
const SUSPENSE_3STAR = [
  { title: "◈  Reaching into the fracture...",   desc: "*The fracture gives something back...*",             color: 0x1A1A1A },
];

async function runSuspense(
  interaction: ChatInputCommandInteraction,
  tier: 3 | 4 | 5,
): Promise<void> {
  const frames  = tier === 5 ? SUSPENSE_5STAR : tier === 4 ? SUSPENSE_4STAR : SUSPENSE_3STAR;
  const gifPath = tier === 5 ? ANIM_5STAR     : tier === 4 ? ANIM_4STAR     : ANIM_3STAR;
  const delay   = tier === 5 ? 1400           : tier === 4 ? 1000           : 800;

  for (let i = 0; i < frames.length; i++) {
    const isLast = i === frames.length - 1;
    const files  = isLast ? [new AttachmentBuilder(gifPath, { name: "anim.gif" })] : [];
    const embed  = new EmbedBuilder()
      .setColor(frames[i].color)
      .setTitle(frames[i].title)
      .setDescription(frames[i].desc)
      .setFooter({ text: "CARTETHYIA  ·  Wish" });
    if (isLast) embed.setImage("attachment://anim.gif");

    await interaction.editReply({ embeds: [embed], files, components: [] });
    await new Promise(r => setTimeout(r, delay));
  }
}

// ── Result embed ──────────────────────────────────────────────────────────────
function resultEmbed(
  w: WishWeapon, newPity: number, color: number,
  guaranteed: boolean, lostCoin: boolean,
): EmbedBuilder {
  const atk  = calcWishAtk(w, 1);
  const sub  = calcWishSubStat(w.subStatBase, w.subStatScale, 1);
  const stars = "★".repeat(w.rarity as number) + "☆".repeat(Math.max(0, 5 - (w.rarity as number)));

  const footerParts = [
    "Added to your arsenal  ·  /equip to equip",
    w.rarity === 5 && guaranteed   ? "◈ Guaranteed pull" : "",
    w.rarity === 5 && lostCoin     ? "◈ Lost 50/50 — next 5★ guaranteed featured" : "",
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
    .setFooter({ text: footerParts });
}

// ── Save weapon to DB ─────────────────────────────────────────────────────────
function weaponCreateData(userId: string, w: WishWeapon) {
  return {
    userId,
    weaponType:     w.type,
    name:           w.name,
    rarity:         w.rarity as number,
    baseAtk:        w.baseAtk,
    subStatType:    w.subStatType,
    subStatVal:     w.subStatBase,
    hiddenSub1Type: w.hiddenSub1Type,
    hiddenSub1Val:  w.hiddenSub1Base,
    hiddenSub2Type: w.hiddenSub2Type ?? null,
    hiddenSub2Val:  w.hiddenSub2Base ?? null,
    isEquipped:     false,
  };
}

// ── Command ───────────────────────────────────────────────────────────────────
const command: Command = {
  data: new SlashCommandBuilder()
    .setName("wish")
    .setDescription("Pull from the Fracture Resonance weapon banner.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const dbUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { element: true, fractureKeys: true, wishPity: true, wish4Pity: true, wishGuaranteed: true },
    });
    if (!dbUser) { await replyNotStarted(interaction); return; }

    const color      = ELEMENT_HEX[dbUser.element] ?? ELEMENT_HEX.NONE;
    const featuredImg = getWeaponImagePath(FEATURED_5STAR.type, FEATURED_5STAR.name);
    const featFile    = featuredImg ? [new AttachmentBuilder(featuredImg, { name: "featured.png" })] : [];

    // ── Banner screen with Pull ×1 / ×10 buttons ─────────────────────────────
    const bannerRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("wish_x1")
        .setLabel("◈  Pull  ×1  (1 🗝️)")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(dbUser.fractureKeys < 1),
      new ButtonBuilder()
        .setCustomId("wish_x10")
        .setLabel("✦  Pull  ×10  (10 🗝️)")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(dbUser.fractureKeys < 10),
    );

    const msg = await interaction.editReply({
      embeds:     [bannerEmbed(dbUser.wishPity, dbUser.wish4Pity, dbUser.wishGuaranteed, dbUser.fractureKeys, color, featuredImg)],
      files:      featFile,
      components: [bannerRow],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: b => b.user.id === interaction.user.id && (b.customId === "wish_x1" || b.customId === "wish_x10"),
      time:   90_000,
      max:    1,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      const fresh = await prisma.user.findUnique({
        where:  { id: interaction.user.id },
        select: { fractureKeys: true, wishPity: true, wish4Pity: true, wishGuaranteed: true },
      });
      if (!fresh) return;

      const amount = btn.customId === "wish_x10" ? 10 : 1;

      if (fresh.fractureKeys < amount) {
        await btn.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setTitle("◈ Not enough Fracture Keys")
            .setDescription(`You only have **${fresh.fractureKeys}** 🗝️ — need **${amount}**.`)
            .setFooter({ text: "CARTETHYIA  ·  Wish" })],
          files: [], components: [],
        });
        return;
      }

      // ── Single pull ─────────────────────────────────────────────────────────
      if (amount === 1) {
        const res = doSinglePull(fresh.wishPity, fresh.wish4Pity, fresh.wishGuaranteed);
        const { newPity, new4Pity, newGuaranteed } = res;

        // Save first
        if (res.tier === 3) {
          await prisma.user.update({
            where: { id: interaction.user.id },
            data:  {
              fractureKeys:  { decrement: 1 },
              wishPity:      newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed,
              forgingOres:   { increment: res.mat.forgingOres },
              tuningModules: { increment: res.mat.tuningModules },
              credits:       { increment: res.mat.credits },
            },
          });
        } else {
          await prisma.$transaction([
            prisma.user.update({
              where: { id: interaction.user.id },
              data:  { fractureKeys: { decrement: 1 }, wishPity: newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed },
            }),
            prisma.weapon.create({ data: weaponCreateData(interaction.user.id, res.weapon) }),
          ]);
        }

        await runSuspense(interaction, res.tier);

        if (res.tier === 3) {
          await interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(0x4A4A5A)
              .setTitle("◇  The fracture yields materials")
              .setDescription([
                `**${res.mat.label}**`,
                ``,
                `*The resonance wasn't strong enough this time.*`,
              ].join("\n"))
              .addFields({ name: "Pity", value: `${newPity} / ${HARD_PITY}`, inline: true })
              .setFooter({ text: "CARTETHYIA  ·  Wish  ·  Keep pulling — pity carries over" })],
            files: [], components: [],
          });
        } else {
          const lostCoin = res.weapon.rarity === 5 && res.weapon.id !== FEATURED_5STAR.id && !fresh.wishGuaranteed;
          const imgPath  = getWeaponImagePath(res.weapon.type, res.weapon.name);
          const files    = imgPath ? [new AttachmentBuilder(imgPath, { name: "weapon.png" })] : [];
          const embed    = resultEmbed(res.weapon, newPity, color, fresh.wishGuaranteed, lostCoin);
          if (imgPath) embed.setImage("attachment://weapon.png");
          await interaction.editReply({ embeds: [embed], files, components: [] });
        }
        return;
      }

      // ── ×10 pull ────────────────────────────────────────────────────────────
      let pity = fresh.wishPity, p4 = fresh.wish4Pity, guar = fresh.wishGuaranteed;
      const results: PullResult[] = [];
      for (let i = 0; i < 10; i++) {
        const r = doSinglePull(pity, p4, guar);
        results.push(r);
        pity = r.newPity; p4 = r.new4Pity; guar = r.newGuaranteed;
      }

      // Guarantee at least one 4★ — replace last 3★ if needed
      if (!results.some(r => r.tier >= 4)) {
        results[9] = { tier: 4, weapon: roll4Star(), newPity: pity, new4Pity: 0, newGuaranteed: guar };
        p4 = 0;
      }

      // Tally materials from 3★ pulls
      const matTotals = { forgingOres: 0, tuningModules: 0, credits: 0 };
      for (const r of results) {
        if (r.tier === 3) {
          matTotals.forgingOres   += r.mat.forgingOres;
          matTotals.tuningModules += r.mat.tuningModules;
          matTotals.credits       += r.mat.credits;
        }
      }
      const weaponResults = results.filter((r): r is Extract<PullResult, { tier: 4 | 5 }> => r.tier >= 4);
      const star3count    = results.filter(r => r.tier === 3).length;

      await prisma.$transaction([
        prisma.user.update({
          where: { id: interaction.user.id },
          data:  {
            fractureKeys:  { decrement: 10 },
            wishPity:      pity, wish4Pity: p4, wishGuaranteed: guar,
            forgingOres:   { increment: matTotals.forgingOres },
            tuningModules: { increment: matTotals.tuningModules },
            credits:       { increment: matTotals.credits },
          },
        }),
        ...weaponResults.map(r => prisma.weapon.create({ data: weaponCreateData(interaction.user.id, r.weapon) })),
      ]);

      const has5 = results.some(r => r.tier === 5);
      const has4 = results.some(r => r.tier === 4);
      await runSuspense(interaction, has5 ? 5 : has4 ? 4 : 3);

      const star5s    = results.filter(r => r.tier === 5) as Extract<PullResult, { tier: 5 }>[];
      const star4s    = results.filter(r => r.tier === 4) as Extract<PullResult, { tier: 4 }>[];
      const highlight = star5s[0] ?? star4s[0];

      const lines = results.map(r => {
        if (r.tier === 3) return `◇  *${r.mat.label}*`;
        const stars = "★".repeat(r.tier);
        return `${RARITY_LABEL[r.tier]}  **${r.weapon.name}**  ${stars}  ·  ${r.weapon.type}`;
      });

      const summaryEmbed = new EmbedBuilder()
        .setColor(star5s.length ? RARITY_COLOR[5] : star4s.length ? RARITY_COLOR[4] : 0x4A4A5A)
        .setTitle(`✦  ×10 Fracture Resonance`)
        .setDescription(lines.join("\n"))
        .addFields(
          { name: "✦ 5★",  value: `${star5s.length}`,        inline: true },
          { name: "◆ 4★",  value: `${star4s.length}`,        inline: true },
          { name: "Pity",  value: `${pity} / ${HARD_PITY}`,  inline: true },
          ...(star3count > 0 ? [{ name: "◇ Materials", value: `${star3count} pulls → ${matTotals.forgingOres} Forging Ores + ${matTotals.tuningModules} Tuning Modules + ${matTotals.credits} Credits`, inline: false }] : []),
        )
        .setFooter({ text: "CARTETHYIA  ·  Wish  ·  Weapons added to arsenal  ·  /equip to swap" });

      const hlImg = highlight ? getWeaponImagePath(highlight.weapon.type, highlight.weapon.name) : null;
      const files = hlImg ? [new AttachmentBuilder(hlImg, { name: "weapon.png" })] : [];
      if (hlImg) summaryEmbed.setThumbnail("attachment://weapon.png");

      await interaction.editReply({ embeds: [summaryEmbed], files, components: [] });
    });

    collector.on("end", (col) => {
      if (col.size === 0) interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
