import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";
import { getWeaponImagePath } from "./weapons";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#4FC3F7", ELECTRO: "#B39DDB",
  AERO: "#80CBC4", HAVOC: "#C355E0", SPECTRO: "#FFD54F", NONE: "#8B7FF5",
};

const RARITY_COLOR: Record<number, string> = {
  1: "#9CA3AF", 2: "#34D399", 3: "#818CF8", 4: "#F59E0B", 5: "#F43F5E",
};

function rgba(hex: string, a: number) {
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

export interface WeaponCardInput {
  name:        string;
  weaponType:  string;
  rarity:      number;
  level:       number;
  baseAtk:     number;
  effectiveAtk: number;
  subStatType: string | null;
  subStatVal:  number | null;
  effectiveSub: number | null;
  passive:     string;
  element:     string;       // owner's element for theming
  ownerName:   string;
  ownerAvatar: string;
  isUnique?:   boolean;
  userId?:     string;
}

export async function generateWeaponCard(input: WeaponCardInput): Promise<Buffer> {
  const W = 700, H = 280;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const ec = ELEMENT_HEX[input.element.toUpperCase()] ?? ELEMENT_HEX.NONE;
  const rc = RARITY_COLOR[input.rarity] ?? RARITY_COLOR[3];

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = "#080B12";
  ctx.fillRect(0, 0, W, H);

  // Element bloom — radiates from the art side
  const bloom = ctx.createRadialGradient(200, H / 2, 0, 200, H / 2, 320);
  bloom.addColorStop(0, rgba(ec, 0.28));
  bloom.addColorStop(0.5, rgba(ec, 0.10));
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  // Rarity bloom — subtle glow behind art
  const rarBloom = ctx.createRadialGradient(200, H / 2, 0, 200, H / 2, 180);
  rarBloom.addColorStop(0, rgba(rc, 0.18));
  rarBloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rarBloom;
  ctx.fillRect(0, 0, W, H);

  // ── Art panel (left side) ───────────────────────────────────────────────────
  const AX = 18, AY = 18, AW = 260, AH = H - 36;
  ctx.save();
  rrect(ctx, AX, AY, AW, AH, 14);
  ctx.clip();

  // Art background tint
  ctx.fillStyle = rgba(ec, 0.08);
  ctx.fillRect(AX, AY, AW, AH);

  // Load & draw weapon art — centred, cover-fill
  const imgPath = getWeaponImagePath(input.weaponType, input.name, {
    isUnique: input.isUnique,
    userId:   input.userId,
  });
  if (imgPath) {
    try {
      const img   = await loadImage(imgPath);
      const scale = Math.max(AW / img.width, AH / img.height);
      const sw    = img.width * scale, sh = img.height * scale;
      ctx.drawImage(img, AX + (AW - sw) / 2, AY + (AH - sh) / 2, sw, sh);
    } catch { /* fallback */ }
  }

  // Subtle dark vignette over art so UI stays readable
  const vig = ctx.createLinearGradient(AX, AY, AX + AW, AY);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(8,11,18,0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(AX, AY, AW, AH);

  ctx.restore();

  // Rarity border glow on art panel
  ctx.save();
  ctx.shadowColor = rc; ctx.shadowBlur = 18;
  ctx.strokeStyle = rgba(rc, 0.9); ctx.lineWidth = 1.5;
  rrect(ctx, AX, AY, AW, AH, 14); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // ── Vertical divider ────────────────────────────────────────────────────────
  const grad = ctx.createLinearGradient(296, 0, 296, H);
  grad.addColorStop(0,   "rgba(0,0,0,0)");
  grad.addColorStop(0.3, rgba(ec, 0.5));
  grad.addColorStop(0.7, rgba(ec, 0.5));
  grad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.strokeStyle = grad; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(296, 20); ctx.lineTo(296, H - 20); ctx.stroke();

  // ── Stats panel (right side) ────────────────────────────────────────────────
  const SX = 314;
  const font = (size: number, weight = "bold") =>
    `${weight} ${size}px Rajdhani, 'Noto Sans', Arial, sans-serif`;

  // Weapon name
  ctx.fillStyle = input.isUnique ? ec : "#FFFFFF";
  ctx.font = font(26);
  ctx.fillText(input.name, SX, 52);

  // Type label + unique badge
  ctx.fillStyle = rgba("#FFFFFF", 0.45);
  ctx.font = font(12);
  const typeLine = input.weaponType.charAt(0).toUpperCase() + input.weaponType.slice(1).toLowerCase();
  ctx.fillText(typeLine.toUpperCase(), SX, 70);

  if (input.isUnique) {
    const badgeX = SX + ctx.measureText(typeLine.toUpperCase()).width + 10;
    ctx.fillStyle = rgba(ec, 0.2);
    rrect(ctx, badgeX, 58, 58, 14, 3); ctx.fill();
    ctx.strokeStyle = rgba(ec, 0.6); ctx.lineWidth = 1;
    rrect(ctx, badgeX, 58, 58, 14, 3); ctx.stroke();
    ctx.fillStyle = ec;
    ctx.font = font(9);
    ctx.fillText("◈ FORGED", badgeX + 5, 69);
  }

  // Stars
  const starY = 86;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < input.rarity ? rc : rgba("#FFFFFF", 0.15);
    drawStar(ctx, SX + 8 + i * 20, starY, 7);
  }

  // Level pill
  const lvText = `LV ${input.level} / 90`;
  const lvW    = ctx.measureText(lvText).width + 20;
  ctx.fillStyle = rgba(ec, 0.15);
  rrect(ctx, SX + 108, starY - 8, lvW, 18, 4); ctx.fill();
  ctx.strokeStyle = rgba(ec, 0.4); ctx.lineWidth = 1;
  rrect(ctx, SX + 108, starY - 8, lvW, 18, 4); ctx.stroke();
  ctx.fillStyle = rgba("#FFFFFF", 0.7);
  ctx.font = font(10);
  ctx.fillText(lvText, SX + 118, starY + 4);

  // Separator
  ctx.strokeStyle = rgba(ec, 0.25); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(SX, 100); ctx.lineTo(W - 20, 100); ctx.stroke();

  // Stat rows
  const statRows: { label: string; value: string; highlight?: boolean }[] = [
    { label: "BASE ATK",  value: `${input.baseAtk}` },
    { label: "EFF. ATK",  value: `${input.effectiveAtk}`, highlight: true },
  ];
  if (input.subStatType && input.effectiveSub !== null) {
    statRows.push({
      label: input.subStatType.replace(/_/g, " "),
      value: `+${input.effectiveSub}%`,
      highlight: true,
    });
  }

  let sy = 122;
  for (const row of statRows) {
    ctx.fillStyle = rgba("#FFFFFF", 0.35);
    ctx.font = font(10);
    ctx.fillText(row.label, SX, sy);

    ctx.fillStyle = row.highlight ? ec : rgba("#FFFFFF", 0.85);
    ctx.font = font(16);
    ctx.fillText(row.value, SX, sy + 16);
    sy += 36;
  }

  // Separator
  ctx.strokeStyle = rgba(ec, 0.25); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(SX, sy + 2); ctx.lineTo(W - 20, sy + 2); ctx.stroke();
  sy += 14;

  // Passive block
  ctx.fillStyle = rgba(ec, 0.12);
  rrect(ctx, SX, sy, W - SX - 20, H - sy - 18, 6); ctx.fill();
  ctx.strokeStyle = rgba(ec, 0.3); ctx.lineWidth = 1;
  rrect(ctx, SX, sy, W - SX - 20, H - sy - 18, 6); ctx.stroke();

  ctx.fillStyle = rgba(ec, 0.9);
  ctx.font = font(9);
  ctx.fillText("PASSIVE", SX + 8, sy + 13);

  // Wrap passive text
  ctx.fillStyle = rgba("#FFFFFF", 0.75);
  ctx.font = font(11, "normal");
  const passiveWords = input.passive.split(" ");
  let line = "", px = SX + 8, py = sy + 27, lineH = 14, maxW = W - SX - 36;
  for (const word of passiveWords) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, px, py); py += lineH; line = word;
    } else { line = test; }
  }
  if (line) ctx.fillText(line, px, py);

  // ── Footer ──────────────────────────────────────────────────────────────────
  ctx.fillStyle = rgba("#FFFFFF", 0.15);
  ctx.font = font(9);
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA  ·  ARSENAL", W - 14, H - 8);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}
