import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateLanternPuzzle, pressLantern, isLanternSolved, lanternHint,
  generateSequence, judgeSequenceStep, scarAnswer, buildScarOptions,
  canUseHint, applyPuzzleHint, applyPuzzleFail, applyPuzzleSuccess, bossStartBonus,
  type LanternGrid,
} from "./puzzles";
import { newRunState } from "./runEngine";
import type { PuzzleDefinition, RunState } from "./types";

const def: PuzzleDefinition = {
  kind: "SEQUENCE", limit: 2, failCostFraction: 0.1, hintCostFraction: 0.05,
  success: { hpGainFraction: 0.1, setsFlag: "relic" },
};
const withHp = (hpFraction: number, extra: Partial<RunState> = {}): RunState => ({ ...newRunState("NORMAL"), hpFraction, ...extra });

/** Fewest presses that light every lantern, by brute force over all 512 press subsets; Infinity if unsolvable. */
function minPresses(grid: LanternGrid): number {
  let best = Infinity;
  for (let mask = 0; mask < 512; mask++) {
    let g = grid;
    let count = 0;
    for (let i = 0; i < 9; i++) if (mask & (1 << i)) { g = pressLantern(g, i); count++; }
    if (isLanternSolved(g) && count < best) best = count;
  }
  return best;
}

test("generateLanternPuzzle is never solved and always solvable for seeds 1 to 200", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const grid = generateLanternPuzzle(seed);
    assert.equal(grid.length, 9);
    assert.equal(isLanternSolved(grid), false, `seed ${seed} was already solved`);
    assert.ok(Number.isFinite(minPresses(grid)), `seed ${seed} is unsolvable`);
  }
});

test("pressLantern flips 3 cells at a corner and 5 at the center", () => {
  const solved: LanternGrid = new Array(9).fill(true);
  const flipped = (g: LanternGrid) => g.filter(v => !v).length;
  assert.equal(flipped(pressLantern(solved, 0)), 3);
  assert.equal(flipped(pressLantern(solved, 8)), 3);
  assert.equal(flipped(pressLantern(solved, 4)), 5);
});

test("pressing the same lantern twice restores the grid and never mutates the input", () => {
  const grid = generateLanternPuzzle(5);
  const copy = [...grid];
  assert.deepEqual(pressLantern(pressLantern(grid, 3), 3), grid);
  assert.deepEqual(grid, copy);
});

test("lanternHint returns a press that reduces the minimum presses by one", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const grid = generateLanternPuzzle(seed);
    const hint = lanternHint(grid);
    assert.equal(minPresses(pressLantern(grid, hint)), minPresses(grid) - 1, `seed ${seed}`);
  }
});

test("generateSequence is deterministic, the requested length, and uses symbols 0 to 3", () => {
  const a = generateSequence(42, 6);
  assert.deepEqual(a, generateSequence(42, 6));
  assert.equal(a.length, 6);
  assert.ok(a.every(n => Number.isInteger(n) && n >= 0 && n <= 3));
});

test("judgeSequenceStep reports CORRECT, WRONG and COMPLETE", () => {
  const seq = [2, 0, 3, 1];
  assert.deepEqual(judgeSequenceStep(seq, 0, 2), { result: "CORRECT", nextProgress: 1 });
  assert.deepEqual(judgeSequenceStep(seq, 1, 3), { result: "WRONG", nextProgress: 1 });
  assert.deepEqual(judgeSequenceStep(seq, 3, 1), { result: "COMPLETE", nextProgress: 4 });
});

test("scarAnswer sums the clues and buildScarOptions returns 4 distinct positive options including it", () => {
  assert.equal(scarAnswer([13, 17, 11]), 41);
  const opts = buildScarOptions(41, 7);
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.every(n => n > 0));
  assert.ok(opts.includes(41));
  assert.deepEqual(opts, buildScarOptions(41, 7));
});

test("buildScarOptions stays positive and distinct for a tiny answer", () => {
  const opts = buildScarOptions(2, 3);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.every(n => n > 0));
  assert.ok(opts.includes(2));
});

test("canUseHint is false when HP equals the hint cost", () => {
  assert.equal(canUseHint(withHp(0.05), def), false);
  assert.equal(canUseHint(withHp(0.06), def), true);
});

test("applyPuzzleHint subtracts the cost and counts the hint", () => {
  const puzzle = { kind: "SEQUENCE" as const, seed: 1, progress: [], mistakes: 0, hintsUsed: 0 };
  const s = applyPuzzleHint(withHp(0.5, { puzzle }), def);
  assert.ok(Math.abs(s.hpFraction - 0.45) < 1e-9);
  assert.equal(s.puzzle!.hintsUsed, 1);
});

test("applyPuzzleFail at 0.05 HP leaves exactly 0.01 and clears the puzzle", () => {
  const puzzle = { kind: "SEQUENCE" as const, seed: 1, progress: [], mistakes: 2, hintsUsed: 0 };
  const s = applyPuzzleFail(withHp(0.05, { puzzle }), def);
  assert.equal(s.hpFraction, 0.01);
  assert.equal(s.puzzle, null);
});

test("applyPuzzleSuccess adds its flag once even if applied twice and clamps HP at 1", () => {
  const once = applyPuzzleSuccess(withHp(0.95), def);
  assert.equal(once.hpFraction, 1);
  assert.deepEqual(once.flags, ["relic"]);
  assert.deepEqual(applyPuzzleSuccess(once, def).flags, ["relic"]);
  assert.equal(once.puzzle, null);
});

test("bossStartBonus adds 0.25 HP with the relic flag and changes nothing without it", () => {
  const withRelic = bossStartBonus(withHp(0.5, { flags: ["relic"] }));
  assert.ok(Math.abs(withRelic.hpFraction - 0.75) < 1e-9);
  assert.equal(bossStartBonus(withHp(0.9, { flags: ["relic"] })).hpFraction, 1);
  const plain = withHp(0.5);
  assert.deepEqual(bossStartBonus(plain), plain);
});
