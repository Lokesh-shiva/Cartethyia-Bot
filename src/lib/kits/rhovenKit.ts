// src/lib/kits/rhovenKit.ts
// Rhoven's PlayableCharacterKit — Aero tempo/control, standard-pool 5★.
// See design spec docs/superpowers/specs/2026-09-07-rhoven-aero-character-design.md.
//
// Deliberately simpler than Rilo's kit: no reactive "on hit taken" hook (that
// needed its own bespoke per-combat-loop wiring beyond onSkill/onUltimate,
// see riloOnHitTaken's call sites) — every one of Rhoven's mechanics routes
// through the two functions the PlayableCharacterKit interface already
// dispatches generically, plus a WEAKENED debuff application on his Ultimate
// that combat loops apply via the existing debuffs.ts primitive (not a new
// enemy-targeted action channel).

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface RhovenMechanicState {
  tempoStacks:   number; // 0-maxTempoStacks(constellation), consumed by Windward Step's damage bonus
  tempoTurnsLeft: number; // decays to 0 (and drops all stacks) after this many turns unless C2 removes decay
}

export function rhovenCreateInitialMechanicState(): RhovenMechanicState {
  return { tempoStacks: 0, tempoTurnsLeft: 0 };
}

export function rhovenMaxTempoStacks(constellation: number): number {
  return constellation >= 1 ? 4 : 3;
}

// Deliberately averaged across the existing roster's own ceilings (Rilo
// 1200/130/120/90, Vesper 900/140/80/115, Kaelith 950/145/85/105) rather than
// specialized toward his tempo/control fantasy — that identity comes from
// the kit mechanic below, not from an outlier baseSpeed the way Rilo's tank
// fantasy got an outlier-low one. Per design spec: "keep base stats and max
// possible stats average, since he's a Standard character too."
const HP_CEIL = 1000, HP_FLOOR_FRAC = 0.32;
const ATK_CEIL = 135, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 95,  DEF_FLOOR_FRAC = 0.32;
const SPD_CEIL = 105, SPD_FLOOR_FRAC = 0.58;
const CRIT_RATE_CEIL = 0.09, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.7,   CRIT_DMG_FLOOR_FRAC = 0.60;
const RHOVEN_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (RHOVEN_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

// Field names must match PlayableCharacterKit.statsAtLevel's declared return
// shape exactly — { hpMax, baseAtk, baseDef, baseSpeed, critRate, critDmg }.
export function rhovenStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(scaleStat(HP_CEIL, HP_FLOOR_FRAC, level)),
    baseAtk:   Math.round(scaleStat(ATK_CEIL, ATK_FLOOR_FRAC, level)),
    baseDef:   Math.round(scaleStat(DEF_CEIL, DEF_FLOOR_FRAC, level)),
    baseSpeed: Math.round(scaleStat(SPD_CEIL, SPD_FLOOR_FRAC, level)),
    critRate:  scaleStat(CRIT_RATE_CEIL, CRIT_RATE_FLOOR_FRAC, level),
    critDmg:   scaleStat(CRIT_DMG_CEIL, CRIT_DMG_FLOOR_FRAC, level),
  };
}

// Tempo stack → damage bonus consumed by Windward Step itself (each cast
// spends all current stacks for bonus damage, then grants exactly 1 fresh
// stack — a "spend to empower, refill by casting again" loop rather than a
// pure stockpile-and-dump like Kaelith's).
const RHOVEN_TEMPO_DMG_PER_STACK = 0.08; // +8% dmg per stack spent
const RHOVEN_TEMPO_DECAY_TURNS = 3;
// Eye of the Squall's enemy debuff — mirrors the magnitude of a constellation
// -level effect elsewhere in the roster (Rilo's C2 DEF-shred is 10%/2 turns)
// but doubled since this is a base-kit Ultimate payload, not a constellation
// bonus on top of an existing hit.
const RHOVEN_ULT_WEAKEN_PCT = 0.20;
const RHOVEN_ULT_WEAKEN_TURNS = 2;
const RHOVEN_ULT_DMG_PER_TEMPO_STACK = 0.06; // ultimate consumes remaining stacks too, for bonus dmg

export function rhovenSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.2 + (1.8 - 1.2) * t; // 1.2 -> 1.8 across kit levels 1-10
}

export function rhovenUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.4 + (3.4 - 2.4) * t; // 2.4 -> 3.4 across kit levels 1-10
}

// Extends the shared SkillEffectResult shape with fields only the combat
// loops need — NOT part of the PlayableCharacterKit interface itself, same
// pattern RiloSkillResult/VesperSkillResult established.
export interface RhovenSkillResult extends SkillEffectResult {
  stacksSpent: number;
  forceCrit:   boolean; // C5 — Windward Step's hit is always a critical hit
}

export function rhovenOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): RhovenSkillResult {
  const state = ctx.mechanicState as RhovenMechanicState;
  const stacksSpent = state.tempoStacks;
  const forceCrit = constellation >= 5;

  const baseMult = rhovenSkillBaseMult(skillLevel);
  const damageMult = baseMult + stacksSpent * RHOVEN_TEMPO_DMG_PER_STACK;

  const maxStacks = rhovenMaxTempoStacks(constellation);
  const newStacks = Math.min(maxStacks, 1); // casting always refills to exactly 1 fresh stack after spending

  return {
    damageMult,
    vibFrac: 0.55,
    moveLabel: stacksSpent > 0 ? `Windward Step (+${stacksSpent} Tempo)` : "Windward Step",
    newMechanicState: {
      tempoStacks: newStacks,
      tempoTurnsLeft: constellation >= 2 ? 99 : RHOVEN_TEMPO_DECAY_TURNS + 1, // C2: stacks no longer decay; +1 elsewhere compensates for the same-round decrement every other kit's buff-duration convention applies right after
    } as RhovenMechanicState,
    stacksSpent,
    forceCrit,
  };
}

// Ultimate's enemy-debuff payload — NOT part of UltimateEffectResult (that
// interface has no enemy-targeting concept, see allyActions.ts's ally-only
// AllyActionType). Combat loops call this alongside onUltimate and apply the
// result via debuffs.ts's applyDebuff() to the boss's own DebuffState, same
// "extend via a kit-specific helper" pattern Rilo's riloUltimateShieldFromDamage
// established.
export interface RhovenUltimateWeaken {
  weakenPct: number;
  weakenTurns: number;
  bonusDamageMult: number; // additional multiplier from consumed Tempo stacks, folded into the caller's damage calc
}

export function rhovenOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as RhovenMechanicState;

  return {
    healResult: { actions: [] }, // no ally-targeted payload — C4 grants a Tempo stack to the active ally instead, applied by the calling loop alongside rhovenUltimateWeaken() below
    moveLabel: "Eye of the Squall",
    newMechanicState: {
      tempoStacks: 0, // consumed entirely by the Ultimate
      tempoTurnsLeft: 0,
    } as RhovenMechanicState,
    resetsConcertoEnergy: false,
  };
}

export function rhovenUltimateWeaken(state: RhovenMechanicState, constellation: number): RhovenUltimateWeaken {
  return {
    weakenPct: RHOVEN_ULT_WEAKEN_PCT,
    weakenTurns: constellation >= 3 ? RHOVEN_ULT_WEAKEN_TURNS + 1 : RHOVEN_ULT_WEAKEN_TURNS,
    bonusDamageMult: 1 + state.tempoStacks * RHOVEN_ULT_DMG_PER_TEMPO_STACK,
  };
}

const RHOVEN_INTRO_TEMPO_GRANT = 1;

export function rhovenIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return {
    actions: [],
    newMechanicState: { grantTempoOnIntro: RHOVEN_INTRO_TEMPO_GRANT },
  };
}

export function rhovenOutroEffect(constellation: number): IntroOutroEffect {
  return {
    actions: [],
    newMechanicState: {},
  };
}

export const RHOVEN_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const RHOVEN_FORTE_GAIN_PER_BASIC = 22;

export function rhovenBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as every other kit's basic curve
}

export function rhovenAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5500 * targetPhase,
    forgingOres: 7 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0, // interface filler — see kaelithKit.ts's identical note on this known limitation
    tempestShards: 3 * targetPhase,
  };
}

export function rhovenLevelUpCost(currentLevel: number) {
  return {
    credits: 220 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function rhovenStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as RhovenMechanicState;
  return `Tempo: **${state.tempoStacks}** stack${state.tempoStacks === 1 ? "" : "s"}${state.tempoTurnsLeft > 0 && state.tempoTurnsLeft < 99 ? `  ·  decays in ${state.tempoTurnsLeft}t` : ""}`;
}

export const RHOVEN_LORE_FRAGMENTS = [
  "Rhoven doesn't fight the wind. He just asks it, very politely, to arrive a little early.",
  "He keeps time the way other people keep grudges — precisely, and for far longer than seems reasonable.",
  "Ask him what he's counting and he'll say 'turns.' Ask whose turns and he'll just smile.",
  "He was late to his own duel once. He still won. He has never explained how.",
  "The wind changes direction around him a half-second before it changes everywhere else.",
  "He calls it patience. Everyone who's fought him calls it something closer to being outpaced by the clock itself.",
  "By the time you've decided to act, Rhoven already has — and he's already decided what you'll do next.",
];

export const RHOVEN_CONSTELLATION_EFFECTS = [
  "Max Tempo stacks raised from 3 to 4.",
  "Tempo stacks no longer decay over time — they persist until spent.",
  "Eye of the Squall's Weaken duration extended from 2 turns to 3.",
  "Eye of the Squall also grants the active ally 1 Tempo stack.",
  "Windward Step's hit is always a critical hit.",
  "**(Defining)** Whenever Tempo is at max stacks, Windward Step hits twice — each hit still grants its normal Tempo refill (capped).",
];

export const rhovenKit: PlayableCharacterKit = {
  id: "rhoven",
  label: "Rhoven",
  emoji: "🌪️",
  element: "AERO",
  rarity: 5,
  portraitPath: "assets/Characters/Rhoven.png",
  loreFragments: RHOVEN_LORE_FRAGMENTS,
  skillCooldownTurns: 0,
  statsAtLevel: rhovenStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "rhoven" } },
    });
    const level = progress?.level ?? 1;
    const lvl = rhovenStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "rhoven");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: rhovenAscensionCost,
  levelUpCost: rhovenLevelUpCost,
  basicDamageMult: rhovenBasicDamageMult,
  introEffect: rhovenIntroEffect,
  outroEffect: rhovenOutroEffect,
  forteConfig: RHOVEN_FORTE_CONFIG,
  forteGainPerBasic: RHOVEN_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: rhovenCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => rhovenOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => rhovenOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: rhovenStatusLineText,
  constellationEffects: RHOVEN_CONSTELLATION_EFFECTS,
  maxConstellation: 6,
};

CHARACTER_KITS[rhovenKit.id] = rhovenKit;
