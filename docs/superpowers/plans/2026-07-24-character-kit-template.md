# Playable Character Kit Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `PlayableCharacterKit` interface and a `solaceKit.ts` wrapper around Solace's existing systems, verified in isolation to behave identically to her current logic — with zero changes to any live combat file. Combat-loop dispatch rewiring is deferred to Kaelith's own implementation plan (see the design spec's "Phasing" section for why).

**Architecture:** A new interface (`src/lib/characterKit.ts`) defines the shared shape every character's kit implements. `src/lib/kits/solaceKit.ts` wraps Solace's existing `solace.ts`/`attunement.ts`/`wellspring.ts` functions to satisfy that interface, extracting her Skill/Ultimate's Attunement-mode-cycle and Convergence-heal logic (currently inline in all 7 combat loops) into `onSkill`/`onUltimate` callbacks — written and unit-verified now, but not yet called from any combat loop.

**Tech Stack:** TypeScript, no test framework in this repo — verification is a standalone `scripts/verify-solace-kit.ts` script (matching the project's existing `scripts/test-*.ts` convention) plus `npx tsc --noEmit`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/characterKit.ts` | New. `PlayableCharacterKit` interface, `CharacterCombatContext`/`SkillEffectResult`/`UltimateEffectResult` types, empty `CHARACTER_KITS` registry |
| `src/lib/kits/solaceKit.ts` | New. Solace's kit object implementing the interface — wraps existing `solace.ts` functions, adds `onSkill`/`onUltimate` extracted from `ascend.ts`'s inline logic |
| `src/lib/kits/index.ts` | New. Registers `solaceKit` into `CHARACTER_KITS` — the one place a new character gets added to the registry going forward |
| `scripts/verify-solace-kit.ts` | New, one-off verification script — deleted at the end of this plan once confirmed passing |

No existing files are modified in this plan — that's the whole point of the deferred-rewiring scope.

---

## Task 1: `characterKit.ts` interface

**Files:**
- Create: `src/lib/characterKit.ts`

- [ ] **Step 1: Write the interface file**

```typescript
// src/lib/characterKit.ts
// Shared shape every playable-ally character's kit module implements. Plumbing
// only — what a character's Basic/Skill/Ultimate/Intro/Outro/Constellations
// actually DO stays entirely bespoke inside each kit's own onSkill/onUltimate/
// introEffect/outroEffect functions. See design spec
// docs/superpowers/specs/2026-07-24-playable-character-kit-template-design.md.
//
// Combat-loop dispatch through this registry is NOT wired up yet (deferred to
// the next character's implementation, per the spec's "Phasing" section) —
// this file plus kits/solaceKit.ts exist and are verified in isolation first.

import { ResolvedStats } from "./setBonus";
import { IntroOutroEffect, AllyAction } from "./introOutro";
import { ForteConfig } from "./forte";

// Generic combat-state bag — NOT Attunement-specific. A character that
// doesn't need some of these fields simply ignores them.
export interface CharacterCombatContext {
  playerHp: number; playerHpMax: number;
  allyHp: number; allyHpMax: number;
  turn: number;
  isShattered: boolean;
  mechanicState: unknown; // opaque per-character state — combat loop never inspects this
}

export interface SkillEffectResult {
  damageMult: number;      // multiplier on the acting unit's ATK for this hit
  vibFrac: number;         // vib-bar damage fraction
  moveLabel: string;       // display text
  newMechanicState: unknown;
  bonusConcertoEnergy?: number;
}

export interface UltimateEffectResult {
  healResult: { actions: AllyAction[] }; // fed through resolveIntroOutroEffect, same as today
  moveLabel: string;
  newMechanicState: unknown;
  resetsConcertoEnergy: boolean;
}

export interface PlayableCharacterKit {
  id:            string;
  label:         string;
  emoji:         string;
  element:       string;
  portraitPath:  string;

  statsAtLevel(level: number): { hpMax: number; baseAtk: number; baseDef: number; baseSpeed: number; critRate: number; critDmg: number };
  resolveStats(userId: string): Promise<ResolvedStats & { hasSignatureWeapon: boolean; signatureWeaponRefinement: number }>;

  ascensionLevelCap: number[];
  ascensionCost(currentPhase: number): { credits: number; forgingOres: number; paradoxCores: number; starfallShards: number };
  levelUpCost(currentLevel: number): { resonanceRecords: number; credits: number };

  basicDamageMult(basicLevel: number): number;
  introEffect(introLevel: number, constellation: number): IntroOutroEffect;
  outroEffect(constellation: number): IntroOutroEffect;

  forteConfig: ForteConfig;
  forteGainPerBasic: number;

  createInitialMechanicState(): unknown;
  onSkill(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): SkillEffectResult;
  onUltimate(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): UltimateEffectResult;

  constellationEffects: string[]; // exactly 6 entries
  maxConstellation: number;
}

export const CHARACTER_KITS: Record<string, PlayableCharacterKit> = {};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — this file has no consumers yet, so it can only fail on its own internal type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/characterKit.ts
git commit -m "feat(character-kit): add PlayableCharacterKit interface and registry"
```

---

## Task 2: `solaceKit.ts` wrapper

**Files:**
- Create: `src/lib/kits/solaceKit.ts`

- [ ] **Step 1: Read the exact current Attunement/Convergence logic being extracted**

The source of truth for what `onSkill`/`onUltimate` must reproduce is `src/commands/rpg/ascend.ts`'s two Solace-specific branches (confirmed identical in shape across all 7 combat loops per tonight's constellation work):

```typescript
// Skill branch (ascend.ts, "battle_skill" && isDevGuild && activeUnit === "ally"):
attunement.mode = cycleAttunementMode(attunement.mode);
if (solaceConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
const crit = Math.random() < activeCritRate; abilCrit = crit;
const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
playerDmg  = dmg;
moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));

// Ultimate branch (ascend.ts, "battle_ultimate" && isDevGuild && activeUnit === "ally"):
const healPct = solaceConvergenceHealPct(solaceUltimateLevel, solaceConstellation);
const healResult = resolveIntroOutroEffect({ actions: [
  { type: "HEAL_ALLY", value: healPct },
  { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(solaceConstellation) },
] }, { hp: state.playerHp, hpMax: state.playerHpMax });
// ... (ally-side heal, HP application, and the isForteMaxed empowered-vs-normal branch)
```

Note: the damage-multiplier extraction (`0.6` for Skill) and the `crit`/`abilCrit` roll are Solace-specific enough to belong in `onSkill`'s returned `damageMult` — but the actual crit-roll and final damage arithmetic (which needs `activeCritRate`/`defReduction`/`isWeak`/`bonuses.elemDmgBonus` — all combat-loop-local context not part of "Solace's kit") stays in the combat loop, unchanged, for now. `onSkill` only needs to return `damageMult: 0.6` and the mode-cycle/concerto-burst side effects — the combat loop keeps doing its own crit roll and damage math exactly as today, since this plan does not touch that call site yet.

- [ ] **Step 2: Write the kit file**

```typescript
// src/lib/kits/solaceKit.ts
// Solace's PlayableCharacterKit — wraps her existing solace.ts/attunement.ts
// functions. This does NOT change her live behavior: it's a parallel,
// verified-equivalent surface that combat loops will call through once
// Kaelith's implementation wires up real dispatch (see the template design
// spec's Phasing section). Until then, nothing calls this file except
// scripts/verify-solace-kit.ts.

import { PlayableCharacterKit, CharacterCombatContext, SkillEffectResult, UltimateEffectResult } from "../characterKit";
import {
  solaceStatsAtLevel, resolveSolaceStats, solaceAscensionCost, solaceLevelUpCost,
  ASCENSION_LEVEL_CAP, solaceBasicDamageMult, solaceIntroEffect, solaceOutroEffect,
  solaceConvergenceHealPct, solaceConvergenceCleanseCount,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC,
} from "../solace";
import { AttunementState, cycleAttunementMode } from "../attunement";
import { addConcertoEnergy } from "../concertoEnergy";
import { CONSTELLATION_EFFECTS_SOLACE } from "./solaceConstellationText";

interface SolaceMechanicState {
  attunement: AttunementState;
  concertoEnergy: number;
}

export const solaceKit: PlayableCharacterKit = {
  id: "solace",
  label: "Solace",
  emoji: "✨",
  element: "SPECTRO",
  portraitPath: "assets/Characters/Solace.png",

  statsAtLevel: solaceStatsAtLevel,
  resolveStats: async (userId: string) => {
    const stats = await resolveSolaceStats(userId);
    return { ...stats, hasSignatureWeapon: stats.hasWellspring, signatureWeaponRefinement: stats.wellspringRefinement };
  },

  ascensionLevelCap: ASCENSION_LEVEL_CAP,
  ascensionCost: solaceAscensionCost,
  levelUpCost: solaceLevelUpCost,

  basicDamageMult: solaceBasicDamageMult,
  introEffect: solaceIntroEffect,
  outroEffect: solaceOutroEffect,

  forteConfig: SOLACE_FORTE_CONFIG,
  forteGainPerBasic: SOLACE_FORTE_GAIN_PER_BASIC,

  createInitialMechanicState: (): SolaceMechanicState => ({ attunement: { mode: null }, concertoEnergy: 0 }),

  onSkill(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): SkillEffectResult {
    const state = ctx.mechanicState as SolaceMechanicState;
    const newMode = cycleAttunementMode(state.attunement.mode);
    const bonusConcertoEnergy = constellation >= 3 ? 25 : 0;
    return {
      damageMult: 0.6,
      vibFrac: 0.3,
      moveLabel: `✦ Attunement — now in **${newMode}** mode!`,
      newMechanicState: { attunement: { mode: newMode }, concertoEnergy: state.concertoEnergy },
      bonusConcertoEnergy,
    };
  },

  onUltimate(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): UltimateEffectResult {
    const state = ctx.mechanicState as SolaceMechanicState;
    const healPct = solaceConvergenceHealPct(kitLevels.ultimateLevel, constellation);
    return {
      healResult: {
        actions: [
          { type: "HEAL_ALLY", value: healPct },
          { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(constellation) },
        ],
      },
      moveLabel: `⚡ **Convergence!** Team healed, debuffs cleansed.`,
      newMechanicState: { attunement: state.attunement, concertoEnergy: 0 },
      resetsConcertoEnergy: true,
    };
  },

  constellationEffects: CONSTELLATION_EFFECTS_SOLACE,
  maxConstellation: 6,
};
```

- [ ] **Step 3: Move the existing constellation flavor text into its own file**

`CONSTELLATION_EFFECTS["solace"]` currently lives in `src/commands/rpg/character.ts`'s `CONSTELLATION_EFFECTS` map. Create `src/lib/kits/solaceConstellationText.ts`:

```typescript
// src/lib/kits/solaceConstellationText.ts
// Solace's 6 constellation flavor-text descriptions, moved here so
// solaceKit.ts can expose them via the PlayableCharacterKit interface
// without importing from a command file. character.ts's existing
// CONSTELLATION_EFFECTS["solace"] entry is untouched — this is a copy for
// the new kit object to reference, not a replacement (character.ts's map
// stays the source of truth used by the live /character command until
// Kaelith's build actually migrates character.ts to read from
// CHARACTER_KITS instead of CONSTELLATION_EFFECTS).
export const CONSTELLATION_EFFECTS_SOLACE: string[] = [
  "Outro's guaranteed-crit buff also grants the incoming ally +15% ATK for their first action after the swap.",
  "**(Kit change)** Ultimate's heal significantly increased; cleanses 2 debuffs instead of 1.",
  "Switching Attunement Mode (Skill) also grants a team-wide Concerto Energy burst.",
  "**(Kit change)** Intro Skill's heal also grants a shield equal to 30% of the amount healed.",
  "Ultimate's doubled-mode-effect duration extends from 3 turns to 4.",
  "**(Defining)** While one Attunement Mode is active, allies ALSO gain 50% of the other two modes' effects.",
];
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `resolveSolaceStats`'s return type doesn't structurally match what `resolveStats`'s wrapper produces, fix the wrapper's return object to match — do not change `solace.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kits/solaceKit.ts src/lib/kits/solaceConstellationText.ts
git commit -m "feat(character-kit): add solaceKit.ts wrapping Solace's existing systems"
```

---

## Task 3: Register `solaceKit` in `CHARACTER_KITS`

**Files:**
- Create: `src/lib/kits/index.ts`
- Modify: none (this is the registration point, but `CHARACTER_KITS` itself lives in `characterKit.ts` and is empty until this file populates it — nothing outside `src/lib/kits/` imports this yet, so there's nothing else to update)

- [ ] **Step 1: Write the registration file**

```typescript
// src/lib/kits/index.ts
// Registers every playable character's kit. Importing this file (which
// nothing does yet — combat-loop dispatch is deferred to Kaelith's build)
// populates CHARACTER_KITS as a side effect.
import { CHARACTER_KITS } from "../characterKit";
import { solaceKit } from "./solaceKit";

CHARACTER_KITS[solaceKit.id] = solaceKit;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/kits/index.ts
git commit -m "feat(character-kit): register solaceKit in CHARACTER_KITS"
```

---

## Task 4: Verify `solaceKit` matches Solace's current live behavior

**Files:**
- Create: `scripts/verify-solace-kit.ts` (deleted at the end of this task)

- [ ] **Step 1: Write the verification script**

```typescript
// scripts/verify-solace-kit.ts
// One-off: confirms solaceKit's wrapped functions produce output matching
// what the current inline combat-loop logic would produce for the same
// inputs. Deleted once confirmed — this is not a permanent test file
// (project has no test framework; see other scripts/test-*.ts for the
// established one-off-verification convention).
import "../src/lib/kits/index"; // populates CHARACTER_KITS as a side effect
import { CHARACTER_KITS } from "../src/lib/characterKit";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${label}`);
  }
}

async function main() {
  const kit = CHARACTER_KITS["solace"];
  if (!kit) { console.error("FAIL: solace not registered in CHARACTER_KITS"); process.exit(1); }

  // onSkill: mode cycles null -> ATK, no C3 burst below constellation 3
  const skillResult = kit.onSkill(
    { playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: kit.createInitialMechanicState() },
    {}, /* constellation */ 0,
  );
  assertEqual(skillResult.damageMult, 0.6, "onSkill damageMult matches the 0.6x used in ascend.ts");
  assertEqual(skillResult.vibFrac, 0.3, "onSkill vibFrac matches ascend.ts's 0.3");
  assertEqual(skillResult.bonusConcertoEnergy, 0, "onSkill grants no C3 burst below constellation 3");
  assertEqual((skillResult.newMechanicState as any).attunement.mode, "ATK", "onSkill cycles null -> ATK, matching cycleAttunementMode(null)");

  // onSkill at constellation 3+: grants the +25 burst
  const skillResultC3 = kit.onSkill(
    { playerHp: 100, playerHpMax: 100, allyHp: 100, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: kit.createInitialMechanicState() },
    {}, 3,
  );
  assertEqual(skillResultC3.bonusConcertoEnergy, 25, "onSkill grants +25 Concerto Energy at constellation >= 3");

  // onUltimate: heal % and cleanse count match solaceConvergenceHealPct/solaceConvergenceCleanseCount
  const ultResult = kit.onUltimate(
    { playerHp: 50, playerHpMax: 100, allyHp: 50, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: kit.createInitialMechanicState() },
    { ultimateLevel: 1 }, 0,
  );
  assertEqual(ultResult.healResult.actions[0].value, 0.30, "onUltimate heal% matches solaceConvergenceHealPct(1, 0) == 0.30");
  assertEqual(ultResult.healResult.actions[1].value, 1, "onUltimate cleanse count is 1 below constellation 2");
  assertEqual(ultResult.resetsConcertoEnergy, true, "onUltimate always resets Concerto Energy");

  const ultResultC2 = kit.onUltimate(
    { playerHp: 50, playerHpMax: 100, allyHp: 50, allyHpMax: 100, turn: 1, isShattered: false, mechanicState: kit.createInitialMechanicState() },
    { ultimateLevel: 1 }, 2,
  );
  assertEqual(ultResultC2.healResult.actions[0].value, 0.45, "onUltimate heal% at constellation >= 2 matches solaceConvergenceHealPct(1, 2) == 0.30 + 0.15");
  assertEqual(ultResultC2.healResult.actions[1].value, 2, "onUltimate cleanse count is 2 at constellation >= 2");

  console.log(process.exitCode === 1 ? "\nSome checks FAILED." : "\nAll checks passed.");
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-solace-kit.ts`
Expected: `PASS` on every line, ending with `All checks passed.`

- [ ] **Step 3: If any check fails, fix `solaceKit.ts` (never the test) until all pass**

The test encodes ascend.ts's actual current values (0.6 damageMult, 0.3 vibFrac, 25 Concerto Energy burst, `solaceConvergenceHealPct`/`solaceConvergenceCleanseCount`'s real output) — if a mismatch shows up, the kit wrapper has a bug relative to live behavior, not the other way around.

- [ ] **Step 4: Delete the verification script**

```bash
rm scripts/verify-solace-kit.ts
```

- [ ] **Step 5: Final typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add -A -- scripts/verify-solace-kit.ts
git commit -m "chore: remove one-off solaceKit verification script (all checks passed)"
```
