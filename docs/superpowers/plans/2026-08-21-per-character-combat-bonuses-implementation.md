# Per-Character Combat Bonuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every character in a fight (the player and each ally) uses their OWN equipped grid's elemDmgBonus/lifesteal/elementPassive/echoSkill/named-set mechanics, not the human player's. The player's account-level Unique Ability stays self-only.

**Architecture:** `resolvePlayerBonuses` already correctly scopes echoes/weapon/set-bonuses by `characterId` — only its Unique Ability section needs a self-only gate. Each of the 6 fight commands resolves a `PlayerBonuses` object once per side/participant at fight-start and never re-resolves it per active unit; each already has a working "active unit's own ATK/DEF/CritRate/CritDmg" pattern (`activeAtk`/`activeDef`/etc.) to mirror. The fix is: give each ally bundle its own resolved `PlayerBonuses` (in addition to the `ResolvedStats` it already gets via `kit.resolveStats()`), and introduce one `activeBonuses`-style variable per turn that every existing `bonuses.X`/`myBonus.X` read site gets pointed at instead of the raw per-side/per-participant object.

**Tech Stack:** TypeScript, Prisma, discord.js. No test framework — verification via `npx tsc --noEmit`, `npm run build`, and live manual testing for `/duel` (the one command testable in this environment).

**Reference:** [docs/superpowers/specs/2026-08-21-per-character-combat-bonuses-design.md](../specs/2026-08-21-per-character-combat-bonuses-design.md)

---

### Task 1: `setBonus.ts` — Unique Ability is self-only

**Files:**
- Modify: `src/lib/setBonus.ts`

- [ ] **Step 1: Gate the whole Unique Ability block behind `characterId === "self"`**

Find the block starting at `// ── Unique ability (composite) ────` (currently around line 488) through the end of the V1/V2 if/else (currently ending around line 545, right before the final `return bonuses;`). Wrap the entire block:

```ts
  // ── Unique ability (composite) ────────────────────────────────────────────
  // Self-only: an ally's own equipped grid should never inherit the human
  // player's account-level Unique Ability — that system belongs to the
  // player, not to Solace/Kaelith/Rilo/Vesper.
  if (characterId === "self") {
    bonuses.abilityVersion = user.abilityVersion ?? 1;

    if (bonuses.abilityVersion === 2) {
      // V2 — composable trigger→effect language.
      if (bonuses.abilityEffects.length > 0) {
        const wp = compositePassives(bonuses.abilityEffects);
        bonuses.atkMult       *= wp.atkMult;
        bonuses.hpMult        *= wp.hpMult;
        bonuses.defMult       *= wp.defMult;
        bonuses.critRateBonus += wp.critRateBonus;
        bonuses.critDmgBonus  += wp.critDmgBonus;
        bonuses.lifesteal     += wp.lifesteal;
        bonuses.energyBonus   += wp.energyBonus;
        bonuses.elemDmgBonus  += wp.elemDmgBonus;
      }
      const v2 = sanitizeV2Effects(user.uniqueAbilityEffects, user.abilityEvolved, 7);
      if (v2.length > 0) {
        bonuses.v2Effects = v2;
        const p = v2CompositePassives(v2);
        bonuses.atkMult       *= p.atkMult;
        bonuses.hpMult        *= p.hpMult;
        bonuses.defMult       *= p.defMult;
        bonuses.critRateBonus += p.critRateBonus;
        bonuses.critDmgBonus  += p.critDmgBonus;
        bonuses.lifesteal     += p.lifesteal;
        bonuses.energyBonus   += p.energyBonus;
        bonuses.elemDmgBonus  += p.elemDmgBonus;
        bonuses.activeLabels.push(`✦ Unique${user.uniqueAbilityName ? ` — ${user.uniqueAbilityName}` : ""}:\n${formatV2Effects(v2).split("\n").map(l => "  › " + l).join("\n")}`);
      }
    } else {
      // V1 — source priority: stored composite → migrate legacy single-type → none
      let effects: AbilityEffect[] = sanitizeEffects(user.uniqueAbilityEffects, user.abilityEvolved);

      if (effects.length === 0 && user.uniqueAbilityType) {
        effects = legacyToComposite(user.uniqueAbilityType, user.uniqueAbilityValue, playerElem, userId);
        prisma.user.update({
          where: { id: userId },
          data:  { uniqueAbilityEffects: effects as any },
        }).catch(() => {});
      }

      if (effects.length > 0) {
        bonuses.abilityEffects = [...bonuses.abilityEffects, ...effects];
        const p = compositePassives(bonuses.abilityEffects);
        bonuses.atkMult       *= p.atkMult;
        bonuses.hpMult        *= p.hpMult;
        bonuses.defMult       *= p.defMult;
        bonuses.critRateBonus += p.critRateBonus;
        bonuses.critDmgBonus  += p.critDmgBonus;
        bonuses.lifesteal     += p.lifesteal;
        bonuses.energyBonus   += p.energyBonus;
        bonuses.elemDmgBonus  += p.elemDmgBonus;
        bonuses.activeLabels.push(`✦ Unique${user.uniqueAbilityName ? ` — ${user.uniqueAbilityName}` : ""}:\n${formatEffects(effects).split("\n").map(l => "  › " + l).join("\n")}`);
      }
    }
  }
```

This is the exact same body as before, just wrapped in `if (characterId === "self") { ... }` with `bonuses.abilityVersion = user.abilityVersion ?? 1;` moved inside the gate too (an ally has no meaningful ability version if it never gets a Unique Ability applied — leaving it at the `PlayerBonuses` default of `1` from the initial object literal is correct for allies).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/setBonus.ts
git commit -m "fix(bonuses): Unique Ability no longer leaks into ally-scoped resolvePlayerBonuses calls"
```

---

### Task 2: `duel.ts` — allies use their own bonuses

**Files:**
- Modify: `src/commands/rpg/duel.ts`

- [ ] **Step 1: Add `bonuses` to `DuelAllyBundle` and resolve it in `buildDuelSideRoster`**

Current (~line 75):
```ts
interface DuelAllyBundle {
  characterId: string; kit: PlayableCharacterKit; hp: number; hpMax: number;
  mechanicState: unknown; basicLevel: number; skillLevel: number; ultimateLevel: number;
  introLevel: number; forteLevel: number; constellation: number; solaceStats: any;
}
```
New:
```ts
interface DuelAllyBundle {
  characterId: string; kit: PlayableCharacterKit; hp: number; hpMax: number;
  mechanicState: unknown; basicLevel: number; skillLevel: number; ultimateLevel: number;
  introLevel: number; forteLevel: number; constellation: number; solaceStats: any;
  bonuses: PlayerBonuses;
}
```

Current (~line 264, inside `buildDuelSideRoster`):
```ts
    const solaceStats = await kit.resolveStats(userId);
    // Use the ally's own gear/level-resolved HP, not the fixed level-90 base.
    const hpMax = solaceStats.hp;
    bundles[pos] = {
      characterId: value, kit, hp: hpMax, hpMax, mechanicState: kit.createInitialMechanicState(),
      basicLevel: progress.basicLevel ?? 1, skillLevel: progress.skillLevel ?? 1, ultimateLevel: progress.ultimateLevel ?? 1,
      introLevel: progress.introLevel ?? 1, forteLevel: progress.forteLevel ?? 1, constellation: progress.constellation ?? 0,
      solaceStats,
    };
```
New:
```ts
    const solaceStats = await kit.resolveStats(userId);
    // Ally's own equipped grid's full bonus set — elemDmgBonus/lifesteal/
    // elementPassive/echoSkill/named-set mechanics, NOT the player's. Cheap:
    // resolvePlayerBonuses caches per (userId, characterId) for 30s and
    // kit.resolveStats() already calls it internally for the stat numbers.
    const bonuses = await resolvePlayerBonuses(userId, value);
    // Use the ally's own gear/level-resolved HP, not the fixed level-90 base.
    const hpMax = solaceStats.hp;
    bundles[pos] = {
      characterId: value, kit, hp: hpMax, hpMax, mechanicState: kit.createInitialMechanicState(),
      basicLevel: progress.basicLevel ?? 1, skillLevel: progress.skillLevel ?? 1, ultimateLevel: progress.ultimateLevel ?? 1,
      introLevel: progress.introLevel ?? 1, forteLevel: progress.forteLevel ?? 1, constellation: progress.constellation ?? 0,
      solaceStats, bonuses,
    };
```

- [ ] **Step 2: Add `cAllyBonuses`/`dAllyBonuses` to `DuelState`, mirroring `cAllySolaceStats`/`dAllySolaceStats`**

Current (~line 101):
```ts
  cAllySolaceStats: (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null; // each side's own resolved stats
```
New (add right after):
```ts
  cAllySolaceStats: (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null; // each side's own resolved stats
  cAllyBonuses: PlayerBonuses | null; // the currently-active ally's own full bonus set (elemDmgBonus/lifesteal/echoSkill/named-set/etc.)
```
Do the same for the `d` side (currently ~line 129):
```ts
  dAllySolaceStats: (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null; // each side's own resolved stats
  dAllyBonuses: PlayerBonuses | null;
```

- [ ] **Step 3: Set the initial value at fight-init (`startDuelMatch`)**

Current (~line 496):
```ts
    const cAllySolaceStats = cInitialBundle?.solaceStats as (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null;
    const dAllySolaceStats = dInitialBundle?.solaceStats as (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null;
```
New:
```ts
    const cAllySolaceStats = cInitialBundle?.solaceStats as (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null;
    const dAllySolaceStats = dInitialBundle?.solaceStats as (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null;
    const cAllyBonuses = cInitialBundle?.bonuses ?? null;
    const dAllyBonuses = dInitialBundle?.bonuses ?? null;
```
Then add `cAllyBonuses,` and `dAllyBonuses,` to the `state: DuelState = { ... }` object literal, next to the existing `cAllySolaceStats,`/`dAllySolaceStats,` entries (~lines 506/530 region — search for `cAllySolaceStats` inside the object literal, not the earlier `const` declarations).

- [ ] **Step 4: Sync on voluntary swap**

Two spots (combo and no-combo branches) currently do:
```ts
            state.cAllySolaceStats = finalBundle?.solaceStats ?? null;
```
and
```ts
            state.dAllySolaceStats = finalBundle?.solaceStats ?? null;
```
Add immediately after each:
```ts
            state.cAllyBonuses = finalBundle?.bonuses ?? null;
```
```ts
            state.dAllyBonuses = finalBundle?.bonuses ?? null;
```

- [ ] **Step 5: Sync on KO auto-fallback**

In `applyDuelKoFallback`, the `fields` object currently includes `AllySolaceStats: bundle?.solaceStats ?? null,`. Add a sibling entry:
```ts
            AllySolaceStats: bundle?.solaceStats ?? null,
            AllyBonuses: bundle?.bonuses ?? null,
```
Then where `fields.AllySolaceStats` is assigned to `state.cAllySolaceStats`/`state.dAllySolaceStats`, add the matching line:
```ts
            state.cAllySolaceStats = fields.AllySolaceStats; state.cAllyBonuses = fields.AllyBonuses;
```
```ts
            state.dAllySolaceStats = fields.AllySolaceStats; state.dAllyBonuses = fields.AllyBonuses;
```

- [ ] **Step 6: Make the per-turn `myBonus` active-unit-aware**

Current (~line 667, inside the main per-turn handler — BEFORE `myIsAllyActing` is computed):
```ts
        const myBonus  = isChallenger ? state.cBonuses  : state.dBonuses;
```
Delete this line entirely from its current position.

Then, right after the existing block that computes `myIsAllyActing` (currently):
```ts
        const myAllySolaceStats  = isChallenger ? state.cAllySolaceStats : state.dAllySolaceStats;
        const oppAllySolaceStats = isChallenger ? state.dAllySolaceStats : state.cAllySolaceStats;
        const myIsAllyActing     = myActiveUnit === "ally" && myAllySolaceStats !== null;
        const oppIsAllyDefending = (isChallenger ? state.dActiveUnit : state.cActiveUnit) === "ally" && oppAllySolaceStats !== null;
```
add:
```ts
        const myAllyBonuses = isChallenger ? state.cAllyBonuses : state.dAllyBonuses;
        const myBonus = myIsAllyActing ? myAllyBonuses! : (isChallenger ? state.cBonuses : state.dBonuses);
```

- [ ] **Step 7: Make the echo-skill-button-label `myBonus` (inside `buildDuelButtons`) active-unit-aware too**

Current (~line 329, a SEPARATE function/scope from Step 6 — `buildDuelButtons` already has `myActiveUnit` as a local):
```ts
  const myBonus         = isChallenger ? state.cBonuses : state.dBonuses;
```
New:
```ts
  const myActiveAllyBonuses = isChallenger ? state.cAllyBonuses : state.dAllyBonuses;
  const myBonus         = (myActiveUnit === "ally" && myActiveAllyBonuses) ? myActiveAllyBonuses : (isChallenger ? state.cBonuses : state.dBonuses);
```
(`myActiveUnit` is already defined earlier in this function per the existing code — confirm it's in scope above this line; it is, per the existing `buildDuelButtons` locals block.)

- [ ] **Step 8: Simplify the now-redundant `myElemDmg`/`myLife` special-casing**

This session already patched `myElemDmg`/`myLife` to branch on `myIsAllyActing` reading from `myAllySolaceStats`. Now that `myBonus` itself is correctly active-unit-aware, this is redundant — `myBonus.elemDmgBonus`/`myBonus.lifesteal` are already correct. Current (~line 750, right after the `activeAtk`/`activeCritDmg`/`activeCritBase`/`oppActiveDef` block):
```ts
        const myElemDmg = myIsAllyActing ? myAllySolaceStats!.elemDmgBonus : (isChallenger ? state.cElemDmg   : state.dElemDmg);
        const myLife    = myIsAllyActing ? myAllySolaceStats!.lifesteal    : (isChallenger ? state.cLifesteal : state.dLifesteal);
```
New:
```ts
        const myElemDmg = myBonus.elemDmgBonus;
        const myLife    = myBonus.lifesteal;
```

- [ ] **Step 9: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors. `PlayerBonuses` must already be imported in duel.ts (it is — used for `cBonuses`/`dBonuses` typing already).

Run: `npm run build`
Expected: clean.

- [ ] **Step 10: Live verification**

Set up two test/alt accounts. Give one account an ally (via `/team`) with a DIFFERENT named echo set equipped on the ally's own grid than whatever the player's own "self" grid has (e.g. player's self grid = Voidborn Remnant, ally's grid = Radiant Convergence). Start a `/duel`, swap to the ally mid-fight, and confirm:
- The combat log's elemental-DMG/lifesteal numbers change to match the ally's own grid once active (compare damage output against what the ally's echoes should produce vs. what the player's echoes would have produced — they should now differ).
- The ally's own named-set mechanic (e.g. Radiant Convergence's turn-heal) fires while the ally is active, not the player's set's mechanic.
- The Echo Skill button label matches the ally's own Main-slot echo, not the player's.
- A normal (no-ally) `/duel` still behaves identically to before this change — full challenge/accept/fight/win, matching the verification already done for the earlier `startDuelMatch()` refactor this session.

- [ ] **Step 11: Commit**

```bash
git add src/commands/rpg/duel.ts
git commit -m "fix(duel): allies use their own elemDmgBonus/lifesteal/echoSkill/named-set bonuses, not the player's"
```

---

### Task 3: `ascend.ts` — allies use their own bonuses

**Files:**
- Modify: `src/commands/rpg/ascend.ts`

- [ ] **Step 1: Add `bonuses` to the local `AllyBundle` interface**

Current (~line 400):
```ts
    interface AllyBundle {
      characterId: string;
      kit: PlayableCharacterKit;
      hp: number;
      hpMax: number;
      mechanicState: unknown;
      basicLevel: number;
      skillLevel: number;
      ultimateLevel: number;
      introLevel: number;
      forteLevel: number;
      constellation: number;
      solaceStats: any;
    }
```
New: add `bonuses: PlayerBonuses;` as the last field.

- [ ] **Step 2: Resolve it in the bundle-building loop**

Current (~line 430):
```ts
      const resolvedStats = await kit.resolveStats(interaction.user.id);
      // resolvedStats.hp is the ally's OWN gear/level-resolved HP — ...
      const hpMax = resolvedStats.hp;
      allyBundles[pos] = {
        characterId:   value,
        kit,
        hp:            hpMax,
        hpMax,
        mechanicState: kit.createInitialMechanicState(),
        basicLevel:    progress.basicLevel    ?? 1,
        skillLevel:    progress.skillLevel    ?? 1,
        ultimateLevel: progress.ultimateLevel ?? 1,
        introLevel:    progress.introLevel    ?? 1,
        forteLevel:    progress.forteLevel    ?? 1,
        constellation: progress.constellation ?? 0,
        solaceStats:   resolvedStats,
      };
```
New (add the resolve call before `hpMax`, and the field to the object):
```ts
      const resolvedStats = await kit.resolveStats(interaction.user.id);
      const allyBonuses = await resolvePlayerBonuses(interaction.user.id, value);
      // resolvedStats.hp is the ally's OWN gear/level-resolved HP — ...
      const hpMax = resolvedStats.hp;
      allyBundles[pos] = {
        characterId:   value,
        kit,
        hp:            hpMax,
        hpMax,
        mechanicState: kit.createInitialMechanicState(),
        basicLevel:    progress.basicLevel    ?? 1,
        skillLevel:    progress.skillLevel    ?? 1,
        ultimateLevel: progress.ultimateLevel ?? 1,
        introLevel:    progress.introLevel    ?? 1,
        forteLevel:    progress.forteLevel    ?? 1,
        constellation: progress.constellation ?? 0,
        solaceStats:   resolvedStats,
        bonuses:       allyBonuses,
      };
```
Confirm `resolvePlayerBonuses` is already imported (it is — used for the top-level `bonuses` a few lines above this block).

- [ ] **Step 3: Add an `allyBonuses` loop-local, synced by `syncActiveBundle()`**

Current (~line 472-483, the "legacy single-ally variables" block):
```ts
    let activeAllyCharacterId: string | null = null;
    let allyKit: PlayableCharacterKit | null = null;
    let allyHp = 0;
    let allyHpMax = 0;
    let allyMechanicState: unknown = null;
    let allyBasicLevel = 1;
    let allySkillLevel = 1;
    let allyUltimateLevel = 1;
    let allyIntroLevel = 1;
    let allyForteLevel = 1;
    let allyConstellation = 0;
    let allySolaceStats: any = null;
```
New: add `let allyBonuses: PlayerBonuses | null = null;` after `allySolaceStats`.

Then find `syncActiveBundle()` (~line 495):
```ts
    function syncActiveBundle(): AllyBundle | null {
      const bundle = isPlayerActive() ? null : (allyBundles[activeUnit] ?? null);
      activeAllyCharacterId = bundle?.characterId ?? null;
      allyKit               = bundle?.kit ?? null;
      allyHp                = bundle?.hp ?? 0;
      allyHpMax             = bundle?.hpMax ?? 0;
      allyMechanicState     = bundle?.mechanicState ?? null;
      allyBasicLevel        = bundle?.basicLevel ?? 1;
      allySkillLevel        = bundle?.skillLevel ?? 1;
      allyUltimateLevel     = bundle?.ultimateLevel ?? 1;
      allyIntroLevel        = bundle?.introLevel ?? 1;
      allyForteLevel        = bundle?.forteLevel ?? 1;
      allyConstellation     = bundle?.constellation ?? 0;
      allySolaceStats       = bundle?.solaceStats ?? null;
      return bundle;
    }
```
New: add `allyBonuses = bundle?.bonuses ?? null;` right after the `allySolaceStats` line, before `return bundle;`.

- [ ] **Step 4: Introduce `activeBonuses` where `isAllyActingOrDefending` is computed**

Current (~line 638):
```ts
        const isAllyActingOrDefending = !isPlayerActiveNow && allySolaceStats !== null;
        const activeAtk     = isAllyActingOrDefending ? allySolaceStats!.atk     : stats.atk;
        const activeDef     = isAllyActingOrDefending ? allySolaceStats!.def     : stats.def;
        const activeCritDmg = isAllyActingOrDefending ? allySolaceStats!.critDmg : stats.critDmg;
        const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, (isAllyActingOrDefending ? allySolaceStats!.critRate : stats.critRate) + radCrit + stormCritBuff), state.playerHp, state.playerHpMax);
```
New (add `activeBonuses` right after; leave the existing lines as-is since `apply5pcLowHpCrit(bonuses, ...)` on this exact line is about to be superseded per Step 5):
```ts
        const isAllyActingOrDefending = !isPlayerActiveNow && allySolaceStats !== null;
        const activeBonuses = isAllyActingOrDefending ? allyBonuses! : bonuses;
        const activeAtk     = isAllyActingOrDefending ? allySolaceStats!.atk     : stats.atk;
        const activeDef     = isAllyActingOrDefending ? allySolaceStats!.def     : stats.def;
        const activeCritDmg = isAllyActingOrDefending ? allySolaceStats!.critDmg : stats.critDmg;
        const activeCritRate = apply5pcLowHpCrit(activeBonuses, Math.min(1, (isAllyActingOrDefending ? allySolaceStats!.critRate : stats.critRate) + radCrit + stormCritBuff), state.playerHp, state.playerHpMax);
```

- [ ] **Step 5: Replace `bonuses.X` reads with `activeBonuses.X` for the acting/defending unit, turn-logic only**

From this point down to the end of the turn-handling collector callback (NOT the pre-fight setup above `isAllyActingOrDefending`, and NOT any header/embed rendering that's intentionally always about the human player's account), replace every `bonuses.elemDmgBonus`, `bonuses.elementPassive`, `bonuses.lifesteal`, `bonuses.echoSkill`, `bonuses.abilityEffects`, `bonuses.healingBonus`, `bonuses.spdFlat`, `bonuses.activeNamedSetId` read with `activeBonuses.` — this repeats the exact same field name, just swapping the receiver object. Do NOT touch `radCrit`/`stormCritBuff`-style locals computed BEFORE `activeBonuses` exists (those already correctly use `bonuses.elementPassive` for pre-turn setup that happens before the active/defending distinction matters, e.g. Radiance's crit bonus calc reading `bonuses.elementPassive` at the very top of the turn before `activeBonuses` is introduced — leave those, since they run once per turn using `state.playerHp` regardless of who's active; only the sites AFTER `activeBonuses` is defined need the swap). Concretely, using the exact line numbers found this session (re-grep after Step 1-4's edits shift line numbers before making this pass):

```bash
grep -n "bonuses\.\(elemDmgBonus\|elementPassive\|lifesteal\|echoSkill\|abilityEffects\|healingBonus\|spdFlat\|activeNamedSetId\)" src/commands/rpg/ascend.ts
```

For every match at or after the `activeBonuses` line from Step 4, change `bonuses.` to `activeBonuses.`. Leave matches from BEFORE that line (pre-fight setup, echo-skill button rendering before the collector, etc.) untouched — those are correctly self-scoped display/setup code, not the acting-unit's turn.

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/ascend.ts
git commit -m "fix(ascend): allies use their own elemDmgBonus/lifesteal/echoSkill/named-set bonuses, not the player's"
```

---

### Task 4: `boss.ts` — same fix, same pattern

**Files:**
- Modify: `src/commands/rpg/boss.ts`

- [ ] **Step 1-5: Repeat Task 3's Steps 1-5 verbatim against `boss.ts`**

`boss.ts` was confirmed this session to share the exact same structure as `ascend.ts`: a local `AllyBundle` interface, the same bundle-building loop shape, a `syncActiveBundle()` function (at its own line, currently ~429), and the same `isAllyActingOrDefending`/`activeAtk`/`activeCritRate` block (currently ~643-647) reading `apply5pcLowHpCrit(bonuses, ...)`. Apply the identical five edits: add `bonuses: PlayerBonuses` to the interface, resolve `resolvePlayerBonuses(interaction.user.id, value)` in the bundle-building loop, add `let allyBonuses: PlayerBonuses | null = null;` alongside the other ally locals, sync it inside `syncActiveBundle()`, and introduce `activeBonuses` right where `isAllyActingOrDefending` is computed — then sweep the rest of the turn-handling logic for `bonuses.X` reads at/after that point and switch them to `activeBonuses.X`.

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/boss.ts
git commit -m "fix(boss): allies use their own elemDmgBonus/lifesteal/echoSkill/named-set bonuses, not the player's"
```

---

### Task 5: `dungeon.ts` — same fix, same pattern

**Files:**
- Modify: `src/commands/rpg/dungeon.ts`

- [ ] **Step 1-5: Repeat Task 3's Steps 1-5 verbatim against `dungeon.ts`**

Confirmed this session: `dungeon.ts` has the same `AllyBundle` interface shape, the same bundle-building loop, a `syncActiveBundle()` function (currently ~642), and the same `isAllyActingOrDefending`/`activeAtk` block (currently ~873-877, using a fight-state object `ws` instead of `state` — note the crit-rate line uses local name `cRate` instead of `activeCritRate`, but the pattern is otherwise identical: `apply5pcLowHpCrit(bonuses, ...)` still needs its first argument swapped to `activeBonuses`). Apply the same five edits.

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/dungeon.ts
git commit -m "fix(dungeon): allies use their own elemDmgBonus/lifesteal/echoSkill/named-set bonuses, not the player's"
```

---

### Task 6: `field-boss.ts` — same fix, same pattern

**Files:**
- Modify: `src/commands/rpg/field-boss.ts`

- [ ] **Step 1-5: Repeat Task 3's Steps 1-5 verbatim against `field-boss.ts`**

Confirmed this session: same `AllyBundle` interface shape, `kit.resolveStats(interaction.user.id)` call in the bundle loop (currently ~457), a `syncActiveBundle(): AllyBundle | null` function (currently ~517), and the same `isAllyActingOrDefending`/`activeAtk`/`activeCritRate` block (currently ~784-788). Apply the same five edits.

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/field-boss.ts
git commit -m "fix(field-boss): allies use their own elemDmgBonus/lifesteal/echoSkill/named-set bonuses, not the player's"
```

---

### Task 7: `raid.ts` — per-participant version of the same fix

**Files:**
- Modify: `src/commands/rpg/raid.ts`

Raid stores ally state directly on each participant object rather than in loose loop-locals, but the underlying bug is identical: `current.bonuses`/`p.bonuses` is resolved once per participant at raid-start and read directly everywhere, never swapped for the active ally.

- [ ] **Step 1: Add `bonuses` to `RaidAllyBundle`**

Current (~line 81):
```ts
interface RaidAllyBundle {
  characterId: string; kit: PlayableCharacterKit; hp: number; hpMax: number;
  mechanicState: unknown; basicLevel: number; skillLevel: number; ultimateLevel: number;
  introLevel: number; forteLevel: number; constellation: number; solaceStats: any;
}
```
New: add `bonuses: PlayerBonuses;` as the last field.

- [ ] **Step 2: Resolve it in the bundle-building loop**

Current (~line 778):
```ts
    const solaceStats = await kit.resolveStats(userId);
    // ...
    const hpMax = solaceStats.hp;
```
Find the object literal that follows (constructing `allyBundles[pos] = { ..., solaceStats, };`) and, mirroring Task 2 Step 1's duel.ts edit:
```ts
    const solaceStats = await kit.resolveStats(userId);
    const allyBonuses = await resolvePlayerBonuses(userId, value);
    // ...
    const hpMax = solaceStats.hp;
```
then add `bonuses: allyBonuses,` to that object literal, alongside the existing `solaceStats,` entry.

- [ ] **Step 3: Add `allyBonuses` to the per-participant state shape and its initial value**

Find where the participant type/interface declares `allySolaceStats: (ResolvedStats & {...}) | null;` (search `allySolaceStats` in the participant interface, near where `activeUnit`/`activePosition`/`allyBundles` are declared on the same type, currently around line 288-293). Add a sibling field:
```ts
  allyBonuses: PlayerBonuses | null;
```
Find where the participant object is constructed at raid-start (search `allySolaceStats = initialBundle?.solaceStats`, currently ~line 793) and add:
```ts
  const allySolaceStats = initialBundle?.solaceStats as (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null;
  const allyBonuses = initialBundle?.bonuses ?? null;
```
then include `allyBonuses,` in the participant object literal alongside `allySolaceStats,`.

- [ ] **Step 4: Sync on swap/KO-fallback**

Find every assignment of `current.allySolaceStats = finalBundle?.solaceStats ?? null;` or `p.allySolaceStats = bundle?.solaceStats ?? null;` (currently at ~1301 and ~1935) and add a sibling line immediately after each:
```ts
        current.allyBonuses = finalBundle?.bonuses ?? null;
```
```ts
                p.allyBonuses = bundle?.bonuses ?? null;
```
(match the exact receiver variable name — `current` at line 1301, `p` at line 1935 — and the exact indentation of the line it follows.)

- [ ] **Step 5: Introduce `activeBonuses` where `activeAtk` is computed**

Current (~line 1150):
```ts
      const activeAtk      = currentIsAllyActing ? current.allySolaceStats!.atk      : current.atk;
      const activeCritDmg  = currentIsAllyActing ? current.allySolaceStats!.critDmg  : current.critDmg;
      const activeCritBase = currentIsAllyActing ? current.allySolaceStats!.critRate : current.critRate;
```
New (add before these lines, since `mySetId`/`radCrit` above this already read `current.bonuses` directly and need the swap too — see Step 6):
```ts
      const activeBonuses  = currentIsAllyActing ? current.allyBonuses!             : current.bonuses;
      const activeAtk      = currentIsAllyActing ? current.allySolaceStats!.atk      : current.atk;
      const activeCritDmg  = currentIsAllyActing ? current.allySolaceStats!.critDmg  : current.critDmg;
      const activeCritBase = currentIsAllyActing ? current.allySolaceStats!.critRate : current.critRate;
```

- [ ] **Step 6: Replace `current.bonuses.X` reads with `activeBonuses.X` for the acting unit's turn logic**

Run:
```bash
grep -n "current\.bonuses\." src/commands/rpg/raid.ts
```
For every match from the `mySetId`/`radCrit` lines just above the Step 5 block through the rest of the turn-handling collector callback (button-click handler for the acting participant's own action), change `current.bonuses.` to `activeBonuses.`. Leave `p.bonuses.echoSkill` at line ~480 (the button-rendering code building each participant's OWN action-row before any turn happens) — that one already needs the same treatment, so include it too: change it to check that participant's own active-unit state the same way `buildDuelButtons` was fixed in Task 2 Step 7 — i.e. wrap it as:
```ts
    const pActiveBonuses = p.activeUnit === "ally" && p.allyBonuses ? p.allyBonuses : p.bonuses;
    if (pActiveBonuses.echoSkill) {
```
(replacing the current `if (p.bonuses.echoSkill) {` and the two `p.bonuses.echoSkill.name` references immediately below it with `pActiveBonuses.echoSkill`/`pActiveBonuses.echoSkill.name`).

Do NOT touch `p.bonuses.healingBonus` at line ~1735 (the party-heal application, which explicitly heals every OTHER living participant using THEIR OWN `p.bonuses.healingBonus` inside a loop over `raid.participants` — that's already correct per-participant scoping from a design standpoint, but per this same fix it technically should also become active-unit-aware for consistency. Since this loop already iterates `for (const p of raid.participants)`, apply the same swap: change `p.bonuses.healingBonus` to `(p.activeUnit === "ally" && p.allyBonuses ? p.allyBonuses : p.bonuses).healingBonus`).

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "fix(raid): allies use their own elemDmgBonus/lifesteal/echoSkill/named-set bonuses, not the player's"
```

---

### Task 8: Final verification + deploy

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: clean, across all 7 modified files.

- [ ] **Step 2: Push + SSH deploy**

```bash
git push origin main
```
Then on the VM: `git pull && npm run build && pm2 restart cartethyia` (no schema change, no new command — `prisma generate`/`npm run deploy` not needed).

- [ ] **Step 3: Live spot-check**

Per Task 2 Step 10's scenario (different named sets on player vs. ally), confirm in production that swapping to an ally mid-`/duel` shows that ally's own set bonuses in the combat log. For the other 5 commands, confirm via `/ascend`, `/boss`, `/dungeon`, `/field-boss`, and `/raid` that a fight with an ally in the roster completes normally (no crash, no `undefined` reference) — full regression coverage isn't practical without a test framework, but a normal fight completing end-to-end for each command rules out the most likely failure mode (a missed `activeBonuses` conversion leaving `bonuses` `undefined` somewhere it shouldn't be).
