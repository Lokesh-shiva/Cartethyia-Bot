import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if Cartethyia is online and responsive."),

  async execute(interaction: ChatInputCommandInteraction) {
    const discordBefore = Date.now();
    await interaction.reply({ content: "Measuring..." });
    const discordLatency = Date.now() - discordBefore;

    // Database latency
    const dbBefore = Date.now();
    let dbLatency = 0;
    let dbStatus = "❌ Error";
    try {
      await prisma.user.count();
      dbLatency = Date.now() - dbBefore;
      dbStatus = dbLatency < 300 ? "✅ Connected" : dbLatency < 2500 ? "⚠️ Slow" : "❌ Timeout";
    } catch (e) {
      dbLatency = Date.now() - dbBefore;
      dbStatus = "❌ Offline";
    }

    // LM Studio health (optional, non-blocking)
    let aiStatus = "🔵 Unknown";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const aiBase = (process.env.LM_STUDIO_URL ?? "http://localhost:1234/v1").replace(/\/v1\/?$/, "");
      const res = await fetch(`${aiBase}/v1/models`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);
      aiStatus = res?.ok ? "✅ Online" : "❌ Offline";
    } catch {
      aiStatus = "❌ Unreachable";
    }

    const wsLatency = interaction.client.ws.ping;
    const wsDisplay = wsLatency < 0 ? "*initializing…*" : `\`${wsLatency}ms\``;
    const overallStatus =
      dbStatus.includes("Connected") || dbStatus.includes("Slow") ? "✅ Online" : "❌ Degraded";

    const embed = new EmbedBuilder()
      .setColor(overallStatus.includes("Online") ? 0x10B981 : 0xEF4444)
      .setTitle("🌐 Cartethyia — System Status")
      .addFields(
        { name: "Discord Roundtrip", value: `\`${discordLatency}ms\``, inline: true },
        { name: "WebSocket Ping",    value: wsDisplay,                  inline: true },
        { name: "Status",            value: overallStatus,              inline: true },
        { name: "Database",          value: `${dbStatus} (\`${dbLatency}ms\`)`, inline: true },
        { name: "AI Service",        value: aiStatus,                   inline: true },
        { name: "Uptime",            value: `\`${Math.floor(process.uptime())}s\``, inline: true }
      )
      .setFooter({ text: "Cartethyia • Turn-Based Resonance RPG" })
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
  },
};

export default command;
