import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { generateInventoryCard } from "../../lib/inventoryCard";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your materials and currencies.")
    .addUserOption((o) =>
      o.setName("user").setDescription("Check another player's inventory.").setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target      = interaction.options.getUser("user") ?? interaction.user;
    const avatarUrl   = target.displayAvatarURL({ size: 128, extension: "png" });
    const displayName = interaction.guild?.members.cache.get(target.id)?.displayName
      ?? target.displayName ?? target.username;

    const user  = await getOrCreateUser(target.id, displayName, avatarUrl);
    const color = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;

    const card       = await generateInventoryCard(user, displayName, avatarUrl);
    const attachment = new AttachmentBuilder(card, { name: "inventory.png" });

    const embed = new EmbedBuilder()
      .setColor(color)
      .setImage("attachment://inventory.png")
      .setFooter({ text: "CARTETHYIA  ·  Material Inventory" });

    await interaction.editReply({ embeds: [embed], files: [attachment] });
  },
};

export default command;
