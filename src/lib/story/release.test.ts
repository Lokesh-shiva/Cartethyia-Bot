import { test } from "node:test";
import assert from "node:assert/strict";
import { decideStart, pickChapterToPlay } from "./release";
import type { ChapterDefinition } from "./types";

const zero = { credits: 0, fractonite: 0, emberShards: 0 };

function chapter(id: number, requiresWorldLevel = 8 + id): ChapterDefinition {
  return {
    id, title: `Ch ${id}`, blurb: "", requiresWorldLevel, clearsToWorldLevel: requiresWorldLevel + 1,
    enemyWorldLevel: requiresWorldLevel + 1, hardModeMult: 1.4, nodes: [],
    rewards: { weaponId: "x", firstClear: zero, replay: zero },
  };
}

const now = new Date("2026-11-11T12:00:00Z");
const past = new Date("2026-11-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");

const base = {
  chapter: chapter(1), worldLevel: 9, clearedChapterIds: [] as number[],
  releaseAt: past as Date | null, now, activeRun: null as { id: string } | null, bypassRelease: false,
};

test("decideStart resumes an active run even when gating would now deny", () => {
  const d = decideStart({ ...base, releaseAt: null, worldLevel: 1, activeRun: { id: "run1" } });
  assert.deepEqual(d, { action: "RESUME", runId: "run1" });
});

test("decideStart denies NOT_RELEASED with no releaseAt or a future one", () => {
  assert.deepEqual(decideStart({ ...base, releaseAt: null }), { action: "DENIED", reason: "NOT_RELEASED" });
  assert.deepEqual(decideStart({ ...base, releaseAt: future }), { action: "DENIED", reason: "NOT_RELEASED" });
});

test("decideStart bypassRelease skips the release check", () => {
  assert.deepEqual(decideStart({ ...base, releaseAt: null, bypassRelease: true }), { action: "START", difficulty: "NORMAL" });
});

test("decideStart denies WORLD_LEVEL below the chapter requirement", () => {
  assert.deepEqual(decideStart({ ...base, worldLevel: 8 }), { action: "DENIED", reason: "WORLD_LEVEL" });
});

test("decideStart denies PREVIOUS_NOT_CLEARED for chapter 2 with chapter 1 uncleared", () => {
  const d = decideStart({ ...base, chapter: chapter(2), worldLevel: 10, clearedChapterIds: [] });
  assert.deepEqual(d, { action: "DENIED", reason: "PREVIOUS_NOT_CLEARED" });
});

test("decideStart starts HARD for a cleared chapter without a world-level check", () => {
  const d = decideStart({ ...base, worldLevel: 10, clearedChapterIds: [1] });
  assert.deepEqual(d, { action: "START", difficulty: "HARD" });
  const low = decideStart({ ...base, worldLevel: 1, clearedChapterIds: [1] });
  assert.deepEqual(low, { action: "START", difficulty: "HARD" });
});

test("decideStart starts NORMAL when eligible and uncleared", () => {
  assert.deepEqual(decideStart(base), { action: "START", difficulty: "NORMAL" });
});

test("pickChapterToPlay returns the first uncleared chapter, else the highest cleared", () => {
  const ch1 = chapter(1), ch2 = chapter(2);
  assert.equal(pickChapterToPlay([ch1, ch2], [1]).id, 2);
  assert.equal(pickChapterToPlay([ch1], [1]).id, 1);
  assert.equal(pickChapterToPlay([ch1, ch2], [1, 2]).id, 2);
});
