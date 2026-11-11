import { test } from "node:test";
import assert from "node:assert/strict";
import { runStateFromRow } from "./runService";

const baseRow = {
  id: "ckrun1", userId: "u1", chapterId: 1, difficulty: "NORMAL", status: "ACTIVE", pausedAt: null,
  nodeIndex: 3, flags: ["relic"], hpFraction: 0.55, allyHpFractions: {}, puzzle: null,
  threadId: "t1", guildId: "g1", startedAt: new Date(), updatedAt: new Date(),
};

test("runStateFromRow maps a saved row to a RunState", () => {
  assert.deepEqual(runStateFromRow(baseRow), {
    nodeIndex: 3, flags: ["relic"], hpFraction: 0.55, allyHpFractions: {}, difficulty: "NORMAL", puzzle: null,
  });
});

test("runStateFromRow restores a saved puzzle and HARD difficulty", () => {
  const puzzle = { kind: "LANTERNS", seed: 9, progress: [4, 0], mistakes: 2, hintsUsed: 1 };
  const s = runStateFromRow({ ...baseRow, difficulty: "HARD", puzzle });
  assert.equal(s.difficulty, "HARD");
  assert.deepEqual(s.puzzle, puzzle);
});

test("runStateFromRow copes with a null allyHpFractions column", () => {
  const s = runStateFromRow({ ...baseRow, allyHpFractions: null as unknown as object });
  assert.deepEqual(s.allyHpFractions, {});
});
