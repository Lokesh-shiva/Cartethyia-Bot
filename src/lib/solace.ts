// src/lib/solace.ts
// The first real banner character — see design spec §6 for the full kit
// rationale. Replaces src/lib/placeholderAlly.ts, which was always meant to be
// thrown away once a real character existed.
//
// Forte, Wellspring, and Constellations are NOT part of this file — they're
// separate follow-up milestones (2b/2c/2d). Her Ultimate here is the base
// version only (doubles the current Attunement mode for 3 turns); the
// Forte-triggered "Empowered Ultimate -> all 3 modes at once" upgrade requires
// the Forte gauge to exist first.

import { IntroOutroEffect } from "./introOutro";
import { ForteConfig } from "./forte";
import { MAX_KIT_LEVEL } from "./characterProgress";
import { resolvePlayerBonuses, applyBonuses, ResolvedStats } from "./setBonus";

export const SOLACE = {
  name:  "Solace",
  hpMax: 1100,
  // Milestone 3.5b: a fixed level-25-equivalent starting stat block (matches
  // hpMax=1100 above: 800 + 12/level * 25 = 1100, same derivation for the
  // rest — a level-1 player's base stats + the standard per-level growth
  // curve from CLAUDE.md, frozen at 25). Not a leveling system of her own —
  // her only progression is her existing kit-level tracks (Basic/Skill/
  // Ultimate/Intro/Forte). Before this milestone her combat formulas borrowed
  // the acting player's own resolved stats; now she has an independent stat
  // line that combines with her OWN equipped echoes/weapon via
  // resolveSolaceStats() below, so per-character loadouts (Milestone 3.5a)
  // actually change her damage.
  baseAtk:   115,
  baseDef:   100,
  baseSpeed: 125,
  critRate:  0.05,
  critDmg:   1.5,

  // Outro Skill: shields the incoming ally. The "guarantees their next attack
  // crits" half of her Outro (per spec) has no AllyAction primitive for it yet
  // (HEAL/SHIELD/BUFF_ATK/CLEANSE don't cover "arm a guaranteed crit") — a
  // later task wires that part directly in encounter.ts by reusing the
  // existing nextAttackCritArmed variable already in that file (from the Echo
  // Skill system), rather than inventing a new primitive for a single one-off
  // use. Outro deliberately does NOT level (design spec §6/§8) — stays fixed
  // regardless of investment, unlike Intro below.
  outro: {
    actions: [
      { type: "SHIELD_ALLY", value: 0.15 },
    ],
  } as IntroOutroEffect,
};

// Intro Skill: instant heal + cleanse, zero ramp-up (design spec §6). Unlike
// Outro, Intro's heal % scales with Intro level (Milestone 2e) — so it's a
// function, not a static object, to avoid a second, silently-stale source of
// truth for the heal value.
export function solaceIntroEffect(introLevel: number): IntroOutroEffect {
  return {
    actions: [
      { type: "HEAL_ALLY",    value: solaceIntroHealPct(introLevel) },
      { type: "CLEANSE_ALLY", value: 1 },
    ],
  };
}

// Ultimate's doubled-Attunement-effect duration (design spec §6: "3 turns").
export const SOLACE_ULTIMATE_DOUBLE_TURNS = 3;

// The player's own personalized character still gets the universal, generic
// Intro/Outro pair from design spec §2 — unrelated to which banner character
// is in the other slot. These lived in the now-deleted placeholderAlly.ts;
// they move here rather than getting a separate file of their own.
export const PLAYER_SELF_INTRO: IntroOutroEffect = { actions: [{ type: "HEAL_ALLY", value: 0.05 }] };
export const PLAYER_SELF_OUTRO: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.05 }] };

// ── Forte (Milestone 2c) ──────────────────────────────────────────────────
// Solace's specific gauge tuning and full-charge payoff. forte.ts itself
// knows nothing about any of this — see design spec §2/§3.

export const SOLACE_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] }; // single phase, matches her "steady build" identity
export const SOLACE_FORTE_GAIN_PER_BASIC = 20; // Chime Strike fills the gauge — 5 hits to max

// These are separate concepts that happen to share a duration today: Ultimate's
// own "double the active Attunement mode" window vs. Forte's "Empowered
// Ultimate" window. They're aliased for consistency, not because they're the
// same knob — if tuning one, check whether you meant to affect both.
export const SOLACE_FORTE_EMPOWERED_TURNS = SOLACE_ULTIMATE_DOUBLE_TURNS;

// Empowered Ultimate's payoff: reduced bonuses, applied REGARDLESS of which
// single Attunement mode is currently active — deliberately additive
// alongside (not a replacement for) attunement.ts's own per-mode getters, so
// attunement.ts needs zero changes. Magnitude scales with Forte level
// (Milestone 2e) — Lv1 matches the original Milestone 2c flat values exactly
// (0.08/0.08/0.10, roughly half of Attunement's own baseline 15%/15%/20%),
// doubling by Lv10. See design spec §3/§6 for why these numbers were chosen
// to stay clear of Constellation 6's eventual territory.
export function getSolaceForteAtkBonus(forteLevel: number, empowered: boolean): number {
  return empowered ? solaceForteEmpoweredAtkCritBonus(forteLevel) : 0;
}
export function getSolaceForteCritRateBonus(forteLevel: number, empowered: boolean): number {
  return empowered ? solaceForteEmpoweredAtkCritBonus(forteLevel) : 0;
}
export function getSolaceForteDefBonus(forteLevel: number, empowered: boolean): number {
  return empowered ? solaceForteEmpoweredDefBonus(forteLevel) : 0;
}

// ── Kit-leveling scaling curves (Milestone 2e) ────────────────────────────
// Linear interpolation from Lv1 to Lv10 for every track. Lv1 values match
// each track's ORIGINAL pre-Milestone-2e hardcoded constant exactly — a fresh
// Lv1 character must play identically to how she did before this milestone.
// See design spec §3 for the full table and §6 for the Constellation-6
// balance reasoning behind the chosen Lv10 ceilings.

export function solaceBasicDamageMult(basicLevel: number): number {
  return 1.0 + (1.8 - 1.0) * (basicLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceAttunementAtkCritBonus(skillLevel: number): number {
  return 0.15 + (0.30 - 0.15) * (skillLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceAttunementDefBonus(skillLevel: number): number {
  return 0.20 + (0.40 - 0.20) * (skillLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceConvergenceHealPct(ultimateLevel: number): number {
  return 0.30 + (0.60 - 0.30) * (ultimateLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceIntroHealPct(introLevel: number): number {
  return 0.20 + (0.40 - 0.20) * (introLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceForteEmpoweredAtkCritBonus(forteLevel: number): number {
  return 0.08 + (0.16 - 0.08) * (forteLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceForteEmpoweredDefBonus(forteLevel: number): number {
  return 0.10 + (0.20 - 0.10) * (forteLevel - 1) / (MAX_KIT_LEVEL - 1);
}

// ── Independent stat resolution (Milestone 3.5b) ──────────────────────────
// Resolves Solace's OWN combat stats from her own base line + her own
// equipped echoes/weapon (characterId "solace"), completely independent of
// whichever player owns her. Every combat surface's Solace/ally branch
// should call this once per fight (not per action — bonuses don't change
// mid-fight) and use the result instead of the acting player's own stats.
export async function resolveSolaceStats(userId: string): Promise<ResolvedStats> {
  const bonuses = await resolvePlayerBonuses(userId, "solace");
  return applyBonuses(
    { baseHp: SOLACE.hpMax, baseAtk: SOLACE.baseAtk, baseDef: SOLACE.baseDef, critRate: SOLACE.critRate, critDmg: SOLACE.critDmg, baseSpeed: SOLACE.baseSpeed },
    bonuses,
  );
}
