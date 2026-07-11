# Milestone 2b — Wellspring (Solace's Signature Weapon) Design

**Status:** Approved, ready for planning.

## 1. What this is

The top-level [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) (§7) sketches "Wellspring" as a real, ownable Rectifier weapon with R1–R5 refinement, obtainable via `/wish`. This milestone builds a much smaller slice: Wellspring's **passive mechanic only**, proven the same way Solace's own core kit was proven in Milestone 2a — hardcoded, dev-guild-gated, zero new infrastructure.

**Explicitly deferred, not built here:**
- **R2–R5 refinement** — requires a duplicate-ownership/refinement-tracking system that doesn't exist in the `Weapon` schema today (no `refineRank` field, no dupe-consumption flow). Same blocker Constellations already has. Only R1's effect is built.
- **Real acquisition** — not added to `/wish`'s pull pool. It's a fixed part of Solace's kit in this milestone, not a droppable/pullable item.
- **Per-character equip slots** — there is no database concept of "a character's own equipped weapon" yet (nothing like that exists for any of the 6 banner characters, because there are no banner characters with independent loadouts yet — Solace still borrows the player's entire stat block, per Milestone 2a). Building real swappable per-character loadouts is its own future milestone. For now, Wellspring is simply hardcoded as an always-on part of Solace's kit — not stored in the `Weapon` table, not equipped via `/equip`, not shared with (or interchangeable with) the player's own real equipped weapon.

## 2. Where it lives

- New file: `src/lib/wellspring.ts` — pure data + two small pure functions, mirroring `src/lib/attunement.ts`'s shape (a tiny typed module, not a class, not stateful beyond what's passed in).
- Wiring: `src/lib/encounter.ts` — special-cased directly alongside the existing Attunement calculations, the same way Solace's Outro crit-arm was special-cased rather than routed through the generic `WEAPON_PASSIVES`/`setBonus.ts` pipeline (Wellspring isn't a real `Weapon` DB row, so it can't flow through that pipeline — it doesn't have a `name` to look up).

## 3. The passive, concretely

**Base effect (frames as "any wielder gets value," even though only Solace has it in this milestone):**
- +18% ATK — reuses the existing `ATK_BOOST` primitive's shape (`atkMult *= 1.18`), sitting at the top of that primitive's existing 8–18% registry range (`src/lib/abilityEffects.ts:19`).
- +12 flat Concerto Energy on Solace's own actions — NOT `state.playerEnergy` (the player's personal Ultimate gauge). The `ENERGY_BOOST` primitive normally feeds `state.playerEnergy`, but Solace's kit never touches that resource at all (per Milestone 2a, her Skill/Ultimate run entirely on Concerto Energy) — so applying it there would be inert. This reuses `ENERGY_BOOST`'s VALUE (+12, matching Electro's 2pc set bonus, `src/lib/setBonus.ts:54`) but targets Concerto Energy instead, since that's the only energy resource Solace's own actions actually interact with.

These are NOT routed through `resolvePlayerBonuses`/`WEAPON_PASSIVES` (Wellspring has no `Weapon` DB row to key off of). They're applied as flat local additions in `encounter.ts`, gated to fire only when Solace is the attacker (`isDevGuild && activeUnit === "ally"`).

**Bonus effect (fires whenever `attunement.mode !== null`, applied to whichever unit is currently attacking — matching how Attunement's own buff already applies uniformly regardless of active unit):**
- ATK mode active → an additional +10% ATK (stacks with Attunement's own +15%, and with Convergence's doubling — Wellspring's amplifier does NOT get doubled by Convergence; only Attunement's own bonus does, per §6/§7 of the parent spec keeping refinement's amplification conceptually separate from Constellation/Ultimate doubling)
- CRIT mode active → an additional +10% crit rate
- DEF mode active → an additional +12% DEF (reduces incoming damage further)

Implemented as three tiny pure functions in `wellspring.ts` mirroring `attunement.ts`'s own getter shape:

```typescript
export function getWellspringAtkBonus(state: AttunementState): number {
  return state.mode === "ATK" ? 0.10 : 0;
}
export function getWellspringCritRateBonus(state: AttunementState): number {
  return state.mode === "CRIT" ? 0.10 : 0;
}
export function getWellspringDefBonus(state: AttunementState): number {
  return state.mode === "DEF" ? 0.12 : 0;
}
```

## 4. Wiring into `encounter.ts`

Same `isDevGuild` gating discipline as everything else in this feature area. Three touch points, mirroring exactly where Attunement's own getters are already called:

1. **Basic Attack (`enc_basic`) and Ultimate (`enc_ultimate`)** — ATK mult and crit-rate bonus calculations gain an additional Wellspring term, gated by `isDevGuild && activeUnit === "ally"` (base ATK boost + Energy Regen only apply while Solace is attacking) and the bonus-mode amplifier gated by `isDevGuild` alone (fires for either unit, matching Attunement's own scope).
2. **Enemy damage calc** — DEF mode's Wellspring amplifier folds into the same `attunementDefMult` expression already there, gated by `isDevGuild` alone (defensive value protects the whole team, not just Solace).
3. **Concerto Energy gain** — Solace's own turn actions (when `isDevGuild && activeUnit === "ally"`) gain +12 flat Concerto Energy on top of whatever the move already grants via `CONCERTO_GAIN_BY_MOVE`. Implemented as a direct addition immediately after the existing `addConcertoEnergy(...)` call for Solace's moves — not a change to `CONCERTO_GAIN_BY_MOVE` itself, since that lookup is shared by both units and Wellspring's bonus is Solace-only.

## 5. Testing

- `npx tsc --noEmit` clean, as always.
- No new unit-test script needed — the two bonus functions are pure and trivial (mirroring `attunement.ts`'s own getters), verified inline via a few `assert` lines appended to the existing `scripts/test-attunement.ts` rather than a whole new test file (small enough not to warrant one).
- Manual Discord playtest in the dev guild: verify the ATK/Energy boost is felt while Solace attacks, verify the mode-amplifier stacks correctly with Attunement's own bonus (bigger jump than Attunement alone), verify non-dev-guild `/encounter` is untouched.
