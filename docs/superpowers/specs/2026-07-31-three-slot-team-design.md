# Three-Slot Team Design

**Goal:** Expand `/team` from "player + 1 chosen ally" to "player + 2 chosen allies," with in-combat swapping between all three units directly (not just player↔ally) — and the player themselves becomes a fully symmetric, fully benchable unit rather than a fixed anchor that must always be active turn 1 forever. This is the multi-character roster `profileDisplayCharacterId`'s original comment anticipated ("survives the future multi-character `/team` roster without needing to be untangled from combat-ally selection") — that decoupling already exists, this spec is the roster expansion it was built for.

**Status:** Approved by user 2026-07-31. Not yet implemented.

---

## Roster & `/team` Command

- `/team` gains two independent slot pickers — "Slot 2" and "Slot 3" — each a `StringSelectMenuBuilder` listing the player's owned characters (a `characterProgress` row exists for that `characterId`), same select-menu UX the command already has for its single slot today, just twice.
- A character can only occupy one slot at a time (picking the same character for both slots is rejected, same validation shape as "you don't own that character").
- Either slot can be set to "None — solo" independently; a player can run 1, 2, or 3-unit rosters.

## Database

Replace the single column with two:

```prisma
teamAllySlot1CharacterId String?
teamAllySlot2CharacterId String?
```

(Drop `teamAllyCharacterId` — no back-compat needed, single-player game state, not a public API.)

## Combat State Shape

Every combat loop's `activeUnit: "player" | "ally"` becomes `activeUnit: "player" | "allySlot1" | "allySlot2"`. Each ally slot carries its own full parallel state set — HP/HPMax, `allyMechanicState`, kit levels (basic/skill/ultimate/intro/forte), constellation, resolved stats — mirroring exactly what today's single `ally*` variable set already tracks, just duplicated per slot (`allySlot1Hp`/`allySlot2Hp`, etc.) rather than a new state concept.

`allyKit`/`allyConstellation`/etc. become "whichever slot's kit is relevant for the branch currently executing" — resolved once per turn based on `activeUnit`, same as today's single-ally resolution, just branching three ways instead of two.

## Swap Mechanic

- **The player is now a fully symmetric 3rd unit**, not a fixed anchor. Today's rule ("the player's own character always fights turn-1 and can never be fully benched") is removed — the player can be swapped out entirely and stay benched for the rest of the fight, exactly like an ally slot can today.
- Any unit may swap directly to any other unit (player ↔ slot1, player ↔ slot2, slot1 ↔ slot2) — six possible transitions instead of today's two. The fight still opens with the player active turn 1 by default (no change to fight *start*), but nothing prevents swapping away from them immediately and never swapping back.
- **Button UX**: if only one other unit is benched, the swap button behaves exactly as it does now — a single "Swap to X" button, no picker. If two other units are benched, the button opens a `StringSelectMenuBuilder` listing them — same picker pattern `/team` itself already uses.
- **Outro/Intro**: unchanged mechanically. Whichever unit is leaving triggers its own `outroEffect()`; whichever unit is arriving triggers its own `introEffect()`. This already generalizes to any-to-any swaps without new logic — the existing code reasons about "outgoing" and "incoming," never hardcodes "player" or "ally" as fixed roles. (The player's own Outro/Intro already exists today as `PLAYER_SELF_OUTRO`/`PLAYER_SELF_INTRO` for the player↔ally case — reused unchanged for player↔either-slot.)
- **Concerto Energy**: stays one shared meter for the whole team (not per-pair, not per-slot) — a swap of any kind consumes the same shared bar, exactly like today's single-ally version.

## Loss Condition

Today, a fight ends in defeat the instant `state.playerHp` hits 0, regardless of who's active, and a KO'd ally auto-swaps back to the player rather than ending the fight. Since the player can now be fully benched, this generalizes:

- **Defeat only triggers once all 3 units (player + both filled ally slots) have hit 0 HP.** An empty ("None — solo") slot doesn't count toward this — if a player runs solo, defeat is still just their own HP hitting 0, unchanged.
- **A KO'd active unit auto-swaps to any other unit still standing** (player, or either living ally slot) — generalizing today's "KO'd ally swaps back to player" rule, which assumed the player was always the fallback. Now the fallback is "whichever of the remaining units is alive," picking the same priority order the swap-dropdown would show (or an arbitrary deterministic order — e.g. player first if alive, then slot1, then slot2 — since this is an automatic system swap with no player input, not a fight-ending choice).
- If the currently active unit KOs and no other unit is alive, the fight ends in defeat immediately (all 3 down).

## Explicitly Out of Scope

- Simultaneous multi-unit action (confirmed: still exactly one unit acts per turn, matching today's model) — not a combat-pacing change, purely a roster-size and swap-flexibility change.
- Any change to `duel.ts`/`raid.ts`'s fundamentally different state shapes (per-side `c*`/`d*` fields in duel, per-participant `current.` in raid) beyond mechanically applying the same 3-slot pattern within each file's existing shape — no restructuring of those files' architecture.
- Standard-banner pool / launch timing for any character — unrelated to this feature.
- UI/UX polish beyond the described dropdown-when-2-filled behavior.
