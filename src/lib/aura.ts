import prisma from "./prisma";

export const MAX_AURA          = 5;  // base cap (no patron)
export const REGEN_INTERVAL_MS = 3 * 60 * 60 * 1000; // 1 charge per 3 hours

export interface AuraState {
  current:     number;
  max:         number;
  nextRegenMs: number;
}

export function getMaxAura(patronTier: number): number {
  if (patronTier >= 3) return 8;
  if (patronTier >= 2) return 6;
  return 5;
}

/** Compute current aura from stored value + elapsed time (no DB write). */
export function computeAura(stored: number, updatedAt: Date, maxAura = MAX_AURA): AuraState {
  const msPassed    = Date.now() - updatedAt.getTime();
  const regenCount  = Math.min(maxAura - stored, Math.floor(msPassed / REGEN_INTERVAL_MS));
  const current     = Math.min(maxAura, stored + regenCount);
  const msInto      = msPassed % REGEN_INTERVAL_MS;
  const nextRegenMs = current >= maxAura ? Infinity : REGEN_INTERVAL_MS - msInto;
  return { current, max: maxAura, nextRegenMs };
}

/** Format time until next regen for display. */
export function fmtAuraRegen(ms: number): string {
  if (ms === Infinity || ms <= 0) return "full";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Aura bar string like ◈◈◈◇◇ */
export function auraBar(current: number, max = MAX_AURA): string {
  return "◈".repeat(current) + "◇".repeat(Math.max(0, max - current));
}

/**
 * After a stored/updatedAt pair changes (a consume or refund), figure out
 * what auraUpdatedAt should become. Naively stamping `new Date()` on every
 * write restarts the full REGEN_INTERVAL_MS countdown from scratch — so a
 * player who used 1 charge, waited 1h, then used their remaining 4 would see
 * "3h to next" instead of "2h", because the 1h of progress already made
 * toward that tick got silently discarded on the second write.
 *
 * Preserve that partial progress by backdating the new updatedAt by however
 * far into the current regen window we already were — UNLESS regen was
 * capped by maxAura before using the full elapsed time (sitting at/above cap
 * for a while), in which case there's no fractional progress to preserve;
 * the countdown genuinely restarts from now.
 */
function nextUpdatedAt(
  now: number, msPassed: number, maxAura: number,
  storedBefore: number, auraAfter: number,
): Date {
  const rawTicks   = Math.floor(msPassed / REGEN_INTERVAL_MS);
  const regenCount = Math.min(maxAura - storedBefore, rawTicks);
  const wasCapped  = regenCount < rawTicks || storedBefore + regenCount >= maxAura;
  const msInto     = (auraAfter >= maxAura || wasCapped) ? 0 : msPassed % REGEN_INTERVAL_MS;
  return new Date(now - msInto);
}

/**
 * Attempt to consume `cost` aura charges.
 * Returns the new aura value on success, or null if not enough.
 * Writes the updated value to the DB.
 */
export async function consumeAura(userId: string, cost: number): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { resonanceAura: true, auraUpdatedAt: true, patronTier: true },
  });
  if (!user) return null;

  const maxAura   = getMaxAura(user.patronTier);
  const now       = Date.now();
  const msPassed  = now - user.auraUpdatedAt.getTime();
  const { current } = computeAura(user.resonanceAura, user.auraUpdatedAt, maxAura);
  if (current < cost) return null;

  const newAura = current - cost;
  await prisma.user.update({
    where: { id: userId },
    data:  { resonanceAura: newAura, auraUpdatedAt: nextUpdatedAt(now, msPassed, maxAura, user.resonanceAura, newAura) },
  });
  return newAura;
}

/**
 * Refund `amount` aura charges (e.g. a fight interrupted by a bot restart
 * that never got to finish). Computes current aura first (accounting for
 * elapsed regen) so the refund adds on top of whatever's already regenerated,
 * capped at max — never lets a refund push someone above their real cap.
 */
export async function refundAura(userId: string, amount: number): Promise<number | null> {
  if (amount <= 0) return null;
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { resonanceAura: true, auraUpdatedAt: true, patronTier: true },
  });
  if (!user) return null;

  const maxAura   = getMaxAura(user.patronTier);
  const now       = Date.now();
  const msPassed  = now - user.auraUpdatedAt.getTime();
  const { current } = computeAura(user.resonanceAura, user.auraUpdatedAt, maxAura);
  const newAura = Math.min(maxAura, current + amount);
  await prisma.user.update({
    where: { id: userId },
    data:  { resonanceAura: newAura, auraUpdatedAt: nextUpdatedAt(now, msPassed, maxAura, user.resonanceAura, newAura) },
  });
  return newAura;
}

/** Read current aura for a user (no write). */
export async function getAura(userId: string): Promise<AuraState | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { resonanceAura: true, auraUpdatedAt: true, patronTier: true },
  });
  if (!user) return null;
  return computeAura(user.resonanceAura, user.auraUpdatedAt, getMaxAura(user.patronTier));
}
