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
