// Durable button handler for story_* customIds. Everything is resolved from the DB run row,
// so buttons keep working after a bot restart.
import { ButtonInteraction, EmbedBuilder } from "discord.js";
import prisma from "../prisma";
import { getChapter } from "./chapters";
import { lanternHint } from "./puzzles";
import { lanternGridOf, stepPuzzle, type PuzzleAction } from "./puzzleStep";
import { buildPuzzleView } from "./puzzleUi";
import { applyEventOption, canTakeOption, isStaleAction, parseCustomId } from "./runEngine";
import { pauseRun, resumeRun, runStateFromRow, saveRunState } from "./runService";
import { continueRunLocked, finishNode, sceneFile, withRunLock } from "./storyFlow";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const note = (i: ButtonInteraction, content: string) => i.followUp({ content, flags: 64 }).catch(() => {});

export async function handleStoryButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;
  await interaction.deferUpdate().catch(() => {});

  const started = await withRunLock(parsed.runId, async () => {
    try {
    const run = await prisma.storyRun.findUnique({ where: { id: parsed.runId } });
    if (!run) { await note(interaction, "This story run no longer exists."); return; }
    if (run.userId !== interaction.user.id) { await note(interaction, "This is someone else's story run."); return; }
    const chapter = getChapter(run.chapterId);
    if (!chapter) { await note(interaction, "This chapter is no longer available."); return; }

    if (parsed.kind === "resume" && run.status === "PAUSED") await resumeRun(run.id);
    else if (run.status !== "ACTIVE") { await note(interaction, "This story run isn't active. Use /story play."); return; }

    const state = runStateFromRow(run);
    if (isStaleAction(state, parsed.nodeIndex)) { await note(interaction, "That choice is out of date. Use the latest message."); return; }
    const node = chapter.nodes[state.nodeIndex]!;

    switch (parsed.kind) {
      case "next":
      case "resume": {
        await interaction.editReply({ components: [] }).catch(() => {});
        await continueRunLocked(interaction.client, run.id);
        return;
      }
      case "pause": {
        await pauseRun(run.id);
        await interaction.editReply({ components: [] }).catch(() => {});
        const thread = interaction.channel;
        if (thread?.isThread()) {
          await thread.send({ embeds: [new EmbedBuilder().setColor(0x334155)
            .setDescription(`Autosaved at Node ${state.nodeIndex + 1} of ${chapter.nodes.length}. Continue anytime with **/story play**.`)
            .setFooter({ text: "CARTETHYIA  ·  Story" })] }).catch(() => {});
          await thread.setArchived(true).catch(() => {});
        }
        return;
      }
      case "opt": {
        const option = node.options?.find(o => o.id === parsed.optionId);
        if (!option || !canTakeOption(state, option)) { await note(interaction, "You can't take that option."); return; }
        await interaction.editReply({ components: [] }).catch(() => {});
        const next = applyEventOption(state, option);
        const thread = interaction.channel;
        if (thread?.isThread()) await finishNode(thread, run, chapter, state.nodeIndex, next, `${node.title} - ${option.resultText}`);
        return;
      }
      case "hint":
      case "pz": {
        const def = node.puzzle;
        if (node.kind !== "PUZZLE" || !def || !state.puzzle) { await note(interaction, "No puzzle is active here."); return; }
        const scene = sceneFile(chapter, node);
        const sceneAttachment = scene ? "scene.png" : undefined;
        const view = (s = state, extra = {}) => buildPuzzleView(run.id, node, state.nodeIndex, s, { sceneAttachment, ...extra });

        let action: PuzzleAction;
        if (parsed.kind === "hint") action = { type: "hint" };
        else if (parsed.optionId === "giveup") action = { type: "giveup" };
        else if (parsed.optionId === "force") action = { type: "force" };
        else action = { type: "press", value: Number(parsed.optionId) };
        if (action.type === "press" && !Number.isInteger(action.value)) return;

        const res = stepPuzzle(state, def, action);
        if (res.outcome === "NO_HINT") { await note(interaction, "Not enough HP left to spend on a hint."); return; }
        if (res.outcome === "NO_FORCE") { await note(interaction, "You can't do that."); return; }

        if (res.outcome === "CONTINUE") {
          await saveRunState(run.id, res.state);
          await interaction.editReply(view(res.state)).catch(() => {});
          return;
        }
        if (res.outcome === "HINT") {
          await saveRunState(run.id, res.state);
          if (def.kind === "SEQUENCE") {
            await interaction.editReply(view(res.state, { revealSequence: true })).catch(() => {});
            await sleep(5000);
            await interaction.editReply(view(res.state)).catch(() => {});
          } else if (def.kind === "LANTERNS") {
            const cell = lanternHint(lanternGridOf(res.state.puzzle!));
            await interaction.editReply(view(res.state, { hintCell: cell >= 0 ? cell : undefined })).catch(() => {});
          } else {
            await interaction.editReply(view(res.state)).catch(() => {});
          }
          return;
        }

        // SUCCESS | FAIL | FORCED: the puzzle is over, the run moves on.
        await interaction.editReply({ components: [] }).catch(() => {});
        const headline = res.outcome === "SUCCESS" ? `${node.title} - solved`
          : res.outcome === "FORCED" ? `${node.title} - taken by force` : `${node.title} - failed`;
        const thread = interaction.channel;
        if (thread?.isThread()) await finishNode(thread, run, chapter, state.nodeIndex, res.state, headline);
        return;
      }
    }
    } catch (err) {
      console.error("[Story] handler error:", err);
      await note(interaction, "Something went wrong. Your progress is saved - use /story play.");
    }
  });
  if (!started) await note(interaction, "Still working on your last action. Give it a moment.");
}
