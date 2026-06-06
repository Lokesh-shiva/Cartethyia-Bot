import { Element } from "@prisma/client";

export type EchoCost = 1 | 3 | 4;
export type EchoRarityKey = "THREE_STAR" | "FOUR_STAR" | "FIVE_STAR";

export interface EchoDefinition {
  name:       string;
  element:    Element;
  cost:       EchoCost;
  assetFile:  string;   // assets/echoes/<file>
  // base combat stats (for encounter resolution)
  hp:         number;
  atk:        number;
  def:        number;
  // drop rarity weights [3★, 4★, 5★]
  rarityWeights: [number, number, number];
}

export const ECHO_DEFINITIONS: EchoDefinition[] = [
  // ── 1-cost common (one per element) ────────────────────────────────────────
  {
    name: "Ember Wisp",      element: "FUSION",  cost: 1,
    assetFile: "ember_wisp.svg",
    hp: 180, atk: 28, def: 12,
    rarityWeights: [92, 8, 0],
  },
  {
    name: "Frost Mote",      element: "GLACIO",  cost: 1,
    assetFile: "frost_mote.svg",
    hp: 200, atk: 22, def: 18,
    rarityWeights: [92, 8, 0],
  },
  {
    name: "Static Spark",    element: "ELECTRO", cost: 1,
    assetFile: "static_spark.svg",
    hp: 160, atk: 32, def: 10,
    rarityWeights: [92, 8, 0],
  },
  {
    name: "Zephyr Mite",     element: "AERO",    cost: 1,
    assetFile: "zephyr_mite.svg",
    hp: 170, atk: 30, def: 14,
    rarityWeights: [92, 8, 0],
  },
  {
    name: "Shadow Flicker",  element: "HAVOC",   cost: 1,
    assetFile: "shadow_flicker.svg",
    hp: 190, atk: 26, def: 16,
    rarityWeights: [92, 8, 0],
  },
  {
    name: "Lumen Speck",     element: "SPECTRO", cost: 1,
    assetFile: "lumen_speck.svg",
    hp: 175, atk: 24, def: 20,
    rarityWeights: [92, 8, 0],
  },

  // ── 3-cost field (one per element) ─────────────────────────────────────────
  {
    name: "Magma Sentinel",  element: "FUSION",  cost: 3,
    assetFile: "magma_sentinel.svg",
    hp: 520, atk: 72, def: 38,
    rarityWeights: [75, 22, 3],
  },
  {
    name: "Glacial Warden",  element: "GLACIO",  cost: 3,
    assetFile: "glacial_warden.svg",
    hp: 580, atk: 60, def: 55,
    rarityWeights: [75, 22, 3],
  },
  {
    name: "Thunder Drake",   element: "ELECTRO", cost: 3,
    assetFile: "thunder_drake.svg",
    hp: 490, atk: 82, def: 32,
    rarityWeights: [75, 22, 3],
  },
  {
    name: "Storm Harbinger", element: "AERO",    cost: 3,
    assetFile: "storm_harbinger.svg",
    hp: 510, atk: 76, def: 36,
    rarityWeights: [75, 22, 3],
  },
  {
    name: "Void Stalker",    element: "HAVOC",   cost: 3,
    assetFile: "void_stalker.svg",
    hp: 550, atk: 68, def: 44,
    rarityWeights: [75, 22, 3],
  },
  {
    name: "Radiant Keeper",  element: "SPECTRO", cost: 3,
    assetFile: "radiant_keeper.svg",
    hp: 540, atk: 64, def: 50,
    rarityWeights: [75, 22, 3],
  },
];

// Boss echoes (4-cost) are awarded by the ascension system, not encounters.
// These definitions are used when the ascension system creates the drop.
export const BOSS_ECHO_DEFINITIONS: EchoDefinition[] = [
  {
    name: "Resonant Wraith",     element: "HAVOC",  cost: 4,
    assetFile: "resonant_wraith.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 75, 25],
  },
  {
    name: "Tidecaller Sovereign", element: "GLACIO", cost: 4,
    assetFile: "tidecaller_sovereign.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 70, 30],
  },
  {
    name: "Fractured Arbiter",   element: "ELECTRO", cost: 4,
    assetFile: "fractured_arbiter.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 60, 40],
  },
  {
    name: "Nullfire Construct",  element: "ELECTRO", cost: 4,
    assetFile: "nullfire_construct.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 55, 45],
  },
  {
    name: "Sable Harbinger",     element: "HAVOC",   cost: 4,
    assetFile: "sable_harbinger.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 50, 50],
  },
  {
    name: "Auric Colossus",      element: "SPECTRO", cost: 4,
    assetFile: "auric_colossus.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 40, 60],
  },
  // ── Field boss 4-cost echoes (one per element, farmed via /field-boss) ──────
  {
    name: "Ignis Behemoth",      element: "FUSION",  cost: 4,
    assetFile: "ignis_behemoth.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 80, 20],
  },
  {
    name: "Permafrost Sovereign", element: "GLACIO", cost: 4,
    assetFile: "permafrost_sovereign.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 80, 20],
  },
  {
    name: "Voltaic Aberrant",    element: "ELECTRO", cost: 4,
    assetFile: "voltaic_aberrant.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 80, 20],
  },
  {
    name: "Tempest Ancient",     element: "AERO",    cost: 4,
    assetFile: "tempest_ancient.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 80, 20],
  },
  {
    name: "Null Ravager",        element: "HAVOC",   cost: 4,
    assetFile: "null_ravager.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 80, 20],
  },
  {
    name: "Luminal Specter",     element: "SPECTRO", cost: 4,
    assetFile: "luminal_specter.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 80, 20],
  },

  // ── WL6 / WL7 / WL8 boss echoes ─────────────────────────────────────────────
  {
    name: "Embercrown Tyrant",   element: "FUSION",  cost: 4,
    assetFile: "embercrown_tyrant.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 60, 40],
  },
  {
    name: "Galeborne Phantom",   element: "AERO",    cost: 4,
    assetFile: "galeborne_phantom.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 55, 45],
  },
  {
    name: "Resonant Absolute",   element: "SPECTRO", cost: 4,
    assetFile: "resonant_absolute.svg",
    hp: 0, atk: 0, def: 0,
    rarityWeights: [0, 40, 60],
  },
];

export const ALL_ECHO_DEFINITIONS = [...ECHO_DEFINITIONS, ...BOSS_ECHO_DEFINITIONS];

// ── Element colours ──────────────────────────────────────────────────────────
export const ELEMENT_COLORS: Record<Element, number> = {
  NONE:    0x8899AA,
  FUSION:  0xFF6B35,
  GLACIO:  0x4FC3F7,
  ELECTRO: 0xB39DDB,
  AERO:    0x80CBC4,
  HAVOC:   0x9C27B0,
  SPECTRO: 0xFFD54F,
};

export const ELEMENT_EMOJI: Record<Element, string> = {
  NONE:    "◇",
  FUSION:  "🔥",
  GLACIO:  "❄️",
  ELECTRO: "⚡",
  AERO:    "🌪️",
  HAVOC:   "🌑",
  SPECTRO: "✨",
};

// ── Rarity helpers ───────────────────────────────────────────────────────────
export const RARITY_STARS: Record<string, string> = {
  THREE_STAR: "★★★",
  FOUR_STAR:  "★★★★",
  FIVE_STAR:  "★★★★★",
};

export function rollRarity(weights: [number, number, number]): EchoRarityKey {
  const roll = Math.random() * 100;
  if (roll < weights[0]) return "THREE_STAR";
  if (roll < weights[0] + weights[1]) return "FOUR_STAR";
  return "FIVE_STAR";
}

// ── Substat pool ─────────────────────────────────────────────────────────────
export const SUBSTAT_POOL = [
  "ATK_FLAT", "ATK_PCT", "HP_FLAT", "HP_PCT",
  "DEF_FLAT", "DEF_PCT", "CRIT_RATE", "CRIT_DMG",
  "ELEM_DMG_PCT", "ENERGY_REGEN", "SPEED",
];

export const SUBSTAT_LABELS: Record<string, string> = {
  ATK_FLAT:    "ATK",
  ATK_PCT:     "ATK%",
  HP_FLAT:     "HP",
  HP_PCT:      "HP%",
  DEF_FLAT:    "DEF",
  DEF_PCT:     "DEF%",
  CRIT_RATE:   "Crit Rate",
  CRIT_DMG:    "Crit DMG",
  ELEM_DMG_PCT:"Elem DMG%",
  ENERGY_REGEN:"Energy Regen",
  SPEED:       "Speed",
};

export const MAIN_STAT_POOL: Record<EchoCost, string[]> = {
  4: ["CRIT_RATE", "CRIT_DMG", "HP_PCT", "ATK_PCT", "ELEM_DMG_PCT", "DEF_PCT"],
  3: ["HP_PCT", "ATK_PCT", "DEF_PCT", "FUSION_DMG", "GLACIO_DMG", "ELECTRO_DMG", "AERO_DMG", "HAVOC_DMG", "SPECTRO_DMG", "HEALING_PCT"],
  1: ["HP_FLAT", "HP_PCT", "ATK_FLAT", "ATK_PCT", "DEF_FLAT", "DEF_PCT"],
};

export const MAIN_STAT_LABELS: Record<string, string> = {
  ...SUBSTAT_LABELS,
  FUSION_DMG:   "Fusion DMG Bonus",
  GLACIO_DMG:   "Glacio DMG Bonus",
  ELECTRO_DMG:  "Electro DMG Bonus",
  AERO_DMG:     "Aero DMG Bonus",
  HAVOC_DMG:    "Havoc DMG Bonus",
  SPECTRO_DMG:  "Spectro DMG Bonus",
  HEALING_PCT:  "Healing Bonus",
};

export function rollMainStat(cost: EchoCost, element?: Element): string {
  const pool = MAIN_STAT_POOL[cost];
  // Bias 3-cost toward matching element's DMG bonus (40% chance if element given)
  if (cost === 3 && element && element !== "NONE") {
    if (Math.random() < 0.4) return `${element}_DMG`;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

export function rollSubstats(count: number, excludeMain: string): string[] {
  const pool = SUBSTAT_POOL.filter(s => s !== excludeMain);
  const chosen: string[] = [];
  while (chosen.length < count) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!chosen.includes(pick)) chosen.push(pick);
  }
  return chosen;
}

export function substatCount(rarity: EchoRarityKey): number {
  return rarity === "THREE_STAR" ? 3 : rarity === "FOUR_STAR" ? 4 : 5;
}

export function maxEchoLevel(rarity: EchoRarityKey | string): number {
  if (rarity === "FIVE_STAR")  return 25;
  if (rarity === "FOUR_STAR")  return 20;
  return 15; // THREE_STAR
}

// ── Substat value ranges ─────────────────────────────────────────────────────
// [min, max] for a single substat roll
const SUBSTAT_RANGES: Record<string, [number, number]> = {
  ATK_FLAT:    [30,  70],
  ATK_PCT:     [4.0, 9.0],
  HP_FLAT:     [200, 500],
  HP_PCT:      [4.0, 9.0],
  DEF_FLAT:    [20,  50],
  DEF_PCT:     [5.0, 11.0],
  CRIT_RATE:   [3.2, 6.3],
  CRIT_DMG:    [6.4, 12.6],
  ELEM_DMG_PCT:[4.0, 9.0],
  ENERGY_REGEN:[4.0, 9.0],
  SPEED:       [4,   8],
};

// Flat stats (displayed as integers)
export const FLAT_STATS = new Set(["ATK_FLAT", "HP_FLAT", "DEF_FLAT", "SPEED"]);

export function rollSubstatValue(type: string): number {
  const [min, max] = SUBSTAT_RANGES[type] ?? [0, 0];
  const val = min + Math.random() * (max - min);
  return FLAT_STATS.has(type) ? Math.round(val) : Math.round(val * 10) / 10;
}

// ── Main stat values by level ────────────────────────────────────────────────
// base = value at level 0, max = value at level 25 (for 5★)
const MAIN_STAT_5STAR: Record<string, { base: number; max: number }> = {
  CRIT_RATE:    { base: 6.3,  max: 22.1 },
  CRIT_DMG:     { base: 12.6, max: 44.1 },
  ATK_PCT:      { base: 8.0,  max: 30.0 },
  HP_PCT:       { base: 8.0,  max: 30.0 },
  DEF_PCT:      { base: 10.0, max: 35.0 },
  ELEM_DMG_PCT: { base: 8.0,  max: 30.0 },
  FUSION_DMG:   { base: 8.0,  max: 30.0 },
  GLACIO_DMG:   { base: 8.0,  max: 30.0 },
  ELECTRO_DMG:  { base: 8.0,  max: 30.0 },
  AERO_DMG:     { base: 8.0,  max: 30.0 },
  HAVOC_DMG:    { base: 8.0,  max: 30.0 },
  SPECTRO_DMG:  { base: 8.0,  max: 30.0 },
  HEALING_PCT:  { base: 8.0,  max: 30.0 },
  HP_FLAT:      { base: 500,  max: 2000  },
  ATK_FLAT:     { base: 40,   max: 150   },
  DEF_FLAT:     { base: 30,   max: 100   },
};

const RARITY_MULTIPLIER: Record<string, number> = {
  THREE_STAR: 0.60,
  FOUR_STAR:  0.82,
  FIVE_STAR:  1.00,
};

export function calcMainStatValue(type: string, level: number, rarity: string): number {
  const def    = MAIN_STAT_5STAR[type] ?? { base: 0, max: 0 };
  const mult   = RARITY_MULTIPLIER[rarity] ?? 1;
  const maxLvl = maxEchoLevel(rarity);
  const val    = (def.base + (def.max - def.base) * (level / maxLvl)) * mult;
  return FLAT_STATS.has(type) ? Math.round(val) : Math.round(val * 10) / 10;
}

// ── Tuning Module upgrade cost ───────────────────────────────────────────────
// Cost to go from `level` to `level + 1`
export function upgradeCost(level: number): number {
  if (level < 5)  return 1;
  if (level < 10) return 2;
  if (level < 15) return 3;
  if (level < 20) return 4;
  return 5;
}

export const MAX_ECHO_LEVEL = 25;

// ── Substat scaling with echo level ─────────────────────────────────────────
// Substats grow +10% per 5 levels, reaching 1.5× their rolled value at level 25.
// The rolled (base) value is stored in the DB; this is always computed on the fly.
export function calcSubstatValue(type: string, base: number, level: number): number {
  const scaled = base * (1 + level / 50);
  return FLAT_STATS.has(type) ? Math.round(scaled) : Math.round(scaled * 10) / 10;
}

// ── Format a stat value for display ─────────────────────────────────────────
export function formatStatValue(type: string, value: number): string {
  if (FLAT_STATS.has(type)) return `${value}`;
  return `${value}%`;
}

// ── Pick a random encounter enemy ────────────────────────────────────────────
// 3-cost echoes are available from WL0 — players need them to build their grid.
// Rate scales with WL so field enemies become more common as you progress.
// Rarity (not cost tier) is what's gated by WL.
export function pickEncounterEnemy(worldLevel: number): EchoDefinition {
  const threeCosters = ECHO_DEFINITIONS.filter(e => e.cost === 3);
  const oneCosters   = ECHO_DEFINITIONS.filter(e => e.cost === 1);

  // WL0: 15% · WL1: 23% · WL2: 31% · ... caps at 75% at WL8
  const fieldChance = Math.min(0.75, 0.15 + worldLevel * 0.08);
  const pool = Math.random() < fieldChance ? threeCosters : oneCosters;
  return pool[Math.floor(Math.random() * pool.length)];
}
