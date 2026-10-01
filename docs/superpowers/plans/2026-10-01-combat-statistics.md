# Combat Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live and final combat statistics for damage taken, damage done, direct healing, lifesteal healing, vibration damage, and shatters across all combat modes and raids.

**Architecture:** Add a small pure `CombatStats` module with recording, aggregation, and formatting helpers. Each combat loop owns one stats object, while raids store one on each participant; existing mutation points update the record and existing status/final embeds render it. No database schema or persistent profile changes are needed.

**Tech Stack:** TypeScript, CommonJS, discord.js v14 embeds, `tsx` disposable scripts, Node `assert`.

**Spec:** `docs/superpowers/specs/2026-10-01-combat-statistics-design.md`

## Global Constraints

- Stats are ephemeral and reset at the beginning of each combat.
- `healed` excludes lifesteal; `lifesteal` is reported separately.
- Healing and lifesteal count actual HP restored, not overhealing.
- Damage done excludes damage absorbed entirely by a boss shield.
- Vibration damage is the actual vibration-bar reduction, including explicit bonus drains.
- Shatters count only active-bar-to-shattered transitions.
- Existing rewards, mechanics, and combat turn order remain unchanged.

## Review Focus

- A direct heal at full HP must not inflate `healed`; test the shared recorder's actual-gain behavior.
- Lifesteal must increment only `lifesteal`, never `healed`; test the two counters separately.
- A vibration drain capped by the remaining bar must count only the capped amount; test the shared recorder.
- A raid with no participants or zero-valued stats must still format a valid summary; test aggregation/formatting.
- A boss shield absorbing damage must not inflate `damageDone`; verify the raid damage path uses post-shield HP loss.

---

### Task 1: Shared combat-statistics primitives

**Files:**
- Create: `src/lib/combatStats.ts`
- Create: `scripts/test-combat-stats.ts`

**Interfaces:**
- `CombatStats`, `emptyCombatStats()`, `addCombatStats()`, `recordDamageDone()`, `recordDamageTaken()`, `recordDirectHeal()`, `recordLifesteal()`, `recordVibrationDamage()`, `recordShatter()`, `formatCombatStats()`, `formatCombatStatsSummary()`.

- [x] **Step 1: Write the failing tests** for actual HP gain/loss, separate heal/lifesteal counters, capped vibration damage, shatter increments, aggregation, and formatter labels.
- [x] **Step 2: Run the test command and confirm the expected missing-module failure.**
- [x] **Step 3: Implement the minimal pure helpers.** Use before/after HP values for actual gain/loss and `Math.max(0, before - after)` for damage/vibration deltas.
- [x] **Step 4: Run the script again and confirm it passes.**

### Task 2: Solo and team-enabled battle loops

**Files:**
- Modify: `src/lib/encounter.ts`
- Modify: `src/commands/rpg/ascend.ts`
- Modify: `src/commands/rpg/boss.ts`
- Modify: `src/commands/rpg/dungeon.ts`
- Modify: `src/commands/rpg/field-boss.ts`

**Interfaces:**
- Consume the shared `CombatStats` helpers.
- Add one ephemeral stats record per battle and include its formatted line in the existing live battle status.
- Add a final summary to victory/defeat messages, including direct healing and lifesteal separately.

- [x] **Step 1:** Add the stats import and initialize the record at each loop's battle-state creation.
- [x] **Step 2:** Record player/ally damage at final enemy-HP mutations, actual HP loss after boss attacks, and direct/lifesteal HP gain at existing authoritative mutations.
- [x] **Step 3:** Record vibration deltas immediately around existing vibration mutations and increment shatters at existing transition checks.
- [x] **Step 4:** Add the compact live line to the existing battle-card/status helper and the full summary to every win/loss path.
- [x] **Step 5:** Run the TypeScript compiler and shared-stat script.

### Task 3: Duels

**Files:**
- Modify: `src/commands/rpg/duel.ts`

**Interfaces:**
- Store one `CombatStats` record per duel side.
- Render both sides' live stats and both final summaries from the shared formatter.

- [x] **Step 1:** Initialize challenger and defender stat records with the duel state.
- [x] **Step 2:** Record each side's damage, actual taken damage, direct healing, lifesteal, and reactive damage at the existing mutation points. Duels have no vibration bar, so vibration and shatter remain zero.
- [x] **Step 3:** Add both sides to live duel embeds and final win/loss embeds.
- [x] **Step 4:** Run the shared script and TypeScript compiler.

### Task 4: Raids

**Files:**
- Modify: `src/commands/rpg/raid.ts`

**Interfaces:**
- Add `combatStats: CombatStats` to `RaidParticipant`; retain `dmgDealt` only if other code still needs it, otherwise replace its display usage with `combatStats.damageDone`.
- Add a party-total aggregation helper to the raid embed and final result.

- [x] **Step 1:** Initialize each participant's stats when they join the raid.
- [x] **Step 2:** Record player damage after boss-shield absorption, boss damage taken after mitigation/shields, direct healing, lifesteal, shared vibration reductions, and shatter transitions.
- [x] **Step 3:** Add a compact party-total line to live raid embeds.
- [x] **Step 4:** Replace damage-only standings with per-participant six-stat rows plus a `TOTAL` row in both victory and defeat summaries.
- [x] **Step 5:** Run the shared script and TypeScript compiler.

### Task 5: Verification and review

**Files:**
- Modify only files required by fixes found during verification.

- [x] **Step 1:** Re-read the spec and check every requested metric in live and final displays for solo, duel, and raid paths.
- [x] **Step 2:** Run the shared combat-stat test.
- [x] **Step 3:** Run the TypeScript compiler.
- [x] **Step 4:** Inspect `git diff --check` and `git status --short`, confirming `.claude/settings.local.json` remains unrelated and untouched.
