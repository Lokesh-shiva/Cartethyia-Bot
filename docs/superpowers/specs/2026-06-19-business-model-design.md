# Cartethyia Business Model — Sequenced Growth Design

**Date:** 2026-06-19  
**Author:** Lokesh  
**Status:** Design Locked  
**Goal:** Break-even sustainability through sequenced growth → retention → monetization

---

## Executive Summary

Cartethyia is a Discord RPG bot currently in 1–5 servers with $0 infrastructure cost (Oracle free tier + Neon free tier). The three immediate problems are:
1. No monetization pathway
2. Stalled user growth (not discoverable)
3. No retention mechanics forcing daily engagement

The solution is a **sequenced approach**: grow the playerbase first, retain them through existing daily mechanics, then monetize through cosmetic-only perks once the community is invested. This avoids the trap of monetizing before reaching product-market fit.

**Success criteria:**
- Growth: 50+ servers within 6 months
- Retention: Stable weekly active players
- Monetization: 5–10 Patreon supporters covering base infrastructure costs

---

## Phase 1: Growth (Now)

**Goal:** Get from 1–5 servers to 50+ servers where vote ranking algorithms compound and organic discovery begins.

### In-Game Referral System

**What:** A `/invite` command that generates a shareable referral link. When someone joins a server with that link and completes `/start`, both players are rewarded.

**Mechanics:**
- Inviter reward: 500 credits + 1 Sealing Tube (one-time per new referred player)
- Invited player reward: 200 credits bonus on first `/start` (stacks with any other new-player bonuses)
- Tracking: Store referrer ID in the user's DB row; grant rewards on first `/start` completion

**Why:** Every engaged player becomes a growth channel. Low friction (one command), tangible reward, and scales with community size.

**Implementation notes:**
- Use unique referral codes (hash of inviter ID + timestamp) or Discord invite links with tracking params
- Prevent abuse: one reward per unique inviter per target server (same inviter can't farm rewards by inviting same person multiple times)

### Bot List Presence

**Status:** Already listed on major platforms (top.gg, DBL, discord.bots.gg). No action needed currently.

---

## Phase 2: Retention (Already Built)

**Goal:** Keep players opening the bot daily and progressing through content.

### Existing Mechanics

- **Daily rewards** (`/daily` command with streak multiplier) — creates habit loop
- **Leaderboards** (`/leaderboard` command) — competitive engagement
- **Progression milestones:** Element unlock (Lv20), Ability Evolution (Lv50), Weapon Awakening (Lv60), World Levels 0–8, Ascension fracture keys — provide constant forward momentum
- **Echo collection + upgrades** — ongoing equipment grind with visual satisfaction

### No Additional Work Required

Retention infrastructure is solid. The progression curve has enough punctuation points that players have reasons to return. No mid-progression dead zones.

---

## Phase 3: Monetization (Patreon)

**Goal:** Cover infrastructure costs if/when Oracle free tier and Neon free tier end. Target: $15–50/month from a small supporter base.

### Patreon Tier Structure

**One tier at $3–5/month:**

**Perks (cosmetic-only):**
- Supporter badge on `/profile` card (visible identifier)
- Gold accent color on profile card (visual distinction, no stat impact)
- Unique title under player name (e.g. "Resonant Patron")

**Why cosmetics-only:** RPG bots live and die by fairness perception. Any gameplay advantage (stat boost, currency gain, exclusive drops) creates pay-to-win accusations and kills the community. Cosmetics are purely visual — supporters feel rewarded without breaking game balance.

### Launch Timing

**Launch immediately** (even at 7 servers). At current scale:
- Unlikely to get supporters yet, but the page is live and discoverable
- Sets expectation early: "This bot has a cost; there's a way to help"
- As the playerbase grows to 50–100 servers, Patreon becomes a natural home for invested community members

### Link Integration

**`/support` command** → Patreon page link (single, simple call-to-action)

---

## Phase Sequencing and Dependencies

```
Phase 1 (Growth)          Phase 2 (Retention)     Phase 3 (Monetization)
├─ /invite referral       ├─ /daily ✓ built       ├─ Patreon page ✓ live
└─ Bot list presence ✓    ├─ /leaderboard ✓       ├─ /support command
                          ├─ WL progression ✓
                          ├─ Evolution/Awaken ✓
                          └─ Echo grind ✓
```

**Why sequence matters:**
1. **Growth first:** You can't retain players you don't have. Retention mechanics only matter with an engaged base.
2. **Retention second:** Retention locks in players emotionally. Once they've evolved an ability or awakened a weapon, they're invested.
3. **Monetization third:** A Patreon with 0 supporters looks weak. But a Patreon that grows with the community feels natural.

---

## Success Metrics

| Metric | Target | Timeline |
|---|---|---|
| Server count | 50+ | 6 months |
| Monthly active users | Stable week-to-week | Ongoing |
| Patreon supporters | 5–10 | 12 months (after reaching 50+ servers) |
| Revenue | $15–50/month | Same as supporters target |

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Referral abuse (farming rewards) | Unique code per inviter per server; one reward per referral pair |
| Patreon fatigue at low scale | Don't push it in-game; just have `/support` available for people who ask |
| Feature creep during growth | Stick to `/invite` + existing retention. Don't add new game modes/systems yet. |
| Infrastructure costs spike | Monitor Neon/Oracle usage; set up cost alerts. Patreon buffer exists for this scenario. |

---

## Out of Scope (Defer)

- Named Echo Sets (unique lore names) — nice-to-have, doesn't affect growth/retention
- Echo lock flag — small QoL, defer until post-50-servers
- Seasonal events / limited-time echoes — add once playerbase is large enough to sustain hype
- Additional bot lists or marketing campaigns — wait until referral system proves effectiveness

---

## Next Steps

1. **Implement `/invite` referral system** (Phase 1 execution)
2. **Monitor Patreon page** for early supporters (Phase 3 live, waiting for traction)
3. **Measure growth** — track server count weekly, celebrate milestones
4. **At 50+ servers:** Re-evaluate retention metrics; consider limited-time content if engagement is plateauing

---

## Notes

- Patreon is already live as of this design (tax forms completed, page configured)
- `/invite` is the only new code work required for growth
- No additional retention work needed — existing systems are sufficient
- Cost exposure: $0 currently; ~$20–30/month if free tiers end (Patreon target covers this)
