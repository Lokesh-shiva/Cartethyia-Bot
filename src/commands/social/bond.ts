import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, getAffinity } from "../../lib/economy";
import { BondType } from "@prisma/client";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const BOND_META: Record<BondType, {
  label:        string;
  emoji:        string;
  description:  string;
  minAffinity:  number;
  color:        number;
}> = {
  FRIEND: {
    label:       "Friend",
    emoji:       "🤝",
    description: "A genuine friendship bond.",
    minAffinity: 0,
    color:       0x60A5FA,
  },
  PARTNER: {
    label:       "Partner",
    emoji:       "💞",
    description: "A romantic or deeply trusted partner bond.",
    minAffinity: 200,
    color:       0xF472B6,
  },
  ADOPTED_PARENT: {
    label:       "Adopt (as Parent)",
    emoji:       "🛡️",
    description: "You become their guardian in Cartethyia.",
    minAffinity: 75,
    color:       0xFBBF24,
  },
  ADOPTED_CHILD: {
    label:       "Adopt (as Child)",
    emoji:       "🌱",
    description: "You become their ward in Cartethyia.",
    minAffinity: 75,
    color:       0x34D399,
  },
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("bond")
    .setDescription("Form a Synchrony Bond with another player.")
    .addSubcommand((s) =>
      s.setName("create")
        .setDescription("Send a bond request to another player.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Who to bond with.").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("type").setDescription("Type of bond.").setRequired(true)
            .addChoices(
              { name: "🤝  Friend",           value: "FRIEND"         },
              { name: "💞  Partner",           value: "PARTNER"        },
              { name: "🛡️  Adopt (as Parent)", value: "ADOPTED_PARENT" },
              { name: "🌱  Adopt (as Child)",  value: "ADOPTED_CHILD"  },
            )
        )
    )
    .addSubcommand((s) =>
      s.setName("view")
        .setDescription("View your bonds and family tree.")
        .addUserOption((o) =>
          o.setName("user").setDescription("View another player's bonds.").setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s.setName("break")
        .setDescription("Break an existing bond.")
        .addUserOption((o) =>
          o.setName("user").setDescription("Who to break the bond with.").setRequired(true)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") await handleCreate(interaction);
    if (sub === "view")   await handleView(interaction);
    if (sub === "break")  await handleBreak(interaction);
  },
};

// ── /bond create ──────────────────────────────────────────────────────────────
async function handleCreate(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target    = interaction.options.getUser("user", true);
  const bondType  = interaction.options.getString("type", true) as BondType;
  const meta      = BOND_META[bondType];

  const actorName  = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName ?? interaction.user.username;
  const targetName = interaction.guild?.members.cache.get(target.id)?.displayName
    ?? target.displayName ?? target.username;
  const actorAvatar = interaction.user.displayAvatarURL({ size: 64, extension: "png" });

  // Basic checks
  if (target.id === interaction.user.id) {
    await interaction.editReply({ content: "◈ You can't bond with yourself." }); return;
  }
  if (target.bot) {
    await interaction.editReply({ content: "◈ Bots don't form bonds." }); return;
  }

  await Promise.all([
    getOrCreateUser(interaction.user.id, actorName, actorAvatar),
    getOrCreateUser(target.id, targetName, target.displayAvatarURL({ size: 64, extension: "png" })),
  ]);

  // Check existing bond
  const existing = await prisma.bond.findFirst({
    where: {
      OR: [
        { initiatorId: interaction.user.id, receiverId: target.id },
        { initiatorId: target.id, receiverId: interaction.user.id },
      ],
    },
  });

  if (existing) {
    const existingMeta = BOND_META[existing.bondType];
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x334155)
        .setDescription(`◈ You already have a **${existingMeta.emoji} ${existingMeta.label}** bond with **${targetName}**.\nBreak it first with **/bond break**.`)],
    });
    return;
  }

  // Affinity check
  const affinity = await getAffinity(interaction.user.id, target.id);
  const score    = affinity?.score ?? 0;

  if (score < meta.minAffinity) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x334155)
        .setDescription([
          `◈ Not enough Synchrony with **${targetName}**.`,
          ``,
          `**${meta.emoji} ${meta.label}** requires **${meta.minAffinity}** Synchrony.`,
          `You currently have **${score}**.`,
          ``,
          `Use **/vibe** to build your connection.`,
        ].join("\n"))
        .setFooter({ text: "CARTETHYIA  ·  Bond System" })],
    });
    return;
  }

  // ── Send bond request embed ───────────────────────────────────────────────
  const requestEmbed = new EmbedBuilder()
    .setColor(meta.color)
    .setAuthor({ name: `${actorName}  ·  Bond Request`, iconURL: actorAvatar })
    .setDescription([
      `<@${target.id}> — **${actorName}** wants to form a bond with you.`,
      ``,
      `${meta.emoji}  **${meta.label}**`,
      `*${meta.description}*`,
      ``,
      `◈ Current Synchrony: **${score}**`,
      ``,
      `*This bond will appear on both your profile cards.*`,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: "CARTETHYIA  ·  Bond System  ·  Expires in 10 minutes" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bond_accept_${interaction.user.id}_${target.id}_${bondType}`).setLabel("✅  Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bond_decline_${interaction.user.id}_${target.id}`).setLabel("❌  Decline").setStyle(ButtonStyle.Danger),
  );

  const msg = await interaction.editReply({ embeds: [requestEmbed], components: [row] });

  // Only target can respond
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.user.id === target.id,
    time:   10 * 60 * 1000,
    max:    1,
  });

  collector.on("collect", async (btn: ButtonInteraction) => {
    await btn.deferUpdate();

    if (btn.customId.startsWith("bond_decline_")) {
      await btn.editReply({
        embeds: [new EmbedBuilder().setColor(0x334155)
          .setDescription(`◈ **${targetName}** declined the bond request.`)
          .setFooter({ text: "CARTETHYIA  ·  Bond System" })],
        components: [],
      });
      return;
    }

    // Accept — create bond
    await prisma.bond.create({
      data: {
        initiatorId: interaction.user.id,
        receiverId:  target.id,
        bondType,
      },
    });

    // Both players get a Resonance Record for forming a bond
    await Promise.all([
      prisma.user.update({ where: { id: interaction.user.id }, data: { resonanceRecords: { increment: 1 } } }),
      prisma.user.update({ where: { id: target.id },           data: { resonanceRecords: { increment: 1 } } }),
    ]);

    const acceptEmbed = new EmbedBuilder()
      .setColor(meta.color)
      .setTitle(`${meta.emoji}  Bond Formed`)
      .setDescription([
        `**${actorName}**  ×  **${targetName}**`,
        ``,
        `${meta.emoji}  **${meta.label}** bond is now active.`,
        `*${meta.description}*`,
        ``,
        `◈ This bond appears on your profile cards.`,
        `◈ Build more Synchrony via **/vibe** to unlock combat buffs.`,
      ].join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Bond System" });

    await btn.editReply({ embeds: [acceptEmbed], components: [] });
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") {
      await msg.edit({ components: [] }).catch(() => {});
    }
  });
}

// ── /bond view ────────────────────────────────────────────────────────────────
async function handleView(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target      = interaction.options.getUser("user") ?? interaction.user;
  const displayName = interaction.guild?.members.cache.get(target.id)?.displayName
    ?? target.displayName ?? target.username;
  const avatarUrl   = target.displayAvatarURL({ size: 64, extension: "png" });

  await getOrCreateUser(target.id, displayName, avatarUrl);

  const dbUser = await prisma.user.findUnique({ where: { id: target.id }, select: { element: true } });
  const color  = ELEMENT_HEX[dbUser?.element ?? "NONE"] ?? ELEMENT_HEX.NONE;

  const bonds = await prisma.bond.findMany({
    where: {
      OR: [{ initiatorId: target.id }, { receiverId: target.id }],
    },
  });

  if (bonds.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setAuthor({ name: `${displayName}  ·  Bonds`, iconURL: avatarUrl })
        .setDescription(
          target.id === interaction.user.id
            ? `◈ You have no bonds yet.\nUse **/bond create @user** to form one.`
            : `◈ **${displayName}** has no bonds yet.`
        )
        .setFooter({ text: "CARTETHYIA  ·  Bond System" })],
    });
    return;
  }

  // Fetch partner names
  const partnerIds = bonds.map((b) => b.initiatorId === target.id ? b.receiverId : b.initiatorId);
  const partners   = await prisma.user.findMany({
    where:  { id: { in: partnerIds } },
    select: { id: true, username: true },
  });
  const partnerMap = Object.fromEntries(partners.map((p) => [p.id, p.username]));

  // Fetch affinities for each
  const bondLines = await Promise.all(bonds.map(async (b) => {
    const partnerId = b.initiatorId === target.id ? b.receiverId : b.initiatorId;
    const meta      = BOND_META[b.bondType];
    const aff       = await getAffinity(target.id, partnerId);
    const name      = interaction.guild?.members.cache.get(partnerId)?.displayName
      ?? partnerMap[partnerId] ?? "Unknown";
    return `${meta.emoji}  **${name}**  ·  ${meta.label}  ·  Synchrony **${aff?.score ?? 0}**`;
  }));

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${displayName}  ·  Bonds`, iconURL: avatarUrl })
      .setDescription([
        `**${bonds.length}** active bond${bonds.length > 1 ? "s" : ""}`,
        ``,
        bondLines.join("\n"),
        ``,
        `◈ Reach **500 Synchrony** with any bond partner to unlock **Synchrony Aura** in Co-op.`,
      ].join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Bond System" })],
  });
}

// ── /bond break ───────────────────────────────────────────────────────────────
async function handleBreak(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const target     = interaction.options.getUser("user", true);
  const actorName  = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName ?? interaction.user.username;
  const targetName = interaction.guild?.members.cache.get(target.id)?.displayName
    ?? target.displayName ?? target.username;

  const bond = await prisma.bond.findFirst({
    where: {
      OR: [
        { initiatorId: interaction.user.id, receiverId: target.id },
        { initiatorId: target.id, receiverId: interaction.user.id },
      ],
    },
  });

  if (!bond) {
    await interaction.editReply({ content: `◈ You don't have a bond with **${targetName}**.` });
    return;
  }

  const meta = BOND_META[bond.bondType];

  // Confirm
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("break_confirm").setLabel("Break Bond").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("break_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const msg = await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0xEF4444)
      .setDescription(`◈ Are you sure you want to break your **${meta.emoji} ${meta.label}** bond with **${targetName}**?\n\n*Synchrony is preserved but the bond is removed.*`)
      .setFooter({ text: "CARTETHYIA  ·  Bond System" })],
    components: [row],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.user.id === interaction.user.id,
    time: 30_000, max: 1,
  });

  collector.on("collect", async (btn: ButtonInteraction) => {
    await btn.deferUpdate();
    if (btn.customId === "break_cancel") {
      await btn.editReply({ components: [] }); return;
    }
    await prisma.bond.delete({ where: { id: bond.id } });
    await btn.editReply({
      embeds: [new EmbedBuilder().setColor(0x334155)
        .setDescription(`◈ Your **${meta.emoji} ${meta.label}** bond with **${targetName}** has been broken.`)
        .setFooter({ text: "CARTETHYIA  ·  Bond System" })],
      components: [],
    });
  });
}

export default command;
