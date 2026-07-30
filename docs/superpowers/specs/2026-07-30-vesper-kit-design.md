# Vesper Kit Design

**Goal:** Design Vesper's full playable kit — the second 4★ banner character, an Electro sub-DPS whose mechanical identity (Static Mark → Discharge → Overload chain, Forte-tied double-hit payoff) is distinct from both Solace (mode-cycle support) and Kaelith (stack-and-detonate DPS).

**Status:** Approved by user 2026-07-30. Not yet implemented — this spec is the input to a future implementation plan (kit module + combat-loop dispatch, mirroring Kaelith's build), not started yet.

---

## Identity

- **Element:** Electro
- **Rarity:** 4★ (same rarity as Kaelith)
- **Signature weapon:** None — any weapon type works, no limited weapon banner tied to her (matches Kaelith's precedent: a 4★ character never carries a signature weapon, since those are reserved for limited-banner-exclusive 5★s like Solace's Wellspring)
- **Recommended echo set:** **Stormcaller's Oath** (Electro) — her own element; its thunderbolt/crit-rate mechanics complement a Discharge-chain playstyle without fighting it
- **Role framing:** Billed as "sub-DPS" — not a healer/support like Solace, but not a pure glass-cannon like Kaelith either. The "sub" flavor comes through in her stat curve (higher SPD floor) and her Intro/Outro (both enable a *chain*, either for herself or for whoever she swaps with), not in lower damage output.

## Stats Profile

Same low-floor/high-ceiling shape as Kaelith (HP/ATK/DEF/CritRate/CritDmg scale heavily across levels, matching a DPS-biased build-reward curve), except:
- **SPD floor is meaningfully higher than Kaelith's** — reflects Electro's energy/speed theme and her sub-DPS role (she's built to act more often / enable faster rotations, not just hit hardest).

Exact numeric curves (ceiling/floor-fraction pairs per stat, mirroring `kaelithStatsAtLevel`'s shape) are an implementation-time decision, not fixed in this spec — the implementer should follow the same `scaleStat(ceil, floorFrac, level)` pattern already established in `kaelithKit.ts`, picking a SPD floor fraction noticeably above Kaelith's 0.50.

## Core Mechanic: Static Mark → Discharge → Overload

- **Basic Attack** applies a **Static Mark** to the enemy — a boolean flag in her `mechanicState` (present/absent, not a stack count). Refreshes on every Basic regardless of whether one was already present.
- **Skill ("Discharge")**:
  - Always castable, no cooldown (see "Skill Cooldown" below).
  - If a Static Mark is present: consumes it, deals bonus damage, and the mark's bonus amount is what Constellation 2 doubles.
  - If no mark is present: deals its base damage only, no bonus, no consumption (nothing to consume).
  - This is the core alternating rhythm the kit is built around: Basic sets up, Discharge cashes in, Basic sets up again.
- **Ultimate ("Overload")**:
  - If a Static Mark is present: consumes it for a bigger hit.
  - If no mark is present: deals its base Ultimate damage only (no bonus, nothing to consume).
  - **Always** leaves a fresh Static Mark on the enemy afterward, regardless of whether it consumed one — using Ultimate never "wastes" the setup; it chains directly into another Discharge next turn.

## Forte Payoff: Arc Discharge

- Forte uses the same shared gauge shape as Solace/Kaelith (`phaseThresholds: [100]`), filling from Basic Attacks (with Discharge filling it *extra* fast specifically when it successfully consumes a mark — rewards the alternating rhythm doubly, not just through raw damage).
- When Forte is maxed, her next Discharge becomes an **Arc Discharge**: it hits the enemy **twice** instead of once (each hit independently rolls the mark-consumption bonus check), then resets Forte to empty.
- At Constellation 4, an Arc Discharge becomes a **triple hit** instead of double, whenever Forte is empowered.

## Skill Cooldown

**0 turns**, unmodified across all constellations (including C6). This is intentional, not an oversight: Discharge's *bonus* damage only comes from consuming a Static Mark, and marks only ever come from a prior Basic (or the Outro's free one). Spamming Discharge back-to-back without an intervening Basic just deals reduced, non-bonus damage each time — the alternating rhythm is the naturally optimal play without needing a cooldown to force it. A cooldown would actively work against the "chain freely" feel the kit is going for.

## Intro / Outro

- **Intro**: instant **Energy burst for herself** on swap-in — lets her chain straight into a Discharge/Overload sequence immediately instead of needing to land a Basic first. (Contrast: Kaelith's Intro grants stacks to himself; Solace's grants an ATK buff to the incoming ally. Vesper's is the first Intro effect that's purely self-directed Energy, distinct from both.)
- **Outro**: leaves a **free Static Mark on the enemy** for whoever swaps in next (the player or another future ally) — reinforces the "sub-DPS enabling" framing: even when she's benched, her setup carries forward to benefit the next actor's opening Skill/Ultimate.

## Constellations

| C | Effect |
|---|---|
| C1 | Outro's mark becomes a **Charged Mark** — the next Discharge that consumes it gets a large flat damage bonus (bigger than a normal mark-consumption bonus) |
| C2 | Discharge's mark-consumption bonus damage is **doubled** — a flat, crit-independent power increase |
| C3 | Ultimate's damage additionally scales with her current Energy% at the moment it's cast, and refunds that spent Energy into progress toward her next Arc Discharge (so a big Ultimate isn't "dead time" before her next payoff) |
| C4 | Arc Discharge becomes a **triple hit** (not double) whenever Forte is empowered — the core payoff itself gets bigger, not a side utility bump |
| C5 | Arc Discharge's hits **ignore 15% of the enemy's DEF** — deliberately NOT "hits can crit independently" (that option was rejected: it becomes dead weight once a player's crit rate is already capped near 100%, an always-relevant DEF-ignore bonus doesn't have that problem) |
| C6 (Defining) | Vesper tracks a hidden counter: how many Discharges she's used since her last Ultimate. Overload's damage bonus scales with that counter, then the counter resets to 0 after each Ultimate cast. Rewards sustaining a long Basic→Discharge→Basic→Discharge chain before cashing in Overload, rather than a flat one-time refill or stat buff. |

(Constellation gate numbers — exact bonus percentages, DEF-ignore stacking behavior, etc. — are implementation-time decisions following the same style as `kaelithKit.ts`'s constellation-gated formulas; this spec fixes the *mechanic* of each tier, not the exact tuning constants.)

## Double-Hit Display (New Work — No Existing Precedent)

Investigated during this session: **every** existing double-hit-style effect in this codebase (`roll4pcDoubleHit`, Smoldering Sovereign's skill-double, echo-skill double-hit) is currently silent — the damage number is doubled with zero text or visual indicator anywhere, in embeds or on the battle-card canvas. Arc Discharge is the first mechanic that needs a real indicator, and the user explicitly asked for both:

1. **Embed text**: instead of one combined damage number, show two separate lines — `Hit 1: X dmg` and `Hit 2: Y dmg` (three lines at C4's triple-hit tier).
2. **Battle-card canvas badge**: a small "×2" (or "×3" at C4) tag rendered onto the actual battle-card image near the damage number. This has no existing component to reuse — `canvas.ts`'s battle card renderer has no hit-count/multi-hit badge concept today (its only badges are CREATOR/PATRON/AWAKENED/echo-cost/level). This is new canvas rendering work, not a wiring exercise.

## Ascension Material

New currency (not yet named in this spec beyond "Vesper's shard") dropped by **Voltaic Aberrant** — the Electro field boss, confirmed base-tier (no `unlockWorldLevel` gate in `src/lib/fieldBosses.ts`), matching the established pattern (Solace: Starfall Shards from Luminal Specter; Kaelith: Umbral Shards from Null Ravager, also both base-tier bosses).

## Explicitly Out of Scope for This Spec

- Exact numeric tuning constants (stat curves, damage multipliers, constellation bonus percentages) — implementation-time decisions following established per-kit patterns, not fixed here.
- The actual currency name/schema field, drop wiring, and inventory/emoji registration (mirrors the exact steps already done for Umbral Shards — schema column, `inventoryCard.ts` entry, `emojiManager.ts` entry, field-boss drop block).
- Combat-loop dispatch implementation (the 7-file rewiring pattern already proven twice for Kaelith).
- `/character` page wiring (already fully generic as of this session's Kaelith fix — adding Vesper to `CHARACTER_KITS` is sufficient, no further `/character` changes needed).
- Standard-banner pool inclusion / launch timing — a business decision for later, same as Kaelith's current gated status.
- The new canvas double-hit badge's exact visual design (size, position, styling) — a design decision to make during implementation, informed by the existing badge components' styling conventions in `canvas.ts`.
