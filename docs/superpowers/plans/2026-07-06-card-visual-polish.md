# Card & Embed Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three concrete rendering defects (blurry echo thumbnails, letterboxed landscape weapon art, text-on-art readability on echo cards), document an asset spec so future art doesn't reintroduce them, and give the shop's purchase moment the same canvas-card treatment already used by daily/dispatch/vibe.

**Architecture:** All fixes are runtime rendering changes in existing `@napi-rs/canvas` card generators (no new visual system, no DB/schema changes). A new small shared util (`canvasUtil.ts`) holds a step-down image downscale helper used by the grid card. The shop purchase flow gains a thumbnail (existing icon assets) and reuses the existing `generateLootCard` function instead of a plain text embed.

**Tech Stack:** TypeScript, `@napi-rs/canvas`, discord.js v14, existing `src/lib/*Card.ts` modules.

---

This project has no automated test suite (Discord bot with canvas image output — confirmed via `package.json`, no test runner configured). Verification for each visual task is: run a small one-off `tsx` script that calls the generator with representative sample data, save the resulting image to the scratchpad, and view it with the Read tool to visually confirm the fix. This replaces the usual "write failing test" step throughout this plan.

### Task 1: Shared sharp-downscale helper

**Files:**
- Create: `src/lib/canvasUtil.ts`
- Test script (throwaway): `C:\Users\Lokesh\AppData\Local\Temp\claude\D--Projects-Bot\32c3f3ca-ecfe-453c-89d7-f449462d90d8\scratchpad\test-sharp-downscale.ts`

- [ ] **Step 1: Write `drawImageSharp`**

Create `src/lib/canvasUtil.ts`:

```typescript
import { createCanvas, Image, SKRSContext2D } from "@napi-rs/canvas";

/**
 * Draws `img` into (dx, dy, dw, dh) using step-down halving instead of a single
 * drawImage call. @napi-rs/canvas has no mipmapping, so a single-pass downscale
 * of a large source (e.g. 1500px art -> 150px thumbnail) looks soft/blurry.
 * Halving repeatedly until within 2x of the target keeps each pass sharp.
 */
export function drawImageSharp(
  ctx: SKRSContext2D,
  img: Image,
  dx: number, dy: number, dw: number, dh: number,
): void {
  const srcW = img.width, srcH = img.height;

  // Small enough already (upscale or mild downscale) — one pass is fine.
  if (srcW <= dw * 2 && srcH <= dh * 2) {
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }

  let curCanvas = createCanvas(srcW, srcH);
  let curCtx = curCanvas.getContext("2d");
  curCtx.drawImage(img, 0, 0, srcW, srcH);
  let curW = srcW, curH = srcH;

  while (curW > dw * 2 && curH > dh * 2) {
    const nextW = Math.max(dw, Math.floor(curW / 2));
    const nextH = Math.max(dh, Math.floor(curH / 2));
    const nextCanvas = createCanvas(nextW, nextH);
    const nextCtx = nextCanvas.getContext("2d");
    nextCtx.drawImage(curCanvas, 0, 0, curW, curH, 0, 0, nextW, nextH);
    curCanvas = nextCanvas;
    curCtx = nextCtx;
    curW = nextW;
    curH = nextH;
  }

  ctx.drawImage(curCanvas, 0, 0, curW, curH, dx, dy, dw, dh);
}
```

- [ ] **Step 2: Verify it compiles and runs**

Run: `npx tsc --noEmit -p . 2>&1 | grep canvasUtil || echo "no errors in canvasUtil.ts"`
Expected: `no errors in canvasUtil.ts`

- [ ] **Step 3: Visual smoke test**

Create `C:\Users\Lokesh\AppData\Local\Temp\claude\D--Projects-Bot\32c3f3ca-ecfe-453c-89d7-f449462d90d8\scratchpad\test-sharp-downscale.ts`:

```typescript
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { drawImageSharp } from "../../../../../../../../Projects/Bot/src/lib/canvasUtil";
import fs from "fs";
import path from "path";

async function main() {
  // Pick any large existing boss art as the stress-test source.
  const bossDir = path.join("D:/Projects/Bot", "Bosses");
  const files = fs.readdirSync(bossDir).filter(f => f.endsWith(".png"));
  const src = path.join(bossDir, files[0]);
  const img = await loadImage(src);

  const canvas = createCanvas(300, 150);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111"; ctx.fillRect(0, 0, 300, 150);

  ctx.drawImage(img, 0, 0, 150, 150);              // left: naive single-pass
  drawImageSharp(ctx, img, 150, 0, 150, 150);       // right: step-down

  fs.writeFileSync(path.join(__dirname, "sharp-compare.png"), canvas.toBuffer("image/png"));
  console.log("wrote", path.join(__dirname, "sharp-compare.png"), "source:", src);
}
main();
```

Run: `cd "D:/Projects/Bot" && npx tsx "C:\Users\Lokesh\AppData\Local\Temp\claude\D--Projects-Bot\32c3f3ca-ecfe-453c-89d7-f449462d90d8\scratchpad\test-sharp-downscale.ts"`
Expected: prints the output path with no errors. Then use the Read tool on the printed `sharp-compare.png` path — the right half (step-down) should look visibly crisper than the left half (naive).

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvasUtil.ts
git commit -m "feat(canvas): add step-down image downscale helper for sharp thumbnails"
```

---

### Task 2: Use sharp downscale in the grid card's equipped-echo slots

**Files:**
- Modify: `src/lib/gridCard.ts:1-10` (imports), `src/lib/gridCard.ts:94-107` (`drawSlot`)

- [ ] **Step 1: Add the import**

In `src/lib/gridCard.ts`, add near the top (after the existing imports):

```typescript
import { drawImageSharp } from "./canvasUtil";
```

- [ ] **Step 2: Replace the naive drawImage call in `drawSlot`**

Find this block (current lines ~100-106):

```typescript
    const ap = echoArtPath(slot.name, slot.cost);
    if (ap) {
      try {
        const img = await loadImage(ap);
        const sc = Math.max(size / img.width, size / img.height);
        const sw = img.width * sc, sh = img.height * sc;
        ctx.drawImage(img, x + (size - sw) / 2, y + (size - sh) / 2, sw, sh);
      } catch { /* skip */ }
    }
```

Replace with:

```typescript
    const ap = echoArtPath(slot.name, slot.cost);
    if (ap) {
      try {
        const img = await loadImage(ap);
        const sc = Math.max(size / img.width, size / img.height);
        const sw = img.width * sc, sh = img.height * sc;
        drawImageSharp(ctx, img, x + (size - sw) / 2, y + (size - sh) / 2, sw, sh);
      } catch { /* skip */ }
    }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p . 2>&1 | grep gridCard || echo "no errors in gridCard.ts"`
Expected: `no errors in gridCard.ts`

- [ ] **Step 4: Visual check**

`src/lib/gridCard.ts` exports `generateGridCard(d: GridCardData): Promise<Buffer>` and the `GridSlot`/`GridCardData` interfaces (see lines 71-149). Write a throwaway scratchpad script that calls it with a sample `GridCardData` whose main slot (slot 0) is a 4-cost boss echo (e.g. `name: "Resonant Wraith", element: "HAVOC", rarity: "FIVE_STAR", cost: 4, level: 25` — largest source art, worst case for blur) and 1-4 sub-slots filled with smaller 1/3-cost echoes, `gridPoints: 10`, `bonusLabels: []`. Save the buffer to `scratchpad/grid-check.webp` and view it with Read. Confirm the equipped-echo art looks sharp, not soft/mushy, especially at the smaller sub-slot size.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gridCard.ts
git commit -m "fix(gridCard): use step-down downscale for equipped-echo thumbnails"
```

---

### Task 3: Weapon card aspect-aware art fit

**Files:**
- Modify: `src/lib/weaponCard.ts:100-121`

- [ ] **Step 1: Replace the art-panel drawing block**

Find this block (current lines ~100-121):

```typescript
  // ── Art panel ───────────────────────────────────────────────────────────────
  const AX=16, AY=16, AW=262, AH=H-32;
  ctx.save();
  rrect(ctx,AX,AY,AW,AH,14); ctx.clip();

  ctx.fillStyle = rgba(ec,0.07); ctx.fillRect(AX,AY,AW,AH);

  const imgPath = getWeaponImagePath(input.weaponType, input.name, {
    isUnique: input.isUnique, userId: input.userId,
    awakenedName: input.awakened ? input.awakenedName : null,
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
```

Replace with:

```typescript
  // ── Art panel ───────────────────────────────────────────────────────────────
  const AX=16, AY=16, AW=262, AH=H-32;
  ctx.save();
  rrect(ctx,AX,AY,AW,AH,14); ctx.clip();

  ctx.fillStyle = rgba(ec,0.07); ctx.fillRect(AX,AY,AW,AH);

  const imgPath = getWeaponImagePath(input.weaponType, input.name, {
    isUnique: input.isUnique, userId: input.userId,
    awakenedName: input.awakened ? input.awakenedName : null,
  });
  if (imgPath) {
    try {
      const img  = await loadImage(imgPath);
      const ratio = img.width / img.height;

      if (ratio <= 1.15) {
        // Portrait / near-square icon art — contain-fit, unchanged behavior.
        const pad  = 12;
        const scale = Math.min((AW - pad*2) / img.width, (AH - pad*2) / img.height);
        const sw = img.width * scale, sh = img.height * scale;
        ctx.drawImage(img, AX + (AW-sw)/2, AY + (AH-sh)/2, sw, sh);
      } else {
        // Landscape scene art — cover-fit (fills the panel, crops overflow)
        // instead of letterboxing with dead black bars.
        const scale = Math.max(AW / img.width, AH / img.height);
        const sw = img.width * scale, sh = img.height * scale;
        ctx.drawImage(img, AX + (AW-sw)/2, AY + (AH-sh)/2, sw, sh);

        // Soft edge vignette so the crop blends into the panel bg instead of
        // cutting the scene off hard at the frame edge.
        const edgeFade = 28;
        const top = ctx.createLinearGradient(0, AY, 0, AY + edgeFade);
        top.addColorStop(0, "rgba(0,0,0,0.55)"); top.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = top; ctx.fillRect(AX, AY, AW, edgeFade);

        const bottom = ctx.createLinearGradient(0, AY + AH - edgeFade, 0, AY + AH);
        bottom.addColorStop(0, "rgba(0,0,0,0)"); bottom.addColorStop(1, "rgba(0,0,0,0.55)");
        ctx.fillStyle = bottom; ctx.fillRect(AX, AY + AH - edgeFade, AW, edgeFade);
      }
    } catch { /* fallback */ }
  }

  ctx.restore();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p . 2>&1 | grep weaponCard || echo "no errors in weaponCard.ts"`
Expected: `no errors in weaponCard.ts`

- [ ] **Step 3: Visual check against the exact art that showed the bug**

Write a throwaway scratchpad script that calls `generateWeaponCard` with `awakened: true, awakenedName: "Symphony of the Unbound"` (matching the awakened pistols art already on disk at `assets/weapons/awakened/Symphony of the Unbound.png` per the reported screenshot) plus the other required `WeaponCardInput` fields (use plausible placeholder numbers — rarity 5, level 90, baseAtk/effectiveAtk from the screenshot: 123/615, subStatType with effectiveSub 22.9, hiddenSub1/2 matching crit rate/dmg from the screenshot). Save to `scratchpad/weapon-check.webp` and view with Read. Confirm the space scene now fills the panel edge-to-edge with no black letterbox bars, and the top/bottom vignette blends cleanly.

Also generate one card for an existing portrait-art weapon (any non-awakened 3-5★ weapon with art in `assets/weapons/<Type>/`) to confirm the `ratio <= 1.15` branch still renders identically to before (no regression).

- [ ] **Step 4: Commit**

```bash
git add src/lib/weaponCard.ts
git commit -m "fix(weaponCard): cover-fit landscape art instead of letterboxing"
```

---

### Task 4: Echo card fade strengthening

**Files:**
- Modify: `src/lib/echoCard.ts:144-147`

- [ ] **Step 1: Replace the fade gradient**

Find this block (current lines ~144-147):

```typescript
  // bottom fade into panel
  const fade = ctx.createLinearGradient(0, artY + artH - 80, 0, artY + artH);
  fade.addColorStop(0, "rgba(11,12,20,0)"); fade.addColorStop(1, "rgba(11,12,20,0.95)");
  ctx.fillStyle = fade; ctx.fillRect(artX, artY + artH - 80, artW, 80);
```

Replace with:

```typescript
  // bottom fade into panel — covers ~40% of the art height and ramps to
  // fully opaque well before the bottom edge, so name/element text always
  // sits on a solid dark backdrop regardless of how bright/busy the art is.
  const fadeH = artH * 0.4;
  const fade = ctx.createLinearGradient(0, artY + artH - fadeH, 0, artY + artH);
  fade.addColorStop(0, "rgba(11,12,20,0)");
  fade.addColorStop(0.5, "rgba(11,12,20,0.75)");
  fade.addColorStop(1, "rgba(11,12,20,0.98)");
  ctx.fillStyle = fade; ctx.fillRect(artX, artY + artH - fadeH, artW, fadeH);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p . 2>&1 | grep echoCard || echo "no errors in echoCard.ts"`
Expected: `no errors in echoCard.ts`

- [ ] **Step 3: Visual check against the reported echo**

Write a throwaway scratchpad script calling `generateEchoCard` with data matching the reported "Thunder Drake" echo (name: "Thunder Drake", element: "ELECTRO", rarity: "FIVE_STAR", cost: 3, level: 0, mainStatType matching "Aero DMG Bonus" per the screenshot, mainStatValue: 8.0, revealedSubstats: 0, substats: []). Save to `scratchpad/echo-check.webp` and view with Read. Confirm "Thunder Drake" and the element row now read clearly against a dark backdrop, not overlapping the dragon artwork's bright detail.

Also render one echo with dark/calm existing art to confirm no regression (fade shouldn't look like a heavy black band on art that was already fine).

- [ ] **Step 4: Commit**

```bash
git add src/lib/echoCard.ts
git commit -m "fix(echoCard): deepen bottom fade so name/element text stays readable on bright art"
```

---

### Task 5: Asset spec doc

**Files:**
- Create: `docs/asset-spec.md`

- [ ] **Step 1: Write the spec doc**

Create `docs/asset-spec.md`:

```markdown
# Art Asset Spec — Cards

Guidance for any new echo/weapon/background art (hand-made or AI-generated) so it
renders cleanly in the existing card generators without code changes.

## Echo art (`assets/echoes/{1,3}-cost/*.png`, `Bosses/*.png` for 4-cost)

- **Aspect ratio:** portrait, 2:3 to 3:4 (matches the echo card's art panel, which
  is wider-than-tall-safe but expects a standing/centered subject).
- **Resolution:** at least 900px on the short edge. Larger is fine — the renderer
  now step-downscales sharply (see `src/lib/canvasUtil.ts`), so oversized source
  art is not a problem.
- **Safe zone:** keep the subject within the center ~80% of the frame. The bottom
  ~40% of the panel gets a dark fade overlay for text — avoid putting essential
  detail (face, key silhouette) in the very bottom 15%, since it will be dimmed.
- **Background:** transparent or a dark/simple background preferred, but not
  required — the bottom fade now compensates for busy/bright art.

## Weapon art (`assets/weapons/{Type}/*.png`, `assets/weapons/awakened/*.png`, `assets/weapons/unique/*.png`)

- **Preferred:** portrait or near-square (width/height ratio ≤ 1.15) icon-style
  art of the weapon itself, transparent or simple background — this gets a
  `contain`-fit, unchanged from before.
- **Landscape scene art** (ratio > 1.15, e.g. a wide establishing shot) is
  supported but gets `cover`-fit and cropped to fill the panel — keep the subject
  centered so cropping the left/right or top/bottom edges doesn't cut it off.
- **Resolution:** at least 800px on the short edge.

## General card backgrounds (`assets/backgrounds/*.png`)

- Match the card's canvas dimensions' aspect ratio as closely as possible
  (profile card is 820×340 landscape) — these are scaled to always-cover already,
  so extreme mismatches just mean more of the source gets cropped, not distorted.
- Resolution: at least 1200px wide.

## Rule of thumb

If new art doesn't fit these guidelines, prefer fixing the generator (as Tasks
2-4 in `docs/superpowers/plans/2026-07-06-card-visual-polish.md` did) over
manually retouching every asset — but following the spec avoids needing a fix
in the first place.
```

- [ ] **Step 2: Commit**

```bash
git add docs/asset-spec.md
git commit -m "docs: add art asset spec for echo/weapon/background art"
```

---

### Task 6: Shop item thumbnails

**Files:**
- Modify: `src/lib/lootCard.ts:9-20` (export icon path helper)
- Modify: `src/commands/rpg/shop.ts:1-10` (imports), `src/commands/rpg/shop.ts:222-271` (`showQuantityPicker`)

- [ ] **Step 1: Export an icon-path helper from `lootCard.ts`**

In `src/lib/lootCard.ts`, after the existing `ICON_FILES` map (current lines ~11-20), add:

```typescript
/** Absolute path to the icon PNG for a given item field (e.g. "tuningModules"), or null if unknown. */
export function itemIconPath(field: string): string | null {
  const file = ICON_FILES[field];
  return file ? path.join(ICONS_DIR, file) : null;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p . 2>&1 | grep lootCard || echo "no errors in lootCard.ts"`
Expected: `no errors in lootCard.ts`

- [ ] **Step 3: Add thumbnail to the quantity-picker embed in `shop.ts`**

In `src/commands/rpg/shop.ts`, the current top-of-file imports (lines 1-11) are:

```typescript
import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ModalSubmitInteraction, Events, Interaction,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import { Element } from "@prisma/client";
```

Replace with:

```typescript
import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ModalSubmitInteraction, Events, Interaction, AttachmentBuilder,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import { Element } from "@prisma/client";
import { itemIconPath } from "../../lib/lootCard";
import fs from "fs";
```

Find `showQuantityPicker` (current lines ~222-271) and change its final `sel.update(...)` call. Current:

```typescript
  await sel.update({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${item.emoji}  ${item.name}`)
      .setDescription(
        `${item.description}\n\n` +
        `**Gives:** ${givesText} per purchase\n` +
        `**Price:** ${item.price} ${currencyEmoji(item.currency)} ${currencyLabel(item.currency)} each\n\n` +
        `How many do you want?`
      )
      .setFooter({ text: "CARTETHYIA  ·  Shop  ·  Expires in 60s" })],
    components: rows,
```

Replace with (thumbnail built from the item's primary `gives` field, falling back to no thumbnail if unknown):

```typescript
  const primaryField = Object.keys(item.gives)[0];
  const iconPath = primaryField ? itemIconPath(primaryField) : null;
  const files = iconPath && fs.existsSync(iconPath)
    ? [new AttachmentBuilder(iconPath, { name: "item-icon.png" })]
    : [];

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${item.emoji}  ${item.name}`)
    .setDescription(
      `${item.description}\n\n` +
      `**Gives:** ${givesText} per purchase\n` +
      `**Price:** ${item.price} ${currencyEmoji(item.currency)} ${currencyLabel(item.currency)} each\n\n` +
      `How many do you want?`
    )
    .setFooter({ text: "CARTETHYIA  ·  Shop  ·  Expires in 60s" });
  if (files.length) embed.setThumbnail("attachment://item-icon.png");

  await sel.update({
    embeds: [embed],
    files,
    components: rows,
```

(Keep the rest of the object — `components: rows,` was already the next line; do not duplicate it.)

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit -p . 2>&1 | grep shop.ts || echo "no errors in shop.ts"`
Expected: `no errors in shop.ts`

- [ ] **Step 5: Manual check**

Run the bot locally (`npm run dev`), run `/shop` in the dev guild, select any item, and confirm the quantity-picker embed now shows a small icon thumbnail matching the item.

- [ ] **Step 6: Commit**

```bash
git add src/lib/lootCard.ts src/commands/rpg/shop.ts
git commit -m "feat(shop): add item icon thumbnail to the quantity-picker embed"
```

---

### Task 7: Shop purchase confirmation as a canvas card

**Files:**
- Modify: `src/commands/rpg/shop.ts:350-401` (`processPurchase`)

- [ ] **Step 1: Add the import**

In `src/commands/rpg/shop.ts`, add to the imports:

```typescript
import { generateLootCard } from "../../lib/lootCard";
```

- [ ] **Step 2: Replace the plain-text purchase confirmation**

Find the success path at the end of `processPurchase` (current lines ~385-401):

```typescript
  const givesLines = Object.entries(item.gives)
    .map(([k, v]) => `› +${(v ?? 0) * qty} ${k.replace(/([A-Z])/g, ' $1').trim()}`)
    .join("\n");

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${item.emoji}  Purchase Complete`)
      .setDescription(
        `**${item.name} × ${qty}** purchased for **${total.toLocaleString()} ${currencyEmoji(item.currency)}**.\n\n` +
        `${givesLines}\n\n` +
        `Remaining balance: **${(balance - total).toLocaleString()} ${currencyEmoji(item.currency)}**`
      )
      .setFooter({ text: "CARTETHYIA  ·  Shop" })],
    components: [],
  });
```

Replace with:

```typescript
  const lootResult = {
    credits:          item.gives.credits          ? (item.gives.credits ?? 0) * qty          : 0,
    tuningModules:    item.gives.tuningModules     ? (item.gives.tuningModules ?? 0) * qty     : 0,
    sealingTubes:     item.gives.sealingTubes      ? (item.gives.sealingTubes ?? 0) * qty      : 0,
    forgingOres:      item.gives.forgingOres       ? (item.gives.forgingOres ?? 0) * qty       : 0,
    resonanceExp:     item.gives.resonanceExp      ? (item.gives.resonanceExp ?? 0) * qty      : 0,
    resonanceRecords: item.gives.resonanceRecords  ? (item.gives.resonanceRecords ?? 0) * qty  : 0,
    isMultiplied:     false,
  };

  const cardColorHex = "#" + color.toString(16).padStart(6, "0").toUpperCase();
  const card = await generateLootCard({
    loot: lootResult,
    actorName: interaction.user.username,
    elementColor: cardColorHex,
    affinity: null,
    isReturn: false,
  });
  const attachment = new AttachmentBuilder(card, { name: "purchase.webp" });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${item.emoji}  Purchase Complete`)
      .setDescription(
        `**${item.name} × ${qty}** purchased for **${total.toLocaleString()} ${currencyEmoji(item.currency)}**.\n\n` +
        `Remaining balance: **${(balance - total).toLocaleString()} ${currencyEmoji(item.currency)}**`
      )
      .setImage("attachment://purchase.webp")
      .setFooter({ text: "CARTETHYIA  ·  Shop" })],
    files: [attachment],
    components: [],
  });
```

Note: `item.gives` values not present in the shop catalogue (e.g. no `stasisLocks`/`paradoxCores` field exists on `LootResult`) are intentionally left out of `lootResult` — if a future shop item grants a field `LootResult` doesn't have, extend `LootResult` in `src/lib/loot.ts` first.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p . 2>&1 | grep shop.ts || echo "no errors in shop.ts"`
Expected: `no errors in shop.ts`

- [ ] **Step 4: Manual check**

Run the bot locally (`npm run dev`), run `/shop`, buy any item, and confirm the purchase confirmation now shows the loot-card image (matching the style already seen on `/daily`) instead of a plain text-only embed.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/shop.ts
git commit -m "feat(shop): show purchase confirmation as a loot card instead of plain text"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1-2 → spec §1 (blur). Task 3 → spec §2 (letterboxing). Task 4 → spec §3 (text-on-art). Task 5 → spec §4 (asset spec). Tasks 6-7 → spec §5 (shop embeds: thumbnails + mini-card). All five spec sections have a task.
- **Type consistency:** `drawImageSharp(ctx, img, dx, dy, dw, dh)` signature is identical everywhere it's called (Task 2). `itemIconPath(field: string)` return type (`string | null`) matches its one call site's `fs.existsSync` guard (Task 6).
- **No placeholders:** every step has literal code/commands; the one deliberately-deferred item (extending `LootResult` if a future item needs a new field) is explicitly out of scope, not a TODO left in this work.
