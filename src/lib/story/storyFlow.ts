// Story run flow: posts each node, runs fights through the dungeon engine, saves at every boundary.
// One node per continueRun call; boundaries wait for a durable button so the player can pause or restart safely.
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, TextChannel, ThreadChannel,
} from "discord.js";
import fs from "fs";
import path from "path";
import prisma from "../prisma";
import { carryOverWaveState, createWaveSession, runWave, type WaveSession } from "../../commands/rpg/dungeon";
import { formatCombatStatsSummary } from "../combatStats";
import { acquireLock, releaseLock } from "../combatLock";
import { registerFight, clearFight } from "../fightTracker";
import { checkLevelUp } from "../progression";
import { getWishWeapon } from "../wishWeapons";
import { getChapter, chapterNodeDungeon } from "./chapters";
import { buildLoanerBundle, loanerRoster, STORY_BREN_KIT_LEVEL, STORY_BREN_LEVEL } from "./loaner";
import { generateStoryMapCard, NODE_COLOR } from "./mapCard";
import { buildPuzzleView } from "./puzzleUi";
import { initPuzzleState } from "./puzzleStep";
import { advanceNode, applyRest, buildCustomId, canTakeOption, isFinalNode, MIN_HP } from "./runEngine";
import { bossStartBonus } from "./puzzles";
import { completeRun, failRun, runStateFromRow, saveRunState, setRunThread, type StoryRunRow } from "./runService";
import type { ChapterDefinition, NodeDefinition, RunState } from "./types";

const BRAND = "CARTETHYIA  ·  Story";
const hex = (c: string) => parseInt(c.slice(1), 16);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── per-run mutex: a double click or a second flow can never run a node twice ──
const busyRuns = new Set<string>();
export function isRunBusy(runId: string): boolean { return busyRuns.has(runId); }
export async function withRunLock(runId: string, fn: () => Promise<void>): Promise<boolean> {
  if (busyRuns.has(runId)) return false;
  busyRuns.add(runId);
  try { await fn(); } finally { busyRuns.delete(runId); }
  return true;
}

// ── art ──────────────────────────────────────────────────────────────────────
export const artDirOf = (chapter: ChapterDefinition) => path.join(process.cwd(), "assets", "story", `ch${chapter.id}`);

function sceneFile(chapter: ChapterDefinition, node: NodeDefinition): AttachmentBuilder | null {
  if (!node.art) return null;
  const p = path.join(artDirOf(chapter), `${node.art}.png`);
  return fs.existsSync(p) ? new AttachmentBuilder(p, { name: "scene.png" }) : null;
}

export async function buildMapAttachment(chapter: ChapterDefinition, state: RunState): Promise<AttachmentBuilder> {
  const buf = await generateStoryMapCard({
    chapterTitle: chapter.title,
    nodes: chapter.nodes.map(n => ({ kind: n.kind, label: n.title })),
    currentIndex: state.nodeIndex, hpFraction: state.hpFraction, artDir: artDirOf(chapter),
  });
  return new AttachmentBuilder(buf, { name: "map.png" });
}

// ── threads ──────────────────────────────────────────────────────────────────
/** The run's thread, reopened if archived; null when it is gone. */
export async function fetchRunThread(client: Client, run: StoryRunRow): Promise<ThreadChannel | null> {
  if (!run.threadId) return null;
  const ch = await client.channels.fetch(run.threadId).catch(() => null);
  if (!ch || !ch.isThread()) return null;
  if (ch.archived) await ch.setArchived(false).catch(() => {});
  await ch.members.add(run.userId).catch(() => {});
  return ch;
}

export async function createRunThread(channel: TextChannel, userId: string, displayName: string, title: string): Promise<ThreadChannel | null> {
  try {
    const thread = await channel.threads.create({
      name: `${displayName} - ${title}`.slice(0, 90), autoArchiveDuration: 1440, type: ChannelType.PrivateThread,
    });
    await thread.members.add(userId);
    return thread;
  } catch { return null; }
}

/** Reuses the run's thread or makes a new one in `channel` and records it. */
export async function ensureRunThread(client: Client, run: StoryRunRow, channel: TextChannel, displayName: string, title: string): Promise<ThreadChannel | null> {
  const existing = await fetchRunThread(client, run);
  if (existing) return existing;
  const fresh = await createRunThread(channel, run.userId, displayName, title);
  if (fresh) await setRunThread(run.id, fresh.id, fresh.guildId);
  return fresh;
}

// ── boundary / intro posts ───────────────────────────────────────────────────
export function boundaryRow(runId: string, nodeIndex: number, nextLabel = "Continue"): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buildCustomId("next", runId, nodeIndex)).setLabel(nextLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buildCustomId("pause", runId, nodeIndex)).setLabel("Pause").setStyle(ButtonStyle.Secondary),
  );
}

export async function postMapMessage(
  thread: ThreadChannel, chapter: ChapterDefinition, runId: string, state: RunState,
  opts: { title: string; description: string; button: string; footerExtra?: string },
): Promise<void> {
  const map = await buildMapAttachment(chapter, state);
  await thread.send({
    embeds: [new EmbedBuilder().setColor(hex("#ff7a3d")).setTitle(opts.title).setDescription(opts.description)
      .setImage("attachment://map.png").setFooter({ text: `${BRAND}${opts.footerExtra ? `  ·  ${opts.footerExtra}` : ""}` })],
    files: [map], components: [boundaryRow(runId, state.nodeIndex, opts.button)],
  });
}

// ── fights ───────────────────────────────────────────────────────────────────
function applyFractions(session: WaveSession, state: RunState): void {
  const ws = session.ws;
  ws.playerHp = Math.max(1, Math.round(ws.playerHpMax * state.hpFraction));
  for (const b of Object.values(ws.allyBundles)) {
    if (!b) continue;
    b.hp = Math.max(1, Math.round(b.hpMax * (state.allyHpFractions[b.characterId] ?? 1)));
  }
}

function captureFractions(session: WaveSession, state: RunState): RunState {
  const ws = session.ws;
  const allyHpFractions: Record<string, number> = {};
  for (const b of Object.values(ws.allyBundles)) if (b) allyHpFractions[b.characterId] = Math.max(MIN_HP, b.hp / b.hpMax);
  return { ...state, hpFraction: Math.max(MIN_HP, Math.min(1, ws.playerHp / ws.playerHpMax)), allyHpFractions };
}

type FightStatus = "WON" | "LOST" | "BLOCKED";

async function runFightNode(
  thread: ThreadChannel, run: StoryRunRow, chapter: ChapterDefinition, nodeIndex: number, state: RunState,
): Promise<{ status: FightStatus; state: RunState }> {
  const node = chapter.nodes[nodeIndex]!;
  const bren = node.kind === "STORY_BREN_FIGHT";
  const dbRow = await prisma.user.findUnique({
    where: { id: run.userId },
    select: { level: true, worldLevel: true, element: true, baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true, critRate: true, critDmg: true },
  });
  if (!dbRow) return { status: "BLOCKED", state };
  // Story enemies scale from the chapter's world level, not the player's.
  const dbUser = { ...dbRow, worldLevel: chapter.enemyWorldLevel };
  const displayName = thread.guild?.members.cache.get(run.userId)?.displayName ?? "Resonator";

  if (!acquireLock(run.userId, "Story")) {
    await thread.send({ content: "You are in another fight. Finish it, then press Continue again." });
    return { status: "BLOCKED", state };
  }
  await registerFight(run.userId, thread.id, run.guildId ?? thread.guildId, "Story", 0);
  try {
    const session = bren
      ? await createWaveSession({
          userId: run.userId, dbUser, displayName,
          roster: loanerRoster("bren"),
          allyBundles: { 1: buildLoanerBundle("bren", STORY_BREN_LEVEL, STORY_BREN_KIT_LEVEL) },
        })
      : await createWaveSession({ userId: run.userId, dbUser, displayName });
    if (!bren) applyFractions(session, state);

    const dungeon = chapterNodeDungeon(chapter, nodeIndex, state.difficulty);
    let ws = session.ws;
    for (let w = 0; w < dungeon.waves.length; w++) {
      const result = await runWave(thread, run.userId, dungeon, w, dbUser, session.stats, session.bonuses, ws, displayName);
      if (!result.survived) return { status: "LOST", state };
      ws = carryOverWaveState(result);
      session.ws = ws;
      if (w < dungeon.waves.length - 1) {
        await thread.send({ embeds: [new EmbedBuilder().setColor(hex("#e0523a")).setDescription(`**Wave ${w + 1} cleared.** HP carries over.`).setFooter({ text: BRAND })] });
        await sleep(2000);
      }
    }
    await thread.send({ embeds: [new EmbedBuilder().setColor(hex("#e0523a")).setDescription(`**Combat summary**\n${formatCombatStatsSummary(ws.combatStats)}`).setFooter({ text: BRAND })] });
    // Bren's flashback is a loan: it never changes the player's own HP.
    return { status: "WON", state: bren ? state : captureFractions(session, state) };
  } finally {
    releaseLock(run.userId);
    await clearFight(run.userId);
  }
}

// ── node completion ──────────────────────────────────────────────────────────
async function finishNode(
  thread: ThreadChannel, run: StoryRunRow, chapter: ChapterDefinition, nodeIndex: number, state: RunState, headline: string,
): Promise<void> {
  const node = chapter.nodes[nodeIndex]!;
  if (isFinalNode(chapter, { ...state, nodeIndex })) {
    await postVictory(thread, run, chapter, state);
    return;
  }
  const next = advanceNode({ ...state, puzzle: null });
  await saveRunState(run.id, next);
  await postMapMessage(thread, chapter, run.id, next, {
    title: headline,
    description: node.resultText ?? "The path continues.",
    button: "Continue",
    footerExtra: `Autosaved - next: Node ${next.nodeIndex + 1} of ${chapter.nodes.length}`,
  });
}

async function postVictory(thread: ThreadChannel, run: StoryRunRow, chapter: ChapterDefinition, state: RunState): Promise<void> {
  const last = chapter.nodes[chapter.nodes.length - 1]!;
  const done = await completeRun(run.id, chapter);
  if (done.alreadyCompleted || !done.plan) {
    await thread.send({ content: "This chapter was already completed and its rewards claimed." });
    return;
  }
  const { plan } = done;
  const lines = [
    `${CURRENCY_LINE(plan.currencies.credits, plan.currencies.fractonite, plan.currencies.emberShards)}`,
  ];
  if (plan.advanceWorldLevelTo) lines.push(`**World Level raised to ${plan.advanceWorldLevelTo}.**`);
  if (plan.grantWeaponId) lines.push(`**New weapon:** ${getWishWeapon(plan.grantWeaponId)?.name ?? plan.grantWeaponId}`);
  if (state.difficulty === "HARD") lines.push("*Replay rewards. World Level and the weapon are first-clear only.*");
  const embed = new EmbedBuilder().setColor(hex("#ffd479")).setTitle(`${chapter.title} - Complete`)
    .setDescription(`${last.resultText ?? ""}\n\n${lines.join("\n")}`).setFooter({ text: BRAND });
  const boss = chapter.nodes.find(n => n.kind === "BOSS");
  const scene = boss ? sceneFile(chapter, boss) : null;
  if (scene) embed.setImage("attachment://scene.png");
  await thread.send({ embeds: [embed], files: scene ? [scene] : [] });
  await checkLevelUp(run.userId).catch(() => {});
  await thread.setArchived(true).catch(() => {});
}

const CURRENCY_LINE = (credits: number, fractonite: number, shards: number) =>
  `**Rewards:** ${credits.toLocaleString()} credits  ·  ${fractonite} fractonite  ·  ${shards} ember shards`;

// ── the engine ───────────────────────────────────────────────────────────────
/** Runs the current node. Caller must hold the run lock. */
export async function continueRunLocked(client: Client, runId: string): Promise<void> {
  const run = await prisma.storyRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "ACTIVE") return;
  const chapter = getChapter(run.chapterId);
  if (!chapter) return;
  const thread = await fetchRunThread(client, run);
  if (!thread) return;

  let state = runStateFromRow(run);
  const idx = state.nodeIndex;
  const node = chapter.nodes[idx];
  if (!node) return;
  const scene = sceneFile(chapter, node);
  const intro = () => new EmbedBuilder().setColor(hex(NODE_COLOR[node.kind])).setTitle(node.title).setDescription(node.intro).setFooter({ text: BRAND });

  switch (node.kind) {
    case "EVENT": {
      const embed = intro();
      if (scene) embed.setImage("attachment://scene.png");
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents((node.options ?? []).map(o =>
        new ButtonBuilder().setCustomId(buildCustomId("opt", run.id, idx, o.id))
          .setLabel(`${o.label}${o.hpCostFraction > 0 ? ` (-${Math.round(o.hpCostFraction * 100)}% HP)` : ""}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary).setDisabled(!canTakeOption(state, o))));
      await thread.send({ embeds: [embed], files: scene ? [scene] : [], components: [row] });
      return;
    }
    case "REST": {
      const embed = intro();
      if (scene) embed.setImage("attachment://scene.png");
      await thread.send({ embeds: [embed], files: scene ? [scene] : [] });
      state = applyRest(state, node.restFraction ?? 0);
      await finishNode(thread, run, chapter, idx, state, `${node.title} - restored ${Math.round((node.restFraction ?? 0) * 100)}% HP`);
      return;
    }
    case "PUZZLE": {
      const def = node.puzzle!;
      const fresh = !state.puzzle;
      if (fresh) {
        state = { ...state, puzzle: initPuzzleState(def, Date.now() % 2147483647) };
        await saveRunState(run.id, state);
      }
      const reveal = fresh && def.kind === "SEQUENCE";
      const attachmentName = scene ? "scene.png" : undefined;
      const msg = await thread.send({
        ...buildPuzzleView(run.id, node, idx, state, { revealSequence: reveal, sceneAttachment: attachmentName }),
        files: scene ? [scene] : [],
      });
      if (reveal) {
        await sleep(5000);
        await msg.edit(buildPuzzleView(run.id, node, idx, state, { sceneAttachment: attachmentName })).catch(() => {});
      }
      return;
    }
    case "FIGHT":
    case "STORY_BREN_FIGHT":
    case "BOSS": {
      if (node.kind === "BOSS" && !state.flags.includes("boss_started")) {
        state = { ...bossStartBonus(state), flags: [...state.flags, "boss_started"] };
        await saveRunState(run.id, state);
      }
      const embed = intro();
      if (scene) embed.setImage("attachment://scene.png");
      await thread.send({ embeds: [embed], files: scene ? [scene] : [] });
      await sleep(1500);
      const res = await runFightNode(thread, run, chapter, idx, state);
      if (res.status === "BLOCKED") return;
      if (res.status === "LOST") {
        await failRun(run.id);
        await thread.send({ embeds: [new EmbedBuilder().setColor(0x4a4a5a).setTitle("Defeated")
          .setDescription(`You fell at **${node.title}**. The run ends here.\nStart again with **/story play**.`).setFooter({ text: BRAND })] });
        await thread.setArchived(true).catch(() => {});
        return;
      }
      await finishNode(thread, run, chapter, idx, res.state, `${node.title} - cleared`);
      return;
    }
  }
}

export async function continueRun(client: Client, runId: string): Promise<void> {
  await withRunLock(runId, async () => {
    try { await continueRunLocked(client, runId); }
    catch (err) { console.error("[Story] continueRun failed:", err); }
  });
}

export { finishNode, sceneFile };
