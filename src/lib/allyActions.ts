// src/lib/allyActions.ts
// Composable ally-targeted action primitives — what Intro/Outro Skills and support
// kits (e.g. Solace's Attunement) are built FROM. See design spec §4.3.
// These are pure result-computers; callers (future combat-loop wiring in later
// milestones) are responsible for clamping hp to hpMax, applying shield/buff state,
// and calling debuffs.ts's cleanseDebuffs() with the returned cleanseCount.

export type AllyActionType = "HEAL_ALLY" | "SHIELD_ALLY" | "BUFF_ALLY_ATK" | "BUFF_ALLY_CRIT_RATE" | "CLEANSE_ALLY";

export interface AllyAction {
  type:  AllyActionType;
  // HEAL_ALLY / SHIELD_ALLY: fraction of target's max HP.
  // BUFF_ALLY_ATK / BUFF_ALLY_CRIT_RATE: fraction bonus (ATK% or Crit Rate).
  // CLEANSE_ALLY: number of debuffs to remove.
  value: number;
}

export interface AllyActionTarget {
  hp:    number;
  hpMax: number;
}

export interface AllyActionResult {
  hpDelta:      number; // heal amount — caller adds to target.hp and clamps to hpMax
  shieldDelta:  number; // shield amount to grant
  atkBuffPct:   number; // ATK% buff to apply to target
  critRateBuffPct: number; // Crit Rate buff to apply to target
  cleanseCount: number; // debuff count to remove via debuffs.ts's cleanseDebuffs()
}

export function applyAllyAction(action: AllyAction, target: AllyActionTarget): AllyActionResult {
  const result: AllyActionResult = { hpDelta: 0, shieldDelta: 0, atkBuffPct: 0, critRateBuffPct: 0, cleanseCount: 0 };
  switch (action.type) {
    case "HEAL_ALLY":
      result.hpDelta = Math.floor(target.hpMax * action.value);
      break;
    case "SHIELD_ALLY":
      result.shieldDelta = Math.floor(target.hpMax * action.value);
      break;
    case "BUFF_ALLY_ATK":
      result.atkBuffPct = action.value;
      break;
    case "BUFF_ALLY_CRIT_RATE":
      result.critRateBuffPct = action.value;
      break;
    case "CLEANSE_ALLY":
      result.cleanseCount = action.value;
      break;
  }
  return result;
}
