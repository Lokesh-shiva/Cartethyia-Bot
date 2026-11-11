import {
  applyPuzzleFail, applyPuzzleHint, applyPuzzleSuccess, canUseHint,
  generateLanternPuzzle, generateSequence, isLanternSolved, judgeSequenceStep, pressLantern, scarAnswer,
  type LanternGrid,
} from "./puzzles";
import { addFlag, canTakeOption, MIN_HP } from "./runEngine";
import type { PuzzleDefinition, PuzzleState, RunState } from "./types";

export const SEQUENCE_LENGTH = 4;

export type PuzzleAction =
  | { type: "press"; value: number }
  | { type: "hint" }
  | { type: "giveup" }
  | { type: "force" };

export type PuzzleOutcome = "CONTINUE" | "SUCCESS" | "FAIL" | "HINT" | "NO_HINT" | "FORCED" | "NO_FORCE";

export function initPuzzleState(def: PuzzleDefinition, seed: number): PuzzleState {
  return { kind: def.kind, seed, progress: [], mistakes: 0, hintsUsed: 0 };
}

/** Current lantern grid: the seeded start with every saved press replayed. */
export function lanternGridOf(puzzle: PuzzleState): LanternGrid {
  return puzzle.progress.reduce((g, i) => pressLantern(g, i), generateLanternPuzzle(puzzle.seed));
}

export function sequenceOf(puzzle: PuzzleState): number[] {
  return generateSequence(puzzle.seed, SEQUENCE_LENGTH);
}

/**
 * One puzzle action. Pure: returns the new run state and what happened.
 * SEQUENCE/SCAR_COUNT fail once wrong answers exceed `limit`; LANTERNS fails when the press budget is spent.
 */
export function stepPuzzle(state: RunState, def: PuzzleDefinition, action: PuzzleAction): { state: RunState; outcome: PuzzleOutcome } {
  const puzzle = state.puzzle;
  if (!puzzle) return { state, outcome: "CONTINUE" };

  if (action.type === "hint") {
    if (!canUseHint(state, def)) return { state, outcome: "NO_HINT" };
    return { state: applyPuzzleHint(state, def), outcome: "HINT" };
  }
  if (action.type === "giveup") return { state: applyPuzzleFail(state, def), outcome: "FAIL" };
  if (action.type === "force") {
    const f = def.forceOption;
    if (!f || !canTakeOption(state, { id: "force", label: f.label, hpCostFraction: f.hpCostFraction, resultText: "" })) {
      return { state, outcome: "NO_FORCE" };
    }
    return {
      state: { ...state, hpFraction: Math.max(MIN_HP, state.hpFraction - f.hpCostFraction), flags: addFlag(state.flags, f.setsFlag), puzzle: null },
      outcome: "FORCED",
    };
  }

  // press
  if (def.kind === "SEQUENCE") {
    const seq = sequenceOf(puzzle);
    const step = puzzle.progress[0] ?? 0;
    const j = judgeSequenceStep(seq, step, action.value);
    if (j.result === "WRONG") {
      const mistakes = puzzle.mistakes + 1;
      const next = { ...state, puzzle: { ...puzzle, mistakes } };
      return mistakes > def.limit ? { state: applyPuzzleFail(next, def), outcome: "FAIL" } : { state: next, outcome: "CONTINUE" };
    }
    if (j.result === "COMPLETE") return { state: applyPuzzleSuccess(state, def), outcome: "SUCCESS" };
    return { state: { ...state, puzzle: { ...puzzle, progress: [j.nextProgress] } }, outcome: "CONTINUE" };
  }

  if (def.kind === "LANTERNS") {
    const progress = [...puzzle.progress, action.value];
    const next = { ...state, puzzle: { ...puzzle, progress, mistakes: progress.length } };
    if (isLanternSolved(lanternGridOf(next.puzzle!))) return { state: applyPuzzleSuccess(next, def), outcome: "SUCCESS" };
    if (progress.length >= def.limit) return { state: applyPuzzleFail(next, def), outcome: "FAIL" };
    return { state: next, outcome: "CONTINUE" };
  }

  // SCAR_COUNT
  if (action.value === scarAnswer(def.clues ?? [])) return { state: applyPuzzleSuccess(state, def), outcome: "SUCCESS" };
  const mistakes = puzzle.mistakes + 1;
  const next = { ...state, puzzle: { ...puzzle, mistakes, progress: [...puzzle.progress, action.value] } };
  return mistakes > def.limit ? { state: applyPuzzleFail(next, def), outcome: "FAIL" } : { state: next, outcome: "CONTINUE" };
}
