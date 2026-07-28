// src/lib/kits/kaelithKit.ts
// Kaelith's PlayableCharacterKit — Havoc DPS, stack-based Skill/Ultimate
// detonation mechanic. See design spec
// docs/superpowers/specs/2026-07-24-kaelith-kit-design.md.

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface KaelithMechanicState {
  stacks: number;
  forteEmpoweredKeepStacksActivationsLeft: number; // C5: lasts 2 activations instead of 1
}

export function kaelithCreateInitialMechanicState(): KaelithMechanicState {
  return { stacks: 0, forteEmpoweredKeepStacksActivationsLeft: 0 };
}

// Base cap 5; C2 -> 6; C4 -> 7; C6 -> 9. Highest applicable threshold wins.
export function kaelithStackCap(constellation: number): number {
  if (constellation >= 6) return 9;
  if (constellation >= 4) return 7;
  if (constellation >= 2) return 6;
  return 5;
}

// Skill stack cost: 2 normally, 1 at C2+.
export function kaelithSkillStackCost(constellation: number): number {
  return constellation >= 2 ? 1 : 2;
}

// Basic Attack stack grant: +1 normally; C3 gives a 30% chance of +2 instead.
export function kaelithBasicStackGain(constellation: number): number {
  if (constellation >= 3 && Math.random() < 0.30) return 2;
  return 1;
}

const HP_CEIL = 950, HP_FLOOR_FRAC = 0.30;
const ATK_CEIL = 145, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 85, DEF_FLOOR_FRAC = 0.30;
const SPD_CEIL = 105, SPD_FLOOR_FRAC = 0.50;
const CRIT_RATE_CEIL = 0.10, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.8, CRIT_DMG_FLOOR_FRAC = 0.60;
const KAELITH_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (KAELITH_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

// Field names must match PlayableCharacterKit.statsAtLevel's declared return
// shape exactly — { hpMax, baseAtk, baseDef, baseSpeed, critRate, critDmg }.
export function kaelithStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(scaleStat(HP_CEIL, HP_FLOOR_FRAC, level)),
    baseAtk:   Math.round(scaleStat(ATK_CEIL, ATK_FLOOR_FRAC, level)),
    baseDef:   Math.round(scaleStat(DEF_CEIL, DEF_FLOOR_FRAC, level)),
    baseSpeed: Math.round(scaleStat(SPD_CEIL, SPD_FLOOR_FRAC, level)),
    critRate:  scaleStat(CRIT_RATE_CEIL, CRIT_RATE_FLOOR_FRAC, level),
    critDmg:   scaleStat(CRIT_DMG_CEIL, CRIT_DMG_FLOOR_FRAC, level),
  };
}

export const KAELITH_PER_STACK_SKILL_BONUS = 0.5;
export const KAELITH_PER_STACK_ULT_BONUS   = 0.6;

// kaelithSkillBaseMult: 1.4 at kit level 1 -> 2.2 at kit level 10, linear.
export function kaelithSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.4 + (2.2 - 1.4) * t;
}

// kaelithUltimateBaseMult: 2.5 at kit level 1 -> 3.8 at kit level 10, linear.
export function kaelithUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.5 + (3.8 - 2.5) * t;
}

export function kaelithOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): SkillEffectResult {
  const state = ctx.mechanicState as KaelithMechanicState;
  const cost = kaelithSkillStackCost(constellation);
  const stacksConsumed = Math.min(state.stacks, cost);
  const newStacks = state.stacks - stacksConsumed;

  const damageMult = kaelithSkillBaseMult(skillLevel) + stacksConsumed * KAELITH_PER_STACK_SKILL_BONUS;

  return {
    damageMult,
    vibFrac: 0.6,
    moveLabel: `Umbral Detonation — consumed ${stacksConsumed} stack${stacksConsumed === 1 ? "" : "s"}`,
    newMechanicState: { ...state, stacks: newStacks } as KaelithMechanicState,
  };
}

export function kaelithOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as KaelithMechanicState;
  const stacksConsumed = state.stacks;

  // Forte-empowered "keeps stacks" — normally 1 activation, C5 extends to 2.
  const keepStacks = state.forteEmpoweredKeepStacksActivationsLeft > 0;
  const nextKeepStacksLeft = keepStacks ? state.forteEmpoweredKeepStacksActivationsLeft - 1 : 0;

  const healFrac = constellation >= 4 ? 0.15 : 0;

  return {
    healResult: { actions: healFrac > 0 ? [{ type: "HEAL_ALLY", value: healFrac }] : [] },
    moveLabel: keepStacks
      ? `Umbral Cataclysm — stacks preserved by Forte! (${stacksConsumed} consumed for damage only)`
      : `Umbral Cataclysm — consumed all ${stacksConsumed} stacks`,
    newMechanicState: {
      stacks: keepStacks ? state.stacks : 0,
      forteEmpoweredKeepStacksActivationsLeft: nextKeepStacksLeft,
    } as KaelithMechanicState,
    resetsConcertoEnergy: true,
  };
}

export function kaelithIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return {
    actions: [{ type: "BUFF_ALLY_ATK", value: 0.20 }],
    // Consumed specially by ascend.ts: grants +2 stacks (cap-limited) on entry.
    newMechanicState: { grantStacksOnIntro: 2 },
  };
}

export function kaelithOutroEffect(constellation: number): IntroOutroEffect {
  const debuffPct = constellation >= 1 ? 0.20 : 0.15;
  return {
    actions: constellation >= 1 ? [{ type: "BUFF_ALLY_CRIT_RATE", value: 0.10 }] : [],
    enemyDebuff: { type: "DEF_SHRED", value: debuffPct, turns: 2 },
  };
}

export const KAELITH_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const KAELITH_FORTE_GAIN_PER_BASIC = 20;

export function kaelithBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as Solace's basic curve
}

// PlayableCharacterKit.ascensionCost's declared return type is
// { credits, forgingOres, paradoxCores, starfallShards } — currently
// hardcoded to Solace's own currencies at the interface level. Kaelith's
// real ascension currency is umbralShards, not starfallShards. Returning an
// object with BOTH starfallShards: 0 (to satisfy the existing interface,
// which nothing currently reads for Kaelith since no ascension-currency-
// spending command exists yet — out of scope for this plan) AND the real
// umbralShards field (an extra property, allowed structurally since this is
// assigned via a function reference, not an object literal) is a deliberate
// stopgap. Generalizing the interface's cost shape to be currency-agnostic
// is explicitly out of scope here.
export function kaelithAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5000 * targetPhase,
    forgingOres: 6 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0,
    umbralShards: 3 * targetPhase,
  };
}

export function kaelithLevelUpCost(currentLevel: number) {
  return {
    credits: 200 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function kaelithStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as KaelithMechanicState;
  return `Stacks: **${state.stacks}**${state.forteEmpoweredKeepStacksActivationsLeft > 0 ? "  ·  ✨ Forte-empowered (keeps stacks)" : ""}`;
}

export const KAELITH_LORE_FRAGMENTS = [
  "Kaelith speaks rarely, and only after the silence has already answered.",
  "What he calls discipline, others call the absence of mercy.",
  "The stacks are not power he channels — they are debts the world owes him, collected one strike at a time.",
  "He does not raise his voice. He has never needed to.",
  "Every enemy he has ever faced learns the same lesson, usually too late: restraint is not the same as weakness.",
  "There was a version of him that showed mercy once. It did not survive the choice.",
  "When the last stack detonates, Kaelith does not smile. He simply moves on to the next debt.",
];

export const kaelithKit: PlayableCharacterKit = {
  id: "kaelith",
  label: "Kaelith",
  emoji: "🌑",
  element: "HAVOC",
  portraitPath: "assets/Characters/Kaelith.png",
  loreFragments: KAELITH_LORE_FRAGMENTS,
  skillCooldownTurns: 3,
  statsAtLevel: kaelithStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "kaelith" } },
    });
    const level = progress?.level ?? 1;
    const lvl = kaelithStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "kaelith");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: kaelithAscensionCost,
  levelUpCost: kaelithLevelUpCost,
  basicDamageMult: kaelithBasicDamageMult,
  introEffect: kaelithIntroEffect,
  outroEffect: kaelithOutroEffect,
  forteConfig: KAELITH_FORTE_CONFIG,
  forteGainPerBasic: KAELITH_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: kaelithCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => kaelithOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => kaelithOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: kaelithStatusLineText,
  constellationEffects: [
    "Outro also grants +10% Crit Rate to incoming ally; DEF-shred 15% -> 20%",
    "Skill stack cost 2 -> 1; stack cap 5 -> 6",
    "Basic Attacks: 30% chance to grant +2 stacks instead of +1",
    "Ultimate also heals Kaelith 15% of damage dealt; stack cap 6 -> 7",
    "Forte-empowered 'keeps stacks' effect lasts 2 activations instead of 1",
    "Stack cap 7 -> 9; Ultimate's damage formula changes entirely (stack-scaling replaces flat base)",
  ],
  maxConstellation: 6,
};

CHARACTER_KITS[kaelithKit.id] = kaelithKit;
