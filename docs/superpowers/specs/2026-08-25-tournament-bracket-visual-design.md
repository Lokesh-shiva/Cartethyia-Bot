# Tournament Bracket Visual — Design Spec

## Goal

A live-updating visual bracket tree for `/tournament`, so players can see the whole draw and how it's progressing at a glance instead of reading a flat text list. One message per tournament, posted when round 1's pairings are generated, auto-pinned, and edited in place every time something changes — a match resolves, a round advances, or the tournament finishes.

## Background

`/tournament status` currently renders the current round only, as a flat text list (`@A vs @B — ✅ won by @A`). It doesn't show the whole draw, earlier rounds, or how the bracket narrows toward a champion. All tournament state already lives in `Tournament`/`TournamentParticipant`/`TournamentMatch` (see `prisma/schema.prisma`); `src/lib/tournamentSweep.ts`'s sweep is the sole place matches get created/resolved today (round-1 generation, match auto-start, deadline forfeits, round advance, completion).

## Approach

**Rendering:** a classic horizontal bracket tree — round 1 on the left, each pair's winner advancing into a connector line that feeds the next round's box, ending at a single champion box on the right. New file `src/lib/tournamentBracketCard.ts`, following this project's existing canvas-card convention (`@napi-rs/canvas`, one file per card type — see `versusCard.ts`, `gridCard.ts` for the established style).

**Node content:** each match box shows both players' **display names** (guild nickname if set, else global display name — resolved via `guild.members.fetch({ user: [...ids] })` in one batch call, not per-player fetches), colored by their element (reusing `ELEMENT_HEX`). No avatars — keeps rendering fast and reliable even at max bracket size (128 players = up to 64 first-round boxes), and sidesteps the avatar-fetch retry/failure surface entirely for this card. A bye shows the single advancing name with no opponent line. An unresolved match shows both names in full color; a resolved one dims the loser's name and keeps the winner's at full color/weight. Byes count as immediately "resolved" (the sole name is already the winner).

**Font handling:** names must render correctly regardless of what characters a player's nickname uses (CJK, full-width, stylized Unicode, emoji, etc.) — reuses the same `FONT_FALLBACK` stack already established in `canvas.ts` (`'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', 'Arial Unicode MS', Arial, sans-serif`) rather than inventing a new one.

**Scale:** always renders every round present so far, however wide that makes the image — no size cap or fallback-to-text. Canvas width scales with round count (`currentRound`, capped at how many rounds exist for `maxPlayers`); height scales with round-1's match count, since that's always the tallest round. Later rounds are vertically centered between their two round-1 feeder positions, per standard bracket layout math.

**Persistence:** add `bracketMessageId String?` to the `Tournament` model — the one message this card gets posted to and then repeatedly edited in place, rather than reposting a new image every time. Posted (and pinned) the moment round 1's pairings are generated in `closeExpiredSignups()`; unpinned when the tournament reaches `COMPLETED` or `CANCELLED`.

**Update triggers:** a single exported `updateBracketMessage(client, tournamentId)` in `tournamentSweep.ts` does the full "fetch every match across every round so far → resolve display names → render → edit `bracketMessageId` (or post fresh and pin if it doesn't exist yet, e.g. the message was deleted)" cycle. Called from the four places tournament state already changes: after round-1 generation, after a match's `onComplete` callback fires (win or forfeit), after `resolveDeadlineForfeits()` resolves a match, and after `advanceCompletedRounds()` either starts the next round or finishes the tournament. This keeps the bracket accurate within one sweep tick of any change, same as everything else in this system — no new timer, no polling of its own.

## What does NOT change

- `/tournament status`'s existing text output stays as-is (still useful for quick mobile-friendly reading); the bracket image is additive, not a replacement.
- No change to match-resolution logic itself (win/forfeit/bye handling in `tournamentSweep.ts`) — this only adds a render-and-post step after state already changes.
- `/tournament start-match` and the round-hours messaging fixed in the previous session are untouched.

## Testing

No automated test framework in this codebase — verification via `npx tsc --noEmit`, `npm run build`, and live manual testing: run a small test tournament (4-8 alt accounts, `signup_minutes` for a fast signup window), confirm the bracket posts and pins on round 1, updates correctly after a win, a bye, and a deadline forfeit, advances correctly into round 2, and unpins/stops updating once the tournament completes. Also spot-check a nickname with CJK/stylized characters renders as real glyphs, not boxes.
