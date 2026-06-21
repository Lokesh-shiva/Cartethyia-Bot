import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import { CE } from "../../lib/emojiManager";
import { communityFooter } from "../../lib/communityFooter";
import prisma from "../../lib/prisma";

const DBL_VOTE_URL     = "https://discordbotlist.com/bots/cartethyia/upvote";
const TOPGG_VOTE_URL   = "https://top.gg/bot/1510163339177623642/vote";
const RANKTOP_VOTE_URL = "https://rank.top/bot/cartethyia";
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
    .setDescription("Upvote Cartethyia on top.gg or discordbotlist.com and earn rewards."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const weekend    = isWeekend();
    const rewards    = { credits: weekend ? 2000 : 1000, fractonite: weekend ? 40 : 20 };
    const weekendNote = weekend ? "\n> 🎉 **Weekend bonus active — rewards are doubled!**\n" : "\n";

    const dbUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { lastVoted: true },
    });

    const lastVoted   = dbUser?.lastVoted;
    const msRemaining = lastVoted ? VOTE_COOLDOWN_MS - (Date.now() - lastVoted.getTime()) : 0;
    const onCooldown  = msRemaining > 0;

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
          `Support the bot by upvoting — it helps more players find Cartethyia!\n` +
          weekendNote +
          `**Rewards per upvote (per site, every 12 hours):**\n` +
          `${CE.cr} **${rewards.credits}** Credits\n` +
          `${CE.ft} **${rewards.fractonite}** Fractonite\n\n` +
          `Rewards arrive automatically via DM after your vote is confirmed.\n\n` +
          `**[→ Upvote on top.gg](${TOPGG_VOTE_URL})**\n` +
          `**[→ Upvote on discordbotlist.com](${DBL_VOTE_URL})**\n` +
          `**[→ Upvote on rank.top](${RANKTOP_VOTE_URL})**`
        )
        .addFields(
          { name: "🌐  Community",   value: "[Join our server](https://discord.gg/vgVmRMc2Gb)", inline: true },
          { name: "📋  top.gg",      value: `[top.gg/bot/cartethyia](https://top.gg/bot/1510163339177623642)`, inline: true },
          { name: "📋  DBL",         value: `[discordbotlist.com](https://discordbotlist.com/bots/cartethyia)`, inline: true },
          { name: "📋  rank.top",    value: `[rank.top/bot/cartethyia](https://rank.top/bot/cartethyia)`, inline: true },
        )
        .setFooter(communityFooter(interaction.guildId, "CARTETHYIA  ·  Voting"))],
    });
  },
};

export default command;
