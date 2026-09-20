import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { OWNER_ID } from "../../lib/owner";
import { generateUniqueAbility, generateUniqueAbilityV2 } from "../../lib/uniqueAbility";
import { evolveEffects, evolveEffectsV2, evolvedName } from "../../lib/abilityEvolution";
import { generateAbilityCard } from "../../lib/abilityCard";
import { formatEffects, sanitizeEffects } from "../../lib/abilityEffects";
import { formatV2Effects, sanitizeV2Effects } from "../../lib/abilityEngineV2";

type PendingAbility =
  | { v2: false; name: string; effect: string; lore: string; effects: any[] }
  | { v2: true; name: string; effect: string; lore: string; v2Effects: any[] };

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("debugreawakening")
    .setDescription("🛠️ Reroll an already-awakened ability without removing its awakened status.")
    .setDefaultMemberPermissions(0)
    .addBooleanOption(o =>
      o.setName("v2")
        .setDescription("Use the V2 composable trigger→effect engine")
        .setRequired(false)
    )
    .addUserOption(o =>
      o.setName("target")
        .setDescription("Awakened user to re-roll (owner only)")
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: "Owner only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const targetUser = interaction.options.getUser("target") ?? interaction.user;
    const targetId   = targetUser.id;
    const displayName = interaction.guild?.members.cache.get(targetId)?.displayName
      ?? targetUser.displayName ?? targetUser.username;
    const useV2 = interaction.options.getBoolean("v2") ?? false;

    const dbUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        element: true,
        abilityEvolved: true,
        uniqueAbilityName: true,
        uniqueAbilityEffect: true,
        uniqueAbilityLore: true,
        uniqueAbilityEffects: true,
        abilityVersion: true,
      },
    });

    if (!dbUser?.uniqueAbilityName) {
      await interaction.editReply({ content: `${displayName} has no ability to reawaken.` });
      return;
    }
    if (!dbUser.abilityEvolved) {
      await interaction.editReply({ content: `${displayName}'s ability has not awakened yet. Use /evolve first.` });
      return;
    }

    const showPreview = async (isReroll: boolean): Promise<PendingAbility | null> => {
      let pending: PendingAbility;
      let effectLines: string[];

      if (useV2) {
        const base = await generateUniqueAbilityV2(targetId, false);
        if (!base) { await interaction.editReply({ content: "V2 generation failed." }); return null; }
        const effects = evolveEffectsV2(sanitizeV2Effects(base.v2Effects), dbUser.element, targetId);
        pending = {
          v2: true,
          name: evolvedName(base.name, dbUser.element),
          effect: base.effect,
          lore: base.lore,
          v2Effects: effects,
        };
        effectLines = formatV2Effects(effects)
          .replace(/\*\*/g, "").replace(/\*([^*]+)\*/g, "$1")
          .split("\n").filter(Boolean);
      } else {
        const base = await generateUniqueAbility(targetId, false);
        if (!base) { await interaction.editReply({ content: "Generation failed." }); return null; }
        const effects = evolveEffects(sanitizeEffects(base.effects), dbUser.element, targetId);
        pending = {
          v2: false,
          name: evolvedName(base.name, dbUser.element),
          effect: base.effect,
          lore: base.lore,
          effects,
        };
        effectLines = formatEffects(effects).split("\n").filter(Boolean);
      }

      const cardBuf = await generateAbilityCard({
        displayName,
        avatarUrl: targetUser.displayAvatarURL({ size: 128, extension: "png" }),
        element: dbUser.element,
        abilityName: pending.name,
        effects: effectLines,
        lore: pending.lore,
        evolved: true,
      });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dra_keep").setLabel("✓  Keep this").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("dra_reroll").setLabel("↺  Reroll").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dra_cancel").setLabel("✕  Cancel").setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xF59E0B)
          .setTitle("✦  Reawakening Preview")
          .setImage("attachment://ability.webp")
          .setDescription(`**${pending.name}** — *${pending.effect}*`)
          .setFooter({ text: `🛠️ ${useV2 ? "V2" : "V1"} awakened dry-run${isReroll ? " (rerolled)" : ""} · not saved yet` })],
        files: [new AttachmentBuilder(cardBuf, { name: "ability.webp" })],
        components: [row],
      });

      return pending;
    };

    let pending = await showPreview(false);
    if (!pending) return;

    const listen = () => {
      const collector = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === interaction.user.id
          && ["dra_keep", "dra_reroll", "dra_cancel"].includes(b.customId),
        time: 5 * 60 * 1000,
        max: 1,
      });

      collector?.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate();
        if (btn.customId === "dra_cancel") {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x4A4A5A)
              .setDescription("Reawakening cancelled — existing awakened ability unchanged.")
              .setFooter({ text: "🛠️ debugreawakening" })],
            files: [], components: [],
          });
          return;
        }
        if (btn.customId === "dra_reroll") {
          pending = await showPreview(true);
          if (pending) listen();
          return;
        }
        if (!pending) return;

        await prisma.user.update({
          where: { id: targetId },
          data: pending.v2
            ? {
                uniqueAbilityName: pending.name,
                uniqueAbilityEffect: pending.effect,
                uniqueAbilityLore: pending.lore,
                uniqueAbilityEffects: pending.v2Effects as any,
                abilityVersion: 2,
                abilityEvolved: true,
              }
            : {
                uniqueAbilityName: pending.name,
                uniqueAbilityEffect: pending.effect,
                uniqueAbilityLore: pending.lore,
                uniqueAbilityEffects: pending.effects as any,
                abilityVersion: 1,
                abilityEvolved: true,
              },
        });

        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xF59E0B)
            .setDescription(`✦ **${pending.name}** saved as ${displayName}'s new awakened ability.`)
            .setFooter({ text: "🛠️ debugreawakening · awakened status preserved" })],
          files: [], components: [],
        });
      });

      collector?.on("end", async (col) => {
        if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
      });
    };

    listen();
  },
};

export default command;
