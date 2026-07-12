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
