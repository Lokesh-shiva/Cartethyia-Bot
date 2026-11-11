import type { ChapterDefinition, Difficulty, EventOption, RunState } from "./types";

const MIN_HP = 0.01;

export type CustomIdKind = "next" | "opt" | "resume" | "pause" | "pz" | "hint";
const KINDS: readonly CustomIdKind[] = ["next", "opt", "resume", "pause", "pz", "hint"];

export function newRunState(difficulty: Difficulty): RunState {
  return { nodeIndex: 0, flags: [], hpFraction: 1, allyHpFractions: {}, difficulty, puzzle: null };
}

export function canTakeOption(state: RunState, option: EventOption): boolean {
  return state.hpFraction > option.hpCostFraction;
}

export function addFlag(flags: string[], flag: string | undefined): string[] {
  if (!flag || flags.includes(flag)) return flags;
  return [...flags, flag];
}

export function applyEventOption(state: RunState, option: EventOption): RunState {
  return {
    ...state,
    hpFraction: Math.max(MIN_HP, state.hpFraction - option.hpCostFraction),
    flags: addFlag(state.flags, option.setsFlag),
  };
}

export function applyRest(state: RunState, restFraction: number): RunState {
  return { ...state, hpFraction: Math.min(1, state.hpFraction + restFraction) };
}

export function advanceNode(state: RunState): RunState {
  return { ...state, nodeIndex: state.nodeIndex + 1 };
}

export function isFinalNode(chapter: ChapterDefinition, state: RunState): boolean {
  return state.nodeIndex >= chapter.nodes.length - 1;
}

export function isStaleAction(state: RunState, actionNodeIndex: number): boolean {
  return state.nodeIndex !== actionNodeIndex;
}

export function buildCustomId(kind: CustomIdKind, runId: string, nodeIndex: number, optionId?: string): string {
  const base = `story_${kind}_${runId}_${nodeIndex}`;
  return optionId === undefined ? base : `${base}_${optionId}`;
}

export function parseCustomId(customId: string): { kind: CustomIdKind; runId: string; nodeIndex: number; optionId?: string } | null {
  const parts = customId.split("_");
  if (parts.length < 4 || parts[0] !== "story") return null;
  const kind = parts[1] as CustomIdKind;
  if (!KINDS.includes(kind)) return null;
  const runId = parts[2]!;
  const nodeIndex = Number(parts[3]);
  if (!runId || !Number.isInteger(nodeIndex) || nodeIndex < 0) return null;
  const optionId = parts.length > 4 ? parts.slice(4).join("_") : undefined;
  return { kind, runId, nodeIndex, optionId };
}
