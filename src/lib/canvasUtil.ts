import { createCanvas, loadImage, Image, SKRSContext2D } from "@napi-rs/canvas";

/**
 * Sets (or replaces) the `size` query param on a Discord CDN avatar URL.
 * `displayAvatarURL({ size })` already returns a URL with `?size=N` on it —
 * every card generator that then did `avatarUrl + "?size=256"` was producing
 * a malformed `...png?size=256?size=256` URL (two `?`). Verified this still
 * loads fine in practice (Discord's CDN tolerates it, loadImage() doesn't
 * choke on it) — so it wasn't actually the cause of missing pfps on cards,
 * but it's confusing, fragile, and worth not doing regardless. Always route
 * through this instead of string-concatenating a size.
 */
export function avatarUrlAt(avatarUrl: string, size: number): string {
  const [base] = avatarUrl.split("?");
  return `${base}?size=${size}`;
}

/**
 * loadImage() with one retry on failure (short backoff) before giving up.
 * Avatar fetches occasionally hit a transient blip (timeout, momentary CDN
 * hiccup) — reported live: one side of a two-avatar duel intro card came
 * back as a plain colored circle instead of the real pfp, on an otherwise-
 * working duel. A single retry catches most of these without meaningfully
 * slowing down card generation on the (common) case where nothing failed.
 * Callers still need their own try/catch for the case both attempts fail.
 */
export async function loadAvatarImage(avatarUrl: string, size: number): Promise<Image> {
  const url = avatarUrlAt(avatarUrl, size);
  try {
    return await loadImage(url);
  } catch {
    await new Promise(r => setTimeout(r, 300));
    return await loadImage(url);
  }
}

/**
 * Draws `img` into (dx, dy, dw, dh) using step-down halving instead of a single
 * drawImage call. @napi-rs/canvas has no mipmapping, so a single-pass downscale
 * of a large source (e.g. 1500px art -> 150px thumbnail) looks soft/blurry.
 * Halving repeatedly until within 2x of the target keeps each pass sharp.
 */
export function drawImageSharp(
  ctx: SKRSContext2D,
  img: Image,
  dx: number, dy: number, dw: number, dh: number,
): void {
  const srcW = img.width, srcH = img.height;

  // Small enough already (upscale or mild downscale) — one pass is fine.
  if (srcW <= dw * 2 && srcH <= dh * 2) {
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }

  let curCanvas = createCanvas(srcW, srcH);
  let curCtx = curCanvas.getContext("2d");
  curCtx.drawImage(img, 0, 0, srcW, srcH);
  let curW = srcW, curH = srcH;

  while (curW > dw * 2 && curH > dh * 2) {
    const nextW = Math.max(dw, Math.floor(curW / 2));
    const nextH = Math.max(dh, Math.floor(curH / 2));
    const nextCanvas = createCanvas(nextW, nextH);
    const nextCtx = nextCanvas.getContext("2d");
    nextCtx.drawImage(curCanvas, 0, 0, curW, curH, 0, 0, nextW, nextH);
    curCanvas = nextCanvas;
    curCtx = nextCtx;
    curW = nextW;
    curH = nextH;
  }

  ctx.drawImage(curCanvas, 0, 0, curW, curH, dx, dy, dw, dh);
}
