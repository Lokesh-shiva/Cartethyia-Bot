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
import { AllyAction } from "./allyActions";
import { ForteConfig } from "./forte";
import { MAX_KIT_LEVEL } from "./characterProgress";
import { resolvePlayerBonuses, applyBonuses, ResolvedStats } from "./setBonus";
import prisma from "./prisma";

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

// ── Leveling & Ascension (character card project) ────────────────────────
// Mirrors the WL boss level-cap table (CLAUDE.md): index = ascensionPhase (0-6).
export const ASCENSION_LEVEL_CAP: number[] = [20, 40, 50, 60, 70, 80, 90];
export const MAX_ASCENSION_PHASE = ASCENSION_LEVEL_CAP.length - 1; // 6
export const SOLACE_MAX_LEVEL = ASCENSION_LEVEL_CAP[MAX_ASCENSION_PHASE]; // 90

export interface AscensionCost {
  credits:        number;
  forgingOres:    number;
  paradoxCores:   number;
  starfallShards: number; // 0 for phase 1; required from phase 2 (the Lv40 ascension) onward
}

// Cost to ascend FROM `currentPhase` TO `currentPhase + 1`. currentPhase is
// 0-5 (ascending past phase 6 is impossible — SOLACE_MAX_LEVEL is the ceiling).
export function solaceAscensionCost(currentPhase: number): AscensionCost {
  const targetPhase = currentPhase + 1; // 1-6
  return {
    credits:        2000 * targetPhase,
    forgingOres:     10 * targetPhase,
    paradoxCores:     2 * targetPhase,
    starfallShards: targetPhase >= 2 ? 3 * (targetPhase - 1) : 0,
  };
}

// Cost to raise `level` by 1, in Resonance Records + Credits — flat per-level
// spend; the caller clamps to the current phase's cap.
export function solaceLevelUpCost(currentLevel: number): { resonanceRecords: number; credits: number } {
  return { resonanceRecords: Math.ceil(currentLevel / 2) + 1, credits: currentLevel * 50 };
}

// Support-class growth bias (design spec §7): HP/DEF grow across the full
// range (low floor), ATK grows across a narrow range (high floor — leveling
// barely raises her damage), Crit barely moves at all. A maxed-level Solace
// must still read as a support unit, never DPS-shaped.
const LEVEL_FLOOR_FRACTION = { hp: 0.20, def: 0.20, atk: 0.65, spd: 0.50, critRate: 0.95, critDmg: 0.95 };

function levelScaledStat(ceiling: number, level: number, floorFraction: number): number {
  const clamped = Math.max(1, Math.min(SOLACE_MAX_LEVEL, level));
  const t = (clamped - 1) / (SOLACE_MAX_LEVEL - 1); // 0 at Lv1, 1 at Lv90
  return ceiling * (floorFraction + (1 - floorFraction) * t);
}

// SOLACE.baseAtk/baseDef/baseSpeed/hpMax above are her Lv90 ceiling values.
export function solaceStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(levelScaledStat(SOLACE.hpMax,   level, LEVEL_FLOOR_FRACTION.hp)),
    baseAtk:   Math.round(levelScaledStat(SOLACE.baseAtk, level, LEVEL_FLOOR_FRACTION.atk)),
    baseDef:   Math.round(levelScaledStat(SOLACE.baseDef, level, LEVEL_FLOOR_FRACTION.def)),
    baseSpeed: Math.round(levelScaledStat(SOLACE.baseSpeed, level, LEVEL_FLOOR_FRACTION.spd)),
    critRate:  levelScaledStat(SOLACE.critRate, level, LEVEL_FLOOR_FRACTION.critRate),
    critDmg:   levelScaledStat(SOLACE.critDmg, level, LEVEL_FLOOR_FRACTION.critDmg),
  };
}

// 7 fixed lore fragments — Fragment 1 always visible, Fragments 2-7 unlock at
// ascensionPhase 1-6 respectively. Design spec §7.1.
export const SOLACE_LORE_FRAGMENTS: string[] = [
  "They say every star eventually falls. Most burn out in the descent, forgotten before they touch the ground.",
  "Solace remembers her fall — the sky tearing open, the long silence of the drop, and then warmth, unfamiliar and entire, as she opened eyes she didn't know she had onto a world that was not her own.",
  "She could have stayed dim. Fallen stars usually do — spent, purposeless, waiting to go dark for good. But something in her refused the silence.",
  "She chose to keep shining, because somewhere below her light there was always someone who needed it more than the sky ever had.",
  "So she stays close to the ground now, deliberately. She kneels beside the wounded instead of watching from above.",
  "She lends her glow to whoever's fighting beside her — not because the sky asks it of her anymore, but because she decided, once and for all, what a star that falls should do with the light it has left.",
  "Give it away, freely, to anyone still standing in the dark. She doesn't call herself a light in the heavens anymore. She calls herself one on the ground — smaller, maybe, but close enough to actually reach the people who need her.",
];

// Fragment index i (0-based) is unlocked once ascensionPhase >= i.
export function unlockedLoreFragments(ascensionPhase: number): { text: string; unlocked: boolean }[] {
  return SOLACE_LORE_FRAGMENTS.map((text, i) => ({ text, unlocked: ascensionPhase >= i }));
}

// Intro Skill: instant heal + cleanse, zero ramp-up (design spec §6). Unlike
// Outro, Intro's heal % scales with Intro level (Milestone 2e) — so it's a
// function, not a static object, to avoid a second, silently-stale source of
// truth for the heal value. Milestone 4d: constellation gates two additions —
// C4 adds a shield equal to 30% of the heal (computed at construction time
// since HEAL_ALLY/SHIELD_ALLY are both flat fractions of hpMax, so no need to
// wait for a resolved heal amount).
export function solaceIntroEffect(introLevel: number, constellation: number = 0): IntroOutroEffect {
  const healPct = solaceIntroHealPct(introLevel);
  const actions: AllyAction[] = [
    { type: "HEAL_ALLY",    value: healPct },
    { type: "CLEANSE_ALLY", value: 1 },
  ];
  if (constellation >= 4) actions.push({ type: "SHIELD_ALLY", value: healPct * 0.30 });
  return { actions };
}

// Outro: shields the incoming ally 15% of hpMax (design spec §6/§8 — see the
// "guaranteed crit" note below for why that half of the spec was never built).
// C1 adds a standalone +15% ATK buff to the incoming ally's first action.
//
// The "guarantees their next attack crits" half of her Outro (per spec) has no
// AllyAction primitive for it yet (HEAL/SHIELD/BUFF_ATK/CLEANSE don't cover
// "arm a guaranteed crit") — a later task wires that part directly via the
// existing nextAttackCritArmed variable already used by the Echo Skill system.
// C1 does NOT depend on that gap — it ships as its own +15% ATK buff.
export function solaceOutroEffect(constellation: number = 0): IntroOutroEffect {
  const actions: AllyAction[] = [{ type: "SHIELD_ALLY", value: 0.15 }];
  if (constellation >= 1) actions.push({ type: "BUFF_ALLY_ATK", value: 0.15 });
  return { actions };
}

// Ultimate's doubled-Attunement-effect duration (design spec §6: "3 turns").
// C5 extends this to 4. SOLACE_FORTE_EMPOWERED_TURNS below is aliased to the
// same window (Empowered Ultimate is a variant of the same doubled-mode
// mechanic) so it extends together with C5, not independently.
export function solaceUltimateDoubleTurns(constellation: number = 0): number {
  return constellation >= 5 ? 4 : 3;
}

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
// Ultimate" window. They shared a constant before Milestone 4d; now both read
// solaceUltimateDoubleTurns(constellation) directly — if tuning one, check
// whether you meant to affect both.

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
// C2 adds a flat +0.15 on top of the kit-level-scaled range (0.30-0.60 becomes
// 0.45-0.75 at constellation >= 2).
export function solaceConvergenceHealPct(ultimateLevel: number, constellation: number = 0): number {
  const base = 0.30 + (0.60 - 0.30) * (ultimateLevel - 1) / (MAX_KIT_LEVEL - 1);
  return constellation >= 2 ? base + 0.15 : base;
}

// C2 also raises Convergence's CLEANSE_ALLY value from 1 to 2 — combat loops
// call this instead of hardcoding the literal.
export function solaceConvergenceCleanseCount(constellation: number = 0): number {
  return constellation >= 2 ? 2 : 1;
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
export async function resolveSolaceStats(userId: string): Promise<ResolvedStats & { hasWellspring: boolean; wellspringRefinement: number }> {
  const [bonuses, progress] = await Promise.all([
    resolvePlayerBonuses(userId, "solace"),
    prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "solace" } },
      select: { level: true },
    }),
  ]);
  const lvl = solaceStatsAtLevel(progress?.level ?? 1);
  const stats = applyBonuses(
    { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
    bonuses,
  );
  // Milestone 4a: Wellspring's mode-linked bonus (getWellspringXBonus in
  // wellspring.ts) only applies when Solace has ACTUALLY equipped Wellspring
  // — she's a real, optional item now, not an always-on hardcoded stopgap.
  return { ...stats, hasWellspring: bonuses.equippedWeaponName === "Wellspring", wellspringRefinement: bonuses.equippedWeaponRefinement };
}
