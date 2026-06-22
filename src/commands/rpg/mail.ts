import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType,
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
  return parts.length ? parts.join(" · ") : "No rewards";
}

function hasRewards(m: Record<string, any>): boolean {
  return ["credits","lunakite","fractonite","fractureKeys","auraPrisms",
          "tuningModules","sealingTubes","forgingOres","paradoxCores",
          "stasisLocks","resonanceRecords"].some(k => m[k] > 0);
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
        {
          OR: [
            { targetUserId: null, sentAt: { gt: userCreatedAt } },
            { targetUserId: userId },
          ],
        },
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
      },
    }),
  ]);
}

function sumRewards(mails: any[]): Record<string, number> {
  const totals: Record<string, number> = {};
  const fields = ["credits","lunakite","fractonite","fractureKeys","auraPrisms",
                  "tuningModules","sealingTubes","forgingOres","paradoxCores",
                  "stasisLocks","resonanceRecords"];
  for (const m of mails) {
    for (const f of fields) {
      if (m[f]) totals[f] = (totals[f] ?? 0) + m[f];
    }
  }
  return totals;
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

    const mails = await getUnclaimedMails(interaction.user.id, user.createdAt);

    if (mails.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setTitle("📬  Mailbox")
          .setDescription("Your mailbox is empty — no unclaimed rewards.")
          .setFooter({ text: "CARTETHYIA  ·  Mail" })],
      });
      return;
    }

    const PAGE = 5;
    let page = 0;

    function buildEmbed(page: number, mails: any[]): EmbedBuilder {
      const slice = mails.slice(page * PAGE, (page + 1) * PAGE);
      const lines = slice.map((m, i) => {
        const idx    = page * PAGE + i + 1;
        const reward = hasRewards(m) ? `\n> ${fmtRewards(m)}` : "";
        const scope  = m.targetUserId ? "✉️ Personal" : "📡 Global";
        return `**${idx}. ${m.subject}**  ·  *${timeAgo(m.sentAt)}*  ·  ${scope}\n${m.body}${reward}`;
      });

      const totalRewards = fmtRewards(sumRewards(mails));
      return new EmbedBuilder()
        .setColor(0xFCD34D)
        .setTitle(`📬  Mailbox  ·  ${mails.length} unread`)
        .setDescription(lines.join("\n\n"))
        .addFields({ name: "Total if claimed all", value: totalRewards, inline: false })
        .setFooter({ text: `CARTETHYIA  ·  Mail  ·  Page ${page + 1}/${Math.ceil(mails.length / PAGE)}` });
    }

    function buildRow(page: number, total: number, disabled = false) {
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

    const msg = await interaction.editReply({
      embeds:     [buildEmbed(page, mails)],
      components: [buildRow(page, mails.length)],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: b => b.user.id === interaction.user.id,
      time: 3 * 60 * 1000,
    });

    let remaining = [...mails];

    collector.on("collect", async btn => {
      await btn.deferUpdate();

      if (btn.customId === "mail_prev") {
        page = Math.max(0, page - 1);
        await btn.editReply({ embeds: [buildEmbed(page, remaining)], components: [buildRow(page, remaining.length)] });
        return;
      }

      if (btn.customId === "mail_next") {
        page = Math.min(Math.ceil(remaining.length / PAGE) - 1, page + 1);
        await btn.editReply({ embeds: [buildEmbed(page, remaining)], components: [buildRow(page, remaining.length)] });
        return;
      }

      // Claim page or all
      const toClaim = btn.customId === "mail_claim_all"
        ? remaining
        : remaining.slice(page * PAGE, (page + 1) * PAGE);

      if (toClaim.length === 0) {
        await btn.editReply({ embeds: [buildEmbed(page, remaining)], components: [buildRow(page, remaining.length)] });
        return;
      }

      // Claim each in sequence (transaction per mail to avoid partial-reward races)
      for (const m of toClaim) {
        await claimMail(m.id, interaction.user.id);
      }

      const totals   = sumRewards(toClaim);
      const rewarded = fmtRewards(totals);

      remaining = remaining.filter(m => !toClaim.find(c => c.id === m.id));
      page      = Math.min(page, Math.max(0, Math.ceil(remaining.length / PAGE) - 1));

      if (remaining.length === 0) {
        collector.stop("done");
        await btn.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0x10B981)
            .setTitle("📬  All Mail Claimed!")
            .setDescription(`**Rewards received:**\n${rewarded}`)
            .setFooter({ text: "CARTETHYIA  ·  Mailbox empty" })],
          components: [],
        });
        return;
      }

      await btn.editReply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setTitle("✅  Claimed!")
          .setDescription(`**Received:** ${rewarded}\n\n**${remaining.length} mail${remaining.length > 1 ? "s" : ""} remaining.**`)
          .setFooter({ text: "CARTETHYIA  ·  Mail" })
          .setTimestamp()],
        components: [],
      });

      // Re-show inbox with remaining after 3s
      await new Promise(r => setTimeout(r, 3000));
      await btn.editReply({
        embeds:     [buildEmbed(page, remaining)],
        components: [buildRow(page, remaining.length)],
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
