# Milestone 2a — Solace's Core Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Milestone 1's placeholder Training Dummy with a real Solace, implementing her core combat kit — Basic Attack, Skill (Attunement Mode cycling), Ultimate (Convergence), Intro, Outro — proving the Attunement Mode mechanic (a persistent, switchable team buff) actually works in the now-proven `/encounter` engine. Still dev-guild-gated, still `/encounter` only.

**Architecture:** One new isolated primitive (`src/lib/attunement.ts`, mirroring `debuffs.ts`'s shape — a small typed state + pure functions, unit-tested the same way Milestone 0's modules were) plus one new kit-data file (`src/lib/solace.ts`, replacing `src/lib/placeholderAlly.ts`). `src/lib/encounter.ts` gets Solace's real button row (Basic/Skill/Ultimate/Flee, no Echo Skill — she has no echoes equipped in this test context) instead of the dummy's Swap-only row.

**Explicitly deferred to their own follow-up plans, not built here:**
- **Forte** (in-combat gauge + out-of-combat kit-leveling) — her Ultimate here is the *base* version only ("doubles the current Attunement mode's effect for 3 turns"); the Forte-triggered "Empowered Ultimate → all 3 modes at once" upgrade needs the Forte gauge to exist first.
- **Wellspring** (signature weapon, conditional passive) — needs the base kit proven first; also needs a new "does the wielder have an Attunement Mode" conditional-passive capability that doesn't exist in the weapon engine yet.
- **Constellations** — dupe-based permanent upgrades don't make sense before there's a gacha/ownership system (Milestone 4) to get duplicates from.

**Tech Stack:** TypeScript, discord.js, Milestone 0's primitives (`allyActions.ts`, `introOutro.ts`) plus this milestone's new `attunement.ts`. No schema changes — same in-memory per-fight state pattern as Milestones 0-1.

---

### Task 1: Attunement Mode Primitive

**Files:**
- Create: `src/lib/attunement.ts`
- Test: `scripts/test-attunement.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// scripts/test-attunement.ts
// Usage: npx tsx scripts/test-attunement.ts
import assert from "assert";
import {
  cycleAttunementMode, getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
  AttunementState,
} from "../src/lib/attunement";

// cycleAttunementMode rotates ATK -> CRIT -> DEF -> ATK
assert.strictEqual(cycleAttunementMode(null), "ATK", "starts at ATK from no mode");
assert.strictEqual(cycleAttunementMode("ATK"), "CRIT");
assert.strictEqual(cycleAttunementMode("CRIT"), "DEF");
assert.strictEqual(cycleAttunementMode("DEF"), "ATK");

// Only the active mode's getter returns a bonus; the other two stay neutral
let state: AttunementState = { mode: "ATK" };
assert.strictEqual(getAttunementAtkMult(state), 1.15);
assert.strictEqual(getAttunementCritRateBonus(state), 0);
assert.strictEqual(getAttunementDefMult(state), 1);

state = { mode: "CRIT" };
assert.strictEqual(getAttunementAtkMult(state), 1);
assert.strictEqual(getAttunementCritRateBonus(state), 0.15);
assert.strictEqual(getAttunementDefMult(state), 1);

state = { mode: "DEF" };
assert.strictEqual(getAttunementAtkMult(state), 1);
assert.strictEqual(getAttunementCritRateBonus(state), 0);
assert.strictEqual(getAttunementDefMult(state), 1.2);

// No mode active (null) = fully neutral
state = { mode: null };
assert.strictEqual(getAttunementAtkMult(state), 1);
assert.strictEqual(getAttunementCritRateBonus(state), 0);
assert.strictEqual(getAttunementDefMult(state), 1);

// doubled=true (Ultimate's effect) doubles the ACTIVE mode's bonus above the
// baseline 1.0/0 — i.e. the bonus portion doubles, not the whole multiplier
state = { mode: "ATK" };
assert.strictEqual(getAttunementAtkMult(state, true), 1.30, "doubled ATK bonus: +15% -> +30%");
assert.strictEqual(getAttunementCritRateBonus(state, true), 0, "inactive mode stays 0 even when doubled=true");

state = { mode: "CRIT" };
assert.strictEqual(getAttunementCritRateBonus(state, true), 0.30, "doubled CRIT bonus: +15% -> +30%");

state = { mode: "DEF" };
assert.strictEqual(getAttunementDefMult(state, true), 1.40, "doubled DEF bonus: +20% -> +40%");

console.log("✓ all Attunement primitive tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-attunement.ts`
Expected: FAIL — `Cannot find module '../src/lib/attunement'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/attunement.ts
// Solace's core mechanic (design spec §6) — a persistent, switchable team buff,
// cycled via her Skill. Unlike Milestone 0's debuffs (which decay over turns) or
// ally-actions (one-shot heal/shield/buff/cleanse), Attunement is standing state
// that modifies damage/crit/DEF calculations every turn while active — closer in
// shape to Milestone 1's own debuff-multiplier getters (getWeakenedMult, etc.)
// than to a one-shot action.

export type AttunementMode = "ATK" | "CRIT" | "DEF";

export interface AttunementState {
  mode: AttunementMode | null;
}

const ATTUNEMENT_ATK_BONUS  = 0.15; // +15% ATK while in ATK mode
const ATTUNEMENT_CRIT_BONUS = 0.15; // +15% Crit Rate while in CRIT mode
const ATTUNEMENT_DEF_BONUS  = 0.20; // +20% DEF while in DEF mode

// Cycles ATK -> CRIT -> DEF -> ATK. No-mode (null) starts at ATK.
export function cycleAttunementMode(current: AttunementMode | null): AttunementMode {
  if (current === "ATK")  return "CRIT";
  if (current === "CRIT") return "DEF";
  return "ATK"; // covers both `null` (first activation) and "DEF" (wrap around)
}

// `doubled` is Solace's Ultimate ("Convergence") temporarily doubling whichever
// mode is currently active — it doubles the BONUS portion (the amount above the
// neutral 1.0/0 baseline), not the whole multiplier.
export function getAttunementAtkMult(state: AttunementState, doubled = false): number {
  if (state.mode !== "ATK") return 1;
  return 1 + ATTUNEMENT_ATK_BONUS * (doubled ? 2 : 1);
}

export function getAttunementCritRateBonus(state: AttunementState, doubled = false): number {
  if (state.mode !== "CRIT") return 0;
  return ATTUNEMENT_CRIT_BONUS * (doubled ? 2 : 1);
}

export function getAttunementDefMult(state: AttunementState, doubled = false): number {
  if (state.mode !== "DEF") return 1;
  return 1 + ATTUNEMENT_DEF_BONUS * (doubled ? 2 : 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-attunement.ts`
Expected: `✓ all Attunement primitive tests passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/attunement.ts scripts/test-attunement.ts
git commit -m "feat(teams): add Attunement Mode primitive (Milestone 2a)"
```

---

### Task 2: Solace's Kit Data (replaces the placeholder ally)

**Files:**
- Create: `src/lib/solace.ts`
- Delete: `src/lib/placeholderAlly.ts` (its own header comment says to do this once a real character exists)

- [ ] **Step 1: Write `src/lib/solace.ts`**

```typescript
// src/lib/solace.ts
// The first real banner character — see design spec §6 for the full kit
// rationale. Replaces src/lib/placeholderAlly.ts, which was always meant to be
// thrown away once a real character existed.
//
// Forte, Wellspring, and Constellations are NOT part of this file — they're
// separate follow-up milestones (2b/2c/2d). Her Ultimate here is the base
// version only (doubles the current Attunement mode for 3 turns); the
// Forte-triggered "Empowered Ultimate -> all 3 modes at once" upgrade requires
// the Forte gauge to exist first.

import { IntroOutroEffect } from "./introOutro";

export const SOLACE = {
  name:  "Solace",
  hpMax: 1100,

  // Intro Skill: instant heal + cleanse, zero ramp-up (design spec §6).
  intro: {
    actions: [
      { type: "HEAL_ALLY",    value: 0.20 },
      { type: "CLEANSE_ALLY", value: 1 },
    ],
  } as IntroOutroEffect,

  // Outro Skill: shields the incoming ally. The "guarantees their next attack
  // crits" half of her Outro (per spec) has no AllyAction primitive for it yet
  // (HEAL/SHIELD/BUFF_ATK/CLEANSE don't cover "arm a guaranteed crit") — Task 3
  // wires that part directly in encounter.ts by reusing the existing
  // nextAttackCritArmed variable already in that file (from the Echo Skill
  // system), rather than inventing a new primitive for a single one-off use.
  outro: {
    actions: [
      { type: "SHIELD_ALLY", value: 0.15 },
    ],
  } as IntroOutroEffect,
};

// Ultimate's doubled-Attunement-effect duration (design spec §6: "3 turns").
export const SOLACE_ULTIMATE_DOUBLE_TURNS = 3;

// The player's own personalized character still gets the universal, generic
// Intro/Outro pair from design spec §2 — unrelated to which banner character
// is in the other slot. These lived in the now-deleted placeholderAlly.ts;
// they move here rather than getting a separate file of their own.
export const PLAYER_SELF_INTRO: IntroOutroEffect = { actions: [{ type: "HEAL_ALLY", value: 0.05 }] };
export const PLAYER_SELF_OUTRO: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.05 }] };
```

- [ ] **Step 2: Delete the placeholder file**

```bash
rm src/lib/placeholderAlly.ts
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAILS at this step — `src/lib/encounter.ts` still imports from the now-deleted `placeholderAlly.ts`. This is expected; Task 3 fixes it. Do not attempt to fix `encounter.ts` in this task — that's Task 3's job, keep this task's diff to just the two files above.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/solace.ts src/lib/placeholderAlly.ts
git commit -m "feat(teams): add Solace kit data, remove placeholder ally (Milestone 2a)"
```

(The commit will show `src/lib/placeholderAlly.ts` as deleted and `src/lib/solace.ts` as added. `npx tsc --noEmit` failing at this point is expected and fine — Task 3 fixes the broken import immediately next.)

---

### Task 3: Wire Solace's Basic/Skill/Intro/Outro into `/encounter`

**Context:** This is the biggest task — it touches every place `PLACEHOLDER_ALLY` was referenced, gives Solace a real button row (Basic/Skill/Ultimate/Flee) instead of the dummy's Swap-only row when she's active, and wires the Attunement primitive into the player's own damage/crit/DEF calculations (since only one unit acts per turn, "the player's damage" and "Solace's damage" share the same calculation code path — Attunement affects whichever unit is currently attacking).

**Files:**
- Modify: `src/lib/encounter.ts`

- [ ] **Step 1: Update imports**

Find:

```typescript
import { PLACEHOLDER_ALLY, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO } from "./placeholderAlly";
import { resolveIntroOutroEffect } from "./introOutro";
```

Replace with:

```typescript
import { SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO } from "./solace";
import { resolveIntroOutroEffect } from "./introOutro";
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "./attunement";
```

(`PLAYER_SELF_INTRO`/`PLAYER_SELF_OUTRO` now live in `src/lib/solace.ts`, per Task 2 — they moved out of the deleted `placeholderAlly.ts` rather than getting a separate file.)

- [ ] **Step 2: Add Attunement state alongside the existing 2-unit state**

Find:

```typescript
  // ── Milestone 1: two-unit team state (dev guild only) ────────────────────────
  let activeUnit: "player" | "ally" = "player";
  let allyHp    = PLACEHOLDER_ALLY.hpMax;
  const allyHpMax = PLACEHOLDER_ALLY.hpMax;
  let concertoEnergy: number = 0;
  let playerDebuffs: DebuffState = [];
```

Replace with:

```typescript
  // ── Milestone 1/2a: two-unit team state (dev guild only) ─────────────────────
  let activeUnit: "player" | "ally" = "player";
  let allyHp    = SOLACE.hpMax;
  const allyHpMax = SOLACE.hpMax;
  let concertoEnergy: number = 0;
  let playerDebuffs: DebuffState = [];
  let attunement: AttunementState = { mode: null };
  let attunementDoubleTurnsLeft = 0; // set by Solace's Ultimate; see Task 4
```

- [ ] **Step 3: Give Solace a real button row instead of Swap-only**

Find:

```typescript
    // Milestone 1: when the benched teammate is active, it has no real kit yet —
    // the only available action is to swap back to your own character. This
    // avoids needing a fake AI-driven ally turn, which is out of scope here.
    if (isDevGuild && activeUnit === "ally") {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      ));
    } else {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill")
          .setLabel(state.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(state.skillCooldown > 0),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("⚡  Ultimate")
          .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
      );
      if (bonuses.echoSkill) {
        const echoReady = echoSkillCooldown === 0;
        row.addComponents(
          new ButtonBuilder().setCustomId("enc_echoskill")
            .setLabel(echoReady ? `🌀  ${bonuses.echoSkill.name}` : `🌀  ${bonuses.echoSkill.name} (${echoSkillCooldown}🔄)`)
            .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
        );
      }
      row.addComponents(
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    }

    if (isDevGuild) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_swap")
          .setLabel(activeUnit === "player" ? `🔄  Swap to ${PLACEHOLDER_ALLY.name}` : `🔄  Swap to ${displayName}`)
          .setStyle(ButtonStyle.Secondary),
      ));
    }

    return rows;
  }
```

Replace with:

```typescript
    // Milestone 2a: Solace has a real kit now, so BOTH activeUnit states get a
    // full Basic/Skill/Ultimate/Flee row — the player's row keeps its Echo
    // Skill button (from her own equipped echo), Solace's row never has one
    // (she has no echoes equipped in this test context). Skill/Ultimate labels
    // differ because Solace's Skill is Attunement (no cooldown, always
    // available — it's a mode switch, not a charge-gated move) and her
    // Ultimate spends Concerto Energy rather than personal Energy.
    if (isDevGuild && activeUnit === "ally") {
      const modeLabel = attunement.mode ? `(${attunement.mode})` : "(inactive)";
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("⚡  Convergence")
          .setStyle(ButtonStyle.Success).setDisabled(concertoEnergy < 100),
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    } else {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill")
          .setLabel(state.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(state.skillCooldown > 0),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("⚡  Ultimate")
          .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
      );
      if (bonuses.echoSkill) {
        const echoReady = echoSkillCooldown === 0;
        row.addComponents(
          new ButtonBuilder().setCustomId("enc_echoskill")
            .setLabel(echoReady ? `🌀  ${bonuses.echoSkill.name}` : `🌀  ${bonuses.echoSkill.name} (${echoSkillCooldown}🔄)`)
            .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
        );
      }
      row.addComponents(
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    }

    if (isDevGuild) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_swap")
          .setLabel(activeUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${displayName}`)
          .setStyle(ButtonStyle.Secondary),
      ));
    }

    return rows;
  }
```

- [ ] **Step 4: Update remaining `PLACEHOLDER_ALLY` references**

Run: `grep -n "PLACEHOLDER_ALLY" src/lib/encounter.ts`

Every remaining match needs `PLACEHOLDER_ALLY` replaced with `SOLACE` (same field names — `.name`, `.hpMax`, `.intro`, `.outro` — this is a mechanical find-and-replace, not a structural change). Expected remaining locations: the swap branch (outro/intro effect selection), the `teamStatusLine()` function, and the ally-KO auto-swap-back message. Replace each occurrence, then run `grep -n "PLACEHOLDER_ALLY" src/lib/encounter.ts` again to confirm zero matches remain.

- [ ] **Step 5: Wire Attunement mode-switching into the Skill button, only for Solace**

Find:

```typescript
      if (btn.customId === "enc_skill") {
        const r  = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, forcedCritActive ? 1 : Math.min(1, cRate + 0.1), stats.critDmg, 1.8, isWeak, state.isShattered);
        let base = Math.floor(r.damage * (1 + stats.elemDmgBonus));
        base     = Math.floor(base * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
        // Ignite is a separate proc effect, not part of the base attack roll —
        // intentionally NOT scoped by WEAKENED, unlike the calcPlayerDamage call above.
        const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "SKILL"; vibFrac = 0.6;
        moveName  = `Resonance Skill — ${playerDmg} DMG${r.isCrit ? " **(CRIT)**" : ""}`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.skillCooldown = effectiveSkillCooldown(bonuses, SKILL_COOLDOWN);
        state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));
      }
```

Replace with:

```typescript
      if (btn.customId === "enc_skill" && isDevGuild && activeUnit === "ally") {
        // Solace's Skill is Attunement — a mode cycle, not a damage move. No
        // cooldown (always available), no personal Energy interaction. Deals a
        // small hit so it's not purely administrative, using her own baseline
        // (reuses the player's ATK/DEF context since Solace has no stat block
        // of her own yet in this test milestone, same simplification the
        // placeholder ally used).
        attunement.mode = cycleAttunementMode(attunement.mode);
        const r  = calcPlayerDamage(stats.atk, defVal, cRate, stats.critDmg, 0.6, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus)); isCrit = r.isCrit;
        moveType = "SKILL"; vibFrac = 0.3;
        moveName = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${r.isCrit ? " **(CRIT)**" : ""}`;
      } else if (btn.customId === "enc_skill") {
        const r  = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, forcedCritActive ? 1 : Math.min(1, cRate + 0.1), stats.critDmg, 1.8, isWeak, state.isShattered);
        let base = Math.floor(r.damage * (1 + stats.elemDmgBonus));
        base     = Math.floor(base * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
        // Ignite is a separate proc effect, not part of the base attack roll —
        // intentionally NOT scoped by WEAKENED, unlike the calcPlayerDamage call above.
        const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "SKILL"; vibFrac = 0.6;
        moveName  = `Resonance Skill — ${playerDmg} DMG${r.isCrit ? " **(CRIT)**" : ""}`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.skillCooldown = effectiveSkillCooldown(bonuses, SKILL_COOLDOWN);
        state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));
      }
```

- [ ] **Step 6: Apply Attunement's buffs to the player's own damage/crit — the team-wide part of the mechanic**

Since only one unit acts per turn and Attunement is a TEAM buff (design spec §6: "team-wide moderate % buff"), it must affect the PLAYER's attacks too, not just Solace's — this is the actual point of the mechanic (you activate a mode on Solace's turn, then it boosts your own attacks on your next turn). Find the three player-damage `calcPlayerDamage` calls (Basic/Ultimate — Skill was already handled uniquely in Step 5 above) and apply the Attunement ATK multiplier:

Find:

```typescript
      if (btn.customId === "enc_basic") {
        const r  = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, forcedCritActive ? 1 : cRate, stats.critDmg, 1.0, isWeak, state.isShattered);
```

Replace with:

```typescript
      if (btn.customId === "enc_basic") {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement) : 1);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement) : 0)), stats.critDmg, 1.0, isWeak, state.isShattered);
```

Find:

```typescript
      if (btn.customId === "enc_ultimate") {
        const r = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

Replace with:

```typescript
      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement) : 1);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

**Do not touch the `elemIgniteProc` calls** that follow Basic/Skill — same reasoning as the WEAKENED scoping from Milestone 1 (Ignite is a separate proc, not part of the base attack roll).

Apply the DEF-mode bonus to incoming damage — find:

```typescript
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def, move.damage);
```

Replace with:

```typescript
        const attunementDefMult = isDevGuild ? getAttunementDefMult(attunement, attunementDoubleTurnsLeft > 0) : 1;
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
```

- [ ] **Step 7: Wire Solace's Outro's crit-arm (the part with no AllyAction primitive)**

Find the swap branch's Outro resolution (added in Milestone 1, Task 3):

```typescript
          const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
          const introEffect = outgoingIsPlayer ? SOLACE.intro : PLAYER_SELF_INTRO;
          const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
          const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);
```

(Note: this exact text only matches AFTER Step 4's find-and-replace already changed `PLACEHOLDER_ALLY` to `SOLACE` here — do Step 4 before this step if you haven't already.)

Immediately after that block (still inside the `if (comboReady)` branch, before `const totalBonus = ...`), insert:

```typescript
          // Solace's Outro also arms a guaranteed crit for whoever swaps in —
          // no AllyAction primitive covers this, so it reuses the existing
          // nextAttackCritArmed variable (already wired for the Echo Skill
          // system elsewhere in this file) rather than inventing a new one.
          if (!outgoingIsPlayer) nextAttackCritArmed = true;
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): wire Solace's Basic/Skill/Intro/Outro into /encounter (Milestone 2a)"
```

---

### Task 4: Solace's Ultimate (Convergence)

**Files:**
- Modify: `src/lib/encounter.ts`

- [ ] **Step 1: Add the Convergence branch**

Find (this is the Ultimate branch you just modified in Task 3 Step 6 — find the version WITH the `!(isDevGuild && activeUnit === "ally")` guard already added):

```typescript
      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement) : 1);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus)); isCrit = true;
        moveType = "ULT"; vibFrac = 0.8;
        moveName  = `⚡ ULTIMATE — ${playerDmg} DMG`;
        state.playerEnergy = 0;
      }
```

Replace with:

```typescript
      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement) : 1);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus)); isCrit = true;
        moveType = "ULT"; vibFrac = 0.8;
        moveName  = `⚡ ULTIMATE — ${playerDmg} DMG`;
        state.playerEnergy = 0;
      } else if (btn.customId === "enc_ultimate" && isDevGuild && activeUnit === "ally") {
        // Solace's Ultimate spends Concerto Energy, not personal Energy — team
        // heal + cleanse + doubles the current Attunement mode's effect for
        // 3 turns (base version; the Forte-triggered "all 3 modes at once"
        // upgrade is a later milestone once Forte exists).
        const target: AllyActionTarget = { hp: state.playerHp, hpMax: state.playerHpMax };
        const healResult = resolveIntroOutroEffect({ actions: [
          { type: "HEAL_ALLY", value: 0.30 },
          { type: "CLEANSE_ALLY", value: 1 },
        ] }, target);
        const before = state.playerHp;
        state.playerHp = Math.min(state.playerHpMax, state.playerHp + healResult.hpDelta);
        const actualHeal = state.playerHp - before;
        playerDebuffs = cleanseDebuffs(playerDebuffs, healResult.cleanseCount);

        attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS;
        concertoEnergy = 0;

        playerDmg = 0; isCrit = false; moveType = "ULT"; vibFrac = 0;
        moveName = `⚡ **Convergence!** Team healed +${actualHeal} HP, debuffs cleansed, ` +
          `**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
      }
```

- [ ] **Step 2: Decrement `attunementDoubleTurnsLeft` alongside the other per-turn cooldowns**

Find:

```typescript
      state.turn++;
      if (state.skillCooldown > 0) state.skillCooldown--;
      if (echoSkillCooldown > 0) echoSkillCooldown--;
      if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
      if (forcedCritActive) nextAttackCritArmed = false;
```

Replace with:

```typescript
      state.turn++;
      if (state.skillCooldown > 0) state.skillCooldown--;
      if (echoSkillCooldown > 0) echoSkillCooldown--;
      if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
      if (isDevGuild && attunementDoubleTurnsLeft > 0) attunementDoubleTurnsLeft--;
      if (forcedCritActive) nextAttackCritArmed = false;
```

- [ ] **Step 3: Add the `cleanseDebuffs` import (not needed until this task)**

Find:

```typescript
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult } from "./debuffs";
```

Replace with:

```typescript
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult, cleanseDebuffs } from "./debuffs";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): wire Solace's Ultimate (Convergence) (Milestone 2a)"
```

---

### Task 5: Verification

Same shape as Milestone 1's Task 5 — automated checks I can run, plus a manual checklist that needs your hands in Discord.

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
npx tsx scripts/test-attunement.ts
grep -n "PLACEHOLDER_ALLY" src/lib/encounter.ts   # expect ZERO matches
grep -n "isDevGuild" src/lib/encounter.ts          # re-audit every new branch is still gated
```

- [ ] **Step 2: Manual — deploy and playtest**

```bash
npm run deploy   # only needed if this milestone added a new slash command, which it didn't — a restart is enough
```
then on the VM: `git pull && npm run build && pm2 restart cartethyia`

In the dev guild, fight an encounter and verify:
- [ ] Swapping to Solace shows her real button row (Chime Strike / Attunement / Convergence / Flee), not just Swap+Flee
- [ ] Pressing Attunement cycles ATK → CRIT → DEF → ATK, shown in the button label and the battle text
- [ ] Swap back to your own character and confirm your next attack reflects whichever mode was active (ATK mode: higher damage than an unweakened baseline; CRIT mode: more crits than usual; DEF mode: less incoming damage from the enemy's next hit)
- [ ] Convergence (Solace's Ultimate) is disabled until Concerto Energy hits 100, and using it heals/cleanses and shows the doubled-mode message
- [ ] After Convergence, the next couple of turns show a noticeably bigger version of whichever mode was active (the doubled bonus)
- [ ] Solace's Outro (triggered on a full-energy swap away from her) arms a guaranteed crit on your next hit after swapping back
- [ ] Non-dev-guild `/encounter` is still completely unaffected (spot-check in another server)

- [ ] **Step 3: Report findings back**

Same as before — if something's off, tell me exactly what you saw and I'll fix it directly rather than re-planning from scratch.
