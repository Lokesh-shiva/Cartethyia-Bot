import { TwoPcEffect } from "./setBonus";

export type NamedSetId =
  | "SMOLDERING_SOVEREIGN" | "FROSTVEIL_BASTION" | "STORMCALLERS_OATH"
  | "WINDSTRIDERS_LEGACY"  | "VOIDBORN_REMNANT"  | "RADIANT_CONVERGENCE";

export interface NamedSetInfo {
  id:      NamedSetId;
  name:    string;
  element: string;
}

export const NAMED_SETS: Record<NamedSetId, NamedSetInfo> = {
  SMOLDERING_SOVEREIGN: { id: "SMOLDERING_SOVEREIGN", name: "Smoldering Sovereign", element: "FUSION" },
  FROSTVEIL_BASTION:    { id: "FROSTVEIL_BASTION",    name: "Frostveil Bastion",    element: "GLACIO" },
  STORMCALLERS_OATH:    { id: "STORMCALLERS_OATH",    name: "Stormcaller's Oath",   element: "ELECTRO" },
  WINDSTRIDERS_LEGACY:  { id: "WINDSTRIDERS_LEGACY",  name: "Windstrider's Legacy", element: "AERO" },
  VOIDBORN_REMNANT:     { id: "VOIDBORN_REMNANT",     name: "Voidborn Remnant",     element: "HAVOC" },
  RADIANT_CONVERGENCE:  { id: "RADIANT_CONVERGENCE",  name: "Radiant Convergence",  element: "SPECTRO" },
};

// ── 2pc — simple stat bonuses, reuse the existing TwoPcEffect shape ──────────
export const NAMED_TWO_PC: Record<NamedSetId, TwoPcEffect> = {
  SMOLDERING_SOVEREIGN: { label: "Smoldering Sovereign 2pc — +12% Fusion DMG",         atkMult: 1.0, hpMult: 1.0, defMult: 1.0, critRateBonus: 0,    energyBonus: 0,  lifesteal: 0    },
  FROSTVEIL_BASTION:    { label: "Frostveil Bastion 2pc — +15% DEF · +8% Glacio DMG",  atkMult: 1.0, hpMult: 1.0, defMult: 1.15, critRateBonus: 0,    energyBonus: 0,  lifesteal: 0    },
  STORMCALLERS_OATH:    { label: "Stormcaller's Oath 2pc — +10% Electro DMG · +10 Energy/turn", atkMult: 1.0, hpMult: 1.0, defMult: 1.0, critRateBonus: 0, energyBonus: 10, lifesteal: 0 },
  WINDSTRIDERS_LEGACY:  { label: "Windstrider's Legacy 2pc — +10% Aero DMG",           atkMult: 1.0, hpMult: 1.0, defMult: 1.0, critRateBonus: 0,    energyBonus: 0,  lifesteal: 0    },
  VOIDBORN_REMNANT:     { label: "Voidborn Remnant 2pc — +10% Lifesteal · +8% Havoc DMG", atkMult: 1.0, hpMult: 1.0, defMult: 1.0, critRateBonus: 0, energyBonus: 0,  lifesteal: 0.10 },
  RADIANT_CONVERGENCE:  { label: "Radiant Convergence 2pc — +12% HP · +8% Spectro DMG", atkMult: 1.0, hpMult: 1.12, defMult: 1.0, critRateBonus: 0,   energyBonus: 0,  lifesteal: 0    },
};

// Note: the "+8%/+10%/+12% element DMG" portions of each 2pc label above are NOT yet
// wired into elemDmgBonus — that requires an elemDmgBonus field on TwoPcEffect, which
// doesn't exist on the current shared shape. The consumer of this file (setBonus.ts)
// handles this by special-casing NAMED_ELEM_DMG_2PC below rather than touching the
// shared TwoPcEffect interface used by the original 6 plain-element sets.
export const NAMED_ELEM_DMG_2PC: Record<NamedSetId, number> = {
  SMOLDERING_SOVEREIGN: 0.12,
  FROSTVEIL_BASTION:    0.08,
  STORMCALLERS_OATH:    0.10,
  WINDSTRIDERS_LEGACY:  0.10,
  VOIDBORN_REMNANT:     0.08,
  RADIANT_CONVERGENCE:  0.08,
};

// ── Player-facing reference text — used by /echo, /echoes, and /guide so
// players can see what a set actually does before they've farmed 4-5 pieces
// of it (the 4pc/5pc mechanics themselves only currently activate in
// /field-boss combat). Kept as plain strings here rather than derived from
// the pure functions above, since those encode behavior, not prose.
export interface NamedSetDescription {
  twoPc:   string;
  fourPc:  string;
  fivePc:  string;
}

export const NAMED_SET_DESCRIPTIONS: Record<NamedSetId, NamedSetDescription> = {
  SMOLDERING_SOVEREIGN: {
    twoPc:  "+12% Fusion DMG",
    fourPc: "Each consecutive action increases ATK by 6%, stacking up to 4×. Taking damage resets all stacks.",
    fivePc: "When ATK stacks reach 4×, the next Skill hits twice and deals +30% bonus Fusion DMG. Stacks reset after trigger.",
  },
  FROSTVEIL_BASTION: {
    twoPc:  "+15% DEF · +8% Glacio DMG",
    fourPc: "Taking a hit has a 30% chance to trigger Counter-Frost: drain 20% enemy vibration. 3-turn internal cooldown.",
    fivePc: "The first time HP drops below 60%, gain a shield (+28% max HP) and +22% Glacio DMG for 4 turns. Once per fight.",
  },
  STORMCALLERS_OATH: {
    twoPc:  "+10% Electro DMG · +10 Energy/turn",
    fourPc: "After using Ultimate, gain +40 Energy instantly and +15% Crit Rate for 3 turns.",
    fivePc: "When Energy reaches its cap, the next Basic Attack triggers Thunderbolt — 80% ATK bonus Electro DMG and restores 20 Energy. Resets after trigger.",
  },
  WINDSTRIDERS_LEGACY: {
    twoPc:  "+10% Aero DMG",
    fourPc: "Each hit adds a Windstack (+5% DMG each, up to 6×). Stacks persist until Gale Explosion fires or you take a big hit.",
    fivePc: "At 6 Windstacks, the next attack is a guaranteed Crit dealing +120% bonus Aero DMG. Stacks reset after trigger.",
  },
  VOIDBORN_REMNANT: {
    twoPc:  "+10% Lifesteal · +8% Havoc DMG",
    fourPc: "Shatter effects deal +60% ATK bonus Havoc DMG and heal 15% HP.",
    fivePc: "The first time HP falls below 35%, gain +25% ATK, +15% Lifesteal, and ignore 20% enemy DEF for 4 turns. Once per fight.",
  },
  RADIANT_CONVERGENCE: {
    twoPc:  "+12% HP · +8% Spectro DMG",
    fourPc: "Heal 3% max HP each turn. Each heal adds +3% Spectro DMG, stacking up to 5×. Taking a big hit resets stacks.",
    fivePc: "At full HP, every Crit applies Radiant Fracture to the enemy (+10% DMG taken from all sources, 3 turns, refreshes on Crit). Below 50% HP, active Fracture stacks burst-heal you.",
  },
};

// ── Per-fight mutable state for 4pc/5pc mechanics ────────────────────────────
// Combat loops create ONE of these per fight (via initNamedSetState) and pass it
// into the hook functions below for every player action. Nothing here is read from
// the DB — it only exists for the duration of a single combat session.
export interface NamedSetState {
  fusionAtkStacks:       number;  // Smoldering Sovereign 4pc — consecutive-action ATK stacks (max 4)
  fusionSkillDoubleArmed:boolean; // Smoldering Sovereign 5pc — true once 4 stacks reached, consumed on next Skill
  glacioCounterCd:       number;  // Frostveil Bastion 4pc — turns until Counter-Frost can proc again
  glacioShieldUsed:      boolean; // Frostveil Bastion 5pc — once-per-fight panic shield
  electroThunderboltArmed: boolean; // Stormcaller's Oath 5pc — true once energy reaches 100 (cap), consumed on next Basic
  aeroWindstacks:        number;  // Windstrider's Legacy 4pc — momentum stacks (max 6)
  havocFrenzyUsed:       boolean; // Voidborn Remnant 5pc — once-per-fight low-HP frenzy
  havocFrenzyTurnsLeft:  number;  // turns remaining on active frenzy
  spectroHealStacks:     number;  // Radiant Convergence 4pc — heal-chain DMG stacks (max 5)
  spectroFractureTurnsLeft: number; // Radiant Convergence 5pc — Radiant Fracture debuff duration
}

export function initNamedSetState(): NamedSetState {
  return {
    fusionAtkStacks: 0, fusionSkillDoubleArmed: false,
    glacioCounterCd: 0, glacioShieldUsed: false,
    electroThunderboltArmed: false,
    aeroWindstacks: 0,
    havocFrenzyUsed: false, havocFrenzyTurnsLeft: 0,
    spectroHealStacks: 0, spectroFractureTurnsLeft: 0,
  };
}

// ── Smoldering Sovereign (Fusion) ─────────────────────────────────────────────
// 4pc: +6% ATK per consecutive action, max 4 stacks. Taking damage resets to 0.
// 5pc: at 4 stacks, next Skill hits twice + 30% bonus Fusion DMG, then resets.
export function smolderingSovereignOnAction(state: NamedSetState): number {
  state.fusionAtkStacks = Math.min(4, state.fusionAtkStacks + 1);
  if (state.fusionAtkStacks === 4) state.fusionSkillDoubleArmed = true;
  return 1 + state.fusionAtkStacks * 0.06; // ATK multiplier to apply this action
}
export function smolderingSovereignOnDamageTaken(state: NamedSetState): void {
  state.fusionAtkStacks = 0;
  state.fusionSkillDoubleArmed = false;
}
export function smolderingSovereignOnSkill(state: NamedSetState): { doubleHit: boolean; bonusMult: number } {
  if (!state.fusionSkillDoubleArmed) return { doubleHit: false, bonusMult: 1.0 };
  state.fusionSkillDoubleArmed = false;
  state.fusionAtkStacks = 0;
  return { doubleHit: true, bonusMult: 1.30 };
}

// ── Frostveil Bastion (Glacio) ────────────────────────────────────────────────
// 4pc: 30% chance on being hit (if off cooldown) to drain 20% enemy vibration, 3-turn cooldown.
// 5pc: first time HP drops below 60%, shield 28% max HP + Glacio DMG +22% for 4 turns, once per fight.
export function frostveilBastionOnHitTaken(state: NamedSetState): { counterProc: boolean; vibDrain: number } {
  if (state.glacioCounterCd > 0) { state.glacioCounterCd--; return { counterProc: false, vibDrain: 0 }; }
  if (Math.random() < 0.30) {
    state.glacioCounterCd = 3;
    return { counterProc: true, vibDrain: 0.20 };
  }
  return { counterProc: false, vibDrain: 0 };
}
export function frostveilBastionCheckPanicShield(
  state: NamedSetState, currentHp: number, maxHp: number,
): { triggered: boolean; shieldAmount: number; elemDmgBonus: number; turnsLeft: number } {
  if (state.glacioShieldUsed || currentHp / maxHp >= 0.60) {
    return { triggered: false, shieldAmount: 0, elemDmgBonus: 0, turnsLeft: 0 };
  }
  state.glacioShieldUsed = true;
  return { triggered: true, shieldAmount: Math.floor(maxHp * 0.28), elemDmgBonus: 0.22, turnsLeft: 4 };
}

// ── Stormcaller's Oath (Electro) ──────────────────────────────────────────────
// 4pc: after Ultimate, +40 Energy instantly + Crit Rate +15% for 3 turns.
// 5pc: when Energy reaches its cap (100 — combat loops hard-cap energy at 100, so
// "exceeds 120" from the original design text is unreachable in practice), next Basic
// triggers Thunderbolt (80% ATK bonus dmg + restore 20 Energy), resets.
export function stormcallersOathOnUltimate(): { bonusEnergy: number; critRateBonus: number; turnsLeft: number } {
  return { bonusEnergy: 40, critRateBonus: 0.15, turnsLeft: 3 };
}
export function stormcallersOathCheckThunderbolt(state: NamedSetState, currentEnergy: number): boolean {
  if (currentEnergy >= 100) state.electroThunderboltArmed = true;
  return state.electroThunderboltArmed;
}
export function stormcallersOathOnBasic(state: NamedSetState): { proc: boolean; bonusMult: number; bonusEnergy: number } {
  if (!state.electroThunderboltArmed) return { proc: false, bonusMult: 1.0, bonusEnergy: 0 };
  state.electroThunderboltArmed = false;
  return { proc: true, bonusMult: 0.80, bonusEnergy: 20 };
}

// ── Windstrider's Legacy (Aero) ────────────────────────────────────────────────
// 4pc: each hit adds a Windstack (+5% DMG each, max 6). Stacks persist until Gale
//      Explosion fires OR the player takes damage exceeding 25% max HP in one hit
//      (deliberately NOT a per-stack timer — an individual 2-turn expiry makes 6
//      stacks mathematically unreachable in a 1-action-per-turn combat loop).
// 5pc: at 6 stacks, next attack is guaranteed crit + 120% ATK bonus Aero DMG, stacks reset.
export function windstridersLegacyOnHit(state: NamedSetState): number {
  state.aeroWindstacks = Math.min(6, state.aeroWindstacks + 1);
  return 1 + state.aeroWindstacks * 0.05; // DMG multiplier for the NEXT hit
}
export function windstridersLegacyOnBigHitTaken(state: NamedSetState, dmgTaken: number, maxHp: number): void {
  if (dmgTaken > maxHp * 0.25) state.aeroWindstacks = 0;
}
export function windstridersLegacyCheckExplosion(state: NamedSetState): { proc: boolean; guaranteedCrit: boolean; bonusMult: number } {
  if (state.aeroWindstacks < 6) return { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
  state.aeroWindstacks = 0;
  return { proc: true, guaranteedCrit: true, bonusMult: 1.20 };
}

// ── Voidborn Remnant (Havoc) ───────────────────────────────────────────────────
// 4pc: Shatter deals +60% ATK bonus Havoc DMG and heals 15% HP.
// 5pc: first time HP falls below 35%, ATK +25%, Lifesteal +15%, ignore 20% enemy
//      DEF for 4 turns, once per fight.
export function voidbornRemnantOnShatter(): { bonusMult: number; healPct: number } {
  return { bonusMult: 0.60, healPct: 0.15 };
}
export function voidbornRemnantCheckFrenzy(
  state: NamedSetState, currentHp: number, maxHp: number,
): { triggered: boolean; atkMult: number; lifesteal: number; defIgnorePct: number } {
  if (state.havocFrenzyUsed || currentHp / maxHp >= 0.35) {
    return { triggered: false, atkMult: 1.0, lifesteal: 0, defIgnorePct: 0 };
  }
  state.havocFrenzyUsed = true;
  state.havocFrenzyTurnsLeft = 4;
  return { triggered: true, atkMult: 1.25, lifesteal: 0.15, defIgnorePct: 0.20 };
}
export function voidbornRemnantFrenzyActive(state: NamedSetState): boolean {
  if (state.havocFrenzyTurnsLeft <= 0) return false;
  state.havocFrenzyTurnsLeft--;
  return true;
}

// ── Radiant Convergence (Spectro) ─────────────────────────────────────────────
// 4pc: heal 3% max HP each turn; each heal adds +3% Spectro DMG, stacking up to 5x.
//      Taking a hit above 20% max HP resets stacks.
// 5pc: at full HP, every Crit applies Radiant Fracture (enemy takes +10% DMG from all
//      sources for 3 turns, refreshes on Crit). When HP drops below 50%, all fracture
//      stacks burst-heal 6% HP each (consumed once per crossing).
export function radiantConvergenceOnTurnHeal(state: NamedSetState, maxHp: number, healingBonus: number = 0): { healAmount: number; dmgMult: number } {
  state.spectroHealStacks = Math.min(5, state.spectroHealStacks + 1);
  return { healAmount: Math.floor(maxHp * 0.03 * (1 + healingBonus)), dmgMult: 1 + state.spectroHealStacks * 0.03 };
}
export function radiantConvergenceOnHitTaken(state: NamedSetState, dmgTaken: number, maxHp: number): void {
  if (dmgTaken > maxHp * 0.20) state.spectroHealStacks = 0;
}
export function radiantConvergenceOnCrit(state: NamedSetState, currentHp: number, maxHp: number): boolean {
  if (currentHp < maxHp) return false;
  state.spectroFractureTurnsLeft = 3 + 1; // +1 compensates for the same-round decrement that fires immediately after this triggers (same pattern/reason as Frostveil Bastion's shield and Stormcaller's Oath's crit buff)
  return true; // caller applies "+10% dmg taken" debuff to the enemy for 3 turns
}
export function radiantConvergenceCheckBurstHeal(
  state: NamedSetState, currentHp: number, maxHp: number, healingBonus: number = 0,
): number {
  if (state.spectroFractureTurnsLeft <= 0 || currentHp / maxHp >= 0.50) return 0;
  const healAmount = Math.floor(maxHp * 0.06 * state.spectroFractureTurnsLeft * (1 + healingBonus));
  state.spectroFractureTurnsLeft = 0;
  return healAmount;
}
