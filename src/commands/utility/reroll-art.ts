import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import { regenerateArtPrompt } from "../../lib/weaponAwakening";
import prisma from "../../lib/prisma";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("reroll-art")
    .setDescription("Owner only — regenerate the art prompt for your equipped awakened weapon."),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "This command is owner-only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const weapon = await prisma.weapon.findFirst({
      where:  { userId: interaction.user.id, isEquipped: true, awakened: true },
      select: { awakenedName: true, name: true },
    });

    if (!weapon) {
      await interaction.editReply("No awakened weapon equipped.");
      return;
    }

    await interaction.editReply(`Contacting the lore engine for **${weapon.awakenedName ?? weapon.name}**…`);

    const prompt = await regenerateArtPrompt(interaction.user.id);
    if (!prompt) {
      await interaction.editReply("Failed to regenerate — check that LM Studio is running.");
      return;
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFCD34D)
        .setTitle(`✦  Art Prompt — ${weapon.awakenedName ?? weapon.name}`)
        .setDescription(`\`\`\`${prompt}\`\`\``)
        .setFooter({ text: `Drop art at assets/weapons/awakened/${weapon.awakenedName ?? weapon.name}.png` })],
    });
  },
};

export default command;
