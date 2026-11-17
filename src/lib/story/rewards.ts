import type { ChapterDefinition, CurrencyBundle, Difficulty } from "./types";

export const MAX_WEAPON_REFINEMENT = 5;

export interface ClearRewardPlan {
  advanceWorldLevelTo: number | null;
  /** First-clear weapon. */
  grantWeaponId: string | null;
  /** Hard replays offer one more copy (for /weapon-refine) while the player is below R5 worth of copies. */
  grantWeaponCopyId: string | null;
  currencies: CurrencyBundle;
}

/** What a clear pays. Only the first NORMAL clear advances the world level and grants the weapon; Hard replays offer a refinement copy. */
export function planClearRewards(chapter: ChapterDefinition, alreadyCleared: boolean, difficulty: Difficulty): ClearRewardPlan {
  if (!alreadyCleared && difficulty === "NORMAL") {
    return {
      advanceWorldLevelTo: chapter.clearsToWorldLevel,
      grantWeaponId: chapter.rewards.weaponId,
      grantWeaponCopyId: null,
      currencies: chapter.rewards.firstClear,
    };
  }
  return {
    advanceWorldLevelTo: null,
    grantWeaponId: null,
    grantWeaponCopyId: difficulty === "HARD" ? chapter.rewards.weaponId : null,
    currencies: chapter.rewards.replay,
  };
}

/** Each weapon row's refinement counts as that many merged copies; stop granting at R5 worth. */
export function needsWeaponCopy(refinements: number[]): boolean {
  return refinements.reduce((sum, r) => sum + r, 0) < MAX_WEAPON_REFINEMENT;
}
