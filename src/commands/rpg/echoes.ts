import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder,
} from "discord.js";
import prisma from "../../lib/prisma";
import {
  ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS,
  MAIN_STAT_LABELS, SUBSTAT_LABELS,
} from "../../lib/echoes";
import { echoEmoji } from "../../lib/emojiManager";
import { resolvePlayerBonuses } from "../../lib/setBonus";
import { generateGridCard } from "../../lib/gridCard";
import { Element } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("echoes")
  .setDescription("View your Echo collection and equipped resonance grid.")
  .addUserOption(o =>
    o.setName("user").setDescription("View another player's echoes").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target = interaction.options.getUser("user") ?? interaction.user;
  const member = interaction.guild?.members.cache.get(target.id);
  const displayName = member?.displayName ?? target.displayName;

  const dbUser = await prisma.user.findUnique({
    where:   { id: target.id },
    select:  { element: true, worldLevel: true },
  });

  if (!dbUser) {
    await interaction.editReply({ content: `${displayName} hasn't started their journey yet.`,});
    return;
  }

  const echoes = await prisma.echo.findMany({
    where:   { userId: target.id },
    orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { createdAt: "desc" }],
  });

  const element  = dbUser.element as Element;
  const color    = ELEMENT_COLORS[element];

  if (echoes.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle(`${ELEMENT_EMOJI[element]}  ${displayName}'s Echoes`)
        .setDescription("*No echoes collected yet.*\n\nEngage enemies that appear while chatting to capture their echoes.")
        .setFooter({ text: "CARTETHYIA  ·  Echo Collection" })],
    });
    return;
  }

  // Split equipped vs unequipped
  const equipped   = echoes.filter(e => e.isEquipped).sort((a, b) => (a.equippedSlot ?? 0) - (b.equippedSlot ?? 0));
  const unequipped = echoes.filter(e => !e.isEquipped);
  const gridPoints = equipped.reduce((sum, e) => sum + e.cost, 0);

  // Resolve bonuses for the grid card panel
  const bonuses = await resolvePlayerBonuses(target.id);

  // Render the Resonance Grid card
  const gridBuf = await generateGridCard({
    displayName,
    element:    dbUser.element,
    slots:      equipped.filter(e => e.equippedSlot !== null).map(e => ({
      slot: e.equippedSlot!, name: e.name, element: e.element,
      rarity: e.rarity, cost: e.cost, level: e.level,
    })),
    gridPoints,
    bonusLabels: bonuses.activeLabels.flatMap(l => l.split("\n")).map(l => l.replace(/^\s*[›✦]\s*/, "").trim()).filter(Boolean),
  });
  const gridAttach = new AttachmentBuilder(gridBuf, { name: "grid.png" });

  // Inventory list (first 12)
  const invLines: string[] = unequipped.slice(0, 12).map(e => {
    const elem    = e.element as Element;
    const icon    = echoEmoji(e.name, ELEMENT_EMOJI[elem]);
    return `${icon} **${e.name}**  ${RARITY_STARS[e.rarity]}  ·  ${e.cost}-cost · Lv${e.level}`;
  });
  if (unequipped.length > 12) invLines.push(`*… and ${unequipped.length - 12} more*`);

  // Full active bonus text for the embed (canvas may wrap long lines)
  const bonusText = bonuses.activeLabels.length === 0
    ? "*No active bonuses — equip echoes of the same element to activate set effects.*"
    : bonuses.activeLabels.map(l => `› ${l}`).join("\n");
  const bonusValue = bonusText.length > 1024 ? bonusText.slice(0, 1020) + "…" : bonusText;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setImage("attachment://grid.png")
    .addFields(
      {
        name:   "✦  Active Bonuses",
        value:  bonusValue,
        inline: false,
      },
      {
        name:   `◇  Inventory  [${unequipped.length} echo${unequipped.length !== 1 ? "es" : ""}]`,
        value:  invLines.length ? invLines.join("\n") : "*All echoes equipped or none collected.*",
        inline: false,
      },
    )
    .setFooter({ text: `CARTETHYIA  ·  ${echoes.length} echoes  ·  /echo to view a card · /echo-equip to slot` });

  await interaction.editReply({ embeds: [embed], files: [gridAttach] });
}
