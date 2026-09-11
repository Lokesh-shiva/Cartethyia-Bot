// src/lib/kits/feyraKit.ts
// Feyra's PlayableCharacterKit — Glacio lockdown/debuffer, standard-pool 4★.
// First kit built entirely around crippling the enemy rather than buffing
// herself/allies or racking up raw damage. Reuses the WEAKENED debuff
// primitive already wired identically across all 6 combat loops for
// Rhoven's Ultimate — deliberately NOT inventing a second enemy-facing
// debuff type (VULNERABLE-on-boss), which would have meant building that
// whole plumbing from scratch across every loop for a first release.

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface FeyraMechanicState {
  frostStacks: number; // 0-maxFrostStacks(constellation), consumed by her Ultimate for bonus damage
}

export function feyraCreateInitialMechanicState(): FeyraMechanicState {
  return { frostStacks: 0 };
}

export function feyraMaxFrostStacks(constellation: number): number {
  return constellation >= 5 ? 4 : 3;
}

// Same averaged-4★ baseline as Bren — no outlier specialization.
const HP_CEIL = 925, HP_FLOOR_FRAC = 0.30;
const ATK_CEIL = 143, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 83,  DEF_FLOOR_FRAC = 0.30;
const SPD_CEIL = 110, SPD_FLOOR_FRAC = 0.58;
const CRIT_RATE_CEIL = 0.10, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.8,   CRIT_DMG_FLOOR_FRAC = 0.60;
const FEYRA_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (FEYRA_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

export function feyraStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(scaleStat(HP_CEIL, HP_FLOOR_FRAC, level)),
    baseAtk:   Math.round(scaleStat(ATK_CEIL, ATK_FLOOR_FRAC, level)),
    baseDef:   Math.round(scaleStat(DEF_CEIL, DEF_FLOOR_FRAC, level)),
    baseSpeed: Math.round(scaleStat(SPD_CEIL, SPD_FLOOR_FRAC, level)),
    critRate:  scaleStat(CRIT_RATE_CEIL, CRIT_RATE_FLOOR_FRAC, level),
    critDmg:   scaleStat(CRIT_DMG_CEIL, CRIT_DMG_FLOOR_FRAC, level),
  };
}

const FEYRA_WEAKEN_BASE_PCT   = 0.20; // C1 raises to 0.25
const FEYRA_WEAKEN_BASE_TURNS = 2;    // C2 raises to 3
const FEYRA_ULT_DMG_PER_STACK = 0.07;

export function feyraSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.2 + (1.8 - 1.2) * t; // 1.2 -> 1.8 across kit levels 1-10
}

export function feyraUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.4 + (3.4 - 2.4) * t; // 2.4 -> 3.4 across kit levels 1-10
}

export interface FeyraWeaken {
  weakenPct: number;
  weakenTurns: number;
}

export function feyraWeaken(constellation: number): FeyraWeaken {
  return {
    weakenPct: constellation >= 1 ? FEYRA_WEAKEN_BASE_PCT + 0.05 : FEYRA_WEAKEN_BASE_PCT,
    weakenTurns: constellation >= 2 ? FEYRA_WEAKEN_BASE_TURNS + 1 : FEYRA_WEAKEN_BASE_TURNS,
  };
}

// Extends the shared SkillEffectResult shape — NOT part of the
// PlayableCharacterKit interface itself, same pattern every other kit's own
// *SkillResult type established.
export interface FeyraSkillResult extends SkillEffectResult {
  forceCrit: boolean; // C3 — Frostbind always crits
}

export function feyraOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): FeyraSkillResult {
  const state = ctx.mechanicState as FeyraMechanicState;
  const maxStacks = feyraMaxFrostStacks(constellation);
  const newStacks = Math.min(maxStacks, state.frostStacks + 1);

  return {
    damageMult: feyraSkillBaseMult(skillLevel),
    vibFrac: 0.55,
    moveLabel: "Frostbind",
    newMechanicState: { frostStacks: newStacks } as FeyraMechanicState,
    forceCrit: constellation >= 3,
  };
}

export interface FeyraUltimateResult extends UltimateEffectResult {
  damageMult: number; // base UltimateEffectResult carries no damage-mult field — same pattern Bren's kit established
}

export function feyraOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): FeyraUltimateResult {
  const state = ctx.mechanicState as FeyraMechanicState;
  const stacksConsumed = state.frostStacks;
  const bonusMult = stacksConsumed * FEYRA_ULT_DMG_PER_STACK;

  // C4: cleanses 1 of her own debuffs, via the standard CLEANSE_ALLY action
  // channel (targets herself — she IS the active ally when this fires).
  return {
    healResult: { actions: constellation >= 4 ? [{ type: "CLEANSE_ALLY", value: 1 }] : [] },
    moveLabel: "Absolute Zero",
    newMechanicState: { frostStacks: 0 } as FeyraMechanicState,
    resetsConcertoEnergy: true, // gates on Concerto Energy like Kaelith/Rilo/Rhoven/Bren/default-Solace
    damageMult: feyraUltimateBaseMult(ultimateLevel) + bonusMult,
  };
}

const FEYRA_INTRO_NOTE = "Feyra enters already reading the fight's temperature.";

export function feyraIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return { actions: [], newMechanicState: {} };
}
export function feyraOutroEffect(constellation: number): IntroOutroEffect {
  return { actions: [], newMechanicState: {} };
}

export const FEYRA_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const FEYRA_FORTE_GAIN_PER_BASIC = 20;

export function feyraBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as every other kit's basic curve
}

export function feyraAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5500 * targetPhase,
    forgingOres: 7 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0, // interface filler — see kaelithKit.ts's identical note on this known limitation
    glacialShards: 3 * targetPhase, // reuses Rilo's own shard — first character to share an element/ascension-mat with an existing one
  };
}

export function feyraLevelUpCost(currentLevel: number) {
  return {
    credits: 220 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function feyraStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as FeyraMechanicState;
  return `Frost: **${state.frostStacks}** stack${state.frostStacks === 1 ? "" : "s"}`;
}

export const FEYRA_LORE_FRAGMENTS = [
  "Feyra doesn't raise her voice. She doesn't need to — the room gets colder either way.",
  "She was taught that the fastest way to win a fight is to make sure the other side never really gets to start.",
  "People call her cold. She considers that an occupational compliment.",
  "She counts an opponent's strengths out loud sometimes, one by one, right before she takes each one away.",
  "The frost that gathers where she stands isn't for effect. It's just what happens when she stops holding back.",
  "She's never once needed to hit harder than someone. She's only ever needed them to hit softer than they think.",
  "By the time an enemy realizes what she's done to them, it's already the second thing she's done.",
];

export const FEYRA_CONSTELLATION_EFFECTS = [
  "Weaken magnitude increased from -20% to -25% enemy ATK.",
  "Weaken duration extended from 2 turns to 3.",
  "Frostbind's hit is always a critical hit.",
  "Absolute Zero cleanses 1 of her own debuffs.",
  "Max Frost stacks raised from 3 to 4.",
  "**(Defining)** Whenever Frost is at max stacks, Frostbind hits twice — each hit still grants its normal Frost stack (capped).",
];

export const feyraKit: PlayableCharacterKit = {
  id: "feyra",
  label: "Feyra",
  emoji: "❄️",
  element: "GLACIO",
  rarity: 4,
  portraitPath: "assets/Characters/Feyra.png",
  loreFragments: FEYRA_LORE_FRAGMENTS,
  skillCooldownTurns: 0,
  statsAtLevel: feyraStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "feyra" } },
    });
    const level = progress?.level ?? 1;
    const lvl = feyraStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "feyra");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: feyraAscensionCost,
  levelUpCost: feyraLevelUpCost,
  basicDamageMult: feyraBasicDamageMult,
  introEffect: feyraIntroEffect,
  outroEffect: feyraOutroEffect,
  forteConfig: FEYRA_FORTE_CONFIG,
  forteGainPerBasic: FEYRA_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: feyraCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => feyraOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => feyraOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: feyraStatusLineText,
  constellationEffects: FEYRA_CONSTELLATION_EFFECTS,
  maxConstellation: 6,
};

CHARACTER_KITS[feyraKit.id] = feyraKit;
