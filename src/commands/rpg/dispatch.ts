import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, AttachmentBuilder,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, awardUser } from "../../lib/economy";
import { checkLevelUp } from "../../lib/progression";
import { generateLootCard } from "../../lib/lootCard";
import { LootResult } from "../../lib/loot";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const ELEMENT_HEX_STR: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#38BDF8", ELECTRO: "#A855F7",
  AERO:   "#10B981", HAVOC:  "#EC4899", SPECTRO: "#EAB308", NONE: "#6366F1",
};

// Dispatch tiers
const DISPATCHES = [
  {
    hours:   4,
    label:   "Short Expedition",
    emoji:   "🌿",
    desc:    "A quick foray into the outskirts.",
    rewards: (level: number, wl: number) => ({
      credits:          Math.floor((40  + level * 3) * (1 + wl * 0.15)),
      resonanceExp:     Math.floor((20  + level * 2) * (1 + wl * 0.10)),
      tuningModules:    Math.random() < 0.30 + wl * 0.05 ? 1 : 0,
      forgingOres:      Math.random() < 0.20 + wl * 0.04 ? 1 : 0,
      sealingTubes:     0,
      resonanceRecords: Math.random() < 0.08 ? 1 : 0,
      paradoxCores:     0,
      stasisLocks:      0,
      lunakite:         0,
    }),
  },
  {
    hours:   8,
    label:   "Standard Expedition",
    emoji:   "⚔️",
    desc:    "A full day's worth of resonance hunting.",
    rewards: (level: number, wl: number) => ({
      credits:          Math.floor((100 + level * 6) * (1 + wl * 0.20)),
      resonanceExp:     Math.floor((50  + level * 4) * (1 + wl * 0.15)),
      tuningModules:    Math.floor(Math.random() * 2) + (wl >= 1 ? 1 : 0),
      forgingOres:      Math.random() < 0.40 + wl * 0.05 ? 1 : 0,
      sealingTubes:     Math.random() < 0.25 + wl * 0.05 ? 1 : 0,
      resonanceRecords: Math.random() < 0.15 ? 1 : 0,
      paradoxCores:     0,
      stasisLocks:      0,
      lunakite:         wl >= 2 && Math.random() < 0.10 ? 1 : 0,
    }),
  },
  {
    hours:   12,
    label:   "Deep Expedition",
    emoji:   "🌌",
    desc:    "Into the deepest resonance zones. Maximum yield.",
    rewards: (level: number, wl: number) => ({
      credits:          Math.floor((200 + level * 10) * (1 + wl * 0.25)),
      resonanceExp:     Math.floor((80  + level * 6)  * (1 + wl * 0.20)),
      tuningModules:    Math.floor(Math.random() * 3) + 1,
      forgingOres:      Math.floor(Math.random() * 2) + (wl >= 1 ? 1 : 0),
      sealingTubes:     Math.random() < 0.50 + wl * 0.05 ? 1 : 0,
      resonanceRecords: Math.random() < 0.25 ? 1 : 0,
      paradoxCores:     wl >= 1 && Math.random() < 0.12 + wl * 0.03 ? 1 : 0,
      stasisLocks:      0,
      lunakite:         wl >= 1 && Math.random() < 0.20 ? 1 : 0,
    }),
  },
];

function formatTimeLeft(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("dispatch")
    .setDescription("Send your character on an AFK expedition to earn passive rewards.")
    .addSubcommand((s) =>
      s.setName("send")
        .setDescription("Send your character on an expedition.")
    )
    .addSubcommand((s) =>
      s.setName("claim")
        .setDescription("Claim rewards from a completed expedition.")
    )
    .addSubcommand((s) =>
      s.setName("status")
        .setDescription("Check your current expedition status.")
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "send")   await handleSend(interaction);
    if (sub === "claim")  await handleClaim(interaction);
    if (sub === "status") await handleStatus(interaction);
  },
};

// ── /dispatch send ────────────────────────────────────────────────────────────
async function handleSend(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName ?? interaction.user.username;
  const avatarUrl   = interaction.user.displayAvatarURL({ size: 64, extension: "png" });
  const user        = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
  const color       = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;

  // Already on dispatch
  if (user.dispatchStatus === "ON_DISPATCH" && user.dispatchEndsAt) {
    const remaining = user.dispatchEndsAt.getTime() - Date.now();
    if (remaining > 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(color)
          .setAuthor({ name: `${displayName}  ·  Dispatch`, iconURL: avatarUrl })
          .setDescription(`◈ You are already on a **${user.dispatchHours}-hour** expedition.\n\nReturns in: **${formatTimeLeft(remaining)}**\n\nUse **/dispatch claim** when ready.`)
          .setFooter({ text: "CARTETHYIA  ·  Dispatch System" })],
      });
      return;
    }
    // Already finished — nudge to claim
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`◈ Your expedition is complete! Use **/dispatch claim** to collect your rewards.`)
        .setFooter({ text: "CARTETHYIA  ·  Dispatch System" })],
    });
    return;
  }

  // Show dispatch options
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${displayName}  ·  Dispatch`, iconURL: avatarUrl })
    .setDescription([
      `Choose your expedition length.`,
      `Longer expeditions yield more and better rewards.`,
      `World Level **${user.worldLevel}** bonus active — rewards scale up.`,
      ``,
      DISPATCHES.map((d) => [
        `${d.emoji}  **${d.label}** — ${d.hours}h`,
        `*${d.desc}*`,
      ].join("\n")).join("\n\n"),
    ].join("\n"))
    .setFooter({ text: "CARTETHYIA  ·  You cannot /duel or /ascend while on dispatch" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    DISPATCHES.map((d) =>
      new ButtonBuilder()
        .setCustomId(`dispatch_${d.hours}`)
        .setLabel(`${d.emoji}  ${d.hours}h`)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const msg = await interaction.editReply({ embeds: [embed], components: [row] });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.user.id === interaction.user.id,
    time:   60_000,
    max:    1,
  });

  collector.on("collect", async (btn) => {
    await btn.deferUpdate();
    const hours   = parseInt(btn.customId.split("_")[1]);
    const dispatch = DISPATCHES.find((d) => d.hours === hours)!;
    const endsAt  = new Date(Date.now() + hours * 3_600_000);

    await prisma.user.update({
      where: { id: interaction.user.id },
      data:  {
        dispatchStatus: "ON_DISPATCH",
        dispatchEndsAt: endsAt,
        dispatchHours:  hours,
      },
    });

    await btn.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setAuthor({ name: `${displayName}  ·  Dispatch`, iconURL: avatarUrl })
        .setTitle(`${dispatch.emoji}  ${dispatch.label} — Begun`)
        .setDescription([
          `*${dispatch.desc}*`,
          ``,
          `◈  Duration: **${hours} hours**`,
          `◈  Returns: **<t:${Math.floor(endsAt.getTime() / 1000)}:R>**`,
          ``,
          `Use **/dispatch claim** when the time is up.`,
        ].join("\n"))
        .setFooter({ text: "CARTETHYIA  ·  Dispatch System" })],
      components: [],
    });
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") await interaction.editReply({ components: [] }).catch(() => {});
  });
}

// ── /dispatch claim ───────────────────────────────────────────────────────────
async function handleClaim(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName ?? interaction.user.username;
  const avatarUrl   = interaction.user.displayAvatarURL({ size: 64, extension: "png" });
  const user        = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
  const color       = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
  const elHex       = ELEMENT_HEX_STR[user.element] ?? "#6366F1";

  if (user.dispatchStatus !== "ON_DISPATCH" || !user.dispatchEndsAt) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x334155)
        .setDescription(`◈ You aren't on an expedition.\nUse **/dispatch send** to begin one.`)
        .setFooter({ text: "CARTETHYIA  ·  Dispatch System" })],
    });
    return;
  }

  const remaining = user.dispatchEndsAt.getTime() - Date.now();
  if (remaining > 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setAuthor({ name: `${displayName}  ·  Dispatch`, iconURL: avatarUrl })
        .setDescription(`◈ Your expedition isn't done yet.\n\nReturns **<t:${Math.floor(user.dispatchEndsAt.getTime() / 1000)}:R>** (${formatTimeLeft(remaining)} remaining)`)
        .setFooter({ text: "CARTETHYIA  ·  Dispatch System" })],
    });
    return;
  }

  // Roll rewards
  const dispatch = DISPATCHES.find((d) => d.hours === user.dispatchHours)
    ?? DISPATCHES[0];
  const raw      = dispatch.rewards(user.level, user.worldLevel);

  const loot: LootResult = { ...raw, isMultiplied: false };

  // Award and reset dispatch
  await awardUser(interaction.user.id, loot);
  await prisma.user.update({
    where: { id: interaction.user.id },
    data:  { dispatchStatus: "IDLE", dispatchEndsAt: null, dispatchHours: null },
  });

  await checkLevelUp(interaction.user.id);

  // Generate loot card
  const card       = await generateLootCard({ loot, actorName: displayName, elementColor: elHex, affinity: null, isReturn: false });
  const attachment = new AttachmentBuilder(card, { name: "dispatch.png" });

  const dispatch_meta = DISPATCHES.find((d) => d.hours === user.dispatchHours)!;

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(color)
      .setAuthor({ name: `${displayName}  ·  Expedition Complete`, iconURL: avatarUrl })
      .setTitle(`${dispatch_meta?.emoji ?? "🌿"}  ${dispatch_meta?.label ?? "Expedition"} — Returned`)
      .setDescription(`Your character has returned from a **${user.dispatchHours}-hour** expedition.\n\nHere's what they brought back:`)
      .setImage("attachment://dispatch.png")
      .setFooter({ text: "CARTETHYIA  ·  Dispatch System  ·  Send another with /dispatch send" })],
    files: [attachment],
  });
}

// ── /dispatch status ──────────────────────────────────────────────────────────
async function handleStatus(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName ?? interaction.user.username;
  const avatarUrl   = interaction.user.displayAvatarURL({ size: 64, extension: "png" });
  const user        = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
  const color       = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;

  if (user.dispatchStatus !== "ON_DISPATCH" || !user.dispatchEndsAt) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x334155)
        .setDescription(`◈ You are not on an expedition.\nUse **/dispatch send** to begin one.`)
        .setFooter({ text: "CARTETHYIA  ·  Dispatch System" })],
    });
    return;
  }

  const remaining  = user.dispatchEndsAt.getTime() - Date.now();
  const dispatch   = DISPATCHES.find((d) => d.hours === user.dispatchHours)!;
  const totalMs    = (user.dispatchHours ?? 4) * 3_600_000;
  const progress   = Math.min(100, Math.floor(((totalMs - remaining) / totalMs) * 100));
  const filled     = Math.round(progress / 10);
  const bar        = "▰".repeat(filled) + "▱".repeat(10 - filled);

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(color)
      .setAuthor({ name: `${displayName}  ·  Expedition Status`, iconURL: avatarUrl })
      .setDescription([
        `${dispatch.emoji}  **${dispatch.label}** — ${user.dispatchHours}h`,
        ``,
        `\`${bar}\`  ${progress}%`,
        ``,
        remaining > 0
          ? `◈  Returns **<t:${Math.floor(user.dispatchEndsAt.getTime() / 1000)}:R>** (${formatTimeLeft(remaining)} left)`
          : `◈  **Complete!** Use **/dispatch claim** to collect.`,
      ].join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Dispatch System" })],
  });
}

export default command;
