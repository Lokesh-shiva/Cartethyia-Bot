import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ComponentType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS, MAIN_STAT_LABELS } from "../../lib/echoes";
import { Element } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("echo-equip")
  .setDescription("Equip an echo to your Resonance Grid.")
  .addIntegerOption(o =>
    o.setName("slot")
      .setDescription("Grid slot (0 = main, 1-4 = sub slots)")
      .setRequired(true)
      .addChoices(
        { name: "Main Slot (0)", value: 0 },
        { name: "Sub Slot 1",    value: 1 },
        { name: "Sub Slot 2",    value: 2 },
        { name: "Sub Slot 3",    value: 3 },
        { name: "Sub Slot 4",    value: 4 },
      )
  )
  .addStringOption(o =>
    o.setName("element")
      .setDescription("Filter echoes by element")
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
      .setDescription("Filter echoes by cost")
      .setRequired(false)
      .addChoices(
        { name: "1-cost  (common)", value: 1 },
        { name: "3-cost  (field)",  value: 3 },
        { name: "4-cost  (boss)",   value: 4 },
      )
  );

const MAX_GRID_POINTS = 12;

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const slot          = interaction.options.getInteger("slot", true);
  const filterElement = interaction.options.getString("element")  ?? null;
  const filterCost    = interaction.options.getInteger("cost")    ?? null;

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const element = dbUser.element as Element;
  const color   = ELEMENT_COLORS[element];

  const where: any = { userId: interaction.user.id, isEquipped: false };
  if (filterElement) where.element = filterElement;
  if (filterCost)    where.cost    = filterCost;

  const unequipped = await prisma.echo.findMany({
    where,
    orderBy: [{ rarity: "desc" }, { cost: "desc" }, { level: "desc" }, { createdAt: "desc" }],
  });

  const filterDesc = [
    filterElement ? `${ELEMENT_EMOJI[filterElement as Element]} ${filterElement}` : null,
    filterCost    ? `${filterCost}-cost` : null,
  ].filter(Boolean).join("  ·  ");

  if (unequipped.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription(
          filterDesc
            ? `No unequipped echoes matching **${filterDesc}**.\nTry different filters or unequip some echoes first.`
            : "You have no unequipped echoes.\n\nDefeat enemies to collect more."
        )
        .setFooter({ text: "CARTETHYIA  ·  Resonance Grid" })],
    });
    return;
  }

  // Current grid to validate point budget
  const equipped = await prisma.echo.findMany({
    where:  { userId: interaction.user.id, isEquipped: true },
    select: { cost: true, equippedSlot: true },
  });

  const pointsExcludingSlot = equipped
    .filter(e => e.equippedSlot !== slot)
    .reduce((sum, e) => sum + e.cost, 0);

  // Show up to 25 (Discord limit)
  const shown   = unequipped.slice(0, 25);
  const hasMore = unequipped.length > 25;

  const options = shown.map(e => {
    const mainLabel  = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
    const stars      = RARITY_STARS[e.rarity];
    const pts        = pointsExcludingSlot + e.cost;
    const overBudget = pts > MAX_GRID_POINTS;
    return {
      label:       `${e.name}  ${stars}  Lv${e.level}  (${e.cost}-cost)${overBudget ? "  ⚠ over budget" : ""}`,
      description: `Main: ${mainLabel}  ·  ${ELEMENT_EMOJI[e.element as Element]} ${e.element}`,
      value:       e.id,
    };
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("echo_equip_select")
      .setPlaceholder(filterDesc ? `${unequipped.length} echo${unequipped.length !== 1 ? "es" : ""} — ${filterDesc}` : "Select an echo to equip…")
      .addOptions(options)
  );

  const slotName = slot === 0 ? "Main Slot" : `Sub Slot ${slot}`;

  const filterLine = filterDesc ? `\n**Filter:** ${filterDesc}` : "";

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${ELEMENT_EMOJI[element]}  Resonance Grid — ${slotName}`)
      .setDescription(
        `Grid: **${pointsExcludingSlot}** pts used (excluding this slot) / **${MAX_GRID_POINTS}** max.${filterLine}\n\n` +
        `Choose an echo for **${slotName}**. Echoes marked ⚠ would exceed the 12-point cap.` +
        (hasMore ? `\n\n*Showing 25 of ${unequipped.length} — add filters to narrow down.*` : "")
      )
      .setFooter({ text: "CARTETHYIA  ·  Resonance Grid  ·  Expires in 60s" })],
    components: [row],
  });

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter:        i => i.user.id === interaction.user.id && i.customId === "echo_equip_select",
    time:          60_000,
    max:           1,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();  // acknowledge immediately before any DB work
    const echoId = sel.values[0];
    const echo   = await prisma.echo.findUnique({ where: { id: echoId } });
    if (!echo || echo.userId !== interaction.user.id) {
      await sel.editReply({ content: "Echo not found.", components: [], embeds: [] });
      return;
    }

    const newPoints = pointsExcludingSlot + echo.cost;
    if (newPoints > MAX_GRID_POINTS) {
      await sel.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF4F6D)
          .setDescription(`⚠  **Over budget.** Equipping **${echo.name}** (${echo.cost}-cost) would use **${newPoints}/12** points.\n\nUnequip something first.`)
          .setFooter({ text: "CARTETHYIA  ·  Resonance Grid" })],
        components: [],
      });
      return;
    }

    await prisma.echo.updateMany({
      where: { userId: interaction.user.id, equippedSlot: slot, isEquipped: true },
      data:  { isEquipped: false, equippedSlot: null },
    });
    await prisma.echo.update({
      where: { id: echoId },
      data:  { isEquipped: true, equippedSlot: slot },
    });

    const slotLabel = slot === 0 ? "Main Slot" : `Sub Slot ${slot}`;
    const mainLabel = MAIN_STAT_LABELS[echo.mainStatType] ?? echo.mainStatType;
    const echoElem  = echo.element as Element;

    await sel.editReply({
      embeds: [new EmbedBuilder()
        .setColor(ELEMENT_COLORS[echoElem])
        .setTitle(`${ELEMENT_EMOJI[echoElem]}  Echo Equipped`)
        .setDescription(
          `**${echo.name}**  ${RARITY_STARS[echo.rarity]}\n` +
          `› Slotted into **${slotLabel}**\n` +
          `› Main stat: **${mainLabel}**\n` +
          `› Grid now using **${newPoints}/12** points.`
        )
        .setFooter({ text: "CARTETHYIA  ·  Resonance Grid  ·  Use /echoes to view your grid" })],
      components: [],
    });
  });

  collector?.on("end", async (collected) => {
    if (collected.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
