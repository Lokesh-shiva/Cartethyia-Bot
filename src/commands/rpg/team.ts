// src/commands/rpg/team.ts
// Lets a player set their 3-position combat roster: Position 1/2/3, each
// either "Yourself" or an owned character. Filling a position is both
// roster membership AND turn/KO-fallback order in one action — no separate
// ordering step. See design spec
// docs/superpowers/specs/2026-07-31-three-slot-team-design.md.
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
import { resolveRoster, positionLabel, ResolvedRoster, PositionIndex } from "../../lib/teamPositions";

export const data = new SlashCommandBuilder()
  .setName("team")
  .setDescription("Set your 3-position combat roster (yourself + up to 2 owned characters).");

function kitLabel(characterId: string): string | null {
  const kit = CHARACTER_KITS[characterId];
  return kit ? `${kit.emoji} ${kit.label}` : null;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, teamPosition1: true, teamPosition2: true, teamPosition3: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element] ?? 0x6366F1;
  const playerName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName ?? interaction.user.username;

  const ownedProgress = await prisma.characterProgress.findMany({
    where:  { userId: interaction.user.id },
    select: { characterId: true },
  });
  const ownedIds = ownedProgress
    .map(p => p.characterId)
    .filter(id => CHARACTER_KITS[id] !== undefined);

  function buildEmbedAndRows(roster: ResolvedRoster) {
    const lines = ([1, 2, 3] as PositionIndex[]).map(pos => {
      const label = positionLabel(roster, pos, playerName, kitLabel);
      return `**Position ${pos}:** ${label === "(empty)" ? "*(empty)*" : label}`;
    });

    const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = ([1, 2, 3] as PositionIndex[]).map(pos => {
      // Values occupying the OTHER two positions — excluded from this
      // position's picker options.
      const usedElsewhere = new Set<string>();
      if (pos !== 1 && roster.position1 !== null) usedElsewhere.add(roster.position1);
      if (pos !== 2 && roster.position2 !== null) usedElsewhere.add(roster.position2);
      if (pos !== 3 && roster.position3 !== null) usedElsewhere.add(roster.position3);

      const currentValue = pos === 1 ? roster.position1 : pos === 2 ? roster.position2 : roster.position3;

      const options = [
        ...(usedElsewhere.has("self") ? [] : [{ label: "Yourself", description: "Your own character", value: "self", emoji: "🧑" }]),
        ...ownedIds
          .filter(id => !usedElsewhere.has(id))
          .map(id => {
            const kit = CHARACTER_KITS[id];
            return { label: `${kit.label}  ${"★".repeat(kit.rarity)}`, description: `${kit.rarity}★ ${kit.element}`, value: id, emoji: kit.emoji };
          }),
        ...(pos === 1 ? [] : [{ label: "None — leave empty", description: "This position stays unfilled", value: "none", emoji: "🚫" }]),
      ];

      const currentLabel = currentValue === null ? "empty" : positionLabel(roster, pos, playerName, kitLabel);

      return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`team_pos${pos}`)
          .setPlaceholder(`Position ${pos}: ${currentLabel}`)
          .addOptions(options),
      );
    });

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("◈  Your Team")
      .setDescription(`${lines.join("\n")}\n\nPosition 1 fights first. On KO, the active unit falls back to the next living position in order (wrapping 1→2→3→1).\n\nPick below to change any position.`)
      .setFooter({ text: "CARTETHYIA  ·  Team  ·  Expires in 60s" });

    return { embed, rows };
  }

  if (ownedIds.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle("◈  Your Team")
        .setDescription(
          `**Position 1:** Yourself\n**Position 2:** *(empty — you don't own any banner characters yet)*\n**Position 3:** *(empty)*`
        )
        .setFooter({ text: "CARTETHYIA  ·  Team" })],
    });
    return;
  }

  let roster = resolveRoster(dbUser);
  const { embed, rows } = buildEmbedAndRows(roster);
  const msg = await interaction.editReply({ embeds: [embed], components: rows });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && /^team_pos[123]$/.test(i.customId),
    time: 60_000,
  });

  collector.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();
    const pos = Number(sel.customId.replace("team_pos", "")) as PositionIndex;
    const choice = sel.values[0];

    const newValue = choice === "none" ? null : choice;

    if (newValue !== null && newValue !== "self" && (!CHARACTER_KITS[newValue] || !ownedIds.includes(newValue))) {
      await sel.followUp({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D)
          .setDescription(`◈ You don't own that character.`)
          .setFooter({ text: "CARTETHYIA  ·  Team" })],
        flags: 64,
      });
      return;
    }

    // Guard against the same value already occupying a different position
    // (shouldn't happen given the picker excludes used values, but a stale
    // dropdown from before another position changed could race).
    const otherPositions = ([1, 2, 3] as PositionIndex[]).filter(p => p !== pos);
    const conflict = otherPositions.some(p => {
      const v = p === 1 ? roster.position1 : p === 2 ? roster.position2 : roster.position3;
      return v !== null && v === newValue;
    });
    if (conflict) {
      await sel.followUp({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D)
          .setDescription(`◈ That's already occupying another position — refresh with /team and try again.`)
          .setFooter({ text: "CARTETHYIA  ·  Team" })],
        flags: 64,
      });
      return;
    }

    const data: Record<string, string | null> =
      pos === 1 ? { teamPosition1: newValue ?? "self" } // position 1 must stay filled
      : pos === 2 ? { teamPosition2: newValue }
      : { teamPosition3: newValue };

    await prisma.user.update({ where: { id: interaction.user.id }, data });

    roster = {
      position1: pos === 1 ? (newValue ?? "self") : roster.position1,
      position2: pos === 2 ? newValue : roster.position2,
      position3: pos === 3 ? newValue : roster.position3,
    };

    const rebuilt = buildEmbedAndRows(roster);
    await sel.editReply({ embeds: [rebuilt.embed], components: rebuilt.rows });
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}
