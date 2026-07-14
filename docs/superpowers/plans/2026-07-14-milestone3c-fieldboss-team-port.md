# Milestone 3c-ii — Team Mechanics in /field-boss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the team-combat system into `/field-boss`, using `/boss`'s already-shipped, already-reviewed port as the literal reference implementation.

**Reference commits (read via `git show <sha>` against `src/commands/rpg/boss.ts` on `main`, in order):**
1. `9f38665` — dev-guild gate, team state, button/embed plumbing
2. `f75a797` — swap handler (falls through to shared tail, exclusions)
3. `16a6d9a` — Attunement/Wellspring/Forte/WEAKENED wired in
4. `89034d0` — Convergence, Forte fill, Concerto gain, ally-damage routing
5. `c6ca97a` — the `+1` turn-duration compensation fix (apply from the start)

**`/field-boss`-specific adaptations (confirmed differences from `/boss`):**
- Button customId prefix is `fb_` (`fb_basic`/`fb_skill`/`fb_ultimate`/`fb_flee`/`fb_echoskill`), not `boss_`. Add `fb_swap` for the new button.
- **No enrage mechanic** — retaliation formula is `scaled.atk * move.damage - stats.def * 0.4` (no `enrageMult` term at all, unlike `/boss`/`/ascend`). When porting the DEF-bonus composition (`attunementDefMult`), fold it into `stats.def * attunementDefMult * 0.4` with no enrage term to worry about — simpler than `/boss`'s equivalent step.
- Confirm `/field-boss`'s own variable names (`state`, `stats`, `scaled`, `namedState`, etc.) before assuming they match `/boss`'s naming — adapt to whatever the real file uses.

---

### Task 1: Team State + Button/Embed Plumbing

Port `boss.ts`'s commit `9f38665` into `src/commands/rpg/field-boss.ts`. Read the diff, find the equivalent per-fight state block, the message/embed-sending function, and the button-building function + its call sites in `field-boss.ts`, apply the same additions adapted to real names and the `fb_` customId prefix.

Typecheck, commit as `feat(teams): add dev-guild-gated team state + button/embed plumbing to /field-boss (Milestone 3c-ii Task 1)`.

### Task 2: Swap Handler

Port `boss.ts`'s commit `f75a797` into `field-boss.ts`, using `fb_swap`. Swap must fall through to the shared tail — no independent send/return. Exclude `fb_swap` from `firstActionDone`/Quick-Strike/`nextAttackCritArmed`-reset.

Typecheck, commit as `feat(teams): wire swap handler into /field-boss (Milestone 3c-ii Task 2)`.

### Task 3: Attunement/Wellspring/Forte/WEAKENED

Port `boss.ts`'s commit `16a6d9a` into `field-boss.ts`: Solace-only Basic multiplier + team bonuses, Skill split (preserve original Skill logic untouched under `else if`), Ultimate guard + team bonuses, enemy retaliation DEF bonuses (no enrage term here — simpler formula than `/boss`), WEAKENED tick+apply+fold into the 3 player damage formulas.

Typecheck, commit as `feat(teams): wire Attunement/Wellspring/Forte/WEAKENED into /field-boss Basic/Skill/Ultimate/retaliation (Milestone 3c-ii Task 3)`.

### Task 4: Solace's Ultimate (Convergence), Forte Fill, Concerto Gain, Ally-Damage Routing

Port `boss.ts`'s commits `89034d0` + `c6ca97a` into `field-boss.ts`: Convergence branch with the `+1` turn compensation included from the start, `convergenceUsedThisTurn` guard, Forte fill with threshold messages, per-turn decrements, ally-damage routing + KO auto-swap before Second-Wind/Lose checks, Quick-Strike exclusion for Solace's Convergence.

Typecheck, commit as `feat(teams): wire Solace's Ultimate, Forte fill, Concerto Energy, ally-damage routing into /field-boss (Milestone 3c-ii Task 4)`.

### Task 5: Verification

`npx tsc --noEmit`, `grep -c "fb_swap" src/commands/rpg/field-boss.ts` (expect ≥5), `grep -n "isDevGuild"` gating audit. Manual playtest checklist same as Milestone 3b's Task 5, adapted to `/field-boss`. Report findings back.
