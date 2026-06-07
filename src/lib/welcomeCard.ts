import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";

try {
  try { GlobalFonts.loadSystemFonts(); } catch {}
GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

function rrect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

/**
 * Striking onboarding banner — "You are now a Drifter".
 * Cosmic dark base, indigo bloom, glowing avatar, corner ticks (WW/HSR feel).
 */
export async function generateWelcomeCard(
  displayName: string, avatarUrl: string | null, isFirstTime: boolean,
): Promise<Buffer> {
  const W = 920, H = 320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const accent  = "#8B7FF5";   // indigo resonance
  const accent2 = "#C7B8FF";

  // ── Background: try a neutral art bg, else cosmic gradient ─────────────────
  const bgCandidates = [
    path.join(process.cwd(), "assets", "backgrounds", "Default.png"),
    path.join(process.cwd(), "assets", "backgrounds", "default.png"),
  ];
  let drew = false;
  for (const bg of bgCandidates) {
    if (fs.existsSync(bg)) {
      try {
        const img = await loadImage(bg);
        const scale = Math.max(W / img.width, H / img.height);
        const sw = img.width * scale, sh = img.height * scale;
        ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh);
        drew = true; break;
      } catch { /* next */ }
    }
  }
  if (!drew) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0A0B16"); g.addColorStop(0.5, "#16122E"); g.addColorStop(1, "#0A0B16");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // Dark wash for readability
  ctx.fillStyle = "rgba(8,9,20,0.72)"; ctx.fillRect(0, 0, W, H);

  // Indigo radial bloom behind the text block
  const bloom = ctx.createRadialGradient(W * 0.62, H * 0.5, 0, W * 0.62, H * 0.5, W * 0.55);
  bloom.addColorStop(0, "rgba(139,127,245,0.22)"); bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom; ctx.fillRect(0, 0, W, H);

  // Faint starfield
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 60; i++) {
    const x = (i * 137.5) % W, y = (i * 89.3) % H, r = (i % 3) * 0.5 + 0.3;
    ctx.globalAlpha = 0.05 + (i % 5) * 0.03;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Avatar (left, large, glowing) ─────────────────────────────────────────
  const avCX = 150, avCY = 160, avR = 92;
  // Outer rotating-tick ring (decorative)
  ctx.strokeStyle = "rgba(199,184,255,0.25)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(avCX, avCY, avR + 18, 0, Math.PI * 2); ctx.stroke();
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    const x1 = avCX + Math.cos(rad) * (avR + 14), y1 = avCY + Math.sin(rad) * (avR + 14);
    const x2 = avCX + Math.cos(rad) * (avR + 22), y2 = avCY + Math.sin(rad) * (avR + 22);
    ctx.strokeStyle = "rgba(199,184,255,0.4)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // Glow ring
  ctx.shadowColor = accent; ctx.shadowBlur = 34;
  ctx.strokeStyle = accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(avCX, avCY, avR + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  // Avatar image
  ctx.save();
  ctx.beginPath(); ctx.arc(avCX, avCY, avR, 0, Math.PI * 2); ctx.clip();
  if (avatarUrl) {
    try { const img = await loadImage(avatarUrl + "?size=256"); ctx.drawImage(img, avCX - avR, avCY - avR, avR * 2, avR * 2); }
    catch { ctx.fillStyle = "rgba(139,127,245,0.3)"; ctx.fillRect(avCX - avR, avCY - avR, avR * 2, avR * 2); }
  } else { ctx.fillStyle = "rgba(139,127,245,0.3)"; ctx.fillRect(avCX - avR, avCY - avR, avR * 2, avR * 2); }
  ctx.restore();

  // ── Text block (right) ────────────────────────────────────────────────────
  const TX = 290;

  // Eyebrow
  ctx.fillStyle = accent2; ctx.font = `bold 13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "5px";
  ctx.fillText("RESONANCE  DETECTED", TX, 74);
  ctx.letterSpacing = "0px";

  // Big title
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold 50px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.fillText("You are a Drifter", TX, 124);

  // Name line
  ctx.fillStyle = accent2;
  ctx.font = `bold 26px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  const nm = displayName.length > 22 ? displayName.slice(0, 21) + "…" : displayName;
  ctx.fillText(`Welcome, ${nm}`, TX, 160);

  // Accent rule
  const rule = ctx.createLinearGradient(TX, 0, TX + 420, 0);
  rule.addColorStop(0, accent); rule.addColorStop(0.7, "rgba(139,127,245,0.15)"); rule.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = rule; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(TX, 178); ctx.lineTo(TX + 440, 178); ctx.stroke();

  // Tagline
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = `500 16px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText("Socialize. Resonate. Ascend.", TX, 206);
  ctx.fillStyle = "rgba(255,255,255,0.40)";
  ctx.font = `500 14px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText("Interaction is power — you cannot reach endgame alone.", TX, 228);

  // Starter pack chip (first-timers)
  if (isFirstTime) {
    const chipY = 252, chipW = 430, chipH = 36;
    ctx.fillStyle = "rgba(139,127,245,0.14)";
    rrect(ctx, TX, chipY, chipW, chipH, 8); ctx.fill();
    ctx.strokeStyle = "rgba(139,127,245,0.5)"; ctx.lineWidth = 1;
    rrect(ctx, TX, chipY, chipW, chipH, 8); ctx.stroke();
    ctx.fillStyle = accent2; ctx.font = `bold 11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("STARTER PACK", TX + 12, chipY + 15);
    ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 14px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("500 Credits   ·   3 Tuning Modules   ·   5 Resonance Records", TX + 12, chipY + 29);
  }

  // ── Corner ticks ──────────────────────────────────────────────────────────
  ctx.strokeStyle = accent; ctx.lineWidth = 2;
  const T = 18;
  [[10,10,1,1],[W-10,10,-1,1],[10,H-10,1,-1],[W-10,H-10,-1,-1]].forEach(([x,y,dx,dy]) => {
    ctx.beginPath(); ctx.moveTo(x, y + dy*T); ctx.lineTo(x, y); ctx.lineTo(x + dx*T, y); ctx.stroke();
  });

  // Outer frame glow
  ctx.shadowColor = accent; ctx.shadowBlur = 16;
  ctx.strokeStyle = "rgba(139,127,245,0.4)"; ctx.lineWidth = 1.5;
  rrect(ctx, 2, 2, W - 4, H - 4, 0); ctx.stroke();
  ctx.shadowBlur = 0;

  // Watermark
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.font = `bold 11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "4px"; ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA", W - 16, H - 14);
  ctx.textAlign = "left"; ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}
