import { Events, Message, EmbedBuilder, AttachmentBuilder, TextChannel } from "discord.js";
import { tryAwardChatExp, getOrCreateUser } from "../lib/economy";
import { checkLevelUp, sendMilestoneNotifications } from "../lib/progression";
import { generateLevelUpCard } from "../lib/levelUpCard";
import { sendElementSelection } from "../lib/elementSelect";
import { shouldSpawnEncounter, spawnEncounter, getLevelUpChannelId, getNotifChannelId, isLevelUpEnabled } from "../lib/encounter";
import { getPrefix } from "../lib/prefixManager";
import { ExtendedClient } from "../types";
import prisma from "../lib/prisma";

export const name = Events.MessageCreate;
export const once = false;

export async function execute(message: Message) {
  if (message.author.bot || !message.guild) return;
  const channel = message.channel as TextChannel;

  const displayName = message.member?.displayName
    ?? message.author.displayName
    ?? message.author.username;

  // ── Prefix command handler ───────────────────────────────────────────────────
  // Runs FIRST — before any DB call — so a slow database can never delay or block
  // a command. Each command calls getOrCreateUser() itself, so the user is still
  // ensured to exist. EXP/encounter handling below does its own getOrCreateUser.
  const prefix  = getPrefix(message.guildId!);   // always returns a string ("c!" default)
  const content = message.content;

  if (content.toLowerCase().startsWith(prefix.toLowerCase())) {
    const withoutPrefix = content.slice(prefix.length).trim().replace(/^!+/, "");
    if (withoutPrefix.length > 0) {
      const [cmdName, ...rest] = withoutPrefix.split(/\s+/);
      const cmd = cmdName.toLowerCase();

      const client  = message.client as ExtendedClient;
      const command = client.commands.get(cmd);

      if (command) {
        const fakeInteraction = buildPrefixInteraction(message, cmd, rest);
        try {
          await command.execute(fakeInteraction as any);
        } catch (err) {
          console.error(`[Prefix] Error running ${cmd}:`, err);
          await message.reply({ content: `◈ Something went wrong running \`${cmd}\`.` }).catch(() => {});
        }
        // Don't award EXP for command messages
        return;
      }
    }
  }

  // ── Ensure user exists (for EXP + encounters) ────────────────────────────────
  await getOrCreateUser(
    message.author.id,
    displayName,
    message.author.displayAvatarURL({ size: 128, extension: "png" })
  );

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

  const avatarUrl = message.author.displayAvatarURL({ size: 256, extension: "png" });
  const isCapped  = result.hitCapAt !== null;
  const guildId   = message.guildId!;

  // Resolve target channels from guild settings (falls back to current channel)
  const lvUpId  = getLevelUpChannelId(guildId);
  const notifId = getNotifChannelId(guildId);
  const lvUpCh  = (lvUpId  && message.client.channels.cache.get(lvUpId)  as TextChannel | undefined) || channel;
  const notifCh = (notifId && message.client.channels.cache.get(notifId) as TextChannel | undefined) || lvUpCh;

  // Level-up card (respects the levelUpEnabled toggle)
  if (isLevelUpEnabled(guildId)) {
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
    await lvUpCh.send({ embeds: [embed], files: [attachment] }).catch(() => {});
  }

  // Milestone unlocks + level cap notification
  await sendMilestoneNotifications(notifCh, result.oldLevel, result.newLevel, result.hitCapAt);

  // If player just hit level 20 and hasn't chosen an element — trigger element selection
  if (result.newLevel === 20 && (!dbUser?.element || dbUser.element === "NONE")) {
    await new Promise((r) => setTimeout(r, 1500));
    await sendElementSelection(
      message.author.id,
      displayName,
      message.channel as TextChannel
    );
  }
}

// ── Prefix interaction adapter ────────────────────────────────────────────────
//
// Wraps a Message so that any slash command's execute() can be called unchanged.
// Positional args are consumed in the ORDER they are requested — which mirrors
// how discord.js delivers slash command options sequentially.
//
// Usage syntax examples:
//   c!profile                       ← no args
//   c!guide echoes                  ← getString("topic") → "echoes"
//   c!dispatch send                 ← getSubcommand() → "send"
//   c!vibe hug @User                ← getString("action") → "hug", getUser("target") → @User
//   c!dungeon type:echo-dungeon     ← named: getString("type") → "echo-dungeon"
//   c!echo-equip slot:3 cost:3      ← named: getInteger("slot") → 3
//
function buildPrefixInteraction(message: Message, commandName: string, rawArgs: string[]) {
  // Separate named args (key:value) from positional args
  const named: Record<string, string> = {};
  const positional: string[] = [];

  for (const arg of rawArgs) {
    const m = arg.match(/^([\w-]+):([\s\S]+)$/);
    if (m) {
      named[m[1].toLowerCase()] = m[2];
    } else {
      positional.push(arg);
    }
  }

  // Mentioned users in arrival order (for getUser calls)
  const mentionedUsers = [...message.mentions.users.values()];
  let mentionIdx = 0;

  // Shared positional index — consumed in call order
  let posIdx = 0;
  const nextPos = (): string | null => positional[posIdx++] ?? null;

  const getNamed = (name: string): string | null => named[name.toLowerCase()] ?? null;
  const getNamedOrPos = (name: string): string | null => getNamed(name) ?? nextPos();

  // Reply state
  let replied  = false;
  let deferred = false;
  let replyMsg: Message | null = null;

  const sendPayload = async (data: any): Promise<Message | null> => {
    const payload = normalizeData(data);
    if (!replied) {
      replied  = true;
      replyMsg = await message.reply(payload).catch(() => null);
    } else {
      replyMsg = await (message.channel as TextChannel).send(payload).catch(() => null);
    }
    return replyMsg;
  };

  const editPayload = async (data: any) => {
    if (replyMsg) await replyMsg.edit(normalizeData(data)).catch(() => {});
  };

  return {
    // Core identity
    user:       message.author,
    member:     message.member,
    guild:      message.guild,
    channel:    message.channel,
    client:     message.client,
    guildId:    message.guildId,
    channelId:  message.channelId,
    commandName,

    // Type guards (some commands check these)
    isCommand:           () => true,
    isChatInputCommand:  () => true,
    isRepliable:         () => true,

    // ── Options ────────────────────────────────────────────────────────────────
    options: {
      // Subcommand: consumes the first positional word
      getSubcommand: (_required?: boolean): string =>
        getNamed("_sub") ?? nextPos()?.toLowerCase() ?? "",

      // Subcommand group: not used in prefix context
      getSubcommandGroup: (_required?: boolean): string | null => null,

      getString: (name: string, _req?: boolean): string | null =>
        getNamedOrPos(name),

      getInteger: (name: string, _req?: boolean): number | null => {
        const v = getNamedOrPos(name);
        if (v === null) return null;
        const n = parseInt(v, 10);
        return isNaN(n) ? null : n;
      },

      getNumber: (name: string, _req?: boolean): number | null => {
        const v = getNamedOrPos(name);
        if (v === null) return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      },

      getBoolean: (name: string, _req?: boolean): boolean | null => {
        const v = getNamedOrPos(name);
        if (v === null) return null;
        return v === "true" || v === "yes" || v === "1";
      },

      // User: named arg (as raw ID or <@id>) → next @mention in message
      getUser: (_name: string, _req?: boolean) => {
        const namedVal = getNamed(_name);
        if (namedVal) {
          const id = namedVal.replace(/[<@!>]/g, "");
          return message.mentions.users.get(id) ?? null;
        }
        // Advance past any <@…> token in positional
        while (posIdx < positional.length && positional[posIdx].startsWith("<@")) {
          posIdx++;
        }
        return mentionedUsers[mentionIdx++] ?? null;
      },

      getMember: (_name: string, _req?: boolean) =>
        message.mentions.members?.first() ?? null,

      getChannel: (_name: string, _req?: boolean) =>
        message.mentions.channels?.first() ?? null,

      getRole: (_name: string, _req?: boolean) =>
        message.mentions.roles?.first() ?? null,

      getMentionable: (_name: string, _req?: boolean) =>
        message.mentions.users.first() ?? message.mentions.roles.first() ?? null,

      getAttachment: (_name: string, _req?: boolean) =>
        message.attachments.first() ?? null,

      // Autocomplete — not applicable for prefix commands
      getFocused: () => ({ value: "" }),

      resolved: null,
      data:     {},
    },

    // ── Reply methods ──────────────────────────────────────────────────────────
    deferReply: async (_opts?: any) => {
      deferred = true;
      // Return shape expected by commands that use withResponse: true
      return { resource: { message: null } };
    },

    reply: async (data: any) => {
      const msg = await sendPayload(data);
      return { resource: { message: msg } };
    },

    editReply: async (data: any) => {
      if (deferred && !replied) {
        // First real response after a deferReply
        replied  = true;
        replyMsg = await message.reply(normalizeData(data)).catch(() => null);
      } else {
        await editPayload(data);
      }
      return replyMsg;
    },

    followUp: async (data: any) => {
      return (message.channel as TextChannel).send(normalizeData(data)).catch(() => null);
    },

    deleteReply: async () => {
      await replyMsg?.delete().catch(() => {});
    },

    fetchReply: async () => replyMsg,

    // Modals / select menus are not supported in prefix context (no-op)
    showModal: async () => {},

    // Needed by some internals
    deferred,
    replied,
  };
}

// Strip interaction-only flags and normalise to a plain sendable payload
function normalizeData(data: any): any {
  if (typeof data === "string") return { content: data };
  const out: any = {};
  if (data.content    !== undefined) out.content    = data.content;
  if (data.embeds     !== undefined) out.embeds     = data.embeds;
  if (data.files      !== undefined) out.files      = data.files;
  if (data.components !== undefined) out.components = data.components;
  if (data.attachments !== undefined) out.attachments = data.attachments;
  // Strip ephemeral / flags — text channels don't support them
  return out;
}
