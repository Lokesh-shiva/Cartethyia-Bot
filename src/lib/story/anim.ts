import fs from "fs";
import path from "path";

export type AnimMoment = "title" | "boss-intro" | "flashback" | "victory";

/** Path of the pre-rendered GIF for a moment, or null so the flow falls back to the static card. */
export function animPathFor(moment: AnimMoment, artDir = path.join("assets", "story", "ch1")): string | null {
  const p = path.join(artDir, "anim", `${moment}.gif`);
  return fs.existsSync(p) ? p : null;
}
