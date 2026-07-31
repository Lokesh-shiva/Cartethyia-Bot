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
