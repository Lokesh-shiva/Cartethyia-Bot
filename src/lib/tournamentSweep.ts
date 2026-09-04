// src/lib/tournamentSweep.ts
// Single periodic sweep drives every time-based tournament transition:
// closing signup windows, auto-starting round matches, resolving deadline
// forfeits, advancing rounds, and distributing rewards on completion.
// Deliberately NOT per-tournament setTimeout chains — those don't survive a
// bot restart, a DB-driven sweep does.

import { Client, TextChannel, EmbedBuilder, AttachmentBuilder } from "discord.js";
import prisma from "./prisma";
import { seedParticipants, generateFirstRoundPairings, generateNextRoundPairings } from "./tournament";
import { startDuelMatch } from "../commands/rpg/duel";
import { resolvePlayerBonuses, applyBonuses } from "./setBonus";
import { acquireLock, releaseLock } from "./combatLock";
import { awardUser } from "./economy";
import { generateTournamentBracketCard, BracketRound, BracketMatch } from "./tournamentBracketCard";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // deadlines are hour-scale, 5 min polling is plenty

function fmtTime(d: Date): string {
  return `<t:${Math.floor(d.getTime() / 1000)}:R>`;
}

// Shared with interactionCreate.ts's global tournament_join_<id> handler —
// the signup embed used to be rebuilt inline by a message-scoped button
// collector in tournament.ts, which died on every bot restart/deploy
// (mid-signup joins would silently stop working). Routing the button
// through the global interaction handler instead needs this embed builder
// to be callable from outside the /tournament command's own execute().
export function buildTournamentSignupEmbed(maxPlayers: number, signupEndsAt: Date, roundHours: number, count: number) {
  return new EmbedBuilder()
    .setColor(0x6366F1)
    .setTitle("🏆  Weekly Duel Tournament — Signups Open")
    .setDescription(
      `Single-elimination bracket. Real interactive \`/duel\` matches, round by round.\n\n` +
      `**Players:** ${count}/${maxPlayers}\n` +
      `**Signup closes:** ${fmtTime(signupEndsAt)}\n\n` +
      `Once signup closes, matches open automatically within a few minutes (or use \`/tournament start-match\` to open yours immediately). ` +
      `Each match then plays out like a normal \`/duel\` — **10 minutes per turn**, so be ready to actually play once it opens, not just show up sometime in the next ${roundHours}h. ` +
      `That ${roundHours}h window is a safety net for stuck/failed starts, not free time.\n\n` +
      `**Rewards:** Champion, Runner-up, Semifinalists, and Participation tiers — ` +
      `Credits, Fractonite, Radiant Keys, Paradox Cores, Stasis Locks, Aura Prisms, and a permanent profile title for the top two.\n\n` +
      `Click below to join!`
    )
    .setFooter({ text: "CARTETHYIA  ·  Tournament" });
}

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

// ── Bracket visual: render + post/edit the single pinned bracket message ───
export async function updateBracketMessage(client: Client, tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) return;

  const matches = await prisma.tournamentMatch.findMany({
    where: { tournamentId, round: { lte: tournament.currentRound } },
    orderBy: [{ round: "asc" }, { id: "asc" }],
  });
  if (matches.length === 0) return;

  const userIds = Array.from(new Set(matches.flatMap(m => [m.playerAId, m.playerBId]).filter((id): id is string => !!id)));
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const elementById = new Map(users.map(u => [u.id, u.element as string]));

  const guild = await client.guilds.fetch(tournament.guildId).catch(() => null);
  const nameById = new Map<string, string>();
  if (guild) {
    const members = await guild.members.fetch({ user: userIds }).catch(() => null);
    if (members) for (const [id, member] of members) nameById.set(id, member.displayName);
  }
  const displayName = (id: string) => nameById.get(id) ?? users.find(u => u.id === id)?.username ?? "Unknown";

  const maxRound = Math.max(...matches.map(m => m.round));
  const rounds: BracketRound[] = [];
  for (let r = 1; r <= maxRound; r++) {
    const roundMatches = matches.filter(m => m.round === r).sort((x, y) => x.playerAId.localeCompare(y.playerAId) || 0);
    const bracketMatches: BracketMatch[] = roundMatches.map(m => {
      const aName = displayName(m.playerAId);
      const aElement = elementById.get(m.playerAId) ?? null;
      if (!m.playerBId) {
        return { a: { name: aName, element: aElement, isWinner: true }, b: null, resolved: true };
      }
      const bName = displayName(m.playerBId);
      const bElement = elementById.get(m.playerBId) ?? null;
      const resolved = m.status === "COMPLETE" || m.status === "FORFEIT";
      return {
        a: { name: aName, element: aElement, isWinner: resolved ? m.winnerId === m.playerAId : true },
        b: { name: bName, element: bElement, isWinner: resolved ? m.winnerId === m.playerBId : true },
        resolved,
      };
    });
    rounds.push({ matches: bracketMatches });
  }

  let champion: { name: string; element: string } | null = null;
  if (tournament.phase === "COMPLETED") {
    const lastRound = rounds[rounds.length - 1];
    const lastMatch = lastRound?.matches[0];
    const winner = lastMatch ? (lastMatch.a.isWinner ? lastMatch.a : lastMatch.b) : null;
    if (winner?.name) champion = { name: winner.name, element: winner.element ?? "NONE" };
  }

  const buffer = await generateTournamentBracketCard(rounds, champion);
  const attachment = new AttachmentBuilder(buffer, { name: "bracket.webp" });

  const channel = await fetchChannel(client, tournament.channelId);
  if (!channel) return;

  if (tournament.bracketMessageId) {
    const existing = await channel.messages.fetch(tournament.bracketMessageId).catch(() => null);
    if (existing) {
      await existing.edit({ files: [attachment] }).catch(() => {});
      return;
    }
  }

  const posted = await channel.send({ content: "🏆 **Tournament Bracket**", files: [attachment] }).catch(() => null);
  if (!posted) return;
  await prisma.tournament.update({ where: { id: tournamentId }, data: { bracketMessageId: posted.id } }).catch(() => {});
  await posted.pin().catch(() => {});
}

export async function unpinBracketMessage(client: Client, tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament?.bracketMessageId) return;
  const channel = await fetchChannel(client, tournament.channelId);
  const msg = await channel?.messages.fetch(tournament.bracketMessageId).catch(() => null);
  await msg?.unpin().catch(() => {});
}

async function runSweep(client: Client): Promise<void> {
  await closeExpiredSignups(client);
  await startPendingMatches(client);
  await resolveDeadlineForfeits(client);
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
    await updateBracketMessage(client, tournament.id);

    const byes = pairings.filter(p => p.playerBId === null).length;
    const matches = pairings.length - byes;
    await channel?.send({
      embeds: [new EmbedBuilder().setColor(0x6366F1)
        .setTitle("🏆  Tournament — Round 1")
        .setDescription(
          `Signups closed with **${participants.length}** players.\n` +
          `**${matches}** match${matches === 1 ? "" : "es"} this round` +
          (byes > 0 ? `, **${byes}** bye${byes === 1 ? "" : "s"} advancing automatically.` : ".") +
          `\n\nMatches open automatically within a few minutes — or use \`/tournament start-match\` to open yours right away. ` +
          `Once it opens it plays like a normal \`/duel\`: **10 minutes per turn**, so be ready to play it out.`
        )],
    }).catch(() => {});
  }
}

// ── 2. Auto-start any pending, non-bye match that hasn't opened a thread ────
// Exported so a player can trigger their own match immediately via
// /tournament start-match instead of waiting on the next sweep tick (up to
// 5 minutes) — same logic either way, just who/when calls it differs.
export async function attemptStartMatch(
  client: Client,
  tournament: { id: string; guildId: string; channelId: string; currentRound: number },
  match: { id: string; playerAId: string; playerBId: string | null },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const playerAId = match.playerAId;
  const playerBId = match.playerBId;
  if (!playerBId) return { ok: false, reason: "This is a bye — nothing to start." };

  if (!acquireLock(playerAId, "Tournament")) return { ok: false, reason: "One of you is already in another fight — try again in a bit." };
  if (!acquireLock(playerBId, "Tournament")) { releaseLock(playerAId); return { ok: false, reason: "One of you is already in another fight — try again in a bit." }; }

  const [a, b] = await Promise.all([resolveFighter(playerAId), resolveFighter(playerBId)]);
  if (!a || !b) {
    releaseLock(playerAId); releaseLock(playerBId);
    return { ok: false, reason: "One side hasn't started their CARTETHYIA journey yet (`/start`)." };
  }

  const channel = await fetchChannel(client, tournament.channelId);
  if (!channel) return { ok: false, reason: "Couldn't reach the tournament's channel." };

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
      await updateBracketMessage(client, tournament.id);
    },
    (threadId) => {
      prisma.tournamentMatch.update({ where: { id: match.id }, data: { status: "IN_PROGRESS", threadId } }).catch(() => {});
    },
  ).catch(err => console.error("[Tournament] startDuelMatch error:", err));

  return { ok: true };
}

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
      await attemptStartMatch(client, tournament, match);
    }
  }
}

// ── 3. Resolve matches whose round deadline has passed unresolved ──────────
async function resolveDeadlineForfeits(client: Client): Promise<void> {
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
    await updateBracketMessage(client, match.tournamentId);
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
      await updateBracketMessage(client, tournament.id);
      await unpinBracketMessage(client, tournament.id);
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
    await updateBracketMessage(client, tournament.id);
    await channel?.send({
      embeds: [new EmbedBuilder().setColor(0x6366F1)
        .setTitle(`🏆  Tournament — Round ${nextRound}`)
        .setDescription(`${orderedWinnerIds.length} players remain. Matches open automatically within a few minutes — or use \`/tournament start-match\` to open yours right away. Once it opens it's a normal \`/duel\`: 10 minutes per turn.`)],
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
