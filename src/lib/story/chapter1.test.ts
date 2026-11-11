import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAPTER_1 } from "./chapter1";
import { CHAPTERS } from "./chapters";
import { validateChapter, chapterNodeDungeon } from "./chapterRules";

test("chapter 1 validates cleanly and is registered", () => {
  assert.deepEqual(validateChapter(CHAPTER_1), []);
  assert.equal(CHAPTER_1.nodes.length, 8);
  assert.deepEqual(CHAPTERS, [CHAPTER_1]);
  assert.equal(CHAPTER_1.requiresWorldLevel, 9);
  assert.equal(CHAPTER_1.clearsToWorldLevel, 10);
  assert.equal(CHAPTER_1.hardModeMult, 1.4);
  assert.equal(CHAPTER_1.rewards.weaponId, "cinderheart");
});

test("exactly one boss and it is last; 1-2 Bren fights; every fight has waves", () => {
  const kinds = CHAPTER_1.nodes.map(n => n.kind);
  assert.equal(kinds.filter(k => k === "BOSS").length, 1);
  assert.equal(kinds[kinds.length - 1], "BOSS");
  const bren = kinds.filter(k => k === "STORY_BREN_FIGHT").length;
  assert.ok(bren >= 1 && bren <= 2);
  for (const n of CHAPTER_1.nodes) {
    if (n.kind === "FIGHT" || n.kind === "STORY_BREN_FIGHT" || n.kind === "BOSS") assert.ok(n.waves && n.waves.length > 0, n.title);
  }
});

test("three puzzles of the right kinds; sequence has a force option", () => {
  const puzzles = CHAPTER_1.nodes.filter(n => n.kind === "PUZZLE");
  assert.deepEqual(puzzles.map(p => p.puzzle!.kind), ["SEQUENCE", "LANTERNS", "SCAR_COUNT"]);
  assert.ok(puzzles[0].puzzle!.forceOption);
});

test("scar clues 13, 17, 11 appear in earlier nodes and sum to 41", () => {
  const idx = CHAPTER_1.nodes.findIndex(n => n.puzzle?.kind === "SCAR_COUNT");
  const earlier = CHAPTER_1.nodes.slice(0, idx).map(n => `${n.intro} ${n.resultText ?? ""}`).join(" ").toLowerCase();
  for (const w of ["thirteen", "seventeen", "eleven"]) assert.ok(earlier.includes(`${w} scars`), w);
  assert.equal(13 + 17 + 11, 41);
});

test("HARD dungeon multiplies waves without mutating the source", () => {
  const before = CHAPTER_1.nodes[0].waves![0].hpMult;
  const hard = chapterNodeDungeon(CHAPTER_1, 0, "HARD");
  assert.equal(hard.waves[0].hpMult, before * 1.4);
  assert.equal(hard.auraCost, 2);
  assert.equal(CHAPTER_1.nodes[0].waves![0].hpMult, before);
  assert.equal(chapterNodeDungeon(CHAPTER_1, 0, "NORMAL").auraCost, 0);
});

test("validateChapter reports problems", () => {
  const bad = { ...CHAPTER_1, nodes: CHAPTER_1.nodes.slice(0, 3) };
  assert.ok(validateChapter(bad).length > 0);
});
