import type { ChapterDefinition, CurrencyBundle, Difficulty } from "./types";

export interface ClearRewardPlan {
  advanceWorldLevelTo: number | null;
  grantWeaponId: string | null;
  currencies: CurrencyBundle;
}

/** What a clear pays. Only the first NORMAL clear advances the world level and grants the weapon. */
export function planClearRewards(chapter: ChapterDefinition, alreadyCleared: boolean, difficulty: Difficulty): ClearRewardPlan {
  if (!alreadyCleared && difficulty === "NORMAL") {
    return {
      advanceWorldLevelTo: chapter.clearsToWorldLevel,
      grantWeaponId: chapter.rewards.weaponId,
      currencies: chapter.rewards.firstClear,
    };
  }
  return { advanceWorldLevelTo: null, grantWeaponId: null, currencies: chapter.rewards.replay };
}
