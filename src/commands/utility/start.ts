import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import { Command } from "../../types";
import { sendOnboarding } from "../../lib/onboarding";
import { GuildMember } from "discord.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Begin your Cartethyia journey — shows the welcome guide.")
    .addStringOption(opt =>
      opt.setName("referral")
        .setDescription("Referral code from a friend (optional)")
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(interaction.member instanceof GuildMember)) {
      await interaction.reply({ content: "This command only works in a server.", flags: 64 });
      return;
    }

    const referralCode = interaction.options.getString("referral") ?? undefined;
    await interaction.reply({ content: "◈ Initialising your Resonance...", flags: 64 });

    await sendOnboarding(
      interaction.member,
      interaction.channel as TextChannel,
      undefined,
      referralCode,
    );
  },
};

export default command;
