import { Client, Events, ActivityType, EmbedBuilder } from "discord.js";
import { loadExploreChannels, loadAllGuildSettings, restoreEncounters } from "../lib/encounter";
import { loadEmojis } from "../lib/emojiManager";
import { rescheduleOnReady } from "../lib/dailyReminder";
import { loadAllPrefixes } from "../lib/prefixManager";
import prisma from "../lib/prisma";

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client) {
  console.log(`✅ Cartethyia is online as ${client.user?.tag}`);

  // Warm up DB connection to avoid cold-start latency on first user interaction
  await prisma.$queryRaw`SELECT 1`.catch(() => {});
  console.log("[Ready] Database connection warmed.");

  // Keep Neon connection alive — prevents serverless suspension between queries
  setInterval(async () => {
    await prisma.$queryRaw`SELECT 1`.catch(() => {});
  }, 4 * 60 * 1000); // every 4 minutes

  // Application emojis — uploaded to the bot itself, usable in every server
  await loadEmojis(client);

  // Per-guild config for ALL servers (multi-server ready)
  await loadAllGuildSettings();
  await loadAllPrefixes();

  await restoreEncounters(client);
  await rescheduleOnReady(client);

  // ── Fight recovery: clean up any fights left open from a previous session ──
  const staleFights = await prisma.activeFight.findMany();
  if (staleFights.length > 0) {
    console.log(`[Ready] Found ${staleFights.length} stale fight(s) — sending recovery messages...`);
    for (const fight of staleFights) {
      try {
        const guild  = await client.guilds.fetch(fight.guildId).catch(() => null);
        const thread = guild
          ? await guild.channels.fetch(fight.threadId).catch(() => null)
          : null;

        if (thread && thread.isTextBased() && "send" in thread) {
          await (thread as any).send({
            embeds: [new EmbedBuilder()
              .setColor(0x334155)
              .setTitle("◈  Resonance Field Disrupted")
              .setDescription(
                `The **${fight.command}** was interrupted by a system restart.\n\n` +
                `Your progress has been lost but no resources were deducted.\n` +
                `You may start a new fight anytime.`
              )
              .setFooter({ text: "CARTETHYIA  ·  Auto-recovery" })],
          }).catch(() => {});
          await (thread as any).setArchived(true).catch(() => {});
        }
      } catch { /* guild/thread may be inaccessible — ignore */ }
    }
    await prisma.activeFight.deleteMany();
    console.log(`[Ready] Stale fights cleared.`);
  }

  client.user?.setPresence({
    activities: [
      {
        name: "the Resonance Grid",
        type: ActivityType.Watching,
      },
    ],
    status: "online",
  });
}
