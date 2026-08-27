# Rilo Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Rilo's full `PlayableCharacterKit` (Glacio tank/control, Broadblade-brawler, build-and-spend Guard/Shield gauge with a defining "hits twice at max Shield" Ultimate payoff), her new ascension currency, and the hit-taken combat hook her constellations need (C3's near-death auto-block, C5's Forte-on-hit-taken, C6's 0-Shield safety net) — per the approved design spec `docs/superpowers/specs/2026-07-30-rilo-kit-design.md`.

**Architecture:** Same generic `CHARACTER_KITS` dispatch pattern proven for Kaelith and Vesper — registering Rilo makes her immediately playable in all 7 combat loops via the existing `activeAllyCharacterId`/`allyKit` dispatch. Two things are genuinely new cross-cutting work, not just registration: (1) Rilo's Ultimate reuses the multi-hit display infrastructure already built for Vesper (`state.hitBadge`, the canvas badge, the `Hit 1:`/`Hit 2:` embed pattern) — no new display work, just a new call site gated on "Shield at max" instead of "Forte empowered"; (2) a brand-new **hit-taken hook** — nothing in this codebase today lets a character kit react to the *enemy's* attack landing on the active unit, which C3/C5/C6 all need. This plan adds a small non-interface helper (`riloOnHitTaken`, same "extend via a kit-specific helper function, not the shared interface" pattern `VesperSkillResult` already established) that each combat loop calls at the point enemy damage is applied to the active unit.

**Tech Stack:** TypeScript (CommonJS), discord.js v14, existing `characterKit.ts`/`allyActions.ts`/`introOutro.ts`/`battleCard.ts`/`canvas.ts`/`forte.ts` infrastructure, Prisma (new `glacialShards` column, mirrors `voltaicShards` exactly).

---

## Important context for whoever executes this

- No test framework in this repo — verification is `npx tsc --noEmit`, `npm run build`, and disposable one-off `scripts/*.ts` scripts (created, run with `npx tsx`, then deleted — never committed).
- Work happens directly on `main`. Commit after every task, push + SSH-deploy (`git pull && npm run build && pm2 restart cartethyia`, `npx prisma generate` after schema changes) after the whole plan is done, matching the established rhythm from Kaelith's and Vesper's builds.
- `src/lib/kits/vesperKit.ts` is the direct template for Task 1/2/3's shape, and for Task 6's multi-hit reuse. `src/lib/kits/kaelithKit.ts` is the template for the simpler stack-gain-on-Basic dispatch pattern.
- Read `docs/superpowers/specs/2026-07-30-rilo-kit-design.md` in full before Task 1 — every formula/number below is derived from it, but the spec left exact tuning constants as implementation-time decisions; this plan fixes those constants concretely.
- Currency name for this plan: **Glacial Shards**, dropped by **Permafrost Sovereign** (id `permafrost_sovereign` in `src/lib/fieldBosses.ts`, confirmed base-tier, no `unlockWorldLevel` gate) — same naming pattern as the other three (material name related to but distinct from the boss name).
- Lore fragments (7 entries, matching Solace/Kaelith/Vesper's precedent) were left undrafted in the spec — Task 2 drafts them concretely as part of assembling the kit content, matching how tuning constants were fixed in this plan rather than left open.
- Character art (portrait + icon variant) has not been provided yet — Task 3's `portraitPath` will point at `assets/Characters/Rilo.png`, which does not exist yet. This is flagged the same way Vesper's asset gap was: the kit registers and typechecks fine, but `/character`'s art and the profile-badge icon will silently show nothing until the file is actually dropped in and `scp`'d to the VM (assets aren't git-tracked).

---

### Task 1: `riloKit.ts` — mechanic state, stat curve

**Files:**
- Create: `src/lib/kits/riloKit.ts`
- Reference (read-only): `src/lib/kits/vesperKit.ts`, `src/lib/characterKit.ts`

- [ ] **Step 1: Create the file with mechanic state and stat curve**

```typescript
// src/lib/kits/riloKit.ts
// Rilo's PlayableCharacterKit — Glacio tank/control, standard-pool 5★,
// Broadblade-brawler. Build-and-spend Guard/Shield gauge. See design spec
// docs/superpowers/specs/2026-07-30-rilo-kit-design.md.

import {
  PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult, CHARACTER_KITS,
} from "../characterKit";
import { IntroOutroEffect } from "../introOutro";
import { ForteConfig } from "../forte";

export interface RiloMechanicState {
  shield: number;                       // 0-maxShield (140 at C5+, else 100), persists across turns
  defShredTurnsLeft: number;             // C2's 2-turn DEF-shred window on the enemy
  usedClutchSaveThisBattle: boolean;     // C3's once-per-battle near-death auto-block
  usedZeroShieldSaveThisBattle: boolean; // C6's once-per-battle 0-Shield safety net
}

export function riloCreateInitialMechanicState(): RiloMechanicState {
  return { shield: 0, defShredTurnsLeft: 0, usedClutchSaveThisBattle: false, usedZeroShieldSaveThisBattle: false };
}

export function riloMaxShield(constellation: number): number {
  return constellation >= 5 ? 140 : 100;
}

const HP_CEIL = 1200, HP_FLOOR_FRAC = 0.35;
const ATK_CEIL = 130, ATK_FLOOR_FRAC = 0.35;
const DEF_CEIL = 120, DEF_FLOOR_FRAC = 0.35;
// SPD floor/ceiling both sit below Kaelith/Vesper's — she is deliberately the
// slowest character in the roster (dragging a huge blade), per design spec.
const SPD_CEIL = 90, SPD_FLOOR_FRAC = 0.55;
const CRIT_RATE_CEIL = 0.08, CRIT_RATE_FLOOR_FRAC = 0.60;
const CRIT_DMG_CEIL = 1.6, CRIT_DMG_FLOOR_FRAC = 0.60;
const RILO_LEVEL_CAP = 90;

function scaleStat(ceil: number, floorFrac: number, level: number): number {
  const floor = ceil * floorFrac;
  const t = Math.min(1, Math.max(0, (level - 1) / (RILO_LEVEL_CAP - 1)));
  return floor + (ceil - floor) * t;
}

// Field names must match PlayableCharacterKit.statsAtLevel's declared return
// shape exactly — { hpMax, baseAtk, baseDef, baseSpeed, critRate, critDmg }.
export function riloStatsAtLevel(level: number) {
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
Expected: no errors from `riloKit.ts` (not imported anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/kits/riloKit.ts
git commit -m "feat(rilo-kit): add mechanic-state, stat-curve foundations"
```

---

### Task 2: `riloKit.ts` — Skill/Ultimate/Intro/Outro/Forte/cost/constellation content + hit-taken helper

**Files:**
- Modify: `src/lib/kits/riloKit.ts`

- [ ] **Step 1: Add Skill (Guard Break) and Ultimate (Avalanche Slam) formulas**

```typescript
// Fraction of Shield consumed by Guard Break that converts to bonus damage
// multiplier. E.g. consuming 60 Shield at RILO_SHIELD_TO_DAMAGE_MULT = 0.02
// adds +1.2 to her base multiplier.
const RILO_SHIELD_TO_DAMAGE_MULT = 0.02;
const RILO_BASELINE_SKILL_DMG_NO_SHIELD = 0.8; // Guard Break with 0 Shield banked — reduced but never a hard block
// C2's DEF-shred value/duration.
const RILO_C2_DEF_SHRED_PCT = 0.10;
const RILO_C2_DEF_SHRED_TURNS = 2;
// Forte-empowered Guard Break's flat Shield refund after consuming.
const RILO_FORTE_SHIELD_REFUND = 25;
// C4's Ultimate-damage-to-Shield conversion cap.
const RILO_C4_ULT_SHIELD_CONVERSION_PCT = 0.20;
// Ultimate's own post-cast Shield refund (independent of Forte/C4).
const RILO_ULT_SHIELD_REFUND_FRAC = 0.45; // ~45% of max Shield

export function riloSkillBaseMult(skillLevel: number): number {
  const t = Math.min(1, Math.max(0, (skillLevel - 1) / 9));
  return 1.4 + (2.0 - 1.4) * t; // 1.4 -> 2.0 across kit levels 1-10
}

export function riloUltimateBaseMult(ultimateLevel: number): number {
  const t = Math.min(1, Math.max(0, (ultimateLevel - 1) / 9));
  return 2.6 + (3.8 - 2.6) * t; // 2.6 -> 3.8 across kit levels 1-10
}

// Extends the shared SkillEffectResult shape with fields only the combat
// loops need — NOT part of the PlayableCharacterKit interface itself, same
// pattern VesperSkillResult established.
export interface RiloSkillResult extends SkillEffectResult {
  shieldConsumed: number;
  defShredApplied: boolean;
}

export function riloOnSkill(
  ctx: CharacterCombatContext,
  skillLevel: number,
  constellation: number,
): RiloSkillResult {
  const state = ctx.mechanicState as RiloMechanicState;
  const shieldConsumed = state.shield;
  const forteEmpowered = (ctx as any).forteEmpowered === true;

  const baseMult = riloSkillBaseMult(skillLevel);
  const damageMult = shieldConsumed > 0
    ? baseMult + shieldConsumed * RILO_SHIELD_TO_DAMAGE_MULT
    : RILO_BASELINE_SKILL_DMG_NO_SHIELD;

  // Forte-empowered: refund a flat chunk back after consuming, instead of
  // fully draining to 0.
  const shieldAfter = forteEmpowered ? Math.min(riloMaxShield(constellation), RILO_FORTE_SHIELD_REFUND) : 0;

  return {
    damageMult,
    vibFrac: 0.6,
    moveLabel: forteEmpowered ? "Braced Guard Break" : "Guard Break",
    newMechanicState: {
      ...state,
      shield: shieldAfter,
      defShredTurnsLeft: constellation >= 2 ? RILO_C2_DEF_SHRED_TURNS + 1 : state.defShredTurnsLeft, // +1 compensates for the same-round decrement applied right after, matching every other kit's outro-buff-duration convention
    } as RiloMechanicState,
    shieldConsumed,
    defShredApplied: constellation >= 2,
  };
}

export function riloOnUltimate(
  ctx: CharacterCombatContext,
  ultimateLevel: number,
  constellation: number,
): UltimateEffectResult {
  const state = ctx.mechanicState as RiloMechanicState;
  const damageMult = riloUltimateBaseMult(ultimateLevel);
  const maxShield = riloMaxShield(constellation);

  // Base refund, independent of C4's damage-conversion bonus.
  const baseRefund = Math.floor(maxShield * RILO_ULT_SHIELD_REFUND_FRAC);
  // C4's damage-to-Shield conversion is applied by the calling combat loop
  // (it needs the actual damage number dealt, which this function doesn't
  // compute — the loop adds `Math.floor(actualDamageDealt * RILO_C4_ULT_SHIELD_CONVERSION_PCT)`
  // on top of baseRefund itself before writing the final `shield` value into
  // newMechanicState; this function returns the pre-C4 baseline only,
  // exactly like Vesper's onUltimate doesn't know the calling loop's crit
  // roll ahead of time).
  const newShield = Math.min(maxShield, state.shield + baseRefund);

  return {
    healResult: { actions: constellation >= 4 ? [{ type: "CLEANSE_ALLY", value: 1 }] : [] },
    moveLabel: "Avalanche Slam",
    newMechanicState: {
      ...state,
      shield: newShield,
    } as RiloMechanicState,
    resetsConcertoEnergy: false, // Rilo has no Solace-style team-heal Ultimate
  };
}

// C4's Shield-from-damage conversion — a plain helper (not part of
// UltimateEffectResult, same non-interface-extension pattern as
// RiloSkillResult) the calling combat loop invokes once it knows the actual
// Ultimate damage dealt.
export function riloUltimateShieldFromDamage(actualDamageDealt: number, constellation: number): number {
  return constellation >= 4 ? Math.floor(actualDamageDealt * RILO_C4_ULT_SHIELD_CONVERSION_PCT) : 0;
}
```

- [ ] **Step 2: Add Intro/Outro effects**

```typescript
const RILO_INTRO_SHIELD_GRANT = 20;
const RILO_OUTRO_SHIELD_TRANSFER_FRAC = 0.5; // half her remaining Shield transfers, as a temp absorb buff value
const RILO_C1_OUTRO_DEF_BUFF_TURNS = 2;

export function riloIntroEffect(introLevel: number, constellation: number): IntroOutroEffect {
  return {
    actions: [],
    newMechanicState: { grantShieldOnIntro: RILO_INTRO_SHIELD_GRANT + introLevel },
  };
}

export function riloOutroEffect(constellation: number): IntroOutroEffect {
  return {
    actions: [],
    // shieldTransferAmount is computed by the calling combat loop (it needs
    // the outgoing Rilo's actual current shield value, which this function
    // doesn't have access to) — this side-channel just flags the fraction
    // and whether C1's DEF buff applies.
    newMechanicState: {
      grantShieldTransferOnOutro: RILO_OUTRO_SHIELD_TRANSFER_FRAC,
      grantDefBuffOnOutro: constellation >= 1,
      defBuffTurns: RILO_C1_OUTRO_DEF_BUFF_TURNS,
    },
  };
}
```

- [ ] **Step 3: Add Forte config, basic damage mult, ascension/level-up cost, status line, hit-taken helper, lore, constellation text**

```typescript
export const RILO_FORTE_CONFIG: ForteConfig = { phaseThresholds: [100] };
export const RILO_FORTE_GAIN_PER_BASIC = 20;
export const RILO_FORTE_GAIN_PER_HIT_TAKEN = 7; // C5 only — roughly a third of a Basic's contribution
export const RILO_SHIELD_GAIN_PER_BASIC = 18;

export function riloBasicDamageMult(basicLevel: number): number {
  const t = Math.min(1, Math.max(0, (basicLevel - 1) / 9));
  return 1.0 + 0.5 * t; // 1.0 -> 1.5 across kit levels 1-10, same shape as every other kit's basic curve
}

export function riloAscensionCost(currentPhase: number) {
  const targetPhase = currentPhase + 1;
  return {
    credits: 5500 * targetPhase,
    forgingOres: 7 * targetPhase,
    paradoxCores: 2 * targetPhase,
    starfallShards: 0, // interface filler — see kaelithKit.ts's identical note on this known limitation
    glacialShards: 3 * targetPhase,
  };
}

export function riloLevelUpCost(currentLevel: number) {
  return {
    credits: 220 * currentLevel,
    resonanceRecords: Math.max(1, Math.floor(currentLevel / 5)),
  };
}

export function riloStatusLineText(mechanicState: unknown): string {
  const state = mechanicState as RiloMechanicState;
  return `Shield: **${state.shield}**  ·  DEF-shred: **${state.defShredTurnsLeft > 0 ? `${state.defShredTurnsLeft}t` : "none"}**`;
}

// C3 (near-death auto-block) and C5 (Forte-on-hit-taken) both need Rilo to
// react to the ENEMY's attack landing on her — nothing in this codebase
// today lets a character kit hook into that, so this is a plain helper (not
// part of PlayableCharacterKit) each combat loop calls at the exact point it
// applies enemy damage to the active unit, IF that unit is Rilo. Mirrors the
// "extend via a kit-specific helper, not the shared interface" pattern
// RiloSkillResult/riloUltimateShieldFromDamage already established above.
export interface RiloHitTakenResult {
  newMechanicState: RiloMechanicState;
  actualDamageTaken: number;   // 0 if C3's block fully absorbed it
  blockedByC3: boolean;
  forteGain: number;           // 0 unless C5 and state.shield > 0 at the time of the hit
  zeroShieldSaveTriggered: boolean; // C6 — informational, so the combat loop can announce it
}

export function riloOnHitTaken(
  state: RiloMechanicState,
  incomingDamage: number,
  currentHp: number,
  maxHp: number,
  constellation: number,
): RiloHitTakenResult {
  let shield = state.shield;
  let actualDamageTaken = incomingDamage;
  let blockedByC3 = false;
  let zeroShieldSaveTriggered = false;

  // C3: once per battle, a hit that would drop her below 25% HP is instead
  // fully blocked by consuming all remaining Shield. Only fires if she
  // actually has Shield banked — not a free pass every fight.
  const wouldDropBelow25Pct = (currentHp - incomingDamage) < maxHp * 0.25;
  if (constellation >= 3 && !state.usedClutchSaveThisBattle && wouldDropBelow25Pct && shield > 0) {
    actualDamageTaken = 0;
    blockedByC3 = true;
    shield = 0; // consuming "all remaining Shield" per spec
  }

  // C5: taking a hit while holding any Shield grants a flat, modest Forte
  // contribution. Checked against the ORIGINAL shield value (before this
  // same hit's C3 consumption above), since "holding Shield at the moment of
  // the hit" is the trigger condition, not "holding Shield afterward."
  const forteGain = constellation >= 5 && state.shield > 0 ? RILO_FORTE_GAIN_PER_HIT_TAKEN : 0;

  // C6: once per battle, if Shield is ever exactly 0 (checked AFTER any C3
  // consumption above, since C3 draining it to 0 is a valid trigger too),
  // it's immediately restored to 50% of max.
  if (constellation >= 6 && !state.usedZeroShieldSaveThisBattle && shield === 0) {
    shield = Math.floor(riloMaxShield(constellation) * 0.5);
    zeroShieldSaveTriggered = true;
  }

  return {
    newMechanicState: {
      ...state,
      shield,
      usedClutchSaveThisBattle: state.usedClutchSaveThisBattle || blockedByC3,
      usedZeroShieldSaveThisBattle: state.usedZeroShieldSaveThisBattle || zeroShieldSaveTriggered,
    },
    actualDamageTaken,
    blockedByC3,
    forteGain,
    zeroShieldSaveTriggered,
  };
}

export const RILO_LORE_FRAGMENTS = [
  "Rilo picked up her first broadblade because it was the only thing in the armory taller than she was. She has not put one down since.",
  "She apologizes to the enemies she hits. Genuinely. Then hits them again.",
  "Someone told her a blade that size should scare people. She took it as a compliment about her upper-body strength.",
  "Rilo counts her guard the way other people count sheep — quietly, constantly, and mostly to stay calm before the fun part.",
  "She has never once described a fight as dangerous. \"Exciting,\" maybe. \"A lot,\" sometimes. Never dangerous.",
  "The frost that gathers on her blade isn't for show — it's just what happens when something that cold moves that fast, that often.",
  "When she finally lets the swing land, she still grins first. The grin arrives before the impact does.",
];

export const RILO_CONSTELLATION_EFFECTS = [
  "Basic Attacks that land a critical hit grant +50% bonus Shield on top of the normal flat gain (still capped at max Shield).",
  "Guard Break's guaranteed crit also applies a 10% DEF-shred debuff for 2 turns (non-stacking — reapplying refreshes duration).",
  "**Once per battle:** if a hit would drop her below 25% HP and she has any Shield banked, she instead auto-consumes all remaining Shield to fully block it.",
  "Avalanche Slam cleanses one debuff from her and grants Shield equal to 20% of the damage it dealt.",
  "Forte also gains a flat, modest amount whenever she takes a hit while holding any Shield — max Shield is also raised from 100 to 140.",
  "**(Defining)** Once per battle, if her Shield ever hits exactly 0, it's immediately restored to 50% of max — and Avalanche Slam hits twice whenever cast while Shield is at max.",
];
```

Note: C5's max-Shield-raise (100→140) was originally its own bullet in the spec but is folded into the same constellation-effects string as the Forte-on-hit-taken change here, since `riloMaxShield()` (Task 1) already gates both behind `constellation >= 5` in one place — avoids the constellation text implying two independent unlocks when the code ties them to the same gate.

- [ ] **Step 4: Verify compiles**

```bash
npx tsc --noEmit
```
Expected: no errors (not registered yet — Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/riloKit.ts
git commit -m "feat(rilo-kit): add skill/ultimate/intro/outro/forte/cost/hit-taken/constellation content"
```

---

### Task 3: Assemble and register Rilo's kit

**Files:**
- Modify: `src/lib/kits/riloKit.ts`
- Modify: `src/lib/kits/index.ts`
- Modify: `src/lib/characterElements.ts`

Unlike Vesper, Rilo needs **no new fields on `CharacterCombatContext`** — her hit-taken hook (`riloOnHitTaken`) is a plain function taking explicit parameters, not something read off the shared context object.

- [ ] **Step 1: Assemble the kit**

Append to `src/lib/kits/riloKit.ts`:

```typescript
export const riloKit: PlayableCharacterKit = {
  id: "rilo",
  label: "Rilo",
  emoji: "🛡️",
  element: "GLACIO",
  rarity: 5,
  portraitPath: "assets/Characters/Rilo.png",
  loreFragments: RILO_LORE_FRAGMENTS,
  skillCooldownTurns: 0,
  statsAtLevel: riloStatsAtLevel,
  async resolveStats(userId: string) {
    const { prisma } = await import("../prisma");
    const { resolvePlayerBonuses, applyBonuses } = await import("../setBonus");
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: "rilo" } },
    });
    const level = progress?.level ?? 1;
    const lvl = riloStatsAtLevel(level);
    const bonuses = await resolvePlayerBonuses(userId, "rilo");
    const stats = applyBonuses(
      { baseHp: lvl.hpMax, baseAtk: lvl.baseAtk, baseDef: lvl.baseDef, critRate: lvl.critRate, critDmg: lvl.critDmg, baseSpeed: lvl.baseSpeed },
      bonuses,
    );
    return { ...stats, hasSignatureWeapon: false, signatureWeaponRefinement: 0 };
  },
  ascensionLevelCap: [20, 40, 50, 60, 70, 80, 90],
  ascensionCost: riloAscensionCost,
  levelUpCost: riloLevelUpCost,
  basicDamageMult: riloBasicDamageMult,
  introEffect: riloIntroEffect,
  outroEffect: riloOutroEffect,
  forteConfig: RILO_FORTE_CONFIG,
  forteGainPerBasic: RILO_FORTE_GAIN_PER_BASIC,
  createInitialMechanicState: riloCreateInitialMechanicState,
  onSkill: (ctx, kitLevels, constellation) => riloOnSkill(ctx, kitLevels.skillLevel, constellation),
  onUltimate: (ctx, kitLevels, constellation) => riloOnUltimate(ctx, kitLevels.ultimateLevel, constellation),
  statusLineText: riloStatusLineText,
  constellationEffects: RILO_CONSTELLATION_EFFECTS,
  maxConstellation: 6,
};

CHARACTER_KITS[riloKit.id] = riloKit;
```

**Before finalizing**: confirm the real `onSkill`/`onUltimate` parameter names in `characterKit.ts` match this arrow-wrapper shape exactly (same live-interface check Kaelith's and Vesper's plans both flagged) — do the same here rather than trusting this sketch blindly.

- [ ] **Step 2: Register in `src/lib/kits/index.ts`**

```typescript
import "./riloKit";
```

- [ ] **Step 3: Add to `src/lib/characterElements.ts`**

```typescript
export const CHARACTER_ELEMENTS: Record<string, string> = {
  solace: "SPECTRO",
  kaelith: "HAVOC",
  vesper: "ELECTRO",
  rilo: "GLACIO",
};
```

- [ ] **Step 4: Verify with a standalone script**

```typescript
// scripts/verify-rilo-kit.ts
import "dotenv/config";
import "../src/lib/kits";
import { CHARACTER_KITS } from "../src/lib/characterKit";
import { riloOnSkill, riloOnUltimate, riloOnHitTaken, riloMaxShield, RiloMechanicState } from "../src/lib/kits/riloKit";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("PASS:", msg);
}

const kit = CHARACTER_KITS["rilo"];
assert(kit !== undefined, "rilo kit registered");
assert(kit.rarity === 5, "rilo is 5-star");
assert(kit.constellationEffects.length === 6, "6 constellation strings");
assert(kit.loreFragments.length === 7, "7 lore fragments");

const noShield: RiloMechanicState = { shield: 0, defShredTurnsLeft: 0, usedClutchSaveThisBattle: false, usedZeroShieldSaveThisBattle: false };
const withShield: RiloMechanicState = { shield: 60, defShredTurnsLeft: 0, usedClutchSaveThisBattle: false, usedZeroShieldSaveThisBattle: false };

const skillNoShield = riloOnSkill({ playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: noShield }, 1, 0);
assert(skillNoShield.shieldConsumed === 0, "Guard Break with no Shield consumes nothing");

const skillWithShield = riloOnSkill({ playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: withShield }, 1, 0);
assert(skillWithShield.shieldConsumed === 60, "Guard Break consumes all banked Shield");
assert((skillWithShield.newMechanicState as RiloMechanicState).shield === 0, "non-Forte-empowered Guard Break drains Shield to 0");

const forteCtx = { playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: withShield, forteEmpowered: true } as any;
const skillForte = riloOnSkill(forteCtx, 1, 0);
assert((skillForte.newMechanicState as RiloMechanicState).shield > 0, "Forte-empowered Guard Break refunds Shield instead of fully draining");

assert(riloMaxShield(0) === 100, "max Shield is 100 below C5");
assert(riloMaxShield(5) === 140, "max Shield is 140 at C5+");

// C3: near-death clutch save
const nearDeathHit = riloOnHitTaken(withShield, 90, 100, 100, 3); // would drop to 10 HP, below 25%
assert(nearDeathHit.blockedByC3 === true, "C3 blocks a near-death hit when Shield is banked");
assert(nearDeathHit.actualDamageTaken === 0, "C3's block fully negates the hit's damage");
assert((nearDeathHit.newMechanicState as RiloMechanicState).usedClutchSaveThisBattle === true, "C3 marks itself used after triggering");

const secondNearDeathHit = riloOnHitTaken(nearDeathHit.newMechanicState, 90, 100, 100, 3);
assert(secondNearDeathHit.blockedByC3 === false, "C3 does not trigger a second time in the same battle");

// C5: Forte-on-hit-taken
const hitWithShieldC5 = riloOnHitTaken(withShield, 10, 100, 100, 5);
assert(hitWithShieldC5.forteGain > 0, "C5 grants Forte when hit while holding Shield");
const hitNoShieldC5 = riloOnHitTaken(noShield, 10, 100, 100, 5);
assert(hitNoShieldC5.forteGain === 0, "C5 grants no Forte when hit with 0 Shield banked");

// C6: zero-Shield safety net
const zeroShieldHit = riloOnHitTaken(noShield, 10, 100, 100, 6);
assert(zeroShieldHit.zeroShieldSaveTriggered === true, "C6 triggers when Shield is exactly 0");
assert((zeroShieldHit.newMechanicState as RiloMechanicState).shield > 0, "C6 restores Shield after triggering");
const secondZeroShieldHit = riloOnHitTaken(zeroShieldHit.newMechanicState, 200, 100, 100, 6);
// second hit drains shield back toward 0 depending on formula — just confirm the used-flag prevents a second restore this battle
const thirdCallForcedZero: RiloMechanicState = { ...(zeroShieldHit.newMechanicState as RiloMechanicState), shield: 0 };
const secondTrigger = riloOnHitTaken(thirdCallForcedZero, 10, 100, 100, 6);
assert(secondTrigger.zeroShieldSaveTriggered === false, "C6 does not trigger a second time in the same battle");

const ultResult = riloOnUltimate({ playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: noShield }, 1, 0);
assert((ultResult.newMechanicState as RiloMechanicState).shield > 0, "Avalanche Slam refunds Shield after casting");

process.exit(process.exitCode ?? 0);
```

Run:
```bash
npx tsx scripts/verify-rilo-kit.ts
```
Expected: all `PASS:` lines, exit code 0.

- [ ] **Step 5: Delete the verification script (never committed)**

```bash
rm scripts/verify-rilo-kit.ts
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/kits/riloKit.ts src/lib/kits/index.ts src/lib/characterElements.ts
git commit -m "feat(rilo-kit): assemble PlayableCharacterKit and register"
```

---

### Task 4: New currency — Glacial Shards (schema, registration, drop wiring)

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/inventoryCard.ts`
- Modify: `src/lib/emojiManager.ts`
- Modify: `src/commands/rpg/field-boss.ts`

Mirrors the exact steps already done for Voltaic Shards, with Permafrost Sovereign instead of Voltaic Aberrant.

- [ ] **Step 1: Add `glacialShards` column to `User` and `Mail` models**

In `prisma/schema.prisma`, add after the existing `voltaicShards` line in both models:

```prisma
  glacialShards Int @default(0)
```

- [ ] **Step 2: Push schema and regenerate client**

```bash
npm run db:push
npx prisma generate
```
Expected: "Your database is now in sync", no data-loss warnings.

- [ ] **Step 3: Register in `src/lib/inventoryCard.ts`'s `CURRENCIES` array**

```typescript
  { key: "glacialShards", file: "Glacial Shard.png", label: "Glacial Shards", color: "#38BDF8", desc: "Rilo ascension" },
```

Note: `assets/icons/Glacial Shard.png` does not exist yet — flag to the user, matching the established silent-no-op pattern until the icon is drawn.

- [ ] **Step 4: Register in `src/lib/emojiManager.ts`**

Three additions, mirroring the `cc_voltaic` entries exactly:
- `{ name: "cc_glacial", file: "assets/icons/Glacial Shard.png" }` in `EMOJI_ASSETS`
- `glacialShards: "cc_glacial"` in `CURRENCY_EMOJI_MAP`
- `get gs() { return getEmoji("cc_glacial", "❄️"); }` in the `CE` accessor object

- [ ] **Step 5: Add the drop to `field-boss.ts` for Permafrost Sovereign**

```bash
grep -n "voltaic_aberrant\|voltaicShardsDropped\|dropNote" src/commands/rpg/field-boss.ts
```

Add a parallel `fb.id === "permafrost_sovereign"` branch at each of the three points (same three edit points Vesper's currency touched):
1. `dropNote` ternary: append `fb.id === "permafrost_sovereign" ? "  ✦ drops Glacial Shards"` alongside the existing checks
2. A new `glacialShardsDropped` block mirroring `voltaicShardsDropped`'s shape exactly (unconditional `+1` on `fb.id === "permafrost_sovereign"`)
3. Victory-embed description string: extend with `(glacialShardsDropped ? \`\n${CE.gs} **1 Glacial Shard**\` : "")`

- [ ] **Step 6: Typecheck, build, commit**

```bash
npx tsc --noEmit
npm run build
git add prisma/schema.prisma src/lib/inventoryCard.ts src/lib/emojiManager.ts src/commands/rpg/field-boss.ts
git commit -m "feat(rilo): add Glacial Shards currency, Permafrost Sovereign drop"
```

---

### Task 5: `/character` — map entries

**Files:**
- Modify: `src/commands/rpg/character.ts`

- [ ] **Step 1: Add to `ASCENSION_SHARD_CURRENCY` and `ShardDbField`**

```typescript
const ASCENSION_SHARD_CURRENCY: Record<string, { field: string; dbField: ShardDbField; label: string }> = {
  solace:  { field: "starfallShards", dbField: "starfallShards", label: "Starfall Shards" },
  kaelith: { field: "umbralShards",   dbField: "umbralShards",   label: "Umbral Shards"   },
  vesper:  { field: "voltaicShards",  dbField: "voltaicShards",  label: "Voltaic Shards"  },
  rilo:    { field: "glacialShards",  dbField: "glacialShards",  label: "Glacial Shards"  },
};

type ShardDbField = "starfallShards" | "umbralShards" | "voltaicShards" | "glacialShards";
```

Add `glacialShards: true` alongside the existing shard fields in both Prisma `select` clauses:

```bash
grep -n "starfallShards: true, umbralShards: true, voltaicShards: true" src/commands/rpg/character.ts
```

- [ ] **Step 2: Add to `RECOMMENDED_SET`**

```typescript
  rilo: "**Frostveil Bastion** (Glacio) — her own element, and its shield/panic-shield mechanics stack naturally on top of her own Guard gauge instead of fighting it.",
```

- [ ] **Step 3: Add to `SHARD_FIELD_BOSS`**

```typescript
  rilo: "Permafrost Sovereign",
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/commands/rpg/character.ts
git commit -m "feat(character): add Rilo's shard currency/recommended-set/field-boss entries"
```

---

### Task 6: Combat-loop dispatch — Basic Attack, Skill, Ultimate, Outro/Intro, and the new hit-taken hook (all 7 loops)

**Files:**
- Modify: `src/commands/rpg/ascend.ts`, `boss.ts`, `field-boss.ts`, `dungeon.ts`, `duel.ts`, `raid.ts`, `src/lib/encounter.ts`

This is the largest task — Rilo needs the full Basic/Skill/Ultimate/swap dispatch pattern (same shape Kaelith and Vesper both needed), **plus** the brand-new hit-taken hook every one of her constellations past C2 depends on. Use `ascend.ts` as the reference implementation, verify it fully, then mechanically apply the same transform to the other 6 (matching each file's own established Kaelith/Vesper-dispatch variable-naming conventions — `activeAtk`/`effectiveOppDef` in duel.ts, `current.` prefixes in raid.ts, `ws.` prefixes in dungeon.ts — not a blind copy-paste).

- [ ] **Step 1: Import line**

```typescript
import {
  RiloMechanicState, RiloSkillResult, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC,
  RILO_SHIELD_GAIN_PER_BASIC, riloMaxShield, riloUltimateBaseMult, riloUltimateShieldFromDamage, riloOnHitTaken,
} from "../../lib/kits/riloKit";
```

- [ ] **Step 2: Button branch** (mirrors Vesper's, labels swapped)

```typescript
} else if (team?.isDevGuild && team.activeUnit === "ally" && team.activeAllyCharacterId === "rilo") {
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("battle_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("battle_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("battle_ultimate").setLabel("🛡️  Avalanche Slam")
      .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
    new ButtonBuilder().setCustomId("battle_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
  ));
```

Note: Rilo's Ultimate button is gated on Concerto Energy like Kaelith's (not personal Energy like Vesper's) — she has no Vesper-style personal Energy resource; her spendable resource is Shield, which is not what gates the Ultimate button (matching Kaelith's precedent where the stack gauge and the Ultimate-gating resource are two different things).

- [ ] **Step 3: Basic Attack — dual-fill Shield + Forte**

```typescript
if (isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "rilo") {
  const rState = allyMechanicState as RiloMechanicState;
  const maxShield = riloMaxShield(allyConstellation);
  allyMechanicState = { ...rState, shield: Math.min(maxShield, rState.shield + RILO_SHIELD_GAIN_PER_BASIC + (isCrit ? Math.floor(RILO_SHIELD_GAIN_PER_BASIC * (allyConstellation >= 1 ? 0.5 : 0)) : 0)) };
  moveName += `\n🛡️ +${RILO_SHIELD_GAIN_PER_BASIC} Shield (${(allyMechanicState as RiloMechanicState).shield}/${maxShield})`;
}
```

(`isCrit` here refers to whichever crit-roll variable this Basic-Attack branch already computed earlier in the same block — confirm the exact local name per file, matching the same care Vesper's plan flagged for cross-file variable names.)

Forte-fill `else if` branch, same shape as Vesper's:

```typescript
} else if (isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "rilo") {
  const forteBefore = solaceForte;
  solaceForte = addForteCharge(solaceForte, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
  if (isForteMaxed(solaceForte, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
    moveName += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
  }
}
```

- [ ] **Step 4: Skill (Guard Break) branch**

```typescript
} else if (btn.customId === "battle_skill" && isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "rilo" && allyKit) {
  const rState = allyMechanicState as RiloMechanicState;
  const crit = true; // Guard Break is always a guaranteed crit, per spec — no roll needed
  const forteEmpowered = isForteMaxed(solaceForte, RILO_FORTE_CONFIG);
  const result = allyKit.onSkill(
    { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: rState, forteEmpowered } as any,
    { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
    allyConstellation,
  ) as RiloSkillResult;
  allyMechanicState = result.newMechanicState;
  if (forteEmpowered) solaceForte = resetForte();

  const base = Math.max(1, Math.floor(activeAtk * result.damageMult * (1 - defReduction)));
  const dmg  = Math.floor(base * activeCritDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
  playerDmg  = dmg;
  moveName   = `🛡️ ${result.moveLabel} — ${playerDmg} DMG **(CRIT)** (consumed ${result.shieldConsumed} Shield)`;
  if (result.defShredApplied) moveName += `\n❄️ Enemy DEF shredded 10% for 2 turns!`;
  state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * result.vibFrac * totalVibMult));
}
```

- [ ] **Step 5: Ultimate (Avalanche Slam) branch, with C6's double-hit reuse of Vesper's `hitBadge` display**

```typescript
} else if (btn.customId === "battle_ultimate" && isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "rilo" && allyKit) {
  const rState = allyMechanicState as RiloMechanicState;
  const result = allyKit.onUltimate(
    { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: rState },
    { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
    allyConstellation,
  );
  const maxShield = riloMaxShield(allyConstellation);
  const c6DoubleHit = allyConstellation >= 6 && rState.shield >= maxShield;
  const hits = c6DoubleHit ? 2 : 1;

  const perHitBase = Math.max(1, Math.floor(activeAtk * (riloUltimateBaseMult(allyUltimateLevel) / hits) * (1 - defReduction)));
  const perHitDmg  = Math.floor(perHitBase * activeCritDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
  const totalDmg   = perHitDmg * hits;

  // C4's damage-to-Shield conversion needs the actual damage dealt, computed
  // above — apply it on top of onUltimate's own base refund (which riloKit.ts
  // already folded into result.newMechanicState.shield).
  const c4Bonus = riloUltimateShieldFromDamage(totalDmg, allyConstellation);
  const finalMechanicState = {
    ...(result.newMechanicState as RiloMechanicState),
    shield: Math.min(maxShield, (result.newMechanicState as RiloMechanicState).shield + c4Bonus),
  };
  allyMechanicState = finalMechanicState;

  if (hits > 1) {
    const hitLines = Array.from({ length: hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
    playerDmg = totalDmg;
    moveName  = `🛡️ ${result.moveLabel}\n${hitLines}\n**Total: ${playerDmg} DMG**`;
    state.hitBadge = hits;
  } else {
    playerDmg = totalDmg;
    moveName  = `🛡️ ${result.moveLabel} — ${playerDmg} DMG`;
    state.hitBadge = undefined;
  }
  state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));

  if (result.healResult.actions.length > 0) {
    const healResult = resolveIntroOutroEffect(result.healResult, { hp: state.playerHp, hpMax: state.playerHpMax });
    // C4's cleanse targets Rilo herself (she's the active unit), not the bench — apply directly.
    playerDebuffs = cleanseDebuffs(playerDebuffs, 1);
  }
}
```

**Caveat**: `state.hitBadge` reuse means Rilo's Ultimate and Vesper's Skill are the only two call sites that ever set it — the existing `state.hitBadge = undefined;` reset at the top of each turn handler (already added for Vesper) covers Rilo automatically, no extra reset needed.

- [ ] **Step 6: Outro/Intro Shield side-channels in the swap block**

```typescript
if (!outgoingIsPlayer && outroEffect.newMechanicState && activeAllyCharacterId === "rilo") {
  const rOutgoing = allyMechanicState as RiloMechanicState; // Rilo's OWN state before she left, still readable here
  const transferFrac = (outroEffect.newMechanicState as any).grantShieldTransferOnOutro as number;
  const transferAmount = Math.floor(rOutgoing.shield * transferFrac);
  // Apply as a temporary damage-absorb buff on the incoming unit. This
  // codebase has no generic "shield buff on the player" primitive yet — the
  // simplest integration is folding it into a flat HP-equivalent bonus via
  // resolveIntroOutroEffect's existing shieldDelta path (same mechanism
  // Kaelith/Solace's Outro/Intro HP-ish bonuses already use), NOT a new
  // damage-reduction system. Confirm this against `introOutro.ts`'s actual
  // `shieldDelta` handling before wiring — if shieldDelta already clamps to
  // maxHp like a heal (as it does for Kaelith today), transferAmount should
  // be treated the same way here for consistency, even though thematically
  // it's "Shield" not "healing."
  if ((outroEffect.newMechanicState as any).grantDefBuffOnOutro) {
    // C1's temporary DEF buff on the incoming unit — no existing generic
    // "buff the other unit's DEF for N turns" primitive either; this needs
    // either a new lightweight side-channel (mirroring enemyDefShredTurnsLeft
    // but for the player/ally's OWN def instead of the enemy's) or reuse of
    // an existing buff-duration variable if one already fits. Flagged as a
    // real implementation decision, not resolved by this plan — the spec's
    // mechanic is fixed, the exact plumbing is not.
  }
}
if (outgoingIsPlayer && introEffect.newMechanicState && activeAllyCharacterId === "rilo") {
  const grant = (introEffect.newMechanicState as any).grantShieldOnIntro as number | undefined;
  if (grant) {
    const rIncoming = allyMechanicState as RiloMechanicState;
    allyMechanicState = { ...rIncoming, shield: Math.min(riloMaxShield(allyConstellation), rIncoming.shield + grant) };
  }
}
```

- [ ] **Step 7: The new hit-taken hook — wherever the boss's turn currently applies damage to the active unit**

This is the one genuinely new cross-cutting integration point. Find where each loop currently computes and applies the enemy's damage to `state.playerHp` (or the equivalent per-loop field):

```bash
grep -n "state.playerHp = Math.max(0, state.playerHp -\|bossDmg\b" src/commands/rpg/ascend.ts
```

Immediately before that damage is actually subtracted, if the active unit is Rilo, call the new hook and use its adjusted damage number instead of the raw one:

```typescript
let finalBossDmg = bossDmg;
if (isDevGuild && activeUnit === "ally" && activeAllyCharacterId === "rilo") {
  const rState = allyMechanicState as RiloMechanicState;
  const hitResult = riloOnHitTaken(rState, bossDmg, state.playerHp, state.playerHpMax, allyConstellation);
  allyMechanicState = hitResult.newMechanicState;
  finalBossDmg = hitResult.actualDamageTaken;
  if (hitResult.forteGain > 0) solaceForte = addForteCharge(solaceForte, RILO_FORTE_CONFIG, hitResult.forteGain);
  if (hitResult.blockedByC3) state.lastMove = (state.lastMove ?? "") + `\n🛡️ **Guard Break Save!** Rilo's Shield fully absorbed a lethal blow!`;
  if (hitResult.zeroShieldSaveTriggered) state.lastMove = (state.lastMove ?? "") + `\n❄️ **Unbreakable Guard** — Shield surges back from nothing!`;
}
state.playerHp = Math.max(0, state.playerHp - finalBossDmg);
```

**Important caveats for whoever implements this**:
1. This hook must fire only when Rilo is the unit actually *taking* the hit — in duel.ts/raid.ts, confirm which side's HP field is being reduced at that call site (each side's own `activeUnit`/`activeAllyCharacterId`), not just "any Rilo present in the fight."
2. `bossDmg` (or its per-loop equivalent name — `enemyDmg`, `dmg`, etc.) must be fully computed (all existing modifiers — DEF, elemental resistance, named-set effects — already applied) BEFORE this hook runs, since the hook operates on the final incoming number, not a raw base value.
3. Each of the 7 files computes the enemy's damage under a different local variable name and at a different point in its turn-resolution flow — locate the exact line via the grep above in each file individually, don't assume it's in the same relative position as `ascend.ts`.
4. `duel.ts` and `raid.ts` don't have a single `state.playerHp` — confirm the correct per-side (`state.cHp`/`state.dHp`) or per-participant (`current.hp`) field before wiring, same caution Vesper's Task 6 flagged for those two files' different state shape.

- [ ] **Step 8: Typecheck each file after editing it, then build the whole repo**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/ascend.ts src/commands/rpg/boss.ts src/commands/rpg/field-boss.ts src/commands/rpg/dungeon.ts src/commands/rpg/duel.ts src/commands/rpg/raid.ts src/lib/encounter.ts
git commit -m "feat(rilo): dispatch Basic/Skill/Ultimate/swap + new hit-taken hook across all 7 combat loops"
```

---

### Task 7: Final full-repo verification and deploy

- [ ] **Step 1: Full typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: zero errors.

- [ ] **Step 2: Grep sweep for any remaining placeholder/TODO markers**

```bash
grep -rn "TODO\|FIXME\|placeholder" src/lib/kits/riloKit.ts src/commands/rpg/character.ts
```
Expected: no results (or only pre-existing, unrelated ones).

- [ ] **Step 3: Announce and hand off to finishing-a-development-branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."
**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — push to `main`, SSH-deploy (`git pull && npm run build && pm2 restart cartethyia`), remembering `npx prisma generate` on the VM after the schema change. Rilo's art (`assets/Characters/Rilo.png`, icon variant) has not been provided yet — do not attempt to scp files that don't exist; flag this to the user as outstanding, matching how Umbral/Voltaic Shard icons were flagged before being drawn.

---

## Self-review notes (completed during plan writing)

- **Spec coverage**: Guard/Shield gauge (build via Basic, consume via Skill) ✓ (Task 1/2/6), Guard Break guaranteed crit + Shield-scaled damage ✓ (Task 2/6), Avalanche Slam flat damage + post-cast Shield refund ✓ (Task 2/6), Forte-empowered Braced Guard Break refund ✓ (Task 2/6), Intro Shield grant / Outro Shield transfer + DEF buff ✓ (Task 2/6), all 6 reworked constellations ✓ (Task 2's formulas + Task 6's dispatch), C6's double-hit reusing Vesper's display infra ✓ (Task 6 Step 5), Glacial Shards ascension material from Permafrost Sovereign ✓ (Task 4), `/character` generic-dispatch entries ✓ (Task 5), tankiest-in-roster stat profile (highest HP+DEF, ATK/Crit at-or-above both 4★s) ✓ (Task 1).
- **Known open items flagged inline, not silently resolved**: Task 6 Step 6's Outro DEF-buff plumbing (no existing "buff the ally's own DEF for N turns" primitive confirmed to exist — left as an explicit implementation-time decision, not asserted as solved), Task 6 Step 6's Shield-transfer-as-a-buff mechanism (whether `shieldDelta` clamps like a heal needs confirming against `introOutro.ts`'s real behavior), Task 6 Step 7's hit-taken hook integration point varying by file (flagged per-file grep, not assumed identical across all 7).
- **Explicitly out of scope**, matching the spec: exact icon art for Glacial Shards and Rilo's character portrait/icon (both flagged the same silent-no-op way prior currencies/characters were before their assets arrived), standard-banner pool inclusion / launch timing (this plan doesn't touch `STANDARD_CHARACTER_POOL` in `wish.ts` at all — matching Kaelith and Vesper's current gated status, even though Rilo is nominally "standard pool" by design, her actual launch is still a separate business decision), whether Shield should ever passively reduce incoming damage in addition to being spendable (explicit scope note carried over from the spec, untouched here).
