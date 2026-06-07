import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";

try { try { (GlobalFonts as any).loadSystemFonts(); } catch {}
GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani"); } catch { /* fallback */ }

const ELEMENT_COLORS: Record<string, { primary: string; secondary: string }> = {
  FUSION:   { primary: "#FF6B35", secondary: "#FFB38A" },
  GLACIO:   { primary: "#38BDF8", secondary: "#BAE6FD" },
  ELECTRO:  { primary: "#A855F7", secondary: "#D8B4FE" },
  AERO:     { primary: "#10B981", secondary: "#6EE7B7" },
  HAVOC:    { primary: "#EC4899", secondary: "#F9A8D4" },
  SPECTRO:  { primary: "#EAB308", secondary: "#FDE68A" },
  NONE:     { primary: "#6366F1", secondary: "#A5B4FC" },
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

// Deterministic sparkle positions so they look natural
function drawSparkles(ctx: SKRSContext2D, W: number, H: number, color: string, seed: number) {
  const positions = [
    [0.15, 0.2], [0.25, 0.75], [0.38, 0.15], [0.42, 0.88],
    [0.72, 0.12], [0.78, 0.82], [0.85, 0.35], [0.92, 0.65],
    [0.55, 0.08], [0.60, 0.92], [0.10, 0.55], [0.96, 0.48],
  ];

  positions.forEach(([rx, ry], i) => {
    const x    = rx * W;
    const y    = ry * H;
    const size = [4, 6, 3, 7, 4, 5, 3, 6, 4, 5, 3, 6][i % 12];
    const alpha = [0.9, 0.6, 0.8, 0.5, 0.7, 0.9, 0.6, 0.8, 0.5, 0.7, 0.9, 0.6][i % 12];

    // 4-point star
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4 * (i % 2));
    ctx.fillStyle = rgba(color, alpha);
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let p = 0; p < 4; p++) {
      const angle = (p / 4) * Math.PI * 2;
      const inner = size * 0.25;
      const outer = size;
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.lineTo(Math.cos(angle + Math.PI / 4) * inner, Math.sin(angle + Math.PI / 4) * inner);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  });
}

export interface LevelUpCardOptions {
  displayName: string;
  avatarUrl:   string | null;
  oldLevel:    number;
  newLevel:    number;
  element:     string;
  isCapped:    boolean;
}

export async function generateLevelUpCard(opts: LevelUpCardOptions): Promise<Buffer> {
  const W = 620, H = 200;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const theme = ELEMENT_COLORS[opts.element] ?? ELEMENT_COLORS.NONE;
  const P     = theme.primary;
  const S     = theme.secondary;

  // ── Background ──────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#07091280");
  bg.addColorStop(1, "#0A0D18");
  ctx.fillStyle = "#08091280";
  ctx.fillRect(0, 0, W, H);

  // Full dark base
  ctx.fillStyle = "#0A0D18";
  rrect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // Element radial bloom from center-right
  const bloom = ctx.createRadialGradient(W * 0.62, H / 2, 0, W * 0.62, H / 2, 260);
  bloom.addColorStop(0, rgba(P, 0.28));
  bloom.addColorStop(0.5, rgba(P, 0.08));
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  // Subtle left bloom behind avatar
  const bloom2 = ctx.createRadialGradient(100, H / 2, 0, 100, H / 2, 130);
  bloom2.addColorStop(0, rgba(P, 0.18));
  bloom2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom2;
  ctx.fillRect(0, 0, W, H);

  // Sparkles
  drawSparkles(ctx, W, H, P, opts.newLevel);

  // ── Border ───────────────────────────────────────────────────────────────────
  ctx.shadowColor = P;
  ctx.shadowBlur  = 20;
  ctx.strokeStyle = rgba(P, 0.55);
  ctx.lineWidth   = 1.5;
  rrect(ctx, 1, 1, W - 2, H - 2, 16);
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Top accent bar
  const topBar = ctx.createLinearGradient(0, 0, W, 0);
  topBar.addColorStop(0, P);
  topBar.addColorStop(0.5, S);
  topBar.addColorStop(1, rgba(P, 0.1));
  ctx.fillStyle = topBar;
  rrect(ctx, 1, 1, W - 2, 3, 2);
  ctx.fill();

  // ── Avatar ───────────────────────────────────────────────────────────────────
  const avCX = 100, avCY = H / 2, avR = 68;

  // Glow ring
  ctx.shadowColor = P;
  ctx.shadowBlur  = 22;
  ctx.strokeStyle = P;
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.arc(avCX, avCY, avR + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Outer decorative ring
  ctx.strokeStyle = rgba(S, 0.3);
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.arc(avCX, avCY, avR + 10, 0, Math.PI * 2);
  ctx.stroke();

  // Avatar clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(avCX, avCY, avR, 0, Math.PI * 2);
  ctx.clip();
  if (opts.avatarUrl) {
    try {
      const img = await loadImage(opts.avatarUrl + "?size=256");
      ctx.drawImage(img, avCX - avR, avCY - avR, avR * 2, avR * 2);
    } catch {
      ctx.fillStyle = rgba(P, 0.3);
      ctx.fillRect(avCX - avR, avCY - avR, avR * 2, avR * 2);
    }
  } else {
    ctx.fillStyle = rgba(P, 0.3);
    ctx.fillRect(avCX - avR, avCY - avR, avR * 2, avR * 2);
  }
  ctx.restore();

  // ── Content: right of avatar ──────────────────────────────────────────────
  const TX = 196;

  // Header label
  ctx.fillStyle = rgba(P, 0.75);
  ctx.font      = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "3px";
  ctx.fillText(opts.isCapped ? "LEVEL CAP REACHED" : "RESONANCE AMPLIFIED", TX, 44);
  ctx.letterSpacing = "0px";

  // Display name
  ctx.fillStyle = "#FFFFFF";
  ctx.font      = `bold 18px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.fillText(opts.displayName, TX, 68);

  // ── Level transition: OLD → NEW ───────────────────────────────────────────
  const centerY = 120;

  if (opts.isCapped) {
    // Capped — single large level number
    ctx.fillStyle = S;
    ctx.font      = `bold 52px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
    ctx.fillText(`${opts.newLevel}`, TX, centerY + 18);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font      = `bold 13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("WORLD LEVEL CAP", TX, centerY + 40);
  } else {
    // Old level (dimmed)
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font      = `bold 48px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
    ctx.fillText(`${opts.oldLevel}`, TX, centerY + 16);

    // Measure old level width for arrow placement
    const oldW = ctx.measureText(`${opts.oldLevel}`).width;

    // Arrow
    const arrowX = TX + oldW + 14;
    ctx.fillStyle = rgba(P, 0.9);
    ctx.font      = `bold 28px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("→", arrowX, centerY + 8);
    const arrowW = ctx.measureText("→").width;

    // New level (bright, glowing)
    const newX = arrowX + arrowW + 14;
    ctx.shadowColor = P;
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = S;
    ctx.font        = `bold 64px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
    ctx.fillText(`${opts.newLevel}`, newX, centerY + 22);
    ctx.shadowBlur  = 0;
  }

  // ── Thin separator + footer ────────────────────────────────────────────────
  const sepY = H - 32;
  const sepGrad = ctx.createLinearGradient(TX, 0, TX + 340, 0);
  sepGrad.addColorStop(0, rgba(P, 0.5));
  sepGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = sepGrad;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(TX, sepY); ctx.lineTo(TX + 340, sepY);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.font      = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText("Chat to earn Resonance EXP  ·  Ascension breaks the cap", TX, sepY + 16);

  // Watermark
  ctx.fillStyle     = "rgba(255,255,255,0.07)";
  ctx.font          = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "3px";
  ctx.textAlign     = "right";
  ctx.fillText("CARTETHYIA", W - 14, H - 10);
  ctx.textAlign     = "left";
  ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}
