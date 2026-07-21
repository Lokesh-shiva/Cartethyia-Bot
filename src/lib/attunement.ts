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

// Cycles ATK -> CRIT -> DEF -> ATK. No-mode (null) starts at ATK.
export function cycleAttunementMode(current: AttunementMode | null): AttunementMode {
  if (current === "ATK")  return "CRIT";
  if (current === "CRIT") return "DEF";
  return "ATK"; // covers both `null` (first activation) and "DEF" (wrap around)
}

// `bonus` is the magnitude for whichever mode IS active (e.g. Solace's
// Skill-level-scaled value, computed by the caller — see solace.ts). No
// default: Milestone 2e deliberately removed the old hardcoded 0.15/0.15/0.20
// constants so a future character reusing this mechanic can't silently
// inherit Solace's numbers by omission — every caller must supply its own
// character's magnitude explicitly.
//
// `doubled` is Solace's Ultimate ("Convergence") temporarily doubling whichever
// mode is currently active — it doubles the BONUS portion (the amount above the
// neutral 1.0/0 baseline), not the whole multiplier.
//
// `constellation6`: C6 — while one mode is active, allies ALSO gain 50% of the
// other two modes' effects. Only applies to modes that are NOT the active one
// (the active mode's own bonus/doubling is unaffected — this is purely
// additive spillover onto the two inactive modes).
export function getAttunementAtkMult(state: AttunementState, bonus: number, doubled = false, constellation6 = false): number {
  if (state.mode === "ATK") return 1 + bonus * (doubled ? 2 : 1);
  return constellation6 ? 1 + bonus * 0.5 : 1;
}

export function getAttunementCritRateBonus(state: AttunementState, bonus: number, doubled = false, constellation6 = false): number {
  if (state.mode === "CRIT") return bonus * (doubled ? 2 : 1);
  return constellation6 ? bonus * 0.5 : 0;
}

export function getAttunementDefMult(state: AttunementState, bonus: number, doubled = false, constellation6 = false): number {
  if (state.mode === "DEF") return 1 + bonus * (doubled ? 2 : 1);
  return constellation6 ? 1 + bonus * 0.5 : 1;
}
