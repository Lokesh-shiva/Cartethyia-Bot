// src/lib/alphaRaidBoss.ts
// Builds a RaidBossConfig from a playable character's real kit — Alpha
// Raid's boss is that character, boss-scaled, not a generic raid boss. Move
// effects are deliberately generic (not each character's actual bespoke
// kit result type — those differ per character and are hand-wired into all
// 6 combat loops individually, not safe to re-simulate generically here);
// only the NAME/element/flavor is real, the mechanical effect is a flat
// kit-tier debuff applied by raid.ts's boss counter-attack block when it
// sees the "ALPHA_SKILL_DEBUFF"/"ALPHA_ULT_DEBUFF" effect marker.
import path from "path";
import { CHARACTER_KITS } from "./characterKit";
import "./kits";
import { COUNTER_ELEMENT } from "./combat";
import { RaidBossConfig } from "../commands/rpg/raid";

export function buildAlphaRaidBoss(characterId: string): RaidBossConfig | null {
  const kit = CHARACTER_KITS[characterId];
  if (!kit) return null;

  return {
    id:      `alpha_${characterId}`,
    name:    kit.label,
    title:   `${kit.label}, Unleashed`,
    element: kit.element,
    weakness: COUNTER_ELEMENT[kit.element] ?? "NONE",
    artFile: "", // unused for Alpha Raid — launchRaid uses alphaRaidBossArtPath() instead
    baseHp: 0, baseAtk: 0, baseDef: 0, vibBar: 0, // unused — computeRaidBossStats() is purely party-derived, ignores these
    moves: [
      { name: `${kit.label}'s Basic Attack`, damage: 1.0, effect: "none" },
      { name: `${kit.label}'s Skill`,        damage: 1.3, effect: "ALPHA_SKILL_DEBUFF" },
      { name: `${kit.label}'s Ultimate`,     damage: 1.6, effect: "ALPHA_ULT_DEBUFF" },
    ],
    defeatLoot: {
      credits: 52_500, tuningModules: 42, sealingTubes: 33,
      forgingOres: 30, paradoxCores: 21, resonanceExp: 12_000,
    },
  };
}

/** Absolute path to the character's own portrait — used as the boss art since Alpha bosses have no dedicated art in Bosses/. */
export function alphaRaidBossArtPath(characterId: string): string | null {
  const kit = CHARACTER_KITS[characterId];
  if (!kit) return null;
  return path.join(process.cwd(), kit.portraitPath);
}
