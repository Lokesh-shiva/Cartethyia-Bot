# Milestone 3c — Team Mechanics in /ascend and /field-boss Design

**Status:** Approved, ready for planning.

## What this is

Ports the team-combat system into `/ascend` and `/field-boss` — both are solo single-player-vs-boss fights, structurally near-identical to `/boss` (same `runTurn()` per-turn message-recreation loop, same raw multiplicative damage-formula shape, no shared `calcPlayerDamage()` helper). Full reuse of the [Milestone 3b design](2026-07-14-milestone3b-boss-team-port-design.md) — same scope, same architecture, same lessons-learned-upfront discipline (swap falls through, WEAKENED fully wired, teamStatusLine shown, Convergence-refund guard built in from the start).

**Confirmed differences from `/boss` to adapt per file:**
- `/ascend`: button customId prefix is `battle_` (not `boss_`). Formula shape otherwise matches `/boss` almost exactly (`scaled.atk * move.damage * enrageMult - stats.def * 0.4`).
- `/field-boss`: button customId prefix is `fb_` (not `boss_`). No enrage mechanic at all — its retaliation formula is `scaled.atk * move.damage - stats.def * 0.4` (no `enrageMult` term to compose with).

Both dev-guild-gated, one milestone each (not sub-slices), matching every prior surface.

## Testing

Same as Milestone 3b: `npx tsc --noEmit` clean, no new unit tests (pure integration reusing already-tested functions), manual Discord playtest per surface confirming swap/Solace kit/Attunement/Wellspring/Forte/Convergence/WEAKENED/teamStatusLine all work, non-dev-guild unaffected.
