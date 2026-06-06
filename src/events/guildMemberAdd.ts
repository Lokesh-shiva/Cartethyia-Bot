import { Events, GuildMember, TextChannel } from "discord.js";
import { sendOnboarding } from "../lib/onboarding";
import prisma from "../lib/prisma";

export const name = Events.GuildMemberAdd;
export const once = false;

export async function execute(member: GuildMember) {
  if (member.user.bot) return;

  // Auto-onboarding only fires if an admin set a welcome channel via /setup.
  // Otherwise members opt in with /start — prevents spamming random channels.
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: member.guild.id } });
  if (!settings?.welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(settings.welcomeChannelId) as TextChannel | undefined;
  if (!channel || !channel.isTextBased()) return;
  if (!channel.permissionsFor(member.guild.members.me!)?.has("SendMessages")) return;

  await sendOnboarding(member, channel).catch(console.error);
}
