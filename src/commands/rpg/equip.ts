import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { RARITY_STARS, WEAPON_TYPE_EMOJI, FORGED_WEAPONS } from "../../lib/weapons";
import { generateWeaponCard } from "../../lib/weaponCard";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";
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

      const wishDef  = ALL_WISH_WEAPONS.find(x => x.name === chosen.name);
      const forgeDef = FORGED_WEAPONS.find(x => x.name === chosen.name);
      const h1Val = chosen.level >= 20 && chosen.hiddenSub1Val != null
        ? calcWishSubStat(chosen.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, chosen.level) : null;
      const h2Val = chosen.level >= 50 && chosen.hiddenSub2Val != null
        ? calcWishSubStat(chosen.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, chosen.level) : null;

      const maxMult: Record<number, number> = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 };
      const effectiveAtk = Math.round(chosen.baseAtk * (1 + (chosen.level - 1) * ((maxMult[chosen.rarity] ?? 2.5) - 1) / 89));
      const effectiveSub = chosen.subStatVal != null
        ? Math.round((chosen.subStatVal * (1 + (chosen.level - 1) * 0.8 / 89)) * 10) / 10 : null;

      const cardBuf = await generateWeaponCard({
        name:         chosen.name,
        weaponType:   chosen.weaponType,
        rarity:       chosen.rarity,
        level:        chosen.level,
        baseAtk:      chosen.baseAtk,
        effectiveAtk,
        subStatType:  chosen.subStatType ?? null,
        subStatVal:   chosen.subStatVal  ?? null,
        effectiveSub,
        passive:      chosen.awakened && (chosen.awakenedPassive as any)?.desc
          ? (chosen.awakenedPassive as any).desc
          : forgeDef?.passive ?? "",
        element:      user.element,
        ownerName:    displayName,
        ownerAvatar:  avatarUrl,
        hiddenSub1Type: chosen.hiddenSub1Type ?? null,
        hiddenSub1Val:  h1Val,
        hiddenSub2Type: chosen.hiddenSub2Type ?? null,
        hiddenSub2Val:  h2Val,
        awakened:      chosen.awakened,
        awakenedName:  chosen.awakenedName,
        weaponBond:    chosen.weaponBond,
      });
      const file = new AttachmentBuilder(cardBuf, { name: "weapon.png" });

      const displayName2 = (chosen.awakened && chosen.awakenedName) ? chosen.awakenedName : chosen.name;
      await sel.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(chosen.awakened ? 0xFCD34D : color)
            .setTitle(`✦ ${chosen.awakened ? "Ego Weapon" : "Weapon"} Equipped`)
            .setDescription([
              equipped ? `◇ Unequipped: **${(equipped.awakened && equipped.awakenedName) ? equipped.awakenedName : equipped.name}**` : "",
            ].filter(Boolean).join("\n") || null)
            .setImage("attachment://weapon.png")
            .setFooter({ text: `CARTETHYIA  ·  Arsenal${chosen.awakened ? `  ·  ✦ ${displayName2}` : ""}` }),
        ],
        files: [file],
        components: [],
      });
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
