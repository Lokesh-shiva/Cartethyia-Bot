import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoanerBundle, loanerRoster, STORY_BREN_LEVEL, STORY_BREN_KIT_LEVEL } from "./loaner";
import { CHARACTER_KITS } from "../characterKit";
import { applyBonuses, emptyPlayerBonuses } from "../setBonus";
import "../kits";

test("story Bren constants are 70 and 5", () => {
  assert.equal(STORY_BREN_LEVEL, 70);
  assert.equal(STORY_BREN_KIT_LEVEL, 5);
});

test("buildLoanerBundle builds a gear-less Bren at the requested level and kit level", () => {
  const b = buildLoanerBundle("bren", 70, 5);
  const s = CHARACTER_KITS.bren!.statsAtLevel(70);
  const expected = applyBonuses(
    { baseHp: s.hpMax, baseAtk: s.baseAtk, baseDef: s.baseDef, critRate: s.critRate, critDmg: s.critDmg, baseSpeed: s.baseSpeed },
    emptyPlayerBonuses("FUSION"),
  );
  assert.equal(b.kit.id, "bren");
  assert.equal(b.characterId, "bren");
  assert.equal(b.constellation, 0);
  assert.deepEqual(
    [b.basicLevel, b.skillLevel, b.ultimateLevel, b.introLevel, b.forteLevel],
    [5, 5, 5, 5, 5],
  );
  assert.equal(b.hpMax, expected.hp);
  assert.equal(b.hp, b.hpMax);
  assert.ok(b.hpMax > 0);
});

test("buildLoanerBundle gives Bren his element's innate passive and no gear", () => {
  const b = buildLoanerBundle("bren", 70, 5);
  assert.ok(b.bonuses.elementPassive, "Fusion innate passive expected");
  assert.equal(b.bonuses.set4pc, null);
  assert.equal(b.bonuses.echoSkill, null);
  assert.equal(b.bonuses.equippedWeaponName, null);
});

test("buildLoanerBundle creates a fresh mechanic state each call", () => {
  const a = buildLoanerBundle("bren", 70, 5);
  const c = buildLoanerBundle("bren", 70, 5);
  assert.notEqual(a.mechanicState, c.mechanicState);
});

test("loanerRoster puts the character in position 1 and leaves 2 and 3 empty", () => {
  const r = loanerRoster("bren");
  assert.equal(r.position1, "bren");
  assert.equal(r.position2, null);
  assert.equal(r.position3, null);
});

test("buildLoanerBundle throws for an unknown character id", () => {
  assert.throws(() => buildLoanerBundle("nobody", 70, 5), /unknown character/i);
});
