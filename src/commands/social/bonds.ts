import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { BondType } from "@prisma/client";
import prisma from "../../lib/prisma";

const BOND_EMOJI: Record<BondType, string> = {
  FRIEND:         "🤝",
  PARTNER:        "💞",
  ADOPTED_PARENT: "🛡️",
  ADOPTED_CHILD:  "🌱",
};

const BOND_LABEL: Record<BondType, string> = {
  FRIEND:         "Friend",
  PARTNER:        "Partner",
  ADOPTED_PARENT: "Parent",
  ADOPTED_CHILD:  "Child",
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("bonds")
    .setDescription("View all your Synchrony Bonds.")
    .addUserOption(opt =>
      opt.setName("user").setDescription("View another player's bonds.").setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const target      = interaction.options.getUser("user") ?? interaction.user;
    const member      = interaction.guild?.members.cache.get(target.id)
                     ?? await interaction.guild?.members.fetch(target.id).catch(() => null);
    const displayName = member?.displayName ?? target.displayName ?? target.username;

    await getOrCreateUser(target.id, displayName, target.displayAvatarURL());

    const rawBonds = await prisma.bond.findMany({
      where: { OR: [{ initiatorId: target.id }, { receiverId: target.id }] },
    });

    if (rawBonds.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x334155)
          .setDescription(`◈ **${displayName}** has no Synchrony Bonds yet.\nUse **/bond** to form one.`)
          .setFooter({ text: "CARTETHYIA  ·  Bonds" })],
      });
      return;
    }

    const partnerIds = rawBonds.map(b =>
      b.initiatorId === target.id ? b.receiverId : b.initiatorId
    );

    const partnerUsers = await prisma.user.findMany({
      where:  { id: { in: partnerIds } },
      select: { id: true, username: true },
    });

    const affinities = await prisma.affinity.findMany({
      where: {
        OR: partnerIds.map(pid => {
          const [a, b] = [target.id, pid].sort();
          return { userAId: a, userBId: b };
        }),
      },
      select: { userAId: true, userBId: true, score: true },
    });

    const getScore = (partnerId: string) => {
      const [a, b] = [target.id, partnerId].sort();
      return affinities.find(af => af.userAId === a && af.userBId === b)?.score ?? 0;
    };

    const sorted = [...rawBonds].sort((a, b) => {
      const pA = a.initiatorId === target.id ? a.receiverId : a.initiatorId;
      const pB = b.initiatorId === target.id ? b.receiverId : b.initiatorId;
      return getScore(pB) - getScore(pA);
    });

    const lines = sorted.map(b => {
      const partnerId = b.initiatorId === target.id ? b.receiverId : b.initiatorId;
      const pu        = partnerUsers.find(p => p.id === partnerId);
      const gMember   = interaction.guild?.members.cache.get(partnerId);
      const name      = gMember?.displayName ?? pu?.username ?? "Unknown";
      const score     = getScore(partnerId);
      return `${BOND_EMOJI[b.bondType]} **${name}** — ${BOND_LABEL[b.bondType]}  ·  ✨ ${score} Synchrony`;
    });

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x60A5FA)
        .setTitle(`🔗  ${displayName}'s Synchrony Bonds`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: `CARTETHYIA  ·  ${rawBonds.length} bond${rawBonds.length !== 1 ? "s" : ""}` })
        .setThumbnail(target.displayAvatarURL({ size: 128 }))],
    });
  },
};

export default command;
