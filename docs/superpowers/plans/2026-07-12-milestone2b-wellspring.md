# Milestone 2b — Wellspring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Solace her signature weapon's passive mechanic — a flat power boost while she's on the field plus an amplifier on whichever Attunement mode is active — proving the "signature weapon synergizes with a specific character's mechanic" pattern in the now-proven `/encounter` engine. Still dev-guild-gated, still `/encounter` only, still hardcoded (not a real ownable item).

**Architecture:** One new small data module (`src/lib/wellspring.ts`, mirroring `src/lib/attunement.ts`'s shape — constants + pure getter functions) plus surgical edits to `src/lib/encounter.ts` at the same touch points Attunement itself already modifies (Basic, Ultimate, enemy-damage DEF calc, Concerto Energy gain). No schema changes, no `WEAPON_PASSIVES` entry, no `/equip` integration — see the [design spec](../specs/2026-07-11-milestone2b-wellspring-design.md) §1 for why.

**Explicitly deferred to their own follow-up plans, not built here:**
- R2–R5 refinement (needs a duplicate-ownership/refinement-tracking system that doesn't exist yet).
- Real acquisition via `/wish`.
- Per-character equip slots (Wellspring stays hardcoded onto Solace until that infrastructure exists).

**Tech Stack:** TypeScript, Milestone 2a's `attunement.ts` primitive. No schema changes — same in-memory per-fight state pattern as prior milestones.

---

### Task 1: Wellspring Data Module

**Files:**
- Create: `src/lib/wellspring.ts`
- Modify: `scripts/test-attunement.ts` (append tests — small enough not to warrant its own test file, matching the design spec §5)

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-attunement.ts` (after the existing `console.log("✓ all Attunement primitive tests passed");` line):

```typescript

// ── Wellspring (Milestone 2b) ────────────────────────────────────────────────
import { getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus } from "../src/lib/wellspring";

assert.strictEqual(getWellspringAtkBonus({ mode: "ATK" }), 0.10, "ATK mode grants Wellspring's ATK amplifier");
assert.strictEqual(getWellspringAtkBonus({ mode: "CRIT" }), 0, "inactive mode grants nothing");
assert.strictEqual(getWellspringAtkBonus({ mode: null }), 0, "no mode grants nothing");

assert.strictEqual(getWellspringCritRateBonus({ mode: "CRIT" }), 0.10, "CRIT mode grants Wellspring's crit-rate amplifier");
assert.strictEqual(getWellspringCritRateBonus({ mode: "ATK" }), 0, "inactive mode grants nothing");

assert.strictEqual(getWellspringDefBonus({ mode: "DEF" }), 0.12, "DEF mode grants Wellspring's DEF amplifier");
assert.strictEqual(getWellspringDefBonus({ mode: "ATK" }), 0, "inactive mode grants nothing");

console.log("✓ all Wellspring primitive tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-attunement.ts`
Expected: FAIL — `Cannot find module '../src/lib/wellspring'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/wellspring.ts
// Wellspring — Solace's signature weapon, Milestone 2b. See design spec
// docs/superpowers/specs/2026-07-11-milestone2b-wellspring-design.md.
//
// This is NOT a real, ownable Weapon DB row yet — no per-character equip slot
// exists (see that spec's §1). It's hardcoded directly onto Solace as a
// stopgap: always-on while she's the active unit, not swappable, not shared
// with the player's own /equip weapon. A future milestone turns this into a
// real item once per-character loadouts exist — do not treat this file as
// the permanent home for Wellspring's data once that happens.

import { AttunementState } from "./attunement";

// Base effect — always active whenever Solace is the attacker. Reuses the
// existing ATK_BOOST/ENERGY_BOOST primitives' VALUES (not their plumbing —
// see encounter.ts wiring for why: Solace never touches state.playerEnergy).
export const WELLSPRING_BASE_ATK_MULT     = 1.18; // +18% ATK — top of ATK_BOOST's existing 8-18% registry range
export const WELLSPRING_BASE_ENERGY_BONUS = 12;   // +12 flat Concerto Energy on her own actions

// Bonus effect — amplifies whichever Attunement mode is currently active.
// Fires for either unit (mirrors how Attunement's own buff already applies
// uniformly regardless of who's attacking) — this is Wellspring being in the
// fight at all, not Wellspring being wielded by whoever's currently acting.
// Does NOT get doubled by Convergence — only Attunement's own bonus does.
export function getWellspringAtkBonus(state: AttunementState): number {
  return state.mode === "ATK" ? 0.10 : 0;
}
export function getWellspringCritRateBonus(state: AttunementState): number {
  return state.mode === "CRIT" ? 0.10 : 0;
}
export function getWellspringDefBonus(state: AttunementState): number {
  return state.mode === "DEF" ? 0.12 : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-attunement.ts`
Expected: `✓ all Attunement primitive tests passed` followed by `✓ all Wellspring primitive tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/wellspring.ts scripts/test-attunement.ts
git commit -m "feat(teams): add Wellspring passive primitive (Milestone 2b)"
```

---

### Task 2: Wire Wellspring into `/encounter`

**Context:** Wellspring's effects land at exactly the same touch points Attunement itself already modifies in `src/lib/encounter.ts` — this task is a set of small, additive edits alongside existing Attunement logic, not new branches.

**Files:**
- Modify: `src/lib/encounter.ts`

- [ ] **Step 1: Add the import**

Find:
```typescript
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "./attunement";
```

Replace with:
```typescript
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "./attunement";
import {
  WELLSPRING_BASE_ATK_MULT, WELLSPRING_BASE_ENERGY_BONUS,
  getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus,
} from "./wellspring";
```

- [ ] **Step 2: Apply Wellspring's base + mode-amplifier bonuses to Basic Attack**

Find:
```typescript
      if (btn.customId === "enc_basic") {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement, attunementDoubleTurnsLeft > 0) : 0)), stats.critDmg, 1.0, isWeak, state.isShattered);
```

Replace with:
```typescript
      if (btn.customId === "enc_basic") {
        // Wellspring: base ATK boost only while Solace is actually attacking
        // (it's hardcoded onto her, not the player's own weapon); the mode
        // amplifier applies regardless of who's attacking, same scope as
        // Attunement's own bonus.
        const wellspringAtkMult   = isDevGuild && activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
        const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * wellspringAtkMult * (1 + wellspringAtkBonus);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement, attunementDoubleTurnsLeft > 0) : 0) + wellspringCritBonus), stats.critDmg, 1.0, isWeak, state.isShattered);
```

- [ ] **Step 3: Apply Wellspring's mode-amplifier to the player's own Ultimate**

Find:
```typescript
      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

Replace with:
```typescript
      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        // No base ATK boost here — this branch only ever runs for the
        // player's own Ultimate (Solace's Ultimate is the else-if branch
        // below, which deals no damage), and the base boost is Solace-only.
        const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringAtkBonus);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

- [ ] **Step 4: Apply Wellspring's DEF-mode amplifier to incoming enemy damage**

Find:
```typescript
        const attunementDefMult = isDevGuild ? getAttunementDefMult(attunement, attunementDoubleTurnsLeft > 0) : 1;
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
```

Replace with:
```typescript
        const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
        const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus);
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
```

- [ ] **Step 5: Apply Wellspring's Energy Regen to Solace's own Concerto Energy gain**

Find:
```typescript
      if (isDevGuild) {
        const concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
        if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
      }
```

Replace with:
```typescript
      if (isDevGuild) {
        let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
        // Wellspring's Energy Regen passive — only while Solace is the one
        // acting (it's hardcoded onto her, not a shared account-level weapon,
        // so it shouldn't boost the player's own turns).
        if (concertoGain > 0 && activeUnit === "ally") concertoGain += WELLSPRING_BASE_ENERGY_BONUS;
        if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
      }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): wire Wellspring's passive into /encounter (Milestone 2b)"
```

---

### Task 3: Verification

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
npx tsx scripts/test-attunement.ts
grep -n "isDevGuild" src/lib/encounter.ts   # re-audit every new Wellspring branch is still gated
```

- [ ] **Step 2: Manual — deploy and playtest**

```bash
npm run deploy   # not needed, no new slash command — a restart is enough
```
then on the VM: `git pull && npm run build && pm2 restart cartethyia`

In the dev guild, fight an encounter and verify:
- [ ] Swap to Solace, attack with Chime Strike — damage is noticeably higher than before this milestone (base +18% ATK) and Concerto Energy fills faster than the player's own Basic Attack would (+12 bonus on top of the normal +10 for Basic)
- [ ] Cycle Attunement to ATK mode, swap back to yourself, attack — damage is bigger than ATK mode alone was in Milestone 2a (Attunement's own +15% plus Wellspring's +10% now stack)
- [ ] Same check for CRIT mode (more crits than Attunement-only) and DEF mode (less incoming damage than Attunement-only)
- [ ] Trigger Convergence, then attack again during the 3 doubled turns — Attunement's own bonus is doubled, but Wellspring's flat amplifier is NOT (should look like a big-but-not-double jump versus a pre-Convergence hit with Wellspring active)
- [ ] Non-dev-guild `/encounter` is still completely unaffected (spot-check another server)

- [ ] **Step 3: Report findings back**

Same as before — if something's off, tell me exactly what you saw and I'll fix it directly rather than re-planning from scratch.
