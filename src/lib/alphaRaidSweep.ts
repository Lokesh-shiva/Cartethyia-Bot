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
