# Milestone 3a — Team Mechanics in /dungeon Design

**Status:** Approved, ready for planning.

## 1. What this is

Ports the fully-built `/encounter` team-combat system (swap, Solace's kit, Wellspring, Forte, kit-leveling) into `/dungeon` — the first of the top-level [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md)'s "Milestone 3: roll out to the remaining 6 combat surfaces." This is a port, not new design work — every primitive and Solace-specific function already exists and is reused as-is. `/boss`, `/duel`, `/raid`, `/field-boss`, `/ascend` are separate future milestones, each with their own bespoke state to integrate with.

**Explicitly deferred, not touched here:**
- Any other combat surface.
- New Solace mechanics, new Forte phases, new Wellspring ranks — none needed, this milestone only wires existing capabilities into a new surface.

## 2. Architecture — extend the existing cross-wave state pattern

`/dungeon` already threads solo-player combat state (`playerHp`, `playerEnergy`, `skillCooldown`, Named Echo Set state, elemental buff timers, etc.) across multiple sequential waves within one run: initialized once in the `while (true)` run loop (`dungeon.ts:298-317`, before the `for` loop over waves), passed into `runWave()` as part of a `WaveState` object literal, and copied field-by-field out of the returned `WaveResult` back into loop-local variables after each wave (`dungeon.ts:349-364`). Team state uses this exact same mechanism — no new state-passing pattern invented:

- `WaveState`/`WaveResult` interfaces gain: `activeUnit`, `allyHp`, `concertoEnergy`, `playerDebuffs`, `attunement`, `solaceForte`, `forteEmpoweredTurnsLeft`, `attunementDoubleTurnsLeft`.
- Initialized once per run (dev-guild only) alongside the existing `let playerHp = ...` block, using the exact same starting values `/encounter` uses (`activeUnit: "player"`, `allyHp: SOLACE.hpMax`, etc.).
- Copied out of `result` back into loop-local `let`s after each wave, same mechanical pattern as the 15 existing fields already handled this way.
- **One wrinkle worth being explicit about**: `skillCooldown` is decremented by 1 between waves (`Math.max(0, result.skillCooldown - 1)`) — wave transitions are treated as consuming a turn-equivalent for cooldown-style state. `attunementDoubleTurnsLeft`/`forteEmpoweredTurnsLeft` (both turn-count-based, same shape as a cooldown) get the identical treatment for consistency — a temporary buff active at the end of wave 1 has one fewer turn left by the start of wave 2, mirroring the existing skill-cooldown precedent rather than inventing a different rule.
- Solace's `CharacterProgress` levels are fetched once per run (not per wave), same "fetched once, doesn't change mid-fight" reasoning `/encounter` already uses.

## 3. What gets wired in

Everything Solace has, reusing existing functions with zero new `solace.ts`/`attunement.ts`/`wellspring.ts`/`forte.ts` code:
- Basic (Chime Strike) / Skill (Attunement) / Ultimate (Convergence) / Intro / Outro — same functions, same level-scaling calls (`solaceBasicDamageMult`, `getAttunementAtkMult` with `solaceAttunementAtkCritBonus`, etc.) as `/encounter`.
- Wellspring's base + mode-amplifier passive.
- Forte's gauge, fill/threshold messages, and Empowered Convergence branch.
- Convergence's dual-target heal (both `playerHp` and `allyHp`), matching the Milestone 2e fix.

`/dungeon`'s own existing solo-play systems (Named Echo Sets, elemental buffs/frenzy state, gear-aware wave scaling) are untouched — team mechanics layer on top via the same `isDevGuild` gating pattern, not a replacement for any of it.

## 4. UI changes

`buildButtons()` currently returns a single `ActionRowBuilder<ButtonBuilder>` already at Discord's 5-component-per-row cap (Basic/Skill/Ultimate/EchoSkill/Flee). Adding a Swap button needs a second row — the function's return type changes to `ActionRowBuilder<ButtonBuilder>[]`, mirroring exactly how `/encounter`'s `buildEncounterButtons()` already does this. The one call site (`components: [buildButtons()]`) becomes `components: buildButtons()` (the array itself, no wrapping). When `activeUnit === "ally"`, the row shows Solace's real kit (Chime Strike/Attunement/Convergence/Flee) instead of the player's row, same swap-driven row-switching `/encounter` already does.

## 5. Scope

Dev-guild-gated (`isDevGuild`), matching every `/encounter` milestone's staging discipline — even though the underlying mechanics are proven, this is a fresh integration into a materially more complex surface (multi-wave, Named Echo Sets, Discord threads instead of a single channel message) and deserves its own live-playtest pass before wider release.

## 6. Testing

- `npx tsc --noEmit` clean.
- No new unit tests needed — no new pure functions are introduced (everything reused as-is from `/encounter`'s already-tested primitives); this milestone is integration wiring only.
- Manual Discord playtest in the dev guild: run a full 3-wave dungeon, confirm Swap/Solace's kit/Attunement/Wellspring/Forte/Convergence dual-heal all work exactly as they do in `/encounter`, confirm team state (Concerto Energy, Attunement mode, Forte charge, active unit) correctly carries from wave 1 into wave 2 into wave 3 rather than resetting, confirm a wave-ending KO of the benched unit doesn't break the run, confirm non-dev-guild `/dungeon` is completely unaffected.
