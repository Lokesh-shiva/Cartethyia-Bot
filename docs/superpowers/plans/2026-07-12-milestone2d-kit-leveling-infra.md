# Milestone 2d — Kit-Leveling Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-character kit levels (Basic/Skill/Ultimate/Intro/Forte, max Lv10 each) and let a player spend existing Forging Ores to raise them, via a new generic `/character` command. Zero combat effect yet — that's Milestone 2e.

**Architecture:** One new Prisma model (`CharacterProgress`, generic/character-agnostic via a `characterId` string field), one new data/logic module (`src/lib/characterProgress.ts` — cost curve + lazy row lookup, isolated as its own function per the design spec's explicit forward-compat note), one new command (`src/commands/rpg/character.ts`, mirroring `/guide`'s select-menu-swaps-embed pattern and `/weapon-upgrade`'s currency-transaction pattern). See the [design spec](../specs/2026-07-12-milestone2d-kit-leveling-infra-design.md) for full rationale.

**Explicitly deferred to their own follow-up plans, not built here:**
- Wiring levels into actual combat effects (Milestone 2e) — leveling a track only changes a database number in this milestone.
- The weekly-capped material economy, including the "levels 7-10 require the weekly item" gate noted in the design spec §3 — not implemented, but the cost-curve function is isolated so it can be extended later without restructuring.

**Tech Stack:** TypeScript, Prisma v7 (adapter-only, no `url` in datasource — after the schema change: `npm run db:push` then `npx prisma generate`, per this project's established gotcha).

---

### Task 1: Prisma Schema — `CharacterProgress` Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the `CharacterProgress` model**

Find the end of the `User` model's relations block:
```prisma
  combatSessions   CombatSession[]
  dungeonCooldowns DungeonCooldown[]
  bossCooldowns    BossCooldown[]
```

Replace with:
```prisma
  combatSessions   CombatSession[]
  dungeonCooldowns DungeonCooldown[]
  bossCooldowns    BossCooldown[]
  characterProgress CharacterProgress[]
```

Then find the end of the file (or a sensible location near other small standalone models — check the file for where similarly-sized models like `BossCooldown` are defined and place this near them for consistency) and add:

```prisma
// Milestone 2d — out-of-combat kit-leveling (Basic/Skill/Ultimate/Intro/Forte).
// characterId is a free string ("solace" today) rather than a foreign key to
// a Character table, because no such table exists yet (no gacha/ownership
// system) — see design spec docs/superpowers/specs/2026-07-12-milestone2d-kit-leveling-infra-design.md §2.
model CharacterProgress {
  id            String @id @default(cuid())
  userId        String
  user          User   @relation(fields: [userId], references: [id])
  characterId   String // "solace" for now; future characters use their own id string

  basicLevel    Int @default(1)
  skillLevel    Int @default(1)
  ultimateLevel Int @default(1)
  introLevel    Int @default(1)
  forteLevel    Int @default(1)
  // Outro deliberately excluded — per design spec, it does not level.

  @@unique([userId, characterId])
  @@map("character_progress")
}
```

- [ ] **Step 2: Push schema and regenerate the Prisma client**

Run:
```bash
npm run db:push
npx prisma generate
```
Expected: both succeed with no errors. `db:push` should report the new `character_progress` table being created.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(teams): add CharacterProgress model for kit-leveling (Milestone 2d)"
```

---

### Task 2: Kit-Leveling Logic Module

**Files:**
- Create: `src/lib/characterProgress.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/lib/characterProgress.ts
// Generic kit-leveling logic — persistence lookup + cost curve. Character-
// agnostic (works for any characterId), mirroring the same "generic
// primitive, character-specific data elsewhere" split established by
// forte.ts in Milestone 2c. See design spec
// docs/superpowers/specs/2026-07-12-milestone2d-kit-leveling-infra-design.md.

import prisma from "./prisma";
import { CharacterProgress } from "@prisma/client";

export const MAX_KIT_LEVEL = 10;

export type KitTrack = "basic" | "skill" | "ultimate" | "intro" | "forte";

// Maps a track key to its CharacterProgress column name. Exported and
// centralized here so every call site (the /character command, and
// eventually Milestone 2e's combat wiring) reads the same mapping rather
// than each hardcoding field names — a duplicate copy of this map drifting
// out of sync would be a real, easy-to-miss bug.
export const TRACK_FIELD: Record<KitTrack, "basicLevel" | "skillLevel" | "ultimateLevel" | "introLevel" | "forteLevel"> = {
  basic:    "basicLevel",
  skill:    "skillLevel",
  ultimate: "ultimateLevel",
  intro:    "introLevel",
  forte:    "forteLevel",
};

export function getTrackLevel(progress: CharacterProgress, track: KitTrack): number {
  return progress[TRACK_FIELD[track]];
}

// Cost to raise a track FROM `currentLevel` to `currentLevel + 1`, in Forging
// Ores. Isolated as its own function (not inlined in the command handler) so
// a future milestone can add the "levels 7-10 require a weekly-capped item"
// gate (design spec §3) without restructuring the leveling flow — that gate
// would likely become a second return value or a parallel check here, not a
// rewrite of every call site.
export function kitLevelUpCost(currentLevel: number): number {
  return currentLevel;
}

export function totalCostToMax(currentLevel: number): number {
  let total = 0;
  for (let l = currentLevel; l < MAX_KIT_LEVEL; l++) total += kitLevelUpCost(l);
  return total;
}

// Fetches a player's progress for a character, creating a fresh Lv1-everywhere
// row on first access rather than provisioning rows for every player upfront.
export async function getOrCreateCharacterProgress(userId: string, characterId: string): Promise<CharacterProgress> {
  const existing = await prisma.characterProgress.findUnique({
    where: { userId_characterId: { userId, characterId } },
  });
  if (existing) return existing;
  return prisma.characterProgress.create({
    data: { userId, characterId },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors. (If `prisma.characterProgress` or the `userId_characterId` compound-unique lookup name isn't recognized, this means Task 1's `npx prisma generate` needs to be re-run in this task's environment — run it and retry. Prisma's auto-generated compound-unique input name follows the pattern `<fieldA>_<fieldB>` from the `@@unique([userId, characterId])` declaration, so it should be exactly `userId_characterId`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/characterProgress.ts
git commit -m "feat(teams): add kit-leveling logic module (Milestone 2d)"
```

---

### Task 3: `/character` Command

**Files:**
- Create: `src/commands/rpg/character.ts`

**Context:** Mirrors two existing proven patterns in this codebase: `/guide`'s select-menu-swaps-embed-in-place flow (`src/commands/utility/guide.ts`) and `/weapon-upgrade`'s currency-spend transaction (`src/commands/rpg/weapon-upgrade.ts`, uses `prisma.$transaction([...])` + `auditSpend`). Read both files first if anything below is unclear about the exact API shape (`Command` type, `replyNotStarted`, `CE.fo` emoji getter, `auditSpend` signature).

- [ ] **Step 1: Write the command**

```typescript
// src/commands/rpg/character.ts
// Milestone 2d — the seed of the eventual multi-page character profile
// (design spec §9: Stats/Weapon/Echoes/Kit Levels/Constellations/Lore). This
// milestone only implements the Kit Levels page. Deliberately named
// /character (not /solace-kit) so future characters slot into the same
// command's select menu without a new command being added each time.

import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { auditSpend } from "../../lib/antiCheat";
import { CE } from "../../lib/emojiManager";
import {
  MAX_KIT_LEVEL, KitTrack, TRACK_FIELD, getTrackLevel, kitLevelUpCost,
  getOrCreateCharacterProgress,
} from "../../lib/characterProgress";

// Only "solace" exists today — future characters add entries here, and the
// select menu below automatically grows to offer them. No other code in this
// file needs to change when that happens.
const CHARACTERS: Record<string, { label: string; emoji: string }> = {
  solace: { label: "Solace", emoji: "✨" },
};

const TRACK_LABELS: Record<KitTrack, string> = {
  basic:    "⚔️  Chime Strike",
  skill:    "✦  Attunement",
  ultimate: "⚡  Convergence",
  intro:    "🔷  Intro Skill",
  forte:    "🌟  Forte",
};

async function buildKitLevelsView(userId: string, characterId: string) {
  const [progress, dbUser] = await Promise.all([
    getOrCreateCharacterProgress(userId, characterId),
    prisma.user.findUnique({ where: { id: userId }, select: { forgingOres: true } }),
  ]);
  const ores = dbUser?.forgingOres ?? 0;
  const char = CHARACTERS[characterId];

  const tracks: KitTrack[] = ["basic", "skill", "ultimate", "intro", "forte"];
  const lines = tracks.map(t => {
    const lvl = getTrackLevel(progress, t);
    const maxed = lvl >= MAX_KIT_LEVEL;
    const cost = maxed ? null : kitLevelUpCost(lvl);
    return `${TRACK_LABELS[t]} — **Lv ${lvl}/${MAX_KIT_LEVEL}**` +
      (maxed ? "" : `  ·  ${cost}${CE.fo} to Lv ${lvl + 1}`);
  });

  const embed = new EmbedBuilder()
    .setColor(0x6366F1)
    .setTitle(`${char.emoji}  ${char.label} — Kit Levels`)
    .setDescription(`You have **${ores}${CE.fo} Forging Ores**.\n\n${lines.join("\n")}`)
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Kit Levels" });

  const trackButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    tracks.map(t => {
      const lvl = getTrackLevel(progress, t);
      const maxed = lvl >= MAX_KIT_LEVEL;
      const cost = maxed ? 0 : kitLevelUpCost(lvl);
      return new ButtonBuilder()
        .setCustomId(`charlvl:${characterId}:${t}`)
        .setLabel(maxed ? `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (MAX)` : `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (${cost}${"⛭"})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(maxed || ores < cost);
    })
  );

  return { embed, trackButtons };
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("character")
    .setDescription("View and level up your characters' kits.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const dbUser = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { id: true } });
    if (!dbUser) { await replyNotStarted(interaction); return; }

    const select = new StringSelectMenuBuilder()
      .setCustomId("character_cmd_select")
      .setPlaceholder("Choose a character…")
      .addOptions(
        Object.entries(CHARACTERS).map(([value, c]) => ({
          label: `${c.emoji}  ${c.label}`,
          value,
        }))
      );
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const overview = new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("◈  Characters")
      .setDescription("Select a character to view their Kit Levels.")
      .setFooter({ text: "CARTETHYIA  ·  Character" });

    await interaction.editReply({ embeds: [overview], components: [selectRow] });

    const collector = interaction.channel?.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id &&
        (i.customId === "character_cmd_select" || i.customId.startsWith("charlvl:")),
      time: 5 * 60 * 1000,
    });

    collector?.on("collect", async i => {
      if (i.customId === "character_cmd_select" && i.isStringSelectMenu()) {
        const sel = i as StringSelectMenuInteraction;
        const characterId = sel.values[0];
        if (!CHARACTERS[characterId]) { await sel.deferUpdate().catch(() => {}); return; }
        const { embed, trackButtons } = await buildKitLevelsView(interaction.user.id, characterId);
        await sel.update({ embeds: [embed], components: [selectRow, trackButtons] }).catch(() => {});
        return;
      }

      if (i.customId.startsWith("charlvl:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, track] = btn.customId.split(":") as [string, string, KitTrack];

        // Never trust the disabled-button state alone — re-verify affordability
        // and max-level server-side, since the message could be stale.
        const [progress, dbUser2] = await Promise.all([
          getOrCreateCharacterProgress(interaction.user.id, characterId),
          prisma.user.findUnique({ where: { id: interaction.user.id }, select: { forgingOres: true } }),
        ]);
        const lvl  = getTrackLevel(progress, track);
        const ores = dbUser2?.forgingOres ?? 0;
        const cost = kitLevelUpCost(lvl);

        if (lvl >= MAX_KIT_LEVEL || ores < cost) {
          await btn.deferUpdate().catch(() => {});
          return;
        }

        await prisma.$transaction([
          prisma.user.update({ where: { id: interaction.user.id }, data: { forgingOres: { decrement: cost } } }),
          prisma.characterProgress.update({
            where: { userId_characterId: { userId: interaction.user.id, characterId } },
            data:  { [TRACK_FIELD[track]]: { increment: 1 } },
          }),
        ]);
        auditSpend(interaction.user.id, { forgingOres: cost }, "character-kit-level");

        const { embed, trackButtons } = await buildKitLevelsView(interaction.user.id, characterId);
        await btn.update({ embeds: [embed], components: [selectRow, trackButtons] }).catch(() => {});
      }
    });

    collector?.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
```

**Note for the implementer**: read `src/commands/utility/guide.ts` and `src/commands/rpg/weapon-upgrade.ts` in full before starting — this task's code above is written to match their conventions, but the exact `Command` type shape, import paths, and end-of-collector cleanup behavior should be verified against those real files rather than assumed. If the `Command` type or export shape (`export default command` vs `export const data`/`export async function execute`) doesn't match what's shown above, follow the ACTUAL convention used by sibling files in `src/commands/rpg/` — this project's command auto-discovery (per `npm run deploy`) depends on getting that shape right.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Deploy the new command**

Run: `npm run deploy` (dev-guild deploy — this command is NOT dev-guild-gated in its logic, but slash commands still need registering to become visible; use the project's normal non-global deploy for local testing, matching how every other new command in this codebase gets registered)

- [ ] **Step 4: Commit**

```bash
git add src/commands/rpg/character.ts
git commit -m "feat(teams): add /character command for kit-leveling (Milestone 2d)"
```

---

### Task 4: Verification

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Manual — deploy and playtest**

On the VM: `git pull && npm run build && npm run db:push && npx prisma generate && pm2 restart cartethyia`, then run `npm run deploy` once (or `GLOBAL=true npm run deploy` per the project's normal release process) so the new `/character` command is registered.

Run `/character` and verify:
- [ ] Selecting Solace shows her Kit Levels view: all 5 tracks at Lv1/10, correct cost (1 Ore) shown for each, current Forging Ore balance shown correctly
- [ ] Leveling up a track spends the correct amount of Forging Ores, increments that track to Lv2, and the embed updates in place (no new message)
- [ ] The cost shown for the next level-up updates correctly (Lv2→3 should now show cost 2)
- [ ] A track's button becomes disabled once its level reaches 10 (may need repeated testing or manually adjusting the DB row to verify without grinding — either is fine)
- [ ] A track's button becomes disabled (or the click is silently rejected) if the player doesn't have enough Forging Ores
- [ ] This command works in a non-dev-guild server too (it's intentionally not gated — confirm it's NOT accidentally gated behind `isDevGuild` anywhere)
- [ ] Running `/character` again later shows the previously-leveled progress persisted (not reset to Lv1)

- [ ] **Step 3: Report findings back**

Same as before — if something's off, tell me exactly what you saw and I'll fix it directly rather than re-planning from scratch.
