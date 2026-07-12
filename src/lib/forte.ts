// src/lib/forte.ts
// Generic, character-agnostic Forte gauge primitive. See design spec
// docs/superpowers/specs/2026-07-12-milestone2c-forte-design.md §2.
//
// This file must NEVER reference a specific character, mode system, or
// combat move — only phase/charge bookkeeping. Fill triggers, phase counts,
// per-phase thresholds, and full-charge payoffs are all defined per-character
// in that character's own file (e.g. src/lib/solace.ts), composed with this
// file's generic functions. Solace uses a single phase; a future character
// can use 2, 3, or more phases with uneven thresholds without this file
// changing at all.

export interface ForteConfig {
  // Charge required to complete each phase, in order. length = phase count.
  phaseThresholds: number[];
}

export interface ForteState {
  phase: number;   // how many phases are FULLY complete
  charge: number;  // progress within the current, not-yet-complete phase
}

// Adds charge to the current phase, rolling over into subsequent phases if
// the amount overflows the current phase's threshold (handles a single big
// charge gain crossing multiple phase boundaries at once). Caps at the final
// phase fully charged — does not roll past the last phase or store excess.
export function addForteCharge(state: ForteState, config: ForteConfig, amount: number): ForteState {
  let phase  = state.phase;
  let charge = state.charge + amount;
  while (phase < config.phaseThresholds.length && charge >= config.phaseThresholds[phase]) {
    charge -= config.phaseThresholds[phase];
    phase++;
  }
  if (phase >= config.phaseThresholds.length) return { phase: config.phaseThresholds.length, charge: 0 };
  return { phase, charge };
}

// True once the LAST phase is fully charged.
export function isForteMaxed(state: ForteState, config: ForteConfig): boolean {
  return state.phase >= config.phaseThresholds.length;
}

// Resets to empty (phase 0, charge 0).
export function resetForte(): ForteState {
  return { phase: 0, charge: 0 };
}
