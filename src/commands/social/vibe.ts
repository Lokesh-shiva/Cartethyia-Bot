import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { fetchGif, ActionType, ACTION_META } from "../../lib/gifs";
import { processInteractionRewards, rollLoot, LootResult } from "../../lib/loot";
import { generateInteractionFlavor } from "../../lib/ai";
import { getAffinity, incrementAffinity } from "../../lib/economy";
import { generateLootCard } from "../../lib/lootCard";
import { AttachmentBuilder } from "discord.js";
import prisma from "../../lib/prisma";

// ── Choices ───────────────────────────────────────────────────────────────────
const PHYSICAL_CHOICES = [
  { name: "🤗 Hug",       value: "hug"      },
  { name: "🫵 Pat",       value: "pat"      },
  { name: "💋 Kiss",      value: "kiss"     },
  { name: "👋 Slap",      value: "slap"     },
  { name: "😤 Bite",      value: "bite"     },
  { name: "👉 Poke",      value: "poke"     },
  { name: "🥰 Cuddle",    value: "cuddle"   },
  { name: "🤝 Handhold",  value: "handhold" },
];
const EXPRESSIVE_CHOICES = [
  { name: "💃 Dance",     value: "dance"    },
  { name: "😢 Cry",       value: "cry"      },
  { name: "😊 Blush",     value: "blush"    },
  { name: "😴 Sleep",     value: "sleep"    },
  { name: "😏 Smug",      value: "smug"     },
  { name: "👋 Wave",      value: "wave"     },
  { name: "👍 Thumbs Up", value: "thumbsup" },
  { name: "😋 Nom",       value: "nom"      },
];
const EMOTIONAL_CHOICES = [
  { name: "😠 Angry",     value: "angry"    },
  { name: "😄 Happy",     value: "happy"    },
  { name: "😬 Cringe",    value: "cringe"   },
  { name: "😑 Bored",     value: "bored"    },
  { name: "😰 Nervous",   value: "nervous"  },
];

// ── Element → hex color (drives embed sidebar) ────────────────────────────────
const ELEMENT_HEX: Record<string, number> = {
  FUSION:   0xFF6B35,
  GLACIO:   0x38BDF8,
  ELECTRO:  0xA855F7,
  AERO:     0x10B981,
  HAVOC:    0xEC4899,
  SPECTRO:  0xEAB308,
  NONE:     0x6366F1,
};

// Main interaction embed - pure GIF + narration, no loot
// Affinity rank thresholds
const AFFINITY_RANKS = [
  { score: 1000, label: "Resonant Soul"  },
  { score: 500,  label: "Deep Harmony"   },
  { score: 200,  label: "Warm Affinity"  },
  { score: 75,   label: "Familiar"       },
  { score: 20,   label: "Acquainted"     },
  { score: 0,    label: "Strangers"      },
];
function getAffinityRank(score: number) {
  return AFFINITY_RANKS.find((r) => score >= r.score) ?? AFFINITY_RANKS[AFFINITY_RANKS.length - 1];
}
function didRankUp(oldScore: number, newScore: number): string | null {
  const o = getAffinityRank(oldScore); const n = getAffinityRank(newScore);
  return o.label !== n.label ? n.label : null;
}

// Main interaction embed - pure GIF + narration, no loot
function buildEmbed(
  actorName:    string,
  actorAvatar:  string,
  actorElement: string,
  targetId:     string | null,
  targetName:   string | null,
  action:       ActionType,
  gifUrl:       string | null,
  flavorText:   string,
  isReturn:     boolean,
  affinityScore:  number | null = null,
  affinityBefore: number | null = null,
): EmbedBuilder {
  const meta  = ACTION_META[action];
  const color = ELEMENT_HEX[actorElement] ?? ELEMENT_HEX.NONE;
  const subject   = targetName ? `${actorName}  >  ${targetName}` : actorName;
  const verb      = isReturn ? (meta.selfVerb ?? meta.verb) : meta.verb;
  const mention   = targetId ? `<@${targetId}>` : null;
  const actionStr = isReturn ? (meta.selfVerb ?? meta.verb) : meta.verb;
  const actionLine = mention ? `**${actorName}** ${actionStr} ${mention}` : `**${actorName}** ${actionStr}`;
  let affinityLine = "";
  if (affinityScore !== null && affinityBefore !== null) {
    const rankUp = didRankUp(affinityBefore, affinityScore);
    if (rankUp) {
      affinityLine = `\n\n**Bond rank reached: ${rankUp}**`;
    } else {
      const rank = getAffinityRank(affinityScore);
      affinityLine = `\n${rank.label}  |  Synchrony **${affinityScore}**`;
    }
  }
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${subject}  .  ${verb}`, iconURL: actorAvatar })
    .setDescription(`${actionLine}\n*${flavorText}*${affinityLine}`)
    .setFooter({ text: "CARTETHYIA  .  Vibe Engine" });
  if (gifUrl) embed.setImage(gifUrl);
  return embed;
}

// ── Command definition ────────────────────────────────────────────────────────
const ALL_CHOICES = [...PHYSICAL_CHOICES, ...EXPRESSIVE_CHOICES, ...EMOTIONAL_CHOICES];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("vibe")
    .setDescription("Send an action or interact with someone.")
    .addStringOption((o) =>
      o.setName("action").setDescription("What to do").setRequired(true)
        .addChoices(...ALL_CHOICES)
    )
    .addUserOption((o) =>
      o.setName("target").setDescription("Who to direct this at (optional for some actions)").setRequired(false)
    ) as SlashCommandBuilder,

  // ── Execute ────────────────────────────────────────────────────────────────
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const action     = interaction.options.getString("action", true) as ActionType;
    const targetUser = interaction.options.getUser("target") ?? null;
    const meta       = ACTION_META[action];
    const group      = meta.category;

    // Physical actions require a target
    if (group === "physical" && !targetUser) {
      await interaction.editReply({ content: "❌ This action requires a target — mention someone!" });
      return;
    }

    // Block self-targeting on physical
    if (group === "physical" && targetUser?.id === interaction.user.id) {
      await interaction.editReply({ content: "❌ You can't do that to yourself!" });
      return;
    }

    // Block targeting bots
    if (targetUser?.bot) {
      await interaction.editReply({ content: "❌ Bots don't feel emotions (yet)." });
      return;
    }

    // Fetch actor's recent messages in this channel for AI context
    const recentMessages: string[] = [];
    try {
      if (interaction.channel && interaction.channel.isTextBased()) {
        const msgs = await interaction.channel.messages.fetch({ limit: 30 });
        msgs
          .filter((m) => m.author.id === interaction.user.id && m.content.length > 2)
          .first(4)
          .forEach((m) => recentMessages.push(m.content.slice(0, 80)));
      }
    } catch { /* no permissions — skip context */ }

    const actorAvatar = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    // Prefer server nickname → global display name → username
    const { GuildMember } = await import("discord.js");
    const actorDisplay  = interaction.member instanceof GuildMember
      ? interaction.member.displayName
      : interaction.user.displayName ?? interaction.user.username;

    const targetDisplay = targetUser
      ? (interaction.guild?.members.cache.get(targetUser.id)?.displayName
          ?? targetUser.displayName
          ?? targetUser.username)
      : null;

    // Ensure users exist in DB — also grab actor's element for embed theming
    const [actorUser] = await Promise.all([
      getOrCreateUser(interaction.user.id, actorDisplay, actorAvatar),
      targetUser
        ? getOrCreateUser(targetUser.id, targetDisplay ?? targetUser.username, targetUser.displayAvatarURL({ size: 128, extension: "png" }))
        : Promise.resolve(null),
    ]);

    // Fetch GIF + affinity in parallel
    const [gifUrl, affinityRecord] = await Promise.all([
      fetchGif(action),
      targetUser ? getAffinity(interaction.user.id, targetUser.id) : Promise.resolve(null),
    ]);

    const affinityScore = affinityRecord?.score ?? 0;

    // AI flavor text — uses display names so narration feels personal
    const flavorText = await generateInteractionFlavor(
      action,
      actorDisplay,
      targetDisplay,
      affinityScore,
      recentMessages
    );

    // Silently track playstyle for ability generation
    const vibeField = group === "physical"   ? "vibePhysicalCount"
                    : group === "expressive" ? "vibeExpressiveCount"
                    : "vibeEmotionalCount";
    await prisma.user.update({
      where: { id: interaction.user.id },
      data:  { [vibeField]: { increment: 1 } },
    }).catch(() => {});

    // Process rewards
    const loot = await processInteractionRewards(
      interaction.user.id,
      targetUser?.id ?? null,
      meta.category
    );

    // ── Public embed — clean, just GIF + narration ────────────────────────
    const embed = buildEmbed(
      actorDisplay,
      actorAvatar,
      actorUser.element,
      targetUser?.id ?? null,
      targetDisplay,
      action,
      gifUrl,
      flavorText,
      false,
      targetUser ? affinityScore + 10 : null,
      targetUser ? affinityScore : null,
    );

    const canReturn      = group === "physical" && targetUser !== null;
    const returnCustomId = `return_${action}_${interaction.user.id}_${targetUser?.id}`;

    const row = canReturn
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(returnCustomId)
            .setLabel(meta.returnLabel ?? "↩️ Return")
            .setStyle(ButtonStyle.Secondary)
        )
      : null;

    const reply = await interaction.editReply({
      embeds: [embed],
      components: row ? [row] : [],
    });

    // ── Ephemeral loot card — only actor sees this ─────────────────────────
    const elementHex = ["#FF6B35","#38BDF8","#A855F7","#10B981","#EC4899","#EAB308","#6366F1"];
    const elementKeys = ["FUSION","GLACIO","ELECTRO","AERO","HAVOC","SPECTRO","NONE"];
    const elIdx = elementKeys.indexOf(actorUser.element);
    const elHex = elIdx >= 0 ? elementHex[elIdx] : "#6366F1";

    const lootCardBuffer = await generateLootCard({
      loot,
      actorName:    interaction.user.username,
      elementColor: elHex,
      affinity:     targetUser ? affinityScore + 10 : null,
      isReturn:     false,
    });

    await interaction.followUp({
      files: [new AttachmentBuilder(lootCardBuffer, { name: "yield.png" })],
      flags: 64,
    });

    // ── Action Chain ──────────────────────────────────────────────────────
    if (!canReturn || !targetUser) return;

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (btn) => btn.customId === returnCustomId && btn.user.id === targetUser.id,
      time: 5 * 60 * 1000,
      max: 1,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      const [returnGif, returnAffinity] = await Promise.all([
        fetchGif(action),
        getAffinity(interaction.user.id, targetUser.id),
      ]);

      const returnerDisplay = btn.guild?.members.cache.get(targetUser.id)?.displayName
        ?? targetUser.displayName ?? targetUser.username;

      const returnFlavorText = await generateInteractionFlavor(
        action,
        returnerDisplay,
        actorDisplay,
        (returnAffinity?.score ?? 0) + 20
      );

      const returnLootActor  = rollLoot(meta.category, true);
      const returnLootTarget = rollLoot(meta.category, true);
      const { applyLoot }    = await import("../../lib/loot");

      const [targetDbUser] = await Promise.all([
        prisma.user.findUnique({ where: { id: targetUser.id }, select: { element: true } }),
        applyLoot(targetUser.id, returnLootActor),
        applyLoot(interaction.user.id, returnLootTarget),
        incrementAffinity(interaction.user.id, targetUser.id, 20),
      ]);

      const newAffinity = (returnAffinity?.score ?? 0) + 20;

      // Edit original public message
      const returnEmbed = buildEmbed(
        returnerDisplay,
        btn.user.displayAvatarURL({ size: 128, extension: "png" }),
        targetDbUser?.element ?? "NONE",
        interaction.user.id,
        actorDisplay,
        action,
        returnGif,
        returnFlavorText,
        true,
        newAffinity,
        (returnAffinity?.score ?? 0),
      );

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(returnCustomId)
          .setLabel("✅ Returned!")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );

      await btn.editReply({ embeds: [returnEmbed], components: [disabledRow] });

      // Ephemeral loot card for the returner (User B)
      const tElIdx = elementKeys.indexOf(targetDbUser?.element ?? "NONE");
      const tElHex = tElIdx >= 0 ? elementHex[tElIdx] : "#6366F1";
      const returnCardBuffer = await generateLootCard({
        loot:         returnLootActor,
        actorName:    targetUser.username,
        elementColor: tElHex,
        affinity:     newAffinity,
        isReturn:     true,
      });

      await btn.followUp({
        files: [new AttachmentBuilder(returnCardBuffer, { name: "yield.png" })],
        flags: 64,
      });
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") await reply.edit({ components: [] }).catch(() => {});
    });
  },
};

export default command;
