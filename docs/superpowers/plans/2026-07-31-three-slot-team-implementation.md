# Three-Slot Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `/team` and all 7 combat loops from the current "player + 1 chosen ally" binary model to a 3-position roster (any mix of "yourself" + up to 2 owned characters), with direct any-to-any swapping, a KO-fallback that walks position order, and the player no longer a fixed always-active anchor — per the approved design spec `docs/superpowers/specs/2026-07-31-three-slot-team-design.md`.

**Architecture:** The binary `activeUnit: "player" | "ally"` model is replaced everywhere with a 3-way `activeUnit: 1 | 2 | 3` position index. Rather than tripling every combat loop's ally-state variables by hand (each loop already tracks ~15 ally-specific variables — HP, mechanicState, kit levels, constellation, resolved stats — this would triple an already-large file), this plan introduces a small shared helper module, `src/lib/teamPositions.ts`, holding the position-resolution, KO-fallback, and swap-dropdown logic once. Each combat loop still needs its own per-position state variables (that part doesn't fully collapse — Basic/Skill/Ultimate dispatch still branches on which position is active, same as it branches on `activeAllyCharacterId` today), but the *bookkeeping* (which position is active, who's next on KO, building the swap dropdown) is centralized instead of duplicated 7 times.

**Tech Stack:** TypeScript (CommonJS), discord.js v14 (`StringSelectMenuBuilder` for both `/team`'s position pickers and the in-combat swap dropdown), Prisma (schema column replacement, not additive — no back-compat needed).

---

## Important context for whoever executes this

- No test framework — verification is `npx tsc --noEmit`, `npm run build`, and disposable `scripts/*.ts` (created, run via `npx tsx`, deleted, never committed).
- Work happens directly on `main`. Commit after every task; push + SSH-deploy only after the whole plan is verified, matching the established rhythm from the last three character builds.
- This is the largest single feature touched this session — all 7 combat loops need real changes, not just registration. Budget accordingly: treat each combat-loop task as comparable in size to a full character's combat-dispatch task (i.e., Kaelith/Vesper/Rilo's Task 6 equivalent), not a quick edit.
- `duel.ts` (per-side `c*`/`d*` fields) and `raid.ts` (per-participant `current.` object) need position-tripling applied within their own existing state shapes — `teamPositions.ts`'s helpers must be written generically enough (taking explicit state objects as parameters, not assuming a single global `state`) to be usable from all 7 files' different conventions.
- Read `docs/superpowers/specs/2026-07-31-three-slot-team-design.md` in full before Task 1.

---

### Task 1: Schema — replace `teamAllyCharacterId` with 3 position columns

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Replace the column**

In the `User` model, replace:
```prisma
teamAllyCharacterId String?     // null = solo with own character. Non-null = an owned banner character filling the 2nd combat slot (ownership = a CharacterProgress row exists for this userId+characterId).
```
with:
```prisma
teamPosition1 String? @default("self") // "self" | a characterId. Fight's starting active unit.
teamPosition2 String? // "self" | a characterId | null ("None" — unfilled)
teamPosition3 String? // "self" | a characterId | null ("None" — unfilled)
```

Update the `profileDisplayCharacterId` comment (it references the old column name):
```prisma
profileDisplayCharacterId String? // which owned character's badge shows on /profile — independent of teamPosition1/2/3 so it survives roster changes without needing to be untangled from combat-ally selection.
```

- [ ] **Step 2: Push schema and regenerate client**

```bash
npm run db:push
npx prisma generate
```
Expected: "Your database is now in sync." A data-loss warning on dropping `teamAllyCharacterId` is expected and fine — no migration of old values needed (confirm with user only if the push tool warns about it unexpectedly).

- [ ] **Step 3: Grep for every remaining reference to the old field name**

```bash
grep -rn "teamAllyCharacterId" src/
```
Expected: no results after this task's later steps touch `/team` and all 7 loops (some will remain until those tasks land — re-run this grep again at Task 10 as the final check).

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add prisma/schema.prisma
git commit -m "feat(team): replace teamAllyCharacterId with 3-position schema columns"
```
(Expect typecheck errors from `team.ts` and the 7 combat loops still referencing the old field — that's fine, they're fixed in the following tasks. Commit anyway; this is schema-only.)

---

### Task 2: `src/lib/teamPositions.ts` — shared position-resolution helpers

**Files:**
- Create: `src/lib/teamPositions.ts`

This is the new shared module every combat loop and `/team` itself will import from.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/teamPositions.ts
// Shared helpers for the 3-position team roster (teamPosition1/2/3 on User).
// "self" represents the player's own character occupying a position;
// anything else is a characterId. Centralizes position-resolution, KO
// fallback, and swap-dropdown construction so all 7 combat loops don't
// each reimplement this bookkeeping by hand.

export type TeamPositionValue = "self" | string; // "self" | characterId
export type PositionIndex = 1 | 2 | 3;

export interface ResolvedRoster {
  position1: TeamPositionValue;
  position2: TeamPositionValue | null;
  position3: TeamPositionValue | null;
}

// Reads the raw DB columns into a typed roster, defaulting position1 to
// "self" if somehow null (shouldn't happen given the schema default, but
// combat loops shouldn't crash on a malformed row).
export function resolveRoster(dbUser: { teamPosition1: string | null; teamPosition2: string | null; teamPosition3: string | null }): ResolvedRoster {
  return {
    position1: dbUser.teamPosition1 ?? "self",
    position2: dbUser.teamPosition2,
    position3: dbUser.teamPosition3,
  };
}

export function positionValue(roster: ResolvedRoster, pos: PositionIndex): TeamPositionValue | null {
  if (pos === 1) return roster.position1;
  if (pos === 2) return roster.position2;
  return roster.position3;
}

export function isPositionFilled(roster: ResolvedRoster, pos: PositionIndex): boolean {
  return positionValue(roster, pos) !== null;
}

// Every position actually in play (1 is always filled per the schema
// default; 2/3 may be null).
export function filledPositions(roster: ResolvedRoster): PositionIndex[] {
  const out: PositionIndex[] = [1];
  if (roster.position2 !== null) out.push(2);
  if (roster.position3 !== null) out.push(3);
  return out;
}

// KO fallback: walks 1->2->3->1 from the current position, skipping
// itself, returning the first OTHER filled position whose HP (per the
// caller-supplied lookup) is > 0. Returns null if no other position is
// alive (fight-ending condition — caller checks for this).
export function nextAliveFallback(
  roster: ResolvedRoster,
  currentPos: PositionIndex,
  hpLookup: (pos: PositionIndex) => number,
): PositionIndex | null {
  const order: PositionIndex[] = [1, 2, 3];
  const startIdx = order.indexOf(currentPos);
  for (let i = 1; i <= 3; i++) {
    const candidate = order[(startIdx + i) % 3];
    if (candidate === currentPos) continue;
    if (!isPositionFilled(roster, candidate)) continue;
    if (hpLookup(candidate) > 0) return candidate;
  }
  return null;
}

// All filled positions dead -> defeat.
export function isTeamWiped(roster: ResolvedRoster, hpLookup: (pos: PositionIndex) => number): boolean {
  return filledPositions(roster).every(pos => hpLookup(pos) <= 0);
}

// Positions available to swap TO from the current one (excludes current,
// excludes unfilled). Used to decide single-button vs dropdown swap UX.
export function swappableTargets(roster: ResolvedRoster, currentPos: PositionIndex): PositionIndex[] {
  return filledPositions(roster).filter(p => p !== currentPos);
}

// Label for a position, given the resolved kit for non-"self" positions.
// playerName is the player's own display name (for "self").
export function positionLabel(
  roster: ResolvedRoster,
  pos: PositionIndex,
  playerName: string,
  kitLabel: (characterId: string) => string | null,
): string {
  const value = positionValue(roster, pos);
  if (value === "self") return playerName;
  if (value === null) return "(empty)";
  return kitLabel(value) ?? value;
}
```

- [ ] **Step 2: Verify it compiles standalone**

```bash
npx tsc --noEmit 2>&1 | grep "teamPositions.ts"
```
Expected: no output.

- [ ] **Step 3: Verify with a disposable script**

```typescript
// scripts/verify-team-positions.ts
import {
  resolveRoster, filledPositions, nextAliveFallback, isTeamWiped, swappableTargets,
} from "../src/lib/teamPositions";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; }
  else console.log("PASS:", msg);
}

const soloRoster = resolveRoster({ teamPosition1: "self", teamPosition2: null, teamPosition3: null });
assert(filledPositions(soloRoster).length === 1, "solo roster has 1 filled position");
assert(swappableTargets(soloRoster, 1).length === 0, "solo roster has nothing to swap to");

const fullRoster = resolveRoster({ teamPosition1: "self", teamPosition2: "kaelith", teamPosition3: "rilo" });
assert(filledPositions(fullRoster).length === 3, "full roster has 3 filled positions");
assert(swappableTargets(fullRoster, 1).length === 2, "full roster has 2 swap targets from position 1");

const allAlive = () => 100;
assert(nextAliveFallback(fullRoster, 2, allAlive) === 3, "fallback from 2 goes to 3 when both 1 and 3 alive (wrap order 2->3->1)");

const pos3Dead = (p: 1|2|3) => p === 3 ? 0 : 100;
assert(nextAliveFallback(fullRoster, 2, pos3Dead) === 1, "fallback from 2 skips dead position 3, lands on 1");

const onlyPos2Alive = (p: 1|2|3) => p === 2 ? 100 : 0;
assert(nextAliveFallback(fullRoster, 2, onlyPos2Alive) === null, "no fallback available when every OTHER position is dead");
assert(isTeamWiped(fullRoster, (p) => p === 2 ? 100 : 0) === false, "team not wiped while position 2 alive");
assert(isTeamWiped(fullRoster, () => 0) === true, "team wiped when all filled positions are 0 HP");

process.exit(process.exitCode ?? 0);
```

Run:
```bash
npx tsx scripts/verify-team-positions.ts
```
Expected: all `PASS:` lines.

- [ ] **Step 4: Delete the script, typecheck, commit**

```bash
rm scripts/verify-team-positions.ts
npx tsc --noEmit 2>&1 | grep "teamPositions.ts"
git add src/lib/teamPositions.ts
git commit -m "feat(team): add shared teamPositions.ts helper module"
```

---

### Task 3: Rewrite `/team` — 3 position pickers

**Files:**
- Modify: `src/commands/rpg/team.ts`

- [ ] **Step 1: Replace the single-slot picker with 3 position pickers**

Read the current file fully first (`src/commands/rpg/team.ts`) — it's short (~140 lines) and already uses `CHARACTER_KITS` generically. Restructure `execute()`:

1. Query `dbUser` for `teamPosition1`, `teamPosition2`, `teamPosition3` (not `teamAllyCharacterId`).
2. Build a `ResolvedRoster` via `resolveRoster()`.
3. Show an embed listing all 3 positions (`positionLabel()` for each), plus three `StringSelectMenuBuilder`s (customIds `team_pos1`, `team_pos2`, `team_pos3`), each offering:
   - "Yourself" (value `"self"`)
   - every owned character NOT already occupying a different position (filter `ownedIds` against the other two positions' current values)
   - "None" (value `"none"`) — omit this option for Position 1's picker, since position 1 must stay filled.
4. On selecting a value for position N: validate the chosen value isn't already occupying a different position (reject with the same "already on your team" error shape used elsewhere in this codebase); otherwise `prisma.user.update` writing `teamPositionN`, then re-render the embed.

- [ ] **Step 2: Handle the "no owned characters" case**

If `ownedIds.length === 0`, positions 2/3 only ever offer "Yourself" (already used by position 1, so effectively nothing) and "None" — same graceful early-return shape the current file already has for this case, adapted to show all 3 positions with 2/3 forced empty.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit 2>&1 | grep "team.ts"
git add src/commands/rpg/team.ts
git commit -m "feat(team): rewrite /team as a 3-position picker"
```

---

### Task 4: `ascend.ts` — reference implementation for 3-way position dispatch

**Files:**
- Modify: `src/commands/rpg/ascend.ts`

This is the proof-of-pattern file, verified fully before the same transform is mechanically applied to the other 6. Given the size (this file currently has ~1300+ lines after the character-kit work), this task is comparable in scope to a full character's Task 6 dispatch — budget accordingly.

- [ ] **Step 1: Import `teamPositions.ts` helpers**

```typescript
import {
  resolveRoster, filledPositions, nextAliveFallback, isTeamWiped, swappableTargets,
  ResolvedRoster, PositionIndex,
} from "../../lib/teamPositions";
```

- [ ] **Step 2: Replace `activeUnit: "player" | "ally"` with `activeUnit: PositionIndex`**

Find every declaration and read site of `activeUnit` in this file (`grep -n "activeUnit" src/commands/rpg/ascend.ts`). Replace the binary type with `PositionIndex` (1 | 2 | 3). Every `activeUnit === "player"` check becomes a check against `roster.position1 === "self" && activeUnit === 1` — more precisely, since position 1 isn't guaranteed to be "self" anymore, checks need restructuring from "is the player active" to "is THIS position's value 'self'". Introduce a small local helper at the top of the turn-handling closure:

```typescript
const activeValue = (): string => {
  if (activeUnit === 1) return roster.position1;
  if (activeUnit === 2) return roster.position2!;
  return roster.position3!;
};
const isPlayerActive = () => activeValue() === "self";
```

Replace every existing `activeUnit === "player"` with `isPlayerActive()`, and every `activeUnit === "ally"` with `!isPlayerActive()`. Replace every `activeAllyCharacterId === "kaelith"` (etc.) check with `activeValue() === "kaelith"` (etc.) — the existing per-character dispatch branches (Kaelith/Vesper/Rilo's Basic/Skill/Ultimate blocks) need NO other changes; they already dispatch on a characterId string, which `activeValue()` now supplies regardless of which position that character occupies.

- [ ] **Step 3: Triple the per-position state variables**

Every existing single `ally*` variable (`allyHp`, `allyHpMax`, `allyMechanicState`, `allyKit`, `allyBasicLevel`, `allySkillLevel`, `allyUltimateLevel`, `allyIntroLevel`, `allyForteLevel`, `allyConstellation`, `allySolaceStats`) becomes three variables, one per position that isn't "self" (position 1 never needs ally-state if it's "self"; if position 1 is a character, it needs the same ally-state shape position 2/3 would). Simplest approach: since ANY of the 3 positions could hold "self" or a character, give **all 3 positions** a full state set uniformly (including a nominally-unused one for whichever position holds "self") — avoids conditional variable existence, at the cost of a few always-empty variables for the "self" position. Name them `pos1Hp`/`pos1MechanicState`/etc., `pos2Hp`/etc., `pos3Hp`/etc.

Resolve each position's kit/levels/constellation/stats ONCE at fight-start (mirroring how `allyKit`/`allyBasicLevel`/etc. are resolved once today), keyed by whichever characterId (or "self") occupies that position — reading from `CHARACTER_KITS[value]` when `value !== "self"`.

- [ ] **Step 4: Generalize the swap block to any-to-any**

The current swap handler assumes exactly 2 units (`outgoingIsPlayer` boolean). Replace with: the swap button/dropdown produces a target `PositionIndex` directly (not a boolean), and the handler computes `outgoing = activeUnit`, `incoming = targetPosition`, then resolves `outgoingIsSelf = activeValue() === "self"` (using the OUTGOING position's value, not necessarily position 1 anymore) to pick `PLAYER_SELF_OUTRO` vs. the outgoing character kit's `outroEffect()`, and symmetrically for the incoming side. Every per-character Outro/Intro side-channel branch (Kaelith stacks, Vesper mark/energy, Rilo shield/DEF-buff) keeps its existing `activeAllyCharacterId === "X"` check, just re-pointed at `activeValue()` for whichever side (outgoing/incoming) is relevant — these branches already don't care how many total positions exist, only which specific character is transitioning.

- [ ] **Step 5: Generalize `buildButtons()` for the swap dropdown**

Use `swappableTargets(roster, activeUnit)` — if length 1, render today's single "Swap to X" button (label from `positionLabel()`); if length 2, render a `StringSelectMenuBuilder` (customId `battle_swap_select`) listing both. Wire a new collector branch handling `battle_swap_select`'s selected value (parse back to a `PositionIndex`) alongside the existing `battle_swap` button handler (single-target case).

- [ ] **Step 6: Generalize KO handling and the loss condition**

Find the existing "ally KO'd -> auto-swap back to player" block and the fight-loss check (`state.playerHp <= 0` or equivalent). Replace with:
```typescript
if (currentPositionHp(activeUnit) <= 0) {
  const fallback = nextAliveFallback(roster, activeUnit, currentPositionHp);
  if (fallback === null) {
    // defeat — every filled position is down
  } else {
    activeUnit = fallback;
    // announce the forced swap, same flavor text shape as today's "ally KO'd, swapping back"
  }
}
```
where `currentPositionHp(pos)` is a small local lookup returning `pos1Hp`/`pos2Hp`/`pos3Hp`/`state.playerHp` as appropriate (whichever the position currently resolves to — note HP itself is tracked per-POSITION, not per-character-identity, since a position's occupant is fixed for the whole fight, only which position is ACTIVE changes).

- [ ] **Step 7: Typecheck, build**

```bash
npx tsc --noEmit 2>&1 | grep "ascend.ts"
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/commands/rpg/ascend.ts
git commit -m "feat(team): 3-position dispatch in ascend.ts (reference implementation)"
```

---

### Task 5: Apply the same transform to `boss.ts`, `field-boss.ts`, `dungeon.ts`, `src/lib/encounter.ts`

**Files:**
- Modify: `src/commands/rpg/boss.ts`, `src/commands/rpg/field-boss.ts`, `src/commands/rpg/dungeon.ts`, `src/lib/encounter.ts`

Mechanically apply Task 4's Steps 1-6 to each file, following each file's own established variable-naming conventions (confirmed repeatedly this session: `ws.`-prefixed in `dungeon.ts`, plain locals in the others). `dungeon.ts` has no canvas battle card (plain embed) and carries state across waves via the `WaveState` interface — the position-state variables become new `WaveState` fields (mirroring how `riloDefBuffTurnsLeft`/`riloDefBuffPct` were added there earlier this session), threaded through the same `runWave(...)` parameter object and `{ ...ws, survived }` result spread.

- [ ] **Step 1: `boss.ts`** — apply, typecheck (`npx tsc --noEmit 2>&1 | grep "boss.ts"`), build, commit (`feat(team): 3-position dispatch in boss.ts`).
- [ ] **Step 2: `field-boss.ts`** — apply, typecheck, build, commit (`feat(team): 3-position dispatch in field-boss.ts`).
- [ ] **Step 3: `dungeon.ts`** — apply (add position-state fields to `WaveState` interface, its init object, and its cross-wave carry-over block), typecheck, build, commit (`feat(team): 3-position dispatch in dungeon.ts`).
- [ ] **Step 4: `src/lib/encounter.ts`** — apply, typecheck, build, commit (`feat(team): 3-position dispatch in encounter.ts`).

---

### Task 6: `duel.ts` — adapt to per-side (`c*`/`d*`) state

**Files:**
- Modify: `src/commands/rpg/duel.ts`

`duel.ts` doubles everything for two competing players (challenger `c*` / challenged `d*`). Each side independently has its own 3-position roster — this is a 2×3 = 6-way total state space (not 3-way), but each side's 3 positions are resolved and swapped independently of the other side's, so the pattern from Task 4 applies once PER SIDE, not fundamentally differently.

- [ ] **Step 1: Fetch both sides' rosters** at fight-start (`teamPosition1/2/3` for both challenger and challenged users), resolve via `resolveRoster()` twice.
- [ ] **Step 2: Triple `c*` and `d*` position-state fields** on `DuelState` (today's `cAllyHp`/`cAllyMechanicState`/etc. singular fields become `cPos1Hp`/`cPos2Hp`/`cPos3Hp`-shaped triples, same for `d*`).
- [ ] **Step 3: Generalize `myActiveUnit`/`oppActiveUnit`-style resolution** to `PositionIndex` per side, mirroring Task 4 Step 2's `isPlayerActive()`/`activeValue()` helpers, computed per-side (`my`/`opp` prefix already exists in this file's convention — extend it, don't replace it).
- [ ] **Step 4: Generalize the swap block, KO fallback, and loss condition** per-side, reusing `teamPositions.ts`'s helpers with each side's own `ResolvedRoster` and per-side HP lookups.
- [ ] **Step 5: Typecheck, build, commit**

```bash
npx tsc --noEmit 2>&1 | grep "duel.ts"
npm run build
git add src/commands/rpg/duel.ts
git commit -m "feat(team): 3-position dispatch in duel.ts (per-side rosters)"
```

---

### Task 7: `raid.ts` — adapt to per-participant `current.` state

**Files:**
- Modify: `src/commands/rpg/raid.ts`

Each raid participant already carries their own full state object (`RaidParticipant`). Each participant now needs their own 3-position roster and position-state, resolved independently per participant at raid-join time — this is the most natural fit for tripling, since the file already loops `for (const p of alive)` per-participant for AoE damage.

- [ ] **Step 1: Add `roster: ResolvedRoster` and triple the position-state fields** to the `RaidParticipant` interface (today's `allyHp`/`allyMechanicState`/etc. become `pos1Hp`/`pos2Hp`/`pos3Hp`-shaped triples), and to the participant-init object.
- [ ] **Step 2: Generalize `current.activeUnit`** to `PositionIndex`, mirroring Task 4's approach, scoped to `current` (the acting participant) each turn.
- [ ] **Step 3: Generalize the swap block, the AoE-damage KO-fallback (in the per-participant `for (const p of alive)` loop), and the loss condition** using `teamPositions.ts`'s helpers with each participant's own roster.
- [ ] **Step 4: Typecheck, build, commit**

```bash
npx tsc --noEmit 2>&1 | grep "raid.ts"
npm run build
git add src/commands/rpg/raid.ts
git commit -m "feat(team): 3-position dispatch in raid.ts (per-participant rosters)"
```

---

### Task 8: `/profile`, `/character`, and any other reader of the old field

**Files:**
- Modify: `src/commands/rpg/profile.ts` (uses `teamAllyCharacterId` as a fallback for `profileDisplayCharacterId` per this session's earlier work)
- Grep-confirm no other file references the dropped column

- [ ] **Step 1: Update `profile.ts`'s fallback**

```bash
grep -n "teamAllyCharacterId" src/commands/rpg/profile.ts
```
Replace the fallback logic (`teamAllyCharacterId` used when `profileDisplayCharacterId` is unset) with `teamPosition1`/`teamPosition2`/`teamPosition3` — falling back to whichever non-"self" position is filled first (position 2, then position 3), or leaving the profile badge unset if the whole roster is solo ("self" in position 1, nothing else filled). This is a reasonable behavior-preserving adaptation, not a new decision — confirm the exact fallback order doesn't materially matter (it's just "pick something sensible if the player never explicitly set a profile badge").

- [ ] **Step 2: Final repo-wide grep for the dropped field**

```bash
grep -rn "teamAllyCharacterId" src/
```
Expected: zero results.

- [ ] **Step 3: Typecheck, build, commit**

```bash
npx tsc --noEmit
npm run build
git add src/commands/rpg/profile.ts
git commit -m "feat(team): update /profile's fallback to read teamPosition1/2/3"
```

---

### Task 9: Final full-repo verification

- [ ] **Step 1: Full typecheck and build**

```bash
npx tsc --noEmit
npm run build
```
Expected: zero errors.

- [ ] **Step 2: Grep sweep**

```bash
grep -rn "TODO\|FIXME\|placeholder" src/lib/teamPositions.ts src/commands/rpg/team.ts
grep -rn "teamAllyCharacterId" src/
```
Expected: no results.

- [ ] **Step 3: Manual smoke-test checklist** (no test framework — this is the closest available verification for a UI-heavy, multi-file feature)

Using a real Discord test account, confirm:
- `/team` shows 3 position pickers; setting all 3 to different owned characters (or "Yourself") works; picking a value already used elsewhere is rejected.
- Starting `/ascend` (or any combat loop) with a 3-filled roster shows a swap dropdown (not a single button) when 2 other positions are alive.
- Forcing a KO (e.g. via a throwaway low-HP test account state, if one exists from this session's earlier "Task 9: temp test-state grant/restore scripts" precedent) triggers the correct fallback order, and defeat only triggers once all 3 positions are down.
- A solo roster (`/team` with positions 2/3 empty) behaves identically to today's pre-feature behavior — no regression for players who never touch the new roster slots.

- [ ] **Step 4: Announce and hand off to finishing-a-development-branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work."
**REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch — push to `main`, SSH-deploy (`git pull && npx prisma generate && npm run build && pm2 restart cartethyia`).

---

## Self-review notes (completed during plan writing)

- **Spec coverage**: unified 3-position `/team` model ✓ (Task 3), player as a fully benchable position ✓ (Task 4 Step 2's `isPlayerActive()` generalization), direct any-to-any swap + dropdown-when-2-filled ✓ (Task 4 Step 5), Outro/Intro unchanged-but-repointed ✓ (Task 4 Step 4), KO fallback walking position order with wraparound ✓ (`teamPositions.ts`'s `nextAliveFallback`), all-3-KO'd loss condition ✓ (`isTeamWiped`), shared Concerto Energy unchanged ✓ (not touched by any task — confirmed no task modifies energy pooling).
- **Known open items flagged inline, not silently resolved**: Task 4 Step 3's decision to give all 3 positions a full state set uniformly (including the "self" position's unused slot) is a real implementation-time simplification tradeoff, flagged as a choice rather than asserted as the only option. Task 8 Step 1's exact fallback order for `/profile`'s badge default is flagged as "doesn't materially matter" rather than a hard requirement.
- **Explicitly out of scope**, matching the spec: simultaneous multi-unit action (untouched — still one active unit per turn), any deeper restructuring of duel.ts/raid.ts's fundamental architecture beyond position-tripling within their existing shapes, standard-banner pool/launch timing (unrelated), UI polish beyond the dropdown-when-2-filled behavior.
- **Scope acknowledgment**: this plan is large — 9 tasks across all 7 combat loops plus `/team` and `/profile`. Each combat-loop task is comparable in size to a full character's dispatch build (this session built 3 of those). If executing inline in one session proves too large, Tasks 4-7 (the combat loops) are the natural checkpoint boundary to pause between, since Task 4 (ascend.ts) stands alone as a fully verified reference before Tasks 5-7 mechanically repeat it.
