// src/lib/kits/solaceKit.ts
// Solace's PlayableCharacterKit — wraps her existing solace.ts/attunement.ts
// functions. This does NOT change her live behavior: it's a parallel,
// verified-equivalent surface that combat loops will call through once
// Kaelith's implementation wires up real dispatch (see the template design
// spec's Phasing section). Until then, nothing calls this file except
// scripts/verify-solace-kit.ts.

import { PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult } from "../characterKit";
import {
  solaceStatsAtLevel, resolveSolaceStats, solaceAscensionCost, solaceLevelUpCost,
  ASCENSION_LEVEL_CAP, solaceBasicDamageMult, solaceIntroEffect, solaceOutroEffect,
  solaceConvergenceHealPct, solaceConvergenceCleanseCount,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_LORE_FRAGMENTS,
} from "../solace";
import { AttunementState, cycleAttunementMode } from "../attunement";
import { CONSTELLATION_EFFECTS_SOLACE } from "./solaceConstellationText";

interface SolaceMechanicState {
  attunement: AttunementState;
  concertoEnergy: number;
}

export const solaceKit: PlayableCharacterKit = {
  id: "solace",
  label: "Solace",
  emoji: "✨",
  element: "SPECTRO",
  rarity: 5,
  portraitPath: "assets/Characters/Solace.png",
  loreFragments: SOLACE_LORE_FRAGMENTS,
  skillCooldownTurns: 0, // no cooldown — Attunement is a utility mode-cycle, not a damage move

  statsAtLevel: solaceStatsAtLevel,
  resolveStats: async (userId: string) => {
    const stats = await resolveSolaceStats(userId);
    return { ...stats, hasSignatureWeapon: stats.hasWellspring, signatureWeaponRefinement: stats.wellspringRefinement };
  },

  ascensionLevelCap: ASCENSION_LEVEL_CAP,
  ascensionCost: solaceAscensionCost,
  levelUpCost: solaceLevelUpCost,

  basicDamageMult: solaceBasicDamageMult,
  introEffect: solaceIntroEffect,
  outroEffect: solaceOutroEffect,

  forteConfig: SOLACE_FORTE_CONFIG,
  forteGainPerBasic: SOLACE_FORTE_GAIN_PER_BASIC,

  createInitialMechanicState: (): SolaceMechanicState => ({ attunement: { mode: null }, concertoEnergy: 0 }),

  onSkill(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): SkillEffectResult {
    const state = ctx.mechanicState as SolaceMechanicState;
    const newMode = cycleAttunementMode(state.attunement.mode);
    const bonusConcertoEnergy = constellation >= 3 ? 25 : 0;
    return {
      damageMult: 0.6,
      vibFrac: 0.3,
      moveLabel: `✦ Attunement — now in **${newMode}** mode!`,
      newMechanicState: { attunement: { mode: newMode }, concertoEnergy: state.concertoEnergy },
      bonusConcertoEnergy,
    };
  },

  onUltimate(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): UltimateEffectResult {
    const state = ctx.mechanicState as SolaceMechanicState;
    const healPct = solaceConvergenceHealPct(kitLevels.ultimateLevel, constellation);
    return {
      healResult: {
        actions: [
          { type: "HEAL_ALLY", value: healPct },
          { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(constellation) },
        ],
      },
      moveLabel: `⚡ **Convergence!** Team healed, debuffs cleansed.`,
      newMechanicState: { attunement: state.attunement, concertoEnergy: 0 },
      resetsConcertoEnergy: true,
    };
  },

  statusLineText(mechanicState: unknown): string {
    const state = mechanicState as SolaceMechanicState;
    return `${state.attunement.mode ? `(${state.attunement.mode} mode)` : "(no mode)"}  ·  Concerto Energy: ${state.concertoEnergy}/100`;
  },

  constellationEffects: CONSTELLATION_EFFECTS_SOLACE,
  maxConstellation: 6,
};
