# Solace Constellations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players spend banked Constellation Tokens to raise Solace's `constellation` rank (0-6) via a new button in `/character`, and wire all six C1-C6 effects into every combat surface where Solace fights.

**Architecture:** `constellation` is read once per fight (added to the existing `resolveSolaceStats()` / per-fight `CharacterProgress` read that already exists in all 7 combat files) and threaded as a plain number into the same six call sites where her kit-level numbers (`solaceIntroLevel`, `solaceSkillLevel`, etc.) already flow. No new state machine — every effect is a small conditional addition to existing functions.

**Tech Stack:** TypeScript, Prisma, discord.js v14. No test framework in this repo — verification is `npx tsc --noEmit` per task plus a manual playtest at the end (matching the project's existing `scripts/test-*.ts` convention for anything that can be checked outside Discord, and live `/encounter`+`/boss` checks for anything that can't).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/solace.ts` | Modify: C1 outro buff, C2 heal/cleanse bonus, C4 shield bonus, C5 turns function |
| `src/lib/attunement.ts` | Modify: C6 off-mode bonus param on the 3 getters |
| `src/commands/rpg/character.ts` | Modify: unlock button + handler on the Constellations page |
| `src/commands/rpg/ascend.ts` | Modify: wire `constellation` into C1-C6 |
| `src/commands/rpg/boss.ts` | Modify: same |
| `src/commands/rpg/dungeon.ts` | Modify: same (uses a `ws.` state-wrapper object, not bare locals) |
| `src/commands/rpg/field-boss.ts` | Modify: same |
| `src/lib/encounter.ts` | Modify: same |
| `src/commands/rpg/duel.ts` | Modify: same, two-sided (challenger/defender each need their own constellation read) |
| `src/commands/rpg/raid.ts` | Modify: same, per-participant + the shared `partyWideTeamBonuses()` helper |

---

## Task 1: `solace.ts` — C1, C2, C4, C5 core functions

**Files:**
- Modify: `src/lib/solace.ts:128-138` (intro/outro/ultimate-duration section)

- [ ] **Step 1: Add constellation-aware intro/outro builders and the C5 turns function**

Replace lines 124-138 (the `solaceIntroEffect` function through `SOLACE_ULTIMATE_DOUBLE_TURNS`):

```typescript
// Intro Skill: instant heal + cleanse, zero ramp-up (design spec §6). Unlike
// Outro, Intro's heal % scales with Intro level (Milestone 2e) — so it's a
// function, not a static object, to avoid a second, silently-stale source of
// truth for the heal value. Milestone 4d: constellation gates two additions —
// C4 adds a shield equal to 30% of the heal (computed at construction time
// since HEAL_ALLY/SHIELD_ALLY are both flat fractions of hpMax, so no need to
// wait for a resolved heal amount).
export function solaceIntroEffect(introLevel: number, constellation: number = 0): IntroOutroEffect {
  const healPct = solaceIntroHealPct(introLevel);
  const actions: AllyAction[] = [
    { type: "HEAL_ALLY",    value: healPct },
    { type: "CLEANSE_ALLY", value: 1 },
  ];
  if (constellation >= 4) actions.push({ type: "SHIELD_ALLY", value: healPct * 0.30 });
  return { actions };
}

// Outro: shields the incoming ally 15% of hpMax (design spec §6/§8 — see the
// "guaranteed crit" note below for why that half of the spec was never built).
// C1 adds a standalone +15% ATK buff to the incoming ally's first action.
//
// The "guarantees their next attack crits" half of her Outro (per spec) has no
// AllyAction primitive for it yet (HEAL/SHIELD/BUFF_ATK/CLEANSE don't cover
// "arm a guaranteed crit") — a later task wires that part directly via the
// existing nextAttackCritArmed variable already used by the Echo Skill system.
// C1 does NOT depend on that gap — it ships as its own +15% ATK buff.
export function solaceOutroEffect(constellation: number = 0): IntroOutroEffect {
  const actions: AllyAction[] = [{ type: "SHIELD_ALLY", value: 0.15 }];
  if (constellation >= 1) actions.push({ type: "BUFF_ALLY_ATK", value: 0.15 });
  return { actions };
}

// Ultimate's doubled-Attunement-effect duration (design spec §6: "3 turns").
// C5 extends this to 4. SOLACE_FORTE_EMPOWERED_TURNS below is aliased to the
// same window (Empowered Ultimate is a variant of the same doubled-mode
// mechanic) so it extends together with C5, not independently.
export function solaceUltimateDoubleTurns(constellation: number = 0): number {
  return constellation >= 5 ? 4 : 3;
}
```

- [ ] **Step 2: Update `AllyAction` import to include the type**

Check the top of `src/lib/solace.ts` for its `introOutro`/`allyActions` imports. Add `AllyAction` to the import from `./allyActions` if not already present:

```typescript
import { IntroOutroEffect } from "./introOutro";
import { AllyAction } from "./allyActions";
```

- [ ] **Step 3: Update C2 — Convergence heal % and cleanse count**

Find `solaceConvergenceHealPct` (around line 194 in the original file):

```typescript
export function solaceConvergenceHealPct(ultimateLevel: number): number {
  return 0.30 + (0.60 - 0.30) * (ultimateLevel - 1) / (MAX_KIT_LEVEL - 1);
}
```

Replace with:

```typescript
// C2 adds a flat +0.15 on top of the kit-level-scaled range (0.30-0.60 becomes
// 0.45-0.75 at constellation >= 2).
export function solaceConvergenceHealPct(ultimateLevel: number, constellation: number = 0): number {
  const base = 0.30 + (0.60 - 0.30) * (ultimateLevel - 1) / (MAX_KIT_LEVEL - 1);
  return constellation >= 2 ? base + 0.15 : base;
}

// C2 also raises Convergence's CLEANSE_ALLY value from 1 to 2 — combat loops
// call this instead of hardcoding the literal.
export function solaceConvergenceCleanseCount(constellation: number = 0): number {
  return constellation >= 2 ? 2 : 1;
}
```

- [ ] **Step 4: Update `SOLACE_ULTIMATE_DOUBLE_TURNS` references**

`SOLACE_ULTIMATE_DOUBLE_TURNS` (the old constant) and `SOLACE_FORTE_EMPOWERED_TURNS` (its alias) are replaced by the new `solaceUltimateDoubleTurns()` function. Remove both old declarations:

```typescript
export const SOLACE_ULTIMATE_DOUBLE_TURNS = 3;
```
and
```typescript
export const SOLACE_FORTE_EMPOWERED_TURNS = SOLACE_ULTIMATE_DOUBLE_TURNS;
```

These two exports are deleted — Task 4-10 replace every call site. `getSolaceForteAtkBonus`/etc. (which reference forte level, not turns) are untouched.

- [ ] **Step 5: Typecheck (expect errors — call sites not yet updated)**

Run: `npx tsc --noEmit`
Expected: FAIL — errors in ascend.ts/boss.ts/dungeon.ts/duel.ts/raid.ts/field-boss.ts/encounter.ts referencing `SOLACE_ULTIMATE_DOUBLE_TURNS`, `SOLACE_FORTE_EMPOWERED_TURNS`, and the old 1-arg `solaceIntroEffect`/`solaceConvergenceHealPct` signatures. This is expected — Tasks 4-10 fix each file. Do not fix them here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solace.ts
git commit -m "feat(solace): add constellation-gated C1/C2/C4/C5 kit modifiers"
```

---

## Task 2: `attunement.ts` — C6 off-mode bonus

**Files:**
- Modify: `src/lib/attunement.ts`

- [ ] **Step 1: Add the `constellation6` param to all three getters**

Replace the full file body (lines 32-45) with:

```typescript
// `bonus` is the magnitude for whichever mode IS active (e.g. Solace's
// Skill-level-scaled value, computed by the caller — see solace.ts). No
// default: Milestone 2e deliberately removed the old hardcoded 0.15/0.15/0.20
// constants so a future character reusing this mechanic can't silently
// inherit Solace's numbers by omission — every caller must supply its own
// character's magnitude explicitly.
//
// `doubled` is Solace's Ultimate ("Convergence") temporarily doubling whichever
// mode is currently active — it doubles the BONUS portion (the amount above the
// neutral 1.0/0 baseline), not the whole multiplier.
//
// `constellation6`: C6 — while one mode is active, allies ALSO gain 50% of the
// other two modes' effects. Only applies to modes that are NOT the active one
// (the active mode's own bonus/doubling is unaffected — this is purely
// additive spillover onto the two inactive modes).
export function getAttunementAtkMult(state: AttunementState, bonus: number, doubled = false, constellation6 = false): number {
  if (state.mode === "ATK") return 1 + bonus * (doubled ? 2 : 1);
  return constellation6 ? 1 + bonus * 0.5 : 1;
}

export function getAttunementCritRateBonus(state: AttunementState, bonus: number, doubled = false, constellation6 = false): number {
  if (state.mode === "CRIT") return bonus * (doubled ? 2 : 1);
  return constellation6 ? bonus * 0.5 : 0;
}

export function getAttunementDefMult(state: AttunementState, bonus: number, doubled = false, constellation6 = false): number {
  if (state.mode === "DEF") return 1 + bonus * (doubled ? 2 : 1);
  return constellation6 ? 1 + bonus * 0.5 : 1;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: Same pre-existing failures as Task 1 (unrelated call sites) — no NEW failures from this file, since the new param defaults to `false` and is backward-compatible with every existing call site.

- [ ] **Step 3: Commit**

```bash
git add src/lib/attunement.ts
git commit -m "feat(attunement): add C6 off-mode 50% spillover bonus"
```

---

## Task 3: `character.ts` — unlock button + handler

**Files:**
- Modify: `src/commands/rpg/character.ts:360-377` (`buildConstellationsView` and its button row)

- [ ] **Step 1: Read the current `buildConstellationsView` function and surrounding button-row/customId-handling code**

Run: `grep -n "buildConstellationsView\|con_unlock\|CustomId.*char" src/commands/rpg/character.ts`

Confirm the exact current line numbers for the function body and where `/character`'s other page buttons/customId handlers are wired (the file uses a shared button-row builder and a central customId switch — follow that exact existing pattern, don't invent a new one).

- [ ] **Step 2: Add the unlock button to `buildConstellationsView`**

Modify `buildConstellationsView` so it returns an extra button row when eligible. The existing function returns a `PageView` (embed + subtitle) — check `PageView`'s shape (`grep -n "interface PageView" src/commands/rpg/character.ts`) to confirm whether it already supports a `components` field; if not, add one (optional array of `ActionRowBuilder`), and thread it through wherever `PageView.embed`/`.subtitle` are consumed to build the final message.

Add this to `buildConstellationsView`, right before the `return`:

```typescript
const canUnlock = progress.constellationTokens >= 1 && progress.constellation < MAX_CONSTELLATION;
const components = canUnlock ? [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("char_con_unlock")
      .setLabel(`✦  Unlock C${progress.constellation + 1}  (1 Token)`)
      .setStyle(ButtonStyle.Success),
  ),
] : [];
```

(`ActionRowBuilder` and `ButtonBuilder` are already imported at the top of the file — confirm with `grep -n "^import" src/commands/rpg/character.ts | grep discord.js`.)

- [ ] **Step 3: Add the `char_con_unlock` button handler**

Find the file's central button-collector `switch`/`if` chain (search for an existing customId like `charequipecho:` or similar to find the pattern). Add a new branch:

```typescript
if (customId === "char_con_unlock") {
  const result = await prisma.characterProgress.updateMany({
    where: {
      userId, characterId: "solace",
      constellationTokens: { gte: 1 },
      constellation: currentConstellationBeforeClick, // the value read when this page was rendered
    },
    data: {
      constellationTokens: { decrement: 1 },
      constellation: { increment: 1 },
    },
  });
  if (result.count === 0) {
    // Race — tokens or constellation changed since render (double-click, or
    // a wish pull landed a token in between). Re-render with fresh data
    // rather than showing an error; this is an expected race, not a bug.
  }
  // Re-fetch progress and re-render the Constellations page (reuse whatever
  // this file's existing re-render-after-action pattern is — follow it, don't
  // invent a new one).
  return;
}
```

Adapt the exact `where`/re-render mechanics to match this file's established pattern for other race-guarded spend actions (e.g. Kit Level's forgingOres spend) — grep for `updateMany.*where.*gte` in this file to find the existing template and mirror its structure exactly, including how it re-fetches and re-renders afterward.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors from `character.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/character.ts
git commit -m "feat(character): add Solace constellation unlock button"
```

---

## Task 4: Wire constellation into `ascend.ts`

**Files:**
- Modify: `src/commands/rpg/ascend.ts:336` (stats fetch), `:452` (intro), `:486-487,558-559,607` (attunement getters), `:551` (skill mode-switch → C3 burst), `:638-641` (Convergence heal+cleanse), `:670,673` (doubled turns)

- [ ] **Step 1: Read constellation alongside the existing Solace progress fetch**

At line 336, `resolveSolaceStats` is called but `constellation` isn't read anywhere in this file yet. Find where `solaceIntroLevel`/`solaceSkillLevel`/etc. are read from `CharacterProgress` (search `grep -n "solaceIntroLevel\s*=" src/commands/rpg/ascend.ts` to find the exact fetch), and add `constellation` to that same `select` + destructure:

```typescript
const solaceConstellation = solaceProgress?.constellation ?? 0;
```//placed alongside the existing `solaceIntroLevel`/`solaceSkillLevel`/`solaceUltimateLevel`/`solaceForteLevel` declarations.

- [ ] **Step 2: Wire C1 — outro call site**

`ascend.ts` doesn't currently call a `solaceOutroEffect()` function (Task 1 created one) — find where `SOLACE.outro` is currently referenced directly (search `grep -n "SOLACE.outro" src/commands/rpg/ascend.ts`). Replace `SOLACE.outro` with `solaceOutroEffect(solaceConstellation)` at that call site, and add the import:

```typescript
import { solaceOutroEffect } from "../../lib/solace";
```
(add to the existing `from "../../lib/solace"` import list rather than a new import line).

- [ ] **Step 3: Wire C1/C4 — intro call site**

Line 452:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(solaceIntroLevel) : PLAYER_SELF_INTRO;
```
becomes:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(solaceIntroLevel, solaceConstellation) : PLAYER_SELF_INTRO;
```

- [ ] **Step 4: Wire C6 — the three attunement-getter call sites**

Lines 486-487, 558-559, 607 all follow this shape:
```typescript
const teamAtkMult  = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
const teamCritBonus = isDevGuild ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 0;
```
Add `solaceConstellation >= 6` as the 4th argument to every `getAttunementAtkMult`/`getAttunementCritRateBonus`/`getAttunementDefMult` call in the file (there are 4 total: the two above appear 3 times combined at lines 486-487/558-559/607, plus `getAttunementDefMult` at line 929). Example:
```typescript
const teamAtkMult  = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0, solaceConstellation >= 6) : 1;
const teamCritBonus = isDevGuild ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0, solaceConstellation >= 6) : 0;
```
Apply the same `, solaceConstellation >= 6` addition to all 4 call sites (486, 487, 558, 559, 607, 929 — 6 total occurrences across the 3 getter names).

- [ ] **Step 5: Wire C3 — Skill mode-switch Concerto Energy burst**

Line 551:
```typescript
attunement.mode = cycleAttunementMode(attunement.mode);
```
becomes:
```typescript
attunement.mode = cycleAttunementMode(attunement.mode);
if (solaceConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
```
(`addConcertoEnergy` is already imported in this file per the earlier grep.)

- [ ] **Step 6: Wire C2 — Convergence heal % and cleanse count**

Lines 638-641:
```typescript
const healPct = solaceConvergenceHealPct(solaceUltimateLevel);
...
{ type: "CLEANSE_ALLY", value: 1 },
```
becomes:
```typescript
const healPct = solaceConvergenceHealPct(solaceUltimateLevel, solaceConstellation);
...
{ type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(solaceConstellation) },
```
Apply this to BOTH `CLEANSE_ALLY` occurrences at line 641 (there are two nearby — one for the player's heal object, one for the ally's — confirm via `grep -n "CLEANSE_ALLY" src/commands/rpg/ascend.ts` and update every occurrence in the Convergence/Ultimate branch, not just the first match).

Add `solaceConvergenceCleanseCount` to the import from `../../lib/solace`.

- [ ] **Step 7: Wire C5 — doubled-turns**

Lines 670 and 673:
```typescript
attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS + 1; // +1 compensates for the same-round decrement
...
`**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
```
becomes:
```typescript
attunementDoubleTurnsLeft = solaceUltimateDoubleTurns(solaceConstellation) + 1; // +1 compensates for the same-round decrement
...
`**${attunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(solaceConstellation)} turns!**`;
```
Remove `SOLACE_ULTIMATE_DOUBLE_TURNS` from the import list (it no longer exists per Task 1) and add `solaceUltimateDoubleTurns`.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors referencing `ascend.ts`. Errors in other combat files are expected until their tasks run.

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/ascend.ts
git commit -m "feat(ascend): wire Solace constellation effects into ascension fights"
```

---

## Task 5: Wire constellation into `boss.ts`

**Files:**
- Modify: `src/commands/rpg/boss.ts` (identical structure/variable names to `ascend.ts` — same bare-local pattern)

- [ ] **Step 1-7: Repeat Task 4's steps 1-7 exactly, applied to `boss.ts`**

`boss.ts` uses the exact same variable names as `ascend.ts` (`solaceIntroLevel`, `solaceSkillLevel`, `attunementDoubleTurnsLeft`, `concertoEnergy`, `isDevGuild`, etc. — confirmed identical via earlier grep). Apply the same 7 transformations at boss.ts's own line numbers (previously confirmed: intro at line 544, attunement getters at 578-579/650-653/699-700/949-953, skill mode-switch at 643, Convergence heal at 731-736, doubled-turns at 758-766).

Because this file's exact line numbers may have shifted slightly since the original grep, use `grep -n "solaceIntroEffect(\|getAttunementAtkMult(\|getAttunementCritRateBonus(\|getAttunementDefMult(\|cycleAttunementMode(\|SOLACE_ULTIMATE_DOUBLE_TURNS\|CLEANSE_ALLY" src/commands/rpg/boss.ts` first to get current line numbers before editing, and apply the exact same code transformations shown in Task 4 Steps 2-7 (same before/after snippets — this file's surrounding code matches ascend.ts's shape closely enough that the same replacement text applies verbatim, just at different line numbers, and `boss.ts` also directly references `SOLACE.outro` — find and replace it the same way as Task 4 Step 2).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors referencing `boss.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/boss.ts
git commit -m "feat(boss): wire Solace constellation effects into boss fights"
```

---

## Task 6: Wire constellation into `field-boss.ts`

**Files:**
- Modify: `src/commands/rpg/field-boss.ts` (same bare-local shape as ascend/boss, confirmed via grep: `isDevGuild` line 360, intro line 557, attunement getters 602-603/672-673/718/949, skill mode-switch 665, Convergence 748-751, doubled-turns 780/783)

- [ ] **Step 1-7: Repeat Task 4's steps 1-7 exactly, applied to `field-boss.ts` at its own (grep-confirmed) line numbers.**

Same variable names as ascend.ts/boss.ts throughout. Run `grep -n "solaceIntroEffect(\|getAttunementAtkMult(\|getAttunementCritRateBonus(\|getAttunementDefMult(\|cycleAttunementMode(\|SOLACE_ULTIMATE_DOUBLE_TURNS\|CLEANSE_ALLY\|SOLACE.outro" src/commands/rpg/field-boss.ts` to confirm current line numbers, then apply the same before/after transformations as Task 4.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors referencing `field-boss.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/field-boss.ts
git commit -m "feat(field-boss): wire Solace constellation effects into field boss fights"
```

---

## Task 7: Wire constellation into `encounter.ts`

**Files:**
- Modify: `src/lib/encounter.ts` (same bare-local shape; confirmed: `hasSolace`/`isDevGuild` lines 400-401, intro line 616, attunement getters 693-694/761, skill mode-switch 728, Convergence 775-778, doubled-turns 812/815)

- [ ] **Step 1-7: Repeat Task 4's steps 1-7 exactly, applied to `encounter.ts` at its own (grep-confirmed) line numbers.**

Same variable names. Note this file computes `atkMult`/crit bonus inline in a single combined expression rather than separate `teamAtkMult`/`teamCritBonus` variables in some places (e.g. line 693-694) — add `, solaceConstellation >= 6` as the extra argument to the `getAttunementAtkMult(...)`/`getAttunementCritRateBonus(...)`/`getAttunementDefMult(...)` calls wherever they appear inline, same as any other call site (the transformation is identical regardless of whether the call is assigned to its own variable first).

Run `grep -n "solaceIntroEffect(\|getAttunementAtkMult(\|getAttunementCritRateBonus(\|getAttunementDefMult(\|cycleAttunementMode(\|SOLACE_ULTIMATE_DOUBLE_TURNS\|CLEANSE_ALLY\|SOLACE.outro" src/lib/encounter.ts` first to confirm current lines.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors referencing `encounter.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(encounter): wire Solace constellation effects into chat encounters"
```

---

## Task 8: Wire constellation into `dungeon.ts` (state-wrapper shape)

**Files:**
- Modify: `src/commands/rpg/dungeon.ts` (uses a `ws.` state-wrapper object instead of bare locals — confirmed via grep: `hasSolace` line 296, `solaceIntroLevel` etc. lines 300-304, intro line 769, attunement getters 807-808/882-883/931/1172, skill mode-switch 875, Convergence 965-968, doubled-turns 997/1000)

- [ ] **Step 1: Read constellation into the per-fight Solace state**

At the block around lines 296-304 where `solaceBasicLevel`/`solaceSkillLevel`/`solaceUltimateLevel`/`solaceIntroLevel`/`solaceForteLevel` are read from `solaceProgress`, add:

```typescript
const solaceConstellation = solaceProgress?.constellation ?? 0;
```

This file threads these values into a worker-state object accessed as `ws.solaceIntroLevel` etc. inside the fight loop (confirmed via grep — `ws.solaceIntroLevel` used at line 769). Find where the worker-state object is constructed (search `grep -n "solaceIntroLevel:" src/commands/rpg/dungeon.ts` to find the object-literal that packages these values for `ws`) and add `solaceConstellation` as a field there too.

- [ ] **Step 2: Wire C1 — outro call site**

Find `SOLACE.outro` in this file (`grep -n "SOLACE.outro" src/commands/rpg/dungeon.ts`) and replace with `solaceOutroEffect(ws.solaceConstellation)`, adding the import as in Task 4 Step 2.

- [ ] **Step 3: Wire C1/C4 — intro call site**

Line 769:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(ws.solaceIntroLevel) : PLAYER_SELF_INTRO;
```
becomes:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(ws.solaceIntroLevel, ws.solaceConstellation) : PLAYER_SELF_INTRO;
```

- [ ] **Step 4: Wire C6 — attunement getters**

Lines 807-808, 882-883, 931, 1172 all use `ws.attunement`/`ws.solaceSkillLevel`/`ws.attunementDoubleTurnsLeft`. Add `, ws.solaceConstellation >= 6` as the 4th argument to every `getAttunementAtkMult`/`getAttunementCritRateBonus`/`getAttunementDefMult` call in the file (6 occurrences total across those 4 line groups), e.g.:
```typescript
const teamAtkMult  = ws.isDevGuild ? getAttunementAtkMult(ws.attunement, solaceAttunementAtkCritBonus(ws.solaceSkillLevel), ws.attunementDoubleTurnsLeft > 0, ws.solaceConstellation >= 6) : 1;
```

- [ ] **Step 5: Wire C3 — Skill mode-switch burst**

Line 875:
```typescript
ws.attunement.mode = cycleAttunementMode(ws.attunement.mode);
```
becomes:
```typescript
ws.attunement.mode = cycleAttunementMode(ws.attunement.mode);
if (ws.solaceConstellation >= 3) ws.concertoEnergy = addConcertoEnergy(ws.concertoEnergy, 25);
```

- [ ] **Step 6: Wire C2 — Convergence heal + cleanse**

Lines 965-968:
```typescript
const healPct = solaceConvergenceHealPct(ws.solaceUltimateLevel);
...
{ type: "CLEANSE_ALLY", value: 1 },
```
becomes:
```typescript
const healPct = solaceConvergenceHealPct(ws.solaceUltimateLevel, ws.solaceConstellation);
...
{ type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(ws.solaceConstellation) },
```
Update every `CLEANSE_ALLY` occurrence in this Convergence branch (confirm count via `grep -n "CLEANSE_ALLY" src/commands/rpg/dungeon.ts`).

- [ ] **Step 7: Wire C5 — doubled turns**

Lines 997, 1000:
```typescript
ws.attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS + 1; // +1 compensates for the same-round decrement
...
`**${ws.attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
```
becomes:
```typescript
ws.attunementDoubleTurnsLeft = solaceUltimateDoubleTurns(ws.solaceConstellation) + 1; // +1 compensates for the same-round decrement
...
`**${ws.attunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(ws.solaceConstellation)} turns!**`;
```
Update imports: remove `SOLACE_ULTIMATE_DOUBLE_TURNS`, add `solaceUltimateDoubleTurns` and `solaceConvergenceCleanseCount` and `solaceOutroEffect` to the `../../lib/solace` import.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors referencing `dungeon.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/dungeon.ts
git commit -m "feat(dungeon): wire Solace constellation effects into dungeon fights"
```

---

## Task 9: Wire constellation into `duel.ts` (two-sided)

**Files:**
- Modify: `src/commands/rpg/duel.ts` (challenger `c*`/defender `d*` prefixed state fields on a shared `state` object; confirmed via grep: `isDevGuild` line 378, `mySolaceIntroLevel` etc. computed per-action around lines 552/641/700-701/752/763-764/790/813/849-853, `state.cConcertoEnergy`/`state.dConcertoEnergy` at 179/552)

- [ ] **Step 1: Read each side's constellation into `DuelState`**

Find `DuelState`'s interface definition (`grep -n "interface DuelState" src/commands/rpg/duel.ts`) and add two fields matching the existing `c*Level`/`d*Level` naming convention (e.g. if the state has `cSolaceIntroLevel`/`dSolaceIntroLevel`, add `cSolaceConstellation`/`dSolaceConstellation` alongside them). Find where the challenger/defender `CharacterProgress` rows are fetched at duel start (search `grep -n "solaceIntroLevel:" src/commands/rpg/duel.ts` for the object literal building the initial `DuelState`) and populate the two new fields from `cProgress?.constellation ?? 0` / `dProgress?.constellation ?? 0` (adjust exact variable names to match what's actually there).

- [ ] **Step 2: Compute `mySolaceConstellation`/`oppSolaceConstellation` alongside the existing per-turn `mySolaceIntroLevel` etc. locals**

This file recomputes `mySolaceIntroLevel = isChallenger ? state.cSolaceIntroLevel : state.dSolaceIntroLevel` (or equivalent) at the top of each button handler. Find every such block (search `grep -n "isChallenger ? state\.c.*: state\.d" src/commands/rpg/duel.ts`) and add:
```typescript
const mySolaceConstellation = isChallenger ? state.cSolaceConstellation : state.dSolaceConstellation;
```
alongside each existing `mySolaceXLevel` declaration, in every block where those exist (there are multiple near-duplicate blocks per button handler — add it to each, not just the first).

- [ ] **Step 3: Wire C1 — outro call site(s)**

Find every `SOLACE.outro` reference (`grep -n "SOLACE.outro" src/commands/rpg/duel.ts` — likely 2 occurrences, one per swap direction) and replace each with `solaceOutroEffect(mySolaceConstellation)` (or the correctly-scoped local for whichever side is swapping in that branch — verify which side's constellation applies at each specific call site, since a duel can have Solace on either or both sides).

- [ ] **Step 4: Wire C1/C4 — intro call site**

Line 641:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(mySolaceIntroLevel) : PLAYER_SELF_INTRO;
```
becomes:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(mySolaceIntroLevel, mySolaceConstellation) : PLAYER_SELF_INTRO;
```

- [ ] **Step 5: Wire C6 — attunement getters (both my-side and opp-side)**

Lines 590 (`oppAttunementDefMult`, uses `oppAttunement`/`oppAttunementDefBonus`/`oppAttunementDblTurns` — needs an `oppSolaceConstellation` local computed the same way as Step 2 but inverted), 700-701, 763-764, 790. Add `, mySolaceConstellation >= 6` (or `oppSolaceConstellation >= 6` for the opp-side call at line 590) as the 4th argument to every `getAttunementAtkMult`/`getAttunementCritRateBonus`/`getAttunementDefMult` call (confirm exact count via `grep -n "getAttunementAtkMult(\|getAttunementCritRateBonus(\|getAttunementDefMult(" src/commands/rpg/duel.ts` — expect ~7 occurrences total).

- [ ] **Step 6: Wire C3 — Skill mode-switch burst**

Line 752:
```typescript
const newMode = cycleAttunementMode(myAttunement.mode);
```
Find where `newMode` is subsequently assigned back and where the acting side's concerto energy is tracked (`state.cConcertoEnergy`/`state.dConcertoEnergy`). Add, immediately after the mode assignment lands:
```typescript
if (mySolaceConstellation >= 3) {
  if (isChallenger) state.cConcertoEnergy = addConcertoEnergy(state.cConcertoEnergy, 25);
  else state.dConcertoEnergy = addConcertoEnergy(state.dConcertoEnergy, 25);
}
```

- [ ] **Step 7: Wire C2 — Convergence heal + cleanse**

Lines 813-816:
```typescript
const healPct = solaceConvergenceHealPct(mySolaceUltimateLvl);
...
{ type: "CLEANSE_ALLY", value: 1 },
```
becomes:
```typescript
const healPct = solaceConvergenceHealPct(mySolaceUltimateLvl, mySolaceConstellation);
...
{ type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(mySolaceConstellation) },
```
Update every `CLEANSE_ALLY` occurrence in the Convergence branch.

- [ ] **Step 8: Wire C5 — doubled turns**

Lines 849, 853:
```typescript
const dbl = SOLACE_ULTIMATE_DOUBLE_TURNS + 1;
...
`**${myAttunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
```
becomes:
```typescript
const dbl = solaceUltimateDoubleTurns(mySolaceConstellation) + 1;
...
`**${myAttunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(mySolaceConstellation)} turns!**`;
```
Update imports (remove `SOLACE_ULTIMATE_DOUBLE_TURNS`, add `solaceUltimateDoubleTurns`, `solaceConvergenceCleanseCount`, `solaceOutroEffect`).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors referencing `duel.ts`.

- [ ] **Step 10: Commit**

```bash
git add src/commands/rpg/duel.ts
git commit -m "feat(duel): wire Solace constellation effects into both duel sides"
```

---

## Task 10: Wire constellation into `raid.ts` (per-participant + shared helper)

**Files:**
- Modify: `src/commands/rpg/raid.ts` (per-participant `current.*` fields on a `RaidParticipant`; a shared `partyWideTeamBonuses()` helper at lines ~448-463 wraps the 3 attunement getters for whichever participant currently has Solace active)

- [ ] **Step 1: Read constellation into `RaidParticipant`**

Find `RaidParticipant`'s interface (`grep -n "interface RaidParticipant" src/commands/rpg/raid.ts`) and add a `solaceConstellation: number` field alongside the existing `solaceIntroLevel` etc. fields. Find where participants are constructed at raid-join time (search `grep -n "solaceIntroLevel:" src/commands/rpg/raid.ts` for the object literal) and populate it from the fetched `CharacterProgress.constellation ?? 0`.

- [ ] **Step 2: Wire C6 in `partyWideTeamBonuses()`**

Read the current function body:
```bash
grep -n -A20 "function partyWideTeamBonuses" src/commands/rpg/raid.ts
```
This function iterates participants and calls `getAttunementAtkMult(ally.attunement, attuneAtkBonus, doubled)` etc. (lines 457-463 per earlier grep) for whichever participant has Solace active. Add `, ally.solaceConstellation >= 6` as the 4th argument to all three calls:
```typescript
atkMult *= getAttunementAtkMult(ally.attunement, attuneAtkBonus, doubled, ally.solaceConstellation >= 6);
critBonus += getAttunementCritRateBonus(ally.attunement, attuneAtkBonus, doubled, ally.solaceConstellation >= 6);
defMult *= getAttunementDefMult(ally.attunement, attuneDefBonus, doubled, ally.solaceConstellation >= 6);
```
(Confirm the exact local variable name holding the relevant participant — it may not literally be named `ally`; use whatever this function's real parameter/loop-variable name is.)

- [ ] **Step 3: Wire C1 — outro call site**

Find `SOLACE.outro` (`grep -n "SOLACE.outro" src/commands/rpg/raid.ts`) and replace with `solaceOutroEffect(current.solaceConstellation)` (verify `current` is the correct in-scope participant reference at that specific call site — this file's swap logic uses `current` per earlier grep at line 1041).

- [ ] **Step 4: Wire C1/C4 — intro call site**

Line 1051:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(current.solaceIntroLevel) : PLAYER_SELF_INTRO;
```
becomes:
```typescript
const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(current.solaceIntroLevel, current.solaceConstellation) : PLAYER_SELF_INTRO;
```

- [ ] **Step 5: Wire C3 — Skill mode-switch burst**

Line 1140:
```typescript
current.attunement.mode = cycleAttunementMode(current.attunement.mode);
```
becomes:
```typescript
current.attunement.mode = cycleAttunementMode(current.attunement.mode);
if (current.solaceConstellation >= 3) current.concertoEnergy = addConcertoEnergy(current.concertoEnergy, 25);
```

- [ ] **Step 6: Wire C2 — Convergence heal + cleanse**

Lines 1191, 1196:
```typescript
const healPct = solaceConvergenceHealPct(current.solaceUltimateLevel);
...
{ type: "CLEANSE_ALLY", value: 1 },
```
becomes:
```typescript
const healPct = solaceConvergenceHealPct(current.solaceUltimateLevel, current.solaceConstellation);
...
{ type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(current.solaceConstellation) },
```
Update every `CLEANSE_ALLY` occurrence in this branch.

- [ ] **Step 7: Wire C5 — doubled turns**

Lines 1230, 1233:
```typescript
current.attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS + 1; // +1 compensates for the same-round decrement
...
`**${current.attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
```
becomes:
```typescript
current.attunementDoubleTurnsLeft = solaceUltimateDoubleTurns(current.solaceConstellation) + 1; // +1 compensates for the same-round decrement
...
`**${current.attunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(current.solaceConstellation)} turns!**`;
```
Update imports (remove `SOLACE_ULTIMATE_DOUBLE_TURNS`, add `solaceUltimateDoubleTurns`, `solaceConvergenceCleanseCount`, `solaceOutroEffect`).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors anywhere in the project — this is the last file. If any errors remain, they indicate a missed call site in Tasks 4-10; grep for the specific missing symbol across the whole `src/commands/rpg/` + `src/lib/encounter.ts` to find it.

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "feat(raid): wire Solace constellation effects into raid fights"
```

---

## Task 11: Full project verification and manual playtest

**Files:** None modified — verification only.

- [ ] **Step 1: Full typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: both clean, zero errors.

- [ ] **Step 2: Force a test account to constellation 6 for a live playtest**

Write a one-off script `scripts/set-test-constellation.ts` (following the existing `scripts/*.ts` one-off convention, e.g. `compensate-topgg-vote.ts`):

```typescript
import "dotenv/config";
import prisma from "../src/lib/prisma";

const TEST_USER_ID = process.argv[2];
if (!TEST_USER_ID) { console.error("Usage: npx tsx scripts/set-test-constellation.ts <userId> [rank]"); process.exit(1); }
const rank = parseInt(process.argv[3] ?? "6", 10);

async function main() {
  await prisma.characterProgress.update({
    where: { userId_characterId: { userId: TEST_USER_ID, characterId: "solace" } },
    data: { constellation: rank, constellationTokens: 5 },
  });
  console.log(`Set constellation=${rank}, tokens=5 for ${TEST_USER_ID}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

Run it locally against your own test account: `npx tsx scripts/set-test-constellation.ts <your-user-id> 6`

- [ ] **Step 3: Deploy to the dev environment and manually verify each effect**

Deploy per the project's standard flow (build, push, `pm2 restart` on the VM — or test locally against the dev guild first). With the test account at C6, using `/encounter` (simplest surface) with Solace on the team:

- Swap Solace out: confirm the incoming ally's next action shows a visible +15% ATK buff applied (C1).
- Use Convergence (Ultimate): confirm the heal % is noticeably higher than pre-constellation numbers and the message states 2 debuffs cleansed (C2).
- Use Skill (mode switch): confirm Concerto Energy jumps by 25 beyond the normal per-move gain (C3).
- Swap Solace in: confirm the heal message also shows a shield amount applied (C4).
- Trigger Convergence's doubled-mode window: confirm it lasts 4 turns instead of 3 (C5) — count turns in the embed's status line.
- With one Attunement mode active, confirm ATK/Crit/DEF stat lines (via `/stats` mid-fight if available, or the embed's damage numbers) reflect a partial (50%) bonus from the two inactive modes (C6).

- [ ] **Step 4: Test the unlock button and race guard**

Run `/character` → Constellations with the test account reset to `constellation: 0, constellationTokens: 1` (rerun the script from Step 2 with rank 0). Click "Unlock C1" — confirm the page re-renders showing C1 lit and 0 tokens remaining. Rapidly double-click (or re-issue) the same unlock action with only 1 token banked — confirm only one rank was actually consumed (no double-spend).

- [ ] **Step 5: Delete the one-off test script**

```bash
rm scripts/set-test-constellation.ts
git add scripts/set-test-constellation.ts
git commit -m "chore: remove one-off constellation test script"
```

- [ ] **Step 6: Final commit confirming the feature is complete**

If Steps 1-4 all passed with no code changes needed, no further commit is required — the feature is done as of Task 10's commit. If any playtest step in Step 3/4 revealed a bug, fix it in the relevant file from Tasks 1-10, re-run Step 1's typecheck, and commit the fix separately with a clear message (e.g. `fix(raid): C3 burst wasn't applying to the correct participant`).
