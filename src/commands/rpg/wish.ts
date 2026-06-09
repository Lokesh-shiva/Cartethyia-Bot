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

function doSinglePull(wishPity: number, wish4Pity: number, wishGuaranteed: boolean) {
  let weapon: WishWeapon;
  let newPity      = wishPity + 1;
  let new4Pity     = wish4Pity + 1;
  let newGuaranteed = wishGuaranteed;

  const rate5 = softPityRate(newPity);
  const r     = Math.random();

  if (newPity >= HARD_PITY || r < rate5) {
    weapon        = roll5Star(newGuaranteed);
    newGuaranteed = weapon.id !== FEATURED_5STAR.id;
    newPity = 0; new4Pity = 0;
  } else if (new4Pity >= HARD_PITY_4 || r < BASE_5_RATE + BASE_4_RATE) {
    weapon    = roll4Star();
    new4Pity  = 0;
  } else {
    weapon = { ...roll4Star(), rarity: 3 as any };
  }

  return { weapon, newPity, new4Pity, newGuaranteed };
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
const SUSPENSE_FRAMES = [
  { title: "◈  Reaching into the fracture...",      desc: "*The resonance responds...*",                           color: 0x1E1F2E },
  { title: "✦  Something stirs in the void...",     desc: "*A weapon takes shape from the darkness...*",           color: 0x2D1B4E },
  { title: "⚡  The fracture tears open...",         desc: "*Energy crackles — a name is about to surface...*",    color: 0x4A0E6B },
];

async function runSuspense(
  interaction: ChatInputCommandInteraction,
  is5Star: boolean,
): Promise<void> {
  const frames = is5Star ? SUSPENSE_FRAMES : SUSPENSE_FRAMES.slice(0, 2);
  for (const frame of frames) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(frame.color)
        .setTitle(frame.title)
        .setDescription(frame.desc)
        .setFooter({ text: "CARTETHYIA  ·  Wish" })],
      files: [],
      components: [],
    });
    await new Promise(r => setTimeout(r, is5Star ? 1400 : 900));
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
        const res        = doSinglePull(fresh.wishPity, fresh.wish4Pity, fresh.wishGuaranteed);
        const { weapon, newPity, new4Pity, newGuaranteed } = res;
        const lostCoin   = weapon.rarity === 5 && weapon.id !== FEATURED_5STAR.id && !fresh.wishGuaranteed;

        // Save first so DB is consistent
        await prisma.$transaction([
          prisma.user.update({
            where: { id: interaction.user.id },
            data:  { fractureKeys: { decrement: 1 }, wishPity: newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed },
          }),
          prisma.weapon.create({ data: weaponCreateData(interaction.user.id, weapon) }),
        ]);

        // Suspense animation
        await runSuspense(interaction, weapon.rarity === 5);

        // Reveal
        const imgPath = getWeaponImagePath(weapon.type, weapon.name);
        const files   = imgPath ? [new AttachmentBuilder(imgPath, { name: "weapon.png" })] : [];
        const embed   = resultEmbed(weapon, newPity, color, fresh.wishGuaranteed, lostCoin);
        if (imgPath) embed.setImage("attachment://weapon.png");

        await interaction.editReply({ embeds: [embed], files, components: [] });
        return;
      }

      // ── ×10 pull ────────────────────────────────────────────────────────────
      let pity = fresh.wishPity, p4 = fresh.wish4Pity, guar = fresh.wishGuaranteed;
      const results: ReturnType<typeof doSinglePull>[] = [];
      for (let i = 0; i < 10; i++) {
        const r = doSinglePull(pity, p4, guar);
        results.push(r);
        pity = r.newPity; p4 = r.new4Pity; guar = r.newGuaranteed;
      }

      // Guarantee at least one 4★
      if (!results.some(r => (r.weapon.rarity as number) >= 4)) {
        results[9] = { ...results[9], weapon: { ...roll4Star(), rarity: 4 as any } };
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: interaction.user.id },
          data:  { fractureKeys: { decrement: 10 }, wishPity: pity, wish4Pity: p4, wishGuaranteed: guar },
        }),
        ...results.map(r => prisma.weapon.create({ data: weaponCreateData(interaction.user.id, r.weapon) })),
      ]);

      // Suspense — longer if any 5★
      const has5 = results.some(r => r.weapon.rarity === 5);
      await runSuspense(interaction, has5);

      // ×10 summary reveal
      const star5s    = results.filter(r => r.weapon.rarity === 5);
      const star4s    = results.filter(r => (r.weapon.rarity as number) === 4);
      const highlight = star5s[0] ?? star4s[0] ?? results[results.length - 1];

      const lines = results.map(r => {
        const stars = "★".repeat(r.weapon.rarity as number);
        return `${RARITY_LABEL[r.weapon.rarity as number] ?? "◇"}  **${r.weapon.name}**  ${stars}  ·  ${r.weapon.type}`;
      });

      const summaryEmbed = new EmbedBuilder()
        .setColor(star5s.length ? RARITY_COLOR[5] : star4s.length ? RARITY_COLOR[4] : color)
        .setTitle(`✦  ×10 Fracture Resonance`)
        .setDescription(lines.join("\n"))
        .addFields(
          { name: "✦ 5★",     value: `${star5s.length}`,        inline: true },
          { name: "◆ 4★",     value: `${star4s.length}`,        inline: true },
          { name: "Pity",     value: `${pity} / ${HARD_PITY}`, inline: true },
        )
        .setFooter({ text: "CARTETHYIA  ·  Wish  ·  All weapons added to your arsenal  ·  /equip to swap" });

      const hlImg = getWeaponImagePath(highlight.weapon.type, highlight.weapon.name);
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
