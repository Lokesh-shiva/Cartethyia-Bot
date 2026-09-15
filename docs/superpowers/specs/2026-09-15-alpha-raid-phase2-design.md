# Alpha Raid Phase 2 — Fight Engine & Rewards Design

## Goal

Build the piece explicitly deferred from the Phase 1 plan (`docs/superpowers/plans/2026-09-12-alpha-raid-implementation.md`): the Begin → fight → reward handoff that turns a `RECRUITING` Alpha Raid instance into an actual playable boss fight, using `/raid`'s existing engine.

New creative direction from the user (originally AlphaBeast's pitch): the Alpha Raid boss is not a generic raid boss — it's a **playable character**, boss-scaled. The owner picks who each time they trigger the event.

## Background

Phase 1 shipped: global trigger (`/owner-alpharaid start`), per-guild `AlphaRaidInstance` rows, durable Join button, 72h expiry sweep. `AlphaRaidInstance.phase` currently only supports `"RECRUITING"` | `"EXPIRED"`. This phase adds `"FIGHTING"` | `"COMPLETE"`.

`/raid`'s existing engine (`src/commands/rpg/raid.ts`) already has everything needed to run a fight once boss stats/moves exist:
- `computeRaidBossStats()` — purely party-derived HP/ATK/DEF/vibBar, boss-choice-agnostic. Reused unchanged, with an extra ×1.5 Alpha multiplier applied on top (per the Phase 1 spec).
- The boss doesn't run its own "AI turn" — after each player action it auto-counter-attacks the whole party AoE using a random entry from `boss.moves` (`raid.ts:2144`), scaled by `raid.bossAtk`.
- `canManageRaids()` gates who can click Begin (guild's `ManageGuild` permission, or the bot owner) — same gate the normal `/raid` Begin flow already uses. Reused as-is; this is explicitly NOT bot-owner-exclusive, so any of that server's raid organizers can start the fight once people have joined.

## Boss Selection

The owner picks a character when triggering the event:

```
/owner-alpharaid start character:<name> [test-guild-id] [fracture-keys] [radiant-keys] [fractonite]
```

`character` autocompletes from `CHARACTER_KITS` (the same registry `/raid`, `/duel`, `/ascend` etc. already use) — so only fully-released, fully-built characters are selectable. No support for previewing unreleased characters in this phase.

The chosen character is the **same across every server** for that event — stored once on `AlphaRaidEvent.bossCharacterId`, not per-instance. One global trigger, one boss identity, fought independently in every server.

## Boss Stats

Unchanged from the Phase 1 spec: `computeRaidBossStats(boss, participants) × 1.5` on every axis (HP/ATK/DEF/vibBar), computed fresh per-server from that server's actual joined participants once Begin is clicked — same party-aware scaling formula normal raids already use, just harder.

## Move Pool — Reusing the Character's Real Kit

`boss.moves` (previously a static array per hand-authored `RaidBossConfig`) is built dynamically from the chosen character's kit at Begin time:

- **Basic** → a boss move using the character's Basic Attack name/flavor, `damage: 1.0` (baseline AoE multiplier, same scale as existing boss moves).
- **Skill** → damage multiplier bumped (`damage: 1.3`), and carries that character's real Skill effect as a party-wide debuff where applicable (e.g. Bren's Skill lifesteal flavor becomes the boss draining HP from a hit; Feyra's Skill weaken becomes a DEF-shred debuff on the party).
- **Ultimate** → highest multiplier (`damage: 1.6`), carries the character's real Ultimate effect the same way (e.g. Feyra's Ultimate freeze/weaken applied to the whole party, not just one target).

This reuses the existing `SkillEffectResult`/`UltimateEffectResult` debuff fields (`defShred`, `forceCrit`-equivalent-for-boss, etc.) that already exist for player kits — translated onto the party as a boss-inflicted debuff via the same `DebuffState`/`tickDebuffs` system `raid.ts` already uses for dev-guild mechanics, generalized to apply outside the dev-guild gate for Alpha Raid specifically.

## New Boss-Only Mechanics

Two mechanics new to `raid.ts` (not per-character — apply to every Alpha Raid boss regardless of who's chosen):

- **Evasion**: 15% flat chance a player's attack is dodged entirely (0 damage dealt that hit, distinct message line: `"◇ {Boss} evades the strike!"`). Rolled after the player's damage is calculated but before it's applied to `bossHp`.
- **Enrage** at ≤40% HP: `bossAtk × 1.6`, and move selection is forced to the Ultimate-tier move instead of the random pick — same enrage pattern WL bosses already use in `ascend.ts`/`boss.ts` (per CLAUDE.md gotchas), applied here to Alpha Raid specifically rather than globally to `/raid`.

## Phase Transitions

- `RECRUITING` → `FIGHTING`: any user passing `canManageRaids()` in that guild clicks **Begin** on the recruiting message (same manual flow `/raid` already uses, not auto-started). All current `AlphaRaidParticipant` rows for that instance become the fight roster — same resolution path `/raid` uses to build `RaidParticipant[]` from joined user IDs (fetch each user's `db`/`bonuses`/`stats` via `resolvePlayerBonuses`/`applyBonuses`).
- `FIGHTING` → `COMPLETE`: boss HP hits 0. Rewards distributed (see below), completion message posted.
- `FIGHTING` → stays `FIGHTING` past the 72h `deadlineAt`: the sweep does **not** force-end an in-progress fight — 72h was always the kill window for getting a fight *started and won*, not a hard fight-length cap. If Begin was clicked before the deadline, the fight is allowed to finish. (Matches the Phase 1 spec's framing: deadline gates recruiting → begin, not turn-by-turn play.)
- If the boss is not defeated and the party wipes (all participants defeated): instance moves to `EXPIRED` directly (no separate "wipe" phase needed) with a distinct wipe message, distinguishable from a clean 72h recruiting-timeout expiry.

## Rewards

Flat per-participant bundle, on top of whatever normal `/raid` loot the fight would have dropped anyway, via `awardUser(userId, {...}, "raid")`:

- **Default**: 10 Fracture Keys + 10 Radiant Keys + 1500 Fractonite.
- **Overridable at trigger time**: `/owner-alpharaid start` gains three optional integer options — `fracture-keys`, `radiant-keys`, `fractonite`. Any omitted option falls back to its default. The chosen bundle is stored on `AlphaRaidEvent` (alongside `bossCharacterId`) so every server's payout for that event is consistent, and so a slow-to-finish server's fight still pays out the bundle that was actually announced, even if the owner has since triggered a newer event with different numbers.

## What Does NOT Change

Normal `/raid`, its combat engine internals, `computeRaidBossStats()`'s formula itself, the Phase 1 recruiting/join/sweep infrastructure.

## Testing

Manual, via `test-guild-id` (already shipped in Phase 1) to restrict a live trigger to one server during iteration — `npx tsc --noEmit`/`npm run build` for type safety, then a real Begin→fight→win/wipe cycle in the dev server before wider rollout.
