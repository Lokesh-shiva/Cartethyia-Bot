import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { generateAwakening, AwakeningResult, awakenHiddenBase, SUB_LABELS } from "../../lib/weaponAwakening";
import { formatEffects } from "../../lib/abilityEffects";
import { OWNER_ID } from "../../lib/owner";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("debugawaken")
    .setDescription("🛠️ Re-run weapon awakening generation for a user (owner only).")
    .setDefaultMemberPermissions(0)
    .addUserOption(o =>
      o.setName("target")
        .setDescription("User whose awakened weapon to regenerate")
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: "Owner only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const targetUser = interaction.options.getUser("target", true);
    const targetId   = targetUser.id;
    const displayName = interaction.guild?.members.cache.get(targetId)?.displayName
      ?? targetUser.displayName ?? targetUser.username;

    // Verify the user has an awakened weapon
    const weapon = await prisma.weapon.findFirst({
      where:  { userId: targetId, isEquipped: true, awakened: true },
      select: { id: true, name: true, weaponType: true, rarity: true, awakenedName: true, awakenedLore: true },
    });

    if (!weapon) {
      await interaction.editReply({ content: `${displayName} has no awakened weapon equipped.` });
      return;
    }

    const showPreview = async (isReroll: boolean): Promise<AwakeningResult | null> => {
      const result = await generateAwakening(targetId);
      if (!result) {
        await interaction.editReply({ content: "Generation failed — LM Studio may be offline." });
        return null;
      }

      const passiveLines = [
        result.passive.desc,
        result.passive.elemDmg ? `+${Math.round(result.passive.elemDmg * 100)}% Elemental DMG` : null,
        result.passive.effects.length ? formatEffects(result.passive.effects) : null,
      ].filter(Boolean).join("\n");

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("daw_keep").setLabel("✓  Apply this").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("daw_reroll").setLabel("↺  Reroll").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("daw_cancel").setLabel("✕  Cancel").setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xF5A623)
          .setTitle(`🛠️ Awakening Preview${isReroll ? " (rerolled)" : ""} — ${displayName}`)
          .addFields(
            { name: "Original", value: `**${weapon.name}** (${weapon.rarity}★ ${weapon.weaponType})`, inline: true },
            { name: "Awakened Name", value: `**${result.name}**`, inline: true },
            { name: "Lore", value: `*${result.lore}*`, inline: false },
            { name: "Awakened Passive", value: passiveLines || "none", inline: false },
            { name: "New Hidden Substats", value: [
              result.newHiddenSub1Type ? `Hidden I: ${SUB_LABELS[result.newHiddenSub1Type] ?? result.newHiddenSub1Type} *(newly added)*` : "Hidden I: unchanged",
              result.newHiddenSub2Type ? `Hidden II: ${SUB_LABELS[result.newHiddenSub2Type] ?? result.newHiddenSub2Type} *(newly added)*` : "Hidden II: unchanged",
            ].join("\n"), inline: false },
            { name: "Art Prompt", value: result.artPrompt.slice(0, 1024), inline: false },
          )
          .setFooter({ text: "🛠️ Not applied yet — confirm to overwrite awakening (identity + substats, baseAtk unchanged)" })],
        components: [row],
      });

      return result;
    };

    let pending = await showPreview(false);
    if (!pending) return;

    const listen = () => {
      const collector = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === interaction.user.id
          && ["daw_keep", "daw_reroll", "daw_cancel"].includes(b.customId),
        time: 5 * 60 * 1000,
        max:  1,
      });

      collector?.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate();

        if (btn.customId === "daw_cancel") {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x4A4A5A)
              .setDescription(`Cancelled — **${weapon.awakenedName ?? weapon.name}** identity unchanged.`)
              .setFooter({ text: "🛠️ debugawaken" })],
            components: [],
          });
          return;
        }

        if (btn.customId === "daw_reroll") {
          pending = await showPreview(true);
          if (pending) listen();
          return;
        }

        // daw_keep — overwrite identity + substats (baseAtk unchanged)
        if (!pending) return;
        await prisma.weapon.update({
          where: { id: weapon.id },
          data:  {
            awakenedName:      pending.name,
            awakenedLore:      pending.lore,
            awakenedArtPrompt: pending.artPrompt,
            awakenedPassive:   pending.passive as any,
            ...(pending.newHiddenSub1Type ? {
              hiddenSub1Type: pending.newHiddenSub1Type,
              hiddenSub1Val:  awakenHiddenBase(pending.newHiddenSub1Type, weapon.rarity),
            } : {}),
            ...(pending.newHiddenSub2Type ? {
              hiddenSub2Type: pending.newHiddenSub2Type,
              hiddenSub2Val:  awakenHiddenBase(pending.newHiddenSub2Type, weapon.rarity),
            } : {}),
          },
        });

        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x22C55E)
            .setTitle("🛠️ Awakening Applied")
            .setDescription(
              `**${weapon.name}** → **${pending.name}**\n` +
              `*${pending.lore}*\n\n` +
              (pending.newHiddenSub1Type || pending.newHiddenSub2Type
                ? `New hidden subs added: ${[pending.newHiddenSub1Type, pending.newHiddenSub2Type].filter(Boolean).map(t => SUB_LABELS[t!] ?? t).join(", ")}\n`
                : `No new hidden subs (weapon already had them).\n`) +
              `Existing substat values and baseAtk unchanged.`
            )
            .setFooter({ text: `🛠️ debugawaken · ${displayName}` })],
          components: [],
        });
      });

      collector?.on("end", async (col) => {
        if (col.size === 0) {
          await interaction.editReply({ components: [] }).catch(() => {});
        }
      });
    };

    listen();
  },
};

export default command;
