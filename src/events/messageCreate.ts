import { Events, Message, EmbedBuilder, AttachmentBuilder, TextChannel } from "discord.js";
import { tryAwardChatExp, getOrCreateUser } from "../lib/economy";
import { checkLevelUp, WORLD_LEVEL_CAPS, sendMilestoneNotifications } from "../lib/progression";
import { generateLevelUpCard } from "../lib/levelUpCard";
import { sendElementSelection } from "../lib/elementSelect";
import { shouldSpawnEncounter, spawnEncounter } from "../lib/encounter";
import { getPrefix } from "../lib/prefixManager";
import { ExtendedClient } from "../types";
import prisma from "../lib/prisma";

export const name = Events.MessageCreate;
export const once = false;

// Commands that work via prefix (no interactive components needed)
const PREFIX_COMMANDS = new Set([
  "ping", "profile", "level", "inventory", "echoes", "daily",
  "ability", "weapon", "leaderboard", "guide",
]);

export async function execute(message: Message) {
  if (message.author.bot || !message.guild) return;
  const channel = message.channel as TextChannel;

  const displayName = message.member?.displayName
    ?? message.author.displayName
    ?? message.author.username;

  await getOrCreateUser(
    message.author.id,
    displayName,
    message.author.displayAvatarURL({ size: 128, extension: "png" })
  );

  // ── Prefix command handler ───────────────────────────────────────────────────
  const prefix = getPrefix(message.guildId!);
  if (prefix) {
    const lower = message.content.trim().toLowerCase();
    // Match: prefix followed by space+command or just prefix+command (e.g. "c ping" or "c!ping")
    const prefixPattern = new RegExp(`^${escapeRegex(prefix)}[!\\s]+`);
    if (prefixPattern.test(lower)) {
      const withoutPrefix = message.content.trim().slice(prefix.length).trimStart().replace(/^!+\s*/, "");
      const [cmdName, ...rest] = withoutPrefix.trim().split(/\s+/);
      const cmd = cmdName?.toLowerCase();

      if (cmd && PREFIX_COMMANDS.has(cmd)) {
        const client = message.client as ExtendedClient;
        const command = client.commands.get(cmd);
        if (command) {
          // Build a fake ChatInputCommandInteraction shim for simple commands
          const fakeInteraction = buildPrefixInteraction(message, cmd, rest);
          try {
            await command.execute(fakeInteraction as any);
          } catch (err) {
            console.error(`[Prefix] Error running ${cmd}:`, err);
            await message.reply({ content: `◈ Something went wrong running \`${cmd}\`.` }).catch(() => {});
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          // Don't process EXP for command-trigger messages
          return;
        }
      }
    }
  }

  // ── Chat EXP ─────────────────────────────────────────────────────────────────
  const expGained = await tryAwardChatExp(message.author.id);

  // Encounter check — runs regardless of exp cooldown
  if (shouldSpawnEncounter(message.guildId!, message.channelId)) {
    const dbForEnc = await prisma.user.findUnique({
      where:  { id: message.author.id },
      select: { worldLevel: true },
    });
    await spawnEncounter(channel, dbForEnc?.worldLevel ?? 0);
  }

  if (!expGained) return;

  const result = await checkLevelUp(message.author.id);
  if (!result.didLevelUp) return;

  // Fetch element for theming
  const dbUser = await prisma.user.findUnique({
    where:  { id: message.author.id },
    select: { element: true },
  });

  const avatarUrl  = message.author.displayAvatarURL({ size: 256, extension: "png" });
  const isCapped   = result.hitCapAt !== null;

  const cardBuffer = await generateLevelUpCard({
    displayName,
    avatarUrl,
    oldLevel:  result.oldLevel,
    newLevel:  result.newLevel,
    element:   dbUser?.element ?? "NONE",
    isCapped,
  });

  const attachment = new AttachmentBuilder(cardBuffer, { name: "levelup.png" });

  const embed = new EmbedBuilder()
    .setColor(0x6366F1)
    .setImage("attachment://levelup.png")
    .setFooter({ text: "CARTETHYIA  ·  Resonance System" });

  await channel.send({ embeds: [embed], files: [attachment] }).catch(() => {});

  // Milestone unlocks + level cap notification (shared with /use record)
  await sendMilestoneNotifications(channel, result.oldLevel, result.newLevel, result.hitCapAt);

  // If player just hit level 20 and hasn't chosen an element — trigger element selection
  if (result.newLevel === 20 && (!dbUser?.element || dbUser.element === "NONE")) {
    await new Promise((r) => setTimeout(r, 1500)); // small pause after level-up card
    await sendElementSelection(
      message.author.id,
      displayName,
      message.channel as TextChannel
    );
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds a minimal fake interaction that satisfies simple slash command execute() calls.
// Only works for commands that call deferReply → editReply (no modals, no select menus).
function buildPrefixInteraction(message: Message, commandName: string, args: string[]) {
  let replied = false;
  let deferred = false;
  let replyContent: any = null;

  const textChannel = message.channel as TextChannel;
  const send = async (data: any) => {
    if (!replied) {
      replied = true;
      replyContent = await message.reply(normalizeData(data)).catch(() => null);
    } else {
      replyContent = await textChannel.send(normalizeData(data)).catch(() => null);
    }
    return replyContent;
  };

  const edit = async (data: any) => {
    if (replyContent && "edit" in replyContent) {
      await (replyContent as Message).edit(normalizeData(data)).catch(() => {});
    }
  };

  return {
    user:    message.author,
    member:  message.member,
    guild:   message.guild,
    channel: message.channel,
    client:  message.client,
    guildId: message.guildId,
    commandName,

    options: {
      getUser: (_name: string) => {
        // If a user was mentioned, return them
        return message.mentions.users.first() ?? null;
      },
      getString:  (_name: string) => args[0] ?? null,
      getInteger: (_name: string) => (args[0] ? parseInt(args[0]) : null),
      getBoolean: (_name: string) => null,
      getNumber:  (_name: string) => null,
    },

    deferReply: async (_opts?: any) => { deferred = true; },
    reply:      async (data: any) => { await send(data); },
    editReply:  async (data: any) => {
      if (deferred && !replied) {
        replied = true;
        replyContent = await message.reply(normalizeData(data)).catch(() => null);
      } else {
        await edit(data);
      }
    },
    followUp: async (data: any) => {
      await (message.channel as TextChannel).send(normalizeData(data)).catch(() => {});
    },
  };
}

function normalizeData(data: any): any {
  if (typeof data === "string") return { content: data };
  const out: any = {};
  if (data.content)    out.content   = data.content;
  if (data.embeds)     out.embeds    = data.embeds;
  if (data.files)      out.files     = data.files;
  if (data.components) out.components = data.components;
  // Strip ephemeral flag — text channels don't support it
  return out;
}
