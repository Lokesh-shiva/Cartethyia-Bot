import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { RARITY_STARS, WEAPON_TYPE_EMOJI } from "../../lib/weapons";
import { generateWeaponCard } from "../../lib/weaponCard";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";
import { FORGED_WEAPONS } from "../../lib/weapons";
import { WeaponType } from "@prisma/client";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

function effectiveAtk(baseAtk: number, rarity: number, level: number): number {
  const maxMult: Record<number, number> = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 };
  return Math.round(baseAtk * (1 + (level - 1) * ((maxMult[rarity] ?? 2.5) - 1) / 89));
}
function effectiveSub(base: number, level: number): number {
  return Math.round((base * (1 + (level - 1) * 0.8 / 89)) * 10) / 10;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("weapons")
    .setDescription("View all weapons in your arsenal.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl   = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const color   = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
    const weapons = await prisma.weapon.findMany({
      where:   { userId: interaction.user.id },
      orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "desc" }],
    });

    if (weapons.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x334155)
          .setDescription("◈ You don't own any weapons yet.\nUse **/forge** to craft one or **/wish** to pull from the banner.")
          .setFooter({ text: "CARTETHYIA  ·  Arsenal" })],
      });
      return;
    }

    const buildCard = async (weaponId: string) => {
      const w = weapons.find(x => x.id === weaponId)!;
      const wishDef   = ALL_WISH_WEAPONS.find(x => x.name === w.name);
      const forgeDef  = FORGED_WEAPONS.find(x => x.name === w.name);
      const h1Val = w.level >= 20 && w.hiddenSub1Val != null
        ? calcWishSubStat(w.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, w.level) : null;
      const h2Val = w.level >= 50 && w.hiddenSub2Val != null
        ? calcWishSubStat(w.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, w.level) : null;

      const buf = await generateWeaponCard({
        name:         w.name,
        weaponType:   w.weaponType,
        rarity:       w.rarity,
        level:        w.level,
        baseAtk:      w.baseAtk,
        effectiveAtk: effectiveAtk(w.baseAtk, w.rarity, w.level),
        subStatType:  w.subStatType ?? null,
        subStatVal:   w.subStatVal  ?? null,
        effectiveSub: w.subStatVal  != null ? effectiveSub(w.subStatVal, w.level) : null,
        passive:      w.awakened && (w.awakenedPassive as any)?.desc
          ? (w.awakenedPassive as any).desc
          : forgeDef?.passive ?? "",
        element:      user.element,
        ownerName:    displayName,
        ownerAvatar:  avatarUrl,
        hiddenSub1Type: w.hiddenSub1Type ?? null,
        hiddenSub1Val:  h1Val,
        hiddenSub2Type: w.hiddenSub2Type ?? null,
        hiddenSub2Val:  h2Val,
        awakened:      w.awakened,
        awakenedName:  w.awakenedName,
        weaponBond:    w.weaponBond,
      });
      return buf;
    };

    const makeEmbed = (weaponId: string) => {
      const w = weapons.find(x => x.id === weaponId)!;
      const displayName2 = (w.awakened && w.awakenedName) ? w.awakenedName : w.name;
      return new EmbedBuilder()
        .setColor(w.awakened ? 0xFCD34D : color)
        .setAuthor({ name: `${displayName}  ·  Arsenal (${weapons.length} weapons)`, iconURL: avatarUrl })
        .setDescription(w.isEquipped ? `**Currently equipped**` : `◇ Not equipped  ·  use \`/equip\` to switch`)
        .setImage("attachment://weapon.png")
        .setFooter({ text: w.awakened ? `CARTETHYIA  ·  Arsenal  ·  ✦ Ego Awakened  ·  ${displayName2}` : `CARTETHYIA  ·  Arsenal` });
    };

    const makeSelect = (selectedId: string) => new StringSelectMenuBuilder()
      .setCustomId("weapons_select")
      .setPlaceholder("Browse your arsenal…")
      .addOptions(weapons.map(w =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${(w.awakened && w.awakenedName) ? w.awakenedName : w.name}  ${RARITY_STARS[w.rarity]}${w.isEquipped ? "  ← equipped" : ""}`)
          .setDescription(`Lv${w.level}  ·  ATK ${w.baseAtk}  ·  ${w.weaponType}${w.awakened ? "  ·  ✦ AWAKENED" : ""}`)
          .setValue(w.id)
          .setEmoji(WEAPON_TYPE_EMOJI[w.weaponType as WeaponType])
          .setDefault(w.id === selectedId)
      ));

    // Start with equipped weapon (first in sorted list)
    const initial = weapons[0];
    const buf     = await buildCard(initial.id);
    const file    = new AttachmentBuilder(buf, { name: "weapon.png" });
    const row     = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(makeSelect(initial.id));

    const msg = await interaction.editReply({ embeds: [makeEmbed(initial.id)], files: [file], components: [row] });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id,
      time:   5 * 60 * 1000,
    });

    collector.on("collect", async sel => {
      await sel.deferUpdate();
      const chosenId = sel.values[0];
      const cardBuf  = await buildCard(chosenId);
      const newFile  = new AttachmentBuilder(cardBuf, { name: "weapon.png" });
      const newRow   = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(makeSelect(chosenId));
      await sel.editReply({ embeds: [makeEmbed(chosenId)], files: [newFile], components: [newRow] });
    });

    collector.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
