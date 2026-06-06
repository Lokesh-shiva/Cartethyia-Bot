import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import {
  FORGED_WEAPONS, RARITY_STARS, WEAPON_TYPE_LABEL,
  WEAPON_TYPE_EMOJI, WeaponDefinition,
} from "../../lib/weapons";
import { WeaponType } from "@prisma/client";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const TYPE_CHOICES = [
  { name: "🗡️  Broadblade  — Slow, massive damage",         value: "BROADBLADE" },
  { name: "⚔️  Sword  — Balanced, medium speed",             value: "SWORD"      },
  { name: "🔫  Pistols  — Multi-hit, great for Crit builds", value: "PISTOLS"    },
  { name: "🔮  Rectifier  — Converts attacks to elemental",  value: "RECTIFIER"  },
];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("forge")
    .setDescription("Craft a weapon using Forging Ores.")
    .addStringOption((o) =>
      o.setName("type")
        .setDescription("Weapon type to browse")
        .setRequired(true)
        .addChoices(...TYPE_CHOICES)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const type        = interaction.options.getString("type", true) as WeaponType;
    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl   = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const color   = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
    const weapons = FORGED_WEAPONS.filter((w) => w.type === type);

    // Current equipped weapon
    const equipped = await prisma.weapon.findFirst({ where: { userId: interaction.user.id, isEquipped: true } });

    // ── Weapon browser embed ─────────────────────────────────────────────────
    const weaponList = weapons.map((w) => {
      const canAfford = user.forgingOres >= w.forgeCost;
      const isEquipped = equipped?.name === w.name;
      return [
        `${canAfford ? "✅" : "❌"}  **${w.name}**  ${RARITY_STARS[w.rarity]}`,
        `${WEAPON_TYPE_EMOJI[type]}  ATK: **${w.baseAtk}**  ·  ${w.subStatType.replace(/_/g, " ")}: +${w.subStatVal}%`,
        `*${w.passive}*`,
        `Cost: **${w.forgeCost}** Forging Ore${w.forgeCost > 1 ? "s" : ""}${isEquipped ? "  ·  *(equipped)*" : ""}`,
      ].join("\n");
    }).join("\n\n");

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${displayName}  ·  Forge`, iconURL: avatarUrl })
      .setDescription([
        `◈  **${WEAPON_TYPE_EMOJI[type]}  ${WEAPON_TYPE_LABEL[type]}**`,
        ``,
        `You have **${user.forgingOres}** Forging Ore${user.forgingOres !== 1 ? "s" : ""}`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        weaponList,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Select a weapon below to forge it.`,
      ].join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Forge  ·  Forging replaces your current weapon" });

    // ── Dropdown to select weapon ─────────────────────────────────────────────
    const select = new StringSelectMenuBuilder()
      .setCustomId("forge_select")
      .setPlaceholder("Choose a weapon to forge...")
      .addOptions(
        weapons.map((w) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${w.name}  ${RARITY_STARS[w.rarity]}`)
            .setDescription(`${w.forgeCost} Forging Ore${w.forgeCost > 1 ? "s" : ""}  ·  ATK ${w.baseAtk}  ·  ${w.passive.slice(0, 50)}`)
            .setValue(w.id)
            .setEmoji(w.rarity >= 3 ? "✨" : w.rarity >= 2 ? "🔹" : "⬜")
        )
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    // ── Handle selection ──────────────────────────────────────────────────────
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time:   5 * 60 * 1000,
      max:    1,
    });

    collector.on("collect", async (sel) => {
      await sel.deferUpdate();

      const chosen = weapons.find((w) => w.id === sel.values[0])!;

      // Refresh user for latest ore count
      const freshUser = await prisma.user.findUnique({ where: { id: interaction.user.id } });

      if (!freshUser || freshUser.forgingOres < chosen.forgeCost) {
        await sel.followUp({
          embeds: [
            new EmbedBuilder()
              .setColor(0xEF4444)
              .setDescription(`◈ Not enough Forging Ores.\nYou need **${chosen.forgeCost}** but have **${freshUser?.forgingOres ?? 0}**.\n\nEarn more from **/vibe** physical interactions and **/daily**.`)
              .setFooter({ text: "CARTETHYIA  ·  Forge" }),
          ],
          flags: 64,
        });
        return;
      }

      // Confirm prompt
      const confirmEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`⚒️ Forge  —  ${chosen.name}`)
        .setDescription([
          `${RARITY_STARS[chosen.rarity]}  ${WEAPON_TYPE_EMOJI[type]}  ${chosen.type}`,
          ``,
          `ATK  **${chosen.baseAtk}**  ·  ${chosen.subStatType.replace(/_/g, " ")}  +${chosen.subStatVal}%`,
          `*${chosen.passive}*`,
          ``,
          `Cost: **${chosen.forgeCost}** Forging Ore${chosen.forgeCost > 1 ? "s" : ""}`,
          equipped ? `\n⚠️ This will **replace** your current weapon: **${equipped.name}**` : "",
        ].filter(Boolean).join("\n"))
        .setFooter({ text: "CARTETHYIA  ·  Forge  ·  This cannot be undone" });

      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("forge_confirm").setLabel("⚒️  Forge it").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("forge_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      );

      await sel.editReply({ embeds: [confirmEmbed], components: [confirmRow] });

      // Confirm/cancel
      const btnCollector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b) => b.user.id === interaction.user.id,
        time:   60_000,
        max:    1,
      });

      btnCollector.on("collect", async (btn) => {
        await btn.deferUpdate();

        if (btn.customId === "forge_cancel") {
          await btn.editReply({ embeds: [embed], components: [] });
          return;
        }

        // Check if already owns this weapon
        const alreadyOwns = await prisma.weapon.findFirst({
          where: { userId: interaction.user.id, name: chosen.name },
        });
        if (alreadyOwns) {
          await btn.followUp({
            embeds: [new EmbedBuilder().setColor(0x334155)
              .setDescription(`◈ You already own **${chosen.name}**. Use **/equip** to switch weapons.`)],
            flags: 64,
          });
          return;
        }

        // Deduct ores + create new weapon (unequip current)
        await prisma.user.update({
          where: { id: interaction.user.id },
          data:  { forgingOres: { decrement: chosen.forgeCost } },
        });

        // Unequip all current weapons
        await prisma.weapon.updateMany({
          where: { userId: interaction.user.id, isEquipped: true },
          data:  { isEquipped: false },
        });

        // Create new weapon as equipped
        await prisma.weapon.create({
          data: {
            userId:      interaction.user.id,
            weaponType:  chosen.type,
            name:        chosen.name,
            rarity:      chosen.rarity,
            baseAtk:     chosen.baseAtk,
            subStatType: chosen.subStatType,
            subStatVal:  chosen.subStatVal,
            isEquipped:  true,
          },
        });

        // Update user's weaponType field
        await prisma.user.update({
          where: { id: interaction.user.id },
          data:  { weaponType: chosen.type },
        });

        await btn.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(color)
              .setTitle(`✦ ${chosen.name} Forged`)
              .setDescription([
                `${RARITY_STARS[chosen.rarity]}  ${WEAPON_TYPE_EMOJI[chosen.type]}  ${chosen.type}`,
                ``,
                `ATK  **${chosen.baseAtk}**  ·  ${chosen.subStatType.replace(/_/g, " ")}  +${chosen.subStatVal}%`,
                `*${chosen.passive}*`,
                ``,
                `Your weapon has been equipped. Check **/profile** to see it.`,
              ].join("\n"))
              .setFooter({ text: "CARTETHYIA  ·  Forge" }),
          ],
          components: [],
        });
      });
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  },
};

export default command;
