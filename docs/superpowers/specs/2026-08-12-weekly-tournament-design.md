# Weekly Duel Tournament — Design Spec

## Goal

An owner-triggered, single-elimination `/duel` tournament: players sign up, get bracketed, fight real interactive duels round by round over about a week, and top finishers get large one-time rewards plus a permanent bragging-rights title. Meant to drive activity in whichever server it's run in (starting with the support server), not to replace the existing casual `/duel` command.

**Non-goals for this spec:** cross-server tournaments, stat normalization/balancing for fairness, limited cosmetic skins as rewards (explicitly deferred — needs its own art/asset pipeline later), and the separate "fixed-HP big raid battle" feature mentioned alongside this idea (its own future spec).

## Background — what already exists to build on

- `/duel` (`src/commands/rpg/duel.ts`) already runs a full interactive real-time duel between two players — challenge, accept, turn-based combat in a thread, win/loss/forfeit/timeout handling, `combatLock`/`fightTracker` integration. The tournament reuses this engine as-is; it does not reimplement combat.
- `/owner-banner` (`src/commands/utility/owner-banner.ts`) is the existing pattern for an owner-only, `isOwner()`-gated, `setDefaultMemberPermissions(0)` command with subcommands and a `BannerWindow`-style single-row-per-guild DB model.
- `/raid` (`src/commands/rpg/raid.ts`) is the existing pattern for a multi-player Discord event with a join-button signup window, a `MIN_PLAYERS`/`MAX_PLAYERS` cap, and a `setTimeout`-driven auto-start — but its state is **entirely in-memory** (a `Map<channelId, ActiveRaid>`) because a raid only lasts minutes. A tournament spans days, so it cannot use this pattern for its top-level state; it must be DB-backed (see Persistence below). Individual matches *within* the tournament still delegate to `/duel`'s existing in-memory combat engine, same blast-radius reasoning as any single duel today.
- `ready.ts`'s fight-recovery system (built earlier this session) already detects orphaned fights and either refunds a resource or reports no resources deducted. Tournament matches need their own equivalent recovery path (see Match execution → restart handling).

## Command surface

New file `src/commands/utility/tournament.ts`. Owner-only (`isOwner()`), `setDefaultMemberPermissions(0)`, scoped to the guild it's run in (no cross-server logic — a tournament's rows are keyed by `guildId`, exactly one active tournament per guild at a time).

```
/tournament start [signup_hours] [round_hours] [max_players]
  - signup_hours: default 24, how long the Join window stays open
  - round_hours:  default 48, deadline per round before no-shows forfeit
  - max_players:  default 32, hard cap on signups (bracket math + schedule length)

/tournament status
  - Shows phase (signing up / round N in progress / completed), remaining
    players, current round's pairings + deadlines, or final results if done.

/tournament cancel
  - Aborts at any phase. No rewards distributed. Any in-progress duel threads
    for that tournament are archived, not force-ended (players can still
    finish that one duel casually if they want, it just no longer counts).
```

Only one tournament per guild at a time — `start` fails with a clear error if one is already active (signing up, in progress, or awaiting round transition) for that `guildId`.

## Data model

```prisma
model Tournament {
  id            String   @id @default(cuid())
  guildId       String
  channelId     String   // where signup + bracket announcements post
  phase         String   // "SIGNUP" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
  maxPlayers    Int
  signupEndsAt  DateTime
  roundHours    Int      // deadline per round, in hours
  currentRound  Int      @default(0) // 0 = signup, 1+ = which round is live
  createdAt     DateTime @default(now())

  participants  TournamentParticipant[]
  matches       TournamentMatch[]

  @@index([guildId, phase])
  @@map("tournaments")
}

model TournamentParticipant {
  id             String     @id @default(cuid())
  tournamentId   String
  tournament     Tournament @relation(fields: [tournamentId], references: [id])
  userId         String
  seed           Int        // bracket position, assigned at signup close
  eliminated     Boolean    @default(false)
  eliminatedRound Int?      // which round they were knocked out in, null = still in or champion
  joinedAt       DateTime   @default(now())

  @@unique([tournamentId, userId])
  @@map("tournament_participants")
}

model TournamentMatch {
  id            String     @id @default(cuid())
  tournamentId  String
  tournament    Tournament @relation(fields: [tournamentId], references: [id])
  round         Int
  playerAId     String
  playerBId     String?    // null = playerA has a bye this round
  winnerId      String?    // null = not yet resolved
  threadId      String?    // the /duel thread this match ran in, once started
  status        String     // "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FORFEIT"
  deadlineAt    DateTime

  @@map("tournament_matches")
}
```

## Signup flow

1. `/tournament start` posts a signup embed with a **Join** button and the configured window countdown, in the channel the command was run in.
2. Each click creates a `TournamentParticipant` row (unique per tournament+user, so double-joins are a no-op with a friendly "already joined" reply). Capped at `maxPlayers` — the button reports "Tournament is full" once the cap is hit.
3. When `signupEndsAt` passes (a `setTimeout` scheduled at start, same pattern as `/raid`'s auto-start timer):
   - If fewer than 2 participants signed up, the tournament auto-cancels with an embed explaining why.
   - Otherwise, shuffle participants, assign `seed` 1..N, and generate the round-1 bracket.

## Bracket generation

Standard single-elimination. If participant count isn't a power of 2, the difference between the count and the next power of 2 below it gets random byes in round 1 (e.g. 20 players → 12 real matches + 8 byes, so round 2 has exactly 16). A bye is a `TournamentMatch` row with `playerBId: null`, auto-resolved as a win for `playerAId` with no thread created.

## Match execution

For each non-bye `TournamentMatch` in the newly-generated round:
1. Post a pairing announcement pinging both players.
2. Auto-start a duel: reuse `/duel`'s existing accept/combat flow, but skip the manual challenge/accept step — both players are already committed by having signed up, so the duel thread opens directly rather than waiting for an `/duel`-style accept click. Store the resulting `threadId` on the `TournamentMatch` row, set `status: "IN_PROGRESS"`.
3. On win/loss (duel's existing `cleanup()` callback), write `winnerId` and `status: "COMPLETE"` back onto the matching `TournamentMatch` row.
4. If `deadlineAt` passes with `status` still `"PENDING"` or `"IN_PROGRESS"`: whoever never started/finished forfeits. If neither player ever started the duel, the lower `seed` number (earlier signup) advances as a tiebreak.

**Restart handling**: if the bot restarts while a `TournamentMatch` is `"IN_PROGRESS"` (its `/duel` thread was live), the fight itself is lost the same way any interrupted duel is today. On the next `ready.ts` startup pass, any `TournamentMatch` still `"IN_PROGRESS"` with no `winnerId` gets automatically restarted (a fresh duel thread between the same two players, deadline extended by the elapsed time so neither side is unfairly rushed) rather than resolved as a forfeit — a bot crash should never eliminate someone from a tournament they were actively winning.

Once every `TournamentMatch` in the current round is resolved (complete, bye, or forfeit), the next round's bracket generates automatically from the winners and the process repeats. When only one player remains, the tournament moves to `"COMPLETED"`.

## Rewards

Distributed automatically the moment `phase` becomes `"COMPLETED"`:

| Tier | Credits | Fractonite | Radiant Keys | Paradox Cores | Stasis Locks | Aura Prisms | Title |
|---|---|---|---|---|---|---|---|
| Champion | 50,000 | 1,500 | 5 | 15 | 15 | 8 | "Tournament Champion" |
| Runner-up | 25,000 | 750 | 3 | 8 | 8 | 4 | "Tournament Finalist" |
| Semifinalists (both) | 12,000 | 400 | 1 | 3 | 3 | — | — |
| Participation (played ≥1 real match — byes alone don't count) | 1,500 | 100 | — | — | — | — | — |

Titles are a new small field (e.g. `tournamentTitle: String?` on `User`, or a JSON array if stacking multiple over time is desired later) surfaced in `/profile`'s footer, same slot patron tiers already use — no new UI system needed, just extend the existing footer-assembly logic.

Currency rewards go through the existing `awardUser()` helper (same as every other reward path in the codebase), tagged with source `"tournament"` for `auditAward`/anti-cheat logging.

## Error handling / edge cases

- Fewer than 2 signups at window close → auto-cancel, no rewards, clear message why.
- A participant who never plays their round-1 match (no-show from the very first pairing) forfeits exactly like a no-show in any later round — no special-casing round 1.
- A player already in another `/duel`/combat lock when their tournament match tries to start: the auto-start attempt fails gracefully, retried a few minutes later before eventually counting as a no-show if it never succeeds before the round deadline.
- Only one active tournament per guild — `start` checks for an existing non-`COMPLETED`/`CANCELLED` `Tournament` row for that `guildId` first.

## Testing

No automated test framework in this codebase — verification via `npx tsc --noEmit`, `npm run build`, and manual live testing:
- Run a small tournament (4-8 test/alt accounts) end to end: signup, bracket generation with an odd count (confirm bye works), at least one real duel match, one deliberate no-show forfeit, and full reward distribution at completion.
- Kill and restart the bot mid-match, confirm the interrupted match auto-restarts rather than resolving as a forfeit.
- Confirm `/tournament status` renders correctly at each phase (signup countdown, round in progress with pairings, completed with final standings).
