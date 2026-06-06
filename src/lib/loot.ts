import { ActionCategory } from "./gifs";
import { awardUser, incrementAffinity } from "./economy";
import { CE } from "./emojiManager";

export interface LootResult {
  credits:          number;
  tuningModules:    number;
  sealingTubes:     number;
  forgingOres:      number;
  resonanceExp:     number;
  resonanceRecords: number;
  isMultiplied:     boolean;
}

const BASE_LOOT: Record<ActionCategory, () => Omit<LootResult, "isMultiplied">> = {
  // Physical → Echo upgrade materials
  physical: () => ({
    credits:          Math.floor(Math.random() * 8)  + 2,
    tuningModules:    Math.random() < 0.45 ? 1 : 0,
    sealingTubes:     Math.random() < 0.20 ? 1 : 0,
    forgingOres:      Math.random() < 0.15 ? 1 : 0,
    resonanceExp:     Math.floor(Math.random() * 5)  + 3,
    resonanceRecords: Math.random() < 0.05 ? 1 : 0,  // 5% rare drop
  }),
  // Expressive → Credits + chance at Records
  expressive: () => ({
    credits:          Math.floor(Math.random() * 20) + 10,
    tuningModules:    0,
    sealingTubes:     0,
    forgingOres:      0,
    resonanceExp:     Math.floor(Math.random() * 3)  + 1,
    resonanceRecords: Math.random() < 0.12 ? 1 : 0,  // 12% — expressive self-acts reward self
  }),
  // Emotional → EXP focus
  emotional: () => ({
    credits:          Math.floor(Math.random() * 4)  + 1,
    tuningModules:    0,
    sealingTubes:     0,
    forgingOres:      0,
    resonanceExp:     Math.floor(Math.random() * 8)  + 5,
    resonanceRecords: Math.random() < 0.08 ? 1 : 0,  // 8%
  }),
};

/**
 * Roll loot for an interaction.
 * @param isReturn  Whether this is a "return action" (2x multiplier)
 */
export function rollLoot(category: ActionCategory, isReturn = false): LootResult {
  const base = BASE_LOOT[category]();
  if (!isReturn) return { ...base, isMultiplied: false };

  return {
    credits:          base.credits          * 2,
    tuningModules:    base.tuningModules    * 2,
    sealingTubes:     base.sealingTubes     * 2,
    forgingOres:      base.forgingOres      * 2,
    resonanceExp:     base.resonanceExp     * 2,
    resonanceRecords: base.resonanceRecords * 2,
    isMultiplied:     true,
  };
}

export async function applyLoot(userId: string, loot: LootResult): Promise<string> {
  await awardUser(userId, {
    credits:          loot.credits,
    tuningModules:    loot.tuningModules,
    sealingTubes:     loot.sealingTubes,
    forgingOres:      loot.forgingOres,
    resonanceExp:     loot.resonanceExp,
    resonanceRecords: loot.resonanceRecords,
  });

  const parts: string[] = [];
  if (loot.credits          > 0) parts.push(`${CE.cr} ${loot.credits} Credits`);
  if (loot.tuningModules    > 0) parts.push(`${CE.tm} ${loot.tuningModules} Tuning Module`);
  if (loot.sealingTubes     > 0) parts.push(`${CE.st} ${loot.sealingTubes} Sealing Tube`);
  if (loot.forgingOres      > 0) parts.push(`${CE.fo} ${loot.forgingOres} Forging Ore`);
  if (loot.resonanceRecords > 0) parts.push(`${CE.rr} ${loot.resonanceRecords} Resonance Record`);
  if (loot.resonanceExp     > 0) parts.push(`✨ ${loot.resonanceExp} EXP`);

  const prefix = loot.isMultiplied ? "⚡ **2x BONUS** · " : "";
  return prefix + (parts.join("  ·  ") || "Nothing dropped.");
}

/**
 * Handle all rewards for a social interaction (loot + affinity).
 */
export async function processInteractionRewards(
  actorId:   string,
  targetId:  string | null,
  category:  ActionCategory,
  isReturn = false
): Promise<LootResult> {
  const loot = rollLoot(category, isReturn);

  // Award actor
  await applyLoot(actorId, loot);

  // If targeted, also award the target (smaller amount) and increment affinity
  if (targetId && targetId !== actorId) {
    const targetLoot = rollLoot(category, isReturn);
    await applyLoot(targetId, targetLoot);
    await incrementAffinity(actorId, targetId, isReturn ? 20 : 10);
  }

  return loot;
}
