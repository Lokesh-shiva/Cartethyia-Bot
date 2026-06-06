import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ChannelType, PermissionFlagsBits,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { loadExploreChannels } from "../../lib/encounter";
import { savePrefixToDb, getPrefix } from "../../lib/prefixManager";

// Build/refresh a guild settings row, returning the fresh record.
async function getSettings(guildId: string) {
  return prisma.guildSettings.upsert({
    where:  { guildId },
    update: {},
    create: { guildId },
  });
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure CARTETHYIA for this server (requires Manage Server).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(s =>
      s.setName("view").setDescription("Show the current server configuration."))
    .addSubcommand(s =>
      s.setName("encounters")
        .setDescription("Enable or disable chat encounters server-wide.")
        .addBooleanOption(o => o.setName("enabled").setDescription("Turn chat encounters on/off").setRequired(true)))
    .addSubcommand(s =>
      s.setName("encounter-channel")
        .setDescription("Add/remove a channel from the encounter allowlist (empty list = everywhere).")
        .addChannelOption(o => o.setName("channel").setDescription("Channel to toggle").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s =>
      s.setName("explore-channel")
        .setDescription("Add/remove a high-rate explore channel.")
        .addChannelOption(o => o.setName("channel").setDescription("Channel to toggle").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s =>
      s.setName("welcome-channel")
        .setDescription("Set (or clear) the channel where new members are auto-onboarded.")
        .addChannelOption(o => o.setName("channel").setDescription("Welcome channel — leave empty to disable auto-onboarding").addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand(s =>
      s.setName("prefix")
        .setDescription("Set or clear a text command prefix (e.g. 'c' → 'c profile', 'c ping').")
        .addStringOption(o => o.setName("value").setDescription("Prefix to use — leave empty to disable").setRequired(false).setMaxLength(5))) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server only.", flags: 64 }); return;
    }
    await interaction.deferReply({ flags: 64 });

    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const s       = await getSettings(guildId);

    // ── View ──────────────────────────────────────────────────────────────
    if (sub === "view") {
      const enc = s.encounterChannelIds.length
        ? s.encounterChannelIds.map(id => `<#${id}>`).join(" ")
        : "*everywhere (no allowlist set)*";
      const exp = s.exploreChannelIds.length
        ? s.exploreChannelIds.map(id => `<#${id}>`).join(" ")
        : "*none*";
      const currentPrefix = getPrefix(guildId);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x6366F1)
          .setTitle("◈  CARTETHYIA — Server Configuration")
          .addFields(
            { name: "Chat Encounters", value: s.encountersEnabled ? "✅ Enabled" : "⛔ Disabled", inline: false },
            { name: "Encounter Channels", value: enc, inline: false },
            { name: "Explore Channels (high-rate)", value: exp, inline: false },
            { name: "Auto-Onboard Channel", value: s.welcomeChannelId ? `<#${s.welcomeChannelId}>` : "*off (members use /start)*", inline: false },
            { name: "Text Prefix", value: currentPrefix ? `\`${currentPrefix}\` (e.g. \`${currentPrefix} profile\`)` : "*disabled — slash commands only*", inline: false },
          )
          .setFooter({ text: "CARTETHYIA  ·  /setup to change" })],
      });
      return;
    }

    // ── Master toggle ─────────────────────────────────────────────────────
    if (sub === "encounters") {
      const enabled = interaction.options.getBoolean("enabled", true);
      await prisma.guildSettings.update({ where: { guildId }, data: { encountersEnabled: enabled } });
      await loadExploreChannels(guildId);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(enabled ? 0x4CAF50 : 0x4A4A5A)
          .setDescription(`Chat encounters are now **${enabled ? "ENABLED" : "DISABLED"}** for this server.`)
          .setFooter({ text: "CARTETHYIA  ·  Setup" })],
      });
      return;
    }

    // ── Encounter channel toggle ──────────────────────────────────────────
    if (sub === "encounter-channel") {
      const ch = interaction.options.getChannel("channel", true);
      const has = s.encounterChannelIds.includes(ch.id);
      const updated = has ? s.encounterChannelIds.filter(id => id !== ch.id) : [...s.encounterChannelIds, ch.id];
      await prisma.guildSettings.update({ where: { guildId }, data: { encounterChannelIds: updated } });
      await loadExploreChannels(guildId);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x80CBC4)
          .setDescription(
            `<#${ch.id}> ${has ? "**removed from**" : "**added to**"} the encounter allowlist.\n\n` +
            (updated.length === 0
              ? "Allowlist is now empty → encounters fire in **all channels**."
              : `Encounters now fire only in: ${updated.map(id => `<#${id}>`).join(" ")} (+ explore channels).`))
          .setFooter({ text: "CARTETHYIA  ·  Setup" })],
      });
      return;
    }

    // ── Welcome channel ───────────────────────────────────────────────────
    if (sub === "welcome-channel") {
      const ch = interaction.options.getChannel("channel");
      await prisma.guildSettings.update({ where: { guildId }, data: { welcomeChannelId: ch?.id ?? null } });
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x6366F1)
          .setDescription(ch
            ? `New members will be auto-onboarded in <#${ch.id}>.`
            : `Auto-onboarding **disabled**. Members can still opt in with \`/start\`.`)
          .setFooter({ text: "CARTETHYIA  ·  Setup" })],
      });
      return;
    }

    // ── Prefix ───────────────────────────────────────────────────────────
    if (sub === "prefix") {
      const value = interaction.options.getString("value")?.trim().toLowerCase() ?? null;
      // Strip trailing ! in case user types "c!" — store only the base prefix
      const cleaned = value?.replace(/!+$/, "") || null;
      await savePrefixToDb(guildId, cleaned);
      const SUPPORTED = ["ping", "profile", "level", "inventory", "echoes", "daily", "ability", "weapon", "leaderboard", "guide"];
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x6366F1)
          .setTitle("◈  Text Prefix Updated")
          .setDescription(cleaned
            ? `Prefix set to \`${cleaned}\`.\n\nSupported commands: ${SUPPORTED.map(c => `\`${cleaned} ${c}\``).join("  ·  ")}`
            : "Text prefix **disabled**. Use slash commands to interact.")
          .setFooter({ text: "CARTETHYIA  ·  Setup" })],
      });
      return;
    }

    // ── Explore channel toggle ────────────────────────────────────────────
    if (sub === "explore-channel") {
      const ch = interaction.options.getChannel("channel", true);
      const has = s.exploreChannelIds.includes(ch.id);
      const updated = has ? s.exploreChannelIds.filter(id => id !== ch.id) : [...s.exploreChannelIds, ch.id];
      await prisma.guildSettings.update({ where: { guildId }, data: { exploreChannelIds: updated } });
      await loadExploreChannels(guildId);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x80CBC4)
          .setDescription(
            `<#${ch.id}> ${has ? "**removed from**" : "**added to**"} explore channels.\n` +
            `Explore channels have a **38%** spawn rate (vs 13% normal) with a 30s cooldown.`)
          .setFooter({ text: "CARTETHYIA  ·  Setup" })],
      });
      return;
    }
  },
};

export default command;
