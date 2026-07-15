# Milestone 3e — Team Mechanics in /duel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the team-combat system (Solace, Attunement/Wellspring/Forte/Convergence/Concerto Energy) into `/duel` — the last of the 6 combat surfaces. Dev-guild-gated, matching every prior milestone's staging discipline.

**Architecture:** `src/commands/rpg/duel.ts` is PvP — a single `DuelState` object with every stat mirrored as a `c*` (challenger) / `d*` (challenged) pair, one long-lived-per-turn `collector.on("collect", ...)` handler inside `runDuelTurn()` that reads whichever side is acting via `isChallenger = turnUserId === state.challengerId` ternaries into local `my*`/`opp*` variables, then writes results back into `state.c*`/`state.d*` at the end. This is NOT a party (unlike `/raid`) and NOT a single-owner PvE fight (unlike `/boss`) — it's **two independent solo `/boss`-shaped fights, mirrored**. Every new field this milestone adds gets a `c*`/`d*` pair, following the exact pattern the file already uses for `cNamedState`/`dNamedState`, `cGlacioShieldTurnsLeft`/`dGlacioShieldTurnsLeft`, etc.

**Every lesson from Milestones 3a–3d's bug-fix history is applied from the start:** swap falls through to the shared tail from Task 2 onward; `cFirstAction`/`dFirstAction`, the turn-1 SPD first-strike bonus, and the `nextCritArmed` reset correctly exclude swap (and the SPD first-strike bonus also excludes Convergence, mirroring the Quick-Strike exclusion from `/boss`/`/ascend`); WEAKENED is fully wired (tick + apply + fold into damage) in the same task that adds Convergence; a duel status line ships in Task 1 alongside the state it displays; Convergence's `concertoEnergy = 0` is guarded against the same-turn generic-gain refund from the moment that gain logic is written; **ally-HP routing and every other new branch is applied symmetrically to BOTH the `isChallenger` and `!isChallenger` cases** — this file's `c*`/`d*` duplication is the single biggest copy-paste risk in this port, called out explicitly in every step below.

See the [design spec](../specs/2026-07-15-milestone3e-duel-team-port-design.md) for full rationale.

**Tech Stack:** TypeScript. Reuses every function already built for `/encounter`/`/dungeon`/`/boss`/`/ascend`/`/field-boss`/`/raid` — `solace.ts`, `attunement.ts`, `wellspring.ts`, `forte.ts`, `characterProgress.ts`, `debuffs.ts`, `introOutro.ts`, `concertoEnergy.ts`, `allyActions.ts` — with zero changes to any of those files. Only `src/commands/rpg/duel.ts` is modified.

---

### Task 1: Dev-Guild Gate, Per-Side Team State, Button/Embed Plumbing

**Files:**
- Modify: `src/commands/rpg/duel.ts`

- [ ] **Step 1: Add imports**

Find (the last import line):
```typescript
import { AttachmentBuilder } from "discord.js";
```

Add above it:
```typescript
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

- [ ] **Step 2: Extend `DuelState` with `c*`/`d*` team-state pairs**

Find:
```typescript
  cEchoSkillCd: number; cDefShredTurnsLeft: number; cDefShredPct: number; cNextCritArmed: boolean;
  // Challenged stats
```

Replace with:
```typescript
  cEchoSkillCd: number; cDefShredTurnsLeft: number; cDefShredPct: number; cNextCritArmed: boolean;
  // Milestone 3e: challenger team state (dev guild only)
  cHasSolace: boolean;
  cSolaceBasicLevel: number; cSolaceSkillLevel: number; cSolaceUltimateLevel: number;
  cSolaceIntroLevel: number; cSolaceForteLevel: number;
  cActiveUnit: "player" | "ally"; cAllyHp: number; cAllyHpMax: number;
  cConcertoEnergy: number; cPlayerDebuffs: DebuffState;
  cAttunement: AttunementState; cAttunementDoubleTurnsLeft: number;
  cSolaceForte: ForteState; cForteEmpoweredTurnsLeft: number;
  // Challenged stats
```

Find:
```typescript
  dEchoSkillCd: number; dDefShredTurnsLeft: number; dDefShredPct: number; dNextCritArmed: boolean;
  // Turn tracking
```

Replace with:
```typescript
  dEchoSkillCd: number; dDefShredTurnsLeft: number; dDefShredPct: number; dNextCritArmed: boolean;
  // Milestone 3e: challenged team state (dev guild only)
  dHasSolace: boolean;
  dSolaceBasicLevel: number; dSolaceSkillLevel: number; dSolaceUltimateLevel: number;
  dSolaceIntroLevel: number; dSolaceForteLevel: number;
  dActiveUnit: "player" | "ally"; dAllyHp: number; dAllyHpMax: number;
  dConcertoEnergy: number; dPlayerDebuffs: DebuffState;
  dAttunement: AttunementState; dAttunementDoubleTurnsLeft: number;
  dSolaceForte: ForteState; dForteEmpoweredTurnsLeft: number;
  // Turn tracking
```

- [ ] **Step 3: Compute `isDevGuild` + fetch both `CharacterProgress` rows at accept-time, populate the new fields on `state`**

Find (inside the `challengeCollector.on("collect", ...)` handler, right after `await interaction.editReply({ components: [] });`):
```typescript
    // locks already held for both players

    const state: DuelState = {
```

Replace with:
```typescript
    // locks already held for both players

    const isDevGuild = interaction.guildId === process.env.GUILD_ID;
    const [cSolaceProgress, dSolaceProgress] = isDevGuild
      ? await Promise.all([
          getOrCreateCharacterProgress(interaction.user.id, "solace"),
          getOrCreateCharacterProgress(target.id, "solace"),
        ])
      : [null, null];

    const state: DuelState = {
```

Find:
```typescript
      cEchoSkillCd: 0, cDefShredTurnsLeft: 0, cDefShredPct: 0, cNextCritArmed: false,
      dHp: dStats.hp, dHpMax: dStats.hp, dEnergy: 0, dSkillCd: 0,
```

Replace with:
```typescript
      cEchoSkillCd: 0, cDefShredTurnsLeft: 0, cDefShredPct: 0, cNextCritArmed: false,
      cHasSolace: cSolaceProgress !== null,
      cSolaceBasicLevel: cSolaceProgress?.basicLevel ?? 1, cSolaceSkillLevel: cSolaceProgress?.skillLevel ?? 1,
      cSolaceUltimateLevel: cSolaceProgress?.ultimateLevel ?? 1, cSolaceIntroLevel: cSolaceProgress?.introLevel ?? 1,
      cSolaceForteLevel: cSolaceProgress?.forteLevel ?? 1,
      cActiveUnit: "player", cAllyHp: SOLACE.hpMax, cAllyHpMax: SOLACE.hpMax,
      cConcertoEnergy: 0, cPlayerDebuffs: [],
      cAttunement: { mode: null }, cAttunementDoubleTurnsLeft: 0,
      cSolaceForte: { phase: 0, charge: 0 }, cForteEmpoweredTurnsLeft: 0,
      dHp: dStats.hp, dHpMax: dStats.hp, dEnergy: 0, dSkillCd: 0,
```

Find:
```typescript
      dEchoSkillCd: 0, dDefShredTurnsLeft: 0, dDefShredPct: 0, dNextCritArmed: false,
      // Higher SPD acts first; ties keep the challenger-first default
```

Replace with:
```typescript
      dEchoSkillCd: 0, dDefShredTurnsLeft: 0, dDefShredPct: 0, dNextCritArmed: false,
      dHasSolace: dSolaceProgress !== null,
      dSolaceBasicLevel: dSolaceProgress?.basicLevel ?? 1, dSolaceSkillLevel: dSolaceProgress?.skillLevel ?? 1,
      dSolaceUltimateLevel: dSolaceProgress?.ultimateLevel ?? 1, dSolaceIntroLevel: dSolaceProgress?.introLevel ?? 1,
      dSolaceForteLevel: dSolaceProgress?.forteLevel ?? 1,
      dActiveUnit: "player", dAllyHp: SOLACE.hpMax, dAllyHpMax: SOLACE.hpMax,
      dConcertoEnergy: 0, dPlayerDebuffs: [],
      dAttunement: { mode: null }, dAttunementDoubleTurnsLeft: 0,
      dSolaceForte: { phase: 0, charge: 0 }, dForteEmpoweredTurnsLeft: 0,
      // Higher SPD acts first; ties keep the challenger-first default
```

- [ ] **Step 4: Team status line in `duelEmbed`**

Find:
```typescript
      {
        name:   "◈  Combat Log",
        value:  lastMove || "*The duel begins.*",
        inline: false,
      },
    )
    .setFooter({ text: `CARTETHYIA  ·  ${turnName}'s turn  ·  10 min to act` });
```

Replace with:
```typescript
      {
        name:   "◈  Combat Log",
        value:  lastMove || "*The duel begins.*",
        inline: false,
      },
    )
    .setDescription(duelTeamStatusLine(state))
    .setFooter({ text: `CARTETHYIA  ·  ${turnName}'s turn  ·  10 min to act` });
```

Add above `function duelEmbed(...)`:
```typescript
function duelTeamStatusLine(state: DuelState): string | null {
  const lines: string[] = [];
  if (state.cHasSolace) lines.push(duelSideStatusLine(state.challengerName, state.cActiveUnit, state.cAllyHp, state.cAllyHpMax, state.cConcertoEnergy, state.cPlayerDebuffs));
  if (state.dHasSolace) lines.push(duelSideStatusLine(state.challengedName, state.dActiveUnit, state.dAllyHp, state.dAllyHpMax, state.dConcertoEnergy, state.dPlayerDebuffs));
  return lines.length > 0 ? lines.join("\n") : null;
}

function duelSideStatusLine(
  name: string, activeUnit: "player" | "ally", allyHp: number, allyHpMax: number,
  concertoEnergy: number, debuffs: DebuffState,
): string {
  const debuffLine = debuffs.length > 0 ? `  ·  ${debuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}` : "";
  const soloLine = activeUnit === "ally" ? `  ·  ${SOLACE.name} ${allyHp}/${allyHpMax} HP` : "";
  return `🔄 **${name}**: Concerto Energy **${concertoEnergy}/100**${soloLine}${debuffLine}`;
}
```

- [ ] **Step 5: Solace's button row + swap button in `buildDuelButtons`**

Find:
```typescript
function buildDuelButtons(state: DuelState, forUserId: string): ActionRowBuilder<ButtonBuilder> {
  const isChallenger = forUserId === state.challengerId;
  const myEnergy     = isChallenger ? state.cEnergy  : state.dEnergy;
  const mySkillCd    = isChallenger ? state.cSkillCd : state.dSkillCd;
  const myBonus      = isChallenger ? state.cBonuses : state.dBonuses;
  const myEchoCd     = isChallenger ? state.cEchoSkillCd : state.dEchoSkillCd;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("duel_skill")
      .setLabel(mySkillCd === 0 ? "✦  Skill" : `✦  Skill (${mySkillCd}🔄)`)
      .setStyle(ButtonStyle.Secondary).setDisabled(mySkillCd > 0),
    new ButtonBuilder().setCustomId("duel_ultimate")
      .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(myEnergy < 100),
  );
  if (myBonus.echoSkill) {
    const echoReady = myEchoCd === 0;
    row.addComponents(
      new ButtonBuilder().setCustomId("duel_echoskill")
        .setLabel(echoReady ? `🌀  ${myBonus.echoSkill.name}` : `🌀  ${myBonus.echoSkill.name} (${myEchoCd}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId("duel_forfeit")
      .setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
  );
  return row;
}
```

Replace with (now returns an array of rows — every call site updated in Step 6):
```typescript
function buildDuelButtons(state: DuelState, forUserId: string, isDevGuild: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const isChallenger  = forUserId === state.challengerId;
  const myEnergy       = isChallenger ? state.cEnergy  : state.dEnergy;
  const mySkillCd       = isChallenger ? state.cSkillCd : state.dSkillCd;
  const myBonus         = isChallenger ? state.cBonuses : state.dBonuses;
  const myEchoCd         = isChallenger ? state.cEchoSkillCd : state.dEchoSkillCd;
  const myHasSolace       = isChallenger ? state.cHasSolace : state.dHasSolace;
  const myActiveUnit       = isChallenger ? state.cActiveUnit : state.dActiveUnit;
  const myConcertoEnergy    = isChallenger ? state.cConcertoEnergy : state.dConcertoEnergy;
  const myAttunement          = isChallenger ? state.cAttunement : state.dAttunement;
  const myName                 = isChallenger ? state.challengerName : state.challengedName;

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (isDevGuild && myHasSolace && myActiveUnit === "ally") {
    const modeLabel = myAttunement.mode ? `(${myAttunement.mode})` : "(inactive)";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("duel_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("duel_ultimate").setLabel("⚡  Convergence")
        .setStyle(ButtonStyle.Success).setDisabled(myConcertoEnergy < 100),
      new ButtonBuilder().setCustomId("duel_forfeit").setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("duel_skill")
        .setLabel(mySkillCd === 0 ? "✦  Skill" : `✦  Skill (${mySkillCd}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(mySkillCd > 0),
      new ButtonBuilder().setCustomId("duel_ultimate")
        .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(myEnergy < 100),
    );
    if (myBonus.echoSkill) {
      const echoReady = myEchoCd === 0;
      row.addComponents(
        new ButtonBuilder().setCustomId("duel_echoskill")
          .setLabel(echoReady ? `🌀  ${myBonus.echoSkill.name}` : `🌀  ${myBonus.echoSkill.name} (${myEchoCd}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId("duel_forfeit").setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
    );
    rows.push(row);
  }

  if (isDevGuild && myHasSolace) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_swap")
        .setLabel(myActiveUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${myName}`)
        .setStyle(ButtonStyle.Secondary),
    ));
  }

  return rows;
}
```

- [ ] **Step 6: Update every `buildDuelButtons(...)` call site to pass `isDevGuild` and spread the returned array into `components`**

Run: `grep -n "buildDuelButtons(state" src/commands/rpg/duel.ts` — expect 2 call sites (initial `battleMsg` send, and the post-turn `thread.send` inside the collector). At both:
- Change `components: [buildDuelButtons(state, state.currentTurn)]` to `components: buildDuelButtons(state, state.currentTurn, isDevGuild)`.
- `isDevGuild` must be in scope at both call sites — it's declared once in the `challengeCollector` handler (Step 3) and both call sites are inside that same closure (`runDuelTurn`/`collector.on("collect", ...)` are nested inside it), so no threading needed.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, or errors scoped only to the 2 call sites from Step 6. Fix those now.

- [ ] **Step 8: Commit**

```bash
git add src/commands/rpg/duel.ts
git commit -m "feat(teams): add dev-guild-gated per-side team state + button/embed plumbing to /duel (Milestone 3e Task 1)"
```

---

### Task 2: Swap Handler (Both Sides)

**Files:**
- Modify: `src/commands/rpg/duel.ts`

**Context:** Insert the swap branch as a sibling `if` alongside `duel_basic`/`duel_skill`/`duel_ultimate`, AFTER the existing per-turn prelude that computes `my*`/`opp*` locals (lines ~389–433 in the pre-Milestone file), and BEFORE the `duel_forfeit`/`duel_basic` branches. It must fall through to the SAME shared tail every other action uses (healing/energy application → damage application → named-set reactive checks → Second Wind → cooldown ticks → win-check → turn switch → next message) — the exact lesson every prior port had to guard against.

- [ ] **Step 1: Read locals for both `my*` and `opp*` team state**

Find (the block computing `myNamedState`/`mySetId`/etc., right after `const isWeak = ...`):
```typescript
        const myNamedState  = isChallenger ? state.cNamedState : state.dNamedState;
```

Insert immediately above it:
```typescript
        // Milestone 3e: per-side team-state locals
        const myHasSolace          = isChallenger ? state.cHasSolace : state.dHasSolace;
        const myActiveUnit         = isChallenger ? state.cActiveUnit : state.dActiveUnit;
        const myAllyHpVal          = isChallenger ? state.cAllyHp : state.dAllyHp;
        const myAllyHpMaxVal       = isChallenger ? state.cAllyHpMax : state.dAllyHpMax;
        const myConcertoEnergy     = isChallenger ? state.cConcertoEnergy : state.dConcertoEnergy;
        const myPlayerDebuffs      = isChallenger ? state.cPlayerDebuffs : state.dPlayerDebuffs;
        const myAttunement         = isChallenger ? state.cAttunement : state.dAttunement;
        const myAttunementDblTurns = isChallenger ? state.cAttunementDoubleTurnsLeft : state.dAttunementDoubleTurnsLeft;
        const mySolaceForte        = isChallenger ? state.cSolaceForte : state.dSolaceForte;
        const myForteEmpoweredTurns= isChallenger ? state.cForteEmpoweredTurnsLeft : state.dForteEmpoweredTurnsLeft;
        const mySolaceBasicLevel   = isChallenger ? state.cSolaceBasicLevel : state.dSolaceBasicLevel;
        const mySolaceSkillLevel   = isChallenger ? state.cSolaceSkillLevel : state.dSolaceSkillLevel;
        const mySolaceUltimateLvl  = isChallenger ? state.cSolaceUltimateLevel : state.dSolaceUltimateLevel;
        const mySolaceIntroLevel   = isChallenger ? state.cSolaceIntroLevel : state.dSolaceIntroLevel;
        const mySolaceForteLevel   = isChallenger ? state.cSolaceForteLevel : state.dSolaceForteLevel;
        let convergenceUsedThisTurn = false;

        const myNamedState  = isChallenger ? state.cNamedState : state.dNamedState;
```

- [ ] **Step 2: Add the swap branch before `duel_forfeit`**

Find:
```typescript
        if (btn.customId === "duel_forfeit") {
```

Insert immediately before it:
```typescript
        // Milestone 3e: swap — always consumes the turn, falls through to the
        // shared tail below, same as every other action. Ported from
        // boss.ts's Milestone 3b swap handler.
        if (btn.customId === "duel_swap" && isDevGuild && myHasSolace) {
          const outgoingIsPlayer = myActiveUnit === "player";
          const comboReady = myConcertoEnergy >= 100;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = outgoingIsPlayer
              ? { hp: myAllyHpVal, hpMax: myAllyHpMaxVal }
              : { hp: myHp, hpMax: myHpMax };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
            const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(mySolaceIntroLevel) : PLAYER_SELF_INTRO;
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            if (!outgoingIsPlayer) {
              if (isChallenger) state.cNextCritArmed = true; else state.dNextCritArmed = true;
            }

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;
            let actualGain: number;
            if (outgoingIsPlayer) {
              const before = myAllyHpVal;
              const after  = Math.min(myAllyHpMaxVal, myAllyHpVal + totalBonus);
              actualGain = after - before;
              if (isChallenger) state.cAllyHp = after; else state.dAllyHp = after;
            } else {
              const before = myHp;
              const after  = Math.min(myHpMax, myHp + totalBonus);
              actualGain = after - before;
              if (isChallenger) state.cHp = after; else state.dHp = after;
            }

            moveLine = actualGain > 0
              ? `${myName} — 🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : myName}** — Outro+Intro combo! +${actualGain} HP.`
              : `${myName} — 🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : myName}** — Outro+Intro combo! (already full HP, no heal needed)`;
            const newConcerto = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART
            if (isChallenger) state.cConcertoEnergy = newConcerto; else state.dConcertoEnergy = newConcerto;
          } else {
            moveLine = `${myName} — 🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : myName}** — Concerto Energy not full, no combo triggered.`;
          }

          if (isChallenger) state.cActiveUnit = outgoingIsPlayer ? "ally" : "player";
          else              state.dActiveUnit = outgoingIsPlayer ? "ally" : "player";
          damage = 0;
        }

        if (btn.customId === "duel_forfeit") {
```

**Do NOT** add a `return` or independent `thread.send`/`battleMsg.edit` inside this branch — it must fall through to the exact same shared tail (`applyAbilityAttack` → first-strike bonus → lifesteal/heal/energy application → damage application → named-set reactive checks → Second Wind → Radiance regen → cooldown ticks → win-check → turn switch → next message) that `duel_basic`/`duel_skill`/`duel_ultimate`/`duel_echoskill` already fall through to.

- [ ] **Step 3: Exclude swap from the turn-1 SPD first-strike bonus, `cFirstAction`/`dFirstAction`, and the `nextCritArmed` reset**

Find:
```typescript
        // SPD first-strike — whoever has the SPD edge gets bonus damage on the duel's very first action
        if (state.turn === 1 && mySpd > oppSpd) {
```

Replace with:
```typescript
        // SPD first-strike — whoever has the SPD edge gets bonus damage on the duel's very first action.
        // Excludes swap (free repositioning, deals 0 damage anyway) and Solace's Convergence
        // (a real action, but shouldn't get a damage bonus it can't use), mirroring the
        // Quick-Strike exclusion already applied to Convergence in /boss and /ascend.
        if (state.turn === 1 && mySpd > oppSpd && btn.customId !== "duel_swap" &&
            !(btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally")) {
```

Find:
```typescript
          state.cFirstAction = false;
        } else {
```

Replace with:
```typescript
          if (btn.customId !== "duel_swap") state.cFirstAction = false;
        } else {
```

Find:
```typescript
          state.dFirstAction = false;
        }
```

Replace with:
```typescript
          if (btn.customId !== "duel_swap") state.dFirstAction = false;
        }
```

Find:
```typescript
          if (forcedCritActive) state.cNextCritArmed = false;
        } else {
```

Replace with:
```typescript
          if (forcedCritActive && btn.customId !== "duel_swap") state.cNextCritArmed = false;
        } else {
```

Find:
```typescript
          if (forcedCritActive) state.dNextCritArmed = false;
        }
```

Replace with:
```typescript
          if (forcedCritActive && btn.customId !== "duel_swap") state.dNextCritArmed = false;
        }
```

(These four exclusions are applied NOW, matching every prior port's "built in from the start, not discovered after the fact" discipline.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, or errors only about team-state functions not yet fully wired elsewhere (Tasks 3–4). Fix anything in the swap branch itself now.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/duel.ts
git commit -m "feat(teams): wire swap handler into /duel (Milestone 3e Task 2)"
```

---

### Task 3: Wire Attunement/Wellspring/Forte/WEAKENED into Basic, Skill, Ultimate (Both Sides)

**Files:**
- Modify: `src/commands/rpg/duel.ts`

**Context:** Same additive-term folding as `/boss`'s Task 3, applied once per acting side (the existing `isChallenger` ternary pattern already localizes everything into `my*` variables, so this is folding new multipliers into that same local computation, not duplicating logic per side).

- [ ] **Step 1: Basic Attack (`duel_basic`) — Solace-only base multiplier + team-wide bonuses + WEAKENED**

Find:
```typescript
        if (btn.customId === "duel_basic") {
          const windExplosion = mySetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(myNamedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const forcedCrit = forcedCritActive || windExplosion.guaranteedCrit;
          const r      = calcPlayerDamage(myAtk * smolderMult * myHavocAtkMult, effectiveOppDef, forcedCrit ? 1 : aCrit, myCritDmg, 1.0, isWeak, false);
          let base     = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus) * radiantDmgMult);
```

Replace with:
```typescript
        if (btn.customId === "duel_basic") {
          const teamAtkMult   = isDevGuild ? getAttunementAtkMult(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0) : 1;
          const teamCritBonus = isDevGuild ? getAttunementCritRateBonus(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0) : 0;
          const wellspringAtkMult   = isDevGuild && myActiveUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
          const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(myAttunement) : 0;
          const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(myAttunement) : 0;
          const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const teamMult = getWeakenedMult(myPlayerDebuffs) * teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const basicMoveMult = isDevGuild && myActiveUnit === "ally" ? solaceBasicDamageMult(mySolaceBasicLevel) : 1.0;
          const windExplosion = mySetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(myNamedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const forcedCrit = forcedCritActive || windExplosion.guaranteedCrit;
          const r      = calcPlayerDamage(myAtk * teamMult * basicMoveMult * smolderMult * myHavocAtkMult, effectiveOppDef, forcedCrit ? 1 : Math.min(1, aCrit + teamCritBonus + wellspringCritBonus + forteCritBonus), myCritDmg, 1.0, isWeak, false);
          let base     = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus) * radiantDmgMult);
```

- [ ] **Step 2: Skill (`duel_skill`) — split into Solace's Attunement branch vs. the existing player Skill logic**

Find:
```typescript
        if (btn.customId === "duel_skill") {
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const r      = calcPlayerDamage(myAtk * smolderMult * myHavocAtkMult, effectiveOppDef, forcedCritActive ? 1 : Math.min(1, aCrit + 0.1), myCritDmg, 1.8, isWeak, false);
```

Replace with:
```typescript
        if (btn.customId === "duel_skill" && isDevGuild && myActiveUnit === "ally") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          const newMode = cycleAttunementMode(myAttunement.mode);
          if (isChallenger) state.cAttunement.mode = newMode; else state.dAttunement.mode = newMode;
          const crit = Math.random() < aCrit;
          const r    = calcPlayerDamage(myAtk * 0.6, effectiveOppDef, crit ? 1 : 0, myCritDmg, 1.0, isWeak, false);
          damage = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus));
          isCrit = r.isCrit; moveType = "SKILL";
          moveLine = `${myName} — ✦ Attunement — now in **${newMode}** mode!`;
        } else if (btn.customId === "duel_skill") {
          const teamAtkMult    = isDevGuild ? getAttunementAtkMult(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0) : 1;
          const teamCritBonus  = isDevGuild ? getAttunementCritRateBonus(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0) : 0;
          const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(myAttunement) : 0;
          const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(myAttunement) : 0;
          const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const teamMult = getWeakenedMult(myPlayerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const r      = calcPlayerDamage(myAtk * teamMult * smolderMult * myHavocAtkMult, effectiveOppDef, forcedCritActive ? 1 : Math.min(1, aCrit + 0.1 + teamCritBonus + wellspringCritBonus + forteCritBonus), myCritDmg, 1.8, isWeak, false);
```

**Important:** everything else inside the original `duel_skill` block (energy/cooldown update, `moveLine`, ignite, etc.) stays exactly as it was, just re-parented under the new `else if` — do not duplicate or remove any of it. The Solace-Attunement branch above is intentionally self-contained and does NOT fall through into that block's energy/cooldown code — add its own energy gain line at the end of the new `if` block: `const enGain = ENERGY_PER_TURN; if (isChallenger) state.cEnergy = Math.min(100, state.cEnergy + enGain); else state.dEnergy = Math.min(100, state.dEnergy + enGain);` (Solace's Attunement cycle still builds the player's own personal Energy bar in the background, same as `/boss`'s equivalent branch).

- [ ] **Step 3: Ultimate (`duel_ultimate`) — team-wide bonuses on the player's own Ultimate only (Solace's own Ultimate is Task 4)**

Find:
```typescript
        if (btn.customId === "duel_ultimate") {
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const r  = calcPlayerDamage(myAtk * smolderMult * myHavocAtkMult, effectiveOppDef, 1.0, myCritDmg, 3.5, isWeak, false);
```

Replace with:
```typescript
        if (btn.customId === "duel_ultimate" && !(isDevGuild && myActiveUnit === "ally")) {
          const teamAtkMult   = isDevGuild ? getAttunementAtkMult(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0) : 1;
          const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(myAttunement) : 0;
          const forteAtkBonus = isDevGuild ? getSolaceForteAtkBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const teamMult = getWeakenedMult(myPlayerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const r  = calcPlayerDamage(myAtk * teamMult * smolderMult * myHavocAtkMult, effectiveOppDef, 1.0, myCritDmg, 3.5, isWeak, false);
```

- [ ] **Step 4: WEAKENED — tick at start of the acting side's turn, apply on a landed hit**

Find (right after the `let damage = 0; let moveLine = "";` declaration, before the `duel_swap`/`duel_forfeit` branches):
```typescript
        let damage = 0;
        let moveLine = "";
```

Replace with:
```typescript
        let damage = 0;
        let moveLine = "";

        // Debuffs tick down at the start of the acting side's own turn.
        if (isDevGuild) {
          const tickResult = tickDebuffs(myPlayerDebuffs);
          if (isChallenger) state.cPlayerDebuffs = tickResult.state; else state.dPlayerDebuffs = tickResult.state;
        }
```

Find (after damage is applied to the opponent — the `// Apply damage to opponent` block):
```typescript
        // Apply damage to opponent
        if (isChallenger) state.dHp = Math.max(0, state.dHp - damage);
        else              state.cHp = Math.max(0, state.cHp - damage);
```

Replace with:
```typescript
        // Apply damage to opponent
        if (isChallenger) state.dHp = Math.max(0, state.dHp - damage);
        else              state.cHp = Math.max(0, state.cHp - damage);

        // Milestone 3e: landing a real attack has a 25% chance to leave the
        // opponent WEAKENED, mirroring /boss's retaliation-side chance.
        // Excluded from swap (damage === 0 anyway, so this is a no-op safety
        // net, not load-bearing).
        if (isDevGuild && damage > 0 && Math.random() < 0.25) {
          if (isChallenger) state.dPlayerDebuffs = applyDebuff(state.dPlayerDebuffs, "WEAKENED", 0.2, 2);
          else              state.cPlayerDebuffs = applyDebuff(state.cPlayerDebuffs, "WEAKENED", 0.2, 2);
          moveLine += `\n◇ *Leaves ${isChallenger ? state.challengedName : state.challengerName}* **WEAKENED** *(-20% ATK, 2 turns)*`;
        }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, or errors only about Solace's own Ultimate/Forte-fill/Concerto-gain/ally-HP-routing not existing yet (Task 4). Report BLOCKED if anything else appears.

- [ ] **Step 6: Commit**

```bash
git add src/commands/rpg/duel.ts
git commit -m "feat(teams): wire Attunement/Wellspring/Forte/WEAKENED into /duel Basic/Skill/Ultimate (Milestone 3e Task 3)"
```

---

### Task 4: Solace's Ultimate (Convergence), Forte Fill, Concerto Gain, Ally-HP Routing, KO Auto-Swap

**Files:**
- Modify: `src/commands/rpg/duel.ts`

- [ ] **Step 1: Add Solace's Ultimate (Convergence) as a new branch**

Find the `duel_ultimate` branch's closing `}` — it should be immediately followed by the echo-skill check:
```typescript
        let echoResult: ReturnType<typeof applyEchoSkill> | null = null;
```

Insert a new `else if` branch immediately BEFORE this line (i.e. right after `duel_ultimate`'s closing `}`):
```typescript
        } else if (btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally") {
          // Solace's Ultimate spends Concerto Energy, not personal Energy, and
          // heals the 2-unit side (player + Solace) — no party to heal in a
          // duel, matching /dungeon's/`boss.ts`'s 2-unit Convergence, not
          // /raid's party-wide version.
          const healPct = solaceConvergenceHealPct(mySolaceUltimateLvl);
          const playerHealResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
            { type: "CLEANSE_ALLY", value: 1 },
          ] }, { hp: myHp, hpMax: myHpMax });
          const allyHealResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
          ] }, { hp: myAllyHpVal, hpMax: myAllyHpMaxVal });

          const beforePlayer = myHp;
          const afterPlayer  = Math.min(myHpMax, myHp + playerHealResult.hpDelta);
          const actualHealPlayer = afterPlayer - beforePlayer;
          const beforeAlly = myAllyHpVal;
          const afterAlly  = Math.min(myAllyHpMaxVal, myAllyHpVal + allyHealResult.hpDelta);
          const actualHealAlly = afterAlly - beforeAlly;
          const cleansedDebuffs = cleanseDebuffs(myPlayerDebuffs, playerHealResult.cleanseCount);

          if (isChallenger) {
            state.cHp = afterPlayer; state.cAllyHp = afterAlly; state.cPlayerDebuffs = cleansedDebuffs;
            state.cConcertoEnergy = 0;
          } else {
            state.dHp = afterPlayer; state.dAllyHp = afterAlly; state.dPlayerDebuffs = cleansedDebuffs;
            state.dConcertoEnergy = 0;
          }
          convergenceUsedThisTurn = true;
          damage = 0; isCrit = false; moveType = "ULT";

          const healSummary = `${myName} +${actualHealPlayer} HP, ${SOLACE.name} +${actualHealAlly} HP`;
          if (isForteMaxed(mySolaceForte, SOLACE_FORTE_CONFIG)) {
            const emp = SOLACE_FORTE_EMPOWERED_TURNS + 1;
            const reset = resetForte();
            if (isChallenger) { state.cForteEmpoweredTurnsLeft = emp; state.cAttunementDoubleTurnsLeft = 0; state.cSolaceForte = reset; }
            else              { state.dForteEmpoweredTurnsLeft = emp; state.dAttunementDoubleTurnsLeft = 0; state.dSolaceForte = reset; }
            moveLine = `${myName} — ⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**all 3 Attunement Modes empowered for ${SOLACE_FORTE_EMPOWERED_TURNS} turns!**`;
          } else {
            const dbl = SOLACE_ULTIMATE_DOUBLE_TURNS + 1;
            if (isChallenger) { state.cAttunementDoubleTurnsLeft = dbl; state.cForteEmpoweredTurnsLeft = 0; }
            else              { state.dAttunementDoubleTurnsLeft = dbl; state.dForteEmpoweredTurnsLeft = 0; }
            moveLine = `${myName} — ⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**${myAttunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
          }
        }

        let echoResult: ReturnType<typeof applyEchoSkill> | null = null;
```

(The `+1` turn-duration compensation is baked in from the start, matching Milestone 3d Task 4's explicit callout — do not ship without it.)

- [ ] **Step 2: Forte fill from Chime Strike, with threshold-crossing messages**

Find the end of the `duel_basic` block — the last statement before its closing `}`:
```typescript
          if (mySetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(myNamedState, isChallenger ? state.cEnergy : state.dEnergy);
        }
```

Replace with:
```typescript
          if (mySetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(myNamedState, isChallenger ? state.cEnergy : state.dEnergy);

          // Forte fills only from Solace's own Chime Strike.
          if (isDevGuild && myActiveUnit === "ally") {
            const forteBefore = mySolaceForte;
            const forteAfter  = addForteCharge(forteBefore, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
            if (isChallenger) state.cSolaceForte = forteAfter; else state.dSolaceForte = forteAfter;
            const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
            const isHalf  = forteAfter.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(forteAfter, SOLACE_FORTE_CONFIG);
            if (isForteMaxed(forteAfter, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
            } else if (isHalf && !wasHalf) {
              moveLine += `\n✨ Forte is **HALF CHARGED**.`;
            }
          }
        }
```

(Read the actual current file to confirm this really is the last statement inside `duel_basic` after Task 3's edits — verify before inserting.)

- [ ] **Step 3: Concerto Energy gain — apply to all move buttons, guarded against the same-turn Convergence refund**

Find (right after the echo-skill block's closing `}`, before `// Apply unique ability effects`):
```typescript
        // Apply unique ability effects
```

Insert immediately before it:
```typescript
        // Concerto Energy builds from combat actions, never from swapping.
        const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
          duel_basic: 10, duel_skill: 20, duel_echoskill: 20, duel_ultimate: 35,
        };
        if (isDevGuild && !convergenceUsedThisTurn) {
          let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
          if (concertoGain > 0 && myActiveUnit === "ally") concertoGain += WELLSPRING_BASE_ENERGY_BONUS;
          if (concertoGain > 0) {
            const newVal = addConcertoEnergy(myConcertoEnergy, concertoGain);
            if (isChallenger) state.cConcertoEnergy = newVal; else state.dConcertoEnergy = newVal;
          }
        }

        // Apply unique ability effects
```

- [ ] **Step 4: Ally-HP routing on the damage-application step, symmetric on both sides**

Find:
```typescript
        // Apply damage to opponent
        if (isChallenger) state.dHp = Math.max(0, state.dHp - damage);
        else              state.cHp = Math.max(0, state.cHp - damage);
```

Replace with:
```typescript
        // Apply damage to opponent — routes into their Solace's HP pool
        // instead of their own HP if their Solace is currently active.
        // Symmetric: both branches need this check, not just one (the
        // biggest copy-paste risk in this file's c*/d* duplication pattern).
        if (isChallenger) {
          if (isDevGuild && state.dActiveUnit === "ally") state.dAllyHp = Math.max(0, state.dAllyHp - damage);
          else                                            state.dHp     = Math.max(0, state.dHp - damage);
        } else {
          if (isDevGuild && state.cActiveUnit === "ally") state.cAllyHp = Math.max(0, state.cAllyHp - damage);
          else                                            state.cHp     = Math.max(0, state.cHp - damage);
        }
```

- [ ] **Step 5: Ally-KO auto-swap-back, on both sides, before Second Wind**

Find:
```typescript
        // Second Wind on opponent (survive lethal once)
        if (isChallenger) {
```

Insert immediately before it:
```typescript
        // Ally KO'd — auto-swap back to the player rather than ending the
        // duel over a benched unit's HP. Checked for whichever side just
        // took damage (the opponent of whoever acted this turn).
        if (isDevGuild) {
          if (isChallenger && state.dActiveUnit === "ally" && state.dAllyHp <= 0) {
            state.dAllyHp = 0; state.dActiveUnit = "player";
            moveLine += `\n◇ **${SOLACE.name} was knocked out** — ${state.challengedName} swapped back.`;
          } else if (!isChallenger && state.cActiveUnit === "ally" && state.cAllyHp <= 0) {
            state.cAllyHp = 0; state.cActiveUnit = "player";
            moveLine += `\n◇ **${SOLACE.name} was knocked out** — ${state.challengerName} swapped back.`;
          }
        }

        // Second Wind on opponent (survive lethal once)
        if (isChallenger) {
```

- [ ] **Step 6: Per-turn decrement of Attunement/Forte duration counters, both sides**

Find:
```typescript
        // Named-set buff timers tick down on the acting player's own turns
        if (isChallenger) {
          if (state.cGlacioShieldTurnsLeft > 0) state.cGlacioShieldTurnsLeft--;
          if (state.cStormBuffTurnsLeft > 0) state.cStormBuffTurnsLeft--;
          if (state.cNamedState.spectroFractureTurnsLeft > 0) state.cNamedState.spectroFractureTurnsLeft--;
          if (state.cEchoSkillCd > 0) state.cEchoSkillCd--;
          if (state.cDefShredTurnsLeft > 0) state.cDefShredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "duel_swap") state.cNextCritArmed = false;
        } else {
          if (state.dGlacioShieldTurnsLeft > 0) state.dGlacioShieldTurnsLeft--;
          if (state.dStormBuffTurnsLeft > 0) state.dStormBuffTurnsLeft--;
          if (state.dNamedState.spectroFractureTurnsLeft > 0) state.dNamedState.spectroFractureTurnsLeft--;
          if (state.dEchoSkillCd > 0) state.dEchoSkillCd--;
          if (state.dDefShredTurnsLeft > 0) state.dDefShredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "duel_swap") state.dNextCritArmed = false;
        }
```

Replace with:
```typescript
        // Named-set buff timers tick down on the acting player's own turns
        if (isChallenger) {
          if (state.cGlacioShieldTurnsLeft > 0) state.cGlacioShieldTurnsLeft--;
          if (state.cStormBuffTurnsLeft > 0) state.cStormBuffTurnsLeft--;
          if (state.cNamedState.spectroFractureTurnsLeft > 0) state.cNamedState.spectroFractureTurnsLeft--;
          if (state.cEchoSkillCd > 0) state.cEchoSkillCd--;
          if (state.cDefShredTurnsLeft > 0) state.cDefShredTurnsLeft--;
          if (isDevGuild && state.cAttunementDoubleTurnsLeft > 0) state.cAttunementDoubleTurnsLeft--;
          if (isDevGuild && state.cForteEmpoweredTurnsLeft > 0) state.cForteEmpoweredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "duel_swap") state.cNextCritArmed = false;
        } else {
          if (state.dGlacioShieldTurnsLeft > 0) state.dGlacioShieldTurnsLeft--;
          if (state.dStormBuffTurnsLeft > 0) state.dStormBuffTurnsLeft--;
          if (state.dNamedState.spectroFractureTurnsLeft > 0) state.dNamedState.spectroFractureTurnsLeft--;
          if (state.dEchoSkillCd > 0) state.dEchoSkillCd--;
          if (state.dDefShredTurnsLeft > 0) state.dDefShredTurnsLeft--;
          if (isDevGuild && state.dAttunementDoubleTurnsLeft > 0) state.dAttunementDoubleTurnsLeft--;
          if (isDevGuild && state.dForteEmpoweredTurnsLeft > 0) state.dForteEmpoweredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "duel_swap") state.dNextCritArmed = false;
        }
```

- [ ] **Step 7: Win-check must key off the player's own HP only, never the ally HP pool**

Find:
```typescript
        // Check win
        const loserHp = isChallenger ? state.dHp : state.cHp;
        if (loserHp <= 0) {
```

Leave as-is — confirm (do not change) that `loserHp` already reads `state.dHp`/`state.cHp` (the player's own pool), NOT `allyHp`. Since Step 4 now sometimes damages `allyHp` instead of `hp`, this win-check is already correct as long as it's untouched: a side can only lose the duel when their own `hp` hits 0, never from their benched Solace's HP hitting 0 (that triggers the Step 5 auto-swap instead). This step is a verification checkpoint, not an edit — if `loserHp` somehow reads from the wrong field, STOP and report BLOCKED rather than guessing.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/duel.ts
git commit -m "feat(teams): wire Solace's Ultimate, Forte fill, Concerto Energy, ally-HP routing, KO auto-swap into /duel (Milestone 3e Task 4)"
```

---

### Task 5: Verification

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
grep -n "isDevGuild" src/commands/rpg/duel.ts    # confirm every new branch is gated
grep -c "duel_swap" src/commands/rpg/duel.ts     # expect at least 6 (button creation ×1 loop, click handler, SPD-first-strike/firstAction×2/nextCritArmed×2 exclusions)
grep -n "state.dAllyHp\|state.cAllyHp" src/commands/rpg/duel.ts   # confirm BOTH sides appear at damage-application AND KO-auto-swap — this is the single highest copy-paste-risk check in this port
```

- [ ] **Step 2: Read the full diff from the pre-Milestone-3e commit to HEAD**

Sanity-check: every new branch that touches one side (`isChallenger` true) has a symmetric counterpart for the other side (`isChallenger` false) — scan specifically for any block that reads/writes `state.c*` without an `else` branch writing the matching `state.d*` (or vice versa). This file's existing `c*`/`d*` duplication makes an asymmetric copy-paste the single most likely bug class here, more so than in any prior milestone (raid/boss/ascend/field-boss are all single-owner-per-fight, so this class of bug couldn't occur there).

- [ ] **Step 3: Manual — deploy and playtest**

No new slash command, so `npm run deploy` isn't needed. On the VM: `git pull && npm run build && pm2 restart cartethyia`.

In the dev guild, run a full duel between 2 real accounts (ideally both with Solace unlocked) and verify:
- [ ] Swap button appears for both sides independently; swapping shows Solace's real row (Chime Strike/Attunement/Convergence/Forfeit); Concerto Energy/Solace HP/debuffs are visible per-side in the embed
- [ ] Swap still costs the swapper's own turn
- [ ] Attunement cycles ATK→CRIT→DEF→ATK on whichever side activates it, affects only that side's own damage/DEF — the opponent's stats are untouched
- [ ] Convergence heals the 2-unit side (player + Solace) correctly, Empowered/normal branches correctly, does NOT refund Concerto Energy the same turn
- [ ] Landing a hit can WEAKEN the opponent (-20% ATK, 2 turns), ticking down correctly, without affecting the attacker's own stats
- [ ] While a side's Solace is active, opponent damage lands on that side's Solace HP pool, not the player's own HP — confirm the duel does NOT end when the ally HP pool hits 0 (auto-swap-back instead) but DOES end when the player's own HP hits 0
- [ ] If both accounts have Solace unlocked, confirm both sides can have her active simultaneously with no cross-talk (no bleed of one side's Attunement/Forte bonuses into the other's damage)
- [ ] Non-dev-guild `/duel` is completely unaffected

- [ ] **Step 4: Report findings back**

Same as every prior milestone — if something's off, describe exactly what you saw and I'll fix it directly.
