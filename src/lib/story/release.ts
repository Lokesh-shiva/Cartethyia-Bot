import type { ChapterDefinition, Difficulty } from "./types";

export type StartDecision =
  | { action: "START"; difficulty: Difficulty }
  | { action: "RESUME"; runId: string }
  | { action: "DENIED"; reason: "NOT_RELEASED" | "WORLD_LEVEL" | "PREVIOUS_NOT_CLEARED" };

export function decideStart(input: {
  chapter: ChapterDefinition;
  worldLevel: number;
  clearedChapterIds: number[];
  releaseAt: Date | null;
  now: Date;
  activeRun: { id: string } | null;
  bypassRelease: boolean;
}): StartDecision {
  const { chapter, worldLevel, clearedChapterIds, releaseAt, now, activeRun, bypassRelease } = input;

  if (activeRun) return { action: "RESUME", runId: activeRun.id };

  if (!bypassRelease && (!releaseAt || releaseAt.getTime() > now.getTime())) {
    return { action: "DENIED", reason: "NOT_RELEASED" };
  }

  if (clearedChapterIds.includes(chapter.id)) return { action: "START", difficulty: "HARD" };

  if (worldLevel < chapter.requiresWorldLevel) return { action: "DENIED", reason: "WORLD_LEVEL" };

  if (chapter.id > 1 && !clearedChapterIds.includes(chapter.id - 1)) {
    return { action: "DENIED", reason: "PREVIOUS_NOT_CLEARED" };
  }

  return { action: "START", difficulty: "NORMAL" };
}

export function pickChapterToPlay(chapters: ChapterDefinition[], clearedChapterIds: number[]): ChapterDefinition {
  const ordered = [...chapters].sort((a, b) => a.id - b.id);
  const next = ordered.find(c => !clearedChapterIds.includes(c.id));
  if (next) return next;
  return ordered[ordered.length - 1]!;
}
