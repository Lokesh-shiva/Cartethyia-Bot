import { askAI } from "./ai";
import prisma from "./prisma";
import { ABILITY_REGISTRY, AbilityEffect, sanitizeEffects, composeFallbackEffects } from "./abilityEffects";

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
