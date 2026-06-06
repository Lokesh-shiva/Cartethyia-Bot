import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { generateUniqueAbility } from "../../lib/uniqueAbility";
import { generateAbilityCard } from "../../lib/abilityCard";
import { formatEffects, sanitizeEffects, composeFallbackEffects } from "../../lib/abilityEffects";
import { OWNER_ID } from "../../lib/owner";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("debugability")
    .setDescription("🛠️ Preview your unique ability reveal card (owner only).")
    .setDefaultMemberPermissions(0)
    .addStringOption(o =>
      o.setName("element")
        .setDescription("Preview a card for any element (doesn't touch your data)")
        .setRequired(false)
        .addChoices(
          { name: "🔥 Fusion", value: "FUSION" }, { name: "❄️ Glacio", value: "GLACIO" },
          { name: "⚡ Electro", value: "ELECTRO" }, { name: "🌪️ Aero", value: "AERO" },
          { name: "🌑 Havoc", value: "HAVOC" }, { name: "✨ Spectro", value: "SPECTRO" },
        )
    )
    .addBooleanOption(o =>
      o.setName("reroll")
        .setDescription("Force a fresh ability (overwrites current one)")
        .setRequired(false)
    )
    .addUserOption(o =>
      o.setName("target")
        .setDescription("Reroll/preview for another user (owner only)")
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: "Owner only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const previewElement = interaction.options.getString("element");
    const targetUser     = interaction.options.getUser("target") ?? interaction.user;
    const targetId       = targetUser.id;
    const displayNameTop = interaction.guild?.members.cache.get(targetId)?.displayName
      ?? targetUser.displayName ?? targetUser.username;

    // ── Pure preview path: any element, any level, no DB writes ──────────────
    if (previewElement) {
      const effects = composeFallbackEffects(previewElement, interaction.user.id + Date.now());
      const effList = formatEffects(sanitizeEffects(effects)).split("\n").filter(Boolean);
      const cardBuf = await generateAbilityCard({
        displayName: displayNameTop,
        avatarUrl:   interaction.user.displayAvatarURL({ size: 128, extension: "png" }),
        element:     previewElement,
        abilityName: "Preview Resonance",
        effects:     effList,
        lore:        "A glimpse of what the Grid might forge for one such as you.",
      });
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x8B7FF5).setImage("attachment://ability.png")
          .setFooter({ text: `🛠️ ${previewElement} preview (not saved) · run again for a different roll` })],
        files: [new AttachmentBuilder(cardBuf, { name: "ability.png" })],
      });
      return;
    }

    const reroll = interaction.options.getBoolean("reroll") ?? false;

    // Reroll clears the existing ability so generation runs fresh
    if (reroll) {
      await prisma.user.update({
        where: { id: targetId },
        data:  {
          uniqueAbilityName: null, uniqueAbilityEffect: null, uniqueAbilityLore: null,
          uniqueAbilityType: null, uniqueAbilityValue: null, uniqueAbilityEffects: undefined,
        },
      });
    }

    const user = await prisma.user.findUnique({
      where:  { id: targetId },
      select: { element: true },
    });
    if (!user || user.element === "NONE") {
      await interaction.editReply({ content: `${displayNameTop} hasn't chosen an element yet — they need a real element before ability generation.` });
      return;
    }

    const ability = await generateUniqueAbility(targetId);
    if (!ability) { await interaction.editReply({ content: "Generation failed." }); return; }

    const me = await prisma.user.findUnique({
      where:  { id: targetId },
      select: { uniqueAbilityEffects: true },
    });
    const effList = formatEffects(sanitizeEffects(me?.uniqueAbilityEffects)).split("\n").filter(Boolean);

    const displayName = displayNameTop;

    const cardBuf = await generateAbilityCard({
      displayName,
      avatarUrl:   targetUser.displayAvatarURL({ size: 128, extension: "png" }),
      element:     user.element,
      abilityName: ability.name,
      effects:     effList,
      lore:        ability.lore,
    });

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x8B7FF5)
        .setImage("attachment://ability.png")
        .setDescription(`**${ability.name}** — *${ability.effect}*`)
        .setFooter({ text: `🛠️ Debug preview${reroll ? " (rerolled)" : ""}  ·  /debugability reroll:true for a new one` })],
      files: [new AttachmentBuilder(cardBuf, { name: "ability.png" })],
    });
  },
};

export default command;
