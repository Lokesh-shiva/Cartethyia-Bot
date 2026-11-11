# Story Chapters — Monthly Release Design

## Intent and why

CARTETHYIA has about 200 registered players but roughly 16 active. The owner has also lost interest: the game has deep systems (echoes, gacha, raids) but only a grind loop. Nothing pulls a player back tomorrow, and there is no story or discovery. A survey of active players said: most are at the level cap and want it raised; they want exploration and adventure; they want new weapons (more 4★ and a new 5★); they have enough echoes.

This project gives the game a reason to return every month: a **story chapter** released on a schedule, with a new region, a character-POV story, a boss, a new weapon, and a step up in the player level cap.

## Goals

- A monthly release cadence that survives the owner being busy: 3-4 chapters are built before launch, locked, and released automatically one per month.
- Single-player-friendly: works with 16 active players, no waiting on others.
- Reuse existing pieces (dungeon/boss combat, weapon system, sweep pattern, owner-command pattern) instead of building a new engine.
- Give the level-capped players a reason to level: each chapter raises the player level cap by one step.
- Give post-story players something to repeat so they are not idle between releases.
- Include real puzzles (button-only, no typing) so a chapter is not only fights and choices.

## Non-goals

- Card trading.
- Raising character level caps or weapon level caps (later, if this works).
- New echoes (players said there are enough).
- Putting the new weapons on any banner. They are story-only.

## Anti-goals

- A release schedule that goes quiet again because chapters ran out or the owner could not keep up.
- Power creep: raising the cap without raising enemy difficulty, since player power already outpaces boss tuning.
- Losing a player's run progress on a bot restart.

## Decided by the owner

- **Monthly cadence with a prebuilt buffer.** The bot holds the chapters locked and releases one a month automatically, with the announcement posted by a timed check (same pattern as `alphaRaidSweep.ts` / `tournamentSweep.ts`). An owner command can release early, delay, or show the schedule.
- **Exploration/adventure over trading.**
- **Player level cap only** rises per chapter, via the `WORLD_LEVEL_CAPS` table in `src/lib/progression.ts` (WL9 is the current ceiling at 90; each chapter adds the next WL entry). Characters and weapons keep their Lv90 ceiling for now.
- **New weapons are not pullable on banners.** A chapter's weapon is a **direct reward** for clearing it (not a forge blueprint). 4★ weapons along the way, one new 5★ at the finale. They are new entries alongside the existing wish weapons (4★: Dawnbreaker, Gravemaw, Scatter Hex, Ether Codex; 5★: Oathbreaker's Edge, Ruin Sovereign, Null Fangs, Abyssal Tome, plus Wellspring).
- **Pause, continue and autosave.** A run autosaves at every node boundary and shows "Autosaved" with its node. A player can pause between nodes with a Pause button and continue later with `/story play` from any channel. A run left idle for 30 minutes is paused automatically (never while a fight is in progress). Pausing never costs progress; leaving mid-fight replays that fight from the start of its node, with HP as saved.
- **Three puzzles in chapter 1**, each tied to a scene: the **Ember Sequence** (shrine: watch a flashing order of four embers, then repeat it), **Light the Lanterns** (pool: a 3x3 grid where pressing a lantern also flips its neighbors, goal all lit, random each run), and **The Scar Count** (the Stranger: a riddle whose answer is the sum of three numbers mentioned in earlier nodes). Every puzzle has a limit on mistakes, a paid hint that costs HP, and a reward (some HP back plus a flag); failing never ends the run, it only costs HP. The shrine also keeps the Bren-style bargain: take the relic by force for 20% HP instead of solving. The relic's effect is non-combat (my call): it restores 25% HP when the boss fight starts.
- **Echoes are out of scope.**
- **Chapter 1 is told from Bren's POV (a 4★ character), chosen because his HP-as-resource kit suits an attrition run.** Two modes inside the chapter: for most nodes the player plays as themselves with Bren as a story companion; at a few scripted moments (one or two nodes in chapter 1) the player controls Bren himself. In those segments the player controls a fixed **"story Bren"** at set stats that every player gets, regardless of whether they own him, so chapter 1 never requires owning Bren and everyone plays the same segment. The builder must verify that the team-position system (`resolveRoster` in `src/lib/teamPositions.ts`) can place Bren in the lead slot, since combat currently assumes the human's own character leads.

## The owner's guesses (marked as guesses, not decisions)

- Each chapter is one region plus one character's POV; seven playable characters (Solace, Kaelith, Vesper, Rilo, Rhoven, Bren, Feyra) could cover seven months.
- Inside a chapter: a branching run of about 6-8 nodes (fights, puzzles, story choices, rest stops, then a region boss). Run progress is saved in the database.
- A replayable harder or weekly mode after the story, so players are not idle.
- The cap steps up by about +5 per chapter.

## Quality over quantity (owner decision)

Ship **one** chapter first and make it good, then build the later chapters slowly after release while the schedule buys time. A chapter is only released when it is finished and playtested; the monthly cadence is a goal to grow into, not a reason to ship rushed content.

## Visual presentation (owner wants this to feel more visual)

Chapters should be image-led, using the existing canvas card pipeline (`@napi-rs/canvas`, `src/lib/*Card.ts`):
- a **map card** showing the node path, the player's position and cleared nodes, redrawn as they advance;
- a **region backdrop** and a chapter title card;
- an illustration per story event and the region boss's art.

Limits: the owner supplies the art (one backdrop plus node icons and event images for chapter 1); static backgrounds should be rendered once and cached, with only the changing parts redrawn, because the VM has about 1 GB of RAM and shared CPU; canvas text must stay ASCII (the Rajdhani font lacks unicode symbols); the bot cannot animate anything live, but it can send pre-rendered GIFs the way `/wish` does (`assets/*_star animation.gif`), so a few key moments (chapter title reveal, boss intro, flashback transition, victory) may be short pre-rendered animations built outside the bot from the generated art (parallax, zoom, ember particles) with a static-image fallback when a file is missing. Keep each GIF small (about 5 MB or less) and treat animation as polish after the chapter works with static cards. (Corrected: an earlier draft wrongly said Discord images could not be animated.)

## Content production (owner decisions)

- Art workflow: the assistant writes the image prompts, the owner generates the images in ChatGPT, and the assistant wires them into canvas cards. The assistant cannot drive the owner's browser.
- Promotion: each chapter release gets a short teaser (motion-graphics trailer, optionally an animated short) made when the chapter is ready to announce. This is outside the bot and is not part of the build.
- Engagement hooks to design into chapter 1: risky choices with real consequences, a cliffhanger toward the next chapter, small collectibles that reward replaying, and runs short enough to play daily.

## Constraints

- Discord bot only: interaction is buttons, selects, embeds, and canvas image cards. Button handlers that must survive restarts go through the global `interactionCreate.ts` handler with the entity id in the customId (not message-scoped collectors).
- State that must survive restarts lives in the database; schema changes need `npm run db:push` then `npx prisma generate`.
- Combat reuse: fights should use the existing dungeon/boss combat (`dungeon.ts`/`boss.ts`) rather than a new engine. Any new fight code must wire a character's kit into the combat loops the usual way, so avoid adding new combat loops.
- Combat scaling (`gearAwareScale` in `combat.ts`) is hard-capped on every axis. New regions need their enemy difficulty tuned deliberately so raised-cap players are still challenged.
- Anti-cheat (`auditSpend`) and the existing currency/reward helpers (`awardUser`) should be used for any new rewards.

## Left to the builder

- Chapter and node data model (tables vs static content files), the event-text pool, and how a run is stored.
- Exact enemy stat curves for each region and how they tie to the new cap step.
- The new weapons' exact stats, passives, and names (suggested: draft them for owner review).
- The shape of the replay mode (hard mode vs weekly rotation).
- Announcement format, and which channels it posts to (the Alpha Raid channel convention, echo/encounter spawn channels, is a reasonable default).
- Whether chapter content is gated per player by "cleared the previous chapter" (recommended) in addition to the release date.

## Calls made after the builder review (assistant's calls, for the owner to check)

1. **How the cap actually rises.** Today a player's cap is `WORLD_LEVEL_CAPS[user.worldLevel]` in `progression.ts`, and the world level advances through `/ascend` (beating the WL8 boss takes a player to WL9, which is the current content ceiling: `getBoss(9)` is null and `/ascend` says the next trial is being prepared). Chapter N moves a player from WL(8+N) to WL(9+N): clearing chapter 1's boss advances `worldLevel` from 9 to 10, and the cap for WL10 is new (guess: 95). The existing WL9 entry stays at 90. (Corrected: an earlier draft of this document wrongly said the ceiling was WL8.)
2. **Who can play chapter 1.** Chapter 1 requires WL9 (the current maximum), and each later chapter requires the previous one cleared plus its release date. Players below WL9 keep progressing through the normal WL bosses; most active players are already capped, so this is the intended audience.
3. **Combat reuse is not a thin wrapper yet.** `dungeon.ts` exports only `data` and `execute`, so its fight loop is coupled to the slash-command interaction. Wave data is separate and data-driven (`src/lib/dungeons.ts`: `DungeonDefinition`, `WaveDefinition`, `getScaledWaveEnemy`). The precedent for reuse is the entry points already extracted this way: `startDuelMatch` (duel.ts, used by tournaments) and `startAlphaRaidFight` (raid.ts). The plan's first task should extract a fight entry point from `dungeon.ts` the same way, taking a wave definition and returning win/lose. This is the largest risk in the project because `dungeon.ts` is hand-wired for every character's kit.
4. **Story writing.** The assistant drafts each chapter's region, story beats, events and boss text; the owner approves tone and lore before it ships. Chapter 1 is written first and gates the rest.
5. **Scope of this build.** This build is the engine plus chapter 1 with real content: the release scheduler and owner command, the run/node system, the cap step, and chapter 1's region, boss and weapons. Chapters 2-4 are separate content drops on the same engine, each with its own small plan. The monthly buffer is built up after chapter 1 ships, not before.
6. **Release early / delay.** Release dates only control when a chapter unlocks. A chapter that is already unlocked or a run in progress is never revoked or reset by a delay; delaying only affects chapters that have not unlocked yet.

## Open items the builder should flag

- The exact cap increment per chapter (guess: +5) and the number of chapters to prebuild (guess: 3-4).
- Which character is the POV for each chapter, and the story/lore for each region (the owner wants help drafting, but the tone and lore are the owner's to approve).
