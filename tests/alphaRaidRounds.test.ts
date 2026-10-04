import assert from "node:assert/strict";
import test from "node:test";

import {
  beginAlphaRound,
  recordAlphaAction,
  type AlphaRoundParticipant,
} from "../src/lib/alphaRaidRounds";

function participants(...ids: string[]): AlphaRoundParticipant[] {
  return ids.map(userId => ({ userId, isDefeated: false }));
}

test("gives each living Alpha participant one action before the round completes", () => {
  const roster = participants("p1", "p2", "p3");
  let round = beginAlphaRound(roster, 0);

  assert.equal(round.currentIndex, 0);
  assert.equal(round.roundComplete, false);

  round = recordAlphaAction(round, roster, "p1");
  assert.equal(round.currentIndex, 1);
  assert.equal(round.roundComplete, false);

  round = recordAlphaAction(round, roster, "p2");
  assert.equal(round.currentIndex, 2);
  assert.equal(round.roundComplete, false);

  round = recordAlphaAction(round, roster, "p3");
  assert.equal(round.roundComplete, true);
});

test("skips defeated participants when selecting the next Alpha action", () => {
  const roster: AlphaRoundParticipant[] = [
    { userId: "p1", isDefeated: false },
    { userId: "p2", isDefeated: true },
    { userId: "p3", isDefeated: false },
  ];
  let round = beginAlphaRound(roster, 0);

  round = recordAlphaAction(round, roster, "p1");

  assert.equal(round.currentIndex, 2);
  assert.equal(round.roundComplete, false);
});
