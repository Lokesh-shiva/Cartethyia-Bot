import prisma from "./prisma";
import {
  AbilityEffect, sanitizeEffects, legacyToComposite, compositePassives,
  formatEffects, compositeDamageMult, compositeCritBonus, compositeHealOnHit,
  compositeEnergyOnHit, compositeVibMult, compositeHasSecondWind, AbilityCtx,
} from "./abilityEffects";
import {
  V2EffectEntry, sanitizeV2Effects, v2CompositePassives,
  applyV2Attack, abilityCritRateV2, abilityVibV2, hasSecondWindV2,
  getV2TurnStartRegen, formatV2Effects,
} from "./abilityEngineV2";
import { WEAPON_PASSIVES } from "./weapons";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "./wishWeapons";
import { bondMultiplier } from "./weaponAwakening";
import { calcSubstatValue } from "./echoes";

// ── Set bonus definitions ─────────────────────────────────────────────────────

export interface SetBonusInfo {
  element:  string;
  count:    number;  // echoes of this element equipped
  has2pc:   boolean;
  has4pc:   boolean;
  has5pc:   boolean;
}

export interface TwoPcEffect {
  label:        string;
  atkMult:      number;  // 1.0 = no change
  hpMult:       number;
  defMult:      number;
  critRateBonus:number;  // flat
  energyBonus:  number;  // flat per turn
  lifesteal:    number;  // 0–1
}

export interface FourPcEffect {
  label:      string;
  type:       "SKILL_POWER" | "ULT_POWER" | "DOUBLE_HIT" | "DAMAGE_REDUCE" | "HP_REGEN" | "VIB_DRAIN";
  value:      number;
}

export interface FivePcEffect {
  label:      string;
  type:       "LOW_HP_CRIT" | "FIRST_HIT" | "POST_ULT_SKILL" | "FULL_HP_DMG" | "AUTO_BLOCK" | "VIB_DRAIN_25" | "HP_REGEN";
  value:      number;
}

const TWO_PC: Record<string, TwoPcEffect> = {
  FUSION:  { label: "Fusion 2pc — +8% ATK",            atkMult: 1.08, hpMult: 1.0,  defMult: 1.0,  critRateBonus: 0,    energyBonus: 0,  lifesteal: 0    },
  GLACIO:  { label: "Glacio 2pc — +12% DEF",           atkMult: 1.0,  hpMult: 1.0,  defMult: 1.12, critRateBonus: 0,    energyBonus: 0,  lifesteal: 0    },
  ELECTRO: { label: "Electro 2pc — +12 Energy/turn",   atkMult: 1.0,  hpMult: 1.0,  defMult: 1.0,  critRateBonus: 0,    energyBonus: 12, lifesteal: 0    },
  AERO:    { label: "Aero 2pc — +5% Crit Rate",        atkMult: 1.0,  hpMult: 1.0,  defMult: 1.0,  critRateBonus: 0.05, energyBonus: 0,  lifesteal: 0    },
  HAVOC:   { label: "Havoc 2pc — 6% Lifesteal",        atkMult: 1.0,  hpMult: 1.0,  defMult: 1.0,  critRateBonus: 0,    energyBonus: 0,  lifesteal: 0.06 },
  SPECTRO: { label: "Spectro 2pc — +8% HP",            atkMult: 1.0,  hpMult: 1.08, defMult: 1.0,  critRateBonus: 0,    energyBonus: 0,  lifesteal: 0    },
};

const FOUR_PC: Record<string, FourPcEffect> = {
  FUSION:  { label: "Fusion 4pc — First Skill +30% DMG",      type: "SKILL_POWER",   value: 0.30 },
  GLACIO:  { label: "Glacio 4pc — 25% chance block 30% DMG",  type: "DAMAGE_REDUCE", value: 0.30 },
  ELECTRO: { label: "Electro 4pc — Ultimate +30% DMG",        type: "ULT_POWER",     value: 0.30 },
  AERO:    { label: "Aero 4pc — Basic hits 20% chance ×2",    type: "DOUBLE_HIT",    value: 0.20 },
  HAVOC:   { label: "Havoc 4pc — Shatter heals 15% HP",       type: "HP_REGEN",      value: 0.15 },
  SPECTRO: { label: "Spectro 4pc — +10 Energy/turn passively",type: "HP_REGEN",      value: 10   },
};

const FIVE_PC: Record<string, FivePcEffect> = {
  FUSION:  { label: "Fusion 5pc — Below 50% HP: +25% Crit Rate",   type: "LOW_HP_CRIT",    value: 0.25 },
  GLACIO:  { label: "Glacio 5pc — Full HP: +20% DMG",              type: "FULL_HP_DMG",    value: 0.20 },
  ELECTRO: { label: "Electro 5pc — Post-Ultimate: Skill resets",   type: "POST_ULT_SKILL", value: 1    },
  AERO:    { label: "Aero 5pc — First action +50% DMG",            type: "FIRST_HIT",      value: 0.50 },
  HAVOC:   { label: "Havoc 5pc — Vib drain +25% faster",           type: "VIB_DRAIN_25",   value: 0.25 },
  SPECTRO: { label: "Spectro 5pc — HP regen 3% max HP per turn",   type: "HP_REGEN",       value: 0.03 },
};

// ── Unique ability types ──────────────────────────────────────────────────────
// Maps type string → how it modifies combat stats
export const ABILITY_TYPE_LABELS: Record<string, string> = {
  ATK_BOOST:         "Passive ATK increase",
  HP_BOOST:          "Passive HP increase",
  CRIT_RATE:         "Passive Crit Rate increase",
  CRIT_DMG:          "Passive Crit DMG increase",
  LIFESTEAL:         "Passive lifesteal on hit",
  ENERGY_BOOST:      "Bonus energy per turn",
  ELEM_DMG_BOOST:    "Bonus element damage",
  SKILL_POWER:       "Resonance Skill damage boost",
  ULT_POWER:         "Ultimate damage boost",
  LOW_HP_CRIT:       "Crit Rate boost when HP < 40%",
  FULL_HP_DMG:       "Damage boost at full HP",
};

// ── Element passive system ────────────────────────────────────────────────────

export type ElemHookType =
  | "IGNITE"        // 35% chance: Basic/Skill deal extra +hookValue×ATK Fusion hit
  | "FROST_SHIELD"  // 25% chance: absorb hookValue% of incoming hit
  | "DISCHARGE"     // on any crit: gain hookValue bonus energy
  | "WINDSTRIDE"    // Basic/Skill gain hookValue% DMG per consecutive turn (max ×5)
  | "VOID_SURGE"    // on Shatter: restore hookValue% max HP
  | "RADIANCE";     // hookValue% HP regen per turn + below 40% HP → +25% Crit Rate

export interface ElementPassive {
  atkMult:       number;
  defMult:       number;
  hpMult:        number;
  critRateBonus: number;
  critDmgBonus:  number;
  energyBonus:   number;
  lifesteal:     number;
  elemDmgBonus:  number;
  hookType:      ElemHookType;
  hookValue:     number;
  statLabel:     string;
  hookLabel:     string;
}

export const ELEMENT_PASSIVES: Record<string, ElementPassive> = {
  FUSION: {
    atkMult: 1.15, defMult: 1.0,  hpMult: 1.0,
    critRateBonus: 0.15, critDmgBonus: 0, energyBonus: 0, lifesteal: 0, elemDmgBonus: 0.20,
    hookType: "IGNITE", hookValue: 0.25,
    statLabel: "🔥 Fusion Innate — +15% ATK · +15% Crit Rate · +20% Fusion DMG",
    hookLabel: "🔥 Ignite — Basic/Skill: 35% chance +25% ATK bonus fire hit",
  },
  GLACIO: {
    atkMult: 1.0,  defMult: 1.30, hpMult: 1.15,
    critRateBonus: 0, critDmgBonus: 0, energyBonus: 0, lifesteal: 0, elemDmgBonus: 0.20,
    hookType: "FROST_SHIELD", hookValue: 0.40,
    statLabel: "❄️ Glacio Innate — +30% DEF · +15% HP · +20% Glacio DMG",
    hookLabel: "❄️ Frost Shield — 25% chance to absorb 40% of any incoming hit",
  },
  ELECTRO: {
    atkMult: 1.0,  defMult: 1.0,  hpMult: 1.0,
    critRateBonus: 0.05, critDmgBonus: 0.20, energyBonus: 25, lifesteal: 0, elemDmgBonus: 0.20,
    hookType: "DISCHARGE", hookValue: 20,
    statLabel: "⚡ Electro Innate — +5% Crit · +20% Crit DMG · +25 Energy/turn · +20% Electro DMG",
    hookLabel: "⚡ Discharge — on any crit: gain +20 bonus energy",
  },
  AERO: {
    atkMult: 1.15, defMult: 1.0,  hpMult: 1.0,
    critRateBonus: 0, critDmgBonus: 0.40, energyBonus: 0, lifesteal: 0, elemDmgBonus: 0.20,
    hookType: "WINDSTRIDE", hookValue: 0.08,
    statLabel: "🌪️ Aero Innate — +15% ATK · +40% Crit DMG · +20% Aero DMG",
    hookLabel: "🌪️ Windstride — Basic/Skill: +8% DMG per turn, stacks up to ×5",
  },
  HAVOC: {
    atkMult: 1.15, defMult: 1.0,  hpMult: 1.0,
    critRateBonus: 0, critDmgBonus: 0, energyBonus: 0, lifesteal: 0.20, elemDmgBonus: 0.20,
    hookType: "VOID_SURGE", hookValue: 0.25,
    statLabel: "🌑 Havoc Innate — +15% ATK · +20% Lifesteal · +20% Havoc DMG",
    hookLabel: "🌑 Void Surge — on Shatter: restore 25% max HP instantly",
  },
  SPECTRO: {
    atkMult: 1.0,  defMult: 1.0,  hpMult: 1.30,
    critRateBonus: 0, critDmgBonus: 0, energyBonus: 0, lifesteal: 0, elemDmgBonus: 0.20,
    hookType: "RADIANCE", hookValue: 0.02,
    statLabel: "✨ Spectro Innate — +30% Max HP · +20% Spectro DMG",
    hookLabel: "✨ Radiance — +2% HP regen per turn · below 40% HP: +25% Crit Rate",
  },
};

// ── Resolved bonuses passed to combat ────────────────────────────────────────
export interface PlayerBonuses {
  // Flat stat additions (from echo main stats + substats)
  atkFlat:        number;
  hpFlat:         number;
  defFlat:        number;
  // Passive stat multipliers
  atkMult:        number;
  hpMult:         number;
  defMult:        number;
  critRateBonus:  number;
  critDmgBonus:   number;
  energyBonus:    number;
  lifesteal:      number;
  elemDmgBonus:   number;

  // Active set effects
  set4pc: FourPcEffect | null;
  set5pc: FivePcEffect | null;

  // Element passive hook for in-combat procs
  elementPassive: ElementPassive | null;

  // Unique ability — composite list of mechanical primitives
  abilityEffects:  AbilityEffect[];

  // V2 ability engine fields (abilityVersion=2 only)
  abilityVersion:  number;          // 1 or 2
  v2Effects:       V2EffectEntry[];

  // Display
  activeLabels: string[];
}

// ── Main resolver ─────────────────────────────────────────────────────────────
export async function resolvePlayerBonuses(userId: string): Promise<PlayerBonuses> {
  const [user, echoes, weapon] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { element: true, uniqueAbilityType: true, uniqueAbilityValue: true, uniqueAbilityEffects: true, uniqueAbilityName: true, abilityEvolved: true, abilityVersion: true },
    }),
    prisma.echo.findMany({
      where:  { userId, isEquipped: true },
      select: {
        element: true, mainStatType: true, mainStatValue: true, revealedSubstats: true,
        level: true,
        substat1Type: true, substat1Value: true,
        substat2Type: true, substat2Value: true,
        substat3Type: true, substat3Value: true,
        substat4Type: true, substat4Value: true,
        substat5Type: true, substat5Value: true,
      },
    }),
    prisma.weapon.findFirst({
      where:  { userId, isEquipped: true },
      select: {
        name: true, baseAtk: true, level: true, rarity: true, subStatType: true, subStatVal: true,
        hiddenSub1Type: true, hiddenSub1Val: true, hiddenSub2Type: true, hiddenSub2Val: true,
        awakened: true, awakenedName: true, awakenedPassive: true, weaponBond: true,
      },
    }),
  ]);

  const bonuses: PlayerBonuses = {
    atkFlat: 0, hpFlat: 0, defFlat: 0,
    atkMult: 1.0, hpMult: 1.0, defMult: 1.0,
    critRateBonus: 0, critDmgBonus: 0,
    energyBonus: 0, lifesteal: 0, elemDmgBonus: 0,
    set4pc: null, set5pc: null,
    elementPassive:  null,
    abilityEffects:  [],
    abilityVersion:  1,
    v2Effects:       [],
    activeLabels:    [],
  };

  if (!user) return bonuses;

  const playerElem = user.element;

  // ── Player element innate bonuses ────────────────────────────────────────
  const ep = ELEMENT_PASSIVES[playerElem] ?? null;
  bonuses.elementPassive = ep;
  if (ep) {
    bonuses.atkMult       *= ep.atkMult;
    bonuses.defMult       *= ep.defMult;
    bonuses.hpMult        *= ep.hpMult;
    bonuses.critRateBonus += ep.critRateBonus;
    bonuses.critDmgBonus  += ep.critDmgBonus;
    bonuses.energyBonus   += ep.energyBonus;
    bonuses.lifesteal     += ep.lifesteal;
    bonuses.elemDmgBonus  += ep.elemDmgBonus;
    bonuses.activeLabels.push(ep.statLabel);
    bonuses.activeLabels.push(ep.hookLabel);
  }

  // ── Element affinity (+3% elem damage per matching echo) ─────────────────
  const matchingCount = echoes.filter(e => e.element === playerElem).length;
  bonuses.elemDmgBonus += matchingCount * 0.03;
  if (matchingCount > 0) {
    bonuses.activeLabels.push(`${elementEmoji(playerElem)} Affinity ×${matchingCount} — +${matchingCount * 3}% Elem DMG`);
  }

  // ── Echo main stats + revealed substats feed real combat stats ───────────
  const elemDmgKeys = new Set(["FUSION_DMG","GLACIO_DMG","ELECTRO_DMG","AERO_DMG","HAVOC_DMG","SPECTRO_DMG"]);
  const applyStat = (type: string | null, value: number | null) => {
    if (!type || value == null || value === 0) return;
    const v = value;            // percent stats stored as e.g. 8.0 = 8%
    switch (type) {
      case "ATK_FLAT":     bonuses.atkFlat       += v;          break;
      case "HP_FLAT":      bonuses.hpFlat        += v;          break;
      case "DEF_FLAT":     bonuses.defFlat       += v;          break;
      case "ATK_PCT":      bonuses.atkMult       *= (1 + v/100); break;
      case "HP_PCT":       bonuses.hpMult        *= (1 + v/100); break;
      case "DEF_PCT":      bonuses.defMult       *= (1 + v/100); break;
      case "CRIT_RATE":    bonuses.critRateBonus += v/100;       break;
      case "CRIT_DMG":     bonuses.critDmgBonus  += v/100;       break;
      case "ELEM_DMG_PCT": bonuses.elemDmgBonus  += v/100;       break;
      case "ENERGY_REGEN": bonuses.energyBonus   += v/2;         break; // dampened
      case "HEALING_PCT":  /* no in-combat healing yet */        break;
      case "SPEED":        /* combat doesn't use speed yet */    break;
      default:
        // Element-specific DMG main stat (e.g. Fusion DMG Bonus) — only if it matches you
        if (elemDmgKeys.has(type) && type === `${playerElem}_DMG`) {
          bonuses.elemDmgBonus += v/100;
        }
    }
  };

  for (const e of echoes) {
    applyStat(e.mainStatType, e.mainStatValue);
    const subs: [string | null, number | null][] = [
      [e.substat1Type, e.substat1Value], [e.substat2Type, e.substat2Value],
      [e.substat3Type, e.substat3Value], [e.substat4Type, e.substat4Value],
      [e.substat5Type, e.substat5Value],
    ];
    // Only revealed substats contribute; scale values by echo level
    for (let i = 0; i < e.revealedSubstats && i < subs.length; i++) {
      const [type, base] = subs[i];
      if (type && base != null) {
        applyStat(type, calcSubstatValue(type, base, e.level));
      }
    }
  }

  // ── Equipped weapon feeds combat ─────────────────────────────────────────
  if (weapon) {
    // ATK scales from base → base × maxMult at level 90, by rarity
    const maxMult     = weapon.rarity === 3 ? 3.5 : weapon.rarity === 2 ? 3.0 : 2.5;
    const rawAtk      = Math.round(weapon.baseAtk * (1 + (weapon.level - 1) * (maxMult - 1) / 89));
    // Bond multiplier: awakened weapons start at 80% power (bond 0), reach 100% at bond 10
    const bondMult    = weapon.awakened ? bondMultiplier(weapon.weaponBond ?? 0) : 1.0;
    const effectiveAtk = Math.round(rawAtk * bondMult);
    bonuses.atkFlat   += effectiveAtk;

    // Sub-stat scales from base → base × 1.8 at level 90
    const svBase = weapon.subStatVal ?? 0;
    const svRaw  = Math.round((svBase * (1 + (weapon.level - 1) * 0.8 / 89)) * 10) / 10;
    const sv     = Math.round(svRaw * bondMult * 10) / 10;
    const applySub = (type: string | null, val: number) => {
      switch (type) {
        case "HP_PERCENT":    bonuses.hpMult        *= (1 + val/100); break;
        case "ATK_PERCENT":   bonuses.atkMult       *= (1 + val/100); break;
        case "DEF_PERCENT":   bonuses.defMult       *= (1 + val/100); break;
        case "CRIT_RATE":     bonuses.critRateBonus += val/100;       break;
        case "CRIT_DMG":      bonuses.critDmgBonus  += val/100;       break;
        case "ELEMENTAL_DMG": bonuses.elemDmgBonus  += val/100;       break;
        case "ENERGY_REGEN":  bonuses.energyBonus   += val/2;         break;
      }
    };
    applySub(weapon.subStatType, sv);

    // Hidden substats (wish weapons) — unlock at Lv20 / Lv50, scale like weapon.ts display
    const wishDef = ALL_WISH_WEAPONS.find(w => w.name === weapon.name);
    if (weapon.level >= 20 && weapon.hiddenSub1Type && weapon.hiddenSub1Val != null) {
      applySub(weapon.hiddenSub1Type, Math.round(calcWishSubStat(weapon.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, weapon.level) * bondMult * 10) / 10);
    }
    if (weapon.level >= 50 && weapon.hiddenSub2Type && weapon.hiddenSub2Val != null) {
      applySub(weapon.hiddenSub2Type, Math.round(calcWishSubStat(weapon.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, weapon.level) * bondMult * 10) / 10);
    }

    // Weapon passive — awakened weapons carry their own passive in the DB
    if (weapon.awakened && weapon.awakenedPassive) {
      const ap = weapon.awakenedPassive as any;
      if (ap.elemDmg) bonuses.elemDmgBonus += Number(ap.elemDmg) || 0;
      if (Array.isArray(ap.effects)) bonuses.abilityEffects.push(...sanitizeEffects(ap.effects, true));
    } else {
      const passive = WEAPON_PASSIVES[weapon.name];
      if (passive) {
        if (passive.elemDmg) bonuses.elemDmgBonus += passive.elemDmg;
        if (passive.effects) bonuses.abilityEffects.push(...passive.effects);
      }
    }

    const shownName = weapon.awakened && weapon.awakenedName ? `✦ ${weapon.awakenedName}` : weapon.name;
    bonuses.activeLabels.push(`🗡️ ${shownName} Lv${weapon.level} — +${effectiveAtk} ATK`);
  }

  // Summarise echo stat contribution for display
  if (echoes.length > 0) {
    const parts: string[] = [];
    if (bonuses.atkFlat)       parts.push(`+${Math.round(bonuses.atkFlat)} ATK`);
    if (bonuses.hpFlat)        parts.push(`+${Math.round(bonuses.hpFlat)} HP`);
    if (bonuses.defFlat)       parts.push(`+${Math.round(bonuses.defFlat)} DEF`);
    if (bonuses.atkMult > 1)   parts.push(`+${Math.round((bonuses.atkMult - 1) * 100)}% ATK`);
    if (bonuses.hpMult  > 1)   parts.push(`+${Math.round((bonuses.hpMult  - 1) * 100)}% HP`);
    if (bonuses.defMult > 1)   parts.push(`+${Math.round((bonuses.defMult - 1) * 100)}% DEF`);
    if (bonuses.critRateBonus) parts.push(`+${(bonuses.critRateBonus * 100).toFixed(1)}% Crit Rate`);
    if (bonuses.critDmgBonus)  parts.push(`+${(bonuses.critDmgBonus * 100).toFixed(1)}% Crit DMG`);
    if (parts.length > 0) {
      bonuses.activeLabels.push(`◈ Echo Stats: ${parts.join("  ·  ")}`);
    }
  }

  // ── Set bonuses (count by element among equipped echoes) ─────────────────
  const elemCounts: Record<string, number> = {};
  for (const e of echoes) {
    elemCounts[e.element] = (elemCounts[e.element] ?? 0) + 1;
  }

  for (const [elem, count] of Object.entries(elemCounts)) {
    if (count >= 2 && TWO_PC[elem]) {
      const b = TWO_PC[elem];
      bonuses.atkMult       *= b.atkMult;
      bonuses.hpMult        *= b.hpMult;
      bonuses.defMult       *= b.defMult;
      bonuses.critRateBonus += b.critRateBonus;
      bonuses.energyBonus   += b.energyBonus;
      bonuses.lifesteal     += b.lifesteal;
      bonuses.activeLabels.push(b.label);
    }
    if (count >= 4 && FOUR_PC[elem]) {
      bonuses.set4pc = FOUR_PC[elem];
      bonuses.activeLabels.push(FOUR_PC[elem].label);
    }
    if (count >= 5 && FIVE_PC[elem]) {
      bonuses.set5pc = FIVE_PC[elem];
      bonuses.activeLabels.push(FIVE_PC[elem].label);
    }
  }

  // ── Unique ability (composite) ────────────────────────────────────────────
  bonuses.abilityVersion = user.abilityVersion ?? 1;

  if (bonuses.abilityVersion === 2) {
    // V2 — composable trigger→effect language.
    // Weapon effects are already in bonuses.abilityEffects — fold their passives
    // first so CRIT_DMG / LIFESTEAL / EXECUTE from awakened weapons still apply.
    if (bonuses.abilityEffects.length > 0) {
      const wp = compositePassives(bonuses.abilityEffects);
      bonuses.atkMult       *= wp.atkMult;
      bonuses.hpMult        *= wp.hpMult;
      bonuses.defMult       *= wp.defMult;
      bonuses.critRateBonus += wp.critRateBonus;
      bonuses.critDmgBonus  += wp.critDmgBonus;
      bonuses.lifesteal     += wp.lifesteal;
      bonuses.energyBonus   += wp.energyBonus;
      bonuses.elemDmgBonus  += wp.elemDmgBonus;
    }
    const v2 = sanitizeV2Effects(user.uniqueAbilityEffects, user.abilityEvolved);
    if (v2.length > 0) {
      bonuses.v2Effects = v2;
      const p = v2CompositePassives(v2);
      bonuses.atkMult       *= p.atkMult;
      bonuses.hpMult        *= p.hpMult;
      bonuses.defMult       *= p.defMult;
      bonuses.critRateBonus += p.critRateBonus;
      bonuses.critDmgBonus  += p.critDmgBonus;
      bonuses.lifesteal     += p.lifesteal;
      bonuses.energyBonus   += p.energyBonus;
      bonuses.elemDmgBonus  += p.elemDmgBonus;
      bonuses.activeLabels.push(`✦ Unique${user.uniqueAbilityName ? ` — ${user.uniqueAbilityName}` : ""}:\n${formatV2Effects(v2).split("\n").map(l => "  › " + l).join("\n")}`);
    }
  } else {
    // V1 — source priority: stored composite → migrate legacy single-type → none
    let effects: AbilityEffect[] = sanitizeEffects(user.uniqueAbilityEffects, user.abilityEvolved);

    if (effects.length === 0 && user.uniqueAbilityType) {
      effects = legacyToComposite(user.uniqueAbilityType, user.uniqueAbilityValue, playerElem, userId);
      prisma.user.update({
        where: { id: userId },
        data:  { uniqueAbilityEffects: effects as any },
      }).catch(() => {});
    }

    if (effects.length > 0) {
      bonuses.abilityEffects = [...bonuses.abilityEffects, ...effects];
      const p = compositePassives(bonuses.abilityEffects);
      bonuses.atkMult       *= p.atkMult;
      bonuses.hpMult        *= p.hpMult;
      bonuses.defMult       *= p.defMult;
      bonuses.critRateBonus += p.critRateBonus;
      bonuses.critDmgBonus  += p.critDmgBonus;
      bonuses.lifesteal     += p.lifesteal;
      bonuses.energyBonus   += p.energyBonus;
      bonuses.elemDmgBonus  += p.elemDmgBonus;
      bonuses.activeLabels.push(`✦ Unique${user.uniqueAbilityName ? ` — ${user.uniqueAbilityName}` : ""}:\n${formatEffects(effects).split("\n").map(l => "  › " + l).join("\n")}`);
    }
  }

  return bonuses;
}

// ── Apply bonuses to base stats ───────────────────────────────────────────────
export interface ResolvedStats {
  hp:        number;
  atk:       number;
  def:       number;
  critRate:  number;
  critDmg:   number;
  energyPerTurn: number;
  lifesteal: number;
  elemDmgBonus: number;
}

export function applyBonuses(
  base: { baseHp: number; baseAtk: number; baseDef: number; critRate: number; critDmg: number },
  bonuses: PlayerBonuses,
): ResolvedStats {
  return {
    hp:           Math.floor((base.baseHp  + bonuses.hpFlat)  * bonuses.hpMult),
    atk:          Math.floor((base.baseAtk + bonuses.atkFlat) * bonuses.atkMult),
    def:          Math.floor((base.baseDef + bonuses.defFlat) * bonuses.defMult),
    critRate:     Math.min(1, base.critRate + bonuses.critRateBonus),
    critDmg:      base.critDmg + bonuses.critDmgBonus,
    energyPerTurn: 25 + bonuses.energyBonus,
    lifesteal:    bonuses.lifesteal,
    elemDmgBonus: bonuses.elemDmgBonus,
  };
}

// ── 4pc / 5pc in-combat helpers ───────────────────────────────────────────────

export function apply4pcSkillBonus(bonuses: PlayerBonuses, baseDmg: number, firstSkill: boolean): number {
  if (!bonuses.set4pc || bonuses.set4pc.type !== "SKILL_POWER") return baseDmg;
  if (!firstSkill) return baseDmg;
  return Math.floor(baseDmg * (1 + bonuses.set4pc.value));
}

export function apply4pcUltBonus(bonuses: PlayerBonuses, baseDmg: number): number {
  if (!bonuses.set4pc || bonuses.set4pc.type !== "ULT_POWER") return baseDmg;
  return Math.floor(baseDmg * (1 + bonuses.set4pc.value));
}

export function roll4pcDoubleHit(bonuses: PlayerBonuses): boolean {
  if (!bonuses.set4pc || bonuses.set4pc.type !== "DOUBLE_HIT") return false;
  return Math.random() < bonuses.set4pc.value;
}

export function roll4pcBlock(bonuses: PlayerBonuses, incomingDmg: number): number {
  if (!bonuses.set4pc || bonuses.set4pc.type !== "DAMAGE_REDUCE") return incomingDmg;
  if (Math.random() < 0.25) return Math.floor(incomingDmg * (1 - bonuses.set4pc.value));
  return incomingDmg;
}

export function apply5pcLowHpCrit(bonuses: PlayerBonuses, critRate: number, currentHp: number, maxHp: number): number {
  if (!bonuses.set5pc || bonuses.set5pc.type !== "LOW_HP_CRIT") return critRate;
  return (currentHp / maxHp) < 0.5 ? Math.min(1, critRate + bonuses.set5pc.value) : critRate;
}

export function apply5pcFirstHit(bonuses: PlayerBonuses, baseDmg: number, firstAction: boolean): number {
  if (!bonuses.set5pc || bonuses.set5pc.type !== "FIRST_HIT") return baseDmg;
  return firstAction ? Math.floor(baseDmg * (1 + bonuses.set5pc.value)) : baseDmg;
}

export function apply5pcFullHpDmg(bonuses: PlayerBonuses, baseDmg: number, currentHp: number, maxHp: number): number {
  if (!bonuses.set5pc || bonuses.set5pc.type !== "FULL_HP_DMG") return baseDmg;
  return currentHp === maxHp ? Math.floor(baseDmg * (1 + bonuses.set5pc.value)) : baseDmg;
}

export function get5pcVibDrainMult(bonuses: PlayerBonuses): number {
  if (!bonuses.set5pc || bonuses.set5pc.type !== "VIB_DRAIN_25") return 1.0;
  return 1 + bonuses.set5pc.value;
}

export function get5pcHpRegen(bonuses: PlayerBonuses, maxHp: number): number {
  if (!bonuses.set5pc || bonuses.set5pc.type !== "HP_REGEN") return 0;
  return typeof bonuses.set5pc.value === "number" && bonuses.set5pc.value < 1
    ? Math.floor(maxHp * bonuses.set5pc.value)
    : Math.floor(bonuses.set5pc.value); // flat energy for Spectro 4pc
}

export function applyLifesteal(lifesteal: number, damage: number, currentHp: number, maxHp: number): number {
  if (lifesteal <= 0) return currentHp;
  return Math.min(maxHp, currentHp + Math.floor(damage * lifesteal));
}

// ── Unique ability in-combat effects (composite) ─────────────────────────────
export interface AbilityAttackResult {
  dmg:         number;
  healHp:      number;
  bonusEnergy: number;
  tag:         string;   // joined effect tags for the combat log
  newStacks?:  number;   // updated V2 stack count (STACK_DMG); undefined for V1
}

// Apply all damage-modifying + on-hit ability primitives for a single attack.
export function applyAbilityAttack(
  bonuses: PlayerBonuses, baseDmg: number, isCrit: boolean, ctx: AbilityCtx,
): AbilityAttackResult {
  if (bonuses.abilityVersion === 2) {
    const v2ctx = {
      ...ctx,
      isCrit,
      isWeak:      ctx.isWeak      ?? false,
      isShattered: ctx.isShattered ?? false,
      v2Stacks:    ctx.v2Stacks    ?? 0,
    };
    // V2 unique ability hooks
    const r = bonuses.v2Effects.length > 0
      ? applyV2Attack(bonuses.v2Effects, baseDmg, isCrit, v2ctx)
      : { dmg: baseDmg, healHp: 0, bonusEnergy: 0, tag: "", newStacks: 0, critDmgBonus: 0, lifesteal: 0, vibMult: 1 };
    // Weapon passive combat hooks (EXECUTE, CRIT_MOMENTUM, etc.) still apply via V1 path
    const { mult: wMult, tags: wTags } = compositeDamageMult(bonuses.abilityEffects, ctx);
    return {
      dmg:         Math.floor(r.dmg * wMult),
      healHp:      r.healHp + compositeHealOnHit(bonuses.abilityEffects, isCrit, ctx.maxHp),
      bonusEnergy: r.bonusEnergy + compositeEnergyOnHit(bonuses.abilityEffects, isCrit),
      tag:         [r.tag, ...wTags].filter(Boolean).join("·"),
      newStacks:   r.newStacks,
    };
  }
  const { mult, tags } = compositeDamageMult(bonuses.abilityEffects, ctx);
  return {
    dmg:         Math.floor(baseDmg * mult),
    healHp:      compositeHealOnHit(bonuses.abilityEffects, isCrit, ctx.maxHp),
    bonusEnergy: compositeEnergyOnHit(bonuses.abilityEffects, isCrit),
    tag:         tags.join("·"),
  };
}

// Crit rate including ability bonus (e.g. Desperation below 40% HP).
export function abilityCritRate(bonuses: PlayerBonuses, baseCrit: number, currentHp: number, maxHp: number): number {
  if (bonuses.abilityVersion === 2) {
    const ctx = { isCrit: false, isWeak: false, isShattered: false, v2Stacks: 0,
      moveType: "BASIC" as const, currentHp, maxHp, enemyHpPct: 0, turn: 1, isFirstAction: false };
    // V2 ability crit bonus + weapon crit bonus (LOW_HP_CRIT etc.)
    return Math.min(1, baseCrit
      + abilityCritRateV2(bonuses.v2Effects, ctx)
      + compositeCritBonus(bonuses.abilityEffects, currentHp, maxHp));
  }
  return Math.min(1, baseCrit + compositeCritBonus(bonuses.abilityEffects, currentHp, maxHp));
}

// Vibration drain multiplier from ability (Shatterpoint).
export function abilityVib(bonuses: PlayerBonuses): number {
  if (bonuses.abilityVersion === 2) {
    // V2 vib × weapon vib (VIB_BREAKER from weapon still applies)
    return abilityVibV2(bonuses.v2Effects) * compositeVibMult(bonuses.abilityEffects);
  }
  return compositeVibMult(bonuses.abilityEffects);
}

// V2 turn-start regen (call at top of each turn like 5pc HP_REGEN).
export function abilityV2TurnRegen(bonuses: PlayerBonuses, maxHp: number): { healHp: number; energy: number } {
  if (bonuses.abilityVersion !== 2) return { healHp: 0, energy: 0 };
  return getV2TurnStartRegen(bonuses.v2Effects, maxHp);
}

// Second wind — survive lethal blow once.
export function abilityHasSecondWind(bonuses: PlayerBonuses): boolean {
  if (bonuses.abilityVersion === 2) return hasSecondWindV2(bonuses.v2Effects);
  return compositeHasSecondWind(bonuses.abilityEffects);
}

// ── Element passive in-combat helpers ─────────────────────────────────────────

/** Fusion — Ignite proc on Basic/Skill. Returns bonus dmg and tag (0 if no proc). */
export function elemIgniteProc(ep: ElementPassive | null, atkVal: number): { dmg: number; tag: string } {
  if (!ep || ep.hookType !== "IGNITE") return { dmg: 0, tag: "" };
  if (Math.random() < 0.35) return { dmg: Math.floor(atkVal * ep.hookValue), tag: "Ignite🔥" };
  return { dmg: 0, tag: "" };
}

/** Glacio — Frost Shield: reduce incoming hit on 25% chance. */
export function elemFrostShield(ep: ElementPassive | null, incomingDmg: number): { dmg: number; blocked: boolean } {
  if (!ep || ep.hookType !== "FROST_SHIELD") return { dmg: incomingDmg, blocked: false };
  if (Math.random() < 0.25) return { dmg: Math.floor(incomingDmg * (1 - ep.hookValue)), blocked: true };
  return { dmg: incomingDmg, blocked: false };
}

/** Electro — Discharge: bonus energy on any crit. */
export function elemDischargeEnergy(ep: ElementPassive | null, isCrit: boolean): number {
  if (!ep || ep.hookType !== "DISCHARGE" || !isCrit) return 0;
  return ep.hookValue;
}

/** Aero — Windstride: damage multiplier scaling with turn (1 + stacks×0.08, max ×5). */
export function elemWindstrideMult(ep: ElementPassive | null, turn: number, moveType: "BASIC" | "SKILL" | "ULT"): number {
  if (!ep || ep.hookType !== "WINDSTRIDE" || moveType === "ULT") return 1;
  const stacks = Math.min(5, Math.max(0, turn - 1));
  return 1 + stacks * ep.hookValue;
}

/** Havoc — Void Surge: HP healed on Shatter. */
export function elemVoidSurgeHeal(ep: ElementPassive | null, maxHp: number): number {
  if (!ep || ep.hookType !== "VOID_SURGE") return 0;
  return Math.floor(maxHp * ep.hookValue);
}

/** Spectro — Radiance regen: HP healed per turn after enemy attacks. */
export function elemRadianceRegen(ep: ElementPassive | null, maxHp: number): number {
  if (!ep || ep.hookType !== "RADIANCE") return 0;
  return Math.floor(maxHp * ep.hookValue);
}

/** Spectro — Radiance crit: bonus Crit Rate when below 40% HP. */
export function elemRadianceCrit(ep: ElementPassive | null, currentHp: number, maxHp: number): number {
  if (!ep || ep.hookType !== "RADIANCE") return 0;
  return (currentHp / maxHp) < 0.40 ? 0.25 : 0;
}

function elementEmoji(el: string): string {
  const m: Record<string, string> = {
    FUSION:"🔥", GLACIO:"❄️", ELECTRO:"⚡", AERO:"🌪️", HAVOC:"🌑", SPECTRO:"✨", NONE:"◇",
  };
  return m[el] ?? "◇";
}

// ── Display helper for /echoes ────────────────────────────────────────────────
export async function formatSetBonuses(userId: string): Promise<string> {
  const bonuses = await resolvePlayerBonuses(userId);
  if (bonuses.activeLabels.length === 0) return "*No active bonuses — equip echoes to activate set effects.*";
  return bonuses.activeLabels.map(l => `› ${l}`).join("\n");
}
