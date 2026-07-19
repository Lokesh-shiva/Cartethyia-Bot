// src/lib/characterCard.ts
// Shared canvas templates for /character's 6-page profile — see
// docs/superpowers/specs/2026-07-17-solace-character-card-design.md §3/§4.
// Element-driven theming (not a bespoke per-character palette) so a future
// 2nd character needs zero new design work.

import { createCanvas, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";
import { loadCachedImage } from "./canvas";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#4FC3F7", ELECTRO: "#B39DDB",
  AERO: "#80CBC4", HAVOC: "#C355E0", SPECTRO: "#FFD54F", NONE: "#8B7FF5",
};

export interface ElementTheme {
  accent:     string;
  accentDark: string;
  bgGradient: [string, string];
}

export function getElementTheme(element: string): ElementTheme {
  const accent = ELEMENT_HEX[element.toUpperCase()] ?? ELEMENT_HEX.NONE;
  return { accent, accentDark: rgba(accent, 0.35), bgGradient: ["#0F0F1A", "#1A1A2E"] };
}

// Reuses the same per-element illustrated backgrounds /profile already uses
// (assets/backgrounds/{element}.png) instead of a flat gradient — same file
// resolution order as generateProfileCard in canvas.ts. Draws the art
// cover-fit, then a dark scrim so foreground text
// stays legible over busy art, matching the vignette treatment already used
// by generateProfileCard.
async function paintBackground(ctx: SKRSContext2D, element: string, theme: ElementTheme) {
  const elemKey = element.toLowerCase();
  const bgPaths = [
    path.join(process.cwd(), "assets", "backgrounds", `${elemKey}.png`),
    path.join(process.cwd(), "assets", "backgrounds", `${elemKey}.jpg`),
    path.join(process.cwd(), "assets", "backgrounds", `${elemKey[0].toUpperCase()}${elemKey.slice(1)}.png`),
    path.join(process.cwd(), "assets", "backgrounds", "default.png"),
    path.join(process.cwd(), "assets", "backgrounds", "Default.png"),
  ];
  for (const bgPath of bgPaths) {
    if (fs.existsSync(bgPath)) {
      const img = await loadCachedImage(bgPath);
      const scale = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img as any, (W - dw) / 2, (H - dh) / 2, dw, dh);
      // Dark scrim so text/bars stay legible over bright illustrated skies —
      // heavier at top/bottom (where text/labels sit), lighter through the middle.
      const scrimV = ctx.createLinearGradient(0, 0, 0, H);
      scrimV.addColorStop(0, "rgba(8,8,14,0.70)");
      scrimV.addColorStop(0.45, "rgba(8,8,14,0.55)");
      scrimV.addColorStop(1, "rgba(8,8,14,0.78)");
      ctx.fillStyle = scrimV; ctx.fillRect(0, 0, W, H);
      // Flat darken on top of the vertical scrim — the vertical-only gradient
      // still leaves bright sky patches mid-frame with too little contrast
      // for label text on pages with no portrait to anchor a dark zone
      // (Kit Levels/Echoes/Constellations).
      ctx.fillStyle = "rgba(6,6,12,0.30)"; ctx.fillRect(0, 0, W, H);
      return true;
    }
  }
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bgGradient[0]); grad.addColorStop(1, theme.bgGradient[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  return false;
}

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function mixHex(hexA: string, hexB: string, t: number): string {
  const a = [1, 3, 5].map(i => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map(i => parseInt(hexB.slice(i, i + 2), 16));
  const m = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${m.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}
function rrect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function font(sz: number, w = "bold") { return `${w} ${sz}px Rajdhani, 'Noto Sans', Arial, sans-serif`; }

// Translucent "liquid gold" bar fill: a see-through golden gradient with a
// wet top highlight, a brighter meniscus at the leading edge, and glitter
// specks suspended inside. Sparkle placement uses a deterministic PRNG seeded
// from the fill geometry so the same stats always render the same card (no
// shimmer-flicker between rerenders of an unchanged page).
function liquidGoldFill(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, accent: string) {
  ctx.save();

  // A genuinely BRIGHT gold, not a darkened/muddy one — mix well past the
  // element accent toward pure white-gold. Any dark stop in this fill read
  // as "dirty" to the eye, so this gradient never dips below a light tone.
  const bright = mixHex(accent, "#FFF3C4", 0.6);

  // Soft outer glow so the fill pops off the frosted track instead of
  // blending flatly into it.
  ctx.shadowColor = rgba(bright, 0.65); ctx.shadowBlur = 14;
  rrect(ctx, x, y, w, h, 6);
  ctx.fillStyle = rgba(bright, 0.5);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Base liquid — bright throughout, only a light-to-brighter gradient
  // (never dark) so it still reads as glassy without dipping into murk.
  rrect(ctx, x, y, w, h, 6);
  const liquid = ctx.createLinearGradient(0, y, 0, y + h);
  liquid.addColorStop(0,   rgba(bright, 0.55));
  liquid.addColorStop(0.5, rgba(bright, 0.70));
  liquid.addColorStop(1,   rgba(mixHex(accent, "#FFF3C4", 0.35), 0.80));
  ctx.fillStyle = liquid;
  ctx.fill();

  // Clip everything decorative to the liquid body
  rrect(ctx, x, y, w, h, 6); ctx.clip();

  // Wet-glass top highlight — bright band hugging the upper curve
  const shine = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
  shine.addColorStop(0, "rgba(255,255,255,0.70)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fillRect(x, y, w, h * 0.55);

  // Meniscus — brighter vertical sliver at the leading (right) edge
  const edge = ctx.createLinearGradient(x + w - 10, 0, x + w, 0);
  edge.addColorStop(0, "rgba(255,255,255,0)");
  edge.addColorStop(1, "rgba(255,255,250,0.85)");
  ctx.fillStyle = edge;
  ctx.fillRect(x + w - 10, y, 10, h);

  // Glitter: deterministic star-specks suspended in the liquid. shadowBlur is
  // expensive per-draw-call in @napi-rs/canvas — set it ONCE for the whole
  // batch instead of save/restore-ing it per speck (this loop previously did
  // up to ~30 shadowed draws per bar × 6 bars per page, which was slow enough
  // on the production VM's 2 CPUs to blow past Discord's interaction timeout).
  let seed = (Math.floor(w) * 2654435761 ^ Math.floor(y) * 40503) >>> 0;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const count = Math.max(3, Math.floor(w / 40));
  ctx.shadowColor = "rgba(255,255,255,0.9)"; ctx.shadowBlur = 4;
  for (let i = 0; i < count; i++) {
    const gx = x + 4 + rand() * (w - 8);
    const gy = y + 3 + rand() * (h - 6);
    const gr = 1.4 + rand() * 2.2;
    const ga = 0.75 + rand() * 0.25;
    ctx.fillStyle = `rgba(255,255,255,${ga.toFixed(2)})`;
    // 4-point sparkle: two thin crossed lozenges read as a glint at this size
    ctx.beginPath();
    ctx.moveTo(gx, gy - gr * 2); ctx.quadraticCurveTo(gx + gr * 0.4, gy, gx, gy + gr * 2);
    ctx.quadraticCurveTo(gx - gr * 0.4, gy, gx, gy - gr * 2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(gx - gr * 2, gy); ctx.quadraticCurveTo(gx, gy + gr * 0.4, gx + gr * 2, gy);
    ctx.quadraticCurveTo(gx, gy - gr * 0.4, gx - gr * 2, gy);
    ctx.closePath(); ctx.fill();
    // bright pinpoint core so the glint reads at a glance, not just on close zoom
    ctx.beginPath(); ctx.arc(gx, gy, gr * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;

  ctx.restore();
}

// Draws the portrait on the left edge with its right side fading to
// TRANSPARENT (not to a solid color) — done on an offscreen canvas with a
// destination-out alpha mask so the illustrated card background shows
// through the fade instead of the portrait ending in a hard block.
async function drawPortraitFaded(ctx: SKRSContext2D, portraitPath: string, pw: number) {
  const img = await loadCachedImage(portraitPath);
  const off = createCanvas(pw, H);
  const octx = off.getContext("2d");
  const scale = Math.max(pw / img.width, H / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  octx.drawImage(img as any, (pw - dw) / 2, (H - dh) / 2, dw, dh);
  // Erase alpha along the right edge of the offscreen portrait
  const fadeW = Math.round(pw * 0.45);
  const mask = octx.createLinearGradient(pw - fadeW, 0, pw, 0);
  mask.addColorStop(0, "rgba(0,0,0,0)");
  mask.addColorStop(1, "rgba(0,0,0,1)");
  octx.globalCompositeOperation = "destination-out";
  octx.fillStyle = mask;
  octx.fillRect(pw - fadeW, 0, fadeW, H);
  octx.globalCompositeOperation = "source-over";
  ctx.drawImage(off as any, 0, 0);
}

function diamond(ctx: SKRSContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
  ctx.closePath();
}

// Corner accent ticks — a light frame around the whole canvas plus small
// L-shaped marks in each corner, the "game UI panel" look every gacha card
// uses instead of a plain rectangle border.
function frameCorners(ctx: SKRSContext2D, accent: string) {
  ctx.strokeStyle = rgba(accent, 0.5); ctx.lineWidth = 1.5;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  const L = 22;
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  const corners: [number, number, number, number][] = [
    [10, 10, 1, 1], [W - 10, 10, -1, 1], [10, H - 10, 1, -1], [W - 10, H - 10, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y + L * dy); ctx.lineTo(x, y); ctx.lineTo(x + L * dx, y);
    ctx.stroke();
  }
}

// A soft off-canvas radial glow behind the header — gives the flat gradient
// background some depth instead of reading as a solid-color rectangle.
function headerGlow(ctx: SKRSContext2D, cx: number, cy: number, accent: string) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 260);
  g.addColorStop(0, rgba(accent, 0.16)); g.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = g; ctx.fillRect(cx - 260, cy - 260, 520, 520);
}

// Rounded pill with a thin accent border — used for the subtitle instead of
// plain floating text, and for the ornamental divider's end caps.
function pill(ctx: SKRSContext2D, x: number, y: number, text: string, accent: string) {
  ctx.font = font(16, "700");
  const tw = ctx.measureText(text).width;
  const padX = 14, ph = 26;
  rrect(ctx, x, y, tw + padX * 2, ph, ph / 2);
  ctx.fillStyle = rgba(accent, 0.14); ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.55); ctx.lineWidth = 1; rrect(ctx, x, y, tw + padX * 2, ph, ph / 2); ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillText(text, x + padX, y + 18);
  return tw + padX * 2;
}

function ornamentalDivider(ctx: SKRSContext2D, x: number, y: number, w: number, accent: string) {
  ctx.fillStyle = accent; diamond(ctx, x, y, 4); ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.35); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + w - 10, y); ctx.stroke();
  ctx.fillStyle = accent; diamond(ctx, x + w, y, 4); ctx.fill();
}

const W = 1000, H = 563; // 16:9 landscape

// ── Stats bars (Stats + Kit Levels pages) ──────────────────────────────────

export interface StatBar { label: string; value: number; max: number; displayValue: string; }
export interface StatBarsCardInput {
  characterName: string;
  element:       string;
  subtitle:      string;
  bars:          StatBar[];
  portraitPath?: string;
}

export async function renderStatBarsCard(input: StatBarsCardInput): Promise<Buffer> {
  const theme = getElementTheme(input.element);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  await paintBackground(ctx, input.element, theme);

  if (input.portraitPath && fs.existsSync(input.portraitPath)) {
    await drawPortraitFaded(ctx, input.portraitPath, 340);
  }

  const px = input.portraitPath ? 380 : 48;
  headerGlow(ctx, px + 40, 30, theme.accent);

  ctx.fillStyle = theme.accent;
  ctx.font = font(40);
  diamond(ctx, px + 8, 52, 7); ctx.fill();
  ctx.fillText(input.characterName, px + 26, 62);

  pill(ctx, px, 82, input.subtitle, theme.accent);

  ornamentalDivider(ctx, px, 132, W - 48 - px, theme.accent);

  const barX = px, barW = W - 48 - px, barH = 22, gap = 46;
  let y = 168;
  for (const bar of input.bars) {
    ctx.fillStyle = theme.accent; diamond(ctx, barX + 4, y - 14, 4); ctx.fill();
    ctx.fillStyle = "#94A3B8"; ctx.font = font(17, "600");
    ctx.fillText(bar.label, barX + 16, y - 8);
    ctx.fillStyle = "#E2E8F0"; ctx.font = font(17, "700");
    ctx.textAlign = "right";
    ctx.fillText(bar.displayValue, barX + barW, y - 8);
    ctx.textAlign = "left";

    // Frosted-glass track — light, NOT dark. An opaque dark backing read as
    // "dirty" once the user saw it; a near-opaque light frost keeps the tube
    // visible and clean without exposing the busy background art underneath.
    rrect(ctx, barX, y, barW, barH, 8);
    ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.30)"; ctx.lineWidth = 1; rrect(ctx, barX, y, barW, barH, 8); ctx.stroke();

    const pct = Math.max(0, Math.min(1, bar.max > 0 ? bar.value / bar.max : 0));
    if (pct > 0) {
      const fillW = Math.max(barH, barW * pct); // never smaller than the bar's own rounded end, so tiny % still reads as a bar
      liquidGoldFill(ctx, barX + 2, y + 2, fillW - 4, barH - 4, theme.accent);
    }
    y += gap;
  }

  frameCorners(ctx, theme.accent);
  return canvas.toBuffer("image/png");
}

// ── Slot grid (Echoes + Constellations pages) ──────────────────────────────

export interface GridCardSlot { label: string; sublabel: string; filled: boolean; iconPath?: string; }
export interface SlotGridCardInput {
  characterName: string;
  element:       string;
  subtitle:      string;
  slots:         GridCardSlot[];
}

export async function renderSlotGridCard(input: SlotGridCardInput): Promise<Buffer> {
  const theme = getElementTheme(input.element);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  await paintBackground(ctx, input.element, theme);
  headerGlow(ctx, 88, 30, theme.accent);

  ctx.fillStyle = theme.accent; ctx.font = font(36);
  diamond(ctx, 56, 52, 7); ctx.fill();
  ctx.fillText(`${input.characterName}`, 74, 62);
  pill(ctx, 48, 82, input.subtitle, theme.accent);
  ornamentalDivider(ctx, 48, 128, W - 96, theme.accent);

  const cols = Math.min(6, input.slots.length) || 1;
  const cellW = 140, cellH = 170, gapX = 24, gapY = 24;
  const totalW = cols * cellW + (cols - 1) * gapX;
  const startX = (W - totalW) / 2;
  const startY = 158;

  for (let i = 0; i < input.slots.length; i++) {
    const slot = input.slots[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (cellW + gapX), y = startY + row * (cellH + gapY);

    // Opaque dark base first (the illustrated background is bright — a
    // translucent-only fill isn't enough to keep slot labels readable),
    // then a translucent accent tint on top for filled slots.
    rrect(ctx, x, y, cellW, cellH, 12);
    ctx.fillStyle = "rgba(8,8,14,0.72)";
    ctx.fill();
    if (slot.filled) {
      rrect(ctx, x, y, cellW, cellH, 12);
      ctx.fillStyle = rgba(theme.accent, 0.20);
      ctx.fill();
    }
    ctx.strokeStyle = slot.filled ? theme.accent : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2; rrect(ctx, x, y, cellW, cellH, 12); ctx.stroke();

    if (slot.filled && slot.iconPath && fs.existsSync(slot.iconPath)) {
      const img = await loadCachedImage(slot.iconPath);
      const iw = cellW - 24, ih = 90, ix = x + 12, iy = y + 12;
      ctx.save();
      rrect(ctx, ix, iy, iw, ih, 6); ctx.clip();
      // Cover-fit crop (not a naive stretch) — echo/boss art is scene
      // illustration at various aspect ratios, stretching it to a fixed box
      // warps it noticeably.
      const scale = Math.max(iw / img.width, ih / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img as any, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
      ctx.restore();
    }

    ctx.fillStyle = slot.filled ? "#F1F5F9" : "#64748B";
    ctx.font = font(15, "700");
    ctx.textAlign = "center";
    ctx.fillText(slot.label, x + cellW / 2, y + cellH - 32, cellW - 12);
    ctx.fillStyle = slot.filled ? "#94A3B8" : "#475569";
    ctx.font = font(13, "600");
    ctx.fillText(slot.sublabel, x + cellW / 2, y + cellH - 12, cellW - 12);
    ctx.textAlign = "left";
  }

  frameCorners(ctx, theme.accent);
  return canvas.toBuffer("image/png");
}

// ── Lore (Lore page) ────────────────────────────────────────────────────────

export interface LoreCardInput {
  characterName: string;
  element:       string;
  portraitPath:  string;
  fragments:     { text: string; unlocked: boolean }[];
}

export async function renderLoreCard(input: LoreCardInput): Promise<Buffer> {
  const theme = getElementTheme(input.element);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  await paintBackground(ctx, input.element, theme);

  const pw = 320;
  if (fs.existsSync(input.portraitPath)) {
    await drawPortraitFaded(ctx, input.portraitPath, pw);
  }

  const tx = pw + 40, tw = W - pw - 80;
  headerGlow(ctx, tx + 40, 30, theme.accent);
  ctx.fillStyle = theme.accent; ctx.font = font(30);
  diamond(ctx, tx - 18, 48, 6); ctx.fill();
  ctx.fillText(`${input.characterName} — Lore`, tx, 56);
  ornamentalDivider(ctx, tx, 76, tw, theme.accent);

  let y = 106;
  ctx.font = font(15, "500");
  for (const frag of input.fragments) {
    ctx.fillStyle = frag.unlocked ? "#E2E8F0" : "#3F3F52";
    const text = frag.unlocked ? frag.text : "▓▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓ ▓▓▓▓▓.";
    y = wrapText(ctx, text, tx, y, tw, 21) + 20;
  }

  frameCorners(ctx, theme.accent);
  return canvas.toBuffer("image/png");
}

function wrapText(ctx: SKRSContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word; y += lineH;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}
