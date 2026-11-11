import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import prisma from "../../lib/prisma";
import { CHAPTERS, getChapter } from "../../lib/story/chapters";
import { canReschedule } from "../../lib/story/release";

export const data = new SlashCommandBuilder()
  .setName("owner-story")
  .setDescription("Owner only - manage story chapter releases.")
  .addSubcommand(s => s.setName("status").setDescription("Show every chapter's release state."))
  .addSubcommand(s => s.setName("release").setDescription("Release a chapter right now.")
    .addIntegerOption(o => o.setName("chapter").setDescription("Chapter number").setRequired(true).setMinValue(1)))
  .addSubcommand(s => s.setName("schedule").setDescription("Schedule a chapter's release in N days.")
    .addIntegerOption(o => o.setName("chapter").setDescription("Chapter number").setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName("days").setDescription("Days from now").setRequired(true).setMinValue(0).setMaxValue(365))) as SlashCommandBuilder;

export const command: Command = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) { await interaction.reply({ content: "Owner only.", flags: 64 }); return; }
    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand();
    const now = new Date();

    if (sub === "status") {
      const rows = await prisma.storyRelease.findMany();
      const lines = CHAPTERS.map(c => {
        const r = rows.find(x => x.chapterId === c.id);
        const when = !r ? "not scheduled" : r.releaseAt <= now ? `released${r.announcedAt ? ", announced" : ", announcement pending"}` : `scheduled <t:${Math.floor(r.releaseAt.getTime() / 1000)}:R>`;
        return `**${c.id}. ${c.title}** - ${when}`;
      });
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xff7a3d).setTitle("Story releases").setDescription(lines.join("\n"))] });
      return;
    }

    const chapterId = interaction.options.getInteger("chapter", true);
    if (!getChapter(chapterId)) { await interaction.editReply(`Chapter ${chapterId} does not exist.`); return; }
    const existing = await prisma.storyRelease.findUnique({ where: { chapterId } });

    if (sub === "release") {
      if (existing && existing.releaseAt <= now) { await interaction.editReply("That chapter is already released."); return; }
      await prisma.storyRelease.upsert({ where: { chapterId }, create: { chapterId, releaseAt: now }, update: { releaseAt: now, announcedAt: null } });
      await interaction.editReply(`Chapter ${chapterId} is live. The announcement posts within 5 minutes.`);
      return;
    }

    const days = interaction.options.getInteger("days", true);
    if (!canReschedule(existing, now)) { await interaction.editReply("That chapter is already released and can't be rescheduled."); return; }
    const releaseAt = new Date(now.getTime() + days * 86_400_000);
    await prisma.storyRelease.upsert({ where: { chapterId }, create: { chapterId, releaseAt }, update: { releaseAt, announcedAt: null } });
    await interaction.editReply(`Chapter ${chapterId} will release <t:${Math.floor(releaseAt.getTime() / 1000)}:F>.`);
  },
};
