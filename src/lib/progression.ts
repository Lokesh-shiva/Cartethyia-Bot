import prisma from "./prisma";
import { EmbedBuilder, TextChannel, ThreadChannel } from "discord.js";

// ── Milestone definitions ─────────────────────────────────────────────────────

interface Milestone { title: string; lines: string[] }

const MILESTONES: Record<number, Milestone> = {
  3:  { title: "Dungeons Unlocked", lines: [
    "› `/dungeon` — **Resonance Forge** (Tuning Modules) and **Memory Vault** (Resonance Records) are now open.",
  ]},
  5:  { title: "Echo Farming Unlocked", lines: [
    "› `/dungeon` — All **Echo Dungeons** now available. Farm element-matched echoes.",
    "› `/dungeon` — **Sealed Archive** (Sealing Tubes) and **Forging Grounds** (Forging Ores) unlocked.",
    "› `/field-boss` — Fight any of 6 elemental **Field Bosses** for guaranteed 4-cost echoes. No WL required.",
  ]},
  15: { title: "First Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Wraith's Trial** — Face the Resonant Wraith for a guaranteed **4-cost Havoc Echo**. (2 ◈ Aura)",
  ]},
  20: { title: "Ascension Trial Unlocked", lines: [
    "› `/ascend` — Challenge the **Resonant Wraith** to break your level cap and advance to WL1.",
    "› Choose your **Elemental Resonance** to unlock passive stat bonuses and combat hooks.",
  ]},
  25: { title: "Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Tidecaller's Trial** *(requires WL1)* — 4-cost Glacio Echo on win. (2 ◈ Aura)",
  ]},
  30: { title: "Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Embercrown's Trial** *(requires WL1)* — **4-cost Fusion Echo** on win. (2 ◈ Aura)",
  ]},
  35: { title: "Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Arbiter's Trial** *(requires WL2)* — 4-cost Electro Echo on win. (2 ◈ Aura)",
  ]},
  45: { title: "Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Nullfire's Trial** *(requires WL3)* — 4-cost Electro Echo on win. (2 ◈ Aura)",
  ]},
  50: { title: "Boss Trial Unlocked · Ability Evolution Available", lines: [
    "› `/dungeon` → **Galeborne's Trial** *(requires WL3)* — **4-cost Aero Echo** on win. (2 ◈ Aura)",
    "› 🌀 `/evolve` — **Ability Evolution** is now unlocked! Evolve your unique passive into a legendary form with 1.3× amplified effects and a 4th combat primitive.",
  ]},
  60: { title: "Ego Weapon Awakening Available", lines: [
    "› ✦ `/awaken` — **Ego Weapon Awakening** is now unlocked! Transform your equipped weapon into its Ego form — amplified stats, a new AI-generated effect, and a Weapon Bond that grows through combat.",
    "› *Requires evolved unique ability and an equipped weapon.*",
  ]},
  55: { title: "Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Sable Harbinger's Trial** *(requires WL4)* — 4-cost Havoc Echo on win. (2 ◈ Aura)",
  ]},
  65: { title: "Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Auric Colossus' Trial** *(requires WL5)* — 4-cost Spectro Echo on win. (2 ◈ Aura)",
  ]},
  70: { title: "Boss Trial Unlocked", lines: [
    "› `/dungeon` → **Embercrown's Trial** *(requires WL6)* — 4-cost Fusion Echo on win. (2 ◈ Aura)",
  ]},
  80: { title: "Final Trial Unlocked", lines: [
    "› `/dungeon` → **Trial of the Absolute** *(requires WL7)* — Face the Resonant Absolute. The hardest challenge. (2 ◈ Aura)",
  ]},
};

/**
 * Send any milestone unlock notifications for levels crossed between oldLevel and newLevel.
 * Also sends a level cap notification if the player just hit their cap.
 * Call this after every checkLevelUp() — from chat EXP, records, dungeon rewards, etc.
 */
export async function sendMilestoneNotifications(
  channel: TextChannel | ThreadChannel,
  oldLevel: number,
  newLevel: number,
  hitCapAt: number | null,
): Promise<void> {
  const triggered: Milestone[] = [];
  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    if (MILESTONES[lvl]) triggered.push(MILESTONES[lvl]);
  }

  for (const m of triggered) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xFCD34D)
        .setTitle(`✦  ${m.title}`)
        .setDescription(m.lines.join("\n"))
        .setFooter({ text: `CARTETHYIA  ·  Level ${newLevel} Milestone` })],
    }).catch(() => {});
  }

  if (hitCapAt !== null) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xEC4899)
        .setTitle("◈  Level Cap Reached")
        .setDescription(
          `You've hit the **Level ${hitCapAt}** cap for your current World Level.\n\n` +
          `› Use \`/ascend\` to challenge the next boss and break through.\n` +
          `› EXP will not accumulate until you ascend.`
        )
        .setFooter({ text: "CARTETHYIA  ·  Ascension System" })],
    }).catch(() => {});
  }
}

// ── EXP thresholds per level ──────────────────────────────────────────────────
// Level cap per World Level: WL0→20, WL1→40, WL2→60... WL8→90 (max 90)
export const WORLD_LEVEL_CAPS: Record<number, number> = {
  0: 20, 1: 40, 2: 50, 3: 60, 4: 70, 5: 80, 6: 84, 7: 88, 8: 90, 9: 90,
};

// EXP needed to reach the next level (scales quadratically)
export function expToNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.6));
}

// Total EXP accumulated to reach a given level from 1
export function totalExpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += expToNextLevel(l);
  return total;
}

export interface LevelUpResult {
  didLevelUp:  boolean;
  oldLevel:    number;
  newLevel:    number;
  hitCapAt:    number | null; // if capped, the cap they hit
}

/**
 * Check if a user should level up after gaining EXP.
 * Called after any EXP award. Handles multiple level-ups at once.
 */
export async function checkLevelUp(userId: string): Promise<LevelUpResult> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { level: true, resonanceExp: true, worldLevel: true },
  });
  if (!user) return { didLevelUp: false, oldLevel: 1, newLevel: 1, hitCapAt: null };

  const cap     = WORLD_LEVEL_CAPS[user.worldLevel] ?? 20;
  const oldLevel = user.level;
  let   level    = user.level;
  let   exp      = user.resonanceExp;

  while (level < cap) {
    const needed = expToNextLevel(level);
    if (exp < needed) break;
    exp -= needed;
    level++;
  }

  // Hit the cap — clamp exp at 0 so it doesn't overflow
  const hitCapAt = level >= cap && level === cap ? cap : null;

  if (level === oldLevel) return { didLevelUp: false, oldLevel, newLevel: level, hitCapAt };

  const levelsGained  = level - oldLevel;
  const oldMilestone  = Math.floor(oldLevel / 5);
  const newMilestone  = Math.floor(level    / 5);
  const recordBonus   = newMilestone - oldMilestone; // 1 record per 5-level milestone

  await prisma.user.update({
    where: { id: userId },
    data: {
      baseHp:           { increment: levelsGained * 126 },
      baseAtk:          { increment: levelsGained * 4   },
      baseDef:          { increment: levelsGained * 11  },
      baseSpeed:        { increment: levelsGained * 1  },
      resonanceRecords: recordBonus > 0 ? { increment: recordBonus } : undefined,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data:  { level, resonanceExp: exp },
  });

  return { didLevelUp: true, oldLevel, newLevel: level, hitCapAt };
}

/**
 * EXP progress bar string for the /level command.
 * e.g.  ▰▰▰▰▰▰▱▱▱▱  60%
 */
export function expProgressBar(currentExp: number, level: number, worldLevel: number): {
  bar: string; percent: number; current: number; needed: number; capped: boolean;
} {
  const cap    = WORLD_LEVEL_CAPS[worldLevel] ?? 20;
  const capped = level >= cap;

  if (capped) {
    return { bar: "▰▰▰▰▰▰▰▰▰▰", percent: 100, current: 0, needed: 0, capped: true };
  }

  const needed  = expToNextLevel(level);
  const percent = Math.min(100, Math.floor((currentExp / needed) * 100));
  const filled  = Math.round(percent / 10);
  const bar     = "▰".repeat(filled) + "▱".repeat(10 - filled);

  return { bar, percent, current: currentExp, needed, capped: false };
}
