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

// ── Channel types included in selectors ───────────────────────────────────────
// Text-capable: regular text, announcements, and all thread types
const TEXT_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
] as const;

// Only non-thread channels for output (welcome/level-up/notif should be top-level)
const OUTPUT_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
] as const;

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getSettings(guildId: string) {
  return prisma.guildSettings.upsert({
    where:  { guildId },
    update: {},
    create: { guildId },
  });
}

// ── Panel page definitions ────────────────────────────────────────────────────

type Page = "main" | "encounters" | "output" | "commands" | "general";

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────

function mainEmbed(s: any, prefix: string, guildName: string, saved = false) {
  const pfx    = prefix || "c";
  const encChs = s.encounterChannelIds.length ? s.encounterChannelIds.map((id: string) => `<#${id}>`).join(" ") : "All channels";
  const blkChs = s.encounterBlacklist?.length ? s.encounterBlacklist.map((id: string) => `<#${id}>`).join(" ") : "None";
  const expChs = s.exploreChannelIds.length   ? s.exploreChannelIds.map((id: string) => `<#${id}>`).join(" ")   : "None";
  const welCh  = s.welcomeChannelId  ? `<#${s.welcomeChannelId}>`  : "Disabled";
  const lvUpCh = s.levelUpChannelId  ? `<#${s.levelUpChannelId}>`  : "Same channel as message";
  const notifCh = s.notifChannelId   ? `<#${s.notifChannelId}>`    : "Same as level-up";
  const botChs = s.botChannelIds?.length ? s.botChannelIds.map((id: string) => `<#${id}>`).join(" ") : "All channels";

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
          `🎴 Level-Up Cards: ${s.levelUpEnabled !== false ? "✅" : "⛔"} → ${lvUpCh}`,
          `🔔 Notifications:  ${notifCh}`,
        ].join("\n"),
        inline: true,
      },
      {
        name:  "🤖  Commands",
        value: [
          `💬 Bot Channels:  ${botChs}`,
          `✨ Chat EXP:      ${s.expEnabled !== false ? "✅ On" : "⛔ Off"}`,
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
      new ButtonBuilder().setCustomId("setup_nav_enc").setLabel("⚔️  Encounters").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("setup_nav_out").setLabel("📢  Output Channels").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("setup_nav_cmd").setLabel("🤖  Commands").setStyle(ButtonStyle.Primary),
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
        value: `${blk}\n-# Always silent — no enemies regardless of allowlist. Use the picker **or** ➕ Add by ID for threads the bot can't see.`,
        inline: false,
      },
      {
        name: "🗺️  Explore Channels",
        value: `${exp}\n-# High-rate grind zones — **38% spawn rate** & **30s cooldown** vs 13% / 2min in normal channels.`,
        inline: false,
      },
    )
    .setFooter({ text: "CARTETHYIA  ·  Threads not visible in picker? Use ➕ Add by ID  ·  Right-click channel → Copy ID" });
}

function encounterComponents(s: any) {
  const allowMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_enc_allow")
    .setPlaceholder("📍  Encounter Allowlist — where enemies can spawn (clear = everywhere)")
    .setChannelTypes(...TEXT_CHANNEL_TYPES)
    .setMinValues(0).setMaxValues(20);
  if (s.encounterChannelIds.length) allowMenu.setDefaultChannels(s.encounterChannelIds);

  const blackMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_enc_block")
    .setPlaceholder("🚫  Encounter Blacklist — enemies NEVER spawn here (includes threads)")
    .setChannelTypes(...TEXT_CHANNEL_TYPES)
    .setMinValues(0).setMaxValues(20);
  if (s.encounterBlacklist?.length) blackMenu.setDefaultChannels(s.encounterBlacklist);

  const exploreMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_enc_explore")
    .setPlaceholder("🗺️  Explore Channels — high-rate grind zones (38% spawn, 30s cooldown)")
    .setChannelTypes(...TEXT_CHANNEL_TYPES)
    .setMinValues(0).setMaxValues(10);
  if (s.exploreChannelIds.length) exploreMenu.setDefaultChannels(s.exploreChannelIds);

  return [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(allowMenu),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(blackMenu),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(exploreMenu),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("setup_blk_add_id").setLabel("➕ Add to Blacklist by ID").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("setup_blk_clear_id").setLabel("🗑️ Remove from Blacklist by ID").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("setup_back").setLabel("← Back").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── OUTPUT CHANNELS PAGE ──────────────────────────────────────────────────────

function outputEmbed(s: any, guildName: string) {
  const welCh   = s.welcomeChannelId  ? `<#${s.welcomeChannelId}>`  : "Disabled";
  const lvUpCh  = s.levelUpChannelId  ? `<#${s.levelUpChannelId}>`  : "Same channel as the message";
  const notifCh = s.notifChannelId    ? `<#${s.notifChannelId}>`    : "Same as level-up";
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
    .setChannelTypes(...OUTPUT_CHANNEL_TYPES)
    .setMinValues(0).setMaxValues(1);
  if (s.welcomeChannelId) welMenu.setDefaultChannels([s.welcomeChannelId]);

  const lvUpMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_out_levelup")
    .setPlaceholder("🎴  Level-Up Cards Channel — where level-up cards post (clear = same channel)")
    .setChannelTypes(...OUTPUT_CHANNEL_TYPES)
    .setMinValues(0).setMaxValues(1);
  if (s.levelUpChannelId) lvUpMenu.setDefaultChannels([s.levelUpChannelId]);

  const notifMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_out_notif")
    .setPlaceholder("🔔  Notification Channel — milestones & cap alerts (clear = same as level-up)")
    .setChannelTypes(...OUTPUT_CHANNEL_TYPES)
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

// ── COMMANDS PAGE ─────────────────────────────────────────────────────────────

function commandsEmbed(s: any, guildName: string) {
  const botChs = s.botChannelIds?.length
    ? s.botChannelIds.map((id: string) => `<#${id}>`).join(" ")
    : "All channels (no restriction)";

  return new EmbedBuilder()
    .setColor(0x10B981)
    .setAuthor({ name: `⚙️  ${guildName}  ·  Command Settings` })
    .addFields(
      {
        name: "🤖  Bot Command Channels",
        value: `${botChs}\n-# If set, slash commands and prefix commands **only work in these channels**. \`/setup\` always works for admins regardless. Clear = commands work everywhere.`,
        inline: false,
      },
      {
        name: `✨  Chat EXP — ${s.expEnabled !== false ? "✅ Enabled" : "⛔ Disabled"}`,
        value: `-# When disabled, chatting does **not** award Resonance EXP. Encounters still spawn normally. Toggle with the button below.`,
        inline: false,
      },
    )
    .setFooter({ text: "CARTETHYIA  ·  Command Settings  ·  Includes threads in the channel picker" });
}

function commandsComponents(s: any) {
  const botChMenu = new ChannelSelectMenuBuilder()
    .setCustomId("setup_cmd_channels")
    .setPlaceholder("🤖  Bot Command Channels — restrict where commands work (clear = everywhere)")
    .setChannelTypes(...TEXT_CHANNEL_TYPES)
    .setMinValues(0).setMaxValues(20);
  if (s.botChannelIds?.length) botChMenu.setDefaultChannels(s.botChannelIds);

  return [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(botChMenu),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("setup_toggle_exp")
        .setLabel(s.expEnabled !== false ? "✨  Disable Chat EXP" : "✨  Enable Chat EXP")
        .setStyle(s.expEnabled !== false ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId("setup_back").setLabel("← Back to Overview").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ── GENERAL PAGE ──────────────────────────────────────────────────────────────

function generalEmbed(prefix: string, guildName: string) {
  const pfx = prefix || "c";
  return new EmbedBuilder()
    .setColor(0xF59E0B)
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
    .setDescription("Interactive server configuration — encounters, channels, commands, prefix and more.")
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
        case "commands":
          embed      = commandsEmbed(s, guildName);
          components = commandsComponents(s);
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

    const save = async (i: any, data: Record<string, any>) => {
      await i.deferUpdate();
      await prisma.guildSettings.update({ where: { guildId }, data });
      await loadExploreChannels(guildId);
      await render();
    };

    collector?.on("collect", async (i) => {
      try {
      const id = i.customId;

      // ── Navigation ───────────────────────────────────────────────────────────
      if (id === "setup_nav_enc")  { page = "encounters"; await i.deferUpdate(); await render(); return; }
      if (id === "setup_nav_out")  { page = "output";     await i.deferUpdate(); await render(); return; }
      if (id === "setup_nav_cmd")  { page = "commands";   await i.deferUpdate(); await render(); return; }
      if (id === "setup_nav_gen")  { page = "general";    await i.deferUpdate(); await render(); return; }
      if (id === "setup_back")     { page = "main";       await i.deferUpdate(); await render(); return; }

      // ── Done ─────────────────────────────────────────────────────────────────
      if (id === "setup_done") {
        await i.deferUpdate();
        page = "main";
        collector.stop("done");
        await render(true);
        return;
      }

      // ── Toggles ───────────────────────────────────────────────────────────────
      if (id === "setup_toggle_enc") {
        await save(i, { encountersEnabled: !s.encountersEnabled }); return;
      }
      if (id === "setup_toggle_levelup") {
        await save(i, { levelUpEnabled: (s as any).levelUpEnabled === false }); return;
      }
      if (id === "setup_toggle_exp") {
        await save(i, { expEnabled: (s as any).expEnabled === false }); return;
      }

      // ── Encounter channels ────────────────────────────────────────────────────
      if (id === "setup_enc_allow") {
        await save(i, { encounterChannelIds: (i as ChannelSelectMenuInteraction).values }); return;
      }
      if (id === "setup_enc_block") {
        await save(i, { encounterBlacklist: (i as ChannelSelectMenuInteraction).values }); return;
      }
      if (id === "setup_enc_explore") {
        await save(i, { exploreChannelIds: (i as ChannelSelectMenuInteraction).values }); return;
      }

      // ── Blacklist add/remove by ID (for threads the picker can't see) ─────────
      if (id === "setup_blk_add_id" || id === "setup_blk_clear_id") {
        const isAdd = id === "setup_blk_add_id";
        const modal = new ModalBuilder()
          .setCustomId(`setup_blk_id_modal_${isAdd ? "add" : "remove"}`)
          .setTitle(isAdd ? "Add Channels/Threads by ID" : "Remove Channels/Threads by ID")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("channel_ids")
                .setLabel("Channel / Thread IDs (comma separated)")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("e.g.  1234567890  or  1234567890, 9876543210\n\nRight-click a channel/thread → Copy Channel ID")
                .setMinLength(1).setMaxLength(1000).setRequired(true)
            )
          );
        await (i as ButtonInteraction).showModal(modal);

        const submitted = await new Promise<{ intr: ModalSubmitInteraction; raw: string } | null>((resolve) => {
          const tid = setTimeout(() => { interaction.client.off(Events.InteractionCreate, mHandler); resolve(null); }, 60_000);
          const mHandler = async (intr: Interaction) => {
            if (
              intr.isModalSubmit() &&
              intr.customId === `setup_blk_id_modal_${isAdd ? "add" : "remove"}` &&
              intr.user.id === interaction.user.id
            ) {
              clearTimeout(tid);
              interaction.client.off(Events.InteractionCreate, mHandler);
              const raw = (intr as ModalSubmitInteraction).fields.getTextInputValue("channel_ids");
              // Acknowledge the modal — deferUpdate for component-triggered modals, fall back to reply
              try {
                await (intr as any).deferUpdate();
              } catch (e1: any) {
                console.error("[Setup] deferUpdate failed on modal:", e1?.message ?? e1);
                try {
                  await (intr as any).reply({ content: "◈ Updating...", flags: 64 });
                } catch (e2: any) {
                  console.error("[Setup] reply fallback also failed:", e2?.message ?? e2);
                }
              }
              resolve({ intr: intr as ModalSubmitInteraction, raw });
            }
          };
          interaction.client.on(Events.InteractionCreate, mHandler);
        });

        if (submitted) {
          const ids     = submitted.raw.split(/[\s,]+/).map(x => x.trim()).filter(x => /^\d{17,20}$/.test(x));
          const fresh   = await getSettings(guildId);
          const current: string[] = (fresh as any).encounterBlacklist ?? [];
          const updated = isAdd
            ? [...new Set([...current, ...ids])]
            : current.filter(x => !ids.includes(x));
          await prisma.guildSettings.update({ where: { guildId }, data: { encounterBlacklist: updated } });
          await loadExploreChannels(guildId);
        }
        await render(); return;
      }

      // ── Output channels ───────────────────────────────────────────────────────
      if (id === "setup_out_welcome") {
        await save(i, { welcomeChannelId: (i as ChannelSelectMenuInteraction).values[0] ?? null }); return;
      }
      if (id === "setup_out_levelup") {
        await save(i, { levelUpChannelId: (i as ChannelSelectMenuInteraction).values[0] ?? null }); return;
      }
      if (id === "setup_out_notif") {
        await save(i, { notifChannelId: (i as ChannelSelectMenuInteraction).values[0] ?? null }); return;
      }

      // ── Command channels ──────────────────────────────────────────────────────
      if (id === "setup_cmd_channels") {
        await save(i, { botChannelIds: (i as ChannelSelectMenuInteraction).values }); return;
      }

      // ── Prefix ────────────────────────────────────────────────────────────────
      if (id === "setup_prefix") {
        const value = (i as StringSelectMenuInteraction).values[0];

        if (value === "__reset__") {
          await i.deferUpdate();
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

          const submitted = await new Promise<string | null>((resolve) => {
            const tid = setTimeout(() => { interaction.client.off(Events.InteractionCreate, handler); resolve(null); }, 60_000);
            const handler = async (intr: Interaction) => {
              if (intr.isModalSubmit() && intr.customId === "setup_pfx_modal" && intr.user.id === interaction.user.id) {
                clearTimeout(tid);
                interaction.client.off(Events.InteractionCreate, handler);
                const val = (intr as ModalSubmitInteraction).fields.getTextInputValue("pfx_value").trim().toLowerCase().replace(/!+$/, "") || null;
                try {
                  await (intr as any).deferUpdate();
                } catch (e1: any) {
                  console.error("[Setup] deferUpdate failed on pfx modal:", e1?.message ?? e1);
                  try { await (intr as any).reply({ content: "◈ Updating...", flags: 64 }); }
                  catch (e2: any) { console.error("[Setup] pfx reply fallback failed:", e2?.message ?? e2); }
                }
                resolve(val);
              }
            };
            interaction.client.on(Events.InteractionCreate, handler);
          });

          if (submitted) {
            await savePrefixToDb(guildId, submitted);
          }
          await render(); return;
        }

        await i.deferUpdate();
        await savePrefixToDb(guildId, value);
        await render(); return;
      }
      } catch (err: any) {
        console.error("[Setup] collector error:", err?.message ?? err);
        await i.reply({ content: "◈ Something went wrong in setup. Please try again.", flags: 64 }).catch(() => {});
      }
    });

    collector?.on("end", async (_c, reason) => {
      if (reason === "done") return;
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
