import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";

try { (GlobalFonts as any).loadSystemFonts(); } catch { /* not critical */ }
try {
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"),    "Rajdhani");
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-SemiBold.ttf"),"RajdhaniSemi");
} catch { /* fallback */ }

const FONT_STACK = `Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
const FONT_STACK_SEMI = `RajdhaniSemi, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;

const THEME: Record<string, { primary: string; glow: string; label: string }> = {
  FUSION:  { primary: "#FF6B35", glow: "#FF6B3555", label: "FUSION"   },
  GLACIO:  { primary: "#38BDF8", glow: "#38BDF855", label: "GLACIO"   },
  ELECTRO: { primary: "#A855F7", glow: "#A855F755", label: "ELECTRO"  },
  AERO:    { primary: "#10B981", glow: "#10B98155", label: "AERO"     },
  HAVOC:   { primary: "#EC4899", glow: "#EC489955", label: "HAVOC"    },
  SPECTRO: { primary: "#EAB308", glow: "#EAB30855", label: "SPECTRO"  },
  NONE:    { primary: "#6366F1", glow: "#6366F155", label: "DRIFTER"  },
};

const ELEMENT_EMOJI: Record<string, string> = {
  FUSION:"🔥", GLACIO:"❄️", ELECTRO:"⚡", AERO:"🌪️", HAVOC:"🌑", SPECTRO:"✨", NONE:"◇",
};

const RESONANCE_TITLE: (level: number) => string = (l) => {
  if (l >= 90) return "APEX RESONATOR";
  if (l >= 80) return "GRAND RESONATOR";
  if (l >= 70) return "SENIOR RESONATOR";
  if (l >= 60) return "ADEPT RESONATOR";
  if (l >= 50) return "SKILLED RESONATOR";
  if (l >= 40) return "RISING RESONATOR";
  if (l >= 30) return "FLEDGLING RESONATOR";
  if (l >= 20) return "AWAKENED RESONATOR";
  if (l >= 10) return "RESONATOR";
  return "INITIATE";
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

function cornerTick(ctx: SKRSContext2D, x: number, y: number, size: number, color: string, dir: [number, number]) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + dir[0] * size, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + dir[1] * size);
  ctx.stroke();
}

export interface LevelCardInput {
  displayName:  string;
  avatarUrl:    string | null;
  level:        number;
  worldLevel:   number;
  element:      string;
  resonanceExp: number;
  expNeeded:    number;
  expPercent:   number;
  isCapped:     boolean;
  hp:           number;
  atk:          number;
  def:          number;
  critRate:     number;  // 0–1
  critDmg:      number;  // multiplier, e.g. 1.5
}

export async function generateLevelCard(input: LevelCardInput): Promise<Buffer> {
  const W = 920, H = 280;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const theme = THEME[input.element] ?? THEME.NONE;
  const col   = theme.primary;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = "#0B0F1A";
  ctx.fillRect(0, 0, W, H);

  // Left ambient glow
  const leftGlow = ctx.createRadialGradient(0, H / 2, 0, 0, H / 2, 340);
  leftGlow.addColorStop(0, rgba(col, 0.20));
  leftGlow.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = leftGlow;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid lines
  ctx.strokeStyle = rgba(col, 0.05);
  ctx.lineWidth   = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Thin outer border
  ctx.strokeStyle = rgba(col, 0.25);
  ctx.lineWidth   = 1;
  rrect(ctx, 1, 1, W - 2, H - 2, 8);
  ctx.stroke();

  // Corner ticks
  const tickSize = 14, tickCol = rgba(col, 0.7);
  cornerTick(ctx,       6,       6, tickSize, tickCol, [1,  1]);
  cornerTick(ctx, W -  6,       6, tickSize, tickCol, [-1, 1]);
  cornerTick(ctx,       6, H -  6, tickSize, tickCol, [1, -1]);
  cornerTick(ctx, W -  6, H -  6, tickSize, tickCol, [-1,-1]);

  // ── Avatar ──────────────────────────────────────────────────────────────────
  const avX = 44, avY = H / 2, avR = 56;

  // Element ring glow
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur  = 20;
  ctx.strokeStyle = col;
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.arc(avX, avY, avR + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Avatar clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(avX, avY, avR, 0, Math.PI * 2);
  ctx.clip();
  if (input.avatarUrl) {
    try {
      const img = await loadImage(input.avatarUrl);
      ctx.drawImage(img, avX - avR, avY - avR, avR * 2, avR * 2);
    } catch {
      ctx.fillStyle = "#1E2535";
      ctx.fill();
    }
  } else {
    ctx.fillStyle = "#1E2535";
    ctx.fill();
  }
  ctx.restore();

  // ── Name + title ────────────────────────────────────────────────────────────
  const textX = avX + avR + 24;

  ctx.font      = `12px ${FONT_STACK_SEMI}`;
  ctx.fillStyle = rgba(col, 0.8);
  ctx.fillText(RESONANCE_TITLE(input.level), textX, 48);

  // Auto-shrink name to fit within available width (stops before the separator at ~460px)
  let namePx = 26;
  ctx.font = `${namePx}px ${FONT_STACK}`;
  while (namePx > 10 && ctx.measureText(input.displayName).width > 300) {
    namePx--;
    ctx.font = `${namePx}px ${FONT_STACK}`;
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(input.displayName, textX, 78);

  // Element badge
  const emojiLabel = `${ELEMENT_EMOJI[input.element] ?? "◇"}  ${theme.label}`;
  const badgeW = 110, badgeH = 22;
  rrect(ctx, textX, 86, badgeW, badgeH, 4);
  ctx.fillStyle = rgba(col, 0.18);
  ctx.fill();
  ctx.strokeStyle = rgba(col, 0.45);
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.font      = `12px ${FONT_STACK_SEMI}`;
  ctx.fillStyle = col;
  ctx.fillText(emojiLabel, textX + 8, 101);

  // WL badge
  const wlText = `WL ${input.worldLevel}`;
  rrect(ctx, textX + badgeW + 8, 86, 55, badgeH, 4);
  ctx.fillStyle = rgba("#FFFFFF", 0.06);
  ctx.fill();
  ctx.strokeStyle = rgba("#FFFFFF", 0.12);
  ctx.stroke();
  ctx.font      = `12px ${FONT_STACK_SEMI}`;
  ctx.fillStyle = rgba("#FFFFFF", 0.55);
  ctx.fillText(wlText, textX + badgeW + 18, 101);

  // ── Level number (center-right) ──────────────────────────────────────────────
  const lvlX = 480;

  ctx.font      = `11px ${FONT_STACK_SEMI}`;
  ctx.fillStyle = rgba(col, 0.6);
  ctx.fillText("RESONANCE LEVEL", lvlX, 52);

  ctx.save();
  ctx.font      = `96px ${FONT_STACK}`;
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillText(`${input.level}`, lvlX - 2, 158);
  ctx.restore();

  ctx.font      = `88px ${FONT_STACK}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = col;
  ctx.shadowBlur  = 28;
  ctx.fillText(`${input.level}`, lvlX, 156);
  ctx.shadowBlur = 0;

  // ── EXP bar ─────────────────────────────────────────────────────────────────
  const barX = textX, barY = 128, barW = 310, barH = 14;

  ctx.font      = `11px ${FONT_STACK_SEMI}`;
  ctx.fillStyle = rgba("#FFFFFF", 0.4);
  ctx.fillText(input.isCapped ? "LEVEL CAP REACHED — ASCEND TO CONTINUE" : "RESONANCE EXP", barX, barY - 5);

  // EXP count right-aligned to the bar end (stays left of the separator so it never overlaps the level number)
  if (!input.isCapped) {
    const expStr = `${input.resonanceExp.toLocaleString()} / ${input.expNeeded.toLocaleString()}`;
    ctx.font      = `11px ${FONT_STACK_SEMI}`;
    ctx.fillStyle = rgba("#FFFFFF", 0.35);
    const expW = ctx.measureText(expStr).width;
    ctx.fillText(expStr, barX + barW - expW, barY - 5);
  }

  // Track
  rrect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = rgba("#FFFFFF", 0.07);
  ctx.fill();

  // Fill
  if (!input.isCapped) {
    const fillW = Math.max(4, Math.floor(barW * (input.expPercent / 100)));
    const fillGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
    fillGrad.addColorStop(0, rgba(col, 0.6));
    fillGrad.addColorStop(1, col);
    rrect(ctx, barX, barY, fillW, barH, 4);
    ctx.fillStyle = fillGrad;
    ctx.fill();
    // Glow tip
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur  = 10;
    rrect(ctx, barX + fillW - 6, barY, 6, barH, 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.restore();
  } else {
    const fullGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    fullGrad.addColorStop(0, rgba(col, 0.6));
    fullGrad.addColorStop(1, col);
    rrect(ctx, barX, barY, barW, barH, 4);
    ctx.fillStyle = fullGrad;
    ctx.fill();
  }

  // EXP capped label (only needed when capped — non-capped count is in the label row above)
  if (input.isCapped) {
    ctx.font      = `11px ${FONT_STACK_SEMI}`;
    ctx.fillStyle = rgba("#FFFFFF", 0.45);
    ctx.fillText("MAX", barX + barW - 28, barY + 11);
  }

  // ── Stats row ────────────────────────────────────────────────────────────────
  const stats = [
    { label: "HP",        value: input.hp.toLocaleString()              },
    { label: "ATK",       value: input.atk.toLocaleString()             },
    { label: "DEF",       value: input.def.toLocaleString()             },
    { label: "CRIT RATE", value: `${(input.critRate * 100).toFixed(1)}%`},
    { label: "CRIT DMG",  value: `${Math.round(input.critDmg * 100)}%` },
  ];

  const statStartX = textX;
  const statY      = 188;
  const statGap    = 61;

  stats.forEach((s, i) => {
    const sx = statStartX + i * statGap;
    // Panel
    rrect(ctx, sx, statY, 54, 46, 4);
    ctx.fillStyle = rgba("#FFFFFF", 0.05);
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.20);
    ctx.lineWidth   = 1;
    ctx.stroke();

    ctx.font      = `10px ${FONT_STACK_SEMI}`;
    ctx.fillStyle = rgba(col, 0.7);
    ctx.fillText(s.label, sx + 4, statY + 14);

    ctx.font      = `15px ${FONT_STACK}`;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(s.value, sx + 4, statY + 34);
  });

  // ── Decorative vertical separator ────────────────────────────────────────────
  ctx.strokeStyle = rgba(col, 0.15);
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(lvlX - 20, 32);
  ctx.lineTo(lvlX - 20, H - 32);
  ctx.stroke();

  // ── Watermark ────────────────────────────────────────────────────────────────
  ctx.font      = `11px ${FONT_STACK_SEMI}`;
  ctx.fillStyle = rgba("#FFFFFF", 0.12);
  ctx.fillText("CARTETHYIA  ◇  RESONANCE SYSTEM", W - 260, H - 14);

  return canvas.toBuffer("image/png");
}
