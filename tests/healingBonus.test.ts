import assert from "node:assert/strict";
import test from "node:test";

import { applyAllyAction } from "../src/lib/allyActions";
import { resolveIntroOutroEffect } from "../src/lib/introOutro";

const target = { hp: 0, hpMax: 1000 };

test("outgoing healing uses the healer's Healing Bonus", () => {
  const result = applyAllyAction(
    { type: "HEAL_ALLY", value: 0.1 },
    target,
    1,
  );

  assert.equal(result.hpDelta, 200);
});

test("intro/outro heals use the source healer's Healing Bonus", () => {
  const result = resolveIntroOutroEffect(
    { actions: [{ type: "HEAL_ALLY", value: 0.1 }] },
    target,
    4,
  );

  assert.equal(result.hpDelta, 500);
});
