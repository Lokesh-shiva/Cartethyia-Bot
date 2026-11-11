import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAnnouncements, canReschedule, selectIdleRuns } from "./release";

const now = new Date("2026-12-01T12:00:00Z");
const past = new Date("2026-11-30T12:00:00Z");
const future = new Date("2026-12-05T12:00:00Z");

test("selectAnnouncements returns only released, unannounced chapters", () => {
  const ids = selectAnnouncements([
    { chapterId: 1, releaseAt: past, announcedAt: null },
    { chapterId: 2, releaseAt: past, announcedAt: past },
    { chapterId: 3, releaseAt: future, announcedAt: null },
    { chapterId: 4, releaseAt: now, announcedAt: null },
  ], now);
  assert.deepEqual(ids, [1, 4]);
});

test("canReschedule is false once released, true for no row or a future release", () => {
  assert.equal(canReschedule(null, now), true);
  assert.equal(canReschedule({ releaseAt: future }, now), true);
  assert.equal(canReschedule({ releaseAt: past }, now), false);
});

test("selectIdleRuns picks idle ACTIVE runs not in a fight, never other statuses", () => {
  const idleMs = 30 * 60 * 1000;
  const old = new Date(now.getTime() - 31 * 60 * 1000);
  const fresh = new Date(now.getTime() - 5 * 60 * 1000);
  const ids = selectIdleRuns([
    { id: "a", userId: "u1", status: "ACTIVE", updatedAt: old },
    { id: "b", userId: "u2", status: "ACTIVE", updatedAt: fresh },
    { id: "c", userId: "u3", status: "ACTIVE", updatedAt: old },
    { id: "d", userId: "u4", status: "PAUSED", updatedAt: old },
    { id: "e", userId: "u5", status: "COMPLETE", updatedAt: old },
    { id: "f", userId: "u6", status: "FAILED", updatedAt: old },
  ], now, idleMs, new Set(["u3"]));
  assert.deepEqual(ids, ["a"]);
});
