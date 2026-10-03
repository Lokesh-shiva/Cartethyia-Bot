import assert from "assert";
import {
  autocompleteTargetUserId,
  classifyBonusLabels,
  formatCombatStatBlock,
  formatCharacterKitLines,
  truncateDiscordField,
} from "../src/lib/statsDisplay";
import { describeWeaponPassiveForRow } from "../src/lib/weapons";

const block = formatCombatStatBlock(
  {
    hp: 1_000, atk: 200, def: 150, spd: 101,
    critRate: 0.05, critDmg: 1.5,
  },
  {
    hp: 1_250, atk: 260, def: 150, spd: 121,
    critRate: 0.2, critDmg: 1.8,
    energyPerTurn: 30, lifesteal: 0.1, elemDmgBonus: 0.35,
  },
  { critRateBonus: 0.15, critDmgBonus: 0.3 },
  "✨",
);
assert.match(block, /HP — \*\*1,250\*\*  \*\(\+250\)\*/);
assert.match(block, /SPD — \*\*121\*\*  \*\(\+20\)\*/);
assert.match(block, /✨ Elem DMG Bonus — \*\*35\.0%\*\*/);
assert.match(block, /🩸 Lifesteal — \*\*10\.0%\*\*/);

assert.deepStrictEqual(
  classifyBonusLabels([
    "🌑 Havoc Innate — +15% ATK",
    "🗡️ Ruin Sovereign Lv90 — +500 ATK",
    "◈ Echo Stats: +20 ATK",
    "✦ Unique — Iron Will:\n  › +10% DEF",
  ]),
  {
    effects: ["🌑 Havoc Innate — +15% ATK"],
    weapon: ["🗡️ Ruin Sovereign Lv90 — +500 ATK"],
    echoes: ["◈ Echo Stats: +20 ATK"],
    abilities: ["✦ Unique — Iron Will:\n  › +10% DEF"],
  },
);

assert.deepStrictEqual(
  formatCharacterKitLines({
    basicLevel: 4,
    basicMultiplier: 1.3,
    skillLevel: 3,
    skillCooldownTurns: 2,
    ultimateLevel: 5,
    introLevel: 2,
    forteLevel: 6,
    constellation: 2,
    maxConstellation: 6,
  }),
  [
    "⚔️ Basic — Lv4 · ×1.30 ATK",
    "✦ Skill — Lv3 · 2-turn cooldown",
    "⚡ Ultimate — Lv5",
    "🔷 Intro — Lv2",
    "🌟 Forte — Lv6",
    "📜 Resonance Chain — C2/6",
  ],
);

assert.strictEqual(truncateDiscordField("a".repeat(1_100), 1_024).length, 1_024);
assert.strictEqual(truncateDiscordField("short", 1_024), "short");
assert.strictEqual(autocompleteTargetUserId("target-user", "invoking-user"), "target-user");
assert.strictEqual(autocompleteTargetUserId(undefined, "invoking-user"), "invoking-user");
assert.strictEqual(autocompleteTargetUserId({ id: "wrong-shape" }, "invoking-user"), "invoking-user");
assert.match(
  describeWeaponPassiveForRow({ name: "Twin Sparks", awakened: false, awakenedPassive: null, refinement: 3 }),
  /SPD: \+52/,
);
assert.match(
  describeWeaponPassiveForRow({
    name: "Custom Awakened", awakened: true, refinement: 2,
    awakenedPassive: { energyFlat: 10, spdFlat: 20, effects: [] },
  }),
  /Energy: \+11\.5 per turn[\s\S]*SPD: \+23/,
);
assert.match(
  describeWeaponPassiveForRow({
    name: "Capped Awakened", awakened: true, refinement: 5,
    awakenedPassive: { effects: [{ type: "EXECUTE", value: 0.60 }] },
  }),
  /Reaper's Mark: Vs enemies below 30% HP: \+78% DMG/,
);

console.log("✓ stats display tests passed");
