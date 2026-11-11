import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newRunState, canTakeOption, applyEventOption, applyRest, advanceNode,
  isFinalNode, isStaleAction, buildCustomId, parseCustomId,
} from "./runEngine";
import type { ChapterDefinition, EventOption, RunState } from "./types";

const opt = (hpCostFraction: number, setsFlag?: string): EventOption => ({
  id: "pay", label: "Pay", hpCostFraction, setsFlag, resultText: "ok",
});
const withHp = (hpFraction: number): RunState => ({ ...newRunState("NORMAL"), hpFraction });

test("newRunState starts at node 0 with full HP, no flags and no puzzle", () => {
  const s = newRunState("HARD");
  assert.deepEqual(s, { nodeIndex: 0, flags: [], hpFraction: 1, allyHpFractions: {}, difficulty: "HARD", puzzle: null });
});

test("canTakeOption is false when HP equals the cost and true when HP exceeds it", () => {
  assert.equal(canTakeOption(withHp(0.2), opt(0.2)), false);
  assert.equal(canTakeOption(withHp(0.2), opt(0.15)), true);
});

test("applyEventOption subtracts the cost and never reaches 0 HP", () => {
  const s = applyEventOption(withHp(0.2), opt(0.19));
  assert.ok(s.hpFraction > 0);
  assert.ok(Math.abs(s.hpFraction - 0.01) < 1e-9);
});

test("applyEventOption adds a flag only once when applied twice", () => {
  const once = applyEventOption(withHp(1), opt(0.1, "relic"));
  const twice = applyEventOption(once, opt(0.1, "relic"));
  assert.deepEqual(twice.flags, ["relic"]);
});

test("applyEventOption does not mutate its input", () => {
  const s = withHp(1);
  applyEventOption(s, opt(0.1, "relic"));
  assert.deepEqual(s.flags, []);
  assert.equal(s.hpFraction, 1);
});

test("applyRest clamps HP at 1", () => {
  assert.equal(applyRest(withHp(0.9), 0.3).hpFraction, 1);
  assert.ok(Math.abs(applyRest(withHp(0.4), 0.3).hpFraction - 0.7) < 1e-9);
});

test("isStaleAction is true for a different node index and false for the current one", () => {
  const s: RunState = { ...newRunState("NORMAL"), nodeIndex: 3 };
  assert.equal(isStaleAction(s, 2), true);
  assert.equal(isStaleAction(s, 3), false);
});

test("advanceNode adds exactly 1 to nodeIndex and leaves HP and flags untouched", () => {
  const s: RunState = { ...newRunState("NORMAL"), nodeIndex: 2, hpFraction: 0.55, flags: ["relic"] };
  const n = advanceNode(s);
  assert.equal(n.nodeIndex, 3);
  assert.equal(n.hpFraction, 0.55);
  assert.deepEqual(n.flags, ["relic"]);
});

test("isFinalNode is true only on the last node index", () => {
  const chapter = { nodes: [{}, {}, {}] } as unknown as ChapterDefinition;
  assert.equal(isFinalNode(chapter, { ...newRunState("NORMAL"), nodeIndex: 1 }), false);
  assert.equal(isFinalNode(chapter, { ...newRunState("NORMAL"), nodeIndex: 2 }), true);
});

test("customId helpers round-trip every kind and reject garbage", () => {
  const id = buildCustomId("opt", "ckabc123", 2, "pay");
  assert.deepEqual(parseCustomId(id), { kind: "opt", runId: "ckabc123", nodeIndex: 2, optionId: "pay" });
  assert.deepEqual(parseCustomId(buildCustomId("pause", "ckabc123", 4)), { kind: "pause", runId: "ckabc123", nodeIndex: 4, optionId: undefined });
  assert.deepEqual(parseCustomId(buildCustomId("pz", "ckabc123", 1, "7")), { kind: "pz", runId: "ckabc123", nodeIndex: 1, optionId: "7" });
  assert.equal(parseCustomId("story_garbage"), null);
  assert.equal(parseCustomId("other_next_ckabc123_1"), null);
  assert.equal(parseCustomId("story_nope_ckabc123_1"), null);
});
