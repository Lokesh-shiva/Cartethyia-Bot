# Kaelith Kit + Ascend.ts Full-Unification Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Kaelith's full kit module (`src/lib/kits/kaelithKit.ts`) per the approved design spec, register it, and rewrite `src/commands/rpg/ascend.ts` so BOTH Solace and Kaelith dispatch through `CHARACTER_KITS[characterId]` generically instead of Solace having ~30 hardcoded inline call sites — proving the `PlayableCharacterKit` template holds up for a second, mechanically different character before the same rewiring is repeated on the other 6 combat loops.

**Architecture:** `ascend.ts` currently has one hardcoded "ally" concept: Solace, gated by `isDevGuild` (a legacy-named boolean meaning "has an active Solace ally"), with bare local variables (`attunement`, `concertoEnergy`, `solaceForte`, `forteEmpoweredTurnsLeft`, `attunementDoubleTurnsLeft`) threaded through button-building, basic/skill/ultimate branches, swap, forte-fill, status line, and turn-end decrements. This plan replaces that with: a generic `activeAllyCharacterId: string | null` (the ally the player has picked via `/team`, currently only ever `"solace"` but now also possibly `"kaelith"`), a generic `allyKit: PlayableCharacterKit | null` looked up once from `CHARACTER_KITS`, and a single opaque `allyMechanicState: unknown` local replacing all four Solace-specific locals above. Skill/Ultimate button handlers call `allyKit.onSkill(ctx, ...)` / `allyKit.onUltimate(ctx, ...)` instead of inlining Solace's Attunement/Convergence math; the returned `newMechanicState` is stored back into `allyMechanicState`. Status line calls `allyKit.statusLineText(allyMechanicState)` instead of hand-formatting Attunement mode + Concerto Energy. Forte gauge handling (shared shape between Solace and Kaelith per spec) stays as a small generic helper since both kits expose `forteConfig`/`forteGainPerBasic` already. Named-set/echo-skill/lifesteal/enrage/shatter logic — none of which is ally-specific — is untouched.

**Tech Stack:** TypeScript (CommonJS), discord.js v14, existing `characterKit.ts`/`allyActions.ts`/`introOutro.ts` interfaces (already extended in the prior Foundations plan), Prisma (`characterProgress` table, already generic per-character), `@napi-rs/canvas` (unaffected — no card changes in this plan).

---

## Important context for whoever executes this

- There is no test framework in this repo. Verification = `npx tsc --noEmit`, `npm run build`, and disposable one-off `scripts/*.ts` scripts (created, run with `npx tsx`, then deleted — never committed). This matches every prior task this session.
- Work happens directly on `main`. Commit after every task.
- `CHARACTER_KITS`, `PlayableCharacterKit`, `IntroOutroEffect`, `AllyAction`, `resolveIntroOutroEffect` all already exist (built in the prior "Foundations" plan, `docs/superpowers/plans/2026-07-24-kaelith-foundations.md`, already merged to `main`). Do not recreate them.
- Kaelith's full kit content (stack mechanic, skill/ultimate formulas, intro/outro, forte, constellations) is specified in `docs/superpowers/specs/2026-07-24-kaelith-kit-design.md` — read it before Task 1 if any number below looks unfamiliar; every formula used in Task 1 is copied from that spec.
- `src/lib/kits/solaceKit.ts` is the existing reference implementation of `PlayableCharacterKit` — Kaelith's file should have the exact same shape (same field names, same method signatures), just different content.

---

### Task 1: `kaelithKit.ts` — mechanic state, stats, and stack helpers

**Files:**
- Create: `src/lib/kits/kaelithKit.ts`
- Reference (read-only): `src/lib/kits/solaceKit.ts`, `src/lib/characterKit.ts`, `docs/superpowers/specs/2026-07-24-kaelith-kit-design.md`

- [ ] **Step 1: Read the current `solaceKit.ts` file in full** to confirm the exact shape (imports, `ResolvedStats` construction, `resolveStats` signature) before writing the parallel Kaelith file. Run:

```bash
sed -n '1,60p' src/lib/kits/solaceKit.ts
```

Confirm it imports `PlayableCharacterKit`, `CharacterCombatContext`, `SkillEffectResult`, `UltimateEffectResult` from `../characterKit`, and `ResolvedStats` from `../setBonus`.

- [ ] **Step 2: Create `src/lib/kits/kaelithKit.ts` with mechanic state type, stack cap table, and stat curve**

```typescript
import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ResolvedStats } from "../setBonus";
import { resolvePlayerBonuses } from "../setBonus";

export interface KaelithMechanicState {
  stacks: number;
  forteEmpoweredKeepStacksActivationsLeft: number; // C5: lasts 2 activations instead of 1
}

export function kaelithCreateInitialMechanicState(): KaelithMechanicState {
  return { stacks: 0, forteEmpoweredKeepStacksActivationsLeft: 0 };
}

// Base cap 5; C2 -> 6; C4 -> 7; C6 -> 9. Highest applicable threshold wins.
export function kaelithStackCap(constellation: number): number {
  if (constellation >= 6) return 9;
  if (constellation >= 4) return 7;
  if (constellation >= 2) return 6;
  return 5;
}

// Skill stack cost: 2 normally, 1 at C2+.
export function kaelithSkillStackCost(constellation: number): number {
  return constellation >= 2 ? 1 : 2;
}

// Basic Attack stack grant: +1 normally; C3 gives a 30% chance of +2 instead.
export function kaelithBasicStackGain(constellation: number): number {
  if (constellation >= 3 && Math.random() < 0.30) return 2;
  return 1;
}

const HP_CEIL = 950, HP_FLOOR_FRAC = 0.30;
const ATK_CEIL = 145, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 85, DEF_FLOOR_FRAC = 0.30;
const SPD_CEIL = 105, SPD_FLOOR_FRAC = 0.50;
const CRIT_RATE_CEIL = 0.10, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.8, CRIT_DMG_FLOOR_FRAC = 0.60;
const KAELITH_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (KAELITH_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

// NOTE: field names must match PlayableCharacterKit.statsAtLevel's declared
// return shape exactly — { hpMax, baseAtk, baseDef, baseSpeed, critRate, critDmg }
// (confirmed against src/lib/characterKit.ts and src/lib/solace.ts's
// solaceStatsAtLevel, which this mirrors) — NOT { hp, atk, def, spd, ... }.
export function kaelithStatsAtLevel(level: number) {
  return {
    hpMax:     Math.round(scaleStat(HP_CEIL, HP_FLOOR_FRAC, level)),
    baseAtk:   Math.round(scaleStat(ATK_CEIL, ATK_FLOOR_FRAC, level)),
    baseDef:   Math.round(scaleStat(DEF_CEIL, DEF_FLOOR_FRAC, level)),
    baseSpeed: Math.round(scaleStat(SPD_CEIL, SPD_FLOOR_FRAC, level)),
    critRate:  scaleStat(CRIT_RATE_CEIL, CRIT_RATE_FLOOR_FRAC, level),
    critDmg:   scaleStat(CRIT_DMG_CEIL, CRIT_DMG_FLOOR_FRAC, level),
  };
}
```

- [ ] **Step 3: Verify it compiles standalone**

Run:
```bash
npx tsc --noEmit
```
Expected: no new errors attributable to `kaelithKit.ts` (the file isn't imported/exported anywhere yet, so it should type-check in isolation — unused-export warnings are fine, this repo doesn't run with `noUnusedLocals` for exported top-level symbols).

- [ ] **Step 4: Commit**

```bash
git add src/lib/kits/kaelithKit.ts
git commit -m "feat(kaelith-kit): add mechanic-state, stack-cap, and stat-curve helpers"
```

---

### Task 2: `kaelithKit.ts` — skill/ultimate damage, intro/outro, forte, ascension costs

**Files:**
- Modify: `src/lib/kits/kaelithKit.ts`

- [ ] **Step 1: Add skill/ultimate damage-multiplier curves and the `onSkill`/`onUltimate` handlers**

Append to `src/lib/kits/kaelithKit.ts`:

```typescript
export const KAELITH_PER_STACK_SKILL_BONUS = 0.5;
export const KAELITH_PER_STACK_ULT_BONUS   = 0.6;

// kaelithSkillBaseMult: 1.4 at kit level 1 -> 2.2 at kit level 10, linear.
export function kaelithSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.4 + (2.2 - 1.4) * t;
}

// kaelithUltimateBaseMult: 2.5 at kit level 1 -> 3.8 at kit level 10, linear.
export function kaelithUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.5 + (3.8 - 2.5) * t;
}

export function kaelithOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): SkillEffectResult {
  const state = ctx.mechanicState as KaelithMechanicState;
  const cost = kaelithSkillStackCost(constellation);
  const stacksConsumed = Math.min(state.stacks, cost);
  const newStacks = state.stacks - stacksConsumed;

  const damageMult = kaelithSkillBaseMult(skillLevel) + stacksConsumed * KAELITH_PER_STACK_SKILL_BONUS;

  return {
    damageMult,
    vibFrac: 0.6,
    moveLabel: `Umbral Detonation — consumed ${stacksConsumed} stack${stacksConsumed === 1 ? "" : "s"}`,
    newMechanicState: { ...state, stacks: newStacks } as KaelithMechanicState,
  };
}

export function kaelithOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as KaelithMechanicState;
  const stacksConsumed = state.stacks;

  // Forte-empowered "keeps stacks" — normally 1 activation, C5 extends to 2.
  const keepStacks = state.forteEmpoweredKeepStacksActivationsLeft > 0;
  const nextKeepStacksLeft = keepStacks ? state.forteEmpoweredKeepStacksActivationsLeft - 1 : 0;

  let damageMult: number;
  if (constellation >= 6) {
    // C6: flat base term dropped entirely, replaced by stack-scaling only.
    damageMult = stacksConsumed * (KAELITH_PER_STACK_ULT_BONUS * 1.6);
  } else {
    damageMult = kaelithUltimateBaseMult(ultimateLevel) + stacksConsumed * KAELITH_PER_STACK_ULT_BONUS;
  }

  const healFrac = constellation >= 4 ? 0.15 : 0;

  return {
    healResult: { actions: healFrac > 0 ? [{ type: "HEAL_ALLY", value: healFrac }] : [] },
    moveLabel: keepStacks
      ? `Umbral Cataclysm — stacks preserved by Forte! (${stacksConsumed} consumed for damage only)`
      : `Umbral Cataclysm — consumed all ${stacksConsumed} stacks`,
    newMechanicState: {
      stacks: keepStacks ? state.stacks : 0,
      forteEmpoweredKeepStacksActivationsLeft: nextKeepStacksLeft,
    } as KaelithMechanicState,
    resetsConcertoEnergy: true,
  };
}
```

Note: `damageMult` here is consumed by `ascend.ts` the same way `solaceBasicDamageMult`/skill multipliers already are (multiplied into the existing damage formula) — Task 5/6 wire this in.

- [ ] **Step 2: Add intro/outro effects**

```typescript
export function kaelithIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return {
    actions: [{ type: "BUFF_ALLY_ATK", value: 0.20 }],
    // Consumed specially by ascend.ts: grants +2 stacks (cap-limited) on entry.
    newMechanicState: { grantStacksOnIntro: 2 },
  };
}

export function kaelithOutroEffect(constellation: number): IntroOutroEffect {
  const debuffPct = constellation >= 1 ? 0.20 : 0.15;
  const effect: IntroOutroEffect = {
    actions: constellation >= 1 ? [{ type: "BUFF_ALLY_CRIT_RATE", value: 0.10 }] : [],
    enemyDebuff: { type: "DEF_SHRED", value: debuffPct, turns: 2 },
  };
  return effect;
}
```

- [ ] **Step 3: Add forte config, basic damage mult, ascension/level-up cost, and status line**

```typescript
import { ForteConfig } from "../characterKit";

export const KAELITH_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const KAELITH_FORTE_GAIN_PER_BASIC = 20;

export function kaelithBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as Solace's basic curve
}

// PlayableCharacterKit.ascensionCost's declared return type (see AscensionCost
// in src/lib/solace.ts) is { credits, forgingOres, paradoxCores, starfallShards }
// — that shape is currently hardcoded to Solace's own currencies at the
// interface level (not yet generalized to "whichever currency this character
// uses", since only one character existed when it was written). Kaelith's
// real ascension currency is umbralShards, not starfallShards. Returning an
// object with BOTH `starfallShards: 0` (to satisfy the existing interface,
// which nothing currently reads for Kaelith since no ascension-currency-
// spending command exists yet — that's Plan 3/out of scope here) AND the
// real `umbralShards` field (an extra property, allowed structurally since
// this is assigned via a function reference, not an object literal) is a
// deliberate stopgap. Generalizing the interface's cost shape to be
// currency-agnostic is explicitly OUT OF SCOPE for this plan (it would touch
// solaceKit.ts and characterKit.ts's public interface again, well beyond
// ascend.ts's combat-loop dispatch) — flag it to the user as a known gap
// once this plan ships, don't silently fix it here.
export function kaelithAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5000 * targetPhase,
    forgingOres: 6 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0,
    umbralShards: 3 * targetPhase,
  };
}

export function kaelithLevelUpCost(currentLevel: number) {
  return {
    credits: 200 * currentLevel,
    umbralShards: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function kaelithStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as KaelithMechanicState;
  return `Stacks: **${state.stacks}**${state.forteEmpoweredKeepStacksActivationsLeft > 0 ? "  ·  ✨ Forte-empowered (keeps stacks)" : ""}`;
}
```

- [ ] **Step 4: Verify compiles**

```bash
npx tsc --noEmit
```
Expected: no errors from `kaelithKit.ts` (still not imported anywhere — Task 3 wires it in).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/kaelithKit.ts
git commit -m "feat(kaelith-kit): add skill/ultimate/intro/outro/forte/cost formulas"
```

---

### Task 3: Assemble the `PlayableCharacterKit` object and register it

**Files:**
- Modify: `src/lib/kits/kaelithKit.ts`
- Modify: `src/lib/kits/index.ts`
- Modify: `src/lib/characterElements.ts`

- [ ] **Step 1: Read `src/lib/kits/index.ts`** to confirm the exact registration pattern used for Solace:

```bash
sed -n '1,30p' src/lib/kits/index.ts
```

- [ ] **Step 2: Append the exported `kaelithKit` object to `src/lib/kits/kaelithKit.ts`**

```typescript
import { CHARACTER_KITS } from "../characterKit";

export const KAELITH_LORE_FRAGMENTS = [
  "Kaelith speaks rarely, and only after the silence has already answered.",
  "What he calls discipline, others call the absence of mercy.",
  "The stacks are not power he channels — they are debts the world owes him, collected one strike at a time.",
];

export const kaelithKit: PlayableCharacterKit = {
  id: "kaelith",
  label: "Kaelith",
  emoji: "🌑",
  element: "HAVOC",
  portraitPath: "assets/Characters/Kaelith.png",
  loreFragments: KAELITH_LORE_FRAGMENTS,
  skillCooldownTurns: 3,
  statsAtLevel: kaelithStatsAtLevel,
  // Must return ResolvedStats (hp, atk, def, critRate, critDmg, energyPerTurn,
  // lifesteal, elemDmgBonus, spd) & { hasSignatureWeapon, signatureWeaponRefinement }
  // — confirmed against src/lib/setBonus.ts's ResolvedStats interface. Mirrors
  // solaceKit.ts's resolveStats: run this character's own base stats through
  // resolvePlayerBonuses/applyBonuses (the character's OWN echoes/weapon gear,
  // per the "her own resolved stats" pattern already established for Solace),
  // not a bespoke stat object. Kaelith has no signature weapon (per spec), so
  // hasSignatureWeapon is always false and signatureWeaponRefinement is 0.
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses } = await import("../setBonus");
    const { applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "kaelith" } },
    });
    const level = progress?.level ?? 1;
    const lvl = kaelithStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "kaelith");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: kaelithAscensionCost,
  levelUpCost: kaelithLevelUpCost,
  basicDamageMult: kaelithBasicDamageMult,
  introEffect: kaelithIntroEffect,
  outroEffect: kaelithOutroEffect,
  forteConfig: KAELITH_FORTE_CONFIG,
  forteGainPerBasic: KAELITH_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: kaelithCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => kaelithOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => kaelithOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: kaelithStatusLineText,
  constellationEffects: [
    "Outro also grants +10% Crit Rate to incoming ally; DEF-shred 15% -> 20%",
    "Skill stack cost 2 -> 1; stack cap 5 -> 6",
    "Basic Attacks: 30% chance to grant +2 stacks instead of +1",
    "Ultimate also heals Kaelith 15% of damage dealt; stack cap 6 -> 7",
    "Forte-empowered 'keeps stacks' effect lasts 2 activations instead of 1",
    "Stack cap 7 -> 9; Ultimate's damage formula changes entirely (stack-scaling replaces flat base)",
  ],
  maxConstellation: 6,
};

CHARACTER_KITS[kaelithKit.id] = kaelithKit;
```

**IMPORTANT — before finalizing this step**, open `src/lib/characterKit.ts` and confirm the actual signature of `onSkill`/`onUltimate` (the summary of this interface used `(ctx, kitLevels, constellation)` shorthand — read the real parameter names/types and adjust the arrow-function wrappers above to match exactly). Also confirm the real shape of `resolveStats`'s return type against `solaceKit.ts`'s actual implementation (the sketch above is illustrative of the fields, not copy-paste-verified against the live interface) — copy `solaceKit.ts`'s `resolveStats` structure field-for-field, substituting Kaelith's own base stats/passive/no-signature-weapon in place of Solace's.

- [ ] **Step 3: Register the side-effect import in `src/lib/kits/index.ts`**

Add alongside the existing `solaceKit` import:
```typescript
import "./kaelithKit";
```

- [ ] **Step 4: Add Kaelith to `src/lib/characterElements.ts`**

```typescript
export const CHARACTER_ELEMENTS: Record<string, string> = {
  solace: "SPECTRO",
  kaelith: "HAVOC",
};
```

- [ ] **Step 5: Verify with a standalone script**

Create `scripts/verify-kaelith-kit.ts`:
```typescript
import "dotenv/config";
import "../src/lib/kits"; // triggers registration side-effects
import { CHARACTER_KITS } from "../src/lib/characterKit";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("PASS:", msg);
}

const kit = CHARACTER_KITS["kaelith"];
assert(kit !== undefined, "kaelith kit is registered");
assert(kit.skillCooldownTurns === 3, "skill cooldown is 3 turns");
assert(kit.maxConstellation === 6, "max constellation is 6");

const state = kit.createInitialMechanicState() as { stacks: number };
assert(state.stacks === 0, "initial stacks are 0");

const skillResult = kit.onSkill(
  { playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: { stacks: 5, forteEmpoweredKeepStacksActivationsLeft: 0 } },
  { skillLevel: 1, ultimateLevel: 1 } as any,
  0,
);
assert((skillResult.newMechanicState as any).stacks === 3, "skill at C0 consumes 2 stacks (5 -> 3)");

process.exit(process.exitCode ?? 0);
```

Run:
```bash
npx tsx scripts/verify-kaelith-kit.ts
```
Expected: all lines print `PASS:` and exit code 0. If `onSkill`'s real signature differs from the sketch, fix both `kaelithKit.ts`'s wrapper arrow function and this script to match the real interface, then re-run.

- [ ] **Step 6: Delete the verification script (never committed)**

```bash
rm scripts/verify-kaelith-kit.ts
```

- [ ] **Step 7: Run full typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/kits/kaelithKit.ts src/lib/kits/index.ts src/lib/characterElements.ts
git commit -m "feat(kaelith-kit): assemble PlayableCharacterKit object and register in CHARACTER_KITS"
```

---

### Task 4: `ascend.ts` — generalize state initialization (lines ~317-364)

**Files:**
- Modify: `src/commands/rpg/ascend.ts:317-364`

This task replaces the Solace-only ownership lookup and bare-locals block with a generic ally lookup that works for any `CHARACTER_KITS` entry, while preserving every existing Solace behavior exactly.

- [ ] **Step 1: Replace lines 317-352 (the `solaceProgress`/`hasSolace`/`isDevGuild`/`allySolaceStats`/bare-locals block)**

Before (current, lines 317-352):
```typescript
    const solaceProgress = user.teamAllyCharacterId === "solace"
      ? await prisma.characterProgress.findUnique({ where: { userId_characterId: { userId: interaction.user.id, characterId: "solace" } } })
      : null;
    const hasSolace = solaceProgress !== null;
    const isDevGuild = hasSolace;
    const allySolaceStats = hasSolace ? await resolveSolaceStats(interaction.user.id) : null;
    const solaceBasicLevel    = solaceProgress?.basicLevel    ?? 1;
    const solaceSkillLevel    = solaceProgress?.skillLevel    ?? 1;
    const solaceUltimateLevel = solaceProgress?.ultimateLevel ?? 1;
    const solaceIntroLevel    = solaceProgress?.introLevel    ?? 1;
    const solaceForteLevel    = solaceProgress?.forteLevel    ?? 1;
    const solaceConstellation = solaceProgress?.constellation ?? 0;
    let activeUnit: "player" | "ally" = "player";
    let allyHp    = SOLACE.hpMax;
    const allyHpMax = SOLACE.hpMax;
    let concertoEnergy: number = 0;
    let playerDebuffs: DebuffState = [];
    let attunement: AttunementState = { mode: null };
    let attunementDoubleTurnsLeft = 0;
    let solaceForte: ForteState = { phase: 0, charge: 0 };
    let forteEmpoweredTurnsLeft = 0;
```

After:
```typescript
    import { CHARACTER_KITS } from "../../lib/characterKit"; // add to the top-of-file import block instead — see Step 2

    const activeAllyCharacterId: string | null =
      user.teamAllyCharacterId && CHARACTER_KITS[user.teamAllyCharacterId] ? user.teamAllyCharacterId : null;
    const allyProgress = activeAllyCharacterId
      ? await prisma.characterProgress.findUnique({ where: { userId_characterId: { userId: interaction.user.id, characterId: activeAllyCharacterId } } })
      : null;
    const hasSolace = allyProgress !== null; // legacy name kept — see note below
    const isDevGuild = hasSolace;            // legacy name kept — see note below
    const allyKit = activeAllyCharacterId ? CHARACTER_KITS[activeAllyCharacterId] : null;
    const allyResolvedStats = hasSolace && allyKit ? await allyKit.resolveStats(interaction.user.id) : null;
    const allySolaceStats = allyResolvedStats; // legacy alias for the ~14 Wellspring-branch call sites — see Task 5/6/7
    const allyBasicLevel    = allyProgress?.basicLevel    ?? 1;
    const allySkillLevel    = allyProgress?.skillLevel    ?? 1;
    const allyUltimateLevel = allyProgress?.ultimateLevel ?? 1;
    const allyIntroLevel    = allyProgress?.introLevel    ?? 1;
    const allyForteLevel    = allyProgress?.forteLevel    ?? 1;
    const allyConstellation = allyProgress?.constellation ?? 0;
    let activeUnit: "player" | "ally" = "player";
    let allyHp    = allyKit ? allyKit.statsAtLevel(90).hp : 0;
    const allyHpMax = allyHp;
    let concertoEnergy: number = 0;
    let playerDebuffs: DebuffState = [];
    let attunement: AttunementState = { mode: null };
    let attunementDoubleTurnsLeft = 0;
    let solaceForte: ForteState = { phase: 0, charge: 0 };
    let forteEmpoweredTurnsLeft = 0;
    let allyMechanicState: unknown = allyKit ? allyKit.createInitialMechanicState() : null;
```

**Do not rename `hasSolace`/`isDevGuild`** in this task — they are read at ~30 call sites across the file and a blanket rename belongs in its own mechanical pass, not mixed with behavior changes. Keep the variable names, just make what they mean generic (per the comments added above). `attunement`/`solaceForte`/`attunementDoubleTurnsLeft`/`forteEmpoweredTurnsLeft` are **kept as Solace-specific locals only used inside Solace's own `onSkill`/`onUltimate` branches** (Task 6) — they are NOT part of the generic dispatch; Kaelith's stack state lives entirely in `allyMechanicState`. This is intentional: Solace's existing inline math is being routed through `allyKit.onSkill`/`onUltimate` too (full unification), but her mode-cycle/forte locals still need somewhere to live between calls, so they stay as locals that Solace's kit-dispatch closures close over.

- [ ] **Step 2: Add the `CHARACTER_KITS` import to the real top-of-file import block**

Do NOT leave the `import` statement inline where Step 1 showed it (that was illustrative placement only). Open `src/commands/rpg/ascend.ts` lines 1-40, find the existing `import { ... } from "../../lib/setBonus";`-style block, and add:
```typescript
import { CHARACTER_KITS } from "../../lib/characterKit";
```
adjusting the relative path to match this file's actual depth (confirm via the existing sibling imports in that block — `ascend.ts` is at `src/commands/rpg/`, so `../../lib/characterKit` is correct if `setBonus` is imported the same way; verify by reading the current import line for `setBonus` before finalizing).

- [ ] **Step 3: Update `teamStatusLine()` (lines 354-364) to use the kit's own status line**

Before:
```typescript
    function teamStatusLine(): string {
      if (!hasSolace) return "";
      const benchedName = activeUnit === "player" ? SOLACE.name : displayName;
      const benchedHp   = activeUnit === "player" ? allyHp : state.playerHp;
      const benchedMax  = activeUnit === "player" ? allyHpMax : state.playerHpMax;
      const debuffLine  = playerDebuffs.length > 0
        ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
        : "";
      return `\n\n🔄 Benched: **${benchedName}** — ${benchedHp}/${benchedMax} HP  ·  ` +
             `Concerto Energy: **${concertoEnergy}/100**${debuffLine}`;
    }
```

After:
```typescript
    function teamStatusLine(): string {
      if (!hasSolace || !allyKit) return "";
      const benchedName = activeUnit === "player" ? allyKit.label : displayName;
      const benchedHp   = activeUnit === "player" ? allyHp : state.playerHp;
      const benchedMax  = activeUnit === "player" ? allyHpMax : state.playerHpMax;
      const debuffLine  = playerDebuffs.length > 0
        ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
        : "";
      return `\n\n🔄 Benched: **${benchedName}** — ${benchedHp}/${benchedMax} HP  ·  ` +
             `Concerto Energy: **${concertoEnergy}/100**  ·  ${allyKit.statusLineText(allyMechanicState)}${debuffLine}`;
    }
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```
Expected: errors ONLY at the ~30 remaining call sites still referencing `SOLACE.name`/`SOLACE.hpMax`/`solaceBasicLevel`/etc. that Tasks 5-8 haven't touched yet — this is expected mid-refactor breakage, not a regression. Confirm every error is one of: undefined `solaceBasicLevel`/`solaceSkillLevel`/`solaceUltimateLevel`/`solaceIntroLevel`/`solaceForteLevel`/`solaceConstellation` (renamed to `ally*` in Step 1), or `SOLACE` used where `allyKit`/`allyResolvedStats` should be. If any OTHER kind of error appears, stop and re-check Step 1/2/3 before proceeding — do not paper over an unrelated error by continuing.

- [ ] **Step 5: Commit** (even mid-broken — this is a checkpoint commit, the plan fixes the rest in the next tasks)

```bash
git add src/commands/rpg/ascend.ts
git commit -m "refactor(ascend): generalize ally state init to any CHARACTER_KITS entry (WIP, callers fixed next)"
```

---

### Task 5: `ascend.ts` — button building and swap (lines ~85-157, ~444-483)

**Files:**
- Modify: `src/commands/rpg/ascend.ts`

- [ ] **Step 1: Re-read the CURRENT (post-Task-4) `buildButtons()` and swap block** to get exact line numbers, since Task 4 shifted them by a few lines (the `kaelithKit.ts` helpers this task and Task 6/7 need were already imported in one combined line back in Task 5 Step 3):

```bash
grep -n "solaceBasicLevel\|solaceSkillLevel\|solaceUltimateLevel\|solaceIntroLevel\|solaceForteLevel\|solaceConstellation\|SOLACE\." src/commands/rpg/ascend.ts
```

- [ ] **Step 2: In `buildButtons()`, replace every `SOLACE.name`/`SOLACE.hpMax` reference with `allyKit?.label`/`allyHpMax`**, and every `solaceConvergenceHealPct`/Attunement-label-building call with a call through `allyKit` where the button label needs the ally's own Skill/Ultimate names. Since button labels are currently hardcoded strings like `"✦ Attunement"` / `"⚡ Convergence"`, add a generic per-kit label pair to `PlayableCharacterKit` is OUT OF SCOPE for this plan (would require touching the shared interface again) — instead, keep the button `customId`s (`battle_skill`, `battle_ultimate`) unchanged and keep their **label text** Solace-specific for now via a small local ternary:

```typescript
const skillLabel = activeAllyCharacterId === "kaelith" ? "🌑 Umbral Detonation" : "✦ Attunement";
const ultimateLabel = activeAllyCharacterId === "kaelith" ? "🌑 Umbral Cataclysm" : "⚡ Convergence";
```

Use `skillLabel`/`ultimateLabel` in place of the hardcoded strings inside `buildButtons()`. This is a deliberate, documented compromise: fully generic button labels are deferred to Plan 3 (Surfaces) since it needs an interface change (`skillLabel`/`ultimateLabel` fields on `PlayableCharacterKit`), and the user has not asked for that yet — do not silently expand scope by editing `characterKit.ts` in this task.

- [ ] **Step 3: Replace the swap block (previously lines 444-483)**

Before:
```typescript
        if (btn.customId === "battle_swap" && hasSolace && !(activeUnit === "player" && allyHp <= 0)) {
          const outgoingIsPlayer = activeUnit === "player";
          const comboReady = concertoEnergy >= 100;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = outgoingIsPlayer
              ? { hp: allyHp, hpMax: allyHpMax }
              : { hp: state.playerHp, hpMax: state.playerHpMax };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : solaceOutroEffect(solaceConstellation);
            const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(solaceIntroLevel, solaceConstellation) : PLAYER_SELF_INTRO;
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            if (!outgoingIsPlayer) nextAttackCritArmed = true;

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;

            let actualGain: number;
            if (outgoingIsPlayer) {
              const before = allyHp;
              allyHp = Math.min(allyHpMax, allyHp + totalBonus);
              actualGain = allyHp - before;
            } else {
              const before = state.playerHp;
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + totalBonus);
              actualGain = state.playerHp - before;
            }

            moveName = actualGain > 0
              ? `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Outro+Intro combo! +${actualGain} HP.`
              : `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Outro+Intro combo! (already at full HP, no heal needed)`;
            concertoEnergy = addConcertoEnergy(0, 20);
          } else {
            moveName = `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Concerto Energy not full, no combo triggered.`;
          }

          activeUnit = outgoingIsPlayer ? "ally" : "player";
          playerDmg = 0;
        }
```

After:
```typescript
        if (btn.customId === "battle_swap" && hasSolace && allyKit && !(activeUnit === "player" && allyHp <= 0)) {
          const outgoingIsPlayer = activeUnit === "player";
          const comboReady = concertoEnergy >= 100;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = outgoingIsPlayer
              ? { hp: allyHp, hpMax: allyHpMax }
              : { hp: state.playerHp, hpMax: state.playerHpMax };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : allyKit.outroEffect(allyConstellation);
            const introEffect: IntroOutroEffect = outgoingIsPlayer ? allyKit.introEffect(allyIntroLevel, allyConstellation) : PLAYER_SELF_INTRO;
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            // Kaelith's intro grants stacks rather than a plain HP/shield bonus —
            // AllyAction has no "grant stacks" primitive (deliberately, per spec:
            // stack-granting is Kaelith-specific and shouldn't pollute the shared
            // ally-action vocabulary), so it's applied here via introEffect's
            // newMechanicState side-channel instead of resolveIntroOutroEffect.
            if (!outgoingIsPlayer && introEffect.newMechanicState) {
              const grant = (introEffect.newMechanicState as any).grantStacksOnIntro as number | undefined;
              if (grant && activeAllyCharacterId === "kaelith") {
                const cur = (allyMechanicState as { stacks: number }).stacks;
                const cap = kaelithStackCap(allyConstellation);
                allyMechanicState = { ...(allyMechanicState as object), stacks: Math.min(cap, cur + grant) };
              }
            }
            if (outroEffect.enemyDebuff) {
              // Non-stacking: refresh duration, never compound (per spec, explicit anti-exploit decision).
              enemyDefShredTurnsLeft = outroEffect.enemyDebuff.turns + 1;
              enemyDefShredPct = outroEffect.enemyDebuff.value;
            }

            if (!outgoingIsPlayer) nextAttackCritArmed = true;

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;

            let actualGain: number;
            if (outgoingIsPlayer) {
              const before = allyHp;
              allyHp = Math.min(allyHpMax, allyHp + totalBonus);
              actualGain = allyHp - before;
            } else {
              const before = state.playerHp;
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + totalBonus);
              actualGain = state.playerHp - before;
            }

            moveName = actualGain > 0
              ? `🔄 Swapped to **${outgoingIsPlayer ? allyKit.label : displayName}** — Outro+Intro combo! +${actualGain} HP.`
              : `🔄 Swapped to **${outgoingIsPlayer ? allyKit.label : displayName}** — Outro+Intro combo! (already at full HP, no heal needed)`;
            concertoEnergy = addConcertoEnergy(0, 20);
          } else {
            moveName = `🔄 Swapped to **${outgoingIsPlayer ? allyKit.label : displayName}** — Concerto Energy not full, no combo triggered.`;
          }

          activeUnit = outgoingIsPlayer ? "ally" : "player";
          playerDmg = 0;
        }
```

This preserves Solace's exact existing behavior (her `outroEffect`/`introEffect` calls are now routed through `allyKit.outroEffect`/`allyKit.introEffect`, which for Solace's kit wrap the same `solaceOutroEffect`/`solaceIntroEffect` functions that were called directly before) while adding Kaelith's stack-grant-on-intro and non-stacking-DEF-shred-on-outro side effects generically.

**Add the full Kaelith-helpers import needed by this and later tasks now** (Tasks 6 and 7 also use these), as a single import statement alongside `ascend.ts`'s other lib imports: `import { kaelithStackCap, kaelithBasicStackGain, kaelithUltimateBaseMult, KAELITH_PER_STACK_ULT_BONUS, KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC } from "../../lib/kits/kaelithKit";`

- [ ] **Step 4: Typecheck, expect remaining errors only in Basic/Skill/Ultimate/echo-skill/turn-end/status blocks (Tasks 6-8)**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/ascend.ts
git commit -m "refactor(ascend): route button labels and swap intro/outro through allyKit generically"
```

---

### Task 6: `ascend.ts` — Basic Attack branch, Forte fill (lines ~485-549)

**Files:**
- Modify: `src/commands/rpg/ascend.ts`

- [ ] **Step 1: Replace every `solace*Level`/`SOLACE`-specific reference inside the `battle_basic` block with the generic `ally*Level` names from Task 4, and `basicMoveMult` computation with a kit dispatch**

Before (line ~496):
```typescript
          const basicMoveMult = isDevGuild && activeUnit === "ally" ? solaceBasicDamageMult(solaceBasicLevel) : 1.0;
```

After:
```typescript
          const basicMoveMult = isDevGuild && activeUnit === "ally" && allyKit ? allyKit.basicDamageMult(allyBasicLevel) : 1.0;
```

Every other reference in this block (`solaceSkillLevel` at lines 488-489 for the Attunement atk/crit bonus, `solaceForteLevel` at 493-494) is **Solace-specific mode-cycle/forte math that stays inline for Solace but must be skipped (return neutral 1/0) when the active kit is Kaelith**, since Kaelith has no Attunement or Forte-ATK-bonus mechanic per the spec (his Forte payoff is purely "next Ultimate keeps stacks", not a stat buff). Wrap each with an `activeAllyCharacterId === "solace"` guard:

```typescript
          const teamAtkMult  = isDevGuild && activeAllyCharacterId === "solace" ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
          const teamCritBonus = isDevGuild && activeAllyCharacterId === "solace" ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0;
          const wellspringAtkMult   = isDevGuild && activeAllyCharacterId === "solace" && activeUnit === "ally" && allySolaceStats?.hasWellspring ? getWellspringBaseAtkMult(allySolaceStats.wellspringRefinement) : 1;
          const wellspringAtkBonus  = isDevGuild && activeAllyCharacterId === "solace" && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement) : 0;
          const wellspringCritBonus = isDevGuild && activeAllyCharacterId === "solace" && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(attunement, allySolaceStats.wellspringRefinement) : 0;
          const forteAtkBonus  = isDevGuild && activeAllyCharacterId === "solace" ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const forteCritBonus = isDevGuild && activeAllyCharacterId === "solace" ? getSolaceForteCritRateBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
```

(Rename every `solaceBasicLevel`/`solaceSkillLevel`/`solaceUltimateLevel`/`solaceIntroLevel`/`solaceForteLevel`/`solaceConstellation` occurrence in this file to the `ally*` equivalents from Task 4 — do a project-wide find within `ascend.ts` only, not other combat loops.)

- [ ] **Step 2: Update the Basic-Attack stack grant for Kaelith and the Forte-fill block (lines ~536-548)**

After the existing damage/energy/lifesteal lines in the `battle_basic` block, add (Kaelith only, before the existing Forte-fill `if (isDevGuild && activeUnit === "ally")` block):

```typescript
          if (isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "kaelith") {
            const kState = allyMechanicState as import("../../lib/kits/kaelithKit").KaelithMechanicState;
            const gain = kaelithBasicStackGain(allyConstellation);
            const cap = kaelithStackCap(allyConstellation);
            allyMechanicState = { ...kState, stacks: Math.min(cap, kState.stacks + gain) };
            moveName += `\n🌑 +${gain} stack${gain === 1 ? "" : "s"} (${(allyMechanicState as any).stacks}/${cap})`;
          }
```

(`kaelithBasicStackGain`/`kaelithStackCap` are already imported at the top of `ascend.ts` from Task 5 Step 3 — no new import needed here.)

The existing Forte-fill block (lines ~538-548) stays generic already — it only reads `solaceForte`/`SOLACE_FORTE_CONFIG`/`SOLACE_FORTE_GAIN_PER_BASIC`, which are Solace-specific constants. Guard it the same way:

```typescript
          if (isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "solace") {
            const forteBefore = solaceForte;
            solaceForte = addForteCharge(solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
            // ...unchanged body...
          } else if (isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "kaelith") {
            solaceForte = addForteCharge(solaceForte, KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC);
            if (isForteMaxed(solaceForte, KAELITH_FORTE_CONFIG)) {
              moveName += `\n✨ Forte is **FULLY CHARGED** — next Umbral Cataclysm will keep your stacks!`;
            }
          }
```

Reusing the `solaceForte`/`ForteState` local for Kaelith's gauge too is intentional and safe: both kits use the identical `{ phase, charge }` shape (confirmed in the spec: "same gauge shape as Solace") and only one ally is ever active at a time, so there's no cross-contamination risk — this avoids adding a second parallel local just for Kaelith's numerically-identical gauge shape. `KAELITH_FORTE_CONFIG`/`KAELITH_FORTE_GAIN_PER_BASIC` are already imported via Task 7 Step 0's combined import line — no separate import needed here.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: remaining errors confined to Skill/Ultimate/echo-skill/turn-end blocks (Task 7).

- [ ] **Step 4: Commit**

```bash
git add src/commands/rpg/ascend.ts
git commit -m "refactor(ascend): dispatch Basic Attack stack/forte gain through active ally kit"
```

---

### Task 7: `ascend.ts` — Skill and Ultimate branches (lines ~551-678)

**Files:**
- Modify: `src/commands/rpg/ascend.ts`

- [ ] **Step 1: Replace the Skill branch's Solace-only condition and body**

Before (line 551):
```typescript
        if (btn.customId === "battle_skill" && isDevGuild && activeUnit === "ally") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          attunement.mode = cycleAttunementMode(attunement.mode);
          if (solaceConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
          const crit = Math.random() < activeCritRate; abilCrit = crit;
          const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          playerDmg  = dmg;
          moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
        } else if (btn.customId === "battle_skill") {
          // ...player's own Skill branch, UNCHANGED...
        }
```

After — split the ally-Skill branch by `activeAllyCharacterId` instead of assuming Solace, keeping Solace's exact existing math and adding Kaelith's via `allyKit.onSkill`:
```typescript
        if (btn.customId === "battle_skill" && isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "solace") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          attunement.mode = cycleAttunementMode(attunement.mode);
          if (allyConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
          const crit = Math.random() < activeCritRate; abilCrit = crit;
          const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          playerDmg  = dmg;
          moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
        } else if (btn.customId === "battle_skill" && isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "kaelith" && allyKit) {
          const kState = allyMechanicState as import("../../lib/kits/kaelithKit").KaelithMechanicState;
          if (kState.stacks <= 0) {
            moveName = `🌑 Umbral Detonation — no stacks to consume! (0 DMG bonus)`;
            playerDmg = 0;
          } else {
            const crit = Math.random() < activeCritRate; abilCrit = crit;
            const result = allyKit.onSkill(
              { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: kState },
              { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel } as any,
              allyConstellation,
            );
            allyMechanicState = result.newMechanicState;
            const base = Math.max(1, Math.floor(activeAtk * result.damageMult * (1 - defReduction)));
            const dmg  = Math.floor(base * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            playerDmg  = dmg;
            moveName   = `🌑 ${result.moveLabel} — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * result.vibFrac * totalVibMult));
          }
          state.skillCooldown = allyKit.skillCooldownTurns; // Kaelith's Skill has its own 3-turn cooldown, unlike Solace's Skill (Attunement) which has none
        } else if (btn.customId === "battle_skill") {
          // ...player's own Skill branch, UNCHANGED (do not touch)...
        }
```

**Note the `state.skillCooldown = allyKit.skillCooldownTurns` line**: Solace's Attunement branch has no cooldown assignment at all (matches her existing `skillCooldownTurns: 0`), so it's added only in Kaelith's branch. Confirm `TeamButtonContext`/`buildButtons()` already disables the Skill button based on `state.skillCooldown > 0` generically (it does, per the existing player-Skill branch's own `effectiveSkillCooldown` usage) — no button-rendering change needed here beyond what Task 5 already did for labels.

- [ ] **Step 2: Replace the Ultimate branch's ally-side condition and body (lines ~639-678)**

Before:
```typescript
        } else if (btn.customId === "battle_ultimate" && isDevGuild && activeUnit === "ally") {
          // Solace's Ultimate spends Concerto Energy, not personal Energy.
          const healPct = solaceConvergenceHealPct(solaceUltimateLevel, solaceConstellation);
          // ...rest unchanged, uses solaceConstellation, solaceForte, etc...
        }
```

After — guard Solace's exact existing body with `activeAllyCharacterId === "solace"`, and add a new Kaelith branch that dispatches through `allyKit.onUltimate`:
```typescript
        } else if (btn.customId === "battle_ultimate" && isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "solace") {
          // Solace's Ultimate spends Concerto Energy, not personal Energy.
          const healPct = solaceConvergenceHealPct(allyUltimateLevel, allyConstellation);
          const healResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
            { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(allyConstellation) },
          ] }, { hp: state.playerHp, hpMax: state.playerHpMax });
          const allyHealResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
          ] }, { hp: allyHp, hpMax: allyHpMax });

          const beforePlayer = state.playerHp;
          state.playerHp = Math.min(state.playerHpMax, state.playerHp + healResult.hpDelta);
          const actualHealPlayer = state.playerHp - beforePlayer;

          const beforeAlly = allyHp;
          allyHp = Math.min(allyHpMax, allyHp + allyHealResult.hpDelta);
          const actualHealAlly = allyHp - beforeAlly;

          playerDebuffs = cleanseDebuffs(playerDebuffs, healResult.cleanseCount);

          concertoEnergy = 0;
          convergenceUsedThisTurn = true;
          playerDmg = 0; abilCrit = false;

          const healSummary = `${displayName} +${actualHealPlayer} HP, ${allyKit?.label ?? "Solace"} +${actualHealAlly} HP`;

          if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
            forteEmpoweredTurnsLeft = solaceUltimateDoubleTurns(allyConstellation) + 1;
            attunementDoubleTurnsLeft = 0;
            solaceForte = resetForte();
            moveName = `⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**all 3 Attunement Modes empowered for ${solaceUltimateDoubleTurns(allyConstellation)} turns!**`;
          } else {
            attunementDoubleTurnsLeft = solaceUltimateDoubleTurns(allyConstellation) + 1;
            forteEmpoweredTurnsLeft = 0;
            moveName = `⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**${attunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(allyConstellation)} turns!**`;
          }
        } else if (btn.customId === "battle_ultimate" && isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "kaelith" && allyKit) {
          const kState = allyMechanicState as import("../../lib/kits/kaelithKit").KaelithMechanicState;
          const stacksConsumed = kState.stacks;

          // CONFIRMED: UltimateEffectResult (characterKit.ts) has no damage field —
          // only healResult/moveLabel/newMechanicState/resetsConcertoEnergy. Kaelith's
          // ultimate damage multiplier is therefore computed inline here, duplicating
          // the 2-line formula kaelithOnUltimate uses internally for its own
          // newMechanicState bookkeeping — exactly how Solace's own Ultimate damage is
          // computed inline in her branch above rather than returned from a shared helper.
          const ultDamageMult = allyConstellation >= 6
            ? stacksConsumed * (KAELITH_PER_STACK_ULT_BONUS * 1.6)
            : kaelithUltimateBaseMult(allyUltimateLevel) + stacksConsumed * KAELITH_PER_STACK_ULT_BONUS;

          const result = allyKit.onUltimate(
            { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: kState },
            { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
            allyConstellation,
          );
          allyMechanicState = result.newMechanicState;

          const base = Math.max(1, Math.floor(activeAtk * ultDamageMult * (1 - defReduction)));
          const dmg  = Math.floor(base * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
          playerDmg = dmg;
          moveName  = `🌑 ${result.moveLabel} — ${playerDmg} DMG`;
          state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));

          if (result.healResult.actions.length > 0) {
            const healResult = resolveIntroOutroEffect(result.healResult, { hp: allyHp, hpMax: allyHpMax });
            allyHp = Math.min(allyHpMax, allyHp + healResult.hpDelta);
          }
          if (result.resetsConcertoEnergy) { concertoEnergy = 0; convergenceUsedThisTurn = true; }
        }
```

`kaelithUltimateBaseMult` and `KAELITH_PER_STACK_ULT_BONUS` must be imported into `ascend.ts` from `kaelithKit.ts` — add `KAELITH_PER_STACK_ULT_BONUS` to `kaelithKit.ts`'s exports in Task 2 if not already exported (it's declared with `const`, not `export const`, in Task 2's Step 1 — change it to `export const KAELITH_PER_STACK_ULT_BONUS = 0.6;` before this task, since Task 2 as written only exports `KAELITH_PER_STACK_SKILL_BONUS`... actually re-check Task 2 Step 1: both `KAELITH_PER_STACK_SKILL_BONUS` and `KAELITH_PER_STACK_ULT_BONUS` are declared on the same `const` line without `export`. Add `export` to that line now, in Task 2, before executing this task.

- [ ] **Step 3: Typecheck and fix any remaining `solace*` → `ally*` rename misses flagged by the compiler**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/commands/rpg/ascend.ts
git commit -m "refactor(ascend): dispatch Skill/Ultimate through allyKit for both Solace and Kaelith"
```

---

### Task 8: `ascend.ts` — turn-end decrements, ally-KO auto-swap, remaining `solace*` renames

**Files:**
- Modify: `src/commands/rpg/ascend.ts`

- [ ] **Step 1: Update the ally-KO auto-swap message (previously lines 1005-1011)**

Before:
```typescript
        if (isDevGuild && activeUnit === "ally" && allyHp <= 0) {
          allyHp = 0;
          activeUnit = "player";
          state.lastMove += `\n◇ **${SOLACE.name} was knocked out** — swapped back to ${displayName}.`;
        }
```

After:
```typescript
        if (isDevGuild && activeUnit === "ally" && allyHp <= 0) {
          allyHp = 0;
          activeUnit = "player";
          state.lastMove += `\n◇ **${allyKit?.label ?? "Your ally"} was knocked out** — swapped back to ${displayName}.`;
        }
```

- [ ] **Step 2: Run a final grep to confirm no stray `SOLACE.` or `solace*Level`/`solaceConstellation` references remain outside Solace's own guarded branches**

```bash
grep -n "SOLACE\.\|solaceBasicLevel\|solaceSkillLevel\|solaceUltimateLevel\|solaceIntroLevel\|solaceForteLevel\|solaceConstellation" src/commands/rpg/ascend.ts
```
Expected: zero results, OR results only inside comments/strings that are intentionally Solace-flavored (e.g., a code comment explaining Solace-specific history) — any remaining live-code reference is a bug, fix it before proceeding.

- [ ] **Step 3: Full typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: `npm run build`**

```bash
npm run build
```
Expected: succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/ascend.ts
git commit -m "refactor(ascend): finish generic ally dispatch — no remaining Solace-only call sites"
```

---

### Task 9: Temporary test-state script (grant + restore) for live `/ascend` verification

**Files:**
- Create (temporary, delete after use): `scripts/temp-ascend-test-grant.ts`, `scripts/temp-ascend-test-restore.ts`

The user's main Discord account (`979379636586819746`) is already Level 90 / max World Level, so `/ascend` refuses to start any fight at all on it (`getBoss(user.worldLevel)` returns `null` once all World Levels are cleared). To avoid any risk to real progress, this verification uses the user's **alt account** (`1395128890409877706`) instead of the main one — even though the grant/restore scripts are designed to be safe and reversible, using an alt means a bug in the restore step has zero consequence for the account that actually matters. `USER_ID` below is set to the alt account, not the main one.

- [ ] **Step 1: Confirm the alt account has an onboarded `User` row before running anything.** `prisma.user.findUniqueOrThrow` will throw if the alt hasn't run `/start` in Discord at least once — if so, ask the user to run `/start` on the alt account first, since `messageCreate.ts`'s onboarding gate means an un-onboarded user has no row to snapshot/restore against.

- [ ] **Step 2: Create the grant script, which snapshots current state to a JSON file before changing anything**

```typescript
// scripts/temp-ascend-test-grant.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import fs from "fs";

const USER_ID = "1395128890409877706"; // alt account, not the main — see Task 9 note
const SNAPSHOT_PATH = "scripts/.ascend-test-snapshot.json";

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  const solaceProgress = await prisma.characterProgress.findUnique({
    where: { userId_characterId: { userId: USER_ID, characterId: "solace" } },
  });
  const kaelithProgress = await prisma.characterProgress.findUnique({
    where: { userId_characterId: { userId: USER_ID, characterId: "kaelith" } },
  });

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({
    worldLevel: user.worldLevel,
    teamAllyCharacterId: user.teamAllyCharacterId,
    hadSolace: solaceProgress !== null,
    hadKaelith: kaelithProgress !== null,
  }, null, 2));
  console.log("Snapshot written to", SNAPSHOT_PATH);

  await prisma.user.update({
    where: { id: USER_ID },
    data: { worldLevel: 0, teamAllyCharacterId: "solace" },
  });

  if (solaceProgress === null) {
    await prisma.characterProgress.create({
      data: { userId: USER_ID, characterId: "solace", level: 90, basicLevel: 10, skillLevel: 10, ultimateLevel: 10, introLevel: 10, forteLevel: 10, constellation: 6 },
    });
  }
  if (kaelithProgress === null) {
    await prisma.characterProgress.create({
      data: { userId: USER_ID, characterId: "kaelith", level: 90, basicLevel: 10, skillLevel: 10, ultimateLevel: 10, introLevel: 10, forteLevel: 10, constellation: 6 },
    });
  }

  console.log("Test state applied: worldLevel=0, teamAllyCharacterId=solace, both Solace and Kaelith owned at max level/constellation.");
  console.log("Use /team in Discord to switch your active ally between Solace and Kaelith, then run /ascend for each.");
  console.log("When done, run: npx tsx scripts/temp-ascend-test-restore.ts");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Create the restore script, reading the same snapshot file**

```typescript
// scripts/temp-ascend-test-restore.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import fs from "fs";

const USER_ID = "1395128890409877706"; // alt account, not the main — see Task 9 note
const SNAPSHOT_PATH = "scripts/.ascend-test-snapshot.json";

async function main() {
  const raw = fs.readFileSync(SNAPSHOT_PATH, "utf-8");
  const snapshot = JSON.parse(raw) as {
    worldLevel: number; teamAllyCharacterId: string | null; hadSolace: boolean; hadKaelith: boolean;
  };

  await prisma.user.update({
    where: { id: USER_ID },
    data: { worldLevel: snapshot.worldLevel, teamAllyCharacterId: snapshot.teamAllyCharacterId },
  });

  if (!snapshot.hadSolace) {
    await prisma.characterProgress.deleteMany({ where: { userId: USER_ID, characterId: "solace" } });
  }
  if (!snapshot.hadKaelith) {
    await prisma.characterProgress.deleteMany({ where: { userId: USER_ID, characterId: "kaelith" } });
  }

  fs.unlinkSync(SNAPSHOT_PATH);
  console.log(`Restored worldLevel=${snapshot.worldLevel}, teamAllyCharacterId=${snapshot.teamAllyCharacterId ?? "null"}.`);
  console.log(`Solace ${snapshot.hadSolace ? "kept (was already owned)" : "removed (was test-only)"}.`);
  console.log(`Kaelith ${snapshot.hadKaelith ? "kept (was already owned)" : "removed (was test-only)"}.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run the grant script locally (against the shared production DB — confirm with the user before running, since this temporarily changes the alt account's `worldLevel`/`teamAllyCharacterId` live in production, visible to the bot immediately)**

```bash
npx tsx scripts/temp-ascend-test-grant.ts
```

- [ ] **Step 5: Hand off to the user for the manual live click-through on the alt account** — this step cannot be automated (no Discord access from this session). Tell the user: on the alt account, run `/ascend`, verify the fight starts, verify Solace's buttons/Attunement/Convergence still work exactly as before, then use `/team` to switch to Kaelith and run `/ascend` again to verify his Basic-stack-gain, Skill (3-turn cooldown, partial detonate), Ultimate (full detonate), Intro (+2 stacks), and Outro (DEF-shred, non-stacking) all behave per spec.

- [ ] **Step 6: Once the user confirms the click-through is done, run the restore script**

```bash
npx tsx scripts/temp-ascend-test-restore.ts
```

- [ ] **Step 7: Delete both test scripts (never committed) but keep the plan's record of them in this file**

```bash
rm scripts/temp-ascend-test-grant.ts scripts/temp-ascend-test-restore.ts
```

---

### Task 10: Finish the development branch

- [ ] Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- [ ] **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — run final `npx tsc --noEmit` + `npm run build`, confirm git log is clean, then push + deploy per this session's established convention (`git push origin main`, SSH `git pull && npm run build && pm2 restart cartethyia`).

---

## Self-review notes (completed during plan writing, not a task for the executor)

- **Spec coverage**: stack mechanic ✓ (Task 1), skill/ultimate formulas + constellation gates C1-C6 ✓ (Task 2, Task 6/7 dispatch), intro/outro incl. non-stacking DEF-shred ✓ (Task 2, Task 5), Forte shared-gauge-shape reuse ✓ (Task 6), 3-turn Skill cooldown ✓ (Task 7), stats/ascension/level-up cost curves ✓ (Task 2), lore fragments ✓ (Task 3), own-element passive (already shipped in Foundations plan, Kaelith's entry added here in Task 3 Step 4).
- **Known open item flagged inline, not silently resolved**: Task 7 Step 2 flags that `UltimateEffectResult` has no damage-multiplier field, unlike `SkillEffectResult` — the plan tells the executor exactly what to check and what to do in either case, rather than asserting an unverified interface shape as fact.
- **Explicitly NOT in this plan** (confirmed out of scope per prior user decisions): the other 6 combat loops (`boss.ts`, `dungeon.ts`, `duel.ts`, `raid.ts`, `field-boss.ts`, `encounter.ts`), Plan 3 "Surfaces" work (`/team` menu, `/profile` character picker, standard-banner character pull path, `/guide` generalization, generic per-kit button labels), and Vesper's kit.
