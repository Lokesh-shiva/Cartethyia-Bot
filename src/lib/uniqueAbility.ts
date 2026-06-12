import { askAI } from "./ai";
import prisma from "./prisma";
import { ABILITY_REGISTRY, AbilityEffect, sanitizeEffects, composeFallbackEffects } from "./abilityEffects";
import { V2EffectEntry, sanitizeV2Effects, formatV2Effects, V2_PROMPT_SCHEMA } from "./abilityEngineV2";
import { resolvePlayerBonuses, applyBonuses } from "./setBonus";
import { formatAwakenedPassive } from "./weaponAwakening";
import { FORGED_WEAPONS } from "./weapons";

// â”€â”€ Element context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ELEMENT_BONUS: Record<string, string> = {
  FUSION:  "+15% ATK, +15% Crit Rate â€” volatile, explosive power that rewards aggression",
  GLACIO:  "+30% DEF, +15% HP â€” endurance and patience, power through outlasting",
  ELECTRO: "+25 Energy/turn, +20% Crit DMG â€” relentless tempo, fuelled by constant action",
  AERO:    "+15% ATK, +40% Crit DMG â€” unpredictable and fluid, striking before being struck",
  HAVOC:   "+20% Lifesteal, +15% ATK â€” power drawn from destruction, surviving through offense",
  SPECTRO: "+30% HP â€” radiant sustain, turning connection into survivability",
};

const ELEMENT_ARCHETYPE: Record<string, string> = {
  FUSION:  "a flame that burns brightest in the thick of chaos",
  GLACIO:  "a glacier â€” unmovable, accumulating force over time",
  ELECTRO: "a storm that never tires",
  AERO:    "a wind that slips through every defence",
  HAVOC:   "a void that consumes and grows stronger for it",
  SPECTRO: "a light that sustains those around it",
};

// â”€â”€ Hardcoded fallbacks per element (if LM Studio is offline) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FALLBACK_ABILITIES: Record<string, { name: string; effect: string; lore: string }> = {
  FUSION: {
    name:   "Ember's Last Oath",
    effect: "When your HP drops below 40%, your Crit Rate increases by an additional 20% and all attacks deal Fusion damage for 3 turns.",
    lore:   "Some flames burn coolest just before they consume everything. Yours is one of them.",
  },
  GLACIO: {
    name:   "Stillwater Vow",
    effect: "Every 5 turns without fleeing, gain a DEF stack (+8%) up to 3 stacks. Stacks persist until you take a critical hit.",
    lore:   "Patience is not passivity. It is the art of letting the world exhaust itself against you.",
  },
  ELECTRO: {
    name:   "Unbroken Current",
    effect: "Energy Regen is doubled for the first 3 turns of combat. Ultimates used within this window deal 25% bonus damage.",
    lore:   "The current never asks permission. It simply flows â€” until everything else has stopped.",
  },
  AERO: {
    name:   "Between Heartbeats",
    effect: "Once per battle, when you would receive fatal damage, evade it entirely and gain +30% Crit DMG for 2 turns.",
    lore:   "She was already somewhere else. The blow found only the memory of where she had stood.",
  },
  HAVOC: {
    name:   "Devouring Accord",
    effect: "Every 100 damage you deal restores 5% of your max HP. This effect is doubled against stunned enemies.",
    lore:   "To unmake is also to take. She understood this long before the world gave it a name.",
  },
  SPECTRO: {
    name:   "Resonant Covenant",
    effect: "At the start of each turn, restore HP equal to 3% of your max HP. Doubles to 6% for 2 turns after using your Ultimate.",
    lore:   "The light she carried was not her own. It belonged to every person who had ever trusted her with theirs.",
  },
};

// â”€â”€ Signal derivers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function derivePlaystyle(physical: number, expressive: number, emotional: number): string {
  const total = physical + expressive + emotional;
  if (total === 0) return "a balanced, uncharted resonance â€” no vibe history yet";

  const dominant = physical >= expressive && physical >= emotional ? "physical"
    : expressive >= emotional ? "expressive"
    : "emotional";

  const label = dominant === "physical"   ? "drawn to touch, closeness, and direct action"
    : dominant === "expressive" ? "outward, performative, driven by visible energy"
    : "inward, empathic, attuned to how others feel";

  const pct = (n: number) => Math.round((n / total) * 100);
  return `${label} (${pct(physical)}% physical / ${pct(expressive)}% expressive / ${pct(emotional)}% emotional across ${total} interactions)`;
}

export function derivePersonality(profile: any): string {
  if (!profile?.answers) return "an unknown resonance signature";
  const entries = Object.values(profile.answers) as { value: string; trait: string }[];
  const traits = [...new Set(entries.map(e => e.trait).filter(Boolean))];
  return traits.length > 0 ? traits.join(", ") : "complex and undefined";
}

export function deriveBonds(bonds: { bondType: string }[]): string {
  if (bonds.length === 0) return "no bonds formed â€” a solitary wanderer";

  const types = bonds.map(b => b.bondType);
  const parts: string[] = [];
  const partners = types.filter(t => t === "PARTNER").length;
  const parents  = types.filter(t => t === "ADOPTED_PARENT").length;
  const children = types.filter(t => t === "ADOPTED_CHILD").length;
  const friends  = types.filter(t => t === "FRIEND").length;

  if (partners  > 0) parts.push(`${partners} Partner bond${partners > 1 ? "s" : ""} (deep romantic/chosen connection)`);
  if (parents   > 0) parts.push(`${parents} Adopted Parent bond${parents > 1 ? "s" : ""} (protective, guiding)`);
  if (children  > 0) parts.push(`${children} Adopted Child bond${children > 1 ? "s" : ""} (seeks belonging, trust)`);
  if (friends   > 0) parts.push(`${friends} Friend bond${friends > 1 ? "s" : ""}`);

  return parts.join(", ");
}

export function deriveCombat(
  duelWins: number, duelLosses: number,
  encountersWon: number, raidWins: number,
): string {
  const totalDuels = duelWins + duelLosses;
  const parts: string[] = [];

  if (totalDuels === 0 && encountersWon === 0 && raidWins === 0) {
    return "no combat history â€” untested, unknown potential";
  }

  if (totalDuels > 0) {
    const duelStyle = duelWins > duelLosses * 2 ? `dominant duelist (${duelWins}W / ${duelLosses}L)`
      : duelWins > duelLosses                   ? `competitive fighter (${duelWins}W / ${duelLosses}L)`
      : duelWins === duelLosses                 ? `balanced fighter (${duelWins}W / ${duelLosses}L)`
      : duelLosses > duelWins * 2               ? `persistent â€” loses often but keeps challenging (${duelWins}W / ${duelLosses}L)`
      :                                           `more losses than wins â€” learns through defeat (${duelWins}W / ${duelLosses}L)`;
    parts.push(duelStyle);
  }

  if (encountersWon > 0) {
    const encStyle = encountersWon > 50 ? `prolific echo hunter (${encountersWon} encounters won)`
      : encountersWon > 20              ? `experienced fighter (${encountersWon} encounters won)`
      :                                   `${encountersWon} encounters won`;
    parts.push(encStyle);
  }

  if (raidWins > 0) parts.push(`${raidWins} raid${raidWins > 1 ? "s" : ""} cleared (cooperative)`);

  return parts.join("; ");
}

export function deriveDedication(dailyStreak: number, worldLevel: number, level: number): string {
  const parts: string[] = [];

  if      (dailyStreak >= 30) parts.push(`30+ day daily streak â€” unwavering devotion`);
  else if (dailyStreak >= 14) parts.push(`${dailyStreak}-day daily streak â€” deeply committed`);
  else if (dailyStreak >= 7)  parts.push(`${dailyStreak}-day streak â€” consistent presence`);
  else if (dailyStreak >= 3)  parts.push(`${dailyStreak}-day streak â€” building momentum`);
  else                        parts.push(`low daily streak â€” comes and goes`);

  parts.push(`World Level ${worldLevel}, Level ${level} â€” ${
    worldLevel >= 4 ? "veteran, has pushed deep into the game's hardest content"
    : worldLevel >= 2 ? "experienced, proven through multiple ascensions"
    : worldLevel >= 1 ? "tested, has survived their first ascension"
    : "freshly ascended â€” full of potential"
  }`);

  return parts.join("; ");
}

// â”€â”€ Main generation function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function generateUniqueAbility(userId: string, persist = true): Promise<{
  name: string; effect: string; lore: string; effects: AbilityEffect[];
} | null> {
  // Fetch all relevant player data in parallel
  const [user, bonds] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: {
        element:             true,
        resonanceProfile:    true,
        vibePhysicalCount:   true,
        vibeExpressiveCount: true,
        vibeEmotionalCount:  true,
        uniqueAbilityName:   true,
        duelWins:            true,
        duelLosses:          true,
        encountersWon:       true,
        raidWins:            true,
        dailyStreak:         true,
        worldLevel:          true,
        level:               true,
      },
    }),
    prisma.bond.findMany({
      where:  { OR: [{ initiatorId: userId }, { receiverId: userId }] },
      select: { bondType: true },
    }),
  ]);

  if (!user) return null;

  // Already generated -- don't overwrite (unless persist=false for dry-run preview)
  if (user.uniqueAbilityName && persist) {
    const full = await prisma.user.findUnique({
      where:  { id: userId },
      select: { uniqueAbilityEffect: true, uniqueAbilityLore: true, uniqueAbilityEffects: true },
    });
    return {
      name:    user.uniqueAbilityName,
      effect:  full?.uniqueAbilityEffect ?? '',
      lore:    full?.uniqueAbilityLore   ?? '',
      effects: sanitizeEffects(full?.uniqueAbilityEffects),
    };
  }

  const element     = user.element ?? "NONE";
  const playstyle   = derivePlaystyle(user.vibePhysicalCount, user.vibeExpressiveCount, user.vibeEmotionalCount);
  const personality = derivePersonality(user.resonanceProfile);
  const bondSummary = deriveBonds(bonds);
  const combat      = deriveCombat(user.duelWins, user.duelLosses, user.encountersWon, user.raidWins);
  const dedication  = deriveDedication(user.dailyStreak, user.worldLevel, user.level);
  const elemBonus   = ELEMENT_BONUS[element]    ?? "unknown resonance";
  const elemArch    = ELEMENT_ARCHETYPE[element] ?? "an undefined force";

  // Build the ability primitive menu from the central registry
  const abilityTypes = Object.entries(ABILITY_REGISTRY)
    .map(([key, def]) => `${key} (${def.desc.replace("{v}", "X")}; value ${def.min}â€“${def.max})`)
    .join(", ");

  const systemPrompt = [
    `You are the lore engine for CARTETHYIA â€” a Wuthering Waves-inspired anime social RPG with a dark, poetic aesthetic.`,
    `Generate a UNIQUE PASSIVE ABILITY for a specific player. It must feel deeply personal â€” like it could only belong to them.`,
    `It should sound like a named ability from Wuthering Waves or Honkai: Star Rail â€” evocative, flavourful, concrete.`,
    ``,
    `The ability's mechanic is a COMPOSITE of 2â€“3 distinct primitives you pick and tune from this list (pick 2â€“3, each ONCE):`,
    abilityTypes,
    ``,
    `Rules:`,
    `- NAME: 2-4 words, title-case, evocative. Should feel like it belongs to THIS player.`,
    `- EFFECT: 1-2 sentences. Describe the COMBINED mechanic in flavourful but concrete terms.`,
    `- LORE: 1-2 sentences. Poetic, no numbers. Should echo their personality and bonds.`,
    `- EFFECTS: array of 2-3 objects {type, value}. type must be from the list above, value within its range.`,
    ``,
    `The player data below tells their story. Let it shape the ability â€” a loner gets different mechanics than a connector, a dominant fighter gets different mechanics than someone who loses but persists.`,
    ``,
    `Respond ONLY with valid JSON, no other text:`,
    `{"name":"...","effect":"...","lore":"...","effects":[{"type":"EXECUTE","value":0.45},{"type":"CRIT_DMG","value":0.22}]}`,
  ].join("\n");

  const userPrompt = [
    `Element: ${element} â€” ${elemArch}.`,
    `Element innate bonus: ${elemBonus}.`,
    `Personality (from onboarding questions): ${personality}.`,
    `Social interaction style: ${playstyle}.`,
    `Bonds: ${bondSummary}.`,
    `Combat history: ${combat}.`,
    `Dedication & progression: ${dedication}.`,
    ``,
    `Compose their unique passive (2â€“3 primitives). Make it feel like it grew from who they are, not just what element they picked.`,
  ].join("\n");

  const raw = await askAI({ systemPrompt, userPrompt, maxTokens: 400 });

  let ability: { name: string; effect: string; lore: string } | null = null;
  let effects: AbilityEffect[] = [];

  if (raw) {
    try {
      const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed  = JSON.parse(cleaned);
      if (parsed.name && parsed.effect && parsed.lore) {
        ability = { name: parsed.name, effect: parsed.effect, lore: parsed.lore };
        effects = sanitizeEffects(parsed.effects);
      }
    } catch { /* fall through to fallback */ }
  }

  if (!ability) {
    ability = FALLBACK_ABILITIES[element] ?? FALLBACK_ABILITIES.FUSION;
  }
  if (effects.length === 0) {
    effects = composeFallbackEffects(element, userId);
  }

  // Persist only when requested (persist=false is used for dry-run preview)
  if (persist) {
    await prisma.user.update({
      where: { id: userId },
      data:  {
        uniqueAbilityName:    ability.name,
        uniqueAbilityEffect:  ability.effect,
        uniqueAbilityLore:    ability.lore,
        uniqueAbilityEffects: effects as any,
      },
    });
  }

  return { ...ability, effects };
}

// ── V2 Ability Generation ────────────────────────────────────────────────────
// AI composes trigger→effect entries with full player context including
// resolved combat stats and weapon identity.

export async function generateUniqueAbilityV2(userId: string, persist = true): Promise<{
  name: string; effect: string; lore: string; v2Effects: V2EffectEntry[];
} | null> {
  const [user, bonds, weapon] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: {
        element: true, level: true, worldLevel: true,
        baseAtk: true, baseHp: true, baseDef: true, critRate: true, critDmg: true,
        resonanceProfile: true,
        vibePhysicalCount: true, vibeExpressiveCount: true, vibeEmotionalCount: true,
        uniqueTargetCount: true,
        uniqueAbilityName: true,
        uniqueAbilityEffects: true,
        abilityVersion: true,
        abilityEvolved: true,
        uniqueAbilityEffect: true,
        uniqueAbilityLore: true,
        duelWins: true, duelLosses: true, encountersWon: true, raidWins: true,
        dailyStreak: true,
      },
    }),
    prisma.bond.findMany({
      where:  { OR: [{ initiatorId: userId }, { receiverId: userId }] },
      select: { bondType: true },
    }),
    prisma.weapon.findFirst({
      where:  { userId, isEquipped: true },
      select: {
        name: true, weaponType: true, rarity: true, level: true, baseAtk: true,
        awakened: true, awakenedName: true, awakenedPassive: true,
      },
    }),
  ]);

  if (!user) return null;

  // Dry-run already-generated guard
  if (user.uniqueAbilityName && persist && user.abilityVersion === 2) {
    return {
      name:      user.uniqueAbilityName,
      effect:    user.uniqueAbilityEffect ?? "",
      lore:      user.uniqueAbilityLore   ?? "",
      v2Effects: sanitizeV2Effects(user.uniqueAbilityEffects),
    };
  }

  const element     = user.element ?? "NONE";
  const playstyle   = derivePlaystyle(user.vibePhysicalCount, user.vibeExpressiveCount, user.vibeEmotionalCount);
  const personality = derivePersonality(user.resonanceProfile);
  const bondSummary = deriveBonds(bonds);
  const combat      = deriveCombat(user.duelWins, user.duelLosses, user.encountersWon, user.raidWins);
  const dedication  = deriveDedication(user.dailyStreak, user.worldLevel, user.level);
  const elemArch    = ELEMENT_ARCHETYPE[element] ?? "an undefined force";

  // ── Resolved final combat stats (not base) ───────────────────────────────
  // Base stats are before echoes/weapon/set bonuses — the AI must see FINAL
  // numbers or it wildly misreads the build (e.g. sees 5% crit, gives crit rate boost).
  const bonuses = await resolvePlayerBonuses(userId);
  const stats   = applyBonuses(
    { baseHp: user.baseHp, baseAtk: user.baseAtk, baseDef: user.baseDef,
      critRate: user.critRate ?? 0.05, critDmg: user.critDmg ?? 1.5 },
    bonuses,
  );
  const finalCritPct    = Math.round(stats.critRate * 100);
  const finalCritDmgPct = Math.round(stats.critDmg * 100);
  const finalAtk        = stats.atk;
  const finalHp         = stats.hp;

  // Derive plain-language build archetype from final stats
  const buildArchetype = (() => {
    const parts: string[] = [];
    if (finalCritPct >= 60)       parts.push("crit-capped hypercarry");
    else if (finalCritPct >= 35)  parts.push("high-crit attacker");
    else if (finalCritPct >= 20)  parts.push("moderate crit build");
    if (finalCritDmgPct >= 350)   parts.push("extreme crit damage focus");
    else if (finalCritDmgPct >= 250) parts.push("high crit damage");
    if (finalHp >= 15000)         parts.push("tanky sustain build");
    else if (finalHp <= 6000)     parts.push("glass cannon");
    if (stats.lifesteal >= 0.20)  parts.push("lifesteal-heavy");
    if (stats.energyPerTurn >= 50) parts.push("energy-stacking");
    return parts.length > 0 ? parts.join(", ") : "balanced generalist";
  })();

  // Active echo set bonuses (give AI the set context)
  const activeSetLabels = bonuses.activeLabels
    .filter(l => l.includes("pc") || l.includes("Echo"))
    .map(l => l.split("—")[0].trim())
    .join(", ") || "no set bonuses active";

  // Weapon passive description
  let weaponDesc = "no weapon equipped";
  if (weapon) {
    const wName = weapon.awakened && weapon.awakenedName ? weapon.awakenedName : weapon.name;
    const wMaxMult = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 }[weapon.rarity] ?? 2.5;
    const wEffAtk  = Math.round(weapon.baseAtk * (1 + (weapon.level - 1) * (wMaxMult - 1) / 89));
    let passive = "";
    if (weapon.awakened && weapon.awakenedPassive) {
      passive = formatAwakenedPassive(weapon.awakenedPassive);
    } else {
      passive = FORGED_WEAPONS.find(w => w.name === weapon.name)?.passive ?? "";
    }
    weaponDesc = `${wName} (${weapon.weaponType}, ★${weapon.rarity}, Lv${weapon.level}, ${wEffAtk} ATK${weapon.awakened ? " — Ego Awakened" : ""})`;
    if (passive) weaponDesc += `\n  Passive: ${passive}`;
  }

  // Evolved ability context
  let evolvedCtx = "";
  if (user.abilityEvolved && user.uniqueAbilityName) {
    evolvedCtx = `\nEvolved ability: "${user.uniqueAbilityName}" — ${user.uniqueAbilityEffect ?? "an evolved resonance"}`;
  }

  // Previous ability (avoid re-generating same thing on reroll)
  let prevAbilityCtx = "";
  if (user.uniqueAbilityName && user.abilityVersion === 2) {
    prevAbilityCtx = `\nPrevious ability (do NOT replicate): "${user.uniqueAbilityName}" — ${user.uniqueAbilityEffect ?? ""}`;
  }

  const systemPrompt = [
    `You are the lore engine for CARTETHYIA — a Wuthering Waves-inspired anime social RPG with a dark, poetic aesthetic.`,
    `Generate a UNIQUE PASSIVE ABILITY for a specific player using the V2 composable trigger→effect language.`,
    `It must feel deeply personal and mechanically sharp — it should amplify what the player already does well, not patch weaknesses.`,
    ``,
    V2_PROMPT_SCHEMA,
    ``,
    `Rules:`,
    `- NAME: 2-4 words, title-case, evocative. Should feel like it belongs to THIS player.`,
    `- EFFECT: 1-2 sentences. Describe the combined mechanic in flavourful but concrete terms.`,
    `- LORE: 1-2 sentences. Poetic, no numbers. Should echo their personality and bonds.`,
    `- EFFECTS: 2-3 V2 effect entries. MUST be synergistic with the player's build archetype and element.`,
    ``,
    `BUILD BIAS RULES (critical — follow these strictly):`,
    `- Crit-capped / high-crit attacker → prefer ON_CRIT triggers and CRIT_DMG / DMG_MULT effects. Do NOT give CRIT_RATE (already capped).`,
    `- Extreme crit damage → ON_CRIT:DMG_MULT or STACK_DMG builds that compound the existing multiplier.`,
    `- Glass cannon (low HP) → BELOW_HP_PCT survival or FIRST_ACTION burst.`,
    `- Tanky / high HP → ABOVE_HP_PCT bonuses, HEAL_PCT, or SECOND_WIND.`,
    `- Energy-stacking → GAIN_ENERGY triggers, ON_ULT payoffs.`,
    `- Lifesteal-heavy → ON_HIT:LIFESTEAL amplification or BELOW_HP_PCT heal.`,
    ``,
    `ELEMENT TRIGGER BIAS:`,
    `Aero = FIRST_ACTION burst or STACK_DMG (wind stacking); Havoc = BELOW_HP_PCT aggression; Electro = ON_CRIT energy + EVERY_N_TURNS; Spectro = TURN_START heal + ON_ULT sustain; Fusion = ON_SKILL/ULT power; Glacio = ABOVE_HP_PCT or BELOW_HP_PCT resilience.`,
    ``,
    `Respond ONLY with valid JSON, no other text:`,
    `{"name":"...","effect":"...","lore":"...","effects":[{"trigger":"ON_CRIT","effect":"CRIT_DMG","value":0.28,"displayName":"Lethal Edge","desc":"Critical hits amplify crit damage by 28%."},{"trigger":"FIRST_ACTION","effect":"DMG_MULT","value":0.55,"displayName":"Gale Opener","desc":"The first strike of every fight deals 55% bonus damage."}]}`,
  ].join("\n");

  const userPrompt = [
    `Element: ${element} — ${elemArch}.`,
    `Personality: ${personality}.`,
    `Social style: ${playstyle}.`,
    `Bonds: ${bondSummary}.`,
    `Combat history: ${combat}.`,
    `Progression: ${dedication}.`,
    ``,
    `FINAL COMBAT STATS (after all echoes, weapon, set bonuses):`,
    `ATK ${finalAtk}  ·  HP ${finalHp}  ·  Crit Rate ${finalCritPct}%  ·  Crit DMG ${finalCritDmgPct}%  ·  Lifesteal ${Math.round(stats.lifesteal * 100)}%  ·  Energy/turn ${stats.energyPerTurn}`,
    `Build archetype: ${buildArchetype}.`,
    `Active echo sets: ${activeSetLabels}.`,
    `Weapon: ${weaponDesc}.${evolvedCtx}${prevAbilityCtx}`,
    ``,
    `Design their V2 ability (2–3 components). Amplify their strengths. A ${buildArchetype} player needs mechanics that COMPOUND what they already do — not plug gaps.`,
  ].join("\n");

  const raw = await askAI({ systemPrompt, userPrompt, maxTokens: 600 });

  let ability: { name: string; effect: string; lore: string } | null = null;
  let v2Effects: V2EffectEntry[] = [];

  if (raw) {
    try {
      const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed  = JSON.parse(cleaned);
      if (parsed.name && parsed.effect && parsed.lore) {
        ability   = { name: parsed.name, effect: parsed.effect, lore: parsed.lore };
        v2Effects = sanitizeV2Effects(parsed.effects);
      }
    } catch { /* fall through to fallback */ }
  }

  // Fallback: element-themed V2 ability
  if (!ability) {
    ability = FALLBACK_ABILITIES[element] ?? FALLBACK_ABILITIES.FUSION;
  }
  if (v2Effects.length === 0) {
    v2Effects = V2_ELEMENT_FALLBACKS[element] ?? V2_ELEMENT_FALLBACKS.FUSION;
  }

  if (persist) {
    await prisma.user.update({
      where: { id: userId },
      data:  {
        uniqueAbilityName:    ability.name,
        uniqueAbilityEffect:  ability.effect,
        uniqueAbilityLore:    ability.lore,
        uniqueAbilityEffects: v2Effects as any,
        abilityVersion:       2,
      },
    });
  }

  return { ...ability, v2Effects };
}

// ── V2 element fallbacks (offline AI) ─────────────────────────────────────────
const V2_ELEMENT_FALLBACKS: Record<string, V2EffectEntry[]> = {
  FUSION: [
    { trigger: "ON_SKILL", effect: "DMG_MULT", value: 0.28, displayName: "Flare Burst", desc: "Resonance Skills deal 28% more damage." },
    { trigger: "BELOW_HP_PCT", triggerParam: 0.40, effect: "CRIT_RATE", value: 0.20, displayName: "Ember's Edge", desc: "Below 40% HP, Crit Rate increases by 20%." },
  ],
  GLACIO: [
    { trigger: "ABOVE_HP_PCT", triggerParam: 0.60, effect: "DMG_MULT", value: 0.20, displayName: "Glacial Poise", desc: "Above 60% HP, deal 20% more damage." },
    { trigger: "BELOW_HP_PCT", triggerParam: 0.35, effect: "HEAL_PCT", value: 0.12, displayName: "Frost Mend", desc: "Below 35% HP, attacks heal 12% max HP." },
  ],
  ELECTRO: [
    { trigger: "ON_CRIT", effect: "GAIN_ENERGY", value: 20, displayName: "Discharge", desc: "Critical hits generate 20 bonus energy." },
    { trigger: "EVERY_N_TURNS", triggerParam: 3, effect: "DMG_MULT", value: 0.38, displayName: "Storm Surge", desc: "Every 3rd turn, deal 38% more damage." },
  ],
  AERO: [
    { trigger: "FIRST_ACTION", effect: "DMG_MULT", value: 0.65, displayName: "Opening Gust", desc: "First attack of the fight deals 65% bonus damage." },
    { trigger: "ON_HIT", effect: "STACK_DMG", value: 0.08, stackMax: 5, displayName: "Wind Stacks", desc: "Each hit builds a stack of +8% DMG, up to ×5." },
  ],
  HAVOC: [
    { trigger: "BELOW_HP_PCT", triggerParam: 0.40, effect: "DMG_MULT", value: 0.55, displayName: "Void Rage", desc: "Below 40% HP, deal 55% more damage." },
    { trigger: "ON_HIT", effect: "LIFESTEAL", value: 0.08, displayName: "Devour", desc: "Each hit restores 8% of damage dealt as HP." },
  ],
  SPECTRO: [
    { trigger: "TURN_START", effect: "HEAL_PCT", value: 0.04, displayName: "Radiance", desc: "At the start of each turn, restore 4% max HP." },
    { trigger: "ON_ULT", effect: "HEAL_PCT", value: 0.12, displayName: "Resonant Light", desc: "Using your Ultimate heals 12% of max HP." },
  ],
  NONE: [
    { trigger: "PASSIVE", effect: "ATK_MULT", value: 0.12, displayName: "Iron Will", desc: "Passively increases base attack power by 12%." },
    { trigger: "ON_CRIT", effect: "CRIT_DMG", value: 0.20, displayName: "Keen Strike", desc: "Critical hits deal an additional 20% more damage." },
  ],
};
