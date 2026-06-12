import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { generateAbilityCard } from "../../lib/abilityCard";
import { formatEffects, sanitizeEffects } from "../../lib/abilityEffects";
import { formatV2Effects, sanitizeV2Effects } from "../../lib/abilityEngineV2";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("ability")
    .setDescription("View your unique resonance ability.")
    .addUserOption(o =>
      o.setName("user").setDescription("View another player's ability.").setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target      = interaction.options.getUser("user") ?? interaction.user;
    const avatarUrl   = target.displayAvatarURL({ size: 128, extension: "png" });
    const displayName = interaction.guild?.members.cache.get(target.id)?.displayName
      ?? target.displayName ?? target.username;

    const user = await prisma.user.findUnique({
      where:  { id: target.id },
      select: {
        element:              true,
        uniqueAbilityName:    true,
        uniqueAbilityEffects: true,
        uniqueAbilityType:    true,
        uniqueAbilityLore:    true,
        abilityEvolved:       true,
        abilityVersion:       true,
        worldLevel:           true,
      },
    });

    if (!user) {
      await replyNotStarted(interaction);
      return;
    }

    const color = ELEMENT_HEX[user.element as string] ?? ELEMENT_HEX.NONE;

    // No ability yet — tell them how to get it
    if (!user.uniqueAbilityName) {
      const hint = user.worldLevel === 0
        ? "◈ Your unique ability is forged when you win your first **Ascension Trial** (`/ascend`).\n\nReach **Level 20**, choose your element, then challenge the boss."
        : "◈ Ability data not found. Use `/debugability regenerate` or contact the server owner.";

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setAuthor({ name: `${displayName}  ·  Unique Ability`, iconURL: avatarUrl })
          .setDescription(hint)
          .setFooter({ text: "CARTETHYIA  ·  Unique Ability System" })],
      });
      return;
    }

    const isV2        = user.abilityVersion === 2;
    const effectLines = isV2
      ? formatV2Effects(sanitizeV2Effects(user.uniqueAbilityEffects))
          .replace(/\*\*/g, "").replace(/\*([^*]+)\*/g, "$1")
          .split("\n").filter(Boolean)
      : formatEffects(sanitizeEffects(user.uniqueAbilityEffects, user.abilityEvolved)).split("\n").filter(Boolean);

    // Generate the ability card
    const cardBuffer = await generateAbilityCard({
      displayName,
      avatarUrl,
      element:     user.element as string,
      abilityName: user.uniqueAbilityName,
      effects:     effectLines,
      lore:        user.uniqueAbilityLore ?? "",
      evolved:     user.abilityEvolved,
    });

    const loreText = user.uniqueAbilityLore ?? "";

    const embed = new EmbedBuilder()
      .setColor(user.abilityEvolved ? 0xFCD34D : color)
      .setImage("attachment://ability.png")
      .setFooter({ text: user.abilityEvolved ? "CARTETHYIA  ·  ✦ Evolved — this awakened form is yours alone." : "CARTETHYIA  ·  This ability is yours alone." });

    if (loreText) {
      embed.setDescription(`*${loreText}*`);
    }

    await interaction.editReply({
      embeds: [embed],
      files:  [new AttachmentBuilder(cardBuffer, { name: "ability.png" })],
    });
  },
};

export default command;
