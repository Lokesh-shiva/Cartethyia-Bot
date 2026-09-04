// src/commands/utility/tournament.ts
// Weekly duel tournament: signup, single-elimination bracket, tiered rewards.
// start/cancel are gated by isGuildManager() (bot owner, server owner,
// Administrator, ManageGuild, or a configured /setup manager role — same
// rule /setup itself uses), not just the bot owner. State lives entirely in
// the Tournament/TournamentParticipant/TournamentMatch tables (see
// prisma/schema.prisma) since a tournament spans days — round transitions,
// match auto-start, and deadline forfeits are all driven by
// src/lib/tournamentSweep.ts's periodic sweep, not by this file.

import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import { Command } from "../../types";
import { isGuildManager } from "../../lib/guildManagers";
import prisma from "../../lib/prisma";
import { attemptStartMatch, unpinBracketMessage, buildTournamentSignupEmbed } from "../../lib/tournamentSweep";

const MAX_PLAYERS_CEILING = 128;

// start/cancel are manager-gated (checked per-subcommand below via
// isGuildManager); status and start-match are open to everyone — a regular
// player needs to be able to check the bracket and open their own match
// without needing a manager around, so this can't be locked at the Discord
// permission level (that would hide the whole command, including status,
// from every player).
const builder = new SlashCommandBuilder()
  .setName("tournament")
  .setDescription("Run or join a weekly duel tournament.");

builder.addSubcommand(s =>
  s.setName("start")
    .setDescription("Manager only — start a new tournament's signup window.")
    .addIntegerOption(o => o.setName("signup_hours").setDescription("Signup window length in hours (default 24)").setRequired(false).setMinValue(1))
    .addIntegerOption(o => o.setName("round_hours").setDescription("Deadline per round in hours (default 48)").setRequired(false).setMinValue(1))
    .addIntegerOption(o => o.setName("max_players").setDescription("Max signups (default 32)").setRequired(false).setMinValue(2).setMaxValue(MAX_PLAYERS_CEILING))
    .addIntegerOption(o => o.setName("signup_minutes").setDescription("Testing only — overrides signup_hours with a window in minutes").setRequired(false).setMinValue(1))
);
builder.addSubcommand(s => s.setName("status").setDescription("Show the current tournament's phase and bracket."));
builder.addSubcommand(s => s.setName("cancel").setDescription("Manager only — cancel the current tournament. No rewards distributed."));
builder.addSubcommand(s => s.setName("start-match").setDescription("Open your own pending tournament match right now instead of waiting on the auto-start."));

export const data = builder as SlashCommandBuilder;

function fmtTime(d: Date): string {
  return `<t:${Math.floor(d.getTime() / 1000)}:R>`;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Tournaments can only be run in a server.", flags: 64 });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if ((sub === "start" || sub === "cancel") && !(await isGuildManager(interaction))) {
    await interaction.reply({ content: "◈ You need **Manage Server** permission or a setup manager role to use this.", flags: 64 });
    return;
  }

  await interaction.deferReply();

  const guildId = interaction.guildId;

  if (sub === "start") {
    const existing = await prisma.tournament.findFirst({
      where: { guildId, phase: { in: ["SIGNUP", "IN_PROGRESS"] } },
    });
    if (existing) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription("A tournament is already active in this server. Use `/tournament cancel` first if you want to start a new one.")],
      });
      return;
    }

    const signupHours   = interaction.options.getInteger("signup_hours")   ?? 24;
    const signupMinutes = interaction.options.getInteger("signup_minutes");
    const roundHours    = interaction.options.getInteger("round_hours")   ?? 48;
    const maxPlayers    = interaction.options.getInteger("max_players")   ?? 32;
    const signupEndsAt  = signupMinutes
      ? new Date(Date.now() + signupMinutes * 60 * 1000)
      : new Date(Date.now() + signupHours * 60 * 60 * 1000);

    const tournament = await prisma.tournament.create({
      data: {
        guildId, channelId: interaction.channelId,
        phase: "SIGNUP", maxPlayers, signupEndsAt, roundHours,
      },
    });

    // customId carries the tournament's own id (not a bare "tournament_join")
    // so the button is handled by the global interactionCreate.ts router
    // instead of a message-scoped collector — collectors live only in this
    // process's memory and die on every restart/deploy, silently breaking
    // Join mid-signup. Routing through the global handler makes it durable
    // for as long as the DB says signups are still open.
    const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tournament_join_${tournament.id}`).setLabel("⚔️  Join Tournament").setStyle(ButtonStyle.Success),
    );

    await interaction.editReply({ embeds: [buildTournamentSignupEmbed(maxPlayers, signupEndsAt, roundHours, 0)], components: [joinRow] });
    return;
  }

  if (sub === "status") {
    const tournament = await prisma.tournament.findFirst({
      where: { guildId },
      orderBy: { createdAt: "desc" },
    });
    if (!tournament) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("No tournament has ever been run in this server.")] });
      return;
    }

    if (tournament.phase === "SIGNUP") {
      const count = await prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id } });
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x6366F1)
          .setTitle("🏆  Tournament — Signups Open")
          .setDescription(
            `**Players:** ${count}/${tournament.maxPlayers}\n` +
            `**Signup closes:** ${fmtTime(tournament.signupEndsAt)}`
          )],
      });
      return;
    }

    if (tournament.phase === "IN_PROGRESS") {
      const [matches, remaining] = await Promise.all([
        prisma.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round: tournament.currentRound } }),
        prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id, eliminated: false } }),
      ]);
      const lines = matches.map(m => {
        const vs = m.playerBId ? `<@${m.playerAId}> vs <@${m.playerBId}>` : `<@${m.playerAId}> (bye)`;
        const statusLabel = m.status === "COMPLETE" ? `✅ won by <@${m.winnerId}>`
          : m.status === "FORFEIT" ? `⏱️ forfeit — <@${m.winnerId}> advances`
          : m.status === "IN_PROGRESS" ? "⚔️ in progress"
          : "⏳ pending";
        return `${vs} — ${statusLabel} (deadline ${fmtTime(m.deadlineAt)})`;
      });
      const myPendingMatch = matches.find(m =>
        m.status === "PENDING" && !m.threadId &&
        (m.playerAId === interaction.user.id || m.playerBId === interaction.user.id),
      );
      const hint = myPendingMatch
        ? `\n\n▶ Your match hasn't opened yet — run \`/tournament start-match\` to start it now instead of waiting.`
        : "";
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x6366F1)
          .setTitle(`🏆  Tournament — Round ${tournament.currentRound}`)
          .setDescription(`**Players remaining:** ${remaining}\n\n${lines.join("\n") || "*No matches this round.*"}${hint}`)],
      });
      return;
    }

    if (tournament.phase === "COMPLETED") {
      const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId: tournament.id } });
      const champion = participants.find(p => !p.eliminated);
      const maxEliminatedRound = Math.max(0, ...participants.map(p => p.eliminatedRound ?? 0));
      const runnerUp = participants.find(p => p.eliminatedRound === maxEliminatedRound);
      const semifinalists = participants.filter(p => p.eliminatedRound === maxEliminatedRound - 1);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xFCD34D)
          .setTitle("🏆  Tournament — Final Standings")
          .setDescription(
            `🥇 Champion: ${champion ? `<@${champion.userId}>` : "—"}\n` +
            `🥈 Runner-up: ${runnerUp ? `<@${runnerUp.userId}>` : "—"}\n` +
            (semifinalists.length ? `🥉 Semifinalists: ${semifinalists.map(p => `<@${p.userId}>`).join(", ")}\n` : "")
          )],
      });
      return;
    }

    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("The last tournament was cancelled.")] });
    return;
  }

  if (sub === "start-match") {
    const tournament = await prisma.tournament.findFirst({
      where: { guildId, phase: "IN_PROGRESS" },
    });
    if (!tournament) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("No tournament round is currently in progress here.")] });
      return;
    }
    const match = await prisma.tournamentMatch.findFirst({
      where: {
        tournamentId: tournament.id, round: tournament.currentRound,
        status: "PENDING", threadId: null,
        OR: [{ playerAId: interaction.user.id }, { playerBId: interaction.user.id }],
      },
    });
    if (!match) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("You don't have a pending tournament match waiting to start right now.")] });
      return;
    }
    const result = await attemptStartMatch(interaction.client, tournament, match);
    if (!result.ok) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription(`◈ Couldn't start it: ${result.reason}`)] });
      return;
    }
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4CAF50).setDescription("⚔️ Your match is opening now — check the thread that just appeared.")] });
    return;
  }

  if (sub === "cancel") {
    const tournament = await prisma.tournament.findFirst({
      where: { guildId, phase: { in: ["SIGNUP", "IN_PROGRESS"] } },
    });
    if (!tournament) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("No active tournament to cancel.")] });
      return;
    }
    await prisma.tournament.update({ where: { id: tournament.id }, data: { phase: "CANCELLED" } });
    await unpinBracketMessage(interaction.client, tournament.id);
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("◈ Tournament cancelled. No rewards distributed.")] });
    return;
  }
}

const command: Command = { data, execute };
export default command;
