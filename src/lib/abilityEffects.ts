// ── Unique Ability combat engine ──────────────────────────────────────────────
// Centralizes ALL combat-affecting unique ability logic so every combat loop
// (encounter, dungeon, ascend, duel, raid) behaves identically.

export type AbilityKind = "PASSIVE_STAT" | "COMBAT_HOOK";

export interface AbilityDef {
  label:    string;          // short display name
  kind:     AbilityKind;
  desc:     string;          // human-readable effect
  min:      number;          // value range (for AI gen + clamping)
  max:      number;
  isPct:    boolean;         // value is a fraction (0.15 = 15%) vs flat
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const ABILITY_REGISTRY: Record<string, AbilityDef> = {
  // Passive stat boosts (applied in resolvePlayerBonuses)
  ATK_BOOST:      { label: "Empowered Strikes", kind: "PASSIVE_STAT", desc: "Passive +{v}% ATK",              min: 0.08, max: 0.18, isPct: true },
  HP_BOOST:       { label: "Vital Surge",       kind: "PASSIVE_STAT", desc: "Passive +{v}% HP",               min: 0.10, max: 0.20, isPct: true },
  DEF_BOOST:      { label: "Ironward",          kind: "PASSIVE_STAT", desc: "Passive +{v}% DEF",              min: 0.10, max: 0.22, isPct: true },
  CRIT_RATE:      { label: "Keen Eye",          kind: "PASSIVE_STAT", desc: "Passive +{v}% Crit Rate",        min: 0.05, max: 0.12, isPct: true },
  CRIT_DMG:       { label: "Lethal Edge",       kind: "PASSIVE_STAT", desc: "Passive +{v}% Crit DMG",         min: 0.15, max: 0.30, isPct: true },
  LIFESTEAL:      { label: "Bloodbound",        kind: "PASSIVE_STAT", desc: "Heal {v}% of damage dealt",      min: 0.05, max: 0.12, isPct: true },
  ENERGY_BOOST:   { label: "Resonant Flow",     kind: "PASSIVE_STAT", desc: "+{v} bonus energy per turn",     min: 8,    max: 16,   isPct: false },
  ELEM_DMG_BOOST: { label: "Attuned Soul",      kind: "PASSIVE_STAT", desc: "+{v}% Elemental damage",         min: 0.08, max: 0.16, isPct: true },

  // Combat hooks (applied during the turn)
  SKILL_POWER:    { label: "Skillweaver",       kind: "COMBAT_HOOK", desc: "Resonance Skill deals +{v}% DMG", min: 0.18, max: 0.34, isPct: true },
  ULT_POWER:      { label: "Cataclysm",         kind: "COMBAT_HOOK", desc: "Ultimate deals +{v}% DMG",        min: 0.22, max: 0.40, isPct: true },
  LOW_HP_CRIT:    { label: "Desperation",       kind: "COMBAT_HOOK", desc: "Below 40% HP: +{v}% Crit Rate",   min: 0.18, max: 0.30, isPct: true },
  FULL_HP_DMG:    { label: "Pristine Force",    kind: "COMBAT_HOOK", desc: "At full HP: +{v}% DMG",           min: 0.15, max: 0.25, isPct: true },
  EXECUTE:        { label: "Reaper's Mark",     kind: "COMBAT_HOOK", desc: "Vs enemies below 30% HP: +{v}% DMG", min: 0.30, max: 0.60, isPct: true },
  BERSERK:        { label: "Last Stand",        kind: "COMBAT_HOOK", desc: "Up to +{v}% DMG as your HP drops", min: 0.25, max: 0.50, isPct: true },
  FIRST_STRIKE:   { label: "Opening Gambit",    kind: "COMBAT_HOOK", desc: "First action: +{v}% DMG",         min: 0.40, max: 0.70, isPct: true },
  ESCALATION:     { label: "Rising Tempo",      kind: "COMBAT_HOOK", desc: "+{v}% DMG each turn (max 5 stacks)", min: 0.06, max: 0.12, isPct: true },
  VIB_BREAKER:    { label: "Shatterpoint",      kind: "COMBAT_HOOK", desc: "+{v}% Vibration drain (faster Shatter)", min: 0.30, max: 0.60, isPct: true },
  HEAL_ON_CRIT:   { label: "Sanguine Rhythm",   kind: "COMBAT_HOOK", desc: "Critical hits heal {v}% of max HP", min: 0.06, max: 0.14, isPct: true },
  CRIT_MOMENTUM:  { label: "Surging Instinct",  kind: "COMBAT_HOOK", desc: "Crits grant +{v} energy",         min: 10,   max: 20,   isPct: false },
  SECOND_WIND:    { label: "Undying Will",      kind: "COMBAT_HOOK", desc: "Survive a lethal blow once at 1 HP", min: 1,  max: 1,    isPct: false },
};

export const PASSIVE_TYPES   = Object.keys(ABILITY_REGISTRY).filter(k => ABILITY_REGISTRY[k].kind === "PASSIVE_STAT");
export const COMBAT_HOOK_TYPES = Object.keys(ABILITY_REGISTRY).filter(k => ABILITY_REGISTRY[k].kind === "COMBAT_HOOK");
export const ALL_ABILITY_TYPES = Object.keys(ABILITY_REGISTRY);

// ── Legacy migration ──────────────────────────────────────────────────────────
// "Boring" plain stat boosts get upgraded to richer combat hooks (keeping name/lore).
// Idempotent: once upgraded, the new type isn't in this map so it stays.
const MIGRATE_MAP: Record<string, { type: string; value: number }> = {
  ATK_BOOST:    { type: "EXECUTE",       value: 0.45 },
  HP_BOOST:     { type: "BERSERK",       value: 0.35 },
  CRIT_RATE:    { type: "CRIT_MOMENTUM", value: 15   },
  ENERGY_BOOST: { type: "FIRST_STRIKE",  value: 0.55 },
  DEF_BOOST:    { type: "SECOND_WIND",   value: 1    },
  // CRIT_DMG, LIFESTEAL, ELEM_DMG_BOOST kept — they're already meaningful
};

export function migrateAbility(type: string | null, value: number | null): { type: string | null; value: number; changed: boolean } {
  if (!type) return { type: null, value: 0, changed: false };
  const m = MIGRATE_MAP[type];
  if (m) return { type: m.type, value: m.value, changed: true };
  return { type, value: value ?? 0, changed: false };
}

// ── Combat context ─────────────────────────────────────────────────────────────
export interface AbilityCtx {
  moveType:      "BASIC" | "SKILL" | "ULT";
  currentHp:     number;
  maxHp:         number;
  enemyHpPct:    number;   // 0–1
  turn:          number;   // 1-based
  isFirstAction: boolean;
  // V2 extension fields — optional so existing V1 call sites need no changes
  isCrit?:       boolean;  // whether this attack critted (for ON_CRIT trigger)
  isWeak?:       boolean;  // attacking enemy's elemental weakness (for VS_WEAK trigger)
  isShattered?:  boolean;  // enemy was shattered this turn (for ON_SHATTER trigger)
  v2Stacks?:     number;   // current STACK_DMG stack count
}

// ── Damage multiplier from ability (multiplicative, 1.0 = no change) ──────────
export function abilityDamageMult(type: string | null, value: number, ctx: AbilityCtx): { mult: number; tag: string } {
  if (!type) return { mult: 1, tag: "" };

  switch (type) {
    case "SKILL_POWER":
      return ctx.moveType === "SKILL" ? { mult: 1 + value, tag: "SKILLWEAVER" } : { mult: 1, tag: "" };
    case "ULT_POWER":
      return ctx.moveType === "ULT" ? { mult: 1 + value, tag: "CATACLYSM" } : { mult: 1, tag: "" };
    case "FULL_HP_DMG":
      return ctx.currentHp >= ctx.maxHp ? { mult: 1 + value, tag: "PRISTINE" } : { mult: 1, tag: "" };
    case "EXECUTE":
      return ctx.enemyHpPct < 0.30 ? { mult: 1 + value, tag: "EXECUTE" } : { mult: 1, tag: "" };
    case "BERSERK": {
      const missing = 1 - (ctx.currentHp / ctx.maxHp);   // 0 at full, 1 at empty
      const bonus   = value * missing;
      return bonus > 0.01 ? { mult: 1 + bonus, tag: "LASTSTAND" } : { mult: 1, tag: "" };
    }
    case "FIRST_STRIKE":
      return ctx.isFirstAction ? { mult: 1 + value, tag: "GAMBIT" } : { mult: 1, tag: "" };
    case "ESCALATION": {
      const stacks = Math.min(5, ctx.turn - 1);
      return stacks > 0 ? { mult: 1 + value * stacks, tag: `TEMPO×${stacks}` } : { mult: 1, tag: "" };
    }
    default:
      return { mult: 1, tag: "" };
  }
}

// ── Crit rate bonus from ability (flat addition) ──────────────────────────────
export function abilityCritBonus(type: string | null, value: number, currentHp: number, maxHp: number): number {
  if (type === "LOW_HP_CRIT" && (currentHp / maxHp) < 0.40) return value;
  return 0;
}

// ── On-hit heal (e.g. heal on crit) ───────────────────────────────────────────
export function abilityHealOnHit(type: string | null, value: number, isCrit: boolean, maxHp: number): number {
  if (type === "HEAL_ON_CRIT" && isCrit) return Math.floor(maxHp * value);
  return 0;
}

// ── On-hit energy (e.g. crit momentum) ────────────────────────────────────────
export function abilityEnergyOnHit(type: string | null, value: number, isCrit: boolean): number {
  if (type === "CRIT_MOMENTUM" && isCrit) return value;
  return 0;
}

// ── Vibration drain multiplier ────────────────────────────────────────────────
export function abilityVibMult(type: string | null, value: number): number {
  return type === "VIB_BREAKER" ? 1 + value : 1;
}

// ── Second wind — survive a lethal blow once ──────────────────────────────────
export function abilityHasSecondWind(type: string | null): boolean {
  return type === "SECOND_WIND";
}

// ── Display: formatted effect string ──────────────────────────────────────────
export function formatAbilityEffect(type: string | null, value: number): string {
  if (!type) return "";
  const def = ABILITY_REGISTRY[type];
  if (!def) return type;
  const shown = def.isPct ? `${Math.round(value * 100)}` : `${Math.round(value)}`;
  return def.desc.replace("{v}", shown);
}

export function abilityLabel(type: string | null): string {
  if (!type) return "";
  return ABILITY_REGISTRY[type]?.label ?? type;
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSITE ABILITIES — an ability is a list of primitives, each from the
// registry vocabulary. The AI composes the list + values; the engine executes
// each primitive. This makes the space of possible abilities effectively
// unlimited while every piece still maps to real combat code.
// ══════════════════════════════════════════════════════════════════════════════

export interface AbilityEffect { type: string; value: number; }

// Clamp an AI-provided value into the primitive's valid range.
export function clampEffectValue(type: string, value: number): number {
  const def = ABILITY_REGISTRY[type];
  if (!def) return value;
  return Math.max(def.min, Math.min(def.max, value));
}

// Validate + clamp a raw effect list from the AI. Drops unknown types, caps at 3.
// Evolved abilities get a 4th slot and values up to 1.3× the registry max.
export function sanitizeEffects(raw: any, evolved = false): AbilityEffect[] {
  if (!Array.isArray(raw)) return [];
  const maxCount = evolved ? 4 : 3;
  const seen = new Set<string>();
  const out: AbilityEffect[] = [];
  for (const e of raw) {
    const type = String(e?.type ?? "").toUpperCase();
    const def  = ABILITY_REGISTRY[type];
    if (!def || seen.has(type)) continue;
    seen.add(type);
    const v   = Number(e?.value) || def.min;
    const cap = evolved ? def.max * 1.3 : def.max;
    out.push({ type, value: Math.max(def.min, Math.min(cap, v)) });
    if (out.length >= maxCount) break;
  }
  return out;
}

// ── Composite combat application ──────────────────────────────────────────────
// Returns total damage multiplier (product of all damage primitives) + tags.
export function compositeDamageMult(effects: AbilityEffect[], ctx: AbilityCtx): { mult: number; tags: string[] } {
  let mult = 1; const tags: string[] = [];
  for (const e of effects) {
    const r = abilityDamageMult(e.type, e.value, ctx);
    if (r.mult !== 1) { mult *= r.mult; if (r.tag) tags.push(r.tag); }
  }
  return { mult, tags };
}

export function compositeCritBonus(effects: AbilityEffect[], currentHp: number, maxHp: number): number {
  let b = 0;
  for (const e of effects) b += abilityCritBonus(e.type, e.value, currentHp, maxHp);
  return b;
}

export function compositeHealOnHit(effects: AbilityEffect[], isCrit: boolean, maxHp: number): number {
  let h = 0;
  for (const e of effects) h += abilityHealOnHit(e.type, e.value, isCrit, maxHp);
  return h;
}

export function compositeEnergyOnHit(effects: AbilityEffect[], isCrit: boolean): number {
  let n = 0;
  for (const e of effects) n += abilityEnergyOnHit(e.type, e.value, isCrit);
  return n;
}

export function compositeVibMult(effects: AbilityEffect[]): number {
  let m = 1;
  for (const e of effects) m *= abilityVibMult(e.type, e.value);
  return m;
}

export function compositeHasSecondWind(effects: AbilityEffect[]): boolean {
  return effects.some(e => e.type === "SECOND_WIND");
}

// Passive primitives → applied to base stats (returns the modifiers to fold in).
export interface PassiveMods {
  atkMult: number; hpMult: number; defMult: number;
  critRateBonus: number; critDmgBonus: number;
  energyBonus: number; lifesteal: number; elemDmgBonus: number;
}
export function compositePassives(effects: AbilityEffect[]): PassiveMods {
  const m: PassiveMods = { atkMult: 1, hpMult: 1, defMult: 1, critRateBonus: 0, critDmgBonus: 0, energyBonus: 0, lifesteal: 0, elemDmgBonus: 0 };
  for (const e of effects) {
    switch (e.type) {
      case "ATK_BOOST":      m.atkMult       *= (1 + e.value); break;
      case "HP_BOOST":       m.hpMult        *= (1 + e.value); break;
      case "DEF_BOOST":      m.defMult       *= (1 + e.value); break;
      case "CRIT_RATE":      m.critRateBonus += e.value;       break;
      case "CRIT_DMG":       m.critDmgBonus  += e.value;       break;
      case "LIFESTEAL":      m.lifesteal     += e.value;       break;
      case "ENERGY_BOOST":   m.energyBonus   += e.value;       break;
      case "ELEM_DMG_BOOST": m.elemDmgBonus  += e.value;       break;
    }
  }
  return m;
}

export function formatEffects(effects: AbilityEffect[]): string {
  if (!effects.length) return "";
  return effects.map(e => `${ABILITY_REGISTRY[e.type]?.label ?? e.type}: ${formatAbilityEffect(e.type, e.value)}`).join("\n");
}

// ── Element-themed composite fallback (offline AI) + legacy migration ─────────
const ELEMENT_KIT: Record<string, AbilityEffect[]> = {
  FUSION:  [{ type: "EXECUTE", value: 0.45 }, { type: "CRIT_DMG", value: 0.22 }],
  GLACIO:  [{ type: "DEF_BOOST", value: 0.16 }, { type: "SECOND_WIND", value: 1 }],
  ELECTRO: [{ type: "ESCALATION", value: 0.10 }, { type: "ENERGY_BOOST", value: 12 }],
  AERO:    [{ type: "FIRST_STRIKE", value: 0.55 }, { type: "CRIT_RATE", value: 0.09 }],
  HAVOC:   [{ type: "BERSERK", value: 0.42 }, { type: "LIFESTEAL", value: 0.08 }],
  SPECTRO: [{ type: "HEAL_ON_CRIT", value: 0.12 }, { type: "FULL_HP_DMG", value: 0.18 }],
  NONE:    [{ type: "ATK_BOOST", value: 0.12 }, { type: "CRIT_RATE", value: 0.07 }],
};

// Pool for the deterministic 3rd primitive — varies per player via userId hash.
const THIRD_POOL = [
  "ATK_BOOST", "CRIT_DMG", "LIFESTEAL", "VIB_BREAKER",
  "CRIT_MOMENTUM", "ELEM_DMG_BOOST", "FULL_HP_DMG", "ENERGY_BOOST",
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// Build a composite for offline gen / legacy migration. Seeded by userId so even
// same-element players differ. Keeps it to 3 distinct primitives.
export function composeFallbackEffects(element: string, userId: string): AbilityEffect[] {
  const kit = (ELEMENT_KIT[element] ?? ELEMENT_KIT.NONE).map(e => ({ ...e }));
  const used = new Set(kit.map(e => e.type));
  const h = hashStr(userId);
  // Pick a 3rd primitive deterministically
  for (let i = 0; i < THIRD_POOL.length; i++) {
    const cand = THIRD_POOL[(h + i) % THIRD_POOL.length];
    if (!used.has(cand)) {
      const def = ABILITY_REGISTRY[cand];
      // Value: pick within range, varied by hash
      const t = ((h >> 3) % 100) / 100;
      const val = def.isPct ? +(def.min + (def.max - def.min) * t).toFixed(3) : Math.round(def.min + (def.max - def.min) * t);
      kit.push({ type: cand, value: val });
      break;
    }
  }
  return kit;
}

// Convert a legacy single-type ability into a composite, keeping its core effect.
export function legacyToComposite(oldType: string | null, oldValue: number | null, element: string, userId: string): AbilityEffect[] {
  const base = composeFallbackEffects(element, userId);
  if (oldType && ABILITY_REGISTRY[oldType]) {
    // Preserve the player's original mechanic as the lead primitive
    const lead: AbilityEffect = { type: oldType, value: clampEffectValue(oldType, oldValue ?? ABILITY_REGISTRY[oldType].min) };
    const rest = base.filter(e => e.type !== oldType).slice(0, 2);
    return [lead, ...rest];
  }
  return base;
}
