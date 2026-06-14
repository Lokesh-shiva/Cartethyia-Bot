// ── Unique Ability Engine V2 ────────────────────────────────────────────────
// Composable Trigger → Effect language. Each ability is 2–3 entries where
// the AI freely chooses trigger + effect + value + flavour text, instead of
// picking from 21 fixed preset types.
//
// Storage: `uniqueAbilityEffects` JSON column carries V2EffectEntry[] when
// `abilityVersion = 2`. Discriminated by the `abilityVersion` field on User.

import { PassiveMods } from "./abilityEffects";

// ── Schema ─────────────────────────────────────────────────────────────────────

export type V2Trigger =
  | "PASSIVE"
  | "ON_BASIC" | "ON_SKILL" | "ON_ULT" | "ON_HIT" | "ON_CRIT"
  | "FIRST_ACTION"
  | "EVERY_N_TURNS"     // triggerParam = N (2–5)
  | "BELOW_HP_PCT"      // triggerParam = threshold (0.25–0.50)
  | "ABOVE_HP_PCT"      // triggerParam = threshold (0.50–0.80)
  | "ON_SHATTER"        // enemy shatter
  | "VS_WEAK"           // attacking enemy's elemental weakness
  | "TURN_START";       // per-turn passive (regen / energy tick)

export type V2EffectKind =
  | "DMG_MULT"      // × (1 + value) on final damage
  | "CRIT_RATE"     // + value to crit rate
  | "CRIT_DMG"      // + value to crit damage multiplier
  | "HEAL_PCT"      // heal value × maxHp HP
  | "GAIN_ENERGY"   // flat energy gain
  | "ATK_MULT"      // treated as post-calc DMG_MULT (ATK is pre-resolved)
  | "VIB_DRAIN"     // × (1 + value) vibration drain
  | "LIFESTEAL"     // + value to lifesteal on this hit
  | "ELEM_DMG"      // + value to elemental damage bonus
  | "STACK_DMG"     // + value × stacks to DMG_MULT (up to stackMax)
  | "SECOND_WIND";  // survive one lethal blow at 1 HP

export interface V2EffectEntry {
  trigger:       V2Trigger;
  triggerParam?: number;               // N for EVERY_N_TURNS; threshold for HP%; N for BELOW/ABOVE
  effect:        V2EffectKind;
  value:         number;
  stackMax?:     number;               // STACK_DMG only
  secondary?:    { effect: V2EffectKind; value: number };
  displayName:   string;               // AI-generated short chip label
  desc:          string;               // AI-generated 1-sentence description
}

// Extended combat context for V2 (superset of AbilityCtx)
export interface AbilityCtxV2 {
  moveType:      "BASIC" | "SKILL" | "ULT";
  currentHp:     number;
  maxHp:         number;
  enemyHpPct:    number;
  turn:          number;
  isFirstAction: boolean;
  isCrit:        boolean;
  isWeak:        boolean;     // element hits weakness
  isShattered:   boolean;    // enemy was shattered this turn
  v2Stacks:      number;     // current stack count for STACK_DMG
}

// ── Value ranges ───────────────────────────────────────────────────────────────
// The AI must output values in these ranges. We clamp on read.
// Key: `${trigger}:${effect}` or fallback `*:${effect}`.

interface V2Range { min: number; max: number; }

const RANGES: Record<string, V2Range> = {
  // Passive (no condition — keep values modest)
  "PASSIVE:DMG_MULT":    { min: 0.08, max: 0.18 },
  "PASSIVE:CRIT_RATE":   { min: 0.04, max: 0.10 },
  "PASSIVE:CRIT_DMG":    { min: 0.10, max: 0.22 },
  "PASSIVE:ATK_MULT":    { min: 0.08, max: 0.16 },
  "PASSIVE:ENERGY_REGEN":{ min: 6,    max: 14   },
  "PASSIVE:LIFESTEAL":   { min: 0.04, max: 0.10 },
  "PASSIVE:ELEM_DMG":    { min: 0.08, max: 0.14 },

  // Every hit
  "ON_HIT:DMG_MULT":     { min: 0.08, max: 0.18 },
  "ON_HIT:VIB_DRAIN":    { min: 0.20, max: 0.40 },
  "ON_HIT:LIFESTEAL":    { min: 0.04, max: 0.10 },
  "ON_HIT:GAIN_ENERGY":  { min: 8,    max: 18   },

  // Specific move type
  "ON_BASIC:DMG_MULT":   { min: 0.15, max: 0.30 },
  "ON_SKILL:DMG_MULT":   { min: 0.18, max: 0.35 },
  "ON_ULT:DMG_MULT":     { min: 0.22, max: 0.40 },
  "ON_BASIC:GAIN_ENERGY":{ min: 12,   max: 28   },
  "ON_SKILL:GAIN_ENERGY":{ min: 15,   max: 35   },
  "ON_ULT:GAIN_ENERGY":  { min: 20,   max: 45   },
  "ON_BASIC:CRIT_RATE":  { min: 0.06, max: 0.14 },
  "ON_SKILL:CRIT_RATE":  { min: 0.08, max: 0.16 },
  "ON_ULT:CRIT_RATE":    { min: 0.10, max: 0.20 },
  "ON_BASIC:HEAL_PCT":   { min: 0.03, max: 0.08 },
  "ON_SKILL:HEAL_PCT":   { min: 0.04, max: 0.10 },
  "ON_ULT:HEAL_PCT":     { min: 0.06, max: 0.14 },

  // Crit-triggered
  "ON_CRIT:DMG_MULT":    { min: 0.20, max: 0.45 },
  "ON_CRIT:GAIN_ENERGY": { min: 12,   max: 25   },
  "ON_CRIT:HEAL_PCT":    { min: 0.05, max: 0.12 },
  "ON_CRIT:CRIT_DMG":    { min: 0.15, max: 0.35 },

  // First action (once per fight — high value)
  "FIRST_ACTION:DMG_MULT":  { min: 0.40, max: 0.75 },
  "FIRST_ACTION:CRIT_RATE": { min: 0.15, max: 0.30 },
  "FIRST_ACTION:ATK_MULT":  { min: 0.25, max: 0.50 },

  // Every N turns
  "EVERY_N_TURNS:DMG_MULT":   { min: 0.25, max: 0.55 },
  "EVERY_N_TURNS:GAIN_ENERGY":{ min: 25,   max: 60   },
  "EVERY_N_TURNS:HEAL_PCT":   { min: 0.08, max: 0.18 },

  // HP-conditional
  "BELOW_HP_PCT:DMG_MULT":  { min: 0.30, max: 0.70 },
  "BELOW_HP_PCT:CRIT_RATE": { min: 0.15, max: 0.30 },
  "BELOW_HP_PCT:HEAL_PCT":  { min: 0.08, max: 0.18 },
  "ABOVE_HP_PCT:DMG_MULT":  { min: 0.12, max: 0.28 },
  "ABOVE_HP_PCT:CRIT_RATE": { min: 0.06, max: 0.16 },

  // On shatter
  "ON_SHATTER:DMG_MULT":   { min: 0.30, max: 0.70 },
  "ON_SHATTER:HEAL_PCT":   { min: 0.10, max: 0.22 },
  "ON_SHATTER:GAIN_ENERGY":{ min: 30,   max: 60   },

  // vs weakness element
  "VS_WEAK:DMG_MULT":  { min: 0.20, max: 0.45 },
  "VS_WEAK:ELEM_DMG":  { min: 0.15, max: 0.30 },
  "VS_WEAK:CRIT_DMG":  { min: 0.15, max: 0.30 },

  // Turn-start regen
  "TURN_START:HEAL_PCT":   { min: 0.02, max: 0.05 },
  "TURN_START:GAIN_ENERGY":{ min: 8,    max: 20   },
  "TURN_START:CRIT_RATE":  { min: 0.04, max: 0.10 },

  // STACK_DMG (per stack, stackMax 3–5)
  "STACK_DMG":             { min: 0.05, max: 0.15 },
};

function getRange(trigger: V2Trigger, effect: V2EffectKind): V2Range {
  return (
    RANGES[`${trigger}:${effect}`] ??
    RANGES[`*:${effect}`] ??
    RANGES[effect] ??
    { min: 0, max: 1 }
  );
}

export function clampV2Value(trigger: V2Trigger, effect: V2EffectKind, value: number, capMult = 1.0): number {
  const r = getRange(trigger, effect);
  return Math.max(r.min, Math.min(r.max * capMult, value));
}

// ── Validation ─────────────────────────────────────────────────────────────────

const VALID_TRIGGERS = new Set<string>([
  "PASSIVE","ON_BASIC","ON_SKILL","ON_ULT","ON_HIT","ON_CRIT",
  "FIRST_ACTION","EVERY_N_TURNS","BELOW_HP_PCT","ABOVE_HP_PCT",
  "ON_SHATTER","VS_WEAK","TURN_START",
]);

const VALID_EFFECTS = new Set<string>([
  "DMG_MULT","CRIT_RATE","CRIT_DMG","HEAL_PCT","GAIN_ENERGY","ATK_MULT",
  "VIB_DRAIN","LIFESTEAL","ELEM_DMG","STACK_DMG","SECOND_WIND",
]);

export function sanitizeV2Effects(raw: any, evolved = false, maxOverride?: number): V2EffectEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: V2EffectEntry[] = [];
  const capMult  = evolved ? 999 : 1.0;  // evolved values come pre-clamped from evolveEffectsV2; 999 lets legendary patched values through
  const maxSlots = maxOverride ?? (evolved ? 4 : 3);

  for (const e of raw) {
    const trigger = String(e?.trigger ?? "").toUpperCase() as V2Trigger;
    const effect  = String(e?.effect  ?? "").toUpperCase() as V2EffectKind;

    if (!VALID_TRIGGERS.has(trigger) || !VALID_EFFECTS.has(effect)) continue;

    const value = clampV2Value(trigger, effect, Number(e?.value) || 0, capMult);

    const entry: V2EffectEntry = {
      trigger,
      effect,
      value,
      displayName: String(e?.displayName ?? effect).slice(0, 40),
      desc:        String(e?.desc ?? "").slice(0, 120),
    };

    if (trigger === "EVERY_N_TURNS") {
      entry.triggerParam = Math.round(Math.max(2, Math.min(5, Number(e?.triggerParam) || 3)));
    } else if (trigger === "BELOW_HP_PCT" || trigger === "ABOVE_HP_PCT") {
      entry.triggerParam = Math.max(0.15, Math.min(0.80, Number(e?.triggerParam) || 0.40));
    }

    if (effect === "STACK_DMG") {
      entry.stackMax = Math.round(Math.max(2, Math.min(6, Number(e?.stackMax) || 4)));
    }

    if (e?.secondary) {
      const sEffect = String(e.secondary.effect ?? "").toUpperCase() as V2EffectKind;
      if (VALID_EFFECTS.has(sEffect) && sEffect !== "SECOND_WIND") {
        const sValue = clampV2Value(trigger, sEffect, Number(e.secondary.value) || 0);
        entry.secondary = { effect: sEffect, value: sValue };
      }
    }

    out.push(entry);
    if (out.length >= maxSlots) break;
  }
  return out;
}

// ── Trigger evaluation ─────────────────────────────────────────────────────────

function triggerFired(entry: V2EffectEntry, ctx: AbilityCtxV2): boolean {
  switch (entry.trigger) {
    case "PASSIVE":      return true;
    case "ON_BASIC":     return ctx.moveType === "BASIC";
    case "ON_SKILL":     return ctx.moveType === "SKILL";
    case "ON_ULT":       return ctx.moveType === "ULT";
    case "ON_HIT":       return true;
    case "ON_CRIT":      return ctx.isCrit;
    case "FIRST_ACTION": return ctx.isFirstAction;
    case "EVERY_N_TURNS": {
      const n = entry.triggerParam ?? 3;
      return ctx.turn > 0 && ctx.turn % n === 0;
    }
    case "BELOW_HP_PCT":
      return (ctx.currentHp / ctx.maxHp) < (entry.triggerParam ?? 0.40);
    case "ABOVE_HP_PCT":
      return (ctx.currentHp / ctx.maxHp) >= (entry.triggerParam ?? 0.70);
    case "ON_SHATTER": return ctx.isShattered;
    case "VS_WEAK":    return ctx.isWeak;
    case "TURN_START": return false; // handled in getV2TurnStartRegen, not attack
    default:           return false;
  }
}

// Apply a single effect kind to the running result totals.
function applyOutcome(
  effect:    V2EffectKind,
  value:     number,
  entry:     V2EffectEntry,
  ctx:       AbilityCtxV2,
  out:       { dmgMult: number; critRate: number; critDmg: number; healHp: number; bonusEnergy: number; vibMult: number; lifesteal: number; tag: string; newStacks: number; },
): void {
  switch (effect) {
    case "DMG_MULT":
    case "ATK_MULT":    out.dmgMult  *= (1 + value); break;
    case "CRIT_RATE":   out.critRate += value;        break;
    case "CRIT_DMG":    out.critDmg  += value;        break;
    case "HEAL_PCT":    out.healHp   += Math.floor(ctx.maxHp * value); break;
    case "GAIN_ENERGY": out.bonusEnergy += value;     break;
    case "VIB_DRAIN":   out.vibMult  *= (1 + value);  break;
    case "LIFESTEAL":   out.lifesteal += value;        break;
    case "ELEM_DMG":    out.dmgMult  *= (1 + value);  break; // treat as post-calc bonus
    case "STACK_DMG": {
      const maxStacks = entry.stackMax ?? 4;
      out.newStacks = Math.min(maxStacks, ctx.v2Stacks + 1);
      out.dmgMult  *= (1 + value * out.newStacks);
      break;
    }
    case "SECOND_WIND": break; // handled separately via hasSecondWindV2
  }
}

// ── Main attack interpreter ────────────────────────────────────────────────────

export interface V2AttackResult {
  dmg:          number;
  healHp:       number;
  bonusEnergy:  number;
  tag:          string;
  newStacks:    number;  // updated stack count to persist in fight state
  critDmgBonus: number;  // extra crit multiplier from abilities
  lifesteal:    number;  // total lifesteal fraction from abilities
  vibMult:      number;  // vibration drain multiplier
}

export function applyV2Attack(
  effects:  V2EffectEntry[],
  baseDmg:  number,
  _isCrit:  boolean,
  ctx:      AbilityCtxV2,
): V2AttackResult {
  const acc = {
    dmgMult:     1,
    critRate:    0,
    critDmg:     0,
    healHp:      0,
    bonusEnergy: 0,
    vibMult:     1,
    lifesteal:   0,
    tag:         "",
    newStacks:   ctx.v2Stacks,
  };

  const tags: string[] = [];

  for (const entry of effects) {
    if (entry.trigger === "PASSIVE" || entry.trigger === "TURN_START") continue; // handled in passives
    if (!triggerFired(entry, ctx)) continue;

    applyOutcome(entry.effect, entry.value, entry, ctx, acc);
    if (acc.tag === "") tags.push(entry.displayName || entry.effect);

    if (entry.secondary) {
      applyOutcome(entry.secondary.effect, entry.secondary.value, entry, ctx, acc);
    }
  }

  return {
    dmg:          Math.floor(baseDmg * acc.dmgMult),
    healHp:       acc.healHp,
    bonusEnergy:  acc.bonusEnergy,
    tag:          tags.join("·"),
    newStacks:    acc.newStacks,
    critDmgBonus: acc.critDmg,
    lifesteal:    acc.lifesteal,
    vibMult:      acc.vibMult,
  };
}

// ── Crit rate contribution (for pre-roll crit check) ──────────────────────────

export function abilityCritRateV2(effects: V2EffectEntry[], ctx: AbilityCtxV2): number {
  let bonus = 0;
  for (const e of effects) {
    if (e.effect !== "CRIT_RATE") continue;
    if (e.trigger === "PASSIVE") { bonus += e.value; continue; }
    if (e.trigger === "TURN_START") { bonus += e.value; continue; }  // ongoing buff
    if (triggerFired(e, ctx)) bonus += e.value;
  }
  return bonus;
}

// ── Passive stat contributions (folded into resolvePlayerBonuses) ─────────────

export function v2CompositePassives(effects: V2EffectEntry[]): PassiveMods {
  const m: PassiveMods = {
    atkMult: 1, hpMult: 1, defMult: 1,
    critRateBonus: 0, critDmgBonus: 0,
    energyBonus: 0, lifesteal: 0, elemDmgBonus: 0,
  };

  for (const e of effects) {
    if (e.trigger !== "PASSIVE" && e.trigger !== "TURN_START") continue;

    switch (e.effect) {
      case "ATK_MULT":  m.atkMult   *= (1 + e.value); break;
      case "CRIT_RATE": m.critRateBonus += e.value;    break;
      case "CRIT_DMG":  m.critDmgBonus  += e.value;    break;
      case "LIFESTEAL": m.lifesteal     += e.value;    break;
      case "ELEM_DMG":  m.elemDmgBonus  += e.value;    break;
      case "GAIN_ENERGY": m.energyBonus += e.value;    break;
      // DMG_MULT PASSIVE: treat as small ATK boost for stat sheet purposes
      case "DMG_MULT":  m.atkMult   *= (1 + e.value); break;
    }
  }
  return m;
}

// ── Per-turn regen (replaces 5pc-style TURN_START effects in combat loops) ────

export function getV2TurnStartRegen(effects: V2EffectEntry[], maxHp: number): { healHp: number; energy: number } {
  let healHp = 0; let energy = 0;
  for (const e of effects) {
    if (e.trigger !== "TURN_START") continue;
    if (e.effect === "HEAL_PCT")    healHp  += Math.floor(maxHp * e.value);
    if (e.effect === "GAIN_ENERGY") energy  += e.value;
  }
  return { healHp, energy };
}

// ── Vib drain multiplier from passive V2 effects ──────────────────────────────

export function abilityVibV2(effects: V2EffectEntry[]): number {
  let m = 1;
  for (const e of effects) {
    if (e.effect === "VIB_DRAIN" && (e.trigger === "PASSIVE" || e.trigger === "ON_HIT")) {
      m *= (1 + e.value);
    }
  }
  return m;
}

// ── Second wind check ─────────────────────────────────────────────────────────

export function hasSecondWindV2(effects: V2EffectEntry[]): boolean {
  return effects.some(e => e.effect === "SECOND_WIND");
}

// ── Display formatting ─────────────────────────────────────────────────────────

function triggerLabel(e: V2EffectEntry): string {
  switch (e.trigger) {
    case "PASSIVE":        return "Passive";
    case "ON_BASIC":       return "On Basic";
    case "ON_SKILL":       return "On Skill";
    case "ON_ULT":         return "On Ultimate";
    case "ON_HIT":         return "On Hit";
    case "ON_CRIT":        return "On Crit";
    case "FIRST_ACTION":   return "First Action";
    case "EVERY_N_TURNS":  return `Every ${e.triggerParam ?? 3} Turns`;
    case "BELOW_HP_PCT":   return `Below ${Math.round((e.triggerParam ?? 0.4) * 100)}% HP`;
    case "ABOVE_HP_PCT":   return `Above ${Math.round((e.triggerParam ?? 0.7) * 100)}% HP`;
    case "ON_SHATTER":     return "On Shatter";
    case "VS_WEAK":        return "vs Weakness";
    case "TURN_START":     return "Turn Start";
    default: return e.trigger;
  }
}

export function formatV2Effects(effects: V2EffectEntry[]): string {
  if (!effects.length) return "";
  return effects.map(e => {
    const header = `**${e.displayName}** *(${triggerLabel(e)})*`;
    return `${header}: ${e.desc}`;
  }).join("\n");
}

// ── AI generation prompt schema description ────────────────────────────────────
// Called by uniqueAbility.ts (V2 path) to build the prompt injection.

export const V2_PROMPT_SCHEMA = `
You are composing a UNIQUE PASSIVE ABILITY from a Trigger → Effect language.

Each ability has 2–3 components. For each component, choose:
- trigger: one of: PASSIVE, ON_BASIC, ON_SKILL, ON_ULT, ON_HIT, ON_CRIT, FIRST_ACTION, EVERY_N_TURNS, BELOW_HP_PCT, ABOVE_HP_PCT, ON_SHATTER, VS_WEAK, TURN_START
- triggerParam: required for EVERY_N_TURNS (N=2–5), BELOW_HP_PCT (threshold 0.25–0.50), ABOVE_HP_PCT (threshold 0.50–0.80)
- effect: one of: DMG_MULT, CRIT_RATE, CRIT_DMG, HEAL_PCT, GAIN_ENERGY, ATK_MULT, VIB_DRAIN, LIFESTEAL, ELEM_DMG, STACK_DMG, SECOND_WIND
- value: see ranges below
- stackMax: integer 3–5 (only for STACK_DMG)
- secondary (optional): {effect, value} — a bonus effect that fires alongside the main one
- displayName: 2–3 word chip name (e.g. "Lethal Edge", "Iron Will")
- desc: 1 sentence describing what this component does

Balanced value ranges per trigger:
PASSIVE: DMG_MULT/ATK_MULT 0.08–0.18, CRIT_RATE 0.04–0.10, CRIT_DMG 0.10–0.22, LIFESTEAL 0.04–0.10, ELEM_DMG 0.08–0.14, GAIN_ENERGY 6–14
ON_HIT: DMG_MULT 0.08–0.18, VIB_DRAIN 0.20–0.40, LIFESTEAL 0.04–0.10, GAIN_ENERGY 8–18
ON_BASIC/SKILL/ULT: DMG_MULT 0.18–0.40, GAIN_ENERGY 12–45, CRIT_RATE 0.06–0.20, HEAL_PCT 0.03–0.14
ON_CRIT: DMG_MULT 0.20–0.45, GAIN_ENERGY 12–25, HEAL_PCT 0.05–0.12, CRIT_DMG 0.15–0.35
FIRST_ACTION: DMG_MULT 0.40–0.75, CRIT_RATE 0.15–0.30, ATK_MULT 0.25–0.50
EVERY_N_TURNS: DMG_MULT 0.25–0.55, GAIN_ENERGY 25–60, HEAL_PCT 0.08–0.18
BELOW_HP_PCT: DMG_MULT 0.30–0.70, CRIT_RATE 0.15–0.30, HEAL_PCT 0.08–0.18
ABOVE_HP_PCT: DMG_MULT 0.12–0.28, CRIT_RATE 0.06–0.16
ON_SHATTER: DMG_MULT 0.30–0.70, HEAL_PCT 0.10–0.22, GAIN_ENERGY 30–60
VS_WEAK: DMG_MULT 0.20–0.45, ELEM_DMG 0.15–0.30, CRIT_DMG 0.15–0.30
TURN_START: HEAL_PCT 0.02–0.05 (per-turn regen), GAIN_ENERGY 8–20
STACK_DMG (value per stack, stackMax 3–5): 0.05–0.15/stack
`.trim();
