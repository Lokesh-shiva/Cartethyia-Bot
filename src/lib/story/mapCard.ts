// Story chapter map card: the path of nodes over the chapter backdrop.
// ASCII-only text on canvas (see CLAUDE.md: Rajdhani has no symbol glyphs).
import { createCanvas, loadImage, GlobalFonts, SKRSContext2D, Image } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import type { NodeKind } from "./types";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const FONT = "Rajdhani, Arial, sans-serif";
export const DEFAULT_ART_DIR = path.join("assets", "story", "ch1");

// Design system (docs/story/ch1-design-system.md). PUZZLE nodes use the Event color.
const NODE_COLOR: Record<NodeKind, string> = {
  FIGHT: "#e0523a", EVENT: "#d9a441", PUZZLE: "#d9a441", REST: "#4aa3df",
  STORY_BREN_FIGHT: "#b48cf0", BOSS: "#ff3b30",
};
const NODE_ICON: Record<NodeKind, string> = {
  FIGHT: "icon-fight", EVENT: "icon-event", PUZZLE: "icon-event", REST: "icon-rest",
  STORY_BREN_FIGHT: "icon-flashback", BOSS: "icon-boss",
};

export function toAscii(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\s*\?+\s*/g, m => (m.trim().length === m.length ? m : " "))
    .replace(/\s+/g, " ")
    .trim();
}

let backdropReads = 0;
export function backdropReadCount(): number { return backdropReads; }

const imageCache = new Map<string, Image | null>();
async function loadArt(file: string): Promise<Image | null> {
  if (imageCache.has(file)) return imageCache.get(file)!;
  let img: Image | null = null;
  if (fs.existsSync(file)) {
    try { backdropReads++; img = await loadImage(file); } catch { img = null; }
  }
  imageCache.set(file, img);
  return img;
}

function rrect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export interface StoryMapInput {
  chapterTitle: string;
  nodes: { kind: NodeKind; label: string }[];
  currentIndex: number;
  hpFraction: number;
  artDir?: string;
}

const W = 1000, H = 520;

export async function generateStoryMapCard(input: StoryMapInput): Promise<Buffer> {
  const artDir = input.artDir ?? DEFAULT_ART_DIR;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = await loadArt(path.join(artDir, "backdrop.png"));
  if (bg) {
    const scale = Math.max(W / bg.width, H / bg.height);
    const dw = bg.width * scale, dh = bg.height * scale;
    ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#120a08"); g.addColorStop(1, "#5a4a44");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = "rgba(18,10,8,0.62)"; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#ffd479"; ctx.font = `bold 38px ${FONT}`; ctx.textAlign = "left";
  ctx.fillText(toAscii(input.chapterTitle).toUpperCase(), 40, 62);

  const n = input.nodes.length;
  const left = 70, right = W - 70, y = 255;
  const step = n > 1 ? (right - left) / (n - 1) : 0;
  const pos = (i: number) => left + step * i;

  ctx.lineWidth = 6; ctx.lineCap = "round";
  for (let i = 0; i < n - 1; i++) {
    ctx.strokeStyle = i < input.currentIndex ? "#ff7a3d" : "rgba(207,230,245,0.25)";
    ctx.beginPath(); ctx.moveTo(pos(i), y); ctx.lineTo(pos(i + 1), y); ctx.stroke();
  }

  for (let i = 0; i < n; i++) {
    const node = input.nodes[i], x = pos(i);
    const cleared = i < input.currentIndex, current = i === input.currentIndex;
    const color = NODE_COLOR[node.kind], r = current ? 34 : 26;
    ctx.globalAlpha = cleared || current ? 1 : 0.55;
    if (current) { ctx.shadowColor = color; ctx.shadowBlur = 26; }
    ctx.fillStyle = "#120a08"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color; ctx.lineWidth = current ? 5 : 3; ctx.stroke();
    const icon = await loadArt(path.join(artDir, `${NODE_ICON[node.kind]}.png`));
    if (icon) {
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r - 3, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(icon, x - r + 3, y - r + 3, (r - 3) * 2, (r - 3) * 2); ctx.restore();
    }
    if (cleared) {
      ctx.fillStyle = "#ffd479"; ctx.font = `bold 20px ${FONT}`; ctx.textAlign = "center";
      ctx.fillText("OK", x, y + r + 20);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = current ? "#ffd479" : "#cfe6f5"; ctx.font = `bold 15px ${FONT}`; ctx.textAlign = "center";
    const label = toAscii(node.label);
    ctx.fillText(label.length > 14 ? label.slice(0, 13) + "." : label, x, y - r - 14 - (i % 2 ? 18 : 0));
  }

  // HP bar
  const hp = Math.max(0, Math.min(1, input.hpFraction));
  const bx = 40, by = H - 64, bw = W - 80, bh = 20;
  ctx.textAlign = "left"; ctx.fillStyle = "#cfe6f5"; ctx.font = `bold 16px ${FONT}`;
  ctx.fillText(`HP ${Math.round(hp * 100)}%`, bx, by - 8);
  ctx.fillStyle = "rgba(0,0,0,0.55)"; rrect(ctx, bx, by, bw, bh, 10); ctx.fill();
  ctx.fillStyle = hp > 0.4 ? "#ff7a3d" : "#e0523a"; rrect(ctx, bx, by, Math.max(bh, bw * hp), bh, 10); ctx.fill();

  return canvas.toBuffer("image/png");
}
