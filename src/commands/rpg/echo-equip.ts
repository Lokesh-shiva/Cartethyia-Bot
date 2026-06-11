import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import {
  ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS, MAIN_STAT_LABELS, SUBSTAT_LABELS,
  calcMainStatValue, calcSubstatValue, formatStatValue,
} from "../../lib/echoes";
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
const CLEAR_VALUE     = "__clear__";

// ── Helpers ───────────────────────────────────────────────────────────────────

function echoBlock(e: any | null, label: string): string {
  if (!e) return `**${label}**\n*Empty — nothing equipped here.*`;

  const lines: string[] = [];
  lines.push(`**${label}**`);
  lines.push(`**${e.name}**  ${RARITY_STARS[e.rarity]}`);
  lines.push(`Lv${e.level}  ·  ${e.cost}-cost  ·  ${ELEMENT_EMOJI[e.element as Element]} ${e.element}`);

  const mainVal = calcMainStatValue(e.mainStatType, e.level, e.rarity);
  lines.push(`\`${MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType}: ${formatStatValue(e.mainStatType, mainVal)}\``);

  const subs = [
    [e.substat1Type, e.substat1Value],
    [e.substat2Type, e.substat2Value],
    [e.substat3Type, e.substat3Value],
    [e.substat4Type, e.substat4Value],
    [e.substat5Type, e.substat5Value],
  ].filter(([t], i) => t && i < (e.revealedSubstats ?? 0)) as [string, number][];

  if (subs.length > 0) {
    lines.push("");
    for (const [t, v] of subs) {
      const scaled = calcSubstatValue(t, v, e.level);
      lines.push(`  ${SUBSTAT_LABELS[t] ?? t}: ${formatStatValue(t, scaled)}`);
    }
  } else {
    lines.push("*No substats revealed yet*");
  }

  return lines.join("\n");
}

// ── Command ───────────────────────────────────────────────────────────────────

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
  const slotName = slot === 0 ? "Main Slot" : `Sub Slot ${slot}`;

  // ── Fetch current occupant of this slot ──────────────────────────────────
  const currentEcho = await prisma.echo.findFirst({
    where: { userId: interaction.user.id, isEquipped: true, equippedSlot: slot },
  });

  // ── Fetch all equipped (for point budget) ────────────────────────────────
  const allEquipped = await prisma.echo.findMany({
    where:  { userId: interaction.user.id, isEquipped: true },
    select: { cost: true, equippedSlot: true },
  });
  const pointsExcludingSlot = allEquipped
    .filter(e => e.equippedSlot !== slot)
    .reduce((sum, e) => sum + e.cost, 0);

  // ── Fetch unequipped echoes ───────────────────────────────────────────────
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

  // ── Build select menu ─────────────────────────────────────────────────────
  const buildSelectMenu = () => {
    const opts: { label: string; description: string; value: string; emoji?: string }[] = [];

    if (currentEcho) {
      opts.push({
        label:       `✕  Clear slot — unequip ${(currentEcho.name).slice(0, 40)}`,
        description: `Remove the current echo from ${slotName}`,
        value:       CLEAR_VALUE,
        emoji:       "🗑️",
      });
    }

    const shown   = unequipped.slice(0, currentEcho ? 24 : 25);
    const hasMore = unequipped.length > shown.length;

    for (const e of shown) {
      const pts        = pointsExcludingSlot + e.cost;
      const overBudget = pts > MAX_GRID_POINTS;
      const mainVal    = calcMainStatValue(e.mainStatType, e.level, e.rarity);
      const mainLabel  = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
      opts.push({
        label:       `${e.name}  ${RARITY_STARS[e.rarity]}  Lv${e.level}  (${e.cost}-cost)${overBudget ? "  ⚠" : ""}`,
        description: `${mainLabel}: ${formatStatValue(e.mainStatType, mainVal)}  ·  ${ELEMENT_EMOJI[e.element as Element]} ${e.element}${overBudget ? "  — would exceed 12pt" : ""}`,
        value:       e.id,
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("echo_equip_select")
      .setPlaceholder(
        filterDesc
          ? `${unequipped.length} echo${unequipped.length !== 1 ? "es" : ""} — ${filterDesc}`
          : `Select an echo for ${slotName}…`
      );

    for (const o of opts) {
      menu.addOptions({ label: o.label, description: o.description, value: o.value });
    }

    return { menu, hasMore, shownCount: shown.length, totalCount: unequipped.length };
  };

  const { menu, hasMore, totalCount } = buildSelectMenu();

  if (unequipped.length === 0 && !currentEcho) {
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

  const currentBlock = currentEcho
    ? `**Currently in ${slotName}:**\n${echoBlock(currentEcho, "")}\n`
    : `**${slotName} is empty.**\n`;

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${ELEMENT_EMOJI[element]}  Resonance Grid — ${slotName}`)
      .setDescription(
        `${currentBlock}\n` +
        `Grid: **${pointsExcludingSlot}** pts used (excl. this slot) / **${MAX_GRID_POINTS}** max.\n\n` +
        `Choose an echo below to swap into **${slotName}**.` +
        (hasMore ? `\n\n*Showing 25 of ${totalCount} — add filters to narrow down.*` : "")
      )
      .setFooter({ text: "CARTETHYIA  ·  Resonance Grid  ·  Expires in 90s" })],
    components: [row],
  });

  // ── Select collector ───────────────────────────────────────────────────────
  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter:        i => i.user.id === interaction.user.id && i.customId === "echo_equip_select",
    time:          90_000,
    max:           1,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    try { await sel.deferUpdate(); } catch (err: any) { if (err?.code === 10062) return; throw err; }

    const chosen = sel.values[0];

    // ── Clear slot branch ────────────────────────────────────────────────────
    if (chosen === CLEAR_VALUE) {
      if (!currentEcho) {
        await sel.editReply({ embeds: [new EmbedBuilder().setColor(0x334155).setDescription(`${slotName} is already empty.`)], components: [] });
        return;
      }

      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("clear_confirm").setLabel("Unequip").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("clear_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      );

      await sel.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF4F6D)
          .setTitle(`🗑️  Unequip — ${slotName}`)
          .setDescription(echoBlock(currentEcho, "Removing from slot"))
          .setFooter({ text: "CARTETHYIA  ·  Resonance Grid  ·  This will free the slot" })],
        components: [confirmRow],
      });

      const btnCol = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && ["clear_confirm", "clear_cancel"].includes(i.customId),
        time: 30_000, max: 1,
      });

      btnCol?.on("collect", async btn => {
        try { await btn.deferUpdate(); } catch { return; }
        if (btn.customId === "clear_confirm") {
          await prisma.echo.update({ where: { id: currentEcho.id }, data: { isEquipped: false, equippedSlot: null } });
          await btn.editReply({
            embeds: [new EmbedBuilder().setColor(color)
              .setTitle(`◈  Slot Cleared — ${slotName}`)
              .setDescription(`**${currentEcho.name}** has been unequipped.\nGrid now uses **${pointsExcludingSlot}/12** pts.`)
              .setFooter({ text: "CARTETHYIA  ·  Resonance Grid" })],
            components: [],
          });
        } else {
          await btn.editReply({
            embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")],
            components: [],
          });
        }
      });

      btnCol?.on("end", async (col) => {
        if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
      });

      return;
    }

    // ── Normal equip branch ──────────────────────────────────────────────────
    const incoming = await prisma.echo.findUnique({ where: { id: chosen } });
    if (!incoming || incoming.userId !== interaction.user.id) {
      await sel.editReply({ content: "Echo not found.", components: [], embeds: [] });
      return;
    }

    const newPoints = pointsExcludingSlot + incoming.cost;
    if (newPoints > MAX_GRID_POINTS) {
      await sel.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF4F6D)
          .setDescription(`⚠  **Over budget.** Equipping **${incoming.name}** (${incoming.cost}-cost) would use **${newPoints}/12** points.\n\nUnequip something first.`)
          .setFooter({ text: "CARTETHYIA  ·  Resonance Grid" })],
        components: [],
      });
      return;
    }

    // ── Show comparison embed ────────────────────────────────────────────────
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("equip_confirm").setLabel("Equip").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("equip_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );

    const incomingColor = ELEMENT_COLORS[incoming.element as Element];

    await sel.editReply({
      embeds: [new EmbedBuilder()
        .setColor(incomingColor)
        .setTitle(`${ELEMENT_EMOJI[element]}  Compare — ${slotName}`)
        .addFields(
          {
            name:   `◈ Current`,
            value:  currentEcho ? echoBlock(currentEcho, "") : "*Empty slot*",
            inline: true,
          },
          {
            name:   `✦ Incoming`,
            value:  echoBlock(incoming, ""),
            inline: true,
          },
          {
            name:   "Grid Budget",
            value:  currentEcho
              ? `${pointsExcludingSlot + currentEcho.cost}/12 pts  →  **${newPoints}/12 pts**`
              : `${pointsExcludingSlot}/12 pts  →  **${newPoints}/12 pts**`,
            inline: false,
          }
        )
        .setFooter({ text: "CARTETHYIA  ·  Resonance Grid  ·  Confirm to swap" })],
      components: [confirmRow],
    });

    // ── Button collector ─────────────────────────────────────────────────────
    const btnCol = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.user.id === interaction.user.id && ["equip_confirm", "equip_cancel"].includes(i.customId),
      time: 30_000, max: 1,
    });

    btnCol?.on("collect", async btn => {
      try { await btn.deferUpdate(); } catch { return; }

      if (btn.customId === "equip_confirm") {
        await prisma.echo.updateMany({
          where: { userId: interaction.user.id, equippedSlot: slot, isEquipped: true },
          data:  { isEquipped: false, equippedSlot: null },
        });
        await prisma.echo.update({
          where: { id: incoming.id },
          data:  { isEquipped: true, equippedSlot: slot },
        });

        const mainVal   = calcMainStatValue(incoming.mainStatType, incoming.level, incoming.rarity);
        const mainLabel = MAIN_STAT_LABELS[incoming.mainStatType] ?? incoming.mainStatType;

        await btn.editReply({
          embeds: [new EmbedBuilder()
            .setColor(incomingColor)
            .setTitle(`${ELEMENT_EMOJI[incoming.element as Element]}  Echo Equipped`)
            .setDescription([
              `**${incoming.name}**  ${RARITY_STARS[incoming.rarity]}`,
              `› Slotted into **${slotName}**`,
              `› Main stat: **${mainLabel}: ${formatStatValue(incoming.mainStatType, mainVal)}**`,
              `› Grid now using **${newPoints}/12** points.`,
              currentEcho ? `\n◈ Replaced: **${currentEcho.name}**  (moved to inventory)` : "",
            ].filter(Boolean).join("\n"))
            .setFooter({ text: "CARTETHYIA  ·  Resonance Grid  ·  Use /echoes to view your grid" })],
          components: [],
        });
      } else {
        await btn.editReply({
          embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")],
          components: [],
        });
      }
    });

    btnCol?.on("end", async (col) => {
      if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
    });
  });

  collector?.on("end", async (collected) => {
    if (collected.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
