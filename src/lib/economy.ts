import prisma from "./prisma";
import { EmbedBuilder, ChatInputCommandInteraction } from "discord.js";
import { auditAward } from "./antiCheat";

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
 * @param source  Label for audit logs (e.g. "dungeon", "vote", "boss")
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
    fractonite?:      number;
    auraPrisms?:      number;
    radiantKeys?:     number;
    resonanceExp?:    number;
  },
  source = "unknown",
) {
  const result = await prisma.user.update({
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
      fractonite:       { increment: rewards.fractonite       ?? 0 },
      auraPrisms:       { increment: rewards.auraPrisms       ?? 0 },
      radiantKeys:      { increment: rewards.radiantKeys      ?? 0 },
      resonanceExp:     { increment: rewards.resonanceExp     ?? 0 },
    },
  });
  auditAward(userId, {
    credits:          rewards.credits          ?? 0,
    lunakite:         rewards.lunakite         ?? 0,
    tuningModules:    rewards.tuningModules    ?? 0,
    sealingTubes:     rewards.sealingTubes     ?? 0,
    forgingOres:      rewards.forgingOres      ?? 0,
    paradoxCores:     rewards.paradoxCores     ?? 0,
    stasisLocks:      rewards.stasisLocks      ?? 0,
    resonanceRecords: rewards.resonanceRecords ?? 0,
    fractureKeys:     rewards.fractureKeys     ?? 0,
    fractonite:       rewards.fractonite       ?? 0,
    auraPrisms:       rewards.auraPrisms       ?? 0,
    radiantKeys:      rewards.radiantKeys      ?? 0,
  }, source).catch(() => {});
  return result;
}

/**
 * Award EXP from chatting (1-minute cooldown enforced).
 * Returns the EXP awarded (0 if on cooldown).
 */
// In-memory EXP cooldown — avoids a full DB fetch on every chat message just
// to check if 3s have elapsed. Survives restarts gracefully (falls back to DB).
const expCooldowns = new Map<string, number>();

export async function tryAwardChatExp(userId: string, lastExpGain: Date): Promise<number> {
  const now = Date.now();

  // Fast path: in-memory cooldown check (no DB hit)
  const cached = expCooldowns.get(userId) ?? 0;
  if (now - cached < 3_000) return 0;

  // DB-backed check as fallback (handles bot restarts)
  if (now - lastExpGain.getTime() < 3_000) return 0;

  expCooldowns.set(userId, now);
  const expGain = Math.floor(Math.random() * 6) + 3;
  await prisma.user.update({
    where: { id: userId },
    data:  { resonanceExp: { increment: expGain }, lastExpGain: new Date(now) },
  });

  return expGain;
}

/**
 * Sync check against an already-fetched user object. Use this when the command
 * already called getOrCreateUser() — avoids a redundant DB round-trip.
 */
export function isDispatchBlocked(user: { dispatchStatus: string; dispatchEndsAt: Date | null }): boolean {
  return user.dispatchStatus === "ON_DISPATCH"
    && !!user.dispatchEndsAt
    && user.dispatchEndsAt.getTime() > Date.now();
}

/** @deprecated Use isDispatchBlocked(user) when you already have the user row. */
export async function isOnDispatch(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { dispatchStatus: true, dispatchEndsAt: true },
  });
  if (!user) return false;
  return isDispatchBlocked(user);
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
