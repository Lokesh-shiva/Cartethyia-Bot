# Milestone 2c — Forte (Solace's Gauge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Solace an in-combat Forte gauge — fills from Chime Strike, and at full charge her next Convergence becomes Empowered (a smaller version of all 3 Attunement Modes at once, instead of doubling only the active one). Still dev-guild-gated, still `/encounter` only.

**Architecture:** A new **generic, character-agnostic** gauge primitive (`src/lib/forte.ts`) — pure phase/charge math with zero knowledge of Solace, Attunement, or "3 modes." Solace's specific fill rate and Empowered-Ultimate payoff live in `src/lib/solace.ts` alongside her existing `intro`/`outro` data. Wiring into `src/lib/encounter.ts` follows the exact additive-term pattern Milestone 2b established for Wellspring — no changes to `attunement.ts` or `wellspring.ts`. See the [design spec](../specs/2026-07-12-milestone2c-forte-design.md) for full rationale.

**Explicitly deferred to their own follow-up plans, not built here:**
- Out-of-combat kit-leveling (needs a new "character level" DB concept + material economy).
- Constellation C3/C6 (blocked on the missing gacha/ownership system, same as all Constellations).

**Tech Stack:** TypeScript. No schema changes — same in-memory per-fight state pattern as prior milestones.

---

### Task 1: Forte Gauge Primitive (generic)

**Files:**
- Create: `src/lib/forte.ts`
- Modify: `scripts/test-attunement.ts` (append tests)

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-attunement.ts` (after the existing Wellspring test block's `console.log("✓ all Wellspring primitive tests passed");` line):

```typescript

// ── Forte (Milestone 2c) — generic gauge primitive ───────────────────────────
import { addForteCharge, isForteMaxed, resetForte, ForteConfig, ForteState } from "../src/lib/forte";

const singlePhase: ForteConfig = { phaseThresholds: [100] };
const multiPhase:  ForteConfig = { phaseThresholds: [50, 50, 100] };

// Single-phase accumulation
let fs: ForteState = { phase: 0, charge: 0 };
fs = addForteCharge(fs, singlePhase, 30);
assert.deepStrictEqual(fs, { phase: 0, charge: 30 }, "charge accumulates within the only phase");
assert.strictEqual(isForteMaxed(fs, singlePhase), false, "not maxed until the phase threshold is hit");

fs = addForteCharge(fs, singlePhase, 70);
assert.deepStrictEqual(fs, { phase: 1, charge: 0 }, "phase completes exactly at threshold, no overflow into a nonexistent phase 2");
assert.strictEqual(isForteMaxed(fs, singlePhase), true, "maxed once the only phase is complete");

// Multi-phase rollover — a single large addition crosses more than one phase boundary
let mfs: ForteState = { phase: 0, charge: 0 };
mfs = addForteCharge(mfs, multiPhase, 120); // 50 (phase 0->1) + 50 (phase 1->2) + 20 into phase 2
assert.deepStrictEqual(mfs, { phase: 2, charge: 20 }, "a big single addition rolls over multiple phase boundaries correctly");
assert.strictEqual(isForteMaxed(mfs, multiPhase), false, "phase 2 of 3 needs 100 more, not maxed yet");

mfs = addForteCharge(mfs, multiPhase, 80);
assert.deepStrictEqual(mfs, { phase: 3, charge: 0 }, "final phase completes exactly at its threshold");
assert.strictEqual(isForteMaxed(mfs, multiPhase), true, "maxed once ALL phases are complete");

// Cap at final phase — does not roll past the last phase even with excess charge
let capped: ForteState = { phase: 2, charge: 90 };
capped = addForteCharge(capped, multiPhase, 500);
assert.deepStrictEqual(capped, { phase: 3, charge: 0 }, "overflow past the final phase's threshold is discarded, not carried anywhere");

// Reset
assert.deepStrictEqual(resetForte(), { phase: 0, charge: 0 }, "resetForte returns to empty");

console.log("✓ all Forte primitive tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-attunement.ts`
Expected: FAIL — `Cannot find module '../src/lib/forte'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/forte.ts
// Generic, character-agnostic Forte gauge primitive. See design spec
// docs/superpowers/specs/2026-07-12-milestone2c-forte-design.md §2.
//
// This file must NEVER reference a specific character, mode system, or
// combat move — only phase/charge bookkeeping. Fill triggers, phase counts,
// per-phase thresholds, and full-charge payoffs are all defined per-character
// in that character's own file (e.g. src/lib/solace.ts), composed with this
// file's generic functions. Solace uses a single phase; a future character
// can use 2, 3, or more phases with uneven thresholds without this file
// changing at all.

export interface ForteConfig {
  // Charge required to complete each phase, in order. length = phase count.
  phaseThresholds: number[];
}

export interface ForteState {
  phase: number;   // how many phases are FULLY complete
  charge: number;  // progress within the current, not-yet-complete phase
}

// Adds charge to the current phase, rolling over into subsequent phases if
// the amount overflows the current phase's threshold (handles a single big
// charge gain crossing multiple phase boundaries at once). Caps at the final
// phase fully charged — does not roll past the last phase or store excess.
export function addForteCharge(state: ForteState, config: ForteConfig, amount: number): ForteState {
  let phase  = state.phase;
  let charge = state.charge + amount;
  while (phase < config.phaseThresholds.length && charge >= config.phaseThresholds[phase]) {
    charge -= config.phaseThresholds[phase];
    phase++;
  }
  if (phase >= config.phaseThresholds.length) return { phase: config.phaseThresholds.length, charge: 0 };
  return { phase, charge };
}

// True once the LAST phase is fully charged.
export function isForteMaxed(state: ForteState, config: ForteConfig): boolean {
  return state.phase >= config.phaseThresholds.length;
}

// Resets to empty (phase 0, charge 0).
export function resetForte(): ForteState {
  return { phase: 0, charge: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-attunement.ts`
Expected: all four blocks pass, ending with `✓ all Forte primitive tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/forte.ts scripts/test-attunement.ts
git commit -m "feat(teams): add generic Forte gauge primitive (Milestone 2c)"
```

---

### Task 2: Solace's Forte Config and Payoff

**Files:**
- Modify: `src/lib/solace.ts`
- Modify: `scripts/test-attunement.ts` (append tests)

- [ ] **Step 1: Write the failing test**

Append to the end of `scripts/test-attunement.ts` (after the Task 1 Forte test block's `console.log`):

```typescript

// ── Solace's Forte payoff (Milestone 2c) ─────────────────────────────────────
import {
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
} from "../src/lib/solace";

assert.deepStrictEqual(SOLACE_FORTE_CONFIG, { phaseThresholds: [100] }, "Solace uses a single-phase gauge");
assert.strictEqual(SOLACE_FORTE_GAIN_PER_BASIC, 20, "5 Chime Strikes to fill the gauge");
assert.strictEqual(SOLACE_FORTE_EMPOWERED_TURNS, SOLACE_ULTIMATE_DOUBLE_TURNS, "reuses the existing 3-turn constant for consistency");

assert.strictEqual(getSolaceForteAtkBonus(true), 0.08, "empowered grants the ATK bonus");
assert.strictEqual(getSolaceForteAtkBonus(false), 0, "not empowered grants nothing");
assert.strictEqual(getSolaceForteCritRateBonus(true), 0.08, "empowered grants the crit-rate bonus");
assert.strictEqual(getSolaceForteCritRateBonus(false), 0, "not empowered grants nothing");
assert.strictEqual(getSolaceForteDefBonus(true), 0.10, "empowered grants the DEF bonus");
assert.strictEqual(getSolaceForteDefBonus(false), 0, "not empowered grants nothing");

console.log("✓ all Solace Forte payoff tests passed");
```

You'll also need `SOLACE_ULTIMATE_DOUBLE_TURNS` imported in `scripts/test-attunement.ts` for the assertion above — add it to the existing import from `../src/lib/solace` if this test file doesn't already import it (it doesn't, as of Milestone 2a/2b — check the top of the file and add it to whichever `solace` import already exists there, or add a new import line).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-attunement.ts`
Expected: FAIL — `SOLACE_FORTE_CONFIG` (etc.) is not exported from `../src/lib/solace`

- [ ] **Step 3: Add the Forte config and payoff to `src/lib/solace.ts`**

Find the end of the existing file (after `PLAYER_SELF_OUTRO`'s declaration — the last line of the current file):

```typescript
export const PLAYER_SELF_INTRO: IntroOutroEffect = { actions: [{ type: "HEAL_ALLY", value: 0.05 }] };
export const PLAYER_SELF_OUTRO: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.05 }] };
```

Append after it:

```typescript

// ── Forte (Milestone 2c) ──────────────────────────────────────────────────
// Solace's specific gauge tuning and full-charge payoff. forte.ts itself
// knows nothing about any of this — see design spec §2/§3.
import { ForteConfig } from "./forte";

export const SOLACE_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] }; // single phase, matches her "steady build" identity
export const SOLACE_FORTE_GAIN_PER_BASIC = 20; // Chime Strike fills the gauge — 5 hits to max
export const SOLACE_FORTE_EMPOWERED_TURNS = SOLACE_ULTIMATE_DOUBLE_TURNS; // reuse the existing 3-turn constant for consistency

// Empowered Ultimate's payoff: reduced flat bonuses, applied REGARDLESS of
// which single Attunement mode is currently active — deliberately additive
// alongside (not a replacement for) attunement.ts's own per-mode getters, so
// attunement.ts needs zero changes. Roughly half of Attunement's own
// 15%/15%/20% bonuses.
export function getSolaceForteAtkBonus(empowered: boolean): number { return empowered ? 0.08 : 0; }
export function getSolaceForteCritRateBonus(empowered: boolean): number { return empowered ? 0.08 : 0; }
export function getSolaceForteDefBonus(empowered: boolean): number { return empowered ? 0.10 : 0; }
```

Note: `SOLACE_ULTIMATE_DOUBLE_TURNS` is already declared earlier in this same file (Milestone 2a) — this just references it, no new import needed for that constant within `solace.ts` itself.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-attunement.ts`
Expected: all blocks pass, ending with `✓ all Solace Forte payoff tests passed`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solace.ts scripts/test-attunement.ts
git commit -m "feat(teams): add Solace's Forte config and Empowered payoff (Milestone 2c)"
```

---

### Task 3: Wire Forte into `/encounter`

**Context:** Four touch points in `src/lib/encounter.ts`, all additive to the existing Attunement/Wellspring logic, following the exact pattern Milestone 2b established. Plus one new branch inside Convergence for the Empowered-vs-normal fork.

**Files:**
- Modify: `src/lib/encounter.ts`

- [ ] **Step 1: Update imports**

Find:
```typescript
import { SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO } from "./solace";
```

Replace with:
```typescript
import {
  SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
} from "./solace";
```

Find:
```typescript
import {
  WELLSPRING_BASE_ATK_MULT, WELLSPRING_BASE_ENERGY_BONUS,
  getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus,
} from "./wellspring";
```

Replace with:
```typescript
import {
  WELLSPRING_BASE_ATK_MULT, WELLSPRING_BASE_ENERGY_BONUS,
  getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus,
} from "./wellspring";
import { ForteState, addForteCharge, isForteMaxed, resetForte } from "./forte";
```

- [ ] **Step 2: Add Forte state alongside the existing team state**

Find:
```typescript
  let attunement: AttunementState = { mode: null };
  let attunementDoubleTurnsLeft = 0; // set by Solace's Ultimate; see Task 4
```

Replace with:
```typescript
  let attunement: AttunementState = { mode: null };
  let attunementDoubleTurnsLeft = 0; // set by a normal (non-Empowered) Convergence
  let solaceForte: ForteState = { phase: 0, charge: 0 };
  let forteEmpoweredTurnsLeft = 0; // set by an Empowered Convergence; mutually exclusive with attunementDoubleTurnsLeft
```

- [ ] **Step 3: Fill Forte from Chime Strike, with threshold-crossing status messages**

Find (the end of the `enc_basic` handler):
```typescript
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "BASIC"; vibFrac = 0.3;
        moveName  = r.isCrit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));
      }
```

Replace with:
```typescript
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "BASIC"; vibFrac = 0.3;
        moveName  = r.isCrit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));

        // Forte fills only from Solace's own Chime Strike — announce only on
        // the turn a threshold is actually crossed, not every hit (no
        // permanent visible bar, per design spec §3).
        if (isDevGuild && activeUnit === "ally") {
          const forteBefore = solaceForte;
          solaceForte = addForteCharge(solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
          const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
          const isHalf  = solaceForte.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG);
          if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
            moveName += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
          } else if (isHalf && !wasHalf) {
            moveName += `\n✨ Forte is **HALF CHARGED**.`;
          }
        }
      }
```

- [ ] **Step 4: Branch Convergence on whether Forte is maxed**

Find:
```typescript
        attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS;
        concertoEnergy = 0;

        playerDmg = 0; isCrit = false; moveType = "ULT"; vibFrac = 0;
        moveName = `⚡ **Convergence!** Team healed +${actualHeal} HP, debuffs cleansed, ` +
          `**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
      }
```

Replace with:
```typescript
        concertoEnergy = 0;
        playerDmg = 0; isCrit = false; moveType = "ULT"; vibFrac = 0;

        if (isDevGuild && isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
          // Empowered Convergence — instead of doubling only the active mode,
          // a smaller version of all 3 applies at once (design spec §3).
          // Mutually exclusive with the normal doubling path below.
          forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS;
          solaceForte = resetForte();
          moveName = `⚡ **Empowered Convergence!** Team healed +${actualHeal} HP, debuffs cleansed, ` +
            `**all 3 Attunement Modes empowered for ${SOLACE_FORTE_EMPOWERED_TURNS} turns!**`;
        } else {
          attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS;
          moveName = `⚡ **Convergence!** Team healed +${actualHeal} HP, debuffs cleansed, ` +
            `**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
        }
      }
```

- [ ] **Step 5: Add Forte's additive bonus to Basic Attack**

Find:
```typescript
        const wellspringAtkMult   = isDevGuild && activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
        const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * wellspringAtkMult * (1 + wellspringAtkBonus);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement, attunementDoubleTurnsLeft > 0) : 0) + wellspringCritBonus), stats.critDmg, 1.0, isWeak, state.isShattered);
```

Replace with:
```typescript
        const wellspringAtkMult   = isDevGuild && activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
        const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
        const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement, attunementDoubleTurnsLeft > 0) : 0) + wellspringCritBonus + forteCritBonus), stats.critDmg, 1.0, isWeak, state.isShattered);
```

- [ ] **Step 6: Add Forte's additive bonus to the player's own Ultimate**

Find:
```typescript
        const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringAtkBonus);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

Replace with:
```typescript
        const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const forteAtkBonus = isDevGuild ? getSolaceForteAtkBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

- [ ] **Step 7: Add Forte's additive bonus to the enemy-damage DEF calc**

Find:
```typescript
        const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
        const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus);
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
```

Replace with:
```typescript
        const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
        const forteDefBonus = isDevGuild ? getSolaceForteDefBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus);
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
```

- [ ] **Step 8: Decrement `forteEmpoweredTurnsLeft` alongside the other per-turn counters**

Find:
```typescript
      state.turn++;
      if (state.skillCooldown > 0) state.skillCooldown--;
      if (echoSkillCooldown > 0) echoSkillCooldown--;
      if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
      if (isDevGuild && attunementDoubleTurnsLeft > 0) attunementDoubleTurnsLeft--;
      if (forcedCritActive) nextAttackCritArmed = false;
```

Replace with:
```typescript
      state.turn++;
      if (state.skillCooldown > 0) state.skillCooldown--;
      if (echoSkillCooldown > 0) echoSkillCooldown--;
      if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
      if (isDevGuild && attunementDoubleTurnsLeft > 0) attunementDoubleTurnsLeft--;
      if (isDevGuild && forteEmpoweredTurnsLeft > 0) forteEmpoweredTurnsLeft--;
      if (forcedCritActive) nextAttackCritArmed = false;
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): wire Forte gauge into /encounter (Milestone 2c)"
```

---

### Task 4: Verification

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
npx tsx scripts/test-attunement.ts
grep -n "isDevGuild" src/lib/encounter.ts   # re-audit every new Forte branch is still gated
```

- [ ] **Step 2: Manual — deploy and playtest**

```bash
npm run deploy   # not needed, no new slash command — a restart is enough
```
then on the VM: `git pull && npm run build && pm2 restart cartethyia`

In the dev guild, fight an encounter and verify:
- [ ] Swap to Solace, attack with Chime Strike repeatedly — a "Forte is HALF CHARGED" note appears once around the 3rd hit (60/100, first crossing 50), then "Forte is FULLY CHARGED" once around the 5th hit — each appears exactly once, not on every subsequent hit
- [ ] With Forte maxed, use Convergence — the message says "Empowered Convergence," not the normal doubled-mode message
- [ ] After an Empowered Convergence, switch Attunement to a DIFFERENT mode than whatever was active at cast time and attack — damage/crit/DEF are still slightly boosted (the reduced cross-mode bonus), not zero
- [ ] After an Empowered Convergence, Chime Strike again to confirm Forte is back at 0 (no lingering charge)
- [ ] With Forte NOT maxed, use Convergence — behaves exactly as it did in Milestone 2a/2b (doubles only the active mode, normal message)
- [ ] Non-dev-guild `/encounter` is still completely unaffected (spot-check another server)

- [ ] **Step 3: Report findings back**

Same as before — if something's off, tell me exactly what you saw and I'll fix it directly rather than re-planning from scratch.
