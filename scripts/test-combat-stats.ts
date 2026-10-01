// Usage: npx tsx scripts/test-combat-stats.ts
import assert from "assert";
import {
  addCombatStats,
  emptyCombatStats,
  formatCombatStats,
  formatCombatStatsSummary,
  recordDamageDone,
  recordDamageTaken,
  recordDirectHeal,
  recordLifesteal,
  recordShatter,
  recordVibrationDamage,
  sumCombatStats,
} from "../src/lib/combatStats";

const stats = emptyCombatStats();
assert.deepStrictEqual(stats, {
  damageTaken: 0,
  damageDone: 0,
  healed: 0,
  lifesteal: 0,
  vibrationDamage: 0,
  shatters: 0,
});

assert.strictEqual(recordDamageDone(stats, 1_000, 725), 275);
assert.strictEqual(recordDamageTaken(stats, 900, 640), 260);
assert.strictEqual(recordDirectHeal(stats, 500, 650), 150);
assert.strictEqual(recordDirectHeal(stats, 900, 1_000), 100);
assert.strictEqual(recordDirectHeal(stats, 1_000, 1_000), 0);
assert.strictEqual(recordLifesteal(stats, 300, 420), 120);
assert.strictEqual(recordLifesteal(stats, 1_000, 1_000), 0);
assert.strictEqual(recordVibrationDamage(stats, 500, 350), 150);
assert.strictEqual(recordVibrationDamage(stats, 40, 0), 40);
recordShatter(stats);

assert.deepStrictEqual(stats, {
  damageTaken: 260,
  damageDone: 275,
  healed: 250,
  lifesteal: 120,
  vibrationDamage: 190,
  shatters: 1,
});

const second = emptyCombatStats();
recordDamageDone(second, 100, 50);
recordDirectHeal(second, 0, 20);
recordShatter(second);

assert.deepStrictEqual(sumCombatStats([stats, second]), {
  damageTaken: 260,
  damageDone: 325,
  healed: 270,
  lifesteal: 120,
  vibrationDamage: 190,
  shatters: 2,
});

assert.strictEqual(
  formatCombatStats(stats),
  "📊 Stats — DMG 275 · Taken 260 · Heal 250 · LS 120 · Vib 190 · Shatters 1",
);
assert.match(formatCombatStatsSummary(stats), /Damage done: \*\*275\*\*/);
assert.match(formatCombatStatsSummary(stats), /Lifesteal: \*\*120\*\*/);

assert.strictEqual(addCombatStats(emptyCombatStats(), stats).damageDone, 275);
console.log("✓ all combat-statistics tests passed");
