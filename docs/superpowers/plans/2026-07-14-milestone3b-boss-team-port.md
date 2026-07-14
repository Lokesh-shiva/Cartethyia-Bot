# Milestone 3b — Team Mechanics in /boss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the fully-built `/encounter`/`/dungeon` team-combat system into `/boss`. Dev-guild-gated, matching every prior milestone's staging discipline.

**Architecture:** `src/commands/rpg/boss.ts` is a single continuous fight (no waves) using per-turn message recreation (a no-argument `runTurn()` closure that sends a new message + fresh single-use collector each turn, then recurses — same turn-loop shape as `/dungeon`), but its damage math and team state live as **plain closure variables** (like `/encounter`'s `let state = ...`), not threaded through a parameter object across function-call boundaries (unlike `/dungeon`'s `WaveState`/`WaveResult`, which existed because `/dungeon` needed to carry state across separate `runWave()` calls per wave — `/boss` has no such boundary, `runTurn()` is a single closure for the whole fight). Team state is therefore just more `let` declarations alongside the existing ones (`firstSkillUsed`, `isEnraged`, etc.), referenced directly by name everywhere — simpler than `/dungeon`'s port.

**Every lesson from Milestone 3a's bug-fix history is applied from the start in this plan** (not discovered after the fact): swap falls through to the shared tail from Task 2 onward; `firstActionDone`/Quick-Strike/crit-reset correctly exclude swap (and Quick-Strike also excludes Convergence) from the moment those branches are written; WEAKENED is fully wired (tick + apply + fold into damage) in the same task that adds Convergence, not left as a dangling import; `teamStatusLine()` ships in Task 1 alongside the state it displays; Convergence's `concertoEnergy = 0` is guarded against the same-turn generic-gain refund from the moment that gain logic is written.

See the [design spec](../specs/2026-07-14-milestone3b-boss-team-port-design.md) for full rationale.

**Tech Stack:** TypeScript. Reuses every function already built for `/encounter`/`/dungeon` — `solace.ts`, `attunement.ts`, `wellspring.ts`, `forte.ts`, `characterProgress.ts`, `debuffs.ts` — with zero changes to any of those files. Only `src/commands/rpg/boss.ts` is modified.

---

### Task 1: Dev-Guild Gate, Team State, Button/Embed Plumbing

**Files:**
- Modify: `src/commands/rpg/boss.ts`

- [ ] **Step 1: Add imports**

Find (the last import line):
```typescript
import { echoSkillBaseMult, applyEchoSkill } from "../../lib/echoSkills";
```

Replace with:
```typescript
import { echoSkillBaseMult, applyEchoSkill } from "../../lib/echoSkills";
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

- [ ] **Step 2: Extend `sendBattleCard` to accept team status text and a multi-row button array**

Find:
```typescript
async function sendBattleCard(
  thread: TextChannel | ThreadChannel,
  state: BattleCardState,
  buttons: ActionRowBuilder<ButtonBuilder>,
) {
  const buffer = await generateBattleCard(state);
  const attach = new AttachmentBuilder(buffer, { name: "battle.webp" });
  const embed  = new EmbedBuilder()
    .setColor(ELEMENT_HEX[state.playerElement] ?? 0x6366F1)
    .setImage("attachment://battle.webp");
  return thread.send({ embeds: [embed], files: [attach], components: [buttons] });
}
```

Replace with:
```typescript
async function sendBattleCard(
  thread: TextChannel | ThreadChannel,
  state: BattleCardState,
  buttons: ActionRowBuilder<ButtonBuilder>[],
  teamStatus?: string,
) {
  const buffer = await generateBattleCard(state);
  const attach = new AttachmentBuilder(buffer, { name: "battle.webp" });
  const embed  = new EmbedBuilder()
    .setColor(ELEMENT_HEX[state.playerElement] ?? 0x6366F1)
    .setImage("attachment://battle.webp")
    .setDescription(teamStatus || null);
  return thread.send({ embeds: [embed], files: [attach], components: buttons });
}
```

- [ ] **Step 3: Extend `buildButtons` to return an array of rows, with Solace's row + Swap row**

Find:
```typescript
function buildButtons(
  state: BattleCardState,
  echoSkill?: { name: string; cooldown: number } | null,
): ActionRowBuilder<ButtonBuilder> {
  const skillReady = state.skillCooldown === 0;
  const ultReady   = state.playerEnergy >= 100;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("boss_skill")
      .setLabel(skillReady ? "✦  Resonance Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
      .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
    new ButtonBuilder()
      .setCustomId("boss_ultimate").setLabel("⚡  Ultimate")
      .setStyle(ButtonStyle.Success).setDisabled(!ultReady),
  );
  if (echoSkill) {
    const echoReady = echoSkill.cooldown === 0;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("boss_echoskill")
        .setLabel(echoReady ? `🌀  ${echoSkill.name}` : `🌀  ${echoSkill.name} (${echoSkill.cooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
  );
  return row;
}
```

Replace with:
```typescript
interface TeamButtonContext {
  isDevGuild: boolean;
  activeUnit: "player" | "ally";
  displayName: string;
  attunement: AttunementState;
  concertoEnergy: number;
}

function buildButtons(
  state: BattleCardState,
  echoSkill?: { name: string; cooldown: number } | null,
  team?: TeamButtonContext | null,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (team?.isDevGuild && team.activeUnit === "ally") {
    const modeLabel = team.attunement.mode ? `(${team.attunement.mode})` : "(inactive)";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("boss_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("boss_ultimate").setLabel("⚡  Convergence")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const skillReady = state.skillCooldown === 0;
    const ultReady   = state.playerEnergy >= 100;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("boss_skill")
        .setLabel(skillReady ? "✦  Resonance Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder()
        .setCustomId("boss_ultimate").setLabel("⚡  Ultimate")
        .setStyle(ButtonStyle.Success).setDisabled(!ultReady),
    );
    if (echoSkill) {
      const echoReady = echoSkill.cooldown === 0;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("boss_echoskill")
          .setLabel(echoReady ? `🌀  ${echoSkill.name}` : `🌀  ${echoSkill.name} (${echoSkill.cooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    );
    rows.push(row);
  }

  if (team?.isDevGuild) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_swap")
        .setLabel(team.activeUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${team.displayName}`)
        .setStyle(ButtonStyle.Secondary),
    ));
  }

  return rows;
}
```

- [ ] **Step 4: Add the dev-guild gate + `CharacterProgress` fetch + team state, right after the existing per-fight state block**

Find:
```typescript
      // ── State ────────────────────────────────────────────────────────────────
      let firstSkillUsed  = false;
      let firstActionDone = false;
      let v2Stacks        = 0;
      let secondWindUsed  = false;
      let isEnraged       = false;
      let shatterTurnsLeft = 0;
      let quickStrikeUsed  = false; // SPD-driven bonus action — once per fight
      let battleMsg: any   = null;
```

Replace with:
```typescript
      // ── State ────────────────────────────────────────────────────────────────
      let firstSkillUsed  = false;
      let firstActionDone = false;
      let v2Stacks        = 0;
      let secondWindUsed  = false;
      let isEnraged       = false;
      let shatterTurnsLeft = 0;
      let quickStrikeUsed  = false; // SPD-driven bonus action — once per fight
      let battleMsg: any   = null;

      // ── Milestone 3b: team state (dev guild only) ─────────────────────────────
      const isDevGuild = interaction.guildId === process.env.GUILD_ID;
      const solaceProgress = isDevGuild ? await getOrCreateCharacterProgress(interaction.user.id, "solace") : null;
      const solaceBasicLevel    = solaceProgress?.basicLevel    ?? 1;
      const solaceSkillLevel    = solaceProgress?.skillLevel    ?? 1;
      const solaceUltimateLevel = solaceProgress?.ultimateLevel ?? 1;
      const solaceIntroLevel    = solaceProgress?.introLevel    ?? 1;
      const solaceForteLevel    = solaceProgress?.forteLevel    ?? 1;
      let activeUnit: "player" | "ally" = "player";
      let allyHp    = SOLACE.hpMax;
      const allyHpMax = SOLACE.hpMax;
      let concertoEnergy: number = 0;
      let playerDebuffs: DebuffState = [];
      let attunement: AttunementState = { mode: null };
      let attunementDoubleTurnsLeft = 0;
      let solaceForte: ForteState = { phase: 0, charge: 0 };
      let forteEmpoweredTurnsLeft = 0;

      function teamStatusLine(): string {
        if (!isDevGuild) return "";
        const benchedName = activeUnit === "player" ? SOLACE.name : displayName;
        const benchedHp   = activeUnit === "player" ? allyHp : state.playerHp;
        const benchedMax  = activeUnit === "player" ? allyHpMax : state.playerHpMax;
        const debuffLine  = playerDebuffs.length > 0
          ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
          : "";
        return `\n\n🔄 Benched: **${benchedName}** — ${benchedHp}/${benchedMax} HP  ·  ` +
               `Concerto Energy: **${concertoEnergy}/100**${debuffLine}`;
      }

      function teamButtonContext(): TeamButtonContext {
        return { isDevGuild, activeUnit, displayName, attunement, concertoEnergy };
      }
```

(`state` — the `BattleCardState` object — is declared a few lines below this block in the actual file; `teamStatusLine`'s reference to `state.playerHp`/`state.playerHpMax` is fine since both functions are declared in the same enclosing scope and JS closures resolve `state` at call time, not declaration time — same reasoning `/encounter`'s own `teamStatusLine()` relies on.)

- [ ] **Step 5: Update every call site of `buildButtons`/`sendBattleCard` to pass the team context and status line**

Run: `grep -n "buildButtons(state\|sendBattleCard(thread" src/commands/rpg/boss.ts`

At EACH `buildButtons(state, ...)` call site, add `teamButtonContext()` as the 3rd argument. At EACH `sendBattleCard(thread as any, ..., buildButtons(...))` call site, add `teamStatusLine()` as the trailing argument. There are 3 expected call sites: the top of `runTurn()`, the Win-path inline send, and the Lose-path inline send — update all 3 consistently.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, or close to it — this task only adds plumbing, doesn't yet reference team state inside the collector's damage-calculation logic. If errors appear, they should be scoped to the 3 call sites needing the new arguments (fix them) — report BLOCKED if anything else appears.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/boss.ts
git commit -m "feat(teams): add dev-guild-gated team state + button/embed plumbing to /boss (Milestone 3b Task 1)"
```

---

### Task 2: Swap Handler

**Files:**
- Modify: `src/commands/rpg/boss.ts`

**Context:** Place the swap branch as a SIBLING `if` alongside `boss_basic`/`boss_skill`/`boss_ultimate` (i.e. AFTER the shared per-turn prelude that computes `abilCtxBase`/`defReduction`/etc., NOT before it, and definitely not with its own independent message-send-and-return) — this is the exact lesson from Milestone 3a's Critical bug: swap must fall through to the shared Win-check/Boss-turn/decrements/Lose-check/`runTurn()`-recursion tail, never return early.

- [ ] **Step 1: Add the swap branch**

Find (the `boss_basic` branch's opening — insert your new branch immediately BEFORE this line):
```typescript
          if (btn.customId === "boss_basic") {
            const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
```

Insert immediately before it:
```typescript
          // Milestone 3b: swap — always consumes the turn, falls through to the
          // shared tail below (Win-check/Boss-turn/decrements/Lose-check/next
          // turn), same as every other action. Ported from encounter.ts's
          // Milestone 1/2a swap handler.
          if (btn.customId === "boss_swap" && isDevGuild) {
            const outgoingIsPlayer = activeUnit === "player";
            const comboReady = concertoEnergy >= 100;

            if (comboReady) {
              const incomingTarget: AllyActionTarget = outgoingIsPlayer
                ? { hp: allyHp, hpMax: allyHpMax }
                : { hp: state.playerHp, hpMax: state.playerHpMax };

              const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
              const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(solaceIntroLevel) : PLAYER_SELF_INTRO;
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
              concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART in encounter.ts
            } else {
              moveName = `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Concerto Energy not full, no combo triggered.`;
            }

            activeUnit = outgoingIsPlayer ? "ally" : "player";
            playerDmg = 0;
          }

          if (btn.customId === "boss_basic") {
            const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
```

Note: `moveName`/`playerDmg` must already be declared as `let` in the enclosing collector scope before this point (they are — check the top of the `collector.on("collect", ...)` handler) — if the actual variable names differ, use whatever the real names are.

**Do NOT** add a `return` anywhere in this branch, and do NOT independently call `sendBattleCard`/`thread.send` inside it — it must fall through to the exact same shared tail every other action (`boss_basic`/`boss_skill`/`boss_ultimate`/`boss_echoskill`) already falls through to (the V2-regen/Quick-Strike/`firstActionDone`/Win-check/Boss-turn/decrement/Lose-check/`runTurn()` sequence further down in the same handler).

- [ ] **Step 2: Exclude swap from `firstActionDone`, Quick Strike, and the `nextAttackCritArmed` reset**

Find:
```typescript
          // SPD quick-strike — once per fight, if invested SPD clears the boss's derived SPD
          if (!quickStrikeUsed && btn.customId !== "boss_flee" && hasQuickStrike(stats.spd, fightLevel)) {
```

Replace with:
```typescript
          // SPD quick-strike — once per fight, if invested SPD clears the boss's derived SPD
          if (!quickStrikeUsed && btn.customId !== "boss_flee" && btn.customId !== "boss_swap" && hasQuickStrike(stats.spd, fightLevel)) {
```

Find:
```typescript
          firstActionDone = true;
```

Replace with:
```typescript
          if (btn.customId !== "boss_swap") firstActionDone = true;
```

Find:
```typescript
          if (forcedCritActive) nextAttackCritArmed = false;
```

Replace with:
```typescript
          if (forcedCritActive && btn.customId !== "boss_swap") nextAttackCritArmed = false;
```

(These three exclusions are applied NOW, from the start — Milestone 3a needed a whole separate fix-round to add them after the fact; this plan builds them in immediately.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, or errors only about team-state functions not yet fully wired elsewhere (Tasks 3-4). If the swap branch itself has an error, fix it now — don't defer.

- [ ] **Step 4: Commit**

```bash
git add src/commands/rpg/boss.ts
git commit -m "feat(teams): wire swap handler into /boss (Milestone 3b Task 2)"
```

---

### Task 3: Wire Attunement/Wellspring/Forte/WEAKENED into Basic, Skill, Ultimate, Enemy Retaliation

**Files:**
- Modify: `src/commands/rpg/boss.ts`

**Context:** Same additive-term folding approach as `/dungeon`'s Task 4, but WEAKENED is included from the start this time (Milestone 3a had to add it in a follow-up fix after the final review caught it missing).

- [ ] **Step 1: Basic Attack (`boss_basic`) — Solace-only base multiplier + team-wide bonuses + WEAKENED**

Find:
```typescript
          if (btn.customId === "boss_basic") {
            const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
              ? windstridersLegacyCheckExplosion(namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
            const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < activeCritRate; abilCrit = crit;
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base   = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * (1 - defReduction)));
```

Replace with:
```typescript
          if (btn.customId === "boss_basic") {
            const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
              ? windstridersLegacyCheckExplosion(namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
            const teamAtkMult  = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
            const teamCritBonus = isDevGuild ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 0;
            const wellspringAtkMult   = isDevGuild && activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
            const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
            const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
            const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const basicMoveMult = isDevGuild && activeUnit === "ally" ? solaceBasicDamageMult(solaceBasicLevel) : 1.0;
            const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < Math.min(1, activeCritRate + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base   = Math.max(1, Math.floor(stats.atk * teamMult * basicMoveMult * smolderMult * havocAtkMult * (1 - defReduction)));
```

- [ ] **Step 2: Skill (`boss_skill`) — split into Solace's Attunement branch vs. the existing player Skill logic**

Find:
```typescript
          if (btn.customId === "boss_skill") {
            const crit   = forcedCritActive || Math.random() < Math.min(1, activeCritRate + 0.1); abilCrit = crit;
```

Replace with:
```typescript
          if (btn.customId === "boss_skill" && isDevGuild && activeUnit === "ally") {
            // Solace's Skill is Attunement — a mode cycle, not a damage move.
            attunement.mode = cycleAttunementMode(attunement.mode);
            const crit = Math.random() < activeCritRate; abilCrit = crit;
            const dmg  = Math.max(1, Math.floor(stats.atk * 0.6 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
            playerDmg  = dmg;
            moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
          } else if (btn.customId === "boss_skill") {
            const teamAtkMult  = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
            const teamCritBonus = isDevGuild ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 0;
            const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
            const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
            const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const crit   = forcedCritActive || Math.random() < Math.min(1, activeCritRate + 0.1 + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
```

Then find, a few lines later within the SAME (now `else if`) block:
```typescript
            const base   = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * 1.8 * (1 - defReduction)));
```

Replace with:
```typescript
            const base   = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * 1.8 * (1 - defReduction)));
```

**Important**: everything else inside the original `boss_skill` block (the `smolderMult`, `extraElemBonusSkill`, ability-effect application, energy/HP updates, `firstSkillUsed = true`) stays exactly as it was, just re-parented under the `else if` — do not duplicate or remove any of that logic.

- [ ] **Step 3: Ultimate (`boss_ultimate`) — team-wide bonuses (player's own Ultimate only; Solace's own Ultimate is Task 4)**

Find:
```typescript
          if (btn.customId === "boss_ultimate") {
            abilCrit     = true;
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base   = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * 3.5 * stats.critDmg * (1 - defReduction)));
```

Replace with:
```typescript
          if (btn.customId === "boss_ultimate" && !(isDevGuild && activeUnit === "ally")) {
            abilCrit     = true;
            const teamAtkMult = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
            const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
            const forteAtkBonus = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base   = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * 3.5 * stats.critDmg * (1 - defReduction)));
```

- [ ] **Step 4: Enemy retaliation — Attunement/Wellspring/Forte DEF bonuses (composes independently with the existing enrage multiplier)**

Find:
```typescript
            const enrageMult = isEnraged ? 1.60 : 1.0;
            const move       = isEnraged
              ? boss.moves.reduce((a, b) => a.damage >= b.damage ? a : b)
              : boss.moves[Math.floor(Math.random() * boss.moves.length)];
            let bossDmg   = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - stats.def * 0.4));
```

Replace with:
```typescript
            const enrageMult = isEnraged ? 1.60 : 1.0;
            const move       = isEnraged
              ? boss.moves.reduce((a, b) => a.damage >= b.damage ? a : b)
              : boss.moves[Math.floor(Math.random() * boss.moves.length)];
            const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
            const forteDefBonus = isDevGuild ? getSolaceForteDefBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const attunementDefBonus = solaceAttunementDefBonus(solaceSkillLevel);
            const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDefBonus, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus);
            let bossDmg   = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - stats.def * attunementDefMult * 0.4));
```

- [ ] **Step 5: Tick + apply the WEAKENED debuff**

Find (right before the shatter check, or wherever the enemy-turn block starts — locate the line just before `// Boss turn` comment's `if (shatterTurnsLeft > 0)` check):
```typescript
          // Boss turn
          if (shatterTurnsLeft > 0) {
```

Replace with:
```typescript
          // Debuffs tick down at the START of resolving the boss's turn — this
          // way any WEAKENED applied by the attack below isn't touched until
          // NEXT round's tick, giving it the full 2 turns its own flavor text
          // advertises, instead of being decremented in the same cycle it's
          // created.
          if (isDevGuild) {
            const tickResult = tickDebuffs(playerDebuffs);
            playerDebuffs = tickResult.state;
          }

          // Boss turn
          if (shatterTurnsLeft > 0) {
```

Then find, inside the real-retaliation `else` branch (after the boss's damage message line is appended, before that branch's closing `}`):
```typescript
            state.lastMove += `\n◇ ${boss.name} ${move.effect} — **${bossDmg} DMG**${isEnraged ? " 🔴" : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
            state.playerEnergy = Math.min(100, state.playerEnergy + 15);
          }
```

Replace with:
```typescript
            state.lastMove += `\n◇ ${boss.name} ${move.effect} — **${bossDmg} DMG**${isEnraged ? " 🔴" : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
            state.playerEnergy = Math.min(100, state.playerEnergy + 15);

            // Milestone 3b: exercises the debuff system inside a real fight.
            // 25% chance per enemy attack, only when dev-guild team mechanics
            // are active.
            if (isDevGuild && Math.random() < 0.25) {
              playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.2, 2);
              state.lastMove += `\n◇ *${boss.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
            }
          }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, or errors only about Solace's own Ultimate/Forte-fill/Concerto-gain not existing yet (Task 4). If anything else appears, report BLOCKED with specifics.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/boss.ts
git commit -m "feat(teams): wire Attunement/Wellspring/Forte/WEAKENED into /boss Basic/Skill/Ultimate/retaliation (Milestone 3b Task 3)"
```

---

### Task 4: Solace's Ultimate (Convergence), Forte Fill, Concerto Gain, Ally-Damage Routing

**Files:**
- Modify: `src/commands/rpg/boss.ts`

- [ ] **Step 1: Add Solace's Ultimate (Convergence) as a new branch**

Find the `boss_ultimate` branch's closing `}` — it should be immediately followed by the `boss_echoskill` check:
```typescript
          if (btn.customId === "boss_echoskill" && bonuses.echoSkill) {
```

Insert a new `else if` branch immediately BEFORE this line:
```typescript
          } else if (btn.customId === "boss_ultimate" && isDevGuild && activeUnit === "ally") {
            // Solace's Ultimate spends Concerto Energy, not personal Energy.
            const healPct = solaceConvergenceHealPct(solaceUltimateLevel);
            const healResult = resolveIntroOutroEffect({ actions: [
              { type: "HEAL_ALLY", value: healPct },
              { type: "CLEANSE_ALLY", value: 1 },
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

            const healSummary = `${displayName} +${actualHealPlayer} HP, ${SOLACE.name} +${actualHealAlly} HP`;

            if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
              forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS;
              attunementDoubleTurnsLeft = 0;
              solaceForte = resetForte();
              moveName = `⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
                `**all 3 Attunement Modes empowered for ${SOLACE_FORTE_EMPOWERED_TURNS} turns!**`;
            } else {
              attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS;
              forteEmpoweredTurnsLeft = 0;
              moveName = `⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
                `**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
            }
          }
```

Just above the `boss_ultimate` branch (the player's own Ultimate, from Task 3), add the `convergenceUsedThisTurn` flag declaration — find:
```typescript
          if (btn.customId === "boss_ultimate" && !(isDevGuild && activeUnit === "ally")) {
```

Replace with:
```typescript
          // Set inside Solace's Convergence branch below — Convergence resets
          // concertoEnergy to 0, so the generic per-move gain further down
          // must skip granting anything back on the same turn, or Convergence
          // would silently refund 35-47% of the bar it just spent (a bug
          // caught and fixed in Milestone 3a's port — built in from the start
          // here instead).
          let convergenceUsedThisTurn = false;

          if (btn.customId === "boss_ultimate" && !(isDevGuild && activeUnit === "ally")) {
```

- [ ] **Step 2: Forte fill from Chime Strike, with threshold-crossing messages**

Find the end of the `boss_basic` block (the last statement before its closing `}` — likely the `stormcallersOathCheckThunderbolt` line or equivalent):
```typescript
            if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(namedState, state.playerEnergy);
          }
```

Replace with:
```typescript
            if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(namedState, state.playerEnergy);

            // Forte fills only from Solace's own Chime Strike — announce only
            // on the turn a threshold is actually crossed.
            if (isDevGuild && activeUnit === "ally") {
              const forteBefore = solaceForte;
              solaceForte = addForteCharge(solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
              const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
              const isHalf  = solaceForte.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG);
              if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
                moveName += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
              } else if (isHalf && !wasHalf) {
                moveName += `\n✨ Forte is **HALF CHARGED**.`;
              }
            }
          }
```

(Read the actual current file to confirm this is genuinely the last statement in the `boss_basic` block — after Task 3's edits it should be, but verify before inserting.)

- [ ] **Step 3: Concerto Energy gain — apply to all move buttons, guarded against the same-turn Convergence refund**

Find (right after the `boss_echoskill` block's closing `}`, before the `// V2 turn-start regen` comment):
```typescript
          // V2 turn-start regen (fires each turn)
```

Insert immediately BEFORE this line:
```typescript
          // Concerto Energy builds from combat actions, never from swapping.
          const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
            boss_basic: 10, boss_skill: 20, boss_echoskill: 20, boss_ultimate: 35,
          };
          if (isDevGuild && !convergenceUsedThisTurn) {
            let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
            if (concertoGain > 0 && activeUnit === "ally") concertoGain += WELLSPRING_BASE_ENERGY_BONUS;
            if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
          }

          // V2 turn-start regen (fires each turn)
```

- [ ] **Step 4: Per-turn decrement of Attunement/Forte duration counters**

Find:
```typescript
          state.turn++;
          if (state.skillCooldown > 0) state.skillCooldown--;
          if (glacioShieldTurnsLeft > 0) glacioShieldTurnsLeft--;
          if (stormBuffTurnsLeft > 0) stormBuffTurnsLeft--;
          if (namedState.spectroFractureTurnsLeft > 0) namedState.spectroFractureTurnsLeft--;
          if (echoSkillCooldown > 0) echoSkillCooldown--;
          if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "boss_swap") nextAttackCritArmed = false;
```

Replace with:
```typescript
          state.turn++;
          if (state.skillCooldown > 0) state.skillCooldown--;
          if (glacioShieldTurnsLeft > 0) glacioShieldTurnsLeft--;
          if (stormBuffTurnsLeft > 0) stormBuffTurnsLeft--;
          if (namedState.spectroFractureTurnsLeft > 0) namedState.spectroFractureTurnsLeft--;
          if (echoSkillCooldown > 0) echoSkillCooldown--;
          if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
          if (isDevGuild && attunementDoubleTurnsLeft > 0) attunementDoubleTurnsLeft--;
          if (isDevGuild && forteEmpoweredTurnsLeft > 0) forteEmpoweredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "boss_swap") nextAttackCritArmed = false;
```

(This finds the version already updated by Task 2 Step 2's `nextAttackCritArmed` exclusion — just add the two new decrement lines alongside it, don't revert that exclusion.)

- [ ] **Step 5: Enemy damage routes to the correct active unit's HP + ally-KO auto-swap**

Find:
```typescript
            bossDmg       = shield.dmg;
            state.playerHp = Math.max(0, state.playerHp - bossDmg);
```

Replace with:
```typescript
            bossDmg       = shield.dmg;
            const allyIsActive = isDevGuild && activeUnit === "ally";
            if (allyIsActive) {
              allyHp = Math.max(0, allyHp - bossDmg);
            } else {
              state.playerHp = Math.max(0, state.playerHp - bossDmg);
            }
```

Find the "Second Wind" check (which precedes the "Lose" check):
```typescript
          // Second Wind
          if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
```

Insert immediately BEFORE this line:
```typescript
          // Ally KO'd — auto-swap back to the player rather than ending the
          // fight over a benched unit's HP.
          if (isDevGuild && activeUnit === "ally" && allyHp <= 0) {
            allyHp = 0;
            activeUnit = "player";
            state.lastMove += `\n◇ **${SOLACE.name} was knocked out** — swapped back to ${displayName}.`;
          }

          // Second Wind
          if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/boss.ts
git commit -m "feat(teams): wire Solace's Ultimate, Forte fill, Concerto Energy, ally-damage routing into /boss (Milestone 3b Task 4)"
```

---

### Task 5: Verification

- [ ] **Step 1: Automated**

```bash
npx tsc --noEmit
grep -n "isDevGuild" src/commands/rpg/boss.ts   # confirm every new branch is gated
grep -c "boss_swap" src/commands/rpg/boss.ts    # expect at least 5 (button creation, click handler, firstActionDone/QuickStrike/crit-reset exclusions)
```

- [ ] **Step 2: Manual — deploy and playtest**

No new slash command, so `npm run deploy` isn't needed. On the VM: `git pull && npm run build && pm2 restart cartethyia`.

In the dev guild, run a full boss fight through both pre-enrage and enrage phases and verify:
- [ ] Swap button appears; swapping shows Solace's real row (Chime Strike/Attunement/Convergence/Flee); Concerto Energy/benched-unit-HP/debuffs are visible in the embed
- [ ] Swap still costs a turn — the boss attacks right after you swap, same as a real action
- [ ] Attunement cycles ATK→CRIT→DEF→ATK, affects your own Basic/Ultimate damage and DEF after swapping back
- [ ] Convergence heals both units, does the Empowered/normal branching correctly, and does NOT refund Concerto Energy on the same turn
- [ ] Enrage's ATK ×1.6 and Attunement's DEF bonus compose correctly (both apply — check that a DEF-mode buff measurably reduces damage even during enrage, not overridden by it)
- [ ] Enemy retaliation can occasionally WEAKEN you (-20% ATK, 2 turns), ticking down correctly
- [ ] If Solace gets KO'd while active, auto-swaps back to the player rather than ending the fight
- [ ] Non-dev-guild `/boss` is completely unaffected

- [ ] **Step 3: Report findings back**

Same as every prior milestone — if something's off, describe exactly what you saw and I'll fix it directly.
