// src/commands/rpg/team.ts
// Lets a player choose which owned banner character (if any) fills their 2nd
// combat slot. The player's own character always fights turn-1 in every
// combat surface (unchanged) — this command only controls who's available to
// swap into. See design spec
// docs/superpowers/specs/2026-07-16-milestone3-5-per-character-loadouts-design.md §3.
//
// Rebuilt as a menu over CHARACTER_KITS + the player's own characterProgress
// rows, instead of a hardcoded slash-command choices list — adding a future
// character no longer requires a redeploy for this command to see it.

import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction,
  ComponentType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { ELEMENT_COLORS } from "../../lib/echoes";
import { Element } from "@prisma/client";
import { CHARACTER_KITS } from "../../lib/characterKit";
import "../../lib/kits";

export const data = new SlashCommandBuilder()
  .setName("team")
  .setDescription("Choose which owned character fills your team's 2nd combat slot.");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, teamAllyCharacterId: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element] ?? 0x6366F1;

  const ownedProgress = await prisma.characterProgress.findMany({
    where:  { userId: interaction.user.id },
    select: { characterId: true },
  });
  const ownedIds = ownedProgress
    .map(p => p.characterId)
    .filter(id => CHARACTER_KITS[id] !== undefined);

  const currentId = dbUser.teamAllyCharacterId;
  const currentKit = currentId ? CHARACTER_KITS[currentId] : null;

  if (ownedIds.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle("◈  Your Team")
        .setDescription(
          `**Slot 1:** Yourself\n**Slot 2:** *(solo — you don't own any banner characters yet)*`
        )
        .setFooter({ text: "CARTETHYIA  ·  Team" })],
    });
    return;
  }

  const options = [
    { label: "None — solo", description: "No ally will join your fights", value: "none", emoji: "🚫" },
    ...ownedIds.map(id => {
      const kit = CHARACTER_KITS[id];
      return { label: `${kit.label}  ${"★".repeat(kit.rarity)}`, description: `${kit.rarity}★ ${kit.element} — set as your team's 2nd slot`, value: id, emoji: kit.emoji };
    }),
  ];

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("team_select")
      .setPlaceholder(currentKit ? `Current: ${currentKit.label}` : "Current: solo — no ally set")
      .addOptions(options),
  );

  const msg = await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle("◈  Your Team")
      .setDescription(
        currentKit
          ? `**Slot 1:** Yourself\n**Slot 2:** ${currentKit.emoji} ${currentKit.label}\n\nPick below to change.`
          : `**Slot 1:** Yourself\n**Slot 2:** *(solo — no ally set)*\n\nPick below to change.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Team  ·  Expires in 60s" })],
    components: [selectRow],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "team_select",
    time: 60_000, max: 1,
  });

  collector.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();
    const choice = sel.values[0];

    if (choice === "none") {
      await prisma.user.update({ where: { id: interaction.user.id }, data: { teamAllyCharacterId: null } });
      await sel.editReply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setDescription("◈ Team set to **solo** — no ally will join your fights.")
          .setFooter({ text: "CARTETHYIA  ·  Team" })],
        components: [],
      });
      return;
    }

    const kit = CHARACTER_KITS[choice];
    if (!kit || !ownedIds.includes(choice)) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D)
          .setDescription(`◈ You don't own that character.`)
          .setFooter({ text: "CARTETHYIA  ·  Team" })],
        components: [],
      });
      return;
    }

    await prisma.user.update({ where: { id: interaction.user.id }, data: { teamAllyCharacterId: choice } });
    await sel.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription(`${kit.emoji} **${kit.label}** is now your team's 2nd slot — available to swap into during fights.`)
        .setFooter({ text: "CARTETHYIA  ·  Team" })],
      components: [],
    });
  });

  collector.on("end", async (collected) => {
    if (collected.size === 0) {
      await interaction.editReply({ components: [] }).catch(() => {});
    }
  });
}
