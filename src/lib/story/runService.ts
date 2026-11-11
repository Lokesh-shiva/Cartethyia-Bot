import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { auditAward } from "../antiCheat";
import { getWishWeapon, weaponCreateData } from "../wishWeapons";
import { newRunState } from "./runEngine";
import { planClearRewards, type ClearRewardPlan } from "./rewards";
import type { ChapterDefinition, Difficulty, PuzzleState, RunState } from "./types";

export type StoryRunRow = NonNullable<Awaited<ReturnType<typeof prisma.storyRun.findFirst>>>;

export function runStateFromRow(row: Pick<StoryRunRow, "nodeIndex" | "flags" | "hpFraction" | "allyHpFractions" | "difficulty" | "puzzle">): RunState {
  return {
    nodeIndex: row.nodeIndex,
    flags: row.flags,
    hpFraction: row.hpFraction,
    allyHpFractions: (row.allyHpFractions ?? {}) as Record<string, number>,
    difficulty: row.difficulty as Difficulty,
    puzzle: (row.puzzle ?? null) as PuzzleState | null,
  };
}

/** The user's ACTIVE or PAUSED run, so a start request resumes either. */
export async function getActiveRun(userId: string): Promise<StoryRunRow | null> {
  return prisma.storyRun.findFirst({
    where: { userId, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { startedAt: "desc" },
  });
}

export async function createRun(input: {
  userId: string; chapterId: number; difficulty: Difficulty; threadId: string; guildId: string;
}): Promise<StoryRunRow> {
  const s = newRunState(input.difficulty);
  return prisma.storyRun.create({
    data: {
      userId: input.userId, chapterId: input.chapterId, difficulty: input.difficulty,
      threadId: input.threadId, guildId: input.guildId,
      nodeIndex: s.nodeIndex, flags: s.flags, hpFraction: s.hpFraction,
      allyHpFractions: s.allyHpFractions as Prisma.InputJsonValue,
    },
  });
}

export async function saveRunState(runId: string, state: RunState): Promise<void> {
  await prisma.storyRun.update({
    where: { id: runId },
    data: {
      nodeIndex: state.nodeIndex, flags: state.flags, hpFraction: state.hpFraction,
      allyHpFractions: state.allyHpFractions as Prisma.InputJsonValue,
      puzzle: state.puzzle ? (state.puzzle as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

export async function pauseRun(runId: string): Promise<void> {
  await prisma.storyRun.updateMany({ where: { id: runId, status: "ACTIVE" }, data: { status: "PAUSED", pausedAt: new Date() } });
}

export async function resumeRun(runId: string): Promise<void> {
  await prisma.storyRun.updateMany({ where: { id: runId, status: "PAUSED" }, data: { status: "ACTIVE", pausedAt: null } });
}

export async function failRun(runId: string): Promise<void> {
  await prisma.storyRun.updateMany({ where: { id: runId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "FAILED" } });
}

export async function getClearedChapterIds(userId: string): Promise<number[]> {
  const rows = await prisma.storyProgress.findMany({ where: { userId }, select: { chapterId: true } });
  return rows.map(r => r.chapterId);
}

export interface CompleteResult {
  firstClear: boolean;
  /** True when this run had already been completed (a double click or retry): nothing was paid again. */
  alreadyCompleted: boolean;
  plan: ClearRewardPlan | null;
}

/**
 * Completes a run and pays out exactly once. Two atomic claims inside one transaction:
 * the run row (ACTIVE/PAUSED -> COMPLETE) so a run pays once, and the StoryProgress row
 * (skipDuplicates) so only the first NORMAL clear advances the world level and grants the weapon.
 */
export async function completeRun(runId: string, chapter: ChapterDefinition): Promise<CompleteResult> {
  const run = await prisma.storyRun.findUnique({ where: { id: runId } });
  if (!run) return { firstClear: false, alreadyCompleted: true, plan: null };
  const difficulty = run.difficulty as Difficulty;

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.storyRun.updateMany({
      where: { id: runId, status: { in: ["ACTIVE", "PAUSED"] } },
      data: { status: "COMPLETE", pausedAt: null },
    });
    if (claimed.count === 0) return null;

    const firstClear = difficulty === "NORMAL"
      ? (await tx.storyProgress.createMany({ data: [{ userId: run.userId, chapterId: chapter.id }], skipDuplicates: true })).count === 1
      : false;
    const plan = planClearRewards(chapter, !firstClear, difficulty);

    if (plan.advanceWorldLevelTo !== null) {
      await tx.user.updateMany({
        where: { id: run.userId, worldLevel: { lt: plan.advanceWorldLevelTo } },
        data: { worldLevel: plan.advanceWorldLevelTo },
      });
    }
    if (plan.grantWeaponId) {
      const weapon = getWishWeapon(plan.grantWeaponId);
      if (weapon) await tx.weapon.create({ data: weaponCreateData(run.userId, weapon) });
    }
    await tx.user.update({
      where: { id: run.userId },
      data: {
        credits: { increment: plan.currencies.credits },
        fractonite: { increment: plan.currencies.fractonite },
        emberShards: { increment: plan.currencies.emberShards },
      },
    });
    return { firstClear, plan };
  });

  if (!result) return { firstClear: false, alreadyCompleted: true, plan: null };

  auditAward(run.userId, { credits: result.plan.currencies.credits, fractonite: result.plan.currencies.fractonite }, "story").catch(() => {});
  return { firstClear: result.firstClear, alreadyCompleted: false, plan: result.plan };
}
