# Kaelith Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the plumbing Kaelith's kit needs before his kit module itself can exist — interface additions to `characterKit.ts`/`allyActions.ts`, the new Umbral Shards currency dropping from Null Ravager, and switching ally element passives from "inherits the player's element" to "uses the character's own element" (a live behavior change for Solace, announced separately).

**Architecture:** Five small, mostly-additive interface changes to the character-kit template (proven safe against Solace via the existing `solaceKit.ts` wrapper — her required-field values are trivial, e.g. her existing lore array and a `0` cooldown). Umbral Shards follows the exact Starfall-Shards pattern already shipped (schema field, unconditional field-boss drop, emoji + inventory-card + guide registration). The element-passive fix adds one small standalone map rather than importing the (larger, still-growing) character-kit registry into `setBonus.ts`, to avoid a circular import between the two modules.

**Tech Stack:** TypeScript, Prisma. No test framework — verification is `npx tsc --noEmit`, `npm run build`, and a standalone one-off script for the schema/currency addition (project's established `scripts/*.ts` convention).

---

## File Structure

| File | Change |
|---|---|
| `src/lib/characterKit.ts` | Modify — `loreFragments`, `skillCooldownTurns`, `statusLineText` added to `PlayableCharacterKit`; `newMechanicState`/`enemyDebuff` added to `IntroOutroEffect` |
| `src/lib/kits/solaceKit.ts` | Modify — satisfies the 3 new required fields with her existing values |
| `src/lib/allyActions.ts` | Modify — `BUFF_ALLY_CRIT_RATE` added to `AllyActionType`/`applyAllyAction`/`AllyActionResult` |
| `src/lib/characterElements.ts` | Create — small `characterId -> Element` map, avoids a circular import between `setBonus.ts` and `characterKit.ts` |
| `src/lib/setBonus.ts` | Modify — `playerElem` derivation uses the ally's own element when `characterId !== "self"` |
| `prisma/schema.prisma` | Modify — `umbralShards` added to `User` and `Mail`, mirroring `starfallShards` |
| `src/lib/inventoryCard.ts` | Modify — `umbralShards` added to `CURRENCIES` |
| `src/lib/emojiManager.ts` | Modify — `umbralShards` emoji asset + `CURRENCY_EMOJI_MAP` entry |
| `src/commands/rpg/field-boss.ts` | Modify — unconditional Umbral Shard drop on Null Ravager kill, mirroring the Starfall Shard block; picker hint text |

---

## Task 1: `characterKit.ts` interface additions

**Files:**
- Modify: `src/lib/characterKit.ts`

- [ ] **Step 1: Add the new fields to `IntroOutroEffect`**

`IntroOutroEffect` lives in `src/lib/introOutro.ts`, not `characterKit.ts` — confirm with `grep -n "interface IntroOutroEffect" src/lib/introOutro.ts` before editing. Add the two new optional fields there:

```typescript
export interface IntroOutroEffect {
  actions:  AllyAction[];
  dmgMult?: number;
  newMechanicState?: unknown;   // lets Intro/Outro update a character's opaque mechanic state (e.g. Kaelith's Intro adding stacks)
  enemyDebuff?: { type: string; value: number; turns: number }; // Outro-only — targets the enemy, not an ally
}
```

- [ ] **Step 2: Add `loreFragments`, `skillCooldownTurns`, and `statusLineText` to `PlayableCharacterKit`**

In `src/lib/characterKit.ts`, add these three fields to the `PlayableCharacterKit` interface (after `portraitPath`, before `statsAtLevel`):

```typescript
  loreFragments: string[];      // 7 entries; fragment i unlocks at ascensionPhase >= i
  skillCooldownTurns: number;   // 0 = no cooldown (Solace); a real damage-move Skill should set this
```

And add the method after `onUltimate`:

```typescript
  statusLineText(mechanicState: unknown): string; // renders this character's mechanic state for the battle status line
```

- [ ] **Step 3: Typecheck — expect a failure in `solaceKit.ts`**

Run: `npx tsc --noEmit`
Expected: FAIL — `solaceKit.ts`'s object literal is now missing 3 required fields (`loreFragments`, `skillCooldownTurns`, `statusLineText`). This is expected; Task 2 fixes it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/introOutro.ts src/lib/characterKit.ts
git commit -m "feat(character-kit): add loreFragments/skillCooldownTurns/statusLineText + IntroOutroEffect extensions"
```

---

## Task 2: Update `solaceKit.ts` to satisfy the new required fields

**Files:**
- Modify: `src/lib/kits/solaceKit.ts`

- [ ] **Step 1: Add the import and the three new fields**

```typescript
import { SOLACE_LORE_FRAGMENTS } from "../solace";
```

Add to the `solaceKit` object (after `portraitPath: "assets/Characters/Solace.png",`):

```typescript
  loreFragments: SOLACE_LORE_FRAGMENTS,
  skillCooldownTurns: 0, // no cooldown — Attunement is a utility mode-cycle, not a damage move
```

Add the method (after `onUltimate`, before `constellationEffects`):

```typescript
  statusLineText(mechanicState: unknown): string {
    const state = mechanicState as SolaceMechanicState;
    return `${state.attunement.mode ? `(${state.attunement.mode} mode)` : "(no mode)"}  ·  Concerto Energy: ${state.concertoEnergy}/100`;
  },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/kits/solaceKit.ts
git commit -m "feat(character-kit): satisfy loreFragments/skillCooldownTurns/statusLineText in solaceKit"
```

---

## Task 3: `BUFF_ALLY_CRIT_RATE` in `allyActions.ts`

**Files:**
- Modify: `src/lib/allyActions.ts`

- [ ] **Step 1: Add the new type, result field, and switch case**

Replace the full file body (it's short — 47 lines):

```typescript
// src/lib/allyActions.ts
// Composable ally-targeted action primitives — what Intro/Outro Skills and support
// kits (e.g. Solace's Attunement) are built FROM. See design spec §4.3.
// These are pure result-computers; callers (future combat-loop wiring in later
// milestones) are responsible for clamping hp to hpMax, applying shield/buff state,
// and calling debuffs.ts's cleanseDebuffs() with the returned cleanseCount.

export type AllyActionType = "HEAL_ALLY" | "SHIELD_ALLY" | "BUFF_ALLY_ATK" | "BUFF_ALLY_CRIT_RATE" | "CLEANSE_ALLY";

export interface AllyAction {
  type:  AllyActionType;
  // HEAL_ALLY / SHIELD_ALLY: fraction of target's max HP.
  // BUFF_ALLY_ATK / BUFF_ALLY_CRIT_RATE: fraction bonus (ATK% or Crit Rate).
  // CLEANSE_ALLY: number of debuffs to remove.
  value: number;
}

export interface AllyActionTarget {
  hp:    number;
  hpMax: number;
}

export interface AllyActionResult {
  hpDelta:      number; // heal amount — caller adds to target.hp and clamps to hpMax
  shieldDelta:  number; // shield amount to grant
  atkBuffPct:   number; // ATK% buff to apply to target
  critRateBuffPct: number; // Crit Rate buff to apply to target
  cleanseCount: number; // debuff count to remove via debuffs.ts's cleanseDebuffs()
}

export function applyAllyAction(action: AllyAction, target: AllyActionTarget): AllyActionResult {
  const result: AllyActionResult = { hpDelta: 0, shieldDelta: 0, atkBuffPct: 0, critRateBuffPct: 0, cleanseCount: 0 };
  switch (action.type) {
    case "HEAL_ALLY":
      result.hpDelta = Math.floor(target.hpMax * action.value);
      break;
    case "SHIELD_ALLY":
      result.shieldDelta = Math.floor(target.hpMax * action.value);
      break;
    case "BUFF_ALLY_ATK":
      result.atkBuffPct = action.value;
      break;
    case "BUFF_ALLY_CRIT_RATE":
      result.critRateBuffPct = action.value;
      break;
    case "CLEANSE_ALLY":
      result.cleanseCount = action.value;
      break;
  }
  return result;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — the new `critRateBuffPct` field is additive; nothing currently reads `AllyActionResult` exhaustively in a way that would break (confirm via `grep -rn "AllyActionResult" src/` if unsure — every consumer destructures specific fields by name, never iterates all fields).

- [ ] **Step 3: Commit**

```bash
git add src/lib/allyActions.ts
git commit -m "feat(ally-actions): add BUFF_ALLY_CRIT_RATE"
```

---

## Task 4: Own-element passives for allies

**Files:**
- Create: `src/lib/characterElements.ts`
- Modify: `src/lib/setBonus.ts:274` (the `playerElem` derivation)

- [ ] **Step 1: Create the character-element map**

```typescript
// src/lib/characterElements.ts
// Maps a playable ally's characterId to their own fixed element — used so an
// ally's innate element bonus (setBonus.ts's ELEMENT_PASSIVES) comes from
// THEIR element, not whichever element the human player happens to have
// chosen. A standalone file rather than importing CHARACTER_KITS here:
// setBonus.ts is imported very broadly across the codebase, and
// characterKit.ts already imports ResolvedStats FROM setBonus.ts — importing
// the kit registry back into setBonus.ts would create a circular import.
// Keep this map in sync by hand when a new character is added (matches the
// project's existing convention of small per-character lookup tables, e.g.
// character.ts's CHARACTERS registry itself).
export const CHARACTER_ELEMENTS: Record<string, string> = {
  solace: "SPECTRO",
};
```

- [ ] **Step 2: Read the current `playerElem` line for exact context**

Run: `grep -n "playerElem" src/lib/setBonus.ts`
Confirm line 274 reads `const playerElem = user.element;` and is inside `resolvePlayerBonuses(userId: string, characterId: string = "self")` (confirm the function signature via `grep -n "export async function resolvePlayerBonuses" src/lib/setBonus.ts`).

- [ ] **Step 3: Change the derivation**

```typescript
// Before:
const playerElem = user.element;

// After:
const playerElem = characterId === "self" ? user.element : (CHARACTER_ELEMENTS[characterId] ?? user.element);
```

Add the import at the top of `setBonus.ts`:

```typescript
import { CHARACTER_ELEMENTS } from "./characterElements";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Verify Solace's behavior actually changed, via a one-off script**

```typescript
// scripts/verify-own-element-passive.ts
import "dotenv/config";
import { CHARACTER_ELEMENTS } from "../src/lib/characterElements";
import { ELEMENT_PASSIVES } from "../src/lib/setBonus";

function main() {
  const solaceElement = CHARACTER_ELEMENTS["solace"];
  if (solaceElement !== "SPECTRO") { console.error(`FAIL: expected SPECTRO, got ${solaceElement}`); process.exit(1); }
  const passive = ELEMENT_PASSIVES[solaceElement];
  if (!passive) { console.error("FAIL: no ELEMENT_PASSIVES entry for SPECTRO"); process.exit(1); }
  console.log(`PASS: solace -> ${solaceElement}, passive: ${JSON.stringify(passive)}`);
}
main();
```

Run: `npx tsx scripts/verify-own-element-passive.ts`
Expected: `PASS: solace -> SPECTRO, passive: {...}` (real Spectro passive values printed — confirms the map resolves and a real passive exists for it, not that combat math is re-derived here).

- [ ] **Step 6: Delete the one-off script**

```bash
rm scripts/verify-own-element-passive.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/characterElements.ts src/lib/setBonus.ts
git commit -m "feat(setBonus): allies use their own element's innate passive instead of the player's

BEHAVIOR CHANGE: Solace now gets Spectro's innate bonus (+30% HP, +20% Elem
DMG, RADIANCE regen) instead of inheriting whatever element the player
chose. Needs an announcement — existing owners will notice less ATK/Crit,
more HP/survivability on her."
```

---

## Task 5: Umbral Shards — schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `umbralShards` to `User`**

Find line 100 (`starfallShards   Int            @default(0) // Solace ascension mat...`) and add directly after it:

```prisma
  umbralShards     Int            @default(0) // Kaelith ascension mat (Lv40+), drops only from Null Ravager (Havoc field boss)
```

- [ ] **Step 2: Add `umbralShards` to `Mail`**

Find line 458 (`starfallShards   Int @default(0)` inside the `Mail` model) and add directly after it:

```prisma
  umbralShards     Int @default(0)
```

- [ ] **Step 3: Push schema and regenerate the client**

Run: `npm run db:push`
Expected: Prisma reports the new columns added, no data loss warnings (both are new nullable-with-default columns).

Run: `npx prisma generate`
Expected: Client regenerated successfully.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add umbralShards currency (Kaelith ascension material)"
```

---

## Task 6: Umbral Shards — registration (inventory card, emoji)

**Files:**
- Modify: `src/lib/inventoryCard.ts`
- Modify: `src/lib/emojiManager.ts`

- [ ] **Step 1: Add to `inventoryCard.ts`'s `CURRENCIES`**

Find the line `{ key: "starfallShards", file: "Starfall Shard.png", label: "Starfall Shards",color: "#EAB308", desc: "Solace ascension"     },` and add directly after it:

```typescript
  { key: "umbralShards",   file: "Umbral Shard.png",   label: "Umbral Shards",  color: "#7C3AED", desc: "Kaelith ascension"    },
```

(This references `assets/icons/Umbral Shard.png`, matching where `Starfall Shard.png` actually lives — confirmed via `find . -iname "Starfall Shard.png"`. That file doesn't exist yet; it needs to be added before this displays correctly. It won't crash without it, per this project's established pattern of icons silently no-oping when the file is missing, but it also won't render — flag this to the user at the end of this plan.)

- [ ] **Step 2: Add to `emojiManager.ts`**

Find `{ name: "cc_starfall",   file: "assets/icons/Starfall Shard.png" },` in `EMOJI_ASSETS` (confirmed line 22) and add directly after it:

```typescript
  { name: "cc_umbral", file: "assets/icons/Umbral Shard.png" },
```

Find `starfallShards:   "cc_starfall",` in `CURRENCY_EMOJI_MAP` (confirmed line 152) and add directly after it:

```typescript
  umbralShards:     "cc_umbral",
```

Find `get sf() { return getEmoji("cc_starfall",   "🌠"); },` in the `CE` accessor object (confirmed line 262) and add directly after it:

```typescript
  get us() { return getEmoji("cc_umbral", "🔮"); },
```

(Same asset caveat as Step 1 — `cc_umbral`'s upload will find no file to upload until `Umbral Shard.png` is added; the existing upload loop already tolerates a missing file, matching how new echo icons were added before their PNGs landed earlier this session. The `us` getter's fallback emoji `🔮` displays until then.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/inventoryCard.ts src/lib/emojiManager.ts
git commit -m "feat(currencies): register Umbral Shards in inventory card + emoji manager"
```

---

## Task 7: Null Ravager drop + picker hint

**Files:**
- Modify: `src/commands/rpg/field-boss.ts`

- [ ] **Step 1: Find the exact current Starfall Shard block and Null Ravager's id**

Run: `grep -n "luminal_specter\|null_ravager\|starfallShardsDropped" src/commands/rpg/field-boss.ts`

- [ ] **Step 2: Add the Umbral Shard drop alongside the Starfall Shard one**

The existing block (confirmed at lines 463-470 in `field-boss.ts`):

```typescript
          let starfallShardsDropped = 0;
          if (fb.id === "luminal_specter") {
            starfallShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { starfallShards: { increment: 1 } },
            });
          }
```

becomes:

```typescript
          let starfallShardsDropped = 0;
          if (fb.id === "luminal_specter") {
            starfallShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { starfallShards: { increment: 1 } },
            });
          }
          let umbralShardsDropped = 0;
          if (fb.id === "null_ravager") {
            umbralShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { umbralShards: { increment: 1 } },
            });
          }
```

- [ ] **Step 3: Add it to the victory embed text**

The existing line:
```typescript
                (starfallShardsDropped ? `\n${CE.sf} **1 Starfall Shard**` : "") +
```
becomes:
```typescript
                (starfallShardsDropped ? `\n${CE.sf} **1 Starfall Shard**` : "") +
                (umbralShardsDropped ? `\n${CE.us} **1 Umbral Shard**` : "") +
```

(`CE.us` is the getter added in Task 6 Step 2.)

- [ ] **Step 4: Add a drop hint to Null Ravager's picker option description**

Confirmed at `field-boss.ts:221`, the current line:
```typescript
      const dropNote = fb.id === "luminal_specter" ? "  ✦ drops Starfall Shards" : "";
```
becomes:
```typescript
      const dropNote = fb.id === "luminal_specter" ? "  ✦ drops Starfall Shards"
                      : fb.id === "null_ravager"    ? "  ✦ drops Umbral Shards"
                      : "";
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/rpg/field-boss.ts
git commit -m "feat(field-boss): Null Ravager drops Umbral Shards (Kaelith's ascension material)"
```

---

## Task 8: Final verification

**Files:** None modified — verification only.

- [ ] **Step 1: Full typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: both clean.

- [ ] **Step 2: Confirm no stray script files remain**

```bash
git status
```
Expected: clean working tree (both one-off scripts from Tasks 4 and were already removed in their own steps).

- [ ] **Step 3: Report to the user what still needs a real asset**

At the end of this plan, explicitly tell the user: `Umbral Shard.png` doesn't exist yet (needed in whatever directory `Starfall Shard.png` lives in, for the inventory card) and the same icon is needed for the emoji manager's upload (same or a different path — confirmed during Task 6). Both currently no-op silently rather than crash, but the currency won't have a visible icon until the art is added.
