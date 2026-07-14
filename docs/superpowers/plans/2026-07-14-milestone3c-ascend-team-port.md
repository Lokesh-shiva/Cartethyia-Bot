# Milestone 3c-i — Team Mechanics in /ascend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the team-combat system into `/ascend`, using `/boss`'s already-shipped, already-reviewed port as the literal reference implementation (not re-deriving the design from scratch).

**Reference commits (read these via `git show <sha>` against `src/commands/rpg/boss.ts` on `main`, in order):**
1. `9f38665` — dev-guild gate, team state, button/embed plumbing (`sendBattleCard`/`buildButtons` signature changes, `TeamButtonContext`, `teamStatusLine()`)
2. `f75a797` — swap handler (falls through to shared tail, `firstActionDone`/Quick-Strike/crit-reset exclusions)
3. `16a6d9a` — Attunement/Wellspring/Forte/WEAKENED wired into Basic/Skill/Ultimate/retaliation
4. `89034d0` — Solace's Ultimate (Convergence), Forte fill, Concerto gain (with `convergenceUsedThisTurn` guard), per-turn decrements, ally-damage routing + KO auto-swap
5. `c6ca97a` — the `+1` turn-duration compensation fix for `attunementDoubleTurnsLeft`/`forteEmpoweredTurnsLeft` (apply this from the start here, don't discover it later)

**`/ascend`-specific adaptations (confirmed differences from `/boss`):**
- Button customId prefix is `battle_` (`battle_basic`/`battle_skill`/`battle_ultimate`/`battle_flee`/`battle_echoskill`), not `boss_`. Every customId string in the ported code must use this prefix instead — including the new `battle_swap` button.
- Retaliation formula is `scaled.atk * move.damage * enrageMult - stats.def * 0.4` (line ~657 in `ascend.ts` as of this plan's writing — re-verify against the live file) — same shape as `/boss`, same enrage composition approach applies.
- `/ascend`'s own variable names (`state`, `stats`, `scaled`, `namedState`, `firstActionDone`, etc.) should already closely match `/boss`'s naming from shared heritage — confirm each reference resolves against the actual file, adapt names only where they genuinely differ.

---

### Task 1: Team State + Button/Embed Plumbing

Port `boss.ts`'s commit `9f38665` into `src/commands/rpg/ascend.ts`. Read the actual diff (`git show 9f38665`), find the equivalent insertion points in `ascend.ts` (the per-fight state block, the `sendBattleCard`-equivalent function if one exists — check its actual name in `ascend.ts`, the `buildButtons`-equivalent function, and its call sites), and apply the same additions adapted to `ascend.ts`'s real variable/function names and the `battle_` customId prefix. If `ascend.ts` doesn't have a separately-named `sendBattleCard` function (i.e., the message-sending logic is inlined differently), adapt the embed's `.setDescription(teamStatus || null)` addition to wherever that embed is actually constructed.

Typecheck (`npx tsc --noEmit`), commit as `feat(teams): add dev-guild-gated team state + button/embed plumbing to /ascend (Milestone 3c-i Task 1)`.

### Task 2: Swap Handler

Port `boss.ts`'s commit `f75a797` into `ascend.ts`, using `battle_swap` as the customId. Critical: swap must fall through to the shared Win-check/Boss-turn/decrements/Lose-check/next-turn tail — no independent message-send, no `return`. Exclude `battle_swap` from `firstActionDone`/Quick-Strike/`nextAttackCritArmed`-reset, exactly as `boss.ts` does for `boss_swap`.

Typecheck, commit as `feat(teams): wire swap handler into /ascend (Milestone 3c-i Task 2)`.

### Task 3: Attunement/Wellspring/Forte/WEAKENED

Port `boss.ts`'s commit `16a6d9a` into `ascend.ts`: Solace-only Basic multiplier + team-wide bonuses, Skill split into Solace's Attunement branch vs. player's original Skill (preserve ALL original Skill logic untouched, just re-parent under `else if`), Ultimate guard + team bonuses (player's own Ultimate only), enemy retaliation DEF bonuses composing with `ascend.ts`'s own enrage multiplier, WEAKENED tick+apply+fold into the 3 player damage formulas (not Solace's Attunement-cycle hit).

Typecheck, commit as `feat(teams): wire Attunement/Wellspring/Forte/WEAKENED into /ascend Basic/Skill/Ultimate/retaliation (Milestone 3c-i Task 3)`.

### Task 4: Solace's Ultimate (Convergence), Forte Fill, Concerto Gain, Ally-Damage Routing

Port `boss.ts`'s commits `89034d0` + `c6ca97a` (the +1 fix, applied from the start) into `ascend.ts`: Convergence branch (dual-target heal, cleanse, Empowered-vs-normal branching with the `+1` turn compensation already included), `convergenceUsedThisTurn` guard on the generic Concerto-gain block, Forte fill from Basic with threshold messages, per-turn decrements for the two duration counters, ally-damage routing + KO auto-swap-back placed before the Second-Wind/Lose checks. Also add the Quick-Strike exclusion for Solace's Convergence (`isSolaceConvergence`-style check) — this was added mid-milestone in `boss.ts`, include it from the start here.

Typecheck, commit as `feat(teams): wire Solace's Ultimate, Forte fill, Concerto Energy, ally-damage routing into /ascend (Milestone 3c-i Task 4)`.

### Task 5: Verification

`npx tsc --noEmit`, `grep -c "battle_swap" src/commands/rpg/ascend.ts` (expect ≥5), `grep -n "isDevGuild" src/commands/rpg/ascend.ts` (confirm every new branch gated). Manual playtest checklist same as Milestone 3b's Task 5, adapted to `/ascend`. Report findings back.
