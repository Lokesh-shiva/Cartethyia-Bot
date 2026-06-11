// ── Lv50 Unique Ability Evolution ─────────────────────────────────────────────
// Predetermined (non-AI) evolution of the unique ability earned at first ascension.
// Quest (ordered): start → clear 3 dungeons → defeat a WL2+ boss → pay materials.
// Evolution: existing effect values ×1.3 (over-cap up to 1.3× registry max) + a
// 4th element-themed primitive added. Name gains an epithet, lore gains a line.

import prisma from "./prisma";
import { askAI } from "./ai";
import { ABILITY_REGISTRY, AbilityEffect, sanitizeEffects, formatEffects } from "./abilityEffects";
import { derivePlaystyle, derivePersonality, deriveBonds, deriveCombat, deriveDedication } from "./uniqueAbility";

export const EVO_LEVEL_REQUIRED   = 50;
export const EVO_DUNGEONS_NEEDED  = 3;
// WL2: /boss only lists ALREADY-CLEARED bosses (worldLevel > wl), so a Lv50
// player (WL3 after ascending) can re-fight the WL2 boss — completable right at
// the Lv50 quest unlock. WL3 boss would need WL4 = Lv60; WL5 would need Lv70.
export const EVO_BOSS_WL_REQUIRED = 2;
export const EVO_COST = { paradoxCores: 5, stasisLocks: 8 };

// ── Predetermined evolved identity per element ────────────────────────────────
export const EVOLVED_EPITHET: Record<string, string> = {
  FUSION:  "Rekindled",
  GLACIO:  "Unthawed",
  ELECTRO: "Unbound",
  AERO:    "Stormborn",
  HAVOC:   "Abyssal",
  SPECTRO: "Luminant",
  NONE:    "Awakened",
};

export const EVOLVED_LORE_LINE: Record<string, string> = {
  FUSION:  "The flame that should have died learned instead to burn without fuel.",
  GLACIO:  "What the world called stillness was only the gathering of an avalanche.",
  ELECTRO: "The current no longer flows through her. She is the current.",
  AERO:    "The wind stopped slipping past the world and began to carry it.",
  HAVOC:   "The void she carried finally opened its eyes — and they were hers.",
  SPECTRO: "The borrowed light was returned a hundredfold, and it remembered her name.",
  NONE:    "Something dormant within the resonance finally answered.",
};

// 4th-primitive pool per element — picked deterministically by userId hash,
// skipping anything the player already has.
const EVO_PRIMITIVE_POOL: Record<string, string[]> = {
  FUSION:  ["ULT_POWER", "EXECUTE", "CRIT_DMG", "SKILL_POWER"],
  GLACIO:  ["SECOND_WIND", "DEF_BOOST", "HP_BOOST", "FULL_HP_DMG"],
  ELECTRO: ["ESCALATION", "CRIT_MOMENTUM", "ENERGY_BOOST", "SKILL_POWER"],
  AERO:    ["FIRST_STRIKE", "CRIT_DMG", "CRIT_RATE", "VIB_BREAKER"],
  HAVOC:   ["BERSERK", "LIFESTEAL", "EXECUTE", "LOW_HP_CRIT"],
  SPECTRO: ["HEAL_ON_CRIT", "FULL_HP_DMG", "HP_BOOST", "ELEM_DMG_BOOST"],
  NONE:    ["ATK_BOOST", "CRIT_DMG", "ULT_POWER", "ESCALATION"],
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

// Boost existing effects ×1.3 (capped at 1.3× registry max) and append the new primitive.
export function evolveEffects(effects: AbilityEffect[], element: string, userId: string): AbilityEffect[] {
  const boosted = effects.map(e => {
    const def = ABILITY_REGISTRY[e.type];
    if (!def) return e;
    if (!def.isPct) {
      // Flat values (energy, second wind) — second wind stays 1, others round up
      const v = def.max <= 1 ? e.value : Math.min(Math.round(def.max * 1.3), Math.ceil(e.value * 1.3));
      return { type: e.type, value: v };
    }
    return { type: e.type, value: +Math.min(def.max * 1.3, e.value * 1.3).toFixed(3) };
  });

  const used = new Set(boosted.map(e => e.type));
  const pool = EVO_PRIMITIVE_POOL[element] ?? EVO_PRIMITIVE_POOL.NONE;
  const h    = hashStr(userId);
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(h + i) % pool.length];
    if (used.has(cand)) continue;
    const def = ABILITY_REGISTRY[cand];
    const t   = ((h >> 3) % 100) / 100;
    const val = def.isPct
      ? +(def.min + (def.max - def.min) * t).toFixed(3)
      : Math.round(def.min + (def.max - def.min) * t);
    boosted.push({ type: cand, value: val });
    break;
  }
  return boosted.slice(0, 4);
}

export function evolvedName(name: string, element: string): string {
  return `${name} · ${EVOLVED_EPITHET[element] ?? EVOLVED_EPITHET.NONE}`;
}

// ── AI-driven evolution identity ──────────────────────────────────────────────
// Reads EVERYTHING about the player — personality, bonds, full combat record,
// equipped weapon, echo build, dedication — plus their current ability, and
// generates a superior evolved name, lore, effect text and the 4th primitive.
// Falls back to the deterministic element tables if LM Studio is offline.
export interface EvolutionResult {
  name:    string;
  effect:  string;
  lore:    string;
  effects: AbilityEffect[];   // boosted originals + new 4th primitive
}

export async function generateEvolution(userId: string): Promise<EvolutionResult | null> {
  const [user, bonds, weapon, echoes] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: {
        element: true, level: true, worldLevel: true, dailyStreak: true,
        uniqueAbilityName: true, uniqueAbilityEffect: true, uniqueAbilityLore: true, uniqueAbilityEffects: true,
        resonanceProfile: true,
        vibePhysicalCount: true, vibeExpressiveCount: true, vibeEmotionalCount: true,
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
      select: { name: true, weaponType: true, rarity: true, level: true },
    }),
    prisma.echo.findMany({
      where:  { userId, isEquipped: true },
      select: { name: true, element: true, cost: true, mainStatType: true },
    }),
  ]);
  if (!user?.uniqueAbilityName) return null;

  const element = (user.element as string) ?? "NONE";
  const oldFx   = sanitizeEffects(user.uniqueAbilityEffects);
  const boosted = evolveEffects(oldFx, element, userId);   // already includes deterministic 4th as fallback
  const boostedWithout4th = boosted.slice(0, oldFx.length);

  // Deterministic fallback result
  const fallback: EvolutionResult = {
    name:    evolvedName(user.uniqueAbilityName, element),
    effect:  user.uniqueAbilityEffect ?? "",
    lore:    `${user.uniqueAbilityLore ? user.uniqueAbilityLore + " " : ""}${EVOLVED_LORE_LINE[element] ?? EVOLVED_LORE_LINE.NONE}`,
    effects: boosted,
  };

  // Build the menu of valid 4th primitives (anything they don't already have)
  const owned   = new Set(oldFx.map(e => e.type));
  const choices = Object.entries(ABILITY_REGISTRY)
    .filter(([k]) => !owned.has(k))
    .map(([k, def]) => `${k} (${def.desc.replace("{v}", "X")}; value ${def.min}–${def.max})`)
    .join(", ");

  const buildSummary = [
    weapon ? `Weapon: ${weapon.name} (${weapon.weaponType}, ${weapon.rarity}★, Lv${weapon.level})` : "Weapon: none equipped",
    echoes.length
      ? `Echo build: ${echoes.map(e => `${e.name} (${e.cost}-cost, ${e.mainStatType})`).join(", ")}`
      : "Echo build: none equipped",
  ].join("\n");

  const systemPrompt = [
    `You are the lore engine for CARTETHYIA — a Wuthering Waves-inspired anime social RPG with a dark, poetic aesthetic.`,
    `A player's UNIQUE PASSIVE ABILITY is EVOLVING into its awakened form. This is a major moment — the evolved identity must feel STRICTLY SUPERIOR and like the next chapter of the same ability.`,
    ``,
    `Rules:`,
    `- NAME: 2-5 words, title-case. It must clearly descend from the old name's theme but sound ascended — grander, final-form. NOT just the old name with a suffix.`,
    `- EFFECT: 1-2 sentences describing the awakened mechanic (all old effects grew ~30% stronger AND a new power awakened).`,
    `- LORE: 1-2 sentences, poetic, no numbers. Continue the old lore's story — the promise fulfilled.`,
    `- FOURTH: one object {type, value} — the newly awakened power. type MUST be from this list, value within range:`,
    choices,
    `- Choose the FOURTH to match how this player actually plays and builds (their weapon, echoes, combat record below).`,
    ``,
    `Respond ONLY with valid JSON, no other text:`,
    `{"name":"...","effect":"...","lore":"...","fourth":{"type":"EXECUTE","value":0.5}}`,
  ].join("\n");

  const userPrompt = [
    `CURRENT ABILITY — name: "${user.uniqueAbilityName}", effect: "${user.uniqueAbilityEffect}", lore: "${user.uniqueAbilityLore}"`,
    `Current mechanics: ${formatEffects(oldFx).replace(/\n/g, " | ")}`,
    ``,
    `Element: ${element}.`,
    `Personality: ${derivePersonality(user.resonanceProfile)}.`,
    `Social style: ${derivePlaystyle(user.vibePhysicalCount, user.vibeExpressiveCount, user.vibeEmotionalCount)}.`,
    `Bonds: ${deriveBonds(bonds)}.`,
    `Combat history: ${deriveCombat(user.duelWins, user.duelLosses, user.encountersWon, user.raidWins)}; ${user.dungeonClears} dungeons cleared, ${user.ascensionWins} ascensions won.`,
    `Dedication: ${deriveDedication(user.dailyStreak, user.worldLevel, user.level)}.`,
    buildSummary,
    ``,
    `Evolve their ability. The new name and lore must feel like this exact player earned them.`,
  ].join("\n");

  const raw = await askAI({ systemPrompt, userPrompt, maxTokens: 400 });
  if (!raw) return fallback;

  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed  = JSON.parse(cleaned);
    if (!parsed.name || !parsed.effect || !parsed.lore) return fallback;

    // Validate the AI's 4th primitive; fall back to the deterministic pick if bad
    const fourth = sanitizeEffects([parsed.fourth]).filter(e => !owned.has(e.type));
    const effects = fourth.length > 0
      ? [...boostedWithout4th, fourth[0]]
      : boosted;

    return {
      name:    String(parsed.name).slice(0, 60),
      effect:  String(parsed.effect).slice(0, 300),
      lore:    String(parsed.lore).slice(0, 300),
      effects,
    };
  } catch {
    return fallback;
  }
}

// ── Quest progress tracking ───────────────────────────────────────────────────
// Called from dungeon/boss win paths. Returns a progress line to show the
// player, or null if nothing changed.
export async function trackEvolutionProgress(
  userId: string,
  event: { kind: "dungeon" } | { kind: "boss"; worldLevel: number },
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { abilityEvolved: true, abilityEvoStep: true, abilityEvoDungeons: true },
  });
  if (!user || user.abilityEvolved) return null;

  if (event.kind === "dungeon" && user.abilityEvoStep === 1) {
    const n = Math.min(EVO_DUNGEONS_NEEDED, user.abilityEvoDungeons + 1);
    const done = n >= EVO_DUNGEONS_NEEDED;
    await prisma.user.update({
      where: { id: userId },
      data:  { abilityEvoDungeons: n, ...(done ? { abilityEvoStep: 2 } : {}) },
    });
    return done
      ? `✦ **Evolution Quest** — dungeon trials complete! Next: defeat a **World Level ${EVO_BOSS_WL_REQUIRED}+** boss (\`/boss\`).`
      : `✦ **Evolution Quest** — dungeon trial **${n}/${EVO_DUNGEONS_NEEDED}** cleared.`;
  }

  if (event.kind === "boss" && user.abilityEvoStep === 2 && event.worldLevel >= EVO_BOSS_WL_REQUIRED) {
    await prisma.user.update({ where: { id: userId }, data: { abilityEvoStep: 3 } });
    return `✦ **Evolution Quest** — the boss falls! Your resonance trembles. Use \`/evolve\` to complete the awakening.`;
  }

  return null;
}

// Read evolved effects from a user row (helper for display paths).
export function readEffects(raw: any, evolved: boolean): AbilityEffect[] {
  return sanitizeEffects(raw, evolved);
}
