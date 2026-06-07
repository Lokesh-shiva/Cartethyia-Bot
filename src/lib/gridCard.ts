import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";

try {
  try { GlobalFonts.loadSystemFonts(); } catch {}
GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#4FC3F7", ELECTRO: "#B39DDB",
  AERO: "#80CBC4", HAVOC: "#C355E0", SPECTRO: "#FFD54F", NONE: "#8B7FF5",
};
const RARITY_HEX: Record<string, string> = {
  THREE_STAR: "#78B0C8", FOUR_STAR: "#C088E8", FIVE_STAR: "#F5A623",
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
const BOSS_ART_FILENAMES: Record<string, string> = {
  "Resonant Wraith":      "The Resonant Wraith.png",
  "Tidecaller Sovereign": "Tidecaller Sovereign.png",
  "Fractured Arbiter":    "The Fractured Arbiter.png",
  "Nullfire Construct":   "Nullfire Construct.png",
  "Sable Harbinger":      "Sable Harbinger.png",
  "Auric Colossus":       "Auric Colossus.png",
  "Embercrown Tyrant":    "Embercrown Tyrant.png",
  "Galeborne Phantom":    "Galeborne Phantom.png",
  "Resonant Absolute":    "The Resonant Absolute.png",
  "Ignis Behemoth":       "Ignis Behemoth.png",
  "Permafrost Sovereign": "Permafrost Sovereign.png",
  "Voltaic Aberrant":     "Voltaic Aberrant.png",
  "Tempest Ancient":      "Tempest Ancient.png",
  "Null Ravager":         "Null Ravager.png",
  "Luminal Specter":      "Luminal Specter.png",
};

function echoArtPath(name: string, cost: number): string | null {
  // 1-cost / 3-cost: PNG in the cost subfolder
  if (cost === 1 || cost === 3) {
    const sub = path.join(process.cwd(), "assets", "echoes", `${cost}-cost`, `${name}.png`);
    if (fs.existsSync(sub)) return sub;
  }
  // 4-cost boss echoes: art lives in Bosses/ (same PNGs used for the fight UI)
  if (cost === 4) {
    const bossFile = BOSS_ART_FILENAMES[name] ?? `${name}.png`;
    const bossPath = path.join(process.cwd(), "Bosses", bossFile);
    if (fs.existsSync(bossPath)) return bossPath;
  }
  // fallback: snake_case PNG in echoes root
  const snake = path.join(process.cwd(), "assets", "echoes", name.toLowerCase().replace(/\s+/g, "_") + ".png");
  return fs.existsSync(snake) ? snake : null;
}

export interface GridSlot {
  slot: number;            // 0 main, 1-4 sub
  name: string;
  element: string;
  rarity: string;
  cost: number;
  level: number;
}

export interface GridCardData {
  displayName:  string;
  element:      string;     // player element
  slots:        GridSlot[]; // equipped echoes
  gridPoints:   number;
  bonusLabels:  string[];   // active set/affinity/ability labels (plain text)
}

async function drawSlot(
  ctx: SKRSContext2D, slot: GridSlot | null, x: number, y: number, size: number, label: string, playerElem: string,
) {
  const ec = slot ? (ELEMENT_HEX[slot.element] ?? ELEMENT_HEX.NONE) : ELEMENT_HEX[playerElem] ?? ELEMENT_HEX.NONE;
  const rc = slot ? (RARITY_HEX[slot.rarity] ?? RARITY_HEX.THREE_STAR) : "#444";

  if (slot) {
    // art
    ctx.save();
    rrect(ctx, x, y, size, size, 12); ctx.clip();
    ctx.fillStyle = rgba(ec, 0.12); ctx.fillRect(x, y, size, size);
    const ap = echoArtPath(slot.name, slot.cost);
    if (ap) {
      try {
        const img = await loadImage(ap);
        const sc = Math.max(size / img.width, size / img.height);
        const sw = img.width * sc, sh = img.height * sc;
        ctx.drawImage(img, x + (size - sw) / 2, y + (size - sh) / 2, sw, sh);
      } catch { /* skip */ }
    }
    // bottom fade
    const fade = ctx.createLinearGradient(0, y + size - 40, 0, y + size);
    fade.addColorStop(0, "rgba(11,12,20,0)"); fade.addColorStop(1, "rgba(11,12,20,0.92)");
    ctx.fillStyle = fade; ctx.fillRect(x, y + size - 40, size, 40);
    ctx.restore();

    // frame
    ctx.shadowColor = ec; ctx.shadowBlur = slot.slot === 0 ? 16 : 8;
    ctx.strokeStyle = rgba(ec, 0.9); ctx.lineWidth = slot.slot === 0 ? 2.5 : 1.5;
    rrect(ctx, x, y, size, size, 12); ctx.stroke();
    ctx.shadowBlur = 0;

    // cost badge
    ctx.fillStyle = rgba(ec, 0.92);
    ctx.beginPath(); ctx.arc(x + size - 15, y + 15, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#FFF"; ctx.font = `bold 13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`; ctx.textAlign = "center";
    ctx.fillText(`${slot.cost}`, x + size - 15, y + 20); ctx.textAlign = "left";

    // name + level
    ctx.fillStyle = "#FFF"; ctx.font = `bold ${slot.slot === 0 ? 13 : 11}px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    const nm = slot.name.length > (slot.slot === 0 ? 16 : 12) ? slot.name.split(" ")[0] : slot.name;
    ctx.fillText(nm, x + 8, y + size - 20);
    // rarity dots
    const dots = slot.rarity === "THREE_STAR" ? 3 : slot.rarity === "FOUR_STAR" ? 4 : 5;
    for (let d = 0; d < dots; d++) {
      ctx.fillStyle = rc; ctx.beginPath();
      ctx.arc(x + 10 + d * 9, y + size - 9, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    // level
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.textAlign = "right"; ctx.fillText(`Lv${slot.level}`, x + size - 8, y + size - 8); ctx.textAlign = "left";
  } else {
    // empty
    ctx.fillStyle = "rgba(255,255,255,0.03)"; rrect(ctx, x, y, size, size, 12); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
    rrect(ctx, x, y, size, size, 12); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = `bold 13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.fillText(label, x + size / 2, y + size / 2 + 5); ctx.textAlign = "left";
  }
}

export async function generateGridCard(d: GridCardData): Promise<Buffer> {
  const W = 880, H = 440;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const pe = ELEMENT_HEX[d.element] ?? ELEMENT_HEX.NONE;

  // base
  ctx.fillStyle = "#0B0C14"; ctx.fillRect(0, 0, W, H);
  const bloom = ctx.createRadialGradient(W * 0.3, H * 0.4, 0, W * 0.3, H * 0.4, 480);
  bloom.addColorStop(0, rgba(pe, 0.14)); bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom; ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = "#FFF"; ctx.font = `bold 26px Rajdhani, 'Arial Black', 'Noto Sans', 'Noto Sans CJK SC', Arial, sans-serif`;
  ctx.fillText("RESONANCE GRID", 32, 46);
  ctx.fillStyle = rgba(pe, 0.9); ctx.font = `bold 15px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(`${d.displayName}`, 32, 68);
  // points
  ctx.font = `bold 22px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`; ctx.textAlign = "right";
  ctx.fillStyle = d.gridPoints > 12 ? "#FF4F6D" : pe;
  ctx.fillText(`${d.gridPoints} / 12`, W - 32, 46);
  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = `bold 11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText("GRID POINTS", W - 32, 64); ctx.textAlign = "left";

  // ── Slots: Main (big) + 4 subs (2x2) ──────────────────────────────────────
  const find = (s: number) => d.slots.find(x => x.slot === s) ?? null;
  const gy = 92;
  await drawSlot(ctx, find(0), 32, gy, 150, "MAIN", d.element);
  const subSize = 110, gap = 14, sx = 200;
  await drawSlot(ctx, find(1), sx,                    gy,                   subSize, "S1", d.element);
  await drawSlot(ctx, find(2), sx + subSize + gap,    gy,                   subSize, "S2", d.element);
  await drawSlot(ctx, find(3), sx,                    gy + subSize + gap,   subSize, "S3", d.element);
  await drawSlot(ctx, find(4), sx + subSize + gap,    gy + subSize + gap,   subSize, "S4", d.element);

  // ── Right panel: active bonuses ───────────────────────────────────────────
  const px = 470, pw = W - px - 26, py = 92;
  ctx.fillStyle = "rgba(255,255,255,0.03)"; rrect(ctx, px, py, pw, 316, 12); ctx.fill();
  ctx.strokeStyle = rgba(pe, 0.3); ctx.lineWidth = 1; rrect(ctx, px, py, pw, 316, 12); ctx.stroke();

  ctx.fillStyle = rgba(pe, 0.9); ctx.font = `bold 12px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px"; ctx.fillText("ACTIVE BONUSES", px + 16, py + 26); ctx.letterSpacing = "0px";

  // wrap a single label across two canvas lines if it exceeds the panel width
  const wrapLabel = (text: string): string[] => {
    const maxW = pw - 44;
    ctx.font = `12px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxW) return [text];
    // split at last space before overflow
    let line = "";
    for (const word of text.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW) { break; }
      line = test;
    }
    return [line, text.slice(line.length).trim()];
  };

  let ly = py + 46;
  if (d.bonusLabels.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = `13px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("No active bonuses.", px + 16, ly);
    ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.font = `12px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("Equip echoes to unlock set bonuses.", px + 16, ly + 18);
  } else {
    for (const label of d.bonusLabels) {
      const clean = label.replace(/[✦◈🔥❄️⚡🌪️🌑✨🗡️◇]/g, "").replace(/\s+/g, " ").trim();
      if (!clean) continue;
      const lines = wrapLabel(clean);
      ctx.fillStyle = pe; ctx.fillRect(px + 16, ly - 6, 3, 3);
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = `12px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
      ctx.fillText(lines[0], px + 26, ly);
      if (lines[1]) {
        ly += 15;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(lines[1], px + 26, ly);
      }
      ly += 19;
      if (ly > py + 310) break;
    }
  }

  // frame + watermark
  ctx.strokeStyle = rgba(pe, 0.35); ctx.lineWidth = 1.5; rrect(ctx, 3, 3, W - 6, H - 6, 0); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "3px"; ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA", W - 14, H - 12); ctx.textAlign = "left"; ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}
