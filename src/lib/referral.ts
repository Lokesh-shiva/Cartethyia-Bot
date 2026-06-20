import { Client, EmbedBuilder } from "discord.js";
import { randomBytes } from "crypto";
import prisma from "./prisma";
import { awardUser } from "./economy";

export type ReferralMilestone = "join" | "lv20" | "ascend" | "evolved" | "awakened";

const MILESTONE_REWARDS: Record<Exclude<ReferralMilestone, "join">, {
  credits?:          number;
  sealingTubes?:     number;
  tuningModules?:    number;
  paradoxCores?:     number;
  resonanceRecords?: number;
  label:             string;
}> = {
  lv20: {
    credits:       1000,
    tuningModules: 1,
    label: "your recruit **reached Level 20** and unlocked their Element",
  },
  ascend: {
    credits:      1500,
    paradoxCores: 1,
    label: "your recruit **won their first Ascension Trial**",
  },
  evolved: {
    credits:      2000,
    paradoxCores: 2,
    label: "your recruit **evolved their unique ability** (Lv50)",
  },
  awakened: {
    credits:          5000,
    paradoxCores:     3,
    resonanceRecords: 100,
    label: "your recruit **awakened their Ego Weapon** (Lv60)",
  },
};

/** Generate or fetch the referral code for a user. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { referralCode: true },
  });
  if (user?.referralCode) return user.referralCode;

  let code!: string;
  for (let i = 0; i < 20; i++) {
    const candidate = randomBytes(3).toString("hex").toUpperCase();
    const clash = await prisma.user.findUnique({ where: { referralCode: candidate } });
    if (!clash) { code = candidate; break; }
  }
  if (!code) throw new Error("Could not generate a unique referral code");

  await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
  return code;
}

/** Look up the inviter user ID from a referral code (case-insensitive). */
export async function resolveReferralCode(code: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where:  { referralCode: code.toUpperCase() },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Claim the join referral for a new recruit completing /start for the first time.
 * Returns true if the reward was granted, false if invalid / already claimed.
 */
export async function claimReferralJoin(
  recruitId: string,
  code:       string,
  client?:    Client,
): Promise<boolean> {
  const inviterId = await resolveReferralCode(code);
  if (!inviterId || inviterId === recruitId) return false;

  const recruit = await prisma.user.findUnique({
    where:  { id: recruitId },
    select: { referredBy: true },
  });
  if (recruit?.referredBy) return false; // already has a referrer

  await prisma.$transaction([
    prisma.user.update({
      where: { id: recruitId },
      data:  {
        referredBy:                inviterId,
        referralMilestonesGranted: { push: "join" },
        credits:                   { increment: 200 },
      },
    }),
    prisma.user.update({
      where: { id: inviterId },
      data:  { credits: { increment: 500 }, sealingTubes: { increment: 1 } },
    }),
  ]);

  await notifyInviter(
    client, inviterId,
    "your recruit **joined and started their journey**",
    { credits: 500, sealingTubes: 1 },
  ).catch(() => {});

  return true;
}

/**
 * Grant a milestone reward to the inviter when their recruit hits a progression gate.
 * Idempotent — skips silently if already granted.
 */
export async function grantReferralMilestone(
  recruitId: string,
  milestone: Exclude<ReferralMilestone, "join">,
  client?:   Client,
): Promise<void> {
  const recruit = await prisma.user.findUnique({
    where:  { id: recruitId },
    select: { referredBy: true, referralMilestonesGranted: true },
  });
  if (!recruit?.referredBy) return;
  if (recruit.referralMilestonesGranted.includes(milestone)) return;

  const inviterId = recruit.referredBy;
  const reward    = MILESTONE_REWARDS[milestone];

  await prisma.$transaction([
    prisma.user.update({
      where: { id: recruitId },
      data:  { referralMilestonesGranted: { push: milestone } },
    }),
    prisma.user.update({
      where: { id: inviterId },
      data: {
        credits:          { increment: reward.credits          ?? 0 },
        tuningModules:    { increment: reward.tuningModules    ?? 0 },
        paradoxCores:     { increment: reward.paradoxCores     ?? 0 },
        resonanceRecords: { increment: reward.resonanceRecords ?? 0 },
      },
    }),
  ]);

  await notifyInviter(client, inviterId, reward.label, reward).catch(() => {});
}

async function notifyInviter(
  client:    Client | undefined,
  inviterId: string,
  reason:    string,
  reward:    { credits?: number; sealingTubes?: number; tuningModules?: number; paradoxCores?: number; resonanceRecords?: number },
): Promise<void> {
  if (!client) return;

  const lines = [
    reward.credits          ? `+${reward.credits.toLocaleString()} Credits`    : null,
    reward.sealingTubes     ? `+${reward.sealingTubes} Sealing Tube(s)`        : null,
    reward.tuningModules    ? `+${reward.tuningModules} Tuning Module(s)`      : null,
    reward.paradoxCores     ? `+${reward.paradoxCores} Paradox Core(s)`        : null,
    reward.resonanceRecords ? `+${reward.resonanceRecords} Resonance Records`  : null,
  ].filter(Boolean).join("\n");

  const dmUser = await client.users.fetch(inviterId).catch(() => null);
  if (!dmUser) return;
  await dmUser.send({
    embeds: [new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("✦  Referral Reward")
      .setDescription(`**CARTETHYIA** — ${reason}.\n\n**Awarded to you:**\n${lines}`)
      .setFooter({ text: "CARTETHYIA  ·  Referral System" })],
  }).catch(() => {});
}
