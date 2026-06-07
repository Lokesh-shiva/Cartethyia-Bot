import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import { Boss } from "./bosses";

try { try { (GlobalFonts as any).loadSystemFonts(); } catch {}
GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani"); } catch { /* fallback */ }

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

function drawBar(
  ctx: SKRSContext2D,
  label: string, current: number, max: number,
  x: number, y: number, w: number,
  color: string, thin = false
) {
  const fill  = Math.max(0, Math.min(1, current / max));
  const barH  = thin ? 8 : 14;
  const lowHp = fill < 0.3 && !thin;

  ctx.fillStyle = thin ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.7)";
  ctx.font      = `bold ${thin ? 9 : 11}px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(label, x, y + barH - 2);

  const bx = x + (thin ? 72 : 58);
  const bw = w - (thin ? 72 : 58) - 58;

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  rrect(ctx, bx, y, bw, barH, barH / 2); ctx.fill();

  if (fill > 0) {
    const c    = lowHp ? "#EF4444" : color;
    const grad = ctx.createLinearGradient(bx, 0, bx + bw * fill, 0);
    grad.addColorStop(0, rgba(c, 0.55)); grad.addColorStop(1, c);
    ctx.fillStyle = grad;
    rrect(ctx, bx, y, bw * fill, barH, barH / 2); ctx.fill();

    if (fill > 0.02) {
      ctx.shadowColor = c; ctx.shadowBlur = 8;
      ctx.fillStyle   = "#FFFFFF";
      rrect(ctx, bx + bw * fill - 2, y + 2, 2, barH - 4, 1); ctx.fill();
      ctx.shadowBlur  = 0;
    }
  }

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font      = `bold ${thin ? 9 : 11}px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(
    thin ? `${Math.round(fill * 100)}%` : `${current.toLocaleString()} / ${max.toLocaleString()}`,
    bx + bw + 54, y + barH - 2
  );
  ctx.textAlign = "left";
}

export interface BattleCardState {
  boss:          Boss;
  bossHpNow:     number;
  bossHpMax:     number;
  bossVibNow:    number;
  playerHp:      number;
  playerHpMax:   number;
  playerEnergy:  number;
  playerName:    string;
  playerElement: string;
  turn:          number;
  lastMove:      string | null;
  isShattered:   boolean;
  skillCooldown: number;
}

export async function generateBattleCard(state: BattleCardState): Promise<Buffer> {
  const W        = 700;
  const ART_H    = 300;   // boss art section height
  const PANEL_H  = 200;   // UI panel height
  const H        = ART_H + PANEL_H;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const bossColor   = ELEMENT_COLORS[state.boss.element]   ?? "#6366F1";
  const playerColor = ELEMENT_COLORS[state.playerElement]  ?? "#6366F1";

  // ══════════════════════════════════════════════════════════
  // TOP SECTION — Boss artwork, clean, no overlays
  // ══════════════════════════════════════════════════════════
  ctx.fillStyle = "#080C14";
  ctx.fillRect(0, 0, W, ART_H);

  const bossArtPath = path.isAbsolute(state.boss.artFile)
    ? state.boss.artFile
    : path.join(process.cwd(), "Bosses", state.boss.artFile);
  try {
    const art = await loadImage(bossArtPath);
    const isPortrait = art.height > art.width;

    if (isPortrait) {
      // Fit to height, centre horizontally
      const scale = ART_H / art.height;
      const sw    = art.width * scale;
      ctx.drawImage(art, (W - sw) / 2, 0, sw, ART_H);
    } else {
      const scale = Math.max(W / art.width, ART_H / art.height);
      const sw    = art.width * scale, sh = art.height * scale;
      ctx.drawImage(art, (W - sw) / 2, (ART_H - sh) / 2, sw, sh);
    }
  } catch {
    // Gradient fallback
    const grad = ctx.createLinearGradient(0, 0, W, ART_H);
    grad.addColorStop(0, "#080C14");
    grad.addColorStop(1, rgba(bossColor, 0.3));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, ART_H);
  }

  // Soft fade at the bottom of art into panel
  const artFade = ctx.createLinearGradient(0, ART_H - 60, 0, ART_H);
  artFade.addColorStop(0, "rgba(0,0,0,0)");
  artFade.addColorStop(1, "#0A0D18");
  ctx.fillStyle = artFade; ctx.fillRect(0, 0, W, ART_H);

  // Shattered flash over art
  if (state.isShattered) {
    ctx.fillStyle = "rgba(251,191,36,0.07)";
    ctx.fillRect(0, 0, W, ART_H);
  }

  // ══════════════════════════════════════════════════════════
  // BOTTOM SECTION — UI panel
  // ══════════════════════════════════════════════════════════
  const PY = ART_H; // panel starts here

  ctx.fillStyle = "#0A0D18";
  ctx.fillRect(0, PY, W, PANEL_H);

  // Element bloom behind panel
  const bloom = ctx.createRadialGradient(W / 2, PY + PANEL_H / 2, 0, W / 2, PY + PANEL_H / 2, W * 0.6);
  bloom.addColorStop(0, rgba(bossColor, 0.08));
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom; ctx.fillRect(0, PY, W, PANEL_H);

  // Top rule of panel
  const ruleGrad = ctx.createLinearGradient(0, 0, W, 0);
  ruleGrad.addColorStop(0, bossColor);
  ruleGrad.addColorStop(0.5, rgba(bossColor, 0.4));
  ruleGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ruleGrad;
  ctx.fillRect(0, PY, W, 2);

  const PAD = 20;

  // ── Boss name + shatter status ────────────────────────────
  ctx.fillStyle = "#FFFFFF";
  ctx.font      = `bold 20px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.fillText(state.boss.name, PAD, PY + 24);

  ctx.fillStyle = rgba(bossColor, 0.75);
  ctx.font      = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px";
  ctx.fillText(state.boss.title.toUpperCase(), PAD, PY + 38);
  ctx.letterSpacing = "0px";

  if (state.isShattered) {
    ctx.fillStyle = "#FCD34D";
    ctx.font      = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("⚡ SHATTERED  ·  DEF: 0  ·  ALL HITS CRITICAL", W - PAD, PY + 24);
    ctx.textAlign = "left";
  }

  // ── Boss bars ─────────────────────────────────────────────
  drawBar(ctx, "BOSS HP",  state.bossHpNow, state.bossHpMax,  PAD, PY + 48, W - PAD * 2, bossColor);
  drawBar(ctx, "VIBRATION", state.bossVibNow, state.boss.vibBar, PAD, PY + 70, W - PAD * 2, "#F8FAFC", true);

  // ── Divider ───────────────────────────────────────────────
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, PY + 88); ctx.lineTo(W - PAD, PY + 88); ctx.stroke();

  // ── Player stats ──────────────────────────────────────────
  ctx.fillStyle = rgba(playerColor, 0.75);
  ctx.font      = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px";
  ctx.fillText("RESONATOR", PAD, PY + 104);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#FFFFFF";
  ctx.font      = `bold 13px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.fillText(state.playerName, PAD, PY + 119);

  drawBar(ctx, "HP", state.playerHp, state.playerHpMax, PAD, PY + 126, W - PAD * 2, playerColor);

  // Energy + skill cooldown
  const energyReady = state.playerEnergy >= 100;
  ctx.fillStyle = energyReady ? "#FCD34D" : "rgba(255,255,255,0.3)";
  ctx.font      = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(
    energyReady ? "⚡ ULTIMATE READY" : `ENERGY  ${state.playerEnergy} / 100`,
    PAD, PY + 156
  );

  if (state.skillCooldown > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.textAlign = "right";
    ctx.fillText(`Resonance Skill — cooldown ${state.skillCooldown}`, W - PAD, PY + 156);
    ctx.textAlign = "left";
  }

  // ── Last move log ─────────────────────────────────────────
  if (state.lastMove) {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font      = `11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    // Strip markdown bold for canvas
    const cleanMove = state.lastMove.replace(/\*\*/g, "").split("\n")[0].slice(0, 90);
    ctx.fillText(`Turn ${state.turn}  ·  ${cleanMove}`, PAD, PY + 175);
  }

  // ── Turn counter (top-right of art section) ────────────────
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  rrect(ctx, W - 80, 10, 66, 24, 6); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font      = `bold 11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`TURN  ${state.turn}`, W - 47, 26);
  ctx.textAlign = "left";

  // ── Outer border ──────────────────────────────────────────
  ctx.shadowColor = bossColor; ctx.shadowBlur = 14;
  ctx.strokeStyle = rgba(bossColor, 0.4); ctx.lineWidth = 1.5;
  rrect(ctx, 1, 1, W - 2, H - 2, 0); ctx.stroke();
  ctx.shadowBlur  = 0;

  // Watermark
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.font      = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "3px";
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA  ·  ASCENSION TRIAL", W - 12, H - 8);
  ctx.textAlign = "left"; ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}
