// src/lib/characterCard.ts
// Shared canvas templates for /character's 6-page profile — see
// docs/superpowers/specs/2026-07-17-solace-character-card-design.md §3/§4.
// Element-driven theming (not a bespoke per-character palette) so a future
// 2nd character needs zero new design work.

import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";

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

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
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

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bgGradient[0]); grad.addColorStop(1, theme.bgGradient[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  if (input.portraitPath && fs.existsSync(input.portraitPath)) {
    const img = await loadImage(input.portraitPath);
    const pw = 340, ph = H;
    ctx.save();
    rrect(ctx, 0, 0, pw, ph, 0); ctx.clip();
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img as any, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
    ctx.restore();
    const fade = ctx.createLinearGradient(pw - 120, 0, pw, 0);
    fade.addColorStop(0, "rgba(15,15,26,0)"); fade.addColorStop(1, "rgba(15,15,26,1)");
    ctx.fillStyle = fade; ctx.fillRect(pw - 120, 0, 120, H);
  }

  const px = input.portraitPath ? 380 : 48;
  ctx.fillStyle = theme.accent;
  ctx.font = font(38);
  ctx.fillText(input.characterName, px, 80);
  ctx.fillStyle = "#CBD5E1";
  ctx.font = font(20, "600");
  ctx.fillText(input.subtitle, px, 112);

  ctx.strokeStyle = rgba(theme.accent, 0.4); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, 130); ctx.lineTo(W - 48, 130); ctx.stroke();

  const barX = px, barW = W - 48 - px, barH = 22, gap = 44;
  let y = 165;
  for (const bar of input.bars) {
    ctx.fillStyle = "#94A3B8"; ctx.font = font(17, "600");
    ctx.fillText(bar.label, barX, y - 8);
    ctx.fillStyle = "#E2E8F0"; ctx.font = font(17, "700");
    ctx.textAlign = "right";
    ctx.fillText(bar.displayValue, barX + barW, y - 8);
    ctx.textAlign = "left";

    rrect(ctx, barX, y, barW, barH, 8); ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
    const pct = Math.max(0, Math.min(1, bar.max > 0 ? bar.value / bar.max : 0));
    if (pct > 0) { rrect(ctx, barX, y, barW * pct, barH, 8); ctx.fillStyle = theme.accent; ctx.fill(); }
    y += gap;
  }

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

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bgGradient[0]); grad.addColorStop(1, theme.bgGradient[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = theme.accent; ctx.font = font(34);
  ctx.fillText(`${input.characterName}`, 48, 66);
  ctx.fillStyle = "#CBD5E1"; ctx.font = font(19, "600");
  ctx.fillText(input.subtitle, 48, 96);

  const cols = Math.min(6, input.slots.length) || 1;
  const cellW = 140, cellH = 170, gapX = 24, gapY = 24;
  const totalW = cols * cellW + (cols - 1) * gapX;
  const startX = (W - totalW) / 2;
  const startY = 140;

  for (let i = 0; i < input.slots.length; i++) {
    const slot = input.slots[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (cellW + gapX), y = startY + row * (cellH + gapY);

    rrect(ctx, x, y, cellW, cellH, 12);
    ctx.fillStyle = slot.filled ? rgba(theme.accent, 0.15) : "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.strokeStyle = slot.filled ? theme.accent : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2; rrect(ctx, x, y, cellW, cellH, 12); ctx.stroke();

    if (slot.filled && slot.iconPath && fs.existsSync(slot.iconPath)) {
      const img = await loadImage(slot.iconPath);
      const iw = cellW - 24, ih = 90;
      ctx.drawImage(img as any, x + 12, y + 12, iw, ih);
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

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bgGradient[0]); grad.addColorStop(1, theme.bgGradient[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  const pw = 320;
  if (fs.existsSync(input.portraitPath)) {
    const img = await loadImage(input.portraitPath);
    ctx.save();
    rrect(ctx, 0, 0, pw, H, 0); ctx.clip();
    const scale = Math.max(pw / img.width, H / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img as any, (pw - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    const fade = ctx.createLinearGradient(pw - 100, 0, pw, 0);
    fade.addColorStop(0, "rgba(15,15,26,0)"); fade.addColorStop(1, "rgba(15,15,26,1)");
    ctx.fillStyle = fade; ctx.fillRect(pw - 100, 0, 100, H);
  }

  const tx = pw + 40, tw = W - pw - 80;
  ctx.fillStyle = theme.accent; ctx.font = font(30);
  ctx.fillText(`${input.characterName} — Lore`, tx, 56);

  let y = 96;
  ctx.font = font(15, "500");
  for (const frag of input.fragments) {
    ctx.fillStyle = frag.unlocked ? "#E2E8F0" : "#3F3F52";
    const text = frag.unlocked ? frag.text : "▓▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓ ▓▓▓▓▓.";
    y = wrapText(ctx, text, tx, y, tw, 21) + 20;
  }

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
