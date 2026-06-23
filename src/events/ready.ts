import { Client, Events, ActivityType, EmbedBuilder } from "discord.js";
import { Api as TopGGApi } from "@top-gg/sdk";
import { loadExploreChannels, loadAllGuildSettings, restoreEncounters } from "../lib/encounter";
import { loadEmojis } from "../lib/emojiManager";
import { rescheduleOnReady } from "../lib/dailyReminder";
import { loadAllPrefixes } from "../lib/prefixManager";
import { setAuditClient, runBalanceSweep } from "../lib/antiCheat";
import prisma from "../lib/prisma";

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client) {
  console.log(`✅ Cartethyia is online as ${client.user?.tag}`);

  // Warm up DB connection to avoid cold-start latency on first user interaction
  await prisma.$queryRaw`SELECT 1`.catch(() => {});
  console.log("[Ready] Database connection warmed.");

  // Keep Neon connection alive — prevents serverless auto-suspend (default 5 min
  // idle). Ping every 2 min for comfortable margin; log failures so a dying
  // keepalive is visible instead of silently letting the compute suspend.
  setInterval(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
      console.warn("[Ready] keepalive ping failed:", err?.code ?? err?.message ?? err);
    }
  }, 2 * 60 * 1000); // every 2 minutes

  // Application emojis — uploaded to the bot itself, usable in every server
  await loadEmojis(client);

  // Pre-fetch all guild channels so they appear in slash command dropdowns
  // without requiring the bot to have seen activity in each channel first.
  for (const guild of client.guilds.cache.values()) {
    await guild.channels.fetch().catch(() => {});
  }

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

  // Anti-cheat: wire up audit client + run balance sweep every 12h
  setAuditClient(client);
  setInterval(() => runBalanceSweep(client), 12 * 60 * 60 * 1000);

  // top.gg server count — posts immediately then every 30 min
  const TOPGG_TOKEN = process.env.TOPGG_TOKEN ?? "";
  if (TOPGG_TOKEN) {
    const topgg = new TopGGApi(TOPGG_TOKEN);
    const postTopggStats = async () => {
      try {
        await topgg.postStats({ serverCount: client.guilds.cache.size });
        console.log(`[topgg] Posted server count: ${client.guilds.cache.size} servers`);
      } catch (err: any) {
        console.error("[topgg] postStats error:", err?.message ?? err);
      }
    };
    await postTopggStats();
    setInterval(postTopggStats, 30 * 60 * 1000);
  } else {
    console.warn("[topgg] TOPGG_TOKEN not set — skipping server count updates");
  }
}
