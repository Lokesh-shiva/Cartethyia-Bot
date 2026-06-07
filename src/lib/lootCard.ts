import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import { LootResult } from "./loot";

try { try { GlobalFonts.loadSystemFonts(); } catch {}
GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani"); } catch { /* fallback */ }

const ICONS_DIR = path.join(process.cwd(), "assets", "icons");

// Exact filenames on disk
const ICON_FILES: Record<string, string> = {
  credits:          "Credits.png",
  tuningModules:    "Tuning Module.png",
  sealingTubes:     "Sealing Tube.png",
  forgingOres:      "Forging Ore.png",
  resonanceExp:     "Resonance EXP.png",
  resonanceRecords: "Resonance EXP.png",  // same icon — records are EXP items
  paradoxCores:     "Paradox Core.png",
  stasisLocks:      "Stasis Lock.png",
  lunakite:         "Lunakite.png",
};

const ITEM_LABELS: Record<string, string> = {
  credits:          "Credits",
  tuningModules:    "Tuning Mod.",
  sealingTubes:     "Sealing Tube",
  forgingOres:      "Forging Ore",
  resonanceExp:     "Res. EXP",
  resonanceRecords: "Res. Record",
  paradoxCores:     "Paradox Core",
  stasisLocks:   "Stasis Lock",
  lunakite:      "Lunakite",
};

const ITEM_COLORS: Record<string, string> = {
  credits:       "#60A5FA",
  tuningModules: "#34D399",
  sealingTubes:  "#A78BFA",
  forgingOres:   "#F97316",
  resonanceExp:  "#FBBF24",
  paradoxCores:  "#EC4899",
  stasisLocks:   "#38BDF8",
  lunakite:      "#818CF8",
};

function rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function rrect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export interface LootCardOptions {
  loot:         LootResult;
  actorName:    string;
  elementColor: string;   // hex, e.g. "#A855F7"
  affinity:     number | null;
  isReturn:     boolean;
}

export async function generateLootCard(opts: LootCardOptions): Promise<Buffer> {
  // Collect only non-zero items
  const items: { key: string; val: number }[] = [
    { key: "credits",          val: opts.loot.credits          },
    { key: "tuningModules",    val: opts.loot.tuningModules    },
    { key: "sealingTubes",     val: opts.loot.sealingTubes     },
    { key: "forgingOres",      val: opts.loot.forgingOres      },
    { key: "resonanceExp",     val: opts.loot.resonanceExp     },
    { key: "resonanceRecords", val: opts.loot.resonanceRecords ?? 0 },
  ].filter((i) => i.val > 0);

  const ICON_SIZE  = 52;
  const ITEM_W     = 76;    // icon + label column width
  const PAD        = 20;
  const TOP_H      = 36;    // header area height
  const BOTTOM_H   = opts.affinity !== null ? 30 : 0;
  const ITEM_H     = ICON_SIZE + 28; // icon + label below

  const cols       = Math.max(items.length, 1);
  const W          = Math.max(PAD * 2 + cols * ITEM_W + (cols - 1) * 10, 280);
  const H          = TOP_H + PAD + ITEM_H + PAD + BOTTOM_H + (BOTTOM_H ? 0 : PAD / 2);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const P = opts.elementColor;

  // ── Background ──────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0A0D14");
  bg.addColorStop(1, rgba(P, 0.12));
  ctx.fillStyle = bg;
  rrect(ctx, 0, 0, W, H, 14);
  ctx.fill();

  // Border
  ctx.shadowColor = P;
  ctx.shadowBlur  = 14;
  ctx.strokeStyle = rgba(P, 0.55);
  ctx.lineWidth   = 1.5;
  rrect(ctx, 1, 1, W - 2, H - 2, 14);
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Top accent bar
  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0, P);
  topBar.addColorStop(0.6, rgba(P, 0.3));
  topBar.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topBar;
  rrect(ctx, 1, 1, W - 2, 3, 2);
  ctx.fill();

  // ── Header ──────────────────────────────────────────────────────────────────
  ctx.fillStyle = rgba(P, 0.75);
  ctx.font      = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px";
  const header  = opts.isReturn ? "◈  RESONANCE YIELD  ·  ⚡ 2× BONUS" : "◈  RESONANCE YIELD";
  ctx.fillText(header, PAD, TOP_H - 10);
  ctx.letterSpacing = "0px";

  // Thin rule under header
  const rule = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  rule.addColorStop(0, rgba(P, 0.7));
  rule.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = rule;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, TOP_H - 4);
  ctx.lineTo(W - PAD, TOP_H - 4);
  ctx.stroke();

  // ── Items ────────────────────────────────────────────────────────────────────
  if (items.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font      = `13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No drop this time.", W / 2, TOP_H + PAD + ICON_SIZE / 2 + 6);
    ctx.textAlign = "left";
  } else {
    // Centre the row of items
    const rowW  = cols * ITEM_W + (cols - 1) * 10;
    const startX = (W - rowW) / 2;

    for (let i = 0; i < items.length; i++) {
      const { key, val } = items[i];
      const color = ITEM_COLORS[key] ?? "#FFFFFF";
      const ix    = startX + i * (ITEM_W + 10);
      const iy    = TOP_H + PAD;

      // Icon background pill
      ctx.fillStyle = rgba(color, 0.12);
      rrect(ctx, ix + (ITEM_W - ICON_SIZE) / 2, iy, ICON_SIZE, ICON_SIZE, 12);
      ctx.fill();
      ctx.strokeStyle = rgba(color, 0.35);
      ctx.lineWidth   = 1;
      rrect(ctx, ix + (ITEM_W - ICON_SIZE) / 2, iy, ICON_SIZE, ICON_SIZE, 12);
      ctx.stroke();

      // Icon image
      try {
        const img = await loadImage(path.join(ICONS_DIR, ICON_FILES[key]));
        const pad = 6;
        const iix = ix + (ITEM_W - ICON_SIZE) / 2 + pad;
        const iiy = iy + pad;
        const isz = ICON_SIZE - pad * 2;
        ctx.drawImage(img, iix, iiy, isz, isz);
      } catch {
        // fallback: colored circle with first letter
        ctx.fillStyle = color;
        ctx.font      = `bold 20px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(ITEM_LABELS[key][0], ix + ITEM_W / 2, iy + ICON_SIZE / 2 + 7);
        ctx.textAlign = "left";
      }

      // Count badge (top-right of icon)
      const badgeX = ix + (ITEM_W - ICON_SIZE) / 2 + ICON_SIZE - 18;
      const badgeY = iy - 6;
      ctx.fillStyle = color;
      rrect(ctx, badgeX, badgeY, 22, 16, 8);
      ctx.fill();
      ctx.fillStyle = "#000000";
      ctx.font      = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(val), badgeX + 11, badgeY + 11);
      ctx.textAlign = "left";

      // Item label below icon
      ctx.fillStyle = rgba(color, 0.8);
      ctx.font      = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(ITEM_LABELS[key], ix + ITEM_W / 2, iy + ICON_SIZE + 16);
      ctx.textAlign = "left";
    }
  }

  // ── Affinity row ─────────────────────────────────────────────────────────────
  if (opts.affinity !== null) {
    const ay = H - BOTTOM_H + 6;

    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, ay - 4);
    ctx.lineTo(W - PAD, ay - 4);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font      = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(
      `◇  Synchrony  +10  ·  Total  ${opts.affinity}`,
      W / 2, ay + 14
    );
    ctx.textAlign = "left";
  }

  // ── Watermark ────────────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.font      = `bold 8px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px";
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA", W - PAD, H - 6);
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}
