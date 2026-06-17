import { Events, GuildMember, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from "discord.js";
import { sendOnboarding } from "../lib/onboarding";
import { generateWelcomeCard } from "../lib/welcomeCard";
import prisma from "../lib/prisma";

const MAIN_GUILD_ID   = process.env.MAIN_GUILD_ID   ?? "1516679873438027776";
const DRIFTER_ROLE_ID = process.env.DRIFTER_ROLE_ID ?? "1516691155104829523";

export const name = Events.GuildMemberAdd;
export const once = false;

export async function execute(member: GuildMember) {
  if (member.user.bot) return;

  const settings = await prisma.guildSettings.findUnique({ where: { guildId: member.guild.id } });
  if (!settings?.welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(settings.welcomeChannelId) as TextChannel | undefined;
  if (!channel?.isTextBased()) return;
  if (!channel.permissionsFor(member.guild.members.me!)?.has("SendMessages")) return;

  // ── Main (support) server — welcome card + Begin Journey button ──────────────
  if (member.guild.id === MAIN_GUILD_ID) {
    const avatarUrl = member.user.displayAvatarURL({ size: 256, extension: "png" });
    const cardBuf   = await generateWelcomeCard(member.displayName, avatarUrl, true).catch(() => null);
    const files     = cardBuf ? [new AttachmentBuilder(cardBuf, { name: "welcome.png" })] : [];

    const embed = new EmbedBuilder()
      .setColor(0x6366F1)
      .setDescription(
        `Welcome to **Eureka Society**, <@${member.id}>!\n\n` +
        `**CARTETHYIA** is a social RPG that lives right here in this server.\n\n` +
        `◈  Chat → Resonance EXP → Level up\n` +
        `◈  Fight echoes that spawn while chatting\n` +
        `◈  Dungeons · Boss trials · Duels · Raids\n\n` +
        `Press **Begin Journey** below to calibrate your resonance and unlock the game.`
      )
      .setFooter({ text: "CARTETHYIA  ·  The world is watching." });

    if (cardBuf) embed.setImage("attachment://welcome.png");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`welcome_start_${member.id}`)
        .setLabel("Begin Journey")
        .setStyle(ButtonStyle.Primary),
    );

    await channel.send({ embeds: [embed], components: [row], files }).catch(console.error);
    return;
  }

  // ── Other servers — existing auto-onboarding flow ────────────────────────────
  await sendOnboarding(member, channel).catch(console.error);
}
