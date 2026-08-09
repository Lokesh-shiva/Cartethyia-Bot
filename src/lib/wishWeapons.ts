// Gacha weapon pool — 4★ and 5★ weapons obtainable via /wish

export interface WishWeapon {
  id:           string;
  name:         string;
  type:         "BROADBLADE" | "SWORD" | "PISTOLS" | "RECTIFIER";
  rarity:       4 | 5;
  baseAtk:      number;
  atkMaxMult:   number;   // ATK at Lv90 = baseAtk * atkMaxMult

  subStatType:  string;
  subStatBase:  number;   // value at Lv1
  subStatScale: number;   // multiplier at Lv90

  hiddenSub1Type:  string;
  hiddenSub1Base:  number;
  hiddenSub1Scale: number;

  hiddenSub2Type?: string;  // 5★ only, revealed at Lv50
  hiddenSub2Base?: number;
  hiddenSub2Scale?: number;

  passive:      string;
  lore:         string;
}

// Substat value at a given level:
//   val = base * (1 + (level - 1) * (scale - 1) / 89)
export function calcWishSubStat(base: number, scale: number, level: number): number {
  return Math.round((base * (1 + (level - 1) * (scale - 1) / 89)) * 10) / 10;
}

export function calcWishAtk(weapon: WishWeapon, level: number): number {
  return Math.round(weapon.baseAtk * (1 + (level - 1) * (weapon.atkMaxMult - 1) / 89));
}

// ── 4★ Weapons ────────────────────────────────────────────────────────────────

export const WISH_WEAPONS_4STAR: WishWeapon[] = [
  {
    id: "dawnbreaker", name: "Dawnbreaker", type: "SWORD", rarity: 4,
    baseAtk: 90, atkMaxMult: 4.2,
    subStatType:  "CRIT_DMG",   subStatBase: 18, subStatScale: 2.0,
    hiddenSub1Type: "CRIT_RATE", hiddenSub1Base: 8, hiddenSub1Scale: 2.0,
    passive: "Critical hits grant +18 Energy. Resonance Skill deals +18% bonus damage.",
    lore: "A sword forged at the cusp of dawn, its edge sharpened by the first light of a dying star.",
  },
  {
    id: "gravemaw", name: "Gravemaw", type: "BROADBLADE", rarity: 4,
    baseAtk: 152, atkMaxMult: 4.2,
    subStatType:  "HP_PERCENT",  subStatBase: 12, subStatScale: 2.0,
    hiddenSub1Type: "ATK_PERCENT", hiddenSub1Base: 6, hiddenSub1Scale: 2.0,
    passive: "Deals up to +32% bonus damage as your HP drops. Critical hits heal you for 8% of your max HP.",
    lore: "Carved from the jawbone of an ancient resonant beast. Its hunger never fades.",
  },
  {
    id: "scatter_hex", name: "Scatter Hex", type: "PISTOLS", rarity: 4,
    baseAtk: 76, atkMaxMult: 4.2,
    subStatType:  "CRIT_RATE",  subStatBase: 12, subStatScale: 2.0,
    hiddenSub1Type: "CRIT_DMG", hiddenSub1Base: 14, hiddenSub1Scale: 2.0,
    passive: "Damage rises +9% each turn you're in combat (up to +45% at 5 turns). Vibration drain increased by 35% for faster Shatters.",
    lore: "Twin-hexed barrels that remember every shot. The tenth always bites hardest.",
  },
  {
    id: "ether_codex", name: "Ether Codex", type: "RECTIFIER", rarity: 4,
    baseAtk: 116, atkMaxMult: 4.2,
    subStatType:  "ELEMENTAL_DMG", subStatBase: 20, subStatScale: 2.0,
    hiddenSub1Type: "ATK_PERCENT", hiddenSub1Base: 8, hiddenSub1Scale: 2.0,
    passive: "+8% Elemental DMG. Damage also rises +7% each turn you're in combat (up to +35% at 5 turns).",
    lore: "A tome that rewrites itself each battle — its power compounds with every passing second.",
  },
];

// ── 5★ Weapons ────────────────────────────────────────────────────────────────

export const WISH_WEAPONS_5STAR: WishWeapon[] = [
  {
    id: "oathbreakers_edge", name: "Oathbreaker's Edge", type: "SWORD", rarity: 5,
    baseAtk: 155, atkMaxMult: 5.0,
    subStatType:  "CRIT_DMG",   subStatBase: 30, subStatScale: 2.2,
    hiddenSub1Type: "CRIT_RATE", hiddenSub1Base: 10, hiddenSub1Scale: 2.2,
    hiddenSub2Type: "ATK_PERCENT", hiddenSub2Base: 10, hiddenSub2Scale: 2.2,
    passive: "Critical hits grant +20 Energy. Passive +25% Crit DMG.",
    lore: "An oath was broken the day this blade shattered. It was reforged from the shards of that promise.",
  },
  {
    id: "ruin_sovereign", name: "Ruin Sovereign", type: "BROADBLADE", rarity: 5,
    baseAtk: 196, atkMaxMult: 5.0,
    subStatType:  "ATK_PERCENT", subStatBase: 18, subStatScale: 2.2,
    hiddenSub1Type: "HP_PERCENT",  hiddenSub1Base: 12, hiddenSub1Scale: 2.2,
    hiddenSub2Type: "DEF_PERCENT", hiddenSub2Base: 15, hiddenSub2Scale: 2.2,
    passive: "Vibration drain increased by 55% for much faster Shatters. Deals up to +30% bonus damage as your HP drops.",
    lore: "Wielded only by those who have witnessed the end of something great. Its weight is grief.",
  },
  {
    id: "null_fangs", name: "Null Fangs", type: "PISTOLS", rarity: 5,
    baseAtk: 98, atkMaxMult: 5.0,
    subStatType:  "CRIT_RATE",  subStatBase: 18, subStatScale: 2.2,
    hiddenSub1Type: "CRIT_DMG",   hiddenSub1Base: 20, hiddenSub1Scale: 2.2,
    hiddenSub2Type: "ATK_PERCENT", hiddenSub2Base: 8,  hiddenSub2Scale: 2.2,
    passive: "Damage rises +11% each turn you're in combat (up to +55% at 5 turns). Passive +10% Crit Rate.",
    lore: "Silence before the tenth shot. Everyone who has faced these guns knows the count.",
  },
  {
    id: "abyssal_tome", name: "Abyssal Tome", type: "RECTIFIER", rarity: 5,
    baseAtk: 158, atkMaxMult: 5.0,
    subStatType:  "ELEMENTAL_DMG", subStatBase: 28, subStatScale: 2.2,
    hiddenSub1Type: "CRIT_RATE",   hiddenSub1Base: 8,  hiddenSub1Scale: 2.2,
    hiddenSub2Type: "ATK_PERCENT", hiddenSub2Base: 12, hiddenSub2Scale: 2.2,
    passive: "+18% Elemental DMG. Deals +40% bonus damage against enemies below 30% HP. Ultimate deals +28% bonus damage.",
    lore: "The eye on the cover watches every weakness. The chains are not to keep you out — they're to keep it in.",
  },
];

// ── Wellspring (Milestone 4a) ─────────────────────────────────────────────────
// Solace's signature weapon — real stats now (was a hardcoded stopgap, see
// src/lib/wellspring.ts). Deliberately NOT in WISH_WEAPONS_5STAR: she must
// never appear in /wish's Standard random-pick pool, only via her own
// dedicated "The Tempered Vow" banner. Stat shape from the original
// multi-character-teams design spec §7: Main ATK · Substat Energy Regen ·
// Hidden Sub 1 (Lv20) HP% · Hidden Sub 2 (Lv50) Elemental DMG.
export const WELLSPRING_WEAPON: WishWeapon = {
  id: "wellspring", name: "Wellspring", type: "RECTIFIER", rarity: 5,
  baseAtk: 158, atkMaxMult: 5.0,
  subStatType:  "ENERGY_REGEN",  subStatBase: 22, subStatScale: 2.2,
  hiddenSub1Type: "HP_PERCENT",    hiddenSub1Base: 10, hiddenSub1Scale: 2.2,
  hiddenSub2Type: "ELEMENTAL_DMG", hiddenSub2Base: 12, hiddenSub2Scale: 2.2,
  passive: "While Solace wields Wellspring: +18% ATK and +12 flat Concerto Energy on her own actions. While her Attunement Mode is active, that mode's bonus is amplified further (base wielder: none of the amplification applies).",
  lore: "Drawn from a spring that never runs dry — every note played near it returns clearer than before.",
};

export const ALL_WISH_WEAPONS = [...WISH_WEAPONS_4STAR, ...WISH_WEAPONS_5STAR, WELLSPRING_WEAPON];

export function getWishWeapon(id: string): WishWeapon | undefined {
  return ALL_WISH_WEAPONS.find(w => w.id === id);
}
