import prisma from "./prisma";

export const MAX_AURA            = 5;
export const REGEN_INTERVAL_MS   = 3 * 60 * 60 * 1000; // 1 charge per 3 hours

export interface AuraState {
  current:    number;   // charges available right now
  max:        number;   // always MAX_AURA
  nextRegenMs: number;  // ms until next charge (Infinity if full)
}

/** Compute current aura from stored value + elapsed time (no DB write). */
export function computeAura(stored: number, updatedAt: Date): AuraState {
  const msPassed   = Date.now() - updatedAt.getTime();
  const regenCount = Math.min(MAX_AURA - stored, Math.floor(msPassed / REGEN_INTERVAL_MS));
  const current    = Math.min(MAX_AURA, stored + regenCount);
  const msInto     = msPassed % REGEN_INTERVAL_MS;
  const nextRegenMs = current >= MAX_AURA ? Infinity : REGEN_INTERVAL_MS - msInto;
  return { current, max: MAX_AURA, nextRegenMs };
}

/** Format time until next regen for display. */
export function fmtAuraRegen(ms: number): string {
  if (ms === Infinity || ms <= 0) return "full";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Aura bar string like ◈◈◈◇◇ */
export function auraBar(current: number): string {
  return "◈".repeat(current) + "◇".repeat(MAX_AURA - current);
}

/**
 * Attempt to consume `cost` aura charges.
 * Returns the new aura value on success, or null if not enough.
 * Writes the updated value to the DB.
 */
export async function consumeAura(userId: string, cost: number): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { resonanceAura: true, auraUpdatedAt: true },
  });
  if (!user) return null;

  const { current } = computeAura(user.resonanceAura, user.auraUpdatedAt);
  if (current < cost) return null;

  const newAura = current - cost;
  await prisma.user.update({
    where: { id: userId },
    data:  { resonanceAura: newAura, auraUpdatedAt: new Date() },
  });
  return newAura;
}

/** Read current aura for a user (no write). */
export async function getAura(userId: string): Promise<AuraState | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { resonanceAura: true, auraUpdatedAt: true },
  });
  if (!user) return null;
  return computeAura(user.resonanceAura, user.auraUpdatedAt);
}
