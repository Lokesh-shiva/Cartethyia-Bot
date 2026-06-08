import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { RARITY_STARS, WEAPON_TYPE_EMOJI, WEAPON_TYPE_LABEL, getWeaponImagePath } from "../../lib/weapons";
import { WeaponType } from "@prisma/client";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("weapon")
    .setDescription("View your equipped weapon.")
    .addUserOption((o) =>
      o.setName("user").setDescription("View another player's weapon.").setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target      = interaction.options.getUser("user") ?? interaction.user;
    const displayName = interaction.guild?.members.cache.get(target.id)?.displayName
      ?? target.displayName ?? target.username;
    const avatarUrl   = target.displayAvatarURL({ size: 128, extension: "png" });

    const user   = await getOrCreateUser(target.id, displayName, avatarUrl);
    const color  = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
    const weapon = await prisma.weapon.findFirst({ where: { userId: target.id, isEquipped: true } });

    if (!weapon) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x334155)
            .setAuthor({ name: `${displayName}  ·  Weapon`, iconURL: avatarUrl })
            .setDescription(
              target.id === interaction.user.id
                ? `◈ You don't have a weapon yet.\nUse **/forge** to craft one with Forging Ores.`
                : `◈ **${displayName}** hasn't forged a weapon yet.`
            )
            .setFooter({ text: "CARTETHYIA  ·  Arsenal" }),
        ],
      });
      return;
    }

    const stars   = RARITY_STARS[weapon.rarity] ?? "★☆☆☆☆";
    const emoji   = WEAPON_TYPE_EMOJI[weapon.weaponType as WeaponType] ?? "⚔️";
    const imgPath = getWeaponImagePath(weapon.weaponType, weapon.name);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${displayName}  ·  Equipped Weapon`, iconURL: avatarUrl })
      .setDescription([
        `## ${emoji}  ${weapon.name}`,
        `${stars}  ·  ${weapon.weaponType}`,
        ``,
        `◈  Base ATK  **${weapon.baseAtk}**`,
        weapon.subStatType
          ? `◈  ${weapon.subStatType.replace(/_/g, " ")}  **+${weapon.subStatVal}%**`
          : "",
        ``,
        `*${WEAPON_TYPE_LABEL[weapon.weaponType as WeaponType]}*`,
        ``,
        `Level **${weapon.level}** / 90`,
      ].filter(Boolean).join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Arsenal  ·  /forge to change weapons" });

    const files: AttachmentBuilder[] = [];
    if (imgPath) {
      files.push(new AttachmentBuilder(imgPath, { name: "weapon.png" }));
      embed.setThumbnail("attachment://weapon.png");
    }

    await interaction.editReply({ embeds: [embed], files });
  },
};

export default command;
