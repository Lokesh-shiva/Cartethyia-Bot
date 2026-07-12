# Milestone 2d — Kit-Leveling Infrastructure Design

**Status:** Approved, ready for planning.

## 1. What this is

The top-level [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) (§8) describes out-of-combat kit-leveling: Basic Attack, Skill (Attunement), Ultimate, Intro Skill, and the Forte node system each have their own individual level, raised via a single unified per-character material. This milestone builds the **infrastructure only** — persistence, currency spending, and a command surface to level up. It deliberately does NOT change what Solace's numbers actually do in combat; that's Milestone 2e.

**Explicitly deferred, not built here:**
- **Wiring levels into combat effects** (Milestone 2e) — right now leveling a track changes a number in the database and nothing else. What each level actually does to Chime Strike's damage, Attunement's bonus %, Convergence's heal, Intro's heal, or Forte's fill rate is 2e's job.
- **The weekly-capped material economy** from spec §8 — per explicit user direction, this stays deferred, but the design below is kept open-ended so it can be added later without reworking anything (see §3).
- **Constellations** ("Resonance Chain" in spec terminology) — separate system, still blocked on the missing gacha/ownership infrastructure. Not to be confused with kit-leveling, which has no spec name of its own beyond "Kit Levels."

## 2. Data model — generic, per-character-independent

No character has any DB-tracked level today — not even Solace, who is currently a hardcoded fixture with zero persisted state. Per explicit user direction, each character's progress must be tracked independently (leveling Solace never touches a future character's progress), which the generic `Forte` primitive's precedent already established for in-combat state. This carries the same principle into persistent DB state.

```prisma
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
  // Outro deliberately excluded — per spec §6/§8, it does not level.

  @@unique([userId, characterId])
  @@map("character_progress")
}
```

A row is created lazily (on first `/character` view or first level-up attempt) rather than eagerly for every player — mirrors how other per-player rows in this codebase are created on demand, not provisioned upfront for users who may never touch the feature.

## 3. Currency — reuse Forging Ores, no new drop source

Per explicit user direction: reuse the existing `forgingOres` balance on `User` (already used for weapon upgrades/dismantle) rather than adding a 9th currency. No new drop source is added in this milestone — players spend from their existing Forging Ore balance, sourced however they already earn it today (dungeon loot, dismantle refunds, etc.).

**Left open for later:** a future milestone could add a weekly-capped *additional* source of Forging Ores (e.g. a specific boss's new drop-table entry, capped at 3 kills/week × 3 items = 9/week, per spec §8's original target shape) without touching this milestone's code at all — `CharacterProgress` only tracks levels, never currency income, so the two stay fully decoupled. Nothing in this design assumes Forging Ores has a single source.

**Cost curve:** leveling a track from level N costs `N` Forging Ores (Lv1→2 costs 1, Lv9→10 costs 9). Maxing one track costs 45 Ores total (1+2+...+9); all 5 tracks to max costs 225 Ores. Max level is **10** for every track.

## 4. Command — `/character`, generic and select-driven

A new command, deliberately generic (not `/solace-kit` or similar) so future characters slot into the same command without a new one being added each time. Mirrors the exact select-menu-swaps-embed pattern already proven in `/guide` (`src/commands/utility/guide.ts`) — a `StringSelectMenu` + `createMessageComponentCollector` that updates the same message in place via `.update()`, no new messages per interaction.

**Flow:**
1. `/character` shows a character select dropdown. Only "Solace" is a valid option today — future characters are added as more options to this same menu, requiring no new command.
2. Selecting Solace swaps the embed to her **Kit Levels view**: all 5 tracks listed with current level (`Lv N/10`) and Forging Ore cost to level up once, plus the player's current Forging Ore balance shown prominently.
3. Below the embed, one button row (up to 5 buttons, one per track — Chime Strike/Attunement/Convergence/Intro/Forte), each labeled with its level-up cost (e.g. "Chime Strike (4⛭ → Lv5)"). A button is disabled if that track is already at Lv10, or if the player can't afford the cost.
4. Clicking a track's button: verifies affordability server-side (never trust the disabled-button state alone — a stale/cached message could show an outdated affordability check), decrements `forgingOres`, increments that track's level in `CharacterProgress`, and re-renders the same embed via `.update()`.
5. The character-select dropdown stays visible and functional throughout — selecting a (currently nonexistent) different character mid-session works once more characters exist, without any code changes to this flow.

This command is deliberately built as the seed of spec §9's eventual multi-page character profile (Stats/Weapon/Echoes/Kit Levels/Constellations/Lore) — this milestone only implements the Kit Levels page. The select-menu shell it's built on is the same shell that would carry the other pages once their underlying systems exist (gear/echo integration, Constellations, etc.) — not a throwaway command to be replaced later.

## 5. Testing

- `npx tsc --noEmit` clean, `npx prisma generate` succeeds after the schema change, `npm run db:push` applies cleanly to the dev database.
- No dev-guild gating needed for this command — it's pure data/currency spending, not a combat mechanic, so it's safe to ship to all servers immediately (unlike everything in Milestones 1/2a/2b/2c, which modify live combat math and stay gated).
- Manual Discord test: run `/character`, select Solace, confirm the Kit Levels view renders with correct starting values (all tracks Lv1, correct cost shown), level up a track, confirm the embed updates in place and Forging Ore balance decrements correctly, confirm a track disables correctly at Lv10 and when Forging Ores run out, confirm insufficient-balance clicks are rejected server-side even if a button briefly appears clickable.
