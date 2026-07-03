import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ComponentType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS } from "../../lib/echoes";
import { NAMED_SETS, NamedSetId } from "../../lib/namedSets";
import { Element } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("echo-lock")
  .setDescription("Toggle a lock on an echo to protect it from /echo-discard and /echo-reroll.");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element];

  const echoes = await prisma.echo.findMany({
    where:   { userId: interaction.user.id },
    orderBy: [{ isLocked: "desc" }, { isEquipped: "desc" }, { rarity: "desc" }, { createdAt: "desc" }],
  });

  if (echoes.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color).setDescription("You have no echoes yet.").setFooter({ text: "CARTETHYIA  ·  Echo Lock" })],
    });
    return;
  }

  const options = echoes.slice(0, 25).map(e => {
    const setInfo = e.setId ? NAMED_SETS[e.setId as NamedSetId] : null;
    return {
      label:       `${e.isLocked ? "🔒" : "🔓"} ${e.name}  ${RARITY_STARS[e.rarity]}  Lv${e.level}${e.isEquipped ? "  · EQUIPPED" : ""}`,
      description: `${setInfo ? `✦ ${setInfo.name}` : e.element}  ·  ${e.cost}-cost  ·  ${e.isLocked ? "Locked — select to unlock" : "Unlocked — select to lock"}`,
      value:       e.id,
    };
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("echo_lock_select")
      .setPlaceholder("Select an echo to toggle its lock…")
      .addOptions(options)
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${ELEMENT_EMOJI[dbUser.element as Element]}  Echo Lock`)
      .setDescription(
        "Locked echoes are skipped entirely by `/echo-discard` (single and bulk) so you can't accidentally dismantle a build you're keeping.\n\n" +
        "Select an echo below to toggle its lock."
      )
      .setFooter({ text: "CARTETHYIA  ·  Echo Lock  ·  Expires in 60s" })],
    components: [row],
  });

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "echo_lock_select",
    time:   60_000,
    max:    1,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();
    const echo = await prisma.echo.findUnique({ where: { id: sel.values[0] } });
    if (!echo || echo.userId !== interaction.user.id) {
      await sel.editReply({ content: "Echo not found.", components: [], embeds: [] });
      return;
    }

    const updated = await prisma.echo.update({ where: { id: echo.id }, data: { isLocked: !echo.isLocked } });

    await sel.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription(`${updated.isLocked ? "🔒" : "🔓"} **${updated.name}** is now **${updated.isLocked ? "locked" : "unlocked"}**.`)
        .setFooter({ text: "CARTETHYIA  ·  Echo Lock" })],
      components: [],
    });
  });

  collector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
