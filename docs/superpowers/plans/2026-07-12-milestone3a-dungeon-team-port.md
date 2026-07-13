# Milestone 3a — Team Mechanics in /dungeon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the fully-built `/encounter` team-combat system (swap, Solace's kit, Wellspring, Forte, kit-leveling) into `/dungeon`. Dev-guild-gated, matching every prior milestone's staging discipline.

**Architecture:** `src/commands/rpg/dungeon.ts` is structurally different from `src/lib/encounter.ts` in two important ways every task below must account for:
1. **Damage math is a raw inline formula per move**, not a shared `calcPlayerDamage()` helper — Attunement/Wellspring/Forte bonuses fold in as additional multiplicative terms in each move's existing formula, not as arguments to a shared function.
2. **Turn handling recreates a new message + collector every turn** via a recursive `runTurn()` function (`collector.on("collect")` → send new message → `runTurn()` again), not one long-lived collector like `encounter.ts`. The swap handler and any new customId branches slot into this same recursive structure.

Cross-wave state already has a proven precedent in this file: `playerHp`/`playerEnergy`/`skillCooldown`/Named-Set state/etc. are initialized once per run (`dungeon.ts`, in the `while(true)` loop before the wave `for` loop), threaded into `runWave()` via the `WaveState` parameter, and copied field-by-field out of the returned `WaveResult` back into loop-local variables after each wave. Team state (`activeUnit`, `allyHp`, `concertoEnergy`, `playerDebuffs`, `attunement`, `solaceForte`, `forteEmpoweredTurnsLeft`, `attunementDoubleTurnsLeft`) uses this exact same mechanism.

See the [design spec](../specs/2026-07-12-milestone3a-dungeon-team-port-design.md) for full rationale.

**Tech Stack:** TypeScript. Reuses every function already built for `/encounter` — `solace.ts`, `attunement.ts`, `wellspring.ts`, `forte.ts`, `characterProgress.ts` — with zero changes to any of those files. Only `src/commands/rpg/dungeon.ts` is modified.

---

### Task 1: Dev-Guild Gate + Cross-Wave Team State

**Files:**
- Modify: `src/commands/rpg/dungeon.ts`

- [ ] **Step 1: Add imports**

Find (near the top of the file, after the existing `import { incrementWeaponBond } from "../../lib/weaponAwakening";` line):
```typescript
import { incrementWeaponBond } from "../../lib/weaponAwakening";
```

Replace with:
```typescript
import { incrementWeaponBond } from "../../lib/weaponAwakening";
import {
  SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  solaceIntroEffect, solaceBasicDamageMult, solaceAttunementAtkCritBonus,
  solaceAttunementDefBonus, solaceConvergenceHealPct,
} from "../../lib/solace";
import { resolveIntroOutroEffect, IntroOutroEffect } from "../../lib/introOutro";
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "../../lib/attunement";
import {
  WELLSPRING_BASE_ATK_MULT, WELLSPRING_BASE_ENERGY_BONUS,
  getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus,
} from "../../lib/wellspring";
import { ForteState, addForteCharge, isForteMaxed, resetForte } from "../../lib/forte";
import { AllyActionTarget } from "../../lib/allyActions";
import { addConcertoEnergy } from "../../lib/concertoEnergy";
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult, cleanseDebuffs } from "../../lib/debuffs";
import { getOrCreateCharacterProgress } from "../../lib/characterProgress";
```

- [ ] **Step 2: Add the dev-guild gate + fetch Solace's progress in `runDungeon`**

Find (the start of the `runDungeon` function):
```typescript
async function runDungeon(
  interaction: ChatInputCommandInteraction,
  dungeon:     DungeonDefinition,
  dbUser:      DungeonUser,
```

Read a few more lines after this signature to find the function body's first statement (likely `const displayName = ...`). Insert immediately after the opening `{` of the function body, before any other logic:

```typescript
  const isDevGuild = interaction.guildId === process.env.GUILD_ID;
  const solaceProgress = isDevGuild ? await getOrCreateCharacterProgress(interaction.user.id, "solace") : null;
  const solaceBasicLevel    = solaceProgress?.basicLevel    ?? 1;
  const solaceSkillLevel    = solaceProgress?.skillLevel    ?? 1;
  const solaceUltimateLevel = solaceProgress?.ultimateLevel ?? 1;
  const solaceIntroLevel    = solaceProgress?.introLevel    ?? 1;
  const solaceForteLevel    = solaceProgress?.forteLevel    ?? 1;
```

(Fetched once per dungeon RUN, not per wave — matches `/encounter`'s "levels don't change mid-fight" reasoning. If the exact function body's first line differs from what's described, insert this block as the very first statements inside `runDungeon`, before the thread is created — `interaction.user.id`/`interaction.guildId` are available from the function's parameters immediately.)

- [ ] **Step 3: Add team state alongside the existing per-run state block**

Find:
```typescript
    // Track player HP across waves (shared)
    let playerHp    = stats.hp;
    const playerHpMax = stats.hp;
    let playerEnergy = 0;
    let skillCooldown = 0;
    let firstActionDone = false;
    let firstSkillUsed  = false;
    let v2Stacks        = 0;
    const namedState = initNamedSetState();
    let glacioShieldTurnsLeft = 0;
    let glacioShieldElemBonus = 0;
    let stormBuffTurnsLeft    = 0;
    let stormBuffCritBonus    = 0;
    let havocFrenzyAtkMult    = 1.0;
    let havocFrenzyLifesteal  = 0;
    let havocFrenzyDefIgnore  = 0;
    let quickStrikeUsed       = false; // SPD-driven bonus action — once per dungeon run, not per wave
    let echoSkillCooldown      = 0;
    let enemyDefShredTurnsLeft = 0;
    let enemyDefShredPct       = 0;
    let nextAttackCritArmed    = false;
    let survivedAll            = true;
```

Replace with:
```typescript
    // Track player HP across waves (shared)
    let playerHp    = stats.hp;
    const playerHpMax = stats.hp;
    let playerEnergy = 0;
    let skillCooldown = 0;
    let firstActionDone = false;
    let firstSkillUsed  = false;
    let v2Stacks        = 0;
    const namedState = initNamedSetState();
    let glacioShieldTurnsLeft = 0;
    let glacioShieldElemBonus = 0;
    let stormBuffTurnsLeft    = 0;
    let stormBuffCritBonus    = 0;
    let havocFrenzyAtkMult    = 1.0;
    let havocFrenzyLifesteal  = 0;
    let havocFrenzyDefIgnore  = 0;
    let quickStrikeUsed       = false; // SPD-driven bonus action — once per dungeon run, not per wave
    let echoSkillCooldown      = 0;
    let enemyDefShredTurnsLeft = 0;
    let enemyDefShredPct       = 0;
    let nextAttackCritArmed    = false;
    let survivedAll            = true;

    // ── Milestone 3a: team state (dev guild only), carried across waves the
    // same way playerHp/skillCooldown/etc. already are above. ────────────────
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

- [ ] **Step 4: Thread team state into each `runWave()` call and carry results back out**

Find:
```typescript
    for (let waveIdx = 0; waveIdx < dungeon.waves.length; waveIdx++) {
      const result = await runWave(
        thread, interaction.user.id, dungeon, waveIdx, currentDbUser, stats, bonuses,
        {
          playerHp, playerHpMax, playerEnergy, skillCooldown, firstActionDone, firstSkillUsed, v2Stacks,
          namedState, glacioShieldTurnsLeft, glacioShieldElemBonus, stormBuffTurnsLeft, stormBuffCritBonus,
          havocFrenzyAtkMult, havocFrenzyLifesteal, havocFrenzyDefIgnore, quickStrikeUsed,
          echoSkillCooldown, enemyDefShredTurnsLeft, enemyDefShredPct, nextAttackCritArmed,
        },
        displayName,
      );
```

Replace with:
```typescript
    for (let waveIdx = 0; waveIdx < dungeon.waves.length; waveIdx++) {
      const result = await runWave(
        thread, interaction.user.id, dungeon, waveIdx, currentDbUser, stats, bonuses,
        {
          playerHp, playerHpMax, playerEnergy, skillCooldown, firstActionDone, firstSkillUsed, v2Stacks,
          namedState, glacioShieldTurnsLeft, glacioShieldElemBonus, stormBuffTurnsLeft, stormBuffCritBonus,
          havocFrenzyAtkMult, havocFrenzyLifesteal, havocFrenzyDefIgnore, quickStrikeUsed,
          echoSkillCooldown, enemyDefShredTurnsLeft, enemyDefShredPct, nextAttackCritArmed,
          isDevGuild, activeUnit, allyHp, allyHpMax, concertoEnergy, playerDebuffs, attunement,
          attunementDoubleTurnsLeft, solaceForte, forteEmpoweredTurnsLeft,
          solaceBasicLevel, solaceSkillLevel, solaceUltimateLevel, solaceIntroLevel, solaceForteLevel,
          displayName,
        },
        displayName,
      );
```

(`isDevGuild` and the 5 `solace*Level` constants are passed in as read-only context even though they don't change per wave — simplest to thread them through the same object rather than adding 6 more separate function parameters. `displayName` is included in the state object too since the swap/Convergence messages need it inside `runWave`, in addition to the existing separate `displayName` parameter already passed to `runWave` — having it in both places is slightly redundant but harmless; do NOT remove the existing separate parameter, since other code in `runWave` may already use it that way.)

Find:
```typescript
      // Carry HP/energy between waves
      playerHp       = result.playerHp;
      playerEnergy   = result.playerEnergy;
      skillCooldown  = Math.max(0, result.skillCooldown - 1);
      firstActionDone = result.firstActionDone;
      firstSkillUsed  = result.firstSkillUsed;
      v2Stacks        = result.v2Stacks;
      glacioShieldTurnsLeft = result.glacioShieldTurnsLeft;
      glacioShieldElemBonus = result.glacioShieldElemBonus;
      stormBuffTurnsLeft    = result.stormBuffTurnsLeft;
      stormBuffCritBonus    = result.stormBuffCritBonus;
      havocFrenzyAtkMult    = result.havocFrenzyAtkMult;
      havocFrenzyLifesteal  = result.havocFrenzyLifesteal;
      havocFrenzyDefIgnore  = result.havocFrenzyDefIgnore;
      quickStrikeUsed       = result.quickStrikeUsed;
      echoSkillCooldown       = result.echoSkillCooldown;
```

Read a few more lines after this to find where this block of assignments ends (there may be 1-2 more fields copied after `echoSkillCooldown`, e.g. `enemyDefShredTurnsLeft`/`enemyDefShredPct`/`nextAttackCritArmed` — copy the exact remaining lines you find, then add the team-state carry-over immediately after the LAST existing assignment in this block):

```typescript
      // Milestone 3a: carry team state between waves too, same mechanism.
      // attunementDoubleTurnsLeft/forteEmpoweredTurnsLeft get the same
      // between-wave decrement skillCooldown already gets above — a wave
      // transition is treated as consuming a turn-equivalent for any
      // cooldown-shaped state, per design spec §2.
      activeUnit    = result.activeUnit;
      allyHp        = result.allyHp;
      concertoEnergy = result.concertoEnergy;
      playerDebuffs = result.playerDebuffs;
      attunement    = result.attunement;
      attunementDoubleTurnsLeft = Math.max(0, result.attunementDoubleTurnsLeft - 1);
      solaceForte   = result.solaceForte;
      forteEmpoweredTurnsLeft = Math.max(0, result.forteEmpoweredTurnsLeft - 1);
```

- [ ] **Step 5: Add the new fields to the `WaveState`/`WaveResult` interfaces**

Find:
```typescript
interface WaveState {
  playerHp:        number;
  playerHpMax:     number;
  playerEnergy:    number;
  skillCooldown:   number;
  firstActionDone: boolean;
  firstSkillUsed:  boolean;
  v2Stacks:        number;
  namedState:            NamedSetState;
  glacioShieldTurnsLeft: number;
  glacioShieldElemBonus: number;
  stormBuffTurnsLeft:    number;
  stormBuffCritBonus:    number;
  havocFrenzyAtkMult:    number;
  havocFrenzyLifesteal:  number;
  havocFrenzyDefIgnore:  number;
  quickStrikeUsed:       boolean;
  echoSkillCooldown:     number;
  enemyDefShredTurnsLeft: number;
  enemyDefShredPct:       number;
  nextAttackCritArmed:    boolean;
}

interface WaveResult extends WaveState {
  survived: boolean;
}
```

Replace with:
```typescript
interface WaveState {
  playerHp:        number;
  playerHpMax:     number;
  playerEnergy:    number;
  skillCooldown:   number;
  firstActionDone: boolean;
  firstSkillUsed:  boolean;
  v2Stacks:        number;
  namedState:            NamedSetState;
  glacioShieldTurnsLeft: number;
  glacioShieldElemBonus: number;
  stormBuffTurnsLeft:    number;
  stormBuffCritBonus:    number;
  havocFrenzyAtkMult:    number;
  havocFrenzyLifesteal:  number;
  havocFrenzyDefIgnore:  number;
  quickStrikeUsed:       boolean;
  echoSkillCooldown:     number;
  enemyDefShredTurnsLeft: number;
  enemyDefShredPct:       number;
  nextAttackCritArmed:    boolean;
  // ── Milestone 3a: team state ──────────────────────────────────────────
  isDevGuild: boolean;
  activeUnit: "player" | "ally";
  allyHp: number;
  allyHpMax: number;
  concertoEnergy: number;
  playerDebuffs: DebuffState;
  attunement: AttunementState;
  attunementDoubleTurnsLeft: number;
  solaceForte: ForteState;
  forteEmpoweredTurnsLeft: number;
  solaceBasicLevel: number;
  solaceSkillLevel: number;
  solaceUltimateLevel: number;
  solaceIntroLevel: number;
  solaceForteLevel: number;
  displayName: string;
}

interface WaveResult extends WaveState {
  survived: boolean;
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAILS — `runWave`'s function body destructures/reads `ws.playerHp` etc. from the parameter, but doesn't yet reference any of the new fields, AND the `resolve({ ...ws, survived: ... })` calls (which spread the whole `ws` object into `WaveResult`) should actually already satisfy the new interface fields automatically, since they spread all of `ws`. The only REAL error expected here is if `runWave`'s parameter type annotation needs updating — check if the 8th parameter (the big object literal) has an explicit type annotation matching the OLD `WaveState` shape; if TypeScript infers it structurally there may be no error at all yet. If `npx tsc --noEmit` is already clean, that's fine — proceed to commit. If it's not clean, confirm the errors are about missing fields on the passed-in object (expected, since Task 1 doesn't yet populate the new team-state values into every place `ws` gets destructured) and are NOT about anything else; if anything looks unexpected, report BLOCKED.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/dungeon.ts
git commit -m "feat(teams): add dev-guild-gated team state to /dungeon (Milestone 3a Task 1)"
```

---

### Task 2: Multi-Row Buttons + Solace's Real Row

**Files:**
- Modify: `src/commands/rpg/dungeon.ts`

- [ ] **Step 1: Convert `buildButtons()` to return an array of rows, with Solace's row when she's active**

Find:
```typescript
  function buildButtons(): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("dg_skill")
        .setLabel(ws.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${ws.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(ws.skillCooldown > 0),
      new ButtonBuilder().setCustomId("dg_ultimate")
        .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(ws.playerEnergy < 100),
    );
    if (bonuses.echoSkill) {
      const echoReady = ws.echoSkillCooldown === 0;
      row.addComponents(
        new ButtonBuilder().setCustomId("dg_echoskill")
          .setLabel(echoReady ? `🌀  ${bonuses.echoSkill.name}` : `🌀  ${bonuses.echoSkill.name} (${ws.echoSkillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
    );
    return row;
  }
```

Replace with:
```typescript
  function buildButtons(): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    if (ws.isDevGuild && ws.activeUnit === "ally") {
      const modeLabel = ws.attunement.mode ? `(${ws.attunement.mode})` : "(inactive)";
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dg_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dg_ultimate").setLabel("⚡  Convergence")
          .setStyle(ButtonStyle.Success).setDisabled(ws.concertoEnergy < 100),
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      ));
    } else {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dg_skill")
          .setLabel(ws.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${ws.skillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(ws.skillCooldown > 0),
        new ButtonBuilder().setCustomId("dg_ultimate")
          .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(ws.playerEnergy < 100),
      );
      if (bonuses.echoSkill) {
        const echoReady = ws.echoSkillCooldown === 0;
        row.addComponents(
          new ButtonBuilder().setCustomId("dg_echoskill")
            .setLabel(echoReady ? `🌀  ${bonuses.echoSkill.name}` : `🌀  ${bonuses.echoSkill.name} (${ws.echoSkillCooldown}🔄)`)
            .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
        );
      }
      row.addComponents(
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    }

    if (ws.isDevGuild) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_swap")
          .setLabel(ws.activeUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${ws.displayName}`)
          .setStyle(ButtonStyle.Secondary),
      ));
    }

    return rows;
  }
```

- [ ] **Step 2: Update every call site that uses `buildButtons()`'s old single-row return**

Run: `grep -n "buildButtons()" src/commands/rpg/dungeon.ts`

Expected matches: the initial `battleMsg = await thread.send({ embeds: [...], components: [buildButtons()] })` and the per-turn `thread.send({ embeds: [...], components: [buildButtons()] })` inside the collector's `"collect"` handler. At EACH match, change `components: [buildButtons()]` to `components: buildButtons()` (the function now returns the array itself — no wrapping array needed). Do not change anything else in these calls.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: still fails with the same class of errors as Task 1 Step 6 (missing team-state field population inside `runWave`'s turn-handling logic) — Task 3/4/5 fix those. Confirm no NEW unexpected error categories appeared from this task's changes specifically (e.g. a leftover single-row `components: [buildButtons()]` call site would now be a type error — fix any you find).

- [ ] **Step 4: Commit**

```bash
git add src/commands/rpg/dungeon.ts
git commit -m "feat(teams): multi-row buttons + Solace's real row in /dungeon (Milestone 3a Task 2)"
```

---

### Task 3: Swap Handler

**Files:**
- Modify: `src/commands/rpg/dungeon.ts`

**Context:** `/encounter`'s swap handler (Milestone 1) checks Concerto Energy, resolves Outro (outgoing unit) + Intro (incoming unit) effects if the combo is ready, arms a guaranteed crit for Solace's Outro, and reports the actual (post-clamp) HP gained. Port this logic into `runWave`'s `collector.on("collect", ...)` handler as a new `dg_swap` branch, following the exact same shape.

- [ ] **Step 1: Add the swap branch**

Find (the very start of the collector's collect handler, right after the `dg_flee` check):
```typescript
      collector.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate().catch(() => {});

        if (btn.customId === "dg_flee") {
          await battleMsg.edit({ components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
          return;
        }
```

Replace with:
```typescript
      collector.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate().catch(() => {});

        if (btn.customId === "dg_flee") {
          await battleMsg.edit({ components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
          return;
        }

        // Milestone 3a: swap — always consumes the turn, but the Outro
        // (outgoing) + Intro (incoming) combo only fires if Concerto Energy
        // is full at the moment of swap. Ported from encounter.ts's Milestone
        // 1/2a swap handler — same logic, same field names via `ws.` instead
        // of `state.`.
        if (btn.customId === "dg_swap" && ws.isDevGuild) {
          const outgoingIsPlayer = ws.activeUnit === "player";
          const comboReady = ws.concertoEnergy >= 100;
          let swapMoveLine: string;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = outgoingIsPlayer
              ? { hp: ws.allyHp, hpMax: ws.allyHpMax }
              : { hp: ws.playerHp, hpMax: ws.playerHpMax };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
            const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(ws.solaceIntroLevel) : PLAYER_SELF_INTRO;
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            if (!outgoingIsPlayer) ws.nextAttackCritArmed = true;

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;

            let actualGain: number;
            if (outgoingIsPlayer) {
              const before = ws.allyHp;
              ws.allyHp = Math.min(ws.allyHpMax, ws.allyHp + totalBonus);
              actualGain = ws.allyHp - before;
            } else {
              const before = ws.playerHp;
              ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + totalBonus);
              actualGain = ws.playerHp - before;
            }

            swapMoveLine = actualGain > 0
              ? `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : ws.displayName}** — Outro+Intro combo! +${actualGain} HP.`
              : `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : ws.displayName}** — Outro+Intro combo! (already at full HP, no heal needed)`;
            ws.concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART in encounter.ts
          } else {
            swapMoveLine = `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : ws.displayName}** — Concerto Energy not full, no combo triggered.`;
          }

          ws.activeUnit = outgoingIsPlayer ? "ally" : "player";

          try {
            const newMsg = await thread.send({
              embeds: [buildWaveEmbed(swapMoveLine)],
              components: buildButtons(),
            });
            await battleMsg.edit({ components: [] }).catch(() => {});
            battleMsg = newMsg;
            runTurn();
          } catch (err) {
            console.error("[Dungeon] wave message failed:", err);
            resolve({ ...ws, survived: false });
          }
          return;
        }
```

**Important**: `CONCERTO_INTRO_HEADSTART` is a named constant in `encounter.ts` valued at `20` — this plan inlines the literal `20` directly rather than importing a constant that lives in a different file's module scope (that constant isn't exported from `encounter.ts`). If you'd prefer a named constant here too for clarity, define a local `const DUNGEON_CONCERTO_INTRO_HEADSTART = 20;` near the top of `runWave` instead of the inline literal — either is acceptable, just be consistent.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: still shows the same pre-existing category of errors from Tasks 1-2 (fixed by Task 4/5), but no NEW errors from this specific swap branch. If this branch itself has a type error, fix it before moving on — don't leave swap-handler-specific errors for a later task.

- [ ] **Step 3: Commit**

```bash
git add src/commands/rpg/dungeon.ts
git commit -m "feat(teams): wire swap handler into /dungeon (Milestone 3a Task 3)"
```

---

### Task 4: Wire Attunement/Wellspring/Forte into Basic, Skill, Ultimate, Enemy Retaliation

**Context:** This is the core of the port — folding the same multiplicative bonus terms `/encounter` uses into `/dungeon`'s own (differently-shaped) damage formulas. `/dungeon`'s formulas compute `dmg` via a long chain of `*` multiplications rather than calling a shared `calcPlayerDamage()` function — the approach here is to multiply in one more term for each bonus, at the same point `smolderMult`/`havocAtkMult` etc. already get folded in, rather than restructuring the formula.

**Files:**
- Modify: `src/commands/rpg/dungeon.ts`

- [ ] **Step 1: Basic Attack (`dg_basic`) — Solace-only base multiplier + team-wide Attunement/Wellspring/Forte bonuses**

Find:
```typescript
        if (btn.customId === "dg_basic") {
          const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(ws.namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < cRate; abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonus = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg      = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonus) * radiantDmgMult));
```

Replace with:
```typescript
        if (btn.customId === "dg_basic") {
          const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(ws.namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          // Milestone 3a: same Attunement/Wellspring/Forte/kit-level terms as
          // /encounter's Basic Attack, folded into this move's crit-rate
          // computation and damage formula below instead of a shared
          // calcPlayerDamage() call (this file doesn't use that helper).
          const teamAtkMult  = ws.isDevGuild ? getAttunementAtkMult(ws.attunement, solaceAttunementAtkCritBonus(ws.solaceSkillLevel), ws.attunementDoubleTurnsLeft > 0) : 1;
          const teamCritBonus = ws.isDevGuild ? getAttunementCritRateBonus(ws.attunement, solaceAttunementAtkCritBonus(ws.solaceSkillLevel), ws.attunementDoubleTurnsLeft > 0) : 0;
          const wellspringAtkMult   = ws.isDevGuild && ws.activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
          const wellspringAtkBonus  = ws.isDevGuild ? getWellspringAtkBonus(ws.attunement) : 0;
          const wellspringCritBonus = ws.isDevGuild ? getWellspringCritRateBonus(ws.attunement) : 0;
          const forteAtkBonus  = ws.isDevGuild ? getSolaceForteAtkBonus(ws.solaceForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const forteCritBonus = ws.isDevGuild ? getSolaceForteCritRateBonus(ws.solaceForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          // Solace's own Basic-track level multiplier — Solace-only (this
          // handler is shared with the player's own Basic Attack), matching
          // how /encounter gates its equivalent `basicMoveMult`.
          const basicMoveMult = ws.isDevGuild && ws.activeUnit === "ally" ? solaceBasicDamageMult(ws.solaceBasicLevel) : 1.0;
          const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < Math.min(1, cRate + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonus = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg      = Math.max(1, Math.floor(stats.atk * teamMult * basicMoveMult * smolderMult * havocAtkMult * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonus) * radiantDmgMult));
```

**Do not touch anything else in the `dg_basic` block** (Forte-fill logic is added separately in Task 5).

- [ ] **Step 2: Skill (`dg_skill`) — split into Solace's Attunement branch vs. the existing player Skill logic**

Find:
```typescript
        if (btn.customId === "dg_skill") {
          const crit   = forcedCritActive || Math.random() < Math.min(1, cRate + 0.1); abilCrit = crit;
```

Replace with:
```typescript
        if (btn.customId === "dg_skill" && ws.isDevGuild && ws.activeUnit === "ally") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          // Deals a small hit using the player's own stat block (Solace has
          // no independent stat block yet — same simplification /encounter
          // uses). Ported from encounter.ts's Milestone 2a Skill branch.
          ws.attunement.mode = cycleAttunementMode(ws.attunement.mode);
          const crit = Math.random() < cRate; abilCrit = crit;
          const dmg  = Math.max(1, Math.floor(stats.atk * 0.6 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          playerDmg  = dmg;
          moveLine   = `✦ Attunement — now in **${ws.attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          vibBar     = Math.max(0, vibBar - Math.floor(playerDmg * 0.3 * totalVibMult));
        } else if (btn.customId === "dg_skill") {
          const teamAtkMult  = getAttunementAtkMult(ws.attunement, solaceAttunementAtkCritBonus(ws.solaceSkillLevel), ws.attunementDoubleTurnsLeft > 0);
          const teamCritBonus = getAttunementCritRateBonus(ws.attunement, solaceAttunementAtkCritBonus(ws.solaceSkillLevel), ws.attunementDoubleTurnsLeft > 0);
          const wellspringAtkBonus  = getWellspringAtkBonus(ws.attunement);
          const wellspringCritBonus = getWellspringCritRateBonus(ws.attunement);
          const forteAtkBonus  = getSolaceForteAtkBonus(ws.solaceForteLevel, ws.forteEmpoweredTurnsLeft > 0);
          const forteCritBonus = getSolaceForteCritRateBonus(ws.solaceForteLevel, ws.forteEmpoweredTurnsLeft > 0);
          const teamMult = teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const crit   = forcedCritActive || Math.random() < Math.min(1, cRate + 0.1 + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
```

Then find, a few lines later within the SAME (now `else if`) block:
```typescript
          let dmg      = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * 1.8 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusSkill) * radiantDmgMult));
```

Replace with:
```typescript
          let dmg      = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * 1.8 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusSkill) * radiantDmgMult));
```

**Important**: everything else inside the original `dg_skill` block (the `smolderMult`, `extraElemBonusSkill`, ability-effect application, energy/HP updates, `ws.firstSkillUsed = true`) stays exactly as it was, just now inside the `else if` branch instead of the removed `if` — do not duplicate or remove any of that logic, only the crit-rate/damage-multiplier lines shown above change, and the block's opening condition changes from `if` to `else if`. Make sure the closing `}` that used to close the single `if (btn.customId === "dg_skill")` block now correctly closes the `else if` branch (should be automatic if you only touched the two snippets above).

**Also non-dev-guild behavior must be unaffected**: if `ws.isDevGuild` is `false`, the new Attunement/Wellspring/Forte terms all safely evaluate to neutral values (`getAttunementAtkMult`/`getWellspringAtkBonus`/etc. all return neutral defaults when `attunement.mode` is `null`, which it always is when `isDevGuild` is false since nothing ever sets it) — but to be extra safe and consistent with `/encounter`'s explicit `isDevGuild ? ... : neutral` pattern at every call site, wrap each of the 6 new bonus computations in the `else if` branch with the same ternary gating shown in Step 1, rather than relying on `attunement.mode` staying `null`. Apply this same explicit gating to Step 1's Basic Attack block too if you notice it's missing anywhere (it's shown WITH gating in Step 1 above — just double-check Step 2's Skill block matches that same discipline before moving on).

- [ ] **Step 3: Ultimate (`dg_ultimate`) — team-wide Attunement/Wellspring/Forte bonuses (player's own Ultimate only; Solace's own Ultimate is Task 5)**

Find:
```typescript
        if (btn.customId === "dg_ultimate") {
          abilCrit  = true;
          const smolderMultUlt = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonusUlt = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg   = Math.max(1, Math.floor(stats.atk * smolderMultUlt * havocAtkMult * 3.5 * stats.critDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusUlt) * radiantDmgMult));
```

Replace with:
```typescript
        if (btn.customId === "dg_ultimate" && !(ws.isDevGuild && ws.activeUnit === "ally")) {
          // No base ATK boost here — Wellspring's base boost is Solace-only,
          // and this branch only ever runs for the player's own Ultimate
          // (Solace's own Ultimate/Convergence is a separate branch, Task 5).
          abilCrit  = true;
          const teamAtkMult = ws.isDevGuild ? getAttunementAtkMult(ws.attunement, solaceAttunementAtkCritBonus(ws.solaceSkillLevel), ws.attunementDoubleTurnsLeft > 0) : 1;
          const wellspringAtkBonus = ws.isDevGuild ? getWellspringAtkBonus(ws.attunement) : 0;
          const forteAtkBonus = ws.isDevGuild ? getSolaceForteAtkBonus(ws.solaceForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const smolderMultUlt = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonusUlt = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg   = Math.max(1, Math.floor(stats.atk * teamMult * smolderMultUlt * havocAtkMult * 3.5 * stats.critDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusUlt) * radiantDmgMult));
```

- [ ] **Step 4: Enemy retaliation — Attunement/Wellspring/Forte DEF bonuses**

Find:
```typescript
          const move    = ["strikes back", "retaliates", "lashes out"][Math.floor(Math.random() * 3)];
          let bossDmg   = Math.max(1, Math.floor(scaled.atk * 0.9 - stats.def * 0.4));
```

Replace with:
```typescript
          const move    = ["strikes back", "retaliates", "lashes out"][Math.floor(Math.random() * 3)];
          const wellspringDefBonus = ws.isDevGuild ? getWellspringDefBonus(ws.attunement) : 0;
          const forteDefBonus = ws.isDevGuild ? getSolaceForteDefBonus(ws.solaceForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const attunementDefBonus = solaceAttunementDefBonus(ws.solaceSkillLevel);
          const attunementDefMult = (ws.isDevGuild ? getAttunementDefMult(ws.attunement, attunementDefBonus, ws.attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus);
          let bossDmg   = Math.max(1, Math.floor(scaled.atk * 0.9 - stats.def * attunementDefMult * 0.4));
```

(This formula is subtractive, not the `calcEnemyDamage()` multiplicative-reduction shape `/encounter` uses — the DEF multiplier still folds in the same conceptual way: higher effective DEF via `attunementDefMult` increases the subtracted term, reducing `bossDmg`.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: significantly fewer errors than before — remaining errors (if any) should only be about Solace's Ultimate/Convergence branch not existing yet (Task 5) and Forte-fill/threshold-message logic not existing yet (Task 5). If you see anything else, report BLOCKED with specifics.

- [ ] **Step 6: Commit**

```bash
git add src/commands/rpg/dungeon.ts
git commit -m "feat(teams): wire Attunement/Wellspring/Forte into /dungeon Basic/Skill/Ultimate/retaliation (Milestone 3a Task 4)"
```

---

### Task 5: Solace's Ultimate (Convergence), Forte Fill, Per-Turn Decrements

**Files:**
- Modify: `src/commands/rpg/dungeon.ts`

- [ ] **Step 1: Add Solace's Ultimate (Convergence) as a new branch**

Find (the `dg_ultimate` branch, now guarded per Task 4 Step 3 — find the closing `}` of that `if` block, which should be immediately followed by the `dg_echoskill` check):
```typescript
        if (btn.customId === "dg_echoskill" && bonuses.echoSkill) {
```

Insert a new `else if` branch immediately BEFORE this line (i.e., right after the `dg_ultimate` block's closing `}` and before `if (btn.customId === "dg_echoskill" ...)`):

```typescript
        } else if (btn.customId === "dg_ultimate" && ws.isDevGuild && ws.activeUnit === "ally") {
          // Solace's Ultimate spends Concerto Energy, not personal Energy —
          // team heal (both HP pools, level-scaled %) + cleanse + doubles the
          // active Attunement mode for 3 turns (or, if Forte is maxed,
          // Empowered Convergence — all 3 modes at once). Ported from
          // encounter.ts's Milestone 2a/2c/2e Convergence branch.
          const healPct = solaceConvergenceHealPct(ws.solaceUltimateLevel);
          const healResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
            { type: "CLEANSE_ALLY", value: 1 },
          ] }, { hp: ws.playerHp, hpMax: ws.playerHpMax });
          const allyHealResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
          ] }, { hp: ws.allyHp, hpMax: ws.allyHpMax });

          const beforePlayer = ws.playerHp;
          ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + healResult.hpDelta);
          const actualHealPlayer = ws.playerHp - beforePlayer;

          const beforeAlly = ws.allyHp;
          ws.allyHp = Math.min(ws.allyHpMax, ws.allyHp + allyHealResult.hpDelta);
          const actualHealAlly = ws.allyHp - beforeAlly;

          ws.playerDebuffs = cleanseDebuffs(ws.playerDebuffs, healResult.cleanseCount);

          ws.concertoEnergy = 0;
          playerDmg = 0; abilCrit = false;

          const healSummary = `${ws.displayName} +${actualHealPlayer} HP, ${SOLACE.name} +${actualHealAlly} HP`;

          if (isForteMaxed(ws.solaceForte, SOLACE_FORTE_CONFIG)) {
            ws.forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS;
            ws.attunementDoubleTurnsLeft = 0;
            ws.solaceForte = resetForte();
            moveLine = `⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**all 3 Attunement Modes empowered for ${SOLACE_FORTE_EMPOWERED_TURNS} turns!**`;
          } else {
            ws.attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS;
            ws.forteEmpoweredTurnsLeft = 0;
            moveLine = `⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**${ws.attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
          }
```

The `dg_ultimate` block from Task 4 Step 3 must now end with `}` followed immediately by ` else if (btn.customId === "dg_ultimate" && ws.isDevGuild && ws.activeUnit === "ally") { ... }` as shown, and THAT block's closing `}` is followed by the existing `if (btn.customId === "dg_echoskill" && bonuses.echoSkill) {` line, unchanged.

- [ ] **Step 2: Forte fill from Chime Strike, with threshold-crossing messages**

Find the end of the `dg_basic` block (after Task 4 Step 1's edits — find where `ws.playerHp = applyLifesteal(...)` is, near the end of the `dg_basic` if-block, followed by its closing `}`):
```typescript
          if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(ws.namedState, ws.playerEnergy);
        }
```

Replace with:
```typescript
          if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(ws.namedState, ws.playerEnergy);

          // Forte fills only from Solace's own Chime Strike — announce only
          // on the turn a threshold is actually crossed, matching
          // encounter.ts's Milestone 2c Forte-fill logic.
          if (ws.isDevGuild && ws.activeUnit === "ally") {
            const forteBefore = ws.solaceForte;
            ws.solaceForte = addForteCharge(ws.solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
            const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
            const isHalf  = ws.solaceForte.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(ws.solaceForte, SOLACE_FORTE_CONFIG);
            if (isForteMaxed(ws.solaceForte, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
            } else if (isHalf && !wasHalf) {
              moveLine += `\n✨ Forte is **HALF CHARGED**.`;
            }
          }
        }
```

- [ ] **Step 3: Concerto Energy gain — apply to all move buttons**

Find (right after the `dg_echoskill` block's closing `}`, before the `// V2 turn-start regen` comment):
```typescript
        // V2 turn-start regen (applied each enemy counter phase = start of next player turn)
```

Insert immediately BEFORE this line:
```typescript
        // Concerto Energy builds from combat actions, never from swapping —
        // scaled by move weight, ported from encounter.ts's Milestone 1/2b
        // CONCERTO_GAIN_BY_MOVE logic.
        const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
          dg_basic: 10, dg_skill: 20, dg_echoskill: 20, dg_ultimate: 35,
        };
        if (ws.isDevGuild) {
          let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
          if (concertoGain > 0 && ws.activeUnit === "ally") concertoGain += WELLSPRING_BASE_ENERGY_BONUS;
          if (concertoGain > 0) ws.concertoEnergy = addConcertoEnergy(ws.concertoEnergy, concertoGain);
        }

        // V2 turn-start regen (applied each enemy counter phase = start of next player turn)
```

- [ ] **Step 4: Per-turn decrement of Attunement/Forte duration counters**

Find:
```typescript
        if (ws.skillCooldown > 0) ws.skillCooldown--;
        if (ws.glacioShieldTurnsLeft > 0) ws.glacioShieldTurnsLeft--;
        if (ws.stormBuffTurnsLeft > 0) ws.stormBuffTurnsLeft--;
        if (ws.namedState.spectroFractureTurnsLeft > 0) ws.namedState.spectroFractureTurnsLeft--;
        if (ws.echoSkillCooldown > 0) ws.echoSkillCooldown--;
        if (ws.enemyDefShredTurnsLeft > 0) ws.enemyDefShredTurnsLeft--;
        if (forcedCritActive) ws.nextAttackCritArmed = false;
```

Replace with:
```typescript
        if (ws.skillCooldown > 0) ws.skillCooldown--;
        if (ws.glacioShieldTurnsLeft > 0) ws.glacioShieldTurnsLeft--;
        if (ws.stormBuffTurnsLeft > 0) ws.stormBuffTurnsLeft--;
        if (ws.namedState.spectroFractureTurnsLeft > 0) ws.namedState.spectroFractureTurnsLeft--;
        if (ws.echoSkillCooldown > 0) ws.echoSkillCooldown--;
        if (ws.enemyDefShredTurnsLeft > 0) ws.enemyDefShredTurnsLeft--;
        if (ws.isDevGuild && ws.attunementDoubleTurnsLeft > 0) ws.attunementDoubleTurnsLeft--;
        if (ws.isDevGuild && ws.forteEmpoweredTurnsLeft > 0) ws.forteEmpoweredTurnsLeft--;
        if (forcedCritActive) ws.nextAttackCritArmed = false;
```

- [ ] **Step 5: Enemy damage routes to the correct active unit's HP**

Find:
```typescript
          bossDmg       = shield.dmg;
          ws.playerHp   = Math.max(0, ws.playerHp - bossDmg);
```

Replace with:
```typescript
          bossDmg       = shield.dmg;
          // Milestone 3a: route damage to whichever unit is actually active,
          // fixing the same bug class Milestone 1 fixed in encounter.ts (damage
          // must not always hit the player regardless of who's benched).
          const allyIsActive = ws.isDevGuild && ws.activeUnit === "ally";
          if (allyIsActive) {
            ws.allyHp = Math.max(0, ws.allyHp - bossDmg);
          } else {
            ws.playerHp = Math.max(0, ws.playerHp - bossDmg);
          }
```

Find the "Lose" check:
```typescript
        // Lose
        if (ws.playerHp <= 0) {
          ws.playerHp = 0;
          await battleMsg.edit({ embeds: [buildWaveEmbed(moveLine + " — **YOU FELL.**")], components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
          return;
        }
```

Replace with:
```typescript
        // Ally KO'd — auto-swap back to the player rather than ending the run
        // over a benched unit's HP (matches encounter.ts's Milestone 1 fix).
        if (ws.isDevGuild && ws.activeUnit === "ally" && ws.allyHp <= 0) {
          ws.allyHp = 0;
          ws.activeUnit = "player";
          moveLine += `\n◇ **${SOLACE.name} was knocked out** — swapped back to ${ws.displayName}.`;
        }

        // Lose
        if (ws.playerHp <= 0) {
          ws.playerHp = 0;
          await battleMsg.edit({ embeds: [buildWaveEmbed(moveLine + " — **YOU FELL.**")], components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
          return;
        }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/dungeon.ts
git commit -m "feat(teams): wire Solace's Ultimate, Forte fill, Concerto Energy, ally-damage routing into /dungeon (Milestone 3a Task 5)"
```

---

### Task 6: Verification

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
grep -n "isDevGuild" src/commands/rpg/dungeon.ts   # confirm every new branch is gated
grep -c "dg_swap" src/commands/rpg/dungeon.ts       # expect at least 2 (button creation + handler)
```

- [ ] **Step 2: Manual — deploy and playtest**

No new slash command (`/dungeon` already exists), so `npm run deploy` isn't needed. On the VM: `git pull && npm run build && pm2 restart cartethyia`.

In the dev guild, run a full dungeon (all 3 waves) and verify:
- [ ] Swap button appears; swapping to Solace shows her real row (Chime Strike/Attunement/Convergence/Flee)
- [ ] Attunement cycles ATK→CRIT→DEF→ATK, affects your own Basic/Ultimate damage and DEF after swapping back
- [ ] Concerto Energy, Attunement mode, and Forte charge all carry from wave 1 into wave 2 into wave 3 — do NOT reset between waves
- [ ] Chime Strike fills Forte with HALF/FULLY CHARGED messages appearing once each, not every hit
- [ ] Convergence (with Forte not maxed) heals both units and doubles the active mode for 3 turns; with Forte maxed, triggers Empowered Convergence instead
- [ ] Enemy damage correctly hits whichever unit is active, not always the player
- [ ] If Solace gets KO'd while active, auto-swaps back to the player rather than ending the run
- [ ] Non-dev-guild `/dungeon` is completely unaffected — run it in another server and confirm no Swap button, no team mechanics, identical to pre-milestone behavior

- [ ] **Step 3: Report findings back**

Same as every prior milestone — if something's off, describe exactly what you saw and I'll fix it directly.
