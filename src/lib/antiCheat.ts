import { Client, EmbedBuilder, TextChannel } from "discord.js";
import prisma from "./prisma";

let auditClient: Client | null = null;
const AUDIT_CHANNEL_ID = process.env.AUDIT_CHANNEL_ID ?? "";

// Per-user award rate tracking
const awardHistory = new Map<string, number[]>();

const RATE_WINDOW_MS              = 30_000;  // 30 second window
const RATE_LIMIT                  = 12;      // max awards in window
const SINGLE_CREDITS_THRESHOLD    = 6_000;   // flag any single award above this
const BALANCE_CREDITS_THRESHOLD   = 600_000; // flag users whose total exceeds this

export function setAuditClient(client: Client) {
  auditClient = client;
}

export async function auditAward(
  userId: string,
  rewards: Record<string, number>,
  source: string,
) {
  const parts = Object.entries(rewards)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=+${v}`)
    .join(" ");
  if (parts) console.log(`[economy] userId=${userId} source=${source} ${parts}`);

  const now = Date.now();
  const hist = (awardHistory.get(userId) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  hist.push(now);
  awardHistory.set(userId, hist);

  const flags: string[] = [];

  if (hist.length > RATE_LIMIT) {
    flags.push(`rate: ${hist.length} awards in ${RATE_WINDOW_MS / 1000}s`);
  }
  if ((rewards.credits ?? 0) > SINGLE_CREDITS_THRESHOLD) {
    flags.push(`large single award: ${rewards.credits} credits`);
  }

  if (flags.length === 0) return;

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { credits: true, username: true },
  }).catch(() => null);

  if (user?.credits && user.credits > BALANCE_CREDITS_THRESHOLD) {
    flags.push(`total balance: ${user.credits.toLocaleString()} credits`);
  }

  const username = user?.username ?? "unknown";
  console.warn(`[anticheat] FLAGGED userId=${userId} (${username}) source=${source} — ${flags.join("; ")}`);
  await postAlert(userId, username, source, rewards, flags);
}

async function postAlert(
  userId: string,
  username: string,
  source: string,
  rewards: Record<string, number>,
  flags: string[],
) {
  if (!auditClient || !AUDIT_CHANNEL_ID) return;
  try {
    const ch = await auditClient.channels.fetch(AUDIT_CHANNEL_ID).catch(() => null) as TextChannel | null;
    if (!ch?.isTextBased()) return;

    const rewardStr = Object.entries(rewards)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `**${k}** +${v}`)
      .join(", ") || "none";

    await ch.send({
      embeds: [new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle("⚠️  Anti-Cheat Alert")
        .addFields(
          { name: "User",    value: `<@${userId}> (${username})`, inline: true },
          { name: "Source",  value: source,                        inline: true },
          { name: "Rewards", value: rewardStr,                     inline: false },
          { name: "Flags",   value: flags.map(f => `• ${f}`).join("\n"), inline: false },
        )
        .setTimestamp()],
    });
  } catch {}
}

export async function runBalanceSweep(client: Client) {
  if (!AUDIT_CHANNEL_ID) return;
  try {
    const flagged = await prisma.user.findMany({
      where:  { credits: { gt: BALANCE_CREDITS_THRESHOLD } },
      select: { id: true, username: true, credits: true },
    });
    if (flagged.length === 0) return;

    const ch = await client.channels.fetch(AUDIT_CHANNEL_ID).catch(() => null) as TextChannel | null;
    if (!ch?.isTextBased()) return;

    const lines = flagged
      .map(u => `<@${u.id}> \`${u.username}\` — ${u.credits.toLocaleString()} credits`)
      .join("\n");

    await ch.send({
      embeds: [new EmbedBuilder()
        .setColor(0xff8800)
        .setTitle("📊  Balance Sweep — High Credit Accounts")
        .setDescription(lines)
        .setFooter({ text: `${flagged.length} account(s) exceed ${BALANCE_CREDITS_THRESHOLD.toLocaleString()} credits` })
        .setTimestamp()],
    });
    console.log(`[anticheat] Balance sweep: ${flagged.length} high-credit account(s) flagged`);
  } catch (e) {
    console.error("[anticheat] Balance sweep error:", e);
  }
}
