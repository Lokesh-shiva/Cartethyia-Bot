# Milestone 4b — /wish Banner Picker + Solace Character Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a banner-picker step to `/wish` (Standard / Limited Character Banner "The Rising Overture" / Limited Weapon Banner "The Tempered Vow"), and build the Solace character-banner pull flow end to end.

**Architecture:** Standard's existing code in `src/commands/rpg/wish.ts` is **not refactored** — it's real, live, production code serving real currency right now, and the design spec requires it stay byte-for-byte unchanged. A new banner-picker embed/button row is inserted before Standard's logic runs; picking "Standard" falls straight into the existing code path untouched. The two new banners are **separate, additive functions** in the same file, mirroring Standard's shape (pity math, suspense animation, result embed) but with their own tier logic — some duplication versus a shared generic engine, chosen deliberately to keep zero risk of regressing Standard's already-proven, currently-live pull logic. `runSuspense()` (animation) is reused as-is (already generic, takes a tier number).

See the [design spec](../specs/2026-07-16-milestone4-banner1-gacha-design.md) for full rationale. Milestone 4a (schema, Wellspring's real data) is merged and is a prerequisite.

---

### Task 1: Banner picker

**Files:** Modify `src/commands/rpg/wish.ts`

- [ ] Wrap today's entire `execute()` body into a new function `runStandardBanner(interaction, dbUser)` — pure rename/extraction, zero logic changes. Verify with a diff that only function boundaries moved.
- [ ] `execute()` becomes: fetch `dbUser` (add `radiantKeys`, `solaceBannerPity`, `solaceBannerGuaranteed` to the select — `wellspringBannerPity`/`wellspringBannerGuaranteed` too, for Task-2-in-Plan-4c's sake, harmless to fetch now), show a banner-picker embed with 3 buttons (`wish_pick_standard`, `wish_pick_character`, `wish_pick_weapon`), await the pick via a short-lived collector, then dispatch to `runStandardBanner`/`runCharacterBanner` (this plan)/`runWeaponBanner` (Plan 4c — stub it as "not yet available" for now, don't block this plan on it existing).
- [ ] Banner-picker embed: title "◈ Choose a Banner", 3 buttons labeled "Standard", "Limited Character Banner ✦ The Rising Overture", "Limited Weapon Banner ✦ The Tempered Vow" (per the design spec's slot-generic-label + flavor-title split — the LABEL is generic, the flavor title rides along in the same button label string since Discord buttons don't support subtitles).
- [ ] Typecheck, commit as `feat(gacha): add /wish banner picker, extract Standard into runStandardBanner (Milestone 4b Task 1)`.

### Task 2: Solace character-banner pull mechanics

**Files:** Modify `src/commands/rpg/wish.ts`, `src/lib/characterProgress.ts` (if a helper is needed)

- [ ] `doSingleSolacePull(pity, guaranteed): { gotSolace: boolean; newPity: number; newGuaranteed: boolean; isDuplicate: boolean }` — same soft/hard pity curve as `softPityRate`/`HARD_PITY` (reused constants), but no 4★/3★ tier: a non-5★ roll returns a consolation-materials result (reuse `MATERIAL_DROPS`/`rollMaterials()`), a 5★ roll is **always** Solace (banner #1, no other character to lose the 50/50 into — no "guaranteed" branching needed at all here, unlike Standard, since there's no coin flip to win or lose). `isDuplicate` is computed by checking whether the player already has a `CharacterProgress` row for `"solace"` (query once per pull, or once per ×10 batch and track in-memory across the loop since ownership can only flip from "not owned" to "owned" mid-batch, never back).
- [ ] Ownership grant: on the player's first-ever Solace pull, `getOrCreateCharacterProgress(userId, "solace")` (already exists, Milestone 2d) creates her row — this already IS the grant, no new code needed beyond calling it.
- [ ] Duplicate handling: if already owned, `CharacterProgress.constellationTokens` increments by 1 (`prisma.characterProgress.update({ where: { userId_characterId: {...} }, data: { constellationTokens: { increment: 1 } } })`), `constellation` itself is untouched (spending is Plan 4d's job).
- [ ] Result embed: full character reveal using her splash art at `assets/characters/solace.png` (reuse `/wish`'s `AttachmentBuilder` + `setImage("attachment://...")` pattern; verify the file actually exists at that path before wiring it in — if it's missing, fall back to a text-only embed and flag this explicitly rather than crash) with a "✨ Already owned — converted to 1 Constellation Token (C{n}, {tokens}/6)" line appended when `isDuplicate` is true.
- [ ] `runCharacterBanner(interaction, dbUser)`: mirrors Standard's ×1/×10 button flow structurally (pull buttons check `radiantKeys` balance instead of `fractureKeys`, decrement `radiantKeys` and update `solaceBannerPity`/`solaceBannerGuaranteed` in the same transaction pattern as Standard's `prisma.$transaction([...])`), calls `runSuspense(interaction, tier)` (tier is always 5 or a materials-only "no tier" — reuse tier 3's suspense frames for the consolation case, since there's no meaningful "4★ moment" to animate here), shows the result embed.
- [ ] Typecheck, commit as `feat(gacha): build Solace character-banner pull mechanics (Milestone 4b Task 2)`.

### Task 3: Banner-window gating via a new owner command

**Files:** Create `src/commands/utility/owner-banner.ts`, modify `prisma/schema.prisma`, modify `src/commands/rpg/wish.ts`

- [ ] Schema: a new model
  ```prisma
  model BannerWindow {
    id       String   @id // "banner1" (both Solace + Wellspring share one window — companion banners)
    startsAt DateTime
    endsAt   DateTime
  }
  ```
  `db:push`, `prisma generate`.
- [ ] `src/commands/utility/owner-banner.ts` — owner-only (reuse `isOwner` from `../../lib/owner`, same pattern as `owner-mail.ts`). Subcommand `start` with a `days` integer option (default 23): upserts the `BannerWindow` row with `startsAt: now, endsAt: now + days`. Subcommand `status`: shows the current window's start/end and whether it's currently active. Subcommand `end`: sets `endsAt` to now (immediate close, for correcting a mistake).
- [ ] `src/commands/rpg/wish.ts`'s banner picker: fetch the `BannerWindow` row (id `"banner1"`) once per `/wish` invocation; the "Limited Character Banner"/"Limited Weapon Banner" buttons are `.setDisabled(true)` with a "Banner ended" (or "Not yet started") note in their label whenever `now` is outside `[startsAt, endsAt]` or the row doesn't exist at all (no banner ever started) — Standard's button is never affected by this check.
- [ ] Typecheck, deploy (`npm run deploy` — new command), commit as `feat(gacha): add /owner-banner start/status/end + gate limited banners to the active window (Milestone 4b Task 3)`.

### Task 4: Verification

- `npx tsc --noEmit` and `npm run build` clean.
- Diff `runStandardBanner`'s body against the pre-Task-1 `execute()` body — must be identical apart from the function-boundary extraction (no accidental logic drift).
- Manual playtest checklist (dev guild): Standard pulls behave exactly as before this milestone (same currency, same pity, same results) — this is the single most important regression check, since Standard is live and real. Character-banner ×1/×10 pulls correctly grant ownership on first pull, convert to tokens on repeats, decrement Radiant Keys (never Fracture Keys), and track their own independent pity. Banner buttons correctly disable outside the window.
- Report findings back.
