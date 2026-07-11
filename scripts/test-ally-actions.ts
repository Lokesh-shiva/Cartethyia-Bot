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
