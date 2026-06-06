import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, getAffinity } from "../../lib/economy";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

function affinityRank(score: number): { rank: string; next: number | null; desc: string } {
  if (score >= 1000) return { rank: "💠 Resonant Soul",   next: null, desc: "An unbreakable bond forged through shared resonance." };
  if (score >= 500)  return { rank: "💜 Deep Harmony",    next: 1000, desc: "Your synchrony grants power in battle together."       };
  if (score >= 200)  return { rank: "💙 Warm Affinity",   next: 500,  desc: "A genuine connection is forming between you."          };
  if (score >= 75)   return { rank: "🤍 Familiar",        next: 200,  desc: "You've spent enough time together to feel at ease."     };
  if (score >= 20)   return { rank: "🩶 Acquainted",      next: 75,   desc: "You've crossed paths more than once."                   };
  return               { rank: "⬜ Strangers",           next: 20,   desc: "The resonance between you is barely a whisper."         };
}

function progressBar(current: number, next: number | null): string {
  if (!next) return "▰▰▰▰▰▰▰▰▰▰  MAX";
  const fill    = Math.min(10, Math.floor((current / next) * 10));
  return `${"▰".repeat(fill)}${"▱".repeat(10 - fill)}  ${current} / ${next}`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("affinity")
    .setDescription("View your Synchrony Affinity with another player.")
    .addUserOption((o) =>
      o.setName("user").setDescription("Who to check affinity with.").setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target = interaction.options.getUser("user", true);

    if (target.id === interaction.user.id) {
      await interaction.editReply({ content: "◈ You can't check affinity with yourself." });
      return;
    }
    if (target.bot) {
      await interaction.editReply({ content: "◈ Bots don't form bonds." });
      return;
    }

    const displayName  = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const targetName   = interaction.guild?.members.cache.get(target.id)?.displayName
      ?? target.displayName ?? target.username;
    const actorAvatar  = interaction.user.displayAvatarURL({ size: 64, extension: "png" });
    const targetAvatar = target.displayAvatarURL({ size: 64, extension: "png" });

    await Promise.all([
      getOrCreateUser(interaction.user.id, displayName, actorAvatar),
      getOrCreateUser(target.id, targetName, targetAvatar),
    ]);

    const affinity = await getAffinity(interaction.user.id, target.id);
    const score    = affinity?.score ?? 0;
    const { rank, next, desc } = affinityRank(score);

    // Fetch actor element for color
    const dbUser = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { element: true } });
    const color  = ELEMENT_HEX[dbUser?.element ?? "NONE"] ?? ELEMENT_HEX.NONE;

    // Top interactions count
    const vibeCount = await prisma.affinity.findFirst({
      where: {
        OR: [
          { userAId: interaction.user.id, userBId: target.id },
          { userAId: target.id, userBId: interaction.user.id },
        ],
      },
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setAuthor({ name: `${displayName}  ×  ${targetName}`, iconURL: actorAvatar })
          .setThumbnail(targetAvatar)
          .setDescription([
            `## ${rank}`,
            `*${desc}*`,
            ``,
            `\`${progressBar(score, next)}\``,
            ``,
            score >= 500
              ? `◈  **Synchrony Aura** active in Co-op — +10% Max HP, +15% Damage`
              : `◈  Reach **500 Synchrony** to unlock the **Synchrony Aura** combat buff`,
          ].join("\n"))
          .setFooter({ text: "CARTETHYIA  ·  Use /vibe to build affinity  ·  Return actions give 2× bonus" }),
      ],
    });
  },
};

export default command;
