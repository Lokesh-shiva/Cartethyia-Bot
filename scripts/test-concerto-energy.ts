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
