import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import { CE } from "../../lib/emojiManager";
import { communityFooter } from "../../lib/communityFooter";
import prisma from "../../lib/prisma";

const VOTE_URL         = "https://discordbotlist.com/bots/cartethyia/upvote";
const VOTE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Upvote Cartethyia on discordbotlist.com and earn rewards."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const weekend    = isWeekend();
    const rewards    = { credits: weekend ? 2000 : 1000, fractureKeys: weekend ? 2 : 1 };
    const weekendNote = weekend ? "\n> 🎉 **Weekend bonus active — rewards are doubled!**\n" : "\n";

    const dbUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { lastVoted: true },
    });

    const lastVoted    = dbUser?.lastVoted;
    const msRemaining  = lastVoted ? VOTE_COOLDOWN_MS - (Date.now() - lastVoted.getTime()) : 0;
    const onCooldown   = msRemaining > 0;

    if (onCooldown) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("✅  Already upvoted — thank you!")
          .setDescription(
            `You can upvote again in **${fmtMs(msRemaining)}**.\n\n` +
            `Every upvote helps Cartethyia reach more players. Come back soon!`
          )
          .setFooter(communityFooter(interaction.guildId, "CARTETHYIA  ·  Voting"))],
      });
      return;
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xa78bfa)
        .setTitle("🗳️  Upvote Cartethyia")
        .setDescription(
          `Support the bot by upvoting on **discordbotlist.com** — it helps more players find Cartethyia!\n` +
          weekendNote +
          `**Rewards per upvote:**\n` +
          `${CE.cr} **${rewards.credits}** Credits\n` +
          `${CE.fk} **${rewards.fractureKeys}** Fracture Key${rewards.fractureKeys !== 1 ? "s" : ""}\n\n` +
          `Rewards are sent automatically via DM once your upvote is confirmed.\n` +
          `You can upvote every **12 hours**.\n\n` +
          `**[→ Upvote here](${VOTE_URL})**`
        )
        .addFields(
          { name: "🌐  Community", value: "[Join our server](https://discord.gg/HwkdQbN3Ec)", inline: true },
          { name: "📋  Bot listing", value: `[discordbotlist.com](https://discordbotlist.com/bots/cartethyia)`, inline: true },
        )
        .setFooter(communityFooter(interaction.guildId, "CARTETHYIA  ·  Voting"))],
    });
  },
};

export default command;
