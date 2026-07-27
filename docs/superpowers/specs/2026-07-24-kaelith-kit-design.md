# Kaelith — Kit Design

## Overview

Kaelith is the first character built on the `PlayableCharacterKit` template. Standard-banner 4★, Havoc element, Broadblade user, no signature weapon. His identity: a straightforward, aggressive DPS with zero standing-buff complexity (unlike Solace's Attunement) — a stack-and-detonate rhythm instead. Recommended echo set: Voidborn Remnant (Havoc). This is the character whose implementation also does the deferred combat-loop dispatch rewiring from the character-kit template (see that spec's Phasing section) — the first real proof the template works for a second character.

## Core mechanic: Stacks

- Kaelith holds a **stack counter**, base cap **5** (raised by Constellations — see below).
- **Basic Attack** grants **+1 stack** per hit (cap-limited), on top of dealing its own damage.
- **Skill** is a **partial detonate**: consumes **2 stacks** (1 at C2+) for bonus damage on top of its base hit. If fewer than 2 (or 1, post-C2) stacks are available, it still fires at base damage with no bonus — never blocked from being used.
- **Ultimate** is a **full detonate**: consumes **all current stacks** (down to 0) for a large finisher. 0 stacks is still a valid (if weak) Ultimate — never blocked.
- Stack count is visible in the battle status line every turn, the same way Concerto Energy/Attunement mode currently show for Solace.

## Stats (Lv90 ceiling, same level-scaling formula shape as `solaceStatsAtLevel` — `ceiling * (floorFraction + (1 - floorFraction) * t)`, DPS-biased floor fractions so his numbers grow meaningfully across levels instead of being front-loaded like Solace's support curve)

| Stat | Lv90 ceiling | Floor fraction |
|---|---|---|
| HP | 950 | 0.30 |
| ATK | 145 | 0.35 |
| DEF | 85 | 0.30 |
| Speed | 105 | 0.50 |
| Crit Rate | 0.10 | 0.60 |
| Crit DMG | 1.8 | 0.60 |

Ascension level caps: same table as Solace (`[20, 40, 50, 60, 70, 80, 90]`, 7 phases). Ascension cost and level-up cost formulas: identical shape to `solaceAscensionCost`/`solaceLevelUpCost` (`credits: 2000 * targetPhase`, `forgingOres: 10 * targetPhase`, `paradoxCores: 2 * targetPhase`; level-up `resonanceRecords: Math.ceil(currentLevel / 2) + 1, credits: currentLevel * 50`) — no reason for a standard 4★'s progression economy to differ from a limited 5★'s.

**Ascension material — new currency `umbralShards`.** Solace's ascension consumes Starfall Shards (dropped by Luminal Specter, the base-tier Spectro field boss). Kaelith gets the direct Havoc parallel: a new **Umbral Shard** currency, dropped by **Null Ravager** — the base-tier Havoc field boss, chosen over Voidmaw Devourer specifically because Voidmaw is WL2-gated and a named-set guardian, which would wall newer players out of ascending him. Cost curve mirrors Solace's exactly: `umbralShards: targetPhase >= 2 ? 3 * (targetPhase - 1) : 0`.

This requires:
- A `umbralShards Int @default(0)` column on `User` (Prisma schema change → `npm run db:push && npx prisma generate` before build).
- A guaranteed drop on Null Ravager kills in `field-boss.ts`, mirroring the Starfall Shard grant (which is unconditional on Luminal Specter kills, per the 2026-07-21 fix).
- Registration in `inventoryCard.ts`'s `CURRENCIES` display list and `emojiManager.ts` (both places, per the CLAUDE.md gotcha), plus the `Mail` model's grantable-currency fields.
- A `/guide` currencies-section entry, and a note on Null Ravager's picker option that it drops Umbral Shards (mirroring the Luminal Specter hint added 2026-07-21).

## Basic Attack

`basicDamageMult(basicLevel)`: linear 1.0 (Lv1) → 2.0 (Lv10) — same curve shape as `solaceBasicDamageMult` (1.0→1.8), slightly higher ceiling since Basic is a bigger part of his damage identity than Solace's (hers is a secondary action; his is the stack-building backbone).

```typescript
export function kaelithBasicDamageMult(basicLevel: number): number {
  return 1.0 + (2.0 - 1.0) * (basicLevel - 1) / (MAX_KIT_LEVEL - 1);
}
```

## Skill — partial detonate

- **Cooldown: 3 turns.** Unlike Solace's Skill (no cooldown — it's a utility mode-cycle, not a damage move), Kaelith's Skill is a real damage move with a stack-detonate bonus, so it needs gating. Reuses the same `skillCooldown` state field and countdown logic every combat loop already runs for the player's own Resonance Skill — no new mechanism needed, just a per-character cooldown value on the kit (`skillCooldownTurns: 3`) instead of a hardcoded constant.
- Base stack cost: 2 (1 at Constellation ≥ 2).
- Damage: `baseSkillMult(skillLevel) + stacksConsumed * PER_STACK_SKILL_BONUS`, where `PER_STACK_SKILL_BONUS = 0.5` (flat ATK-multiplier bonus per stack spent) and `baseSkillMult` scales 1.4 (Lv1) → 2.2 (Lv10), same linear-interpolation shape as every other kit-level curve in this game.

```typescript
export function kaelithSkillBaseMult(skillLevel: number): number {
  return 1.4 + (2.2 - 1.4) * (skillLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export const KAELITH_PER_STACK_SKILL_BONUS = 0.5;
export function kaelithSkillStackCost(constellation: number): number {
  return constellation >= 2 ? 1 : 2;
}
```

## Ultimate — full detonate

- Consumes all current stacks (0 to cap).
- Damage below Constellation 6: `baseUltMult(ultimateLevel) + stacksConsumed * PER_STACK_ULT_BONUS`, where `PER_STACK_ULT_BONUS = 0.6` and `baseUltMult` scales 2.5 (Lv1) → 3.8 (Lv10).
- At Constellation 6: the flat `baseUltMult` term is dropped entirely — damage becomes `stacksConsumed * (PER_STACK_ULT_BONUS * 1.6)` — i.e. going all-in on stacks before detonating is rewarded far more heavily than a "safe" low-stack Ultimate. (This is the one place a Constellation changes a formula's *shape*, not just its inputs — matches the "C6 is defining" convention already established for Solace, whose C6 also changes how attunement bonuses apply rather than just scaling a number.)
- At Constellation 4+: also heals Kaelith for 15% of the Ultimate's dealt damage.

```typescript
export function kaelithUltimateBaseMult(ultimateLevel: number): number {
  return 2.5 + (3.8 - 2.5) * (ultimateLevel - 1) / (MAX_KIT_LEVEL - 1);
}
export const KAELITH_PER_STACK_ULT_BONUS = 0.6;
export function kaelithUltimateDamageMult(ultimateLevel: number, stacksConsumed: number, constellation: number): number {
  if (constellation >= 6) return stacksConsumed * (KAELITH_PER_STACK_ULT_BONUS * 1.6);
  return kaelithUltimateBaseMult(ultimateLevel) + stacksConsumed * KAELITH_PER_STACK_ULT_BONUS;
}
export function kaelithUltimateSelfHealPct(constellation: number): number {
  return constellation >= 4 ? 0.15 : 0;
}
```

## Intro / Outro

- **Intro:** grants **+2 stacks** immediately (capped) and a **+20% ATK** buff (`BUFF_ALLY_ATK`) for Kaelith's first action after swapping in.
- **Outro:** applies a **15% DEF-shred** debuff to the enemy for 2 turns as he swaps out (a parting shot that benefits whoever swaps in next, mirroring the "swap synergy" idea Solace's Outro already has, just offense-flavored instead of defense-flavored). **Non-stacking** — re-applying refreshes the 2-turn duration rather than compounding, so repeated fast swapping can't shred DEF toward zero.
- At Constellation 1: Outro's debuff also grants the incoming ally +10% Crit Rate for their first action after the swap, **and the DEF-shred itself increases from 15% to 20%**.

```typescript
export function kaelithIntroEffect(introLevel: number): IntroOutroEffect {
  // introLevel doesn't scale this effect today (both grants are flat) — kept
  // as a parameter for interface consistency and to leave room for a future
  // rebalance without an interface change.
  return {
    actions: [{ type: "BUFF_ALLY_ATK", value: 0.20 }],
    newMechanicState: { /* caller merges +2 stacks (capped) into existing state */ },
  };
}
export function kaelithOutroEffect(constellation: number): IntroOutroEffect {
  return {
    actions: constellation >= 1 ? [{ type: "BUFF_ALLY_CRIT_RATE", value: 0.10 }] : [],
    enemyDebuff: { type: "DEF_SHRED", value: constellation >= 1 ? 0.20 : 0.15, turns: 2 },
  };
}
```

`AllyAction`'s existing type union (`HEAL_ALLY` | `SHIELD_ALLY` | `BUFF_ALLY_ATK` | `CLEANSE_ALLY`) has no Crit Rate variant — this needs one more small addition: `BUFF_ALLY_CRIT_RATE` (value = fraction Crit Rate bonus), following the exact same pattern as the existing `BUFF_ALLY_ATK` in `allyActions.ts`'s `applyAllyAction()` switch and `AllyActionResult`. Backward-compatible (existing callers unaffected, new variant simply unused until Kaelith's Outro emits it).

## Forte

- Same gauge shape as Solace: `phaseThresholds: [100]`, gain-per-Basic `20` (5 Basics to max).
- **Empowered payoff:** the next Ultimate used while Forte is maxed detonates at full damage **without resetting stacks to 0** — he keeps whatever stacks he had. (Contrast with Solace's Empowered Convergence, which changes *what* the Ultimate does; Kaelith's changes a *side effect* of using it.)

## Constellations

| # | Effect |
|---|---|
| C1 | Outro's debuff also grants the incoming ally +10% Crit Rate for their first action after the swap; the DEF-shred itself increases from 15% to 20% |
| C2 | Skill's stack cost drops from 2 to 1; stack cap increases 5→6 |
| C3 | Basic Attacks have a 30% chance to grant +2 stacks instead of +1 |
| C4 | Ultimate's detonate also heals Kaelith for 15% of the damage dealt; stack cap increases 6→7 |
| C5 | The Forte-empowered "keeps stacks" effect applies to the next **2** Ultimates instead of 1 |
| C6 (Defining) | Stack cap increases 7→9; Ultimate's damage formula changes entirely — stack-scaling replaces the flat base multiplier (see Ultimate section) |

```typescript
export function kaelithStackCap(constellation: number): number {
  if (constellation >= 6) return 9;
  if (constellation >= 4) return 7;
  if (constellation >= 2) return 6;
  return 5;
}
```

## Required `characterKit.ts` template extensions

Kaelith's kit is the first to need things Solace's never did — the interface (and one shared helper module) needs five small, backward-compatible additions. Four are optional or additive; the two new *required* fields (`loreFragments`, `skillCooldownTurns`) are trivially satisfied for Solace with her existing data (`SOLACE_LORE_FRAGMENTS` and `0`), so her behavior is unchanged:

1. **`IntroOutroEffect` gains two optional fields:**
   ```typescript
   export interface IntroOutroEffect {
     actions: AllyAction[];
     dmgMult?: number; // already existed
     newMechanicState?: unknown;   // NEW — lets Intro/Outro update opaque state (Kaelith's Intro adds +2 stacks)
     enemyDebuff?: { type: string; value: number; turns: number }; // NEW — Outro-only, targets the enemy rather than an ally
   }
   ```
   Solace's `introEffect`/`outroEffect` simply never set these two fields (stay `undefined`) — zero behavior change for her.

2. **`PlayableCharacterKit` gains a required `statusLineText(mechanicState: unknown): string` method.** Today, every combat loop constructs Solace's status line text ("Concerto Energy: X/100", "(ATK mode)") from loop-local variables directly — there's no generic hook for it at all, because there was only ever one character to hardcode against. This method generalizes that: `solaceKit.statusLineText` renders her attunement mode + Concerto Energy from the same `SolaceMechanicState` shape her `onSkill`/`onUltimate` already use; `kaelithKit.statusLineText` renders `"Stacks: 3/5"` from his own state shape. This is a real, immediately-necessary addition (not deferred) since Kaelith's whole kit is illegible in the status line without it.

3. **`allyActions.ts`'s `AllyActionType` gains `BUFF_ALLY_CRIT_RATE`** (value = fraction Crit Rate bonus), added to `applyAllyAction()`'s switch and `AllyActionResult` the same way `BUFF_ALLY_ATK` already works. Needed for Outro's C1 Crit Rate grant. Backward-compatible — existing callers unaffected.

4. **`PlayableCharacterKit` gains `loreFragments: string[]`** (7 entries — index `i` unlocks at `ascensionPhase >= i`, same rule as Solace's). `/character`'s Lore page currently calls `unlockedLoreFragments()`, which is hardcoded to `SOLACE_LORE_FRAGMENTS`; it becomes a generic helper taking the kit's own fragment array. Kaelith needs 7 fragments written — Havoc-flavored, matching the "worn-out, relentless fighter" tone established by his portrait design, and following Solace's structure (fragment 1 always visible as an intro, 2–7 revealing his history progressively).

5. **`PlayableCharacterKit` gains `skillCooldownTurns: number`** — Solace's is `0` (no cooldown, current behavior preserved exactly), Kaelith's is `3`.

All five additions are scoped into Kaelith's implementation plan directly (not a separate template-revision pass), since they're proven against a real second character rather than speculated about with only Solace to validate against.

## Out-of-kit changes this character requires

These aren't part of the kit interface, but Kaelith can't ship without them:

- **`/team` becomes a menu instead of slash-command choices.** It currently hardcodes `{ name: "✨ Solace", value: "solace" }` as a command option, meaning every new character would need a command-schema redeploy (including the ~1h global propagation). Replacing that with a select menu listing the player's *owned* characters removes that requirement permanently — future characters need no `npm run deploy` at all. Also fixes the same ownership-visibility class of bug already fixed in `/character` (non-owners shouldn't see characters they don't have).
- **`/profile` gains a player-chosen display character.** `canvas.ts` currently has a `solaceLevel` field hardcoded to `Solace_icon.png`. With multiple characters this would clutter the card, so the player picks which owned character appears. Kaelith's icon asset (`Kaelith_icon.png`) is added later — the code handles a missing icon by simply not rendering that tile, same as the existing missing-art paths elsewhere.
- **Standard-banner 4★ pool integration.** Kaelith joins the existing 4★ tier alongside the 4 existing 4★ weapons, matching how Genshin and WuWa both use a *mixed* character-and-weapon 4★ pool with a 10-pull guarantee. No rate or pity changes — he's simply another entry in the pool. Constellation token cost stays **1 per rank** (deliberately not raised: unlike Genshin's purchasable primogems, keys here are earned-only, so pull volume is already the real constraint).

## Non-goals

- No signature weapon (standard 4★ convention, confirmed earlier).
- No multi-hit Basic combo (WuWa-style Basic 1→2→3→4→5) — explicitly deferred per earlier discussion, too complex for this character.
- No new field boss — Kaelith's ascension material drops from the existing Null Ravager rather than introducing a new Havoc boss (which would also require new art and its own 4-cost echo).
- No change to 4★ pull rates, pity, or constellation token costs.
- Vesper is out of scope entirely — she gets her own spec once Kaelith proves the template end-to-end.
