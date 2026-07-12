# Milestone 2e — Kit-Leveling Combat Effects Design

**Status:** Approved, ready for planning.

## 1. What this is

Milestone 2d built the leveling *infrastructure* (persistence, currency, the `/character` command) — leveling a track today just changes a number in the database and does nothing in combat. This milestone wires those levels into Solace's actual `/encounter` numbers, per explicit user direction that leveling should feel like a real, meaningful power increase rather than incremental filler.

**Explicitly deferred, not touched here:**
- Wellspring's own refinement system (R2-R5) — separate progression axis, still deferred per Milestone 2b's design spec.
- Constellations — still blocked on the missing gacha/ownership system. See §6 below for how this milestone's numbers were deliberately chosen to avoid encroaching on Constellation 6's headline effect once it eventually ships.

## 2. Architecture change — `attunement.ts` becomes parameterized

Today, `src/lib/attunement.ts`'s bonus magnitudes (`ATTUNEMENT_ATK_BONUS = 0.15`, `ATTUNEMENT_CRIT_BONUS = 0.15`, `ATTUNEMENT_DEF_BONUS = 0.20`) are hardcoded module-level constants — there's no way for Solace's Skill level to influence them. This milestone changes the three getters to **require** an explicit bonus-magnitude parameter instead:

```typescript
export function getAttunementAtkMult(state: AttunementState, bonus: number, doubled = false): number {
  if (state.mode !== "ATK") return 1;
  return 1 + bonus * (doubled ? 2 : 1);
}
export function getAttunementCritRateBonus(state: AttunementState, bonus: number, doubled = false): number {
  if (state.mode !== "CRIT") return 0;
  return bonus * (doubled ? 2 : 1);
}
export function getAttunementDefMult(state: AttunementState, bonus: number, doubled = false): number {
  if (state.mode !== "DEF") return 1;
  return 1 + bonus * (doubled ? 2 : 1);
}
```

No default value — deliberately forces every call site to explicitly supply the magnitude, so a future character reusing this mechanic can't silently inherit Solace's numbers by omission (an easy-to-miss footgun if a default existed). `encounter.ts` computes Solace's level-scaled magnitude (via a new function in `solace.ts`, §3 below) and passes it in at each of the three existing call sites (Basic, Ultimate, enemy-DEF calc) — same call sites Milestones 2a/2b/2c already established, just one more argument threaded through.

## 3. Per-track scaling (all functions added to `src/lib/solace.ts`, alongside her existing kit data)

Linear interpolation from Lv1 to Lv10 for every track (`value(level) = base + (max - base) * (level - 1) / 9`):

| Track | What scales | Lv1 | Lv10 |
|---|---|---|---|
| Basic (Chime Strike) | Damage multiplier | 0.6x | 1.2x |
| Skill (Attunement) | ATK/Crit bonus magnitude | 15% | 30% |
| Skill (Attunement) | DEF bonus magnitude | 20% | 40% |
| Ultimate (Convergence) | Heal % | 30% | 60% |
| Intro | Heal % | 20% | 40% |
| Forte | Empowered ATK/Crit bonus | 8% | 16% |
| Forte | Empowered DEF bonus | 10% | 20% |

```typescript
export function solaceBasicDamageMult(basicLevel: number): number {
  return 0.6 + (1.2 - 0.6) * (basicLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceAttunementAtkCritBonus(skillLevel: number): number {
  return 0.15 + (0.30 - 0.15) * (skillLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceAttunementDefBonus(skillLevel: number): number {
  return 0.20 + (0.40 - 0.20) * (skillLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceConvergenceHealPct(ultimateLevel: number): number {
  return 0.30 + (0.60 - 0.30) * (ultimateLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceIntroHealPct(introLevel: number): number {
  return 0.20 + (0.40 - 0.20) * (introLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceForteEmpoweredAtkCritBonus(forteLevel: number): number {
  return 0.08 + (0.16 - 0.08) * (forteLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export function solaceForteEmpoweredDefBonus(forteLevel: number): number {
  return 0.10 + (0.20 - 0.10) * (forteLevel - 1) / (MAX_KIT_LEVEL - 1);
}
```

(`MAX_KIT_LEVEL` imported from `characterProgress.ts`, same constant Milestone 2d already established — kept as the single source of truth for "10" rather than a second hardcoded copy.)

These replace the existing hardcoded flat values in `getSolaceForteAtkBonus`/`getSolaceForteCritRateBonus`/`getSolaceForteDefBonus` (Milestone 2c) and `getWellspringAtkBonus`-style calls are untouched (Wellspring stays on its own separate, still-flat-for-now progression axis, per §1).

## 4. Convergence's real team heal (bug fix + level scaling together)

Today, Convergence's heal always targets `state.playerHp`/`state.playerHpMax` regardless of who's active — Solace's own `allyHp` is never healed by her own Ultimate, contradicting the "Team healed" message. This milestone fixes it to heal **both** HP pools:

```typescript
const before = { player: state.playerHp, ally: allyHp };
state.playerHp = Math.min(state.playerHpMax, state.playerHp + Math.floor(state.playerHpMax * healPct));
allyHp         = Math.min(allyHpMax,         allyHp         + Math.floor(allyHpMax         * healPct));
const actualHeal = { player: state.playerHp - before.player, ally: allyHp - before.ally };
```

`healPct` here is `solaceConvergenceHealPct(progress.ultimateLevel)` (§3), not a fixed constant. The message updates to report both amounts healed (or a combined total — exact wording decided at implementation time, not a design-level decision).

## 5. Where the player's `CharacterProgress` row comes from inside `/encounter`

`/encounter`'s combat loop needs Solace's current levels to compute these scaled values. At the point where team state is initialized (alongside `attunement`/`solaceForte`/etc.), fetch once via the existing `getOrCreateCharacterProgress(interaction.user.id, "solace")` (Milestone 2d) and hold it in a local variable for the rest of the fight — no need to re-fetch every turn, since levels can't change mid-fight (leveling only happens via `/character`, a separate command/interaction).

## 6. Balance note — why these numbers don't encroach on Constellation 6

Explicitly discussed and confirmed during brainstorming: Forte's Empowered payoff (all 3 modes at once, temporarily) is structurally distinct from C6 (all 3 modes at once, permanently) even at maxed-out Forte level. A Lv10-Forte, C0 (no constellations) player gets a strong-but-temporary 3-turn burst gated behind filling the gauge and spending the Ultimate; a C6 player has a weaker-per-mode-but-always-on version running the entire fight. The numbers in §3 were deliberately chosen so the *temporary* version's peak strength doesn't functionally replace the *permanent* version's value — kit-leveling and Constellations stay separate, non-overlapping progression axes. If Constellations' eventual numbers ever get designed and this margin feels too thin, revisit Forte's Lv10 numbers first (they're the closest of the five tracks to C6's territory) rather than any of the other four.

## 7. Testing

- `npx tsc --noEmit` clean.
- New assertions appended to `scripts/test-attunement.ts` covering: `attunement.ts`'s three getters with an explicit bonus parameter (confirming the parameterized signature behaves identically to the old hardcoded-constant version at the old values, e.g. `getAttunementAtkMult(state, 0.15)` still returns what `getAttunementAtkMult(state)` used to), and each of the seven new `solace*` scaling functions at Lv1, Lv10, and a midpoint (e.g. Lv5 or Lv6) to catch an interpolation math error.
- Manual Discord playtest in the dev guild: level Solace's tracks via `/character`, fight an encounter, and confirm each track's effect is visibly stronger than it was pre-leveling (Chime Strike damage, Attunement's team buff magnitude, Convergence healing BOTH units and by a bigger amount, Intro's heal amount, Forte's Empowered window's magnitude) — and confirm a fresh/unlevel Lv1 Solace behaves identically to how she did before this milestone (the Lv1 baseline values match Milestones 2a/2b/2c's original hardcoded numbers exactly, so nothing should regress for a player who hasn't leveled anything yet).
