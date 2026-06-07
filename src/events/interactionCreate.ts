import { Events, Interaction, EmbedBuilder } from "discord.js";
import { ExtendedClient } from "../types";
import { handleEncounterFight } from "../lib/encounter";
import { logError } from "../lib/logger";

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
      await handleEncounterFight(interaction).catch(console.error);
      return;
    }
    // All other buttons (vibe return, ascend, bond) handled by collectors in their commands
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const client  = interaction.client as ExtendedClient;
  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`[CMD] Unknown command: ${interaction.commandName}`);
    return;
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
  } catch (error) {
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
