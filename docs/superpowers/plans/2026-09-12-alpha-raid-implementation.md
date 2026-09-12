# Alpha Raid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the global-trigger + per-server-recruiting + 72h-auto-expire half of Alpha Raid — the part that's genuinely new infrastructure (DB-backed, restart-safe, cross-guild fan-out). The actual Begin → turn-based-fight → reward handoff into `/raid`'s existing combat engine is explicitly **out of scope for this plan** (see "Deferred scope" at the end) — `/raid`'s fight engine is 2000+ lines and deserves its own focused extraction pass, not a rushed bolt-on here.

**Architecture:** New Prisma models (`AlphaRaidEvent`/`AlphaRaidInstance`/`AlphaRaidParticipant`) track per-guild recruiting state durably. A new owner-only command fans out to every guild on trigger. The Join button is routed through the global `interactionCreate.ts` handler (keyed by instance id in the customId) rather than a message-scoped collector — the exact fix already applied to `/tournament`'s Join button this session, after it was found to silently break on every bot restart. A new sweep (`alphaRaidSweep.ts`, mirroring `tournamentSweep.ts`) expires any instance past its 72h deadline that never got a fight started.

**Tech Stack:** Prisma v7 (`@prisma/adapter-pg`), discord.js v14, existing `isOwner()`/`GuildSettings` patterns.

---

### Task 1: Schema — AlphaRaidEvent/Instance/Participant models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the three models**

Add this block anywhere in `prisma/schema.prisma` (near the `Tournament` models is a sensible spot for discoverability):

```prisma
model AlphaRaidEvent {
  id          String   @id @default(cuid())
  triggeredBy String   // owner's Discord userId
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
  phase        String   @default("RECRUITING") // "RECRUITING" | "EXPIRED" — FIGHTING/COMPLETE added when the fight-engine handoff ships
  deadlineAt   DateTime // triggeredAt + 72h — kill window, not signup window
  participants AlphaRaidParticipant[]

  @@index([phase, deadlineAt])
}

model AlphaRaidParticipant {
  id         String   @id @default(cuid())
  instanceId String
  instance   AlphaRaidInstance @relation(fields: [instanceId], references: [id])
  userId     String

  @@unique([instanceId, userId])
}
```

- [ ] **Step 2: Push the schema and regenerate the client**

Run:
```bash
npm run db:push
npx prisma generate
```
Expected: `Your database is now in sync with your Prisma schema.` then `✔ Generated Prisma Client`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(alpha-raid): schema — AlphaRaidEvent/Instance/Participant

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Channel resolution helper

**Files:**
- Create: `src/lib/alphaRaidChannel.ts`

- [ ] **Step 1: Write the helper**

```typescript
// src/lib/alphaRaidChannel.ts
// Resolves which channel to post an Alpha Raid announcement in for a given
// guild. No dedicated /setup option — falls back through what already
// exists rather than requiring every server to configure something new
// before the feature works there.
import { Guild, TextChannel } from "discord.js";
import prisma from "./prisma";

export async function resolveAlphaRaidChannel(guild: Guild): Promise<TextChannel | null> {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
  const configured = settings?.botChannelIds ?? [];

  for (const id of configured) {
    const ch = guild.channels.cache.get(id);
    if (ch?.isTextBased() && ch.permissionsFor(guild.members.me!)?.has("SendMessages")) {
      return ch as TextChannel;
    }
  }

  const system = guild.systemChannel;
  if (system?.isTextBased() && system.permissionsFor(guild.members.me!)?.has("SendMessages")) {
    return system as TextChannel;
  }

  const fallback = guild.channels.cache.find(
    ch => ch.isTextBased() && ch.permissionsFor(guild.members.me!)?.has("SendMessages"),
  );
  return (fallback as TextChannel) ?? null;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/alphaRaidChannel.ts
git commit -m "feat(alpha-raid): per-guild announcement channel resolution

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `/owner-alpharaid start` — global trigger command

**Files:**
- Create: `src/commands/utility/owner-alpharaid.ts`

- [ ] **Step 1: Write the command**

```typescript
// src/commands/utility/owner-alpharaid.ts
// Owner-only, global trigger. Fans out a recruiting announcement + Join
// button to every guild the bot is in. Each guild gets its own
// AlphaRaidInstance with a 72h kill-window deadline (see design spec
// docs/superpowers/specs/2026-09-12-alpha-raid-design.md).
import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import prisma from "../../lib/prisma";
import { resolveAlphaRaidChannel } from "../../lib/alphaRaidChannel";

const KILL_WINDOW_HOURS = 72;

export const data = new SlashCommandBuilder()
  .setName("owner-alpharaid")
  .setDescription("Owner only — trigger a global Alpha Raid event across every server.")
  .addSubcommand(s => s.setName("start").setDescription("Fire the event now.")) as SlashCommandBuilder;

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

export const command: Command = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "Owner only.", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });

    const triggeredAt = new Date();
    const deadlineAt = new Date(triggeredAt.getTime() + KILL_WINDOW_HOURS * 60 * 60 * 1000);

    const event = await prisma.alphaRaidEvent.create({
      data: { triggeredBy: interaction.user.id, triggeredAt },
    });

    let posted = 0, skipped = 0;
    for (const guild of interaction.client.guilds.cache.values()) {
      const channel = await resolveAlphaRaidChannel(guild).catch(() => null);
      if (!channel) { skipped++; continue; }

      const instance = await prisma.alphaRaidInstance.create({
        data: { eventId: event.id, guildId: guild.id, channelId: channel.id, deadlineAt },
      });

      const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`alpharaid_join_${instance.id}`).setLabel("⚔️  Join Alpha Raid").setStyle(ButtonStyle.Danger),
      );

      const msg = await channel.send({ embeds: [buildRecruitEmbed(0, deadlineAt)], components: [joinRow] }).catch(() => null);
      if (!msg) { skipped++; continue; }

      await prisma.alphaRaidInstance.update({ where: { id: instance.id }, data: { messageId: msg.id } });
      posted++;
    }

    await interaction.editReply({
      content: `⚡ Alpha Raid triggered — posted in **${posted}** server(s), skipped **${skipped}** (no postable channel found).`,
    });
  },
};

export default command;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Deploy the new slash command definition**

Run: `npm run deploy`
Expected: confirms the new `/owner-alpharaid` command registered.

- [ ] **Step 4: Commit**

```bash
git add src/commands/utility/owner-alpharaid.ts
git commit -m "feat(alpha-raid): /owner-alpharaid start — global trigger command

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Durable Join button — global interactionCreate handler

**Files:**
- Modify: `src/events/interactionCreate.ts`

- [ ] **Step 1: Add the handler**

Add this branch in the button-handling section of `src/events/interactionCreate.ts`, alongside the existing `tournament_join_` handler (same file, same pattern — find the block that starts `if (customId === "tournament_join" || customId.startsWith("tournament_join_")) {` and add this as a sibling `if` block right after it, before the final `return;` fallback):

```typescript
    if (customId.startsWith("alpharaid_join_")) {
      const instanceId = customId.replace("alpharaid_join_", "");
      const instance = await prisma.alphaRaidInstance.findUnique({ where: { id: instanceId } });
      if (!instance || instance.phase !== "RECRUITING") {
        await interaction.reply({ content: "This Alpha Raid isn't open for joining anymore.", flags: 64 });
        return;
      }
      const already = await prisma.alphaRaidParticipant.findUnique({
        where: { instanceId_userId: { instanceId, userId: interaction.user.id } },
      });
      if (already) {
        await interaction.reply({ content: "You're already in.", flags: 64 });
        return;
      }
      await prisma.alphaRaidParticipant.create({
        data: { instanceId, userId: interaction.user.id },
      }).catch(() => null); // unique-constraint race: a double-click loses the race harmlessly

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

`EmbedBuilder`, `ActionRowBuilder`, `ButtonBuilder`, and `prisma` are already imported at the top of `interactionCreate.ts` (confirmed: line 1 and line 8) — no import changes needed for this task.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output. If `Cannot find name 'EmbedBuilder'` (or similar) appears, add the missing name(s) to the existing `discord.js` import line at the top of the file rather than adding a new import statement.

- [ ] **Step 3: Commit**

```bash
git add src/events/interactionCreate.ts
git commit -m "feat(alpha-raid): durable Join button via global interactionCreate handler

Same restart-safety fix already applied to /tournament's Join button
this session — a message-scoped collector dies on every bot restart,
so this routes through the global handler keyed by instance id instead.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 72h expiry sweep

**Files:**
- Create: `src/lib/alphaRaidSweep.ts`
- Modify: `src/events/ready.ts`

- [ ] **Step 1: Write the sweep**

```typescript
// src/lib/alphaRaidSweep.ts
// Expires any AlphaRaidInstance still RECRUITING past its 72h deadline —
// same shape as tournamentSweep.ts. Deliberately a DB-driven interval, not
// a per-instance setTimeout — those don't survive a bot restart.
import { Client, EmbedBuilder, TextChannel } from "discord.js";
import prisma from "./prisma";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export function startAlphaRaidSweep(client: Client): void {
  setInterval(() => runSweep(client).catch(err => console.error("[AlphaRaid] sweep error:", err)), SWEEP_INTERVAL_MS);
}

async function runSweep(client: Client): Promise<void> {
  const expired = await prisma.alphaRaidInstance.findMany({
    where: { phase: "RECRUITING", deadlineAt: { lte: new Date() } },
  });

  for (const instance of expired) {
    await prisma.alphaRaidInstance.update({ where: { id: instance.id }, data: { phase: "EXPIRED" } });

    const ch = await client.channels.fetch(instance.channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) continue;

    await (ch as TextChannel).send({
      embeds: [new EmbedBuilder()
        .setColor(0x4A4A5A)
        .setDescription("◈ The Alpha Raid's kill window has closed here. No reward this time — watch for the next one.")],
    }).catch(() => {});
  }
}
```

- [ ] **Step 2: Start it alongside the tournament sweep**

In `src/events/ready.ts`, add the import next to the existing `startTournamentSweep` import:

```typescript
import { startAlphaRaidSweep } from "../lib/alphaRaidSweep";
```

And call it right after the existing `startTournamentSweep(client);` line:

```typescript
  startAlphaRaidSweep(client);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/alphaRaidSweep.ts src/events/ready.ts
git commit -m "feat(alpha-raid): 72h kill-window expiry sweep

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Build, deploy, live test

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
```
Then SSH deploy (schema changed, so include `npx prisma generate`; a new command was added, so include the deploy step from Task 3 if not already run):
```bash
ssh -i "D:/Projects/Bot/ssh-key-2026-06-05.key" ubuntu@140.245.202.30 "bash -lc 'export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd ~/bot && git pull && npx prisma generate && npm run build && pm2 restart cartethyia'"
```

- [ ] **Step 3: Live test**

Run `/owner-alpharaid start` in a test/dev context. Confirm:
- The reply reports how many servers got a post.
- The announcement posts in each server with a working Join button.
- Clicking Join updates the embed's player count live.
- Clicking Join twice from the same user is rejected gracefully.
- Restart the bot (`pm2 restart cartethyia`) mid-recruiting and confirm the Join button still works afterward (the whole point of the durable-button fix).

---

## Deferred scope (explicitly not in this plan)

The Begin → turn-based-fight → reward handoff into `/raid`'s existing engine, plus the 1.5× boss-stat scaling and the flat Fracture Key/Radiant Key reward payout, are **not built by this plan**. `/raid.ts` is 2000+ lines with its own in-memory `ActiveRaid` state, turn engine, and per-character combat branches (just extensively touched this session for Rhoven/Bren/Feyra) — safely reusing its Begin/fight logic for a second entry point deserves its own dedicated plan, not a rushed extension here. This plan ships a fully working, testable "global trigger → per-server recruiting → durable Join → 72h auto-expire" system on its own; the fight-engine handoff is the natural next plan once this lands.
