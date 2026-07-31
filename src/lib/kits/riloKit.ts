// src/lib/kits/riloKit.ts
// Rilo's PlayableCharacterKit — Glacio tank/control, standard-pool 5★,
// Broadblade-brawler. Build-and-spend Guard/Shield gauge. See design spec
// docs/superpowers/specs/2026-07-30-rilo-kit-design.md.

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface RiloMechanicState {
  shield: number;                       // 0-maxShield (140 at C5+, else 100), persists across turns
  defShredTurnsLeft: number;             // C2's 2-turn DEF-shred window on the enemy
  usedClutchSaveThisBattle: boolean;     // C3's once-per-battle near-death auto-block
  usedZeroShieldSaveThisBattle: boolean; // C6's once-per-battle 0-Shield safety net
}

export function riloCreateInitialMechanicState(): RiloMechanicState {
  return { shield: 0, defShredTurnsLeft: 0, usedClutchSaveThisBattle: false, usedZeroShieldSaveThisBattle: false };
}

export function riloMaxShield(constellation: number): number {
  return constellation >= 5 ? 140 : 100;
}

const HP_CEIL = 1200, HP_FLOOR_FRAC = 0.35;
const ATK_CEIL = 130, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 120, DEF_FLOOR_FRAC = 0.35;
// SPD floor/ceiling both sit below Kaelith/Vesper's — she is deliberately the
// slowest character in the roster (dragging a huge blade), per design spec.
const SPD_CEIL = 90, SPD_FLOOR_FRAC = 0.55;
const CRIT_RATE_CEIL = 0.08, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.6, CRIT_DMG_FLOOR_FRAC = 0.60;
const RILO_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (RILO_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

// Field names must match PlayableCharacterKit.statsAtLevel's declared return
// shape exactly — { hpMax, baseAtk, baseDef, baseSpeed, critRate, critDmg }.
export function riloStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(scaleStat(HP_CEIL, HP_FLOOR_FRAC, level)),
    baseAtk:   Math.round(scaleStat(ATK_CEIL, ATK_FLOOR_FRAC, level)),
    baseDef:   Math.round(scaleStat(DEF_CEIL, DEF_FLOOR_FRAC, level)),
    baseSpeed: Math.round(scaleStat(SPD_CEIL, SPD_FLOOR_FRAC, level)),
    critRate:  scaleStat(CRIT_RATE_CEIL, CRIT_RATE_FLOOR_FRAC, level),
    critDmg:   scaleStat(CRIT_DMG_CEIL, CRIT_DMG_FLOOR_FRAC, level),
  };
}

// Fraction of Shield consumed by Guard Break that converts to bonus damage
// multiplier. E.g. consuming 60 Shield at RILO_SHIELD_TO_DAMAGE_MULT = 0.02
// adds +1.2 to her base multiplier.
const RILO_SHIELD_TO_DAMAGE_MULT = 0.02;
const RILO_BASELINE_SKILL_DMG_NO_SHIELD = 0.8; // Guard Break with 0 Shield banked — reduced but never a hard block
// C2's DEF-shred value/duration.
export const RILO_C2_DEF_SHRED_PCT = 0.10;
const RILO_C2_DEF_SHRED_TURNS = 2;
// Forte-empowered Guard Break's flat Shield refund after consuming.
const RILO_FORTE_SHIELD_REFUND = 25;
// C4's Ultimate-damage-to-Shield conversion cap.
const RILO_C4_ULT_SHIELD_CONVERSION_PCT = 0.20;
// Ultimate's own post-cast Shield refund (independent of Forte/C4).
const RILO_ULT_SHIELD_REFUND_FRAC = 0.45; // ~45% of max Shield

export function riloSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.4 + (2.0 - 1.4) * t; // 1.4 -> 2.0 across kit levels 1-10
}

export function riloUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.6 + (3.8 - 2.6) * t; // 2.6 -> 3.8 across kit levels 1-10
}

// Extends the shared SkillEffectResult shape with fields only the combat
// loops need — NOT part of the PlayableCharacterKit interface itself, same
// pattern VesperSkillResult established.
export interface RiloSkillResult extends SkillEffectResult {
  shieldConsumed: number;
  defShredApplied: boolean;
}

export function riloOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): RiloSkillResult {
  const state = ctx.mechanicState as RiloMechanicState;
  const shieldConsumed = state.shield;
  const forteEmpowered = (ctx as any).forteEmpowered === true;

  const baseMult = riloSkillBaseMult(skillLevel);
  const damageMult = shieldConsumed > 0
    ? baseMult + shieldConsumed * RILO_SHIELD_TO_DAMAGE_MULT
    : RILO_BASELINE_SKILL_DMG_NO_SHIELD;

  // Forte-empowered: refund a flat chunk back after consuming, instead of
  // fully draining to 0.
  const shieldAfter = forteEmpowered ? Math.min(riloMaxShield(constellation), RILO_FORTE_SHIELD_REFUND) : 0;

  return {
    damageMult,
    vibFrac: 0.6,
    moveLabel: forteEmpowered ? "Braced Guard Break" : "Guard Break",
    newMechanicState: {
      ...state,
      shield: shieldAfter,
      defShredTurnsLeft: constellation >= 2 ? RILO_C2_DEF_SHRED_TURNS + 1 : state.defShredTurnsLeft, // +1 compensates for the same-round decrement applied right after, matching every other kit's outro-buff-duration convention
    } as RiloMechanicState,
    shieldConsumed,
    defShredApplied: constellation >= 2,
  };
}

export function riloOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as RiloMechanicState;
  const damageMult = riloUltimateBaseMult(ultimateLevel);
  const maxShield = riloMaxShield(constellation);

  // Base refund, independent of C4's damage-conversion bonus.
  const baseRefund = Math.floor(maxShield * RILO_ULT_SHIELD_REFUND_FRAC);
  // C4's damage-to-Shield conversion is applied by the calling combat loop
  // (it needs the actual damage number dealt, which this function doesn't
  // compute — the loop adds `Math.floor(actualDamageDealt * RILO_C4_ULT_SHIELD_CONVERSION_PCT)`
  // on top of baseRefund itself before writing the final `shield` value into
  // newMechanicState; this function returns the pre-C4 baseline only,
  // exactly like Vesper's onUltimate doesn't know the calling loop's crit
  // roll ahead of time).
  const newShield = Math.min(maxShield, state.shield + baseRefund);

  return {
    healResult: { actions: constellation >= 4 ? [{ type: "CLEANSE_ALLY", value: 1 }] : [] },
    moveLabel: "Avalanche Slam",
    newMechanicState: {
      ...state,
      shield: newShield,
    } as RiloMechanicState,
    resetsConcertoEnergy: false, // Rilo has no Solace-style team-heal Ultimate
  };
}

// C4's Shield-from-damage conversion — a plain helper (not part of
// UltimateEffectResult, same non-interface-extension pattern as
// RiloSkillResult) the calling combat loop invokes once it knows the actual
// Ultimate damage dealt.
export function riloUltimateShieldFromDamage(actualDamageDealt: number, constellation: number): number {
  return constellation >= 4 ? Math.floor(actualDamageDealt * RILO_C4_ULT_SHIELD_CONVERSION_PCT) : 0;
}

const RILO_INTRO_SHIELD_GRANT = 20;
const RILO_OUTRO_SHIELD_TRANSFER_FRAC = 0.5; // half her remaining Shield transfers, as a temp absorb buff value
const RILO_C1_OUTRO_DEF_BUFF_TURNS = 2;

export function riloIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return {
    actions: [],
    newMechanicState: { grantShieldOnIntro: RILO_INTRO_SHIELD_GRANT + introLevel },
  };
}

export function riloOutroEffect(constellation: number): IntroOutroEffect {
  return {
    actions: [],
    // shieldTransferAmount is computed by the calling combat loop (it needs
    // the outgoing Rilo's actual current shield value, which this function
    // doesn't have access to) — this side-channel just flags the fraction
    // and whether C1's DEF buff applies.
    newMechanicState: {
      grantShieldTransferOnOutro: RILO_OUTRO_SHIELD_TRANSFER_FRAC,
      grantDefBuffOnOutro: constellation >= 1,
      defBuffTurns: RILO_C1_OUTRO_DEF_BUFF_TURNS,
    },
  };
}

export const RILO_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const RILO_FORTE_GAIN_PER_BASIC = 20;
export const RILO_FORTE_GAIN_PER_HIT_TAKEN = 7; // C5 only — roughly a third of a Basic's contribution
export const RILO_SHIELD_GAIN_PER_BASIC = 18;

export function riloBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as every other kit's basic curve
}

export function riloAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5500 * targetPhase,
    forgingOres: 7 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0, // interface filler — see kaelithKit.ts's identical note on this known limitation
    glacialShards: 3 * targetPhase,
  };
}

export function riloLevelUpCost(currentLevel: number) {
  return {
    credits: 220 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function riloStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as RiloMechanicState;
  return `Shield: **${state.shield}**  ·  DEF-shred: **${state.defShredTurnsLeft > 0 ? `${state.defShredTurnsLeft}t` : "none"}**`;
}

// C3 (near-death auto-block) and C5 (Forte-on-hit-taken) both need Rilo to
// react to the ENEMY's attack landing on her — nothing in this codebase
// today lets a character kit hook into that, so this is a plain helper (not
// part of PlayableCharacterKit) each combat loop calls at the exact point it
// applies enemy damage to the active unit, IF that unit is Rilo. Mirrors the
// "extend via a kit-specific helper, not the shared interface" pattern
// RiloSkillResult/riloUltimateShieldFromDamage already established above.
export interface RiloHitTakenResult {
  newMechanicState: RiloMechanicState;
  actualDamageTaken: number;   // 0 if C3's block fully absorbed it
  blockedByC3: boolean;
  forteGain: number;           // 0 unless C5 and state.shield > 0 at the time of the hit
  zeroShieldSaveTriggered: boolean; // C6 — informational, so the combat loop can announce it
}

export function riloOnHitTaken(
  state: RiloMechanicState,
  incomingDamage: number,
  currentHp: number,
  maxHp: number,
  constellation: number,
): RiloHitTakenResult {
  let shield = state.shield;
  let actualDamageTaken = incomingDamage;
  let blockedByC3 = false;
  let zeroShieldSaveTriggered = false;

  // C3: once per battle, a hit that would drop her below 25% HP is instead
  // fully blocked by consuming all remaining Shield. Only fires if she
  // actually has Shield banked — not a free pass every fight.
  const wouldDropBelow25Pct = (currentHp - incomingDamage) < maxHp * 0.25;
  if (constellation >= 3 && !state.usedClutchSaveThisBattle && wouldDropBelow25Pct && shield > 0) {
    actualDamageTaken = 0;
    blockedByC3 = true;
    shield = 0; // consuming "all remaining Shield" per spec
  }

  // C5: taking a hit while holding any Shield grants a flat, modest Forte
  // contribution. Checked against the ORIGINAL shield value (before this
  // same hit's C3 consumption above), since "holding Shield at the moment of
  // the hit" is the trigger condition, not "holding Shield afterward."
  const forteGain = constellation >= 5 && state.shield > 0 ? RILO_FORTE_GAIN_PER_HIT_TAKEN : 0;

  // C6: once per battle, if Shield is ever exactly 0 (checked AFTER any C3
  // consumption above, since C3 draining it to 0 is a valid trigger too),
  // it's immediately restored to 50% of max.
  if (constellation >= 6 && !state.usedZeroShieldSaveThisBattle && shield === 0) {
    shield = Math.floor(riloMaxShield(constellation) * 0.5);
    zeroShieldSaveTriggered = true;
  }

  return {
    newMechanicState: {
      ...state,
      shield,
      usedClutchSaveThisBattle: state.usedClutchSaveThisBattle || blockedByC3,
      usedZeroShieldSaveThisBattle: state.usedZeroShieldSaveThisBattle || zeroShieldSaveTriggered,
    },
    actualDamageTaken,
    blockedByC3,
    forteGain,
    zeroShieldSaveTriggered,
  };
}

export const RILO_LORE_FRAGMENTS = [
  "Rilo picked up her first broadblade because it was the only thing in the armory taller than she was. She has not put one down since.",
  "She apologizes to the enemies she hits. Genuinely. Then hits them again.",
  "Someone told her a blade that size should scare people. She took it as a compliment about her upper-body strength.",
  "Rilo counts her guard the way other people count sheep — quietly, constantly, and mostly to stay calm before the fun part.",
  "She has never once described a fight as dangerous. \"Exciting,\" maybe. \"A lot,\" sometimes. Never dangerous.",
  "The frost that gathers on her blade isn't for show — it's just what happens when something that cold moves that fast, that often.",
  "When she finally lets the swing land, she still grins first. The grin arrives before the impact does.",
];

export const RILO_CONSTELLATION_EFFECTS = [
  "Basic Attacks that land a critical hit grant +50% bonus Shield on top of the normal flat gain (still capped at max Shield).",
  "Guard Break's guaranteed crit also applies a 10% DEF-shred debuff for 2 turns (non-stacking — reapplying refreshes duration).",
  "**Once per battle:** if a hit would drop her below 25% HP and she has any Shield banked, she instead auto-consumes all remaining Shield to fully block it.",
  "Avalanche Slam cleanses one debuff from her and grants Shield equal to 20% of the damage it dealt.",
  "Forte also gains a flat, modest amount whenever she takes a hit while holding any Shield — max Shield is also raised from 100 to 140.",
  "**(Defining)** Once per battle, if her Shield ever hits exactly 0, it's immediately restored to 50% of max — and Avalanche Slam hits twice whenever cast while Shield is at max.",
];

export const riloKit: PlayableCharacterKit = {
  id: "rilo",
  label: "Rilo",
  emoji: "🛡️",
  element: "GLACIO",
  rarity: 5,
  portraitPath: "assets/Characters/Rilo.png",
  loreFragments: RILO_LORE_FRAGMENTS,
  skillCooldownTurns: 0,
  statsAtLevel: riloStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "rilo" } },
    });
    const level = progress?.level ?? 1;
    const lvl = riloStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "rilo");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: riloAscensionCost,
  levelUpCost: riloLevelUpCost,
  basicDamageMult: riloBasicDamageMult,
  introEffect: riloIntroEffect,
  outroEffect: riloOutroEffect,
  forteConfig: RILO_FORTE_CONFIG,
  forteGainPerBasic: RILO_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: riloCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => riloOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => riloOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: riloStatusLineText,
  constellationEffects: RILO_CONSTELLATION_EFFECTS,
  maxConstellation: 6,
};

CHARACTER_KITS[riloKit.id] = riloKit;
