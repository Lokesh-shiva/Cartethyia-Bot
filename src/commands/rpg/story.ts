import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, TextChannel } from "discord.js";
import prisma from "../../lib/prisma";
import { isOwner } from "../../lib/owner";
import { isDispatchBlocked, replyNotStarted } from "../../lib/economy";
import { alreadyInCombatMsg, getLock } from "../../lib/combatLock";
import { computeAura, consumeAura, getMaxAura, refundAura } from "../../lib/aura";
import { CHAPTERS } from "../../lib/story/chapters";
import { decideStart, pickChapterToPlay } from "../../lib/story/release";
import { createRun, getActiveRun, getClearedChapterIds, resumeRun, runStateFromRow } from "../../lib/story/runService";
import { animAttachment, createRunThread, ensureRunThread, postMapMessage, withRunLock } from "../../lib/story/storyFlow";

export const data = new SlashCommandBuilder()
  .setName("story")
  .setDescription("Play the monthly story chapters.")
  .addSubcommand(s => s.setName("play").setDescription("Start the next chapter, or continue where you left off."))
  .addSubcommand(s => s.setName("status").setDescription("See which chapters are released, locked or cleared."));

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "status") return storyStatus(interaction);
  return startOrResume(interaction);
}

export const HARD_AURA_COST = 2;

async function storyStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: 64 });
  const user = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { worldLevel: true, isOnboarded: true } });
  if (!user || !user.isOnboarded) { await replyNotStarted(interaction); return; }
  const [cleared, releases, run] = await Promise.all([
    getClearedChapterIds(interaction.user.id),
    prisma.storyRelease.findMany(),
    getActiveRun(interaction.user.id),
  ]);
  const now = Date.now();
  const lines = CHAPTERS.map(c => {
    const rel = releases.find(r => r.chapterId === c.id);
    const released = !!rel && rel.releaseAt.getTime() <= now;
    const state = cleared.includes(c.id) ? "Cleared"
      : !released ? (rel ? `Releases <t:${Math.floor(rel.releaseAt.getTime() / 1000)}:R>` : "Coming soon")
      : user.worldLevel < c.requiresWorldLevel ? `Locked - needs World Level ${c.requiresWorldLevel}`
      : run?.chapterId === c.id ? `In progress (Node ${run.nodeIndex + 1}/${c.nodes.length})` : "Available";
    return `**Chapter ${c.id}: ${c.title}**\n${state}`;
  });
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0xff7a3d).setTitle("Story Chapters").setDescription(lines.join("\n\n") || "No chapters yet.")
      .setFooter({ text: "CARTETHYIA  ·  Story  ·  /story play" })],
  });
}

export async function startOrResume(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: 64 });
  const userId = interaction.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { worldLevel: true, isOnboarded: true, resonanceAura: true, auraUpdatedAt: true, patronTier: true, dispatchStatus: true, dispatchEndsAt: true },
  });
  if (!user || !user.isOnboarded) { await replyNotStarted(interaction); return; }
  if (isDispatchBlocked(user)) { await interaction.editReply("You are on an expedition. Use **/dispatch claim** first."); return; }
  if (getLock(userId)) { await interaction.editReply(alreadyInCombatMsg(userId)); return; }
  if (!interaction.channel || !("threads" in interaction.channel)) {
    await interaction.editReply("Use this in a regular text channel so I can open a private thread for your story."); return;
  }

  const channel = interaction.channel as TextChannel;
  const displayName = interaction.guild?.members.cache.get(userId)?.displayName ?? interaction.user.displayName;
  const cleared = await getClearedChapterIds(userId);
  const chapter = pickChapterToPlay(CHAPTERS, cleared);
  const release = await prisma.storyRelease.findUnique({ where: { chapterId: chapter.id } });
  const activeRun = await getActiveRun(userId);

  const decision = decideStart({
    chapter, worldLevel: user.worldLevel, clearedChapterIds: cleared,
    releaseAt: release?.releaseAt ?? null, now: new Date(), activeRun, bypassRelease: isOwner(userId),
  });

  if (decision.action === "DENIED") {
    const text = decision.reason === "NOT_RELEASED" ? "The next chapter hasn't been released yet. Check **/story status**."
      : decision.reason === "WORLD_LEVEL" ? `Chapter ${chapter.id} needs **World Level ${chapter.requiresWorldLevel}**. Keep pushing through the world bosses.`
      : "Clear the previous chapter first.";
    await interaction.editReply(text);
    return;
  }

  // ── Resume an ACTIVE or PAUSED run ──
  if (decision.action === "RESUME") {
    const run = activeRun!;
    const runChapter = CHAPTERS.find(c => c.id === run.chapterId)!;
    const state = runStateFromRow(run);
    await withRunLock(run.id, async () => {
      if (run.status === "PAUSED") await resumeRun(run.id);
      const thread = await ensureRunThread(interaction.client, run, channel, displayName, runChapter.title);
      if (!thread) { await interaction.editReply("I need **Create Private Threads** permission here to run the story."); return; }
      await postMapMessage(thread, runChapter, run.id, state, {
        title: `Welcome back - ${runChapter.title}`,
        description: `You left off at **Node ${state.nodeIndex + 1} of ${runChapter.nodes.length}: ${runChapter.nodes[state.nodeIndex]!.title}**.`,
        button: "Continue", footerExtra: "Autosaved",
      });
      await interaction.editReply(`Story resumed: <#${thread.id}>`);
    });
    return;
  }

  // ── New run ──
  const hard = decision.difficulty === "HARD";
  if (hard) {
    const aura = computeAura(user.resonanceAura, user.auraUpdatedAt, getMaxAura(user.patronTier ?? 0));
    if (aura.current < HARD_AURA_COST) {
      await interaction.editReply(`A Hard replay costs **${HARD_AURA_COST} Resonance Aura**. You have **${aura.current}**.`);
      return;
    }
  }
  const thread = await createRunThread(channel, userId, displayName, chapter.title);
  if (!thread) { await interaction.editReply("I need **Create Private Threads** + **Send Messages in Threads** permissions here to run the story."); return; }
  if (hard && (await consumeAura(userId, HARD_AURA_COST)) === null) {
    await thread.delete().catch(() => {});
    await interaction.editReply("Not enough Resonance Aura for a Hard replay.");
    return;
  }
  let run;
  try {
    run = await createRun({ userId, chapterId: chapter.id, difficulty: decision.difficulty, threadId: thread.id, guildId: interaction.guildId! });
  } catch (err) {
    if (hard) await refundAura(userId, HARD_AURA_COST).catch(() => {});
    await thread.delete().catch(() => {});
    console.error("[Story] createRun failed:", err);
    await interaction.editReply("Could not start the story. Try again in a moment.");
    return;
  }
  const titleGif = animAttachment(chapter, "title");
  if (titleGif) await thread.send({ files: [titleGif] }).catch(() => {});
  await postMapMessage(thread, chapter, run.id, runStateFromRow(run), {
    title: `${chapter.title}${hard ? "  (Hard replay)" : ""}`,
    description: `${chapter.blurb}\n\n*Your progress autosaves after every node. Pause anytime and return with /story play.*`,
    button: "Begin",
  });
  await interaction.editReply(`Chapter ${chapter.id} begins: <#${thread.id}>`);
}
