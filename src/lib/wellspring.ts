// src/lib/wellspring.ts
// Wellspring — Solace's signature weapon, Milestone 2b. See design spec
// docs/superpowers/specs/2026-07-11-milestone2b-wellspring-design.md.
//
// This is NOT a real, ownable Weapon DB row yet — no per-character equip slot
// exists (see that spec's §1). It's hardcoded directly onto Solace as a
// stopgap: always-on while she's the active unit, not swappable, not shared
// with the player's own /equip weapon. A future milestone turns this into a
// real item once per-character loadouts exist — do not treat this file as
// the permanent home for Wellspring's data once that happens.

import { AttunementState } from "./attunement";
import { REFINEMENT_MULT } from "./weapons";

// Base effect — always active whenever Solace is the attacker. Reuses the
// existing ATK_BOOST/ENERGY_BOOST primitives' VALUES (not their plumbing —
// see encounter.ts wiring for why: Solace never touches state.playerEnergy).
// Milestone 4d: Wellspring became a real, refinable /wish pull (R1-R5) — these
// were flat constants from when she was a hardcoded stopgap with no equip
// slot of her own; now every bonus below scales with REFINEMENT_MULT like any
// other weapon's passive, applied to the BONUS portion only (the +18%/+12/
// +10%/+12%, not the neutral 1.0/0 baseline), same convention as Attunement's
// own doubling.
const WELLSPRING_BASE_ATK_BONUS    = 0.18; // +18% ATK at R1 — top of ATK_BOOST's existing 8-18% registry range
const WELLSPRING_BASE_ENERGY_BONUS = 12;   // +12 flat Concerto Energy at R1, on her own actions

export function getWellspringBaseAtkMult(refinement: number = 1): number {
  return 1 + WELLSPRING_BASE_ATK_BONUS * (REFINEMENT_MULT[refinement] ?? 1);
}
export function getWellspringBaseEnergyBonus(refinement: number = 1): number {
  return WELLSPRING_BASE_ENERGY_BONUS * (REFINEMENT_MULT[refinement] ?? 1);
}

// Bonus effect — amplifies whichever Attunement mode is currently active.
// Fires for either unit (mirrors how Attunement's own buff already applies
// uniformly regardless of who's attacking) — this is Wellspring being in the
// fight at all, not Wellspring being wielded by whoever's currently acting.
// Does NOT get doubled by Convergence — only Attunement's own bonus does.
export function getWellspringAtkBonus(state: AttunementState, refinement: number = 1): number {
  return state.mode === "ATK" ? 0.10 * (REFINEMENT_MULT[refinement] ?? 1) : 0;
}
export function getWellspringCritRateBonus(state: AttunementState, refinement: number = 1): number {
  return state.mode === "CRIT" ? 0.10 * (REFINEMENT_MULT[refinement] ?? 1) : 0;
}
export function getWellspringDefBonus(state: AttunementState, refinement: number = 1): number {
  return state.mode === "DEF" ? 0.12 * (REFINEMENT_MULT[refinement] ?? 1) : 0;
}
