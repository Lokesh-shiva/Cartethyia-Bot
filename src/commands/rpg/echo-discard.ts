import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { auditAward } from "../../lib/antiCheat";
import { invalidateBonusCache } from "../../lib/setBonus";
import {
  ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS, echoDismantleValue,
} from "../../lib/echoes";
import { CE } from "../../lib/emojiManager";
import { Element } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("echo-discard")
  .setDescription("Dismantle unwanted echoes for Tuning Modules.")
  .addStringOption(o =>
    o.setName("rarity")
      .setDescription("Bulk mode: only discard echoes of this rarity")
      .setRequired(false)
      .addChoices(
        { name: "3★", value: "THREE_STAR" },
        { name: "4★", value: "FOUR_STAR" },
        { name: "5★", value: "FIVE_STAR" },
      )
  )
  .addIntegerOption(o =>
    o.setName("cost")
      .setDescription("Bulk mode: only discard echoes of this cost")
      .setRequired(false)
      .addChoices(
        { name: "1-cost", value: 1 },
        { name: "3-cost", value: 3 },
        { name: "4-cost", value: 4 },
      )
  )
  .addIntegerOption(o =>
    o.setName("max-level")
      .setDescription("Bulk mode: only discard echoes at or below this level (avoids nuking invested echoes)")
      .setRequired(false)
      .setMinValue(0)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element];

  const rarity   = interaction.options.getString("rarity");
  const cost     = interaction.options.getInteger("cost");
  const maxLevel = interaction.options.getInteger("max-level");
  const bulkMode = rarity !== null || cost !== null || maxLevel !== null;

  const where: any = { userId: interaction.user.id, isEquipped: false };
  if (rarity)             where.rarity = rarity;
  if (cost)                where.cost  = cost;
  if (maxLevel !== null)  where.level  = { lte: maxLevel };

  const candidates = await prisma.echo.findMany({ where, orderBy: [{ rarity: "asc" }, { level: "asc" }] });

  if (candidates.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(bulkMode
          ? "No unequipped echoes match those filters."
          : "You have no unequipped echoes to discard. (Equipped echoes must be unequipped first via `/echo-equip`.)")
        .setFooter({ text: "CARTETHYIA  ·  Echo Discard" })],
    });
    return;
  }

  // ── Bulk mode: filter-driven, preview + confirm ──────────────────────────────
  if (bulkMode) {
    const totalValue = candidates.reduce((s, e) => s + echoDismantleValue(e.rarity, e.level), 0);
    const filterDesc = [
      rarity ? RARITY_STARS[rarity as keyof typeof RARITY_STARS] : null,
      cost ? `${cost}-cost` : null,
      maxLevel !== null ? `Lv≤${maxLevel}` : null,
    ].filter(Boolean).join("  ·  ");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("discard_confirm").setLabel(`Dismantle ${candidates.length}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("discard_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );

    const msg = await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setTitle("⚠️  Bulk Discard — Confirm")
        .setDescription(
          `Filters: **${filterDesc}**\n\n` +
          `This will permanently dismantle **${candidates.length} echo${candidates.length === 1 ? "" : "es"}** for a total of **${totalValue} ${CE.tm} Tuning Modules**.\n\n` +
          `**This cannot be undone.**`
        )
        .setFooter({ text: "CARTETHYIA  ·  Echo Discard  ·  Expires in 30s" })],
      components: [row],
    });

    const btn = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i: ButtonInteraction) => i.user.id === interaction.user.id,
      time: 30_000,
    }).catch(() => null);

    if (!btn || btn.customId === "discard_cancel") {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")], components: [] }).catch(() => {});
      return;
    }

    await btn.deferUpdate();

    // Re-fetch to guard against equip/level changes between preview and confirm
    const fresh = await prisma.echo.findMany({ where, orderBy: [{ rarity: "asc" }, { level: "asc" }] });
    const freshValue = fresh.reduce((s, e) => s + echoDismantleValue(e.rarity, e.level), 0);

    await prisma.$transaction([
      prisma.echo.deleteMany({ where: { id: { in: fresh.map(e => e.id) } } }),
      prisma.user.update({ where: { id: interaction.user.id }, data: { tuningModules: { increment: freshValue } } }),
    ]);
    invalidateBonusCache(interaction.user.id);
    await auditAward(interaction.user.id, { tuningModules: freshValue }, "echo-discard-bulk");

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Dismantled **${fresh.length} echo${fresh.length === 1 ? "" : "es"}** for **${freshValue} ${CE.tm} Tuning Modules**.`)
        .setFooter({ text: "CARTETHYIA  ·  Echo Discard" })],
      components: [],
    });
    return;
  }

  // ── Single mode: pick-and-confirm ────────────────────────────────────────────
  const shown = candidates.slice(0, 25);
  const options = shown.map(e => {
    const value = echoDismantleValue(e.rarity, e.level);
    return {
      label:       `${e.name}  ${RARITY_STARS[e.rarity]}  Lv${e.level}  (${e.cost}-cost)`,
      description: `Dismantle for ${value} ${CE.tm} Tuning Modules`,
      value:       e.id,
    };
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("echo_discard_select")
      .setPlaceholder("Select an unequipped echo to dismantle…")
      .addOptions(options)
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(color)
      .setTitle(`${ELEMENT_EMOJI[dbUser.element as Element]}  Echo Discard`)
      .setDescription("Dismantle an unequipped echo for Tuning Modules. Equipped echoes must be unequipped first.\n\nUse `rarity`/`cost`/`max-level` options for bulk discard.")
      .setFooter({ text: "CARTETHYIA  ·  Echo Discard  ·  Expires in 60s" })],
    components: [row],
  });

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "echo_discard_select",
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
    if (echo.isEquipped) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription(`**${echo.name}** is currently equipped — unequip it first via \`/echo-equip\`.`)],
        components: [],
      });
      return;
    }

    const value = echoDismantleValue(echo.rarity, echo.level);
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("discard_confirm").setLabel(`Dismantle for ${value} TM`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("discard_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );
    const confirmMsg = await sel.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setDescription(`Dismantle **${echo.name}** ${RARITY_STARS[echo.rarity]} Lv${echo.level} for **${value} ${CE.tm} Tuning Modules**?\n\n**This cannot be undone.**`)
        .setFooter({ text: "CARTETHYIA  ·  Echo Discard  ·  Expires in 30s" })],
      components: [confirmRow],
    });

    const btn = await confirmMsg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i: ButtonInteraction) => i.user.id === interaction.user.id,
      time: 30_000,
    }).catch(() => null);

    if (!btn || btn.customId === "discard_cancel") {
      await sel.editReply({ embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")], components: [] }).catch(() => {});
      return;
    }
    await btn.deferUpdate();

    const stillExists = await prisma.echo.findUnique({ where: { id: echo.id } });
    if (!stillExists || stillExists.isEquipped) {
      await sel.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("That echo changed state — please try again.")], components: [] });
      return;
    }

    await prisma.$transaction([
      prisma.echo.delete({ where: { id: echo.id } }),
      prisma.user.update({ where: { id: interaction.user.id }, data: { tuningModules: { increment: value } } }),
    ]);
    invalidateBonusCache(interaction.user.id);
    await auditAward(interaction.user.id, { tuningModules: value }, "echo-discard");

    await sel.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Dismantled **${echo.name}** for **${value} ${CE.tm} Tuning Modules**.`)
        .setFooter({ text: "CARTETHYIA  ·  Echo Discard" })],
      components: [],
    });
  });

  collector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
