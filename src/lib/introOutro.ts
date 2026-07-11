// src/lib/introOutro.ts
// Intro/Outro Skill hook points — see design spec §4.4. A hook is a composed list of
// ally-actions (allyActions.ts) that fire at a specific swap moment, plus an optional
// damage component against the enemy — matching WuWa, where Intro Skills especially
// are often a real attack, not just a buff. Solace's Intro/Outro are pure-utility
// (dmgMult omitted) since she's a support, but this type supports damage for future
// DPS-archetype characters.
//
// This milestone defines the type + a single-target resolver; wiring "a character
// was actually swapped in/out" into a real turn loop, and resolving dmgMult into an
// actual damage number (needs DEF/crit/etc. from a real combat loop), is future work.

import { AllyAction, applyAllyAction, AllyActionTarget, AllyActionResult } from "./allyActions";

export interface IntroOutroEffect {
  actions:  AllyAction[]; // ally-targeted utility effects (heal/shield/buff/cleanse)
  dmgMult?: number;       // if present, this hook also deals damage to the enemy —
                          // damage = wielder's ATK * dmgMult, resolved via the
                          // standard calcPlayerDamage path once wired in a future milestone
}

export interface IntroOutroResult extends AllyActionResult {
  dmgMult: number; // 0 if this hook deals no damage
}

// Resolves every ally-action in the hook against a single target, summing the
// results, and passes dmgMult through unchanged (actual damage resolution needs
// DEF/crit/etc. that only exists once this is wired into a real combat loop).
// Individual actions targeting different allies (e.g. Outro shielding the incoming
// character while something else affects the whole team) is future work once real
// swap targeting exists — this covers the common single-target case.
export function resolveIntroOutroEffect(effect: IntroOutroEffect, target: AllyActionTarget): IntroOutroResult {
  const total: IntroOutroResult = { hpDelta: 0, shieldDelta: 0, atkBuffPct: 0, cleanseCount: 0, dmgMult: effect.dmgMult ?? 0 };
  for (const action of effect.actions) {
    const r = applyAllyAction(action, target);
    total.hpDelta       += r.hpDelta;
    total.shieldDelta    += r.shieldDelta;
    total.atkBuffPct     += r.atkBuffPct;
    total.cleanseCount   += r.cleanseCount;
  }
  return total;
}
