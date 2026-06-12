import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";
import { isOwner } from "./owner";

// ── Fonts ─────────────────────────────────────────────────────────────────────
// Load all system fonts first — this makes Noto CJK, emoji, etc. available as
// fallbacks so Unicode/CJK usernames render as real glyphs instead of □ boxes.
try { (GlobalFonts as any).loadSystemFonts(); } catch { /* not critical */ }

// Register custom Rajdhani if present (Latin headers / UI labels)
try {
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-SemiBold.ttf"), "RajdhaniSemi");
} catch { /* Rajdhani missing — falls through to system fonts */ }

// Universal fallback font stack (Latin + CJK + emoji)
const FONT_FALLBACK = `'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', 'Arial Unicode MS', Arial, sans-serif`;

/** Render text, shrinking the base px size until it fits within maxWidth. */
function fitText(
  ctx: SKRSContext2D,
  text: string,
  basePx: number,
  maxWidth: number,
  fontFamily: string,
  bold = true,
): string {
  let px = basePx;
  const weight = bold ? "bold " : "";
  while (px > 8) {
    ctx.font = `${weight}${px}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 1;
  }
  return ctx.font;
}

// ── Element theming ───────────────────────────────────────────────────────────
const THEME: Record<string, { primary: string; secondary: string; label: string }> = {
  FUSION:  { primary: "#FF6B35", secondary: "#FFB38A", label: "FUSION"  },
  GLACIO:  { primary: "#38BDF8", secondary: "#BAE6FD", label: "GLACIO"  },
  ELECTRO: { primary: "#A855F7", secondary: "#D8B4FE", label: "ELECTRO" },
  AERO:    { primary: "#10B981", secondary: "#6EE7B7", label: "AERO"    },
  HAVOC:   { primary: "#EC4899", secondary: "#F9A8D4", label: "HAVOC"   },
  SPECTRO: { primary: "#EAB308", secondary: "#FDE68A", label: "SPECTRO" },
  NONE:    { primary: "#6366F1", secondary: "#A5B4FC", label: "DRIFTER" },
};

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#38BDF8", ELECTRO: "#A855F7",
  AERO: "#10B981", HAVOC: "#EC4899", SPECTRO: "#EAB308", NONE: "#6366F1",
};

const RARITY_COLOR: Record<string, string> = {
  THREE_STAR: "#78B0C8",
  FOUR_STAR:  "#C088E8",
  FIVE_STAR:  "#F5A623",
};

// ── Data types passed in from profile command ─────────────────────────────────
export interface BondData {
  displayName: string;
  avatarUrl:   string | null;
  bondType:    string; // "FRIEND" | "PARTNER" | "ADOPTED_PARENT" | "ADOPTED_CHILD"
}

export interface EchoSlotData {
  name:     string;
  element:  string;
  rarity:   string;
  cost:     number;
  level:    number;
  slot:     number; // 0=main, 1-4=sub
}

export interface WeaponData {
  name:          string;
  weaponType:    string;
  rarity:        number;
  baseAtk:       number;
  level?:        number;   // used to compute effective ATK for display
  userId?:       string;   // for unique forged weapons → assets/weapons/unique/{userId}.png
  isUnique?:     boolean;
  awakened?:     boolean;
  awakenedName?: string | null;
  weaponBond?:   number;
}

export interface ProfileCardInput {
  // DB user fields needed
  id:              string;
  username:        string;
  avatarUrl:       string | null;
  element:         string;
  level:           number;
  worldLevel:      number;
  resonanceExp:    number;
  baseHp:          number;
  baseAtk:         number;
  baseDef:         number;
  baseSpeed:       number;
  critRate:        number;
  critDmg:         number;
  credits:         number;
  lunakite:        number;
  paradoxCores:    number;
  resonanceAura:   number;   // current aura charges (0–5)
  auraNextRegenMs: number;   // ms until next charge (Infinity = full)
  uniqueAbilityName: string | null;
  // Extra
  displayName:     string;
  bonds:           BondData[];
  echoes:          EchoSlotData[];
  weapon:          WeaponData | null;
  overrideElement?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function statBar(
  ctx: SKRSContext2D, label: string, val: number, max: number,
  x: number, y: number, barW: number, color: string
) {
  const fill = Math.min(1, val / max);
  const barH = 7;

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(label, x, y + 7);

  const tx = x + 40;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  rrect(ctx, tx, y, barW, barH, 3); ctx.fill();

  if (fill > 0) {
    const fg = ctx.createLinearGradient(tx, 0, tx + barW, 0);
    fg.addColorStop(0, rgba(color, 0.7));
    fg.addColorStop(1, color);
    ctx.fillStyle = fg;
    rrect(ctx, tx, y, barW * fill, barH, 3); ctx.fill();

    if (fill > 0.02) {
      ctx.shadowColor = color; ctx.shadowBlur = 8;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      rrect(ctx, tx + barW * fill - 2, y + 1, 2, barH - 2, 1); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  const str = (label === "CRIT" || label === "CRIT DMG" || label === "C.DMG") ? `${val}%` : val.toLocaleString();
  ctx.fillText(str, tx + barW + 6, y + 7);
}

function expToLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.6));
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
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

function echoAssetPath(name: string, cost?: number): string | null {
  // 1-cost / 3-cost: PNG in the cost subfolder
  if (cost === 1 || cost === 3) {
    const full = path.join(process.cwd(), "assets", "echoes", `${cost}-cost`, `${name}.png`);
    if (fs.existsSync(full)) return full;
  }
  // 4-cost boss echoes: art lives in Bosses/ (same PNGs used for the fight UI)
  if (cost === 4) {
    const bossFile = BOSS_ART_FILENAMES[name] ?? `${name}.png`;
    const bossPath = path.join(process.cwd(), "Bosses", bossFile);
    if (fs.existsSync(bossPath)) return bossPath;
  }
  // Fallback: snake_case PNG in echoes root
  const snake = name.toLowerCase().replace(/\s+/g, "_") + ".png";
  return fs.existsSync(path.join(process.cwd(), "assets", "echoes", snake))
    ? path.join(process.cwd(), "assets", "echoes", snake)
    : null;
}

function bondTypeLabel(type: string): string {
  switch (type) {
    case "FRIEND":         return "Friend";
    case "PARTNER":        return "Partner";
    case "ADOPTED_PARENT": return "Parent";
    case "ADOPTED_CHILD":  return "Child";
    default:               return "Bond";
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateProfileCard(input: ProfileCardInput): Promise<Buffer> {
  const W = 820, H = input.weapon?.awakened ? 380 : 340;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  const element = (input.overrideElement ?? input.element).toUpperCase();
  const t       = THEME[element] ?? THEME.NONE;
  const elemKey = element.toLowerCase();

  // ── BG ────────────────────────────────────────────────────────────────────
  const bgPaths = [
    path.join(process.cwd(), "assets", "backgrounds", `${elemKey}.png`),
    path.join(process.cwd(), "assets", "backgrounds", `${elemKey}.jpg`),
    path.join(process.cwd(), "assets", "backgrounds", `${elemKey[0].toUpperCase() + elemKey.slice(1)}.png`),
    path.join(process.cwd(), "assets", "backgrounds", "default.png"),
    path.join(process.cwd(), "assets", "backgrounds", "Default.png"),
  ];

  let bgLoaded = false;
  for (const bgPath of bgPaths) {
    if (fs.existsSync(bgPath)) {
      try {
        const bg    = await loadImage(bgPath);
        const scale = Math.max(W / bg.width, H / bg.height);
        const sw = bg.width * scale, sh = bg.height * scale;
        ctx.drawImage(bg, (W - sw) / 2, (H - sh) / 2, sw, sh);
        bgLoaded = true; break;
      } catch { /* try next */ }
    }
  }
  if (!bgLoaded) {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#090d18");
    grad.addColorStop(0.5, rgba(t.primary, 0.22));
    grad.addColorStop(1, "#090d18");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  }

  // Vignettes
  const vL = ctx.createLinearGradient(0, 0, W * 0.68, 0);
  vL.addColorStop(0, "rgba(0,0,0,0.90)");
  vL.addColorStop(0.6, "rgba(0,0,0,0.80)");
  vL.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vL; ctx.fillRect(0, 0, W, H);

  const vT = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  vT.addColorStop(0, "rgba(0,0,0,0.65)"); vT.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vT; ctx.fillRect(0, 0, W, H);

  const vB = ctx.createLinearGradient(0, H * 0.7, 0, H);
  vB.addColorStop(0, "rgba(0,0,0,0)"); vB.addColorStop(1, "rgba(0,0,0,0.80)");
  ctx.fillStyle = vB; ctx.fillRect(0, 0, W, H);

  const tR = ctx.createLinearGradient(W * 0.55, 0, W, 0);
  tR.addColorStop(0, "rgba(0,0,0,0)"); tR.addColorStop(1, rgba(t.primary, 0.20));
  ctx.fillStyle = tR; ctx.fillRect(0, 0, W, H);

  // ── Avatar ────────────────────────────────────────────────────────────────
  const avCX = 90, avCY = 155, avR = 68;

  ctx.shadowColor = t.primary; ctx.shadowBlur = 28;
  ctx.strokeStyle = t.primary; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(avCX, avCY, avR + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = rgba(t.secondary, 0.3); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(avCX, avCY, avR + 11, 0, Math.PI * 2); ctx.stroke();

  ctx.save();
  ctx.beginPath(); ctx.arc(avCX, avCY, avR, 0, Math.PI * 2); ctx.clip();
  if (input.avatarUrl) {
    try {
      const img = await loadImage(input.avatarUrl + "?size=256");
      ctx.drawImage(img, avCX - avR, avCY - avR, avR * 2, avR * 2);
    } catch { ctx.fillStyle = rgba(t.primary, 0.3); ctx.fillRect(avCX - avR, avCY - avR, avR * 2, avR * 2); }
  } else {
    ctx.fillStyle = rgba(t.primary, 0.3); ctx.fillRect(avCX - avR, avCY - avR, avR * 2, avR * 2);
  }
  ctx.restore();

  // ── Name + element pill + WL ──────────────────────────────────────────────
  const NX = 180;

  ctx.fillStyle = "#FFFFFF";
  fitText(ctx, input.displayName, 28, 260, `Rajdhani, ${FONT_FALLBACK}`);
  ctx.fillText(input.displayName, NX, 56);

  // Creator crown badge
  if (isOwner(input.id)) {
    const nameW = ctx.measureText(truncate(input.displayName, 20)).width;
    ctx.font = `bold 12px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillStyle = "#FCD34D";
    ctx.shadowColor = "#FCD34D"; ctx.shadowBlur = 8;
    ctx.fillText("* CREATOR", NX + nameW + 10, 52);
    ctx.shadowBlur = 0;
  }

  // Element pill
  const pillW = 82, pillH = 20, pillX = NX, pillY = 64;
  ctx.fillStyle = rgba(t.primary, 0.20);
  rrect(ctx, pillX, pillY, pillW, pillH, 10); ctx.fill();
  ctx.strokeStyle = rgba(t.primary, 0.85); ctx.lineWidth = 1.5;
  rrect(ctx, pillX, pillY, pillW, pillH, 10); ctx.stroke();
  ctx.fillStyle = t.secondary; ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(t.label, pillX + pillW / 2, pillY + 13.5);
  ctx.textAlign = "left";

  const auraFilled = Math.min(5, Math.max(0, input.resonanceAura));
  const auraBar    = "◈".repeat(auraFilled) + "◇".repeat(5 - auraFilled);
  const regenStr   = input.resonanceAura < 5 && isFinite(input.auraNextRegenMs)
    ? (() => {
        const h = Math.floor(input.auraNextRegenMs / 3_600_000);
        const m = Math.floor((input.auraNextRegenMs % 3_600_000) / 60_000);
        return `  +1 in ${h > 0 ? `${h}h ${m}m` : `${m}m`}`;
      })()
    : "";
  ctx.fillStyle = "rgba(255,255,255,0.40)";
  ctx.font = `bold 11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(`LVL ${input.level}   ·   WL ${input.worldLevel}`, pillX + pillW + 10, pillY + 14);
  // Aura on its own line below, with regen hint
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(`${auraBar}  ${auraFilled}/5 Aura${regenStr}`, pillX + pillW + 10, pillY + 27);

  // ── EXP bar ───────────────────────────────────────────────────────────────
  const expNeeded = expToLevel(input.level);
  const expFill   = Math.min(1, input.resonanceExp / expNeeded);
  const expBarX   = NX, expBarY = 92, expBarW = 290, expBarH = 5;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  rrect(ctx, expBarX, expBarY, expBarW, expBarH, 2); ctx.fill();

  if (expFill > 0) {
    const ef = ctx.createLinearGradient(expBarX, 0, expBarX + expBarW, 0);
    ef.addColorStop(0, rgba(t.primary, 0.6)); ef.addColorStop(1, t.primary);
    ctx.fillStyle = ef;
    rrect(ctx, expBarX, expBarY, expBarW * expFill, expBarH, 2); ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.fillText(`${input.resonanceExp.toLocaleString()} / ${expNeeded.toLocaleString()} EXP`, expBarX, expBarY + 16);

  // Accent line
  const lineGrad = ctx.createLinearGradient(NX, 0, NX + 320, 0);
  lineGrad.addColorStop(0, rgba(t.primary, 0.85));
  lineGrad.addColorStop(0.7, rgba(t.primary, 0.15));
  lineGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = lineGrad; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(NX, 112); ctx.lineTo(NX + 340, 112); ctx.stroke();

  // ── Stat bars ─────────────────────────────────────────────────────────────
  const BX = NX, BW = 200;
  const stats = [
    { label: "HP",     val: input.baseHp,                     max: 25000, color: "#FB7185" },
    { label: "ATK",    val: input.baseAtk,                    max: 2000,  color: t.primary },
    { label: "DEF",    val: input.baseDef,                    max: 3000,  color: "#38BDF8" },
    { label: "SPD",    val: input.baseSpeed,                  max: 200,  color: "#34D399" },
    { label: "CRIT",   val: Math.round(input.critRate * 100), max: 100,  color: "#FBBF24" },
    { label: "C.DMG",  val: Math.round(input.critDmg * 100),  max: 300,  color: "#A78BFA" },
  ];
  let sy = 120;
  for (const s of stats) { statBar(ctx, s.label, s.val, s.max, BX, sy, BW, s.color); sy += 16; }

  // ── Weapon ────────────────────────────────────────────────────────────────
  const weapY = sy + 6;
  ctx.strokeStyle = rgba(t.primary, 0.3); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(NX, weapY - 2); ctx.lineTo(NX + 320, weapY - 2); ctx.stroke();

  if (input.weapon) {
    const WS = input.weapon.awakened ? 72 : 36;

    const typeFolder = input.weapon.weaponType.charAt(0).toUpperCase()
      + input.weapon.weaponType.slice(1).toLowerCase();
    const awakenedImgPath = input.weapon.awakened && input.weapon.awakenedName
      ? path.join(process.cwd(), "assets", "weapons", "awakened", `${input.weapon.awakenedName}.png`)
      : null;
    const weapImgPath = (awakenedImgPath && fs.existsSync(awakenedImgPath))
      ? awakenedImgPath
      : input.weapon.isUnique && input.weapon.userId
        ? path.join(process.cwd(), "assets", "weapons", "unique", `${input.weapon.userId}.png`)
        : path.join(process.cwd(), "assets", "weapons", typeFolder, `${input.weapon.name}.png`);

    // Gold aura behind awakened thumbnail
    if (input.weapon.awakened) {
      ctx.shadowColor = "#FCD34D"; ctx.shadowBlur = 24;
      ctx.fillStyle = "rgba(252,211,77,0.10)";
      rrect(ctx, NX - 2, weapY - 4, WS + 4, WS + 4, 10); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Thumbnail box
    ctx.save();
    rrect(ctx, NX, weapY - 2, WS, WS, input.weapon.awakened ? 10 : 6);
    ctx.clip();
    let weapImgLoaded = false;
    if (fs.existsSync(weapImgPath)) {
      try {
        const wImg = await loadImage(weapImgPath);
        ctx.drawImage(wImg, NX, weapY - 2, WS, WS);
        weapImgLoaded = true;
      } catch { /* fall through */ }
    }
    if (!weapImgLoaded) {
      ctx.fillStyle = rgba(t.primary, 0.25);
      ctx.fillRect(NX, weapY - 2, WS, WS);
      ctx.fillStyle = rgba(t.primary, 0.8);
      ctx.font = `bold 18px Rajdhani, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(input.weapon.weaponType.charAt(0), NX + WS / 2, weapY + WS / 2 - 2 + 6);
      ctx.textAlign = "left";
    }
    ctx.restore();

    // Border glow
    const rarityColors: Record<number, string> = { 1: "#9CA3AF", 2: "#34D399", 3: "#818CF8", 4: "#F59E0B", 5: "#F43F5E" };
    if (input.weapon.awakened) {
      ctx.shadowColor = "#FCD34D"; ctx.shadowBlur = 14;
      ctx.strokeStyle = "rgba(252,211,77,0.90)";
    } else {
      ctx.strokeStyle = rarityColors[input.weapon.rarity] ?? "#818CF8";
    }
    ctx.lineWidth = input.weapon.awakened ? 2 : 1.5;
    rrect(ctx, NX, weapY - 2, WS, WS, input.weapon.awakened ? 10 : 6); ctx.stroke();
    ctx.shadowBlur = 0;

    const TX = NX + WS + 8; // text column X

    // Stars
    const filledStars = "★".repeat(input.weapon.rarity);
    ctx.fillStyle = input.weapon.awakened ? "#FCD34D" : (rarityColors[input.weapon.rarity] ?? "#818CF8");
    ctx.font = `bold ${input.weapon.awakened ? 10 : 8}px Rajdhani, Arial, sans-serif`;
    ctx.fillText(filledStars, input.weapon.awakened ? TX : NX, weapY + WS + 6);

    // Weapon name
    const displayWeaponName = (input.weapon.awakened && input.weapon.awakenedName) ? input.weapon.awakenedName : input.weapon.name;
    if (input.weapon.awakened) { ctx.shadowColor = "#FCD34D"; ctx.shadowBlur = 10; }
    ctx.fillStyle = input.weapon.awakened ? "#FCD34D" : input.weapon.isUnique ? t.secondary : "#FFFFFF";
    ctx.font = `bold ${input.weapon.awakened ? 16 : 13}px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText(truncate(displayWeaponName, input.weapon.awakened ? 18 : 22), TX, weapY + (input.weapon.awakened ? 16 : 12));
    ctx.shadowBlur = 0;

    // Type · ATK
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `bold 10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    const wLevel = input.weapon.level ?? 1;
    const wMult  = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 }[input.weapon.rarity] ?? 2.5;
    const effAtk = Math.round(input.weapon.baseAtk * (1 + (wLevel - 1) * (wMult - 1) / 89));
    ctx.fillText(`${typeFolder}  ·  ${effAtk} ATK`, TX, weapY + (input.weapon.awakened ? 32 : 24));

    if (input.weapon.awakened) {
      const bond = Math.min(10, Math.max(0, input.weapon.weaponBond ?? 0));

      // AWAKENED badge
      const bx = TX, bw = 64, bh = 13;
      ctx.fillStyle = "rgba(252,211,77,0.15)";
      rrect(ctx, bx, weapY + 38, bw, bh, 3); ctx.fill();
      ctx.strokeStyle = "rgba(252,211,77,0.55)"; ctx.lineWidth = 1;
      rrect(ctx, bx, weapY + 38, bw, bh, 3); ctx.stroke();
      ctx.fillStyle = "#FCD34D";
      ctx.font = `bold 8px Rajdhani, Arial, sans-serif`;
      ctx.fillText("✦ AWAKENED", bx + 6, weapY + 48);

      // Bond micro-bar
      const barX = TX, barW = 320 - WS - 14, barH = 6;
      ctx.fillStyle = "rgba(252,211,77,0.10)";
      rrect(ctx, barX, weapY + 56, barW, barH, 2); ctx.fill();
      if (bond > 0) {
        const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        fill.addColorStop(0, "rgba(252,211,77,0.9)");
        fill.addColorStop(1, "rgba(245,158,11,0.9)");
        ctx.fillStyle = fill;
        rrect(ctx, barX, weapY + 56, Math.max(4, barW * (bond / 10)), barH, 2); ctx.fill();
      }
      ctx.strokeStyle = "rgba(252,211,77,0.30)"; ctx.lineWidth = 1;
      rrect(ctx, barX, weapY + 56, barW, barH, 2); ctx.stroke();
      ctx.fillStyle = "rgba(252,211,77,0.55)";
      ctx.font = `bold 8px Rajdhani, Arial, sans-serif`;
      ctx.fillText(`${bond}/10`, barX + barW + 4, weapY + 62);
    } else if (input.weapon.isUnique) {
      ctx.fillStyle = rgba(t.primary, 0.15);
      rrect(ctx, TX, weapY + 27, 46, 12, 3); ctx.fill();
      ctx.strokeStyle = rgba(t.primary, 0.5); ctx.lineWidth = 1;
      rrect(ctx, TX, weapY + 27, 46, 12, 3); ctx.stroke();
      ctx.fillStyle = t.secondary;
      ctx.font = `bold 8px Rajdhani, Arial, sans-serif`;
      ctx.fillText("◈ FORGED", TX + 4, weapY + 36);
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = `11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("No weapon equipped  ·  /forge to craft one", NX, weapY + 14);
  }

  // ── Unique ability ────────────────────────────────────────────────────────
  if (input.uniqueAbilityName) {
    const abY = weapY + (input.weapon?.awakened ? 82 : 44);
    ctx.shadowColor = t.primary; ctx.shadowBlur = 12;
    ctx.fillStyle = rgba(t.primary, 0.15);
    rrect(ctx, NX, abY, 320, 20, 4); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(t.primary, 0.5); ctx.lineWidth = 1;
    rrect(ctx, NX, abY, 320, 20, 4); ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("PASSIVE", NX + 6, abY + 13);

    ctx.fillStyle = t.secondary;
    ctx.font = `bold 11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText(truncate(input.uniqueAbilityName, 28), NX + 54, abY + 13);
  }

  // ── Economy row ───────────────────────────────────────────────────────────
  const ecoY = H - 36;
  const sep2 = ctx.createLinearGradient(NX, 0, NX + 340, 0);
  sep2.addColorStop(0, rgba(t.primary, 0.4)); sep2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = sep2; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(NX, ecoY - 6); ctx.lineTo(NX + 340, ecoY - 6); ctx.stroke();

  const eco = [
    { label: "CREDITS",    val: input.credits      },
    { label: "LUNAKITE",   val: input.lunakite     },
    { label: "PAR. CORES", val: input.paradoxCores },
  ];
  eco.forEach((e, i) => {
    const ex = NX + i * 116;
    ctx.fillStyle = "rgba(255,255,255,0.40)";
    ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText(e.label, ex, ecoY + 8);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold 15px Rajdhani, 'Arial Black', Arial`;
    ctx.fillText(e.val.toLocaleString(), ex, ecoY + 24);
  });

  // ── Right panel separator ─────────────────────────────────────────────────
  const RPX = 590;
  const rSep = ctx.createLinearGradient(0, 16, 0, H - 16);
  rSep.addColorStop(0, "rgba(255,255,255,0)");
  rSep.addColorStop(0.3, rgba(t.primary, 0.30));
  rSep.addColorStop(0.7, rgba(t.primary, 0.30));
  rSep.addColorStop(1, "rgba(255,255,255,0)");
  ctx.strokeStyle = rSep; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(RPX - 12, 0); ctx.lineTo(RPX - 12, H); ctx.stroke();

  // ── Echo Grid ─────────────────────────────────────────────────────────────
  ctx.fillStyle = rgba(t.secondary, 0.60);
  ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px";
  ctx.fillText("RESONANCE GRID", RPX, 26);
  ctx.letterSpacing = "0px";

  // Grid points
  const gridPts = input.echoes.reduce((sum, e) => sum + e.cost, 0);
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(`${gridPts}/12 pts`, RPX + 218, 26);
  ctx.textAlign = "left";

  const SS = 46, GAP = 5;
  // Row 1: [MAIN(0)][S1(1)][S2(2)]  Row 2: [S3(3)][S4(4)][ ]
  const slotLayout = [[0, 1, 2], [3, 4]];
  const slotLabels = ["MAIN", "S1", "S2", "S3", "S4"];

  for (let ri = 0; ri < slotLayout.length; ri++) {
    const row = slotLayout[ri];
    for (let ci = 0; ci < row.length; ci++) {
      const slotIdx = row[ci];
      const ex = RPX + ci * (SS + GAP);
      const ey = 34 + ri * (SS + GAP);
      const echo = input.echoes.find(e => e.slot === slotIdx);
      const isMain = slotIdx === 0;

      if (echo) {
        const eColor = ELEMENT_HEX[echo.element] ?? t.primary;
        const rColor = RARITY_COLOR[echo.rarity] ?? "#78B0C8";
        const imgPath = echoAssetPath(echo.name, echo.cost);

        // Slot background
        if (isMain) { ctx.shadowColor = eColor; ctx.shadowBlur = 18; }
        ctx.fillStyle = rgba(eColor, 0.22);
        rrect(ctx, ex, ey, SS, SS, 9); ctx.fill();
        ctx.shadowBlur = 0;

        // Echo art (PNG) — clipped to slot shape
        if (imgPath) {
          try {
            const img = await loadImage(imgPath);
            ctx.save();
            rrect(ctx, ex, ey, SS, SS, 9); ctx.clip();
            ctx.drawImage(img, ex, ey, SS, SS);
            // subtle dark overlay so UI elements stay readable
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.fillRect(ex, ey, SS, SS);
            ctx.restore();
          } catch { /* art failed to load — fall through to name text */ }
        }

        // Slot border
        ctx.strokeStyle = rgba(eColor, 0.85); ctx.lineWidth = isMain ? 1.5 : 1;
        rrect(ctx, ex, ey, SS, SS, 9); ctx.stroke();

        // Cost badge (top-right)
        ctx.fillStyle = rgba(eColor, 0.85);
        rrect(ctx, ex + SS - 14, ey + 2, 12, 12, 3); ctx.fill();
        ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 8px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(`${echo.cost}`, ex + SS - 8, ey + 11);
        ctx.textAlign = "left";

        // Echo name — only shown when no art
        if (!imgPath) {
          ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 8px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(truncate(echo.name.split(" ")[0], 7), ex + SS / 2, ey + SS / 2 + 2);
          ctx.textAlign = "left";
        }

        // Rarity dots at bottom
        const dotCount   = echo.rarity === "THREE_STAR" ? 3 : echo.rarity === "FOUR_STAR" ? 4 : 5;
        const dotSize    = 4, dotGap = 3;
        const dotsTotalW = dotCount * dotSize + (dotCount - 1) * dotGap;
        const dotStartX  = ex + (SS - dotsTotalW) / 2;
        for (let d = 0; d < dotCount; d++) {
          ctx.fillStyle = rColor;
          ctx.beginPath();
          ctx.arc(dotStartX + d * (dotSize + dotGap) + dotSize / 2, ey + SS - 7, dotSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Level badge (bottom-left)
        if (echo.level > 0) {
          ctx.fillStyle = "rgba(0,0,0,0.60)";
          ctx.font = `bold 7px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
          ctx.fillText(`Lv${echo.level}`, ex + 3, ey + SS - 3);
        }

      } else {
        // Empty slot
        ctx.fillStyle = isMain ? rgba(t.primary, 0.08) : "rgba(255,255,255,0.04)";
        rrect(ctx, ex, ey, SS, SS, 9); ctx.fill();
        ctx.strokeStyle = isMain ? rgba(t.primary, 0.35) : "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        rrect(ctx, ex, ey, SS, SS, 9); ctx.stroke();
        ctx.fillStyle = isMain ? rgba(t.secondary, 0.50) : "rgba(255,255,255,0.18)";
        ctx.font = `bold ${isMain ? 9 : 8}px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(slotLabels[slotIdx], ex + SS / 2, ey + SS / 2 + 4);
        ctx.textAlign = "left";
      }
    }
  }

  // ── Bonds ─────────────────────────────────────────────────────────────────
  const bondY = 34 + 2 * (SS + GAP) + 14;
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(RPX, bondY - 6); ctx.lineTo(RPX + 220, bondY - 6); ctx.stroke();

  ctx.fillStyle = rgba(t.secondary, 0.60);
  ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "2px";
  ctx.fillText("SYNCHRONY BONDS", RPX, bondY + 4);
  ctx.letterSpacing = "0px";

  if (input.bonds.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.font = `11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("No bonds yet.", RPX, bondY + 22);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.font = `10px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
    ctx.fillText("Use /bond to connect.", RPX, bondY + 36);
  } else {
    for (let i = 0; i < Math.min(3, input.bonds.length); i++) {
      const bp  = input.bonds[i];
      const bx  = RPX, by = bondY + 10 + i * 34;
      const br  = 12;

      ctx.save();
      ctx.beginPath(); ctx.arc(bx + br, by + br, br, 0, Math.PI * 2); ctx.clip();
      if (bp.avatarUrl) {
        try { ctx.drawImage(await loadImage(bp.avatarUrl + "?size=64"), bx, by, br * 2, br * 2); }
        catch { ctx.fillStyle = rgba(t.primary, 0.3); ctx.fillRect(bx, by, br * 2, br * 2); }
      } else {
        ctx.fillStyle = rgba(t.primary, 0.3); ctx.fillRect(bx, by, br * 2, br * 2);
      }
      ctx.restore();

      ctx.strokeStyle = rgba(t.primary, 0.55); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx + br, by + br, br, 0, Math.PI * 2); ctx.stroke();

      ctx.fillStyle = "#FFFFFF"; ctx.font = `bold 11px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
      ctx.fillText(truncate(bp.displayName, 14), bx + br * 2 + 8, by + 11);

      ctx.fillStyle = rgba(t.secondary, 0.70); ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
      ctx.fillText(bondTypeLabel(bp.bondType), bx + br * 2 + 8, by + 23);
    }
  }

  // ── Card border + watermark ───────────────────────────────────────────────
  ctx.shadowColor = t.primary; ctx.shadowBlur = 18;
  ctx.strokeStyle = rgba(t.primary, 0.40); ctx.lineWidth = 1.5;
  rrect(ctx, 1, 1, W - 2, H - 2, 0); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.font = `bold 9px Rajdhani, 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', Arial, sans-serif`;
  ctx.letterSpacing = "3px";
  ctx.textAlign = "right";
  ctx.fillText("CARTETHYIA", W - 12, H - 10);
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";

  return canvas.toBuffer("image/png");
}
