import * as fs   from "fs";
import * as path from "path";
import { EchoDefinition, ELEMENT_COLORS } from "./echoes";
import { Boss }                           from "./bosses";
import { CE }                             from "./emojiManager";

// ── Element weakness table ────────────────────────────────────────────────────
export const COUNTER_ELEMENT: Record<string, string> = {
  FUSION:  "GLACIO",
  GLACIO:  "FUSION",
  ELECTRO: "AERO",
  AERO:    "ELECTRO",
  HAVOC:   "SPECTRO",
  SPECTRO: "HAVOC",
  NONE:    "NONE",
};

// ── Unicode HP / energy bar ───────────────────────────────────────────────────
export function hpBar(current: number, max: number, width = 18): string {
  const fill  = Math.max(0, Math.min(width, Math.round((current / max) * width)));
  const empty = width - fill;
  const pct   = Math.round((current / max) * 100);
  const bar   = "█".repeat(fill) + "░".repeat(empty);
  return `\`${bar}\` ${pct}%`;
}

export function energyBar(energy: number, width = 10): string {
  const fill = Math.max(0, Math.min(width, Math.round((energy / 100) * width)));
  return "▰".repeat(fill) + "▱".repeat(width - fill);
}

// ── Damage calculation ────────────────────────────────────────────────────────
export interface DamageResult {
  damage:   number;
  isCrit:   boolean;
  isWeak:   boolean;
}

export function calcPlayerDamage(
  baseAtk:   number,
  def:       number,
  critRate:  number,
  critDmg:   number,
  mult:      number,        // 1.0 basic, 1.8 skill, 3.5 ult
  weakBonus: boolean,
  shattered: boolean,
): DamageResult {
  const effectiveDef = shattered ? 0 : def;
  const isCrit       = Math.random() < critRate;
  const weakMult     = weakBonus ? 1.5 : 1.0;
  const damage       = Math.max(1, Math.floor(
    (baseAtk * mult - effectiveDef * 0.5) * (isCrit ? critDmg : 1) * weakMult
  ));
  return { damage, isCrit, isWeak: weakBonus };
}

// DEF uses a divisor model (WuWa/Genshin-style): diminishing returns, never immune.
// reduction = DEF / (DEF + 600), clamped to 75% max so squishies always take some damage.
export function calcEnemyDamage(enemyAtk: number, playerDef: number, moveMult: number): number {
  const reduction = Math.min(0.75, playerDef / (playerDef + 600));
  return Math.max(1, Math.floor(enemyAtk * moveMult * (1 - reduction)));
}

// ── Resolve echo art path (absolute) ─────────────────────────────────────────
function resolveEchoArt(enemy: EchoDefinition): string {
  const sub  = `${enemy.cost}-cost`;
  const full = path.join(process.cwd(), "assets", "echoes", sub, `${enemy.name}.png`);
  if (fs.existsSync(full)) return full;
  // fallback: snake_case at root
  const snake = path.join(process.cwd(), "assets", "echoes", enemy.assetFile.replace(".svg", ".png"));
  return fs.existsSync(snake) ? snake : "";
}

// ── Convert EchoDefinition → a Boss-shaped object for the battle card ─────────
export function echoToBoss(enemy: EchoDefinition): Boss {
  const weakness = COUNTER_ELEMENT[enemy.element] ?? "NONE";
  return {
    id:        enemy.name.toLowerCase().replace(/\s+/g, "_"),
    name:      enemy.name,
    title:     `${enemy.cost}-Cost Echo · ${enemy.element}`,
    worldLevel: 0,
    element:   enemy.element,
    weakness,
    artFile:   resolveEchoArt(enemy), // absolute path — battleCard.ts accepts this
    baseHp:    enemy.hp,
    baseAtk:   enemy.atk,
    baseDef:   enemy.def,
    vibBar:    50,
    moves: [
      { name: "Resonance Pulse", damage: 1.0, effect: "strikes with raw elemental force" },
      { name: "Echo Burst",      damage: 1.3, effect: "releases a burst of echo energy"  },
    ],
    defeatLoot: { credits: 0, tuningModules: 0, sealingTubes: 0, forgingOres: 0, paradoxCores: 0, fractureKeys: 0, stasisLocks: 0, resonanceExp: 0 },
  };
}

// ── Gear-aware enemy scaling ──────────────────────────────────────────────────
// Baseline ATK a player would have at `level` with NO gear (level curve only).
export function baselineAtk(level: number): number {
  return 50 + 3 * Math.max(0, level - 1);
}

// Scale an enemy so fights stay challenging regardless of gear.
// gearRatio = player's resolved ATK / their no-gear baseline.
// HP tracks gear aggressively. ATK also scales with player gear (at 40% weight) so
// geared players can't just tank forever — the boss hits back harder.
export function gearAwareScale(
  base: { hp: number; atk: number; def: number },
  playerLevel: number, worldLevel: number, gearRatio: number,
  levelWeight = 0.50, gearWeight = 0.75,
): { hp: number; atk: number; def: number } {
  // Boss base stats already grow with WL — these multipliers are a NUDGE on top,
  // not the progression itself. Every axis is hard-capped: uncapped, the stacked
  // level × WL × gear terms reached ~30× ATK at WL5+ (one-shot territory) while
  // boss HP ballooned past 300k and DEF erased the player's flat damage.
  const levelScale    = Math.min(1 + (playerLevel / 20) * levelWeight + worldLevel * 0.22, 2.2);
  const cappedHpRatio = Math.min(gearRatio, 2.0);
  const hpGearScale   = 1 + Math.max(0, cappedHpRatio - 1) * gearWeight;
  const cappedAtkRatio = Math.min(gearRatio, 2.5);
  const atkGearScale  = 1 + Math.max(0, cappedAtkRatio - 1) * 0.40; // boss hits harder vs geared players
  const hpScale  = Math.min(levelScale * hpGearScale, 2.0);
  const atkScale = Math.min(levelScale * (1 + worldLevel * 0.12) * atkGearScale, 1.7);
  const defScale = Math.min(levelScale, 1.5);
  return {
    hp:  Math.max(1, Math.floor(base.hp  * hpScale)),
    atk: Math.max(1, Math.floor(base.atk * atkScale)),
    def: Math.max(0, Math.floor(base.def * defScale)),
  };
}

// ── Shared reward text builder ────────────────────────────────────────────────
export function buildRewardText(rewards: Record<string, number>): string {
  const lines: string[] = [];
  if (rewards.credits)          lines.push(`${CE.cr} ${rewards.credits} Credits`);
  if (rewards.tuningModules)    lines.push(`${CE.tm} ${rewards.tuningModules} Tuning Modules`);
  if (rewards.sealingTubes)     lines.push(`${CE.st} ${rewards.sealingTubes} Sealing Tubes`);
  if (rewards.forgingOres)      lines.push(`${CE.fo} ${rewards.forgingOres} Forging Ores`);
  if (rewards.paradoxCores)     lines.push(`${CE.pc} ${rewards.paradoxCores} Paradox Cores`);
  if (rewards.stasisLocks)      lines.push(`${CE.sl} ${rewards.stasisLocks} Stasis Lock${rewards.stasisLocks !== 1 ? "s" : ""}`);
  if (rewards.resonanceRecords) lines.push(`${CE.rr} ${rewards.resonanceRecords} Resonance Records`);
  if (rewards.fractureKeys)     lines.push(`${CE.fk} ${rewards.fractureKeys} Fracture Keys`);
  if (rewards.resonanceExp)     lines.push(`✨ ${rewards.resonanceExp} EXP`);
  return lines.join("  ·  ") || "Nothing";
}
