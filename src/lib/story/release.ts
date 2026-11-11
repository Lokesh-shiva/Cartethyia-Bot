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

/** Chapter ids whose release time has passed and that have not been announced yet. */
export function selectAnnouncements(rows: { chapterId: number; releaseAt: Date; announcedAt: Date | null }[], now: Date): number[] {
  return rows.filter(r => r.releaseAt.getTime() <= now.getTime() && !r.announcedAt).map(r => r.chapterId);
}

/** A release can be (re)scheduled only while it has not already gone live. */
export function canReschedule(row: { releaseAt: Date } | null, now: Date): boolean {
  return !row || row.releaseAt.getTime() > now.getTime();
}

/** ACTIVE runs idle longer than idleMs whose owner is not mid-fight. */
export function selectIdleRuns(
  runs: { id: string; userId: string; status: string; updatedAt: Date }[],
  now: Date, idleMs: number, userIdsInFight: Set<string>,
): string[] {
  return runs
    .filter(r => r.status === "ACTIVE" && now.getTime() - r.updatedAt.getTime() > idleMs && !userIdsInFight.has(r.userId))
    .map(r => r.id);
}
