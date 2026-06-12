import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { RARITY_STARS, WEAPON_TYPE_EMOJI, FORGED_WEAPONS } from "../../lib/weapons";
import { generateWeaponCard } from "../../lib/weaponCard";
import { formatAwakenedPassive } from "../../lib/weaponAwakening";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";
import { WeaponType } from "@prisma/client";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const MAX_MULT: Record<number, number> = { 1: 2.5, 2: 3.0, 3: 3.5, 4: 4.2, 5: 5.0 };

function effectiveAtk(baseAtk: number, rarity: number, level: number): number {
  return Math.round(baseAtk * (1 + (level - 1) * ((MAX_MULT[rarity] ?? 2.5) - 1) / 89));
}
function effectiveSub(base: number, level: number): number {
  return Math.round((base * (1 + (level - 1) * 0.8 / 89)) * 10) / 10;
}

function weaponBlock(w: any): string {
  if (!w) return "*Nothing currently equipped.*";
  const displayName = (w.awakened && w.awakenedName) ? w.awakenedName : w.name;
  const wishDef   = ALL_WISH_WEAPONS.find(x => x.name === w.name);
  const forgeDef  = FORGED_WEAPONS.find(x => x.name === w.name);

  const lines: string[] = [];
  lines.push(`**${displayName}**  ${RARITY_STARS[w.rarity]}`);
  lines.push(`${WEAPON_TYPE_EMOJI[w.weaponType as WeaponType]}  ${w.weaponType}  ·  Lv${w.level}${w.awakened ? "  ·  ✦ Awakened" : ""}`);
  lines.push(`\`ATK: ${effectiveAtk(w.baseAtk, w.rarity, w.level)}\``);

  if (w.subStatType && w.subStatVal != null) {
    const sub = effectiveSub(w.subStatVal, w.level);
    lines.push(`${w.subStatType.replace(/_/g, " ")}: **${sub}%**`);
  }

  // Hidden subs (if unlocked at level)
  if (w.level >= 20 && w.hiddenSub1Type && w.hiddenSub1Val != null) {
    const h1 = calcWishSubStat(w.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, w.level);
    lines.push(`${w.hiddenSub1Type.replace(/_/g, " ")}: **${h1}%** *(hidden)*`);
  }
  if (w.level >= 50 && w.hiddenSub2Type && w.hiddenSub2Val != null) {
    const h2 = calcWishSubStat(w.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, w.level);
    lines.push(`${w.hiddenSub2Type.replace(/_/g, " ")}: **${h2}%** *(hidden)*`);
  }

  // Passive
  const passiveDesc = w.awakened && w.awakenedPassive
    ? formatAwakenedPassive(w.awakenedPassive)
    : forgeDef?.passive ?? "";
  if (passiveDesc) {
    const short = passiveDesc.length > 80 ? passiveDesc.slice(0, 77) + "…" : passiveDesc;
    lines.push(`*${short}*`);
  }

  return lines.join("\n");
}

async function buildCard(w: any, element: string, ownerName: string, ownerAvatar: string): Promise<Buffer> {
  const wishDef   = ALL_WISH_WEAPONS.find(x => x.name === w.name);
  const forgeDef  = FORGED_WEAPONS.find(x => x.name === w.name);
  const h1Val = w.level >= 20 && w.hiddenSub1Val != null
    ? calcWishSubStat(w.hiddenSub1Val, wishDef?.hiddenSub1Scale ?? 1.8, w.level) : null;
  const h2Val = w.level >= 50 && w.hiddenSub2Val != null
    ? calcWishSubStat(w.hiddenSub2Val, wishDef?.hiddenSub2Scale ?? 1.8, w.level) : null;

  return generateWeaponCard({
    name:         w.name,
    weaponType:   w.weaponType,
    rarity:       w.rarity,
    level:        w.level,
    baseAtk:      w.baseAtk,
    effectiveAtk: effectiveAtk(w.baseAtk, w.rarity, w.level),
    subStatType:  w.subStatType ?? null,
    subStatVal:   w.subStatVal  ?? null,
    effectiveSub: w.subStatVal != null ? effectiveSub(w.subStatVal, w.level) : null,
    passive:      w.awakened && w.awakenedPassive
      ? formatAwakenedPassive(w.awakenedPassive)
      : forgeDef?.passive ?? "",
    element,
    ownerName,
    ownerAvatar,
    hiddenSub1Type: w.hiddenSub1Type ?? null,
    hiddenSub1Val:  h1Val,
    hiddenSub2Type: w.hiddenSub2Type ?? null,
    hiddenSub2Val:  h2Val,
    awakened:      w.awakened,
    awakenedName:  w.awakenedName,
    weaponBond:    w.weaponBond,
  });
}

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
    const weapons = await prisma.weapon.findMany({
      where:   { userId: interaction.user.id },
      orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "desc" }],
    });

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
          .setDescription(`◈ You only own one weapon: **${weapons[0].awakened && weapons[0].awakenedName ? weapons[0].awakenedName : weapons[0].name}** — it's already equipped.\nForge more with **/forge**.`)
          .setFooter({ text: "CARTETHYIA  ·  Arsenal" })],
      });
      return;
    }

    const equipped = weapons.find((w) => w.isEquipped);

    // ── Build select menu ────────────────────────────────────────────────────
    const makeSelect = () => new StringSelectMenuBuilder()
      .setCustomId("equip_select")
      .setPlaceholder("Choose a weapon to equip…")
      .addOptions(weapons.map((w) => {
        const label = (w.awakened && w.awakenedName) ? w.awakenedName : w.name;
        const eff   = effectiveAtk(w.baseAtk, w.rarity, w.level);
        const sub   = w.subStatType && w.subStatVal != null
          ? `  ·  ${w.subStatType.replace(/_/g, " ")} ${effectiveSub(w.subStatVal, w.level)}%`
          : "";
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${label}  ${RARITY_STARS[w.rarity]}${w.isEquipped ? "  ← equipped" : ""}`)
          .setDescription(`Lv${w.level}  ·  ATK ${eff}${sub}${w.awakened ? "  ·  ✦" : ""}`)
          .setValue(w.id)
          .setEmoji(WEAPON_TYPE_EMOJI[w.weaponType as WeaponType])
          .setDefault(w.isEquipped ?? false);
      }));

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(makeSelect());

    // Show current weapon + list in the initial embed
    const weaponList = weapons.map((w) => {
      const label = (w.awakened && w.awakenedName) ? w.awakenedName : w.name;
      const eff   = effectiveAtk(w.baseAtk, w.rarity, w.level);
      return `${w.isEquipped ? "▶" : "◇"}  **${label}**  ${RARITY_STARS[w.rarity]}  ·  Lv${w.level}  ·  ATK **${eff}**${w.awakened ? "  ✦" : ""}`;
    }).join("\n");

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `${displayName}  ·  Arsenal`, iconURL: avatarUrl })
        .setDescription([
          `**Currently equipped:**`,
          equipped ? weaponBlock(equipped) : "*None*",
          ``,
          `**All weapons (${weapons.length}):**`,
          weaponList,
          ``,
          `Select one below to swap.`,
        ].join("\n"))
        .setFooter({ text: "CARTETHYIA  ·  Arsenal  ·  Expires in 2 min" })],
      components: [selectRow],
    });

    // ── Select collector ─────────────────────────────────────────────────────
    const collector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id && i.customId === "equip_select",
      time: 2 * 60 * 1000,
      max:  1,
    });

    collector?.on("collect", async (sel) => {
      await sel.deferUpdate();
      const chosenId = sel.values[0];
      const chosen   = weapons.find((w) => w.id === chosenId)!;

      if (chosen.isEquipped) {
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0x334155)
            .setDescription(`◈ **${(chosen.awakened && chosen.awakenedName) ? chosen.awakenedName : chosen.name}** is already equipped.`)],
          components: [],
        });
        return;
      }

      // ── Show comparison ────────────────────────────────────────────────────
      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("equip_confirm").setLabel("Equip").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("equip_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      );

      await sel.editReply({
        embeds: [new EmbedBuilder()
          .setColor(chosen.awakened ? 0xFCD34D : color)
          .setTitle(`${chosen.awakened ? "✦  Ego Weapon" : "◈  Weapon"}  Swap — Compare`)
          .addFields(
            {
              name:   "◈  Current",
              value:  equipped ? weaponBlock(equipped) : "*Empty — nothing equipped*",
              inline: true,
            },
            {
              name:   "✦  Incoming",
              value:  weaponBlock(chosen),
              inline: true,
            },
          )
          .setFooter({ text: "CARTETHYIA  ·  Arsenal  ·  Confirm to swap" })],
        components: [confirmRow],
      });

      // ── Button collector ───────────────────────────────────────────────────
      const btnCol = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id && ["equip_confirm", "equip_cancel"].includes(i.customId),
        time: 30_000,
        max:  1,
      });

      btnCol?.on("collect", async (btn) => {
        try { await btn.deferUpdate(); } catch { return; }

        if (btn.customId === "equip_cancel") {
          await btn.editReply({
            embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")],
            components: [],
          });
          return;
        }

        // Swap in DB
        await prisma.weapon.updateMany({ where: { userId: interaction.user.id, isEquipped: true }, data: { isEquipped: false } });
        await prisma.weapon.update({ where: { id: chosenId }, data: { isEquipped: true } });
        await prisma.user.update({ where: { id: interaction.user.id }, data: { weaponType: chosen.weaponType } });

        // Generate weapon card for confirmation
        const cardBuf = await buildCard(chosen, user.element, displayName, avatarUrl);
        const file    = new AttachmentBuilder(cardBuf, { name: "weapon.png" });

        const displayName2 = (chosen.awakened && chosen.awakenedName) ? chosen.awakenedName : chosen.name;
        await btn.editReply({
          embeds: [new EmbedBuilder()
            .setColor(chosen.awakened ? 0xFCD34D : color)
            .setTitle(`✦ ${chosen.awakened ? "Ego Weapon" : "Weapon"} Equipped`)
            .setDescription(equipped
              ? `◇ Unequipped: **${(equipped.awakened && equipped.awakenedName) ? equipped.awakenedName : equipped.name}**`
              : null)
            .setImage("attachment://weapon.png")
            .setFooter({ text: `CARTETHYIA  ·  Arsenal${chosen.awakened ? `  ·  ✦ ${displayName2}` : ""}` })],
          files: [file],
          components: [],
        });
      });

      btnCol?.on("end", async (col) => {
        if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
      });
    });

    collector?.on("end", async (col) => {
      if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
