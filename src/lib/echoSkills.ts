import { NamedSetId } from "./namedSets";

// ── Echo Skill — a 4th attack move granted by whichever echo sits in the
// Main slot (slot 0). 4-cost (boss) echoes each get a genuinely distinct
// mechanic; 1/3-cost echoes get a simple element-flavored bonus-damage move.
// Own cooldown, independent of the Resonance Skill's.

export type EchoSkillDef =
  | { kind: "EXECUTE_PCT";      name: string; pct: number }                    // bonus dmg = pct * enemy's CURRENT hp
  | { kind: "SHIELD";           name: string; healPct: number }                // instant flat heal = healPct * maxHp
  | { kind: "VIB_DRAIN";        name: string; vibPct: number }                 // extra vib-bar drain on top of normal
  | { kind: "ENERGY_SCALE_DMG"; name: string }                                 // dmg scales up with current energy
  | { kind: "TURN_SCALE_DMG";   name: string }                                 // dmg scales up with turns elapsed
  | { kind: "HEAL_THEN_HIT";    name: string; healPct: number; dmgPerHeal: number } // heal, then bonus dmg = healed * dmgPerHeal
  | { kind: "GUARANTEED_CRIT";  name: string }
  | { kind: "DOUBLE_HIT";       name: string }
  | { kind: "RESET_CD_ON_CRIT"; name: string }                                 // if this hit crits, echo skill CD resets to 0
  | { kind: "BERSERK_SELF_HP";  name: string }                                 // bonus dmg scales with YOUR missing HP%
  | { kind: "DEF_SHRED";        name: string; pct: number; turns: number }     // enemy DEF reduced for N turns
  | { kind: "FULL_ENERGY";      name: string }                                 // no damage — energy set to 100
  | { kind: "ARM_NEXT_CRIT";    name: string }                                 // next attack (any type) is guaranteed crit
  | { kind: "FLAT_LIFESTEAL";   name: string; pct: number }                    // extra flat lifesteal, on top of normal
  | { kind: "NAMED_SET_TRIGGER";name: string; setId: NamedSetId }              // instantly triggers that set's signature mechanic
  | { kind: "PLAIN";            name: string };                                // generic 1/3-cost fallback

// ── 21 bespoke 4-cost (boss) echo skills, keyed by echo name ────────────────
export const BOSS_ECHO_SKILLS: Record<string, EchoSkillDef> = {
  // WL bosses
  "Resonant Wraith":      { kind: "EXECUTE_PCT",      name: "Wraith's Grasp",      pct: 0.15 },
  "Tidecaller Sovereign":  { kind: "SHIELD",           name: "Tidal Ward",          healPct: 0.15 },
  "Fractured Arbiter":     { kind: "VIB_DRAIN",        name: "Fracture Pulse",      vibPct: 0.15 },
  "Nullfire Construct":    { kind: "ENERGY_SCALE_DMG", name: "Overload Discharge" },
  "Sable Harbinger":       { kind: "TURN_SCALE_DMG",   name: "Harbinger's Toll" },
  "Auric Colossus":        { kind: "HEAL_THEN_HIT",    name: "Aureate Bulwark",     healPct: 0.15, dmgPerHeal: 0.5 },
  "Embercrown Tyrant":     { kind: "GUARANTEED_CRIT",  name: "Tyrant's Wrath" },
  "Galeborne Phantom":     { kind: "DOUBLE_HIT",       name: "Phantom Rush" },
  "Resonant Absolute":     { kind: "RESET_CD_ON_CRIT", name: "Absolute Resonance" },
  // Original field bosses
  "Ignis Behemoth":        { kind: "BERSERK_SELF_HP",  name: "Molten Core" },
  "Permafrost Sovereign":  { kind: "DEF_SHRED",        name: "Absolute Zero",       pct: 0.20, turns: 2 },
  "Voltaic Aberrant":      { kind: "FULL_ENERGY",      name: "Aberrant Surge" },
  "Tempest Ancient":       { kind: "ARM_NEXT_CRIT",    name: "Ancient Gale" },
  "Null Ravager":          { kind: "FLAT_LIFESTEAL",   name: "Ravager's Bite",      pct: 0.30 },
  "Luminal Specter":       { kind: "SHIELD",           name: "Luminal Veil",        healPct: 0.15 },
  // Named-set field bosses — instant-trigger their own set's signature mechanic
  "Cinderbound Colossus":  { kind: "NAMED_SET_TRIGGER",name: "Colossal Ignition",   setId: "SMOLDERING_SOVEREIGN" },
  "Cryoveil Warden":       { kind: "NAMED_SET_TRIGGER",name: "Warden's Bulwark",    setId: "FROSTVEIL_BASTION" },
  "Thundercrown Herald":   { kind: "NAMED_SET_TRIGGER",name: "Heraldic Surge",      setId: "STORMCALLERS_OATH" },
  "Galebound Sovereign":   { kind: "NAMED_SET_TRIGGER",name: "Sovereign's Wind",    setId: "WINDSTRIDERS_LEGACY" },
  "Voidmaw Devourer":      { kind: "NAMED_SET_TRIGGER",name: "Devourer's Hunger",   setId: "VOIDBORN_REMNANT" },
  "Lumenwrought Seraph":   { kind: "NAMED_SET_TRIGGER",name: "Seraphic Grace",      setId: "RADIANT_CONVERGENCE" },
};

const GENERIC_SKILL_NAME: Record<string, string> = {
  FUSION:  "Ember Lash",
  GLACIO:  "Frost Bite",
  ELECTRO: "Static Jolt",
  AERO:    "Gale Cutter",
  HAVOC:   "Void Nip",
  SPECTRO: "Radiant Spark",
};

/** Returns the EchoSkillDef for whichever echo occupies the Main slot, or null if empty/unrecognized. */
export function getEchoSkillDef(mainEcho: { name: string; cost: number } | null): EchoSkillDef | null {
  if (!mainEcho) return null;
  if (mainEcho.cost === 4) return BOSS_ECHO_SKILLS[mainEcho.name] ?? { kind: "PLAIN", name: mainEcho.name };
  return null; // 1/3-cost handled by genericEchoSkill(), which needs the element too
}

export function genericEchoSkill(element: string): EchoSkillDef {
  return { kind: "PLAIN", name: GENERIC_SKILL_NAME[element] ?? "Echo Strike" };
}

const ECHO_SKILL_BASE_MULT = 2.2; // between Skill (1.8x) and Ultimate (3.5x)

export interface EchoSkillCtx {
  atk: number;
  enemyHp: number;
  enemyHpMax: number;
  playerHp: number;
  playerHpMax: number;
  playerEnergy: number;
  turn: number;
  bossVibMax: number;
  crit: boolean;
}

export interface EchoSkillResult {
  dmgMult: number;         // multiplier applied on top of the base echo-skill hit
  healHp: number;
  bonusEnergy: number;
  forceCrit: boolean;
  doubleHit: boolean;
  armsNextCrit: boolean;
  defShredPct: number;
  defShredTurns: number;
  extraVibDrain: number;
  resetCdOnCrit: boolean;
  noDamage: boolean;
  setEnergyFull: boolean;
  tag: string;
}

/** Base echo-skill damage multiplier — the shared "how hard does the base hit land" for all skills. */
export function echoSkillBaseMult(): number { return ECHO_SKILL_BASE_MULT; }

export function applyEchoSkill(def: EchoSkillDef, ctx: EchoSkillCtx): EchoSkillResult {
  const r: EchoSkillResult = {
    dmgMult: 1, healHp: 0, bonusEnergy: 0, forceCrit: false, doubleHit: false,
    armsNextCrit: false, defShredPct: 0, defShredTurns: 0, extraVibDrain: 0,
    resetCdOnCrit: false, noDamage: false, setEnergyFull: false, tag: def.name,
  };

  switch (def.kind) {
    case "EXECUTE_PCT":
      r.dmgMult = 1 + def.pct;
      break;
    case "SHIELD":
      r.healHp = Math.floor(ctx.playerHpMax * def.healPct);
      break;
    case "VIB_DRAIN":
      r.extraVibDrain = Math.floor(ctx.bossVibMax * def.vibPct);
      break;
    case "ENERGY_SCALE_DMG":
      r.dmgMult = 1 + ctx.playerEnergy / 200;
      break;
    case "TURN_SCALE_DMG":
      r.dmgMult = 1 + Math.min(1.0, ctx.turn * 0.05);
      break;
    case "HEAL_THEN_HIT": {
      const healed = Math.floor(ctx.playerHpMax * def.healPct);
      r.healHp = healed;
      r.dmgMult = 1 + (healed * def.dmgPerHeal) / Math.max(1, ctx.atk * ECHO_SKILL_BASE_MULT);
      break;
    }
    case "GUARANTEED_CRIT":
      r.forceCrit = true;
      break;
    case "DOUBLE_HIT":
      r.doubleHit = true;
      break;
    case "RESET_CD_ON_CRIT":
      r.resetCdOnCrit = true;
      break;
    case "BERSERK_SELF_HP": {
      const missingPct = 1 - ctx.playerHp / ctx.playerHpMax;
      r.dmgMult = 1 + missingPct * 0.8; // up to +80% bonus at 1 HP
      break;
    }
    case "DEF_SHRED":
      r.defShredPct = def.pct;
      r.defShredTurns = def.turns;
      break;
    case "FULL_ENERGY":
      r.noDamage = true;
      r.setEnergyFull = true;
      break;
    case "ARM_NEXT_CRIT":
      r.armsNextCrit = true;
      break;
    case "FLAT_LIFESTEAL":
      // caller adds def.pct * damage-dealt to heal — handled by caller since damage isn't known yet
      break;
    case "NAMED_SET_TRIGGER":
      // caller handles the actual set-mechanic trigger — this def just carries the setId
      break;
    case "PLAIN":
      r.dmgMult = 1;
      break;
  }
  return r;
}
