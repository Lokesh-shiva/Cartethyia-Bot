import { Events, Interaction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, PermissionFlagsBits } from "discord.js";
import { ExtendedClient } from "../types";
import { handleEncounterFight, getBotChannelIds } from "../lib/encounter";
import { runFirstExpedition } from "../lib/firstExpedition";
import { logError } from "../lib/logger";
import { grantDrifterRole } from "../lib/supportServer";
import { buildTournamentSignupEmbed } from "../lib/tournamentSweep";
import { buildAlphaRaidRecruitEmbed, buildAlphaRaidRecruitRow } from "../lib/alphaRaidEmbed";
import { isOwner } from "../lib/owner";
import { startAlphaRaidFight } from "../commands/rpg/raid";
import { buildAlphaRaidBoss, alphaRaidBossArtPath } from "../lib/alphaRaidBoss";
import prisma from "../lib/prisma";

export const name = Events.InteractionCreate;
export const once = false;

// ── Per-user cooldown ─────────────────────────────────────────────────────────
// userId → commandName → last used timestamp
const cooldowns = new Map<string, Map<string, number>>();
const COOLDOWN_MS = 5_000;

// View-only commands that don't need a cooldown
const NO_COOLDOWN = new Set([
  // View-only / display commands — no cooldown needed
  "profile", "echoes", "echo", "inventory", "level", "weapon",
  "ability", "guide", "leaderboard", "affinity",
  "ping", "debugprofile", "debugability", "explore-channel",
  // Long-running fights handle their own guards internally
  "ascend", "boss", "dungeon", "field-boss", "duel", "raid",
  // Dispatch subcommands that are reads
  "dispatch",
]);

function checkCooldown(userId: string, commandName: string): number {
  if (NO_COOLDOWN.has(commandName)) return 0;

  if (!cooldowns.has(userId)) cooldowns.set(userId, new Map());
  const userCDs  = cooldowns.get(userId)!;
  const lastUsed = userCDs.get(commandName) ?? 0;
  const elapsed  = Date.now() - lastUsed;

  if (elapsed < COOLDOWN_MS) return Math.ceil((COOLDOWN_MS - elapsed) / 1000);

  userCDs.set(commandName, Date.now());
  return 0;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function execute(interaction: Interaction) {
  // ── Button interactions ────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const { customId } = interaction;

    if (customId === "encounter_fight") {
      await handleEncounterFight(interaction).catch((e: any) => {
        if (e?.code !== 10062) console.error(e);
      });
      return;
    }

    if (customId.startsWith("welcome_start_")) {
      const targetId = customId.replace("welcome_start_", "");
      if (interaction.user.id !== targetId) {
        await interaction.reply({ content: "◈ This invitation isn't yours.", flags: 64 });
        return;
      }

      const START_CHANNEL_ID = process.env.START_CHANNEL_ID ?? "1516683590140690502";

      // Safety net alongside the guildMemberAdd.ts join grant — covers anyone who
      // somehow reached this button without having gotten the role on join.
      await grantDrifterRole(interaction.client, targetId).catch(() => {});

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel("Journey Begun")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
      await interaction.update({ components: [disabledRow] }).catch(() => {});

      await interaction.followUp({
        flags: 64,
        content:
          `◈ Head over to <#${START_CHANNEL_ID}> and run \`/start\` (or \`c!start\`) to begin your resonance calibration and unlock the server.\n\n` +
          `Run \`/help\` or \`c!guide\` anytime for a full tutorial.`,
      }).catch(() => {});
      return;
    }

    if (customId.startsWith("expedition_start_")) {
      const targetId = customId.replace("expedition_start_", "");
      if (interaction.user.id !== targetId) {
        await interaction.reply({ content: "◈ This isn't your expedition.", flags: 64 });
        return;
      }

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel("Expedition Started")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
      await interaction.update({ components: [disabledRow] }).catch(() => {});

      const member = interaction.guild?.members.cache.get(interaction.user.id)
        ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (!member || !interaction.channel?.isTextBased()) return;

      runFirstExpedition(member, interaction.channel as TextChannel).catch(console.error);
      return;
    }

    if (customId === "tournament_join" || customId.startsWith("tournament_join_")) {
      // Bare "tournament_join" (no id suffix) is a pre-fix signup message still
      // live in some channel — fall back to that guild's active SIGNUP
      // tournament instead of parsing an id out of the customId.
      const tournamentId = customId === "tournament_join" ? null : customId.replace("tournament_join_", "");
      const tournament = tournamentId
        ? await prisma.tournament.findUnique({ where: { id: tournamentId } })
        : await prisma.tournament.findFirst({ where: { guildId: interaction.guildId ?? undefined, phase: "SIGNUP" } });
      if (!tournament || tournament.phase !== "SIGNUP") {
        await interaction.reply({ content: "Signups are closed.", flags: 64 });
        return;
      }
      const count = await prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id } });
      const already = await prisma.tournamentParticipant.findUnique({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: interaction.user.id } },
      });
      if (already) {
        await interaction.reply({ content: "You're already signed up.", flags: 64 });
        return;
      }
      if (count >= tournament.maxPlayers) {
        await interaction.reply({ content: "Tournament is full.", flags: 64 });
        return;
      }
      await prisma.tournamentParticipant.create({
        data: { tournamentId: tournament.id, userId: interaction.user.id, seed: count + 1 },
      }).catch(() => null); // unique-constraint race: a double-click loses the race harmlessly
      const newCount = await prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id } });
      // Upgrade a legacy bare-id button to the id-suffixed form on first use,
      // so it's durable going forward even though it started out stale.
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`tournament_join_${tournament.id}`).setLabel("⚔️  Join Tournament").setStyle(ButtonStyle.Success),
      );
      await interaction.update({
        embeds: [buildTournamentSignupEmbed(tournament.maxPlayers, tournament.signupEndsAt, tournament.roundHours, newCount)],
        components: [row],
      }).catch(() => {});
      return;
    }

    if (customId.startsWith("alpharaid_join_")) {
      const instanceId = customId.replace("alpharaid_join_", "");
      const instance = await prisma.alphaRaidInstance.findUnique({ where: { id: instanceId } });
      if (!instance || instance.phase !== "RECRUITING") {
        await interaction.reply({ content: "This Alpha Raid isn't open for joining anymore.", flags: 64 });
        return;
      }
      const already = await prisma.alphaRaidParticipant.findUnique({
        where: { instanceId_userId: { instanceId, userId: interaction.user.id } },
      });
      if (already) {
        await interaction.reply({ content: "You're already in.", flags: 64 });
        return;
      }
      await prisma.alphaRaidParticipant.create({
        data: { instanceId, userId: interaction.user.id },
      }).catch(() => null); // unique-constraint race: a double-click loses the race harmlessly

      const newCount = await prisma.alphaRaidParticipant.count({ where: { instanceId } });
      await interaction.update({
        embeds: [buildAlphaRaidRecruitEmbed(newCount, instance.deadlineAt)],
        components: [buildAlphaRaidRecruitRow(instanceId)],
      }).catch(() => {});
      return;
    }

    if (customId.startsWith("alpharaid_begin_")) {
      const instanceId = customId.replace("alpharaid_begin_", "");
      const canManage = (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false) || isOwner(interaction.user.id);
      if (!canManage) {
        await interaction.reply({ content: "You need **Manage Server** to begin this fight.", flags: 64 });
        return;
      }

      const instance = await prisma.alphaRaidInstance.findUnique({
        where: { id: instanceId },
        include: { participants: true, event: true },
      });
      if (!instance || instance.phase !== "RECRUITING") {
        await interaction.reply({ content: "This Alpha Raid isn't open to begin anymore.", flags: 64 });
        return;
      }
      if (instance.participants.length < 2) {
        await interaction.reply({ content: "Need at least 2 joined players to begin.", flags: 64 });
        return;
      }

      const boss = buildAlphaRaidBoss(instance.event.bossCharacterId);
      if (!boss) {
        await interaction.reply({ content: "That character's kit is no longer available — contact the bot owner.", flags: 64 });
        return;
      }

      await interaction.deferUpdate();

      const guild = interaction.guild;
      const channel = guild ? await guild.channels.fetch(instance.channelId).catch(() => null) : null;
      if (!channel || !channel.isTextBased()) {
        await interaction.followUp({ content: "Couldn't reach the announcement channel — it may have been deleted.", flags: 64 }).catch(() => {});
        return;
      }

      const members = guild
        ? await guild.members.fetch({ user: instance.participants.map(p => p.userId) }).catch(() => null)
        : null;
      const displayNameOf = (userId: string) => members?.get(userId)?.displayName ?? userId;

      const result = await startAlphaRaidFight(
        channel as TextChannel, instance.channelId, instance.guildId, interaction.user.id,
        boss,
        instance.participants.map(p => ({ userId: p.userId, displayName: displayNameOf(p.userId) })),
        {
          characterId: instance.event.bossCharacterId,
          statMultiplier: 1.5,
          evasionChance: 0.18,
          bossArtPathOverride: alphaRaidBossArtPath(instance.event.bossCharacterId),
          bonusReward: {
            fractureKeys: instance.event.fractureKeysReward,
            radiantKeys:  instance.event.radiantKeysReward,
            fractonite:   instance.event.fractoniteReward,
          },
          onComplete: async (won: boolean) => {
            await prisma.alphaRaidInstance.update({
              where: { id: instanceId },
              data: { phase: won ? "COMPLETE" : "EXPIRED" },
            }).catch(() => {});
          },
        },
      );

      if (!result.ok) {
        await interaction.followUp({ content: result.reason, flags: 64 }).catch(() => {});
        return;
      }

      await prisma.alphaRaidInstance.update({ where: { id: instanceId }, data: { phase: "FIGHTING" } }).catch(() => {});
      return;
    }

    // All other buttons (vibe return, ascend, bond) handled by collectors in their commands
    return;
  }

  if (interaction.isAutocomplete()) {
    const client  = interaction.client as ExtendedClient;
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      await command.autocomplete(interaction).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const client  = interaction.client as ExtendedClient;
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`[CMD] Unknown command: ${interaction.commandName}`);
    return;
  }

  // ── Bot channel restriction (skip for /setup so admins can always reach it) ──
  if (interaction.commandName !== "setup" && interaction.guildId) {
    const allowed = getBotChannelIds(interaction.guildId);
    if (allowed.size > 0 && !allowed.has(interaction.channelId)) {
      await interaction.reply({
        content: `◈ Commands only work in designated bot channels here. Check <#${[...allowed][0]}> or ask an admin.`,
        flags: 64,
      });
      return;
    }
  }

  // ── Cooldown check ─────────────────────────────────────────────────────────
  const remaining = checkCooldown(interaction.user.id, interaction.commandName);
  if (remaining > 0) {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x4A4A5A)
        .setDescription(`◇  Slow down — \`/${interaction.commandName}\` is on cooldown.\nTry again in **${remaining}s**.`)
        .setFooter({ text: "CARTETHYIA  ·  5s cooldown per command" })],
      flags: 64,
    });
    return;
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  try {
    await command.execute(interaction);
  } catch (error: any) {
    // 10062 = Unknown Interaction — Discord's 3s ack window expired. Silently drop.
    if (error?.code === 10062) return;

    logError(error, {
      source:  `command /${interaction.commandName}`,
      userId:  interaction.user.id,
      guild:   interaction.guildId ?? "DM",
      extra:   interaction.options.data.map(o => `${o.name}=${o.value}`).join(", ") || undefined,
    });

    const errorEmbed = new EmbedBuilder()
      .setColor(0xFF4F6D)
      .setTitle("⚠️ Resonance Disruption")
      .setDescription("Something went wrong processing that command. Please try again.")
      .setTimestamp();

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [errorEmbed], flags: 64 }).catch(() => {});
    }
  }
}
