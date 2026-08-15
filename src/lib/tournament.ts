// src/lib/tournament.ts
// Pure bracket logic — no Discord/Prisma imports, so it's trivially testable
// in isolation. Callers (tournament.ts command, the round-transition sweep)
// own all persistence.

export interface SeededPlayer {
  userId: string;
  seed:   number;
}

export interface Pairing {
  playerAId: string;
  playerBId: string | null; // null = bye
}

/** Shuffle + assign seeds 1..N. Pure — caller persists the result. */
export function seedParticipants(userIds: string[]): SeededPlayer[] {
  const shuffled = [...userIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((userId, i) => ({ userId, seed: i + 1 }));
}

/**
 * Round-1 pairing: byes for whoever doesn't fit into a "full" bracket slot.
 *
 * P = smallest power of 2 >= n (the padded bracket size — P slots total,
 *     each either a real match or a bye advancing straight to round 2)
 * byeCount   = P - n     (how many players get a free pass to round 2)
 * matchCount = (n - byeCount) / 2 = (2n - P) / 2
 *
 * Round 2 size = byeCount + matchCount = P/2 always, whether or not n itself
 * was already a power of 2. Example n=20: P=32, byeCount=12, matchCount=4,
 * round2 = 12+4=16=P/2. Example n=8 (already a power of 2): P=8, byeCount=0,
 * matchCount=4, round2=4=P/2 — a "clean" bracket gets zero byes, as it should.
 */
export function generateFirstRoundPairings(seeded: SeededPlayer[]): Pairing[] {
  const n = seeded.length;
  if (n < 2) return [];
  const P          = Math.pow(2, Math.ceil(Math.log2(n)));
  const byeCount   = P - n;
  const matchCount = (n - byeCount) / 2;

  const byeSeeds = new Set(seeded.slice(0, byeCount).map(p => p.seed));
  const pairings: Pairing[] = [];
  const remaining = seeded.filter(p => !byeSeeds.has(p.seed)); // exactly matchCount*2 players

  for (const p of seeded.filter(p => byeSeeds.has(p.seed))) {
    pairings.push({ playerAId: p.userId, playerBId: null });
  }
  for (let i = 0; i < remaining.length; i += 2) {
    pairings.push({ playerAId: remaining[i].userId, playerBId: remaining[i + 1].userId });
  }
  return pairings;
}

/** Every later round: winners list is already a power of 2, pair sequentially. */
export function generateNextRoundPairings(winnerIds: string[]): Pairing[] {
  const pairings: Pairing[] = [];
  for (let i = 0; i < winnerIds.length; i += 2) {
    pairings.push({ playerAId: winnerIds[i], playerBId: winnerIds[i + 1] ?? null });
  }
  return pairings;
}
