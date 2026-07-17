# Milestone 4c — Wellspring Weapon Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build "The Tempered Vow" — Wellspring's dedicated weapon banner in `/wish`, replacing the current "coming soon" stub.

**Architecture:** Mirrors Milestone 4b's `runCharacterBanner` shape exactly (own function in `wish.ts`, own pity/currency fields already in schema from Milestone 4a) but with weapon-banner tier logic: 50/50 (win → Wellspring, lose → random from `WISH_WEAPONS_5STAR`, next 5★ guaranteed), reusing `WISH_WEAPONS_4STAR` for the 4★ tier (4★s aren't the exclusivity concern, only 5★ Wellspring is) and `MATERIAL_DROPS` for the 3★ tier — i.e. this banner's tier structure is actually closer to Standard's shape (3/4/5★) than the Character banner's (5★-or-materials only), since real weapon content exists at every tier.

See the [design spec](../specs/2026-07-16-milestone4-banner1-gacha-design.md) §5 and Milestone 4a (Wellspring's real data, merged) / 4b (banner-picker infra, merged) as prerequisites.

---

### Task 1: Schema — missing 4★ pity field

**Files:** Modify `prisma/schema.prisma`

Milestone 4a only added `wellspringBannerPity`/`wellspringBannerGuaranteed` (5★ tier only, mirroring the character banner's needs at the time). This banner also has a real 4★ tier (unlike the character banner), so it needs its own 4★ pity counter, same shape as Standard's `wish4Pity`:
```prisma
wellspringBanner4Pity Int @default(0)
```
`db:push`, `prisma generate`, `npx tsc --noEmit`, commit as `feat(gacha): add wellspringBanner4Pity field (Milestone 4c Task 1)`.

### Task 2: Weapon-banner pull mechanics

**Files:** Modify `src/commands/rpg/wish.ts`

- [ ] `doSingleWellspringPull(pity, wish4Pity, guaranteed): PullResult` — same shape as Standard's `doSinglePull`, reusing `softPityRate`/`HARD_PITY`/`HARD_PITY_4`/`BASE_5_RATE`/`BASE_4_RATE`/`rollMaterials`/`roll4Star` (all already generic, no changes needed to any of them). The 5★ resolution differs: `rollWellspring5Star(guaranteed): { weapon: WishWeapon; wonWellspring: boolean }` — win (50% if not guaranteed, 100% if guaranteed) → `WELLSPRING_WEAPON` (from Milestone 4a, imported from `wishWeapons.ts`), lose → random from `WISH_WEAPONS_5STAR` (the Standard 4, reused as this banner's consolation pool per the design spec — this is the ONLY place outside Standard where those 4 weapons can drop, which is fine, they're not exclusivity-sensitive).
- [ ] `runWeaponBanner(interaction, dbUser)`: same ×1/×10 button flow shape as `runCharacterBanner`/Standard, spends `radiantKeys`, updates `wellspringBannerPity`/`wellspringBannerPity4`/`wellspringBannerGuaranteed`, creates a real `Weapon` row via the existing `weaponCreateData()` helper (already generic — works for any `WishWeapon`, including `WELLSPRING_WEAPON`) on any 4★/5★ hit.
- [ ] Result/summary embeds mirror Standard's exactly in shape (reuse `resultEmbed`-equivalent logic, `RARITY_COLOR`/`RARITY_LABEL` already generic) but titled "⚔ The Tempered Vow" and using `getWeaponImagePath` for Wellspring's art (confirm `assets/weapons/wellspring.png` or equivalent exists before wiring `setImage` — fall back to text-only if missing, same discipline as Milestone 4b's Solace art handling).
- [ ] Wire `wish_pick_weapon`'s handler in the banner picker (currently the "coming soon" stub) to call `runWeaponBanner(interaction, dbUser)`.
- [ ] Typecheck, commit as `feat(gacha): build Wellspring weapon-banner pull mechanics (Milestone 4c Task 2)`.

### Task 3: Verification

- `npx tsc --noEmit` and `npm run build` clean.
- Confirm Wellspring can ONLY be obtained via this banner — grep the full diff to confirm `WELLSPRING_WEAPON` is never referenced from `roll5Star`/Standard's code path (only from the new `rollWellspring5Star`).
- Confirm `radiantKeys`/`wellspringBannerPity`/`wellspringBannerGuaranteed` are the only fields this banner touches — never `fractureKeys`/`wishPity`/`wishGuaranteed` (Standard's fields) and never `solaceBannerPity` (the other limited banner's fields).
- Manual playtest checklist (dev guild, banner window active via `/owner-banner start`): weapon-banner ×1/×10 pulls correctly spend Radiant Keys, correctly show Wellspring on a win, correctly show a Standard-pool 5★ on a loss with "next 5★ guaranteed", and correctly add a real, refinable `Weapon` row (`/weapon-refine` should recognize a 2nd Wellspring pull as fodder).
- Report findings back.
