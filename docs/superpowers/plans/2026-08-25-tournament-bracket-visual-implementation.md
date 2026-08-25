# Tournament Bracket Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live-updating, auto-pinned bracket tree image for `/tournament` — posted when round 1 generates, edited in place every time a match resolves or a round advances, unpinned when the tournament ends.

**Architecture:** A new pure canvas renderer (`tournamentBracketCard.ts`) takes fully-resolved round data (names/elements/winner flags already looked up) and draws a horizontal bracket tree using standard recursive vertical-centering layout math. A new `updateBracketMessage()` in `tournamentSweep.ts` does the DB/Discord lookups (batch member fetch for display names, batch user fetch for element colors) and posts/edits/pins the one message tracked by a new `Tournament.bracketMessageId` column. Called from every place tournament state already changes.

**Tech Stack:** TypeScript, `@napi-rs/canvas`, Prisma, discord.js. No test framework — verification via `npx tsc --noEmit`, `npm run build`, and live manual testing (small alt-account tournament with `signup_minutes`).

**Reference:** [docs/superpowers/specs/2026-08-25-tournament-bracket-visual-design.md](../specs/2026-08-25-tournament-bracket-visual-design.md)

---

### Task 1: Schema — `bracketMessageId`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the column**

In `model Tournament`, add after `currentRound`:
```prisma
  bracketMessageId String?  // the one message we keep editing with the bracket image, once posted
```

- [ ] **Step 2: Push + generate**

Run: `npm run db:push`
Expected: "Your database is now in sync with your Prisma schema."

Run: `npx prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add prisma/schema.prisma
git commit -m "feat(tournament): add bracketMessageId for the live bracket image"
```

---

### Task 2: `tournamentBracketCard.ts` — pure renderer

**Files:**
- Create: `src/lib/tournamentBracketCard.ts`

- [ ] **Step 1: Write the renderer**

```ts
// src/lib/tournamentBracketCard.ts
// Pure canvas renderer for the tournament bracket tree — takes already-
// resolved display data (names/elements/winner flags), no DB/Discord calls
// in here. Caller (tournamentSweep.ts) owns all lookups.
import { createCanvas, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import path from "path";

try {
  try { (GlobalFonts as any).loadSystemFonts(); } catch {}
  GlobalFonts.registerFromPath(path.join(process.cwd(), "assets", "fonts", "Rajdhani-Bold.ttf"), "Rajdhani");
} catch { /* fallback */ }

// Same fallback stack as canvas.ts — a bracket has to render whatever
// nickname a player picked (CJK, full-width, stylized Unicode, emoji),
// not just Latin text.
const FONT_FALLBACK = `'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans JP', 'Arial Unicode MS', Arial, sans-serif`;

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#38BDF8", ELECTRO: "#A855F7",
  AERO: "#10B981", HAVOC: "#EC4899", SPECTRO: "#EAB308", NONE: "#8B7FF5",
};

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function rrect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function fitText(ctx: SKRSContext2D, text: string, basePx: number, maxWidth: number, bold = true): string {
  let px = basePx;
  const weight = bold ? "bold " : "";
  while (px > 9) {
    ctx.font = `${weight}${px}px Rajdhani, ${FONT_FALLBACK}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 1;
  }
  return ctx.font;
}

export interface BracketSlot {
  name:    string | null; // null = bye slot with no name (shouldn't happen — byes always have a name) or TBD (round not reached yet)
  element: string | null;
  isWinner: boolean;      // dim if false AND the match is resolved; full color if true or match unresolved
}
export interface BracketMatch {
  a: BracketSlot;
  b: BracketSlot | null;  // null = this is a bye, `a` auto-advances
  resolved: boolean;
}
export interface BracketRound {
  matches: BracketMatch[];
}

const BOX_W = 220, BOX_H = 56, BOX_GAP = 18, COL_GAP = 70;
const MARGIN = 30;

export async function generateTournamentBracketCard(
  rounds: BracketRound[],
  champion: { name: string; element: string } | null,
): Promise<Buffer> {
  const round1Count = rounds[0]?.matches.length ?? 1;
  const numRounds = rounds.length;

  const colW = BOX_W + COL_GAP;
  const totalW = MARGIN * 2 + numRounds * colW + (champion ? BOX_W : 0);
  const totalH = MARGIN * 2 + round1Count * (BOX_H + BOX_GAP);

  const canvas = createCanvas(Math.max(totalW, 600), Math.max(totalH, 300));
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#08070E";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bloom = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, canvas.width * 0.6);
  bloom.addColorStop(0, "rgba(99,102,241,0.10)"); bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Compute each box's Y center per round: round 1 evenly spaced, every
  // later round's box Y is the average of its two feeder boxes' Y (standard
  // bracket vertical-centering recursion).
  const centersByRound: number[][] = [];
  centersByRound[0] = rounds[0].matches.map((_, i) => MARGIN + i * (BOX_H + BOX_GAP) + BOX_H / 2);
  for (let r = 1; r < numRounds; r++) {
    const prev = centersByRound[r - 1];
    centersByRound[r] = rounds[r].matches.map((_, i) => (prev[2 * i] + prev[2 * i + 1]) / 2);
  }

  function drawSlot(x: number, y: number, w: number, h: number, slot: BracketSlot, resolved: boolean) {
    const dim = resolved && !slot.isWinner;
    const color = slot.element ? (ELEMENT_HEX[slot.element] ?? ELEMENT_HEX.NONE) : "#6B7280";
    ctx.fillStyle = dim ? "rgba(255,255,255,0.04)" : rgba(color, 0.12);
    rrect(ctx, x, y, w, h, 6); ctx.fill();
    ctx.strokeStyle = dim ? "rgba(255,255,255,0.08)" : rgba(color, 0.55);
    ctx.lineWidth = 1.2; rrect(ctx, x, y, w, h, 6); ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = dim ? "rgba(255,255,255,0.35)" : "#FFFFFF";
    const label = slot.name ?? "TBD";
    ctx.font = fitText(ctx, label, 15, w - 20, !dim);
    ctx.fillText(label.length > 22 ? label.slice(0, 21) + "…" : label, x + 10, y + h / 2 + 5);
  }

  for (let r = 0; r < numRounds; r++) {
    const x = MARGIN + r * colW;
    const round = rounds[r];
    for (let i = 0; i < round.matches.length; i++) {
      const m = round.matches[i];
      const cy = centersByRound[r][i];
      if (m.b === null) {
        // Bye — single centered slot
        drawSlot(x, cy - BOX_H / 2, BOX_W, BOX_H, m.a, true);
      } else {
        const halfGap = 4;
        drawSlot(x, cy - BOX_H - halfGap, BOX_W, BOX_H, m.a, m.resolved);
        drawSlot(x, cy + halfGap, BOX_W, BOX_H, m.b, m.resolved);
      }
    }
  }

  // Connector lines: for round r, match i feeds round r+1, match floor(i/2).
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5;
  for (let r = 0; r < numRounds - 1; r++) {
    const x = MARGIN + r * colW + BOX_W;
    const nextX = MARGIN + (r + 1) * colW;
    for (let i = 0; i < rounds[r].matches.length; i++) {
      const cy = centersByRound[r][i];
      const nextI = Math.floor(i / 2);
      const nextCy = centersByRound[r + 1] ? centersByRound[r + 1][nextI] : cy;
      ctx.beginPath();
      ctx.moveTo(x, cy); ctx.lineTo(x + COL_GAP / 2, cy);
      ctx.lineTo(x + COL_GAP / 2, nextCy); ctx.lineTo(nextX, nextCy);
      ctx.stroke();
    }
  }

  // Champion box
  if (champion) {
    const x = MARGIN + numRounds * colW;
    const cy = centersByRound[numRounds - 1][0];
    const color = ELEMENT_HEX[champion.element] ?? ELEMENT_HEX.NONE;
    ctx.fillStyle = rgba(color, 0.22); rrect(ctx, x, cy - BOX_H / 2, BOX_W, BOX_H, 8); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; rrect(ctx, x, cy - BOX_H / 2, BOX_W, BOX_H, 8); ctx.stroke();
    ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "left";
    ctx.font = fitText(ctx, `🏆 ${champion.name}`, 16, BOX_W - 20, true);
    ctx.fillText(`🏆 ${champion.name}`.length > 22 ? champion.name.slice(0, 18) + "…" : `🏆 ${champion.name}`, x + 10, cy + 5);
  }

  ctx.textAlign = "left";
  return canvas.toBuffer("image/webp");
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tournamentBracketCard.ts
git commit -m "feat(tournament): bracket tree canvas renderer"
```

---

### Task 3: Wire it into `tournamentSweep.ts`

**Files:**
- Modify: `src/lib/tournamentSweep.ts`

- [ ] **Step 1: Add the data-resolution + post/edit/pin function**

Add near the top, after the existing `resolveFighter`/`fetchChannel` helpers:

```ts
import { generateTournamentBracketCard, BracketRound, BracketMatch } from "./tournamentBracketCard";
import { AttachmentBuilder } from "discord.js";

/**
 * Rebuilds the bracket image from current DB state and posts/edits/pins the
 * one tracked message. Called after every state change (round-1 generation,
 * a match resolving, round advance, tournament completion) — same "re-derive
 * from source of truth" approach as the rest of this sweep, not an
 * incremental diff.
 */
export async function updateBracketMessage(client: Client, tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament || tournament.currentRound < 1) return; // nothing to show before round 1 exists

  const allMatches = await prisma.tournamentMatch.findMany({
    where: { tournamentId },
    orderBy: [{ round: "asc" }],
  });
  if (allMatches.length === 0) return;

  const userIds = Array.from(new Set(allMatches.flatMap(m => [m.playerAId, m.playerBId]).filter((id): id is string => !!id)));
  const [users, guild] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, element: true, username: true } }),
    client.guilds.fetch(tournament.guildId).catch(() => null),
  ]);
  const elemById = new Map(users.map(u => [u.id, u.element]));
  const nameById = new Map(users.map(u => [u.id, u.username])); // fallback if member fetch fails
  if (guild) {
    const members = await guild.members.fetch({ user: userIds }).catch(() => null);
    members?.forEach(m => nameById.set(m.id, m.displayName));
  }

  const slotFor = (userId: string | null, winnerId: string | null, resolved: boolean) => userId ? ({
    name: nameById.get(userId) ?? "Unknown",
    element: elemById.get(userId) ?? null,
    isWinner: !resolved || winnerId === userId,
  }) : { name: null, element: null, isWinner: false };

  const maxRound = Math.max(...allMatches.map(m => m.round));
  const rounds: BracketRound[] = [];
  for (let r = 1; r <= maxRound; r++) {
    const roundMatches = allMatches.filter(m => m.round === r).sort((a, b) => a.id.localeCompare(b.id));
    const matches: BracketMatch[] = roundMatches.map(m => {
      const resolved = m.status === "COMPLETE" || m.status === "FORFEIT";
      return {
        a: slotFor(m.playerAId, m.winnerId, resolved),
        b: m.playerBId ? slotFor(m.playerBId, m.winnerId, resolved) : null,
        resolved,
      };
    });
    rounds.push({ matches });
  }

  let champion: { name: string; element: string } | null = null;
  if (tournament.phase === "COMPLETED") {
    const lastRound = rounds[rounds.length - 1];
    const finalMatch = lastRound.matches[0];
    const winnerSlot = finalMatch.b === null ? finalMatch.a : (finalMatch.a.isWinner ? finalMatch.a : finalMatch.b);
    if (winnerSlot?.name && winnerSlot.element) champion = { name: winnerSlot.name, element: winnerSlot.element };
  }

  const buf = await generateTournamentBracketCard(rounds, champion);
  const attachment = new AttachmentBuilder(buf, { name: "bracket.webp" });
  const channel = await fetchChannel(client, tournament.channelId);
  if (!channel) return;

  if (tournament.bracketMessageId) {
    const existing = await channel.messages.fetch(tournament.bracketMessageId).catch(() => null);
    if (existing) {
      await existing.edit({ files: [attachment] }).catch(() => {});
      return;
    }
    // Message was deleted — fall through to repost.
  }

  const posted = await channel.send({ content: "🏆  **Tournament Bracket**", files: [attachment] }).catch(() => null);
  if (!posted) return;
  await prisma.tournament.update({ where: { id: tournamentId }, data: { bracketMessageId: posted.id } }).catch(() => {});
  await posted.pin().catch(() => {});
}

/** Unpins (does not delete) the bracket message — called on completion/cancel. */
export async function unpinBracketMessage(client: Client, tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament?.bracketMessageId) return;
  const channel = await fetchChannel(client, tournament.channelId);
  const msg = await channel?.messages.fetch(tournament.bracketMessageId).catch(() => null);
  await msg?.unpin().catch(() => {});
}
```

- [ ] **Step 2: Call `updateBracketMessage` after round-1 generation**

In `closeExpiredSignups()`, right after `await prisma.tournament.update({ where: { id: tournament.id }, data: { phase: "IN_PROGRESS", currentRound: 1 } });` and before the round-1 announcement `channel?.send(...)` call, add:
```ts
    await updateBracketMessage(client, tournament.id);
```

- [ ] **Step 3: Call it after a match resolves via auto-start**

In `attemptStartMatch()`'s `onComplete` callback (inside the `async (winnerId, threadId) => {...}` passed to `startDuelMatch`), right after the `prisma.tournamentParticipant.updateMany(...)` call that marks the loser eliminated, add:
```ts
        await updateBracketMessage(client, tournament.id);
```
(`client` needs to be in scope here — `attemptStartMatch`'s first parameter is already named `client`, so this is directly available.)

- [ ] **Step 4: Call it after deadline forfeits**

In `resolveDeadlineForfeits()`, this function currently doesn't take a `client` parameter — add one, update its signature to `async function resolveDeadlineForfeits(client: Client): Promise<void>`, update the call site in `runSweep()` to `await resolveDeadlineForfeits(client);`, and inside the loop, right after the `prisma.tournamentParticipant.updateMany(...)` call, add:
```ts
    await updateBracketMessage(client, match.tournamentId);
```

- [ ] **Step 5: Call it after round advance and on completion**

In `advanceCompletedRounds()`:
- In the `orderedWinnerIds.length <= 1` (tournament complete) branch, right after `await prisma.tournament.update({ where: { id: tournament.id }, data: { phase: "COMPLETED" } });`, add:
```ts
      await updateBracketMessage(client, tournament.id);
      await unpinBracketMessage(client, tournament.id);
```
- In the "generate next round" branch, right after `await prisma.tournament.update({ where: { id: tournament.id }, data: { currentRound: nextRound } });`, add:
```ts
    await updateBracketMessage(client, tournament.id);
```

- [ ] **Step 6: Unpin on manual cancel too**

This touches `src/commands/utility/tournament.ts`'s `cancel` branch, not `tournamentSweep.ts` — see Task 4.

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tournamentSweep.ts
git commit -m "feat(tournament): post/update/pin the bracket image on every state change"
```

---

### Task 4: Unpin on manual cancel

**Files:**
- Modify: `src/commands/utility/tournament.ts`

- [ ] **Step 1: Import and call `unpinBracketMessage`**

Add to the imports:
```ts
import { attemptStartMatch, unpinBracketMessage } from "../../lib/tournamentSweep";
```
In the `cancel` branch, right after `await prisma.tournament.update({ where: { id: tournament.id }, data: { phase: "CANCELLED" } });`, add:
```ts
    await unpinBracketMessage(interaction.client, tournament.id);
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/commands/utility/tournament.ts
git commit -m "feat(tournament): unpin the bracket image on manual cancel too"
```

---

### Task 5: Final verification + deploy

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Push + SSH deploy**

```bash
git push origin main
```
Then on the VM: `git pull && npx prisma generate && npm run build && pm2 restart cartethyia` (schema changed — `prisma generate` required; no new slash command, so `npm run deploy` is not needed).

- [ ] **Step 3: Live end-to-end test**

Run a small test tournament (4-8 alt accounts, `/tournament start signup_minutes:2 max_players:8`). Confirm:
- The bracket image posts and auto-pins the moment round 1 generates.
- It correctly shows byes (single name, no opponent) if the player count isn't a power of 2.
- After a match resolves (win or `/tournament start-match`-triggered duel), the same message updates in place (not a new message) with the loser dimmed and winner highlighted.
- After a deliberate no-show past the round deadline, a forfeit updates the bracket the same way.
- Round 2 (and later) correctly show only the winners advancing, with connector lines linking the right pairs.
- On tournament completion, the champion box appears and the message gets unpinned.
- A nickname containing CJK or stylized Unicode characters renders as real glyphs on the bracket, not empty boxes.
