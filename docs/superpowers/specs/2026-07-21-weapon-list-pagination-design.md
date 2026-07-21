# Paginated Selection for /equip and /weapon-refine

## Problem

`/equip` and `/weapon-refine` both build a Discord select menu from a player's full weapon list. Discord caps select menus at 25 options, so both commands currently just `slice(0, 25)` and silently hide the rest (with a footnote on `/equip`, nothing on `/weapon-refine`'s two lists). Players with larger arsenals can't reach weapons past the 25th.

## Design

A shared 10-per-page pagination pattern:

- `src/lib/pagination.ts` (new): `buildPageNavRow(customIdPrefix: string, page: number, pageCount: number): ActionRowBuilder<ButtonBuilder>` — returns a button row with `◀ Prev` (customId `${customIdPrefix}:prev`) and `▶ Next` (customId `${customIdPrefix}:next`), each disabled at its respective boundary (page 0 for Prev, `pageCount - 1` for Next). Also exports `PAGE_SIZE = 10` and a `pageSlice<T>(items: T[], page: number): T[]` helper (`items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)`).

- **`/equip`** (`src/commands/rpg/equip.ts`): replace `selectableWeapons = weapons.slice(0, 25)` and the "-# Showing top 25 of N" note with real paging. A `let page = 0` closure variable (declared alongside the existing collector setup) drives both the select-menu options and the embed's weapon-list text, both rebuilt via a `render(page)` function. The button row from `buildPageNavRow("equip_page", page, pageCount)` is added as an extra row alongside the existing select menu. The collector's filter gains the two new customIds; clicking Prev/Next increments/decrements `page`, then calls `render(page)` again and re-renders in place (`i.update(...)`), same as every other button branch in this file. The weapon-select dropdown and confirm/cancel flow are untouched.

- **`/weapon-refine`** (`src/commands/rpg/weapon-refine.ts`): same treatment, applied independently to both lists in the flow:
  1. The initial "choose a weapon to refine" (`refinable` array) list.
  2. The "choose a duplicate to consume" (`dupes` array) list, shown after a keeper is picked.

  Each gets its own `page` closure variable and its own `buildPageNavRow` call with a distinct customId prefix (`wr_keeper_page`, `wr_dupe_page`) so the two paginated lists (which can both be on screen across the flow's two steps) never collide.

## Non-goals

- `/weapons` (the read-only arsenal browser) already handles its own >25 case with a truncation note (fixed earlier this session) — not touched here; can get the same treatment in a later pass if requested.
- No change to the underlying selection/confirmation logic in either command — purely the browsing surface.

## Testing

- `npx tsc --noEmit` after each file.
- Manual check: a test account with 30+ weapons — confirm `/equip` and `/weapon-refine` show pages of 10, Prev disabled on page 1, Next disabled on the last page, and selecting a weapon from page 2+ still equips/refines the correct one (not page-1's weapon at the same list index).
