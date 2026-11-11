import { test } from "node:test";
import assert from "node:assert/strict";
import { planClearRewards } from "./rewards";
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
    advanceWorldLevelTo: 10, grantWeaponId: "cinderheart", currencies: firstClear,
  });
});

test("an already-cleared chapter pays only the replay bundle", () => {
  assert.deepEqual(planClearRewards(chapter, true, "NORMAL"), {
    advanceWorldLevelTo: null, grantWeaponId: null, currencies: replay,
  });
});

test("HARD never advances or grants the weapon, even if the chapter was somehow not yet cleared", () => {
  assert.deepEqual(planClearRewards(chapter, false, "HARD"), {
    advanceWorldLevelTo: null, grantWeaponId: null, currencies: replay,
  });
  assert.deepEqual(planClearRewards(chapter, true, "HARD"), {
    advanceWorldLevelTo: null, grantWeaponId: null, currencies: replay,
  });
});
