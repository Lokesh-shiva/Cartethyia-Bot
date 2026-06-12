import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { generateUniqueAbility, generateUniqueAbilityV2 } from "../../lib/uniqueAbility";
import { generateAbilityCard } from "../../lib/abilityCard";
import { formatEffects, sanitizeEffects, composeFallbackEffects } from "../../lib/abilityEffects";
import { formatV2Effects, sanitizeV2Effects } from "../../lib/abilityEngineV2";
import { OWNER_ID } from "../../lib/owner";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("debugability")
    .setDescription("🛠️ Preview your unique ability reveal card (owner only).")
    .setDefaultMemberPermissions(0)
    .addStringOption(o =>
      o.setName("element")
        .setDescription("Preview a card for any element (doesn't touch your data)")
        .setRequired(false)
        .addChoices(
          { name: "🔥 Fusion", value: "FUSION" }, { name: "❄️ Glacio", value: "GLACIO" },
          { name: "⚡ Electro", value: "ELECTRO" }, { name: "🌪️ Aero", value: "AERO" },
          { name: "🌑 Havoc", value: "HAVOC" }, { name: "✨ Spectro", value: "SPECTRO" },
        )
    )
    .addBooleanOption(o =>
      o.setName("reroll")
        .setDescription("Generate a fresh ability preview — confirm before saving")
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName("v2")
        .setDescription("Generate using the V2 composable trigger→effect engine")
        .setRequired(false)
    )
    .addUserOption(o =>
      o.setName("target")
        .setDescription("Reroll/preview for another user (owner only)")
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: "Owner only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const previewElement = interaction.options.getString("element");
    const targetUser     = interaction.options.getUser("target") ?? interaction.user;
    const targetId       = targetUser.id;
    const displayName    = interaction.guild?.members.cache.get(targetId)?.displayName
      ?? targetUser.displayName ?? targetUser.username;

    // ── Pure element preview — no DB reads/writes ────────────────────────────
    if (previewElement) {
      const effects = composeFallbackEffects(previewElement, interaction.user.id + Date.now());
      const effList = formatEffects(sanitizeEffects(effects)).split("\n").filter(Boolean);
      const cardBuf = await generateAbilityCard({
        displayName,
        avatarUrl:   targetUser.displayAvatarURL({ size: 128, extension: "png" }),
        element:     previewElement,
        abilityName: "Preview Resonance",
        effects:     effList,
        lore:        "A glimpse of what the Grid might forge for one such as you.",
      });
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x8B7FF5).setImage("attachment://ability.png")
          .setFooter({ text: `🛠️ ${previewElement} preview (not saved) · run again for a different roll` })],
        files: [new AttachmentBuilder(cardBuf, { name: "ability.png" })],
      });
      return;
    }

    const reroll  = interaction.options.getBoolean("reroll") ?? false;
    const useV2   = interaction.options.getBoolean("v2")     ?? false;

    if (!reroll) {
      // ── No reroll: just show the current saved ability ───────────────────
      const user = await prisma.user.findUnique({
        where:  { id: targetId },
        select: { element: true, uniqueAbilityName: true, uniqueAbilityEffect: true,
                  uniqueAbilityLore: true, uniqueAbilityEffects: true, abilityVersion: true },
      });
      if (!user || !user.uniqueAbilityName) {
        await interaction.editReply({ content: `${displayName} has no ability saved yet. Use \`reroll:true\` to generate one.` });
        return;
      }
      const isV2   = user.abilityVersion === 2;
      const effList = isV2
        ? formatV2Effects(sanitizeV2Effects(user.uniqueAbilityEffects)).split("\n").filter(Boolean)
        : formatEffects(sanitizeEffects(user.uniqueAbilityEffects)).split("\n").filter(Boolean);
      const cardBuf = await generateAbilityCard({
        displayName,
        avatarUrl:   targetUser.displayAvatarURL({ size: 128, extension: "png" }),
        element:     user.element,
        abilityName: user.uniqueAbilityName,
        effects:     effList,
        lore:        user.uniqueAbilityLore ?? "",
      });
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(isV2 ? 0xA78BFA : 0x8B7FF5)
          .setImage("attachment://ability.png")
          .setDescription(`**${user.uniqueAbilityName}** — *${user.uniqueAbilityEffect}*`)
          .setFooter({ text: `🛠️ Current saved ability (${isV2 ? "V2" : "V1"}) · use reroll:true to generate a new one` })],
        files: [new AttachmentBuilder(cardBuf, { name: "ability.png" })],
      });
      return;
    }

    // ── Reroll flow: generate dry-run, show confirm/reroll/cancel ────────────
    const dbUser = await prisma.user.findUnique({
      where:  { id: targetId },
      select: { element: true },
    });
    if (!dbUser || dbUser.element === "NONE") {
      await interaction.editReply({ content: `${displayName} hasn't chosen an element yet.` });
      return;
    }

    type PendingAbility =
      | { v2: false; name: string; effect: string; lore: string; effects: any[] }
      | { v2: true;  name: string; effect: string; lore: string; v2Effects: any[] };

    const showPreview = async (isReroll: boolean): Promise<PendingAbility | null> => {
      let effList: string[];
      let ability: { name: string; effect: string; lore: string };
      let pending: PendingAbility;

      if (useV2) {
        const result = await generateUniqueAbilityV2(targetId, false);
        if (!result) { await interaction.editReply({ content: "V2 generation failed." }); return null; }
        effList  = formatV2Effects(result.v2Effects).split("\n").filter(Boolean);
        ability  = result;
        pending  = { v2: true, ...ability, v2Effects: result.v2Effects };
      } else {
        const result = await generateUniqueAbility(targetId, false);
        if (!result) { await interaction.editReply({ content: "Generation failed." }); return null; }
        effList  = formatEffects(result.effects).split("\n").filter(Boolean);
        ability  = result;
        pending  = { v2: false, ...ability, effects: result.effects };
      }

      const cardBuf = await generateAbilityCard({
        displayName,
        avatarUrl:   targetUser.displayAvatarURL({ size: 128, extension: "png" }),
        element:     dbUser.element,
        abilityName: ability.name,
        effects:     effList,
        lore:        ability.lore,
      });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("da_keep").setLabel("✓  Keep this").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("da_reroll").setLabel("↺  Reroll").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("da_cancel").setLabel("✕  Cancel").setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(useV2 ? 0xA78BFA : 0x8B7FF5)
          .setImage("attachment://ability.png")
          .setDescription(`**${ability.name}** — *${ability.effect}*`)
          .setFooter({ text: `🛠️ ${useV2 ? "V2" : "V1"} dry-run${isReroll ? " (rerolled)" : ""} · not saved yet` })],
        files:      [new AttachmentBuilder(cardBuf, { name: "ability.png" })],
        components: [row],
      });

      return pending;
    };

    let pending = await showPreview(false);
    if (!pending) return;

    // Collector loop — each button interaction re-shows or commits
    const listen = () => {
      const collector = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === interaction.user.id
          && ["da_keep", "da_reroll", "da_cancel"].includes(b.customId),
        time: 5 * 60 * 1000,
        max:  1,
      });

      collector?.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate();

        if (btn.customId === "da_cancel") {
          await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0x4A4A5A)
              .setDescription("Reroll cancelled — existing ability unchanged.")
              .setFooter({ text: "🛠️ debugability" })],
            files: [], components: [],
          });
          return;
        }

        if (btn.customId === "da_reroll") {
          pending = await showPreview(true);
          if (pending) listen();
          return;
        }

        // da_keep — persist the pending ability
        if (!pending) return;
        if (pending.v2) {
          await prisma.user.update({
            where: { id: targetId },
            data:  {
              uniqueAbilityName:    pending.name,
              uniqueAbilityEffect:  pending.effect,
              uniqueAbilityLore:    pending.lore,
              uniqueAbilityEffects: pending.v2Effects as any,
              abilityVersion:       2,
            },
          });
        } else {
          await prisma.user.update({
            where: { id: targetId },
            data:  {
              uniqueAbilityName:    pending.name,
              uniqueAbilityEffect:  pending.effect,
              uniqueAbilityLore:    pending.lore,
              uniqueAbilityEffects: pending.effects as any,
              abilityVersion:       1,
            },
          });
        }

        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x22C55E)
            .setDescription(`✓ **${pending.name}** saved for ${displayName} (${pending.v2 ? "V2 engine" : "V1 engine"}).`)
            .setFooter({ text: "🛠️ debugability · ability committed to DB" })],
          files: [], components: [],
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
