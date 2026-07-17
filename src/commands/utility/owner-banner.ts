// src/commands/utility/owner-banner.ts
// Milestone 4b Task 3 — owner-only control of the limited banner window
// (BannerWindow row "banner1", shared by both the character and weapon
// limited banners in /wish). See design spec + Milestone 4b plan.

import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
} from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import prisma from "../../lib/prisma";

const BANNER_ID = "banner1";

const builder = new SlashCommandBuilder()
  .setName("owner-banner")
  .setDescription("Owner only — control the limited banner window.")
  .setDefaultMemberPermissions(0);

builder.addSubcommand(s =>
  s.setName("start")
    .setDescription("Start the limited banner window (Solace + Wellspring).")
    .addIntegerOption(o => o.setName("days").setDescription("Duration in days (default 23)").setRequired(false).setMinValue(1))
);
builder.addSubcommand(s => s.setName("status").setDescription("Show the current banner window."));
builder.addSubcommand(s => s.setName("end").setDescription("Immediately close the banner window."));

export const data = builder as SlashCommandBuilder;

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!isOwner(interaction.user.id)) {
    await interaction.reply({ content: "Owner only.", flags: 64 });
    return;
  }
  await interaction.deferReply({ flags: 64 });

  const sub = interaction.options.getSubcommand();

  if (sub === "start") {
    const days = interaction.options.getInteger("days") ?? 23;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);

    await prisma.bannerWindow.upsert({
      where:  { id: BANNER_ID },
      create: { id: BANNER_ID, startsAt, endsAt },
      update: { startsAt, endsAt },
    });

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFCD34D)
        .setTitle("✦  Banner Window Started")
        .setDescription(
          `**The Rising Overture** and **The Tempered Vow** are now live.\n\n` +
          `Starts: <t:${Math.floor(startsAt.getTime() / 1000)}:F>\n` +
          `Ends: <t:${Math.floor(endsAt.getTime() / 1000)}:F> (**${days}** days)`
        )],
    });
    return;
  }

  if (sub === "status") {
    const window = await prisma.bannerWindow.findUnique({ where: { id: BANNER_ID } });
    if (!window) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("No banner has ever been started.")] });
      return;
    }
    const now = Date.now();
    const active = now >= window.startsAt.getTime() && now <= window.endsAt.getTime();
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(active ? 0xFCD34D : 0x4A4A5A)
        .setTitle(active ? "✦ Banner Active" : "◇ Banner Not Active")
        .setDescription(
          `Starts: <t:${Math.floor(window.startsAt.getTime() / 1000)}:F>\n` +
          `Ends: <t:${Math.floor(window.endsAt.getTime() / 1000)}:F>`
        )],
    });
    return;
  }

  if (sub === "end") {
    const window = await prisma.bannerWindow.findUnique({ where: { id: BANNER_ID } });
    if (!window) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("No banner is running.")] });
      return;
    }
    await prisma.bannerWindow.update({ where: { id: BANNER_ID }, data: { endsAt: new Date() } });
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("◈ Banner window closed immediately.")] });
    return;
  }
}

const command: Command = { data, execute };
export default command;
