import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import { User } from "@prisma/client";

try { GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani"); } catch { /* fallback */ }

const ICONS_DIR = path.join(process.cwd(), "assets", "icons");

const CURRENCIES = [
  { key: "credits",          file: "Credits.png",       label: "Credits",        color: "#60A5FA", desc: "Base currency"        },
  { key: "lunakite",         file: "Lunakite.png",       label: "Lunakite",       color: "#818CF8", desc: "Premium currency"     },
  { key: "resonanceRecords", file: "Resonance EXP.png",  label: "Res. Records",   color: "#FBBF24", desc: "Instant EXP item"     },
  { key: "tuningModules",    file: "Tuning Module.png",  label: "Tuning Mod",     color: "#34D399", desc: "Echo EXP"             },
  { key: "sealingTubes",     file: "Sealing Tube.png",   label: "Sealing Tube",   color: "#A78BFA", desc: "Reveal substats"      },
  { key: "forgingOres",      file: "Forging Ore.png",    label: "Forging Ore",    color: "#F97316", desc: "Weapon upgrade"       },
  { key: "paradoxCores",     file: "Paradox Core.png",   label: "Paradox Core",   color: "#EC4899", desc: "Reroll substats"      },
  { key: "stasisLocks",      file: "Stasis Lock.png",    label: "Stasis Lock",    color: "#38BDF8", desc: "Lock a substat"       },
];

const ELEMENT_COLORS: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#38BDF8", ELECTRO: "#A855F7",
  AERO:   "#10B981", HAVOC:  "#EC4899", SPECTRO: "#EAB308", NONE: "#6366F1",
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

export async function generateInventoryCard(user: User, displayName: string, avatarUrl: string | null): Promise<Buffer> {
  const COLS = 4, ROWS = 2;
  const CELL_W = 160, CELL_H = 80;
  const PAD = 20, GAP = 10;
  const HEADER_H = 72;

  const W = PAD * 2 + COLS * CELL_W + (COLS - 1) * GAP;
  const H = HEADER_H + PAD + ROWS * CELL_H + (ROWS - 1) * GAP + PAD;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");
  const P      = ELEMENT_COLORS[user.element] ?? "#6366F1";

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = "#0A0D18";
  rrect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  const bloom = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.7);
  bloom.addColorStop(0, rgba(P, 0.10));
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  // Border
  ctx.shadowColor = P; ctx.shadowBlur = 16;
  ctx.strokeStyle = rgba(P, 0.45); ctx.lineWidth = 1.5;
  rrect(ctx, 1, 1, W - 2, H - 2, 16); ctx.stroke();
  ctx.shadowBlur = 0;

  // Top bar
  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0, P); topBar.addColorStop(0.5, rgba(P, 0.4)); topBar.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topBar;
  rrect(ctx, 1, 1, W - 2, 3, 2); ctx.fill();

  // ── Header: avatar + name ────────────────────────────────────────────────────
  const avR = 24, avCX = PAD + avR, avCY = PAD + avR + 4;

  ctx.shadowColor = P; ctx.shadowBlur = 12;
  ctx.strokeStyle = P; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(avCX, avCY, avR + 2, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.beginPath(); ctx.arc(avCX, avCY, avR, 0, Math.PI * 2); ctx.clip();
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl + "?size=128");
      ctx.drawImage(img, avCX - avR, avCY - avR, avR * 2, avR * 2);
    } catch { ctx.fillStyle = rgba(P, 0.3); ctx.fillRect(avCX - avR, avCY - avR, avR * 2, avR * 2); }
  }
  ctx.restore();

  const TX = PAD + avR * 2 + 14;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 18px Rajdhani, 'Arial Black', Arial`;
  ctx.fillText(displayName, TX, avCY - 4);

  ctx.fillStyle = rgba(P, 0.75);
  ctx.font = `bold 9px Rajdhani, Arial`;
  ctx.letterSpacing = "2px";
  ctx.fillText("MATERIAL INVENTORY", TX, avCY + 14);
  ctx.letterSpacing = "0px";

  // Section rule
  ctx.strokeStyle = rgba(P, 0.2); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, HEADER_H - 4); ctx.lineTo(W - PAD, HEADER_H - 4); ctx.stroke();

  // ── Currency cells ───────────────────────────────────────────────────────────
  for (let i = 0; i < CURRENCIES.length; i++) {
    const curr = CURRENCIES[i];
    const col  = i % COLS, row = Math.floor(i / COLS);
    const cx   = PAD + col * (CELL_W + GAP);
    const cy   = HEADER_H + PAD + row * (CELL_H + GAP);
    const val  = (user as any)[curr.key] as number ?? 0;

    // Cell bg
    ctx.fillStyle = rgba(curr.color, 0.07);
    rrect(ctx, cx, cy, CELL_W, CELL_H, 10); ctx.fill();
    ctx.strokeStyle = rgba(curr.color, val > 0 ? 0.35 : 0.10);
    ctx.lineWidth = 1;
    rrect(ctx, cx, cy, CELL_W, CELL_H, 10); ctx.stroke();

    // Left accent bar
    ctx.fillStyle = val > 0 ? curr.color : rgba(curr.color, 0.3);
    rrect(ctx, cx, cy, 3, CELL_H, 2); ctx.fill();

    // Icon
    const iconSize = 32;
    if (curr.file) {
      try {
        const img = await loadImage(path.join(ICONS_DIR, curr.file));
        ctx.drawImage(img, cx + 12, cy + (CELL_H - iconSize) / 2, iconSize, iconSize);
      } catch {
        ctx.fillStyle = curr.color;
        ctx.font = `bold 14px Rajdhani, Arial`;
        ctx.fillText(curr.label[0], cx + 18, cy + CELL_H / 2 + 5);
      }
    } else {
      ctx.fillStyle = curr.color;
      ctx.font = `bold 14px Rajdhani, Arial`;
      ctx.fillText(curr.label[0], cx + 18, cy + CELL_H / 2 + 5);
    }

    // Text
    const textX = cx + 12 + iconSize + 8;
    ctx.fillStyle = rgba(curr.color, 0.8);
    ctx.font = `bold 9px Rajdhani, Arial`;
    ctx.fillText(curr.label.toUpperCase(), textX, cy + 22);

    ctx.fillStyle = val > 0 ? "#F1F5F9" : "#334155";
    ctx.font = `bold 20px Rajdhani, 'Arial Black', Arial`;
    ctx.fillText(val.toLocaleString(), textX, cy + 46);

    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = `9px Rajdhani, Arial`;
    ctx.fillText(curr.desc, textX, cy + 62);
  }

  // Watermark
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.font = `bold 9px Rajdhani, Arial`;
  ctx.letterSpacing = "3px";
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA", W - PAD, H - 8);
  ctx.textAlign = "left"; ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}
