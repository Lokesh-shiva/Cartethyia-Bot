# Alpha Raid Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Begin → fight → reward handoff for Alpha Raid, using a boss built from the owner-chosen character's real kit, fought through `/raid`'s existing engine (reused almost entirely unchanged), paying out a configurable flat reward on top of normal raid loot.

**Architecture:** `/raid`'s `launchRaid()` fight loop is reused directly — it's made to accept an optional `alphaOptions` bag (stat multiplier, art override, evasion chance, bonus reward, completion callback) rather than being duplicated. A new `alphaRaidBoss.ts` builds a `RaidBossConfig`-shaped object from a `CHARACTER_KITS` entry (real Basic/Skill/Ultimate names, boss-flavored). Two new boss mechanics (evasion, enrage) and a generic kit-flavored debuff (Skill → VULNERABLE, Ultimate → WEAKENED, via the existing `debuffs.ts` system) are added inline to the boss counter-attack block, gated behind `alphaOptions` so normal `/raid` bosses are untouched. A new `alpharaid_begin_<id>` button (global `interactionCreate.ts` handler, same durable pattern as Join) resolves the DB instance, builds the boss, and calls a new exported `startAlphaRaidFight()` in `raid.ts` that seeds a fresh in-memory `ActiveRaid` from the DB participant list and hands off to `launchRaid()`.

**Simplification vs. the spec's phrasing:** the spec said the boss "carries that character's real Skill/Ultimate effect" — each character's actual kit result type (`BrenSkillResult`, `FeyraUltimateResult`, etc.) is bespoke per character and hand-wired into all 6 combat loops individually (see CLAUDE.md), so genuinely re-simulating 7+ different bespoke effect shapes generically as a boss AI isn't safe to do here. Instead: the boss's moves use that character's **real names/element/flavor**, and carry a **generic** kit-tier debuff (Skill-tier → VULNERABLE, Ultimate-tier → WEAKENED) using the debuff system already in `raid.ts`. This keeps the "feels like their kit" goal without a second bespoke per-character integration.

**Tech Stack:** Prisma v7, discord.js v14, existing `raid.ts` engine, `debuffs.ts`, `characterKit.ts`/`CHARACTER_KITS`.

---

### Task 1: Schema — reward + boss character fields on AlphaRaidEvent

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add fields to `AlphaRaidEvent`**

Find the `AlphaRaidEvent` model (added in Phase 1) and add these fields:

```prisma
model AlphaRaidEvent {
  id          String   @id @default(cuid())
  triggeredBy String
  triggeredAt DateTime @default(now())
  bossCharacterId    String   @default("solace") // CHARACTER_KITS id — which character's kit the boss uses
  fractureKeysReward Int      @default(10)
  radiantKeysReward  Int      @default(10)
  fractoniteReward   Int      @default(1500)
  instances   AlphaRaidInstance[]

  @@map("alpha_raid_events")
}
```

(Only the 4 new fields and their doc-comments are new — `id`/`triggeredBy`/`triggeredAt`/`instances`/`@@map` already exist from Phase 1, keep them as-is.)

- [ ] **Step 2: Push and regenerate**

```bash
npm run db:push
npx prisma generate
```
Expected: `Your database is now in sync with your Prisma schema.` then `✔ Generated Prisma Client`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(alpha-raid): schema — boss character + reward fields on AlphaRaidEvent

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared recruit embed/row — add the Begin button

**Files:**
- Create: `src/lib/alphaRaidEmbed.ts`
- Modify: `src/commands/utility/owner-alpharaid.ts`
- Modify: `src/events/interactionCreate.ts`

Phase 1 built the recruit embed inline in two places (`owner-alpharaid.ts` and the Join handler in `interactionCreate.ts`), each with only a Join button. This task pulls it into one shared helper (mirroring `tournamentSweep.ts`'s exported `buildTournamentSignupEmbed`, used for the identical reason) and adds a second **Begin** button to the row.

- [ ] **Step 1: Write the shared helper**

```typescript
// src/lib/alphaRaidEmbed.ts
// Shared with owner-alpharaid.ts (initial post) and interactionCreate.ts's
// global alpharaid_join_/alpharaid_begin_ handlers — same reason
// tournamentSweep.ts exports buildTournamentSignupEmbed: the embed/row need
// to be rebuildable from outside the command that originally posted them.
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export function buildAlphaRaidRecruitEmbed(count: number, deadlineAt: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xFF4F4F)
    .setTitle("⚡  ALPHA RAID — A Rare Threat Has Emerged")
    .setDescription(
      `A boss far stronger than anything in the usual rotation has appeared — server-wide, everywhere the bot lives.\n\n` +
      `**Players joined:** ${count}\n` +
      `**Kill window closes:** <t:${Math.floor(deadlineAt.getTime() / 1000)}:R>\n\n` +
      `Bring your best. This one only comes around when the owner calls it — and the rewards (Fracture Keys, Radiant Keys, Fractonite) don't come from anywhere else.\n\n` +
      `Click below to join — a server admin (or the bot owner) can click **Begin** once enough players are in.`
    )
    .setFooter({ text: "CARTETHYIA  ·  Alpha Raid" });
}

export function buildAlphaRaidRecruitRow(instanceId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`alpharaid_join_${instanceId}`).setLabel("⚔️  Join Alpha Raid").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`alpharaid_begin_${instanceId}`).setLabel("▶️  Begin Fight").setStyle(ButtonStyle.Success),
  );
}
```

- [ ] **Step 2: Use it in `owner-alpharaid.ts`**

In `src/commands/utility/owner-alpharaid.ts`, remove the local `buildRecruitEmbed` function entirely and replace its one call site.

Remove:
```typescript
function buildRecruitEmbed(count: number, deadlineAt: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xFF4F4F)
    .setTitle("⚡  ALPHA RAID — A Rare Threat Has Emerged")
    .setDescription(
      `A boss far stronger than anything in the usual rotation has appeared — server-wide, everywhere the bot lives.\n\n` +
      `**Players joined:** ${count}\n` +
      `**Kill window closes:** <t:${Math.floor(deadlineAt.getTime() / 1000)}:R>\n\n` +
      `Bring your best. This one only comes around when the owner calls it — and the rewards (Fracture Keys, Radiant Keys) don't come from anywhere else.\n\n` +
      `Click below to join!`
    )
    .setFooter({ text: "CARTETHYIA  ·  Alpha Raid" });
}
```

Add near the top imports:
```typescript
import { buildAlphaRaidRecruitEmbed, buildAlphaRaidRecruitRow } from "../../lib/alphaRaidEmbed";
```

Replace:
```typescript
      const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`alpharaid_join_${instance.id}`).setLabel("⚔️  Join Alpha Raid").setStyle(ButtonStyle.Danger),
      );

      const msg = await channel.send({ embeds: [buildRecruitEmbed(0, deadlineAt)], components: [joinRow] }).catch(() => null);
```
with:
```typescript
      const joinRow = buildAlphaRaidRecruitRow(instance.id);

      const msg = await channel.send({ embeds: [buildAlphaRaidRecruitEmbed(0, deadlineAt)], components: [joinRow] }).catch(() => null);
```

(`EmbedBuilder`/`ActionRowBuilder`/`ButtonBuilder`/`ButtonStyle` stay imported at the top even though the local function is gone — `ActionRowBuilder`/`ButtonBuilder`/`ButtonStyle` are still referenced by the discord.js import type annotations elsewhere in the file; leave the import line as-is, unused-import isn't a build error here.)

- [ ] **Step 3: Use it in `interactionCreate.ts`'s Join handler**

In `src/events/interactionCreate.ts`, add the import:
```typescript
import { buildAlphaRaidRecruitEmbed, buildAlphaRaidRecruitRow } from "../lib/alphaRaidEmbed";
```

Replace the `alpharaid_join_` handler's row + embed construction:
```typescript
      const newCount = await prisma.alphaRaidParticipant.count({ where: { instanceId } });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId).setLabel("⚔️  Join Alpha Raid").setStyle(ButtonStyle.Danger),
      );
      await interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(0xFF4F4F)
          .setTitle("⚡  ALPHA RAID — A Rare Threat Has Emerged")
          .setDescription(
            `A boss far stronger than anything in the usual rotation has appeared — server-wide, everywhere the bot lives.\n\n` +
            `**Players joined:** ${newCount}\n` +
            `**Kill window closes:** <t:${Math.floor(instance.deadlineAt.getTime() / 1000)}:R>\n\n` +
            `Bring your best. This one only comes around when the owner calls it — and the rewards (Fracture Keys, Radiant Keys) don't come from anywhere else.\n\n` +
            `Click below to join!`
          )
          .setFooter({ text: "CARTETHYIA  ·  Alpha Raid" })],
        components: [row],
      }).catch(() => {});
      return;
    }
```
with:
```typescript
      const newCount = await prisma.alphaRaidParticipant.count({ where: { instanceId } });
      await interaction.update({
        embeds: [buildAlphaRaidRecruitEmbed(newCount, instance.deadlineAt)],
        components: [buildAlphaRaidRecruitRow(instanceId)],
      }).catch(() => {});
      return;
    }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alphaRaidEmbed.ts src/commands/utility/owner-alpharaid.ts src/events/interactionCreate.ts
git commit -m "refactor(alpha-raid): shared recruit embed/row helper, add Begin button

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Boss builder — character kit → RaidBossConfig

**Files:**
- Modify: `src/commands/rpg/raid.ts` (export `RaidBossConfig`)
- Create: `src/lib/alphaRaidBoss.ts`

- [ ] **Step 1: Export `RaidBossConfig` from `raid.ts`**

In `src/commands/rpg/raid.ts`, find:
```typescript
// ── Unified boss handle (works for both World bosses and Field bosses) ─────────
interface RaidBossConfig {
```
Change to:
```typescript
// ── Unified boss handle (works for both World bosses and Field bosses) ─────────
export interface RaidBossConfig {
```

- [ ] **Step 2: Write the boss builder**

```typescript
// src/lib/alphaRaidBoss.ts
// Builds a RaidBossConfig from a playable character's real kit — Alpha
// Raid's boss is that character, boss-scaled, not a generic raid boss. Move
// effects are deliberately generic (not each character's actual bespoke
// kit result type — those differ per character and are hand-wired into all
// 6 combat loops individually, not safe to re-simulate generically here);
// only the NAME/element/flavor is real, the mechanical effect is a flat
// kit-tier debuff applied by raid.ts's boss counter-attack block when it
// sees the "ALPHA_SKILL_DEBUFF"/"ALPHA_ULT_DEBUFF" effect marker.
import path from "path";
import { CHARACTER_KITS } from "./characterKit";
import "./kits";
import { COUNTER_ELEMENT } from "./combat";
import { RaidBossConfig } from "../commands/rpg/raid";

export function buildAlphaRaidBoss(characterId: string): RaidBossConfig | null {
  const kit = CHARACTER_KITS[characterId];
  if (!kit) return null;

  return {
    id:      `alpha_${characterId}`,
    name:    kit.label,
    title:   `${kit.label}, Unleashed`,
    element: kit.element,
    weakness: COUNTER_ELEMENT[kit.element] ?? "NONE",
    artFile: "", // unused for Alpha Raid — launchRaid uses alphaRaidBossArtPath() instead
    baseHp: 0, baseAtk: 0, baseDef: 0, vibBar: 0, // unused — computeRaidBossStats() is purely party-derived, ignores these
    moves: [
      { name: `${kit.label}'s Basic Attack`, damage: 1.0, effect: "none" },
      { name: `${kit.label}'s Skill`,        damage: 1.3, effect: "ALPHA_SKILL_DEBUFF" },
      { name: `${kit.label}'s Ultimate`,     damage: 1.6, effect: "ALPHA_ULT_DEBUFF" },
    ],
    defeatLoot: {
      credits: 52_500, tuningModules: 42, sealingTubes: 33,
      forgingOres: 30, paradoxCores: 21, resonanceExp: 12_000,
    },
  };
}

/** Absolute path to the character's own portrait — used as the boss art since Alpha bosses have no dedicated art in Bosses/. */
export function alphaRaidBossArtPath(characterId: string): string | null {
  const kit = CHARACTER_KITS[characterId];
  if (!kit) return null;
  return path.join(process.cwd(), kit.portraitPath);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/commands/rpg/raid.ts src/lib/alphaRaidBoss.ts
git commit -m "feat(alpha-raid): boss builder — character kit to RaidBossConfig

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `raid.ts` — Alpha fight entrypoint + boss mechanics

**Files:**
- Modify: `src/commands/rpg/raid.ts`

This is the core reuse task: export a way to launch a raid fight from a DB-sourced participant list (instead of `/raid`'s own interactive recruiting), and add three Alpha-only mechanics to the shared boss counter-attack block, all gated behind an optional `alphaOptions` parameter so normal `/raid` behavior is completely unchanged when it's absent.

- [ ] **Step 1: Add the `AlphaRaidOptions` type and export `startAlphaRaidFight`**

Find `async function beginRaid(interaction: ChatInputCommandInteraction) {` in `raid.ts` and add this new block immediately **before** it:

```typescript
// ── Alpha Raid entrypoint ────────────────────────────────────────────────────
// Reuses launchRaid() directly rather than a second fight loop. The caller
// (interactionCreate.ts's alpharaid_begin_ handler) already has the DB
// participant list — this seeds a fresh in-memory ActiveRaid from it the
// same way addParticipant() already builds one from a live interaction.
export interface AlphaRaidOptions {
  statMultiplier: number;      // applied to every axis of computeRaidBossStats()'s output
  evasionChance: number;       // 0-1, boss dodges a player hit entirely
  bossArtPathOverride: string | null;
  bonusReward: { fractureKeys: number; radiantKeys: number; fractonite: number };
  onComplete: (won: boolean) => Promise<void>; // fired once, after the fight resolves
}

export async function startAlphaRaidFight(
  channel:      TextChannel,
  channelId:    string,
  guildId:      string,
  organizerId:  string,
  boss:         RaidBossConfig,
  participants: { userId: string; displayName: string }[],
  alphaOptions: AlphaRaidOptions,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (activeRaids.has(channelId)) {
    return { ok: false, reason: "A raid is already active in this channel — try again once it finishes." };
  }

  const raid: ActiveRaid = {
    bossChoice:  `alpha:${boss.id}`,
    bossHp: 1, bossHpMax: 1, bossAtk: 0, bossDef: 0, bossVib: 1, bossVibMax: 1, // placeholders — launchRaid rescales immediately
    isShattered: false, shatterLeft: 0,
    bossDefShredTurnsLeft: 0, bossDefShredPct: 0,
    bossWeakenTurnsLeft: 0, bossWeakenPct: 0,
    feyraBossWeakenTurnsLeft: 0, feyraBossWeakenPct: 0,
    phase: "RECRUITING", participants: [], currentIdx: 0, turn: 1,
    channelId, guildId, organizerId, isDevGuild: true,
  };
  activeRaids.set(channelId, raid);

  for (const p of participants) await addParticipant(raid, p.userId, p.displayName);

  if (raid.participants.length < MIN_PLAYERS) {
    activeRaids.delete(channelId);
    return { ok: false, reason: `Need at least ${MIN_PLAYERS} players who have run /start — some joiners may not have onboarded.` };
  }

  await launchRaid(channel, channelId, boss, null, alphaOptions);
  return { ok: true };
}

```

- [ ] **Step 2: Thread `alphaOptions` through `launchRaid`'s signature**

Find:
```typescript
async function launchRaid(
  channel:     TextChannel,
  channelId:   string,
  boss:        RaidBossConfig,
  recruitMsg:  any,
) {
```
Replace with:
```typescript
async function launchRaid(
  channel:      TextChannel,
  channelId:    string,
  boss:         RaidBossConfig,
  recruitMsg:   any,
  alphaOptions?: AlphaRaidOptions,
) {
```

- [ ] **Step 3: Apply the stat multiplier**

Find:
```typescript
  // ── Scale boss stats to this party ──────────────────────────────────────────
  const scaled     = computeRaidBossStats(boss, raid.participants);
  raid.bossHp      = scaled.hp;
  raid.bossHpMax   = scaled.hp;
  raid.bossAtk     = scaled.atk;
  raid.bossDef     = scaled.def;
  raid.bossVib     = scaled.vibBar;
  raid.bossVibMax  = scaled.vibBar;
```
Replace with:
```typescript
  // ── Scale boss stats to this party ──────────────────────────────────────────
  const scaled     = computeRaidBossStats(boss, raid.participants);
  const statMult   = alphaOptions?.statMultiplier ?? 1;
  raid.bossHp      = Math.floor(scaled.hp * statMult);
  raid.bossHpMax   = raid.bossHp;
  raid.bossAtk     = Math.floor(scaled.atk * statMult);
  raid.bossDef     = Math.floor(scaled.def * statMult);
  raid.bossVib     = Math.floor(scaled.vibBar * statMult);
  raid.bossVibMax  = raid.bossVib;
```

- [ ] **Step 4: Branch the thread name and art path**

Find:
```typescript
  // Create thread
  let thread;
  try {
    thread = await channel.threads.create({
      name: `☄️ Calamity Raid — ${boss.name}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
    });
```
Replace with:
```typescript
  // Create thread
  let thread;
  try {
    thread = await channel.threads.create({
      name: alphaOptions ? `⚡ Alpha Raid — ${boss.name}` : `☄️ Calamity Raid — ${boss.name}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
    });
```

Find:
```typescript
  // Raid intro card
  const bossArtPath = path.join(process.cwd(), "Bosses", boss.artFile);
```
Replace with:
```typescript
  // Raid intro card
  const bossArtPath = alphaOptions?.bossArtPathOverride ?? path.join(process.cwd(), "Bosses", boss.artFile);
```

- [ ] **Step 5: Award the flat Alpha bonus reward and fire `onComplete`**

Find (inside `finishRaid`, the `if (won)` branch):
```typescript
      await Promise.all(raid.participants.map(p => awardUser(p.userId, perPlayer, "raid")));
```
Replace with:
```typescript
      await Promise.all(raid.participants.map(p => awardUser(p.userId, perPlayer, "raid")));
      if (alphaOptions) {
        await Promise.all(raid.participants.map(p => awardUser(p.userId, alphaOptions.bonusReward, "raid")));
      }
```

Find the very end of `finishRaid` (right before the closing brace that ends the `finishRaid` arrow function):
```typescript
    await thread.setArchived(true).catch(() => {});
    setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
  };
```
Replace with:
```typescript
    await thread.setArchived(true).catch(() => {});
    setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);

    if (alphaOptions) await alphaOptions.onComplete(won).catch((err: any) => console.error("[AlphaRaid] onComplete error:", err));
  };
```

- [ ] **Step 6: Evasion — boss dodges a player hit**

Find:
```typescript
      current.dmgDealt += damage;
      raid.bossHp       = Math.max(0, raid.bossHp - damage);
```
Replace with:
```typescript
      if (alphaOptions && Math.random() < alphaOptions.evasionChance) {
        damage = 0;
        moveLine += `\n◇ **${boss.name}** evades the strike!`;
      }

      current.dmgDealt += damage;
      raid.bossHp       = Math.max(0, raid.bossHp - damage);
```

- [ ] **Step 7: Enrage + kit-flavored debuffs on the boss counter-attack**

Find:
```typescript
      } else {
        const move    = boss.moves[Math.floor(Math.random() * boss.moves.length)];
        const bossWeakenActive = raid.bossWeakenTurnsLeft > 0;
        const feyraBossWeakenActive = raid.feyraBossWeakenTurnsLeft > 0;
        const aoeBase = Math.floor(raid.bossAtk * move.damage * 0.6 * (bossWeakenActive ? (1 - raid.bossWeakenPct) : 1) * (feyraBossWeakenActive ? (1 - raid.feyraBossWeakenPct) : 1)); // AoE = 60% of single-target
        const alive   = raid.participants.filter(p => !p.isDefeated);
```
Replace with:
```typescript
      } else {
        const enraged = !!alphaOptions && raid.bossHp / raid.bossHpMax <= 0.4;
        const move    = enraged ? boss.moves[boss.moves.length - 1]! : boss.moves[Math.floor(Math.random() * boss.moves.length)]!;
        const enrageAtkMult = enraged ? 1.6 : 1;
        const bossWeakenActive = raid.bossWeakenTurnsLeft > 0;
        const feyraBossWeakenActive = raid.feyraBossWeakenTurnsLeft > 0;
        const aoeBase = Math.floor(raid.bossAtk * move.damage * 0.6 * enrageAtkMult * (bossWeakenActive ? (1 - raid.bossWeakenPct) : 1) * (feyraBossWeakenActive ? (1 - raid.feyraBossWeakenPct) : 1)); // AoE = 60% of single-target
        const alive   = raid.participants.filter(p => !p.isDefeated);
        if (enraged && alphaOptions) moveLine += `\n🔥 **${boss.name}** enrages, striking with everything it has!`;
```

Now find the top of the `for (const p of alive) {` loop body in that same block:
```typescript
        for (const p of alive) {
          // Milestone 3.5b: while this participant's Solace is defending,
          // damage reduction uses HER OWN DEF, not the player's own.
          const pDefendingWithAlly = raid.isDevGuild && p.activeUnit === "ally" && p.allySolaceStats !== null;
```
Replace with:
```typescript
        for (const p of alive) {
          if (alphaOptions && move.effect === "ALPHA_SKILL_DEBUFF") {
            p.playerDebuffs = applyDebuff(p.playerDebuffs, "VULNERABLE", 0.15, 2);
          } else if (alphaOptions && move.effect === "ALPHA_ULT_DEBUFF") {
            p.playerDebuffs = applyDebuff(p.playerDebuffs, "WEAKENED", 0.25, 2);
          }

          // Milestone 3.5b: while this participant's Solace is defending,
          // damage reduction uses HER OWN DEF, not the player's own.
          const pDefendingWithAlly = raid.isDevGuild && p.activeUnit === "ally" && p.allySolaceStats !== null;
```

`applyDebuff` is already imported in `raid.ts` (`import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult, cleanseDebuffs } from "../../lib/debuffs";` at the top of the file) — no import changes needed. `VULNERABLE` reduces the player's own effective DEF via `getVulnerableMult` elsewhere in the codebase's convention; for this task only `WEAKENED` (already read by `getWeakenedMult` inside `raid.ts`'s own damage calc) needs to visibly matter — `VULNERABLE` is applied for flavor/future use but not yet read anywhere in `raid.ts`'s player-damage-taken path. That's fine: it's inert until a later pass reads it, matches this plan's "generic, not a full simulation" scope, and causes no bug (an unread debuff in the array is harmless).

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: no output. If `Cannot find name 'AlphaRaidOptions'` appears anywhere outside `raid.ts`, that's expected until Task 6 imports it — this step should be clean within `raid.ts` itself.

- [ ] **Step 9: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "feat(alpha-raid): fight entrypoint + evasion/enrage/debuff boss mechanics

Reuses launchRaid() directly via an optional alphaOptions parameter —
normal /raid behavior is unchanged when it's absent. Adds:
- startAlphaRaidFight(): seeds an ActiveRaid from a DB participant list
  and hands off to launchRaid(), mirroring addParticipant()'s existing
  per-user resolution.
- Evasion: boss dodges a player hit entirely at alphaOptions.evasionChance.
- Enrage at <=40% HP: forces the Ultimate-tier move, 1.6x ATK.
- Kit-flavored debuffs: Skill/Ultimate-tier moves apply a generic
  VULNERABLE/WEAKENED debuff via the existing debuffs.ts system.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `/owner-alpharaid start` — character + reward options

**Files:**
- Modify: `src/commands/utility/owner-alpharaid.ts`

- [ ] **Step 1: Add the command options**

Find:
```typescript
export const data = new SlashCommandBuilder()
  .setName("owner-alpharaid")
  .setDescription("Owner only — trigger a global Alpha Raid event across every server.")
  .addSubcommand(s => s.setName("start")
    .setDescription("Fire the event now.")
    .addStringOption(o => o.setName("test-guild-id")
      .setDescription("Testing only — restrict to a single server ID instead of firing globally.")
      .setRequired(false))) as SlashCommandBuilder;
```
Replace with:
```typescript
export const data = new SlashCommandBuilder()
  .setName("owner-alpharaid")
  .setDescription("Owner only — trigger a global Alpha Raid event across every server.")
  .addSubcommand(s => s.setName("start")
    .setDescription("Fire the event now.")
    .addStringOption(o => o.setName("character")
      .setDescription("Which character's kit the boss uses.")
      .setRequired(true)
      .setAutocomplete(true))
    .addIntegerOption(o => o.setName("fracture-keys")
      .setDescription("Override the default Fracture Key reward per participant (default 10).")
      .setRequired(false).setMinValue(0))
    .addIntegerOption(o => o.setName("radiant-keys")
      .setDescription("Override the default Radiant Key reward per participant (default 10).")
      .setRequired(false).setMinValue(0))
    .addIntegerOption(o => o.setName("fractonite")
      .setDescription("Override the default Fractonite reward per participant (default 1500).")
      .setRequired(false).setMinValue(0))
    .addStringOption(o => o.setName("test-guild-id")
      .setDescription("Testing only — restrict to a single server ID instead of firing globally.")
      .setRequired(false))) as SlashCommandBuilder;
```

- [ ] **Step 2: Add the autocomplete export**

Add near the top imports:
```typescript
import { AutocompleteInteraction } from "discord.js";
import { CHARACTER_KITS } from "../../lib/characterKit";
import "../../lib/kits";
```

Add after the `data` builder, before `buildRecruitEmbed`'s old location (now removed by Task 2) / before `export const command`:
```typescript
export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = Object.values(CHARACTER_KITS)
    .filter(kit => kit.label.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(kit => ({ name: kit.label, value: kit.id }));
  await interaction.respond(choices).catch(() => {});
}
```

- [ ] **Step 3: Read the new options and store them on the event**

Find:
```typescript
    const testGuildId = interaction.options.getString("test-guild-id");
```
Replace with:
```typescript
    const characterId = interaction.options.getString("character", true);
    const testGuildId = interaction.options.getString("test-guild-id");

    if (!CHARACTER_KITS[characterId]) {
      await interaction.editReply({ content: `⚡ Unknown character id \`${characterId}\` — pick one from the autocomplete list.` });
      return;
    }
```

Find:
```typescript
    const event = await prisma.alphaRaidEvent.create({
      data: { triggeredBy: interaction.user.id, triggeredAt },
    });
```
Replace with:
```typescript
    const event = await prisma.alphaRaidEvent.create({
      data: {
        triggeredBy: interaction.user.id, triggeredAt,
        bossCharacterId: characterId,
        fractureKeysReward: interaction.options.getInteger("fracture-keys") ?? 10,
        radiantKeysReward:  interaction.options.getInteger("radiant-keys")  ?? 10,
        fractoniteReward:   interaction.options.getInteger("fractonite")    ?? 1500,
      },
    });
```

- [ ] **Step 4: Show the chosen boss in the confirmation reply**

Find:
```typescript
    await interaction.editReply({
      content: `⚡ Alpha Raid triggered${testGuildId ? " (test mode — single server)" : ""} — posted in **${posted}** server(s), skipped **${skipped}** (no postable channel found).`,
    });
```
Replace with:
```typescript
    await interaction.editReply({
      content: `⚡ Alpha Raid triggered (boss: **${CHARACTER_KITS[characterId]!.label}**)${testGuildId ? " (test mode — single server)" : ""} — posted in **${posted}** server(s), skipped **${skipped}** (no spawn channel configured).`,
    });
```

- [ ] **Step 5: Wire the autocomplete into the command loader**

Check `src/index.ts`'s `loadCommands()` — confirm it already reads `mod.autocomplete` (or `command.autocomplete`) the same way it reads `mod.default ?? mod`. If it only checks `command.data`/`command.execute` and doesn't attach `autocomplete`, add this line right after `command.execute` is confirmed valid inside `loadCommands()`:
```typescript
if (command && mod.autocomplete && !command.autocomplete) command.autocomplete = mod.autocomplete;
```
(Read `src/index.ts`'s `loadCommands()` first — most commands in this codebase already export `autocomplete` as a named export the same way `execute`/`data` are read via `mod.default ?? mod`, e.g. `character.ts`'s pattern. If `mod.default ?? mod` already picks up a named `autocomplete` export automatically — likely, since `command` there is `mod.default ?? mod` and `autocomplete` is a property on `mod` itself when there's no `default` export, or accessible via spread — verify with a quick grep for `\.autocomplete` in `src/index.ts` and another already-working autocomplete command (e.g. `echo.ts`) before assuming a change is needed. Only edit `index.ts` if the grep shows autocomplete truly isn't wired generically.)

- [ ] **Step 6: Redeploy the guild-scoped command (new options)**

Run: `npx tsc --noEmit` (expect clean), then:
```bash
npm run deploy
```
Expected: `✓ Queued: /owner-alpharaid` and a guild-command deploy confirmation.

- [ ] **Step 7: Commit**

```bash
git add src/commands/utility/owner-alpharaid.ts
git commit -m "feat(alpha-raid): character + reward-override options on /owner-alpharaid start

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `alpharaid_begin_` — durable Begin button handler

**Files:**
- Modify: `src/events/interactionCreate.ts`

- [ ] **Step 1: Add the imports**

Add near the top of `src/events/interactionCreate.ts`:
```typescript
import { PermissionFlagsBits } from "discord.js";
import { isOwner } from "../lib/owner";
import { startAlphaRaidFight } from "../commands/rpg/raid";
import { buildAlphaRaidBoss, alphaRaidBossArtPath } from "../lib/alphaRaidBoss";
```

- [ ] **Step 2: Add the handler**

Find the end of the `alpharaid_join_` handler block added in Phase 1 (ends with `return;\n    }` right before `// All other buttons...`) and add this new block right after it, still before the fallback comment:

```typescript
    if (customId.startsWith("alpharaid_begin_")) {
      const instanceId = customId.replace("alpharaid_begin_", "");
      const canManage = (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false) || isOwner(interaction.user.id);
      if (!canManage) {
        await interaction.reply({ content: "You need **Manage Server** to begin this fight.", flags: 64 });
        return;
      }

      const instance = await prisma.alphaRaidInstance.findUnique({
        where: { id: instanceId },
        include: { participants: true, event: true },
      });
      if (!instance || instance.phase !== "RECRUITING") {
        await interaction.reply({ content: "This Alpha Raid isn't open to begin anymore.", flags: 64 });
        return;
      }
      if (instance.participants.length < 2) {
        await interaction.reply({ content: "Need at least 2 joined players to begin.", flags: 64 });
        return;
      }

      const boss = buildAlphaRaidBoss(instance.event.bossCharacterId);
      if (!boss) {
        await interaction.reply({ content: "That character's kit is no longer available — contact the bot owner.", flags: 64 });
        return;
      }

      await interaction.deferUpdate();

      const guild = interaction.guild;
      const channel = guild ? await guild.channels.fetch(instance.channelId).catch(() => null) : null;
      if (!channel || !channel.isTextBased()) {
        await interaction.followUp({ content: "Couldn't reach the announcement channel — it may have been deleted.", flags: 64 }).catch(() => {});
        return;
      }

      const members = guild
        ? await guild.members.fetch({ user: instance.participants.map(p => p.userId) }).catch(() => null)
        : null;
      const displayNameOf = (userId: string) => members?.get(userId)?.displayName ?? userId;

      const result = await startAlphaRaidFight(
        channel as TextChannel, instance.channelId, instance.guildId, interaction.user.id,
        boss,
        instance.participants.map(p => ({ userId: p.userId, displayName: displayNameOf(p.userId) })),
        {
          statMultiplier: 1.5,
          evasionChance: 0.18,
          bossArtPathOverride: alphaRaidBossArtPath(instance.event.bossCharacterId),
          bonusReward: {
            fractureKeys: instance.event.fractureKeysReward,
            radiantKeys:  instance.event.radiantKeysReward,
            fractonite:   instance.event.fractoniteReward,
          },
          onComplete: async (won: boolean) => {
            await prisma.alphaRaidInstance.update({
              where: { id: instanceId },
              data: { phase: won ? "COMPLETE" : "EXPIRED" },
            }).catch(() => {});
          },
        },
      );

      if (!result.ok) {
        await interaction.followUp({ content: result.reason, flags: 64 }).catch(() => {});
        return;
      }

      await prisma.alphaRaidInstance.update({ where: { id: instanceId }, data: { phase: "FIGHTING" } }).catch(() => {});
      return;
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output. If `TextChannel` isn't already imported in `interactionCreate.ts`, add it to the existing `discord.js` import line at the top rather than a new import statement (check first — it likely already is, per the Phase 1 note that `EmbedBuilder`/`ActionRowBuilder`/`ButtonBuilder`/`ButtonStyle`/`TextChannel` are already imported there).

- [ ] **Step 4: Commit**

```bash
git add src/events/interactionCreate.ts
git commit -m "feat(alpha-raid): durable Begin button — hands off to startAlphaRaidFight

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Build, deploy, live test

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
```
Then SSH deploy (schema changed, so include `npx prisma generate`):
```bash
ssh -i "D:/Projects/Bot/ssh-key-2026-06-05.key" -o StrictHostKeyChecking=no ubuntu@140.245.202.30 "bash -lc 'export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd ~/bot && git pull && npx prisma generate && npm run build && pm2 restart cartethyia'"
```

- [ ] **Step 3: Live test in the dev server**

Run `/owner-alpharaid start character:<any owned-and-built character> test-guild-id:1495681992082194432` (using the test-guild-id restriction from Phase 1 so this doesn't fan out globally). Confirm:
- The announcement posts with both **Join** and **Begin Fight** buttons.
- At least 2 accounts click Join; the embed's player count updates live.
- Clicking **Begin Fight** with fewer than 2 joined players is rejected.
- Clicking **Begin Fight** as a non-admin, non-owner account is rejected.
- Clicking **Begin Fight** as an admin/owner with 2+ joined starts a real fight thread named "⚡ Alpha Raid — `<character label>`", using that character's real Basic/Skill/Ultimate names in the boss's move log.
- Winning the fight pays out normal raid loot **plus** the configured Fracture Keys/Radiant Keys/Fractonite bundle, and the `AlphaRaidInstance.phase` moves to `COMPLETE`.
- A full party wipe moves the instance to `EXPIRED` instead.
- Restart the bot (`pm2 restart cartethyia`) mid-recruiting (before clicking Begin) and confirm Begin still works afterward — same durable-button reasoning already proven for Join in Phase 1.

---

## Out of scope for this plan

Per-character bespoke boss AI (genuinely simulating each character's own resource mechanic — Tempo stacks, Forte gauges, etc. — as an NPC), a `VULNERABLE`-reading damage-taken path in `raid.ts` (applied but currently inert — a future pass can wire `getVulnerableMult` into the player-damage-taken calc the same way `getWeakenedMult` already is), and a persistent reward-config menu (Phase 2 spec explicitly chose per-trigger override over a saved config).
