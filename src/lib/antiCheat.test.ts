import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAwardFlags } from "./antiCheat";

test("a rich player earning a normal award is not flagged for their total balance", () => {
  const flags = computeAwardFlags({ rewards: { credits: 520 }, source: "dungeon", worldLevel: 9, recentAwardCount: 1 });
  assert.deepEqual(flags, []);
});

test("an award spike above the world-level threshold is still flagged", () => {
  const flags = computeAwardFlags({ rewards: { credits: 90_000 }, source: "dungeon", worldLevel: 9, recentAwardCount: 1 });
  assert.equal(flags.length, 1);
  assert.match(flags[0]!, /large single award/);
});

test("the story's fixed first-clear payout is never flagged as a large award", () => {
  const flags = computeAwardFlags({ rewards: { credits: 40_000 }, source: "story", worldLevel: 10, recentAwardCount: 1 });
  assert.deepEqual(flags, []);
});

test("too many awards in the window is still flagged", () => {
  const flags = computeAwardFlags({ rewards: { credits: 10 }, source: "dungeon", worldLevel: 9, recentAwardCount: 13 });
  assert.equal(flags.length, 1);
  assert.match(flags[0]!, /rate/);
});
