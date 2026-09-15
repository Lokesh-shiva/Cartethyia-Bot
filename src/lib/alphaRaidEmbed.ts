// src/lib/alphaRaidEmbed.ts
// Shared with owner-alpharaid.ts (initial post) and interactionCreate.ts's
// global alpharaid_join_/alpharaid_begin_ handlers — same reason
// tournamentSweep.ts exports buildTournamentSignupEmbed: the embed/row need
// to be rebuildable from outside the command that originally posted them.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export function buildAlphaRaidRecruitEmbed(count: number, deadlineAt: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xFF4F4F)
    .setTitle("⚡  ALPHA RAID — A Rare Threat Has Emerged")
    .setDescription(
      `A boss far stronger than anything in the usual rotation has appeared — server-wide, everywhere the bot lives.\n\n` +
      `**Players joined:** ${count}\n` +
      `**Kill window closes:** <t:${Math.floor(deadlineAt.getTime() / 1000)}:R>\n\n` +
      `Bring your best. This one only comes around when the owner calls it — and the rewards (Fracture Keys, Radiant Keys, Fractonite) don't come from anywhere else.\n\n` +
      `Click below to join — a server admin (or the bot owner) can click **Begin** once enough players are in.`
    )
    .setFooter({ text: "CARTETHYIA  ·  Alpha Raid" });
}

export function buildAlphaRaidRecruitRow(instanceId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`alpharaid_join_${instanceId}`).setLabel("⚔️  Join Alpha Raid").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`alpharaid_begin_${instanceId}`).setLabel("▶️  Begin Fight").setStyle(ButtonStyle.Success),
  );
}
