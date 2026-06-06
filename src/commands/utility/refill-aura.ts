import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { MAX_AURA } from "../../lib/aura";
import { isOwner } from "../../lib/owner";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("refill-aura")
    .setDescription("Dev only — refill Resonance Aura to max for a user.")
    .setDefaultMemberPermissions(0)
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to refill (defaults to yourself).")
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "❌ Owner only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const target      = interaction.options.getUser("user") ?? interaction.user;
    const displayName = interaction.guild?.members.cache.get(target.id)?.displayName
                     ?? target.displayName ?? target.username;

    const user = await prisma.user.findUnique({ where: { id: target.id } });
    if (!user) {
      await interaction.editReply({ content: `❌ ${displayName} hasn't started yet.` });
      return;
    }

    await prisma.user.update({
      where: { id: target.id },
      data:  { resonanceAura: MAX_AURA, auraUpdatedAt: new Date() },
    });

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x6366F1)
        .setDescription(`◈◈◈◈◈  **${displayName}'s** Resonance Aura refilled to **${MAX_AURA}/${MAX_AURA}**.`)
        .setFooter({ text: "CARTETHYIA  ·  Dev" })],
    });
  },
};

export default command;
export const { data, execute } = command;
