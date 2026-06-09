import prisma from "./prisma";
import { EmbedBuilder, ChatInputCommandInteraction } from "discord.js";

/** Standard "not registered" reply for commands that require a DB user. */
export async function replyNotStarted(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x6366F1)
    .setTitle("◈  Welcome to CARTETHYIA")
    .setDescription(
      `It looks like you haven't begun your journey yet.\n\n` +
      `› Use **\`/start\`** to set up your profile and enter the world\n` +
      `› Use **\`/guide\`** to learn how everything works first\n\n` +
      `*Your resonance signature is waiting to be forged.*`
    )
    .setFooter({ text: "CARTETHYIA  ·  /start to begin" });

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed] });
  } else {
    await interaction.reply({ embeds: [embed], flags: 64 });
  }
}

/**
 * Get or create a user in the database.
 * Call this at the start of every command.
 */
export async function getOrCreateUser(discordId: string, username: string, avatarUrl?: string) {
  return prisma.user.upsert({
    where:  { id: discordId },
    update: { username, avatarUrl: avatarUrl ?? null, lastSeen: new Date() },
    create: { id: discordId, username, avatarUrl: avatarUrl ?? null },
  });
}

/**
 * Award currency or items to a user.
 */
export async function awardUser(
  userId: string,
  rewards: {
    credits?:         number;
    lunakite?:        number;
    tuningModules?:   number;
    sealingTubes?:    number;
    forgingOres?:     number;
    paradoxCores?:    number;
    stasisLocks?:     number;
    resonanceRecords?:number;
    fractureKeys?:    number;
    resonanceExp?:    number;
  }
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      credits:          { increment: rewards.credits          ?? 0 },
      lunakite:         { increment: rewards.lunakite         ?? 0 },
      tuningModules:    { increment: rewards.tuningModules    ?? 0 },
      sealingTubes:     { increment: rewards.sealingTubes     ?? 0 },
      forgingOres:      { increment: rewards.forgingOres      ?? 0 },
      paradoxCores:     { increment: rewards.paradoxCores     ?? 0 },
      stasisLocks:      { increment: rewards.stasisLocks      ?? 0 },
      resonanceRecords: { increment: rewards.resonanceRecords ?? 0 },
      fractureKeys:     { increment: rewards.fractureKeys     ?? 0 },
      resonanceExp:     { increment: rewards.resonanceExp     ?? 0 },
    },
  });
}

/**
 * Award EXP from chatting (1-minute cooldown enforced).
 * Returns the EXP awarded (0 if on cooldown).
 */
export async function tryAwardChatExp(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return 0;

  const now  = new Date();
  const diff = now.getTime() - user.lastExpGain.getTime();
  if (diff < 3_000) return 0;

  const expGain = Math.floor(Math.random() * 6) + 3; // 3–8 EXP per message
  await prisma.user.update({
    where: { id: userId },
    data:  { resonanceExp: { increment: expGain }, lastExpGain: now },
  });

  return expGain;
}

/**
 * Returns true if the user is currently on an active dispatch expedition.
 * Use this to block combat commands (/ascend, /boss, /dungeon, /field-boss, /duel).
 */
export async function isOnDispatch(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { dispatchStatus: true, dispatchEndsAt: true },
  });
  if (!user || user.dispatchStatus !== "ON_DISPATCH") return false;
  if (!user.dispatchEndsAt) return false;
  return user.dispatchEndsAt.getTime() > Date.now();
}

/**
 * Get or create the Affinity record between two users.
 * Always stores with the lower ID first to avoid duplicates.
 */
export async function getAffinity(userAId: string, userBId: string) {
  const [a, b] = [userAId, userBId].sort();
  return prisma.affinity.upsert({
    where:  { userAId_userBId: { userAId: a, userBId: b } },
    update: {},
    create: { userAId: a, userBId: b, score: 0 },
  });
}

export async function incrementAffinity(userAId: string, userBId: string, amount = 10) {
  const [a, b] = [userAId, userBId].sort();
  return prisma.affinity.upsert({
    where:  { userAId_userBId: { userAId: a, userBId: b } },
    update: { score: { increment: amount } },
    create: { userAId: a, userBId: b, score: amount },
  });
}
