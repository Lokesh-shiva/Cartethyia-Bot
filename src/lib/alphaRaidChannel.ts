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
