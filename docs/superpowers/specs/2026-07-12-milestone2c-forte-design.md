# Milestone 2c — Forte (Solace's Gauge) Design

**Status:** Approved, ready for planning.

## 1. What this is

The top-level [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) (§6/§8) describes "Forte" as two distinct systems sharing one name: (A) an in-combat gauge that empowers her Ultimate, and (B) out-of-combat kit-leveling via a per-character material economy. This milestone builds **(A) only** — the in-combat gauge. Kit-leveling needs its own DB concept (no "character level" exists anywhere today — not even for Solace) and a material/currency decision; it's a separate future milestone, mirroring how Wellspring's refinement (R2-R5) was deferred from its base passive.

**Explicitly deferred, not built here:**
- Out-of-combat kit-leveling (per-move levels, material economy, weekly caps) — §8 of the top-level spec.
- Constellation C3/C6, which modify Forte's behavior (C3: mode-switch grants a Concerto Energy burst; C6: makes the "all 3 modes at reduced value" effect permanent rather than Forte-gated) — blocked on the same missing gacha/ownership system that blocks all Constellations.

## 2. Architecture — generic primitive, character-specific payoff

Per explicit user direction: Forte will be common across future characters, but each character's fill triggers, gauge shape, and full-charge payoff will differ — some may have multiple phases, not just Solace's single bar. The primitive must not assume Solace's shape.

**`src/lib/forte.ts` — generic, character-agnostic. Contains ONLY gauge math, no character-specific anything:**

```typescript
export interface ForteConfig {
  phaseThresholds: number[]; // charge needed per phase, in order. length = phase count.
}

export interface ForteState {
  phase: number;   // how many phases are FULLY complete
  charge: number;  // progress within the current, not-yet-complete phase
}

export function addForteCharge(state: ForteState, config: ForteConfig, amount: number): ForteState
export function isForteMaxed(state: ForteState, config: ForteConfig): boolean
export function resetForte(): ForteState
```

`addForteCharge` rolls charge over between phases if a single addition crosses a phase boundary (handles a big charge gain crossing multiple thresholds in one hit — future-proofing for characters with faster fill rates or fewer/smaller phases). `isForteMaxed` is true once `state.phase === config.phaseThresholds.length` (the last phase is fully complete). This file will never import or reference Solace, Attunement, or "3 modes" — it's pure gauge bookkeeping, reusable as-is for a future 2-phase, 3-phase, or differently-triggered character's Forte.

**Solace's specific tuning lives in `src/lib/solace.ts`** (not `forte.ts`), alongside her existing `intro`/`outro` data:

```typescript
export const SOLACE_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] }; // single phase, per her "steady build" identity
export const SOLACE_FORTE_GAIN_PER_BASIC = 20; // Chime Strike fills the gauge — 5 hits to max
export const SOLACE_FORTE_EMPOWERED_TURNS = SOLACE_ULTIMATE_DOUBLE_TURNS; // reuse the existing 3-turn constant for consistency

// Empowered Ultimate's payoff: reduced flat bonuses, applied REGARDLESS of
// which single Attunement mode is currently active — deliberately additive
// alongside (not a replacement for) attunement.ts's own per-mode getters, so
// attunement.ts needs zero changes. Roughly half of Attunement's own
// 15%/15%/20% bonuses.
export function getSolaceForteAtkBonus(empowered: boolean): number { return empowered ? 0.08 : 0; }
export function getSolaceForteCritRateBonus(empowered: boolean): number { return empowered ? 0.08 : 0; }
export function getSolaceForteDefBonus(empowered: boolean): number { return empowered ? 0.10 : 0; }
```

A future character reuses `forte.ts`'s gauge math with their own `ForteConfig` (possibly multi-phase) and defines completely different fill triggers and full-charge payoffs in their own character file — nothing in `forte.ts` needs to change for that.

## 3. Wiring into `/encounter`

Mirrors exactly how Wellspring's bonuses were wired in Milestone 2b — additive terms summed alongside the existing Attunement/Wellspring calculations at the same touch points, all `isDevGuild`-gated.

**New per-fight state** (alongside `attunement`/`attunementDoubleTurnsLeft`):
```typescript
let solaceForte: ForteState = { phase: 0, charge: 0 };
let forteEmpoweredTurnsLeft = 0; // set by an Empowered Convergence; mutually exclusive with attunementDoubleTurnsLeft's normal doubling
```

**Chime Strike (Basic, while `isDevGuild && activeUnit === "ally"`):** after the existing damage calc, add `SOLACE_FORTE_GAIN_PER_BASIC` via `addForteCharge`. If this crosses the 50% or 100% threshold (compare before/after `charge`/`isForteMaxed`), append a status note to the move's flavor message — "✨ Forte is HALF CHARGED" or "✨ Forte is FULLY CHARGED — next Convergence will be Empowered!". No permanent visible bar; this is a one-time announcement on the crossing turn only.

**Convergence (Solace's Ultimate):** branches on `isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)`:
- **If maxed:** set `forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS`, do NOT set `attunementDoubleTurnsLeft` (mutually exclusive per spec's "instead of"), reset `solaceForte = resetForte()`. Message reflects "Empowered Convergence."
- **Otherwise:** unchanged from Milestone 2a — sets `attunementDoubleTurnsLeft` as today. Forte gauge is untouched (keeps accumulating from further Chime Strikes).

**Basic/Ultimate ATK+crit calcs, enemy-damage DEF calc:** each gains one more additive term — `getSolaceForteAtkBonus(forteEmpoweredTurnsLeft > 0)` etc. — following the exact composition pattern Milestone 2b already established for Wellspring: ATK and DEF bonuses become one more `(1 + bonus)` factor chained onto the existing multiplication chain (`atkMult = ... * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus)`), and the crit-rate bonus is one more addend in the existing sum passed to `Math.min(1, cRate + ...)`.

**Per-turn decrement:** `forteEmpoweredTurnsLeft` decrements alongside `attunementDoubleTurnsLeft`, same `isDevGuild`-gated `if (x > 0) x--;` pattern.

## 4. Testing

- `npx tsc --noEmit` clean.
- New assertions appended to `scripts/test-attunement.ts` (same file Wellspring's tests were appended to in Milestone 2b — consistent precedent, still small enough not to warrant a dedicated file) covering: `addForteCharge` accumulates correctly, rolls over a phase boundary correctly, `isForteMaxed` triggers at the right threshold, `resetForte` returns to empty, and Solace's three getter functions return the right bonus only when `empowered` is true.
- Manual Discord playtest in the dev guild: verify the HALF/FULL CHARGED messages appear on the correct hit, verify Convergence's behavior differs when Forte is maxed vs. not, verify the Empowered window's cross-mode bonus is felt (e.g. switch to DEF mode, empower via Forte, then land an ATK-mode-flavored hit and confirm it's still boosted a little), verify non-dev-guild `/encounter` is untouched.
