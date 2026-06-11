// ── Lv60 Ego Weapon Awakening ─────────────────────────────────────────────────
// The player's equipped weapon TRANSFORMS (not replaced): new AI-generated name,
// lore, art prompt, boosted stats (ATK + substat + hidden substats) and an
// awakened passive. Gacha rarity = awakening ceiling (5★ > 4★ > 3★).
// AI uses the full player picture incl. the EVOLVED unique ability; deterministic
// fallback if LM Studio is offline. Art: drop a PNG at
// assets/weapons/awakened/{awakenedName}.png and the card picks it up.

import prisma from "./prisma";
import { askAI } from "./ai";
import { ABILITY_REGISTRY, AbilityEffect, sanitizeEffects, formatEffects } from "./abilityEffects";
import { WEAPON_PASSIVES, WeaponPassive } from "./weapons";
import { derivePersonality, deriveBonds, deriveCombat, deriveDedication } from "./uniqueAbility";

export const EGO_LEVEL_REQUIRED = 60;
export const EGO_COST = { forgingOres: 20, paradoxCores: 8, credits: 20000 };

// Rarity = awakening ceiling: stat multiplier applied to baseAtk, substat, hidden substats.
export const AWAKEN_STAT_MULT: Record<number, number> = { 1: 1.12, 2: 1.12, 3: 1.15, 4: 1.20, 5: 1.25 };

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
  name:      string;
  lore:      string;
  artPrompt: string;
  passive:   AwakenedPassive;
}

export async function generateAwakening(userId: string): Promise<AwakeningResult | null> {
  const [user, bonds, weapon] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: {
        element: true, level: true, worldLevel: true, dailyStreak: true,
        uniqueAbilityName: true, uniqueAbilityEffect: true, uniqueAbilityLore: true,
        uniqueAbilityEffects: true, abilityEvolved: true,
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

  const fbEffect = fallbackNewEffect(element, weapon.rarity, weapon.name, userId);
  const fbDesc   = `Awakened: ${formatEffects([fbEffect])}`;
  const fallback: AwakeningResult = {
    name:      `${epithet} ${weapon.name}`,
    lore:      EGO_LORE_LINE[element] ?? EGO_LORE_LINE.NONE,
    artPrompt: fallbackArtPrompt(weapon.name, weapon.weaponType, element, `${epithet} ${weapon.name}`),
    passive:   buildAwakenedPassive(weapon.name, weapon.rarity, fbEffect, fbDesc),
  };

  const basePassive = WEAPON_PASSIVES[weapon.name];
  const owned   = new Set((basePassive?.effects ?? []).map(e => e.type));
  const choices = Object.entries(ABILITY_REGISTRY)
    .filter(([k]) => !owned.has(k))
    .map(([k, def]) => `${k} (${def.desc.replace("{v}", "X")}; value ${def.min}–${def.max})`)
    .join(", ");

  const evolvedFx = sanitizeEffects(user.uniqueAbilityEffects, user.abilityEvolved);

  const systemPrompt = [
    `You are the lore engine for CARTETHYIA — a Wuthering Waves-inspired anime social RPG with a dark, poetic aesthetic.`,
    `A player's WEAPON is AWAKENING into its Ego form at Level 60 — the weapon develops a soul shaped by its wielder. It TRANSFORMS: new name, new identity, but it is still the same weapon underneath.`,
    ``,
    `Rules:`,
    `- NAME: 2-4 words, title-case. Must feel like the awakened soul of the original weapon name — grander, alive. Do not reuse the original name verbatim.`,
    `- LORE: 1-2 sentences, poetic, no numbers. The weapon waking up, shaped by its wielder's story.`,
    `- ART_PROMPT: a rich, detailed image-generation prompt (4-6 sentences) describing the awakened weapon's appearance. Include: weapon type and silhouette, specific ${element.toLowerCase()} elemental visual effects (glowing cracks, particle effects, energy aura), material and surface details (runes, engravings, metalwork), background environment (dark cosmic void, stars, dimensional rifts, element-themed atmosphere), lighting style (rim light, bloom, dramatic shadows), and overall aesthetic (anime fantasy, Wuthering Waves / Honkai Star Rail style). No humans, no text in image, weapon centered, cinematic composition.`,
    `- DESC: 1 sentence describing the awakened passive in flavourful but concrete terms.`,
    `- NEW_EFFECT: one object {type, value} — the newly awakened power. type MUST be from this list, value within range:`,
    choices,
    `- Choose NEW_EFFECT to synergize with the wielder's evolved unique ability and how they actually fight.`,
    ``,
    `Respond ONLY with valid JSON, no other text:`,
    `{"name":"...","lore":"...","artPrompt":"...","desc":"...","newEffect":{"type":"EXECUTE","value":0.5}}`,
  ].join("\n");

  const userPrompt = [
    `WEAPON: "${weapon.name}" — ${weapon.weaponType}, ${weapon.rarity}★, Lv${weapon.level}, substat ${weapon.subStatType ?? "none"}${weapon.hiddenSub1Type ? `, hidden: ${weapon.hiddenSub1Type}${weapon.hiddenSub2Type ? " + " + weapon.hiddenSub2Type : ""}` : ""}.`,
    `Current weapon passive: ${basePassive?.effects ? formatEffects(basePassive.effects as AbilityEffect[]).replace(/\n/g, " | ") : basePassive?.elemDmg ? `+${Math.round(basePassive.elemDmg * 100)}% Elemental DMG` : "none (this awakening grants its first)"}.`,
    ``,
    `WIELDER — Element: ${element}.`,
    `Evolved unique ability: "${user.uniqueAbilityName}" — ${user.uniqueAbilityEffect} (mechanics: ${formatEffects(evolvedFx).replace(/\n/g, " | ")})`,
    `Personality: ${derivePersonality(user.resonanceProfile)}.`,
    `Bonds: ${deriveBonds(bonds)}.`,
    `Combat history: ${deriveCombat(user.duelWins, user.duelLosses, user.encountersWon, user.raidWins)}; ${user.dungeonClears} dungeons, ${user.ascensionWins} ascensions.`,
    `Dedication: ${deriveDedication(user.dailyStreak, user.worldLevel, user.level)}.`,
    ``,
    `Awaken the weapon. Its new name and soul must feel forged from this exact wielder.`,
  ].join("\n");

  const raw = await askAI({ systemPrompt, userPrompt, maxTokens: 800 });
  if (!raw) return fallback;

  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed  = JSON.parse(cleaned);
    if (!parsed.name || !parsed.lore) return fallback;

    // Validate the AI's new effect; rarity caps the value position in range
    let newEffect = fbEffect;
    const valid = sanitizeEffects([parsed.newEffect]).filter(e => !owned.has(e.type));
    if (valid.length > 0) {
      const capped = Math.min(valid[0].value, effectValueForRarity(valid[0].type, weapon.rarity));
      newEffect = { type: valid[0].type, value: capped };
    }
    const desc = parsed.desc ? String(parsed.desc).slice(0, 200) : fbDesc;

    return {
      name:      String(parsed.name).slice(0, 48),
      lore:      String(parsed.lore).slice(0, 300),
      artPrompt: parsed.artPrompt ? String(parsed.artPrompt).slice(0, 800) : fallback.artPrompt,
      passive:   buildAwakenedPassive(weapon.name, weapon.rarity, newEffect, desc),
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
