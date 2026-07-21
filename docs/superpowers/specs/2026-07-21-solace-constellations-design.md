# Solace Constellations — Unlock + Combat Effects

## Context

Milestone 3.5 (per-character loadouts) added the schema (`CharacterProgress.constellation` 0-6, `constellationTokens`) and the read-only Constellations page in `/character`, but explicitly deferred two things to "once a real duplicate-pull path exists": the actual unlock action (spending tokens to raise `constellation`), and wiring the six C1-C6 effects into combat. Milestone 4 (Solace's banner) shipped the duplicate-pull path — every 5★ pull that isn't a first-time Solace converts to a Constellation Token via `wish.ts`. Tokens have been banking ever since, but nothing lets a player spend them, and the six effects exist only as flavor text (`CONSTELLATION_EFFECTS` in `character.ts`).

This spec covers both pieces: the unlock mechanic and the full combat wiring.

## Unlock mechanic

`/character` → Constellations page (`buildConstellationsView` in `character.ts`) gets a new button, shown only when eligible:

- **Label:** `✦ Unlock C{constellation + 1} (1 Token)`
- **Shown when:** `constellationTokens >= 1 && constellation < MAX_CONSTELLATION (6)`
- **On click:** race-guarded transaction —
  ```ts
  prisma.characterProgress.updateMany({
    where: { userId, characterId: "solace", constellationTokens: { gte: 1 }, constellation },
    data: { constellationTokens: { decrement: 1 }, constellation: { increment: 1 } },
  })
  ```
  `count === 0` means tokens or constellation changed since the page was rendered (double-click, or a pull landed in between) — re-fetch and re-render rather than erroring, matching the existing race-guard pattern used elsewhere in `character.ts`.
- Re-renders the Constellations page on success, showing the newly lit tier.

No confirmation step (per approved design) — unlocking is the whole point of banking tokens, low-risk to do immediately.

## The six effects

All six gate on a single `constellation: number` (0-6), read once per fight from `resolveSolaceStats()` (which already fetches `CharacterProgress` — just needs to also select and return `constellation`). Every combat surface already threads a `solace*Level` set of numbers into Solace's kit functions (`solaceIntroEffect(introLevel)`, `solaceConvergenceHealPct(ultimateLevel)`, etc.) — `constellation` becomes one more number carried alongside them, following the exact same plumbing.

### C1 — Outro grants incoming ally +15% ATK on swap-in
Solace's `outro` (`SOLACE.outro` in `solace.ts`) currently has one action: `SHIELD_ALLY 0.15`. At `constellation >= 1`, add a second action `BUFF_ALLY_ATK 0.15` to the resolved outro effect before it's passed to `resolveIntroOutroEffect()`.

*Scope note:* the existing flavor text says "Outro's **guaranteed-crit** buff also grants...", but the guaranteed-crit half of base Outro was never implemented (a pre-existing gap noted in `solace.ts`'s own comments, unrelated to constellations — it needs a `nextAttackCritArmed`-style primitive wired into every combat loop's swap logic). That gap is out of scope for this feature. C1 ships as a standalone +15% ATK buff on swap-in; the crit-guarantee half remains a separately-tracked gap.

### C2 — Ultimate heal increased, cleanses 2 instead of 1
- `solaceConvergenceHealPct(ultimateLevel)` currently returns 0.30-0.60 (kit-level-scaled). At `constellation >= 2`, add a flat +0.15 (so the effective range becomes 0.45-0.75).
- Both `CLEANSE_ALLY` actions in the Convergence/Ultimate resolution (player heal + ally heal — two call sites per combat loop) use `value: constellation >= 2 ? 2 : 1` instead of the hardcoded `1`.

### C3 — Mode-switch grants a Concerto Energy burst
When the Skill action actually changes `attunement.mode` (i.e. every Skill use — mode always changes since it cycles), and `constellation >= 3`: grant +25 Concerto Energy to **both** the player's and Solace's energy trackers (whichever the combat loop's `concertoEnergy`/equivalent state variable is — some loops track one shared value, verify per-file). Capped at 100 same as all other Concerto Energy gains (use the existing `addConcertoEnergy()` helper, which already clamps).

### C4 — Intro heal also grants a shield
`solaceIntroEffect(introLevel)` currently returns `[HEAL_ALLY healPct, CLEANSE_ALLY 1]`. At `constellation >= 4`, add a third action `SHIELD_ALLY (healPct * 0.30)` — computed at construction time since `SHIELD_ALLY`/`HEAL_ALLY` are both flat fractions of `hpMax` (no need to wait for a resolved heal amount).

### C5 — Doubled-mode-duration 3→4 turns
`SOLACE_ULTIMATE_DOUBLE_TURNS` (currently a constant, `3`) becomes a function:
```ts
export function solaceUltimateDoubleTurns(constellation: number): number {
  return constellation >= 5 ? 4 : 3;
}
```
Every call site that reads the constant (including the `+1` compensation math, e.g. `attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS + 1`) switches to `solaceUltimateDoubleTurns(constellation) + 1`. `SOLACE_FORTE_EMPOWERED_TURNS` (aliased to the same constant today) also becomes constellation-aware via the same function, since Empowered Ultimate is a variant of the same doubled-mode window — both should extend together at C5.

### C6 — Off-modes gain 50% of their effect
`attunement.ts`'s three getters (`getAttunementAtkMult`, `getAttunementCritRateBonus`, `getAttunementDefMult`) each gain an optional `constellation6 = false` param. When `true` and the mode being queried is NOT the active mode, the getter returns 50% of its own base `bonus` (never doubled — doubling only ever applies to the genuinely active mode). Example:
```ts
export function getAttunementAtkMult(state, bonus, doubled = false, constellation6 = false): number {
  if (state.mode === "ATK") return 1 + bonus * (doubled ? 2 : 1);
  return constellation6 ? 1 + bonus * 0.5 : 1;
}
```
Every call site passes `constellation >= 6` as the new last argument.

## Combat-surface wiring

Same 7 files as her Echo Skill rollout: `ascend.ts`, `boss.ts`, `dungeon.ts`, `duel.ts`, `raid.ts`, `field-boss.ts`, `encounter.ts`. Each already fetches Solace's kit levels once per fight via `resolveSolaceStats()`/direct `CharacterProgress` reads — `constellation` is added to that same read, then threaded into the six call sites above (intro/outro construction, Convergence heal+cleanse, Skill mode-switch, the three attunement getters, and the doubled-turns constant).

`duel.ts` and `raid.ts` need both-sides handling where Solace could be on either side (same adaptation pattern already used for her Echo Skill in those two files).

## Data model

No schema changes — `CharacterProgress.constellation` and `.constellationTokens` already exist and are already populated (tokens have been banking since the banner launched).

## Testing

- Fresh Solace (C0, 0 tokens): Constellations page shows no unlock button, all six effects inactive.
- 1 token banked: unlock button appears, unlocking C1 actually adds the ATK buff (verify via a swap in `/encounter` or `/boss`).
- Manually set `constellation: 6` in DB for a test account: verify all six effects fire simultaneously without conflicting (e.g. C5's turn extension doesn't break C3's energy burst timing, C6's off-mode bonus doesn't double-count with the genuinely active mode).
- Race guard: two rapid clicks on the unlock button only consume one token.
