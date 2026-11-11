# Story Chapters (Engine + Chapter 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the monthly story-chapter engine and chapter 1, "The Cost of Ember" (Bren's POV): a DB-persisted 7-node run reusing the dungeon fight code, a map card, a release scheduler with an owner command, a WL10 cap step, and one story-only 4★ weapon.

**Architecture:** Pure rules (eligibility, run state, rewards, release selection) live in `src/lib/story/` and are unit-tested with `node:test` through `tsx`. Fights reuse `runWave` from `dungeon.ts` after a behavior-preserving extraction (precedent: `startDuelMatch`, `startAlphaRaidFight`). Run state is saved at node boundaries in Postgres; every button is durable via the global `interactionCreate.ts` handler with the run id in the customId. A 5-minute sweep (pattern of `alphaRaidSweep.ts`) announces released chapters.

**Tech Stack:** TypeScript (CommonJS, tsx), discord.js v14, Prisma v7, `@napi-rs/canvas`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-11-story-chapters-design.md`

## Global Constraints

- Discord-only interaction: buttons, selects, embeds, canvas image cards.
- Buttons that must survive restarts go through `src/events/interactionCreate.ts` with the entity id in the customId. Message-scoped collectors are allowed only inside a single fight (as dungeons do).
- Schema changes: `npm run db:push` then `npx prisma generate`; the VM deploy also runs `npx prisma generate`.
- Reuse the dungeon combat (`runWave`); do not add a new combat loop. `gearAwareScale` in `combat.ts` stays untouched.
- Rewards go through `awardUser` (`src/lib/economy.ts`) and `auditSpend` where currency is spent.
- Canvas text is ASCII only (Rajdhani lacks unicode glyphs). The VM has about 1 GB RAM and shared CPU: cache static backdrops, redraw only what changes. A missing art file must never crash a card.
- Chapter 1 requires WL9, advances `worldLevel` 9 to 10 on first clear, and the WL10 cap is 95 (a guess to tune). The WL9 cap stays 90.
- The new weapons are never in `WISH_WEAPONS_4STAR`, `WISH_WEAPONS_5STAR`, or any banner pool; they are direct first-clear rewards.
- Story Bren is a fixed-stat loaner for everyone; chapter 1 never requires owning Bren.
- Runs autosave at every node boundary; players can pause between nodes and continue with `/story play`; a run idle for 30 minutes (and not in a fight) is paused automatically.
- Quality over quantity: only chapter 1 ships in this plan; no chapter is released until playtested and its text approved by the owner.

## Review Focus

1. A player runs `/story play` while a run is already active: resume it, never create a second.
2. A stale or double-clicked button (an old node's choice, or the same choice twice) must be ignored, not applied twice.
3. The bot restarts mid-run: the run resumes at the saved node with HP as saved at that node's start; a half-finished fight is not counted as cleared.
4. A "pay HP" bargain offered at low HP is disabled instead of killing the player.
5. First-clear rewards (world level, weapon, currency) must never be granted twice, even if the final node is clicked twice or the bot crashes and retries.

---

### Task 1: Test runner, core types, start/eligibility rules

**Files:**
- Modify: `package.json` (add `"test": "tsx --env-file=.env --test src/lib/story/*.test.ts"`; modules that import `src/lib/prisma.ts` throw without `DATABASE_URL`, and the import only builds the client, so tests must never run a query)
- Create: `src/lib/story/types.ts`, `src/lib/story/release.ts`
- Test: `src/lib/story/release.test.ts`

**Interfaces:**
- Produces (`types.ts`): `type NodeKind = "FIGHT" | "EVENT" | "REST" | "STORY_BREN_FIGHT" | "BOSS"`; `interface EventOption { id: string; label: string; hpCostFraction: number; setsFlag?: string; resultText: string }`; `interface NodeDefinition { kind: NodeKind; title: string; intro: string; waves?: WaveDefinition[]; options?: EventOption[]; restFraction?: number }`; `interface ChapterDefinition { id: number; title: string; blurb: string; requiresWorldLevel: number; clearsToWorldLevel: number; enemyWorldLevel: number; hardModeMult: number; nodes: NodeDefinition[]; rewards: ChapterRewards }`; `interface ChapterRewards { weaponId: string; firstClear: CurrencyBundle; replay: CurrencyBundle }`; `type CurrencyBundle = { credits: number; fractonite: number; emberShards: number }`; `type Difficulty = "NORMAL" | "HARD"`; `interface RunState { nodeIndex: number; flags: string[]; hpFraction: number; allyHpFractions: Record<string, number>; difficulty: Difficulty }`. `WaveDefinition` is imported from `src/lib/dungeons.ts`.
- Produces (`release.ts`): `type StartDecision = { action: "START"; difficulty: Difficulty } | { action: "RESUME"; runId: string } | { action: "DENIED"; reason: "NOT_RELEASED" | "WORLD_LEVEL" | "PREVIOUS_NOT_CLEARED" }`; `decideStart(input: { chapter: ChapterDefinition; worldLevel: number; clearedChapterIds: number[]; releaseAt: Date | null; now: Date; activeRun: { id: string } | null; bypassRelease: boolean }): StartDecision`; `pickChapterToPlay(chapters: ChapterDefinition[], clearedChapterIds: number[]): ChapterDefinition` (first uncleared in id order, else the highest-id cleared one for replay).

- [ ] **Step 1: Write failing tests** in `release.test.ts` (named `decideStart ...`): active run returns `RESUME` even if gating would now deny; no `releaseAt` or a future one returns `NOT_RELEASED`; `bypassRelease: true` skips that check; `worldLevel` below `requiresWorldLevel` returns `WORLD_LEVEL`; chapter 2 with chapter 1 uncleared returns `PREVIOUS_NOT_CLEARED`; a cleared chapter returns `START` with `difficulty: "HARD"` (replay needs no world-level check); otherwise `START` with `NORMAL`. `pickChapterToPlay([ch1, ch2], [1])` returns ch2; `pickChapterToPlay([ch1], [1])` returns ch1.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (modules missing). If `tsx --test` rejects the glob on this Node, switch the script to a `node --import tsx --test` form and note it in the commit.
- [ ] **Step 3: Implement** `types.ts` and `release.ts` to the signatures above. Rule order in `decideStart`: active run, release gate, then cleared-means-HARD, then world level, then previous chapter.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(story): test runner, core types, start eligibility rules`.

### Task 2: Pure run engine

**Files:**
- Create: `src/lib/story/runEngine.ts`
- Test: `src/lib/story/runEngine.test.ts`

**Interfaces:**
- Consumes: `RunState`, `EventOption`, `ChapterDefinition` (Task 1).
- Produces: `newRunState(difficulty: Difficulty): RunState` (nodeIndex 0, hpFraction 1, no flags); `canTakeOption(state: RunState, option: EventOption): boolean` (true only if `state.hpFraction > option.hpCostFraction`); `applyEventOption(state: RunState, option: EventOption): RunState` (subtracts the cost, adds `setsFlag` once); `applyRest(state: RunState, restFraction: number): RunState` (adds, clamps to 1); `advanceNode(state: RunState): RunState`; `isFinalNode(chapter: ChapterDefinition, state: RunState): boolean`; `isStaleAction(state: RunState, actionNodeIndex: number): boolean`; `buildCustomId(kind: "next" | "opt" | "resume" | "pause", runId: string, nodeIndex: number, optionId?: string): string` and `parseCustomId(customId: string): { kind: "next" | "opt" | "resume" | "pause"; runId: string; nodeIndex: number; optionId?: string } | null` (prefix `story_`, run ids are cuids so no underscores inside).

- [ ] **Step 1: Write failing tests**: bargain at `hpFraction 0.2` with cost `0.2` is not takeable and with cost `0.15` is; `applyEventOption` never lets `hpFraction` reach 0 and adds a flag only once when applied twice; `applyRest` clamps at 1; `isStaleAction({nodeIndex: 3}, 2)` is true and `(…, 3)` is false; `advanceNode` adds exactly 1 to `nodeIndex` and leaves `hpFraction` and `flags` untouched (a state saved before a fight resumes at the same node with the same HP); `parseCustomId(buildCustomId("opt", "ckabc123", 2, "pay"))` round-trips and `parseCustomId("story_garbage")` returns `null`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions above, all pure and immutable (return new objects).
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(story): pure run engine and durable customId helpers`.

### Task 3: Extract the dungeon fight entry points

**Files:**
- Modify: `src/lib/dungeons.ts` (add `customEnemy?: EchoDefinition` to `WaveDefinition`; `getScaledWaveEnemy` uses it instead of `getEnemy(name)` when set)
- Modify: `src/commands/rpg/dungeon.ts` (export `runWave`, `WaveState`, `WaveResult`, `AllyBundle`; add `createWaveSession` and `carryOverWaveState`; make `runDungeon` use them with no behavior change)
- Test: `src/lib/story/dungeonScaling.test.ts`

**Interfaces:**
- Produces (`dungeon.ts`): `interface WaveSession { stats: ResolvedStats; bonuses: PlayerBonuses; ws: WaveState; dbUser: DungeonUser; displayName: string }`; `createWaveSession(args: { userId: string; dbUser: DungeonUser; displayName: string; roster?: ResolvedRoster; allyBundles?: Partial<Record<PositionIndex, AllyBundle>> }): Promise<WaveSession>` (no overrides means load roster and bundles exactly as `runDungeon` does today; overrides skip the ownership lookups); `carryOverWaveState(result: WaveResult): WaveState` (the result with `skillCooldown`, `attunementDoubleTurnsLeft` and `forteEmpoweredTurnsLeft` each reduced by 1, floored at 0, as `runDungeon` does between waves). `runWave` keeps its current signature.

- [ ] **Step 1: Write failing tests**: `getScaledWaveEnemy` with a wave carrying `customEnemy` returns that object as `def` and `hp === Math.floor(custom.hp * hpMult * Math.pow(1.45, wl))`; for `getDungeon("boss_absolute")` wave 2 at WL8 the result equals the same formula applied to the `Lumen Speck` entry in `ECHO_DEFINITIONS` (proves existing dungeons are unchanged).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (`customEnemy` unknown).
- [ ] **Step 3: Implement** the `dungeons.ts` change, then the `dungeon.ts` extraction: move the roster/bundle loading and the per-run state initialisation into `createWaveSession`, replace the field-by-field copy-back loop with `carryOverWaveState`, and keep thread creation, aura, rechallenge and rewards in `runDungeon`.
- [ ] **Step 4: Verify**: `npm test`, `npx tsc --noEmit`, then a manual smoke test of `/dungeon` on the dev guild (one full clear and one death) confirming identical behavior.
- [ ] **Step 5: Commit** `refactor(dungeon): extract createWaveSession/carryOverWaveState, support customEnemy`.

### Task 4: Story Bren loaner

**Files:**
- Create: `src/lib/story/loaner.ts`
- Test: `src/lib/story/loaner.test.ts`

**Interfaces:**
- Consumes: `AllyBundle`, `CHARACTER_KITS`, `kit.statsAtLevel`, `applyBonuses`.
- Produces: `STORY_BREN_LEVEL = 70`, `STORY_BREN_KIT_LEVEL = 5` (tunable); `buildLoanerBundle(characterId: string, level: number, kitLevel: number): AllyBundle` (synchronous, no DB; `hp === hpMax`, constellation 0, all five kit levels `kitLevel`, empty-gear bonuses); `loanerRoster(characterId: string): ResolvedRoster` returning `{ position1: characterId, position2: null, position3: null }`.

- [ ] **Step 1: Write failing tests**: `buildLoanerBundle("bren", 70, 5)` has `kit.id === "bren"`, `constellation === 0`, `basicLevel === skillLevel === 5`, and `hpMax` equal to `applyBonuses` of `CHARACTER_KITS.bren.statsAtLevel(70)` with empty bonuses; `loanerRoster("bren").position1 === "bren"` and positions 2 and 3 are `null`; an unknown character id throws.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** If no empty-`PlayerBonuses` constructor exists, add `emptyPlayerBonuses()` to `setBonus.ts` and use it.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(story): story Bren loaner bundle`.

### Task 5: Cap step and the story-only weapon

**Files:**
- Modify: `src/lib/progression.ts` (`WORLD_LEVEL_CAPS[10] = 95`)
- Modify: `src/lib/wishWeapons.ts` (add `STORY_WEAPONS: WishWeapon[]`; `ALL_WISH_WEAPONS` includes them; move `weaponCreateData` here and export it; update `wish.ts` to import it)
- Modify: `src/lib/weapons.ts` (passive entry for the new weapon, keyed by name, as `"Ruin Sovereign"` is)
- Test: `src/lib/story/weapons.test.ts`

**Interfaces:**
- Produces: `STORY_WEAPONS`, containing one 4★ Broadblade `cinderheart` / "Cinderheart" (draft: `baseAtk 150`, `atkMaxMult 4.2`, sub `ATK_PERCENT` base 12 scale 2.0, hidden `CRIT_RATE` base 6 scale 2.0, passive +28% damage as HP drops; the owner reviews these numbers before release); `weaponCreateData(userId: string, w: WishWeapon)` exported from `wishWeapons.ts`.

- [ ] **Step 1: Write failing tests**: `getWishWeapon("cinderheart")` is defined; no id in `WISH_WEAPONS_4STAR` or `WISH_WEAPONS_5STAR` equals `"cinderheart"`; `WORLD_LEVEL_CAPS[9] === 90` and `WORLD_LEVEL_CAPS[10] === 95`; the weapon's passive is registered in `weapons.ts`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Confirm `wish.ts` rolls only from the 4STAR/5STAR arrays and never from `ALL_WISH_WEAPONS`; if it does, change it to the arrays.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(story): WL10 cap, Cinderheart story weapon kept off banners`.

### Task 6: Schema, run persistence, first-clear rewards

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/story/rewards.ts`, `src/lib/story/runService.ts`
- Test: `src/lib/story/rewards.test.ts`

**Interfaces:**
- Schema: `StoryRelease { chapterId Int @id; releaseAt DateTime; announcedAt DateTime? }`; `StoryRun { id String @id @default(cuid()); userId String; chapterId Int; difficulty String; status String @default("ACTIVE") /* ACTIVE | PAUSED | COMPLETE | FAILED */; pausedAt DateTime?; nodeIndex Int @default(0); flags String[]; hpFraction Float @default(1); allyHpFractions Json @default("{}"); threadId String?; guildId String?; startedAt DateTime @default(now()); updatedAt DateTime @updatedAt; @@index([userId, status]) }`; `StoryProgress { userId String; chapterId Int; clearedAt DateTime @default(now()); @@id([userId, chapterId]) }`. Map table names with `@@map` in snake_case as the other models do.
- Produces (`rewards.ts`): `planClearRewards(chapter: ChapterDefinition, alreadyCleared: boolean, difficulty: Difficulty): { advanceWorldLevelTo: number | null; grantWeaponId: string | null; currencies: CurrencyBundle }` (first clear on NORMAL: advance to `clearsToWorldLevel`, grant the weapon, `rewards.firstClear`; any replay or HARD: no advance, no weapon, `rewards.replay`).
- Produces (`runService.ts`): `getActiveRun(userId: string)` (returns the user's ACTIVE or PAUSED run, so `decideStart` resumes both), `pauseRun(runId: string): Promise<void>` and `resumeRun(runId: string): Promise<void>` (set status and `pausedAt`), `createRun(input: { userId: string; chapterId: number; difficulty: Difficulty; threadId: string; guildId: string })`, `saveRunState(runId: string, state: RunState): Promise<void>`, `failRun(runId: string): Promise<void>`, `getClearedChapterIds(userId: string): Promise<number[]>`, `completeRun(runId: string, chapter: ChapterDefinition): Promise<{ firstClear: boolean }>`. `completeRun` creates the `StoryProgress` row inside a transaction; a unique-key conflict means not a first clear, so the world level, weapon and first-clear currency are granted only when the create succeeded. World level uses `updateMany` where `worldLevel < clearsTo` so it can never go backwards.

- [ ] **Step 1: Write failing tests** for `planClearRewards`: first clear NORMAL returns `advanceWorldLevelTo: 10`, the weapon id and the first-clear bundle; `alreadyCleared: true` returns no advance, no weapon and the replay bundle; `difficulty: "HARD"` never advances.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `rewards.ts`, add the models, run `npm run db:push` then `npx prisma generate`, and implement `runService.ts`. Source string for `awardUser` is `"story"`; widen its type if it is a union. `emberShards` is incremented with `prisma.user.update` (as `field-boss.ts` does).
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`; confirm `db:push` reports the DB in sync.
- [ ] **Step 5: Commit** `feat(story): schema, run persistence, idempotent first-clear rewards`.

### Task 7: Map card, art fallback, art prompts

**Files:**
- Create: `src/lib/story/mapCard.ts`, `docs/story/ch1-art-prompts.md`
- Test: `src/lib/story/mapCard.test.ts`

**Interfaces:**
- Produces: `toAscii(text: string): string` (replaces non-ASCII with `?` or the closest plain letter); `generateStoryMapCard(input: { chapterTitle: string; nodes: { kind: NodeKind; label: string }[]; currentIndex: number; hpFraction: number; artDir?: string }): Promise<Buffer>` (draws the path of nodes, cleared nodes marked, the current node highlighted, an HP bar; loads `<artDir>/backdrop.png` once and caches it in memory; falls back to a plain gradient when the file is absent). Default `artDir` is `assets/story/ch1`.

- [ ] **Step 1: Write failing tests**: `toAscii("Ember ✦ Reach")` contains no code point above 126; `generateStoryMapCard` with 7 nodes and a nonexistent `artDir` still resolves to a non-empty Buffer (art fallback); calling it twice with a real temp backdrop reads the file once (spy on the loader).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** with `@napi-rs/canvas`, following the structure of `tournamentBracketCard.ts`. Write `docs/story/ch1-art-prompts.md`: ChatGPT image prompts for the Ashen Reach backdrop, five node icons (fight, event, rest, flashback, boss), the shrine and stranger event illustrations, "The Last Ember" boss art, and the Cinderheart weapon art, in the same style as the earlier character prompts. Keep each prompt short and single-motif.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(story): map card with art fallback and chapter 1 art prompts`.

### Task 8: Chapter 1 content

**Files:**
- Create: `src/lib/story/chapter1.ts`, `src/lib/story/chapters.ts`
- Test: `src/lib/story/chapter1.test.ts`

**Interfaces:**
- Produces: `CHAPTER_1: ChapterDefinition` (id 1, `requiresWorldLevel 9`, `clearsToWorldLevel 10`, `enemyWorldLevel 10`, `hardModeMult 1.4`, rewards: first clear `{ credits: 40000, fractonite: 150, emberShards: 3 }`, replay `{ credits: 15000, fractonite: 50, emberShards: 2 }`, `weaponId "cinderheart"`); `CHAPTERS: ChapterDefinition[] = [CHAPTER_1]` in `chapters.ts`; `validateChapter(chapter: ChapterDefinition): string[]` (list of problems, empty when valid); `chapterNodeDungeon(chapter: ChapterDefinition, nodeIndex: number, difficulty: Difficulty): DungeonDefinition` (a synthetic `DungeonDefinition` for `runWave`: HARD multiplies every wave's `hpMult/atkMult/defMult` by `hardModeMult` without mutating the source, `auraCost` 0 for NORMAL and 2 for HARD).
- Nodes (linear order; my call: branching lives in event choices, not in the path): 1 FIGHT "Ashfall Gate" (2 waves); 2 EVENT "The Furnace Shrine" (options: pay 20% HP for the relic flag `relic`, or walk past); 3 FIGHT "Cinder Crawl" (2 waves); 4 REST "The Cooling Pool" (`restFraction 0.3`); 5 EVENT "The Stranger" (a story choice that sets flag `knows_scar`, no HP cost); 6 STORY_BREN_FIGHT "The First Scar" (flashback, 2 waves, story Bren); 7 BOSS "The Last Ember" (single high-multiplier wave). Enemies are `customEnemy` Fusion definitions that are not registered in `ECHO_DEFINITIONS`. Initial wave multipliers match "Trial of the Absolute" (about 5.0 / 4.5 / 4.0) and the boss about 14 / 9 / 8; tune in playtest. The boss's "hotter every turn" idea is flavor text only in this plan; a real mechanic is out of scope.

- [ ] **Step 1: Write failing tests** for `validateChapter(CHAPTER_1)` returning `[]` and `CHAPTER_1.nodes.length === 7`; exactly one `BOSS` and it is last; 1 or 2 `STORY_BREN_FIGHT` nodes; at least one event option with `hpCostFraction > 0` and one with 0; every fight node has waves; `chapterNodeDungeon(CHAPTER_1, 0, "HARD").waves[0].hpMult === CHAPTER_1.nodes[0].waves![0].hpMult * 1.4` and the source waves are unchanged afterwards.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Draft the intro text, event text and option text in the chapter voice (Bren: blunt, counts costs); keep every string plain ASCII-safe for canvas labels. Stop for owner approval of the text before Task 11.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(story): chapter 1 content and validation`.

### Task 9: `/story` command and durable flow

**Files:**
- Create: `src/commands/rpg/story.ts`, `src/lib/story/storyFlow.ts`, `src/lib/story/storyHandlers.ts`
- Modify: `src/events/interactionCreate.ts` (route customIds starting `story_` to `handleStoryButton`)

**Interfaces:**
- Consumes: Tasks 1 to 8.
- Produces: `/story` with subcommands `play` and `status` (status lists chapters with locked/released/cleared); `startOrResume(interaction: ChatInputCommandInteraction): Promise<void>`; `continueRun(client: Client, runId: string): Promise<void>` (loads the run, resolves the next node, posts the map card, runs fights, saves state at each node boundary); `handleStoryButton(interaction: ButtonInteraction): Promise<void>`.

- [ ] **Step 1: Implement** `startOrResume`: require an onboarded user, call `decideStart` with `bypassRelease: isOwner(userId)`, answer each denial in plain text, create a private thread for START (as dungeons do), post the chapter intro and map card, and post a durable "Begin" button via `buildCustomId`.
- [ ] **Step 2: Implement `continueRun`** by node kind. FIGHT/BOSS: `createWaveSession`, apply the saved HP fractions to the player and ally bundles, `runWave` each wave through `chapterNodeDungeon`, `carryOverWaveState`, save the HP fraction at the node end, `registerFight(..., auraCost)`/`clearFight`. A defeat calls `failRun` and ends the run (my call: runs are short, defeat has stakes). EVENT: post option buttons (disabled when `canTakeOption` is false). REST: apply, save, continue. STORY_BREN_FIGHT: session built from `loanerRoster("bren")` and `buildLoanerBundle`, full HP at the segment start, and the main run's HP fraction is not changed by it. After the final node call `completeRun`, post the victory card and the rewards, and archive the thread. HARD (replay) charges 2 Aura via the existing aura helpers before starting.
- [ ] **Step 3: Implement `handleStoryButton`**: parse with `parseCustomId`; reject clicks from anyone but the run owner; ignore with an ephemeral note if `isStaleAction`; for `opt`, apply `applyEventOption`, save, then `continueRun`; for `resume`, re-post the current node (create a new thread if the old one is gone); for `pause`, call `pauseRun`, post "Autosaved at Node N. Continue anytime with /story play", and archive the thread.
- [ ] **Step 3b: Pause, continue and autosave UX.** Every message posted at a node boundary (after a fight, an event result or a rest) ends with an "Autosaved - Node N of 7" footer and a Pause button (`buildCustomId("pause", ...)`); no Pause button is shown during a fight. `/story play` with a PAUSED or ACTIVE run shows "Welcome back", the map card at the saved node, and a Continue button, calls `resumeRun`, and reuses the old thread or makes a new one if it is gone. Leaving mid-fight is not blocked: that node replays from its start with the saved HP.
- [ ] **Step 4: Verify** `npx tsc --noEmit`; live test on the dev guild as the owner (release bypass): a full normal clear, a death at a node, a double-clicked option, and a mid-run `pm2 restart` followed by Resume.
- [ ] **Step 5: Commit** `feat(story): /story play, node flow, durable buttons`.

### Task 10: Release scheduler and `/owner-story`

**Files:**
- Create: `src/lib/story/storySweep.ts`, `src/commands/utility/owner-story.ts`
- Modify: `src/events/ready.ts` (call `startStorySweep(client)` after `startAlphaRaidSweep`)
- Test: `src/lib/story/schedule.test.ts` (functions live in `release.ts`)

**Interfaces:**
- Produces (`release.ts`): `selectAnnouncements(rows: { chapterId: number; releaseAt: Date; announcedAt: Date | null }[], now: Date): number[]` (chapter ids whose `releaseAt <= now` and are not announced); `canReschedule(row: { releaseAt: Date } | null, now: Date): boolean` (true when there is no row or `releaseAt > now`). `startStorySweep(client: Client): void` (5-minute interval; marks `announcedAt` before posting so a crash cannot double-post, posts an embed with the chapter title and blurb to each guild's channel via `resolveAlphaRaidChannel`, skipping guilds without one). `/owner-story` (owner only) subcommands: `status`, `release chapter:int` (sets `releaseAt` to now), `schedule chapter:int days:int` (sets `releaseAt` to now plus days; refused when `canReschedule` is false).

- [ ] **Step 1: Write failing tests**: `selectAnnouncements` returns only released, unannounced ids; `canReschedule` is false for a past `releaseAt` and true for a future one or no row; `selectIdleRuns(runs: { id: string; userId: string; status: string; updatedAt: Date }[], now: Date, idleMs: number, userIdsInFight: Set<string>): string[]` returns the ids of ACTIVE runs idle longer than `idleMs` (30 minutes) whose user is not in a fight, and never a PAUSED, COMPLETE or FAILED run.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the three pure functions (`selectIdleRuns` lives in `release.ts`), the sweep, the command and the `ready.ts` wiring. The same 5-minute sweep also auto-pauses idle runs: it calls `pauseRun` for each id from `selectIdleRuns` (users with a registered fight are skipped) and posts "Autosaved. Continue anytime with /story play" in the run's thread if it is still reachable.
- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(story): release sweep and /owner-story`.

### Task 11: Integrate, deploy, live test

**Files:**
- Modify: `src/commands/rpg/ascend.ts` (the WL9 ceiling message also mentions `/story play` once a chapter is released)

- [ ] **Step 1: Verify** `npm test`, `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 2: Deploy**: push, then on the VM `git pull && npx prisma generate && npm run build && pm2 restart cartethyia`; run `npm run deploy` for the dev guild first.
- [ ] **Step 3: Live test as the owner on the dev guild** (release bypass): normal clear grants world level 10, cap 95, Cinderheart, and the first-clear currency exactly once; a second clear is HARD and grants only the replay bundle; `/weapons` shows Cinderheart; banners never roll it (100 test pulls on the standard banner).
- [ ] **Step 4: Owner gate**: owner approves the chapter text, the weapon numbers and the art. Then `GLOBAL=true npm run deploy`, then `/owner-story release chapter:1` (or `schedule`) to announce.

---

### Task 12 (polish, after Task 11 works with static cards): animated moments

**Files:**
- Create: `assets/story/ch1/anim/title.gif`, `boss-intro.gif`, `flashback.gif`, `victory.gif` (made outside the bot from the generated art with the motion-graphics tooling: slow parallax/zoom, ember particles; each about 5 MB or less)
- Modify: `src/lib/story/storyFlow.ts` (send the matching GIF at the chapter intro, boss node start, flashback node start and victory)
- Test: `src/lib/story/anim.test.ts`

**Interfaces:**
- Produces (`src/lib/story/anim.ts`): `animPathFor(moment: "title" | "boss-intro" | "flashback" | "victory", artDir?: string): string | null` (returns the GIF path only if the file exists, else `null` so the flow sends the static card instead).

- [ ] **Step 1: Write failing tests**: `animPathFor("title", "<temp dir without the file>")` is `null`; with a temp GIF written to the dir it returns that path.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `anim.ts` and use it in `storyFlow.ts` with an `AttachmentBuilder` as `/wish` does.
- [ ] **Step 4: Verify** `npm test`, `npx tsc --noEmit`, and a live run showing the GIFs, then a run with one GIF removed to confirm the static fallback.
- [ ] **Step 5: Commit** `feat(story): optional animated moments with static fallback`.

## Spec coverage

Monthly scheduler and owner command: Task 10. Cap step: Task 5. Run/node system with DB persistence: Tasks 2, 6, 9. Combat reuse: Task 3. Story Bren: Tasks 4, 9. Chapter 1 content: Task 8. Visuals and art fallback: Task 7. Weapon off banners, direct reward: Tasks 5, 6. Replay (HARD) mode: Tasks 1, 6, 9. Chapters 2 to 4 and weekly rotation: out of scope by design.
