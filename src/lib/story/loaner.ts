import { CHARACTER_KITS } from "../characterKit";
import { applyBonuses, emptyPlayerBonuses } from "../setBonus";
import type { AllyBundle } from "../../commands/rpg/dungeon";
import type { ResolvedRoster } from "../teamPositions";
import "../kits";

/** Story Bren is a fixed-stat loaner so every player plays the same flashback, owned or not. Tunable. */
export const STORY_BREN_LEVEL = 70;
export const STORY_BREN_KIT_LEVEL = 5;

export function buildLoanerBundle(characterId: string, level: number, kitLevel: number): AllyBundle {
  const kit = CHARACTER_KITS[characterId];
  if (!kit) throw new Error(`Unknown character for loaner: ${characterId}`);

  const s = kit.statsAtLevel(level);
  const bonuses = emptyPlayerBonuses(kit.element);
  const solaceStats = applyBonuses(
    { baseHp: s.hpMax, baseAtk: s.baseAtk, baseDef: s.baseDef, critRate: s.critRate, critDmg: s.critDmg, baseSpeed: s.baseSpeed },
    bonuses,
  );

  return {
    characterId, kit,
    hp: solaceStats.hp, hpMax: solaceStats.hp,
    mechanicState: kit.createInitialMechanicState(),
    basicLevel: kitLevel, skillLevel: kitLevel, ultimateLevel: kitLevel, introLevel: kitLevel, forteLevel: kitLevel,
    constellation: 0,
    solaceStats, bonuses,
  };
}

export function loanerRoster(characterId: string): ResolvedRoster {
  return { position1: characterId, position2: null, position3: null };
}
