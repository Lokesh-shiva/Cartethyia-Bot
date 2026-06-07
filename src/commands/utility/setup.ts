import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelSelectMenuInteraction,
  StringSelectMenuBuilder, StringSelectMenuInteraction,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits,
  ButtonInteraction, Interaction, Events, ModalSubmitInteraction,
  TextChannel,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { loadExploreChannels } from "../../lib/encounter";
import { savePrefixToDb, getPrefix } from "../../lib/prefixManager";

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getSettings(guildId: string) {
  return prisma.guildSettings.upsert({
    where:  { guildId },
    update: {},
    create: { guildId },
  });
}

// ── Panel page definitions ────────────────────────────────────────────────────

type Page = "main" | "encounters" | "output" | "general";

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

function mainEmbed(s: any, prefix: string, guildName: string, saved = false) {
  const pfx        = prefix || "c";
  const encChs     = s.encounterChannelIds.length ? s.encounterChannelIds.map((id: string) => `<#${id}>`).join(" ") : "All channels";
  const blkChs     = s.encounterBlacklist?.length ? s.encounterBlacklist.map((id: string) => `<#${id}>`).join(" ") : "None";
  const expChs     = s.exploreChannelIds.length   ? s.exploreChannelIds.map((id: string) => `<#${id}>`).join(" ")   : "None";
  const welCh      = s.welcomeChannelId    ? `<#${s.welcomeChannelId}>`    : "Disabled";
  const lvUpCh     = s.levelUpChannelId    ? `<#${s.levelUpChannelId}>`    : "Same channel as message";
  const notifCh    = s.notifChannelId      ? `<#${s.notifChannelId}>`      : "Same as level-up";
  const lvUpStatus = s.levelUpEnabled !== false ? "✅ On" : "⛔ Off";

  return new EmbedBuilder()
    .setColor(0x6366F1)
    .setAuthor({ name: `⚙️  ${guildName}  ·  CARTETHYIA Setup` })
    .setDescription(
      `Full server configuration. Open a section below to make changes.\n` +
      `All saves are **instant**. Only **Manage Server** admins can interact.\n​`
    )
    .addFields(
      {
        name:  "⚔️  Encounters",
        value: [
          `${s.encountersEnabled ? "✅ Enabled" : "⛔ Disabled"}`,
          `📍 Allowlist: ${encChs}`,
          `🚫 Blacklist: ${blkChs}`,
          `🗺️ Explore:   ${expChs}`,
        ].join("\n"),
        inline: true,
      },
      {
        name:  "📢  Output Channels",
        value: [
          `👋 Welcome:       ${welCh}`,
          `🎴 Level-Up Cards: ${lvUpStatus} → ${lvUpCh}`,
          `🔔 Notifications:  ${notifCh}`,
        ].join("\n"),
        inline: true,
      },
      {
        name:  "⚙️  General",
        value: `⌨️ Prefix: \`${pfx}!\`  —  e.g. \`${pfx}!profile\`  \`${pfx}!daily\``,
        inline: false,
      },
    )
    .setFooter({ text: saved
      ? "CARTETHYIA  ·  Configuration saved ✅"
      : "CARTETHYIA  ·  Select a section below  ·  Closes after 5 min inactivity" });
}

function mainComponents(s: any) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("setup_nav_enc").setLabel("⚔️  Encounter Settings").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("setup_nav_out").setLabel("📢  Output Channels").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("setup_nav_gen").setLabel("⚙️  General").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("setup_toggle_enc")
        .setLabel(s.encountersEnabled ? "⚔️  Disable Encounters" : "⚔️  Enable Encounters")
        .setStyle(s.encountersEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId("setup_done").setLabel("✅  Done").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── ENCOUNTERS PAGE ───────────────────────────────────────────────────────────

function encounterEmbed(s: any, guildName: string) {
  const enc = s.encounterChannelIds.length ? s.encounterChannelIds.map((id: string) => `<#${id}>`).join(" ") : "All channels (no allowlist set)";
  const blk = s.encounterBlacklist?.length ? s.encounterBlacklist.map((id: string) => `<#${id}>`).join(" ")  : "None";
  const exp = s.exploreChannelIds.length   ? s.exploreChannelIds.map((id: string) => `<#${id}>`).join(" ")   : "None";

  return new EmbedBuilder()
    .setColor(0xEF4444)
    .setAuthor({ name: `⚙️  ${guildName}  ·  Encounter Settings` })
    .addFields(
      {
        name: "📍  Encounter Allowlist",
        value: `${enc}\n-# **Empty = enemies spawn everywhere.** Set channels = only those channels get encounters.`,
        inline: false,
      },
      {
        name: "🚫  Encounter Blacklist",
        value: `${blk}\n-# These channels are **always silent** — no enemies, no matter the allowlist. Perfect for announcement, rules, or off-topic channels.`,
        inline: false,
      },
      {
        name: "🗺️  Explore Channels",
        value: `${exp}\n-# High-rate grind zones — **38% spawn rate** & **30s cooldown** vs 13% / 2min in normal channels.`,
        inline: false,
      },
    )
    .setFooter({ text: "CARTETHYIA  ·  Encounter Settings  ·  Clear a menu to reset that setting" });
}

function encounterComponents(s: any) {
  const allowMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_enc_allow")
    .setPlaceholder("📍  Encounter Allowlist — where enemies can spawn (clear = everywhere)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0).setMaxValues(15);
  if (s.encounterChannelIds.length) allowMenu.setDefaultChannels(s.encounterChannelIds);

  const blackMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_enc_block")
    .setPlaceholder("🚫  Encounter Blacklist — enemies NEVER spawn here (overrides allowlist)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0).setMaxValues(15);
  if (s.encounterBlacklist?.length) blackMenu.setDefaultChannels(s.encounterBlacklist);

  const exploreMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_enc_explore")
    .setPlaceholder("🗺️  Explore Channels — high-rate grind zones (38% spawn, 30s cooldown)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0).setMaxValues(5);
  if (s.exploreChannelIds.length) exploreMenu.setDefaultChannels(s.exploreChannelIds);

  return [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(allowMenu),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(blackMenu),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(exploreMenu),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("setup_back").setLabel("← Back to Overview").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── OUTPUT CHANNELS PAGE ──────────────────────────────────────────────────────

function outputEmbed(s: any, guildName: string) {
  const welCh  = s.welcomeChannelId ? `<#${s.welcomeChannelId}>` : "Disabled";
  const lvUpCh = s.levelUpChannelId ? `<#${s.levelUpChannelId}>` : "Same channel as the message";
  const notifCh = s.notifChannelId  ? `<#${s.notifChannelId}>`   : "Same as level-up";
  const lvUpStatus = s.levelUpEnabled !== false ? "✅ Enabled" : "⛔ Disabled";

  return new EmbedBuilder()
    .setColor(0x6366F1)
    .setAuthor({ name: `⚙️  ${guildName}  ·  Output Channels` })
    .addFields(
      {
        name: "👋  Welcome Channel",
        value: `${welCh}\n-# New members are automatically sent a welcome card and prompted to \`/start\` here. Clear = members opt in manually.`,
        inline: false,
      },
      {
        name: `🎴  Level-Up Cards — ${lvUpStatus}`,
        value: `${lvUpCh}\n-# Where level-up cards are posted when a player levels up. Clear = posts in the channel where the message was sent. Toggle on/off with the button below.`,
        inline: false,
      },
      {
        name: "🔔  Notification Channel",
        value: `${notifCh}\n-# Where milestone unlocks and level cap alerts go (e.g. "Dungeons unlocked!", "Level cap reached — use /ascend"). Clear = same as level-up channel.`,
        inline: false,
      },
    )
    .setFooter({ text: "CARTETHYIA  ·  Output Channels  ·  Clear a menu to reset to default" });
}

function outputComponents(s: any) {
  const welMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_out_welcome")
    .setPlaceholder("👋  Welcome Channel — auto-onboard new members (clear = disabled)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0).setMaxValues(1);
  if (s.welcomeChannelId) welMenu.setDefaultChannels([s.welcomeChannelId]);

  const lvUpMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_out_levelup")
    .setPlaceholder("🎴  Level-Up Cards Channel — where level-up cards post (clear = same channel)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0).setMaxValues(1);
  if (s.levelUpChannelId) lvUpMenu.setDefaultChannels([s.levelUpChannelId]);

  const notifMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_out_notif")
    .setPlaceholder("🔔  Notification Channel — milestones & cap alerts (clear = same as level-up)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0).setMaxValues(1);
  if (s.notifChannelId) notifMenu.setDefaultChannels([s.notifChannelId]);

  return [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(welMenu),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(lvUpMenu),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(notifMenu),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("setup_toggle_levelup")
        .setLabel(s.levelUpEnabled !== false ? "🎴  Disable Level-Up Cards" : "🎴  Enable Level-Up Cards")
        .setStyle(s.levelUpEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId("setup_back").setLabel("← Back to Overview").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── GENERAL PAGE ──────────────────────────────────────────────────────────────

function generalEmbed(prefix: string, guildName: string) {
  const pfx = prefix || "c";
  return new EmbedBuilder()
    .setColor(0x10B981)
    .setAuthor({ name: `⚙️  ${guildName}  ·  General Settings` })
    .addFields(
      {
        name: "⌨️  Text Prefix",
        value: [
          `Current: \`${pfx}!\``,
          `Players can use \`${pfx}!profile\`, \`${pfx}!daily\`, \`${pfx}!echoes\`, etc. as an alternative to slash commands.`,
          `Pick a preset from the menu below, or choose **Custom…** to type your own.`,
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: "CARTETHYIA  ·  General Settings" });
}

function generalComponents(prefix: string) {
  const pfx = prefix || "c";
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("setup_prefix")
        .setPlaceholder(`⌨️  Text Prefix — currently: ${pfx}!`)
        .addOptions([
          { label: "c!  →  c!profile, c!daily",  value: "c",          description: "Recommended — short and clean",             emoji: "⌨️"  },
          { label: "cart!  →  cart!profile",      value: "cart",       description: "Uses the full bot name",                    emoji: "🤖"  },
          { label: "!  →  !profile, !daily",      value: "!",          description: "Classic — may conflict with other bots",    emoji: "❗"  },
          { label: "bot!  →  bot!profile",        value: "bot",        description: "Generic bot prefix",                        emoji: "🔧"  },
          { label: "✍️  Custom prefix…",           value: "__custom__", description: "Type your own (opens a text input)",        emoji: "✏️"  },
          { label: "↩️  Reset to default (c!)",   value: "__reset__",  description: "Restore the global default",                emoji: "↩️"  },
        ])
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("setup_back").setLabel("← Back to Overview").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── Command ───────────────────────────────────────────────────────────────────

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Interactive server configuration — encounters, channels, prefix and more.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Server only.", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });

    const guildId   = interaction.guildId;
    const guildName = interaction.guild?.name ?? "This Server";
    let s           = await getSettings(guildId);
    let prefix      = getPrefix(guildId);
    let page: Page  = "main";

    // ── Render helper ──────────────────────────────────────────────────────────
    const render = async (done = false) => {
      s      = await getSettings(guildId);
      prefix = getPrefix(guildId);

      let embed:      EmbedBuilder;
      let components: ActionRowBuilder<any>[];

      switch (page) {
        case "encounters":
          embed      = encounterEmbed(s, guildName);
          components = encounterComponents(s);
          break;
        case "output":
          embed      = outputEmbed(s, guildName);
          components = outputComponents(s);
          break;
        case "general":
          embed      = generalEmbed(prefix, guildName);
          components = generalComponents(prefix);
          break;
        default:
          embed      = mainEmbed(s, prefix, guildName, done);
          components = done ? [] : mainComponents(s);
      }
      await interaction.editReply({ embeds: [embed], components }).catch(() => {});
    };

    await render();

    // ── Collector ──────────────────────────────────────────────────────────────
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
      const id = i.customId;

      // ── Navigation ───────────────────────────────────────────────────────────
      if (id === "setup_nav_enc")   { page = "encounters"; await i.deferUpdate(); await render(); return; }
      if (id === "setup_nav_out")   { page = "output";     await i.deferUpdate(); await render(); return; }
      if (id === "setup_nav_gen")   { page = "general";    await i.deferUpdate(); await render(); return; }
      if (id === "setup_back")      { page = "main";       await i.deferUpdate(); await render(); return; }

      // ── Done ─────────────────────────────────────────────────────────────────
      if (id === "setup_done") {
        await i.deferUpdate();
        page = "main";
        collector.stop("done");
        await render(true);
        return;
      }

      // ── Toggle encounters ─────────────────────────────────────────────────────
      if (id === "setup_toggle_enc") {
        await (i as ButtonInteraction).deferUpdate();
        s = await getSettings(guildId);
        await prisma.guildSettings.update({ where: { guildId }, data: { encountersEnabled: !s.encountersEnabled } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Toggle level-up cards ─────────────────────────────────────────────────
      if (id === "setup_toggle_levelup") {
        await (i as ButtonInteraction).deferUpdate();
        s = await getSettings(guildId);
        await prisma.guildSettings.update({ where: { guildId }, data: { levelUpEnabled: s.levelUpEnabled === false } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Encounter allowlist ────────────────────────────────────────────────────
      if (id === "setup_enc_allow") {
        await (i as ChannelSelectMenuInteraction).deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { encounterChannelIds: (i as ChannelSelectMenuInteraction).values } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Encounter blacklist ────────────────────────────────────────────────────
      if (id === "setup_enc_block") {
        await (i as ChannelSelectMenuInteraction).deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { encounterBlacklist: (i as ChannelSelectMenuInteraction).values } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Explore channels ──────────────────────────────────────────────────────
      if (id === "setup_enc_explore") {
        await (i as ChannelSelectMenuInteraction).deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { exploreChannelIds: (i as ChannelSelectMenuInteraction).values } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Welcome channel ───────────────────────────────────────────────────────
      if (id === "setup_out_welcome") {
        await (i as ChannelSelectMenuInteraction).deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { welcomeChannelId: (i as ChannelSelectMenuInteraction).values[0] ?? null } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Level-up channel ──────────────────────────────────────────────────────
      if (id === "setup_out_levelup") {
        await (i as ChannelSelectMenuInteraction).deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { levelUpChannelId: (i as ChannelSelectMenuInteraction).values[0] ?? null } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Notification channel ──────────────────────────────────────────────────
      if (id === "setup_out_notif") {
        await (i as ChannelSelectMenuInteraction).deferUpdate();
        await prisma.guildSettings.update({ where: { guildId }, data: { notifChannelId: (i as ChannelSelectMenuInteraction).values[0] ?? null } });
        await loadExploreChannels(guildId);
        await render(); return;
      }

      // ── Prefix ────────────────────────────────────────────────────────────────
      if (id === "setup_prefix") {
        const value = (i as StringSelectMenuInteraction).values[0];

        if (value === "__reset__") {
          await (i as StringSelectMenuInteraction).deferUpdate();
          await savePrefixToDb(guildId, null);
          await render(); return;
        }

        if (value === "__custom__") {
          const modal = new ModalBuilder()
            .setCustomId("setup_pfx_modal")
            .setTitle("Set Custom Prefix")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("pfx_value")
                  .setLabel("Prefix without ! — e.g. type 'c' to get c!")
                  .setStyle(TextInputStyle.Short)
                  .setPlaceholder("e.g.  c  or  mybot  or  !")
                  .setMinLength(1).setMaxLength(5).setRequired(true)
              )
            );
          await (i as StringSelectMenuInteraction).showModal(modal);

          const submitted = await new Promise<ModalSubmitInteraction | null>((resolve) => {
            const tid = setTimeout(() => { interaction.client.off(Events.InteractionCreate, handler); resolve(null); }, 60_000);
            const handler = (intr: Interaction) => {
              if (intr.isModalSubmit() && intr.customId === "setup_pfx_modal" && intr.user.id === interaction.user.id) {
                clearTimeout(tid);
                interaction.client.off(Events.InteractionCreate, handler);
                resolve(intr as ModalSubmitInteraction);
              }
            };
            interaction.client.on(Events.InteractionCreate, handler);
          });

          if (submitted) {
            await submitted.deferUpdate();
            const cleaned = submitted.fields.getTextInputValue("pfx_value").trim().toLowerCase().replace(/!+$/, "") || null;
            if (cleaned) await savePrefixToDb(guildId, cleaned);
          }
          await render(); return;
        }

        await (i as StringSelectMenuInteraction).deferUpdate();
        await savePrefixToDb(guildId, value);
        await render(); return;
      }
    });

    collector?.on("end", async (_c, reason) => {
      if (reason === "done") return;
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
