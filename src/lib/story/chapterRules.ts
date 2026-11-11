import type { DungeonDefinition } from "../dungeons";
import type { ChapterDefinition, Difficulty } from "./types";

/** Problems found in a chapter definition; empty when valid. */
export function validateChapter(chapter: ChapterDefinition): string[] {
  const problems: string[] = [];
  const nodes = chapter.nodes;
  if (nodes.length < 4) problems.push("chapter has too few nodes");
  const bosses = nodes.filter(n => n.kind === "BOSS").length;
  if (bosses !== 1) problems.push(`expected exactly one BOSS node, found ${bosses}`);
  else if (nodes[nodes.length - 1].kind !== "BOSS") problems.push("BOSS must be the last node");
  nodes.forEach((n, i) => {
    const tag = `node ${i + 1} (${n.title})`;
    if (["FIGHT", "STORY_BREN_FIGHT", "BOSS"].includes(n.kind) && !n.waves?.length) problems.push(`${tag}: fight without waves`);
    if (n.kind === "PUZZLE" && !n.puzzle) problems.push(`${tag}: puzzle without definition`);
    if (n.kind === "REST" && n.restFraction === undefined) problems.push(`${tag}: rest without restFraction`);
    if (n.kind === "EVENT" && !n.options?.length) problems.push(`${tag}: event without options`);
    if (!n.intro) problems.push(`${tag}: missing intro`);
  });
  if (chapter.clearsToWorldLevel !== chapter.requiresWorldLevel + 1) problems.push("clearsToWorldLevel must be requiresWorldLevel + 1");
  if (chapter.hardModeMult <= 1) problems.push("hardModeMult must exceed 1");
  return problems;
}

/** Synthetic DungeonDefinition for runWave. HARD scales waves by hardModeMult without mutating the source. */
export function chapterNodeDungeon(chapter: ChapterDefinition, nodeIndex: number, difficulty: Difficulty): DungeonDefinition {
  const node = chapter.nodes[nodeIndex];
  const m = difficulty === "HARD" ? chapter.hardModeMult : 1;
  return {
    id: `story_${chapter.id}_${nodeIndex}`,
    name: node.title,
    emoji: "🔥",
    type: "ECHO",
    description: node.intro,
    flavor: "",
    levelReq: 0,
    worldLevelReq: chapter.enemyWorldLevel,
    auraCost: difficulty === "HARD" ? 2 : 0,
    waves: (node.waves ?? []).map(w => ({ ...w, hpMult: w.hpMult * m, atkMult: w.atkMult * m, defMult: w.defMult * m })),
    rewards: { resonanceExp: 0, resonanceExpMult: 1 },
    color: 0xff7a3d,
  };
}
