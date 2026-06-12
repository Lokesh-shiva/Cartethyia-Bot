import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { WEAPON_TYPE_LABEL, FORGED_WEAPONS } from "../../lib/weapons";
import { generateWeaponCard } from "../../lib/weaponCard";
import { formatAwakenedPassive } from "../../lib/weaponAwakening";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";
import { WeaponType } from "@prisma/client";
import prisma from "../../lib/prisma";

function effectiveAtk(baseAtk: number, rarity: number, level: number): number {
  const maxMult: Record<number, number> = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 };
  const mult = maxMult[rarity] ?? 2.5;
  return Math.round(baseAtk * (1 + (level - 1) * (mult - 1) / 89));
}
function effectiveSub(base: number, level: number): number {
  return Math.round((base * (1 + (level - 1) * 0.8 / 89)) * 10) / 10;
}

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
    const weapon = await prisma.weapon.findFirst({
      where: { userId: target.id, isEquipped: true },
      select: {
        name: true, weaponType: true, rarity: true, level: true,
        baseAtk: true, subStatType: true, subStatVal: true,
        hiddenSub1Type: true, hiddenSub1Val: true,
        hiddenSub2Type: true, hiddenSub2Val: true,
        awakened: true, awakenedName: true, awakenedLore: true, awakenedPassive: true, weaponBond: true,
      },
    });

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

    const weaponDef  = FORGED_WEAPONS.find(w => w.name === weapon.name);
    const wishDef    = ALL_WISH_WEAPONS.find(w => w.name === weapon.name);

    // Compute hidden substat effective values (revealed at Lv20 / Lv50)
    const h1Val = weapon.level >= 20 && weapon.hiddenSub1Val != null
      ? calcWishSubStat(weapon.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, weapon.level)
      : null;
    const h2Val = weapon.level >= 50 && weapon.hiddenSub2Val != null
      ? calcWishSubStat(weapon.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, weapon.level)
      : null;

    // Generate weapon card
    const cardBuffer = await generateWeaponCard({
      name:         weapon.name,
      weaponType:   weapon.weaponType,
      rarity:       weapon.rarity,
      level:        weapon.level,
      baseAtk:      weapon.baseAtk,
      effectiveAtk: effectiveAtk(weapon.baseAtk, weapon.rarity, weapon.level),
      subStatType:  weapon.subStatType ?? null,
      subStatVal:   weapon.subStatVal  ?? null,
      effectiveSub: weapon.subStatVal  != null ? effectiveSub(weapon.subStatVal, weapon.level) : null,
      passive:      weapon.awakened && weapon.awakenedPassive
        ? formatAwakenedPassive(weapon.awakenedPassive)
        : weaponDef?.passive ?? WEAPON_TYPE_LABEL[weapon.weaponType as WeaponType] ?? "",
      element:      user.element,
      ownerName:    displayName,
      ownerAvatar:  avatarUrl,
      hiddenSub1Type: weapon.hiddenSub1Type ?? null,
      hiddenSub1Val:  h1Val,
      hiddenSub2Type: weapon.hiddenSub2Type ?? null,
      hiddenSub2Val:  h2Val,
      awakened:      weapon.awakened,
      awakenedName:  weapon.awakenedName,
      weaponBond:    weapon.weaponBond,
    });

    const attachment = new AttachmentBuilder(cardBuffer, { name: "weapon.png" });
    const embed = new EmbedBuilder()
      .setColor(weapon.awakened ? 0xFCD34D : color)
      .setAuthor({ name: `${displayName}  ·  Equipped Weapon`, iconURL: avatarUrl })
      .setImage("attachment://weapon.png")
      .setFooter({ text: weapon.awakened ? "CARTETHYIA  ·  Arsenal  ·  ✦ Ego Awakened" : "CARTETHYIA  ·  Arsenal  ·  /forge to change  ·  /weapon-upgrade to level up" });
    if (weapon.awakened && weapon.awakenedLore) embed.setDescription(`*${weapon.awakenedLore}*`);

    await interaction.editReply({ embeds: [embed], files: [attachment] });
  },
};

export default command;
