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
