// src/lib/alphaRaidChannel.ts
// Resolves which channel to post an Alpha Raid announcement in for a given
// guild. Deliberately restricted to channels the guild has already opted
// into extra bot activity (echo/encounter spawn channels) rather than
// falling back to systemChannel/first-postable-channel — those defaults
// can land the announcement in an unrelated channel (e.g. a welcome
// channel) that just happens to have Send Messages, which is exactly the
// server-owner-experience problem this is meant to avoid. A guild with no
// spawn channels configured is skipped entirely rather than guessed at.
import { Guild, TextChannel } from "discord.js";
import prisma from "./prisma";

export async function resolveAlphaRaidChannel(guild: Guild): Promise<TextChannel | null> {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
  if (!settings) return null;

  const blacklist = new Set(settings.encounterBlacklist ?? []);
  const candidates = [...new Set([...(settings.exploreChannelIds ?? []), ...(settings.encounterChannelIds ?? [])])];

  for (const id of candidates) {
    if (blacklist.has(id)) continue;
    const ch = guild.channels.cache.get(id);
    if (ch?.isTextBased() && ch.permissionsFor(guild.members.me!)?.has("SendMessages")) {
      return ch as TextChannel;
    }
  }

  return null;
}
