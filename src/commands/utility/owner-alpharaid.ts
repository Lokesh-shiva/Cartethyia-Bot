// src/commands/utility/owner-alpharaid.ts
// Owner-only, global trigger. Fans out a recruiting announcement + Join
// button to every guild the bot is in. Each guild gets its own
// AlphaRaidInstance with a 72h kill-window deadline (see design spec
// docs/superpowers/specs/2026-09-12-alpha-raid-design.md).
import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AutocompleteInteraction,
} from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import prisma from "../../lib/prisma";
import { resolveAlphaRaidChannel } from "../../lib/alphaRaidChannel";
import { buildAlphaRaidRecruitEmbed, buildAlphaRaidRecruitRow } from "../../lib/alphaRaidEmbed";
import { CHARACTER_KITS } from "../../lib/characterKit";
import "../../lib/kits";

const KILL_WINDOW_HOURS = 72;

export const data = new SlashCommandBuilder()
  .setName("owner-alpharaid")
  .setDescription("Owner only — trigger a global Alpha Raid event across every server.")
  .addSubcommand(s => s.setName("start")
    .setDescription("Fire the event now.")
    .addStringOption(o => o.setName("character")
      .setDescription("Which character's kit the boss uses.")
      .setRequired(true)
      .setAutocomplete(true))
    .addIntegerOption(o => o.setName("fracture-keys")
      .setDescription("Override the default Fracture Key reward per participant (default 10).")
      .setRequired(false).setMinValue(0))
    .addIntegerOption(o => o.setName("radiant-keys")
      .setDescription("Override the default Radiant Key reward per participant (default 10).")
      .setRequired(false).setMinValue(0))
    .addIntegerOption(o => o.setName("fractonite")
      .setDescription("Override the default Fractonite reward per participant (default 1500).")
      .setRequired(false).setMinValue(0))
    .addStringOption(o => o.setName("test-guild-id")
      .setDescription("Testing only — restrict to a single server ID instead of firing globally.")
      .setRequired(false))) as SlashCommandBuilder;

export const command: Command = {
  data,
  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.values(CHARACTER_KITS)
      .filter(kit => kit.label.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(kit => ({ name: kit.label, value: kit.id }));
    await interaction.respond(choices).catch(() => {});
  },
  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "Owner only.", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });

    const characterId = interaction.options.getString("character", true);
    const testGuildId = interaction.options.getString("test-guild-id");

    if (!CHARACTER_KITS[characterId]) {
      await interaction.editReply({ content: `⚡ Unknown character id \`${characterId}\` — pick one from the autocomplete list.` });
      return;
    }

    const targetGuilds = testGuildId
      ? [...interaction.client.guilds.cache.values()].filter(g => g.id === testGuildId)
      : [...interaction.client.guilds.cache.values()];

    if (testGuildId && targetGuilds.length === 0) {
      await interaction.editReply({ content: `⚡ Bot isn't in a server with ID \`${testGuildId}\`.` });
      return;
    }

    const triggeredAt = new Date();
    const deadlineAt = new Date(triggeredAt.getTime() + KILL_WINDOW_HOURS * 60 * 60 * 1000);

    const event = await prisma.alphaRaidEvent.create({
      data: {
        triggeredBy: interaction.user.id, triggeredAt,
        bossCharacterId: characterId,
        fractureKeysReward: interaction.options.getInteger("fracture-keys") ?? 10,
        radiantKeysReward:  interaction.options.getInteger("radiant-keys")  ?? 10,
        fractoniteReward:   interaction.options.getInteger("fractonite")    ?? 1500,
      },
    });

    let posted = 0, skipped = 0;
    for (const guild of targetGuilds) {
      const channel = await resolveAlphaRaidChannel(guild).catch(() => null);
      if (!channel) { skipped++; continue; }

      const instance = await prisma.alphaRaidInstance.create({
        data: { eventId: event.id, guildId: guild.id, channelId: channel.id, deadlineAt },
      });

      const joinRow = buildAlphaRaidRecruitRow(instance.id);

      const msg = await channel.send({ embeds: [buildAlphaRaidRecruitEmbed(0, deadlineAt)], components: [joinRow] }).catch(() => null);
      if (!msg) { skipped++; continue; }

      await prisma.alphaRaidInstance.update({ where: { id: instance.id }, data: { messageId: msg.id } });
      posted++;
    }

    await interaction.editReply({
      content: `⚡ Alpha Raid triggered (boss: **${CHARACTER_KITS[characterId]!.label}**)${testGuildId ? " (test mode — single server)" : ""} — posted in **${posted}** server(s), skipped **${skipped}** (no spawn channel configured).`,
    });
  },
};

export default command;
