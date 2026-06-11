import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, StringSelectMenuInteraction, ComponentType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS, MAIN_STAT_LABELS, calcMainStatValue, calcSubstatValue, formatStatValue, SUBSTAT_LABELS } from "../../lib/echoes";
import { Element } from "@prisma/client";
import { generateEchoCard, echoRowToCard } from "../../lib/echoCard";

export const data = new SlashCommandBuilder()
  .setName("echo")
  .setDescription("View one of your echoes as a detailed card.")
  .addStringOption(o =>
    o.setName("element")
      .setDescription("Filter by element")
      .setRequired(false)
      .addChoices(
        { name: "🔥 Fusion",   value: "FUSION"  },
        { name: "❄️ Glacio",   value: "GLACIO"  },
        { name: "⚡ Electro",  value: "ELECTRO" },
        { name: "🌪️ Aero",    value: "AERO"    },
        { name: "🌑 Havoc",   value: "HAVOC"   },
        { name: "✨ Spectro",  value: "SPECTRO" },
      )
  )
  .addIntegerOption(o =>
    o.setName("cost")
      .setDescription("Filter by echo cost")
      .setRequired(false)
      .addChoices(
        { name: "1-cost  (common)",      value: 1 },
        { name: "3-cost  (field)",        value: 3 },
        { name: "4-cost  (boss)",         value: 4 },
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const filterElement = interaction.options.getString("element")   ?? null;
  const filterCost    = interaction.options.getInteger("cost")     ?? null;

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const where: any = { userId: interaction.user.id };
  if (filterElement) where.element = filterElement;
  if (filterCost)    where.cost    = filterCost;

  const echoes = await prisma.echo.findMany({
    where,
    orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { cost: "desc" }, { level: "desc" }, { createdAt: "desc" }],
  });

  const filterDesc = [
    filterElement ? `${ELEMENT_EMOJI[filterElement as Element]} ${filterElement}` : null,
    filterCost    ? `${filterCost}-cost` : null,
  ].filter(Boolean).join("  ·  ");

  const color = ELEMENT_COLORS[(filterElement as Element) ?? (dbUser.element as Element)];

  if (echoes.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(
          filterDesc
            ? `No echoes found matching **${filterDesc}**.`
            : "You have no echoes yet. Defeat enemies that appear while chatting to capture them."
        )
        .setFooter({ text: "CARTETHYIA  ·  Echo" })],
    });
    return;
  }

  // Discord select menu max = 25
  const shown   = echoes.slice(0, 25);
  const hasMore = echoes.length > 25;

  const renderCard = async (echo: any) => {
    const buf = await generateEchoCard(echoRowToCard(echo));
    return new AttachmentBuilder(buf, { name: "echo.png" });
  };

  const buildEmbed = (echo: any) => new EmbedBuilder()
    .setColor(ELEMENT_COLORS[echo.element as Element])
    .setImage("attachment://echo.png")
    .setFooter({ text: `CARTETHYIA  ·  Echo${echo.isEquipped ? "  ·  EQUIPPED" : ""}${filterDesc ? `  ·  Filter: ${filterDesc}` : ""}` });

  const options = shown.map(e => {
    const mainVal   = calcMainStatValue(e.mainStatType, e.level, e.rarity);
    const mainLabel = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
    // Best revealed substat (first one)
    const bestSub = e.revealedSubstats > 0 && e.substat1Type
      ? `  ·  ${SUBSTAT_LABELS[e.substat1Type] ?? e.substat1Type} ${formatStatValue(e.substat1Type, calcSubstatValue(e.substat1Type, e.substat1Value ?? 0, e.level))}`
      : "";
    return {
      label:       `${e.name}  ${RARITY_STARS[e.rarity]}  Lv${e.level}${e.isEquipped ? "  ← equipped" : ""}`,
      description: `${e.cost}-cost · ${mainLabel}: ${formatStatValue(e.mainStatType, mainVal)}${bestSub}`,
      value:       e.id,
    };
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("echo_view_select")
      .setPlaceholder(filterDesc ? `Showing ${echoes.length} echo${echoes.length !== 1 ? "es" : ""} — ${filterDesc}` : "Select an echo to view…")
      .addOptions(options)
  );

  const first = shown[0];
  await interaction.editReply({
    embeds:     [buildEmbed(first)],
    files:      [await renderCard(first)],
    components: [row],
  });

  if (hasMore) {
    await interaction.followUp({
      content: `> ℹ️ You have **${echoes.length}** echoes matching this filter — showing the top 25. Add more filters to narrow down.`,
      flags: 64,
    });
  }

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "echo_view_select",
    time:   120_000,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();  // acknowledge immediately — card gen can take a moment
    const echo = shown.find(e => e.id === sel.values[0]);
    if (!echo) return;
    const attachment = await renderCard(echo);
    await sel.editReply({
      embeds:     [buildEmbed(echo)],
      files:      [attachment],
      components: [row],
    });
  });

  collector?.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}
