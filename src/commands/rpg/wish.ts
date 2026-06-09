import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import {
  WISH_WEAPONS_4STAR, WISH_WEAPONS_5STAR, ALL_WISH_WEAPONS,
  WishWeapon, calcWishAtk, calcWishSubStat,
} from "../../lib/wishWeapons";
import { getWeaponImagePath } from "../../lib/weapons";

// ── Rates ──────────────────────────────────────────────────────────────────────
const BASE_5_RATE  = 0.006;   // 0.6%
const BASE_4_RATE  = 0.051;   // 5.1%
const SOFT_PITY    = 65;      // 5★ rate starts ramping here
const HARD_PITY    = 80;      // guaranteed 5★
const HARD_PITY_4  = 10;      // guaranteed 4★ every 10 pulls

// Featured 5★ — rotate this to change the banner
const FEATURED_5STAR = WISH_WEAPONS_5STAR[0]; // Oathbreaker's Edge

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const RARITY_COLOR: Record<number, number> = {
  3: 0x818CF8, 4: 0xF59E0B, 5: 0xF43F5E,
};

function softPityRate(pity: number): number {
  if (pity < SOFT_PITY) return BASE_5_RATE;
  // Ramps from 0.6% to ~100% over 15 pulls
  return Math.min(1, BASE_5_RATE + (pity - SOFT_PITY + 1) * 0.065);
}

function roll5Star(guaranteed: boolean): WishWeapon {
  if (guaranteed) return FEATURED_5STAR;
  // 50/50 — heads = featured, tails = random other 5★
  return Math.random() < 0.5
    ? FEATURED_5STAR
    : WISH_WEAPONS_5STAR[Math.floor(Math.random() * WISH_WEAPONS_5STAR.length)];
}

function roll4Star(): WishWeapon {
  return WISH_WEAPONS_4STAR[Math.floor(Math.random() * WISH_WEAPONS_4STAR.length)];
}

function doSinglePull(wishPity: number, wish4Pity: number, wishGuaranteed: boolean): {
  weapon: WishWeapon;
  newPity: number;
  new4Pity: number;
  newGuaranteed: boolean;
  was4Pity: boolean;
} {
  let weapon: WishWeapon;
  let newPity = wishPity + 1;
  let new4Pity = wish4Pity + 1;
  let newGuaranteed = wishGuaranteed;
  let was4Pity = false;

  const rate5 = softPityRate(newPity);
  const r = Math.random();

  if (newPity >= HARD_PITY || r < rate5) {
    // 5★ hit
    weapon = roll5Star(newGuaranteed);
    newGuaranteed = weapon.id !== FEATURED_5STAR.id; // lost 50/50 → next guaranteed
    newPity = 0;
    new4Pity = 0;
  } else if (new4Pity >= HARD_PITY_4 || r < BASE_5_RATE + BASE_4_RATE) {
    // 4★ hit
    weapon = roll4Star();
    new4Pity = 0;
    was4Pity = new4Pity >= HARD_PITY_4;
  } else {
    // 3★ — placeholder: re-roll a random 4★ at reduced text emphasis
    // (no 3★ weapons in pool — treat as a low 4★ visually downgraded)
    weapon = roll4Star();
    // Mark as 3★ presentation by re-assigning rarity inline
    weapon = { ...weapon, rarity: 3 as any };
  }

  return { weapon, newPity, new4Pity, newGuaranteed, was4Pity };
}

function subStatLine(type: string, val: number): string {
  const label = type.replace(/_/g, " ");
  return `${label}: +${val}%`;
}

function weaponEmbed(
  w: WishWeapon, level: number, pulled: boolean, color: number,
  isGuaranteed: boolean, lostCoin: boolean,
): EmbedBuilder {
  const atk   = calcWishAtk(w, level);
  const sub   = calcWishSubStat(w.subStatBase, w.subStatScale, level);
  const stars = "★".repeat(w.rarity) + "☆".repeat(Math.max(0, 5 - w.rarity));
  const rarityCol = RARITY_COLOR[w.rarity] ?? color;

  const embed = new EmbedBuilder()
    .setColor(rarityCol)
    .setTitle(`${w.rarity === 5 ? "✦ " : ""}${w.name}`)
    .setDescription([
      `${stars}  ·  ${w.type}`,
      ``,
      `**ATK:** ${atk}  ·  **${w.subStatType.replace(/_/g," ")}:** +${sub}%`,
      `*Two additional substats hidden — level up to reveal them.*`,
      ``,
      `> ${w.passive}`,
      ``,
      `*${w.lore}*`,
    ].join("\n"))
    .setFooter({
      text: [
        pulled ? "Added to your arsenal  ·  /equip to equip  ·  /weapon to inspect" : "",
        w.rarity === 5 && isGuaranteed ? "◈ Guaranteed pull" : "",
        w.rarity === 5 && lostCoin && !isGuaranteed ? "◈ Lost 50/50 — next 5★ is guaranteed featured" : "",
        w.rarity === 5 && !lostCoin && !isGuaranteed ? "◈ Won 50/50" : "",
      ].filter(Boolean).join("  ·  "),
    });

  return embed;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("wish")
    .setDescription("Pull from the weapon banner using Fracture Keys.")
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Pull 1 or 10 times.").setRequired(false)
        .addChoices({ name: "×1  (1 Fracture Key)", value: 1 }, { name: "×10  (10 Fracture Keys)", value: 10 })
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const amount = interaction.options.getInteger("amount") ?? 1;

    const dbUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { element: true, fractureKeys: true, wishPity: true, wish4Pity: true, wishGuaranteed: true },
    });
    if (!dbUser) { await replyNotStarted(interaction); return; }

    if (dbUser.fractureKeys < amount) {
      const color = ELEMENT_HEX[dbUser.element] ?? ELEMENT_HEX.NONE;
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setTitle("◈ Not enough Fracture Keys")
          .setDescription(
            `You have **${dbUser.fractureKeys}** 🗝️ Fracture Keys but need **${amount}**.\n\n` +
            `Earn keys from boss trials, dungeon clears, and ascension wins.`
          )
          .addFields({ name: "Pity", value: `${dbUser.wishPity} / ${HARD_PITY} pulls since last 5★`, inline: true })
          .setFooter({ text: "CARTETHYIA  ·  Wish" })],
      });
      return;
    }

    const color = ELEMENT_HEX[dbUser.element] ?? ELEMENT_HEX.NONE;

    // ── Single pull ────────────────────────────────────────────────────────────
    if (amount === 1) {
      const result = doSinglePull(dbUser.wishPity, dbUser.wish4Pity, dbUser.wishGuaranteed);
      const { weapon, newPity, new4Pity, newGuaranteed } = result;
      const lostCoin = weapon.rarity === 5 && weapon.id !== FEATURED_5STAR.id && !dbUser.wishGuaranteed;

      // Save weapon to DB
      await prisma.$transaction([
        prisma.user.update({
          where: { id: interaction.user.id },
          data: {
            fractureKeys:  { decrement: 1 },
            wishPity:      newPity,
            wish4Pity:     new4Pity,
            wishGuaranteed: newGuaranteed,
          },
        }),
        prisma.weapon.create({
          data: {
            userId:       interaction.user.id,
            weaponType:   weapon.type,
            name:         weapon.name,
            rarity:       weapon.rarity as number,
            baseAtk:      weapon.baseAtk,
            subStatType:  weapon.subStatType,
            subStatVal:   weapon.subStatBase,
            hiddenSub1Type: weapon.hiddenSub1Type,
            hiddenSub1Val:  weapon.hiddenSub1Base,
            hiddenSub2Type: weapon.hiddenSub2Type ?? null,
            hiddenSub2Val:  weapon.hiddenSub2Base ?? null,
            isEquipped:   false,
          },
        }),
      ]);

      const imgPath = getWeaponImagePath(weapon.type, weapon.name);
      const files: AttachmentBuilder[] = imgPath ? [new AttachmentBuilder(imgPath, { name: "weapon.png" })] : [];
      const embed = weaponEmbed(weapon, 1, true, color, dbUser.wishGuaranteed, lostCoin);
      if (imgPath) embed.setImage("attachment://weapon.png");
      embed.addFields({ name: "Pity", value: `${newPity} / ${HARD_PITY}`, inline: true });

      await interaction.editReply({ embeds: [embed], files });
      return;
    }

    // ── ×10 pull ──────────────────────────────────────────────────────────────
    let pity  = dbUser.wishPity;
    let p4    = dbUser.wish4Pity;
    let guar  = dbUser.wishGuaranteed;

    const results: ReturnType<typeof doSinglePull>[] = [];
    for (let i = 0; i < 10; i++) {
      const r = doSinglePull(pity, p4, guar);
      results.push(r);
      pity = r.newPity; p4 = r.new4Pity; guar = r.newGuaranteed;
    }

    // Guaranteed at least one 4★ in 10 — if none rolled, replace the last with one
    const has4Plus = results.some(r => r.weapon.rarity >= 4);
    if (!has4Plus) {
      results[9] = { ...results[9], weapon: roll4Star(), was4Pity: true };
      results[9].weapon = { ...results[9].weapon, rarity: 4 };
    }

    // Persist all weapons + updated pity
    await prisma.$transaction([
      prisma.user.update({
        where: { id: interaction.user.id },
        data: { fractureKeys: { decrement: 10 }, wishPity: pity, wish4Pity: p4, wishGuaranteed: guar },
      }),
      ...results.map(r => prisma.weapon.create({
        data: {
          userId:       interaction.user.id,
          weaponType:   r.weapon.type,
          name:         r.weapon.name,
          rarity:       r.weapon.rarity as number,
          baseAtk:      r.weapon.baseAtk,
          subStatType:  r.weapon.subStatType,
          subStatVal:   r.weapon.subStatBase,
          hiddenSub1Type: r.weapon.hiddenSub1Type,
          hiddenSub1Val:  r.weapon.hiddenSub1Base,
          hiddenSub2Type: r.weapon.hiddenSub2Type ?? null,
          hiddenSub2Val:  r.weapon.hiddenSub2Base ?? null,
          isEquipped:   false,
        },
      })),
    ]);

    // Summary embed
    const highlight = results.find(r => r.weapon.rarity === 5) ?? results.reduce((a, b) => b.weapon.rarity >= a.weapon.rarity ? b : a);
    const star5s = results.filter(r => r.weapon.rarity === 5);
    const star4s = results.filter(r => r.weapon.rarity === 4);

    const summaryLines = results.map(r => {
      const stars = "★".repeat(r.weapon.rarity);
      const prefix = r.weapon.rarity === 5 ? "✦ " : r.weapon.rarity === 4 ? "◆ " : "◇ ";
      return `${prefix}**${r.weapon.name}**  ${stars}  ·  ${r.weapon.type}`;
    });

    const embed = new EmbedBuilder()
      .setColor(star5s.length ? RARITY_COLOR[5] : star4s.length ? RARITY_COLOR[4] : color)
      .setTitle(`◈ ×10 Wish Results`)
      .setDescription(summaryLines.join("\n"))
      .addFields(
        { name: "5★ Pulls", value: `${star5s.length}`, inline: true },
        { name: "4★ Pulls", value: `${star4s.length}`, inline: true },
        { name: "Pity",     value: `${pity} / ${HARD_PITY}`, inline: true },
      )
      .setFooter({ text: "CARTETHYIA  ·  Wish  ·  All weapons added to your arsenal" });

    const highlightImg = getWeaponImagePath(highlight.weapon.type, highlight.weapon.name);
    const files = highlightImg ? [new AttachmentBuilder(highlightImg, { name: "weapon.png" })] : [];
    if (highlightImg) embed.setThumbnail("attachment://weapon.png");

    await interaction.editReply({ embeds: [embed], files });
  },
};

export default command;
