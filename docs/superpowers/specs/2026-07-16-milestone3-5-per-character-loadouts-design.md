# Milestone 3.5 — Per-Character Loadouts, Team Setup, Weapon Refinement Design

**Status:** Approved, ready for planning.

## 1. What this is

Milestones 0–3 built the team-combat engine and Solace, the first banner character, then rolled her mechanics out to all 6 combat surfaces — but every surface still hardcodes a single account-wide echo/weapon build shared by whichever unit is on-field, and a single dev-guild-only "everyone gets Solace" gate with no real choice. Before Milestone 4 (the gacha banner) ships, that gap has to close: pulling a 2nd or 3rd banner character is meaningless if there's nowhere to gear them differently from character #1.

This milestone also surfaces a real deviation from the original [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) §2, which assumed the player's own personalized character is always one of the team slots. That assumption no longer holds — teams may exclude it, and (in a later milestone) a player may solo with only a banner character.

**Scope, confirmed during brainstorming:**
- Character roster ownership + per-character echo/weapon loadouts + a `/team` command to pick your 2nd combat slot — built now.
- Weapon refinement (R1-R5, merging duplicate weapon pulls) — built now, since `/wish` already produces real weapon duplicates today.
- Character constellations (C1-C6) — schema + profile page only in this milestone. No earn path exists yet (no character gacha), so wiring the actual combat effects into all 6 fight loops is deferred to Milestone 4, where it can ship already testable against a real duplicate-pull flow.
- True 3-member team rotation, and soloing with only a banner character (no personal character in the fight at all) — both deferred to a later combat-rework milestone. Today's 2-way swap (active unit + 1 bench) is unchanged; this milestone only makes *which* unit fills the bench a real, ownership-checked choice instead of a hardcoded dev-guild freebie.

## 2. Data model changes

```prisma
model Echo {
  // ...existing fields...
  characterId String @default("self")   // "self" = player's own character; future values ("solace") = that unit's own gear
}

model Weapon {
  // ...existing fields...
  characterId String @default("self")
  refinement  Int    @default(1)        // 1-5, raised by merging duplicate weapon pulls
}

model User {
  // ...existing fields...
  teamAllyCharacterId String?           // null = solo with own character (today's default). Non-null = an owned banner character filling the 2nd combat slot.
}

model CharacterProgress {
  // ...existing fields...
  constellation       Int @default(0)   // 0-6, Resonance Chain rank
  constellationTokens Int @default(0)   // banked currency from duplicate pulls — stays 0 for everyone until Milestone 4's gacha exists
}
```

**Migration:** `characterId @default("self")` means every existing `Echo`/`Weapon` row silently becomes "belongs to your own character" — behaviorally identical to today for any player who's never touched team mechanics. No data backfill script needed beyond the schema default.

**Uniqueness change:** `equippedSlot` (0 = main, 1-4 = sub) is currently unique per `userId` implicitly (one account-wide equip state). It becomes scoped per `(userId, characterId)` — slot 0 is unique per character, not per account. Same for `Weapon.isEquipped` — "equipped" now means "equipped by this specific character," so two different characters can each have their own equipped weapon simultaneously (this is exactly why weapon duplicates stay separately equippable, per your explicit callout — unlike characters, there's no "convert extra copies into a token" step for weapons; each copy is its own item, and refinement is an opt-in merge you choose to perform, not automatic).

## 2.5. Solace's own stat block (discovered during planning — real scope addition)

Solace currently has no independent stats: `SOLACE = { name, hpMax, outro }` in `src/lib/solace.ts`, and every combat formula for her Basic/Skill/Ultimate reuses the *player's own* resolved `myAtk`/`myDef`/`myCritRate`/`myCritDmg` (her kit multipliers apply on top of the player's stats, not her own). Per-character echoes have nothing to plug into under this shape — equipping different gear onto her would change nothing about her damage.

**Fix:** `SOLACE` gains a real base stat line (`baseAtk`, `baseDef`, `baseSpeed`, `critRate`, `critDmg` — a fixed level-1-equivalent starting block, not a leveling system of her own; her existing kit-level tracks (Basic/Skill/Ultimate/Intro/Forte) remain the only progression she has). Combat formulas for her Basic/Skill/Ultimate/Chime-Strike branches across all 6 surfaces get rewired to compute HER OWN resolved stats (her base + her own equipped echoes via `resolvePlayerBonuses(userId, "solace")` + her own equipped weapon) instead of borrowing the acting player's. Her HP (`allyHp`/`allyHpMax`) already works this way (an independent pool) — this brings ATK/DEF/Crit in line with that same independence.

This is the change that makes per-character loadouts mean something in combat, not just in the equip UI.

## 3. `/team` command

New command. Shows your current team (self, plus ally if set) and lets you assign your 2nd combat slot to any owned banner character, or clear it back to solo. "Owned" = a `CharacterProgress` row exists for `(userId, characterId)` — reuses the exact mechanism `getOrCreateCharacterProgress` already uses today, no new ownership table.

Your own character is always the one actually fighting turn-1 in every combat surface (unchanged from today) — `/team` only controls who (if anyone) is available to swap into.

## 4. Per-character echo/weapon commands

- **`/echo-equip`, `/equip`** (weapon) — gain a `character` option, defaulting to `self`. Equipping to a character's slot only affects that character's build.
- **`/echoes`, `/weapons`** — gain an optional `character` filter so each unit's build can be viewed independently.
- **`/echo-preset`** — presets become per-character (a preset is one unit's loadout).
- **No changes needed** to `/echo-discard`, `/echo-reroll`, `/echo-lock`, `/echo-upgrade`, `/weapon-upgrade`, `/weapon-discard` — all operate on a specific echo/weapon by ID, and `characterId` is just an attribute on that row now; nothing about picking a target row changes.
- `resolvePlayerBonuses` gains a `characterId` parameter (defaulting to `"self"` at every existing call site that doesn't yet care about a 2nd character) so it resolves the correct unit's gear.

## 5. Combat loop integration

All 6 combat surfaces (`/encounter`, `/dungeon`, `/boss`, `/ascend`, `/field-boss`, `/raid`, `/duel`) currently gate Solace's mechanics on `isDevGuild` alone. This becomes:

```typescript
const hasSolace = isDevGuild && user.teamAllyCharacterId === "solace" && solaceProgress !== null;
```

Still dev-guild-gated for staged rollout, now additionally requiring the player has actually chosen her via `/team`. This is a small, mechanical change per surface — not a rearchitecture, since Solace remains the only character with real combat-mechanic code either way. Future banner characters will need their own hardcoded mechanic wiring (same as Solace got in Milestones 2a-2e) regardless of this milestone; `/team`'s job is only to gate *which* hardcoded ally, if any, is active.

## 6. Weapon refinement

New `/weapon-refine` command: pick a "keeper" weapon, pick a duplicate of matching `weaponType` + `name` + `rarity` to consume, `refinement` +1 (capped at R5 — up to 4 total duplicates consumed across a weapon's lifetime). The consumed duplicate is deleted.

Wellspring's already-speced R1-R5 table ([multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) §7) gets wired into its passive resolution using the new `refinement` field. The existing 4 five-star wish weapons (Oathbreaker's Edge, Ruin Sovereign, Null Fangs, Abyssal Tome) need their own R1-R5 tables authored as part of this work — they don't have one today since refinement didn't exist.

**Interaction with Lv60 Ego Weapon Awakening:** independent, both apply. Refinement scales the base passive's magnitude; Awakening's own amplification (×1.25-1.3× depending on rarity, plus a 4th effect) multiplies on top of whatever refinement rank the weapon is at when awakened, and continues to apply if refinement changes afterward (a weapon can still be refined post-awakening — nothing locks refinement at the moment of awakening).

## 7. Constellations (schema + profile page only)

`/character`'s Constellations page (currently unbuilt — the file's own comment already anticipates it, design spec §9) gets built now: shows current rank (0-6), the full 6-tier effect table (verbatim from [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) §6), and current token count. At rank 0 for literally every player today (no earn path exists), the page should read honestly — e.g. "Tokens are earned from duplicate pulls once Solace's banner exists" — not imply a mechanism that doesn't work yet.

**Explicitly not built in this milestone:** wiring C1-C6's actual combat effects (Outro's bonus ATK grant, Ultimate's improved heal/cleanse, Skill's Concerto Energy burst, Intro's shield, Ultimate's extended duration, and the "50% of both inactive modes" C6 payoff) into any of the 6 combat loops. Since `constellation` can never exceed 0 for a real player until Milestone 4's gacha awards a token, wiring dead code into 6 combat loops now would ship unreachable and untestable. This wiring happens together with Milestone 4's duplicate-pull-to-token flow, so it's testable against a real acquisition path from day one.

## 8. Explicitly deferred (not touched by this milestone)

- True 3-member team rotation (swap-to-either-of-2-benched-units) — still capped at self + 1 ally.
- Soloing with only a banner character, no personal character in the fight at all — requires combat loops to run a banner character's stats as the sole/primary fighter, structurally different from every loop's current "player + optional ally" assumption.
- Constellation combat-effect wiring (§7) — bundled into Milestone 4.
- Anything about the gacha banner itself (pull mechanics, currency, pity, the guaranteed-banner-#1 rule) — unchanged, still Milestone 4.

## 9. Testing

- Migration correctness: existing `Echo`/`Weapon` rows resolve to `characterId: "self"` with no behavior change for players who've never touched `/team`.
- Per-character equip isolation: an echo/weapon equipped to Solace's slot doesn't appear as equipped/usable for the player's own character, and vice versa; equipping the same physical echo to two different characters at once is impossible (each row belongs to exactly one character at a time).
- `/team` correctly rejects setting an ally the player doesn't own (no `CharacterProgress` row), and correctly reverts every combat surface to solo-only behavior when cleared.
- Weapon refinement: merge consumes exactly the selected duplicate (not an arbitrary one), refuses a non-matching type/name/rarity, caps at R5, and correctly stacks with Awakening's own amplification (no double-counting, no lockout).
- Constellations page renders correctly at rank 0 / 0 tokens for every current player, with honest copy about the missing earn path.
- `npx tsc --noEmit` clean across all touched combat surfaces and commands; no new unit tests needed for the per-surface gate changes (same reasoning as every prior team-combat milestone — reused, already-tested primitives, integration wiring only). New unit tests ARE warranted for the weapon-refine merge logic itself (a genuinely new mechanic, not a port).
