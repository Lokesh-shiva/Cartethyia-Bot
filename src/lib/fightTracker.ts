// Tracks active fight threads in the DB so they can be cleaned up on bot restart.
// Each fight registers on entry and deregisters on any exit (win/lose/flee/timeout).

import prisma from "./prisma";

export async function registerFight(userId: string, threadId: string, guildId: string, command: string): Promise<void> {
  await prisma.activeFight.upsert({
    where:  { userId },
    create: { userId, threadId, guildId, command },
    update: { threadId, guildId, command, startedAt: new Date() },
  }).catch(() => {});
}

export async function clearFight(userId: string): Promise<void> {
  await prisma.activeFight.deleteMany({ where: { userId } }).catch(() => {});
}
