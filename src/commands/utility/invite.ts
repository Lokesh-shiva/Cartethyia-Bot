import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { getOrCreateReferralCode } from "../../lib/referral";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get your referral code — share it with friends and earn rewards as they progress."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const user = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { isOnboarded: true },
    });
    if (!user?.isOnboarded) { await replyNotStarted(interaction); return; }

    const code = await getOrCreateReferralCode(interaction.user.id);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x6366F1)
        .setTitle("✦  Your Referral Code")
        .setDescription([
          `Share this with a friend. When they run \`/start\` and enter your code, they get **+200 Credits** as a welcome bonus — and you earn rewards every time they hit a major milestone.`,
          ``,
          `\`\`\`${code}\`\`\``,
          ``,
          `**Your rewards as your recruit progresses:**`,
          `◈ Joins & starts → **+500 Credits + 1 Sealing Tube**`,
          `◈ Reaches **Lv20** (Element unlock) → **+1,000 Credits + 1 Tuning Module**`,
          `◈ Wins first **Ascension Trial** → **+1,500 Credits + 1 Paradox Core**`,
          `◈ **Evolves** their ability (Lv50) → **+2,000 Credits + 2 Paradox Cores**`,
          `◈ **Awakens** their weapon (Lv60) → **+5,000 Credits + 3 Paradox Cores + 100 Records**`,
          ``,
          `*Rewards are sent automatically via DM. One referral chain per recruit.*`,
        ].join("\n"))
        .setFooter({ text: "CARTETHYIA  ·  Referral System" })],
    });
  },
};

export default command;
