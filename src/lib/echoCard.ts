import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";
import { MAIN_STAT_LABELS, SUBSTAT_LABELS, formatStatValue, substatCount, maxEchoLevel, FLAT_STATS, calcSubstatValue } from "./echoes";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#4FC3F7", ELECTRO: "#B39DDB",
  AERO: "#80CBC4", HAVOC: "#C355E0", SPECTRO: "#FFD54F", NONE: "#8B7FF5",
};
const RARITY_HEX: Record<string, string> = {
  THREE_STAR: "#78B0C8", FOUR_STAR: "#C088E8", FIVE_STAR: "#F5A623",
};
const ELEMENT_GLYPH: Record<string, string> = {
  FUSION: "🔥", GLACIO: "❄", ELECTRO: "⚡", AERO: "🌪", HAVOC: "🌑", SPECTRO: "✦", NONE: "◇",
};

function rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Draw a filled 5-point star centered at (cx, cy)
function drawStar(ctx: SKRSContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outer = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const inner = outer + (2 * Math.PI) / 5;
    ctx.lineTo(cx + Math.cos(outer) * r, cy + Math.sin(outer) * r);
    ctx.lineTo(cx + Math.cos(inner) * r * 0.42, cy + Math.sin(inner) * r * 0.42);
  }
  ctx.closePath(); ctx.fill();
}

// Draw a small padlock at (x, y) top-left
function drawLock(ctx: SKRSContext2D, x: number, y: number, color: string) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(x + 5, y + 4, 3, Math.PI, 0); ctx.stroke();        // shackle
  ctx.fillRect(x + 1, y + 4, 8, 7);                                           // body
}
function rrect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export interface EchoCardData {
  name:        string;
  element:     string;
  rarity:      string;     // THREE_STAR | FOUR_STAR | FIVE_STAR
  cost:        number;
  level:       number;
  mainStatType:  string;
  mainStatValue: number;
  revealedSubstats: number;
  substats: { type: string; value: number; locked: boolean }[]; // all (revealed + sealed), in order
}

// Boss echo names don't always match the Bosses/ filenames directly
const BOSS_ART_FILENAMES: Record<string, string> = {
  "Resonant Wraith":      "The Resonant Wraith.png",
  "Tidecaller Sovereign": "Tidecaller Sovereign.png",
  "Fractured Arbiter":    "The Fractured Arbiter.png",
  "Nullfire Construct":   "Nullfire Construct.png",
  "Sable Harbinger":      "Sable Harbinger.png",
  "Auric Colossus":       "Auric Colossus.png",
  "Embercrown Tyrant":    "Embercrown Tyrant.png",
  "Galeborne Phantom":    "Galeborne Phantom.png",
  "Resonant Absolute":    "The Resonant Absolute.png",
  "Ignis Behemoth":       "Ignis Behemoth.png",
  "Permafrost Sovereign": "Permafrost Sovereign.png",
  "Voltaic Aberrant":     "Voltaic Aberrant.png",
  "Tempest Ancient":      "Tempest Ancient.png",
  "Null Ravager":         "Null Ravager.png",
  "Luminal Specter":      "Luminal Specter.png",
};

function echoArtPath(name: string, cost: number): string | null {
  if (cost !== 4) {
    const sub = path.join(process.cwd(), "assets", "echoes", `${cost}-cost`, `${name}.png`);
    if (fs.existsSync(sub)) return sub;
  }
  // 4-cost boss echoes live in the Bosses/ folder
  if (cost === 4) {
    const bossFile = BOSS_ART_FILENAMES[name] ?? `${name}.png`;
    const bossPath = path.join(process.cwd(), "Bosses", bossFile);
    if (fs.existsSync(bossPath)) return bossPath;
  }
  const snake = path.join(process.cwd(), "assets", "echoes", name.toLowerCase().replace(/\s+/g, "_") + ".png");
  return fs.existsSync(snake) ? snake : null;
}

export async function generateEchoCard(e: EchoCardData): Promise<Buffer> {
  const W = 380, H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const ec = ELEMENT_HEX[e.element] ?? ELEMENT_HEX.NONE;
  const rc = RARITY_HEX[e.rarity]   ?? RARITY_HEX.THREE_STAR;
  const total = substatCount(e.rarity as any);

  // ── Base ────────────────────────────────────────────────────────────────────
  ctx.fillStyle = "#0B0C14"; ctx.fillRect(0, 0, W, H);
  // element bloom
  const bloom = ctx.createRadialGradient(W / 2, 180, 0, W / 2, 180, 300);
  bloom.addColorStop(0, rgba(ec, 0.22)); bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom; ctx.fillRect(0, 0, W, H);

  // ── Art panel ─────────────────────────────────────────────────────────────
  const artX = 18, artY = 56, artW = W - 36, artH = 300;
  ctx.save();
  rrect(ctx, artX, artY, artW, artH, 12); ctx.clip();
  ctx.fillStyle = rgba(ec, 0.10); ctx.fillRect(artX, artY, artW, artH);
  const artPath = echoArtPath(e.name, e.cost);
  if (artPath) {
    try {
      const img = await loadImage(artPath);
      const scale = Math.max(artW / img.width, artH / img.height);
      const sw = img.width * scale, sh = img.height * scale;
      // 4-cost boss art is 9:16 portrait — top-align so the head is always visible.
      // 1/3-cost echo art is icon-like — center it.
      const drawY = e.cost === 4
        ? artY                          // anchor top of image to top of panel
        : artY + (artH - sh) / 2;      // center vertically
      ctx.drawImage(img, artX + (artW - sw) / 2, drawY, sw, sh);
    } catch { /* glyph fallback below */ }
  } else {
    ctx.fillStyle = rgba(ec, 0.5); ctx.font = `bold 120px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.fillText("?", W / 2, artY + artH / 2 + 44); ctx.textAlign = "left";
  }
  // bottom fade into panel
  const fade = ctx.createLinearGradient(0, artY + artH - 80, 0, artY + artH);
  fade.addColorStop(0, "rgba(11,12,20,0)"); fade.addColorStop(1, "rgba(11,12,20,0.95)");
  ctx.fillStyle = fade; ctx.fillRect(artX, artY + artH - 80, artW, 80);
  ctx.restore();
  // art frame
  ctx.strokeStyle = rgba(ec, 0.7); ctx.lineWidth = 1.5;
  rrect(ctx, artX, artY, artW, artH, 12); ctx.stroke();

  // ── Top bar: rarity stars (left) + cost badge (right) ─────────────────────
  const starCount = e.rarity === "THREE_STAR" ? 3 : e.rarity === "FOUR_STAR" ? 4 : 5;
  ctx.fillStyle = rc;
  ctx.shadowColor = rc; ctx.shadowBlur = 10;
  for (let i = 0; i < starCount; i++) drawStar(ctx, 30 + i * 24, 30, 9);
  ctx.shadowBlur = 0;

  // cost badge
  const badgeR = 19, bx = W - 34, by = 28;
  ctx.fillStyle = rgba(ec, 0.9); ctx.beginPath(); ctx.arc(bx, by, badgeR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 18px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`; ctx.textAlign = "center";
  ctx.fillText(`${e.cost}`, bx, by + 6); ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = `bold 8px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.fillText("COST", bx, by + badgeR + 9); ctx.textAlign = "left";

  // ── Name + element + level (over art bottom) ──────────────────────────────
  ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 26px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.fillText(e.name.length > 18 ? e.name.slice(0, 17) + "…" : e.name, 22, artY + artH - 16);
  // element dot + label
  ctx.fillStyle = ec; ctx.beginPath(); ctx.arc(27, artY + artH + 2, 4, 0, Math.PI * 2); ctx.fill();
  ctx.font = `bold 13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(e.element, 38, artY + artH + 6);
  // level pill (right)
  const lvText = `Lv ${e.level}/${maxEchoLevel(e.rarity)}`;
  ctx.font = `bold 13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  const lvW = ctx.measureText(lvText).width + 18;
  ctx.fillStyle = rgba(ec, 0.18); rrect(ctx, W - 22 - lvW, artY + artH - 6, lvW, 20, 10); ctx.fill();
  ctx.strokeStyle = rgba(ec, 0.6); ctx.lineWidth = 1; rrect(ctx, W - 22 - lvW, artY + artH - 6, lvW, 20, 10); ctx.stroke();
  ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center";
  ctx.fillText(lvText, W - 22 - lvW / 2, artY + artH + 8); ctx.textAlign = "left";

  // ── Main stat ─────────────────────────────────────────────────────────────
  const msY = artY + artH + 30;
  ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px"; ctx.fillText("MAIN STAT", 22, msY); ctx.letterSpacing = "0px";
  const mainLabel = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
  ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 19px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(mainLabel, 22, msY + 24);
  ctx.fillStyle = ec; ctx.font = `bold 24px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.textAlign = "right";
  const mainVal = FLAT_STATS.has(e.mainStatType) ? `${Math.round(e.mainStatValue)}` : `${e.mainStatValue.toFixed(1)}%`;
  ctx.fillText(mainVal, W - 22, msY + 24); ctx.textAlign = "left";

  // divider
  ctx.strokeStyle = rgba(ec, 0.4); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(22, msY + 38); ctx.lineTo(W - 22, msY + 38); ctx.stroke();

  // ── Substats ──────────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px"; ctx.fillText("SUBSTATS", 22, msY + 58); ctx.letterSpacing = "0px";

  let sy = msY + 80;
  for (let i = 0; i < total; i++) {
    const sub = e.substats[i];
    const revealed = i < e.revealedSubstats;
    if (revealed && sub) {
      const label = SUBSTAT_LABELS[sub.type] ?? sub.type;
      if (sub.locked) { drawLock(ctx, 24, sy - 9, rc); }
      else { ctx.fillStyle = rgba(ec, 0.8); ctx.fillRect(25, sy - 6, 4, 4); }
      ctx.fillStyle = sub.locked ? rc : "rgba(255,255,255,0.88)";
      ctx.font = `bold 14px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
      ctx.fillText(label, 40, sy);
      ctx.fillStyle = sub.locked ? rc : ec; ctx.textAlign = "right";
      ctx.fillText(`+${formatStatValue(sub.type, sub.value)}`, W - 24, sy); ctx.textAlign = "left";
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(25, sy - 6, 4, 4);
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.font = `13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
      ctx.fillText("— sealed —", 40, sy);
    }
    sy += 26;
  }

  // ── Frame + watermark ─────────────────────────────────────────────────────
  ctx.shadowColor = ec; ctx.shadowBlur = 14;
  ctx.strokeStyle = rgba(rc, 0.55); ctx.lineWidth = 2;
  rrect(ctx, 4, 4, W - 8, H - 8, 14); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px"; ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA  ·  ECHO", W - 14, H - 12); ctx.textAlign = "left"; ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}

// Build EchoCardData from a Prisma echo row — substats scaled by current level
export function echoRowToCard(echo: any): EchoCardData {
  const subs = [];
  for (let i = 1; i <= 5; i++) {
    const type = echo[`substat${i}Type`];
    if (!type) continue;
    const base  = echo[`substat${i}Value`] ?? 0;
    const value = calcSubstatValue(type, base, echo.level ?? 0);
    subs.push({ type, value, locked: echo[`substat${i}Locked`] ?? false });
  }
  return {
    name: echo.name, element: echo.element, rarity: echo.rarity, cost: echo.cost,
    level: echo.level, mainStatType: echo.mainStatType, mainStatValue: echo.mainStatValue,
    revealedSubstats: echo.revealedSubstats, substats: subs,
  };
}
