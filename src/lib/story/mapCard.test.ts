import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createCanvas } from "@napi-rs/canvas";
import { toAscii, generateStoryMapCard, backdropReadCount } from "./mapCard";
import type { NodeKind } from "./types";

const kinds: NodeKind[] = ["FIGHT", "PUZZLE", "FIGHT", "REST", "PUZZLE", "PUZZLE", "STORY_BREN_FIGHT", "BOSS"];
const nodes = kinds.map((kind, i) => ({ kind, label: i === 0 ? "Ashfall Gate ✦" : `Node ${i + 1}` }));

test("toAscii leaves no code point above 126", () => {
  const out = toAscii("Ember ✦ Reach ◈");
  for (const ch of out) assert.ok(ch.codePointAt(0)! <= 126);
  assert.ok(out.startsWith("Ember"));
});

test("card renders a non-empty buffer when the art directory is missing", async () => {
  const buf = await generateStoryMapCard({
    chapterTitle: "The Cost of Ember", nodes, currentIndex: 3, hpFraction: 0.5, artDir: "/definitely/not/here",
  });
  assert.ok(buf.length > 1000);
});

test("the backdrop file is read once across repeated renders", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyart-"));
  const c = createCanvas(64, 36);
  fs.writeFileSync(path.join(dir, "backdrop.png"), c.toBuffer("image/png"));
  const before = backdropReadCount();
  const input = { chapterTitle: "T", nodes, currentIndex: 0, hpFraction: 1, artDir: dir };
  await generateStoryMapCard(input);
  await generateStoryMapCard(input);
  assert.equal(backdropReadCount() - before, 1);
});
