import { createCanvas, Image, SKRSContext2D } from "@napi-rs/canvas";

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
