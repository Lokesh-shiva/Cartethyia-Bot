import type { WaveDefinition } from "../dungeons";

export type NodeKind = "FIGHT" | "EVENT" | "REST" | "STORY_BREN_FIGHT" | "BOSS" | "PUZZLE";
export type Difficulty = "NORMAL" | "HARD";
export type PuzzleKind = "SEQUENCE" | "LANTERNS" | "SCAR_COUNT";

export type CurrencyBundle = { credits: number; fractonite: number; emberShards: number };

export interface EventOption {
  id: string;
  label: string;
  hpCostFraction: number;
  setsFlag?: string;
  resultText: string;
}

export interface PuzzleDefinition {
  kind: PuzzleKind;
  limit: number;
  failCostFraction: number;
  hintCostFraction: number;
  success: { hpGainFraction: number; setsFlag?: string };
  forceOption?: { label: string; hpCostFraction: number; setsFlag?: string };
  /** SCAR_COUNT only: the numbers the player collected; the answer is their sum. */
  clues?: number[];
}

export interface PuzzleState {
  kind: PuzzleKind;
  seed: number;
  progress: number[];
  mistakes: number;
  hintsUsed: number;
}

export interface NodeDefinition {
  kind: NodeKind;
  title: string;
  intro: string;
  /** Scene image file name (without .png) under the chapter art folder. */
  art?: string;
  /** Text posted after the node is cleared (clues for the Scar Count live here). */
  resultText?: string;
  waves?: WaveDefinition[];
  options?: EventOption[];
  restFraction?: number;
  puzzle?: PuzzleDefinition;
}

export interface ChapterRewards {
  weaponId: string;
  firstClear: CurrencyBundle;
  replay: CurrencyBundle;
}

export interface ChapterDefinition {
  id: number;
  title: string;
  blurb: string;
  requiresWorldLevel: number;
  clearsToWorldLevel: number;
  enemyWorldLevel: number;
  hardModeMult: number;
  nodes: NodeDefinition[];
  rewards: ChapterRewards;
}

export interface RunState {
  nodeIndex: number;
  flags: string[];
  hpFraction: number;
  allyHpFractions: Record<string, number>;
  difficulty: Difficulty;
  puzzle: PuzzleState | null;
}
