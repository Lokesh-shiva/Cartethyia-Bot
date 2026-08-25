// src/lib/tournamentBracketCard.ts
// Pure canvas renderer for the tournament bracket tree — takes already-
// resolved display data (names/elements/winner flags), no DB/Discord calls
// in here. Caller (tournamentSweep.ts) owns all lookups.
import { createCanvas, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

// Same fallback stack as canvas.ts — a bracket has to render whatever
// nickname a player picked (CJK, full-width, stylized Unicode, emoji),
// not just Latin text.
const FONT_FALLBACK = `'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', 'Arial Unicode MS', Arial, sans-serif`;

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#38BDF8", ELECTRO: "#A855F7",
  AERO: "#10B981", HAVOC: "#EC4899", SPECTRO: "#EAB308", NONE: "#8B7FF5",
};

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
function fitText(ctx: SKRSContext2D, text: string, basePx: number, maxWidth: number, bold = true): string {
  let px = basePx;
  const weight = bold ? "bold " : "";
  while (px > 9) {
    ctx.font = `${weight}${px}px Rajdhani, ${FONT_FALLBACK}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 1;
  }
  return ctx.font;
}

export interface BracketSlot {
  name:    string | null; // null = round not reached yet
  element: string | null;
  isWinner: boolean;      // dim if false AND the match is resolved; full color if true or match unresolved
}
export interface BracketMatch {
  a: BracketSlot;
  b: BracketSlot | null;  // null = this is a bye, `a` auto-advances
  resolved: boolean;
}
export interface BracketRound {
  matches: BracketMatch[];
}

const BOX_W = 220, BOX_H = 56, BOX_GAP = 18, COL_GAP = 70;
const MARGIN = 30;

export async function generateTournamentBracketCard(
  rounds: BracketRound[],
  champion: { name: string; element: string } | null,
): Promise<Buffer> {
  const round1Count = rounds[0]?.matches.length ?? 1;
  const numRounds = rounds.length;

  const colW = BOX_W + COL_GAP;
  const totalW = MARGIN * 2 + numRounds * colW + (champion ? BOX_W : 0);
  const totalH = MARGIN * 2 + round1Count * (BOX_H + BOX_GAP);

  const canvas = createCanvas(Math.max(totalW, 600), Math.max(totalH, 300));
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#08070E";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bloom = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, canvas.width * 0.6);
  bloom.addColorStop(0, "rgba(99,102,241,0.10)"); bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Compute each box's Y center per round: round 1 evenly spaced, every
  // later round's box Y is the average of its two feeder boxes' Y (standard
  // bracket vertical-centering recursion).
  const centersByRound: number[][] = [];
  centersByRound[0] = rounds[0].matches.map((_, i) => MARGIN + i * (BOX_H + BOX_GAP) + BOX_H / 2);
  for (let r = 1; r < numRounds; r++) {
    const prev = centersByRound[r - 1];
    centersByRound[r] = rounds[r].matches.map((_, i) => (prev[2 * i] + prev[2 * i + 1]) / 2);
  }

  function drawSlot(x: number, y: number, w: number, h: number, slot: BracketSlot, resolved: boolean) {
    const dim = resolved && !slot.isWinner;
    const color = slot.element ? (ELEMENT_HEX[slot.element] ?? ELEMENT_HEX.NONE) : "#6B7280";
    ctx.fillStyle = dim ? "rgba(255,255,255,0.04)" : rgba(color, 0.12);
    rrect(ctx, x, y, w, h, 6); ctx.fill();
    ctx.strokeStyle = dim ? "rgba(255,255,255,0.08)" : rgba(color, 0.55);
    ctx.lineWidth = 1.2; rrect(ctx, x, y, w, h, 6); ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = dim ? "rgba(255,255,255,0.35)" : "#FFFFFF";
    const label = slot.name ?? "TBD";
    ctx.font = fitText(ctx, label, 15, w - 20, !dim);
    ctx.fillText(label.length > 22 ? label.slice(0, 21) + "…" : label, x + 10, y + h / 2 + 5);
  }

  for (let r = 0; r < numRounds; r++) {
    const x = MARGIN + r * colW;
    const round = rounds[r];
    for (let i = 0; i < round.matches.length; i++) {
      const m = round.matches[i];
      const cy = centersByRound[r][i];
      if (m.b === null) {
        // Bye — single centered slot
        drawSlot(x, cy - BOX_H / 2, BOX_W, BOX_H, m.a, true);
      } else {
        const halfGap = 4;
        drawSlot(x, cy - BOX_H - halfGap, BOX_W, BOX_H, m.a, m.resolved);
        drawSlot(x, cy + halfGap, BOX_W, BOX_H, m.b, m.resolved);
      }
    }
  }

  // Connector lines: for round r, match i feeds round r+1, match floor(i/2).
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5;
  for (let r = 0; r < numRounds - 1; r++) {
    const x = MARGIN + r * colW + BOX_W;
    const nextX = MARGIN + (r + 1) * colW;
    for (let i = 0; i < rounds[r].matches.length; i++) {
      const cy = centersByRound[r][i];
      const nextI = Math.floor(i / 2);
      const nextCy = centersByRound[r + 1] ? centersByRound[r + 1][nextI] : cy;
      ctx.beginPath();
      ctx.moveTo(x, cy); ctx.lineTo(x + COL_GAP / 2, cy);
      ctx.lineTo(x + COL_GAP / 2, nextCy); ctx.lineTo(nextX, nextCy);
      ctx.stroke();
    }
  }

  // Champion box
  if (champion) {
    const x = MARGIN + numRounds * colW;
    const cy = centersByRound[numRounds - 1][0];
    const color = ELEMENT_HEX[champion.element] ?? ELEMENT_HEX.NONE;
    ctx.fillStyle = rgba(color, 0.22); rrect(ctx, x, cy - BOX_H / 2, BOX_W, BOX_H, 8); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; rrect(ctx, x, cy - BOX_H / 2, BOX_W, BOX_H, 8); ctx.stroke();
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "left";
    const label = `🏆 ${champion.name}`;
    ctx.font = fitText(ctx, label, 16, BOX_W - 20, true);
    ctx.fillText(label.length > 22 ? `🏆 ${champion.name.slice(0, 18)}…` : label, x + 10, cy + 5);
  }

  ctx.textAlign = "left";
  return canvas.toBuffer("image/webp");
}
