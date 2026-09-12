# Alpha Raid — Design Spec

## Goal

A rare, owner-triggered global event: one command fires an announcement + hard boss fight in every server the bot is in simultaneously, rewarding participants with wish currency (Fracture Keys/Radiant Keys) that normal `/raid` never grants. Drives cross-server "the whole community rallies together" engagement around a genuinely valuable, scarce reward — explicitly designed to not be farmable, per the original player feedback (AlphaBeast) this is built from: see `docs/superpowers/specs/2026-09-07-alpha-player-feedback.md` item #1.

## Background

Existing `/raid` (`src/commands/rpg/raid.ts`) is fully in-memory (`activeRaids: Map<channelId, ActiveRaid>`), per-server, and admin-startable at any time with no cooldown — reasonable for a fight that resolves in minutes, wiped safely on every bot restart. Alpha Raid needs to survive a 72-hour window across restarts (this VM gets redeployed multiple times a day), so its pre-fight state (recruiting, deadline tracking) needs the same DB-backed, sweep-driven pattern `/tournament` already uses (`tournamentSweep.ts`) — not `/raid`'s in-memory approach.

## Approach

**Trigger — owner-only, global.** A new command, `/owner-alpharaid start`, gated to `isOwner()` only (not `isGuildManager()` — this is explicitly bot-owner-exclusive per Alpha's own ask, narrowed from "administrators" to "only the owner"). On run, it loops every guild in `client.guilds.cache` and, for each one, creates an `AlphaRaidInstance` DB row and posts a recruiting announcement with a Join button — same visual/embed style as `/raid`'s own recruiting phase, reusing `buildRecruitEmbed`-style formatting.

**Target channel per server.** No new `/setup` option — reuses whatever channel a server would naturally see `/raid` announcements in. Since `/raid` itself has no stored "raid channel" setting today (it's just wherever an admin types the command), Alpha Raid resolves a channel per guild in this order: first of `GuildSettings.botChannelIds` if set, else the guild's own `systemChannel`, else the first text channel the bot can `SendMessages` in. If no channel resolves at all for a guild, that guild is skipped (logged, not fatal to the other guilds).

**Data model — new Prisma models:**
```prisma
model AlphaRaidEvent {
  id          String   @id @default(cuid())
  triggeredBy String   // owner's userId
  triggeredAt DateTime @default(now())
  instances   AlphaRaidInstance[]
}

model AlphaRaidInstance {
  id           String   @id @default(cuid())
  eventId      String
  event        AlphaRaidEvent @relation(fields: [eventId], references: [id])
  guildId      String
  channelId    String
  messageId    String?  // the recruiting message, for live participant-count edits
  phase        String   // "RECRUITING" | "FIGHTING" | "COMPLETE" | "EXPIRED"
  deadlineAt   DateTime // triggeredAt + 72h — kill window, not signup window
  participants AlphaRaidParticipant[]

  @@index([phase, deadlineAt])
}

model AlphaRaidParticipant {
  id          String   @id @default(cuid())
  instanceId  String
  instance    AlphaRaidInstance @relation(fields: [instanceId], references: [id])
  userId      String

  @@unique([instanceId, userId])
}
```
`AlphaRaidInstance.phase` transitions: `RECRUITING` (Join button live, no fight started yet) → `FIGHTING` (an admin/organizer clicked Begin, hands off to the in-memory `/raid`-style combat loop) → `COMPLETE` (boss defeated, rewards paid) or `EXPIRED` (72h deadline passed while still `RECRUITING` or `FIGHTING`, no reward).

**Per-server flow.** Once posted, this is functionally `/raid`'s existing Join → Begin → turn-based fight flow, reused as-is for the actual combat (in-memory `ActiveRaid` state during `FIGHTING`, same collectors/buttons/turn logic) — the only new pieces are: (1) the DB-backed `RECRUITING` phase that survives restarts, (2) boss stats computed via `computeRaidBossStats()` with every axis (HP/ATK/DEF/vibBar) scaled ×1.5 on top of the existing party-derived formula, (3) `Begin` is gated the same way `/raid`'s own Begin already is (`canManageRaids` — that server's own admins, not the bot owner globally, since the owner can't realistically babysit every server's start timing) and transitions `AlphaRaidInstance.phase` to `FIGHTING`, handing control to the normal raid engine, (4) on the normal raid-win path, on top of the existing `perPlayer` loot, every participant also receives a flat **5 Fracture Keys + 2 Radiant Keys**, and `AlphaRaidInstance.phase` → `COMPLETE`.

**Sweep — new `alphaRaidSweep.ts`, same shape as `tournamentSweep.ts`.** Runs on the same 5-minute interval cadence. For every `AlphaRaidInstance` still `RECRUITING` or `FIGHTING` past its `deadlineAt`, mark `EXPIRED`, release any combat locks, post a "time's up" message in that server's channel, and clean up in-memory raid state for that channel if `FIGHTING`.

**Weekly cadence.** Not hard-enforced in code this round — Alpha explicitly wants this exclusively owner-gated and infrequent by nature of being a manual trigger; a hard-coded cooldown would need to reject the owner's own command, which adds complexity for a constraint the owner can already just... not violate by not running it. If abuse becomes a real problem later, a `lastTriggeredAt` check can be added as a fast-follow.

## What does NOT change

- Normal `/raid` — untouched, same in-memory engine, same admin-per-server gating, same no-wish-currency reward.
- The actual turn-by-turn combat UI/logic once `FIGHTING` starts — Alpha Raid reuses it, doesn't reimplement it.
- Wish pity/banner systems — Fracture Keys/Radiant Keys just enter the economy through a new source, same currencies, same spend paths.

## Testing

No automated test framework in this codebase — verified via `npx tsc --noEmit`, `npm run build`, and live manual testing: trigger `/owner-alpharaid start` against a small set of test servers (or the dev guild + one alt server), confirm the recruiting announcement posts correctly in each, confirm Join/Begin/fight/reward all work per-server independently, confirm an instance left unstarted expires correctly after its deadline (can be tested with a shortened deadline via a debug override, mirroring how `/tournament`'s `signup_minutes` exists for fast testing), confirm a bot restart mid-`RECRUITING` doesn't lose the instance.
