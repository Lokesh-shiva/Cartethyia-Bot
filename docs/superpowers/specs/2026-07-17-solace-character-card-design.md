# Solace Character Card Design

**Status:** Approved, ready for planning.

## 1. What this is

Builds the full 6-page canvas-rendered character profile for `/character`, per the original [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) §9 — the last piece of Milestone 5 (art integration) blocking on Solace's portrait, which is now in hand (`assets/Characters/Solace.png`, delivered 2026-07-17).

**In scope:** all 6 pages (Stats, Weapon, Echoes, Kit Levels, Constellations, Lore), converting Kit Levels and Constellations from their current plain-text embeds (Milestones 2d/3.5d) to match the other 4 new canvas-rendered pages, so `/character` looks consistent end to end rather than half text/half canvas.

**Out of scope:** anything beyond Solace herself — this card system is built generically (element-driven, character-agnostic data reads) so a future 2nd character slots in for free, but no 2nd character exists yet to test that claim against.

## 2. Architecture

`/character`'s existing select-menu pattern (`character.ts`, already switching between Kit Levels/Constellations) extends to all 6 pages. Each page renders as a 16:9 landscape canvas image via a new `src/lib/characterCard.ts`, following the exact file-organization convention already established by `weaponCard.ts`/`gridCard.ts` (`@napi-rs/canvas`, one render function per card type, PNG buffer returned to the command for `AttachmentBuilder`).

## 3. Element-driven theming

One shared function, `getElementTheme(element: string): { accent: string; accentDark: string; bgGradient: [string, string] }`, reused by every page template. Derives entirely from the character's `element` field — reusing the same color mapping already established by `ELEMENT_HEX` elsewhere in the codebase (Fusion orange, Glacio blue, Electro purple, Aero teal, Havoc pink/magenta, Spectro gold). Solace is Spectro, so she gets the gold accent automatically; this was explicitly chosen over a bespoke hand-tuned palette so a future character never requires new design work — confirmed during brainstorming (2026-07-17).

## 4. Four shared templates, six pages

Per the original design spec §9's own grouping — building 4 template functions, not 6 bespoke layouts:

- **`renderStatBarsCard()`** — used by both **Stats** (her resolved combat stats: HP/ATK/DEF/SPD/Crit Rate/Crit DMG/Elem DMG Bonus, from `resolveSolaceStats()`, Milestone 3.5b) and **Kit Levels** (her 5 track levels — Basic/Skill/Ultimate/Intro/Forte — same bar visual, replacing the current text embed from `character.ts`'s `buildKitLevelsView`).
- **`renderSlotGridCard()`** — used by both **Echoes** (her actual equipped echo grid, 5 slots, reading the per-character echo data from Milestone 3.5a — `characterId: "solace"`) and **Constellations** (the 6-tier Resonance Chain as slots — unlocked tiers filled/lit, locked tiers grayed — replacing the current text embed from `buildConstellationsView`).
- **Weapon page** — reuses the existing `generateWeaponCard()` (`weaponCard.ts`) essentially unchanged, showing whatever weapon is currently equipped to her `characterId: "solace"` slot (Milestone 3.5a), or a clearly-labeled empty-slot state if nothing's equipped yet.
- **`renderLoreCard()`** — simplest template: her portrait (`assets/Characters/Solace.png`) alongside a styled text panel. Lore text is Claude-drafted (gentle/supportive tone matching her kit identity), delivered for the user's review/edit before this ships — not pulled from an existing source, since none exists yet.

## 5. Data sources

Everything is already-built, real data — this is a rendering layer only, no new data model:

| Page | Source |
|---|---|
| Stats | `resolveSolaceStats(userId)` — Milestone 3.5b |
| Weapon | Equipped `Weapon` row where `characterId: "solace"` — Milestone 3.5a |
| Echoes | Equipped `Echo` rows where `characterId: "solace"` — Milestone 3.5a |
| Kit Levels | `CharacterProgress` track fields — Milestone 2d |
| Constellations | `CharacterProgress.constellation`/`constellationTokens` — Milestone 3.5d |
| Lore | Static drafted text (this project) |

## 6. Testing

- Visual spot-check per page — render each template to a file and inspect it directly (same verification approach already used for the pull-reveal art this session), not just a typecheck pass.
- A populated-state test: Solace owned, some echoes equipped, a weapon equipped, partial kit-track levels, C0 constellation — confirms every template reads real data correctly.
- An edge-case test: freshly-unlocked Solace — no echoes, no weapon, all kit tracks at Lv1, C0/0 tokens — confirms every template's "empty" states render sensibly rather than breaking (blank stat bars, empty weapon slot, all-locked constellation grid) instead of crashing or showing `undefined`.
- Confirm the existing `/character` select-menu correctly swaps between all 6 pages without regressing the already-live Kit Levels/Constellations spend-forgingOres/spend-token interactions (those stay functionally identical — this project only changes how they're *rendered*, not their underlying logic).
