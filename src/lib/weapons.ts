import { WeaponType } from "@prisma/client";
import path from "path";
import fs   from "fs";

export interface WeaponDefinition {
  id:          string;
  name:        string;
  type:        WeaponType;
  rarity:      number;        // 1-3 for forged, 4-5 for unique released
  baseAtk:     number;
  subStatType: string;
  subStatVal:  number;
  passive:     string;        // displayed description
  forgeCost:   number;        // Forging Ores required
  isForged:    boolean;       // false = unique/released weapon
}

// ── Forged weapons (craftable by players) ────────────────────────────────────
export const FORGED_WEAPONS: WeaponDefinition[] = [
  // ── Broadblade ─────────────────────────────────────────────────────────────
  {
    id: "iron_carver", name: "Iron Carver", type: "BROADBLADE", rarity: 1,
    baseAtk: 50, subStatType: "HP_PERCENT", subStatVal: 6,
    passive: "A simple heavy blade. No frills.",
    forgeCost: 2, isForged: true,
  },
  {
    id: "shattered_cleaver", name: "Shattered Cleaver", type: "BROADBLADE", rarity: 2,
    baseAtk: 80, subStatType: "ATK_PERCENT", subStatVal: 8,
    passive: "Deals +15% damage when your HP is above 70%.",
    forgeCost: 5, isForged: true,
  },
  {
    id: "dusk_slicer", name: "Dusk Slicer", type: "BROADBLADE", rarity: 3,
    baseAtk: 124, subStatType: "ATK_PERCENT", subStatVal: 12,
    passive: "Your first Basic Attack each combat deals 1.4× damage.",
    forgeCost: 12, isForged: true,
  },

  // ── Sword ───────────────────────────────────────────────────────────────────
  {
    id: "worn_blade", name: "Worn Blade", type: "SWORD", rarity: 1,
    baseAtk: 42, subStatType: "CRIT_RATE", subStatVal: 5,
    passive: "A balanced blade with a chipped edge.",
    forgeCost: 2, isForged: true,
  },
  {
    id: "resonant_edge", name: "Resonant Edge", type: "SWORD", rarity: 2,
    baseAtk: 68, subStatType: "CRIT_RATE", subStatVal: 8,
    passive: "Resonance Skill deals +20% damage.",
    forgeCost: 5, isForged: true,
  },
  {
    id: "fractured_fang", name: "Fractured Fang", type: "SWORD", rarity: 3,
    baseAtk: 102, subStatType: "CRIT_DMG", subStatVal: 20,
    passive: "Critical hits restore 8 Energy.",
    forgeCost: 12, isForged: true,
  },

  // ── Pistols ─────────────────────────────────────────────────────────────────
  {
    id: "rusted_shot", name: "Rusted Shot", type: "PISTOLS", rarity: 1,
    baseAtk: 28, subStatType: "CRIT_RATE", subStatVal: 6,
    passive: "Basic Attack hits 3 times. Each hit is weaker individually.",
    forgeCost: 2, isForged: true,
  },
  {
    id: "static_barrel", name: "Static Barrel", type: "PISTOLS", rarity: 2,
    baseAtk: 44, subStatType: "CRIT_RATE", subStatVal: 10,
    passive: "Basic Attack hits 3 times. +10% damage per consecutive hit.",
    forgeCost: 5, isForged: true,
  },
  {
    id: "twin_sparks", name: "Twin Sparks", type: "PISTOLS", rarity: 3,
    baseAtk: 58, subStatType: "CRIT_RATE", subStatVal: 14,
    passive: "Basic Attack hits 4 times. Each hit independently rolls Crit.",
    forgeCost: 12, isForged: true,
  },

  // ── Rectifier ───────────────────────────────────────────────────────────────
  {
    id: "crude_lens", name: "Crude Lens", type: "RECTIFIER", rarity: 1,
    baseAtk: 36, subStatType: "ELEMENTAL_DMG", subStatVal: 8,
    passive: "Converts Basic Attack damage to your Element type.",
    forgeCost: 2, isForged: true,
  },
  {
    id: "resonance_prism", name: "Resonance Prism", type: "RECTIFIER", rarity: 2,
    baseAtk: 62, subStatType: "ELEMENTAL_DMG", subStatVal: 16,
    passive: "Elemental damage +20%. Weakness hits deal an extra +10%.",
    forgeCost: 5, isForged: true,
  },
  {
    id: "hollow_focus", name: "Hollow Focus", type: "RECTIFIER", rarity: 3,
    baseAtk: 94, subStatType: "ELEMENTAL_DMG", subStatVal: 22,
    passive: "Elemental damage +28%. Resonance Skill gains your element bonus.",
    forgeCost: 12, isForged: true,
  },
];

export const RARITY_STARS: Record<number, string> = {
  1: "★☆☆☆☆",
  2: "★★☆☆☆",
  3: "★★★☆☆",
  4: "★★★★☆",
  5: "★★★★★",
};

export const WEAPON_TYPE_LABEL: Record<WeaponType, string> = {
  BROADBLADE: "Broadblade  ·  Slow, massive damage",
  SWORD:      "Sword  ·  Balanced, medium speed",
  PISTOLS:    "Pistols  ·  Multi-hit, Crit builds",
  RECTIFIER:  "Rectifier  ·  Converts attacks to elemental damage",
};

export const WEAPON_TYPE_EMOJI: Record<WeaponType, string> = {
  BROADBLADE: "🗡️",
  SWORD:      "⚔️",
  PISTOLS:    "🔫",
  RECTIFIER:  "🔮",
};

export function getForgedWeaponsByType(type: WeaponType): WeaponDefinition[] {
  return FORGED_WEAPONS.filter((w) => w.type === type);
}

// Returns the local path to a weapon's art image, or null if it doesn't exist.
// unique weapons: assets/weapons/unique/{userId}.png
// normal weapons: assets/weapons/{TypeFolder}/{Name}.png
export function getWeaponImagePath(
  weaponType: string,
  weaponName: string,
  opts?: { isUnique?: boolean; userId?: string }
): string | null {
  const imgPath = opts?.isUnique && opts.userId
    ? path.join(process.cwd(), "assets", "weapons", "unique", `${opts.userId}.png`)
    : path.join(
        process.cwd(), "assets", "weapons",
        weaponType.charAt(0).toUpperCase() + weaponType.slice(1).toLowerCase(),
        `${weaponName}.png`
      );
  return fs.existsSync(imgPath) ? imgPath : null;
}

// Passive effects injected into combat at equip-time.
// elemDmg = flat addition to elemDmgBonus (e.g. 0.20 = +20%).
// effects = AbilityEffect entries merged into the player's abilityEffects list.
export interface WeaponPassive {
  elemDmg?: number;
  effects?: { type: string; value: number }[];
}

export const WEAPON_PASSIVES: Record<string, WeaponPassive> = {
  // Broadblade
  "Shattered Cleaver": { effects: [{ type: "FULL_HP_DMG",  value: 0.15 }] },
  "Dusk Slicer":       { effects: [{ type: "FIRST_STRIKE", value: 0.40 }] },
  // Sword
  "Resonant Edge":     { effects: [{ type: "SKILL_POWER",  value: 0.20 }] },
  "Fractured Fang":    { effects: [{ type: "CRIT_MOMENTUM", value: 8   }] },
  // Rectifier
  "Resonance Prism":   { elemDmg: 0.20 },
  "Hollow Focus":      { elemDmg: 0.28, effects: [{ type: "SKILL_POWER", value: 0.10 }] },

  // ── Wish weapons (4★) ─────────────────────────────────────────────────────
  "Dawnbreaker":       { effects: [{ type: "CRIT_MOMENTUM", value: 18 }, { type: "SKILL_POWER",  value: 0.18 }] },
  "Gravemaw":          { effects: [{ type: "BERSERK",       value: 0.32 }, { type: "HEAL_ON_CRIT", value: 0.08 }] },
  "Scatter Hex":       { effects: [{ type: "ESCALATION",    value: 0.09 }, { type: "VIB_BREAKER",  value: 0.35 }] },
  "Ether Codex":       { elemDmg: 0.08, effects: [{ type: "ESCALATION", value: 0.07 }] },

  // ── Wish weapons (5★) ─────────────────────────────────────────────────────
  "Oathbreaker's Edge":{ effects: [{ type: "CRIT_MOMENTUM", value: 20 }, { type: "CRIT_DMG",   value: 0.25 }] },
  "Ruin Sovereign":    { effects: [{ type: "VIB_BREAKER",   value: 0.55 }, { type: "BERSERK",  value: 0.30 }] },
  "Null Fangs":        { effects: [{ type: "ESCALATION",    value: 0.11 }, { type: "CRIT_RATE", value: 0.10 }] },
  "Abyssal Tome":      { elemDmg: 0.18, effects: [{ type: "EXECUTE",   value: 0.40 }, { type: "ULT_POWER", value: 0.28 }] },
};
