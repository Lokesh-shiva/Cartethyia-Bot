// ── Lv60 Ego Weapon Awakening ─────────────────────────────────────────────────
// The player's equipped weapon TRANSFORMS: new AI-generated name, lore, art,
// boosted baseAtk (×mult), and FULLY RE-ROLLED substats chosen by AI to fit the
// player's element + evolved ability. Values are set from rarity-scaled tables,
// not old×mult — awakening is an identity change, not a percentage bump.
// Gacha rarity = ceiling (5★ > 4★ > 3★). Deterministic fallback if AI offline.

import prisma from "./prisma";
import { askAI } from "./ai";
import { ABILITY_REGISTRY, AbilityEffect, sanitizeEffects, formatEffects } from "./abilityEffects";
import { sanitizeV2Effects, formatV2Effects } from "./abilityEngineV2";
import { WEAPON_PASSIVES, WeaponPassive } from "./weapons";
import { derivePersonality, deriveBonds, deriveCombat, deriveDedication } from "./uniqueAbility";

export const EGO_LEVEL_REQUIRED = 60;
export const EGO_COST = { forgingOres: 20, paradoxCores: 8, credits: 20000 };

// Rarity ceiling multiplier — applied to baseAtk ONLY. Substats are now re-rolled fresh.
export const AWAKEN_STAT_MULT: Record<number, number> = { 1: 1.12, 2: 1.12, 3: 1.15, 4: 1.20, 5: 1.25 };

// ── Awakened substat value tables ─────────────────────────────────────────────
// All awakened weapons get 3 substats (subStat + 2 hidden), regardless of origin.
// Values represent the "at bond 10" value for the main substat (stored directly, no
// level scaling). Hidden subs are stored as base values; they scale ×1.8 at Lv90.
// Index: [3★, 4★, 5★] — rarity 1-2 treated as 3★.
const AWAKEN_SUB_VAL: Record<string, [number, number, number]> = {
  CRIT_RATE:    [16, 20, 24],
  CRIT_DMG:     [24, 30, 36],
  ATK_PERCENT:  [14, 18, 22],
  HP_PERCENT:   [18, 22, 26],
  DEF_PERCENT:  [18, 22, 26],
  ELEMENTAL_DMG:[20, 24, 28],
  ENERGY_REGEN: [24, 30, 36],
};

const AWAKEN_HIDDEN_BASE: Record<string, [number, number, number]> = {
  CRIT_RATE:    [8,  10, 12],
  CRIT_DMG:     [12, 15, 18],
  ATK_PERCENT:  [8,  10, 12],
  HP_PERCENT:   [10, 12, 14],
  DEF_PERCENT:  [10, 12, 14],
  ELEMENTAL_DMG:[9,  11, 13],
  ENERGY_REGEN: [14, 17, 20],
};

const VALID_SUB_TYPES = new Set([
  "CRIT_RATE", "CRIT_DMG", "ATK_PERCENT",
  "HP_PERCENT", "DEF_PERCENT", "ELEMENTAL_DMG", "ENERGY_REGEN",
]);
const ALL_SUB_TYPES = [
  "CRIT_RATE", "CRIT_DMG", "ATK_PERCENT", "ELEMENTAL_DMG",
  "HP_PERCENT", "DEF_PERCENT", "ENERGY_REGEN",
];

// Element-specific fallback substat picks: [subStatType, hiddenSub1Type, hiddenSub2Type]
const EGO_SUBSTAT_CHOICES: Record<string, [string, string, string]> = {
  FUSION:  ["CRIT_DMG",     "ATK_PERCENT",  "CRIT_RATE"],
  GLACIO:  ["HP_PERCENT",   "DEF_PERCENT",  "ELEMENTAL_DMG"],
  ELECTRO: ["ENERGY_REGEN", "CRIT_DMG",     "CRIT_RATE"],
  AERO:    ["CRIT_RATE",    "CRIT_DMG",     "ATK_PERCENT"],
  HAVOC:   ["ATK_PERCENT",  "CRIT_DMG",     "ELEMENTAL_DMG"],
  SPECTRO: ["HP_PERCENT",   "ELEMENTAL_DMG","CRIT_RATE"],
  NONE:    ["ATK_PERCENT",  "CRIT_DMG",     "CRIT_RATE"],
};

// Labels for display in the awaken embed
export const SUB_LABELS: Record<string, string> = {
  CRIT_RATE:    "Crit Rate",
  CRIT_DMG:     "Crit DMG",
  ATK_PERCENT:  "ATK%",
  HP_PERCENT:   "HP%",
  DEF_PERCENT:  "DEF%",
  ELEMENTAL_DMG:"Elem DMG",
  ENERGY_REGEN: "Energy Regen",
};

function rarityIdx(r: number): number { return Math.max(0, Math.min(2, r - 3)); }

export function awakenSubVal(type: string, rarity: number): number {
  return (AWAKEN_SUB_VAL[type] ?? AWAKEN_SUB_VAL.ATK_PERCENT)[rarityIdx(rarity)];
}

export function awakenHiddenBase(type: string, rarity: number): number {
  return (AWAKEN_HIDDEN_BASE[type] ?? AWAKEN_HIDDEN_BASE.ATK_PERCENT)[rarityIdx(rarity)];
}

// Ensures 3 distinct valid substat types, falling back to pool order if AI gives bad/duplicate values.
function resolveSubTypes(s: string, h1: string, h2: string): [string, string, string] {
  const used = new Set<string>();
  const pick = (preferred: string): string => {
    if (VALID_SUB_TYPES.has(preferred) && !used.has(preferred)) { used.add(preferred); return preferred; }
    for (const t of ALL_SUB_TYPES) { if (!used.has(t)) { used.add(t); return t; } }
    return "ATK_PERCENT";
  };
  return [pick(s), pick(h1), pick(h2)];
}

// Existing passive effects are amplified by this on awakening (capped at 1.3× registry max).
const PASSIVE_AMP = 1.25;

export interface AwakenedPassive {
  desc:     string;             // display text for the awakened passive
  elemDmg?: number;
  effects:  AbilityEffect[];
}

// ── Deterministic fallbacks per element ───────────────────────────────────────
const EGO_EPITHET: Record<string, string> = {
  FUSION: "Pyrclast", GLACIO: "Permafrost", ELECTRO: "Stormvein",
  AERO: "Galecarver", HAVOC: "Nightmaw", SPECTRO: "Dawnforged", NONE: "Egoborne",
};

const EGO_LORE_LINE: Record<string, string> = {
  FUSION:  "The blade drank its wielder's fire and woke screaming for more.",
  GLACIO:  "In the wielder's patience the steel found its own stillness — and sharpened it.",
  ELECTRO: "It hums now, even sheathed. It remembers every strike and demands the next.",
  AERO:    "Weightless in the hand, restless in the soul — the weapon now moves first.",
  HAVOC:   "Something looked back from inside the steel. It wore its wielder's grin.",
  SPECTRO: "The weapon learned the light its wielder carried, and swore to carry it further.",
  NONE:    "The weapon woke, and knew its wielder's name.",
};

// New awakened effect pool per element (used by fallback; AI picks freely).
const EGO_EFFECT_POOL: Record<string, string[]> = {
  FUSION:  ["ULT_POWER", "EXECUTE", "CRIT_DMG"],
  GLACIO:  ["SECOND_WIND", "DEF_BOOST", "FULL_HP_DMG"],
  ELECTRO: ["CRIT_MOMENTUM", "ESCALATION", "ENERGY_BOOST"],
  AERO:    ["FIRST_STRIKE", "CRIT_RATE", "VIB_BREAKER"],
  HAVOC:   ["BERSERK", "LIFESTEAL", "LOW_HP_CRIT"],
  SPECTRO: ["HEAL_ON_CRIT", "HP_BOOST", "ELEM_DMG_BOOST"],
  NONE:    ["ATK_BOOST", "CRIT_DMG", "SKILL_POWER"],
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// Rarity positions the new effect's value within its registry range.
function effectValueForRarity(type: string, rarity: number): number {
  const def = ABILITY_REGISTRY[type];
  const t   = rarity >= 5 ? 1.0 : rarity === 4 ? 0.75 : 0.5;
  const v   = def.min + (def.max - def.min) * t;
  return def.isPct ? +v.toFixed(3) : Math.round(v);
}

// Amplify the weapon's existing passive (if any) and append the new awakened effect.
export function buildAwakenedPassive(
  weaponName: string, rarity: number, newEffect: AbilityEffect, desc: string,
): AwakenedPassive {
  const base: WeaponPassive = WEAPON_PASSIVES[weaponName] ?? {};
  const effects: AbilityEffect[] = (base.effects ?? []).map(e => {
    const def = ABILITY_REGISTRY[e.type];
    if (!def) return { ...e };
    const cap = def.max * 1.3;
    const v   = Math.min(cap, e.value * PASSIVE_AMP);
    return { type: e.type, value: def.isPct ? +v.toFixed(3) : Math.round(v) };
  });
  if (!effects.some(e => e.type === newEffect.type)) effects.push(newEffect);
  return {
    desc,
    ...(base.elemDmg ? { elemDmg: +(base.elemDmg * PASSIVE_AMP).toFixed(3) } : {}),
    effects,
  };
}

function fallbackNewEffect(element: string, rarity: number, weaponName: string, userId: string): AbilityEffect {
  const owned = new Set((WEAPON_PASSIVES[weaponName]?.effects ?? []).map(e => e.type));
  const pool  = EGO_EFFECT_POOL[element] ?? EGO_EFFECT_POOL.NONE;
  const h     = hashStr(userId + weaponName);
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(h + i) % pool.length];
    if (!owned.has(cand)) return { type: cand, value: effectValueForRarity(cand, rarity) };
  }
  return { type: "ATK_BOOST", value: effectValueForRarity("ATK_BOOST", rarity) };
}

const ELEMENT_ART_LANGUAGE: Record<string, string> = {
  FUSION:  "volcanic magma veins, orange-red fire cracks, molten metal dripping, intense heat shimmer, ember sparks swirling",
  GLACIO:  "crystalline ice fractals, deep blue frost runes, frozen tundra shards orbiting, sub-zero aurora shimmer",
  ELECTRO: "crackling violet lightning arcs, neon purple plasma threads, static discharge halos, electric sigil matrices",
  AERO:    "spiraling wind currents, translucent jade-green air slashes, feather-light debris orbiting, tornado eye calm center",
  HAVOC:   "void-black fractures splitting reality, deep crimson entropy waves, shattered dimensional glass, gravitational distortion",
  SPECTRO: "golden radiance bursting from the core, spectral white light trails, soft lens-flare halos, prismatic refraction",
  NONE:    "silver resonance energy, white-blue arcane sigils, neutral cosmic shimmer",
};

const WEAPON_TYPE_ART: Record<string, string> = {
  BROADBLADE: "massive two-handed blade, wide serrated edge, heavy dark metal, imposing silhouette",
  SWORD:      "elegant longsword, razor-thin edge, ornate crossguard, balanced and deadly",
  PISTOLS:    "twin enchanted pistols, rune-etched barrels, crystalline chambers, floating muzzle-flare",
  RECTIFIER:  "arcane focus catalyst, orbiting resonance crystals, channeling rod, ethereal resonance disk",
};

function fallbackArtPrompt(weaponName: string, weaponType: string, element: string, egoName: string): string {
  const elemVfx  = ELEMENT_ART_LANGUAGE[element.toUpperCase()] ?? ELEMENT_ART_LANGUAGE.NONE;
  const typeDesc = WEAPON_TYPE_ART[weaponType.toUpperCase()] ?? "weapon";
  return [
    `Anime fantasy weapon concept art of "${egoName}", the awakened soul of "${weaponName}".`,
    `${typeDesc}, forged from ${element.toLowerCase()} resonance — ${elemVfx}.`,
    `The weapon hovers centered in frame, radiating awakened energy, surrounded by orbiting runic fragments and elemental particles.`,
    `Dark cosmic void background peppered with stars and dimensional rift light; dramatic rim-lighting; ultra-detailed metalwork and glowing inscriptions.`,
    `Wuthering Waves / Honkai Star Rail aesthetic, cinematic composition, no humans, no text, weapon fills 70% of frame, 1:1 ratio.`,
  ].join(" ");
}

// ── Main generation ───────────────────────────────────────────────────────────
export interface AwakeningResult {
  name:           string;
  lore:           string;
  artPrompt:      string;
  passive:        AwakenedPassive;
  subStatType:    string;
  hiddenSub1Type: string;
  hiddenSub2Type: string;
}

export async function generateAwakening(userId: string): Promise<AwakeningResult | null> {
  const [user, bonds, weapon] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: {
        element: true, level: true, worldLevel: true, dailyStreak: true,
        uniqueAbilityName: true, uniqueAbilityEffect: true, uniqueAbilityLore: true,
        uniqueAbilityEffects: true, abilityEvolved: true, abilityVersion: true,
        resonanceProfile: true,
        duelWins: true, duelLosses: true, encountersWon: true, raidWins: true,
        dungeonClears: true, ascensionWins: true,
      },
    }),
    prisma.bond.findMany({
      where:  { OR: [{ initiatorId: userId }, { receiverId: userId }] },
      select: { bondType: true },
    }),
    prisma.weapon.findFirst({
      where:  { userId, isEquipped: true },
      select: { name: true, weaponType: true, rarity: true, level: true, subStatType: true, hiddenSub1Type: true, hiddenSub2Type: true },
    }),
  ]);
  if (!user || !weapon) return null;

  const element = (user.element as string) ?? "NONE";
  const epithet = EGO_EPITHET[element] ?? EGO_EPITHET.NONE;

  const fbEffect  = fallbackNewEffect(element, weapon.rarity, weapon.name, userId);
  const fbDesc    = `Awakened: ${formatEffects([fbEffect])}`;
  const fbSubtypes = EGO_SUBSTAT_CHOICES[element] ?? EGO_SUBSTAT_CHOICES.NONE;
  const fallback: AwakeningResult = {
    name:           `${epithet} ${weapon.name}`,
    lore:           EGO_LORE_LINE[element] ?? EGO_LORE_LINE.NONE,
    artPrompt:      fallbackArtPrompt(weapon.name, weapon.weaponType, element, `${epithet} ${weapon.name}`),
    passive:        buildAwakenedPassive(weapon.name, weapon.rarity, fbEffect, fbDesc),
    subStatType:    fbSubtypes[0],
    hiddenSub1Type: fbSubtypes[1],
    hiddenSub2Type: fbSubtypes[2],
  };

  const basePassive = WEAPON_PASSIVES[weapon.name];
  const owned   = new Set((basePassive?.effects ?? []).map(e => e.type));
  const choices = Object.entries(ABILITY_REGISTRY)
    .filter(([k]) => !owned.has(k))
    .map(([k, def]) => `${k} (${def.desc.replace("{v}", "X")}; value ${def.min}–${def.max})`)
    .join(", ");

  const abilityMechanics = user.abilityVersion === 2
    ? formatV2Effects(sanitizeV2Effects(user.uniqueAbilityEffects)).replace(/\*\*/g, "").replace(/\*([^*]+)\*/g, "$1").replace(/\n/g, " | ")
    : formatEffects(sanitizeEffects(user.uniqueAbilityEffects, user.abilityEvolved)).replace(/\n/g, " | ");

  const systemPrompt = [
    `You are the lore engine for CARTETHYIA — a Wuthering Waves-inspired anime social RPG with a dark, poetic aesthetic.`,
    `A player's WEAPON is AWAKENING into its Ego form at Level 60 — the weapon develops a soul shaped by its wielder. It TRANSFORMS: new name, new identity, new substats chosen for THIS wielder.`,
    ``,
    `Rules:`,
    `- NAME: 2-4 words, title-case. Awakened soul of the original weapon — grander, alive. Do not reuse the original name verbatim.`,
    `- LORE: 1-2 sentences, poetic, no numbers. The weapon waking, shaped by its wielder.`,
    `- ART_PROMPT: rich image-generation prompt (4-6 sentences). Include: weapon type and silhouette, specific ${element.toLowerCase()} elemental visual effects (glowing cracks, particle effects, energy aura), material and surface details (runes, engravings, metalwork), background environment (dark cosmic void, stars, dimensional rifts, element-themed atmosphere), lighting style (rim light, bloom, dramatic shadows), anime fantasy aesthetic. No humans, no text, weapon centered, cinematic composition.`,
    `- DESC: 1 sentence describing the awakened passive in flavourful but concrete terms.`,
    `- NEW_EFFECT: one object {type, value} — the newly awakened power. type MUST be from this list, value within range:`,
    choices,
    `- Choose NEW_EFFECT to synergize with the wielder's evolved ability and how they actually fight.`,
    ``,
    `- SUBSTATS: The awakened weapon gains 3 all-new substats shaped by the wielder — choose from: CRIT_RATE, CRIT_DMG, ATK_PERCENT, HP_PERCENT, DEF_PERCENT, ELEMENTAL_DMG, ENERGY_REGEN. All three must be DIFFERENT. Choose to match the wielder's element and how their ability actually works (e.g. crit-heavy ability → CRIT_RATE + CRIT_DMG; energy/ult build → ENERGY_REGEN + ATK_PERCENT; survival build → HP_PERCENT + DEF_PERCENT).`,
    ``,
    `Respond ONLY with valid JSON, no other text:`,
    `{"name":"...","lore":"...","artPrompt":"...","desc":"...","newEffect":{"type":"EXECUTE","value":0.5},"subStatType":"CRIT_DMG","hiddenSub1Type":"ATK_PERCENT","hiddenSub2Type":"CRIT_RATE"}`,
  ].join("\n");

  const userPrompt = [
    `WEAPON: "${weapon.name}" — ${weapon.weaponType}, ${weapon.rarity}★, Lv${weapon.level}, substat ${weapon.subStatType ?? "none"}${weapon.hiddenSub1Type ? `, hidden: ${weapon.hiddenSub1Type}${weapon.hiddenSub2Type ? " + " + weapon.hiddenSub2Type : ""}` : ""}.`,
    `Current weapon passive: ${basePassive?.effects ? formatEffects(basePassive.effects as AbilityEffect[]).replace(/\n/g, " | ") : basePassive?.elemDmg ? `+${Math.round(basePassive.elemDmg * 100)}% Elemental DMG` : "none (this awakening grants its first)"}.`,
    ``,
    `WIELDER — Element: ${element}.`,
    `Evolved unique ability: "${user.uniqueAbilityName}" — ${user.uniqueAbilityEffect} (mechanics: ${abilityMechanics})`,
    `Personality: ${derivePersonality(user.resonanceProfile)}.`,
    `Bonds: ${deriveBonds(bonds)}.`,
    `Combat history: ${deriveCombat(user.duelWins, user.duelLosses, user.encountersWon, user.raidWins)}; ${user.dungeonClears} dungeons, ${user.ascensionWins} ascensions.`,
    `Dedication: ${deriveDedication(user.dailyStreak, user.worldLevel, user.level)}.`,
    ``,
    `Awaken the weapon. Its new name and soul must feel forged from this exact wielder.`,
  ].join("\n");

  const raw = await askAI({ systemPrompt, userPrompt, maxTokens: 1000 });
  if (!raw) return fallback;

  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed  = JSON.parse(cleaned);
    if (!parsed.name || !parsed.lore) return fallback;

    // Validate the AI's new passive effect
    let newEffect = fbEffect;
    const valid = sanitizeEffects([parsed.newEffect]).filter(e => !owned.has(e.type));
    if (valid.length > 0) {
      const capped = Math.min(valid[0].value, effectValueForRarity(valid[0].type, weapon.rarity));
      newEffect = { type: valid[0].type, value: capped };
    }
    const desc = parsed.desc ? String(parsed.desc).slice(0, 200) : fbDesc;

    // Validate and deduplicate AI-chosen substat types
    const [subStatType, hiddenSub1Type, hiddenSub2Type] = resolveSubTypes(
      parsed.subStatType    ?? fbSubtypes[0],
      parsed.hiddenSub1Type ?? fbSubtypes[1],
      parsed.hiddenSub2Type ?? fbSubtypes[2],
    );

    return {
      name:           String(parsed.name).slice(0, 48),
      lore:           String(parsed.lore).slice(0, 300),
      artPrompt:      parsed.artPrompt ? String(parsed.artPrompt).slice(0, 800) : fallback.artPrompt,
      passive:        buildAwakenedPassive(weapon.name, weapon.rarity, newEffect, desc),
      subStatType,
      hiddenSub1Type,
      hiddenSub2Type,
    };
  } catch {
    return fallback;
  }
}

// ── Art prompt regeneration ───────────────────────────────────────────────────
// Regenerates ONLY the awakenedArtPrompt for an already-awakened weapon.
// Keeps name/lore/passive untouched.
export async function regenerateArtPrompt(userId: string): Promise<string | null> {
  const [user, weapon] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { element: true } }),
    prisma.weapon.findFirst({
      where:  { userId, isEquipped: true, awakened: true },
      select: { id: true, name: true, weaponType: true, rarity: true, awakenedName: true },
    }),
  ]);
  if (!user || !weapon) return null;

  const element  = (user.element as string) ?? "NONE";
  const egoName  = weapon.awakenedName ?? weapon.name;
  const fallback = fallbackArtPrompt(weapon.name, weapon.weaponType, element, egoName);

  const elemVfx  = ELEMENT_ART_LANGUAGE[element.toUpperCase()] ?? ELEMENT_ART_LANGUAGE.NONE;
  const typeDesc = WEAPON_TYPE_ART[weapon.weaponType.toUpperCase()] ?? "weapon";

  const systemPrompt = `You are a concept art prompt writer for an anime fantasy RPG in the style of Wuthering Waves. Write ONLY a detailed image-generation prompt — no other text.`;
  const userPrompt   = [
    `Write a rich art prompt (4-6 sentences) for an awakened weapon called "${egoName}" (original: "${weapon.name}"), ${weapon.rarity}★ ${weapon.weaponType.toLowerCase()}.`,
    `Visual elements to include: ${typeDesc}. ${element.toLowerCase()} elemental energy — ${elemVfx}.`,
    `The weapon hovers centered in frame. Dark cosmic void background with stars and dimensional rifts.`,
    `Include: detailed metalwork/inscriptions, dramatic rim-lighting, particle effects, elemental aura. Wuthering Waves / Honkai Star Rail aesthetic. No humans, no text.`,
  ].join(" ");

  const raw = await askAI({ systemPrompt, userPrompt, maxTokens: 400 });
  const prompt = raw?.trim() || fallback;

  await prisma.weapon.update({ where: { id: weapon.id }, data: { awakenedArtPrompt: prompt } });
  return prompt;
}

// ── Display helper ────────────────────────────────────────────────────────────
// Builds the full passive string for display: desc + each named effect on its
// own line. Used by weapon card, /weapons, /equip, /weapon so they all match.
export function formatAwakenedPassive(ap: any): string {
  if (!ap) return "";
  const lines: string[] = [];
  if (ap.desc) lines.push(ap.desc);
  if (ap.elemDmg) lines.push(`+${Math.round(Number(ap.elemDmg) * 100)}% Elemental DMG`);
  if (Array.isArray(ap.effects)) {
    for (const e of ap.effects) {
      const def = (ABILITY_REGISTRY as any)[e.type];
      if (!def) continue;
      const valStr = def.isPct ? `${Math.round(e.value * 100)}%` : String(e.value);
      lines.push(`${def.label}: ${def.desc.replace("{v}", valStr)}`);
    }
  }
  return lines.join("\n");
}

// ── Weapon Bond ───────────────────────────────────────────────────────────────
// Awakened weapons start at 80% power (bond 0) and grow to 100% at bond 10.
// Bond increments on boss/dungeon/field-boss wins when weapon is equipped.
export const BOND_MAX = 10;
export const BOND_MILESTONES: Record<number, string> = {
  1:  "Awakening",
  5:  "Resonance",
  10: "Synchrony",
};

export function bondMultiplier(bond: number): number {
  return 0.80 + Math.min(BOND_MAX, Math.max(0, bond)) * 0.02;
}

export async function incrementWeaponBond(userId: string): Promise<{ bond: number; milestone: string | null } | null> {
  const weapon = await prisma.weapon.findFirst({
    where:  { userId, isEquipped: true, awakened: true },
    select: { id: true, weaponBond: true },
  });
  if (!weapon || weapon.weaponBond >= BOND_MAX) return null;

  const newBond = weapon.weaponBond + 1;
  await prisma.weapon.update({ where: { id: weapon.id }, data: { weaponBond: newBond } });
  return { bond: newBond, milestone: BOND_MILESTONES[newBond] ?? null };
}
