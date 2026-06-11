import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import { regenerateArtPrompt } from "../../lib/weaponAwakening";
import prisma from "../../lib/prisma";

const command: Command = {
  data: (new SlashCommandBuilder()
    .setName("reroll-art")
    .setDescription("Owner only — regenerate the art prompt for a player's equipped awakened weapon.")
    .addUserOption(o => o.setName("player").setDescription("Target player (defaults to you)").setRequired(false))
  ) as any,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "This command is owner-only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const target   = interaction.options.getUser("player") ?? interaction.user;
    const targetId = target.id;

    const weapon = await prisma.weapon.findFirst({
      where:  { userId: targetId, isEquipped: true, awakened: true },
      select: { awakenedName: true, name: true },
    });

    if (!weapon) {
      await interaction.editReply(`${target.username} has no awakened weapon equipped.`);
      return;
    }

    await interaction.editReply(`Contacting the lore engine for **${weapon.awakenedName ?? weapon.name}** (${target.username})…`);

    const prompt = await regenerateArtPrompt(targetId);
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
