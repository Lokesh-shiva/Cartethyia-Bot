# Solace Character Card + Leveling/Ascension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/character`'s 6 pages (Stats, Weapon, Echoes, Kit Levels, Constellations, Lore) to canvas-rendered cards, and give Solace a real level/ascension progression system (currently she has none — a fresh pull and a maxed-investment Solace use identical fixed stats).

**Architecture:** One new file `src/lib/characterCard.ts` holds 3 shared canvas templates (`getElementTheme`, `renderStatBarsCard`, `renderSlotGridCard`, `renderLoreCard`) following the existing `weaponCard.ts`/`gridCard.ts` conventions (`@napi-rs/canvas`, local `ELEMENT_HEX`/`rrect`/`rgba` helpers, no shared module — matches how every other card file already duplicates these). The Weapon page reuses the existing `generateWeaponCard()` unchanged. Leveling/ascension math lives in `src/lib/solace.ts` (already the home of her stat resolution) as pure functions, with `CharacterProgress.level`/`ascensionPhase` as the new persisted state. `src/commands/rpg/character.ts` is restructured to route all 6 pages through image attachments instead of the current 2-page (Kit Levels/Constellations) text-embed setup.

**Tech Stack:** TypeScript, `@napi-rs/canvas`, Prisma v7, discord.js v14.

See the [design spec](../specs/2026-07-17-solace-character-card-design.md) for full rationale (§7 leveling/ascension, §7.1 lore fragments, §3 element theming, §4 templates).

---

### Task 1: Schema — leveling fields

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: Add fields**

In `model CharacterProgress` (around line 339), add after `constellationTokens`:
```prisma
  level          Int @default(1)
  ascensionPhase Int @default(0) // 0-6, gates level cap: 20/40/50/60/70/80/90
```

In `model User` (Economy block, near `resonanceRecords` at line 91), add:
```prisma
  starfallShards   Int            @default(0) // Solace ascension mat (Lv40+), drops only from the Spectro field boss
```

- [ ] **Step 2: Push and regenerate**

Run: `npm run db:push`
Expected: prompts/confirms schema sync, no data loss warnings for these additive nullable-default columns.

Run: `npx prisma generate`
Expected: regenerates `@prisma/client` types with `level`/`ascensionPhase`/`starfallShards`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no consumers reference these fields yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(solace): add level/ascensionPhase to CharacterProgress, starfallShards currency"
```

---

### Task 2: Leveling/ascension math in solace.ts

**Files:** Modify `src/lib/solace.ts`

- [ ] **Step 1: Add ascension cap table and lore fragments**

Add near the top of the file, after the `SOLACE` const block:

```typescript
// ── Leveling & Ascension (Milestone: character card project) ─────────────
// Mirrors the WL boss level-cap table (CLAUDE.md): index = ascensionPhase (0-6).
export const ASCENSION_LEVEL_CAP: number[] = [20, 40, 50, 60, 70, 80, 90];
export const MAX_ASCENSION_PHASE = ASCENSION_LEVEL_CAP.length - 1; // 6
export const SOLACE_MAX_LEVEL = ASCENSION_LEVEL_CAP[MAX_ASCENSION_PHASE]; // 90

export interface AscensionCost {
  credits:       number;
  forgingOres:   number;
  paradoxCores:  number;
  starfallShards: number; // 0 for phases 1 (only required from phase 2 onward, i.e. the Lv40 ascension)
}

// Cost to ascend FROM `currentPhase` TO `currentPhase + 1`. currentPhase is
// 0-5 (ascending past phase 6 is impossible — SOLACE_MAX_LEVEL is the ceiling).
export function solaceAscensionCost(currentPhase: number): AscensionCost {
  const targetPhase = currentPhase + 1; // 1-6
  return {
    credits:        2000 * targetPhase,
    forgingOres:     10 * targetPhase,
    paradoxCores:     2 * targetPhase,
    starfallShards: targetPhase >= 2 ? 3 * (targetPhase - 1) : 0,
  };
}

// Cost to raise `level` by 1, in Resonance Records + Credits — flat per-level
// spend, no cap-crossing logic here (the caller clamps to the current phase's cap).
export function solaceLevelUpCost(currentLevel: number): { resonanceRecords: number; credits: number } {
  return { resonanceRecords: Math.ceil(currentLevel / 2) + 1, credits: currentLevel * 50 };
}

// 7 fixed lore fragments — Fragment 1 always visible, Fragments 2-7 unlock at
// ascensionPhase 1-6 respectively. See design spec §7.1 for the approved text.
export const SOLACE_LORE_FRAGMENTS: string[] = [
  "They say every star eventually falls. Most burn out in the descent, forgotten before they touch the ground.",
  "Solace remembers her fall — the sky tearing open, the long silence of the drop, and then warmth, unfamiliar and entire, as she opened eyes she didn't know she had onto a world that was not her own.",
  "She could have stayed dim. Fallen stars usually do — spent, purposeless, waiting to go dark for good. But something in her refused the silence.",
  "She chose to keep shining, because somewhere below her light there was always someone who needed it more than the sky ever had.",
  "So she stays close to the ground now, deliberately. She kneels beside the wounded instead of watching from above.",
  "She lends her glow to whoever's fighting beside her — not because the sky asks it of her anymore, but because she decided, once and for all, what a star that falls should do with the light it has left.",
  "Give it away, freely, to anyone still standing in the dark. She doesn't call herself a light in the heavens anymore. She calls herself one on the ground — smaller, maybe, but close enough to actually reach the people who need her.",
];

// Fragment index i (0-based) is unlocked once ascensionPhase >= i.
export function unlockedLoreFragments(ascensionPhase: number): { text: string; unlocked: boolean }[] {
  return SOLACE_LORE_FRAGMENTS.map((text, i) => ({ text, unlocked: ascensionPhase >= i }));
}
```

- [ ] **Step 2: Make base stats level-aware**

Replace the `SOLACE` const's `baseAtk`/`baseDef`/`baseSpeed`/`hpMax` fields (they stay as-is — they now represent the Lv90 ceiling) and add a new function right after the `SOLACE` const block (before `solaceIntroEffect`):

```typescript
// Support-class growth bias (design spec §7): HP/DEF grow across the full
// range (low floor), ATK grows across a narrow range (high floor — leveling
// barely raises her damage), Crit barely moves at all. This is a deliberate
// constraint, not an incidental curve shape — a maxed-level Solace must still
// read as a support unit, never DPS-shaped.
const LEVEL_FLOOR_FRACTION = { hp: 0.20, def: 0.20, atk: 0.65, spd: 0.50, critRate: 0.95, critDmg: 0.95 };

function levelScaledStat(ceiling: number, level: number, floorFraction: number): number {
  const clamped = Math.max(1, Math.min(SOLACE_MAX_LEVEL, level));
  const t = (clamped - 1) / (SOLACE_MAX_LEVEL - 1); // 0 at Lv1, 1 at Lv90
  return ceiling * (floorFraction + (1 - floorFraction) * t);
}

export function solaceStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(levelScaledStat(SOLACE.hpMax,   level, LEVEL_FLOOR_FRACTION.hp)),
    baseAtk:   Math.round(levelScaledStat(SOLACE.baseAtk, level, LEVEL_FLOOR_FRACTION.atk)),
    baseDef:   Math.round(levelScaledStat(SOLACE.baseDef, level, LEVEL_FLOOR_FRACTION.def)),
    baseSpeed: Math.round(levelScaledStat(SOLACE.baseSpeed, level, LEVEL_FLOOR_FRACTION.spd)),
    critRate:  levelScaledStat(SOLACE.critRate, level, LEVEL_FLOOR_FRACTION.critRate),
    critDmg:   levelScaledStat(SOLACE.critDmg, level, LEVEL_FLOOR_FRACTION.critDmg),
  };
}
```

(`SOLACE_MAX_LEVEL` is defined above this point in the file per Step 1, so ordering is fine — `solaceStatsAtLevel` is declared after the `ASCENSION_LEVEL_CAP` block.)

- [ ] **Step 3: Wire level into `resolveSolaceStats`**

Modify `resolveSolaceStats` (currently reads `SOLACE.baseAtk` etc. directly) to look up the player's level first:

```typescript
export async function resolveSolaceStats(userId: string): Promise<ResolvedStats & { hasWellspring: boolean }> {
  const [bonuses, progress] = await Promise.all([
    resolvePlayerBonuses(userId, "solace"),
    prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "solace" } },
      select: { level: true },
    }),
  ]);
  const lvl = solaceStatsAtLevel(progress?.level ?? 1);
  const stats = applyBonuses(
    { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
    bonuses,
  );
  return { ...stats, hasWellspring: bonuses.equippedWeaponName === "Wellspring" };
}
```

Add `import prisma from "./prisma";` at the top of `src/lib/solace.ts` (not currently imported there).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/solace.ts
git commit -m "feat(solace): level-aware stat curve, ascension costs, lore fragments"
```

---

### Task 3: Starfall Shard drop on the Spectro field boss

**Files:** Modify `src/commands/rpg/field-boss.ts`

- [ ] **Step 1: Add the drop**

In the `cleanup` function's `if (won)` block (around line 439, right after the `awardUser(...)` call for credits/resonanceExp/fractonite), add a conditional Starfall Shard award scoped to the Spectro boss only (`fb.id === "luminal_specter"`, per `src/lib/fieldBosses.ts`):

```typescript
          const credits = 300 + user.worldLevel * 120;
          await awardUser(interaction.user.id, { credits, resonanceExp: 100 + user.worldLevel * 40, fractonite: 60 }, "field-boss");

          let starfallShardsDropped = 0;
          if (fb.id === "luminal_specter" && Math.random() < 0.35) {
            starfallShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { starfallShards: { increment: 1 } },
            });
          }
```

Then extend the result embed's description (same block, a few lines below) to mention the shard when it drops — find the line building `echoLines`/currency text and add a conditional line:

```typescript
                `${CE.cr} ${credits} Credits  ·  ${CE.fk} 1 Fracture Key` +
                (starfallShardsDropped ? `\n✦ **1 Starfall Shard**` : "") +
```

(Insert this line immediately after the existing `${CE.cr} ${credits} Credits  ·  ${CE.fk} 1 Fracture Key` line in the template literal, before the level-up line.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/commands/rpg/field-boss.ts
git commit -m "feat(solace): Starfall Shards drop from the Spectro field boss (35% rate)"
```

---

### Task 4: `characterCard.ts` — shared canvas templates

**Files:** Create `src/lib/characterCard.ts`

- [ ] **Step 1: Element theme + shared helpers**

```typescript
import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";
import fs   from "fs";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#4FC3F7", ELECTRO: "#B39DDB",
  AERO: "#80CBC4", HAVOC: "#C355E0", SPECTRO: "#FFD54F", NONE: "#8B7FF5",
};

export interface ElementTheme {
  accent:     string;
  accentDark: string;
  bgGradient: [string, string];
}

// Element-driven theming (design spec §3): every card page derives its accent
// purely from the character's element, reusing the same mapping every other
// card file already has — chosen over a bespoke per-character palette so a
// future 2nd character needs zero new design work.
export function getElementTheme(element: string): ElementTheme {
  const accent = ELEMENT_HEX[element.toUpperCase()] ?? ELEMENT_HEX.NONE;
  return { accent, accentDark: rgba(accent, 0.35), bgGradient: ["#0F0F1A", "#1A1A2E"] };
}

function rgba(hex: string, a: number): string {
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
function font(sz: number, w = "bold") { return `${w} ${sz}px Rajdhani, 'Noto Sans', Arial, sans-serif`; }

const W = 1000, H = 563; // 16:9 landscape, matches design spec §2
```

- [ ] **Step 2: `renderStatBarsCard` (Stats + Kit Levels)**

Append:

```typescript
export interface StatBar { label: string; value: number; max: number; displayValue: string; }
export interface StatBarsCardInput {
  characterName: string;
  element:       string;
  subtitle:      string;      // e.g. "Lv 42 · Phase 2" or "Kit Levels"
  bars:          StatBar[];
  portraitPath?: string;      // optional, e.g. assets/Characters/Solace.png
}

export async function renderStatBarsCard(input: StatBarsCardInput): Promise<Buffer> {
  const theme = getElementTheme(input.element);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bgGradient[0]); grad.addColorStop(1, theme.bgGradient[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  if (input.portraitPath && fs.existsSync(input.portraitPath)) {
    const img = await loadImage(input.portraitPath);
    const pw = 340, ph = H;
    ctx.save();
    rrect(ctx, 0, 0, pw, ph, 0); ctx.clip();
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img as any, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
    ctx.restore();
    const fade = ctx.createLinearGradient(pw - 120, 0, pw, 0);
    fade.addColorStop(0, "rgba(15,15,26,0)"); fade.addColorStop(1, "rgba(15,15,26,1)");
    ctx.fillStyle = fade; ctx.fillRect(pw - 120, 0, 120, H);
  }

  const px = input.portraitPath ? 380 : 48;
  ctx.fillStyle = theme.accent;
  ctx.font = font(38);
  ctx.fillText(input.characterName, px, 80);
  ctx.fillStyle = "#CBD5E1";
  ctx.font = font(20, "600");
  ctx.fillText(input.subtitle, px, 112);

  ctx.strokeStyle = rgba(theme.accent, 0.4); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, 130); ctx.lineTo(W - 48, 130); ctx.stroke();

  const barX = px, barW = W - 48 - px, barH = 22, gap = 44;
  let y = 165;
  for (const bar of input.bars) {
    ctx.fillStyle = "#94A3B8"; ctx.font = font(17, "600");
    ctx.fillText(bar.label, barX, y - 8);
    ctx.fillStyle = "#E2E8F0"; ctx.font = font(17, "700");
    ctx.textAlign = "right";
    ctx.fillText(bar.displayValue, barX + barW, y - 8);
    ctx.textAlign = "left";

    rrect(ctx, barX, y, barW, barH, 8); ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
    const pct = Math.max(0, Math.min(1, bar.max > 0 ? bar.value / bar.max : 0));
    if (pct > 0) { rrect(ctx, barX, y, barW * pct, barH, 8); ctx.fillStyle = theme.accent; ctx.fill(); }
    y += gap;
  }

  return canvas.toBuffer("image/png");
}
```

- [ ] **Step 3: `renderSlotGridCard` (Echoes + Constellations)**

Append:

```typescript
export interface GridCardSlot { label: string; sublabel: string; filled: boolean; iconPath?: string; }
export interface SlotGridCardInput {
  characterName: string;
  element:       string;
  subtitle:      string; // e.g. "Echoes" or "Resonance Chain — C2/6"
  slots:         GridCardSlot[];
}

export async function renderSlotGridCard(input: SlotGridCardInput): Promise<Buffer> {
  const theme = getElementTheme(input.element);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bgGradient[0]); grad.addColorStop(1, theme.bgGradient[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = theme.accent; ctx.font = font(34);
  ctx.fillText(`${input.characterName}`, 48, 66);
  ctx.fillStyle = "#CBD5E1"; ctx.font = font(19, "600");
  ctx.fillText(input.subtitle, 48, 96);

  const cols = Math.min(6, input.slots.length) || 1;
  const cellW = 140, cellH = 170, gapX = 24, gapY = 24;
  const totalW = cols * cellW + (cols - 1) * gapX;
  const startX = (W - totalW) / 2;
  const startY = 140;

  for (let i = 0; i < input.slots.length; i++) {
    const slot = input.slots[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (cellW + gapX), y = startY + row * (cellH + gapY);

    rrect(ctx, x, y, cellW, cellH, 12);
    ctx.fillStyle = slot.filled ? rgba(theme.accent, 0.15) : "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.strokeStyle = slot.filled ? theme.accent : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2; rrect(ctx, x, y, cellW, cellH, 12); ctx.stroke();

    if (slot.filled && slot.iconPath && fs.existsSync(slot.iconPath)) {
      const img = await loadImage(slot.iconPath);
      const iw = cellW - 24, ih = 90;
      ctx.drawImage(img as any, x + 12, y + 12, iw, ih);
    }

    ctx.fillStyle = slot.filled ? "#F1F5F9" : "#64748B";
    ctx.font = font(15, "700");
    ctx.textAlign = "center";
    ctx.fillText(slot.label, x + cellW / 2, y + cellH - 32, cellW - 12);
    ctx.fillStyle = slot.filled ? "#94A3B8" : "#475569";
    ctx.font = font(13, "600");
    ctx.fillText(slot.sublabel, x + cellW / 2, y + cellH - 12, cellW - 12);
    ctx.textAlign = "left";
  }

  return canvas.toBuffer("image/png");
}
```

- [ ] **Step 4: `renderLoreCard`**

Append:

```typescript
export interface LoreCardInput {
  characterName: string;
  element:       string;
  portraitPath:  string;
  fragments:     { text: string; unlocked: boolean }[];
}

export async function renderLoreCard(input: LoreCardInput): Promise<Buffer> {
  const theme = getElementTheme(input.element);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, theme.bgGradient[0]); grad.addColorStop(1, theme.bgGradient[1]);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  const pw = 320;
  if (fs.existsSync(input.portraitPath)) {
    const img = await loadImage(input.portraitPath);
    ctx.save();
    rrect(ctx, 0, 0, pw, H, 0); ctx.clip();
    const scale = Math.max(pw / img.width, H / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img as any, (pw - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    const fade = ctx.createLinearGradient(pw - 100, 0, pw, 0);
    fade.addColorStop(0, "rgba(15,15,26,0)"); fade.addColorStop(1, "rgba(15,15,26,1)");
    ctx.fillStyle = fade; ctx.fillRect(pw - 100, 0, 100, H);
  }

  const tx = pw + 40, tw = W - pw - 80;
  ctx.fillStyle = theme.accent; ctx.font = font(30);
  ctx.fillText(`${input.characterName} — Lore`, tx, 56);

  let y = 96;
  ctx.font = font(15, "500");
  for (const frag of input.fragments) {
    ctx.fillStyle = frag.unlocked ? "#E2E8F0" : "#3F3F52";
    const text = frag.unlocked ? frag.text : "▓▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓▓▓▓▓ ▓▓▓▓▓.";
    y = wrapText(ctx, text, tx, y, tw, 21) + 20;
  }

  return canvas.toBuffer("image/png");
}

// Word-wraps `text` inside width `maxW`, returns the Y position after the last line drawn.
function wrapText(ctx: SKRSContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word; y += lineH;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, y); y += lineH; }
  return y;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Visual spot-check**

Create a throwaway script `scripts/render-character-card-test.ts` (not committed — scratch verification only, per the writing-plans skill's testing convention already used for the pull-reveal art):

```typescript
import fs from "fs";
import { renderStatBarsCard, renderSlotGridCard, renderLoreCard } from "../src/lib/characterCard";

(async () => {
  const stats = await renderStatBarsCard({
    characterName: "Solace", element: "SPECTRO", subtitle: "Lv 42 · Phase 2",
    portraitPath: "assets/Characters/Solace.png",
    bars: [
      { label: "HP",  value: 3200, max: 6000, displayValue: "3200" },
      { label: "ATK", value: 140,  max: 200,  displayValue: "140" },
      { label: "DEF", value: 260,  max: 500,  displayValue: "260" },
    ],
  });
  fs.writeFileSync("scratch-stats.png", stats);

  const grid = await renderSlotGridCard({
    characterName: "Solace", element: "SPECTRO", subtitle: "Echoes",
    slots: [
      { label: "Main", sublabel: "Lv 25", filled: true },
      { label: "Sub 1", sublabel: "Empty", filled: false },
    ],
  });
  fs.writeFileSync("scratch-grid.png", grid);

  const lore = await renderLoreCard({
    characterName: "Solace", element: "SPECTRO",
    portraitPath: "assets/Characters/Solace.png",
    fragments: [
      { text: "Fragment one text.", unlocked: true },
      { text: "Fragment two text.", unlocked: false },
    ],
  });
  fs.writeFileSync("scratch-lore.png", lore);
})();
```

Run: `npx tsx scripts/render-character-card-test.ts`
Then use the Read tool on `scratch-stats.png`, `scratch-grid.png`, `scratch-lore.png` to visually confirm: text isn't clipped/overlapping, bars render at sane widths, the portrait fade looks right, locked lore fragments show as redacted blocks. Fix any layout issues found, re-run, re-check.

Delete the scratch files and script when satisfied: `rm scripts/render-character-card-test.ts scratch-stats.png scratch-grid.png scratch-lore.png`

- [ ] **Step 7: Commit**

```bash
git add src/lib/characterCard.ts
git commit -m "feat(solace): add characterCard.ts — element-themed canvas templates for the character profile"
```

---

### Task 5: Wire all 6 pages + leveling/ascension into `/character`

**Files:** Modify `src/commands/rpg/character.ts`, `src/lib/characterProgress.ts`

- [ ] **Step 1: Add a progress helper for level/ascension in `characterProgress.ts`**

Append to `src/lib/characterProgress.ts`:

```typescript
import {
  ASCENSION_LEVEL_CAP, MAX_ASCENSION_PHASE, solaceAscensionCost, solaceLevelUpCost,
} from "./solace";

export function currentLevelCap(ascensionPhase: number): number {
  return ASCENSION_LEVEL_CAP[Math.min(ascensionPhase, MAX_ASCENSION_PHASE)];
}
export { ASCENSION_LEVEL_CAP, MAX_ASCENSION_PHASE, solaceAscensionCost, solaceLevelUpCost };
```

(Re-exporting rather than having `character.ts` import from two files for one concept — `characterProgress.ts` is already the "progression" entry point the command imports from.)

- [ ] **Step 2: Replace the whole file with the 6-page version**

Rewrite `src/commands/rpg/character.ts`. Key structural changes from the current version: `CHARACTERS` map gains a `portraitPath`/`element`, view-builder functions each return `{ files, embed }` (image attachment) instead of a text-only embed, a `PAGES` array drives two nav button rows, and a new `charlvl2:` (Level Up/Ascend) button family is added alongside the existing `charlvl:` (kit-track) family.

```typescript
// src/commands/rpg/character.ts
// Full 6-page canvas character profile (Stats/Weapon/Echoes/Kit Levels/
// Constellations/Lore) — see docs/superpowers/specs/2026-07-17-solace-character-card-design.md.

import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { auditSpend } from "../../lib/antiCheat";
import { CE } from "../../lib/emojiManager";
import {
  MAX_KIT_LEVEL, KitTrack, TRACK_FIELD, getTrackLevel, kitLevelUpCost,
  getOrCreateCharacterProgress, currentLevelCap, MAX_ASCENSION_PHASE,
  solaceAscensionCost, solaceLevelUpCost,
} from "../../lib/characterProgress";
import { resolveSolaceStats, unlockedLoreFragments, solaceStatsAtLevel } from "../../lib/solace";
import { renderStatBarsCard, renderSlotGridCard, renderLoreCard } from "../../lib/characterCard";
import { generateWeaponCard } from "../../lib/weaponCard";
import { WEAPON_TYPE_LABEL, FORGED_WEAPONS } from "../../lib/weapons";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";

const CHARACTERS: Record<string, { label: string; emoji: string; element: string; portraitPath: string }> = {
  solace: { label: "Solace", emoji: "✨", element: "SPECTRO", portraitPath: "assets/Characters/Solace.png" },
};

type Page = "stats" | "weapon" | "echoes" | "kit" | "con" | "lore";
const PAGE_LABEL: Record<Page, string> = {
  stats: "📊  Stats", weapon: "⚔️  Weapon", echoes: "◈  Echoes",
  kit: "⚔️  Kit Levels", con: "📜  Constellations", lore: "📖  Lore",
};

const TRACK_LABELS: Record<KitTrack, string> = {
  basic: "⚔️  Chime Strike", skill: "✦  Attunement", ultimate: "⚡  Convergence",
  intro: "🔷  Intro Skill", forte: "🌟  Forte",
};
const VALID_TRACKS = new Set<string>(Object.keys(TRACK_LABELS));
function isKitTrack(value: string): value is KitTrack { return VALID_TRACKS.has(value); }

const CONSTELLATION_EFFECTS: Record<string, string[]> = {
  solace: [
    "Outro's guaranteed-crit buff also grants the incoming ally +15% ATK for their first action after the swap.",
    "**(Kit change)** Ultimate's heal significantly increased; cleanses 2 debuffs instead of 1.",
    "Switching Attunement Mode (Skill) also grants a team-wide Concerto Energy burst.",
    "**(Kit change)** Intro Skill's heal also grants a shield equal to 30% of the amount healed.",
    "Ultimate's doubled-mode-effect duration extends from 3 turns to 4.",
    "**(Defining)** While one Attunement Mode is active, allies ALSO gain 50% of the other two modes' effects.",
  ],
};
const MAX_CONSTELLATION = 6;

function navRows(characterId: string, active: Page): ActionRowBuilder<ButtonBuilder>[] {
  const pages: Page[] = ["stats", "weapon", "echoes"];
  const pages2: Page[] = ["kit", "con", "lore"];
  const row = (list: Page[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    list.map(p => new ButtonBuilder()
      .setCustomId(`charnav:${characterId}:${p}`)
      .setLabel(PAGE_LABEL[p])
      .setStyle(active === p ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(active === p)),
  );
  return [row(pages), row(pages2)];
}

async function buildStatsView(userId: string, characterId: string) {
  const char = CHARACTERS[characterId];
  const [progress, stats] = await Promise.all([
    getOrCreateCharacterProgress(userId, characterId),
    resolveSolaceStats(userId),
  ]);
  const cap = currentLevelCap(progress.ascensionPhase);
  const buf = await renderStatBarsCard({
    characterName: char.label, element: char.element,
    subtitle: `Lv ${progress.level}/${cap} · Phase ${progress.ascensionPhase}/${MAX_ASCENSION_PHASE}`,
    portraitPath: char.portraitPath,
    bars: [
      { label: "HP", value: stats.hp, max: stats.hp, displayValue: `${Math.round(stats.hp)}` },
      { label: "ATK", value: stats.atk, max: stats.atk * 2, displayValue: `${Math.round(stats.atk)}` },
      { label: "DEF", value: stats.def, max: stats.def * 2, displayValue: `${Math.round(stats.def)}` },
      { label: "SPD", value: stats.spd, max: stats.spd * 2, displayValue: `${Math.round(stats.spd)}` },
      { label: "Crit Rate", value: stats.critRate, max: 1, displayValue: `${Math.round(stats.critRate * 100)}%` },
      { label: "Crit DMG", value: stats.critDmg, max: 3, displayValue: `${Math.round(stats.critDmg * 100)}%` },
    ],
  });

  const atCap = progress.level >= cap;
  const isMaxPhase = progress.ascensionPhase >= MAX_ASCENSION_PHASE;
  let actionLabel: string, actionDisabled: boolean;
  if (isMaxPhase && atCap) {
    actionLabel = "MAX LEVEL"; actionDisabled = true;
  } else if (atCap) {
    actionLabel = `Ascend (Phase ${progress.ascensionPhase + 1})`; actionDisabled = false;
  } else {
    const cost = solaceLevelUpCost(progress.level);
    actionLabel = `Level Up (${cost.resonanceRecords} Records · ${cost.credits} Credits)`;
    actionDisabled = false;
  }
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`charlvl2:${characterId}`).setLabel(actionLabel)
      .setStyle(atCap && !isMaxPhase ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(actionDisabled),
  );

  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://stats.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Stats" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "stats.png" })], actionRow };
}

async function buildWeaponView(userId: string, characterId: string) {
  const char = CHARACTERS[characterId];
  const weapon = await prisma.weapon.findFirst({
    where: { userId, characterId, isEquipped: true },
    select: {
      name: true, weaponType: true, rarity: true, level: true, baseAtk: true,
      subStatType: true, subStatVal: true,
      hiddenSub1Type: true, hiddenSub1Val: true, hiddenSub2Type: true, hiddenSub2Val: true,
      awakened: true, awakenedName: true, awakenedPassive: true, weaponBond: true,
    },
  });

  if (!weapon) {
    const embed = new EmbedBuilder().setColor(0x334155)
      .setDescription(`◈ **${char.label}** has no weapon equipped.\nUse **/equip** with a weapon targeting her loadout.`)
      .setFooter({ text: "CARTETHYIA  ·  Character  ·  Weapon" });
    return { embed, files: [] as AttachmentBuilder[] };
  }

  const weaponDef = FORGED_WEAPONS.find(w => w.name === weapon.name);
  const wishDef = ALL_WISH_WEAPONS.find(w => w.name === weapon.name);
  const maxMult: Record<number, number> = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 };
  const effectiveAtk = Math.round(weapon.baseAtk * (1 + (weapon.level - 1) * ((maxMult[weapon.rarity] ?? 2.5) - 1) / 89));
  const effectiveSub = weapon.subStatVal != null ? Math.round((weapon.subStatVal * (1 + (weapon.level - 1) * 0.8 / 89)) * 10) / 10 : null;
  const h1Val = weapon.level >= 20 && weapon.hiddenSub1Val != null ? calcWishSubStat(weapon.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, weapon.level) : null;
  const h2Val = weapon.level >= 50 && weapon.hiddenSub2Val != null ? calcWishSubStat(weapon.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, weapon.level) : null;

  const buf = await generateWeaponCard({
    name: weapon.name, weaponType: weapon.weaponType, rarity: weapon.rarity, level: weapon.level,
    baseAtk: weapon.baseAtk, effectiveAtk,
    subStatType: weapon.subStatType ?? null, subStatVal: weapon.subStatVal ?? null, effectiveSub,
    passive: weaponDef?.passive ?? WEAPON_TYPE_LABEL[weapon.weaponType as keyof typeof WEAPON_TYPE_LABEL] ?? "",
    element: char.element, ownerName: char.label, ownerAvatar: char.portraitPath,
    hiddenSub1Type: weapon.hiddenSub1Type ?? null, hiddenSub1Val: h1Val,
    hiddenSub2Type: weapon.hiddenSub2Type ?? null, hiddenSub2Val: h2Val,
    awakened: weapon.awakened, awakenedName: weapon.awakenedName, weaponBond: weapon.weaponBond,
  });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://weapon.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Weapon" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "weapon.png" })] };
}

async function buildEchoesView(userId: string, characterId: string) {
  const char = CHARACTERS[characterId];
  const echoes = await prisma.echo.findMany({
    where: { userId, characterId, equippedSlot: { not: null } },
    orderBy: { equippedSlot: "asc" },
  });
  const slots = Array.from({ length: 5 }, (_, slot) => {
    const eq = echoes.find(e => e.equippedSlot === slot);
    return eq
      ? { label: eq.name, sublabel: `Lv ${eq.level}`, filled: true }
      : { label: slot === 0 ? "Main" : `Sub ${slot}`, sublabel: "Empty", filled: false };
  });
  const buf = await renderSlotGridCard({ characterName: char.label, element: char.element, subtitle: "Echoes", slots });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://echoes.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Echoes" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "echoes.png" })] };
}

async function buildKitLevelsView(userId: string, characterId: string) {
  const [progress, dbUser] = await Promise.all([
    getOrCreateCharacterProgress(userId, characterId),
    prisma.user.findUnique({ where: { id: userId }, select: { forgingOres: true } }),
  ]);
  const ores = dbUser?.forgingOres ?? 0;
  const char = CHARACTERS[characterId];
  const tracks: KitTrack[] = ["basic", "skill", "ultimate", "intro", "forte"];
  const buf = await renderStatBarsCard({
    characterName: char.label, element: char.element, subtitle: `Kit Levels · ${ores}${CE.fo} Forging Ores`,
    bars: tracks.map(t => {
      const lvl = getTrackLevel(progress, t);
      return { label: TRACK_LABELS[t].replace(/^\S+\s+/, ""), value: lvl, max: MAX_KIT_LEVEL, displayValue: `Lv ${lvl}/${MAX_KIT_LEVEL}` };
    }),
  });

  const trackButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    tracks.map(t => {
      const lvl = getTrackLevel(progress, t);
      const maxed = lvl >= MAX_KIT_LEVEL;
      const cost = maxed ? 0 : kitLevelUpCost(lvl);
      return new ButtonBuilder().setCustomId(`charlvl:${characterId}:${t}`)
        .setLabel(maxed ? `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (MAX)` : `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (${cost}⛭)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(maxed || ores < cost);
    }),
  );
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://kit.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Kit Levels" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "kit.png" })], trackButtons };
}

async function buildConstellationsView(userId: string, characterId: string) {
  const progress = await getOrCreateCharacterProgress(userId, characterId);
  const char = CHARACTERS[characterId];
  const tiers = CONSTELLATION_EFFECTS[characterId] ?? [];
  const slots = tiers.map((_, i) => {
    const tier = i + 1;
    const unlocked = progress.constellation >= tier;
    return { label: `C${tier}`, sublabel: unlocked ? "Unlocked" : "Locked", filled: unlocked };
  });
  const buf = await renderSlotGridCard({
    characterName: char.label, element: char.element,
    subtitle: `Resonance Chain — C${progress.constellation}/${MAX_CONSTELLATION} · ${progress.constellationTokens} Tokens`,
    slots,
  });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://con.png")
    .setDescription(tiers.map((e, i) => `${progress.constellation >= i + 1 ? "✦" : "◇"} **C${i + 1}** — ${e}`).join("\n\n"))
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Constellations" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "con.png" })] };
}

async function buildLoreView(userId: string, characterId: string) {
  const progress = await getOrCreateCharacterProgress(userId, characterId);
  const char = CHARACTERS[characterId];
  const buf = await renderLoreCard({
    characterName: char.label, element: char.element, portraitPath: char.portraitPath,
    fragments: unlockedLoreFragments(progress.ascensionPhase),
  });
  const embed = new EmbedBuilder().setColor(0x6366F1).setImage("attachment://lore.png")
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Lore" });
  return { embed, files: [new AttachmentBuilder(buf, { name: "lore.png" })] };
}

async function buildView(userId: string, characterId: string, page: Page) {
  switch (page) {
    case "stats":  return buildStatsView(userId, characterId);
    case "weapon": return buildWeaponView(userId, characterId);
    case "echoes": return buildEchoesView(userId, characterId);
    case "kit":    return buildKitLevelsView(userId, characterId);
    case "con":    return buildConstellationsView(userId, characterId);
    case "lore":   return buildLoreView(userId, characterId);
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("character")
    .setDescription("View and level up your characters.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });
    const dbUser = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { id: true } });
    if (!dbUser) { await replyNotStarted(interaction); return; }

    const select = new StringSelectMenuBuilder().setCustomId("character_cmd_select")
      .setPlaceholder("Choose a character…")
      .addOptions(Object.entries(CHARACTERS).map(([value, c]) => ({ label: `${c.emoji}  ${c.label}`, value })));
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const overview = new EmbedBuilder().setColor(0x6366F1).setTitle("◈  Characters")
      .setDescription("Select a character to view their profile.")
      .setFooter({ text: "CARTETHYIA  ·  Character" });
    await interaction.editReply({ embeds: [overview], components: [selectRow] });

    const collector = interaction.channel?.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id &&
        (i.customId === "character_cmd_select" || i.customId.startsWith("charlvl:") ||
         i.customId.startsWith("charlvl2:") || i.customId.startsWith("charnav:")),
      time: 5 * 60 * 1000,
    });

    const renderAndReply = async (i: StringSelectMenuInteraction | ButtonInteraction, characterId: string, page: Page) => {
      const view = await buildView(interaction.user.id, characterId, page);
      const extraRow = (view as any).trackButtons ?? (view as any).actionRow;
      const components = [selectRow, ...navRows(characterId, page), ...(extraRow ? [extraRow] : [])];
      await i.update({ embeds: [view.embed], files: view.files, components }).catch(() => {});
    };

    collector?.on("collect", async i => {
      if (i.customId === "character_cmd_select" && i.isStringSelectMenu()) {
        const characterId = i.values[0];
        if (!CHARACTERS[characterId]) { await i.deferUpdate().catch(() => {}); return; }
        await renderAndReply(i, characterId, "stats");
        return;
      }

      if (i.customId.startsWith("charnav:") && i.isButton()) {
        const [, characterId, page] = i.customId.split(":");
        if (!CHARACTERS[characterId] || !(page in PAGE_LABEL)) { await i.deferUpdate().catch(() => {}); return; }
        await renderAndReply(i, characterId, page as Page);
        return;
      }

      if (i.customId.startsWith("charlvl2:") && i.isButton()) {
        const [, characterId] = i.customId.split(":");
        if (!CHARACTERS[characterId]) { await i.deferUpdate().catch(() => {}); return; }

        const progress = await getOrCreateCharacterProgress(interaction.user.id, characterId);
        const cap = currentLevelCap(progress.ascensionPhase);

        try {
          if (progress.level >= cap) {
            if (progress.ascensionPhase >= MAX_ASCENSION_PHASE) { await i.deferUpdate().catch(() => {}); return; }
            const cost = solaceAscensionCost(progress.ascensionPhase);
            const dbUser2 = await prisma.user.findUnique({
              where: { id: interaction.user.id },
              select: { credits: true, forgingOres: true, paradoxCores: true, starfallShards: true },
            });
            if (!dbUser2 || dbUser2.credits < cost.credits || dbUser2.forgingOres < cost.forgingOres ||
                dbUser2.paradoxCores < cost.paradoxCores || dbUser2.starfallShards < cost.starfallShards) {
              await i.deferUpdate().catch(() => {}); return;
            }
            await prisma.$transaction(async (tx) => {
              const spend = await tx.user.updateMany({
                where: { id: interaction.user.id, credits: { gte: cost.credits }, forgingOres: { gte: cost.forgingOres },
                          paradoxCores: { gte: cost.paradoxCores }, starfallShards: { gte: cost.starfallShards } },
                data: { credits: { decrement: cost.credits }, forgingOres: { decrement: cost.forgingOres },
                         paradoxCores: { decrement: cost.paradoxCores }, starfallShards: { decrement: cost.starfallShards } },
              });
              if (spend.count === 0) throw new Error("insufficient-funds-race");
              const ascend = await tx.characterProgress.updateMany({
                where: { userId: interaction.user.id, characterId, ascensionPhase: progress.ascensionPhase },
                data: { ascensionPhase: { increment: 1 } },
              });
              if (ascend.count === 0) throw new Error("already-ascended-race");
            });
            auditSpend(interaction.user.id, { credits: cost.credits, forgingOres: cost.forgingOres, paradoxCores: cost.paradoxCores }, "character-ascend");
          } else {
            const cost = solaceLevelUpCost(progress.level);
            const dbUser2 = await prisma.user.findUnique({
              where: { id: interaction.user.id }, select: { resonanceRecords: true, credits: true },
            });
            if (!dbUser2 || dbUser2.resonanceRecords < cost.resonanceRecords || dbUser2.credits < cost.credits) {
              await i.deferUpdate().catch(() => {}); return;
            }
            await prisma.$transaction(async (tx) => {
              const spend = await tx.user.updateMany({
                where: { id: interaction.user.id, resonanceRecords: { gte: cost.resonanceRecords }, credits: { gte: cost.credits } },
                data: { resonanceRecords: { decrement: cost.resonanceRecords }, credits: { decrement: cost.credits } },
              });
              if (spend.count === 0) throw new Error("insufficient-funds-race");
              const levelUp = await tx.characterProgress.updateMany({
                where: { userId: interaction.user.id, characterId, level: progress.level },
                data: { level: { increment: 1 } },
              });
              if (levelUp.count === 0) throw new Error("already-leveled-race");
            });
            auditSpend(interaction.user.id, { resonanceRecords: cost.resonanceRecords, credits: cost.credits }, "character-level-up");
          }
          await renderAndReply(i, characterId, "stats");
        } catch (err) {
          console.error("[character] level/ascend transaction failed", err);
          await i.deferUpdate().catch(() => {});
        }
        return;
      }

      if (i.customId.startsWith("charlvl:") && i.isButton()) {
        const [, characterId, trackRaw] = i.customId.split(":");
        if (!CHARACTERS[characterId] || !isKitTrack(trackRaw)) { await i.deferUpdate().catch(() => {}); return; }
        const track = trackRaw;

        const [progress, dbUser2] = await Promise.all([
          getOrCreateCharacterProgress(interaction.user.id, characterId),
          prisma.user.findUnique({ where: { id: interaction.user.id }, select: { forgingOres: true } }),
        ]);
        const lvl = getTrackLevel(progress, track);
        const ores = dbUser2?.forgingOres ?? 0;
        const cost = kitLevelUpCost(lvl);
        if (lvl >= MAX_KIT_LEVEL || ores < cost) { await i.deferUpdate().catch(() => {}); return; }

        try {
          await prisma.$transaction(async (tx) => {
            const spend = await tx.user.updateMany({
              where: { id: interaction.user.id, forgingOres: { gte: cost } },
              data: { forgingOres: { decrement: cost } },
            });
            if (spend.count === 0) throw new Error("insufficient-funds-race");
            const levelUp = await tx.characterProgress.updateMany({
              where: { userId: interaction.user.id, characterId, [TRACK_FIELD[track]]: { lt: MAX_KIT_LEVEL } },
              data: { [TRACK_FIELD[track]]: { increment: 1 } },
            });
            if (levelUp.count === 0) throw new Error("already-maxed-race");
          });
          auditSpend(interaction.user.id, { forgingOres: cost }, "character-kit-level");
          await renderAndReply(i, characterId, "kit");
        } catch (err) {
          console.error("[character] kit-level-up transaction failed", err);
          await i.deferUpdate().catch(() => {});
        }
      }
    });

    collector?.on("end", async () => { await interaction.editReply({ components: [] }).catch(() => {}); });
  },
};

export default command;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Fix any type errors (likely candidates: `Weapon`/`Echo` model field names — confirm `characterId`/`equippedSlot` exist on both models via `prisma/schema.prisma` before assuming the exact names above; adjust the two Prisma queries in `buildWeaponView`/`buildEchoesView` if the actual field names differ).

- [ ] **Step 4: Manual playtest (dev guild)**

- `/character` → select Solace → confirm Stats page renders an image, not a blank/broken attachment.
- Click through all 6 nav buttons (Stats/Weapon/Echoes/Kit Levels/Constellations/Lore) — confirm each renders without throwing, and the previously-live Kit Levels/Constellations spend buttons still work exactly as before.
- On Stats page: confirm "Level Up" is shown (not "Ascend") for a fresh Lv1 Solace, clicking it with insufficient Resonance Records/Credits does nothing (button re-renders unchanged), and with sufficient funds it increments level and updates the displayed stats.
- Grind (or manually seed via a one-off script) a Solace to a phase's level cap — confirm the button switches to "Ascend", and ascending correctly spends Forging Ores/Paradox Cores/Credits (+Starfall Shards from Phase 2 onward) and raises the cap.
- Confirm the Lore page shows Fragment 1 readable at Phase 0, and each subsequent fragment unlocks exactly at its matching ascension phase (redacted block below Phase 6).

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/character.ts src/lib/characterProgress.ts
git commit -m "feat(solace): wire all 6 canvas pages + level/ascension into /character"
```

---

### Task 6: Final verification

- [ ] `npx tsc --noEmit` and `npm run build` clean.
- [ ] Confirm `resolveSolaceStats()` callers across all 6 combat surfaces (ascend/boss/dungeon/duel/raid/field-boss/encounter) still typecheck — the function signature is unchanged, only its internals now read `level`, so no call sites should need edits. Grep for `resolveSolaceStats(` to confirm no call site was missed.
- [ ] Confirm a Lv1 Solace's `resolveSolaceStats()` ATK/Crit stay closer to her Lv90 ceiling than her HP/DEF do (spot-check via the scratch script from Task 4, or a one-off `npx tsx` script calling `solaceStatsAtLevel(1)` vs `solaceStatsAtLevel(90)` and comparing ratios) — confirms the support-class growth bias actually landed in the numbers, not just the doc.
- [ ] Confirm Stasis Locks are never referenced in `solaceAscensionCost` or the Task 5 ascend-spend transaction (grep `stasisLocks` in the diff — should show zero matches in the new leveling code).
- [ ] Report findings back. **Do not push to origin or deploy to the VM** — per the standing instruction, nothing ships until Solace + the banner + this card project are completely done.
