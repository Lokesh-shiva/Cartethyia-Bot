# Milestone 4 — Banner #1 Gacha Design (Solace + Wellspring)

**Status:** Approved, ready for planning.

## 1. What this is

Launches the first character gacha banner (Solace) and her companion weapon banner (Wellspring), both limited to a fixed **23-day window**, both fully independent of `/wish`'s existing evergreen weapon pool per the original [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md) §11.

**Explicitly in scope:** pull mechanics for both banners, a new shared currency, ownership grant, duplicate→Constellation-Token conversion, pull-reveal animations, `/wish`'s banner-picker UX change.

**Explicitly out of scope (confirmed during brainstorming):**
- Banner #2+ infrastructure — rotating banners, the "standard pool" a losing 50/50 graduates into, any 2nd character. This only matters once a 2nd character exists; designing it now would be speculative.
- Spending Constellation Tokens and wiring C1-C6's actual combat effects into the 7 fight loops. Tokens accumulate and are visible (reusing Milestone 3.5d's schema/page) but aren't spendable yet — a fast-follow project of similar size to Milestone 3.5b's stat-block rewiring, sequenced right after this one ships.

## 2. Currency: Radiant Keys

Fractonite (existing, already drops from combat — currently converts 100:1 into Fracture Keys for `/wish`) gains a **second conversion path**, into a new currency called **Radiant Keys**. Radiant Keys spend only on the two limited banners (Solace, Wellspring) — never on `/wish`'s Standard pool. The choice of which currency to convert Fractonite into happens at conversion time, a deliberate player decision, not a forced per-pull tradeoff — this is what avoids recreating the "character vs weapon on a shared pity counter" problem the original design spec explicitly rejected (§11).

## 3. `/wish` gains a banner picker

`/wish` now always opens with a banner-selection step first, before anything else:

- **Standard** — today's exact evergreen pool, pity, and Fracture-Keys spend. Byte-for-byte unchanged once selected.
- **Limited Character Banner** — currently featuring Solace. Spends Radiant Keys.
- **Limited Weapon Banner** — currently featuring Wellspring. Spends Radiant Keys.

The picker's option labels are the generic slot names ("Limited Character Banner" / "Limited Weapon Banner"), not the featured character/weapon's own name — the specific occupant is shown inside that banner's own embed/description once selected ("Featuring: Solace"), not in the top-level picker. This matters because the slot is what's structurally permanent across future banner rotations (Milestone 4's banner #2+, out of scope here) — the option value/customId should key off the slot ("character"/"weapon"), not off "solace"/"wellspring", so swapping in a future banner's occupant later doesn't require renaming option values players' muscle memory already depends on.

This is a deliberate, intentional UX change to `/wish` itself (every player now sees a banner picker on open, not just people touching the new banners) — chosen over a default-to-Standard flow specifically for discoverability of the new limited banners. All three banners reuse `/wish`'s existing pull-resolution shell (pity math, animation triggers, result embeds) parameterized by which banner is active, rather than three separate implementations.

**Pity curve:** all three banners share the exact same shape as `/wish`'s already-proven curve — 0.6% base 5★ rate, soft pity starting at 65, hard pity at 80 — but each banner tracks its own independent pity counter and guarantee flag. A player's Solace-banner pity has no relationship to their Wellspring-banner pity or their Standard `/wish` pity.

## 4. Character banner (Solace)

- **Every 5★ pull is Solace.** Banner #1 has no standard pool to lose a 50/50 into yet — this is the unavoidable math of being the first banner, not a generosity toggle (per the design spec's own framing, confirmed during brainstorming).
- **First pull:** creates her `CharacterProgress` row — this is the actual ownership grant, and it's the same row `/team`'s ownership check already looks for (`getOrCreateCharacterProgress` / the `userId_characterId` unique lookup from Milestone 3.5a), so a fresh Solace pull immediately makes her selectable via `/team ally:solace`.
- **Every pull after the first:** full cinematic reveal plays regardless (it's still a 5★-rarity pull, and should feel like one), then the result embed adds an explicit line: *"Already owned — converted to 1 Constellation Token (C2, 1/6)"* using `CharacterProgress.constellationTokens` (schema already in place from Milestone 3.5d). No silent/skipped reveals.

## 5. Weapon banner (Wellspring)

- Wellspring gets **real stats/passive data**, replacing the hardcoded stopgap currently in `src/lib/wellspring.ts` (called out explicitly in Milestone 3.5's design spec §13 as blocked on real per-character equipment existing — it now does, via Milestone 3.5a). She becomes a genuine `Weapon` row like any other.
- **She is NOT added to `WISH_WEAPONS_5STAR`** (the evergreen `/wish` Standard pool). She exists only inside her own banner's pool. This is the fix for the exact problem flagged during brainstorming: mixing her into the flat Standard pool would let a player targeting a *different* weapon accidentally receive her on a lost 50/50, cheapening her as a limited signature weapon.
- **50/50 mechanic:** win → Wellspring. Lose → a random pick from the 4 existing Standard 5★ wish weapons (Oathbreaker's Edge / Ruin Sovereign / Null Fangs / Abyssal Tome) — matching `/wish`'s own proven "consolation 5★" shape, but sourced from Standard's pool specifically so a loss never hands out something equally exclusive. Next 5★ pull on this banner is then guaranteed Wellspring.
- Once real, Wellspring becomes refinable via the already-built `/weapon-refine` system (Milestone 3.5c) once a player owns a duplicate from repeated banner pulls — no new refinement code needed, this falls out for free.

## 6. Pull-reveal animations

- **Character pull (Solace):** a cinematic reveal, using the 9:16 vertical splash-art slot already speced in the original multi-character-teams design (§10) for "the pull-reveal moment." This is a bigger, more deliberate moment than `/wish`'s existing weapon reveal.
- **Weapon pull (Wellspring, and Standard/Solace-banner weapon consolation prizes):** a lighter pulsing/moving animation, reusing `/wish`'s existing animation-asset pattern (`assets/5_star animation.gif` etc.) but visually scaled down from the character moment — correctly weighted smaller, not a copy of the cinematic treatment.

## 7. Data model additions

```prisma
model User {
  // ...existing fields...
  radiantKeys              Int     @default(0)   // spends on the Solace/Wellspring limited banners only

  solaceBannerPity         Int     @default(0)
  solaceBannerGuaranteed   Boolean @default(false)
  wellspringBannerPity     Int     @default(0)
  wellspringBannerGuaranteed Boolean @default(false)
}
```

Mirrors `/wish`'s existing `wishPity`/`wishGuaranteed` shape (a per-banner pity counter + guarantee flag directly on `User`, not a separate table) — consistent with how `/wish` already does this, and simple enough that a separate table would be over-engineering for 2 banners.

**Banner window:** a small hardcoded config (start/end timestamp) gates whether `/wish`'s Solace/Wellspring options are selectable at all — a single constant for banner #1, not a general N-banner scheduling table. `/wish` shows these two options as visibly disabled once the 23-day window closes (not hidden entirely — a disabled option with a "banner ended" note is clearer than the option silently vanishing). Any leftover `radiantKeys` balance simply carries over unspent — it isn't refunded, converted, or expired — and becomes spendable again whenever the next limited banner (Milestone 4's banner #2+, out of scope here) opens.

## 8. Testing

- Pity math parity: Solace-banner and Wellspring-banner pity/guarantee logic produce statistically identical soft/hard-pity behavior to `/wish`'s already-proven implementation (same formula, different currency/pool).
- Ownership grant: first Solace pull creates exactly one `CharacterProgress` row; a 2nd, 3rd, etc. pull never creates duplicate rows (upsert/guard against races, matching the existing `getOrCreateCharacterProgress` pattern).
- Duplicate→token math: `constellationTokens` increments by exactly 1 per duplicate pull, `constellation` rank itself is untouched (spending is the fast-follow's job, not this one's).
- Wellspring never appears from a Standard or Solace-banner pull — only from her own banner's win case.
- `/wish`'s Standard banner is byte-for-byte unchanged in pity math, currency, and pull results once selected — the banner-picker step is the only visible change to existing behavior.
- Banner-window gating: Solace/Wellspring options correctly disappear/disable after the 23-day window; Standard remains selectable always.
