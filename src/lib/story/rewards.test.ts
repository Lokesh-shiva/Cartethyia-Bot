import { test } from "node:test";
import assert from "node:assert/strict";
import { planClearRewards, needsWeaponCopy } from "./rewards";
import type { ChapterDefinition } from "./types";

const firstClear = { credits: 40000, fractonite: 150, emberShards: 3 };
const replay = { credits: 15000, fractonite: 50, emberShards: 2 };

const chapter: ChapterDefinition = {
  id: 1, title: "The Cost of Ember", blurb: "", requiresWorldLevel: 9, clearsToWorldLevel: 10,
  enemyWorldLevel: 10, hardModeMult: 1.4, nodes: [],
  rewards: { weaponId: "cinderheart", firstClear, replay },
};

test("a first NORMAL clear advances the world level, grants the weapon and pays the first-clear bundle", () => {
  assert.deepEqual(planClearRewards(chapter, false, "NORMAL"), {
    advanceWorldLevelTo: 10, grantWeaponId: "cinderheart", grantWeaponCopyId: null, currencies: firstClear,
  });
});

test("an already-cleared chapter pays the replay bundle and offers a weapon copy for refinement", () => {
  assert.deepEqual(planClearRewards(chapter, true, "NORMAL"), {
    advanceWorldLevelTo: null, grantWeaponId: null, grantWeaponCopyId: null, currencies: replay,
  });
  assert.deepEqual(planClearRewards(chapter, true, "HARD"), {
    advanceWorldLevelTo: null, grantWeaponId: null, grantWeaponCopyId: "cinderheart", currencies: replay,
  });
});

test("HARD never advances the world level or grants the first-clear weapon, even if the chapter was somehow not yet cleared", () => {
  const p = planClearRewards(chapter, false, "HARD");
  assert.equal(p.advanceWorldLevelTo, null);
  assert.equal(p.grantWeaponId, null);
  assert.deepEqual(p.currencies, replay);
});

test("needsWeaponCopy stops once owned copies reach R5 (refinement counts as merged copies)", () => {
  assert.equal(needsWeaponCopy([]), true);          // owns none (should not happen, still grants)
  assert.equal(needsWeaponCopy([1]), true);
  assert.equal(needsWeaponCopy([1, 1, 1, 1]), true);  // 4 copies, one short of R5
  assert.equal(needsWeaponCopy([3, 1]), true);        // R3 keeper + 1 spare = 4
  assert.equal(needsWeaponCopy([1, 1, 1, 1, 1]), false);
  assert.equal(needsWeaponCopy([5]), false);          // already R5
  assert.equal(needsWeaponCopy([4, 2]), false);
});
