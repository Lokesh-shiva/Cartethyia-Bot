// src/lib/concertoEnergy.ts
// Shared, team-wide resource — distinct from each character's existing personal Energy
// meter. Persists across swaps (unlike personal Energy, which is tied to whichever
// character is currently active). See design spec §4.1.

export const CONCERTO_ENERGY_MAX = 100;

export function addConcertoEnergy(current: number, amount: number): number {
  return Math.min(CONCERTO_ENERGY_MAX, current + amount);
}

// Returns null if insufficient energy (caller must not deduct/act on a null result),
// otherwise the new post-spend value.
export function spendConcertoEnergy(current: number, amount: number): number | null {
  if (current < amount) return null;
  return current - amount;
}
