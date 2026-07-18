# Solace Character Card Design

**Status:** Approved, ready for planning.

## 1. What this is

Builds the full 6-page canvas-rendered character profile for `/character`, per the original [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) §9 — the last piece of Milestone 5 (art integration) blocking on Solace's portrait, which is now in hand (`assets/Characters/Solace.png`, delivered 2026-07-17).

**In scope:** all 6 pages (Stats, Weapon, Echoes, Kit Levels, Constellations, Lore), converting Kit Levels and Constellations from their current plain-text embeds (Milestones 2d/3.5d) to match the other 4 new canvas-rendered pages, so `/character` looks consistent end to end rather than half text/half canvas. Also adds a real leveling/ascension progression system for Solace (§7) — she currently has no progression beyond kit-track spend, which undercuts the "leveling up a character" feel this card is meant to showcase.

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
- **`renderLoreCard()`** — her portrait (`assets/Characters/Solace.png`) alongside a styled text panel showing **her lore fragments** (§7.1). Not a static block of text — the panel renders one fragment per unlocked ascension phase (`CharacterProgress.ascensionPhase`, §7), with not-yet-unlocked fragments shown as redacted/silhouetted placeholder lines rather than omitted, so the page visibly communicates "more story unlocks as she grows."

## 5. Data sources

Everything is already-built, real data — this is a rendering layer only, no new data model:

| Page | Source |
|---|---|
| Stats | `resolveSolaceStats(userId)` — Milestone 3.5b, now level/ascension-aware (§7 of this doc) |
| Weapon | Equipped `Weapon` row where `characterId: "solace"` — Milestone 3.5a |
| Echoes | Equipped `Echo` rows where `characterId: "solace"` — Milestone 3.5a |
| Kit Levels | `CharacterProgress` track fields — Milestone 2d |
| Constellations | `CharacterProgress.constellation`/`constellationTokens` — Milestone 3.5d |
| Lore | 7 fixed fragments (§7.1), gated by `CharacterProgress.ascensionPhase` (§7) |

## 7. Solace Leveling & Ascension

Solace currently has no progression of her own beyond kit-track spend (Milestone 2e) — a freshly-pulled and a maxed-investment Solace use the exact same fixed base stat line (`SOLACE.baseAtk`/`baseDef`/`baseSpeed`/`hpMax` in `solace.ts`, a frozen level-25-equivalent snapshot). Added here since it's a Stats-page data-source change and there's no 2nd character yet to justify a separate milestone file.

**Data model** — `CharacterProgress` (per-character-progress table, already keyed by `userId`+`characterId`) gains:
```prisma
level          Int @default(1)
ascensionPhase Int @default(0)  // 0-6
```

**Level cap per phase** — mirrors the WL boss level-cap table already in CLAUDE.md: Phase 0→20, 1→40, 2→50, 3→60, 4→70, 5→80, 6→90.

**Stat curve** — `resolveSolaceStats()`'s base stat block becomes a function of `level` instead of the fixed constant: linear interpolation from a Lv1 floor up to today's fixed numbers as the Lv90 ceiling. **Support-class growth bias is an explicit constraint, not an incidental curve shape**: HP and DEF scale at full rate toward the Lv90 ceiling; ATK scales at a reduced rate; Crit Rate/Crit DMG barely move with level at all. A maxed-level Solace must still read as a support unit (low damage/crit, high survivability/utility) — the leveling system is not allowed to drift her toward DPS-shaped numbers. `SOLACE.baseAtk`/`baseDef`/`baseSpeed`/`hpMax` become the Lv90 values; Lv1 floor values are a fraction of each (exact fractions decided at implementation time, weighted per the bias above).

**Leveling (spend, no cap change)** — spend **Resonance Records + Credits** to raise `level` by 1 at a time, up to the current phase's cap. Same currency already used for player EXP — no new currency introduced for this part.

**Ascension (raises the cap)** — costs scale per phase:
- Phase 1 (→Lv20): Forging Ores + Paradox Cores + Credits.
- Phases 2-6 (→Lv40/50/60/70/80/90): same **+ Starfall Shards** (new material — starts being required at the Lv40 ascension, i.e. Phase 2 onward).
- Stasis Locks are never part of this cost — they're earmarked for `/evolve` (ability evolution) only.

**Starfall Shard source** — dropped by the existing **Spectro-element `/field-boss` fight only** (not any of the 6 — specifically the Spectro one), at a modest rate. No new boss content; this is a drop-table addition to a fight that already exists, chosen to tie her ascension thematically to her own element without new combat scope.

**UI** — `/character`'s Stats page (§4 above) gets a single action button: reads **"Level Up"** while `level` is under the current phase's cap, switches to **"Ascend"** once the cap is hit. "Ascend" is disabled until the player has sufficient materials + Credits for the next phase; clicking it raises `ascensionPhase` and unlocks the next level range.

**New pulls** start at `level: 1, ascensionPhase: 0` — no migration path needed, Solace has not launched yet.

### 7.1 Lore fragments (approved 2026-07-18)

7 fixed fragments, one revealed per ascension phase reached — Fragment 1 is always visible (even at Phase 0/Lv1), Fragments 2-7 unlock at Phases 1-6 respectively. The Lore page (§4) renders every fragment slot; locked ones show as a redacted/silhouetted placeholder line instead of being omitted, so the page communicates "more story unlocks as she grows" even before it's readable.

1. **Always unlocked** — "They say every star eventually falls. Most burn out in the descent, forgotten before they touch the ground."
2. **Phase 1 (Lv20)** — "Solace remembers her fall — the sky tearing open, the long silence of the drop, and then warmth, unfamiliar and entire, as she opened eyes she didn't know she had onto a world that was not her own."
3. **Phase 2 (Lv40)** — "She could have stayed dim. Fallen stars usually do — spent, purposeless, waiting to go dark for good. But something in her refused the silence."
4. **Phase 3 (Lv50)** — "She chose to keep shining, because somewhere below her light there was always someone who needed it more than the sky ever had."
5. **Phase 4 (Lv60)** — "So she stays close to the ground now, deliberately. She kneels beside the wounded instead of watching from above."
6. **Phase 5 (Lv70)** — "She lends her glow to whoever's fighting beside her — not because the sky asks it of her anymore, but because she decided, once and for all, what a star that falls should do with the light it has left."
7. **Phase 6 (Lv90)** — "Give it away, freely, to anyone still standing in the dark. She doesn't call herself a light in the heavens anymore. She calls herself one on the ground — smaller, maybe, but close enough to actually reach the people who need her."

## 8. Testing

- Visual spot-check per page — render each template to a file and inspect it directly (same verification approach already used for the pull-reveal art this session), not just a typecheck pass.
- A populated-state test: Solace owned, some echoes equipped, a weapon equipped, partial kit-track levels, C0 constellation — confirms every template reads real data correctly.
- An edge-case test: freshly-unlocked Solace — no echoes, no weapon, all kit tracks at Lv1, C0/0 tokens — confirms every template's "empty" states render sensibly rather than breaking (blank stat bars, empty weapon slot, all-locked constellation grid) instead of crashing or showing `undefined`.
- Confirm the existing `/character` select-menu correctly swaps between all 6 pages without regressing the already-live Kit Levels/Constellations spend-forgingOres/spend-token interactions (those stay functionally identical — this project only changes how they're *rendered*, not their underlying logic).
- Leveling/ascension: confirm a Lv1 Solace reads as meaningfully weaker than Lv90 but never crosses into DPS-shaped stats at any level (spot-check ATK/Crit vs HP/DEF ratio at Lv1/45/90). Confirm "Level Up" correctly blocks at the phase cap and only "Ascend" is clickable there. Confirm Starfall Shards only drop from the Spectro field boss (not the other 5), and that Stasis Locks are never deducted by this feature. Confirm a fresh Solace pull lands at Lv1/Phase 0.
