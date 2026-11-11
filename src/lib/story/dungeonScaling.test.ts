import { test } from "node:test";
import assert from "node:assert/strict";
import { getDungeon, getScaledWaveEnemy, type DungeonDefinition } from "../dungeons";
import { ECHO_DEFINITIONS, type EchoDefinition } from "../echoes";

const custom: EchoDefinition = {
  name: "Zzz Test Wraith", element: "FUSION", cost: 1, assetFile: "none.png",
  hp: 1000, atk: 100, def: 50, rarityWeights: [100, 0, 0],
};

function dungeonWith(wave: DungeonDefinition["waves"][number]): DungeonDefinition {
  return { ...getDungeon("boss_absolute")!, waves: [wave] };
}

test("getScaledWaveEnemy uses customEnemy instead of looking the name up in ECHO_DEFINITIONS", () => {
  const d = dungeonWith({ enemyName: "Zzz Test Wraith", hpMult: 4, atkMult: 3, defMult: 2, customEnemy: custom });
  const r = getScaledWaveEnemy(d, 0, 10);
  const wlScale = Math.pow(1.45, 10);
  assert.equal(r.def, custom);
  assert.equal(r.hp, Math.floor(custom.hp * 4 * wlScale));
  assert.equal(r.atk, Math.floor(custom.atk * 3 * wlScale));
  assert.equal(r.def_, Math.floor(custom.def * 2 * wlScale));
});

test("getScaledWaveEnemy for an existing dungeon is unchanged by customEnemy support", () => {
  const d = getDungeon("boss_absolute")!;
  const speck = ECHO_DEFINITIONS.find(e => e.name === "Lumen Speck")!;
  const r = getScaledWaveEnemy(d, 2, 8);
  const wlScale = Math.pow(1.45, 8);
  assert.equal(r.def, speck);
  assert.equal(r.hp, Math.floor(speck.hp * 9.0 * wlScale));
  assert.equal(r.atk, Math.floor(speck.atk * 8.5 * wlScale));
  assert.equal(r.def_, Math.floor(speck.def * 8.0 * wlScale));
});
