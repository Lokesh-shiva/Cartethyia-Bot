import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, ModalSubmitInteraction,
} from "discord.js";
import { Command } from "../../types";
import { isOwner } from "../../lib/owner";
import { awardUser } from "../../lib/economy";
import prisma from "../../lib/prisma";

const REWARD_OPTIONS = [
  { name: "credits",          desc: "Credits"           },
  { name: "lunakite",         desc: "Lunakite"          },
  { name: "fractonite",       desc: "Fractonite"        },
  { name: "fracture-keys",    desc: "Fracture Keys"     },
  { name: "aura-prisms",      desc: "Aura Prisms"       },
  { name: "tuning-modules",   desc: "Tuning Modules"    },
  { name: "sealing-tubes",    desc: "Sealing Tubes"     },
  { name: "forging-ores",     desc: "Forging Ores"      },
  { name: "paradox-cores",    desc: "Paradox Cores"     },
  { name: "stasis-locks",     desc: "Stasis Locks"      },
  { name: "resonance-records",desc: "Resonance Records" },
] as const;

// kebab-case option name → prisma field name
const OPTION_TO_FIELD: Record<string, string> = {
  "credits":           "credits",
  "lunakite":          "lunakite",
  "fractonite":        "fractonite",
  "fracture-keys":     "fractureKeys",
  "aura-prisms":       "auraPrisms",
  "tuning-modules":    "tuningModules",
  "sealing-tubes":     "sealingTubes",
  "forging-ores":      "forgingOres",
  "paradox-cores":     "paradoxCores",
  "stasis-locks":      "stasisLocks",
  "resonance-records": "resonanceRecords",
};

function fmtRewards(mail: Record<string, any>): string {
  const parts: string[] = [];
  if (mail.credits)          parts.push(`💠 ${mail.credits} Credits`);
  if (mail.lunakite)         parts.push(`🌙 ${mail.lunakite} Lunakite`);
  if (mail.fractonite)       parts.push(`🔷 ${mail.fractonite} Fractonite`);
  if (mail.fractureKeys)     parts.push(`🗝️ ${mail.fractureKeys} Fracture Keys`);
  if (mail.auraPrisms)       parts.push(`🔆 ${mail.auraPrisms} Aura Prisms`);
  if (mail.tuningModules)    parts.push(`⚙️ ${mail.tuningModules} Tuning Modules`);
  if (mail.sealingTubes)     parts.push(`🧪 ${mail.sealingTubes} Sealing Tubes`);
  if (mail.forgingOres)      parts.push(`🪨 ${mail.forgingOres} Forging Ores`);
  if (mail.paradoxCores)     parts.push(`💜 ${mail.paradoxCores} Paradox Cores`);
  if (mail.stasisLocks)      parts.push(`🔒 ${mail.stasisLocks} Stasis Locks`);
  if (mail.resonanceRecords) parts.push(`📀 ${mail.resonanceRecords} Res. Records`);
  return parts.length ? parts.join("  ·  ") : "*No rewards attached*";
}

function collectRewards(interaction: ChatInputCommandInteraction): Record<string, number> {
  const rewards: Record<string, number> = {};
  for (const opt of REWARD_OPTIONS) {
    const val = interaction.options.getInteger(opt.name);
    if (val && val > 0) rewards[OPTION_TO_FIELD[opt.name]] = val;
  }
  return rewards;
}

// Build command
const builder = new SlashCommandBuilder()
  .setName("owner-mail")
  .setDescription("Owner only — mail and compensation tools.")
  .setDefaultMemberPermissions(0)
  .addSubcommand(s => {
    s.setName("send").setDescription("Send a mail (with optional rewards) to all players or one player.")
      .addUserOption(o => o.setName("target").setDescription("Specific player — omit to broadcast to all.").setRequired(false));
    for (const opt of REWARD_OPTIONS) {
      s.addIntegerOption(o => o.setName(opt.name).setDescription(`${opt.desc} to attach.`).setMinValue(1));
    }
    return s;
  })
  .addSubcommand(s => {
    s.setName("compensate").setDescription("Instantly award currencies to a player (no mail).")
      .addUserOption(o => o.setName("user").setDescription("Player to compensate.").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason (shown in log embed)."));
    for (const opt of REWARD_OPTIONS) {
      s.addIntegerOption(o => o.setName(opt.name).setDescription(`${opt.desc} to grant.`).setMinValue(1));
    }
    return s;
  })
  .addSubcommand(s =>
    s.setName("list").setDescription("List the 10 most recent mails.")
  )
  .addSubcommand(s =>
    s.setName("delete")
      .setDescription("Delete a mail by ID (also removes all claim records).")
      .addStringOption(o => o.setName("id").setDescription("Mail ID from /owner-mail list.").setRequired(true))
  ) as SlashCommandBuilder;

const command: Command = {
  data: builder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "❌ Owner only.", flags: 64 });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "send")       return handleSend(interaction);
    if (sub === "compensate") return handleCompensate(interaction);
    if (sub === "list")       return handleList(interaction);
    if (sub === "delete")     return handleDelete(interaction);
  },
};

// ── Send ─────────────────────────────────────────────────────────────────────

async function handleSend(interaction: ChatInputCommandInteraction) {
  const target  = interaction.options.getUser("target") ?? null;
  const rewards = collectRewards(interaction);

  // Open modal for subject + body
  const modal = new ModalBuilder()
    .setCustomId(`owner_mail_compose_${Date.now()}`)
    .setTitle(target ? `Mail to ${target.username}` : "Global Mail to All Players");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("subject")
        .setLabel("Subject")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setPlaceholder("e.g.  ⚙️ Maintenance Gift")
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("body")
        .setLabel("Body (supports Discord emoji)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setPlaceholder("Your message here. Use <:emoji_name:id> for custom emojis.")
        .setRequired(true)
    ),
  );

  await interaction.showModal(modal);

  let modalSubmit: ModalSubmitInteraction;
  try {
    modalSubmit = await interaction.awaitModalSubmit({ time: 5 * 60 * 1000 });
  } catch {
    return; // timed out
  }

  await modalSubmit.deferReply({ flags: 64 });

  const subject = modalSubmit.fields.getTextInputValue("subject").trim();
  const body    = modalSubmit.fields.getTextInputValue("body").trim();

  const mail = await prisma.mail.create({
    data: {
      subject,
      body,
      targetUserId: target?.id ?? null,
      ...rewards,
    },
  });

  const scope = target ? `<@${target.id}>` : `**all players**`;
  const rewardLine = fmtRewards({ ...rewards });

  await modalSubmit.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xFCD34D)
      .setTitle("📬  Mail Sent")
      .addFields(
        { name: "Subject",   value: subject,     inline: false },
        { name: "Body",      value: body,         inline: false },
        { name: "Rewards",   value: rewardLine,   inline: false },
        { name: "To",        value: scope,        inline: true  },
        { name: "Mail ID",   value: `\`${mail.id}\``, inline: true },
      )
      .setFooter({ text: "CARTETHYIA  ·  Players see it on /mail" })],
  });
}

// ── Compensate ───────────────────────────────────────────────────────────────

async function handleCompensate(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const target  = interaction.options.getUser("user", true);
  const reason  = interaction.options.getString("reason") ?? "No reason specified.";
  const rewards = collectRewards(interaction);

  if (Object.keys(rewards).length === 0) {
    await interaction.editReply({ content: "❌ Specify at least one reward amount." });
    return;
  }

  const exists = await prisma.user.findUnique({ where: { id: target.id }, select: { id: true } });
  if (!exists) {
    await interaction.editReply({ content: `❌ <@${target.id}> hasn't started the game yet.` });
    return;
  }

  const data: Record<string, any> = {};
  for (const [field, amount] of Object.entries(rewards)) {
    data[field] = { increment: amount };
  }
  await prisma.user.update({ where: { id: target.id }, data });

  const rewardLine = fmtRewards(rewards);

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x10B981)
      .setTitle("✅  Compensation Granted")
      .setDescription(`**Recipient:** <@${target.id}>\n**Reason:** ${reason}`)
      .addFields({ name: "Awarded", value: rewardLine, inline: false })
      .setFooter({ text: `CARTETHYIA  ·  ${new Date().toISOString().slice(0, 10)}` })],
  });
}

// ── List ─────────────────────────────────────────────────────────────────────

async function handleList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const mails = await prisma.mail.findMany({
    orderBy: { sentAt: "desc" },
    take: 10,
    include: { _count: { select: { claims: true } } },
  });

  if (mails.length === 0) {
    await interaction.editReply({ content: "No mails sent yet." });
    return;
  }

  const lines = (mails as any[]).map((m: any) => {
    const age   = Math.floor((Date.now() - m.sentAt.getTime()) / 3_600_000);
    const scope = m.targetUserId ? `<@${m.targetUserId}>` : "📡 Global";
    const ageStr = age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
    return `\`${m.id.slice(-8)}\`  **${m.subject}**  ·  ${scope}  ·  ${m._count.claims} claimed  ·  *${ageStr}*`;
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("📬  Recent Mails")
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Showing last 10  ·  Use full ID with /owner-mail delete" })],
  });
}

// ── Delete ───────────────────────────────────────────────────────────────────

async function handleDelete(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const id = interaction.options.getString("id", true).trim();

  const mail = await prisma.mail.findUnique({ where: { id } });
  if (!mail) {
    await interaction.editReply({ content: `❌ No mail with ID \`${id}\`.` });
    return;
  }

  await prisma.mail.delete({ where: { id } }); // MailClaims cascade-delete

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xEF4444)
      .setDescription(`🗑️ Mail **"${mail.subject}"** (\`${id}\`) deleted. All claim records removed.`)],
  });
}

export default command;
