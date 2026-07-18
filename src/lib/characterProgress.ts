// src/lib/characterProgress.ts
// Generic kit-leveling logic — persistence lookup + cost curve. Character-
// agnostic (works for any characterId), mirroring the same "generic
// primitive, character-specific data elsewhere" split established by
// forte.ts in Milestone 2c. See design spec
// docs/superpowers/specs/2026-07-12-milestone2d-kit-leveling-infra-design.md.

import prisma from "./prisma";
import { CharacterProgress } from "@prisma/client";
import { ASCENSION_LEVEL_CAP, MAX_ASCENSION_PHASE } from "./solace";

export const MAX_KIT_LEVEL = 10;

export type KitTrack = "basic" | "skill" | "ultimate" | "intro" | "forte";

// Maps a track key to its CharacterProgress column name. Exported and
// centralized here so every call site (the /character command, and
// eventually Milestone 2e's combat wiring) reads the same mapping rather
// than each hardcoding field names — a duplicate copy of this map drifting
// out of sync would be a real, easy-to-miss bug.
export const TRACK_FIELD: Record<KitTrack, "basicLevel" | "skillLevel" | "ultimateLevel" | "introLevel" | "forteLevel"> = {
  basic:    "basicLevel",
  skill:    "skillLevel",
  ultimate: "ultimateLevel",
  intro:    "introLevel",
  forte:    "forteLevel",
};

export function getTrackLevel(progress: CharacterProgress, track: KitTrack): number {
  return progress[TRACK_FIELD[track]];
}

// Cost to raise a track FROM `currentLevel` to `currentLevel + 1`, in Forging
// Ores. Isolated as its own function (not inlined in the command handler) so
// a future milestone can add the "levels 7-10 require a weekly-capped item"
// gate (design spec §3) without restructuring the leveling flow — that gate
// would likely become a second return value or a parallel check here, not a
// rewrite of every call site.
export function kitLevelUpCost(currentLevel: number): number {
  return currentLevel;
}

export function totalCostToMax(currentLevel: number): number {
  let total = 0;
  for (let l = currentLevel; l < MAX_KIT_LEVEL; l++) total += kitLevelUpCost(l);
  return total;
}

// Fetches a player's progress for a character, creating a fresh Lv1-everywhere
// row on first access rather than provisioning rows for every player upfront.
export async function getOrCreateCharacterProgress(userId: string, characterId: string): Promise<CharacterProgress> {
  const existing = await prisma.characterProgress.findUnique({
    where: { userId_characterId: { userId, characterId } },
  });
  if (existing) return existing;
  return prisma.characterProgress.create({
    data: { userId, characterId },
  });
}

export function currentLevelCap(ascensionPhase: number): number {
  return ASCENSION_LEVEL_CAP[Math.min(ascensionPhase, MAX_ASCENSION_PHASE)];
}
