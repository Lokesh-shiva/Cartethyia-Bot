# Rilo Kit Design

**Goal:** Design Rilo's full playable kit — a new standard-pool 5★, a Glacio tank/control Broadblade-brawler whose mechanical identity (build-and-spend Guard/Shield gauge, guaranteed-crit counter swings) is distinct from Solace (mode-cycle support), Kaelith (stack-and-detonate DPS), and Vesper (mark-and-consume sub-DPS). Unlike Solace, she has no signature weapon and is not gated behind a limited banner — she pulls from the same standard 5★ pool as any other standard character, and is explicitly tuned to be strong but not overpowered for that pool.

**Status:** Approved by user 2026-07-30. Not yet implemented — this spec is the input to a future implementation plan (kit module + combat-loop dispatch, mirroring Kaelith/Vesper's build), not started yet.

---

## Identity

- **Element:** Glacio
- **Rarity:** 5★, standard wish-pool (no signature weapon, no limited banner — deliberately restrained power budget for a standard-pool 5★, not meant to compete with Solace's Wellspring-boosted ceiling)
- **Recommended weapon type:** Broadblade — recommended standard-pool weapon is **Ruin Sovereign** (5★ Broadblade, ATK/HP/DEF spread, Shatter-focused passive), which complements her tank/control identity without being required
- **Recommended echo set:** **Frostveil Bastion** (Glacio) — her own element's named set
- **Personality:** Cheerful brawler — a teenager who is genuinely delighted by how hard she hits, treats her oversized broadblade like a fun toy. Tonal contrast between "cute kid" and "casually smashes armored constructs in half" is the character's core flavor hook.
- **Role framing:** Tank/control — leans into Glacio's own innate passive (+30% DEF, +15% HP, +20% Elem DMG, FROST_SHIELD 25% chance to absorb 40% of an incoming hit) rather than fighting it. Her kit doesn't replace FROST_SHIELD, it stacks a second, deliberate layer of mitigation (the Guard gauge) on top of it.

## Stats Profile

Standard-pool 5★, deliberately tuned tankier-not-stronger than Solace (limited-banner 5★) — highest HP **and** DEF in the entire roster (a real tank stacks both, not DEF alone), lowest SPD (dragging a huge blade), ATK/Crit modest and below Solace but never below either 4★ (Kaelith/Vesper) — a 5★ should never sit under a 4★ on every offensive stat at once, tank or not:

| Stat | Rilo (Lv90) | Kaelith (4★, Lv90) | Vesper (4★, Lv90) | Solace (5★, for reference) |
|---|---|---|---|---|
| HP | **1200** | 950 | 900 | 1100 |
| ATK | 130 | 145 | 140 | 115 |
| DEF | **120** | 85 | 80 | 100 |
| SPD | 90 | 105 | 115 | 125 |
| CritRate | 0.08 | 0.10 | 0.10 | 0.05 |
| CritDmg | 1.6 | 1.8 | 1.8 | 1.5 |

Exact floor-fraction curves (mirroring `scaleStat(ceil, floorFrac, level)` from `kaelithKit.ts`/`vesperKit.ts`) are an implementation-time decision — the implementer should follow the same pattern, using these Lv90 ceilings as the target.

## Core Mechanic: Guard Gauge

- **Basic Attack** deals its normal damage **and** grants a flat amount of **Shield** (implementation-time exact number, e.g. ~18 per hit), capped at a max value (spec default: 100). This is a dual-fill just like Kaelith's Basic (stacks + Forte) and Vesper's Basic (mark + Forte) — the same Basic Attack call also fills the separate Forte gauge simultaneously.
- Shield does **not** decay on its own. It persists at whatever value it's at until spent via Skill, or partially handed off via Outro.
- Shield is a personal resource — it does not currently reduce incoming damage passively (that's what FROST_SHIELD already does); it exists purely as spendable resource for Skill/Ultimate/Outro payoffs. (If a future iteration wants Shield to also passively absorb damage like a real shield bar, that's an explicit scope expansion, not assumed here.)

## Skill: "Guard Break"

- Consumes some or all of current Shield (implementation-time: either "all" or a fixed max-consumption amount, following whichever keeps the formula clean — precedent is Kaelith's "consumes all stacks" pattern).
- Damage scales with how much Shield was consumed (more Shield banked → bigger hit).
- Always a **guaranteed crit** — this is the "counter swing she was saving up for."
- If no Shield is present: still castable, deals reduced/base damage with nothing consumed (same "no bonus, not blocked" pattern Vesper's Discharge uses when no mark is present) — never a hard-blocked action.

## Ultimate: "Avalanche Slam"

- Her single biggest guaranteed-crit hit. **Not** Shield-scaled — this is a flat/level-scaled damage tier (like every other character's Ultimate base multiplier), specifically so it's never a whiff at 0 Shield.
- After the hit lands, refills her Shield gauge to roughly 40-50% of max (implementation-time exact fraction) — she goes big, then immediately re-guards for the next turn instead of being left defenseless right after her biggest play.

## Forte Payoff: Braced Guard Break

- Same shared gauge shape as Solace/Kaelith/Vesper (`phaseThresholds: [100]`), filling from Basic Attacks (dual-fill alongside Shield, per Core Mechanic above).
- When Forte is maxed, her next Guard Break **refunds a flat chunk of Shield back** after consuming it, instead of fully draining to zero — lets her hit hard without going into the following turn at 0 Shield. Resets Forte to empty afterward.

## Intro / Outro

- **Intro**: modest flat **Shield grant** on swap-in (parallel structure to Vesper's Energy burst, Kaelith's stack grant) — she doesn't enter a fight defenseless.
- **Outro**: transfers a fraction of her **remaining Shield** to whoever swaps in next, as a temporary damage-absorb buff on them (mirrors Vesper's mark-forward Outro pattern structurally, but carries a real numeric Shield value through the side-channel instead of a boolean flag).

## Skill Cooldown

Implementation-time decision — no strong argument either way was raised during brainstorming. Default to **0 turns** (matching Vesper's precedent) unless a cooldown is specifically needed to prevent a degenerate spam pattern once exact numbers are set.

## Constellations

| C | Effect |
|---|---|
| C1 | Basic Attacks that land a **critical hit** grant **+50% bonus Shield** on top of the normal flat gain (still capped at max Shield) — turns crit RNG into a genuine economy engine instead of pure damage variance |
| C2 | Guard Break's guaranteed crit also applies a **10% DEF-shred debuff for 2 turns** (non-stacking — reapplying refreshes duration, doesn't compound) — the move now does something to the enemy, not just refunds more to her |
| C3 | **Once per battle**: if a hit would drop her below 25% HP, and she has any Shield banked, she instead auto-consumes all remaining Shield to fully block that hit. A genuine clutch save, not a repeatable safety net — if Shield is already empty when it would trigger, it doesn't fire |
| C4 | Avalanche Slam **cleanses one debuff** from her and grants Shield equal to **20% of the damage it dealt** — ties her Ultimate to a new resource path (damage → Shield) instead of a flat refund, plus real utility |
| C5 | Forte now **also gains a flat, modest amount** (roughly a third of a Basic Attack's contribution) whenever she takes a hit while holding any Shield — makes tanking hits an active part of her pacing instead of just something that happens to her |
| C6 (Defining) | **Once per battle**, if her Shield ever hits exactly 0, it's immediately restored to 50% of max (an "unbreakable guard" safety net, not permanent immunity to running dry) — **and** Avalanche Slam hits twice whenever cast while Shield is at max |

Deliberate power guardrails baked into the *mechanic* itself (not just tuning numbers): C1's bonus is a percentage of an already-capped resource, C2's debuff is non-stacking, C3 and C6's safety nets are explicitly once-per-battle, C4's conversion is capped at a fraction of Ultimate damage, C5's hit-triggered gain is flat and modest. Exact percentages/flat amounts are still implementation-time decisions following `kaelithKit.ts`/`vesperKit.ts`'s constellation-gated formula style — this spec fixes the *mechanic and its guardrail* for each tier, not the exact tuning constants.

## Double-Hit Display (C6 Reuse, Not New Work)

C6's "hits twice" payoff reuses the multi-hit display infrastructure already built for Vesper this session (`state.hitBadge` on `BattleCardState`, the `×N HITS` canvas chip, the `Hit 1:`/`Hit 2:` embed-text breakdown pattern in all 7 combat loops). No new display work is needed — the combat-loop dispatch for Rilo's Ultimate should call the same pattern Vesper's multi-hit Skill branch uses, just gated on "Shield at max" instead of "Forte empowered."

## Ascension Material

New currency: **Glacial Shards**, dropped by **Permafrost Sovereign** — the existing Glacio field boss in `src/lib/fieldBosses.ts` (id: `permafrost_sovereign`, confirmed base-tier, no `unlockWorldLevel` gate), matching the established pattern (Solace: Starfall Shards from Luminal Specter; Kaelith: Umbral Shards from Null Ravager; Vesper: Voltaic Shards from Voltaic Aberrant).

## Explicitly Out of Scope for This Spec

- Exact numeric tuning constants (stat curves, Shield-gain-per-Basic, Skill/Ultimate damage multipliers, constellation bonus percentages) — implementation-time decisions following established per-kit patterns, not fixed here.
- The actual currency schema field, drop wiring, and inventory/emoji registration (mirrors the exact steps already done for Umbral/Voltaic Shards — schema column, `inventoryCard.ts` entry, `emojiManager.ts` entry, field-boss drop block).
- Combat-loop dispatch implementation (the 7-file rewiring pattern already proven for Kaelith and Vesper).
- `/character` page wiring (already fully generic — adding Rilo to `CHARACTER_KITS` is sufficient, no further `/character` changes needed).
- Standard-banner pool inclusion / launch timing — a business decision for later, same as Kaelith and Vesper's current gated status. Being a *standard-pool* 5★ by design does not mean she ships live immediately; she still needs an explicit launch decision like the other two.
- Character art (portrait + icon variant) — not yet commissioned/provided.
- Lore fragments (7 entries, matching Solace/Kaelith/Vesper's precedent) — not yet written, to be drafted either at spec-finalization or implementation time.
- Whether Shield should ever passively reduce incoming damage (in addition to being a spendable resource) — an explicit scope expansion if ever wanted, not assumed by this spec.
