import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#4FC3F7", ELECTRO: "#B39DDB",
  AERO: "#80CBC4", HAVOC: "#C355E0", SPECTRO: "#FFD54F", NONE: "#8B7FF5",
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

// word-wrap helper
function wrap(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const words = text.split(" "); const lines: string[] = []; let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface AbilityCardData {
  displayName: string;
  avatarUrl:   string | null;
  element:     string;
  abilityName: string;
  effects:     string[];   // formatted primitive lines (e.g. "Reaper's Mark: Vs enemies below 30% HP: +45% DMG")
  lore:        string;
  evolved?:    boolean;    // awakened form — gold accents, 4 effect slots
}

export async function generateAbilityCard(d: AbilityCardData): Promise<Buffer> {
  const effectCount = Math.min(d.effects.length, d.evolved ? 7 : 3);
  const extraH = d.evolved && effectCount > 4 ? (effectCount - 4) * 68 : 0;
  const W = 860, H = (d.evolved ? 540 : 480) + extraH;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const ec = d.evolved ? "#FCD34D" : (ELEMENT_HEX[d.element] ?? ELEMENT_HEX.NONE);

  // ── Cosmic base ───────────────────────────────────────────────────────────
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#08070E"); g.addColorStop(0.5, "#100A1C"); g.addColorStop(1, "#08070E");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // dual blooms
  const b1 = ctx.createRadialGradient(W * 0.5, 150, 0, W * 0.5, 150, 480);
  b1.addColorStop(0, rgba(ec, 0.26)); b1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = b1; ctx.fillRect(0, 0, W, H);

  // rays from top center
  ctx.save();
  ctx.translate(W / 2, 80); ctx.globalAlpha = 0.06;
  for (let a = 0; a < 360; a += 18) {
    ctx.rotate(18 * Math.PI / 180);
    ctx.fillStyle = ec; ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-14, 700); ctx.lineTo(14, 700); ctx.closePath(); ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha = 1;

  // starfield
  ctx.fillStyle = "#FFFFFF";
  for (let i = 0; i < 70; i++) {
    const x = (i * 151.3) % W, y = (i * 97.7) % H, r = (i % 3) * 0.4 + 0.3;
    ctx.globalAlpha = 0.04 + (i % 4) * 0.03;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Eyebrow ───────────────────────────────────────────────────────────────
  ctx.textAlign = "center";
  ctx.fillStyle = rgba(ec, 0.95); ctx.font = `bold 14px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "6px";
  ctx.fillText(d.evolved ? "✦  EVOLVED  RESONANCE  ·  AWAKENED  FORM  ✦" : "UNIQUE  PASSIVE  ·  FORGED  AT  ASCENSION", W / 2, 56);
  ctx.letterSpacing = "0px";

  // ── Ability name (big, glowing) ───────────────────────────────────────────
  ctx.shadowColor = ec; ctx.shadowBlur = 26;
  const nameFont = d.abilityName.length > 26 ? 38 : 50;
  ctx.fillStyle = "#FFFFFF"; ctx.font = `bold ${nameFont}px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.fillText(d.abilityName.length > 38 ? d.abilityName.slice(0, 37) + "…" : d.abilityName, W / 2, 112);
  ctx.shadowBlur = 0;

  // divider with diamond
  const dy = 134;
  const grad = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
  grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(0.5, ec); grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = grad; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W * 0.22, dy); ctx.lineTo(W * 0.78, dy); ctx.stroke();
  ctx.fillStyle = ec; ctx.save(); ctx.translate(W / 2, dy); ctx.rotate(Math.PI / 4);
  ctx.fillRect(-4, -4, 8, 8); ctx.restore();
  ctx.textAlign = "left";

  // ── Effects panel ─────────────────────────────────────────────────────────
  const px = 60, pw = W - 120, py = 160, ph = (d.evolved ? 260 : 200) + extraH;
  ctx.fillStyle = "rgba(255,255,255,0.03)"; rrect(ctx, px, py, pw, ph, 12); ctx.fill();
  ctx.strokeStyle = rgba(ec, 0.4); ctx.lineWidth = 1; rrect(ctx, px, py, pw, ph, 12); ctx.stroke();

  ctx.fillStyle = rgba(ec, 0.9); ctx.font = `bold 12px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "3px"; ctx.fillText("RESONANT EFFECTS", px + 22, py + 30); ctx.letterSpacing = "0px";

  let ly = py + 60;
  for (const eff of d.effects.slice(0, effectCount)) {
    // split "Label: description" into name + desc
    const idx = eff.indexOf(":");
    const name = idx > 0 ? eff.slice(0, idx) : eff;
    const desc = idx > 0 ? eff.slice(idx + 1).trim() : "";
    // bullet
    ctx.fillStyle = ec; ctx.save(); ctx.translate(px + 26, ly - 4); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3, -3, 6, 6); ctx.restore();
    ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 17px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText(name, px + 42, ly);
    ctx.fillStyle = "rgba(255,255,255,0.62)"; ctx.font = `15px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    const dlines = wrap(ctx, desc, pw - 80);
    let dyl = ly + 22;
    for (const dl of dlines.slice(0, 2)) { ctx.fillText(dl, px + 42, dyl); dyl += 20; }
    ly = dyl + 12;
  }

  // ── Lore ──────────────────────────────────────────────────────────────────
  ctx.textAlign = "center";
  ctx.fillStyle = rgba(ec, 0.75); ctx.font = `italic 16px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  const loreLines = wrap(ctx, `“${d.lore}”`, W - 160);
  let lly = (d.evolved ? 448 : 378) + extraH;
  for (const l of loreLines.slice(0, 3)) { ctx.fillText(l, W / 2, lly); lly += 22; }
  ctx.textAlign = "left";

  // ── Owner footer (avatar + name) ──────────────────────────────────────────
  const avR = 16, avX = 60, avY = H - 34;
  if (d.avatarUrl) {
    try {
      ctx.save(); ctx.beginPath(); ctx.arc(avX + avR, avY, avR, 0, Math.PI * 2); ctx.clip();
      const img = await loadImage(d.avatarUrl + "?size=64");
      ctx.drawImage(img, avX, avY - avR, avR * 2, avR * 2); ctx.restore();
      ctx.strokeStyle = rgba(ec, 0.7); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(avX + avR, avY, avR, 0, Math.PI * 2); ctx.stroke();
    } catch { /* skip */ }
  }
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = `bold 14px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(`${d.displayName} · ${d.element}`, avX + avR * 2 + 12, avY + 5);

  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = `11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.textAlign = "right"; ctx.fillText("No other Drifter shares this ability.", W - 60, avY + 5); ctx.textAlign = "left";

  // ── Corner ticks + frame ──────────────────────────────────────────────────
  ctx.strokeStyle = ec; ctx.lineWidth = 2; const T = 18;
  [[12,12,1,1],[W-12,12,-1,1],[12,H-12,1,-1],[W-12,H-12,-1,-1]].forEach(([x,y,dx,dy]) => {
    ctx.beginPath(); ctx.moveTo(x, y + dy*T); ctx.lineTo(x, y); ctx.lineTo(x + dx*T, y); ctx.stroke();
  });
  ctx.shadowColor = ec; ctx.shadowBlur = 18;
  ctx.strokeStyle = rgba(ec, 0.45); ctx.lineWidth = 1.5; rrect(ctx, 3, 3, W - 6, H - 6, 0); ctx.stroke();
  ctx.shadowBlur = 0;

  return canvas.toBuffer("image/png");
}
