import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuInteraction,
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
import { CE, getEmojiResolvable } from "../../lib/emojiManager";
import path from "path";

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
  | { tier: 4; weapon: WishWeapon; newPity: number; new4Pity: number; newGuaranteed: boolean }
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
    return { tier: 4, weapon: roll4Star(), newPity, new4Pity: 0, newGuaranteed };
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
      ].join("\n");

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
          `4★: **5.1%** base · guaranteed every **10** pulls`,
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

async function runSuspense(interaction: ChatInputCommandInteraction, tier: 3 | 4 | 5): Promise<void> {
  const frames  = tier === 5 ? SUSPENSE_5STAR : tier === 4 ? SUSPENSE_4STAR : SUSPENSE_3STAR;
  const gifPath = tier === 5 ? ANIM_5STAR     : tier === 4 ? ANIM_4STAR     : ANIM_3STAR;
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

function weaponCreateData(userId: string, w: WishWeapon) {
  return {
    userId, weaponType: w.type, name: w.name, rarity: w.rarity as number,
    baseAtk: w.baseAtk, subStatType: w.subStatType, subStatVal: w.subStatBase,
    hiddenSub1Type: w.hiddenSub1Type, hiddenSub1Val: w.hiddenSub1Base,
    hiddenSub2Type: w.hiddenSub2Type ?? null, hiddenSub2Val: w.hiddenSub2Base ?? null,
    isEquipped: false,
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
      select: { element: true, fractureKeys: true, wishPity: true, wish4Pity: true, wishGuaranteed: true, wishTarget: true },
    });
    if (!dbUser) { await replyNotStarted(interaction); return; }

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
      time:   120_000,
    });

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
      collector.stop();

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

        if (res.tier === 3) {
          await prisma.user.update({
            where: { id: interaction.user.id },
            data: { fractureKeys: { decrement: 1 }, wishPity: newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed,
                    forgingOres: { increment: res.mat.forgingOres }, tuningModules: { increment: res.mat.tuningModules }, credits: { increment: res.mat.credits } },
          });
        } else {
          await prisma.$transaction([
            prisma.user.update({ where: { id: interaction.user.id },
              data: { fractureKeys: { decrement: 1 }, wishPity: newPity, wish4Pity: new4Pity, wishGuaranteed: newGuaranteed } }),
            prisma.weapon.create({ data: weaponCreateData(interaction.user.id, res.weapon) }),
          ]);
        }

        await runSuspense(interaction, res.tier);

        if (res.tier === 3) {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x4A4A5A).setTitle("◇  The fracture yields materials")
              .setDescription(`**${res.mat.label}**\n\n*The resonance wasn't strong enough this time.*`)
              .addFields({ name: "Pity", value: `${newPity} / ${HARD_PITY}`, inline: true })
              .setFooter({ text: "CARTETHYIA  ·  Wish  ·  Keep pulling — pity carries over" })],
            files: [], components: [],
          });
        } else {
          const tgt      = targetId ? WISH_WEAPONS_5STAR.find(w => w.id === targetId) ?? null : null;
          const lostCoin = res.weapon.rarity === 5 && !fresh.wishGuaranteed && tgt != null && res.weapon.id !== tgt.id;
          const imgPath  = getWeaponImagePath(res.weapon.type, res.weapon.name);
          const files    = imgPath ? [new AttachmentBuilder(imgPath, { name: "weapon.png" })] : [];
          const embed    = resultEmbed(res.weapon, newPity, color, fresh.wishGuaranteed, lostCoin);
          if (imgPath) embed.setImage("attachment://weapon.png");
          await interaction.editReply({ embeds: [embed], files, components: [] });
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
      const weaponResults = results.filter((r): r is Extract<PullResult, { tier: 4|5 }> => r.tier >= 4);
      const star3count    = results.filter(r => r.tier === 3).length;

      await prisma.$transaction([
        prisma.user.update({ where: { id: interaction.user.id },
          data: { fractureKeys: { decrement: 10 }, wishPity: pity, wish4Pity: p4, wishGuaranteed: guar,
                  forgingOres: { increment: matTotals.forgingOres }, tuningModules: { increment: matTotals.tuningModules }, credits: { increment: matTotals.credits } } }),
        ...weaponResults.map(r => prisma.weapon.create({ data: weaponCreateData(interaction.user.id, r.weapon) })),
      ]);

      const has5 = results.some(r => r.tier === 5), has4 = results.some(r => r.tier === 4);
      await runSuspense(interaction, has5 ? 5 : has4 ? 4 : 3);

      const star5s    = results.filter(r => r.tier === 5) as Extract<PullResult, { tier:5 }>[];
      const star4s    = results.filter(r => r.tier === 4) as Extract<PullResult, { tier:4 }>[];
      const highlight = star5s[0] ?? star4s[0];

      const lines = results.map(r =>
        r.tier === 3
          ? `◇  *${r.mat.label}*`
          : `${RARITY_LABEL[r.tier]}  **${r.weapon.name}**  ${"★".repeat(r.tier)}  ·  ${r.weapon.type}`
      );

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

      const hlImg = highlight ? getWeaponImagePath(highlight.weapon.type, highlight.weapon.name) : null;
      const files = hlImg ? [new AttachmentBuilder(hlImg, { name: "weapon.png" })] : [];
      if (hlImg) summaryEmbed.setImage("attachment://weapon.png");
      await interaction.editReply({ embeds: [summaryEmbed], files, components: [] });
    });

    collector.on("end", (col) => {
      if (!col.has("wish_x1") && !col.has("wish_x10"))
        interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
