// src/lib/tournamentSweep.ts
// Single periodic sweep drives every time-based tournament transition:
// closing signup windows, auto-starting round matches, resolving deadline
// forfeits, advancing rounds, and distributing rewards on completion.
// Deliberately NOT per-tournament setTimeout chains — those don't survive a
// bot restart, a DB-driven sweep does.

import { Client, TextChannel, EmbedBuilder } from "discord.js";
import prisma from "./prisma";
import { seedParticipants, generateFirstRoundPairings, generateNextRoundPairings } from "./tournament";
import { startDuelMatch } from "../commands/rpg/duel";
import { resolvePlayerBonuses, applyBonuses } from "./setBonus";
import { acquireLock, releaseLock } from "./combatLock";
import { awardUser } from "./economy";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // deadlines are hour-scale, 5 min polling is plenty

export function startTournamentSweep(client: Client): void {
  setInterval(() => runSweep(client).catch(err => console.error("[Tournament] sweep error:", err)), SWEEP_INTERVAL_MS);
}

async function fetchChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  return ch && ch.isTextBased() ? (ch as TextChannel) : null;
}

async function resolveFighter(userId: string) {
  const db = await prisma.user.findUnique({ where: { id: userId } });
  if (!db) return null;
  const bonuses = await resolvePlayerBonuses(userId);
  const stats = applyBonuses(db, bonuses);
  return {
    db, bonuses, stats,
    name: db.username,
    avatar: db.avatarUrl ?? "https://cdn.discordapp.com/embed/avatars/0.png",
  };
}

async function runSweep(client: Client): Promise<void> {
  await closeExpiredSignups(client);
  await startPendingMatches(client);
  await resolveDeadlineForfeits();
  await advanceCompletedRounds(client);
}

// ── 1. Close signup windows past their deadline ─────────────────────────────
async function closeExpiredSignups(client: Client): Promise<void> {
  const expired = await prisma.tournament.findMany({
    where: { phase: "SIGNUP", signupEndsAt: { lte: new Date() } },
  });

  for (const tournament of expired) {
    const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId: tournament.id } });
    const channel = await fetchChannel(client, tournament.channelId);

    if (participants.length < 2) {
      await prisma.tournament.update({ where: { id: tournament.id }, data: { phase: "CANCELLED" } });
      await channel?.send({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription(`◈ Tournament cancelled — only ${participants.length} player(s) signed up (need at least 2).`)],
      }).catch(() => {});
      continue;
    }

    const seeded = seedParticipants(participants.map(p => p.userId));
    for (const s of seeded) {
      await prisma.tournamentParticipant.updateMany({
        where: { tournamentId: tournament.id, userId: s.userId },
        data: { seed: s.seed },
      });
    }

    const pairings = generateFirstRoundPairings(seeded);
    const deadlineAt = new Date(Date.now() + tournament.roundHours * 60 * 60 * 1000);
    for (const pairing of pairings) {
      const isBye = pairing.playerBId === null;
      await prisma.tournamentMatch.create({
        data: {
          tournamentId: tournament.id, round: 1,
          playerAId: pairing.playerAId, playerBId: pairing.playerBId,
          status: isBye ? "COMPLETE" : "PENDING",
          winnerId: isBye ? pairing.playerAId : null,
          deadlineAt,
        },
      });
    }

    await prisma.tournament.update({ where: { id: tournament.id }, data: { phase: "IN_PROGRESS", currentRound: 1 } });

    const byes = pairings.filter(p => p.playerBId === null).length;
    const matches = pairings.length - byes;
    await channel?.send({
      embeds: [new EmbedBuilder().setColor(0x6366F1)
        .setTitle("🏆  Tournament — Round 1")
        .setDescription(
          `Signups closed with **${participants.length}** players.\n` +
          `**${matches}** match${matches === 1 ? "" : "es"} this round` +
          (byes > 0 ? `, **${byes}** bye${byes === 1 ? "" : "s"} advancing automatically.` : ".") +
          `\n\nMatches will auto-start shortly — check \`/tournament status\`.`
        )],
    }).catch(() => {});
  }
}

// ── 2. Auto-start any pending, non-bye match that hasn't opened a thread ────
async function startPendingMatches(client: Client): Promise<void> {
  const tournaments = await prisma.tournament.findMany({ where: { phase: "IN_PROGRESS" } });

  for (const tournament of tournaments) {
    const pending = await prisma.tournamentMatch.findMany({
      where: {
        tournamentId: tournament.id, round: tournament.currentRound,
        status: "PENDING", playerBId: { not: null }, threadId: null,
      },
    });

    for (const match of pending) {
      const playerAId = match.playerAId;
      const playerBId = match.playerBId as string;

      if (!acquireLock(playerAId, "Tournament")) continue;
      if (!acquireLock(playerBId, "Tournament")) { releaseLock(playerAId); continue; }

      const [a, b] = await Promise.all([resolveFighter(playerAId), resolveFighter(playerBId)]);
      if (!a || !b) {
        releaseLock(playerAId); releaseLock(playerBId);
        continue; // one side never started the bot — retry next sweep, deadline forfeit eventually catches it
      }

      const channel = await fetchChannel(client, tournament.channelId);
      if (!channel) { releaseLock(playerAId); releaseLock(playerBId); continue; }

      await channel.send({ content: `<@${playerAId}> <@${playerBId}> your tournament match is starting!` }).catch(() => {});

      startDuelMatch(
        playerAId, playerBId, true,
        a.db, b.db, a.bonuses, b.bonuses, a.stats, b.stats,
        a.name, b.name, a.avatar, b.avatar,
        tournament.guildId, channel,
        async (payload: any) => channel.send(payload).catch(() => {}),
        async (winnerId, threadId) => {
          if (!winnerId) return; // shouldn't happen — deadline forfeit sweep is the fallback net
          const loserId = winnerId === playerAId ? playerBId : playerAId;
          await prisma.tournamentMatch.update({
            where: { id: match.id },
            data: { status: "COMPLETE", winnerId, threadId },
          }).catch(() => {});
          await prisma.tournamentParticipant.updateMany({
            where: { tournamentId: tournament.id, userId: loserId },
            data: { eliminated: true, eliminatedRound: tournament.currentRound },
          }).catch(() => {});
        },
        (threadId) => {
          prisma.tournamentMatch.update({ where: { id: match.id }, data: { status: "IN_PROGRESS", threadId } }).catch(() => {});
        },
      ).catch(err => console.error("[Tournament] startDuelMatch error:", err));
    }
  }
}

// ── 3. Resolve matches whose round deadline has passed unresolved ──────────
async function resolveDeadlineForfeits(): Promise<void> {
  const overdue = await prisma.tournamentMatch.findMany({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] }, deadlineAt: { lte: new Date() } },
  });

  for (const match of overdue) {
    if (!match.playerBId) continue; // byes are never PENDING/IN_PROGRESS

    const [pa, pb] = await Promise.all([
      prisma.tournamentParticipant.findFirst({ where: { tournamentId: match.tournamentId, userId: match.playerAId } }),
      prisma.tournamentParticipant.findFirst({ where: { tournamentId: match.tournamentId, userId: match.playerBId } }),
    ]);
    // Neither/either never finished in time — earlier seed (lower number) advances as the tiebreak.
    const winnerId = (pa?.seed ?? Infinity) <= (pb?.seed ?? Infinity) ? match.playerAId : match.playerBId;
    const loserId = winnerId === match.playerAId ? match.playerBId : match.playerAId;

    releaseLock(match.playerAId);
    releaseLock(match.playerBId);

    await prisma.tournamentMatch.update({ where: { id: match.id }, data: { status: "FORFEIT", winnerId } });
    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId: match.tournamentId, userId: loserId },
      data: { eliminated: true, eliminatedRound: match.round },
    });
  }
}

// ── 4. Once a round is fully resolved, generate the next round (or finish) ─
async function advanceCompletedRounds(client: Client): Promise<void> {
  const tournaments = await prisma.tournament.findMany({ where: { phase: "IN_PROGRESS" } });

  for (const tournament of tournaments) {
    const roundMatches = await prisma.tournamentMatch.findMany({
      where: { tournamentId: tournament.id, round: tournament.currentRound },
    });
    if (roundMatches.length === 0) continue;
    const unresolved = roundMatches.some(m => m.status === "PENDING" || m.status === "IN_PROGRESS");
    if (unresolved) continue;

    const winnerIds = roundMatches.map(m => m.winnerId).filter((id): id is string => !!id);
    const winnerParticipants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id, userId: { in: winnerIds } },
      orderBy: { seed: "asc" },
    });
    const orderedWinnerIds = winnerParticipants.map(p => p.userId);

    const channel = await fetchChannel(client, tournament.channelId);

    if (orderedWinnerIds.length <= 1) {
      await prisma.tournament.update({ where: { id: tournament.id }, data: { phase: "COMPLETED" } });
      await distributeRewards(tournament.id, orderedWinnerIds[0] ?? null, tournament.currentRound);
      await channel?.send({
        embeds: [new EmbedBuilder().setColor(0xFCD34D)
          .setTitle("🏆  Tournament Complete!")
          .setDescription(orderedWinnerIds[0]
            ? `Congratulations to <@${orderedWinnerIds[0]}> — **Tournament Champion**!\n\nRewards have been distributed. Check \`/tournament status\` for final standings.`
            : "The tournament ended with no champion.")],
      }).catch(() => {});
      continue;
    }

    const nextRound = tournament.currentRound + 1;
    const pairings = generateNextRoundPairings(orderedWinnerIds);
    const deadlineAt = new Date(Date.now() + tournament.roundHours * 60 * 60 * 1000);
    for (const pairing of pairings) {
      const isBye = pairing.playerBId === null;
      await prisma.tournamentMatch.create({
        data: {
          tournamentId: tournament.id, round: nextRound,
          playerAId: pairing.playerAId, playerBId: pairing.playerBId,
          status: isBye ? "COMPLETE" : "PENDING",
          winnerId: isBye ? pairing.playerAId : null,
          deadlineAt,
        },
      });
    }
    await prisma.tournament.update({ where: { id: tournament.id }, data: { currentRound: nextRound } });
    await channel?.send({
      embeds: [new EmbedBuilder().setColor(0x6366F1)
        .setTitle(`🏆  Tournament — Round ${nextRound}`)
        .setDescription(`${orderedWinnerIds.length} players remain. Matches auto-start shortly — check \`/tournament status\`.`)],
    }).catch(() => {});
  }
}

// ── Rewards ──────────────────────────────────────────────────────────────
const REWARDS = {
  champion:      { credits: 50_000, fractonite: 1500, radiantKeys: 5, paradoxCores: 15, stasisLocks: 15, auraPrisms: 8 },
  runnerUp:      { credits: 25_000, fractonite: 750,  radiantKeys: 3, paradoxCores: 8,  stasisLocks: 8,  auraPrisms: 4 },
  semifinalist:  { credits: 12_000, fractonite: 400,  radiantKeys: 0, paradoxCores: 3,  stasisLocks: 3 },
  participation: { credits: 1_500,  fractonite: 100 },
};

async function distributeRewards(tournamentId: string, championId: string | null, finalRound: number): Promise<void> {
  const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId } });
  const matches = await prisma.tournamentMatch.findMany({ where: { tournamentId } });

  const runnerUp = participants.find(p => p.eliminatedRound === finalRound && p.userId !== championId);
  const semifinalists = participants.filter(p => p.eliminatedRound === finalRound - 1);

  const rewarded = new Set<string>();

  if (championId) {
    await awardUser(championId, REWARDS.champion, "tournament");
    await prisma.user.update({ where: { id: championId }, data: { tournamentTitle: "Tournament Champion" } }).catch(() => {});
    rewarded.add(championId);
  }
  if (runnerUp) {
    await awardUser(runnerUp.userId, REWARDS.runnerUp, "tournament");
    await prisma.user.update({ where: { id: runnerUp.userId }, data: { tournamentTitle: "Tournament Finalist" } }).catch(() => {});
    rewarded.add(runnerUp.userId);
  }
  for (const sf of semifinalists) {
    await awardUser(sf.userId, REWARDS.semifinalist, "tournament");
    rewarded.add(sf.userId);
  }

  // Participation: everyone who played at least one non-bye match, not already rewarded above.
  const playedNonBye = new Set<string>();
  for (const m of matches) {
    if (!m.playerBId) continue; // bye — doesn't count as "played"
    playedNonBye.add(m.playerAId);
    playedNonBye.add(m.playerBId);
  }
  for (const p of participants) {
    if (rewarded.has(p.userId)) continue;
    if (!playedNonBye.has(p.userId)) continue;
    await awardUser(p.userId, REWARDS.participation, "tournament");
  }
}
