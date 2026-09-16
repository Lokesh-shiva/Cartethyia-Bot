# Next Session — Handoff Notes

_Last updated: 2026-09-16_

## What just shipped

- **3 new playable characters**: Rhoven (5★, Aero), Bren (4★, Fusion), Feyra (4★, Glacio) — fully built (kits, constellations, ascension, art), wired into all 6 combat loops, and fixed up in the previously-missed hand-maintained lookup tables (`ASCENSION_SHARD_CURRENCY`, `CHARACTER_ELEMENTS`, `RECOMMENDED_SET`, `SHARD_FIELD_BOSS` in `src/commands/rpg/character.ts` / `src/lib/characterElements.ts`).
- **Alpha Raid** (owner-triggered global event) — both phases shipped:
  - Phase 1: `/owner-alpharaid start`, per-guild recruiting via durable Join button, 72h expiry sweep, channel resolution restricted to echo/encounter spawn channels, `test-guild-id` option for safe testing.
  - Phase 2: the boss is the owner-chosen character's own kit (real Basic/Skill/Ultimate names), boss-scaled ×1.5, with evasion/enrage mechanics and a durable Begin button that hands off into `/raid`'s real fight engine. Configurable flat reward (default 10 Fracture Keys + 10 Radiant Keys + 1500 Fractonite) on top of normal raid loot.
  - Design docs: `docs/superpowers/specs/2026-09-12-alpha-raid-design.md`, `docs/superpowers/specs/2026-09-15-alpha-raid-phase2-design.md`. Plans: `docs/superpowers/plans/2026-09-12-alpha-raid-implementation.md`, `docs/superpowers/plans/2026-09-15-alpha-raid-phase2-implementation.md`.
- **Global slash command deploy** done (2026-09-16) — new/changed commands live everywhere within ~1h of that deploy.
- **Banner command to debut the 3 new characters** (not yet run as of this note):
  ```
  /owner-banner start character:rhoven four_star_a:bren four_star_b:feyra days:23 include_weapon:true
  ```
- Announcement draft for the new characters + Alpha Raid was handed to the user as a file — check whether it's been posted yet.

## Known gaps / deliberately deferred

- **`VULNERABLE` debuff is applied but inert.** Alpha Raid's Skill-tier boss moves apply a `VULNERABLE` debuff to players via `debuffs.ts`, but nothing in `raid.ts`'s player-damage-taken calculation actually reads it yet (only `WEAKENED`, via `getWeakenedMult`, is wired in). Low-risk, contained fix: read `getVulnerableMult(current.playerDebuffs)` the same way `getWeakenedMult` already is, in the player-damage-taken path.
- **Alpha Raid boss AI doesn't simulate each character's real bespoke kit mechanics** (Tempo stacks, Forte gauges, etc.) — deliberately scoped out of Phase 2 as "own-flavor debuff, not a full simulation." Flagged in the Phase 2 spec as a possible future pass if the current version feels too shallow after live testing.
- **Difficulty note from live testing**: 2 players could not beat a ×1.5-scaled Alpha Raid boss in the dev-server test. This is expected — raids are tuned for fuller squads (up to 6) — but worth watching once it's live with real playercounts. No action taken yet; revisit if legitimate 4-6 player attempts also struggle.
- **Prefix (`c!`) commands**: Discord is trending toward slash-only bots industry-wide (not a CARTETHYIA-specific deadline). No action needed now — every prefix command already has a slash equivalent, so nothing breaks if `MessageContent` intent ever gets restricted further. Worth a `/help` nudge toward slash commands at some point, not urgent.

## Open decisions for next session

Pick one to start with, or bring a different priority:

1. **Wire `getVulnerableMult` into `raid.ts`'s damage-taken calc** — small, contained fix for the inert debuff above.
2. **Next Standard character** — clean, well-understood build pattern at this point (see Rhoven/Bren/Feyra as the template).
3. **Named Echo Set expansion** — was on the table as an option before Alpha Raid got picked instead.
4. **Let the Alpha Raid + new-character rollout breathe** — hold off on new builds, watch real player reaction/difficulty before iterating further on Alpha Raid specifically.

## Reminders for whoever picks this up

- This session worked directly on `main` throughout — no feature branches/worktrees. Every task in both Alpha Raid plans was committed and deployed individually; nothing is mid-flight or uncommitted.
- Deploy pattern reminder: schema change → `npm run db:push && npx prisma generate` locally, then after push, SSH deploy with `npx prisma generate` included. New/changed slash command → `npm run deploy` (guild-scoped, instant) normally; only use `GLOBAL=true npm run deploy` when actually ready to ship the change everywhere (it takes ~1h to propagate and can't be un-shipped quickly).
- SSH deploy command: `ssh -i "D:/Projects/Bot/ssh-key-2026-06-05.key" -o StrictHostKeyChecking=no ubuntu@140.245.202.30 "bash -lc 'export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd ~/bot && git pull && npx prisma generate && npm run build && pm2 restart cartethyia'"`
