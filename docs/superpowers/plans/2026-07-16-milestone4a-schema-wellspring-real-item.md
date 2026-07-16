# Milestone 4a — Schema + Wellspring Real-Item Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the schema fields Banner #1 needs (Radiant Keys, per-banner pity, Wellspring's real Weapon identity), and convert Wellspring from her current always-on hardcoded stopgap into a real, optional item whose bonus effect only applies when Solace actually has her equipped.

**Architecture:** `resolveSolaceStats()` (Milestone 3.5b) gains a sibling boolean (`hasWellspring`) computed from her resolved equipped-weapon name. Every one of the ~40 `getWellspringXBonus(...)`/`WELLSPRING_BASE_ATK_MULT` call sites across the 7 combat surfaces gets that boolean folded into its existing `isDevGuild ? X : neutral` gate — mechanical, one shape repeated everywhere, per the pattern already proven in Milestone 3.5b.

See the [design spec](../specs/2026-07-16-milestone4-banner1-gacha-design.md) §5, §7 for rationale.

---

### Task 1: Schema

Add to `prisma/schema.prisma`'s `User` model:
```prisma
radiantKeys                Int     @default(0)
solaceBannerPity           Int     @default(0)
solaceBannerGuaranteed     Boolean @default(false)
wellspringBannerPity       Int     @default(0)
wellspringBannerGuaranteed Boolean @default(false)
```
`npm run db:push`, `npx prisma generate`, `npx tsc --noEmit`, commit as `feat(gacha): add Radiant Keys + per-banner pity fields (Milestone 4a Task 1)`.

### Task 2: Wellspring's real weapon data

In `src/lib/wishWeapons.ts`: add a `WELLSPRING_WEAPON: WishWeapon` constant (stats/substats per the original [Milestone 2b Wellspring design spec](2026-07-11-milestone2b-wellspring-design.md) §7 table — Main stat ATK, Substat Energy Regen, Hidden Sub 1 (Lv20) HP%, Hidden Sub 2 (Lv50) Elemental DMG; `type: "RECTIFIER"`, `rarity: 5`). Add her to `ALL_WISH_WEAPONS` (so substat-scaling lookups via `ALL_WISH_WEAPONS.find(w => w.name === weapon.name)` work generically wherever a Weapon row references her) but explicitly **NOT** to `WISH_WEAPONS_5STAR` (that array is Standard's random-pick pool — she must never appear there, per the design spec's core requirement).

### Task 3: `resolveSolaceStats()` gains `hasWellspring`

In `src/lib/solace.ts`, change `resolveSolaceStats`'s return to `ResolvedStats & { hasWellspring: boolean }`, computed from whether her resolved equipped weapon's name is `"Wellspring"` (thread this through `resolvePlayerBonuses`'s existing weapon query — add an `equippedWeaponName: string | null` field to `PlayerBonuses` in `setBonus.ts` if not already retrievable, populated from the same `weapon` query `resolvePlayerBonuses` already runs).

### Task 4: Gate all ~40 Wellspring call sites on `hasWellspring`

Across `src/commands/rpg/{boss,dungeon,ascend,field-boss,duel,raid}.ts` and `src/lib/encounter.ts`: every `isDevGuild ? getWellspringXBonus(...) : 0` becomes `isDevGuild && allySolaceStats?.hasWellspring ? getWellspringXBonus(...) : 0`, and every `isDevGuild && activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1` becomes `isDevGuild && activeUnit === "ally" && allySolaceStats?.hasWellspring ? WELLSPRING_BASE_ATK_MULT : 1`. `WELLSPRING_BASE_ENERGY_BONUS` sites (Concerto Energy gain) get the same treatment. `raid.ts`'s `partyWideTeamBonuses` (lines ~455-460, reads `ally.attunement` for EVERY active-ally participant in the party) needs the per-participant `ally.allySolaceStats?.hasWellspring` check added there specifically, since it loops multiple participants, not a single `allySolaceStats`.

One file at a time, `npx tsc --noEmit` after each, commit per file as `feat(gacha): gate Wellspring's passive on actually-equipped in /<surface> (Milestone 4a Task 4)`.

### Task 5: Verification

`npx tsc --noEmit` clean across everything. `grep -c "hasWellspring"` sanity count across all 7 files (expect every prior `getWellspringXBonus`/`WELLSPRING_BASE_ATK_MULT`/`WELLSPRING_BASE_ENERGY_BONUS` site to now have a paired `hasWellspring` check). Manual playtest note (for later, not blocking): a Solace with Wellspring NOT equipped should get zero mode-amplification bonus; equipping Wellspring restores today's exact behavior.
