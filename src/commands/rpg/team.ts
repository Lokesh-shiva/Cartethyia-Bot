// src/commands/rpg/team.ts
// New in Milestone 3.5a — lets a player choose which owned banner character
// (if any) fills their 2nd combat slot. The player's own character always
// fights turn-1 in every combat surface (unchanged) — this command only
// controls who's available to swap into. See design spec
// docs/superpowers/specs/2026-07-16-milestone3-5-per-character-loadouts-design.md §3.

import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { ELEMENT_COLORS } from "../../lib/echoes";
import { Element } from "@prisma/client";

// Only "solace" exists today — future characters add entries here, mirroring
// the same growth pattern already used by CHARACTERS in character.ts.
const BANNER_CHARACTERS: Record<string, { label: string; emoji: string }> = {
  solace: { label: "Solace", emoji: "✨" },
};

export const data = new SlashCommandBuilder()
  .setName("team")
  .setDescription("View or change your team's 2nd combat slot.")
  .addStringOption(o =>
    o.setName("ally")
      .setDescription("Which owned banner character to set as your ally (omit to just view your team)")
      .setRequired(false)
      .addChoices(
        { name: "None — solo",   value: "none"   },
        { name: "✨ Solace",     value: "solace" },
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, teamAllyCharacterId: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element] ?? 0x6366F1;
  const choice = interaction.options.getString("ally");

  // ── View-only (no `ally` option passed) ───────────────────────────────────
  if (choice === null) {
    const current = dbUser.teamAllyCharacterId;
    const currentLabel = current ? (BANNER_CHARACTERS[current]?.label ?? current) : null;
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle("◈  Your Team")
        .setDescription(
          currentLabel
            ? `**Slot 1:** Yourself\n**Slot 2:** ${currentLabel}`
            : `**Slot 1:** Yourself\n**Slot 2:** *(solo — no ally set)*`
        )
        .setFooter({ text: "CARTETHYIA  ·  Team  ·  /team ally:<name> to change" })],
    });
    return;
  }

  // ── Clear to solo ──────────────────────────────────────────────────────────
  if (choice === "none") {
    await prisma.user.update({ where: { id: interaction.user.id }, data: { teamAllyCharacterId: null } });
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription("◈ Team set to **solo** — no ally will join your fights.")
        .setFooter({ text: "CARTETHYIA  ·  Team" })],
    });
    return;
  }

  // ── Set an ally — verify ownership first ──────────────────────────────────
  const owned = await prisma.characterProgress.findUnique({
    where: { userId_characterId: { userId: interaction.user.id, characterId: choice } },
  });
  if (!owned) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setDescription(`◈ You don't own **${BANNER_CHARACTERS[choice]?.label ?? choice}** yet.`)
        .setFooter({ text: "CARTETHYIA  ·  Team" })],
    });
    return;
  }

  await prisma.user.update({ where: { id: interaction.user.id }, data: { teamAllyCharacterId: choice } });
  const label = BANNER_CHARACTERS[choice]?.label ?? choice;
  const emoji = BANNER_CHARACTERS[choice]?.emoji ?? "◈";
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setDescription(`${emoji} **${label}** is now your team's 2nd slot — she'll be available to swap into during fights.`)
      .setFooter({ text: "CARTETHYIA  ·  Team" })],
  });
}
