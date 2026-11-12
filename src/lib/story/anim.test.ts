import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { animPathFor } from "./anim";

test("animPathFor is null when the GIF is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyanim-"));
  assert.equal(animPathFor("title", dir), null);
});

test("animPathFor returns the GIF path when the file exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storyanim-"));
  fs.mkdirSync(path.join(dir, "anim"));
  fs.writeFileSync(path.join(dir, "anim", "boss-intro.gif"), "GIF89a");
  assert.equal(animPathFor("boss-intro", dir), path.join(dir, "anim", "boss-intro.gif"));
  assert.equal(animPathFor("victory", dir), null);
});
