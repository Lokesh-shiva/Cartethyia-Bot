import { test } from "node:test";
import assert from "node:assert/strict";
import { carryOverWaveState, type WaveResult } from "../../commands/rpg/dungeon";

function result(over: Record<string, unknown> = {}): WaveResult {
  return {
    survived: true, playerHp: 123, playerEnergy: 40, skillCooldown: 3,
    attunementDoubleTurnsLeft: 2, forteEmpoweredTurnsLeft: 0, quickStrikeUsed: true,
    ...over,
  } as unknown as WaveResult;
}

test("carryOverWaveState drops survived, keeps HP/energy/flags and ticks cooldowns down by one", () => {
  const next = carryOverWaveState(result()) as unknown as Record<string, unknown>;
  assert.equal("survived" in next, false);
  assert.equal(next.playerHp, 123);
  assert.equal(next.playerEnergy, 40);
  assert.equal(next.quickStrikeUsed, true);
  assert.equal(next.skillCooldown, 2);
  assert.equal(next.attunementDoubleTurnsLeft, 1);
  assert.equal(next.forteEmpoweredTurnsLeft, 0);
});

test("carryOverWaveState floors cooldowns at zero and does not mutate its input", () => {
  const input = result({ skillCooldown: 0, attunementDoubleTurnsLeft: 0 });
  const next = carryOverWaveState(input) as unknown as Record<string, unknown>;
  assert.equal(next.skillCooldown, 0);
  assert.equal(next.attunementDoubleTurnsLeft, 0);
  assert.equal((input as unknown as Record<string, unknown>).survived, true);
  assert.equal((input as unknown as Record<string, unknown>).skillCooldown, 0);
});
