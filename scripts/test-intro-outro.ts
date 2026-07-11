// scripts/test-intro-outro.ts
// Usage: npx tsx scripts/test-intro-outro.ts
import assert from "assert";
import { resolveIntroOutroEffect, IntroOutroEffect } from "../src/lib/introOutro";
import { AllyActionTarget } from "../src/lib/allyActions";

const target: AllyActionTarget = { hp: 500, hpMax: 1000 };

// An Intro Skill that heals + cleanses (matches Solace's Intro Skill shape from the spec)
const introEffect: IntroOutroEffect = {
  actions: [
    { type: "HEAL_ALLY", value: 0.2 },
    { type: "CLEANSE_ALLY", value: 1 },
  ],
};
let result = resolveIntroOutroEffect(introEffect, target);
assert.strictEqual(result.hpDelta, 200);
assert.strictEqual(result.cleanseCount, 1);
assert.strictEqual(result.shieldDelta, 0);

// An Outro Skill that shields + buffs ATK (matches Solace's Outro Skill shape)
const outroEffect: IntroOutroEffect = {
  actions: [
    { type: "SHIELD_ALLY", value: 0.15 },
    { type: "BUFF_ALLY_ATK", value: 0.1 },
  ],
};
result = resolveIntroOutroEffect(outroEffect, target);
assert.strictEqual(result.shieldDelta, 150);
assert.strictEqual(result.atkBuffPct, 0.1);

// An empty effect resolves to all zeros (e.g. the player's own character, per the design
// spec's universal-but-generic exception — a genuinely empty/minimal effect is a valid case)
result = resolveIntroOutroEffect({ actions: [] }, target);
assert.strictEqual(result.hpDelta, 0);
assert.strictEqual(result.shieldDelta, 0);
assert.strictEqual(result.atkBuffPct, 0);
assert.strictEqual(result.cleanseCount, 0);
assert.strictEqual(result.dmgMult, 0, "no dmgMult specified should resolve to 0 (no damage)");

// A DPS-archetype Intro Skill: real damage, no utility actions — e.g. a future
// character whose Intro is "deal 150% ATK damage to the enemy on swap-in"
const dpsIntro: IntroOutroEffect = { actions: [], dmgMult: 1.5 };
result = resolveIntroOutroEffect(dpsIntro, target);
assert.strictEqual(result.dmgMult, 1.5);
assert.strictEqual(result.hpDelta, 0, "pure-damage hook should not affect ally HP");

// Damage and utility actions can combine on the same hook (e.g. a hybrid Outro:
// deal some damage AND shield the incoming ally)
const hybridOutro: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.1 }], dmgMult: 0.8 };
result = resolveIntroOutroEffect(hybridOutro, target);
assert.strictEqual(result.dmgMult, 0.8);
assert.strictEqual(result.shieldDelta, 100);

console.log("✓ all Intro/Outro hook tests passed");
