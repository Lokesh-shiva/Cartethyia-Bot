import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, TextChannel } from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { sendElementSelection, ELEMENTS } from "../../lib/elementSelect";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("element")
    .setDescription("Choose your Elemental Resonance (unlocks at Level 20)."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl   = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);

    // Already chosen
    if (user.element && user.element !== "NONE") {
      const chosen = ELEMENTS.find((e) => e.value === user.element);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(chosen?.color ?? 0x6366F1)
            .setDescription(`◈ Your element is already set to **${chosen?.emoji} ${chosen?.label}**.\nThis choice is permanent.`)
            .setFooter({ text: "CARTETHYIA  ·  Resonance System" }),
        ],
      });
      return;
    }

    // Not level 20 yet
    if (user.level < 20) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x334155)
            .setDescription(`◈ Elemental Resonance unlocks at **Level 20**.\nYou are currently **Level ${user.level}**.\n\nKeep chatting and using **/vibe** to level up.`)
            .setFooter({ text: "CARTETHYIA  ·  Resonance System" }),
        ],
      });
      return;
    }

    await interaction.editReply({ content: "◈ Opening Resonance Awakening in this channel..." });
    await sendElementSelection(interaction.user.id, displayName, interaction.channel as TextChannel);
  },
};

export default command;
