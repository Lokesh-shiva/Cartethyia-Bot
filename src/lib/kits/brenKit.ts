// src/lib/kits/brenKit.ts
// Bren's PlayableCharacterKit — Fusion berserker, standard-pool 4★. Skill and
// Ultimate cost a fraction of his own current HP (never below 1) in exchange
// for bonus damage proportional to what he spent — the reckless "the more he
// bleeds, the harder he hits" identity. No persistent resource/stack gauge
// unlike every other kit; the mechanic is pure HP-cost math computed at cast
// time, so BrenMechanicState carries nothing meaningful.

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface BrenMechanicState {
  // Intentionally empty — his whole mechanic is HP-cost math at cast time,
  // nothing carries between turns. Kept as a real (if trivial) type rather
  // than `unknown` so combat-loop call sites can still cast to it safely,
  // matching every other kit's convention.
}

export function brenCreateInitialMechanicState(): BrenMechanicState {
  return {};
}

// Same averaged-4★ baseline approach as Rhoven — mean of Kaelith's and
// Vesper's existing ceilings/floors, no outlier specialization. His kit
// identity comes from the HP-cost mechanic below, not from a stat skew.
const HP_CEIL = 925, HP_FLOOR_FRAC = 0.30;
const ATK_CEIL = 143, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 83,  DEF_FLOOR_FRAC = 0.30;
const SPD_CEIL = 110, SPD_FLOOR_FRAC = 0.58;
const CRIT_RATE_CEIL = 0.10, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.8,   CRIT_DMG_FLOOR_FRAC = 0.60;
const BREN_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (BREN_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

export function brenStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(scaleStat(HP_CEIL, HP_FLOOR_FRAC, level)),
    baseAtk:   Math.round(scaleStat(ATK_CEIL, ATK_FLOOR_FRAC, level)),
    baseDef:   Math.round(scaleStat(DEF_CEIL, DEF_FLOOR_FRAC, level)),
    baseSpeed: Math.round(scaleStat(SPD_CEIL, SPD_FLOOR_FRAC, level)),
    critRate:  scaleStat(CRIT_RATE_CEIL, CRIT_RATE_FLOOR_FRAC, level),
    critDmg:   scaleStat(CRIT_DMG_CEIL, CRIT_DMG_FLOOR_FRAC, level),
  };
}

const BREN_SKILL_HP_COST_FRAC = 0.10; // 10% of his CURRENT hp, before C1
const BREN_ULT_HP_COST_FRAC   = 0.18;
const BREN_HP_BONUS_SCALAR    = 3.0;  // bonus mult = (hpSpent / hpMax) * this
const BREN_C1_COST_REDUCTION  = 0.20; // -20% HP cost on both Skill and Ultimate
const BREN_C2_BONUS_BOOST     = 0.30; // +30% to the bonus-mult scalar
const BREN_C6_LOW_HP_THRESHOLD = 0.30;
const BREN_C6_FLAT_BONUS       = 0.40;

export function brenSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.3 + (1.9 - 1.3) * t; // 1.3 -> 1.9 across kit levels 1-10
}

export function brenUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.6 + (3.6 - 2.6) * t; // 2.6 -> 3.6 across kit levels 1-10
}

// Extends the shared SkillEffectResult shape with the HP-cost side-channel —
// NOT part of the PlayableCharacterKit interface itself, same pattern every
// other kit's own *SkillResult type established.
export interface BrenSkillResult extends SkillEffectResult {
  hpCost: number; // actual HP to subtract from Bren's own pool, already clamped so he never drops below 1
}
export interface BrenUltimateResult extends UltimateEffectResult {
  hpCost: number;
  damageMult: number; // base UltimateEffectResult carries no damage-mult field (every kit computes it via its own exported xUltimateBaseMult) — Bren's also folds in the HP-spent bonus, so it's exposed here rather than making the combat loop re-derive it
}

function computeHpCost(currentHp: number, baseFrac: number, constellation: number): number {
  const frac = baseFrac * (constellation >= 1 ? (1 - BREN_C1_COST_REDUCTION) : 1);
  const raw = Math.floor(currentHp * frac);
  return Math.max(0, Math.min(raw, currentHp - 1)); // never lethal to himself
}

export function brenOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): BrenSkillResult {
  const hpCost = computeHpCost(ctx.allyHp, BREN_SKILL_HP_COST_FRAC, constellation);
  const scalar = BREN_HP_BONUS_SCALAR * (constellation >= 2 ? (1 + BREN_C2_BONUS_BOOST) : 1);
  const belowThreshold = (ctx.allyHp - hpCost) <= ctx.allyHpMax * BREN_C6_LOW_HP_THRESHOLD;
  const bonusMult = (hpCost / ctx.allyHpMax) * scalar + (constellation >= 6 && belowThreshold ? BREN_C6_FLAT_BONUS : 0);

  return {
    damageMult: brenSkillBaseMult(skillLevel) + bonusMult,
    vibFrac: 0.55,
    moveLabel: "Bloodprice Cleave",
    newMechanicState: {},
    hpCost,
  };
}

export function brenOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): BrenUltimateResult {
  const hpCost = computeHpCost(ctx.allyHp, BREN_ULT_HP_COST_FRAC, constellation);
  const scalar = BREN_HP_BONUS_SCALAR * (constellation >= 2 ? (1 + BREN_C2_BONUS_BOOST) : 1);
  const belowThreshold = (ctx.allyHp - hpCost) <= ctx.allyHpMax * BREN_C6_LOW_HP_THRESHOLD;
  const bonusMult = (hpCost / ctx.allyHpMax) * scalar + (constellation >= 6 && belowThreshold ? BREN_C6_FLAT_BONUS : 0);

  // C4: heals back 10% of the HP this Ultimate cost, applied AFTER damage —
  // the calling combat loop resolves this via the standard HEAL_ALLY action
  // channel (targets himself), same as every other kit's healResult usage.
  const healBack = constellation >= 4 ? Math.floor(hpCost * 0.10) : 0;

  return {
    healResult: { actions: healBack > 0 ? [{ type: "HEAL_ALLY", value: healBack / Math.max(1, ctx.allyHpMax) }] : [] },
    moveLabel: "Last Man Standing",
    newMechanicState: {},
    resetsConcertoEnergy: true, // gates on Concerto Energy like Kaelith/Rilo/Rhoven/default-Solace, not a personal-energy spend
    hpCost,
    damageMult: brenUltimateBaseMult(ultimateLevel) + bonusMult,
  };
}

// C3's Skill lifesteal and C5's lingering post-Skill/Ult basic-attack bonus
// both need to react to state the base interface doesn't carry (a "just used
// Skill/Ult" flag) — plain helpers the calling combat loop invokes, same
// non-interface-extension pattern every other kit's bespoke hooks use.
export function brenSkillLifestealPct(constellation: number): number {
  return constellation >= 3 ? 0.15 : 0;
}
export const BREN_C5_LINGER_TURNS = 2;
export const BREN_C5_LINGER_BONUS = 0.15; // flat bonus mult applied to Basic Attacks while the linger window is up

const BREN_INTRO_NOTE = "Bren enters ready to bleed for it.";

export function brenIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return { actions: [], newMechanicState: {} };
}
export function brenOutroEffect(constellation: number): IntroOutroEffect {
  return { actions: [], newMechanicState: {} };
}

export const BREN_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const BREN_FORTE_GAIN_PER_BASIC = 20;

export function brenBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as every other kit's basic curve
}

export function brenAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5500 * targetPhase,
    forgingOres: 7 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0, // interface filler — see kaelithKit.ts's identical note on this known limitation
    emberShards: 3 * targetPhase,
  };
}

export function brenLevelUpCost(currentLevel: number) {
  return {
    credits: 220 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function brenStatusLineText(mechanicState: unknown): string {
  return `Bloodprice: spends current HP for bonus damage`;
}

export const BREN_LORE_FRAGMENTS = [
  "Bren was told once that pain is just information. He decided to stop listening to it.",
  "He doesn't flinch when he's cut. He does the math.",
  "Every scar has a number attached, in his head. He knows exactly how much each fight cost him.",
  "Someone asked him why he doesn't just heal first, then fight. He said that's not how momentum works.",
  "He fights like he's already lost something and is trying to get it back before anyone notices.",
  "The lower his HP drops, the quieter he gets. By the end, he's not saying anything at all.",
  "He calls it a price. Everyone else calls it a warning sign. He's not wrong, exactly.",
];

export const BREN_CONSTELLATION_EFFECTS = [
  "Skill and Ultimate's self-damage cost reduced by 20%.",
  "The bonus damage scalar from HP spent is increased by 30%.",
  "Bloodprice Cleave grants 15% Lifesteal on that hit.",
  "Last Man Standing heals back 10% of the HP it cost, after dealing damage.",
  "For 2 turns after using Skill or Ultimate, Basic Attacks gain a flat +15% bonus damage.",
  "**(Defining)** Below 30% HP, all his attacks (Basic, Skill, Ultimate) gain a flat +40% bonus damage.",
];

export const brenKit: PlayableCharacterKit = {
  id: "bren",
  label: "Bren",
  emoji: "🩸",
  element: "FUSION",
  rarity: 4,
  portraitPath: "assets/Characters/Bren.png",
  loreFragments: BREN_LORE_FRAGMENTS,
  skillCooldownTurns: 0,
  statsAtLevel: brenStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "bren" } },
    });
    const level = progress?.level ?? 1;
    const lvl = brenStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "bren");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: brenAscensionCost,
  levelUpCost: brenLevelUpCost,
  basicDamageMult: brenBasicDamageMult,
  introEffect: brenIntroEffect,
  outroEffect: brenOutroEffect,
  forteConfig: BREN_FORTE_CONFIG,
  forteGainPerBasic: BREN_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: brenCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => brenOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => brenOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: brenStatusLineText,
  constellationEffects: BREN_CONSTELLATION_EFFECTS,
  maxConstellation: 6,
};

CHARACTER_KITS[brenKit.id] = brenKit;
