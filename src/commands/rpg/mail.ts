import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { replyNotStarted } from "../../lib/economy";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

function fmtRewards(m: Record<string, any>): string {
  const parts: string[] = [];
  if (m.credits)          parts.push(`💠 ${m.credits}`);
  if (m.lunakite)         parts.push(`🌙 ${m.lunakite}`);
  if (m.fractonite)       parts.push(`🔷 ${m.fractonite}`);
  if (m.fractureKeys)     parts.push(`🗝️ ${m.fractureKeys}`);
  if (m.auraPrisms)       parts.push(`🔆 ${m.auraPrisms}`);
  if (m.tuningModules)    parts.push(`⚙️ ${m.tuningModules}`);
  if (m.sealingTubes)     parts.push(`🧪 ${m.sealingTubes}`);
  if (m.forgingOres)      parts.push(`🪨 ${m.forgingOres}`);
  if (m.paradoxCores)     parts.push(`💜 ${m.paradoxCores}`);
  if (m.stasisLocks)      parts.push(`🔒 ${m.stasisLocks}`);
  if (m.resonanceRecords) parts.push(`📀 ${m.resonanceRecords}`);
  if (m.radiantKeys)      parts.push(`🔑 ${m.radiantKeys}`);
  if (m.starfallShards)   parts.push(`🌠 ${m.starfallShards}`);
  return parts.length ? parts.join(" · ") : "No rewards";
}

function hasRewards(m: Record<string, any>): boolean {
  return ["credits","lunakite","fractonite","fractureKeys","auraPrisms",
          "tuningModules","sealingTubes","forgingOres","paradoxCores",
          "stasisLocks","resonanceRecords","radiantKeys","starfallShards"].some(k => m[k] > 0);
}

function timeAgo(date: Date): string {
  const h = Math.floor((Date.now() - date.getTime()) / 3_600_000);
  if (h < 1)  return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function getUnclaimedMails(userId: string, userCreatedAt: Date) {
  const now = new Date();
  return prisma.mail.findMany({
    where: {
      AND: [
        { OR: [
          { targetUserId: null, sentAt: { gt: userCreatedAt } },
          { targetUserId: userId },
        ]},
        { claims: { none: { userId } } },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
    orderBy: { sentAt: "asc" },
  });
}

async function claimMail(mailId: string, userId: string): Promise<void> {
  const mail = await prisma.mail.findUnique({ where: { id: mailId } });
  if (!mail) return;
  await prisma.$transaction([
    prisma.mailClaim.create({ data: { mailId, userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        credits:          mail.credits          ? { increment: mail.credits          } : undefined,
        lunakite:         mail.lunakite         ? { increment: mail.lunakite         } : undefined,
        fractonite:       mail.fractonite       ? { increment: mail.fractonite       } : undefined,
        fractureKeys:     mail.fractureKeys     ? { increment: mail.fractureKeys     } : undefined,
        auraPrisms:       mail.auraPrisms       ? { increment: mail.auraPrisms       } : undefined,
        tuningModules:    mail.tuningModules    ? { increment: mail.tuningModules    } : undefined,
        sealingTubes:     mail.sealingTubes     ? { increment: mail.sealingTubes     } : undefined,
        forgingOres:      mail.forgingOres      ? { increment: mail.forgingOres      } : undefined,
        paradoxCores:     mail.paradoxCores     ? { increment: mail.paradoxCores     } : undefined,
        stasisLocks:      mail.stasisLocks      ? { increment: mail.stasisLocks      } : undefined,
        resonanceRecords: mail.resonanceRecords ? { increment: mail.resonanceRecords } : undefined,
        radiantKeys:      mail.radiantKeys      ? { increment: mail.radiantKeys      } : undefined,
        starfallShards:   mail.starfallShards   ? { increment: mail.starfallShards   } : undefined,
      },
    }),
  ]);
}

function sumRewards(mails: any[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const m of mails) {
    for (const f of ["credits","lunakite","fractonite","fractureKeys","auraPrisms",
                     "tuningModules","sealingTubes","forgingOres","paradoxCores",
                     "stasisLocks","resonanceRecords","radiantKeys","starfallShards"]) {
      if (m[f]) totals[f] = (totals[f] ?? 0) + m[f];
    }
  }
  return totals;
}

const PAGE = 5;

function buildInboxEmbed(page: number, mails: any[]): EmbedBuilder {
  const slice = mails.slice(page * PAGE, (page + 1) * PAGE);
  const lines = slice.map((m, i) => {
    const idx     = page * PAGE + i + 1;
    const pin     = m.targetUserId ? "✉️" : "📡";
    const rewards = hasRewards(m) ? `  ·  ${fmtRewards(m)}` : "";
    return `${pin} **${idx}.** ${m.subject}${rewards}\n-# ${timeAgo(m.sentAt)}`;
  });
  const pages = Math.ceil(mails.length / PAGE);
  return new EmbedBuilder()
    .setColor(0xFCD34D)
    .setTitle(`📬  Mailbox  ·  ${mails.length} unread`)
    .setDescription(lines.join("\n\n"))
    .addFields({ name: "Claim all rewards", value: fmtRewards(sumRewards(mails)), inline: false })
    .setFooter({ text: `CARTETHYIA  ·  Mail${pages > 1 ? `  ·  Page ${page + 1}/${pages}` : ""}  ·  Select a mail to read` });
}

function buildDetailEmbed(m: any, color: number): EmbedBuilder {
  const pin = m.targetUserId ? "✉️ Personal" : "📡 Global";
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(m.subject)
    .setDescription(m.body)
    .addFields({ name: "Rewards", value: fmtRewards(m), inline: false })
    .setFooter({ text: `CARTETHYIA  ·  Mail  ·  ${pin}  ·  ${timeAgo(m.sentAt)}` });
}

function buildSelectMenu(page: number, mails: any[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const slice = mails.slice(page * PAGE, (page + 1) * PAGE);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("mail_open")
      .setPlaceholder("Open a mail to read it…")
      .addOptions(slice.map((m, i) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${page * PAGE + i + 1}. ${m.subject}`.slice(0, 100))
          .setDescription(hasRewards(m) ? fmtRewards(m).slice(0, 100) : "No rewards")
          .setValue(m.id)
      ))
  );
}

function buildInboxButtons(page: number, total: number, disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("mail_prev").setLabel("◀").setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId("mail_claim_page").setLabel(`Claim Page ${page + 1}`)
      .setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("mail_claim_all").setLabel("📬 Claim All")
      .setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId("mail_next").setLabel("▶").setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || (page + 1) * PAGE >= total),
  );
}

function buildDetailButtons(mailId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("mail_back").setLabel("◀ Back").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mail_claim_one:${mailId}`).setLabel("Claim Rewards")
      .setStyle(ButtonStyle.Success),
  );
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("mail")
    .setDescription("Open your mailbox and claim any pending rewards."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const user = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { element: true, createdAt: true },
    });
    if (!user) { await replyNotStarted(interaction); return; }

    const color = ELEMENT_HEX[user.element as string] ?? 0x6366F1;

    let remaining = await getUnclaimedMails(interaction.user.id, user.createdAt);

    if (remaining.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setTitle("📬  Mailbox")
          .setDescription("Your mailbox is empty — no unclaimed rewards.")
          .setFooter({ text: "CARTETHYIA  ·  Mail" })],
      });
      return;
    }

    let page = 0;

    const msg = await interaction.editReply({
      embeds:     [buildInboxEmbed(page, remaining)],
      components: [buildSelectMenu(page, remaining), buildInboxButtons(page, remaining.length)],
    });

    const collector = msg.createMessageComponentCollector({
      filter: (i: any) => i.user.id === interaction.user.id,
      time:   3 * 60 * 1000,
    });

    collector.on("collect", async (i: any) => {
      await i.deferUpdate();

      // ── Open a mail (select menu) ───────────────────────────────────────────
      if (i.customId === "mail_open") {
        const mailId = i.values[0];
        const mail   = remaining.find((m: any) => m.id === mailId);
        if (!mail) return;
        await i.editReply({
          embeds:     [buildDetailEmbed(mail, color)],
          components: [buildDetailButtons(mail.id)],
        });
        return;
      }

      // ── Back to inbox ───────────────────────────────────────────────────────
      if (i.customId === "mail_back") {
        await i.editReply({
          embeds:     [buildInboxEmbed(page, remaining)],
          components: [buildSelectMenu(page, remaining), buildInboxButtons(page, remaining.length)],
        });
        return;
      }

      // ── Claim single mail from detail view ──────────────────────────────────
      if (i.customId.startsWith("mail_claim_one:")) {
        const mailId = i.customId.split(":")[1];
        const mail   = remaining.find((m: any) => m.id === mailId);
        if (!mail) return;

        await claimMail(mail.id, interaction.user.id);
        remaining = remaining.filter((m: any) => m.id !== mail.id);
        page      = Math.min(page, Math.max(0, Math.ceil(remaining.length / PAGE) - 1));

        if (remaining.length === 0) {
          collector.stop("done");
          await i.editReply({
            embeds: [new EmbedBuilder()
              .setColor(0x10B981)
              .setTitle("📬  All Mail Claimed!")
              .setDescription(`**Received:** ${fmtRewards(mail)}`)
              .setFooter({ text: "CARTETHYIA  ·  Mailbox empty" })],
            components: [],
          });
          return;
        }

        await i.editReply({
          embeds: [new EmbedBuilder()
            .setColor(color)
            .setTitle("✅  Claimed!")
            .setDescription(`**Received:** ${fmtRewards(mail)}\n\n**${remaining.length} mail${remaining.length > 1 ? "s" : ""} remaining.**`)
            .setFooter({ text: "CARTETHYIA  ·  Mail" })],
          components: [],
        });
        await new Promise(r => setTimeout(r, 2000));
        await i.editReply({
          embeds:     [buildInboxEmbed(page, remaining)],
          components: [buildSelectMenu(page, remaining), buildInboxButtons(page, remaining.length)],
        });
        return;
      }

      // ── Pagination ──────────────────────────────────────────────────────────
      if (i.customId === "mail_prev") {
        page = Math.max(0, page - 1);
        await i.editReply({
          embeds:     [buildInboxEmbed(page, remaining)],
          components: [buildSelectMenu(page, remaining), buildInboxButtons(page, remaining.length)],
        });
        return;
      }

      if (i.customId === "mail_next") {
        page = Math.min(Math.ceil(remaining.length / PAGE) - 1, page + 1);
        await i.editReply({
          embeds:     [buildInboxEmbed(page, remaining)],
          components: [buildSelectMenu(page, remaining), buildInboxButtons(page, remaining.length)],
        });
        return;
      }

      // ── Claim page or all ───────────────────────────────────────────────────
      const toClaim = i.customId === "mail_claim_all"
        ? remaining
        : remaining.slice(page * PAGE, (page + 1) * PAGE);

      if (toClaim.length === 0) return;

      for (const m of toClaim) await claimMail(m.id, interaction.user.id);
      const rewarded = fmtRewards(sumRewards(toClaim));

      remaining = remaining.filter((m: any) => !toClaim.find((c: any) => c.id === m.id));
      page      = Math.min(page, Math.max(0, Math.ceil(remaining.length / PAGE) - 1));

      if (remaining.length === 0) {
        collector.stop("done");
        await i.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x10B981)
            .setTitle("📬  All Mail Claimed!")
            .setDescription(`**Rewards received:**\n${rewarded}`)
            .setFooter({ text: "CARTETHYIA  ·  Mailbox empty" })],
          components: [],
        });
        return;
      }

      await i.editReply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setTitle("✅  Claimed!")
          .setDescription(`**Received:** ${rewarded}\n\n**${remaining.length} mail${remaining.length > 1 ? "s" : ""} remaining.**`)
          .setFooter({ text: "CARTETHYIA  ·  Mail" })],
        components: [],
      });

      await new Promise(r => setTimeout(r, 2000));
      await i.editReply({
        embeds:     [buildInboxEmbed(page, remaining)],
        components: [buildSelectMenu(page, remaining), buildInboxButtons(page, remaining.length)],
      });
    });

    collector.on("end", (_, reason) => {
      if (reason !== "done") {
        interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  },
};

export default command;
