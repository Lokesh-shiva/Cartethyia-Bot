import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { RARITY_STARS, WEAPON_TYPE_EMOJI } from "../../lib/weapons";
import { WeaponType } from "@prisma/client";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("equip")
    .setDescription("Switch your equipped weapon from your arsenal."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl   = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const color   = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
    const weapons = await prisma.weapon.findMany({ where: { userId: interaction.user.id } });

    if (weapons.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x334155)
          .setDescription("◈ You don't own any weapons yet.\nUse **/forge** to craft one.")
          .setFooter({ text: "CARTETHYIA  ·  Arsenal" })],
      });
      return;
    }

    if (weapons.length === 1) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x334155)
          .setDescription(`◈ You only own one weapon: **${weapons[0].name}** — it's already equipped.\nForge more with **/forge**.`)
          .setFooter({ text: "CARTETHYIA  ·  Arsenal" })],
      });
      return;
    }

    const equipped = weapons.find((w) => w.isEquipped);

    const select = new StringSelectMenuBuilder()
      .setCustomId("equip_select")
      .setPlaceholder("Choose a weapon to equip...")
      .addOptions(
        weapons.map((w) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${w.name}  ${RARITY_STARS[w.rarity]}${w.isEquipped ? "  ← equipped" : ""}`)
            .setDescription(`ATK ${w.baseAtk}  ·  ${w.weaponType}${w.subStatType ? `  ·  ${w.subStatType.replace(/_/g, " ")} +${w.subStatVal}%` : ""}`)
            .setValue(w.id)
            .setEmoji(WEAPON_TYPE_EMOJI[w.weaponType as WeaponType])
            .setDefault(w.isEquipped)
        )
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const weaponList = weapons.map((w) =>
      `${w.isEquipped ? "▶" : "◇"}  **${w.name}**  ${RARITY_STARS[w.rarity]}  ·  ATK **${w.baseAtk}**`
    ).join("\n");

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${displayName}  ·  Arsenal`, iconURL: avatarUrl })
      .setDescription([
        `You own **${weapons.length}** weapon${weapons.length > 1 ? "s" : ""}:`,
        ``,
        weaponList,
        ``,
        `Select one below to equip it.`,
      ].join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Arsenal" });

    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time:   2 * 60 * 1000,
      max:    1,
    });

    collector.on("collect", async (sel) => {
      await sel.deferUpdate();
      const chosenId = sel.values[0];
      const chosen   = weapons.find((w) => w.id === chosenId)!;

      if (chosen.isEquipped) {
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0x334155)
            .setDescription(`◈ **${chosen.name}** is already equipped.`)],
          components: [],
        });
        return;
      }

      // Swap equipped
      await prisma.weapon.updateMany({ where: { userId: interaction.user.id, isEquipped: true }, data: { isEquipped: false } });
      await prisma.weapon.update({ where: { id: chosenId }, data: { isEquipped: true } });
      await prisma.user.update({ where: { id: interaction.user.id }, data: { weaponType: chosen.weaponType } });

      await sel.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setTitle(`✦ Weapon Equipped`)
            .setDescription([
              `**${chosen.name}**  ${RARITY_STARS[chosen.rarity]}`,
              `${WEAPON_TYPE_EMOJI[chosen.weaponType as WeaponType]}  ${chosen.weaponType}`,
              ``,
              `ATK  **${chosen.baseAtk}**${chosen.subStatType ? `  ·  ${chosen.subStatType.replace(/_/g, " ")}  +${chosen.subStatVal}%` : ""}`,
              equipped ? `\n◇ Unequipped: **${equipped.name}**` : "",
            ].filter(Boolean).join("\n"))
            .setFooter({ text: "CARTETHYIA  ·  Arsenal" }),
        ],
        components: [],
      });
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
