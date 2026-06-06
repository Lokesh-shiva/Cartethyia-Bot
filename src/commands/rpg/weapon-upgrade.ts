import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { WEAPON_TYPE_EMOJI, RARITY_STARS } from "../../lib/weapons";
import { CE } from "../../lib/emojiManager";
import { WeaponType } from "@prisma/client";

const MAX_WEAPON_LEVEL = 90;

function upgradeCost(level: number): number {
  if (level < 20) return 1;
  if (level < 40) return 2;
  if (level < 60) return 3;
  if (level < 80) return 4;
  return 5;
}

// Total ore to reach a level from 1: used for summary display
function totalCostRange(from: number, to: number): number {
  let cost = 0;
  for (let l = from; l < to; l++) cost += upgradeCost(l);
  return cost;
}

const RARITY_MAX_MULT: Record<number, number> = { 1: 2.5, 2: 3.0, 3: 3.5 };
function effectiveAtk(baseAtk: number, rarity: number, level: number): number {
  const maxMult = RARITY_MAX_MULT[rarity] ?? 2.5;
  return Math.round(baseAtk * (1 + (level - 1) * (maxMult - 1) / 89));
}
function effectiveSubStat(base: number, level: number): number {
  return Math.round((base * (1 + (level - 1) * 0.8 / 89)) * 10) / 10;
}

function modeButtons(weaponId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`wu:${weaponId}:1`).setLabel("+1 Level").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`wu:${weaponId}:10`).setLabel("+10 Levels").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`wu:${weaponId}:auto`).setLabel("Auto Max").setStyle(ButtonStyle.Success),
  );
}

export const data = new SlashCommandBuilder()
  .setName("weapon-upgrade")
  .setDescription("Level up a weapon using Forging Ores (max level 90).");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, forgingOres: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const weapons = await prisma.weapon.findMany({
    where:   { userId: interaction.user.id },
    orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "asc" }],
    take:    25,
  });

  const upgradeable = weapons.filter(w => w.level < MAX_WEAPON_LEVEL);

  if (weapons.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x4A4A5A)
        .setDescription("You don't have any weapons. Use `/forge` to craft one first.")
        .setFooter({ text: "CARTETHYIA  ·  Weapon Upgrade" })],
    });
    return;
  }
  if (upgradeable.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x4A4A5A)
        .setDescription("All your weapons are already at max level (90).")
        .setFooter({ text: "CARTETHYIA  ·  Weapon Upgrade" })],
    });
    return;
  }

  const options = upgradeable.map(w => {
    const cost      = upgradeCost(w.level);
    const canAfford = dbUser.forgingOres >= cost;
    const emoji     = WEAPON_TYPE_EMOJI[w.weaponType as WeaponType] ?? "🗡️";
    return {
      label:       `${w.name}  Lv${w.level}/${MAX_WEAPON_LEVEL}  (${cost} FO next)${canAfford ? "" : "  ✗"}`,
      description: `${emoji} ${w.weaponType}  ·  ${RARITY_STARS[w.rarity] ?? ""}${w.isEquipped ? "  · EQUIPPED" : ""}`,
      value:       w.id,
    };
  });

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("weapon_upgrade_select")
      .setPlaceholder("Select a weapon to upgrade…")
      .addOptions(options)
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xF5A623)
      .setTitle("🗡️  Weapon Upgrade")
      .setDescription(
        `You have **${dbUser.forgingOres} ${CE.fo} Forging Ores**.\n\n` +
        `Cost per level: Lv 1–19: 1 ore  ·  20–39: 2  ·  40–59: 3  ·  60–79: 4  ·  80–89: 5\n\n` +
        `Each level increases **ATK** and **sub-stat**. Passives are always active.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Weapon Upgrade  ·  Expires in 60s" })],
    components: [selectRow],
  });

  const selCollector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "weapon_upgrade_select",
    time:   60_000,
    max:    1,
  });

  selCollector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();
    const weapon = await prisma.weapon.findUnique({ where: { id: sel.values[0] } });
    if (!weapon || weapon.userId !== interaction.user.id) {
      await sel.editReply({ content: "Weapon not found.", components: [], embeds: [] });
      return;
    }
    if (weapon.level >= MAX_WEAPON_LEVEL) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("That weapon is already at max level.")],
        components: [],
      });
      return;
    }

    const freshUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { forgingOres: true },
    });
    const ores  = freshUser?.forgingOres ?? 0;
    const emoji = WEAPON_TYPE_EMOJI[weapon.weaponType as WeaponType] ?? "🗡️";
    const curAtk = effectiveAtk(weapon.baseAtk, weapon.rarity, weapon.level);
    const curSub = weapon.subStatVal != null ? effectiveSubStat(weapon.subStatVal, weapon.level) : null;

    function infoEmbed() {
      let statLine = `**ATK:** ${curAtk}`;
      if (weapon!.subStatType && curSub != null) {
        statLine += `  ·  **${weapon!.subStatType.replace(/_/g, " ")}:** ${curSub}`;
      }
      return new EmbedBuilder()
        .setColor(0xF5A623)
        .setTitle(`${emoji}  ${weapon!.name}  ${RARITY_STARS[weapon!.rarity] ?? ""}`)
        .setDescription(
          `Level **${weapon!.level}** / **${MAX_WEAPON_LEVEL}**\n` +
          `${statLine}\n\n` +
          `${CE.fo} **${ores}** Forging Ores  ·  next level costs **${upgradeCost(weapon!.level)}**`
        )
        .setFooter({ text: "CARTETHYIA  ·  Weapon Upgrade  ·  Expires in 2min" });
    }

    await sel.editReply({
      embeds:     [infoEmbed()],
      components: [modeButtons(weapon.id)],
    });

    const btnCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.user.id === interaction.user.id && i.customId.startsWith(`wu:${weapon.id}:`),
      time:   120_000,
      max:    1,
    });

    btnCollector?.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();
      const mode = btn.customId.split(":")[2];

      const latest = await prisma.weapon.findUnique({ where: { id: weapon.id } });
      if (!latest) { await btn.editReply({ content: "Weapon not found.", components: [], embeds: [] }); return; }

      const latestUser = await prisma.user.findUnique({
        where:  { id: interaction.user.id },
        select: { forgingOres: true },
      });
      const availOres = latestUser?.forgingOres ?? 0;

      const startLevel  = latest.level;
      const targetLevel =
        mode === "1"  ? Math.min(startLevel + 1,  MAX_WEAPON_LEVEL) :
        mode === "10" ? Math.min(startLevel + 10, MAX_WEAPON_LEVEL) :
        MAX_WEAPON_LEVEL;

      let totalCost = 0;
      let endLevel  = startLevel;
      for (let lvl = startLevel; lvl < targetLevel; lvl++) {
        const c = upgradeCost(lvl);
        if (availOres < totalCost + c) break;
        totalCost += c;
        endLevel   = lvl + 1;
      }

      if (endLevel === startLevel) {
        await btn.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setDescription(`⚠  Not enough Forging Ores. Need **${upgradeCost(startLevel)}**, have **${availOres}**.`)
            .setFooter({ text: "CARTETHYIA  ·  Weapon Upgrade" })],
          components: [],
        });
        return;
      }

      await prisma.$transaction([
        prisma.weapon.update({ where: { id: weapon.id }, data: { level: endLevel } }),
        prisma.user.update({ where: { id: interaction.user.id }, data: { forgingOres: { decrement: totalCost } } }),
      ]);

      const newAtk = effectiveAtk(latest.baseAtk, latest.rarity, endLevel);
      const oldAtk = effectiveAtk(latest.baseAtk, latest.rarity, startLevel);
      const newSub = latest.subStatVal != null ? effectiveSubStat(latest.subStatVal, endLevel)   : null;
      const oldSub = latest.subStatVal != null ? effectiveSubStat(latest.subStatVal, startLevel) : null;
      const isMax  = endLevel >= MAX_WEAPON_LEVEL;

      let desc = `**${latest.name}**  ${RARITY_STARS[latest.rarity] ?? ""}\n` +
                 `Level **${startLevel}** → **${endLevel}**${isMax ? "  *(MAX)*" : ""}\n\n` +
                 `**ATK:** ${oldAtk} → **${newAtk}**`;
      if (latest.subStatType && oldSub != null && newSub != null) {
        desc += `\n**${latest.subStatType.replace(/_/g, " ")}:** ${oldSub} → **${newSub}**`;
      }

      await btn.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xF5A623)
          .setTitle(`${emoji}  Weapon Upgraded`)
          .setDescription(desc)
          .setFooter({ text: `CARTETHYIA  ·  Weapon Upgrade  ·  ${availOres - totalCost} ${CE.fo} remaining` })],
        components: [],
      });
    });

    btnCollector?.on("end", async (col) => {
      if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
    });
  });

  selCollector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
