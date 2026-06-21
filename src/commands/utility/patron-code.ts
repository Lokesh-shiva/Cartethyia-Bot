import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import prisma from "../../lib/prisma";

const TIER_NAMES: Record<number, string> = { 1: "Attuned", 2: "Ascendant", 3: "Calamity" };
const TIER_PREFIXES: Record<number, string> = { 1: "ATTUNED", 2: "ASCENDANT", 3: "CALAMITY" };

function generateCode(tier: number): string {
  const prefix = TIER_PREFIXES[tier] ?? "PATRON";
  const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${rand()}-${rand()}`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("patron-code")
    .setDescription("Owner only — manage Patreon activation codes.")
    .setDefaultMemberPermissions(0)
    .addSubcommand(s =>
      s.setName("create")
        .setDescription("Generate a new patron code to send to a subscriber.")
        .addIntegerOption(o =>
          o.setName("tier")
            .setDescription("Patron tier: 1=Attuned, 2=Ascendant, 3=Calamity")
            .setRequired(true)
            .addChoices(
              { name: "1 — Attuned ($3)",    value: 1 },
              { name: "2 — Ascendant ($5)",  value: 2 },
              { name: "3 — Calamity ($10)",  value: 3 },
            )
        )
        .addIntegerOption(o =>
          o.setName("amount")
            .setDescription("How many codes to generate (default: 1).")
            .setMinValue(1).setMaxValue(10).setRequired(false)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("List recent unused codes.")
        .addIntegerOption(o =>
          o.setName("tier")
            .setDescription("Filter by tier (optional).")
            .setRequired(false)
            .addChoices(
              { name: "1 — Attuned",   value: 1 },
              { name: "2 — Ascendant", value: 2 },
              { name: "3 — Calamity",  value: 3 },
            )
        )
    )
    .addSubcommand(s =>
      s.setName("revoke")
        .setDescription("Revoke a user's patron tier (cancellation).")
        .addUserOption(o =>
          o.setName("user").setDescription("User to revoke.").setRequired(true)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "❌ Owner only.", flags: 64 });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "create") await handleCreate(interaction);
    if (sub === "list")   await handleList(interaction);
    if (sub === "revoke") await handleRevoke(interaction);
  },
};

async function handleCreate(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const tier   = interaction.options.getInteger("tier", true);
  const amount = interaction.options.getInteger("amount") ?? 1;

  const codes: string[] = [];
  for (let i = 0; i < amount; i++) {
    let code: string;
    do { code = generateCode(tier); }
    while (await prisma.patronCode.findUnique({ where: { code } }));
    await prisma.patronCode.create({ data: { code, tier } });
    codes.push(code);
  }

  const tierName = TIER_NAMES[tier];
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xFCD34D)
      .setTitle(`✦ ${tierName} Code${amount > 1 ? "s" : ""} Generated`)
      .setDescription(
        codes.map(c => `\`${c}\``).join("\n") + "\n\n" +
        `Send this to your patron via Patreon messages.\n` +
        `They redeem with \`/patron redeem <code>\` — works in DMs or any server.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Patron Codes  ·  Owner only" })],
  });
}

async function handleList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const tier = interaction.options.getInteger("tier");

  const codes = await prisma.patronCode.findMany({
    where:   { usedBy: null, ...(tier ? { tier } : {}) },
    orderBy: { createdAt: "desc" },
    take:    20,
  });

  if (codes.length === 0) {
    await interaction.editReply({ content: "No unused codes." });
    return;
  }

  const lines = codes.map(c => `\`${c.code}\` — ${TIER_NAMES[c.tier]}`);
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xFCD34D)
      .setTitle("✦ Unused Patron Codes")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${codes.length} unused code${codes.length !== 1 ? "s" : ""}` })],
  });
}

async function handleRevoke(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const target = interaction.options.getUser("user", true);

  const user = await prisma.user.findUnique({ where: { id: target.id }, select: { patronTier: true } });
  if (!user || user.patronTier === 0) {
    await interaction.editReply({ content: `${target.username} has no active patron tier.` });
    return;
  }

  const oldTier = user.patronTier;
  await prisma.user.update({
    where: { id: target.id },
    data:  { patronTier: 0 },
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xEF4444)
      .setDescription(`◈ Revoked **${TIER_NAMES[oldTier]}** from **${target.username}**. Their tier is now 0.`)
      .setFooter({ text: "CARTETHYIA  ·  Patron Codes" })],
  });
}

export default command;
