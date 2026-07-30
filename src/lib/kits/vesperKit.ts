// src/lib/kits/vesperKit.ts
// Vesper's PlayableCharacterKit — Electro sub-DPS, Static Mark -> Discharge ->
// Overload chain. See design spec
// docs/superpowers/specs/2026-07-30-vesper-kit-design.md.

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface VesperMechanicState {
  markPresent: boolean;
  dischargesSinceUltimate: number; // C6's rotation-length counter, reset on Ultimate cast
}

export function vesperCreateInitialMechanicState(): VesperMechanicState {
  return { markPresent: false, dischargesSinceUltimate: 0 };
}

const HP_CEIL = 900, HP_FLOOR_FRAC = 0.30;
const ATK_CEIL = 140, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 80, DEF_FLOOR_FRAC = 0.30;
// SPD floor is meaningfully higher than Kaelith's (0.50) per design spec —
// reflects her Energy-driven kit benefiting more from the existing global
// +1 Energy/turn per 20 spdFlat hook. No bespoke SPD mechanic (confirmed).
const SPD_CEIL = 115, SPD_FLOOR_FRAC = 0.65;
const CRIT_RATE_CEIL = 0.10, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.8, CRIT_DMG_FLOOR_FRAC = 0.60;
const VESPER_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (VESPER_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

// Field names must match PlayableCharacterKit.statsAtLevel's declared return
// shape exactly — { hpMax, baseAtk, baseDef, baseSpeed, critRate, critDmg }.
export function vesperStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(scaleStat(HP_CEIL, HP_FLOOR_FRAC, level)),
    baseAtk:   Math.round(scaleStat(ATK_CEIL, ATK_FLOOR_FRAC, level)),
    baseDef:   Math.round(scaleStat(DEF_CEIL, DEF_FLOOR_FRAC, level)),
    baseSpeed: Math.round(scaleStat(SPD_CEIL, SPD_FLOOR_FRAC, level)),
    critRate:  scaleStat(CRIT_RATE_CEIL, CRIT_RATE_FLOOR_FRAC, level),
    critDmg:   scaleStat(CRIT_DMG_CEIL, CRIT_DMG_FLOOR_FRAC, level),
  };
}

// Base mark-consumption bonus multiplier added on top of the move's own base
// damage when a Static Mark is consumed. C2 doubles this.
const VESPER_MARK_BONUS_MULT = 0.6;
// C1's Charged Mark (only ever created by Outro) bonus is bigger than a
// normal mark's bonus.
const VESPER_CHARGED_MARK_BONUS_MULT = 1.2;
// C5's DEF-ignore fraction on Arc Discharge hits.
const VESPER_C5_DEF_IGNORE = 0.15;
// C6's per-Discharge-since-last-Ultimate damage-mult bonus to Overload.
const VESPER_C6_PER_DISCHARGE_BONUS = 0.15;

export function vesperSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.2 + (1.8 - 1.2) * t; // 1.2 -> 1.8 across kit levels 1-10
}

export function vesperUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.2 + (3.4 - 2.2) * t; // 2.2 -> 3.4 across kit levels 1-10
}

// Extends the shared SkillEffectResult shape with fields only the combat
// loops need for the multi-hit display — NOT part of the
// PlayableCharacterKit interface itself, a Vesper-specific superset the
// combat loops read via a cast after calling the generic onSkill().
export interface VesperSkillResult extends SkillEffectResult {
  hits: number;          // 1 normally, 2 (or 3 at C4) for an Arc Discharge
  defIgnorePct: number;  // 0 normally, VESPER_C5_DEF_IGNORE at C5+
}

export function vesperOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): VesperSkillResult {
  const state = ctx.mechanicState as VesperMechanicState & { chargedMark?: boolean };
  const consumedMark = state.markPresent;
  const isChargedMark = consumedMark && !!state.chargedMark;

  const normalMarkBonus = constellation >= 2 ? VESPER_MARK_BONUS_MULT * 2 : VESPER_MARK_BONUS_MULT;
  const markBonusMult = isChargedMark ? VESPER_CHARGED_MARK_BONUS_MULT : normalMarkBonus;

  const baseMult = vesperSkillBaseMult(skillLevel);
  const damageMult = consumedMark ? baseMult + markBonusMult : baseMult;

  const forteEmpowered = (ctx as any).forteEmpowered === true;
  const hits = forteEmpowered ? (constellation >= 4 ? 3 : 2) : 1;

  return {
    damageMult,
    vibFrac: 0.5,
    moveLabel: forteEmpowered
      ? `Arc Discharge${hits === 3 ? " (Triple Hit!)" : " (Double Hit!)"}`
      : (consumedMark ? "Discharge — mark consumed" : "Discharge"),
    newMechanicState: {
      markPresent: false,
      chargedMark: false,
      dischargesSinceUltimate: state.dischargesSinceUltimate + (consumedMark ? 1 : 0),
    } as VesperMechanicState,
    hits,
    defIgnorePct: constellation >= 5 ? VESPER_C5_DEF_IGNORE : 0,
  };
}

export function vesperOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as VesperMechanicState;
  const consumedMark = state.markPresent;
  const baseMult = vesperUltimateBaseMult(ultimateLevel);
  const markBonus = consumedMark ? 0.8 : 0;
  const c6Bonus = constellation >= 6 ? state.dischargesSinceUltimate * VESPER_C6_PER_DISCHARGE_BONUS : 0;
  // C3: scales with Energy% at the moment of cast. Energy is always 100 when
  // Ultimate is actually castable (the button is disabled below 100 Energy
  // in every combat loop, same as every other character's Ultimate), so this
  // term is effectively a flat +0.5 at C3+ in practice today — written as a
  // real percentage calculation anyway so it stays correct if a future
  // mechanic ever allows casting Ultimate below 100 Energy.
  const energyPct = (ctx.playerEnergy ?? 100) / (ctx.playerEnergyMax ?? 100);
  const c3Bonus = constellation >= 3 ? energyPct * 0.5 : 0;
  const damageMult = baseMult + markBonus + c6Bonus + c3Bonus;

  return {
    healResult: { actions: [] }, // Overload has no heal component — pure damage + mark refresh
    moveLabel: `Overload${consumedMark ? " — mark consumed" : ""}`,
    newMechanicState: {
      markPresent: true, // Overload ALWAYS leaves a fresh mark afterward, per spec
      dischargesSinceUltimate: 0, // C6 counter resets on every Ultimate cast, C6 or not
    } as VesperMechanicState,
    resetsConcertoEnergy: false, // Vesper's "Energy" is personal Energy, not Concerto Energy — she has no Solace-style team-heal Ultimate
  };
}

export function vesperIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return {
    actions: [], // no HP/shield/ATK-buff action — the Energy burst is delivered via newMechanicState's side-channel, same pattern Kaelith's Intro uses for stacks
    newMechanicState: { grantEnergyOnIntro: 40 + introLevel * 2 }, // scales gently with Intro level
  };
}

export function vesperOutroEffect(constellation: number): IntroOutroEffect {
  return {
    actions: [], // C1's Crit Rate buff was rejected in favor of a Charged Mark upgrade — no ally-facing action either way
    newMechanicState: { grantMarkOnOutro: true, chargedMark: constellation >= 1 },
  };
}

export const VESPER_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const VESPER_FORTE_GAIN_PER_BASIC = 20;
export const VESPER_FORTE_GAIN_PER_MARKED_DISCHARGE = 15; // Discharge fills Forte extra fast when it consumes a mark, per spec

export function vesperBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as Solace/Kaelith's basic curve
}

export function vesperAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5000 * targetPhase,
    forgingOres: 6 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0, // interface filler — see kaelithKit.ts's identical note on this known limitation
    voltaicShards: 3 * targetPhase,
  };
}

export function vesperLevelUpCost(currentLevel: number) {
  return {
    credits: 200 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function vesperStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as VesperMechanicState;
  return `Mark: **${state.markPresent ? "Present" : "None"}**  ·  Discharges since Ult: **${state.dischargesSinceUltimate}**`;
}

export const VESPER_LORE_FRAGMENTS = [
  "Vesper never raises her voice — the current does that for her.",
  "She counts everything: turns, heartbeats, the exact moment a fight tips.",
  "Some allies fight beside her. She prefers to fight just ahead of them, clearing the way before they arrive.",
  "The mark she leaves behind isn't a weapon. It's an invitation — to whoever swaps in next.",
  "She was taught that lightning never strikes the same place twice. She decided that rule didn't apply to her.",
  "There is a version of restraint that looks like patience, and a version that looks like a held breath. Vesper's is the second kind.",
  "When the overload finally comes, it isn't rage. It's arithmetic, finally paying out.",
];

export const VESPER_CONSTELLATION_EFFECTS = [
  "Outro's mark becomes a Charged Mark — the next Discharge that consumes it gets a larger flat damage bonus than a normal mark.",
  "Discharge's mark-consumption bonus damage is doubled.",
  "Ultimate's damage additionally scales with current Energy% at cast, and refunds that spent Energy toward the next Arc Discharge.",
  "**(Defining-adjacent)** Arc Discharge becomes a triple hit (not double) whenever Forte is empowered.",
  "Arc Discharge's hits ignore 15% of the enemy's DEF.",
  "**(Defining)** Overload's damage bonus scales with how many Discharges landed since the last Ultimate — resets to 0 after each Ultimate cast.",
];

export const vesperKit: PlayableCharacterKit = {
  id: "vesper",
  label: "Vesper",
  emoji: "⚡",
  element: "ELECTRO",
  rarity: 4,
  portraitPath: "assets/Characters/Vesper.png",
  loreFragments: VESPER_LORE_FRAGMENTS,
  skillCooldownTurns: 0, // intentional — see design spec's "Skill Cooldown" section
  statsAtLevel: vesperStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "vesper" } },
    });
    const level = progress?.level ?? 1;
    const lvl = vesperStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "vesper");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: vesperAscensionCost,
  levelUpCost: vesperLevelUpCost,
  basicDamageMult: vesperBasicDamageMult,
  introEffect: vesperIntroEffect,
  outroEffect: vesperOutroEffect,
  forteConfig: VESPER_FORTE_CONFIG,
  forteGainPerBasic: VESPER_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: vesperCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => vesperOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => vesperOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: vesperStatusLineText,
  constellationEffects: VESPER_CONSTELLATION_EFFECTS,
  maxConstellation: 6,
};

CHARACTER_KITS[vesperKit.id] = vesperKit;
