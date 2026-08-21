# Per-Character Combat Bonuses — Design Spec

## Goal

Every character in a fight — the player and each of their allies (Solace/Kaelith/Rilo/Vesper) — should fight with **their own** equipped gear's bonuses: their own elemental-DMG%, Lifesteal%, Echo Skill, named-set 4pc/5pc mechanics, and elemental innate passive hooks. None of that should silently fall back to whichever unit happens to be the human player's own "self" build. The player's account-level Unique Ability is the one exception — that's explicitly a self-only system and must never apply to an ally.

Cross-unit *support* effects (Rilo's DEF-buff transfer on outro, Vesper's mark/energy grant, Kaelith's stack grant, Solace's Attunement/Concerto combo system) are a completely separate mechanism already wired correctly and must not be touched or regressed by this work.

## Background

`resolvePlayerBonuses(userId, characterId)` already correctly scopes echoes, weapon, and set-bonus resolution to whichever `characterId` is passed — the DB queries filter on it. Two things are still wrong:

1. **The Unique Ability section inside `resolvePlayerBonuses`** (both the V1 and V2 branches) applies unconditionally, regardless of `characterId`. An ally resolved this way still picks up the player's own Unique Ability effects.
2. **Every combat loop only ever calls `resolvePlayerBonuses` once, for "self", at fight start**, and reuses that single object (`myBonus` in duel.ts, `bonuses` in ascend/boss/dungeon/raid/field-boss) for the entire fight — including turns where an ally is the active unit. Each loop already correctly gives an active ally its own ATK/DEF/CritRate/CritDmg (via a per-loop `activeAtk`/`activeCritDmg`/etc. pattern reading from the ally's own `resolveStats()`-derived numbers) — but `elemDmgBonus`, `lifesteal`, `elementPassive`, `echoSkill`, and `abilityEffects` all still read from the player's own single resolved-at-start object, in all 6 fight commands (`duel.ts`, `ascend.ts`, `boss.ts`, `dungeon.ts`, `raid.ts`, `field-boss.ts`).

Confirmed by direct code reading in `duel.ts` (fixed already, this session) and `ascend.ts` (same pattern, not yet fixed) — the other three (`boss.ts`, `dungeon.ts`, `field-boss.ts`) share duel/ascend's near-identical 3-position-roster architecture and are expected to have the identical gap; `raid.ts` uses its own per-participant `RaidAllyBundle` following the same overall pattern.

## Approach

**1. `setBonus.ts`:** gate the entire Unique Ability block (V1 `sanitizeEffects`/legacy-migration path and V2 `sanitizeV2Effects` path) behind `characterId === "self"`. No other section of `resolvePlayerBonuses` needs to change — echoes/weapon/set-bonus resolution is already correct.

**2. Each combat loop's ally-bundle builder** (`buildDuelSideRoster` in duel.ts and its equivalent in each of the other 5 files — the function that loops over roster positions 2/3 and constructs one bundle per owned ally) gets one extra line: resolve `resolvePlayerBonuses(userId, characterId)` for that ally alongside the existing `kit.resolveStats(userId)` call, and store the result on the bundle (`bundle.bonuses: PlayerBonuses`, alongside the existing `bundle.solaceStats`/`bundle.mechanicState` etc.). `resolvePlayerBonuses` already has a 30s in-process cache keyed by `${userId}:${characterId}`, so this doesn't meaningfully add DB load — `kit.resolveStats()` already calls the same function internally for the stat numbers, this just also keeps the full object instead of letting it fall out of scope.

**3. In each loop's per-turn logic, swap the single "which bonuses object am I reading" variable** (`myBonus` in duel.ts, `bonuses` in the other five) based on which unit is currently active, mirroring the exact same pattern each loop already uses for `activeAtk`/`activeCritDmg`/etc. Because every existing read site already goes through this one variable name, this is a single-choke-point fix per file — no need to hunt down and individually patch every `bonuses.elemDmgBonus`/`.lifesteal`/`.echoSkill`/`.elementPassive`/`.abilityEffects` call site (that's exactly the class of bug this session already found and partially fixed piecemeal; this design closes the gap in one place instead).

Concretely, per loop:
- duel.ts: `myBonus` is currently `isChallenger ? state.cBonuses : state.dBonuses`. Add a stored `cAllyBonuses`/`dAllyBonuses` field on `DuelState`, synced at the same three places `cAllySolaceStats` already is (fight-init, the swap-action branch, `applyDuelKoFallback`). Then `myBonus` becomes `myIsAllyActing ? myAllyBonuses! : (isChallenger ? state.cBonuses : state.dBonuses)`.
- ascend/boss/dungeon/field-boss: single-player-vs-boss loops with one `bonuses` variable and a `syncActiveBundle()`-style function already responsible for copying the active bundle's fields into loop-local `ally*` variables each turn (or on swap) — add `allyBonuses` to that same sync function, then introduce `activeBonuses = isAllyActingOrDefending ? allyBonuses! : bonuses` once per turn and use `activeBonuses.X` everywhere the turn logic currently reads `bonuses.X` for the acting unit specifically (not for e.g. embed/header rendering that's intentionally always about the human player's own account).
- raid.ts: same idea, scoped per-participant (`RaidAllyBundle` gets a `bonuses` field, each participant's active-bundle sync picks it up the same way).

**4. Cleanup:** duel.ts's existing `myElemDmg`/`myLife` special-casing (added earlier this session, before this broader fix was scoped) becomes redundant once `myBonus` itself is correctly active-unit-aware — simplify back to reading `myBonus.elemDmgBonus`/`myBonus.lifesteal` directly and remove the now-duplicate branching. Not required for correctness, just removes dead complexity.

## What does NOT change

- `kit.introEffect`/`kit.outroEffect` and the whole intro/outro-combo resolution path (Rilo's shield transfer, Vesper's mark, Kaelith's stack grant, Solace's Attunement/Concerto energy, forte systems) — none of this reads through `myBonus`/`bonuses` today, so none of it is touched.
- The already-correct `activeAtk`/`activeDef`/`activeCritRate`/`activeCritDmg` branching in every loop.
- HP/heal targeting (`activeHp`/`healActiveUnit`/etc. in duel.ts) — fixed earlier this session, unrelated code path.
- Named-set 4pc/5pc *mechanic hooks* (the per-turn `NamedSetState` triggers in each loop, e.g. Frostveil counter, RC turn-heal) already correctly key off `activeNamedSetId`, which will now correctly come from the active unit's own bundle bonuses rather than the player's — this is a **fix**, not a behavior change to touch carefully, but worth calling out: an ally wearing a different named set than the player will now correctly get their own set's mechanic instead of the player's.

## Testing

No automated test framework in this codebase. Verification per file: `npx tsc --noEmit`, `npm run build`, and for duel.ts specifically (the one command with live interactive verification available this session) a manual test — build a roster with an ally wearing a *different* named set than the player's own "self" grid, swap to that ally mid-fight, and confirm the correct set's mechanic/elemDmg/lifesteal shows up in the combat log rather than the player's. The other 5 loops get `tsc`/`build` verification plus careful code review against duel.ts's already-verified pattern, since none of them have a practical live-test path in this environment.
