# Milestone 2e — Kit-Leveling Combat Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Milestone 2d's kit levels into Solace's actual `/encounter` numbers — Basic damage, Attunement's buff magnitude, Convergence's (now dual-target) heal, Intro's heal, and Forte's Empowered payoff all scale with their respective track's level. A fresh Lv1 character behaves identically to how she did before this milestone; nothing regresses for an unleveled player.

**Architecture:** `src/lib/attunement.ts`'s three getters lose their hardcoded bonus constants and require an explicit magnitude parameter instead — `encounter.ts` computes Solace's level-scaled magnitude (via new functions in `solace.ts`) and threads it through at the same 3 call sites Milestones 2a-2c already established. Convergence's heal gets fixed to target both HP pools instead of only the player's. No schema changes — `CharacterProgress` (Milestone 2d) already has everything needed; this milestone just reads it. See the [design spec](../specs/2026-07-12-milestone2e-kit-leveling-effects-design.md) for full rationale, including why the numbers were chosen to avoid overlapping with Constellation 6's eventual effect.

**Tech Stack:** TypeScript. Reads (never writes) `CharacterProgress` via Milestone 2d's `getOrCreateCharacterProgress`.

---

### Task 1: Parameterize `attunement.ts`

**Files:**
- Modify: `src/lib/attunement.ts`
- Modify: `scripts/test-attunement.ts`

- [ ] **Step 1: Update the failing test first**

Find the entire Attunement test block in `scripts/test-attunement.ts` (from `import { cycleAttunementMode, ...} from "../src/lib/attunement";` through the `console.log("✓ all Attunement primitive tests passed");` line — this is lines 4-49 of the current file):

```typescript
import {
  cycleAttunementMode, getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
  AttunementState,
} from "../src/lib/attunement";

// cycleAttunementMode rotates ATK -> CRIT -> DEF -> ATK
assert.strictEqual(cycleAttunementMode(null), "ATK", "starts at ATK from no mode");
assert.strictEqual(cycleAttunementMode("ATK"), "CRIT");
assert.strictEqual(cycleAttunementMode("CRIT"), "DEF");
assert.strictEqual(cycleAttunementMode("DEF"), "ATK");

// Only the active mode's getter returns a bonus; the other two stay neutral
let state: AttunementState = { mode: "ATK" };
assert.strictEqual(getAttunementAtkMult(state), 1.15);
assert.strictEqual(getAttunementCritRateBonus(state), 0);
assert.strictEqual(getAttunementDefMult(state), 1);

state = { mode: "CRIT" };
assert.strictEqual(getAttunementAtkMult(state), 1);
assert.strictEqual(getAttunementCritRateBonus(state), 0.15);
assert.strictEqual(getAttunementDefMult(state), 1);

state = { mode: "DEF" };
assert.strictEqual(getAttunementAtkMult(state), 1);
assert.strictEqual(getAttunementCritRateBonus(state), 0);
assert.strictEqual(getAttunementDefMult(state), 1.2);

// No mode active (null) = fully neutral
state = { mode: null };
assert.strictEqual(getAttunementAtkMult(state), 1);
assert.strictEqual(getAttunementCritRateBonus(state), 0);
assert.strictEqual(getAttunementDefMult(state), 1);

// doubled=true (Ultimate's effect) doubles the ACTIVE mode's bonus above the
// baseline 1.0/0 — i.e. the bonus portion doubles, not the whole multiplier
state = { mode: "ATK" };
assert.strictEqual(getAttunementAtkMult(state, true), 1.30, "doubled ATK bonus: +15% -> +30%");
assert.strictEqual(getAttunementCritRateBonus(state, true), 0, "inactive mode stays 0 even when doubled=true");

state = { mode: "CRIT" };
assert.strictEqual(getAttunementCritRateBonus(state, true), 0.30, "doubled CRIT bonus: +15% -> +30%");

state = { mode: "DEF" };
assert.strictEqual(getAttunementDefMult(state, true), 1.40, "doubled DEF bonus: +20% -> +40%");

console.log("✓ all Attunement primitive tests passed");
```

Replace with (same assertions, same expected values — proving the parameterized version behaves identically to the old hardcoded-constant version when passed the OLD constant values — but every call now passes the bonus explicitly as the 2nd argument, `doubled` shifts to 3rd):

```typescript
import {
  cycleAttunementMode, getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
  AttunementState,
} from "../src/lib/attunement";

// cycleAttunementMode rotates ATK -> CRIT -> DEF -> ATK
assert.strictEqual(cycleAttunementMode(null), "ATK", "starts at ATK from no mode");
assert.strictEqual(cycleAttunementMode("ATK"), "CRIT");
assert.strictEqual(cycleAttunementMode("CRIT"), "DEF");
assert.strictEqual(cycleAttunementMode("DEF"), "ATK");

// Only the active mode's getter returns a bonus; the other two stay neutral.
// Bonus values below (0.15/0.15/0.20) match Solace's OLD hardcoded constants
// from before this milestone — proving the parameterized version is a
// behavior-preserving refactor at those specific values, not a behavior change.
let state: AttunementState = { mode: "ATK" };
assert.strictEqual(getAttunementAtkMult(state, 0.15), 1.15);
assert.strictEqual(getAttunementCritRateBonus(state, 0.15), 0);
assert.strictEqual(getAttunementDefMult(state, 0.20), 1);

state = { mode: "CRIT" };
assert.strictEqual(getAttunementAtkMult(state, 0.15), 1);
assert.strictEqual(getAttunementCritRateBonus(state, 0.15), 0.15);
assert.strictEqual(getAttunementDefMult(state, 0.20), 1);

state = { mode: "DEF" };
assert.strictEqual(getAttunementAtkMult(state, 0.15), 1);
assert.strictEqual(getAttunementCritRateBonus(state, 0.15), 0);
assert.strictEqual(getAttunementDefMult(state, 0.20), 1.2);

// No mode active (null) = fully neutral regardless of bonus magnitude
state = { mode: null };
assert.strictEqual(getAttunementAtkMult(state, 0.15), 1);
assert.strictEqual(getAttunementCritRateBonus(state, 0.15), 0);
assert.strictEqual(getAttunementDefMult(state, 0.20), 1);

// doubled=true (Ultimate's effect) doubles the ACTIVE mode's bonus above the
// baseline 1.0/0 — i.e. the bonus portion doubles, not the whole multiplier
state = { mode: "ATK" };
assert.strictEqual(getAttunementAtkMult(state, 0.15, true), 1.30, "doubled ATK bonus: +15% -> +30%");
assert.strictEqual(getAttunementCritRateBonus(state, 0.15, true), 0, "inactive mode stays 0 even when doubled=true");

state = { mode: "CRIT" };
assert.strictEqual(getAttunementCritRateBonus(state, 0.15, true), 0.30, "doubled CRIT bonus: +15% -> +30%");

state = { mode: "DEF" };
assert.strictEqual(getAttunementDefMult(state, 0.20, true), 1.40, "doubled DEF bonus: +20% -> +40%");

// A DIFFERENT bonus magnitude (e.g. a leveled-up value) scales correctly too —
// proves the parameter genuinely drives the output, not just the old constant
// in disguise.
state = { mode: "ATK" };
assert.strictEqual(getAttunementAtkMult(state, 0.30), 1.30, "a bigger bonus magnitude produces a bigger multiplier");
assert.strictEqual(getAttunementAtkMult(state, 0.30, true), 1.60, "doubling scales from whatever magnitude was passed in, not a fixed old value");

console.log("✓ all Attunement primitive tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-attunement.ts`
Expected: FAIL — either a TypeScript error (wrong argument count) if run via `tsx` (which type-checks), or assertion failures if the old file is still in place.

- [ ] **Step 3: Update `src/lib/attunement.ts`**

Find:
```typescript
const ATTUNEMENT_ATK_BONUS  = 0.15; // +15% ATK while in ATK mode
const ATTUNEMENT_CRIT_BONUS = 0.15; // +15% Crit Rate while in CRIT mode
const ATTUNEMENT_DEF_BONUS  = 0.20; // +20% DEF while in DEF mode

// Cycles ATK -> CRIT -> DEF -> ATK. No-mode (null) starts at ATK.
export function cycleAttunementMode(current: AttunementMode | null): AttunementMode {
  if (current === "ATK")  return "CRIT";
  if (current === "CRIT") return "DEF";
  return "ATK"; // covers both `null` (first activation) and "DEF" (wrap around)
}

// `doubled` is Solace's Ultimate ("Convergence") temporarily doubling whichever
// mode is currently active — it doubles the BONUS portion (the amount above the
// neutral 1.0/0 baseline), not the whole multiplier.
export function getAttunementAtkMult(state: AttunementState, doubled = false): number {
  if (state.mode !== "ATK") return 1;
  return 1 + ATTUNEMENT_ATK_BONUS * (doubled ? 2 : 1);
}

export function getAttunementCritRateBonus(state: AttunementState, doubled = false): number {
  if (state.mode !== "CRIT") return 0;
  return ATTUNEMENT_CRIT_BONUS * (doubled ? 2 : 1);
}

export function getAttunementDefMult(state: AttunementState, doubled = false): number {
  if (state.mode !== "DEF") return 1;
  return 1 + ATTUNEMENT_DEF_BONUS * (doubled ? 2 : 1);
}
```

Replace with:
```typescript
// Cycles ATK -> CRIT -> DEF -> ATK. No-mode (null) starts at ATK.
export function cycleAttunementMode(current: AttunementMode | null): AttunementMode {
  if (current === "ATK")  return "CRIT";
  if (current === "CRIT") return "DEF";
  return "ATK"; // covers both `null` (first activation) and "DEF" (wrap around)
}

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
export function getAttunementAtkMult(state: AttunementState, bonus: number, doubled = false): number {
  if (state.mode !== "ATK") return 1;
  return 1 + bonus * (doubled ? 2 : 1);
}

export function getAttunementCritRateBonus(state: AttunementState, bonus: number, doubled = false): number {
  if (state.mode !== "CRIT") return 0;
  return bonus * (doubled ? 2 : 1);
}

export function getAttunementDefMult(state: AttunementState, bonus: number, doubled = false): number {
  if (state.mode !== "DEF") return 1;
  return 1 + bonus * (doubled ? 2 : 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-attunement.ts`
Expected: FAILS at this point with import/type errors from the LATER test blocks (Wellspring, Forte, Solace Forte payoff) — this is expected, because those later blocks in the SAME file don't call `attunement.ts` directly, so they should still pass; but `encounter.ts` (not yet updated) will fail `tsc`'s type-check when `tsx` compiles the whole test file's dependency graph... Actually: `tsx` only type-checks the file being run and its imports — `scripts/test-attunement.ts` does not import `encounter.ts`, so this should NOT fail from that direction. Run it and confirm: the Attunement block passes with the new signature, and everything after it (Wellspring/Forte/Solace-Forte-payoff blocks) still passes unchanged, since those don't touch `attunement.ts`'s signature at all.

Expected final output: `✓ all Attunement primitive tests passed` followed by the three other existing pass lines, unchanged.

- [ ] **Step 5: Typecheck the WHOLE project**

Run: `npx tsc --noEmit`
Expected: FAILS — `src/lib/encounter.ts` calls `getAttunementAtkMult`/`getAttunementCritRateBonus`/`getAttunementDefMult` with the OLD 2-argument signature (state, doubled) at 3 call sites. This is expected and will be fixed in Task 3, not this task. Confirm the errors are ONLY in `encounter.ts` and ONLY about these three function calls (wrong argument count/type) — if you see any OTHER kind of error, stop and report BLOCKED.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attunement.ts scripts/test-attunement.ts
git commit -m "feat(teams): parameterize Attunement bonus magnitude (Milestone 2e)"
```

(Committing with `encounter.ts` still broken is intentional and matches the pattern from Milestone 2a's Task 2 — a later task in this same plan fixes it immediately next.)

---

### Task 2: Solace's Scaling Functions

**Files:**
- Modify: `src/lib/solace.ts`
- Modify: `scripts/test-attunement.ts`

- [ ] **Step 1: Update the failing test first**

Find the "Solace's Forte payoff" test block in `scripts/test-attunement.ts`:

```typescript
// ── Solace's Forte payoff (Milestone 2c) ─────────────────────────────────────
import {
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  SOLACE_ULTIMATE_DOUBLE_TURNS,
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

Replace with (updates the Forte payoff getters to the new `(forteLevel, empowered)` signature, and adds a new block testing the 5 new scaling functions):

```typescript
// ── Solace's Forte payoff (Milestone 2c, level-scaled in Milestone 2e) ───────
import {
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  SOLACE_ULTIMATE_DOUBLE_TURNS,
} from "../src/lib/solace";

assert.deepStrictEqual(SOLACE_FORTE_CONFIG, { phaseThresholds: [100] }, "Solace uses a single-phase gauge");
assert.strictEqual(SOLACE_FORTE_GAIN_PER_BASIC, 20, "5 Chime Strikes to fill the gauge");
assert.strictEqual(SOLACE_FORTE_EMPOWERED_TURNS, SOLACE_ULTIMATE_DOUBLE_TURNS, "reuses the existing 3-turn constant for consistency");

// Not empowered: always 0, regardless of level.
assert.strictEqual(getSolaceForteAtkBonus(1, false), 0, "not empowered grants nothing at Lv1");
assert.strictEqual(getSolaceForteAtkBonus(10, false), 0, "not empowered grants nothing at Lv10 either");

// Empowered: scales from the old flat Milestone 2c values (Lv1) up to double at Lv10.
assert.strictEqual(getSolaceForteAtkBonus(1, true), 0.08, "Lv1 empowered ATK bonus matches the old Milestone 2c flat value");
assert.strictEqual(getSolaceForteCritRateBonus(1, true), 0.08, "Lv1 empowered crit bonus matches the old Milestone 2c flat value");
assert.strictEqual(getSolaceForteDefBonus(1, true), 0.10, "Lv1 empowered DEF bonus matches the old Milestone 2c flat value");
assert.strictEqual(getSolaceForteAtkBonus(10, true), 0.16, "Lv10 empowered ATK bonus is double the Lv1 value");
assert.strictEqual(getSolaceForteCritRateBonus(10, true), 0.16, "Lv10 empowered crit bonus is double the Lv1 value");
assert.strictEqual(getSolaceForteDefBonus(10, true), 0.20, "Lv10 empowered DEF bonus is double the Lv1 value");

console.log("✓ all Solace Forte payoff tests passed");

// ── Solace's other kit-leveling scaling functions (Milestone 2e) ────────────
import {
  solaceBasicDamageMult, solaceAttunementAtkCritBonus, solaceAttunementDefBonus,
  solaceConvergenceHealPct, solaceIntroHealPct,
} from "../src/lib/solace";

// Basic (Chime Strike): 1.0x at Lv1 (matches the pre-Milestone-2e hardcoded
// value exactly — a fresh Lv1 Solace must play identically to before this
// milestone), up to 1.8x at Lv10.
assert.strictEqual(solaceBasicDamageMult(1), 1.0, "Lv1 Basic multiplier matches the pre-2e baseline exactly");
assert.strictEqual(solaceBasicDamageMult(10), 1.8, "Lv10 Basic multiplier reaches the target max");

// Skill (Attunement): 15%/15% ATK+Crit and 20% DEF at Lv1 (matches the old
// hardcoded constants), doubling to 30%/30%/40% at Lv10.
assert.strictEqual(solaceAttunementAtkCritBonus(1), 0.15, "Lv1 ATK/Crit bonus matches the pre-2e baseline");
assert.strictEqual(solaceAttunementAtkCritBonus(10), 0.30, "Lv10 ATK/Crit bonus doubles");
assert.strictEqual(solaceAttunementDefBonus(1), 0.20, "Lv1 DEF bonus matches the pre-2e baseline");
assert.strictEqual(solaceAttunementDefBonus(10), 0.40, "Lv10 DEF bonus doubles");

// Ultimate (Convergence): 30% heal at Lv1 (matches old baseline), 60% at Lv10.
assert.strictEqual(solaceConvergenceHealPct(1), 0.30, "Lv1 heal matches the pre-2e baseline");
assert.strictEqual(solaceConvergenceHealPct(10), 0.60, "Lv10 heal doubles");

// Intro: 20% heal at Lv1 (matches old baseline), 40% at Lv10.
assert.strictEqual(solaceIntroHealPct(1), 0.20, "Lv1 heal matches the pre-2e baseline");
assert.strictEqual(solaceIntroHealPct(10), 0.40, "Lv10 heal doubles");

// Midpoint sanity check (Lv5.5 doesn't exist, but the interpolation formula
// should still be linear and monotonic — spot-check Lv6, roughly 5/9 of the
// way from Lv1 to Lv10) to catch an interpolation math error the endpoint
// checks alone wouldn't.
const lv6Basic = solaceBasicDamageMult(6);
assert.ok(lv6Basic > 1.0 && lv6Basic < 1.8, "Lv6 Basic multiplier sits strictly between Lv1 and Lv10");
assert.strictEqual(Math.round(lv6Basic * 1000), 1444, "Lv6 Basic multiplier matches the expected linear-interpolation value (~1.444x)");

console.log("✓ all Solace kit-leveling scaling functions tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-attunement.ts`
Expected: FAIL — `getSolaceForteAtkBonus` etc. still take the old 1-argument signature, and the 5 new scaling functions don't exist yet.

- [ ] **Step 3: Update `src/lib/solace.ts`**

Find:
```typescript
import { IntroOutroEffect } from "./introOutro";
import { ForteConfig } from "./forte";

export const SOLACE = {
  name:  "Solace",
  hpMax: 1100,

  // Intro Skill: instant heal + cleanse, zero ramp-up (design spec §6).
  intro: {
    actions: [
      { type: "HEAL_ALLY",    value: 0.20 },
      { type: "CLEANSE_ALLY", value: 1 },
    ],
  } as IntroOutroEffect,

  // Outro Skill: shields the incoming ally. The "guarantees their next attack
  // crits" half of her Outro (per spec) has no AllyAction primitive for it yet
  // (HEAL/SHIELD/BUFF_ATK/CLEANSE don't cover "arm a guaranteed crit") — a
  // later task wires that part directly in encounter.ts by reusing the
  // existing nextAttackCritArmed variable already in that file (from the Echo
  // Skill system), rather than inventing a new primitive for a single one-off
  // use.
  outro: {
    actions: [
      { type: "SHIELD_ALLY", value: 0.15 },
    ],
  } as IntroOutroEffect,
};
```

Replace with (removes the static `intro` field — its heal value is now level-scaled and computed by a function below instead of a fixed constant, so a single static object could no longer be the source of truth without silently ignoring level; `outro` is untouched, since Outro deliberately does not level per spec):

```typescript
import { IntroOutroEffect } from "./introOutro";
import { ForteConfig } from "./forte";
import { MAX_KIT_LEVEL } from "./characterProgress";

export const SOLACE = {
  name:  "Solace",
  hpMax: 1100,

  // Outro Skill: shields the incoming ally. The "guarantees their next attack
  // crits" half of her Outro (per spec) has no AllyAction primitive for it yet
  // (HEAL/SHIELD/BUFF_ATK/CLEANSE don't cover "arm a guaranteed crit") — a
  // later task wires that part directly in encounter.ts by reusing the
  // existing nextAttackCritArmed variable already in that file (from the Echo
  // Skill system), rather than inventing a new primitive for a single one-off
  // use. Outro deliberately does NOT level (design spec §6/§8) — stays fixed
  // regardless of investment, unlike Intro below.
  outro: {
    actions: [
      { type: "SHIELD_ALLY", value: 0.15 },
    ],
  } as IntroOutroEffect,
};

// Intro Skill: instant heal + cleanse, zero ramp-up (design spec §6). Unlike
// Outro, Intro's heal % scales with Intro level (Milestone 2e) — so it's a
// function, not a static object, to avoid a second, silently-stale source of
// truth for the heal value.
export function solaceIntroEffect(introLevel: number): IntroOutroEffect {
  return {
    actions: [
      { type: "HEAL_ALLY",    value: solaceIntroHealPct(introLevel) },
      { type: "CLEANSE_ALLY", value: 1 },
    ],
  };
}
```

Find:
```typescript
// The player's own personalized character still gets the universal, generic
// Intro/Outro pair from design spec §2 — unrelated to which banner character
// is in the other slot. These lived in the now-deleted placeholderAlly.ts;
// they move here rather than getting a separate file of their own.
export const PLAYER_SELF_INTRO: IntroOutroEffect = { actions: [{ type: "HEAL_ALLY", value: 0.05 }] };
export const PLAYER_SELF_OUTRO: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.05 }] };
```

Leave this exactly as-is (no change) — the player's own self-Intro/Outro are unrelated to Solace's kit-leveling and don't scale.

Find:
```typescript
// Empowered Ultimate's payoff: reduced flat bonuses, applied REGARDLESS of
// which single Attunement mode is currently active — deliberately additive
// alongside (not a replacement for) attunement.ts's own per-mode getters, so
// attunement.ts needs zero changes. Roughly half of Attunement's own
// 15%/15%/20% bonuses.
export function getSolaceForteAtkBonus(empowered: boolean): number { return empowered ? 0.08 : 0; }
export function getSolaceForteCritRateBonus(empowered: boolean): number { return empowered ? 0.08 : 0; }
export function getSolaceForteDefBonus(empowered: boolean): number { return empowered ? 0.10 : 0; }
```

Replace with:
```typescript
// Empowered Ultimate's payoff: reduced bonuses, applied REGARDLESS of which
// single Attunement mode is currently active — deliberately additive
// alongside (not a replacement for) attunement.ts's own per-mode getters, so
// attunement.ts needs zero changes. Magnitude scales with Forte level
// (Milestone 2e) — Lv1 matches the original Milestone 2c flat values exactly
// (0.08/0.08/0.10, roughly half of Attunement's own baseline 15%/15%/20%),
// doubling by Lv10. See design spec §3/§6 for why these numbers were chosen
// to stay clear of Constellation 6's eventual territory.
export function getSolaceForteAtkBonus(forteLevel: number, empowered: boolean): number {
  return empowered ? solaceForteEmpoweredAtkCritBonus(forteLevel) : 0;
}
export function getSolaceForteCritRateBonus(forteLevel: number, empowered: boolean): number {
  return empowered ? solaceForteEmpoweredAtkCritBonus(forteLevel) : 0;
}
export function getSolaceForteDefBonus(forteLevel: number, empowered: boolean): number {
  return empowered ? solaceForteEmpoweredDefBonus(forteLevel) : 0;
}

// ── Kit-leveling scaling curves (Milestone 2e) ────────────────────────────
// Linear interpolation from Lv1 to Lv10 for every track. Lv1 values match
// each track's ORIGINAL pre-Milestone-2e hardcoded constant exactly — a fresh
// Lv1 character must play identically to how she did before this milestone.
// See design spec §3 for the full table and §6 for the Constellation-6
// balance reasoning behind the chosen Lv10 ceilings.

export function solaceBasicDamageMult(basicLevel: number): number {
  return 1.0 + (1.8 - 1.0) * (basicLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceAttunementAtkCritBonus(skillLevel: number): number {
  return 0.15 + (0.30 - 0.15) * (skillLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceAttunementDefBonus(skillLevel: number): number {
  return 0.20 + (0.40 - 0.20) * (skillLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceConvergenceHealPct(ultimateLevel: number): number {
  return 0.30 + (0.60 - 0.30) * (ultimateLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceIntroHealPct(introLevel: number): number {
  return 0.20 + (0.40 - 0.20) * (introLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceForteEmpoweredAtkCritBonus(forteLevel: number): number {
  return 0.08 + (0.16 - 0.08) * (forteLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceForteEmpoweredDefBonus(forteLevel: number): number {
  return 0.10 + (0.20 - 0.10) * (forteLevel - 1) / (MAX_KIT_LEVEL - 1);
}
```

Note: `solaceIntroEffect` (defined earlier in the file, right after the `SOLACE` object) calls `solaceIntroHealPct`, which is defined LATER in the file (in this final block) — this is fine in TypeScript/JavaScript for function declarations (hoisted), but double-check both are declared with `function` keyword (not `const ... = () =>`) so hoisting applies. Both are written as `function` declarations above, so this is already correct — just confirm you haven't changed either to an arrow-function const while editing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-attunement.ts`
Expected: all blocks pass, ending with `✓ all Solace kit-leveling scaling functions tests passed`.

- [ ] **Step 5: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: FAILS — `encounter.ts` still calls `getSolaceForteAtkBonus`/`getSolaceForteCritRateBonus`/`getSolaceForteDefBonus` with the old 1-argument signature, and still references `SOLACE.intro` (now removed) and the old 2-arg `getAttunementAtkMult`/etc. from Task 1. This is expected — Task 3 fixes `encounter.ts` next. Confirm the errors are confined to `encounter.ts` and match these expected causes; if you see anything else, report BLOCKED.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solace.ts scripts/test-attunement.ts
git commit -m "feat(teams): add Solace's kit-leveling scaling functions (Milestone 2e)"
```

---

### Task 3: Wire Levels into `/encounter`

**Context:** This is the biggest task — it threads a fetched `CharacterProgress` row through every touch point Milestones 2a-2c already established, fixes `encounter.ts`'s now-broken calls from Tasks 1-2, and fixes Convergence's heal to target both units.

**Files:**
- Modify: `src/lib/encounter.ts`

- [ ] **Step 1: Add imports**

Find:
```typescript
import {
  SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
} from "./solace";
```

Replace with:
```typescript
import {
  SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  solaceIntroEffect, solaceBasicDamageMult, solaceAttunementAtkCritBonus,
  solaceAttunementDefBonus, solaceConvergenceHealPct,
} from "./solace";
import { getOrCreateCharacterProgress } from "./characterProgress";
```

- [ ] **Step 2: Fetch Solace's progress once per fight**

Find:
```typescript
  // ── Milestone 1/2a: two-unit team state (dev guild only) ─────────────────────
  let activeUnit: "player" | "ally" = "player";
  let allyHp    = SOLACE.hpMax;
  const allyHpMax = SOLACE.hpMax;
  let concertoEnergy: number = 0;
  let playerDebuffs: DebuffState = [];
  let attunement: AttunementState = { mode: null };
  let attunementDoubleTurnsLeft = 0; // set by a normal (non-Empowered) Convergence
  let solaceForte: ForteState = { phase: 0, charge: 0 };
  let forteEmpoweredTurnsLeft = 0; // set by an Empowered Convergence; mutually exclusive with attunementDoubleTurnsLeft
```

Replace with:
```typescript
  // ── Milestone 1/2a: two-unit team state (dev guild only) ─────────────────────
  let activeUnit: "player" | "ally" = "player";
  let allyHp    = SOLACE.hpMax;
  const allyHpMax = SOLACE.hpMax;
  let concertoEnergy: number = 0;
  let playerDebuffs: DebuffState = [];
  let attunement: AttunementState = { mode: null };
  let attunementDoubleTurnsLeft = 0; // set by a normal (non-Empowered) Convergence
  let solaceForte: ForteState = { phase: 0, charge: 0 };
  let forteEmpoweredTurnsLeft = 0; // set by an Empowered Convergence; mutually exclusive with attunementDoubleTurnsLeft

  // Milestone 2e: kit levels don't change mid-fight (leveling only happens via
  // /character, a separate command/interaction) — fetch once here rather than
  // re-querying every turn. Only fetched in the dev guild, since nothing below
  // reads it outside isDevGuild-gated branches.
  const solaceProgress = isDevGuild ? await getOrCreateCharacterProgress(interaction.user.id, "solace") : null;
  const solaceBasicLevel    = solaceProgress?.basicLevel    ?? 1;
  const solaceSkillLevel    = solaceProgress?.skillLevel    ?? 1;
  const solaceUltimateLevel = solaceProgress?.ultimateLevel ?? 1;
  const solaceIntroLevel    = solaceProgress?.introLevel    ?? 1;
  const solaceForteLevel    = solaceProgress?.forteLevel    ?? 1;
```

- [ ] **Step 3: Basic Attack — level-scaled multiplier (Solace-only) + parameterized Attunement/Forte calls**

Find:
```typescript
      if (btn.customId === "enc_basic") {
        // Wellspring: base ATK boost only while Solace is actually attacking
        // (it's hardcoded onto her, not the player's own weapon); the mode
        // amplifier applies regardless of who's attacking, same scope as
        // Attunement's own bonus.
        const wellspringAtkMult   = isDevGuild && activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
        const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
        const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement, attunementDoubleTurnsLeft > 0) : 0) + wellspringCritBonus + forteCritBonus), stats.critDmg, 1.0, isWeak, state.isShattered);
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
        const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const attunementAtkBonus  = solaceAttunementAtkCritBonus(solaceSkillLevel);
        const attunementCritBonus = solaceAttunementAtkCritBonus(solaceSkillLevel);
        // Milestone 2e: this move's OWN base multiplier (separate from the
        // Attunement/Wellspring/Forte bonuses above) is Solace's Basic-track
        // level scaling — only applies while she's actually attacking, since
        // this handler is shared with the player's own Basic Attack and her
        // level shouldn't affect HIS damage.
        const basicMoveMult = isDevGuild && activeUnit === "ally" ? solaceBasicDamageMult(solaceBasicLevel) : 1.0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementAtkBonus, attunementDoubleTurnsLeft > 0) : 1) * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement, attunementCritBonus, attunementDoubleTurnsLeft > 0) : 0) + wellspringCritBonus + forteCritBonus), stats.critDmg, basicMoveMult, isWeak, state.isShattered);
```

(The `1.0` that was previously the fixed literal move-multiplier argument to `calcPlayerDamage` is now the `basicMoveMult` variable — same position in the argument list, just no longer a hardcoded literal.)

- [ ] **Step 4: Player's own Ultimate — parameterized Attunement/Forte calls**

Find:
```typescript
      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        // No base ATK boost here — this branch only ever runs for the
        // player's own Ultimate (Solace's Ultimate is the else-if branch
        // below, which deals no damage), and the base boost is Solace-only.
        const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const forteAtkBonus = isDevGuild ? getSolaceForteAtkBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

Replace with:
```typescript
      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        // No base ATK boost here — this branch only ever runs for the
        // player's own Ultimate (Solace's Ultimate is the else-if branch
        // below, which deals no damage), and the base boost is Solace-only.
        const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
        const forteAtkBonus = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const attunementAtkBonus = solaceAttunementAtkCritBonus(solaceSkillLevel);
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement, attunementAtkBonus, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

- [ ] **Step 5: Solace's Ultimate (Convergence) — dual-target heal + level-scaled %**

Find:
```typescript
      } else if (btn.customId === "enc_ultimate" && isDevGuild && activeUnit === "ally") {
        // Solace's Ultimate spends Concerto Energy, not personal Energy — team
        // heal + cleanse + doubles the current Attunement mode's effect for
        // 3 turns (base version). If Forte is maxed, this instead becomes an
        // Empowered Convergence — all 3 modes empowered at once — see below.
        const target: AllyActionTarget = { hp: state.playerHp, hpMax: state.playerHpMax };
        const healResult = resolveIntroOutroEffect({ actions: [
          { type: "HEAL_ALLY", value: 0.30 },
          { type: "CLEANSE_ALLY", value: 1 },
        ] }, target);
        const before = state.playerHp;
        state.playerHp = Math.min(state.playerHpMax, state.playerHp + healResult.hpDelta);
        const actualHeal = state.playerHp - before;
        playerDebuffs = cleanseDebuffs(playerDebuffs, healResult.cleanseCount);

        concertoEnergy = 0;
        playerDmg = 0; isCrit = false; moveType = "ULT"; vibFrac = 0;

        if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
          // Empowered Convergence — instead of doubling only the active mode,
          // a smaller version of all 3 applies at once (design spec §3).
          // Mutually exclusive with the normal doubling path below — both
          // counters are explicitly set here so tuning either duration
          // constant can't accidentally leave both nonzero at once.
          forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS;
          attunementDoubleTurnsLeft = 0;
          solaceForte = resetForte();
          moveName = `⚡ **Empowered Convergence!** Team healed +${actualHeal} HP, debuffs cleansed, ` +
            `**all 3 Attunement Modes empowered for ${SOLACE_FORTE_EMPOWERED_TURNS} turns!**`;
        } else {
          attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS;
          forteEmpoweredTurnsLeft = 0;
          moveName = `⚡ **Convergence!** Team healed +${actualHeal} HP, debuffs cleansed, ` +
            `**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
        }
      }
```

Replace with:
```typescript
      } else if (btn.customId === "enc_ultimate" && isDevGuild && activeUnit === "ally") {
        // Solace's Ultimate spends Concerto Energy, not personal Energy — team
        // heal (BOTH units — Milestone 2e fix; previously this only ever
        // healed state.playerHp regardless of who was active, contradicting
        // its own "Team healed" message) + cleanse + doubles the current
        // Attunement mode's effect for 3 turns (base version). Heal % scales
        // with Ultimate level. If Forte is maxed, this instead becomes an
        // Empowered Convergence — all 3 modes empowered at once — see below.
        const healPct = solaceConvergenceHealPct(solaceUltimateLevel);
        const healResult = resolveIntroOutroEffect({ actions: [
          { type: "HEAL_ALLY", value: healPct },
          { type: "CLEANSE_ALLY", value: 1 },
        ] }, { hp: state.playerHp, hpMax: state.playerHpMax });
        const allyHealResult = resolveIntroOutroEffect({ actions: [
          { type: "HEAL_ALLY", value: healPct },
        ] }, { hp: allyHp, hpMax: allyHpMax });

        const beforePlayer = state.playerHp;
        state.playerHp = Math.min(state.playerHpMax, state.playerHp + healResult.hpDelta);
        const actualHealPlayer = state.playerHp - beforePlayer;

        const beforeAlly = allyHp;
        allyHp = Math.min(allyHpMax, allyHp + allyHealResult.hpDelta);
        const actualHealAlly = allyHp - beforeAlly;

        playerDebuffs = cleanseDebuffs(playerDebuffs, healResult.cleanseCount);

        concertoEnergy = 0;
        playerDmg = 0; isCrit = false; moveType = "ULT"; vibFrac = 0;

        const healSummary = `${displayName} +${actualHealPlayer} HP, ${SOLACE.name} +${actualHealAlly} HP`;

        if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
          // Empowered Convergence — instead of doubling only the active mode,
          // a smaller version of all 3 applies at once (design spec §3).
          // Mutually exclusive with the normal doubling path below — both
          // counters are explicitly set here so tuning either duration
          // constant can't accidentally leave both nonzero at once.
          forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS;
          attunementDoubleTurnsLeft = 0;
          solaceForte = resetForte();
          moveName = `⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
            `**all 3 Attunement Modes empowered for ${SOLACE_FORTE_EMPOWERED_TURNS} turns!**`;
        } else {
          attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS;
          forteEmpoweredTurnsLeft = 0;
          moveName = `⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
            `**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
        }
      }
```

- [ ] **Step 6: Intro heal — use the level-scaled function instead of the removed static `SOLACE.intro`**

Find:
```typescript
          const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
          const introEffect = outgoingIsPlayer ? SOLACE.intro : PLAYER_SELF_INTRO;
```

Replace with:
```typescript
          const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
          const introEffect = outgoingIsPlayer ? solaceIntroEffect(solaceIntroLevel) : PLAYER_SELF_INTRO;
```

- [ ] **Step 7: Enemy damage DEF calc — parameterized Attunement/Forte calls**

Find:
```typescript
        const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
        const forteDefBonus = isDevGuild ? getSolaceForteDefBonus(forteEmpoweredTurnsLeft > 0) : 0;
        const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus);
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
```

Replace with:
```typescript
        const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
        const forteDefBonus = isDevGuild ? getSolaceForteDefBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const attunementDefBonus = solaceAttunementDefBonus(solaceSkillLevel);
        const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDefBonus, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus);
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors. (This is the task that finally makes the whole project typecheck clean again after Tasks 1-2 intentionally broke it.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): wire kit levels into /encounter combat effects (Milestone 2e)"
```

---

### Task 4: Verification

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
npx tsx scripts/test-attunement.ts
grep -n "isDevGuild" src/lib/encounter.ts   # re-audit every touched branch is still gated
grep -n "SOLACE.intro" src/lib/encounter.ts # expect ZERO matches — replaced by solaceIntroEffect(...)
```

- [ ] **Step 2: Manual — deploy and playtest**

On the VM: `git pull && npx prisma generate && npm run build && pm2 restart cartethyia` (no schema change this milestone, `prisma generate` isn't strictly needed but harmless to include; no new slash command, so `npm run deploy` isn't needed either).

In the dev guild:
- [ ] Fight an encounter with a completely fresh/unleveled Solace (Lv1 everywhere) and confirm every number matches exactly how it behaved before this milestone — Chime Strike damage, Attunement's team buff %, Convergence's heal %, Intro's heal %, Forte's Empowered bonus. Nothing should feel different yet.
- [ ] Use `/character`, level up all 5 of Solace's tracks a few levels each (spend some Forging Ores).
- [ ] Fight another encounter and confirm each leveled track is now visibly stronger: Chime Strike hits harder, Attunement's active-mode buff is bigger (compare a Basic Attack's damage while a mode is active before vs. after leveling Skill), Convergence heals a bigger % AND now heals both your own HP and Solace's `allyHp` (check the benched unit's HP bar/status line actually goes up too, not just the active one), Intro's swap-heal is bigger, and Forte's Empowered window (after maxing Forte's gauge and using Convergence while it's full) shows a noticeably bigger cross-mode bonus than before leveling.
- [ ] Confirm non-dev-guild `/encounter` is still completely unaffected (spot-check another server).

- [ ] **Step 3: Report findings back**

Same as before — if something's off, tell me exactly what you saw and I'll fix it directly rather than re-planning from scratch.
