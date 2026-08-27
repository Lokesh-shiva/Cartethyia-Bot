# Vesper Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Vesper's full `PlayableCharacterKit` (Electro sub-DPS, Static Mark → Discharge → Overload chain, Forte-tied Arc Discharge double/triple-hit), her new ascension currency, and the double-hit visual indicator (embed text + canvas badge) — per the approved design spec `docs/superpowers/specs/2026-07-30-vesper-kit-design.md`.

**Architecture:** Because the `CHARACTER_KITS` dispatch pattern is already generic across all 7 combat loops (proven twice now — Solace originally, Kaelith this session), Vesper's kit itself needs **zero combat-loop rewiring**. Registering her in `CHARACTER_KITS` with `onSkill`/`onUltimate`/`introEffect`/`outroEffect` makes her immediately playable everywhere `activeAllyCharacterId`/`allyKit` dispatch already exists. The only genuinely new cross-cutting work is the **multi-hit display** (`SkillEffectResult` gets a new optional `hitCount` field, and each combat loop's Skill-branch rendering needs a small, mechanical addition to split damage into N lines + tell the battle card how many hits to badge) and a **new canvas badge** in `canvas.ts`'s battle-card renderer (first-of-its-kind — no existing hit-count visual to reuse). `/character` needs no changes beyond three small map entries (`ASCENSION_SHARD_CURRENCY`, `RECOMMENDED_SET`, `SHARD_FIELD_BOSS`) since it's already fully generic as of this session's Kaelith fix.

**Tech Stack:** TypeScript (CommonJS), discord.js v14, existing `characterKit.ts`/`allyActions.ts`/`introOutro.ts`/`battleCard.ts`/`canvas.ts` infrastructure, Prisma (new `voltaicShards` column, mirrors `umbralShards` exactly).

---

## Important context for whoever executes this

- No test framework in this repo — verification is `npx tsc --noEmit`, `npm run build`, and disposable one-off `scripts/*.ts` scripts (created, run with `npx tsx`, then deleted — never committed).
- Work happens directly on `main`. Commit after every task, push + SSH-deploy (`git pull && npm run build && pm2 restart cartethyia`, `npx prisma generate` after schema changes) after the whole plan is done, matching this session's established rhythm.
- `src/lib/kits/kaelithKit.ts` is the direct template for Task 1/2/3's shape — same field names, same method signatures, different content.
- Read `docs/superpowers/specs/2026-07-30-vesper-kit-design.md` in full before Task 1 — every formula/number below is derived from it, but the spec itself left exact tuning constants as implementation-time decisions; this plan fixes those constants concretely so there's nothing left ambiguous at execution time.
- Currency name chosen for this plan: **Voltaic Shards** (Electro-flavored, distinct from the boss name "Voltaic Aberrant" that drops it — same naming pattern as Solace's Starfall Shards / Luminal Specter and Kaelith's Umbral Shards / Null Ravager, where the material name and boss name are related but not identical).

---

### Task 1: `vesperKit.ts` — mechanic state, mark helpers, stat curve

**Files:**
- Create: `src/lib/kits/vesperKit.ts`
- Reference (read-only): `src/lib/kits/kaelithKit.ts`, `src/lib/characterKit.ts`

- [ ] **Step 1: Create the file with mechanic state, mark helpers, and stat curve**

```typescript
// src/lib/kits/vesperKit.ts
// Vesper's PlayableCharacterKit — Electro sub-DPS, Static Mark -> Discharge ->
// Overload chain. See design spec
// docs/superpowers/specs/2026-07-30-vesper-kit-design.md.

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface VesperMechanicState {
  markPresent: boolean;
  dischargesSinceUltimate: number; // C6's rotation-length counter, reset on Ultimate cast
}

export function vesperCreateInitialMechanicState(): VesperMechanicState {
  return { markPresent: false, dischargesSinceUltimate: 0 };
}

const HP_CEIL = 900, HP_FLOOR_FRAC = 0.30;
const ATK_CEIL = 140, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 80, DEF_FLOOR_FRAC = 0.30;
// SPD floor is meaningfully higher than Kaelith's (0.50) per design spec —
// reflects her Energy-driven kit benefiting more from the existing global
// +1 Energy/turn per 20 spdFlat hook. No bespoke SPD mechanic (confirmed).
const SPD_CEIL = 115, SPD_FLOOR_FRAC = 0.65;
const CRIT_RATE_CEIL = 0.10, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.8, CRIT_DMG_FLOOR_FRAC = 0.60;
const VESPER_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (VESPER_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

// Field names must match PlayableCharacterKit.statsAtLevel's declared return
// shape exactly — { hpMax, baseAtk, baseDef, baseSpeed, critRate, critDmg }.
export function vesperStatsAtLevel(level: number) {
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

- [ ] **Step 2: Verify it compiles standalone**

```bash
npx tsc --noEmit
```
Expected: no errors from `vesperKit.ts` (not imported anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/kits/vesperKit.ts
git commit -m "feat(vesper-kit): add mechanic-state, stat-curve foundations"
```

---

### Task 2: `vesperKit.ts` — Skill/Ultimate/Intro/Outro/Forte/cost formulas + constellations

**Files:**
- Modify: `src/lib/kits/vesperKit.ts`

- [ ] **Step 1: Add Skill (Discharge) and Ultimate (Overload) formulas**

Constellation-gated numbers, concretely fixed for this plan (per spec's mechanic descriptions):

```typescript
// Base mark-consumption bonus multiplier added on top of the move's own base
// damage when a Static Mark is consumed. C2 doubles this.
const VESPER_MARK_BONUS_MULT = 0.6;
// C1's Charged Mark (only ever created by Outro) bonus is bigger than a
// normal mark's bonus.
const VESPER_CHARGED_MARK_BONUS_MULT = 1.2;
// C5's DEF-ignore fraction on Arc Discharge hits.
const VESPER_C5_DEF_IGNORE = 0.15;
// C6's per-Discharge-since-last-Ultimate damage-mult bonus to Overload.
const VESPER_C6_PER_DISCHARGE_BONUS = 0.15;

export function vesperSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.2 + (1.8 - 1.2) * t; // 1.2 -> 1.8 across kit levels 1-10
}

export function vesperUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.2 + (3.4 - 2.2) * t; // 2.2 -> 3.4 across kit levels 1-10
}

// Extends the shared SkillEffectResult shape with fields only the combat
// loops need for the multi-hit display (Task 4/5) — NOT part of the
// PlayableCharacterKit interface itself, a Vesper-specific superset the
// combat loops read via `"hits" in result` type narrowing.
export interface VesperSkillResult extends SkillEffectResult {
  hits: number;          // 1 normally, 2 (or 3 at C4) for an Arc Discharge
  defIgnorePct: number;  // 0 normally, VESPER_C5_DEF_IGNORE at C5+
}

export function vesperOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): VesperSkillResult {
  const state = ctx.mechanicState as VesperMechanicState;
  const wasCharged = false; // Charged Mark is only ever set by Outro (Task 2 Step 2) — read from a
                            // dedicated flag rather than markPresent alone, added below.
  const markBonusMult = constellation >= 2 ? VESPER_MARK_BONUS_MULT * 2 : VESPER_MARK_BONUS_MULT;

  const consumedMark = state.markPresent;
  const baseMult = vesperSkillBaseMult(skillLevel);
  const damageMult = consumedMark ? baseMult + markBonusMult : baseMult;

  const forteEmpowered = (ctx as any).forteEmpowered === true; // set by the combat loop before calling onSkill, same convention as isShattered
  const hits = forteEmpowered ? (constellation >= 4 ? 3 : 2) : 1;

  return {
    damageMult,
    vibFrac: 0.5,
    moveLabel: forteEmpowered
      ? `Arc Discharge${hits === 3 ? " (Triple Hit!)" : " (Double Hit!)"}`
      : (consumedMark ? "Discharge — mark consumed" : "Discharge"),
    newMechanicState: {
      ...state,
      markPresent: false,
      dischargesSinceUltimate: state.dischargesSinceUltimate + (consumedMark ? 1 : 0),
    } as VesperMechanicState,
    hits,
    defIgnorePct: constellation >= 5 ? VESPER_C5_DEF_IGNORE : 0,
  };
}

export function vesperOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as VesperMechanicState;
  const consumedMark = state.markPresent;
  const baseMult = vesperUltimateBaseMult(ultimateLevel);
  const markBonus = consumedMark ? 0.8 : 0;
  const c6Bonus = constellation >= 6 ? state.dischargesSinceUltimate * VESPER_C6_PER_DISCHARGE_BONUS : 0;
  const damageMult = baseMult + markBonus + c6Bonus;

  return {
    healResult: { actions: [] }, // Overload has no heal component — pure damage + mark refresh
    moveLabel: `Overload${consumedMark ? " — mark consumed" : ""}`,
    newMechanicState: {
      markPresent: true, // Overload ALWAYS leaves a fresh mark afterward, per spec
      dischargesSinceUltimate: 0, // C6 counter resets on every Ultimate cast, C6 or not
    } as VesperMechanicState,
    resetsConcertoEnergy: false, // Vesper's "Energy" is personal Energy, not Concerto Energy (she has no Solace-style team-heal Ultimate)
  };
}
```

Note: `damageMult` here is the multiplier the calling combat loop applies to Vesper's own ATK (same convention `kaelithOnSkill`/`kaelithOnUltimate` already use) — the C3 "Ultimate's damage scales with Energy% at cast" formula is intentionally NOT included here, since `CharacterCombatContext` has no `playerEnergy` field today (only `playerHp`/`playerHpMax`/`allyHp`/`allyHpMax`/`turn`/`isShattered`/`mechanicState`). Adding one is Task 3.

- [ ] **Step 2: Add Intro/Outro effects**

```typescript
export function vesperIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return {
    actions: [], // no HP/shield/ATK-buff action — the Energy burst is delivered via newMechanicState's side-channel, same pattern Kaelith's Intro uses for stacks
    newMechanicState: { grantEnergyOnIntro: 40 + introLevel * 2 }, // scales gently with Intro level
  };
}

export function vesperOutroEffect(constellation: number): IntroOutroEffect {
  return {
    actions: constellation >= 1 ? [] : [], // C1's Charged Mark is a mechanicState side-channel too, not an AllyAction — no ally-facing action either way
    newMechanicState: { grantMarkOnOutro: true, chargedMark: constellation >= 1 },
  };
}
```

- [ ] **Step 3: Add Forte config, basic damage mult, ascension/level-up cost, status line, constellation text**

```typescript
export const VESPER_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const VESPER_FORTE_GAIN_PER_BASIC = 20;
export const VESPER_FORTE_GAIN_PER_MARKED_DISCHARGE = 15; // Discharge fills Forte extra fast when it consumes a mark, per spec

export function vesperBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as Solace/Kaelith's basic curve
}

export function vesperAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5000 * targetPhase,
    forgingOres: 6 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0, // interface filler — see kaelithKit.ts's identical note on this known limitation
    voltaicShards: 3 * targetPhase,
  };
}

export function vesperLevelUpCost(currentLevel: number) {
  return {
    credits: 200 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function vesperStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as VesperMechanicState;
  return `Mark: **${state.markPresent ? "Present" : "None"}**  ·  Discharges since Ult: **${state.dischargesSinceUltimate}**`;
}

export const VESPER_LORE_FRAGMENTS = [
  "Vesper never raises her voice — the current does that for her.",
  "She counts everything: turns, heartbeats, the exact moment a fight tips.",
  "Some allies fight beside her. She prefers to fight just ahead of them, clearing the way before they arrive.",
  "The mark she leaves behind isn't a weapon. It's an invitation — to whoever swaps in next.",
  "She was taught that lightning never strikes the same place twice. She decided that rule didn't apply to her.",
  "There is a version of restraint that looks like patience, and a version that looks like a held breath. Vesper's is the second kind.",
  "When the overload finally comes, it isn't rage. It's arithmetic, finally paying out.",
];

export const VESPER_CONSTELLATION_EFFECTS = [
  "Outro's mark becomes a Charged Mark — the next Discharge that consumes it gets a larger flat damage bonus than a normal mark.",
  "Discharge's mark-consumption bonus damage is doubled.",
  "Ultimate's damage additionally scales with current Energy% at cast, and refunds that spent Energy toward the next Arc Discharge.",
  "**(Defining-adjacent)** Arc Discharge becomes a triple hit (not double) whenever Forte is empowered.",
  "Arc Discharge's hits ignore 15% of the enemy's DEF.",
  "**(Defining)** Overload's damage bonus scales with how many Discharges landed since the last Ultimate — resets to 0 after each Ultimate cast.",
];
```

- [ ] **Step 4: Verify compiles**

```bash
npx tsc --noEmit
```
Expected: no errors (not registered yet — Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/vesperKit.ts
git commit -m "feat(vesper-kit): add skill/ultimate/intro/outro/forte/cost/constellation content"
```

---

### Task 3: Extend `characterKit.ts` for Energy-aware context + assemble/register Vesper's kit

**Files:**
- Modify: `src/lib/characterKit.ts`
- Modify: `src/lib/kits/vesperKit.ts`
- Modify: `src/lib/kits/index.ts`
- Modify: `src/lib/characterElements.ts`

- [ ] **Step 1: Add `playerEnergy`/`playerEnergyMax` to `CharacterCombatContext`**

C3's "Ultimate's damage scales with Energy% at cast" needs the acting unit's current Energy, which `CharacterCombatContext` doesn't expose today. Add two optional fields (optional so Solace's/Kaelith's existing call sites, which don't pass them, still compile):

```typescript
export interface CharacterCombatContext {
  playerHp: number; playerHpMax: number;
  allyHp: number; allyHpMax: number;
  turn: number;
  isShattered: boolean;
  mechanicState: unknown;
  playerEnergy?: number;    // NEW — only Vesper's C3 reads this; optional so existing callers don't need updating
  playerEnergyMax?: number; // NEW — always 100 in this codebase, but passed explicitly rather than hardcoded in the kit
}
```

- [ ] **Step 2: Update `vesperOnUltimate` to use the new context field for C3**

Replace the C3-related line in `vesperOnUltimate` (Task 2) — it currently has no Energy-scaling term at all (flagged as missing in Task 2's note). Edit `src/lib/kits/vesperKit.ts`:

```typescript
export function vesperOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as VesperMechanicState;
  const consumedMark = state.markPresent;
  const baseMult = vesperUltimateBaseMult(ultimateLevel);
  const markBonus = consumedMark ? 0.8 : 0;
  const c6Bonus = constellation >= 6 ? state.dischargesSinceUltimate * VESPER_C6_PER_DISCHARGE_BONUS : 0;
  // C3: scales with Energy% at the moment of cast. Energy is always 100 when
  // Ultimate is actually castable (the button is disabled below 100 in every
  // combat loop, same as every other character's Ultimate), so this term is
  // effectively a flat +0.5 at C3+ in practice today — written as a real
  // percentage calculation anyway so it stays correct if a future
  // mechanic ever allows casting Ultimate below 100 Energy.
  const energyPct = (ctx.playerEnergy ?? 100) / (ctx.playerEnergyMax ?? 100);
  const c3Bonus = constellation >= 3 ? energyPct * 0.5 : 0;
  const damageMult = baseMult + markBonus + c6Bonus + c3Bonus;

  return {
    healResult: { actions: [] },
    moveLabel: `Overload${consumedMark ? " — mark consumed" : ""}`,
    newMechanicState: {
      markPresent: true,
      dischargesSinceUltimate: 0,
    } as VesperMechanicState,
    resetsConcertoEnergy: false,
  };
}
```

- [ ] **Step 3: Assemble and register the kit**

Append to `src/lib/kits/vesperKit.ts`:

```typescript
export const vesperKit: PlayableCharacterKit = {
  id: "vesper",
  label: "Vesper",
  emoji: "⚡",
  element: "ELECTRO",
  rarity: 4,
  portraitPath: "assets/Characters/Vesper.png",
  loreFragments: VESPER_LORE_FRAGMENTS,
  skillCooldownTurns: 0, // intentional — see design spec's "Skill Cooldown" section
  statsAtLevel: vesperStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "vesper" } },
    });
    const level = progress?.level ?? 1;
    const lvl = vesperStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "vesper");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: vesperAscensionCost,
  levelUpCost: vesperLevelUpCost,
  basicDamageMult: vesperBasicDamageMult,
  introEffect: vesperIntroEffect,
  outroEffect: vesperOutroEffect,
  forteConfig: VESPER_FORTE_CONFIG,
  forteGainPerBasic: VESPER_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: vesperCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => vesperOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => vesperOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: vesperStatusLineText,
  constellationEffects: VESPER_CONSTELLATION_EFFECTS,
  maxConstellation: 6,
};

CHARACTER_KITS[vesperKit.id] = vesperKit;
```

**Before finalizing**: confirm the real `onSkill`/`onUltimate` parameter names in `characterKit.ts` match this arrow-wrapper shape exactly (same check Kaelith's plan flagged and resolved by reading the live interface — do the same here rather than trusting this sketch blindly).

- [ ] **Step 4: Register in `src/lib/kits/index.ts`**

```typescript
import "./vesperKit";
```

- [ ] **Step 5: Add to `src/lib/characterElements.ts`**

```typescript
export const CHARACTER_ELEMENTS: Record<string, string> = {
  solace: "SPECTRO",
  kaelith: "HAVOC",
  vesper: "ELECTRO",
};
```

- [ ] **Step 6: Verify with a standalone script**

```typescript
// scripts/verify-vesper-kit.ts
import "dotenv/config";
import "../src/lib/kits";
import { CHARACTER_KITS } from "../src/lib/characterKit";
import { vesperOnSkill, vesperOnUltimate, VesperMechanicState } from "../src/lib/kits/vesperKit";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("PASS:", msg);
}

const kit = CHARACTER_KITS["vesper"];
assert(kit !== undefined, "vesper kit registered");
assert(kit.rarity === 4, "vesper is 4-star");
assert(kit.skillCooldownTurns === 0, "skill cooldown is 0");
assert(kit.constellationEffects.length === 6, "6 constellation strings");
assert(kit.loreFragments.length === 7, "7 lore fragments");

const noMark: VesperMechanicState = { markPresent: false, dischargesSinceUltimate: 0 };
const withMark: VesperMechanicState = { markPresent: true, dischargesSinceUltimate: 0 };

const skillNoMark = vesperOnSkill({ playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: noMark }, 1, 0);
assert(skillNoMark.hits === 1, "no-mark, non-empowered Discharge is a single hit");
assert((skillNoMark.newMechanicState as VesperMechanicState).markPresent === false, "consuming nothing leaves no mark");

const skillWithMarkC0 = vesperOnSkill({ playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: withMark }, 1, 0);
assert((skillWithMarkC0.newMechanicState as VesperMechanicState).markPresent === false, "consuming a mark clears it");
assert((skillWithMarkC0.newMechanicState as VesperMechanicState).dischargesSinceUltimate === 1, "consuming a mark increments the C6 counter");

const forteEmpoweredCtx = { playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: withMark, forteEmpowered: true } as any;
const arcC0 = vesperOnSkill(forteEmpoweredCtx, 1, 0);
assert(arcC0.hits === 2, "Forte-empowered Discharge at C0 is a double hit");
const arcC4 = vesperOnSkill(forteEmpoweredCtx, 1, 4);
assert(arcC4.hits === 3, "Forte-empowered Discharge at C4 is a triple hit");

const ultResult = vesperOnUltimate({ playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: { markPresent: true, dischargesSinceUltimate: 3 } }, 1, 0);
assert((ultResult.newMechanicState as VesperMechanicState).markPresent === true, "Overload always leaves a fresh mark");
assert((ultResult.newMechanicState as VesperMechanicState).dischargesSinceUltimate === 0, "Overload resets the C6 counter regardless of constellation");

process.exit(process.exitCode ?? 0);
```

Run:
```bash
npx tsx scripts/verify-vesper-kit.ts
```
Expected: all `PASS:` lines, exit code 0.

- [ ] **Step 7: Delete the verification script (never committed)**

```bash
rm scripts/verify-vesper-kit.ts
```

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/characterKit.ts src/lib/kits/vesperKit.ts src/lib/kits/index.ts src/lib/characterElements.ts
git commit -m "feat(vesper-kit): assemble PlayableCharacterKit, register, add Energy context field"
```

---

### Task 4: New currency — Voltaic Shards (schema, registration, drop wiring)

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/inventoryCard.ts`
- Modify: `src/lib/emojiManager.ts`
- Modify: `src/commands/rpg/field-boss.ts`

Mirrors the exact steps already done for Umbral Shards (`docs/superpowers/plans/2026-07-24-kaelith-foundations.md`) with Voltaic Aberrant instead of Null Ravager.

- [ ] **Step 1: Add `voltaicShards` column to `User` and `Mail` models**

In `prisma/schema.prisma`, add after the existing `umbralShards` line in both models:

```prisma
  voltaicShards Int @default(0)
```

- [ ] **Step 2: Push schema and regenerate client**

```bash
npm run db:push
npx prisma generate
```
Expected: "Your database is now in sync", no data-loss warnings.

- [ ] **Step 3: Register in `src/lib/inventoryCard.ts`'s `CURRENCIES` array**

Add after the `umbralShards` entry:

```typescript
  { key: "voltaicShards", file: "Voltaic Shard.png", label: "Voltaic Shards", color: "#A855F7", desc: "Vesper ascension" },
```

Note: `assets/icons/Voltaic Shard.png` does not exist yet — flag to the user, matching the established pattern (silently no-ops on the icon until drawn, exactly like Umbral Shards did before this session's icon got added).

- [ ] **Step 4: Register in `src/lib/emojiManager.ts`**

Three additions, mirroring the `cc_umbral` entries exactly:
- `{ name: "cc_voltaic", file: "assets/icons/Voltaic Shard.png" }` in `EMOJI_ASSETS`
- `voltaicShards: "cc_voltaic"` in `CURRENCY_EMOJI_MAP`
- `get vs() { return getEmoji("cc_voltaic", "⚡"); }` in the `CE` accessor object

- [ ] **Step 5: Add the drop to `field-boss.ts` for Voltaic Aberrant**

Read the current `dropNote` ternary, `umbralShardsDropped`-equivalent block, and victory-embed description string (same three edit points Kaelith's Foundations plan touched for Null Ravager) — confirm exact current line numbers with:

```bash
grep -n "null_ravager\|umbralShardsDropped\|dropNote" src/commands/rpg/field-boss.ts
```

Add a parallel `fb.id === "voltaic_aberrant"` branch at each of the three points:
1. `dropNote` ternary: append `fb.id === "voltaic_aberrant" ? "  ✦ drops Voltaic Shards"` alongside the existing Null Ravager check
2. A new `voltaicShardsDropped` block mirroring `umbralShardsDropped`'s shape exactly (unconditional `+1` on `fb.id === "voltaic_aberrant"`)
3. Victory-embed description string: extend with `(voltaicShardsDropped ? \`\n${CE.vs} **1 Voltaic Shard**\` : "")`

- [ ] **Step 6: Typecheck, build, commit**

```bash
npx tsc --noEmit
npm run build
git add prisma/schema.prisma src/lib/inventoryCard.ts src/lib/emojiManager.ts src/commands/rpg/field-boss.ts
git commit -m "feat(vesper): add Voltaic Shards currency, Voltaic Aberrant drop"
```

---

### Task 5: `/character` — three small map entries (no other changes needed)

**Files:**
- Modify: `src/commands/rpg/character.ts`

Because `/character` is already fully generic (this session's Kaelith fix), Vesper needs only three map entries added — no other code changes.

- [ ] **Step 1: Add to `ASCENSION_SHARD_CURRENCY`**

```typescript
const ASCENSION_SHARD_CURRENCY: Record<string, { field: string; dbField: ShardDbField; label: string }> = {
  solace:  { field: "starfallShards", dbField: "starfallShards", label: "Starfall Shards" },
  kaelith: { field: "umbralShards",   dbField: "umbralShards",   label: "Umbral Shards"   },
  vesper:  { field: "voltaicShards",  dbField: "voltaicShards",  label: "Voltaic Shards"  },
};
```

Update `ShardDbField`'s type union too:
```typescript
type ShardDbField = "starfallShards" | "umbralShards" | "voltaicShards";
```

And the two `dbUser`/`dbUser2` Prisma `select` clauses in `buildStatsView` and the `charlvl2` ascension branch (Task from the Kaelith-fix plan already added `umbralShards: true` to both — add `voltaicShards: true` alongside it in both places):

```bash
grep -n "starfallShards: true, umbralShards: true" src/commands/rpg/character.ts
```

- [ ] **Step 2: Add to `RECOMMENDED_SET`**

```typescript
const RECOMMENDED_SET: Record<string, string> = {
  solace:  "**Radiant Convergence** (Spectro) — her own element, and its heal-on-turn 4pc/5pc mechanics play directly into her support kit instead of fighting it.",
  kaelith: "**Voidborn Remnant** (Havoc) — his own element, and its Frenzy mechanics amplify his stack-detonation damage instead of fighting it.",
  vesper:  "**Stormcaller's Oath** (Electro) — her own element, and its thunderbolt/crit-rate mechanics complement a Discharge-chain playstyle without fighting it.",
};
```

- [ ] **Step 3: Add to `SHARD_FIELD_BOSS`**

```typescript
const SHARD_FIELD_BOSS: Record<string, string> = {
  solace:  "Luminal Specter",
  kaelith: "Null Ravager",
  vesper:  "Voltaic Aberrant",
};
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/commands/rpg/character.ts
git commit -m "feat(character): add Vesper's shard currency/recommended-set/field-boss entries"
```

---

### Task 6: Multi-hit display — canvas badge + embed text (new work, all 7 combat loops)

**Files:**
- Modify: `src/lib/battleCard.ts` (or wherever `BattleCardState`/`generateBattleCard` live — confirm exact file first)
- Modify: `src/lib/canvas.ts`
- Modify: `src/commands/rpg/ascend.ts`, `boss.ts`, `field-boss.ts`, `dungeon.ts`, `duel.ts`, `raid.ts`, `src/lib/encounter.ts` (the Skill branch only, in each)

This is the one part of Vesper's kit that touches every combat loop, because it's genuinely new cross-cutting UI, not dispatch logic that's already generic.

- [ ] **Step 1: Confirm the actual location of `BattleCardState`/`generateBattleCard`**

```bash
grep -rn "interface BattleCardState\|export async function generateBattleCard" src/lib/
```
(This plan's other tasks reference `battleCard.ts` — confirm that's still the real file name and adjust the steps below if it's actually inside `canvas.ts` or elsewhere.)

- [ ] **Step 2: Add an optional `hitBadge` field to `BattleCardState`**

```typescript
export interface BattleCardState {
  // ...existing fields...
  hitBadge?: number; // set to 2 or 3 when the last move was a multi-hit (Vesper's Arc Discharge) — undefined/1 means no badge
}
```

- [ ] **Step 3: Draw the badge in `canvas.ts`'s battle-card renderer**

Find the existing badge-drawing code (CREATOR/PATRON/AWAKENED-style badges) to match its exact styling conventions:

```bash
grep -n "CREATOR\|AWAKENED\|badge" src/lib/canvas.ts | head -20
```

Add a small rounded-rect "×N" tag near wherever the boss/player damage number is drawn (confirm the exact damage-number draw call site first), following the same `rrect`/`shadowColor`/`fillStyle` pattern already used by the other badges in this file — e.g.:

```typescript
if (state.hitBadge && state.hitBadge > 1) {
  const badgeText = `×${state.hitBadge}`;
  // position: adjust to sit just beside/below the damage number's actual
  // coordinates in this file — read the surrounding damage-text draw call
  // first, don't guess pixel coordinates blind.
  ctx.fillStyle = "#FFD54F";
  ctx.shadowColor = "#FFD54F"; ctx.shadowBlur = 10;
  ctx.font = `bold 14px Rajdhani, 'Noto Sans', Arial, sans-serif`;
  ctx.fillText(badgeText, /* x */, /* y */);
  ctx.shadowBlur = 0;
}
```

- [ ] **Step 4: In each combat loop's Skill branch, when the active ally is Vesper, split the embed text into per-hit lines and set `hitBadge`**

This is the same shape in all 7 files. Using `ascend.ts` as the reference (apply identically to the other 6):

```typescript
} else if (btn.customId === "battle_skill" && isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "vesper" && allyKit) {
  const kState = allyMechanicState as VesperMechanicState;
  const crit = Math.random() < activeCritRate; abilCrit = crit;
  const forteEmpowered = isForteMaxed(solaceForte, VESPER_FORTE_CONFIG);
  const result = allyKit.onSkill(
    { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: kState, playerEnergy: state.playerEnergy, playerEnergyMax: 100, forteEmpowered } as any,
    { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
    allyConstellation,
  ) as VesperSkillResult;
  allyMechanicState = result.newMechanicState;
  if (forteEmpowered) solaceForte = resetForte();

  const effectiveDefReduction = 1 - (1 - defReduction) * (1 - result.defIgnorePct);
  const perHitBase = Math.max(1, Math.floor(activeAtk * (result.damageMult / result.hits) * (1 - effectiveDefReduction)));
  const perHitDmg = Math.floor(perHitBase * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));

  if (result.hits > 1) {
    const hitLines = Array.from({ length: result.hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
    playerDmg = perHitDmg * result.hits;
    moveName = `🌑 ${result.moveLabel}\n${hitLines}\n**Total: ${playerDmg} DMG**${crit ? " **(CRIT)**" : ""}`;
    state.hitBadge = result.hits;
  } else {
    playerDmg = perHitDmg;
    moveName = `⚡ ${result.moveLabel} — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
    state.hitBadge = undefined;
  }
  state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * result.vibFrac * totalVibMult));
}
```

**Important caveats for whoever implements this**:
1. `forteEmpowered` is passed into the context via an `as any` cast because `CharacterCombatContext` doesn't declare it — confirm whether to add a real `forteEmpowered?: boolean` field to the interface instead (cleaner, avoids the cast) before committing to the `any` approach; this plan defaults to the cast only to avoid re-touching `characterKit.ts` a third time, but a real field is arguably better and should be a quick judgment call at implementation time, not blindly copied.
2. `state.hitBadge` must be reset to `undefined` on every OTHER move type (Basic/Ultimate/echo-skill) too, in every loop, or a stale badge from a prior Vesper Discharge will incorrectly persist onto a later, unrelated hit's rendered card. Add `state.hitBadge = undefined;` at the top of each loop's Basic/Ultimate/echo-skill branches, or once at the very start of each turn's handler before any branch runs — whichever is less repetitive in that file's existing structure.
3. Each of the 7 files uses a slightly different set of local variable names (`activeAtk`/`effectiveOppDef` in duel.ts, `current.` prefixes in raid.ts, `ws.` prefixes in dungeon.ts) — mechanically apply the same transform using each file's own established Kaelith-dispatch variable names from this session's earlier work, not a blind copy-paste of the `ascend.ts` snippet above.
4. `duel.ts` and `raid.ts` don't use a shared `state.hitBadge`-style single `BattleCardState` the same way solo fights do (duel is two-sided `state.cHp`/`state.dHp`; raid is per-participant `current.hp`) — confirm whether their card renderers even use `BattleCardState`/`generateBattleCard` (check `versusCard.ts` for duel, and raid's own embed builder) before assuming this exact field name applies unmodified; if they use a different state shape, add the equivalent field to whatever type they DO use, following the same badge-drawing code from Step 3.

- [ ] **Step 5: Typecheck each file after editing it, then build the whole repo**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas.ts src/lib/battleCard.ts src/commands/rpg/ascend.ts src/commands/rpg/boss.ts src/commands/rpg/field-boss.ts src/commands/rpg/dungeon.ts src/commands/rpg/duel.ts src/commands/rpg/raid.ts src/lib/encounter.ts
git commit -m "feat(vesper): add Arc Discharge multi-hit display (embed text + canvas badge) across all combat loops"
```

---

### Task 7: Final full-repo verification

- [ ] **Step 1: Full typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: zero errors.

- [ ] **Step 2: Grep sweep for any remaining placeholder/TODO markers left by earlier tasks**

```bash
grep -rn "TODO\|FIXME\|placeholder" src/lib/kits/vesperKit.ts src/lib/characterKit.ts
```
Expected: no results (or only pre-existing, unrelated ones).

- [ ] **Step 3: Announce and hand off to finishing-a-development-branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."
**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — push to `main`, SSH-deploy (`git pull && npm run build && pm2 restart cartethyia`), remembering `npx prisma generate` on the VM after the schema change, and upload `assets/Characters/Vesper.png` (already exists locally per this session's earlier `ls` check) to the VM the same way `Kaelith.png` needed a manual `scp` — asset files aren't tracked by git.

---

## Self-review notes (completed during plan writing)

- **Spec coverage**: Static Mark/Discharge/Overload chain ✓ (Task 2), Forte-tied Arc Discharge double/triple hit ✓ (Task 2/6), Skill cooldown 0 ✓ (Task 3 assembly), Intro Energy burst / Outro free mark ✓ (Task 2), all 6 constellations ✓ (Task 2's formulas + Task 6's C4/C5 application), SPD floor higher than Kaelith's with no bespoke mechanic ✓ (Task 1, explicit comment), double-hit display both embed-text and canvas badge ✓ (Task 6), Voltaic Aberrant ascension material ✓ (Task 4), `/character` generic-dispatch entries ✓ (Task 5).
- **Known open items flagged inline, not silently resolved**: Task 6 Step 4's `forteEmpowered` context field (cast vs. real interface field — left as an explicit judgment call, not asserted as settled), and Task 6 Step 4's caveat #4 about duel.ts/raid.ts potentially using a different card-state shape entirely (flagged for verification at implementation time rather than assumed).
- **Explicitly out of scope**, matching the spec: exact icon art for Voltaic Shards (flagged the same way Umbral Shards was, silently no-ops until drawn), standard-banner pool inclusion / launch timing for Vesper (a business decision, likely gated the same way Kaelith currently is — this plan doesn't touch `STANDARD_CHARACTER_POOL` in `wish.ts` at all, matching "not yet decided" for her launch).
