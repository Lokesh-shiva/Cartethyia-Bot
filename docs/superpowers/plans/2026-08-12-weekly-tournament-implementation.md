# Weekly Duel Tournament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/tournament` — an owner-only, single-elimination `/duel` tournament that runs over about a week, DB-backed so it survives restarts, with automatic bracket progression and tiered rewards.

**Architecture:** Three new Prisma models hold all tournament state (never in-memory, unlike `/raid`, since a tournament spans days). A new `src/lib/tournament.ts` holds pure bracket logic. `duel.ts` gets one new exported function that starts a duel programmatically (skipping the challenge/accept UI) so the tournament can auto-start matches. A `setInterval` sweep (started once at bot boot) drives round transitions, deadline forfeits, and reward distribution — no per-tournament `setTimeout` chains, since those don't survive restarts.

**Tech Stack:** TypeScript, Prisma, discord.js. No test framework — verification via `npx tsc --noEmit`, `npm run build`, disposable scripts, and manual live testing (per project convention).

**Reference:** [docs/superpowers/specs/2026-08-12-weekly-tournament-design.md](../specs/2026-08-12-weekly-tournament-design.md)

---

### Task 1: Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the three tournament models + the title field on `User`**

Add near the other event-style models (e.g. after `ActiveFight`):

```prisma
model Tournament {
  id            String   @id @default(cuid())
  guildId       String
  channelId     String
  phase         String   // "SIGNUP" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
  maxPlayers    Int
  signupEndsAt  DateTime
  roundHours    Int
  currentRound  Int      @default(0)
  createdAt     DateTime @default(now())

  participants  TournamentParticipant[]
  matches       TournamentMatch[]

  @@index([guildId, phase])
  @@map("tournaments")
}

model TournamentParticipant {
  id              String     @id @default(cuid())
  tournamentId    String
  tournament      Tournament @relation(fields: [tournamentId], references: [id])
  userId          String
  seed            Int
  eliminated      Boolean    @default(false)
  eliminatedRound Int?
  joinedAt        DateTime   @default(now())

  @@unique([tournamentId, userId])
  @@map("tournament_participants")
}

model TournamentMatch {
  id           String     @id @default(cuid())
  tournamentId String
  tournament   Tournament @relation(fields: [tournamentId], references: [id])
  round        Int
  playerAId    String
  playerBId    String?
  winnerId     String?
  threadId     String?
  status       String     // "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FORFEIT"
  deadlineAt   DateTime

  @@map("tournament_matches")
}
```

Add to the `User` model (near `profileDisplayCharacterId`):
```prisma
tournamentTitle String? // "Tournament Champion" | "Tournament Finalist" | null — shown in /profile footer
```

- [ ] **Step 2: Push + generate**

Run: `npm run db:push`
Expected: "Your database is now in sync with your Prisma schema."

Run: `npx prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: no errors (schema-only change, nothing references the new models yet).

```bash
git add prisma/schema.prisma
git commit -m "feat(tournament): add Tournament/TournamentParticipant/TournamentMatch schema"
```

---

### Task 2: Bracket logic (`src/lib/tournament.ts`)

**Files:**
- Create: `src/lib/tournament.ts`

Pure, DB-agnostic bracket functions — easy to verify in isolation before wiring into Discord.

- [ ] **Step 1: Write the seeding + pairing functions**

```ts
// src/lib/tournament.ts
// Pure bracket logic — no Discord/Prisma imports, so it's trivially testable
// in isolation. Callers (tournament.ts command, the round-transition sweep)
// own all persistence.

export interface SeededPlayer {
  userId: string;
  seed:   number;
}

export interface Pairing {
  playerAId: string;
  playerBId: string | null; // null = bye
}

/** Shuffle + assign seeds 1..N. Pure — caller persists the result. */
export function seedParticipants(userIds: string[]): SeededPlayer[] {
  const shuffled = [...userIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((userId, i) => ({ userId, seed: i + 1 }));
}

/**
 * Round-1 pairing: byes for whoever doesn't fit into the largest power-of-2
 * subset, chosen so ROUND 2's count (byes carried forward + match winners)
 * comes out to exactly that power of 2.
 *
 * round2Count = largest power of 2 <= n (the target size for round 2)
 * matchCount  = n - round2Count       (each match eliminates exactly 1 player,
 *                                       so this many matches gets you from n
 *                                       down to round2Count players remaining)
 * byeCount    = round2Count - matchCount = 2*round2Count - n
 *
 * Example, n=20: round2Count=16, matchCount=20-16=4, byeCount=16-4=12.
 * Check: 12 byes + 4 match winners = 16 = round2Count. Correct.
 */
export function generateFirstRoundPairings(seeded: SeededPlayer[]): Pairing[] {
  const n = seeded.length;
  const round2Count = Math.pow(2, Math.floor(Math.log2(n)));
  const matchCount  = n - round2Count;
  const byeCount    = round2Count - matchCount;

  const byeSeeds = new Set(seeded.slice(0, byeCount).map(p => p.seed));
  const pairings: Pairing[] = [];
  const remaining = seeded.filter(p => !byeSeeds.has(p.seed)); // exactly matchCount*2 players

  for (const p of seeded.filter(p => byeSeeds.has(p.seed))) {
    pairings.push({ playerAId: p.userId, playerBId: null });
  }
  for (let i = 0; i < remaining.length; i += 2) {
    pairings.push({ playerAId: remaining[i].userId, playerBId: remaining[i + 1].userId });
  }
  return pairings;
}

/** Every later round: winners list is already a power of 2, pair sequentially. */
export function generateNextRoundPairings(winnerIds: string[]): Pairing[] {
  const pairings: Pairing[] = [];
  for (let i = 0; i < winnerIds.length; i += 2) {
    pairings.push({ playerAId: winnerIds[i], playerBId: winnerIds[i + 1] ?? null });
  }
  return pairings;
}
```

- [ ] **Step 2: Verify with a disposable script**

```ts
// scratchpad: scripts/check-bracket-logic.ts (temporary, delete after)
import { seedParticipants, generateFirstRoundPairings } from "../src/lib/tournament";
for (const n of [4, 5, 8, 20, 32]) {
  const seeded = seedParticipants(Array.from({ length: n }, (_, i) => `p${i}`));
  const pairings = generateFirstRoundPairings(seeded);
  const byes = pairings.filter(p => p.playerBId === null).length;
  const matches = pairings.filter(p => p.playerBId !== null).length;
  const round2 = byes + matches;
  const isPow2 = (round2 & (round2 - 1)) === 0;
  console.log(`n=${n}: ${byes} byes, ${matches} matches, round2=${round2}, isPow2=${isPow2}`);
}
```

Run: `npx tsx scripts/check-bracket-logic.ts`
Expected: `isPow2=true` for every n tested, and for n=20 specifically: `12 byes, 4 matches, round2=16`.

- [ ] **Step 3: Delete the verification script**

```bash
rm scripts/check-bracket-logic.ts
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/tournament.ts
git commit -m "feat(tournament): bracket seeding + pairing logic"
```

---

### Task 3: `startDuelMatch()` — programmatic duel start in `duel.ts`

**Files:**
- Modify: `src/commands/rpg/duel.ts`

This is the most structurally significant task: extracting the "Accept — start duel" branch (currently only reachable from the challenge/accept button collector) into a standalone exported function the tournament sweep can call directly, without a challenge/accept step.

- [ ] **Step 1: Locate the existing accept-branch logic**

Read `duel.ts`'s `challengeCollector?.on("collect", ...)` handler — specifically everything from the `// Accept — start duel` comment (state construction, thread creation, `runDuelTurn()` call) through the end of that callback. This is the code to extract.

- [ ] **Step 2: Extract it into an exported function**

```ts
// New exported function, same file, placed after the existing DuelState/
// buildDuelButtons/duelEmbed helpers, before `execute()`.
export async function startDuelMatch(
  guild: import("discord.js").Guild,
  channel: TextChannel,
  playerAId: string,
  playerBId: string,
  onComplete: (winnerId: string | null, threadId: string) => void,
): Promise<{ threadId: string } | { error: string }> {
  // Body: everything the challenge/accept branch already does from
  // "// Requires each side to have actually picked Solace via /team." onward
  // (roster resolution, state construction, thread creation, runDuelTurn()),
  // MINUS the challenge-embed/accept-button steps that come before it —
  // this function is invoked already-accepted.
  //
  // The only NEW piece: wrap the existing `cleanup()` closure so it also
  // calls `onComplete(winnerId, thread.id)` after doing everything it
  // already does (rewards, lock release, thread archive). Tournament reward
  // distribution stays separate from /duel's own WIN_CREDITS/WIN_EXP path —
  // onComplete only reports the result, it doesn't grant anything itself.
  //
  // Acquire combat locks for both players same as the existing flow
  // (acquireLock/releaseLock) — if either lock fails (already in a fight),
  // return { error: "..." } instead of proceeding, so the caller (the round
  // sweep) can retry later rather than crash.
}
```

- [ ] **Step 3: Rewire the existing challenge/accept flow to call it**

The existing `challengeCollector.on("collect", ...)` accept branch should now just call `startDuelMatch(...)` with a no-op-ish `onComplete` (or one that does nothing extra, since normal `/duel` already handles its own completion inline) — replacing the duplicated logic, not running two copies of it. This is a refactor, not a new feature: normal `/duel` behavior must be unchanged after this step.

- [ ] **Step 4: Verify manually**

Run: `npm run build` then live-test a normal `/duel` (not tournament) end to end — challenge, accept, full fight to a win — confirm it behaves identically to before the refactor. This is the highest-risk step in the whole plan; do not skip live verification here.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/duel.ts
git commit -m "refactor(duel): extract startDuelMatch() for programmatic (tournament) use"
```

---

### Task 4: `/tournament` command — start, status, cancel, signup

**Files:**
- Create: `src/commands/utility/tournament.ts`

- [ ] **Step 1: Command skeleton + `start` subcommand**

Follow `owner-banner.ts`'s exact pattern (`isOwner()` gate, `setDefaultMemberPermissions(0)`, subcommands). `start` takes `signup_hours` (default 24), `round_hours` (default 48), `max_players` (default 32, max e.g. 128 as a hard ceiling). Checks for an existing non-`COMPLETED`/`CANCELLED` `Tournament` row for the guild first (reject with a clear error if found). Creates the `Tournament` row with `phase: "SIGNUP"`, posts the signup embed with a Join button.

- [ ] **Step 2: Join button collector**

A `createMessageComponentCollector` on the signup message, running until `signupEndsAt`. On click: upsert-guarded `TournamentParticipant` create (unique constraint on `[tournamentId, userId]` means a duplicate click just no-ops with a friendly reply), reject once `maxPlayers` reached.

- [ ] **Step 3: `status` subcommand**

Reads the guild's active `Tournament` row (any phase) and renders it: signup countdown if `SIGNUP`, current round's pairings + deadlines if `IN_PROGRESS` (join with `TournamentMatch` rows for `currentRound`), final standings if `COMPLETED`.

- [ ] **Step 4: `cancel` subcommand**

Sets `phase: "CANCELLED"`. No rewards. In-progress duel threads are left alone (archived only when their own natural cleanup runs, not force-ended).

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit`, `npm run build`.

```bash
git add src/commands/utility/tournament.ts
git commit -m "feat(tournament): /tournament start/status/cancel + signup flow"
```

---

### Task 5: Round-transition sweep

**Files:**
- Create: `src/lib/tournamentSweep.ts`
- Modify: `src/events/ready.ts` (start the sweep on boot)

A single `setInterval` (not per-tournament timers, which don't survive restarts) checked periodically (every few minutes is plenty given hour-scale deadlines) that drives everything time-based.

- [ ] **Step 1: Write the sweep function**

```ts
// src/lib/tournamentSweep.ts
import { Client } from "discord.js";
import prisma from "./prisma";
import { generateFirstRoundPairings, generateNextRoundPairings, seedParticipants } from "./tournament";
import { startDuelMatch } from "../commands/rpg/duel";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 min — deadlines are hour-scale, no need for tighter polling

export function startTournamentSweep(client: Client): void {
  setInterval(() => runSweep(client).catch(err => console.error("[Tournament] sweep error:", err)), SWEEP_INTERVAL_MS);
}

async function runSweep(client: Client): Promise<void> {
  // 1. Close signup windows whose signupEndsAt has passed: generate round 1
  //    via seedParticipants()+generateFirstRoundPairings(), write
  //    TournamentParticipant.seed + TournamentMatch rows, set phase
  //    "IN_PROGRESS", currentRound 1. If < 2 participants, phase "CANCELLED"
  //    instead with a posted explanation.
  // 2. For each Tournament in "IN_PROGRESS": start any "PENDING" match whose
  //    thread hasn't been created yet by calling startDuelMatch() (skip byes
  //    — resolve those instantly as a win, no thread). On startDuelMatch
  //    returning an error (lock conflict), leave it PENDING to retry next
  //    sweep.
  // 3. For each match past its deadlineAt still without a winnerId: mark
  //    FORFEIT, resolve winner per the tiebreak rule (earlier seed if neither
  //    started; the one who started if only one did).
  // 4. Once every match in the current round is resolved (COMPLETE/FORFEIT/
  //    bye): generate the next round via generateNextRoundPairings() from
  //    winners, increment currentRound. If only one winner remains, phase
  //    "COMPLETED" and distribute rewards (Task 6).
}
```

- [ ] **Step 2: Wire it into startup**

In `ready.ts`, alongside the other one-time startup calls: `startTournamentSweep(client);`

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`, `npm run build`.

```bash
git add src/lib/tournamentSweep.ts src/events/ready.ts
git commit -m "feat(tournament): round-transition sweep (signup close, match start, deadlines, round advance)"
```

---

### Task 6: Reward distribution + profile title

**Files:**
- Modify: `src/lib/tournamentSweep.ts` (reward distribution on completion)
- Modify: `src/commands/rpg/profile.ts` (show `tournamentTitle` in footer)

- [ ] **Step 1: Reward table + distribution**

In the sweep's "phase COMPLETED" branch:

```ts
const REWARDS = {
  champion:      { credits: 50_000, fractonite: 1500, fractureKeys: 0, radiantKeys: 5, paradoxCores: 15, stasisLocks: 15, auraPrisms: 8 },
  runnerUp:      { credits: 25_000, fractonite: 750,                  radiantKeys: 3, paradoxCores: 8,  stasisLocks: 8,  auraPrisms: 4 },
  semifinalist:  { credits: 12_000, fractonite: 400,                  radiantKeys: 0, paradoxCores: 3,  stasisLocks: 3 },
  participation: { credits: 1_500,  fractonite: 100 },
};
```
Champion + runner-up also get `prisma.user.update({ data: { tournamentTitle: "Tournament Champion" | "Tournament Finalist" } })`. Semifinalists = the two losers of the final's semifinal round. Participation = every `TournamentParticipant` who played at least one non-bye match (check `TournamentMatch` rows where they appear as `playerAId`/`playerBId` and the match isn't a bye).

All currency via the existing `awardUser()` helper, source tag `"tournament"`.

- [ ] **Step 2: Show the title in `/profile`**

Find where `/profile`'s footer assembles `patronTitle`/`solaceBadge` (search for `patronTitle` in `profile.ts`) and add a `tournamentTitleLine` alongside it, same string-concatenation pattern.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`, `npm run build`.

```bash
git add src/lib/tournamentSweep.ts src/commands/rpg/profile.ts
git commit -m "feat(tournament): reward distribution + profile title display"
```

---

### Task 7: Restart recovery for in-progress matches

**Files:**
- Modify: `src/events/ready.ts`

- [ ] **Step 1: Extend the existing stale-fight recovery pass**

The general `ActiveFight` recovery loop (built earlier this session) already handles normal interrupted fights. Add a parallel pass: any `TournamentMatch` with `status: "IN_PROGRESS"` and no `winnerId` gets its `threadId` cleared and `status` reset to `"PENDING"` with `deadlineAt` pushed forward by the elapsed downtime, so the next sweep cycle restarts it fresh rather than treating the elapsed downtime as forfeit time.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit`, `npm run build`.

```bash
git add src/events/ready.ts
git commit -m "feat(tournament): restart recovery re-queues interrupted matches instead of forfeiting them"
```

---

### Task 8: Final verification + deploy

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Deploy the new slash command**

`/tournament` is a brand-new command — needs `npm run deploy` (guild) and `GLOBAL=true npm run deploy` (global) same as any new command this session.

- [ ] **Step 3: Push + SSH deploy**

```bash
git push origin main
```
Then on the VM: `git pull && npx prisma generate && npm run build && pm2 restart cartethyia` (schema changed, `prisma generate` required).

- [ ] **Step 4: Manual end-to-end test**

Per the spec's Testing section: run a small tournament with test/alt accounts (signup, odd-count bye verification, at least one real duel match played to completion, one deliberate no-show forfeit, full reward distribution), plus a deliberate bot restart mid-match to confirm the recovery path re-queues rather than forfeits.
