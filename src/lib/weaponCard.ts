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
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function rrect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}
function drawStar(ctx: SKRSContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const o = (i*4*Math.PI)/5 - Math.PI/2, ii = o + (2*Math.PI)/5;
    ctx.lineTo(cx+Math.cos(o)*r, cy+Math.sin(o)*r);
    ctx.lineTo(cx+Math.cos(ii)*r*0.42, cy+Math.sin(ii)*r*0.42);
  }
  ctx.closePath(); ctx.fill();
}
function sep(ctx: SKRSContext2D, x: number, y: number, w: number, ec: string) {
  ctx.strokeStyle = rgba(ec, 0.25); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+w, y); ctx.stroke();
}

export interface WeaponCardInput {
  name:         string;
  weaponType:   string;
  rarity:       number;
  level:        number;
  baseAtk:      number;
  effectiveAtk: number;
  subStatType:  string | null;
  subStatVal:   number | null;
  effectiveSub: number | null;
  passive:      string;
  element:      string;
  ownerName:    string;
  ownerAvatar:  string;
  isUnique?:    boolean;
  userId?:      string;
  // Hidden substats (wish/4★/5★ weapons only)
  hiddenSub1Type?: string | null;   // null = no hidden sub (forged)
  hiddenSub1Val?:  number | null;   // null = locked (below Lv20)
  hiddenSub2Type?: string | null;
  hiddenSub2Val?:  number | null;   // null = locked (below Lv50)
}

export async function generateWeaponCard(input: WeaponCardInput): Promise<Buffer> {
  const W = 700;
  // Dynamic height: base 310 + 28px per hidden sub row that exists
  const hiddenRows = (input.hiddenSub1Type ? 1 : 0) + (input.hiddenSub2Type ? 1 : 0);
  const H = 310 + hiddenRows * 28;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const ec = ELEMENT_HEX[input.element.toUpperCase()] ?? ELEMENT_HEX.NONE;
  const rc = RARITY_COLOR[input.rarity] ?? RARITY_COLOR[3];
  const font = (sz: number, w = "bold") => `${w} ${sz}px Rajdhani, 'Noto Sans', Arial, sans-serif`;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = "#080B12"; ctx.fillRect(0,0,W,H);

  // Element bloom from art side
  const bloom = ctx.createRadialGradient(210,H/2,0,210,H/2,340);
  bloom.addColorStop(0, rgba(ec,0.30)); bloom.addColorStop(0.6,rgba(ec,0.08)); bloom.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle = bloom; ctx.fillRect(0,0,W,H);

  // Rarity bloom behind art
  const rb = ctx.createRadialGradient(210,H/2,0,210,H/2,190);
  rb.addColorStop(0,rgba(rc,0.20)); rb.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle = rb; ctx.fillRect(0,0,W,H);

  // ── Art panel ───────────────────────────────────────────────────────────────
  const AX=16, AY=16, AW=262, AH=H-32;
  ctx.save();
  rrect(ctx,AX,AY,AW,AH,14); ctx.clip();

  ctx.fillStyle = rgba(ec,0.07); ctx.fillRect(AX,AY,AW,AH);

  const imgPath = getWeaponImagePath(input.weaponType, input.name, {
    isUnique: input.isUnique, userId: input.userId,
  });
  if (imgPath) {
    try {
      const img  = await loadImage(imgPath);
      const pad  = 12;
      const scale = Math.min((AW - pad*2) / img.width, (AH - pad*2) / img.height);
      const sw = img.width * scale, sh = img.height * scale;
      ctx.drawImage(img, AX + (AW-sw)/2, AY + (AH-sh)/2, sw, sh);
    } catch { /* fallback */ }
  }

  ctx.restore();

  // Rarity border glow
  ctx.save();
  ctx.shadowColor = rc; ctx.shadowBlur = 16;
  ctx.strokeStyle = rgba(rc,0.85); ctx.lineWidth = 1.5;
  rrect(ctx,AX,AY,AW,AH,14); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // ── Divider ─────────────────────────────────────────────────────────────────
  const DX = AX+AW+14;
  const dvGrad = ctx.createLinearGradient(DX,0,DX,H);
  dvGrad.addColorStop(0,"rgba(0,0,0,0)"); dvGrad.addColorStop(0.25,rgba(ec,0.45));
  dvGrad.addColorStop(0.75,rgba(ec,0.45)); dvGrad.addColorStop(1,"rgba(0,0,0,0)");
  ctx.strokeStyle = dvGrad; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(DX,18); ctx.lineTo(DX,H-18); ctx.stroke();

  // ── Stats panel ─────────────────────────────────────────────────────────────
  const SX = DX + 14;   // left edge of text
  const RX = W - 18;    // right edge for right-aligned values
  let cy = 0;           // current y cursor

  // ── Weapon name ─────────────────────────────────────────────────────────────
  cy = 46;
  ctx.fillStyle = input.isUnique ? ec : "#FFFFFF";
  ctx.font = font(24);
  // truncate if too long
  let nameText = input.name;
  while (ctx.measureText(nameText).width > RX - SX - 4 && nameText.length > 1)
    nameText = nameText.slice(0, -1);
  if (nameText !== input.name) nameText += "…";
  ctx.fillText(nameText, SX, cy);

  // ── Type + unique badge ──────────────────────────────────────────────────────
  cy = 64;
  const typeFull = input.weaponType.charAt(0).toUpperCase() + input.weaponType.slice(1).toLowerCase();
  ctx.fillStyle = rgba("#FFFFFF", 0.4);
  ctx.font = font(11);
  ctx.fillText(typeFull.toUpperCase(), SX, cy);

  if (input.isUnique) {
    const tw = ctx.measureText(typeFull.toUpperCase()).width;
    const bx = SX + tw + 8, bw = 62, bh = 14;
    ctx.fillStyle = rgba(ec,0.2); rrect(ctx,bx,cy-11,bw,bh,3); ctx.fill();
    ctx.strokeStyle = rgba(ec,0.5); ctx.lineWidth=1; rrect(ctx,bx,cy-11,bw,bh,3); ctx.stroke();
    ctx.fillStyle = ec; ctx.font = font(8);
    ctx.fillText("◈ FORGED", bx+6, cy-1);
  }

  // ── Stars + level pill ───────────────────────────────────────────────────────
  cy = 82;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < input.rarity ? rc : rgba("#FFFFFF",0.12);
    drawStar(ctx, SX + 8 + i*18, cy, 6);
  }

  // Level pill — right-aligned
  const lvTxt = `LV ${input.level} / 90`;
  ctx.font = font(10);
  const lvW = ctx.measureText(lvTxt).width + 16;
  const lvX = RX - lvW;
  ctx.fillStyle = rgba(ec,0.15); rrect(ctx,lvX,cy-9,lvW,18,4); ctx.fill();
  ctx.strokeStyle = rgba(ec,0.35); ctx.lineWidth=1; rrect(ctx,lvX,cy-9,lvW,18,4); ctx.stroke();
  ctx.fillStyle = rgba("#FFFFFF",0.7); ctx.font = font(10);
  ctx.fillText(lvTxt, lvX+8, cy+3);

  // ── Separator ────────────────────────────────────────────────────────────────
  cy = 96;
  sep(ctx, SX, cy, RX-SX, ec);

  // ── Stat rows (label left, value right — single line each) ──────────────────
  cy = 96;
  interface StatRow { label: string; value: string; hi?: boolean; locked?: boolean }
  const stats: StatRow[] = [
    { label: "BASE ATK",  value: `${input.baseAtk}` },
    { label: "ATK @ LV "+input.level, value: `${input.effectiveAtk}`, hi: true },
  ];
  if (input.subStatType && input.effectiveSub !== null) {
    stats.push({ label: input.subStatType.replace(/_/g," "), value: `+${input.effectiveSub}%`, hi: true });
  }
  // Hidden substats
  if (input.hiddenSub1Type) {
    if (input.hiddenSub1Val != null)
      stats.push({ label: input.hiddenSub1Type.replace(/_/g," ") + "  ✦", value: `+${input.hiddenSub1Val}%`, hi: true });
    else
      stats.push({ label: "HIDDEN  ·  unlocks Lv 20", value: "? ? ?", locked: true });
  }
  if (input.hiddenSub2Type) {
    if (input.hiddenSub2Val != null)
      stats.push({ label: input.hiddenSub2Type.replace(/_/g," ") + "  ✦✦", value: `+${input.hiddenSub2Val}%`, hi: true });
    else
      stats.push({ label: "HIDDEN  ·  unlocks Lv 50", value: "? ? ?", locked: true });
  }

  const ROW_H = 28;
  for (const row of stats) {
    cy += ROW_H;
    // label
    ctx.fillStyle = row.locked ? rgba("#FFFFFF",0.20) : rgba("#FFFFFF",0.38); ctx.font = font(10);
    ctx.fillText(row.label.toUpperCase(), SX, cy);
    // value — right-aligned
    ctx.fillStyle = row.locked ? rgba("#FFFFFF",0.22) : row.hi ? ec : rgba("#FFFFFF",0.85);
    ctx.font = row.locked ? font(13) : font(17);
    const vw = ctx.measureText(row.value).width;
    ctx.fillText(row.value, RX - vw, cy);
    // thin rule under each row
    ctx.strokeStyle = rgba("#FFFFFF",0.06); ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(SX,cy+6); ctx.lineTo(RX,cy+6); ctx.stroke();
  }

  cy += 10;
  sep(ctx, SX, cy, RX-SX, ec);

  // ── Passive block ────────────────────────────────────────────────────────────
  cy += 10;
  const passMaxY = H - 12;
  if (passMaxY - cy > 16) {
    // Thin top rule
    ctx.strokeStyle = rgba(ec, 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(SX, cy); ctx.lineTo(RX, cy); ctx.stroke();
    cy += 12;

    // "PASSIVE" chip inline on same line as first text line
    const chipW = 52, chipH = 14;
    ctx.fillStyle = rgba(ec,0.18); rrect(ctx, SX, cy-11, chipW, chipH, 3); ctx.fill();
    ctx.fillStyle = rgba(ec,0.9); ctx.font = font(9);
    ctx.fillText("PASSIVE", SX+6, cy-1);

    // Passive text starting after the chip on the same baseline
    ctx.fillStyle = rgba("#FFFFFF",0.70); ctx.font = font(11,"normal");
    const words = input.passive.split(" ");
    let line="", lx=SX+chipW+8, ly=cy, lh=16, mw=RX-SX-chipW-12;
    // First line has reduced width (starts after chip)
    let firstLine = true;
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      const curMw = firstLine ? mw : RX - SX;
      if (ctx.measureText(t).width > curMw && line) {
        ctx.fillText(line, lx, ly);
        ly += lh; line = w;
        if (ly > passMaxY) { break; }
        if (firstLine) { lx = SX; firstLine = false; }
      } else { line = t; }
    }
    if (line && ly <= passMaxY) ctx.fillText(line, lx, ly);
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  ctx.fillStyle = rgba("#FFFFFF",0.12); ctx.font = font(9);
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA  ·  ARSENAL", W-12, H-6);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}
