# Healing Bonus + Ally/Party Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the dead `HEALING_PCT` echo substat, add a broadly-accessible heal-flavored echo skill, and make echo-skill heals (+ `RADIANT_CONVERGENCE`'s self-heals) scale with it and reach allies/party instead of only the caster.

**Architecture:** Three shared-library changes (`setBonus.ts`, `echoSkills.ts`, `namedSets.ts`) followed by identical-shaped edits across all 7 combat loops at their existing `result.healHp`/`echoResult.healHp` application sites — scale the amount by `(1 + bonuses.healingBonus)`, then route it to the caster + (in raid) the whole living party instead of only the caster.

**Tech Stack:** TypeScript, no test framework — verification via `npx tsc --noEmit`, `npm run build`, and a disposable name-matching check script (same pattern used to catch the WL8 boss-echo-name bug earlier this session).

**Reference:** [docs/superpowers/specs/2026-08-09-healing-bonus-and-ally-healing-design.md](../specs/2026-08-09-healing-bonus-and-ally-healing-design.md)

---

### Task 1: Wire up the `healingBonus` stat

**Files:**
- Modify: `src/lib/setBonus.ts:328` (the `HEALING_PCT` no-op case) and the `PlayerBonuses` interface (search this file for `interface PlayerBonuses`, add the field next to `lifesteal`/`elemDmgBonus`).

- [ ] **Step 1: Add the field to `PlayerBonuses`**

```ts
healingBonus: number; // from HEALING_PCT echo substat — scales echo-skill heals + RADIANT_CONVERGENCE's self-heals
```
Also initialize it to `0` wherever `PlayerBonuses` is constructed with its other defaults (search `atkFlat:` in the same file — the object literal that builds the default `bonuses` value).

- [ ] **Step 2: Replace the no-op case**

```ts
case "HEALING_PCT":  bonuses.healingBonus += v/100;             break;
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (adding a field to an interface + initializing it is a pure addition).

- [ ] **Step 4: Commit**

```bash
git add src/lib/setBonus.ts
git commit -m "feat(healing): wire up HEALING_PCT substat into PlayerBonuses.healingBonus"
```

---

### Task 2: New heal-flavored generic echo skill on the 6 base cost-1 echoes

**Files:**
- Modify: `src/lib/echoSkills.ts`

- [ ] **Step 1: Add the `PARTY_HEAL` kind to `EchoSkillDef`**

```ts
| { kind: "PARTY_HEAL";      name: string; healPct: number }                 // instant heal, reaches allies/party — see targeting rules in combat loops
```

- [ ] **Step 2: Add the generic-heal map, keyed by the 6 base cost-1 echo names**

```ts
// Broadly-accessible heal option — these are the cheapest, most common 1-cost
// echoes in the game (one per element), obtainable from turn one regardless
// of progression. Deliberately NOT a global genericEchoSkill() change, which
// would remove the plain-attack option for every 1/3-cost echo in the game.
export const GENERIC_HEAL_ECHO_SKILLS: Record<string, EchoSkillDef> = {
  "Ember Wisp":     { kind: "PARTY_HEAL", name: "Ember Ward",   healPct: 0.12 },
  "Frost Mote":     { kind: "PARTY_HEAL", name: "Frost Ward",   healPct: 0.12 },
  "Static Spark":   { kind: "PARTY_HEAL", name: "Static Ward",  healPct: 0.12 },
  "Zephyr Mite":    { kind: "PARTY_HEAL", name: "Zephyr Ward",  healPct: 0.12 },
  "Shadow Flicker": { kind: "PARTY_HEAL", name: "Shadow Ward",  healPct: 0.12 },
  "Lumen Speck":    { kind: "PARTY_HEAL", name: "Lumen Ward",   healPct: 0.12 },
};
```

- [ ] **Step 3: Route cost-1/3 lookups through the new map before falling back to plain**

Change `getEchoSkillDef`:

```ts
export function getEchoSkillDef(mainEcho: { name: string; cost: number } | null): EchoSkillDef | null {
  if (!mainEcho) return null;
  if (mainEcho.cost === 4) return BOSS_ECHO_SKILLS[mainEcho.name] ?? { kind: "PLAIN", name: mainEcho.name };
  return GENERIC_HEAL_ECHO_SKILLS[mainEcho.name] ?? null; // null falls through to genericEchoSkill(element) at call sites, unchanged
}
```

- [ ] **Step 4: Add the `PARTY_HEAL` case to `applyEchoSkill()` and `describeEchoSkill()`**

In `applyEchoSkill()`'s switch (same shape as `SHIELD`):
```ts
case "PARTY_HEAL":
  r.healHp = Math.floor(ctx.playerHpMax * def.healPct);
  break;
```

In `describeEchoSkill()`'s switch:
```ts
case "PARTY_HEAL":       return `Instantly heals ${Math.round(def.healPct * 100)}% of your max HP — in a raid, heals your whole living party instead of just you.`;
```

- [ ] **Step 5: Verify the 6 names match real echo data**

Every call site that resolves an equipped echo already reads `mainEcho.name` off a DB row seeded from `NAMED_SET_ECHO_DEFINITIONS`/the base echo pool in `echoes.ts`. Write a disposable script:

```ts
// scripts/check-heal-echo-names.ts
import { GENERIC_HEAL_ECHO_SKILLS } from "../src/lib/echoSkills";
import { NAMED_SET_ECHO_DEFINITIONS } from "../src/lib/echoes";
const realNames = new Set(NAMED_SET_ECHO_DEFINITIONS.map(e => e.name));
for (const name of Object.keys(GENERIC_HEAL_ECHO_SKILLS)) {
  console.log(`"${name}" -> ${realNames.has(name) ? "FOUND" : "*** MISSING ***"}`);
}
```

Run: `npx tsx scripts/check-heal-echo-names.ts`
Expected: all 6 print `FOUND`. If any print `MISSING`, check `src/lib/echoes.ts` for the actual base echo names (they may live in a different array — search for `"Ember Wisp"` directly) and fix the map's keys to match exactly.

Then delete the script: `rm scripts/check-heal-echo-names.ts`

- [ ] **Step 6: Verify types + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/echoSkills.ts
git commit -m "feat(healing): add PARTY_HEAL echo skill on the 6 base cost-1 echoes"
```

---

### Task 3: `RADIANT_CONVERGENCE` heals scale with Healing Bonus

**Files:**
- Modify: `src/lib/namedSets.ts` (the two heal functions)
- Modify: all 7 combat loops (add the new parameter at each call site)

- [ ] **Step 1: Add the parameter to both functions**

```ts
export function radiantConvergenceOnTurnHeal(state: NamedSetState, maxHp: number, healingBonus: number = 0): { healAmount: number; dmgMult: number } {
  state.spectroHealStacks = Math.min(5, state.spectroHealStacks + 1);
  return { healAmount: Math.floor(maxHp * 0.03 * (1 + healingBonus)), dmgMult: 1 + state.spectroHealStacks * 0.03 };
}
```

```ts
export function radiantConvergenceCheckBurstHeal(
  state: NamedSetState, currentHp: number, maxHp: number, healingBonus: number = 0,
): number {
  if (state.spectroFractureTurnsLeft <= 0 || currentHp / maxHp >= 0.50) return 0;
  const healAmount = Math.floor(maxHp * 0.06 * state.spectroFractureTurnsLeft * (1 + healingBonus));
  state.spectroFractureTurnsLeft = 0;
  return healAmount;
}
```

Both default to `0` so any call site not yet updated in this task compiles and behaves exactly as before — safe to land Task 3's library change and the call-site updates as separate commits if needed.

- [ ] **Step 2: Update every call site to pass the acting unit's `bonuses.healingBonus`**

Find every call via: `grep -rn "radiantConvergenceOnTurnHeal\|radiantConvergenceCheckBurstHeal" src/`. Each of the 7 combat loops has exactly one call to each. Pattern (ascend.ts example, others are the same shape with their own `bonuses`/bonuses-equivalent variable already in scope):

Before:
```ts
const heal = radiantConvergenceOnTurnHeal(namedState, state.playerHpMax);
```
After:
```ts
const heal = radiantConvergenceOnTurnHeal(namedState, state.playerHpMax, bonuses.healingBonus);
```

Before:
```ts
const burst = radiantConvergenceCheckBurstHeal(oppNamedState, oppHpNow, oppHpMaxNow);
```
After — use the healing unit's OWN bonuses, not the opponent's (these calls are typically evaluating whether the unit who just got hit triggers their own burst-heal, so use that unit's own `bonuses`, matching whichever variable the surrounding code already uses for that unit's stat resolution):
```ts
const burst = radiantConvergenceCheckBurstHeal(oppNamedState, oppHpNow, oppHpMaxNow, oppBonus.healingBonus);
```

(Exact local variable name for "this unit's bonuses" varies per file/call site — duel.ts uses `oppBonus`/`myBonus`, raid.ts uses `p.bonuses`/`current.bonuses`, solo loops use `bonuses`. Use whichever is already in scope at each call site — every one of these calls already has access to the relevant unit's `PlayerBonuses` object since named-set procs are resolved per-unit.)

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` after each file, `npm run build` at the end.
Expected: no errors.

```bash
git add src/lib/namedSets.ts src/commands/rpg/ascend.ts src/commands/rpg/boss.ts src/commands/rpg/field-boss.ts src/commands/rpg/dungeon.ts src/lib/encounter.ts src/commands/rpg/duel.ts src/commands/rpg/raid.ts
git commit -m "feat(healing): RADIANT_CONVERGENCE self-heals scale with Healing Bonus"
```

---

### Task 4: Echo-skill heals scale + reach the bench ally (5 solo loops + duel)

**Files:** `src/commands/rpg/ascend.ts`, `src/commands/rpg/boss.ts`, `src/commands/rpg/field-boss.ts`, `src/commands/rpg/dungeon.ts`, `src/lib/encounter.ts`, `src/commands/rpg/duel.ts`

Each of these 5 solo loops has one line of the shape `state.playerHp = Math.min(state.playerHpMax, state.playerHp + ar_e.healHp + result.healHp);` (exact variable names differ — `state.playerHp`/`ws.playerHp`, `ar_e`/`result` — see the grep output already collected: ascend.ts:1288, boss.ts:1230, field-boss.ts:1396, dungeon.ts:1446, encounter.ts:1219). Duel.ts has `if (echoResult.healHp > 0) { state.cHp/dHp = ... }` at duel.ts:1444-1446.

- [ ] **Step 1 (ascend.ts): split out the echo-skill heal and route it to the bench**

Before (line 1288):
```ts
state.playerHp     = Math.min(state.playerHpMax, state.playerHp + ar_e.healHp + result.healHp);
```
After:
```ts
const scaledEchoHeal = Math.floor(result.healHp * (1 + bonuses.healingBonus));
state.playerHp = Math.min(state.playerHpMax, state.playerHp + ar_e.healHp + scaledEchoHeal);
if (scaledEchoHeal > 0) {
  const benchPos = ([1, 2, 3] as PositionIndex[]).find(pos => pos !== activeUnit && allyBundles[pos] && allyBundles[pos]!.hp > 0);
  if (benchPos) {
    const b = allyBundles[benchPos]!;
    b.hp = Math.min(b.hpMax, b.hp + scaledEchoHeal);
  }
}
```
(`activeUnit`/`allyBundles`/`PositionIndex` are already in scope in ascend.ts from the earlier 3-position work.)

- [ ] **Step 2 (boss.ts): same pattern at line 1230**

Same shape as Step 1 — boss.ts already has `activeUnit`, `allyBundles`, `bonuses`, `PositionIndex` in scope from its own 3-position conversion.

- [ ] **Step 3 (field-boss.ts): same pattern at line 1396**

Note this file's line combines lifesteal too (`applyLifesteal(echoLifesteal, ...) + ar_e.healHp + result.healHp`) — only change the `result.healHp` term to `scaledEchoHeal` as computed above; leave the lifesteal/`ar_e.healHp` terms untouched.

- [ ] **Step 4 (dungeon.ts): same pattern at line 1446**

Uses `ws.playerHp`/`ws.playerHpMax`/`ws.allyBundles`/`ws.activeUnit` (WaveState-scoped, not top-level `state`) — same shape, prefixed with `ws.`.

- [ ] **Step 5 (encounter.ts): same pattern at line 1219**

- [ ] **Step 6 (duel.ts): same pattern, doubled for both sides at lines 1444-1446**

Before:
```ts
if (echoResult.healHp > 0) {
  if (isChallenger) state.cHp = Math.min(state.cHpMax, state.cHp + echoResult.healHp);
  else              state.dHp = Math.min(state.dHpMax, state.dHp + echoResult.healHp);
}
```
After:
```ts
if (echoResult.healHp > 0) {
  const scaledEchoHeal = Math.floor(echoResult.healHp * (1 + myBonus.healingBonus));
  if (isChallenger) state.cHp = Math.min(state.cHpMax, state.cHp + scaledEchoHeal);
  else              state.dHp = Math.min(state.dHpMax, state.dHp + scaledEchoHeal);
  const myRoster = isChallenger ? state.cRoster : state.dRoster;
  const myActivePos = isChallenger ? state.cActivePosition : state.dActivePosition;
  const myAllyBundles = isChallenger ? state.cAllyBundles : state.dAllyBundles;
  const benchPos = ([1, 2, 3] as PositionIndex[]).find(pos => pos !== myActivePos && myAllyBundles[pos] && myAllyBundles[pos]!.hp > 0);
  if (benchPos) {
    const b = myAllyBundles[benchPos]!;
    b.hp = Math.min(b.hpMax, b.hp + scaledEchoHeal);
  }
}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`
Expected: no errors across all 6 files.

- [ ] **Step 8: Commit**

```bash
git add src/commands/rpg/ascend.ts src/commands/rpg/boss.ts src/commands/rpg/field-boss.ts src/commands/rpg/dungeon.ts src/lib/encounter.ts src/commands/rpg/duel.ts
git commit -m "feat(healing): echo-skill heals scale with Healing Bonus and reach the benched ally"
```

---

### Task 5: Raid — echo-skill heals reach the whole living party

**Files:** `src/commands/rpg/raid.ts`

- [ ] **Step 1: Find raid's echo-skill heal application**

`grep -n "result.healHp" src/commands/rpg/raid.ts` → line 1722: `if (result.healHp > 0) current.hp = Math.min(current.hpMax, current.hp + result.healHp);`

Replace with a party-wide loop instead of only crediting `current`:

```ts
if (result.healHp > 0) {
  for (const p of raid.participants) {
    if (p.isDefeated) continue;
    const scaledHeal = Math.floor(result.healHp * (1 + p.bonuses.healingBonus));
    if (positionValue(p.roster, p.activePosition) === "self") {
      p.hp = Math.min(p.hpMax, p.hp + scaledHeal);
    } else {
      const b = p.allyBundles[p.activePosition];
      if (b) b.hp = Math.min(b.hpMax, b.hp + scaledHeal);
    }
  }
}
```

This heals every living participant's currently-ACTIVE unit (self or their own active ally) — not the caster's bench, since raid's whole point here is reaching teammates, not your own bench (bench-healing for the caster specifically is arguably nice-to-have but out of scope; every other participant already gets healed which is the actual ask).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. (`positionValue` is already imported in raid.ts from the 3-position work.)

- [ ] **Step 3: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "feat(healing): raid echo-skill heals reach the whole living party, not just the caster"
```

---

### Task 6: Final build + deploy

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: clean, zero errors.

- [ ] **Step 2: Push + deploy**

```bash
git push origin main
```
Then SSH deploy (per this project's standard flow): `git pull && npx prisma generate && npm run build && pm2 restart cartethyia` on the VM. (`npx prisma generate` only strictly needed if a schema change happened — it didn't in this plan, but running it is harmless.)

No slash-command signature changes in this plan, so no `npm run deploy` step is needed.

- [ ] **Step 3: Manual verification**

- Equip a base 1-cost echo (e.g. Ember Wisp) in Main slot in a solo fight with no `/team` roster — confirm its 4th button now heals instead of attacking, self-only.
- Same fight with a roster set — confirm the benched ally's HP also rises.
- In a raid with 2+ real participants, trigger the echo skill — confirm every living participant's HP rises, not just the caster's.
- Compare heal amounts with and without a Healing Bonus substat equipped — confirm the bonus visibly increases the heal.
- Run a fight with `RADIANT_CONVERGENCE` 4pc/5pc active — confirm turn-heal and burst-heal amounts scale with Healing Bonus.
