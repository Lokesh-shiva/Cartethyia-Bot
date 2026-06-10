import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import { formatEffects } from "../../lib/abilityEffects";
import { RARITY_STARS, WEAPON_TYPE_EMOJI } from "../../lib/weapons";
import {
  EGO_LEVEL_REQUIRED, EGO_COST, AWAKEN_STAT_MULT, generateAwakening,
} from "../../lib/weaponAwakening";
import { WeaponType } from "@prisma/client";

const EGO_GOLD = 0xFCD34D;

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("awaken")
    .setDescription("Awaken your equipped weapon's ego — it transforms, forever (Lv60)."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const [user, weapon] = await Promise.all([
      prisma.user.findUnique({
        where:  { id: interaction.user.id },
        select: {
          level: true, element: true, abilityEvolved: true, uniqueAbilityName: true,
          forgingOres: true, paradoxCores: true, credits: true,
        },
      }),
      prisma.weapon.findFirst({
        where:  { userId: interaction.user.id, isEquipped: true },
        select: {
          id: true, name: true, weaponType: true, rarity: true, level: true,
          baseAtk: true, subStatVal: true, hiddenSub1Val: true, hiddenSub2Val: true,
          awakened: true, awakenedName: true,
        },
      }),
    ]);
    if (!user) { await replyNotStarted(interaction); return; }

    const color = ELEMENT_HEX[user.element as string] ?? ELEMENT_HEX.NONE;
    const fail = async (msg: string) => {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(color)
          .setTitle("✦  Ego Weapon Awakening")
          .setDescription(msg)
          .setFooter({ text: "CARTETHYIA  ·  Ego Weapon Awakening" })],
      });
    };

    if (!weapon) {
      await fail("You have no weapon equipped. Forge one with `/forge` or pull one with `/wish` first.");
      return;
    }
    if (weapon.awakened) {
      await fail(`**${weapon.awakenedName ?? weapon.name}** has already awakened. A weapon's ego wakes only once.`);
      return;
    }
    if (user.level < EGO_LEVEL_REQUIRED) {
      await fail(`The weapon stirs, but your resonance can't reach it yet. Reach **Level ${EGO_LEVEL_REQUIRED}**. (You are Level ${user.level}.)`);
      return;
    }
    if (!user.abilityEvolved) {
      await fail(`A weapon's ego wakes only in the presence of an **evolved** resonance. Complete your ability evolution first (\`/evolve\`, Lv50).`);
      return;
    }

    const mult      = AWAKEN_STAT_MULT[weapon.rarity] ?? 1.15;
    const canAfford = user.forgingOres  >= EGO_COST.forgingOres
                   && user.paradoxCores >= EGO_COST.paradoxCores
                   && user.credits      >= EGO_COST.credits;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("✦  Ego Weapon Awakening — The Ritual")
      .setDescription([
        `${WEAPON_TYPE_EMOJI[weapon.weaponType as WeaponType]} **${weapon.name}**  ${RARITY_STARS[weapon.rarity]}  Lv${weapon.level}`,
        ``,
        `Your weapon has tasted every battle you've fought. At the edge of your evolved resonance, something inside it is waking.`,
        ``,
        `**On awakening (permanent):**`,
        `◈ New name, soul, and lore — shaped by you and your evolved ability`,
        `◈ ATK, substat & hidden substats **×${mult.toFixed(2)}** (${weapon.rarity}★ ceiling)`,
        `◈ Passive ${weapon.rarity >= 4 ? "amplified **+25%** and a new awakened power added" : "awakened — its first true power"}`,
        ``,
        `**Cost:** ${CE.fo} ${EGO_COST.forgingOres} Forging Ores (${user.forgingOres}) · ${CE.pc} ${EGO_COST.paradoxCores} Paradox Cores (${user.paradoxCores}) · ${CE.cr} ${EGO_COST.credits.toLocaleString()} Credits (${user.credits.toLocaleString()})`,
        canAfford ? "" : `\n⚠️ You can't afford the ritual yet.`,
      ].filter(Boolean).join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Ego Weapon Awakening  ·  This cannot be undone" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ego_confirm").setLabel("Wake the Ego").setStyle(ButtonStyle.Danger).setEmoji("✦").setDisabled(!canAfford),
    );
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });
    if (!canAfford) return;

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
      time: 5 * 60 * 1000, max: 1,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      // Pay atomically (re-checks balances)
      const paid = await prisma.user.updateMany({
        where: {
          id: interaction.user.id,
          forgingOres:  { gte: EGO_COST.forgingOres },
          paradoxCores: { gte: EGO_COST.paradoxCores },
          credits:      { gte: EGO_COST.credits },
        },
        data: {
          forgingOres:  { decrement: EGO_COST.forgingOres },
          paradoxCores: { decrement: EGO_COST.paradoxCores },
          credits:      { decrement: EGO_COST.credits },
        },
      });
      if (paid.count === 0) {
        await interaction.editReply({ components: [] }).catch(() => {});
        return;
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(EGO_GOLD)
          .setTitle("✦  The Weapon Stirs…")
          .setDescription(`*Something inside **${weapon.name}** opens its eyes.*`)
          .setFooter({ text: "CARTETHYIA  ·  Ego Weapon Awakening" })],
        components: [],
      });

      // AI-personalized awakening (deterministic fallback if LM Studio offline)
      const awakening = await generateAwakening(interaction.user.id).catch(() => null);
      if (!awakening) {
        // Refund — generation needs user+weapon rows which just existed; this is a hard failure
        await prisma.user.update({
          where: { id: interaction.user.id },
          data:  {
            forgingOres:  { increment: EGO_COST.forgingOres },
            paradoxCores: { increment: EGO_COST.paradoxCores },
            credits:      { increment: EGO_COST.credits },
          },
        }).catch(() => {});
        await fail("The ritual faltered — nothing was consumed. Try again.");
        return;
      }

      // Transform the weapon (guard against double-awaken races)
      const updated = await prisma.weapon.updateMany({
        where: { id: weapon.id, awakened: false },
        data: {
          awakened:          true,
          awakenedName:      awakening.name,
          awakenedLore:      awakening.lore,
          awakenedArtPrompt: awakening.artPrompt,
          awakenedPassive:   awakening.passive as any,
          baseAtk:           Math.round(weapon.baseAtk * mult),
          ...(weapon.subStatVal    != null ? { subStatVal:    +(weapon.subStatVal    * mult).toFixed(1) } : {}),
          ...(weapon.hiddenSub1Val != null ? { hiddenSub1Val: +(weapon.hiddenSub1Val * mult).toFixed(1) } : {}),
          ...(weapon.hiddenSub2Val != null ? { hiddenSub2Val: +(weapon.hiddenSub2Val * mult).toFixed(1) } : {}),
        },
      });
      if (updated.count === 0) {
        await fail("The weapon has already awakened.");
        return;
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(EGO_GOLD)
          .setTitle("✦  EGO AWAKENED")
          .setDescription([
            `*${awakening.lore}*`,
            ``,
            `${WEAPON_TYPE_EMOJI[weapon.weaponType as WeaponType]} **${weapon.name}** has become **✦ ${awakening.name}**`,
            ``,
            `**Awakened passive:** ${awakening.passive.desc}`,
            `**Effects:** ${formatEffects(awakening.passive.effects).replace(/\n/g, " · ")}${awakening.passive.elemDmg ? ` · +${Math.round(awakening.passive.elemDmg * 100)}% Elemental DMG` : ""}`,
            `**Stats:** ATK, substat & hidden substats ×${mult.toFixed(2)}`,
            ``,
            `🎨 **Art prompt** (for the awakened art — \`assets/weapons/awakened/${awakening.name}.png\`):`,
            `\`\`\`${awakening.artPrompt}\`\`\``,
          ].join("\n"))
          .setFooter({ text: "CARTETHYIA  ·  This weapon's soul is yours alone." })],
        components: [],
      });
    });

    collector.on("end", async (_: any, reason: string) => {
      if (reason === "time") await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
