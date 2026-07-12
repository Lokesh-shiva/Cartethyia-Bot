// scripts/test-attunement.ts
// Usage: npx tsx scripts/test-attunement.ts
import assert from "assert";
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
