# Three-Slot Team Design

**Goal:** Expand `/team` from "player + 1 chosen ally" to "player + 2 chosen allies," with in-combat swapping between all three units directly (not just player↔ally) — and the player themselves becomes a fully symmetric, fully benchable unit rather than a fixed anchor that must always be active turn 1 forever. This is the multi-character roster `profileDisplayCharacterId`'s original comment anticipated ("survives the future multi-character `/team` roster without needing to be untangled from combat-ally selection") — that decoupling already exists, this spec is the roster expansion it was built for.

**Status:** Approved by user 2026-07-31. Not yet implemented.

---

## Roster & `/team` Command — Unified Position Model

Rather than "pick 2 allies" and "set order" as two separate steps, `/team` exposes three **position pickers** — Position 1, Position 2, Position 3 — each a `StringSelectMenuBuilder` offering "Yourself" plus every owned character (a `characterProgress` row exists for that `characterId`), or "None" for positions 2/3. Filling a position *is* choosing both roster membership and turn/fallback order in one action — there's no separate ordering step.

- Position 1 defaults to "Yourself" but can be changed — the player is not guaranteed to start.
- The same unit (whether "Yourself" or a specific character) can only occupy one position; picking a unit already placed elsewhere is rejected the same way "you don't own that character" is today.
- Position 1 must be filled (a team needs a starting unit). Positions 2/3 can independently be "None," supporting 1, 2, or 3-unit rosters.

## Database

Replace the single column with three, directly encoding both roster and order:

```prisma
teamPosition1 String? // "self" | a characterId. Null only transiently invalid — always filled in practice.
teamPosition2 String? // "self" | a characterId | null ("None")
teamPosition3 String? // "self" | a characterId | null ("None")
```

(Drop `teamAllyCharacterId` — no back-compat needed, single-player game state, not a public API. The literal string `"self"` represents the player's own character occupying that position, distinguishing it from a `characterId` value.)

## Combat State Shape

Every combat loop's `activeUnit: "player" | "ally"` becomes `activeUnit: 1 | 2 | 3` (position index) or an equivalent named union (`"pos1" | "pos2" | "pos3"`) — whichever reads more naturally per file, decided at implementation time. Each position carries its own full parallel state set — HP/HPMax, kit-specific `mechanicState`, kit levels, constellation, resolved stats — mirroring exactly what today's single `ally*` variable set already tracks, just tripled (once per position) instead of doubled. If a position holds "self," its state is the player's own existing stat block (no ally kit involved), same as today's "player" branch.

Whichever kit/constellation/etc. is "active" resolves once per turn based on `activeUnit`, branching three ways instead of two — same resolution pattern already used for the binary case.

## Swap Mechanic

- **The player is one of the three positions**, not a fixed anchor — if Position 1 is "self," the fight opens with the player active turn 1 by default (no change to fight *start*), but nothing prevents swapping away from them immediately and never swapping back, including for the whole fight.
- Any position may swap directly to any other filled position — up to six possible transitions (2 units filled = 2 transitions; 3 filled = 6).
- **Button UX**: if only one other position is filled, the swap button behaves exactly as it does now — a single "Swap to X" button, no picker. If two other positions are filled, the button opens a `StringSelectMenuBuilder` listing them — same picker pattern `/team` itself already uses.
- **Outro/Intro**: unchanged mechanically. Whichever unit is leaving triggers its own `outroEffect()`; whichever unit is arriving triggers its own `introEffect()` — already generalizes to any-to-any swaps without new logic, since the existing code reasons about "outgoing"/"incoming," never hardcoded position roles. (The player's own Outro/Intro already exists today as `PLAYER_SELF_OUTRO`/`PLAYER_SELF_INTRO` for the player↔ally case — reused unchanged whenever "self" is the outgoing/incoming position.)
- **Concerto Energy**: stays one shared meter for the whole team (not per-pair, not per-position) — a swap of any kind consumes the same shared bar, exactly like today's single-ally version.

## Loss Condition & KO Fallback

Today, a fight ends in defeat the instant `state.playerHp` hits 0, regardless of who's active, and a KO'd ally auto-swaps back to the player rather than ending the fight. Generalized:

- **Defeat only triggers once every filled position has hit 0 HP.** An unfilled ("None") position doesn't count — a solo player's defeat condition is unchanged.
- **A KO'd active unit auto-swaps to the next living unit in position order**, wrapping around (1 → 2 → 3 → 1). E.g., if Position 2 is active and KOs, fall back to Position 3 if alive, else Position 1, else defeat. This directly reuses the same 1/2/3 ordering the player set in `/team` — no separate fallback-priority concept needed.
- If the currently active position KOs and every other filled position is also already at 0 HP, the fight ends in defeat immediately.

## Explicitly Out of Scope

- Simultaneous multi-unit action (confirmed: still exactly one unit acts per turn, matching today's model) — not a combat-pacing change, purely a roster-size and swap-flexibility change.
- Any change to `duel.ts`/`raid.ts`'s fundamentally different state shapes (per-side `c*`/`d*` fields in duel, per-participant `current.` in raid) beyond mechanically applying the same 3-slot pattern within each file's existing shape — no restructuring of those files' architecture.
- Standard-banner pool / launch timing for any character — unrelated to this feature.
- UI/UX polish beyond the described dropdown-when-2-filled behavior.
