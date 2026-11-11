// 5-minute DB-driven sweep (survives restarts, same shape as alphaRaidSweep):
// 1) announces chapters whose release time has arrived, 2) auto-pauses idle runs.
import { Client, EmbedBuilder } from "discord.js";
import prisma from "../prisma";
import { resolveAlphaRaidChannel } from "../alphaRaidChannel";
import { getChapter } from "./chapters";
import { selectAnnouncements, selectIdleRuns } from "./release";
import { pauseRun } from "./runService";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
export const IDLE_PAUSE_MS = 30 * 60 * 1000;

export function startStorySweep(client: Client): void {
  setInterval(() => runSweep(client).catch(err => console.error("[Story] sweep error:", err)), SWEEP_INTERVAL_MS);
}

async function announce(client: Client): Promise<void> {
  const rows = await prisma.storyRelease.findMany({ where: { announcedAt: null } });
  for (const chapterId of selectAnnouncements(rows, new Date())) {
    // Mark first so a crash mid-post can never double-announce.
    const claimed = await prisma.storyRelease.updateMany({ where: { chapterId, announcedAt: null }, data: { announcedAt: new Date() } });
    if (claimed.count === 0) continue;
    const chapter = getChapter(chapterId);
    if (!chapter) continue;
    const embed = new EmbedBuilder().setColor(0xff7a3d)
      .setTitle(`New story chapter: ${chapter.title}`)
      .setDescription(`${chapter.blurb}\n\nRequires **World Level ${chapter.requiresWorldLevel}**. Begin with **/story play**.`)
      .setFooter({ text: "CARTETHYIA  ·  Story" });
    for (const guild of client.guilds.cache.values()) {
      const channel = await resolveAlphaRaidChannel(guild).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

async function autoPauseIdle(client: Client): Promise<void> {
  const [runs, fights] = await Promise.all([
    prisma.storyRun.findMany({ where: { status: "ACTIVE" }, select: { id: true, userId: true, status: true, updatedAt: true, threadId: true, nodeIndex: true, chapterId: true } }),
    prisma.activeFight.findMany({ select: { userId: true } }),
  ]);
  const ids = selectIdleRuns(runs, new Date(), IDLE_PAUSE_MS, new Set(fights.map(f => f.userId)));
  for (const id of ids) {
    const run = runs.find(r => r.id === id)!;
    await pauseRun(id);
    if (!run.threadId) continue;
    const thread = await client.channels.fetch(run.threadId).catch(() => null);
    if (!thread || !thread.isThread()) continue;
    await thread.send({ embeds: [new EmbedBuilder().setColor(0x334155)
      .setDescription(`Autosaved at Node ${run.nodeIndex + 1}. Continue anytime with **/story play**.`)
      .setFooter({ text: "CARTETHYIA  ·  Story" })] }).catch(() => {});
    await thread.setArchived(true).catch(() => {});
  }
}

async function runSweep(client: Client): Promise<void> {
  await announce(client);
  await autoPauseIdle(client);
}
