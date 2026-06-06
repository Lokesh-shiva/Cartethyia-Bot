import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ComponentType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import {
  ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS,
  MAIN_STAT_LABELS, SUBSTAT_LABELS, formatStatValue, substatCount, calcSubstatValue,
} from "../../lib/echoes";
import { generateEchoCard, echoRowToCard } from "../../lib/echoCard";
import { CE } from "../../lib/emojiManager";
import { AttachmentBuilder } from "discord.js";
import { Element } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("echo-reveal")
  .setDescription("Reveal a hidden substat on an echo using a Sealing Tube.");

function buildSubstatLines(echo: any, revealCount: number): string {
  const total = substatCount(echo.rarity);
  const lines: string[] = [];
  for (let i = 1; i <= total; i++) {
    const type  = echo[`substat${i}Type`]  as string;
    const base  = echo[`substat${i}Value`] as number;
    const value = calcSubstatValue(type, base, echo.level ?? 0);
    const label = SUBSTAT_LABELS[type] ?? type;
    if (i <= revealCount) {
      lines.push(`› **${label}**  +${formatStatValue(type, value)}`);
    } else {
      lines.push(`› *— sealed —*`);
    }
  }
  return lines.join("\n");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, sealingTubes: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element];

  // Only echoes with sealed substats
  const echoes = await prisma.echo.findMany({
    where:   { userId: interaction.user.id },
    orderBy: [{ rarity: "desc" }, { createdAt: "desc" }],
  });

  const revealable = echoes.filter(e => e.revealedSubstats < substatCount(e.rarity));

  if (revealable.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription("All your echoes have their substats fully revealed already.")
        .setFooter({ text: "CARTETHYIA  ·  Echo Reveal" })],
    });
    return;
  }

  const options = revealable.slice(0, 25).map(e => {
    const total     = substatCount(e.rarity);
    const sealed    = total - e.revealedSubstats;
    const mainLabel = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
    return {
      label:       `${e.name}  ${RARITY_STARS[e.rarity]}  (${sealed} sealed)`,
      description: `Main: ${mainLabel}  ·  ${ELEMENT_EMOJI[e.element as Element]} ${e.element}`,
      value:       e.id,
    };
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("echo_reveal_select")
      .setPlaceholder("Select an echo to reveal a substat on…")
      .addOptions(options)
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${ELEMENT_EMOJI[dbUser.element as Element]}  Echo Reveal`)
      .setDescription(
        `You have **${dbUser.sealingTubes} ${CE.st} Sealing Tubes**.\n\n` +
        `Each reveal costs **1 Sealing Tube** and uncovers the next hidden substat on your echo.\n` +
        `3★ echoes have 3 substats, 4★ have 4, 5★ have all 5.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Echo Reveal  ·  Expires in 60s" })],
    components: [row],
  });

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "echo_reveal_select",
    time:   60_000,
    max:    1,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();  // acknowledge immediately — DB + canvas work follows
    const echo = await prisma.echo.findUnique({ where: { id: sel.values[0] } });
    if (!echo || echo.userId !== interaction.user.id) {
      await sel.editReply({ content: "Echo not found.", components: [], embeds: [] });
      return;
    }

    const total  = substatCount(echo.rarity);
    if (echo.revealedSubstats >= total) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(color).setDescription("That echo's substats are already all revealed.")],
        components: [],
      });
      return;
    }

    const fresh = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { sealingTubes: true } });
    if ((fresh?.sealingTubes ?? 0) < 1) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D)
          .setDescription("⚠  You don't have any **Sealing Tubes**.\n\nEarn them from `/vibe` physical interactions, 7-day `/daily` streak, and Dispatch.")
          .setFooter({ text: "CARTETHYIA  ·  Echo Reveal" })],
        components: [],
      });
      return;
    }

    const newRevealed = echo.revealedSubstats + 1;
    await prisma.$transaction([
      prisma.echo.update({ where: { id: echo.id }, data: { revealedSubstats: newRevealed } }),
      prisma.user.update({ where: { id: interaction.user.id }, data: { sealingTubes: { decrement: 1 } } }),
    ]);

    const revealedIdx = newRevealed;
    const newType     = echo[`substat${revealedIdx}Type`  as keyof typeof echo] as string;
    const baseValue   = echo[`substat${revealedIdx}Value` as keyof typeof echo] as number;
    const newValue    = calcSubstatValue(newType, baseValue, echo.level);
    const newLabel    = SUBSTAT_LABELS[newType] ?? newType;
    const echoElem    = echo.element as Element;
    const remaining   = total - newRevealed;

    const cardBuf = await generateEchoCard(echoRowToCard({ ...echo, revealedSubstats: newRevealed }));

    await sel.editReply({
      embeds: [new EmbedBuilder()
        .setColor(ELEMENT_COLORS[echoElem])
        .setImage("attachment://echo.png")
        .setDescription(
          `${ELEMENT_EMOJI[echoElem]}  **Substat ${newRevealed}/${total} revealed:**  ` +
          `**${newLabel}** +${formatStatValue(newType, newValue)}`
        )
        .setFooter({ text: `CARTETHYIA  ·  Echo Reveal  ·  ${remaining} still sealed  ·  ${(fresh?.sealingTubes ?? 1) - 1} ${CE.st} remaining` })],
      files: [new AttachmentBuilder(cardBuf, { name: "echo.png" })],
      components: [],
    });
  });

  collector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
