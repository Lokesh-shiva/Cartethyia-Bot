// src/lib/attunement.ts
// Solace's core mechanic (design spec §6) — a persistent, switchable team buff,
// cycled via her Skill. Unlike Milestone 0's debuffs (which decay over turns) or
// ally-actions (one-shot heal/shield/buff/cleanse), Attunement is standing state
// that modifies damage/crit/DEF calculations every turn while active — closer in
// shape to Milestone 1's own debuff-multiplier getters (getWeakenedMult, etc.)
// than to a one-shot action.

export type AttunementMode = "ATK" | "CRIT" | "DEF";

export interface AttunementState {
  mode: AttunementMode | null;
}

const ATTUNEMENT_ATK_BONUS  = 0.15; // +15% ATK while in ATK mode
const ATTUNEMENT_CRIT_BONUS = 0.15; // +15% Crit Rate while in CRIT mode
const ATTUNEMENT_DEF_BONUS  = 0.20; // +20% DEF while in DEF mode

// Cycles ATK -> CRIT -> DEF -> ATK. No-mode (null) starts at ATK.
export function cycleAttunementMode(current: AttunementMode | null): AttunementMode {
  if (current === "ATK")  return "CRIT";
  if (current === "CRIT") return "DEF";
  return "ATK"; // covers both `null` (first activation) and "DEF" (wrap around)
}

// `doubled` is Solace's Ultimate ("Convergence") temporarily doubling whichever
// mode is currently active — it doubles the BONUS portion (the amount above the
// neutral 1.0/0 baseline), not the whole multiplier.
export function getAttunementAtkMult(state: AttunementState, doubled = false): number {
  if (state.mode !== "ATK") return 1;
  return 1 + ATTUNEMENT_ATK_BONUS * (doubled ? 2 : 1);
}

export function getAttunementCritRateBonus(state: AttunementState, doubled = false): number {
  if (state.mode !== "CRIT") return 0;
  return ATTUNEMENT_CRIT_BONUS * (doubled ? 2 : 1);
}

export function getAttunementDefMult(state: AttunementState, doubled = false): number {
  if (state.mode !== "DEF") return 1;
  return 1 + ATTUNEMENT_DEF_BONUS * (doubled ? 2 : 1);
}
