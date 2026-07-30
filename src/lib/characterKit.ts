// src/lib/characterKit.ts
// Shared shape every playable-ally character's kit module implements. Plumbing
// only — what a character's Basic/Skill/Ultimate/Intro/Outro/Constellations
// actually DO stays entirely bespoke inside each kit's own onSkill/onUltimate/
// introEffect/outroEffect functions. See design spec
// docs/superpowers/specs/2026-07-24-playable-character-kit-template-design.md.
//
// Combat-loop dispatch through this registry is NOT wired up yet (deferred to
// the next character's implementation, per the spec's "Phasing" section) —
// this file plus kits/solaceKit.ts exist and are verified in isolation first.

import { ResolvedStats } from "./setBonus";
import { IntroOutroEffect } from "./introOutro";
import { AllyAction } from "./allyActions";
import { ForteConfig } from "./forte";

// Generic combat-state bag — NOT Attunement-specific. A character that
// doesn't need some of these fields simply ignores them.
export interface CharacterCombatContext {
  playerHp: number; playerHpMax: number;
  allyHp: number; allyHpMax: number;
  turn: number;
  isShattered: boolean;
  mechanicState: unknown; // opaque per-character state — combat loop never inspects this
}

export interface SkillEffectResult {
  damageMult: number;      // multiplier on the acting unit's ATK for this hit
  vibFrac: number;         // vib-bar damage fraction
  moveLabel: string;       // display text
  newMechanicState: unknown;
  bonusConcertoEnergy?: number;
}

export interface UltimateEffectResult {
  healResult: { actions: AllyAction[] }; // fed through resolveIntroOutroEffect, same as today
  moveLabel: string;
  newMechanicState: unknown;
  resetsConcertoEnergy: boolean;
}

export interface PlayableCharacterKit {
  id:            string;
  label:         string;
  emoji:         string;
  element:       string;
  rarity:        4 | 5;         // banner rarity — shown as ★ count in character pickers
  portraitPath:  string;
  loreFragments: string[];      // 7 entries; fragment i unlocks at ascensionPhase >= i
  skillCooldownTurns: number;   // 0 = no cooldown (Solace); a real damage-move Skill should set this

  statsAtLevel(level: number): { hpMax: number; baseAtk: number; baseDef: number; baseSpeed: number; critRate: number; critDmg: number };
  resolveStats(userId: string): Promise<ResolvedStats & { hasSignatureWeapon: boolean; signatureWeaponRefinement: number }>;

  ascensionLevelCap: number[];
  ascensionCost(currentPhase: number): { credits: number; forgingOres: number; paradoxCores: number; starfallShards: number };
  levelUpCost(currentLevel: number): { resonanceRecords: number; credits: number };

  basicDamageMult(basicLevel: number): number;
  introEffect(introLevel: number, constellation: number): IntroOutroEffect;
  outroEffect(constellation: number): IntroOutroEffect;

  forteConfig: ForteConfig;
  forteGainPerBasic: number;

  createInitialMechanicState(): unknown;
  onSkill(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): SkillEffectResult;
  onUltimate(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): UltimateEffectResult;
  statusLineText(mechanicState: unknown): string; // renders this character's mechanic state for the battle status line

  constellationEffects: string[]; // exactly 6 entries
  maxConstellation: number;
}

export const CHARACTER_KITS: Record<string, PlayableCharacterKit> = {};
