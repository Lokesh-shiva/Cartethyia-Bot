import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelSelectMenuInteraction,
  StringSelectMenuBuilder, StringSelectMenuInteraction,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits,
  ButtonInteraction, Interaction, Events, ModalSubmitInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { loadExploreChannels } from "../../lib/encounter";
import { savePrefixToDb, getPrefix } from "../../lib/prefixManager";

async function getSettings(guildId: string) {
  return prisma.guildSettings.upsert({
    where:  { guildId },
    update: {},
    create: { guildId },
  });
}

// ── Embed ─────────────────────────────────────────────────────────────────────

function buildPanel(s: any, prefix: string, guildName: string, done = false): EmbedBuilder {
  const encLine = s.encounterChannelIds.length
    ? s.encounterChannelIds.map((id: string) => `<#${id}>`).join("  ")
    : "All channels";
  const expLine = s.exploreChannelIds.length
    ? s.exploreChannelIds.map((id: string) => `<#${id}>`).join("  ")
    : "None";
  const welLine = s.welcomeChannelId ? `<#${s.welcomeChannelId}>` : "Disabled";
  const pfx     = prefix || "c";

  return new EmbedBuilder()
    .setColor(0x6366F1)
    .setAuthor({ name: `⚙️  ${guildName}  ·  CARTETHYIA Setup` })
    .setDescription(
      `**Server Configuration** — all changes apply instantly.\n` +
      `Use the menus and button below. Only members with **Manage Server** can interact.\n​`
    )
    .addFields(
      {
        name:  s.encountersEnabled ? "⚔️  Chat Encounters — ✅ ENABLED" : "⚔️  Chat Encounters — ⛔ DISABLED",
        value: s.encountersEnabled
          ? "Enemies spawn while members chat. Press **Disable Encounters** to turn off."
          : "No enemies will spawn in any channel. Press **Enable Encounters** to turn on.",
        inline: false,
      },
      {
        name:  "📍  Encounter Channels",
        value: `${encLine}\n-# No channels set = spawns everywhere · Set channels = only those channels`,
        inline: false,
      },
      {
        name:  "🗺️  Explore Channel",
        value: `${expLine}\n-# 38% spawn rate & 30 s cooldown — vs 13% / 2 min in normal channels`,
        inline: true,
      },
      {
        name:  "👋  Welcome Channel",
        value: `${welLine}\n-# New members are automatically onboarded here`,
        inline: true,
      },
      {
        name:  "⌨️  Text Prefix",
        value: `\`${pfx}!\`  —  e.g. \`${pfx}!profile\`  \`${pfx}!daily\`  \`${pfx}!guide\`\n-# Pick a preset or choose "Custom…" to type your own`,
        inline: false,
      },
    )
    .setFooter({ text: done
      ? "CARTETHYIA  ·  Configuration saved ✅"
      : "CARTETHYIA  ·  /setup  ·  Panel closes after 5 min of inactivity" });
}

// ── Component builders ────────────────────────────────────────────────────────

function rowEncounterChannels(ids: string[]) {
  const m = new ChannelSelectMenuBuilder()
    .setCustomId("setup_enc_ch")
    .setPlaceholder("📍  Encounter Channels — select where enemies can spawn (clear = everywhere)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(15);
  if (ids.length) m.setDefaultChannels(ids);
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(m);
}

function rowExplore(ids: string[]) {
  const m = new ChannelSelectMenuBuilder()
    .setCustomId("setup_explore_ch")
    .setPlaceholder("🗺️  Explore Channel — high-rate grind zone (clear = none)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(3);
  if (ids.length) m.setDefaultChannels(ids);
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(m);
}

function rowWelcome(id: string | null) {
  const m = new ChannelSelectMenuBuilder()
    .setCustomId("setup_welcome_ch")
    .setPlaceholder("👋  Welcome Channel — auto-onboard new members (clear = disabled)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (id) m.setDefaultChannels([id]);
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(m);
}

function rowPrefix(current: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("setup_prefix")
      .setPlaceholder(`⌨️  Text Prefix — currently: ${current || "c"}!`)
      .addOptions([
        { label: "c!  →  c!profile, c!daily",  value: "c",         description: "Recommended — short and clean",              emoji: "⌨️"  },
        { label: "cart!  →  cart!profile",      value: "cart",      description: "Uses the full bot name as prefix",           emoji: "🤖"  },
        { label: "!  →  !profile, !daily",      value: "!",         description: "Classic — may conflict with other bots",     emoji: "❗"  },
        { label: "bot!  →  bot!profile",        value: "bot",       description: "Generic bot prefix",                         emoji: "🔧"  },
        { label: "✍️  Custom prefix…",           value: "__custom__", description: "Type your own (opens a quick text input)",  emoji: "✏️"  },
        { label: "↩️  Reset to default (c!)",   value: "__reset__", description: "Restore the global default",                 emoji: "↩️"  },
      ])
  );
}

function rowButtons(encountersEnabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("setup_toggle_enc")
      .setLabel(encountersEnabled ? "⚔️  Disable Encounters" : "⚔️  Enable Encounters")
      .setStyle(encountersEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("setup_done")
      .setLabel("✅  Done")
      .setStyle(ButtonStyle.Secondary),
  );
}

function allComponents(s: any, prefix: string) {
  return [
    rowEncounterChannels(s.encounterChannelIds),
    rowExplore(s.exploreChannelIds),
    rowWelcome(s.welcomeChannelId),
    rowPrefix(prefix),
    rowButtons(s.encountersEnabled),
  ];
}

// ── Command ───────────────────────────────────────────────────────────────────

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Interactive server configuration panel — configure everything in one place.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });

    const guildId   = interaction.guildId;
    const guildName = interaction.guild?.name ?? "This Server";
    let s           = await getSettings(guildId);
    let prefix      = getPrefix(guildId);

    await interaction.editReply({
      embeds:     [buildPanel(s, prefix, guildName)],
      components: allComponents(s, prefix),
    });

    // Refresh helper — re-fetches settings + rebuilds the whole panel
    const refresh = async () => {
      s      = await getSettings(guildId);
      prefix = getPrefix(guildId);
      await interaction.editReply({
        embeds:     [buildPanel(s, prefix, guildName)],
        components: allComponents(s, prefix),
      }).catch(() => {});
    };

    // ── Collector ─────────────────────────────────────────────────────────────
    const collector = interaction.channel?.createMessageComponentCollector({
      filter: async (i) => {
        if (i.user.id !== interaction.user.id) {
          await i.reply({ content: "◈ Only the admin who opened this panel can interact with it.", flags: 64 }).catch(() => {});
          return false;
        }
        return true;
      },
      time: 5 * 60 * 1000,
    });

    collector?.on("collect", async (i) => {

      // ── Done ─────────────────────────────────────────────────────────────────
      if (i.customId === "setup_done") {
        await i.deferUpdate();
        collector.stop("done");
        s      = await getSettings(guildId);
        prefix = getPrefix(guildId);
        await interaction.editReply({
          embeds:     [buildPanel(s, prefix, guildName, true)],
          components: [],
        }).catch(() => {});
        return;
      }

      // ── Toggle encounters ─────────────────────────────────────────────────────
      if (i.customId === "setup_toggle_enc") {
        await (i as ButtonInteraction).deferUpdate();
        s = await getSettings(guildId);
        await prisma.guildSettings.update({ where: { guildId }, data: { encountersEnabled: !s.encountersEnabled } });
        await loadExploreChannels(guildId);
        await refresh();
        return;
      }

      // ── Encounter channels ─────────────────────────────────────────────────────
      if (i.customId === "setup_enc_ch") {
        const sel = i as ChannelSelectMenuInteraction;
        await sel.deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { encounterChannelIds: sel.values } });
        await loadExploreChannels(guildId);
        await refresh();
        return;
      }

      // ── Explore channels ───────────────────────────────────────────────────────
      if (i.customId === "setup_explore_ch") {
        const sel = i as ChannelSelectMenuInteraction;
        await sel.deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { exploreChannelIds: sel.values } });
        await loadExploreChannels(guildId);
        await refresh();
        return;
      }

      // ── Welcome channel ────────────────────────────────────────────────────────
      if (i.customId === "setup_welcome_ch") {
        const sel = i as ChannelSelectMenuInteraction;
        await sel.deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { welcomeChannelId: sel.values[0] ?? null } });
        await refresh();
        return;
      }

      // ── Prefix ─────────────────────────────────────────────────────────────────
      if (i.customId === "setup_prefix") {
        const sel   = i as StringSelectMenuInteraction;
        const value = sel.values[0];

        if (value === "__reset__") {
          await sel.deferUpdate();
          await savePrefixToDb(guildId, null);
          await refresh();
          return;
        }

        if (value === "__custom__") {
          // Show a modal — no deferUpdate before showModal
          const modal = new ModalBuilder()
            .setCustomId("setup_pfx_modal")
            .setTitle("Set Custom Prefix")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("pfx_value")
                  .setLabel("Prefix (without ! — e.g. type 'c' for c!)")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("e.g.  c  or  mybot  or  !")
                  .setMinLength(1)
                  .setMaxLength(5)
                  .setRequired(true)
              )
            );
          await sel.showModal(modal);

          // Temporarily listen for the modal submit
          const submitted = await new Promise<ModalSubmitInteraction | null>((resolve) => {
            const tid = setTimeout(() => {
              interaction.client.off(Events.InteractionCreate, handler);
              resolve(null);
            }, 60_000);
            const handler = (intr: Interaction) => {
              if (
                intr.isModalSubmit() &&
                intr.customId === "setup_pfx_modal" &&
                intr.user.id  === interaction.user.id
              ) {
                clearTimeout(tid);
                interaction.client.off(Events.InteractionCreate, handler);
                resolve(intr as ModalSubmitInteraction);
              }
            };
            interaction.client.on(Events.InteractionCreate, handler);
          });

          if (submitted) {
            await submitted.deferUpdate();
            const raw     = submitted.fields.getTextInputValue("pfx_value").trim().toLowerCase();
            const cleaned = raw.replace(/!+$/, "") || null;
            if (cleaned) await savePrefixToDb(guildId, cleaned);
          }
          await refresh();
          return;
        }

        // Preset value selected
        await sel.deferUpdate();
        await savePrefixToDb(guildId, value);
        await refresh();
        return;
      }
    });

    collector?.on("end", async (_c, reason) => {
      if (reason === "done") return;
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
