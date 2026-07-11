// src/lib/debuffs.ts
// Minimal composable debuff system — see docs/superpowers/specs/2026-07-11-multi-character-teams-design.md §4.5
// Deliberately excludes Silence-style debuffs (needs button-disabling UI infra that doesn't exist yet).

export type DebuffType = "WEAKENED" | "VULNERABLE" | "BLEED";

export interface ActiveDebuff {
  type:      DebuffType;
  value:     number; // WEAKENED/VULNERABLE: fraction (0.2 = 20%). BLEED: flat damage per tick.
  turnsLeft: number;
}

export type DebuffState = ActiveDebuff[];

// Applying a debuff of a type that's already active REPLACES it (refresh, not stack) —
// matches the existing DEF Shred pattern (raid.ts) which always overwrites rather than
// accumulating duplicate stacks.
export function applyDebuff(state: DebuffState, type: DebuffType, value: number, turns: number): DebuffState {
  const withoutType = state.filter(d => d.type !== type);
  return [...withoutType, { type, value, turnsLeft: turns }];
}

// Call at the start of the affected unit's turn. Decrements durations, drops anything that
// expired, and returns the total BLEED damage to apply this turn.
export function tickDebuffs(state: DebuffState): { state: DebuffState; bleedDamage: number } {
  let bleedDamage = 0;
  const next: ActiveDebuff[] = [];
  for (const d of state) {
    if (d.type === "BLEED") bleedDamage += d.value;
    const turnsLeft = d.turnsLeft - 1;
    if (turnsLeft > 0) next.push({ ...d, turnsLeft });
  }
  return { state: next, bleedDamage };
}

export function getWeakenedMult(state: DebuffState): number {
  const d = state.find(x => x.type === "WEAKENED");
  return d ? Math.max(0, 1 - d.value) : 1;
}

export function getVulnerableMult(state: DebuffState): number {
  const d = state.find(x => x.type === "VULNERABLE");
  return d ? 1 + d.value : 1;
}

// Removes up to `count` debuffs (oldest-applied first). Used by cleanse effects
// (e.g. Solace's Ultimate cleanses 1, or 2 at Constellation 2).
export function cleanseDebuffs(state: DebuffState, count: number): DebuffState {
  return state.slice(count);
}
