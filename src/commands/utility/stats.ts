import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { ExtendedClient } from "../../types";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("botstats")
    .setDescription("See how many servers and players are using Cartethyia."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalUsers, activeUsers, totalEchoes, totalWeapons] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastSeen: { gte: sevenDaysAgo } } }),
      prisma.echo.count(),
      prisma.weapon.count(),
    ]);

    // Aggregate combat records
    const combatAgg = await prisma.user.aggregate({
      _sum: { ascensionWins: true, dungeonClears: true, duelWins: true, duelLosses: true },
    });

    const totalAscensions = combatAgg._sum.ascensionWins ?? 0;
    const totalDungeons   = combatAgg._sum.dungeonClears ?? 0;
    const totalDuels      = (combatAgg._sum.duelWins ?? 0) + (combatAgg._sum.duelLosses ?? 0);

    const client    = interaction.client as ExtendedClient;
    const guildCount = client.guilds.cache.size;

    const embed = new EmbedBuilder()
      .setColor(0xa78bfa)
      .setAuthor({ name: "Cartethyia  ·  Bot Statistics", iconURL: client.user?.displayAvatarURL() })
      .setDescription("Live stats across every server Cartethyia calls home.")
      .addFields(
        { name: "🌐  Servers", value: `**${guildCount.toLocaleString()}**`, inline: true },
        { name: "👤  Registered Players", value: `**${totalUsers.toLocaleString()}**`, inline: true },
        { name: "📅  Active (7 days)", value: `**${activeUsers.toLocaleString()}**`, inline: true },
        { name: "🌀  Echoes Collected", value: `**${totalEchoes.toLocaleString()}**`, inline: true },
        { name: "⚔️  Weapons Forged", value: `**${totalWeapons.toLocaleString()}**`, inline: true },
        { name: "​", value: "​", inline: true },
        { name: "🏰  Dungeon Clears", value: `**${totalDungeons.toLocaleString()}**`, inline: true },
        { name: "👑  Ascension Wins", value: `**${totalAscensions.toLocaleString()}**`, inline: true },
        { name: "🥊  Duels Fought", value: `**${totalDuels.toLocaleString()}**`, inline: true },
      )
      .setFooter({ text: "CARTETHYIA  ·  discord.gg/HwkdQbN3Ec" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
