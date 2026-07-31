# Three-Slot Team Design

**Goal:** Expand `/team` from "player + 1 chosen ally" to "player + 2 chosen allies," with in-combat swapping between all three units directly (not just player↔ally). This is the multi-character roster `profileDisplayCharacterId`'s original comment anticipated ("survives the future multi-character `/team` roster without needing to be untangled from combat-ally selection") — that decoupling already exists, this spec is the roster expansion it was built for.

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

- Any unit may swap directly to any other unit (player → slot1, player → slot2, slot1 → slot2, and the reverses) — six possible transitions instead of today's two.
- **Button UX**: if only one ally slot is filled (today's common case), the swap button behaves exactly as it does now — a single "Swap to X" button, no picker. If both ally slots are filled, the button opens a `StringSelectMenuBuilder` listing the units NOT currently active (1 or 2 options depending on who's active) — same picker pattern `/team` itself already uses.
- **Outro/Intro**: unchanged mechanically. Whichever unit is leaving triggers its own `outroEffect()`; whichever unit is arriving triggers its own `introEffect()`. This already generalizes to any-to-any swaps without new logic — the existing code reasons about "outgoing" and "incoming," never hardcodes "player" or "ally" as fixed roles.
- **Concerto Energy**: stays one shared meter for the whole team (not per-pair, not per-slot) — a swap of any kind consumes the same shared bar, exactly like today's single-ally version.

## Explicitly Out of Scope

- Simultaneous multi-unit action (confirmed: still exactly one unit acts per turn, matching today's model) — not a combat-pacing change, purely a roster-size and swap-flexibility change.
- Any change to `duel.ts`/`raid.ts`'s fundamentally different state shapes (per-side `c*`/`d*` fields in duel, per-participant `current.` in raid) beyond mechanically applying the same 3-slot pattern within each file's existing shape — no restructuring of those files' architecture.
- Standard-banner pool / launch timing for any character — unrelated to this feature.
- UI/UX polish beyond the described dropdown-when-2-filled behavior.
