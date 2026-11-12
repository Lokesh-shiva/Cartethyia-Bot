// Chapter 1: "The Cost of Ember". Text is DRAFT pending owner approval (Task 11).
import type { EchoDefinition } from "../echoes";
import type { WaveDefinition } from "../dungeons";
import type { ChapterDefinition } from "./types";

// Story-only enemies: deliberately NOT in ECHO_DEFINITIONS so they never drop or appear elsewhere.
const ASH_WRAITH: EchoDefinition = {
  name: "Ash Wraith", element: "FUSION", cost: 1, assetFile: "Ash Wraith.png",
  hp: 190, atk: 28, def: 16, rarityWeights: [100, 0, 0],
};
const CINDER_HOUND: EchoDefinition = {
  name: "Cinder Hound", element: "FUSION", cost: 1, assetFile: "Cinder Hound.png",
  hp: 210, atk: 30, def: 18, rarityWeights: [100, 0, 0],
};
const LAST_EMBER: EchoDefinition = {
  name: "The Last Ember", element: "FUSION", cost: 3, assetFile: "The Last Ember.png",
  hp: 560, atk: 66, def: 52, rarityWeights: [100, 0, 0],
};

const w = (e: EchoDefinition, hp: number, atk: number, def: number): WaveDefinition =>
  ({ enemyName: e.name, hpMult: hp, atkMult: atk, defMult: def, customEnemy: e });

export const CHAPTER_1: ChapterDefinition = {
  id: 1,
  title: "The Cost of Ember",
  blurb: "Bren walked into the Ashen Reach once and counted what it cost. Walk it with them.",
  requiresWorldLevel: 9,
  clearsToWorldLevel: 10,
  enemyWorldLevel: 10,
  hardModeMult: 1.4,
  rewards: {
    weaponId: "cinderheart",
    firstClear: { credits: 40000, fractonite: 150, emberShards: 3 },
    replay: { credits: 15000, fractonite: 50, emberShards: 2 },
  },
  nodes: [
    {
      kind: "FIGHT", title: "Ashfall Gate", art: "backdrop",
      intro: "The gate to the Ashen Reach is a ribcage of black stone. Ash falls like snow. Something in it is already moving.",
      resultText: "Bren crouches by the fallen wraith and counts the burn marks on its arm. 'Thirteen scars. Somebody fed this thing on purpose.'",
      waves: [w(ASH_WRAITH, 4.0, 3.5, 3.0), w(ASH_WRAITH, 4.5, 4.0, 3.5)],
    },
    {
      kind: "PUZZLE", title: "The Ember Sequence", art: "shrine",
      intro: "A shrine hums in the dark. Four embers burn in a ring, and a relic waits at its center. They flare in a pattern. Repeat it.",
      puzzle: {
        kind: "SEQUENCE", limit: 2, failCostFraction: 0.10, hintCostFraction: 0.05,
        success: { hpGainFraction: 0.10, setsFlag: "relic" },
        forceOption: { label: "Take the relic by force", hpCostFraction: 0.20, setsFlag: "relic" },
      },
      resultText: "The embers settle. The relic is warm, and it costs you nothing you will miss. Yet.",
    },
    {
      kind: "FIGHT", title: "Cinder Crawl", art: "cinder-hound",
      intro: "The tunnel narrows. Hounds of cinder pace the walls, and the heat tastes of old iron.",
      resultText: "Bren wipes soot from a hound's flank. 'Seventeen scars on this one. Whoever made them wanted a count kept.'",
      waves: [w(CINDER_HOUND, 4.2, 3.8, 3.2), w(CINDER_HOUND, 4.8, 4.2, 3.6)],
    },
    {
      kind: "REST", title: "The Cooling Pool", art: "pool", restFraction: 0.3,
      intro: "A pool of cold water sits in the heat, perfectly still. You drink. Bren sits apart and stares at the wall.",
      resultText: "On the pool's edge someone has scratched marks into the stone. Bren touches them. 'Eleven scars. That is the last of the clues you can use. Remember them.'",
    },
    {
      kind: "PUZZLE", title: "Light the Lanterns", art: "pool",
      intro: "Nine lanterns hang over the pool, some lit, some dark. Pressing one flips it and its neighbors. Light them all.",
      puzzle: {
        kind: "LANTERNS", limit: 12, failCostFraction: 0.10, hintCostFraction: 0.05,
        success: { hpGainFraction: 0.15, setsFlag: "lanterns_lit" },
      },
      resultText: "Every lantern burns. The pool warms, and the way forward shows itself.",
    },
    {
      kind: "PUZZLE", title: "The Scar Count", art: "stranger",
      intro: "A Stranger stands where the path bends. 'Three scars were counted before you reached me. Add them. The sum is the toll. Pay it wrong and the Reach keeps you.'",
      puzzle: {
        kind: "SCAR_COUNT", clues: [13, 17, 11], limit: 2, failCostFraction: 0.10, hintCostFraction: 0.05,
        success: { hpGainFraction: 0.10, setsFlag: "knows_scar_count" },
      },
      resultText: "The Stranger nods once. 'Forty-one. Bren counted the same, long ago. It did not save them.'",
    },
    {
      kind: "STORY_BREN_FIGHT", title: "The First Scar", art: "flashback",
      intro: "The ash closes in and the world tilts. This is Bren's memory, not yours. Fight as they fought: alone, counting every cost.",
      // Flashback fights run at world level 0 against Bren's ungeared loaner stats (see runFightNode), so these are small.
      waves: [w(ASH_WRAITH, 4, 3, 3), w(CINDER_HOUND, 4, 3.5, 3)],
      resultText: "The memory breaks. Bren's first scar was the one they gave themselves, to keep going.",
    },
    {
      kind: "BOSS", title: "The Last Ember", art: "boss",
      intro: "At the heart of the Reach, one ember refuses to die. It burns hotter every turn it is ignored. It is what remains of everything the Reach consumed.",
      waves: [w(LAST_EMBER, 14, 9, 8)],
      resultText: "The Last Ember gutters out. The ash stops falling.",
    },
  ],
};
