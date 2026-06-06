import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";

try {
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#38BDF8", ELECTRO: "#A855F7",
  AERO: "#10B981", HAVOC: "#EC4899", SPECTRO: "#EAB308", NONE: "#6366F1",
};

function rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
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

export interface Fighter {
  name:      string;
  avatarUrl: string | null;
  element:   string;
  level:     number;
  hp:        number;
  atk:       number;
}

async function drawFighter(
  ctx: SKRSContext2D, f: Fighter, cx: number, cy: number, mirror: boolean,
) {
  const color = ELEMENT_HEX[f.element] ?? ELEMENT_HEX.NONE;
  const r = 70;

  // Glow ring
  ctx.shadowColor = color; ctx.shadowBlur = 30;
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;

  // Avatar
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (f.avatarUrl) {
    try {
      const img = await loadImage(f.avatarUrl + "?size=256");
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    } catch { ctx.fillStyle = rgba(color, 0.3); ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  } else { ctx.fillStyle = rgba(color, 0.3); ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();

  // Name
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 24px Rajdhani, Arial`;
  ctx.textAlign = "center";
  ctx.fillText(f.name.slice(0, 16), cx, cy + r + 34);

  // Element + level pill
  ctx.fillStyle = color;
  ctx.font = `bold 13px Rajdhani, Arial`;
  ctx.fillText(`${f.element}  ·  Lv ${f.level}`, cx, cy + r + 54);

  // Stat line
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `bold 12px Rajdhani, Arial`;
  ctx.fillText(`${f.hp.toLocaleString()} HP   ${f.atk} ATK`, cx, cy + r + 72);
  ctx.textAlign = "left";
}

// ── Duel intro / result (two fighters) ────────────────────────────────────────
export async function generateVersusCard(
  left: Fighter, right: Fighter, opts?: { winner?: "left" | "right"; subtitle?: string },
): Promise<Buffer> {
  const W = 760, H = 320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const lc = ELEMENT_HEX[left.element]  ?? ELEMENT_HEX.NONE;
  const rc = ELEMENT_HEX[right.element] ?? ELEMENT_HEX.NONE;

  // Background — split element gradient
  const bg = ctx.createLinearGradient(0, 0, W, 0);
  bg.addColorStop(0,    rgba(lc, 0.28));
  bg.addColorStop(0.42, "#070910");
  bg.addColorStop(0.58, "#070910");
  bg.addColorStop(1,    rgba(rc, 0.28));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Diagonal divider sheen
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.rotate(0.18);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(-4, -H, 8, H * 2);
  ctx.restore();

  await drawFighter(ctx, left,  W * 0.24, H * 0.42, false);
  await drawFighter(ctx, right, W * 0.76, H * 0.42, true);

  // VS glyph
  ctx.save();
  ctx.shadowColor = "#FFFFFF"; ctx.shadowBlur = 18;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 56px Rajdhani, 'Arial Black', Arial`;
  ctx.textAlign = "center";
  ctx.fillText("VS", W / 2, H * 0.46);
  ctx.restore();
  ctx.textAlign = "left";

  // Winner banner
  if (opts?.winner) {
    const win = opts.winner === "left" ? left : right;
    const wc  = ELEMENT_HEX[win.element] ?? ELEMENT_HEX.NONE;
    ctx.fillStyle = rgba(wc, 0.92);
    rrect(ctx, W / 2 - 150, H - 52, 300, 34, 8); ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold 18px Rajdhani, 'Arial Black', Arial`;
    ctx.textAlign = "center";
    ctx.fillText(`✦  ${win.name.slice(0, 18)} WINS  ✦`, W / 2, H - 29);
    ctx.textAlign = "left";
  } else if (opts?.subtitle) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `bold 14px Rajdhani, Arial`;
    ctx.textAlign = "center";
    ctx.fillText(opts.subtitle, W / 2, H - 24);
    ctx.textAlign = "left";
  }

  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1.5;
  rrect(ctx, 1, 1, W - 2, H - 2, 0); ctx.stroke();

  // Watermark
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.font = `bold 9px Rajdhani, Arial`;
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA", W - 12, H - 8);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}

// ── Raid roster card (boss + participants) ────────────────────────────────────
export async function generateRaidCard(
  bossName: string, bossElement: string, bossArtPath: string | null,
  participants: { name: string; element: string }[],
  opts?: { victory?: boolean; defeat?: boolean },
): Promise<Buffer> {
  const W = 760, H = 340;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const bc = ELEMENT_HEX[bossElement] ?? "#EC4899";

  // BG
  const bg = ctx.createRadialGradient(W / 2, 120, 0, W / 2, 120, W * 0.7);
  bg.addColorStop(0, rgba(bc, 0.25)); bg.addColorStop(1, "#070910");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Boss art (top, centered)
  if (bossArtPath) {
    try {
      const art = await loadImage(bossArtPath);
      const scale = Math.min(220 / art.width, 200 / art.height);
      const sw = art.width * scale, sh = art.height * scale;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(art, (W - sw) / 2, 12, sw, sh);
      ctx.globalAlpha = 1;
    } catch { /* skip */ }
  }

  // Title
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 26px Rajdhani, 'Arial Black', Arial`;
  ctx.textAlign = "center";
  ctx.fillText(`☄️  ${bossName}`, W / 2, 232);

  // Participants row
  ctx.font = `bold 14px Rajdhani, Arial`;
  const names = participants.map(p => p.name).join("   ·   ");
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(names.slice(0, 70), W / 2, 262);

  ctx.fillStyle = rgba(bc, 0.8);
  ctx.font = `bold 12px Rajdhani, Arial`;
  ctx.fillText(`${participants.length} Resonator${participants.length !== 1 ? "s" : ""} united`, W / 2, 284);

  // Result banner
  if (opts?.victory || opts?.defeat) {
    const txt  = opts.victory ? "✦  RAID CLEARED  ✦" : "✦  RESONATORS FELL  ✦";
    const col  = opts.victory ? "#F5A623" : "#4A4A5A";
    ctx.fillStyle = rgba(col, 0.92);
    rrect(ctx, W / 2 - 150, H - 46, 300, 32, 8); ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold 17px Rajdhani, 'Arial Black', Arial`;
    ctx.fillText(txt, W / 2, H - 24);
  }
  ctx.textAlign = "left";

  // Border + watermark
  ctx.strokeStyle = rgba(bc, 0.35); ctx.lineWidth = 1.5;
  rrect(ctx, 1, 1, W - 2, H - 2, 0); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.font = `bold 9px Rajdhani, Arial`;
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA  ·  CALAMITY RAID", W - 12, H - 8);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}
