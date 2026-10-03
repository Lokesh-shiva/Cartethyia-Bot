// Pure presentation helpers shared by the player and character /stats views.
// Keep the arithmetic in setBonus.ts; this module only turns already-resolved
// values into Discord-safe text so the command cannot accidentally display a
// different formula from combat.

export interface BaseCombatStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  critRate: number;
  critDmg: number;
}

export interface FinalCombatStats extends BaseCombatStats {
  energyPerTurn: number;
  lifesteal: number;
  elemDmgBonus: number;
}

export interface CombatStatBonusDisplay {
  critRateBonus: number;
  critDmgBonus: number;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function diff(base: number, final: number): string {
  const delta = final - base;
  return delta > 0 ? `  *(+${delta.toLocaleString()})*` : "";
}

/** Formats the exact resolved stat shape used by combat. */
export function formatCombatStatBlock(
  base: BaseCombatStats,
  final: FinalCombatStats,
  bonuses: CombatStatBonusDisplay,
  elementEmoji: string,
): string {
  return [
    `❤️ HP — **${final.hp.toLocaleString()}**${diff(base.hp, final.hp)}`,
    `⚔️ ATK — **${final.atk.toLocaleString()}**${diff(base.atk, final.atk)}`,
    `🛡️ DEF — **${final.def.toLocaleString()}**${diff(base.def, final.def)}`,
    `💨 SPD — **${final.spd}**${diff(base.spd, final.spd)}`,
    "",
    `🎯 Crit Rate — **${pct(final.critRate)}**${bonuses.critRateBonus > 0 ? `  *(+${pct(bonuses.critRateBonus)})*` : ""}`,
    `💥 Crit DMG — **${pct(final.critDmg)}**${bonuses.critDmgBonus > 0 ? `  *(+${pct(bonuses.critDmgBonus)})*` : ""}`,
    `${elementEmoji} Elem DMG Bonus — **${pct(final.elemDmgBonus)}**`,
    `⚡ Energy / turn — **${final.energyPerTurn}**`,
    final.lifesteal > 0 ? `🩸 Lifesteal — **${pct(final.lifesteal)}**` : null,
  ].filter((line): line is string => line !== null).join("\n");
}

export interface ClassifiedBonusLabels {
  effects: string[];
  weapon: string[];
  echoes: string[];
  abilities: string[];
}

/** Splits resolver labels into source categories without changing their text. */
export function classifyBonusLabels(labels: string[]): ClassifiedBonusLabels {
  const result: ClassifiedBonusLabels = { effects: [], weapon: [], echoes: [], abilities: [] };
  for (const label of labels) {
    if (label.startsWith("🗡️")) result.weapon.push(label);
    else if (label.startsWith("◈ Echo Stats")) result.echoes.push(label);
    else if (label.startsWith("✦ Unique")) result.abilities.push(label);
    else result.effects.push(label);
  }
  return result;
}

export interface CharacterKitDisplay {
  basicLevel: number;
  basicMultiplier: number;
  skillLevel: number;
  skillCooldownTurns: number;
  ultimateLevel: number;
  introLevel: number;
  forteLevel: number;
  constellation: number;
  maxConstellation: number;
}

/** Compact kit summary for the stats embed; full kit text remains on /character. */
export function formatCharacterKitLines(kit: CharacterKitDisplay): string[] {
  const skillTiming = kit.skillCooldownTurns === 0
    ? "no cooldown"
    : `${kit.skillCooldownTurns}-turn cooldown`;
  return [
    `⚔️ Basic — Lv${kit.basicLevel} · ×${kit.basicMultiplier.toFixed(2)} ATK`,
    `✦ Skill — Lv${kit.skillLevel} · ${skillTiming}`,
    `⚡ Ultimate — Lv${kit.ultimateLevel}`,
    `🔷 Intro — Lv${kit.introLevel}`,
    `🌟 Forte — Lv${kit.forteLevel}`,
    `📜 Resonance Chain — C${kit.constellation}/${kit.maxConstellation}`,
  ];
}

/** Discord embed field values must stay within this limit. */
export function truncateDiscordField(value: string, maxLength = 1_024): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…".slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}

/** Discord sends a user option's ID as the raw autocomplete option value. */
export function autocompleteTargetUserId(optionValue: unknown, fallbackUserId: string): string {
  return typeof optionValue === "string" && optionValue.length > 0 ? optionValue : fallbackUserId;
}
