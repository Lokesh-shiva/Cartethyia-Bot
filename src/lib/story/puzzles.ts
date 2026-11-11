import { addFlag, MIN_HP } from "./runEngine";
import type { PuzzleDefinition, RunState } from "./types";

export type LanternGrid = boolean[];

/** mulberry32: small deterministic PRNG so a seed always rebuilds the same puzzle. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ── Lanterns (3x3 lights-out) ────────────────────────────────────────────────
export function pressLantern(grid: LanternGrid, index: number): LanternGrid {
  const out = [...grid];
  const row = Math.floor(index / 3), col = index % 3;
  const cells: [number, number][] = [[row, col], [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]];
  for (const [r, c] of cells) {
    if (r < 0 || r > 2 || c < 0 || c > 2) continue;
    out[r * 3 + c] = !out[r * 3 + c];
  }
  return out;
}

export function isLanternSolved(grid: LanternGrid): boolean {
  return grid.every(Boolean);
}

export function generateLanternPuzzle(seed: number): LanternGrid {
  const next = rng(seed);
  for (let attempt = 0; attempt < 50; attempt++) {
    let grid: LanternGrid = new Array(9).fill(true);
    for (let i = 0; i < 9; i++) if (next() < 0.5) grid = pressLantern(grid, i);
    if (!isLanternSolved(grid)) return grid;
  }
  return pressLantern(new Array(9).fill(true), 4);
}

/** Index of a press that begins a shortest solution, or -1 when already solved. */
export function lanternHint(grid: LanternGrid): number {
  let bestMask = -1, bestCount = Infinity;
  for (let mask = 1; mask < 512; mask++) {
    let g = grid, count = 0;
    for (let i = 0; i < 9; i++) if (mask & (1 << i)) { g = pressLantern(g, i); count++; }
    if (isLanternSolved(g) && count < bestCount) { bestCount = count; bestMask = mask; }
  }
  if (bestMask < 0) return -1;
  for (let i = 0; i < 9; i++) if (bestMask & (1 << i)) return i;
  return -1;
}

// ── Ember sequence ───────────────────────────────────────────────────────────
export function generateSequence(seed: number, length: number): number[] {
  const next = rng(seed);
  return Array.from({ length }, () => Math.floor(next() * 4));
}

export function judgeSequenceStep(
  sequence: number[], progress: number, pressed: number,
): { result: "CORRECT" | "WRONG" | "COMPLETE"; nextProgress: number } {
  if (sequence[progress] !== pressed) return { result: "WRONG", nextProgress: progress };
  const nextProgress = progress + 1;
  return { result: nextProgress >= sequence.length ? "COMPLETE" : "CORRECT", nextProgress };
}

// ── Scar count ───────────────────────────────────────────────────────────────
export function scarAnswer(clues: number[]): number {
  return clues.reduce((sum, n) => sum + n, 0);
}

export function buildScarOptions(answer: number, seed: number): number[] {
  const next = rng(seed);
  const offsets = shuffled([-4, -3, -2, -1, 1, 2, 3, 4, 5, 6], next);
  const distractors: number[] = [];
  for (const o of offsets) {
    const v = answer + o;
    if (v > 0 && v !== answer && !distractors.includes(v)) distractors.push(v);
    if (distractors.length === 3) break;
  }
  for (let v = answer + 7; distractors.length < 3; v++) distractors.push(v);
  return shuffled([answer, ...distractors], next);
}

// ── Run-state effects ────────────────────────────────────────────────────────
export function canUseHint(state: RunState, def: PuzzleDefinition): boolean {
  return state.hpFraction > def.hintCostFraction;
}

export function applyPuzzleHint(state: RunState, def: PuzzleDefinition): RunState {
  if (!state.puzzle) return state;
  return {
    ...state,
    hpFraction: Math.max(MIN_HP, state.hpFraction - def.hintCostFraction),
    puzzle: { ...state.puzzle, hintsUsed: state.puzzle.hintsUsed + 1 },
  };
}

export function applyPuzzleFail(state: RunState, def: PuzzleDefinition): RunState {
  return { ...state, hpFraction: Math.max(MIN_HP, state.hpFraction - def.failCostFraction), puzzle: null };
}

export function applyPuzzleSuccess(state: RunState, def: PuzzleDefinition): RunState {
  return {
    ...state,
    hpFraction: Math.min(1, state.hpFraction + def.success.hpGainFraction),
    flags: addFlag(state.flags, def.success.setsFlag),
    puzzle: null,
  };
}

export function bossStartBonus(state: RunState): RunState {
  if (!state.flags.includes("relic")) return state;
  return { ...state, hpFraction: Math.min(1, state.hpFraction + 0.25) };
}
