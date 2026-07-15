# Milestone 3d — Team Mechanics in /raid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the team-combat system (Solace, Attunement/Wellspring/Forte/Convergence/Concerto Energy) into `/raid`, adapted for real multiplayer instead of a solo bench.

**Architecture — this is NOT a 1:1 port like `/ascend`/`/field-boss`.** `/raid` (`src/commands/rpg/raid.ts`) has a `RaidParticipant[]` array, a shared boss target, `raid.currentIdx`-based turn order, and boss retaliation that's **AoE against every living participant** (not single-target). The underlying mechanic primitives (`cycleAttunementMode`, `resolveIntroOutroEffect`, `addForteCharge`/`isForteMaxed`, `applyDebuff`/`tickDebuffs`/`getWeakenedMult`, `CONCERTO_GAIN_BY_MOVE`) are reused exactly as `boss.ts` uses them — read `boss.ts` (commits `9f38665`, `f75a797`, `16a6d9a`, `89034d0`, `c6ca97a` on `main`) for how each primitive is called. What's genuinely new here is WHERE the per-owner state lives (on each `RaidParticipant`, not a single closure) and how the AoE retaliation routes damage.

**Confirmed design (from `docs/superpowers/specs/2026-07-15-milestone3d-raid-team-port-design.md`):**
- Solace is NOT shared — each participant has their own personal Solace (own `CharacterProgress`). Only the owning participant can ever swap to *their* Solace.
- Swap replaces the swapper's own turn — no new turn slot in `currentIdx`'s rotation.
- While a participant's Solace is active, her standing effects (Attunement mode, Wellspring passive, Forte's Empowered mode) apply **party-wide** — every living participant benefits, not just the owner. Her direct-damage moves stay single-target.
- Convergence heals the **whole party**.
- Solace has her **own HP pool** per owner; AoE retaliation against that owner's slot hits her pool instead of the owner's own HP while she's active. KO auto-swaps back to the owner.
- Concerto Energy accrues only from the owner's own actions (same as solo fights) — no cross-participant plumbing.
- Multiple owners can have their own Solace active on their own turns simultaneously — buffs stack naturally, no special-casing.

---

### Task 1: Per-Participant Team State + Swap Button + Team Status Line

**Files:** `src/commands/rpg/raid.ts`

1. Add imports mirroring `boss.ts`'s team-mechanic imports: `getOrCreateCharacterProgress` (`../../lib/characterProgress`), `SOLACE`, `SOLACE_ULTIMATE_DOUBLE_TURNS`, `PLAYER_SELF_INTRO`, `PLAYER_SELF_OUTRO`, `SOLACE_FORTE_CONFIG`, `SOLACE_FORTE_GAIN_PER_BASIC`, `SOLACE_FORTE_EMPOWERED_TURNS` (wherever `boss.ts` sources these from — check its import list), `resolveIntroOutroEffect`/`IntroOutroEffect` (`../../lib/introOutro`), `AttunementState`/`cycleAttunementMode`/`getAttunementAtkMult`/`getAttunementCritRateBonus`/etc. (`../../lib/attunement`), Wellspring's equivalent functions, `ForteState`/`addForteCharge`/`isForteMaxed`/`resetForte` (`../../lib/forte`), `DebuffState`/`applyDebuff`/`tickDebuffs`/`getWeakenedMult`/`cleanseDebuffs` (`../../lib/debuffs`).

2. Extend `RaidParticipant` (line 195) with per-owner team fields:
   ```typescript
   hasSolace:      boolean;
   solaceBasicLevel: number;
   solaceSkillLevel: number;
   solaceUltimateLevel: number;
   solaceIntroLevel: number;
   solaceForteLevel: number;
   activeUnit:     "player" | "ally";
   allyHp:         number;
   allyHpMax:      number;
   concertoEnergy: number;
   playerDebuffs:  DebuffState[];
   attunement:     AttunementState;
   attunementDoubleTurnsLeft: number;
   solaceForte:    ForteState;
   forteEmpoweredTurnsLeft:   number;
   ```

3. Add a raid-level `isDevGuild: boolean` field to `ActiveRaid`, set once when the raid starts (`interaction.guildId === process.env.GUILD_ID`).

4. When each `RaidParticipant` is constructed (find the participant-creation code, likely in the join handler and/or the "start fight" transition around line 431/636), fetch `getOrCreateCharacterProgress(userId, "solace")` when `isDevGuild`, and initialize the new fields: `hasSolace = progress !== null` (or whatever signals unlock — confirm against `boss.ts`'s pattern for what makes a player eligible), level fields from the progress row (default 1 if absent), `activeUnit: "player"`, `allyHp`/`allyHpMax` from `SOLACE`'s base HP, `concertoEnergy: 0`, `playerDebuffs: []`, `attunement: { mode: null }`, `attunementDoubleTurnsLeft: 0`, `solaceForte` initialized via whatever `resetForte`/initial-state pattern `boss.ts` uses, `forteEmpoweredTurnsLeft: 0`.

5. **Swap button:** add a `raid_swap` button to `buildRaidButtons(p)` — only rendered/enabled when `raid.isDevGuild && p.hasSolace`. When `p.activeUnit === "ally"`, `buildRaidButtons` should show Solace's row (Chime Strike/Attunement/Convergence) instead of Basic/Skill/Ultimate — mirror `boss.ts`'s `TeamButtonContext`-driven branch in `buildButtons`, but keyed off the individual participant `p` passed in (not a single closure), i.e. `buildRaidButtons(p: RaidParticipant, isDevGuild: boolean)`.

6. **Team status line:** add a `raidTeamStatusLine(raid: ActiveRaid): string` returning `""` when `!raid.isDevGuild`, otherwise listing every participant who `hasSolace`, their `activeUnit`, and (for whoever is currently `activeUnit === "ally"`) their Solace's HP/Concerto Energy. Wire it into `raidEmbed`'s description or an added field — this was the exact gap that caused a live bug in `/dungeon`'s Milestone 3a port (missing Concerto Energy visibility), don't repeat it here.

Typecheck (`npx tsc --noEmit`), commit as `feat(teams): add per-participant Solace state + swap button + team status line to /raid (Milestone 3d Task 1)`.

### Task 2: Swap Handler

**Files:** `src/commands/rpg/raid.ts`

Add a `raid_swap` handler as a plain sibling `if` inside `runRaidTurn`'s collector (alongside `raid_retreat`/`raid_basic`/`raid_skill`/`raid_ultimate`/`raid_echoskill`, around line 860). Critical: it must fall through to the SAME shared tail every other action uses (`current.dmgDealt += damage` no-op since `damage = 0`, boss counter-attack, `nextParticipant(raid)`, decrements, next-turn send) — no independent `thread.send`/`return`/`collector.stop()`, exactly the lesson learned in every prior port. Toggle `current.activeUnit` between `"player"`/`"ally"`, set `damage = 0`, set `moveLine` to a combo/no-combo swap message (mirroring `boss.ts@f75a797`'s Outro/Intro resolution and headstart-energy pattern). Exclude `raid_swap` from `current.nextCritArmed` reset (mirror `boss.ts`'s `nextAttackCritArmed` exclusion).

Typecheck, commit as `feat(teams): wire swap handler into /raid (Milestone 3d Task 2)`.

### Task 3: Attunement/Wellspring/Forte/WEAKENED — Party-Wide Propagation

**Files:** `src/commands/rpg/raid.ts`

This is the task where `/raid` most diverges from `boss.ts`'s shape, because buffs must be **party-wide**, not owner-only.

1. **`raid_basic`/`raid_skill`/`raid_ultimate`:** for the acting `current` participant, if `current.activeUnit === "ally"`, branch exactly like `boss.ts` (Solace's own Basic multiplier for `raid_basic`, Attunement mode-cycle for `raid_skill` instead of the original Skill logic — preserve original Skill logic untouched under `else if`, Ultimate stays player-only). For team-wide bonus multipliers (`teamAtkMult`/`teamCritBonus` from Attunement, Wellspring's ATK/crit/DEF bonuses, Forte's Empowered bonuses): **compute them once per turn from whichever participant(s) currently have `activeUnit === "ally"`, and apply the result to whichever participant is `current` acting this turn** — i.e., a helper like `partyWideTeamBonuses(raid: ActiveRaid): { atkMult, critBonus, defMult, ... }` that folds together every active-ally's contribution (in practice usually 0 or 1 active ally at a time, but must not assume exactly 1 — sum/multiply across however many are active, matching the "stacks naturally" design decision). Fold this into `current`'s damage formula the same way `boss.ts` folds its single-owner `teamMult` in.
2. **WEAKENED**: add a `tickDebuffs(current.playerDebuffs)` call at the start of the boss-AoE-retaliation block (around line 1055, before the per-participant loop), and fold `getWeakenedMult(p.playerDebuffs)` into each participant's own damage formulas when it's their turn (Basic/Skill-player-branch/Ultimate) — NOT into Solace's own Attunement-cycle hit. Apply WEAKENED at 25% chance to whichever participant(s) the boss's AoE move hits particularly hard, or simply to a random living participant per turn (confirm exact targeting against `boss.ts`'s single-target 25%-chance pattern, adapted since raid's retaliation is AoE against everyone — decide: does EVERY hit participant get an independent 25% roll, or one roll for the whole AoE? Recommend: independent roll per participant, since the AoE already loops over all `alive` participants individually).
3. **AoE retaliation ally-routing**: inside the per-participant AoE loop (line 1060), when `p.activeUnit === "ally"`, route `bossDmg` into `p.allyHp` instead of `p.hp` — mirroring `boss.ts`'s single-target ally-damage routing, just inside this per-participant loop instead of a single `if`. KO-check (`p.allyHp <= 0`) auto-swaps `p.activeUnit` back to `"player"` (matching existing KO-auto-swap pattern) — this must NOT count as the participant being `isDefeated` (only the player's own `p.hp <= 0` does that).

Typecheck, commit as `feat(teams): wire Attunement/Wellspring/Forte/WEAKENED into /raid Basic/Skill/Ultimate/AoE-retaliation, party-wide (Milestone 3d Task 3)`.

### Task 4: Solace's Ultimate (Convergence, party heal), Forte Fill, Concerto Gain, Ally-Damage Routing

**Files:** `src/commands/rpg/raid.ts`

Port `boss.ts`'s `89034d0` + `c6ca97a` pattern, adapted for the party:
- Convergence branch (`raid_ultimate` when `current.activeUnit === "ally"`): heal + cleanse debuffs for **every living participant** (`raid.participants.filter(p => !p.isDefeated)`), not just 2 units — loop `resolveIntroOutroEffect` per participant. Empowered-vs-normal branching based on `isForteMaxed(current.solaceForte, SOLACE_FORTE_CONFIG)`. Include the `+1` turn-duration compensation from the start: `current.attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS + 1` / `current.forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS + 1` — bake this in now, do not ship without it.
- `convergenceUsedThisTurn` guard: boolean set `true` inside the Convergence branch right after `current.concertoEnergy = 0`, checked (`!convergenceUsedThisTurn`) before the generic per-move Concerto-gain block (`CONCERTO_GAIN_BY_MOVE`) applies to `current.concertoEnergy`.
- Forte fill from `raid_basic` when `current.activeUnit === "ally"`, with threshold messages, via `addForteCharge`.
- Per-turn decrements for `current.attunementDoubleTurnsLeft`/`current.forteEmpoweredTurnsLeft` alongside the existing `current.skillCd`/`current.echoSkillCd` decrements (line 1119-1120).
- Quick-Strike-equivalent exclusion for Convergence if `/raid` has an SPD-based first-strike bonus analog (check — per `CLAUDE.md`'s SPD section, raid uses SPD for turn order/first-strike bonus, not Quick-Strike specifically; confirm whether any such bonus needs excluding for Convergence, or whether this doesn't apply to raid at all and can be skipped).

Typecheck, commit as `feat(teams): wire Solace's Ultimate (party heal), Forte fill, Concerto Energy, ally-damage routing into /raid (Milestone 3d Task 4)`.

### Task 5: Verification

- `npx tsc --noEmit` clean.
- `grep -c "raid_swap" src/commands/rpg/raid.ts` — confirm every expected site (button def, handler, crit-reset exclusion) is present.
- `grep -n "isDevGuild"` gating audit — confirm every new branch is gated so non-dev-guild raids are completely unaffected.
- Read the full diff from the pre-Milestone-3d commit to HEAD, sanity-check: no leftover single-owner assumptions (e.g. code that assumes only one participant can ever be `activeUnit === "ally"` at a time), no TODO/FIXME left in, `playerDebuffs`/`attunement`/`solaceForte`/etc. initialized for every participant (not just the first).
- Manual playtest checklist (2+ real accounts in a dev-guild raid): confirm per-owner swap, party-wide buff propagation when one participant activates Attunement, Convergence healing everyone, ally HP pool taking AoE damage instead of the owner's own HP, KO auto-swap-back, and — if two participants both have Solace unlocked — that both can have her active simultaneously with stacking buffs. Confirm non-dev-guild raids play identically to before this milestone.

Report findings back.
