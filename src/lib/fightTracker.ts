// Tracks active fight threads in the DB so they can be cleaned up on bot restart.
// Each fight registers on entry and deregisters on any exit (win/lose/flee/timeout).

import prisma from "./prisma";

export async function registerFight(userId: string, threadId: string, guildId: string, command: string, auraCost: number = 0): Promise<void> {
  await prisma.activeFight.upsert({
    where:  { userId },
    create: { userId, threadId, guildId, command, auraCost },
    update: { threadId, guildId, command, startedAt: new Date(), auraCost },
  }).catch(() => {});
}

// Dungeon rechallenges spend additional Aura on the SAME already-registered
// fight (registerFight isn't called again per rechallenge) — accumulate the
// total so a mid-session restart refunds everything actually spent, not just
// the first run's cost.
export async function addFightAuraCost(userId: string, extraCost: number): Promise<void> {
  await prisma.activeFight.update({
    where: { userId },
    data:  { auraCost: { increment: extraCost } },
  }).catch(() => {});
}

export async function clearFight(userId: string): Promise<void> {
  await prisma.activeFight.deleteMany({ where: { userId } }).catch(() => {});
}
