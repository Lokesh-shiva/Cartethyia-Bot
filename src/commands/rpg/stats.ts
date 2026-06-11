import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { resolvePlayerBonuses, applyBonuses } from "../../lib/setBonus";
import { ELEMENT_EMOJI } from "../../lib/echoes";
import { Element } from "@prisma/client";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View your final combat stats — all weapon, echo and element bonuses applied.")
  .addUserOption(o =>
    o.setName("user").setDescription("View another player's stats").setRequired(false)
  );

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
function diff(base: number, final: number): string {
  const d = final - base;
  return d > 0 ? `  *(+${d.toLocaleString()})*` : "";
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target      = interaction.options.getUser("user") ?? interaction.user;
  const member      = interaction.guild?.members.cache.get(target.id);
  const displayName = member?.displayName ?? target.displayName;

  const dbUser = await prisma.user.findUnique({
    where:  { id: target.id },
    select: {
      level: true, worldLevel: true, element: true,
      baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true,
      critRate: true, critDmg: true,
    },
  });
  if (!dbUser) {
    if (target.id === interaction.user.id) { await replyNotStarted(interaction); return; }
    await interaction.editReply({ content: `${displayName} hasn't started their journey yet.` });
    return;
  }

  const bonuses = await resolvePlayerBonuses(target.id);
  const stats   = applyBonuses(dbUser, bonuses);
  const element = dbUser.element as Element;
  const color   = ELEMENT_HEX[element] ?? ELEMENT_HEX.NONE;

  const statBlock = [
    `❤️ HP — **${stats.hp.toLocaleString()}**${diff(dbUser.baseHp, stats.hp)}`,
    `⚔️ ATK — **${stats.atk.toLocaleString()}**${diff(dbUser.baseAtk, stats.atk)}`,
    `🛡️ DEF — **${stats.def.toLocaleString()}**${diff(dbUser.baseDef, stats.def)}`,
    `💨 SPD — **${dbUser.baseSpeed}**`,
    ``,
    `🎯 Crit Rate — **${pct(stats.critRate)}**${bonuses.critRateBonus > 0 ? `  *(+${pct(bonuses.critRateBonus)})*` : ""}`,
    `💥 Crit DMG — **${pct(stats.critDmg)}**${bonuses.critDmgBonus > 0 ? `  *(+${pct(bonuses.critDmgBonus)})*` : ""}`,
    `${ELEMENT_EMOJI[element] ?? "◇"} Elem DMG Bonus — **${pct(stats.elemDmgBonus)}**`,
    `⚡ Energy / turn — **${stats.energyPerTurn}**`,
    stats.lifesteal > 0 ? `🩸 Lifesteal — **${pct(stats.lifesteal)}**` : null,
  ].filter((l): l is string => l !== null).join("\n");

  const bonusText = bonuses.activeLabels.length === 0
    ? "*No active bonuses — equip a weapon and echoes to power up.*"
    : bonuses.activeLabels.map(l => `› ${l}`).join("\n");
  const bonusValue = bonusText.length > 1024 ? bonusText.slice(0, 1020) + "…" : bonusText;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${displayName}  ·  Combat Stats  ·  Lv${dbUser.level}  WL${dbUser.worldLevel}`,
      iconURL: target.displayAvatarURL({ size: 64, extension: "png" }),
    })
    .addFields(
      { name: "◈  Final Stats (all bonuses applied)", value: statBlock, inline: false },
      { name: "✦  Bonus Sources", value: bonusValue, inline: false },
    )
    .setFooter({ text: "CARTETHYIA  ·  Stats  ·  These are the exact numbers used in combat" });

  await interaction.editReply({ embeds: [embed] });
}
