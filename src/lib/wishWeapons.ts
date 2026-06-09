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
    passive: "After landing a critical hit, Resonance Skill cost is reduced by 1 for the next turn. Cannot trigger more than once per turn.",
    lore: "A sword forged at the cusp of dawn, its edge sharpened by the first light of a dying star.",
  },
  {
    id: "gravemaw", name: "Gravemaw", type: "BROADBLADE", rarity: 4,
    baseAtk: 152, atkMaxMult: 4.2,
    subStatType:  "HP_PERCENT",  subStatBase: 12, subStatScale: 2.0,
    hiddenSub1Type: "ATK_PERCENT", hiddenSub1Base: 6, hiddenSub1Scale: 2.0,
    passive: "When HP falls below 50%, ATK increases by 20%. Landing a killing blow restores 18% of max HP. Both effects can only trigger once per battle.",
    lore: "Carved from the jawbone of an ancient resonant beast. Its hunger never fades.",
  },
  {
    id: "scatter_hex", name: "Scatter Hex", type: "PISTOLS", rarity: 4,
    baseAtk: 76, atkMaxMult: 4.2,
    subStatType:  "CRIT_RATE",  subStatBase: 12, subStatScale: 2.0,
    hiddenSub1Type: "CRIT_DMG", hiddenSub1Base: 14, hiddenSub1Scale: 2.0,
    passive: "Basic Attack hits apply Hex stacks (max 10, persists between turns). At 10 stacks, the next attack deals 180% damage and ignores 20% DEF, then resets all stacks.",
    lore: "Twin-hexed barrels that remember every shot. The tenth always bites hardest.",
  },
  {
    id: "ether_codex", name: "Ether Codex", type: "RECTIFIER", rarity: 4,
    baseAtk: 116, atkMaxMult: 4.2,
    subStatType:  "ELEMENTAL_DMG", subStatBase: 20, subStatScale: 2.0,
    hiddenSub1Type: "ATK_PERCENT", hiddenSub1Base: 8, hiddenSub1Scale: 2.0,
    passive: "Each combat turn, Elemental DMG bonus increases by 4% (max 5 stacks, +20%). Stacks reset between battles.",
    lore: "A tome that rewrites itself each battle — its power compounds with every passing second.",
  },
];

// ── 5★ Weapons ────────────────────────────────────────────────────────────────

export const WISH_WEAPONS_5STAR: WishWeapon[] = [
  {
    id: "oathbreakers_edge", name: "Oathbreaker's Edge", type: "SWORD", rarity: 5,
    baseAtk: 130, atkMaxMult: 5.0,
    subStatType:  "CRIT_DMG",   subStatBase: 30, subStatScale: 2.2,
    hiddenSub1Type: "CRIT_RATE", hiddenSub1Base: 10, hiddenSub1Scale: 2.2,
    hiddenSub2Type: "ATK_PERCENT", hiddenSub2Base: 10, hiddenSub2Scale: 2.2,
    passive: "Critical hits trigger a Resonance Burst dealing 50% ATK as bonus elemental damage. If the burst also crits (independent roll), gain +15% Crit DMG for 2 turns (max 2 stacks).",
    lore: "An oath was broken the day this blade shattered. It was reforged from the shards of that promise.",
  },
  {
    id: "ruin_sovereign", name: "Ruin Sovereign", type: "BROADBLADE", rarity: 5,
    baseAtk: 196, atkMaxMult: 5.0,
    subStatType:  "ATK_PERCENT", subStatBase: 18, subStatScale: 2.2,
    hiddenSub1Type: "HP_PERCENT",  hiddenSub1Base: 12, hiddenSub1Scale: 2.2,
    hiddenSub2Type: "DEF_PERCENT", hiddenSub2Base: 15, hiddenSub2Scale: 2.2,
    passive: "Shattering the enemy vib bar deals +70% bonus damage. After a Shatter, ATK increases by 25% and vib damage dealt increases by 15% for 2 turns.",
    lore: "Wielded only by those who have witnessed the end of something great. Its weight is grief.",
  },
  {
    id: "null_fangs", name: "Null Fangs", type: "PISTOLS", rarity: 5,
    baseAtk: 98, atkMaxMult: 5.0,
    subStatType:  "CRIT_RATE",  subStatBase: 18, subStatScale: 2.2,
    hiddenSub1Type: "CRIT_DMG",   hiddenSub1Base: 20, hiddenSub1Scale: 2.2,
    hiddenSub2Type: "ATK_PERCENT", hiddenSub2Base: 8,  hiddenSub2Scale: 2.2,
    passive: "Basic Attack hits stack Fracture charges (max 10, persists between turns). At 10 stacks, the next hit deals 220% damage ignoring 30% DEF and resets all stacks.",
    lore: "Silence before the tenth shot. Everyone who has faced these guns knows the count.",
  },
  {
    id: "abyssal_tome", name: "Abyssal Tome", type: "RECTIFIER", rarity: 5,
    baseAtk: 158, atkMaxMult: 5.0,
    subStatType:  "ELEMENTAL_DMG", subStatBase: 28, subStatScale: 2.2,
    hiddenSub1Type: "CRIT_RATE",   hiddenSub1Base: 8,  hiddenSub1Scale: 2.2,
    hiddenSub2Type: "ATK_PERCENT", hiddenSub2Base: 12, hiddenSub2Scale: 2.2,
    passive: "Weakness hits deal +35% elemental damage and extend your Resonance Skill buff by 1 turn. Every 3rd weakness hit triggers a Void Pulse dealing 80% ATK as elemental damage.",
    lore: "The eye on the cover watches every weakness. The chains are not to keep you out — they're to keep it in.",
  },
];

export const ALL_WISH_WEAPONS = [...WISH_WEAPONS_4STAR, ...WISH_WEAPONS_5STAR];

export function getWishWeapon(id: string): WishWeapon | undefined {
  return ALL_WISH_WEAPONS.find(w => w.id === id);
}
