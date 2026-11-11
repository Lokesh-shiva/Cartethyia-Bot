import { CHAPTER_1 } from "./chapter1";
import type { ChapterDefinition } from "./types";

export { validateChapter, chapterNodeDungeon } from "./chapterRules";

export const CHAPTERS: ChapterDefinition[] = [CHAPTER_1];

export function getChapter(id: number): ChapterDefinition | null {
  return CHAPTERS.find(c => c.id === id) ?? null;
}
