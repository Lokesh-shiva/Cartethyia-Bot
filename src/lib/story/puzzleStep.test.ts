import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAPTER_1 } from "./chapter1";
import { newRunState } from "./runEngine";
import { generateSequence, generateLanternPuzzle, pressLantern, lanternHint } from "./puzzles";
import { initPuzzleState, stepPuzzle, SEQUENCE_LENGTH } from "./puzzleStep";
import type { RunState } from "./types";

const seqDef = CHAPTER_1.nodes[1].puzzle!;
const lanDef = CHAPTER_1.nodes[4].puzzle!;
const scarDef = CHAPTER_1.nodes[5].puzzle!;

function withPuzzle(def: typeof seqDef, seed = 7): RunState {
  return { ...newRunState("NORMAL"), puzzle: initPuzzleState(def, seed) };
}

test("a correct full sequence succeeds, heals and sets the relic flag", () => {
  let s = { ...withPuzzle(seqDef), hpFraction: 0.5 };
  const seq = generateSequence(7, SEQUENCE_LENGTH);
  let outcome = "CONTINUE";
  for (const v of seq) { const r = stepPuzzle(s, seqDef, { type: "press", value: v }); s = r.state; outcome = r.outcome; }
  assert.equal(outcome, "SUCCESS");
  assert.ok(s.flags.includes("relic"));
  assert.ok(Math.abs(s.hpFraction - 0.6) < 1e-9);
  assert.equal(s.puzzle, null);
});

test("wrong sequence presses fail only once they exceed the limit, costing HP", () => {
  const seq = generateSequence(7, SEQUENCE_LENGTH);
  const wrong = (seq[0] + 1) % 4;
  let s = withPuzzle(seqDef);
  let r = stepPuzzle(s, seqDef, { type: "press", value: wrong });
  assert.equal(r.outcome, "CONTINUE");
  r = stepPuzzle(r.state, seqDef, { type: "press", value: wrong });
  assert.equal(r.outcome, "CONTINUE");
  r = stepPuzzle(r.state, seqDef, { type: "press", value: wrong });
  assert.equal(r.outcome, "FAIL");
  assert.ok(Math.abs(r.state.hpFraction - 0.9) < 1e-9);
  assert.equal(r.state.puzzle, null);
});

test("lanterns solve by replaying the hinted presses and fail at the press limit", () => {
  let s = withPuzzle(lanDef, 11);
  let grid = generateLanternPuzzle(11);
  let outcome = "CONTINUE";
  for (let i = 0; i < 9 && outcome === "CONTINUE"; i++) {
    const idx = lanternHint(grid);
    if (idx < 0) break;
    const r = stepPuzzle(s, lanDef, { type: "press", value: idx });
    s = r.state; outcome = r.outcome; grid = pressLantern(grid, idx);
  }
  assert.equal(outcome, "SUCCESS");
  assert.ok(s.flags.includes("lanterns_lit"));

  let f = withPuzzle(lanDef, 11);
  let last = { outcome: "CONTINUE" as string, state: f };
  for (let i = 0; i < lanDef.limit && last.outcome === "CONTINUE"; i++) {
    // pressing the same cell twice undoes itself, so this never solves
    last = stepPuzzle(last.state, lanDef, { type: "press", value: i % 2 === 0 ? 0 : 0 });
  }
  assert.equal(last.outcome, "FAIL");
});

test("scar count accepts 41, rejects others, and fails past the limit", () => {
  const ok = stepPuzzle(withPuzzle(scarDef), scarDef, { type: "press", value: 41 });
  assert.equal(ok.outcome, "SUCCESS");
  assert.ok(ok.state.flags.includes("knows_scar_count"));

  let r = stepPuzzle(withPuzzle(scarDef), scarDef, { type: "press", value: 40 });
  assert.equal(r.outcome, "CONTINUE");
  r = stepPuzzle(r.state, scarDef, { type: "press", value: 42 });
  r = stepPuzzle(r.state, scarDef, { type: "press", value: 43 });
  assert.equal(r.outcome, "FAIL");
});

test("hint costs HP and counts; refused when HP is too low", () => {
  const r = stepPuzzle(withPuzzle(seqDef), seqDef, { type: "hint" });
  assert.equal(r.outcome, "HINT");
  assert.ok(Math.abs(r.state.hpFraction - 0.95) < 1e-9);
  assert.equal(r.state.puzzle!.hintsUsed, 1);

  const low = { ...withPuzzle(seqDef), hpFraction: 0.04 };
  assert.equal(stepPuzzle(low, seqDef, { type: "hint" }).outcome, "NO_HINT");
});

test("give up fails; force takes the relic at HP cost and never when HP is too low", () => {
  assert.equal(stepPuzzle(withPuzzle(lanDef), lanDef, { type: "giveup" }).outcome, "FAIL");

  const f = stepPuzzle(withPuzzle(seqDef), seqDef, { type: "force" });
  assert.equal(f.outcome, "FORCED");
  assert.ok(f.state.flags.includes("relic"));
  assert.ok(Math.abs(f.state.hpFraction - 0.8) < 1e-9);
  assert.equal(f.state.puzzle, null);

  const low = { ...withPuzzle(seqDef), hpFraction: 0.15 };
  assert.equal(stepPuzzle(low, seqDef, { type: "force" }).outcome, "NO_FORCE");
  assert.equal(stepPuzzle(withPuzzle(lanDef), lanDef, { type: "force" }).outcome, "NO_FORCE");
});
