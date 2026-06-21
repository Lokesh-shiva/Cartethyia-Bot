import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { Command } from "../../types";
import { replyNotStarted, awardUser } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const PATRON_GOLD = 0xFCD34D;
const CLAIM_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface PatronTierDef {
  name:      string;
  price:     string;
  auraMax:   number;
  bundle:    string;
  rewards:   {
    lunakite:   number;
    fractonite: number;
    auraPrisms: number;
  };
}

const PATRON_TIERS: Record<number, PatronTierDef> = {
  1: {
    name:    "Attuned",
    price:   "$3/mo",
    auraMax: 5,
    bundle:  `${CE.lk} 2 Lunakite · 🔷 80 Fractonite`,
    rewards: { lunakite: 2, fractonite: 80, auraPrisms: 0 },
  },
  2: {
    name:    "Ascendant",
    price:   "$5/mo",
    auraMax: 6,
    bundle:  `${CE.lk} 5 Lunakite · 🔷 200 Fractonite · 🔆 1 Aura Prism`,
    rewards: { lunakite: 5, fractonite: 200, auraPrisms: 1 },
  },
  3: {
    name:    "Calamity",
    price:   "$10/mo",
    auraMax: 8,
    bundle:  `${CE.lk} 12 Lunakite · 🔷 500 Fractonite · 🔆 3 Aura Prisms`,
    rewards: { lunakite: 12, fractonite: 500, auraPrisms: 3 },
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
    if (sub === "redeem") await handleRedeem(interaction);
  },
};

async function handleInfo(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const user = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { patronTier: true, patronClaimed: true, element: true },
  });
  if (!user) { await replyNotStarted(interaction); return; }

  const color    = user.patronTier > 0 ? PATRON_GOLD : (ELEMENT_HEX[user.element as string] ?? 0x6366F1);
  const tierDef  = user.patronTier > 0 ? PATRON_TIERS[user.patronTier] : null;
  const nextClaim = user.patronClaimed
    ? Math.max(0, CLAIM_COOLDOWN_MS - (Date.now() - user.patronClaimed.getTime()))
    : 0;

  const tierLines = Object.entries(PATRON_TIERS).map(([t, d]) => {
    const active = user.patronTier === Number(t) ? " ← **your tier**" : "";
    return [
      `**✦ ${d.name}** — ${d.price}${active}`,
      `Monthly bundle: ${d.bundle}`,
      d.auraMax > 5 ? `Aura cap raised to **${d.auraMax}**` : "No aura cap bonus",
    ].join("\n");
  }).join("\n\n");

  const statusLine = tierDef
    ? `You are **${tierDef.name}** — ${nextClaim > 0 ? `next claim in **${fmtMs(nextClaim)}**` : "bundle ready to claim!"}`
    : "You are not a Patreon supporter.";

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle("✦  CARTETHYIA Patreon")
      .setDescription(
        `${statusLine}\n\n` +
        `Support the bot and get monthly bundles + permanent perks.\n\n` +
        tierLines + `\n\n` +
        `*To activate your tier, DM the server owner with proof of your Patreon pledge.*`
      )
      .setFooter({ text: "CARTETHYIA  ·  Patreon  ·  /patron claim to collect your bundle" })],
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
