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
import { weaponDismantleValue } from "../../lib/weapons";
import { ELEMENT_COLORS } from "../../lib/echoes";
import { CE } from "../../lib/emojiManager";
import { Element } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("weapon-discard")
  .setDescription("Dismantle unwanted weapons for Forging Ores.")
  .addIntegerOption(o =>
    o.setName("rarity")
      .setDescription("Bulk mode: only discard weapons of this rarity")
      .setRequired(false)
      .addChoices(
        { name: "1★", value: 1 },
        { name: "2★", value: 2 },
        { name: "3★", value: 3 },
      )
  )
  .addIntegerOption(o =>
    o.setName("max-level")
      .setDescription("Bulk mode: only discard weapons at or below this level (avoids nuking invested weapons)")
      .setRequired(false)
      .setMinValue(1)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element];

  const rarity   = interaction.options.getInteger("rarity");
  const maxLevel = interaction.options.getInteger("max-level");
  const bulkMode = rarity !== null || maxLevel !== null;

  // Awakened weapons are excluded entirely — they represent a large, one-time,
  // irreversible investment (Ego Weapon Awakening) and shouldn't be scrappable.
  const where: any = { userId: interaction.user.id, isEquipped: false, awakened: false };
  if (rarity)             where.rarity = rarity;
  if (maxLevel !== null)  where.level  = { lte: maxLevel };

  const candidates = await prisma.weapon.findMany({ where, orderBy: [{ rarity: "asc" }, { level: "asc" }] });

  if (candidates.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(bulkMode
          ? "No unequipped, non-awakened weapons match those filters."
          : "You have no unequipped, non-awakened weapons to discard. (Equipped or Awakened weapons can't be dismantled.)")
        .setFooter({ text: "CARTETHYIA  ·  Weapon Discard" })],
    });
    return;
  }

  // ── Bulk mode ─────────────────────────────────────────────────────────────────
  if (bulkMode) {
    const totalValue = candidates.reduce((s, w) => s + weaponDismantleValue(w.rarity, w.level), 0);
    const filterDesc = [
      rarity ? `${rarity}★` : null,
      maxLevel !== null ? `Lv≤${maxLevel}` : null,
    ].filter(Boolean).join("  ·  ");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("wdiscard_confirm").setLabel(`Dismantle ${candidates.length}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("wdiscard_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );

    const msg = await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setTitle("⚠️  Bulk Discard — Confirm")
        .setDescription(
          `Filters: **${filterDesc}**\n\n` +
          `This will permanently dismantle **${candidates.length} weapon${candidates.length === 1 ? "" : "s"}** for a total of **${totalValue} ${CE.fo} Forging Ores**.\n\n` +
          `**This cannot be undone.**`
        )
        .setFooter({ text: "CARTETHYIA  ·  Weapon Discard  ·  Expires in 30s" })],
      components: [row],
    });

    const btn = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i: ButtonInteraction) => i.user.id === interaction.user.id,
      time: 30_000,
    }).catch(() => null);

    if (!btn || btn.customId === "wdiscard_cancel") {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")], components: [] }).catch(() => {});
      return;
    }
    await btn.deferUpdate();

    const fresh = await prisma.weapon.findMany({ where, orderBy: [{ rarity: "asc" }, { level: "asc" }] });
    const freshValue = fresh.reduce((s, w) => s + weaponDismantleValue(w.rarity, w.level), 0);

    await prisma.$transaction([
      prisma.weapon.deleteMany({ where: { id: { in: fresh.map(w => w.id) } } }),
      prisma.user.update({ where: { id: interaction.user.id }, data: { forgingOres: { increment: freshValue } } }),
    ]);
    invalidateBonusCache(interaction.user.id);
    await auditAward(interaction.user.id, { forgingOres: freshValue }, "weapon-discard-bulk");

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Dismantled **${fresh.length} weapon${fresh.length === 1 ? "" : "s"}** for **${freshValue} ${CE.fo} Forging Ores**.`)
        .setFooter({ text: "CARTETHYIA  ·  Weapon Discard" })],
      components: [],
    });
    return;
  }

  // ── Single mode ───────────────────────────────────────────────────────────────
  const shown = candidates.slice(0, 25);
  const options = shown.map(w => {
    const value = weaponDismantleValue(w.rarity, w.level);
    return {
      label:       `${w.name}  ${"★".repeat(w.rarity)}  Lv${w.level}`,
      description: `Dismantle for ${value} ${CE.fo} Forging Ores`,
      value:       w.id,
    };
  });

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("weapon_discard_select")
      .setPlaceholder("Select an unequipped weapon to dismantle…")
      .addOptions(options)
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(color)
      .setTitle(`⚔️  Weapon Discard`)
      .setDescription("Dismantle an unequipped, non-awakened weapon for Forging Ores.\n\nUse `rarity`/`max-level` options for bulk discard.")
      .setFooter({ text: "CARTETHYIA  ·  Weapon Discard  ·  Expires in 60s" })],
    components: [row],
  });

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "weapon_discard_select",
    time:   60_000,
    max:    1,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();
    const weapon = await prisma.weapon.findUnique({ where: { id: sel.values[0] } });
    if (!weapon || weapon.userId !== interaction.user.id) {
      await sel.editReply({ content: "Weapon not found.", components: [], embeds: [] });
      return;
    }
    if (weapon.isEquipped) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription(`**${weapon.name}** is currently equipped — unequip it first via \`/equip\`.`)],
        components: [],
      });
      return;
    }
    if (weapon.awakened) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription(`**${weapon.awakenedName ?? weapon.name}** is Awakened and can't be dismantled.`)],
        components: [],
      });
      return;
    }

    const value = weaponDismantleValue(weapon.rarity, weapon.level);
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("wdiscard_confirm").setLabel(`Dismantle for ${value} FO`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("wdiscard_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );
    const confirmMsg = await sel.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setDescription(`Dismantle **${weapon.name}** ${"★".repeat(weapon.rarity)} Lv${weapon.level} for **${value} ${CE.fo} Forging Ores**?\n\n**This cannot be undone.**`)
        .setFooter({ text: "CARTETHYIA  ·  Weapon Discard  ·  Expires in 30s" })],
      components: [confirmRow],
    });

    const btn = await confirmMsg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i: ButtonInteraction) => i.user.id === interaction.user.id,
      time: 30_000,
    }).catch(() => null);

    if (!btn || btn.customId === "wdiscard_cancel") {
      await sel.editReply({ embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")], components: [] }).catch(() => {});
      return;
    }
    await btn.deferUpdate();

    const stillExists = await prisma.weapon.findUnique({ where: { id: weapon.id } });
    if (!stillExists || stillExists.isEquipped || stillExists.awakened) {
      await sel.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("That weapon changed state — please try again.")], components: [] });
      return;
    }

    await prisma.$transaction([
      prisma.weapon.delete({ where: { id: weapon.id } }),
      prisma.user.update({ where: { id: interaction.user.id }, data: { forgingOres: { increment: value } } }),
    ]);
    invalidateBonusCache(interaction.user.id);
    await auditAward(interaction.user.id, { forgingOres: value }, "weapon-discard");

    await sel.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Dismantled **${weapon.name}** for **${value} ${CE.fo} Forging Ores**.`)
        .setFooter({ text: "CARTETHYIA  ·  Weapon Discard" })],
      components: [],
    });
  });

  collector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
