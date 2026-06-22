import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { replyNotStarted, awardUser } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import prisma from "../../lib/prisma";
import { schedulePatronDailyReminder, clearPatronDailyReminder } from "../../lib/dailyReminder";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const PATRON_GOLD = 0xFCD34D;
const CLAIM_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000;       // 20 hours (same as /daily)

interface PatronTierDef {
  name:      string;
  price:     string;
  auraMax:   number;
  bundle:    string;
  daily:     string;
  rewards:   { lunakite: number; fractonite: number; auraPrisms: number; };
  dailyRewards: { fractonite: number; credits: number; };
}

const PATRON_TIERS: Record<number, PatronTierDef> = {
  1: {
    name:    "Attuned",
    price:   "$3/mo",
    auraMax: 5,
    bundle:  `${CE.lk} 2 Lunakite · 🔷 80 Fractonite`,
    daily:   `🔷 10 Fractonite · 💠 150 Credits`,
    rewards:      { lunakite: 2, fractonite: 80,  auraPrisms: 0 },
    dailyRewards: { fractonite: 10, credits: 150 },
  },
  2: {
    name:    "Ascendant",
    price:   "$5/mo",
    auraMax: 6,
    bundle:  `${CE.lk} 5 Lunakite · 🔷 200 Fractonite · 🔆 1 Aura Prism`,
    daily:   `🔷 20 Fractonite · 💠 300 Credits`,
    rewards:      { lunakite: 5, fractonite: 200, auraPrisms: 1 },
    dailyRewards: { fractonite: 20, credits: 300 },
  },
  3: {
    name:    "Calamity",
    price:   "$10/mo",
    auraMax: 8,
    bundle:  `${CE.lk} 12 Lunakite · 🔷 500 Fractonite · 🔆 3 Aura Prisms`,
    daily:   `🔷 40 Fractonite · 💠 500 Credits`,
    rewards:      { lunakite: 12, fractonite: 500, auraPrisms: 3 },
    dailyRewards: { fractonite: 40, credits: 500 },
  },
};

function fmtMs(ms: number): string {
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("patron")
    .setDescription("Patreon supporter commands.")
    .addSubcommand(s =>
      s.setName("info").setDescription("View Patreon tiers and your current benefits.")
    )
    .addSubcommand(s =>
      s.setName("claim").setDescription("Claim your monthly Patreon bundle.")
    )
    .addSubcommand(s =>
      s.setName("daily").setDescription("Claim your daily Patreon reward.")
    )
    .addSubcommand(s =>
      s.setName("redeem")
        .setDescription("Activate your Patreon tier with a code sent by the owner.")
        .addStringOption(o =>
          o.setName("code").setDescription("Your activation code (e.g. CALAMITY-X7K2-9QMP).").setRequired(true)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "info")   await handleInfo(interaction);
    if (sub === "claim")  await handleClaim(interaction);
    if (sub === "daily")  await handleDaily(interaction);
    if (sub === "redeem") await handleRedeem(interaction);
  },
};

async function handleInfo(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const user = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { patronTier: true, patronClaimed: true, patronDailyClaimed: true, element: true },
  });
  if (!user) { await replyNotStarted(interaction); return; }

  const color   = user.patronTier > 0 ? PATRON_GOLD : (ELEMENT_HEX[user.element as string] ?? 0x6366F1);
  const tierDef = user.patronTier > 0 ? PATRON_TIERS[user.patronTier] : null;

  const nextBundle = user.patronClaimed
    ? Math.max(0, CLAIM_COOLDOWN_MS - (Date.now() - user.patronClaimed.getTime()))
    : 0;
  const nextDaily = user.patronDailyClaimed
    ? Math.max(0, DAILY_COOLDOWN_MS - (Date.now() - user.patronDailyClaimed.getTime()))
    : 0;

  const tierLines = Object.entries(PATRON_TIERS).map(([t, d]) => {
    const active = user.patronTier === Number(t) ? " ← **your tier**" : "";
    return [
      `**✦ ${d.name}** — ${d.price}${active}`,
      `Monthly bundle: ${d.bundle}`,
      `Daily pass: ${d.daily}`,
      d.auraMax > 5 ? `Aura cap → **${d.auraMax}**` : "No aura cap bonus",
    ].join("\n");
  }).join("\n\n");

  const statusLine = tierDef
    ? [
        `You are **${tierDef.name}** patron.`,
        ``,
        `🗓️ **Monthly bundle** — \`/patron claim\``,
        nextBundle > 0 ? `  Ready in **${fmtMs(nextBundle)}**` : `  ✅ **Ready to claim!**`,
        ``,
        `⚡ **Daily pass** — \`/patron daily\``,
        nextDaily > 0 ? `  Ready in **${fmtMs(nextDaily)}**` : `  ✅ **Ready to claim!**`,
      ].join("\n")
    : "You are not a Patreon supporter.\n\n**As a patron you get:**\n— A daily pass (every 20h) with Fractonite + Credits\n— A monthly bundle (every 30d) with Lunakite + Fractonite\n— Permanent perks like a higher Aura cap";

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle("✦  CARTETHYIA Patreon")
      .setDescription(
        `${statusLine}\n\n` +
        `Support the bot and get daily rewards + monthly bundles + permanent perks.\n\n` +
        tierLines + `\n\n` +
        `*To activate, DM the server owner on Patreon — you'll receive a code to redeem with \`/patron redeem\`.*`
      )
      .setFooter({ text: "CARTETHYIA  ·  /patron daily (20h)  ·  /patron claim (30d)" })],
  });
}

async function handleClaim(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const user = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { patronTier: true, patronClaimed: true, element: true },
  });
  if (!user) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_HEX[user.element as string] ?? 0x6366F1;

  if (user.patronTier === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription("◈ You don't have an active Patreon tier.\nDM the server owner to get your tier activated after pledging.")
        .setFooter({ text: "CARTETHYIA  ·  Patreon" })],
    });
    return;
  }

  const msRemaining = user.patronClaimed
    ? CLAIM_COOLDOWN_MS - (Date.now() - user.patronClaimed.getTime())
    : 0;

  if (msRemaining > 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`◈ Bundle already claimed. Next claim available in **${fmtMs(msRemaining)}**.`)
        .setFooter({ text: "CARTETHYIA  ·  Patreon" })],
    });
    return;
  }

  const tierDef = PATRON_TIERS[user.patronTier];
  if (!tierDef) return;

  await prisma.user.update({
    where: { id: interaction.user.id },
    data:  {
      patronClaimed: new Date(),
      lunakite:      { increment: tierDef.rewards.lunakite },
      fractonite:    { increment: tierDef.rewards.fractonite },
      ...(tierDef.rewards.auraPrisms > 0 ? { auraPrisms: { increment: tierDef.rewards.auraPrisms } } : {}),
    },
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(PATRON_GOLD)
      .setTitle(`✦  ${tierDef.name} Bundle Claimed`)
      .setDescription(
        `Thank you for supporting CARTETHYIA!\n\n` +
        `**Monthly bundle:**\n${tierDef.bundle}\n\n` +
        (tierDef.auraMax > 5 ? `**Permanent perk:** Resonance Aura cap raised to **${tierDef.auraMax}**\n\n` : "") +
        `Next claim available in **30 days**.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Patreon  ·  Your support keeps this game alive." })],
  });
}

async function handleDaily(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const user = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { patronTier: true, patronDailyClaimed: true, element: true, dailyReminderEnabled: true },
  });
  if (!user) { await replyNotStarted(interaction); return; }

  const color = user.patronTier > 0 ? PATRON_GOLD : (ELEMENT_HEX[user.element as string] ?? 0x6366F1);

  if (user.patronTier === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(
          `◈ You don't have an active Patreon tier.\n` +
          `Pledge at patreon.com/c/Cartethyia_bot/membership and DM the owner to activate.`
        )
        .setFooter({ text: "CARTETHYIA  ·  Patreon" })],
    });
    return;
  }

  const msRemaining = user.patronDailyClaimed
    ? DAILY_COOLDOWN_MS - (Date.now() - user.patronDailyClaimed.getTime())
    : 0;

  if (msRemaining > 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`◈ Daily already claimed. Come back in **${fmtMs(msRemaining)}**.`)
        .setFooter({ text: "CARTETHYIA  ·  Patreon Daily" })],
    });
    return;
  }

  const tierDef = PATRON_TIERS[user.patronTier];
  if (!tierDef) return;

  await prisma.user.update({
    where: { id: interaction.user.id },
    data:  {
      patronDailyClaimed: new Date(),
      fractonite:         { increment: tierDef.dailyRewards.fractonite },
      credits:            { increment: tierDef.dailyRewards.credits },
    },
  });

  const fireAt = new Date(Date.now() + DAILY_COOLDOWN_MS);
  if (user.dailyReminderEnabled) {
    schedulePatronDailyReminder(interaction.client, interaction.user.id, fireAt);
  }

  const reminderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("patron_daily_reminder_toggle")
      .setLabel(user.dailyReminderEnabled ? "🔕  Disable Reminder" : "🔔  Remind Me in 20h")
      .setStyle(user.dailyReminderEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary),
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(PATRON_GOLD)
      .setTitle(`✦  ${tierDef.name} Daily Claimed`)
      .setDescription(
        `${tierDef.daily}\n\n` +
        `Come back in **20 hours** for your next daily.\n` +
        `-# Use \`/patron claim\` for your monthly bundle too.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Patreon Daily  ·  Thank you for supporting!" })],
    components: [reminderRow],
  });

  // Reminder toggle (60s window)
  let currentEnabled = user.dailyReminderEnabled;
  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: b => b.user.id === interaction.user.id && b.customId === "patron_daily_reminder_toggle",
    time: 60_000,
  });

  collector?.on("collect", async btn => {
    await btn.deferUpdate();
    currentEnabled = !currentEnabled;

    await prisma.user.update({
      where: { id: interaction.user.id },
      data:  { dailyReminderEnabled: currentEnabled },
    });

    if (currentEnabled) {
      schedulePatronDailyReminder(btn.client, interaction.user.id, fireAt);
    } else {
      clearPatronDailyReminder(interaction.user.id);
    }

    await btn.editReply({
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("patron_daily_reminder_toggle")
          .setLabel(currentEnabled ? "🔕  Disable Reminder" : "🔔  Remind Me in 20h")
          .setStyle(currentEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary),
      )],
    });
  });

  collector?.on("end", () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

const TIER_NAMES: Record<number, string> = { 1: "Attuned", 2: "Ascendant", 3: "Calamity" };

async function handleRedeem(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const code = interaction.options.getString("code", true).trim().toUpperCase();

  const record = await prisma.patronCode.findUnique({ where: { code } });

  if (!record) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xEF4444)
        .setDescription("◈ Invalid code. Double-check the code sent to you via Patreon messages.")
        .setFooter({ text: "CARTETHYIA  ·  Patreon" })],
    });
    return;
  }

  if (record.usedBy) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xEF4444)
        .setDescription("◈ This code has already been redeemed.")
        .setFooter({ text: "CARTETHYIA  ·  Patreon" })],
    });
    return;
  }

  const existing = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { patronTier: true },
  });
  if (!existing) { await replyNotStarted(interaction); return; }

  if (existing.patronTier >= record.tier) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xEF4444)
        .setDescription(`◈ You already have **${TIER_NAMES[existing.patronTier]}** (tier ${existing.patronTier}) — this code is for tier ${record.tier}.`)
        .setFooter({ text: "CARTETHYIA  ·  Patreon" })],
    });
    return;
  }

  const tierDef = PATRON_TIERS[record.tier];

  // Mark code used + set patron tier + grant first bundle immediately
  await Promise.all([
    prisma.patronCode.update({
      where: { code },
      data:  { usedBy: interaction.user.id, usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: interaction.user.id },
      data:  {
        patronTier:    record.tier,
        patronClaimed: new Date(),
        lunakite:      { increment: tierDef.rewards.lunakite },
        fractonite:    { increment: tierDef.rewards.fractonite },
        ...(tierDef.rewards.auraPrisms > 0 ? { auraPrisms: { increment: tierDef.rewards.auraPrisms } } : {}),
      },
    }),
  ]);

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(PATRON_GOLD)
      .setTitle(`✦  Welcome, ${TIER_NAMES[record.tier]} Patron!`)
      .setDescription(
        `Your tier is now active. Thank you for supporting CARTETHYIA!\n\n` +
        `**First bundle granted:**\n${tierDef.bundle}\n\n` +
        (tierDef.auraMax > 5 ? `**Permanent perk:** Resonance Aura cap raised to **${tierDef.auraMax}**\n\n` : "") +
        `Use \`/patron claim\` each month for your ongoing bundle.\n` +
        `Next claim available in **30 days**.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Patreon  ·  Your support keeps this game alive." })],
  });
}

export default command;
