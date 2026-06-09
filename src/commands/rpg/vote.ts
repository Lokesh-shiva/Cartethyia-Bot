import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import { CE } from "../../lib/emojiManager";
import { communityFooter } from "../../lib/communityFooter";
import prisma from "../../lib/prisma";

const TOPGG_TOKEN  = process.env.TOPGG_TOKEN ?? "";
const BOT_ID       = process.env.CLIENT_ID   ?? "1510163339177623642";
const VOTE_URL     = `https://top.gg/bot/${BOT_ID}/vote`;
const VOTE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // top.gg allows vote every 12h

function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function hasVotedRecently(userId: string): Promise<boolean> {
  if (!TOPGG_TOKEN) {
    // Fallback: check DB lastVoted
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastVoted: true } });
    if (!user?.lastVoted) return false;
    return Date.now() - user.lastVoted.getTime() < VOTE_COOLDOWN_MS;
  }

  try {
    const res  = await fetch(`https://top.gg/api/bots/${BOT_ID}/check?userId=${userId}`, {
      headers: { Authorization: TOPGG_TOKEN },
    });
    const data = await res.json() as { voted: number };
    return data.voted === 1;
  } catch {
    return false;
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Vote for Cartethyia on top.gg and earn rewards."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const weekend  = isWeekend();
    const rewards  = { credits: weekend ? 2000 : 1000, fractureKeys: weekend ? 2 : 1 };
    const weekendNote = weekend ? "\n> 🎉 **Weekend bonus active — rewards are doubled!**" : "";

    // Check cooldown from DB
    const dbUser = await prisma.user.findUnique({
      where: { id: interaction.user.id },
      select: { lastVoted: true },
    });

    const lastVoted = dbUser?.lastVoted;
    const msRemaining = lastVoted
      ? VOTE_COOLDOWN_MS - (Date.now() - lastVoted.getTime())
      : 0;

    const voted = lastVoted && msRemaining > 0;

    // Also check live top.gg if token available
    const liveVoted = voted ? true : await hasVotedRecently(interaction.user.id);

    if (liveVoted && msRemaining > 0) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅  Already voted — thank you!")
        .setDescription(
          `You can vote again in **${fmtMs(msRemaining)}**.\n\n` +
          `Voting supports Cartethyia and helps more players find it. ` +
          `Come back soon!`
        )
        .setFooter(communityFooter(interaction.guildId, "CARTETHYIA  ·  Voting"));

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xa78bfa)
      .setTitle("🗳️  Vote for Cartethyia")
      .setDescription(
        `Support the bot by voting on **top.gg** — it helps more players discover Cartethyia!\n` +
        weekendNote +
        `\n\n**Rewards per vote:**\n` +
        `${CE.cr} **${rewards.credits}** Credits\n` +
        `${CE.fk} **${rewards.fractureKeys}** Fracture Key${rewards.fractureKeys !== 1 ? "s" : ""}\n\n` +
        `Rewards are delivered automatically after your vote is confirmed.\n` +
        `You can vote every **12 hours**.\n\n` +
        `**[→ Click here to vote](${VOTE_URL})**`
      )
      .addFields(
        { name: "🌐  Community", value: "[Join our server](https://discord.gg/HwkdQbN3Ec)", inline: true },
        { name: "📋  Bot listing", value: `[top.gg page](https://top.gg/bot/${BOT_ID})`, inline: true },
      )
      .setFooter(communityFooter(interaction.guildId, "CARTETHYIA  ·  Voting"));

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
