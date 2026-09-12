// src/commands/utility/owner-alpharaid.ts
// Owner-only, global trigger. Fans out a recruiting announcement + Join
// button to every guild the bot is in. Each guild gets its own
// AlphaRaidInstance with a 72h kill-window deadline (see design spec
// docs/superpowers/specs/2026-09-12-alpha-raid-design.md).
import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import prisma from "../../lib/prisma";
import { resolveAlphaRaidChannel } from "../../lib/alphaRaidChannel";

const KILL_WINDOW_HOURS = 72;

export const data = new SlashCommandBuilder()
  .setName("owner-alpharaid")
  .setDescription("Owner only — trigger a global Alpha Raid event across every server.")
  .addSubcommand(s => s.setName("start").setDescription("Fire the event now.")) as SlashCommandBuilder;

function buildRecruitEmbed(count: number, deadlineAt: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xFF4F4F)
    .setTitle("⚡  ALPHA RAID — A Rare Threat Has Emerged")
    .setDescription(
      `A boss far stronger than anything in the usual rotation has appeared — server-wide, everywhere the bot lives.\n\n` +
      `**Players joined:** ${count}\n` +
      `**Kill window closes:** <t:${Math.floor(deadlineAt.getTime() / 1000)}:R>\n\n` +
      `Bring your best. This one only comes around when the owner calls it — and the rewards (Fracture Keys, Radiant Keys) don't come from anywhere else.\n\n` +
      `Click below to join!`
    )
    .setFooter({ text: "CARTETHYIA  ·  Alpha Raid" });
}

export const command: Command = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "Owner only.", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });

    const triggeredAt = new Date();
    const deadlineAt = new Date(triggeredAt.getTime() + KILL_WINDOW_HOURS * 60 * 60 * 1000);

    const event = await prisma.alphaRaidEvent.create({
      data: { triggeredBy: interaction.user.id, triggeredAt },
    });

    let posted = 0, skipped = 0;
    for (const guild of interaction.client.guilds.cache.values()) {
      const channel = await resolveAlphaRaidChannel(guild).catch(() => null);
      if (!channel) { skipped++; continue; }

      const instance = await prisma.alphaRaidInstance.create({
        data: { eventId: event.id, guildId: guild.id, channelId: channel.id, deadlineAt },
      });

      const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`alpharaid_join_${instance.id}`).setLabel("⚔️  Join Alpha Raid").setStyle(ButtonStyle.Danger),
      );

      const msg = await channel.send({ embeds: [buildRecruitEmbed(0, deadlineAt)], components: [joinRow] }).catch(() => null);
      if (!msg) { skipped++; continue; }

      await prisma.alphaRaidInstance.update({ where: { id: instance.id }, data: { messageId: msg.id } });
      posted++;
    }

    await interaction.editReply({
      content: `⚡ Alpha Raid triggered — posted in **${posted}** server(s), skipped **${skipped}** (no postable channel found).`,
    });
  },
};

export default command;
