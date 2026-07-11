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
