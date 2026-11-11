import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STORY_WEAPONS, WISH_WEAPONS_4STAR, WISH_WEAPONS_5STAR, WELLSPRING_WEAPON,
  getWishWeapon, weaponCreateData,
} from "../wishWeapons";
import { WEAPON_PASSIVES } from "../weapons";
import { WORLD_LEVEL_CAPS } from "../progression";

test("Cinderheart is a story weapon resolvable by id", () => {
  const w = getWishWeapon("cinderheart");
  assert.ok(w);
  assert.equal(w!.name, "Cinderheart");
  assert.equal(w!.rarity, 4);
  assert.equal(w!.type, "BROADBLADE");
  assert.ok(STORY_WEAPONS.includes(w!));
});

test("story weapons are never in any banner pool", () => {
  const banner = new Set([...WISH_WEAPONS_4STAR, ...WISH_WEAPONS_5STAR, WELLSPRING_WEAPON].map(w => w.id));
  for (const w of STORY_WEAPONS) assert.equal(banner.has(w.id), false, `${w.id} must not be in a banner pool`);
});

test("WORLD_LEVEL_CAPS keeps WL9 at 90 and adds WL10 at 95", () => {
  assert.equal(WORLD_LEVEL_CAPS[9], 90);
  assert.equal(WORLD_LEVEL_CAPS[10], 95);
});

test("Cinderheart's passive is registered by name with the +28% low-HP damage effect", () => {
  const passive = WEAPON_PASSIVES["Cinderheart"];
  assert.ok(passive);
  assert.deepEqual(passive!.effects?.map(e => [e.type, e.value]), [["BERSERK", 0.28]]);
});

test("weaponCreateData builds an unequipped weapon row for a user", () => {
  const row = weaponCreateData("user1", getWishWeapon("cinderheart")!);
  assert.equal(row.userId, "user1");
  assert.equal(row.name, "Cinderheart");
  assert.equal(row.weaponType, "BROADBLADE");
  assert.equal(row.rarity, 4);
  assert.equal(row.isEquipped, false);
  assert.equal(row.hiddenSub2Type, null);
});
