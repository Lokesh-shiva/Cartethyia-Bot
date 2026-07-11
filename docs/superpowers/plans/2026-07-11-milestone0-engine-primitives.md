# Milestone 0 — Engine Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three new Layer 1 combat primitives from `docs/superpowers/specs/2026-07-11-multi-character-teams-design.md` (§4) as isolated, pure-function library modules — the minimal debuff system, Concerto Energy, and ally-targeted actions — verified via assertion scripts and a composition simulation. Zero changes to any existing command or combat loop in this milestone; nothing here is player-facing yet.

**Architecture:** Three independent `src/lib/*.ts` modules, each a small typed vocabulary + pure functions, mirroring the existing `abilityEffects.ts` composable-primitive shape. No new dependencies, no schema changes, no new commands. Verified with plain `node:assert`-based scripts run via `npx tsx` (matches this project's existing convention — there is no Jest/Vitest in this repo; verification has always been ad-hoc `tsx` scripts, e.g. `scripts/migrate-stats.ts`).

**Tech Stack:** TypeScript, `npx tsx` for running scripts, Node's built-in `assert` module (no new package needed).

---

### Task 1: Debuff System

**Files:**
- Create: `src/lib/debuffs.ts`
- Test: `scripts/test-debuffs.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-debuffs.ts
// Usage: npx tsx scripts/test-debuffs.ts
import assert from "assert";
import {
  applyDebuff, tickDebuffs, getWeakenedMult, getVulnerableMult, cleanseDebuffs,
  DebuffState,
} from "../src/lib/debuffs";

// applyDebuff adds a new debuff
let state: DebuffState = [];
state = applyDebuff(state, "WEAKENED", 0.2, 3);
assert.strictEqual(state.length, 1);
assert.strictEqual(state[0].type, "WEAKENED");
assert.strictEqual(state[0].value, 0.2);
assert.strictEqual(state[0].turnsLeft, 3);

// applyDebuff on an already-active type REFRESHES (replaces), doesn't stack
state = applyDebuff(state, "WEAKENED", 0.35, 5);
assert.strictEqual(state.length, 1, "same debuff type should refresh, not stack");
assert.strictEqual(state[0].value, 0.35);
assert.strictEqual(state[0].turnsLeft, 5);

// Different debuff types coexist
state = applyDebuff(state, "VULNERABLE", 0.15, 2);
state = applyDebuff(state, "BLEED", 40, 4);
assert.strictEqual(state.length, 3);

// getWeakenedMult / getVulnerableMult reflect active values
assert.strictEqual(getWeakenedMult(state), 1 - 0.35);
assert.strictEqual(getVulnerableMult(state), 1 + 0.15);
assert.strictEqual(getWeakenedMult([]), 1, "no debuff = no multiplier change");
assert.strictEqual(getVulnerableMult([]), 1, "no debuff = no multiplier change");

// tickDebuffs decrements turns, returns bleed damage, drops expired entries
let tickResult = tickDebuffs(state); // WEAKENED 5->4, VULNERABLE 2->1, BLEED 4->3
assert.strictEqual(tickResult.bleedDamage, 40);
assert.strictEqual(tickResult.state.length, 3);
assert.strictEqual(tickResult.state.find(d => d.type === "WEAKENED")!.turnsLeft, 4);

state = tickResult.state;
tickResult = tickDebuffs(state); // VULNERABLE 1->0, should be removed
assert.strictEqual(tickResult.state.some(d => d.type === "VULNERABLE"), false, "expired debuff should be removed");
assert.strictEqual(tickResult.state.length, 2, "WEAKENED and BLEED still active");

// cleanseDebuffs removes up to N debuffs
state = tickResult.state; // [WEAKENED, BLEED] at this point (order preserved)
const cleansed = cleanseDebuffs(state, 1);
assert.strictEqual(cleansed.length, 1, "cleansing 1 of 2 debuffs should leave 1");

console.log("✓ all debuff system tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-debuffs.ts`
Expected: FAIL — `Cannot find module '../src/lib/debuffs'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/debuffs.ts
// Minimal composable debuff system — see docs/superpowers/specs/2026-07-11-multi-character-teams-design.md §4.5
// Deliberately excludes Silence-style debuffs (needs button-disabling UI infra that doesn't exist yet).

export type DebuffType = "WEAKENED" | "VULNERABLE" | "BLEED";

export interface ActiveDebuff {
  type:      DebuffType;
  value:     number; // WEAKENED/VULNERABLE: fraction (0.2 = 20%). BLEED: flat damage per tick.
  turnsLeft: number;
}

export type DebuffState = ActiveDebuff[];

// Applying a debuff of a type that's already active REPLACES it (refresh, not stack) —
// matches the existing DEF Shred pattern (raid.ts) which always overwrites rather than
// accumulating duplicate stacks.
export function applyDebuff(state: DebuffState, type: DebuffType, value: number, turns: number): DebuffState {
  const withoutType = state.filter(d => d.type !== type);
  return [...withoutType, { type, value, turnsLeft: turns }];
}

// Call at the start of the affected unit's turn. Decrements durations, drops anything that
// expired, and returns the total BLEED damage to apply this turn.
export function tickDebuffs(state: DebuffState): { state: DebuffState; bleedDamage: number } {
  let bleedDamage = 0;
  const next: ActiveDebuff[] = [];
  for (const d of state) {
    if (d.type === "BLEED") bleedDamage += d.value;
    const turnsLeft = d.turnsLeft - 1;
    if (turnsLeft > 0) next.push({ ...d, turnsLeft });
  }
  return { state: next, bleedDamage };
}

export function getWeakenedMult(state: DebuffState): number {
  const d = state.find(x => x.type === "WEAKENED");
  return d ? Math.max(0, 1 - d.value) : 1;
}

export function getVulnerableMult(state: DebuffState): number {
  const d = state.find(x => x.type === "VULNERABLE");
  return d ? 1 + d.value : 1;
}

// Removes up to `count` debuffs (oldest-applied first). Used by cleanse effects
// (e.g. Solace's Ultimate cleanses 1, or 2 at Constellation 2).
export function cleanseDebuffs(state: DebuffState, count: number): DebuffState {
  return state.slice(count);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-debuffs.ts`
Expected: `✓ all debuff system tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/debuffs.ts scripts/test-debuffs.ts
git commit -m "feat(teams): add minimal debuff system (Milestone 0)"
```

---

### Task 2: Concerto Energy

**Files:**
- Create: `src/lib/concertoEnergy.ts`
- Test: `scripts/test-concerto-energy.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-concerto-energy.ts
// Usage: npx tsx scripts/test-concerto-energy.ts
import assert from "assert";
import { addConcertoEnergy, spendConcertoEnergy, CONCERTO_ENERGY_MAX } from "../src/lib/concertoEnergy";

assert.strictEqual(CONCERTO_ENERGY_MAX, 100);

// addConcertoEnergy accumulates normally
assert.strictEqual(addConcertoEnergy(0, 30), 30);
assert.strictEqual(addConcertoEnergy(30, 40), 70);

// addConcertoEnergy clamps at max
assert.strictEqual(addConcertoEnergy(90, 50), 100);

// spendConcertoEnergy succeeds when sufficient, returns the new value
assert.strictEqual(spendConcertoEnergy(100, 40), 60);
assert.strictEqual(spendConcertoEnergy(40, 40), 0);

// spendConcertoEnergy returns null when insufficient (spend rejected, caller must not deduct)
assert.strictEqual(spendConcertoEnergy(30, 40), null);

console.log("✓ all Concerto Energy tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-concerto-energy.ts`
Expected: FAIL — `Cannot find module '../src/lib/concertoEnergy'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/concertoEnergy.ts
// Shared, team-wide resource — distinct from each character's existing personal Energy
// meter. Persists across swaps (unlike personal Energy, which is tied to whichever
// character is currently active). See design spec §4.1.

export const CONCERTO_ENERGY_MAX = 100;

export function addConcertoEnergy(current: number, amount: number): number {
  return Math.min(CONCERTO_ENERGY_MAX, current + amount);
}

// Returns null if insufficient energy (caller must not deduct/act on a null result),
// otherwise the new post-spend value.
export function spendConcertoEnergy(current: number, amount: number): number | null {
  if (current < amount) return null;
  return current - amount;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-concerto-energy.ts`
Expected: `✓ all Concerto Energy tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/concertoEnergy.ts scripts/test-concerto-energy.ts
git commit -m "feat(teams): add Concerto Energy shared resource (Milestone 0)"
```

---

### Task 3: Ally-Targeted Actions

**Files:**
- Create: `src/lib/allyActions.ts`
- Test: `scripts/test-ally-actions.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-ally-actions.ts
// Usage: npx tsx scripts/test-ally-actions.ts
import assert from "assert";
import { applyAllyAction, AllyActionTarget } from "../src/lib/allyActions";

const target: AllyActionTarget = { hp: 500, hpMax: 1000 };

// HEAL_ALLY — flat amount derived from target's max HP
let result = applyAllyAction({ type: "HEAL_ALLY", value: 0.2 }, target);
assert.strictEqual(result.hpDelta, 200);
assert.strictEqual(result.shieldDelta, 0);
assert.strictEqual(result.atkBuffPct, 0);
assert.strictEqual(result.cleanseCount, 0);

// SHIELD_ALLY — flat amount derived from target's max HP
result = applyAllyAction({ type: "SHIELD_ALLY", value: 0.3 }, target);
assert.strictEqual(result.shieldDelta, 300);
assert.strictEqual(result.hpDelta, 0);

// BUFF_ALLY_ATK — passes the percentage through for the caller to wire into bonuses
result = applyAllyAction({ type: "BUFF_ALLY_ATK", value: 0.15 }, target);
assert.strictEqual(result.atkBuffPct, 0.15);
assert.strictEqual(result.hpDelta, 0);

// CLEANSE_ALLY — passes the debuff count through for the caller to hand to cleanseDebuffs()
result = applyAllyAction({ type: "CLEANSE_ALLY", value: 2 }, target);
assert.strictEqual(result.cleanseCount, 2);
assert.strictEqual(result.hpDelta, 0);

console.log("✓ all ally-action tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-ally-actions.ts`
Expected: FAIL — `Cannot find module '../src/lib/allyActions'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/allyActions.ts
// Composable ally-targeted action primitives — what Intro/Outro Skills and support
// kits (e.g. Solace's Attunement) are built FROM. See design spec §4.3.
// These are pure result-computers; callers (future combat-loop wiring in later
// milestones) are responsible for clamping hp to hpMax, applying shield/buff state,
// and calling debuffs.ts's cleanseDebuffs() with the returned cleanseCount.

export type AllyActionType = "HEAL_ALLY" | "SHIELD_ALLY" | "BUFF_ALLY_ATK" | "CLEANSE_ALLY";

export interface AllyAction {
  type:  AllyActionType;
  // HEAL_ALLY / SHIELD_ALLY: fraction of target's max HP.
  // BUFF_ALLY_ATK: fraction ATK bonus.
  // CLEANSE_ALLY: number of debuffs to remove.
  value: number;
}

export interface AllyActionTarget {
  hp:    number;
  hpMax: number;
}

export interface AllyActionResult {
  hpDelta:     number; // heal amount — caller adds to target.hp and clamps to hpMax
  shieldDelta: number; // shield amount to grant
  atkBuffPct:  number; // ATK% buff to apply to target
  cleanseCount: number; // debuff count to remove via debuffs.ts's cleanseDebuffs()
}

export function applyAllyAction(action: AllyAction, target: AllyActionTarget): AllyActionResult {
  const result: AllyActionResult = { hpDelta: 0, shieldDelta: 0, atkBuffPct: 0, cleanseCount: 0 };
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
    case "CLEANSE_ALLY":
      result.cleanseCount = action.value;
      break;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-ally-actions.ts`
Expected: `✓ all ally-action tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/allyActions.ts scripts/test-ally-actions.ts
git commit -m "feat(teams): add composable ally-targeted action primitives (Milestone 0)"
```

---

### Task 4: Intro/Outro Hook Type

Defines Intro/Outro as their own named concept (per design spec §4.4) — a composed list of `AllyAction`s (Task 3) that fire at a swap moment, PLUS an optional damage component against the enemy (matching WuWa, where Intro Skills especially are often a real attack, not just a buff — Solace's are pure-utility by design since she's a support, but the hook type itself must support damage for future DPS-archetype characters). This task builds the type and a resolver; wiring "a player actually got swapped in/out" into a real turn loop, and resolving the actual damage number (which needs DEF/crit/etc. from a real combat loop), is Milestone 1+.

**Files:**
- Create: `src/lib/introOutro.ts`
- Test: `scripts/test-intro-outro.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-intro-outro.ts
// Usage: npx tsx scripts/test-intro-outro.ts
import assert from "assert";
import { resolveIntroOutroEffect, IntroOutroEffect } from "../src/lib/introOutro";
import { AllyActionTarget } from "../src/lib/allyActions";

const target: AllyActionTarget = { hp: 500, hpMax: 1000 };

// An Intro Skill that heals + cleanses (matches Solace's Intro Skill shape from the spec)
const introEffect: IntroOutroEffect = {
  actions: [
    { type: "HEAL_ALLY", value: 0.2 },
    { type: "CLEANSE_ALLY", value: 1 },
  ],
};
let result = resolveIntroOutroEffect(introEffect, target);
assert.strictEqual(result.hpDelta, 200);
assert.strictEqual(result.cleanseCount, 1);
assert.strictEqual(result.shieldDelta, 0);

// An Outro Skill that shields + buffs ATK (matches Solace's Outro Skill shape)
const outroEffect: IntroOutroEffect = {
  actions: [
    { type: "SHIELD_ALLY", value: 0.15 },
    { type: "BUFF_ALLY_ATK", value: 0.1 },
  ],
};
result = resolveIntroOutroEffect(outroEffect, target);
assert.strictEqual(result.shieldDelta, 150);
assert.strictEqual(result.atkBuffPct, 0.1);

// An empty effect resolves to all zeros (e.g. the player's own character, per spec §2's
// universal-but-generic exception — a genuinely empty/minimal effect is a valid case)
result = resolveIntroOutroEffect({ actions: [] }, target);
assert.strictEqual(result.hpDelta, 0);
assert.strictEqual(result.shieldDelta, 0);
assert.strictEqual(result.atkBuffPct, 0);
assert.strictEqual(result.cleanseCount, 0);
assert.strictEqual(result.dmgMult, 0, "no dmgMult specified should resolve to 0 (no damage)");

// A DPS-archetype Intro Skill: real damage, no utility actions — e.g. a future
// character whose Intro is "deal 150% ATK damage to the enemy on swap-in"
const dpsIntro: IntroOutroEffect = { actions: [], dmgMult: 1.5 };
result = resolveIntroOutroEffect(dpsIntro, target);
assert.strictEqual(result.dmgMult, 1.5);
assert.strictEqual(result.hpDelta, 0, "pure-damage hook should not affect ally HP");

// Damage and utility actions can combine on the same hook (e.g. a hybrid Outro:
// deal some damage AND shield the incoming ally)
const hybridOutro: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.1 }], dmgMult: 0.8 };
result = resolveIntroOutroEffect(hybridOutro, target);
assert.strictEqual(result.dmgMult, 0.8);
assert.strictEqual(result.shieldDelta, 100);

console.log("✓ all Intro/Outro hook tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-intro-outro.ts`
Expected: FAIL — `Cannot find module '../src/lib/introOutro'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/introOutro.ts
// Intro/Outro Skill hook points — see design spec §4.4. A hook is a composed list of
// ally-actions (allyActions.ts) that fire at a specific swap moment, plus an optional
// damage component against the enemy — matching WuWa, where Intro Skills especially
// are often a real attack, not just a buff. Solace's Intro/Outro are pure-utility
// (dmgMult omitted) since she's a support, but this type supports damage for future
// DPS-archetype characters.
//
// This milestone defines the type + a single-target resolver; wiring "a character
// was actually swapped in/out" into a real turn loop, and resolving dmgMult into an
// actual damage number (needs DEF/crit/etc. from a real combat loop), is Milestone 1+.

import { AllyAction, applyAllyAction, AllyActionTarget, AllyActionResult } from "./allyActions";

export interface IntroOutroEffect {
  actions:  AllyAction[]; // ally-targeted utility effects (heal/shield/buff/cleanse)
  dmgMult?: number;       // if present, this hook also deals damage to the enemy —
                          // damage = wielder's ATK * dmgMult, resolved via the
                          // standard calcPlayerDamage path once wired in Milestone 1+
}

export interface IntroOutroResult extends AllyActionResult {
  dmgMult: number; // 0 if this hook deals no damage
}

// Resolves every ally-action in the hook against a single target, summing the
// results, and passes dmgMult through unchanged (actual damage resolution needs
// DEF/crit/etc. that only exists once this is wired into a real combat loop).
// Individual actions targeting different allies (e.g. Outro shielding the incoming
// character while something else affects the whole team) is a Milestone 1+ concern
// once real swap targeting exists — this covers the common single-target case.
export function resolveIntroOutroEffect(effect: IntroOutroEffect, target: AllyActionTarget): IntroOutroResult {
  const total: IntroOutroResult = { hpDelta: 0, shieldDelta: 0, atkBuffPct: 0, cleanseCount: 0, dmgMult: effect.dmgMult ?? 0 };
  for (const action of effect.actions) {
    const r = applyAllyAction(action, target);
    total.hpDelta       += r.hpDelta;
    total.shieldDelta    += r.shieldDelta;
    total.atkBuffPct     += r.atkBuffPct;
    total.cleanseCount   += r.cleanseCount;
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-intro-outro.ts`
Expected: `✓ all Intro/Outro hook tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/introOutro.ts scripts/test-intro-outro.ts
git commit -m "feat(teams): add Intro/Outro hook type + resolver (Milestone 0)"
```

---

### Task 5: Composition Simulation

Proves the four modules work together as a system — the "batch simulation" verification called for in design spec §3, scoped down to a single deterministic scripted sequence since there's no real character kit or combat loop to run a full Monte Carlo simulation against yet (that comes in Milestone 1/2).

**Files:**
- Create: `scripts/simulate-milestone0.ts`

- [ ] **Step 1: Write the simulation script**

```typescript
// scripts/simulate-milestone0.ts
// Usage: npx tsx scripts/simulate-milestone0.ts
//
// Scripted scenario proving the three Milestone 0 primitives compose correctly:
// an enemy debuffs a player, a teammate heals + cleanses them via an ally action,
// and Concerto Energy accumulates across turns to a spend threshold — all without
// any real combat loop existing yet.
import assert from "assert";
import { applyDebuff, tickDebuffs, getWeakenedMult, cleanseDebuffs, DebuffState } from "../src/lib/debuffs";
import { addConcertoEnergy, spendConcertoEnergy } from "../src/lib/concertoEnergy";
import { AllyActionTarget } from "../src/lib/allyActions";
import { resolveIntroOutroEffect, IntroOutroEffect } from "../src/lib/introOutro";

console.log("--- Turn 1: enemy applies WEAKENED to the active player ---");
let playerDebuffs: DebuffState = [];
playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.3, 3);
let playerAtk = 1000 * getWeakenedMult(playerDebuffs);
assert.strictEqual(playerAtk, 700, "WEAKENED should reduce effective ATK by 30%");
console.log(`Player ATK reduced to ${playerAtk} (from 1000, WEAKENED -30%)`);

let concerto = 0;
concerto = addConcertoEnergy(concerto, 25); // basic attack builds team energy
console.log(`Concerto Energy: ${concerto}/100`);

console.log("\n--- Turn 2: a benched support swaps in — Intro Skill heals + cleanses ---");
const player: AllyActionTarget = { hp: 400, hpMax: 1000 };
const introEffect: IntroOutroEffect = {
  actions: [
    { type: "HEAL_ALLY", value: 0.25 },
    { type: "CLEANSE_ALLY", value: 1 },
  ],
};
const introResult = resolveIntroOutroEffect(introEffect, player);
const newHp = Math.min(player.hpMax, player.hp + introResult.hpDelta);
assert.strictEqual(newHp, 650, "Intro heal should restore 25% of max HP");
console.log(`Player healed ${introResult.hpDelta} HP (${player.hp} -> ${newHp})`);

playerDebuffs = cleanseDebuffs(playerDebuffs, introResult.cleanseCount);
assert.strictEqual(playerDebuffs.length, 0, "cleanse should remove the WEAKENED debuff");
playerAtk = 1000 * getWeakenedMult(playerDebuffs);
assert.strictEqual(playerAtk, 1000, "ATK should be back to full after cleanse");
console.log(`WEAKENED cleansed — player ATK restored to ${playerAtk}`);

concerto = addConcertoEnergy(concerto, 30);
console.log(`Concerto Energy: ${concerto}/100`);

console.log("\n--- Turn 3: BLEED ticks on an unrelated enemy-side debuff target ---");
let enemyDebuffs: DebuffState = applyDebuff([], "BLEED", 50, 2);
const tick = tickDebuffs(enemyDebuffs);
assert.strictEqual(tick.bleedDamage, 50, "BLEED should deal its flat value this tick");
enemyDebuffs = tick.state;
console.log(`BLEED ticked for ${tick.bleedDamage} damage, ${enemyDebuffs[0].turnsLeft} turn(s) remaining`);

concerto = addConcertoEnergy(concerto, 50);
console.log(`Concerto Energy: ${concerto}/100`);

console.log("\n--- Turn 4: team spends Concerto Energy on a team-wide Ultimate ---");
const spendResult = spendConcertoEnergy(concerto, 80);
assert.notStrictEqual(spendResult, null, "should have enough energy to spend by now");
console.log(`Concerto Energy spent: ${concerto} -> ${spendResult}`);

console.log("\n✓ Milestone 0 primitives compose correctly end-to-end");
```

- [ ] **Step 2: Run the simulation**

Run: `npx tsx scripts/simulate-milestone0.ts`
Expected: All assertions pass, ends with `✓ Milestone 0 primitives compose correctly end-to-end`

- [ ] **Step 3: Commit**

```bash
git add scripts/simulate-milestone0.ts
git commit -m "test(teams): add Milestone 0 composition simulation"
```

---

## Explicitly out of scope for this plan

- Any change to an existing command or combat loop (`ascend.ts`, `boss.ts`, `dungeon.ts`, `duel.ts`, `raid.ts`, `field-boss.ts`, `encounter.ts`) — that's Milestone 1.
- Solace's actual kit, Wellspring, constellations, Forte — Milestone 2.
- Intro/Outro as *trigger points wired into a turn loop* — Milestone 1+ (this plan builds the ally-action primitives Intro/Outro effects will be built FROM, not the turn-loop hook itself, since there's no team turn loop yet).
- Any gacha/banner/currency work — Milestone 4.
- Any schema change — none of this milestone's state needs to persist to the database yet; it's all in-memory combat-turn state, matching how existing per-fight state (`glacioShieldTurnsLeft`, `stormBuffTurnsLeft`, etc.) already works in the current combat loops.
