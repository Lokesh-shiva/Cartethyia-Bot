# Milestone 1 — Team Mechanics in `/encounter` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the multi-unit team mechanic (swap, Intro/Outro, Concerto Energy, debuffs — all built as isolated primitives in Milestone 0) actually works inside ONE real combat loop, gated to the dev guild only. Use a single hardcoded placeholder ally ("Training Dummy") — not real character content, that's Milestone 2.

**Architecture:** `/encounter` (`src/lib/encounter.ts`) is chosen because it's the simplest existing combat loop (no named-set state, per the project's own conventions). Scope is deliberately narrow:
- Only the player's own character can act on their turn. The benched unit (dummy or player) sits out — no AI-driven ally turn, that's out of scope.
- Swap costs the turn (per design spec §4.2) and fires both Outro (outgoing) + Intro (incoming) via Milestone 0's `resolveIntroOutroEffect`.
- Visual treatment stays minimal: the existing single-unit `battleCard.ts` render is reused unchanged for whoever's active; the benched unit's HP is shown as a plain text line in the embed. No new canvas work — that's a separate future pass once the mechanic itself is proven.
- Everything here is gated behind `interaction.guildId === process.env.GUILD_ID` (the existing dev-guild env var, already used at deploy-time per `deploy-commands.ts`) — every other server keeps the exact current 1v1 `/encounter` behavior, byte-for-byte unchanged.

**Tech Stack:** TypeScript, discord.js, the four Milestone 0 modules (`debuffs.ts`, `concertoEnergy.ts`, `allyActions.ts`, `introOutro.ts`). No schema changes — all state is in-memory per-fight, matching the existing pattern (`shatterTurnsLeft`, `firstActionDone`, etc. are already plain closure variables in `handleEncounterFight`).

---

### Task 1: Placeholder Ally + Player-Self Intro/Outro Constants

**Files:**
- Create: `src/lib/placeholderAlly.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/placeholderAlly.ts
// Milestone 1 test fixture — a single hardcoded teammate used ONLY to prove the
// multi-unit swap mechanic works in one real combat loop. NOT real character
// content (that's Milestone 2's Solace). Delete or replace this file once real
// banner characters exist.
//
// Also defines the player's own character's Intro/Outro — per design spec §2,
// the player's personalized character gets a universal, generic, non-authored
// pair (not a real kit) so the "swap = Outro + Intro" turn-cost payoff doesn't
// structurally break for 1 of every team's slots.

import { IntroOutroEffect } from "./introOutro";

export const PLACEHOLDER_ALLY = {
  name:  "Training Dummy",
  hpMax: 800,
  intro: { actions: [{ type: "HEAL_ALLY", value: 0.15 }] } as IntroOutroEffect,
  outro: { actions: [{ type: "SHIELD_ALLY", value: 0.10 }] } as IntroOutroEffect,
};

export const PLAYER_SELF_INTRO: IntroOutroEffect = { actions: [{ type: "HEAL_ALLY", value: 0.05 }] };
export const PLAYER_SELF_OUTRO: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.05 }] };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors (this file has no runtime behavior to test standalone — it's pure data, verified by the integration tasks that consume it)

- [ ] **Step 3: Commit**

```bash
git add src/lib/placeholderAlly.ts
git commit -m "feat(teams): add Milestone 1 placeholder ally + player-self Intro/Outro"
```

---

### Task 2: Two-Unit State + Dev-Guild Gate + Swap Button

**Files:**
- Modify: `src/commands/rpg/encounter.ts` — wait, actually `src/lib/encounter.ts` (the file containing `handleEncounterFight`)

**Context:** `handleEncounterFight` currently declares a block of closure state right after resolving `bonuses`/`stats` (around the existing `let secondWindUsed = false;` and the `ENERGY_PER_TURN`/`SKILL_COOLDOWN` block). This task adds the 2-unit state alongside it, and restructures `buildEncounterButtons()` to return an array of rows instead of a single row (needed for a second row containing the Swap button — Discord caps at 5 buttons per row, and the existing row can already hit 5 with Basic/Skill/Ultimate/EchoSkill/Flee).

- [ ] **Step 1: Add the dev-guild gate + 2-unit state**

Find this existing block in `src/lib/encounter.ts` (right after `const displayName = ...` and before `const bonuses = await resolvePlayerBonuses(...)`):

```typescript
  const displayName = (interaction.member as any)?.displayName ?? interaction.user.displayName;

  // Resolve full combat stats (echoes + weapon + set bonuses + unique ability)
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
```

Insert the dev-guild gate directly above it:

```typescript
  const displayName = (interaction.member as any)?.displayName ?? interaction.user.displayName;

  // Milestone 1: team mechanics (swap, Intro/Outro, Concerto Energy, debuffs) are
  // gated to the dev guild only. Every other server keeps the exact current 1v1
  // /encounter flow, byte-for-byte unchanged. See design spec + Milestone 1 plan.
  const isDevGuild = interaction.guildId === process.env.GUILD_ID;

  // Resolve full combat stats (echoes + weapon + set bonuses + unique ability)
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
```

Then find this existing block (right after `let secondWindUsed = false;`):

```typescript
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
  const stats   = applyBonuses(dbUser, bonuses);
  let secondWindUsed = false;
```

Replace it with:

```typescript
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
  const stats   = applyBonuses(dbUser, bonuses);
  let secondWindUsed = false;

  // ── Milestone 1: two-unit team state (dev guild only) ────────────────────────
  let activeUnit: "player" | "ally" = "player";
  let allyHp    = PLACEHOLDER_ALLY.hpMax;
  const allyHpMax = PLACEHOLDER_ALLY.hpMax;
  let concertoEnergy: number = 0;
  let playerDebuffs: DebuffState = [];
```

- [ ] **Step 2: Add the new imports**

Find the existing import block at the top of the file:

```typescript
import { echoSkillBaseMult, applyEchoSkill } from "./echoSkills";
import { generateEchoCard, echoRowToCard } from "./echoCard";
```

Replace with:

```typescript
import { echoSkillBaseMult, applyEchoSkill } from "./echoSkills";
import { generateEchoCard, echoRowToCard } from "./echoCard";
import { PLACEHOLDER_ALLY, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO } from "./placeholderAlly";
import { resolveIntroOutroEffect } from "./introOutro";
import { AllyActionTarget } from "./allyActions";
import { addConcertoEnergy } from "./concertoEnergy";
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult } from "./debuffs";
```

Note: `spendConcertoEnergy` and `cleanseDebuffs` (both built in Milestone 0) are deliberately NOT imported here — this milestone only accumulates and displays Concerto Energy (no team-ultimate spend mechanic exists yet), and the placeholder ally's Intro/Outro don't include a `CLEANSE_ALLY` action. Both will get real callers once Milestone 2 builds a character whose kit actually uses them.

- [ ] **Step 3: Restructure `buildEncounterButtons()` to return rows, and add the Swap row**

Find the existing function:

```typescript
  function buildEncounterButtons(): ActionRowBuilder<ButtonBuilder> {
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
    return row;
  }
```

Replace with:

```typescript
  function buildEncounterButtons(): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

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

- [ ] **Step 4: Update both call sites that use `buildEncounterButtons()`**

Find (the initial battle message send):

```typescript
    return (interaction.channel as TextChannel).send({ embeds: [embed], files: [attach], components: [buildEncounterButtons()] });
```

Replace with:

```typescript
    return (interaction.channel as TextChannel).send({ embeds: [embed], files: [attach], components: buildEncounterButtons() });
```

Find (the next-turn edit, near the end of the collector handler):

```typescript
      await battleMsg!.edit({
        embeds: [embed], files: [attach],
        components: [buildEncounterButtons()],
        attachments: [],
      } as any).catch(() => {});
```

Replace with:

```typescript
      await battleMsg!.edit({
        embeds: [embed], files: [attach],
        components: buildEncounterButtons(),
        attachments: [],
      } as any).catch(() => {});
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors. (No runtime behavior change yet for non-dev-guild servers — `buildEncounterButtons()` still returns a single-row array there, equivalent to before. This step only adds state and UI scaffolding; the swap button doesn't do anything yet until Task 3.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): add dev-guild-gated 2-unit state + swap button UI to /encounter"
```

---

### Task 3: Swap Handler — Intro/Outro Resolution + Turn Consumption

**Context:** The existing collector handler computes `playerDmg`/`moveName` per button type (`enc_basic`/`enc_skill`/`enc_ultimate`/`enc_echoskill`), then falls through into shared post-processing (unique-ability effects, vib drain, HP loss, shatter check, win check) before reaching the enemy-turn block. The Swap branch deals no damage, so it needs to skip that damage-specific block but still fall through to the enemy-turn/turn-increment logic, since swapping consumes the turn.

**Files:**
- Modify: `src/lib/encounter.ts`

- [ ] **Step 1: Hoist `forcedCritActive` out of the section about to be wrapped**

**Correction (caught during implementation, before this was committed):** `forcedCritActive` is declared `const` inside the damage-dealing section that Step 2 below wraps in a new `else {}` block, but it's read again later in the turn-increment logic (`if (forcedCritActive) nextAttackCritArmed = false;`), which sits OUTSIDE that block. Wrapping the section as originally planned would make `forcedCritActive` go out of scope at that later read site — a real `tsc` error, not a style nit. Fix: hoist it to a `let` declared before the swap check, defaulting to `false` (a swap never arms/consumes a forced crit, which is also the semantically correct behavior — no attack happened on a swap turn).

Find this existing block (top of the button collector, right after `deferUpdate()`):

```typescript
      let moveName = "";
      let playerDmg = 0;

      if (btn.customId === "enc_flee") {
```

Replace with:

```typescript
      let moveName = "";
      let playerDmg = 0;
      let forcedCritActive = false; // set inside the damage-dealing branch below; a swap never arms/consumes it

      if (btn.customId === "enc_flee") {
```

Then find this existing line (inside the damage-dealing section, right after the `defShredActive`/`defVal`/`enemyHpPct`/`radCrit`/`cRate`/`vibMult` block):

```typescript
      const forcedCritActive = nextAttackCritArmed && btn.customId !== "enc_flee";
```

Replace with:

```typescript
      forcedCritActive = nextAttackCritArmed && btn.customId !== "enc_flee";
```

(Same expression, just an assignment to the hoisted `let` instead of a new `const` declaration — this is the only change needed to fix the scoping bug.)

- [ ] **Step 2: Add the swap branch**

Find this existing block (right after the `enc_flee` early-return, before the `defShredActive`/`defVal` computation):

```typescript
      if (btn.customId === "enc_flee") {
        removeEncounter(interaction.message.id);
        const fleeEmbed = new EmbedBuilder()
          .setColor(0x4A4A5A)
          .setDescription(`*${displayName} retreated. The echo dissipates into the ether.*`)
          .setFooter({ text: "CARTETHYIA  ·  Encounter" });
        await battleMsg!.edit({ embeds: [fleeEmbed], components: [], files: [] }).catch(() => {});
        return;
      }

      const defShredActive = enemyDefShredTurnsLeft > 0;
```

Replace with:

```typescript
      if (btn.customId === "enc_flee") {
        removeEncounter(interaction.message.id);
        const fleeEmbed = new EmbedBuilder()
          .setColor(0x4A4A5A)
          .setDescription(`*${displayName} retreated. The echo dissipates into the ether.*`)
          .setFooter({ text: "CARTETHYIA  ·  Encounter" });
        await battleMsg!.edit({ embeds: [fleeEmbed], components: [], files: [] }).catch(() => {});
        return;
      }

      // ── Milestone 1: swap — consumes the turn, fires Outro (outgoing) + Intro
      // (incoming) via the Milestone 0 primitives. Falls through to the shared
      // enemy-turn block below (skipping the damage-dealing section, since a
      // swap deals no damage) since swapping still costs the turn. ─────────────
      if (btn.customId === "enc_swap" && isDevGuild) {
        const outgoingIsPlayer = activeUnit === "player";
        const incomingTarget: AllyActionTarget = outgoingIsPlayer
          ? { hp: allyHp, hpMax: allyHpMax }
          : { hp: state.playerHp, hpMax: state.playerHpMax };

        const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : PLACEHOLDER_ALLY.outro;
        const introEffect = outgoingIsPlayer ? PLACEHOLDER_ALLY.intro : PLAYER_SELF_INTRO;
        const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
        const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

        // Milestone 1 has no separate shield stat yet — shieldDelta is folded
        // into a flat HP bonus, capped at max HP like a heal. Real shield state
        // (absorbing damage before HP) is a later-milestone concern once a
        // second real character exists to make the distinction matter.
        const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;

        if (outgoingIsPlayer) {
          allyHp = Math.min(allyHpMax, allyHp + totalBonus);
        } else {
          state.playerHp = Math.min(state.playerHpMax, state.playerHp + totalBonus);
        }

        concertoEnergy = addConcertoEnergy(concertoEnergy, 15);
        activeUnit = outgoingIsPlayer ? "ally" : "player";
        moveName = `🔄 Swapped to **${outgoingIsPlayer ? PLACEHOLDER_ALLY.name : displayName}** — Outro + Intro triggered, +${totalBonus} HP.`;
        state.lastMove = moveName;
      } else {

      const defShredActive = enemyDefShredTurnsLeft > 0;
```

Note the added `} else {` at the end — this wraps the ENTIRE existing damage-dealing section (from `defShredActive` through the shatter-check block) so it's skipped on swap. The matching closing brace goes in Step 2.

- [ ] **Step 3: Close the wrapping `else` block before the win-check section**

Find this existing block (the shatter-check, right before "── Win ──"):

```typescript
      if (state.bossVibNow <= 0 && !state.isShattered) {
        state.isShattered = true;
        shatterTurnsLeft  = 2;
        moveName += "\n✦ **SHATTER!** Echo stunned — all hits critical!";
        const voidHeal = elemVoidSurgeHeal(bonuses.elementPassive, state.playerHpMax);
        if (voidHeal > 0) {
          state.playerHp = Math.min(state.playerHpMax, state.playerHp + voidHeal);
          moveName += `\n✦ **Void Surge** — +${voidHeal} HP!`;
        }
      }

      state.lastMove = moveName;

      // ── Win ────────────────────────────────────────────────────────────────
```

Replace with:

```typescript
      if (state.bossVibNow <= 0 && !state.isShattered) {
        state.isShattered = true;
        shatterTurnsLeft  = 2;
        moveName += "\n✦ **SHATTER!** Echo stunned — all hits critical!";
        const voidHeal = elemVoidSurgeHeal(bonuses.elementPassive, state.playerHpMax);
        if (voidHeal > 0) {
          state.playerHp = Math.min(state.playerHpMax, state.playerHp + voidHeal);
          moveName += `\n✦ **Void Surge** — +${voidHeal} HP!`;
        }
      }

      state.lastMove = moveName;

      } // end of the damage-dealing else-branch opened in the swap check above

      // ── Win ────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Guard the win-check against a dead player's own damage while the ally is benched**

The existing win-check (`if (state.bossHpNow <= 0) { ... }`) is unaffected by this change — `state.bossHpNow` only decreases in the damage-dealing branch, which swap skips, so a swap turn can never trigger a win. No code change needed here — just confirming this is correct by inspection.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): wire swap handler — Intro/Outro resolution, turn consumption"
```

---

### Task 4: Debuffs + Concerto Energy Display

**Context:** Adds one debuff interaction (the enemy has a chance to apply WEAKENED to whoever's currently active) and folds it into the player's own damage calculation, plus shows Concerto Energy as a text line. This is the piece that actually exercises Milestone 0's `debuffs.ts` inside a real fight, not just the earlier isolated simulation.

**Files:**
- Modify: `src/lib/encounter.ts`

- [ ] **Step 1: Apply `getWeakenedMult` to the player's own damage**

Find each of the three damage-calc lines (Basic/Skill/Ultimate — inside the `else` branch from Task 3, i.e. still indented one level deeper than before):

```typescript
      if (btn.customId === "enc_basic") {
        const r  = calcPlayerDamage(stats.atk, defVal, forcedCritActive ? 1 : cRate, stats.critDmg, 1.0, isWeak, state.isShattered);
```

Replace with:

```typescript
      if (btn.customId === "enc_basic") {
        const r  = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, forcedCritActive ? 1 : cRate, stats.critDmg, 1.0, isWeak, state.isShattered);
```

Find:

```typescript
      if (btn.customId === "enc_skill") {
        const r  = calcPlayerDamage(stats.atk, defVal, forcedCritActive ? 1 : Math.min(1, cRate + 0.1), stats.critDmg, 1.8, isWeak, state.isShattered);
```

Replace with:

```typescript
      if (btn.customId === "enc_skill") {
        const r  = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, forcedCritActive ? 1 : Math.min(1, cRate + 0.1), stats.critDmg, 1.8, isWeak, state.isShattered);
```

Find:

```typescript
      if (btn.customId === "enc_ultimate") {
        const r = calcPlayerDamage(stats.atk, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

Replace with:

```typescript
      if (btn.customId === "enc_ultimate") {
        const r = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
```

Basic/Skill/Ultimate also feed `elemIgniteProc(bonuses.elementPassive, stats.atk)` right after — leave those calls using raw `stats.atk` unchanged (Ignite is a separate proc effect, not part of the base hit being weakened; scoping WEAKENED to only the direct attack roll keeps this change small and its effect easy to verify by eye during manual testing).

- [ ] **Step 2: Enemy has a chance to apply WEAKENED, and debuffs tick each round**

Find this existing block (the enemy-turn section):

```typescript
      } else {
        const move     = boss.moves[Math.floor(Math.random() * boss.moves.length)];
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def, move.damage);
        const shield   = elemFrostShield(bonuses.elementPassive, bossDmg);
        bossDmg        = shield.dmg;
        state.playerHp = Math.max(0, state.playerHp - bossDmg);
        const radRegen = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
        if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
        state.lastMove += `\n◇ ${enc.enemy.name} ${move.effect} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + 15);
      }
```

Replace with:

```typescript
      } else {
        const move     = boss.moves[Math.floor(Math.random() * boss.moves.length)];
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def, move.damage);
        const shield   = elemFrostShield(bonuses.elementPassive, bossDmg);
        bossDmg        = shield.dmg;
        state.playerHp = Math.max(0, state.playerHp - bossDmg);
        const radRegen = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
        if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
        state.lastMove += `\n◇ ${enc.enemy.name} ${move.effect} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + 15);

        // Milestone 1: exercises the Milestone 0 debuff system inside a real fight.
        // 25% chance per enemy attack, only when the dev-guild team mechanics are
        // active — keeps this invisible to every other server.
        if (isDevGuild && Math.random() < 0.25) {
          playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.2, 2);
          state.lastMove += `\n◇ *${enc.enemy.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
        }
      }

      if (isDevGuild) {
        const tickResult = tickDebuffs(playerDebuffs);
        playerDebuffs = tickResult.state;
        // No BLEED sources exist yet in this milestone, but tickDebuffs still
        // needs calling every round to decrement WEAKENED's duration correctly.
      }
```

- [ ] **Step 3: Show Concerto Energy + debuff status + benched ally HP as text under the battle card**

Find this existing block (the initial battle message embed):

```typescript
  let battleMsg = await (async () => {
    const buf    = await generateBattleCard(state);
    const attach = new AttachmentBuilder(buf, { name: "encounter.webp" });
    const embed  = new EmbedBuilder()
      .setColor(ELEMENT_COLORS[enc.enemy.element])
      .setImage("attachment://encounter.webp");
    return (interaction.channel as TextChannel).send({ embeds: [embed], files: [attach], components: buildEncounterButtons() });
  })();
```

Replace with:

```typescript
  function teamStatusLine(): string {
    if (!isDevGuild) return "";
    const benchedName = activeUnit === "player" ? PLACEHOLDER_ALLY.name : displayName;
    const benchedHp   = activeUnit === "player" ? allyHp : state.playerHp;
    const benchedMax  = activeUnit === "player" ? allyHpMax : state.playerHpMax;
    const debuffLine  = playerDebuffs.length > 0
      ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
      : "";
    return `\n\n🔄 Benched: **${benchedName}** — ${benchedHp}/${benchedMax} HP  ·  ` +
           `Concerto Energy: **${concertoEnergy}/100**${debuffLine}`;
  }

  let battleMsg = await (async () => {
    const buf    = await generateBattleCard(state);
    const attach = new AttachmentBuilder(buf, { name: "encounter.webp" });
    const embed  = new EmbedBuilder()
      .setColor(ELEMENT_COLORS[enc.enemy.element])
      .setImage("attachment://encounter.webp")
      .setDescription(teamStatusLine() || null);
    return (interaction.channel as TextChannel).send({ embeds: [embed], files: [attach], components: buildEncounterButtons() });
  })();
```

Find this existing block (the next-turn embed, near the end of the collector handler):

```typescript
      const buf    = await generateBattleCard(state);
      const attach = new AttachmentBuilder(buf, { name: "encounter.webp" });
      const embed  = new EmbedBuilder()
        .setColor(ELEMENT_COLORS[enc.enemy.element])
        .setImage("attachment://encounter.webp");
      await battleMsg!.edit({
```

Replace with:

```typescript
      const buf    = await generateBattleCard(state);
      const attach = new AttachmentBuilder(buf, { name: "encounter.webp" });
      const embed  = new EmbedBuilder()
        .setColor(ELEMENT_COLORS[enc.enemy.element])
        .setImage("attachment://encounter.webp")
        .setDescription(teamStatusLine() || null);
      await battleMsg!.edit({
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/encounter.ts
git commit -m "feat(teams): wire debuffs + Concerto Energy display into /encounter"
```

---

### Task 5: Verification

**This milestone genuinely needs manual Discord testing — there is no automated substitute for verifying live button interactions.** This task covers what CAN be automated, plus a concrete manual checklist for what can't.

- [ ] **Step 1: Automated — typecheck + confirm non-dev-guild behavior is unchanged**

Run: `npx tsc --noEmit`
Expected: clean.

Run:
```bash
grep -n "isDevGuild" src/lib/encounter.ts
```
Expected: every new branch of behavior (swap button, debuff application, team status line, dummy-only-swap-button restriction) is gated behind `isDevGuild`. Manually re-read each `isDevGuild` check to confirm: when `isDevGuild` is `false`, `buildEncounterButtons()` returns exactly the same single row as before this milestone, and no debuff/Concerto Energy/swap code paths can execute. This is the automated proxy for "every other server's `/encounter` is byte-for-byte unchanged."

- [ ] **Step 2: Manual — deploy to dev guild and playtest**

```bash
npm run deploy
```
(non-global deploy, targets `GUILD_ID` per `deploy-commands.ts` — no code change here activates the new behavior for any other server regardless of deploy scope, since it's gated by `interaction.guildId` at runtime, not by command registration)

In the dev guild, trigger a chat encounter and fight it. Verify:
- [ ] The Swap button appears as a second row below the normal Basic/Skill/Ultimate/Flee row
- [ ] Clicking Swap switches the active unit, consumes the turn (the enemy attacks immediately after), and the embed description shows the Outro+Intro heal amount
- [ ] While the Training Dummy is active, only Swap and Flee are available (no Basic/Skill/Ultimate)
- [ ] The benched unit's HP and Concerto Energy show correctly in the embed text below the battle card image
- [ ] After a few enemy turns, WEAKENED sometimes applies (visible in the embed text) and visibly reduces the player's next attack's damage number compared to an un-weakened hit
- [ ] The debuff's turn counter decrements and it expires after 2 turns
- [ ] Confirm in a NON-dev-guild server (or by temporarily testing with a different `GUILD_ID`) that `/encounter` looks and behaves exactly as it did before this milestone — no Swap button, no team status line

- [ ] **Step 3: Report findings back**

If manual testing reveals a bug, fix it directly (this is UI/live-behavior verification, not something to re-delegate) and re-run Step 2's checklist from the top.
