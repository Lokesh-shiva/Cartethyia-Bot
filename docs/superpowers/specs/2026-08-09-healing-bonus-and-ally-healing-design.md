# Healing Bonus + Ally/Party Healing — Design Spec

## Goal

`HEALING_PCT` ("Healing Bonus") is a rollable echo substat (base 8%, up to 30% at high echo level) that has been completely inert since it shipped — `setBonus.ts` explicitly no-ops it (`/* no in-combat healing yet */`). It was the only dead stat found in a full audit of every echo and weapon substat type; everything else is correctly wired.

This spec gives Healing Bonus real value, and — because the only thing it could scale today was Solace's ally-targeted heals — also adds two new ways for **any player, regardless of character ownership**, to heal themselves and (in raid) their teammates:

1. A new heal-flavored generic echo skill, reachable via echoes every player already farms from turn one — not gated behind Solace ownership or a rare boss-echo drop.
2. Healing Bonus scaling for the existing `RADIANT_CONVERGENCE` named set's self-heals.

Non-goals: this does not touch Solace's own heal formulas (Convergence, swap-combo), does not add a new standalone "self-heal" action button, and does not change lifesteal.

## Background — where healing already exists in the codebase

- `allyActions.ts` / `introOutro.ts`: pure `HEAL_ALLY`/`SHIELD_ALLY` primitives (% of target's own max HP). Used by Solace's Ultimate and Intro/Outro swap combos, and the small 5% player-self swap heal/shield (`PLAYER_SELF_INTRO`/`PLAYER_SELF_OUTRO` in `solace.ts`). Solace-only in practice today.
- `echoSkills.ts`: the 4th action button, granted by whichever echo sits in Main slot (slot 0). 21 bespoke 4-cost boss echo skills (`BOSS_ECHO_SKILLS`, keyed by echo name); every 1★/3★ echo instead gets a single fixed `genericEchoSkill(element)` — currently always `{ kind: "PLAIN" }`, a plain bonus-damage hit, regardless of which specific common echo it is.
  - Two of the 21 boss skills already self-heal: `SHIELD` (Tidecaller Sovereign, Luminal Specter — instant heal) and `HEAL_THEN_HIT` (Auric Colossus — heal then bonus damage scaled by the heal). Both output a `healHp` number on `EchoSkillResult`, already wired generically into all 6 solo/duel combat loops' echo-skill handling — but always applied to the CASTER only.
- `namedSets.ts`'s `RADIANT_CONVERGENCE` (Spectro 4pc/5pc set): 4pc heals 3% max HP every turn (stacking a Spectro DMG buff up to 5×); 5pc arms a "Radiant Fracture" enemy debuff on crit-at-full-HP, which later burst-heals 6% HP × stacks when dropping below 50% HP. Self-only, no Healing Bonus scaling.

## Design

### 1. Wire up the stat (`setBonus.ts`)

Add a `healingBonus: number` field to `PlayerBonuses` (default `0`), aggregated the same way every other substat already is:

```ts
case "HEALING_PCT": bonuses.healingBonus += v / 100; break;
```

(Replaces the existing no-op case at `setBonus.ts:328`.)

### 2. New heal-flavored generic echo skill — broadly accessible, no rare drop required

Add a new `EchoSkillDef` kind:

```ts
| { kind: "PARTY_HEAL"; name: string; healPct: number }
```

`applyEchoSkill()` computes it identically to `SHIELD` (`r.healHp = Math.floor(ctx.playerHpMax * def.healPct)`) — the difference from `SHIELD` is purely semantic/targeting (see §4), not in the pure function itself.

**Accessibility decision:** rather than a global change to `genericEchoSkill()` (which would remove the plain-attack option for every 1★/3★ echo in the game — too disruptive to existing damage-focused builds), key the heal variant to the **6 base cost-1 elemental echoes** (Ember Wisp, Frost Mote, Static Spark, Zephyr Mite, Shadow Flicker, Lumen Speck) — the cheapest, most common echoes in the game, obtained from turn one regardless of progression or gacha luck. This is the accessible alternative to gating behind a rare boss echo or a specific character, without forcing every generic echo user into a heal-only skill.

Implementation: add a `GENERIC_HEAL_ECHO_SKILLS: Record<string, EchoSkillDef>` map (same shape/pattern as `BOSS_ECHO_SKILLS`, just for these 6 names) and check it in `getEchoSkillDef`'s cost-1/3 path before falling back to `genericEchoSkill(element)`:

```ts
export function getEchoSkillDef(mainEcho: { name: string; cost: number } | null): EchoSkillDef | null {
  if (!mainEcho) return null;
  if (mainEcho.cost === 4) return BOSS_ECHO_SKILLS[mainEcho.name] ?? { kind: "PLAIN", name: mainEcho.name };
  return GENERIC_HEAL_ECHO_SKILLS[mainEcho.name] ?? null; // null still falls through to genericEchoSkill(element) at call sites
}
```

Call sites currently do `getEchoSkillDef(mainEcho) ?? genericEchoSkill(mainEcho.element)` (or equivalent) — unchanged; `getEchoSkillDef` just now sometimes returns a real def for a 1-cost echo instead of always null.

`healPct` for these: `0.12` (12% max HP) — comparable to the existing boss `SHIELD`/`HEAL_THEN_HIT` skills' 15%, slightly lower since these are trivially farmable rather than boss drops.

### 3. Healing Bonus scales all echo-skill heals

At every call site that currently does something like:
```ts
if (echoResult.healHp > 0) state.cHp = Math.min(state.cHpMax, state.cHp + echoResult.healHp);
```
change the amount applied (not the raw `EchoSkillResult.healHp`, which stays a pure/unscaled number) to:
```ts
const healAmount = Math.floor(echoResult.healHp * (1 + bonuses.healingBonus));
```
This keeps `applyEchoSkill()` a pure function independent of a specific player's gear, matching its existing design (it already takes a plain `EchoSkillCtx`, no `PlayerBonuses`).

### 4. Targeting: who receives the heal

This applies to **all three** heal-capable echo-skill kinds (`SHIELD`, `HEAL_THEN_HIT`, new `PARTY_HEAL`) uniformly — same targeting rule regardless of which kind triggered it:

- **Solo loops (ascend/boss/field-boss/dungeon/encounter) + duel**: heal the acting side — the caster, plus their currently-benched ally if they have a team roster set (mirrors how Solace's Convergence already splits between active+bench). No roster → the full amount goes to the caster only, identical to today's behavior. Fully backward compatible for anyone not using `/team`.
- **Raid**: heal the **whole living party** — every un-defeated participant, each healed for `theirOwnMaxHp * healPct * (1 + theirOwnHealingBonus)` (each participant's own Healing Bonus, not the caster's, scales their own share — consistent with every other per-participant stat in raid.ts). This is the genuinely new capability: today nobody can help a teammate in raid at all.

Implementation shape (per combat loop, at the existing `if (echoResult.healHp > 0)` block):
- Solo/duel: also credit the benched ally bundle's `hp` (same commit-to-bundle pattern already used for swap combos) when a roster exists and a bench position is filled and alive.
- Raid: loop `raid.participants.filter(p => !p.isDefeated)`, computing each participant's own scaled heal amount and applying it to whichever HP pool (`p.hp` or their own active ally bundle) is currently live for them — reuses the same `positionValue`/bundle-write pattern the 3-position swap logic already established.

### 5. `RADIANT_CONVERGENCE` — Healing Bonus scaling only, no ally targeting

Scope stays narrow here: this set's identity is self-sustain, and party-support is already covered by §2–4. Scale its two existing heal amounts by `(1 + healingBonus)`:

- `radiantConvergenceOnTurnHeal`: `healAmount: Math.floor(maxHp * 0.03 * (1 + healingBonus))`
- `radiantConvergenceCheckBurstHeal`: `Math.floor(maxHp * 0.06 * state.spectroFractureTurnsLeft * (1 + healingBonus))`

Both functions currently take `(state, maxHp)` / `(state, currentHp, maxHp)` with no bonuses parameter — add `healingBonus: number` as an additional parameter, defaulting to `0` so any call site not yet updated keeps current behavior. Every call site (7 combat loops) already has `bonuses`/`current.bonuses` in scope at the point these are called, so threading it through is a small, mechanical change per file.

## Error handling / edge cases

- A participant with `healingBonus === 0` (no Healing Bonus gear) sees identical numbers to today — nothing regresses.
- Raid party-heal must skip defeated participants (`!p.isDefeated`) and must not resurrect anyone — only ever raises HP toward `maxHp`, standard `Math.min(maxHp, ...)` clamping throughout, same as every other heal in the codebase.
- Solo/duel bench-heal must handle "no roster" (heal caster only) and "roster exists but bench position is a dead ally" (per existing convention elsewhere in the codebase, dead bench units still exist in the bundle map but shouldn't receive a heal that revives them — clamp to 0 if `bundle.hp <= 0`, i.e. only heal a bench ally that's still alive).
- `GENERIC_HEAL_ECHO_SKILLS` keys must exactly match the 6 base echo names in `NAMED_SET_ECHO_DEFINITIONS`/echo seed data — verify via the same kind of exact-match check that caught the WL8 "The Resonant Absolute" bug earlier this session (a disposable script cross-referencing names before shipping).

## Testing

No automated test framework in this codebase (per project convention) — verification is via `npx tsc --noEmit`, `npm run build`, and manual live testing:
- Equip a base 1-cost echo (e.g. Ember Wisp) in Main slot, confirm its echo skill now heals instead of plain-attacking, in a solo fight with no roster (self-only heal) and with a roster (self+bench heal).
- Same in a raid with 2+ real participants — confirm every living participant's HP increases, not just the caster's.
- Equip a Healing Bonus substat, confirm the heal amount is visibly larger than the same fight without it.
- Run a fight with `RADIANT_CONVERGENCE` 4pc/5pc active, confirm turn-heal and burst-heal amounts scale with Healing Bonus.
