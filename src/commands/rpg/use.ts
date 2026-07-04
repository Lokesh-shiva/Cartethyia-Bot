import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType,
  TextChannel,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { auditSpend, auditAward } from "../../lib/antiCheat";
import { checkLevelUp, expToNextLevel, WORLD_LEVEL_CAPS, sendMilestoneNotifications } from "../../lib/progression";
import { sendElementSelection } from "../../lib/elementSelect";
import { computeAura, getMaxAura } from "../../lib/aura";
import { CE } from "../../lib/emojiManager";
import prisma from "../../lib/prisma";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

// Each Resonance Record grants a FIXED amount of EXP — meaningful early game,
// a smaller fraction of a level as you climb. (Previously 1 full level each,
// which made records absurdly strong at high levels.)
const EXP_PER_RECORD = 2500;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("use")
    .setDescription("Use a consumable item.")
    .addSubcommand((s) =>
      s.setName("record")
        .setDescription("Use Resonance Records to instantly gain EXP.")
        .addIntegerOption((o) =>
          o.setName("amount")
            .setDescription("How many records to use (default: 1).")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s.setName("fractonite")
        .setDescription("Convert 100 Fractonite into 1 Fracture Key.")
        .addIntegerOption((o) =>
          o.setName("amount")
            .setDescription("How many Fracture Keys to buy (default: 1).")
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s.setName("aura-prism")
        .setDescription("Use an Aura Prism to restore 3 Resonance Aura charges.")
        .addIntegerOption((o) =>
          o.setName("amount")
            .setDescription("How many prisms to use (default: 1).")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "record")     await handleRecord(interaction);
    if (sub === "fractonite") await handleFractonite(interaction);
    if (sub === "aura-prism") await handleAuraPrism(interaction);
  },
};

async function handleRecord(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const amount      = interaction.options.getInteger("amount") ?? 1;
  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName ?? interaction.user.username;
  const avatarUrl   = interaction.user.displayAvatarURL({ size: 64, extension: "png" });

  const user  = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
  const color = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
  const cap   = WORLD_LEVEL_CAPS[user.worldLevel] ?? 20;

  // Already at cap
  if (user.level >= cap) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x334155)
        .setAuthor({ name: `${displayName}  ·  Resonance Records`, iconURL: avatarUrl })
        .setDescription(`◈ You are at the **Level ${cap}** cap.\nComplete an **Ascension Trial** to increase your cap before using Records.`)
        .setFooter({ text: "CARTETHYIA  ·  Items" })],
    });
    return;
  }

  // Not enough records
  if (user.resonanceRecords < amount) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x334155)
        .setAuthor({ name: `${displayName}  ·  Resonance Records`, iconURL: avatarUrl })
        .setDescription(`◈ You only have **${user.resonanceRecords}** Resonance Record${user.resonanceRecords !== 1 ? "s" : ""}.\n\nEarn more from **/vibe**, level milestones, and **/bond** formation.`)
        .setFooter({ text: "CARTETHYIA  ·  Items" })],
    });
    return;
  }

  // Calculate total EXP gain
  const expGain  = EXP_PER_RECORD * amount;
  const needed   = expToNextLevel(user.level);
  const progress = Math.min(100, Math.round(((user.resonanceExp + expGain) / needed) * 100));

  // Preview embed
  const previewEmbed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${displayName}  ·  Resonance Records`, iconURL: avatarUrl })
    .setDescription([
      `Using **${amount}** Resonance Record${amount > 1 ? "s" : ""}`,
      ``,
      `◈  EXP Gain: **+${expGain.toLocaleString()}**  (${EXP_PER_RECORD.toLocaleString()} each)`,
      `◈  Progress toward Lv${user.level + 1}: **~${progress}%** after use`,
      `◈  Records remaining after: **${user.resonanceRecords - amount}**`,
      ``,
      `*Each record grants a fixed ${EXP_PER_RECORD.toLocaleString()} EXP.*`,
    ].join("\n"))
    .setFooter({ text: "CARTETHYIA  ·  Items  ·  Confirm to proceed" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("use_confirm").setLabel(`Use ${amount} Record${amount > 1 ? "s" : ""}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("use_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const msg = await interaction.editReply({ embeds: [previewEmbed], components: [row] });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.user.id === interaction.user.id,
    time:   30_000,
    max:    1,
  });

  collector.on("collect", async (btn) => {
    await btn.deferUpdate();

    if (btn.customId === "use_cancel") {
      await btn.editReply({ components: [] });
      return;
    }

    // Deduct records + add EXP
    await prisma.user.update({
      where: { id: interaction.user.id },
      data:  {
        resonanceRecords: { decrement: amount },
        resonanceExp:     { increment: expGain },
      },
    });
    auditSpend(interaction.user.id, { resonanceRecords: amount }, "use:record");
    auditAward(interaction.user.id, { resonanceExp: expGain }, "use:record").catch(() => {});

    // Check level ups + send milestone notifications (same as chat EXP path)
    const result = await checkLevelUp(interaction.user.id);
    const freshUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { resonanceExp: true, level: true, element: true },
    });

    if (result.didLevelUp) {
      await sendMilestoneNotifications(
        interaction.channel as TextChannel,
        result.oldLevel, result.newLevel, result.hitCapAt,
      );
    }

    // Trigger element selection if they hit level 20 without an element
    if (result.newLevel >= 20 && (!freshUser?.element || freshUser.element === "NONE")) {
      setTimeout(async () => {
        await sendElementSelection(
          interaction.user.id,
          displayName,
          interaction.channel as TextChannel
        );
      }, 1500);
    }

    const resultEmbed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${displayName}  ·  Resonance Records`, iconURL: avatarUrl })
      .setDescription([
        `✦ Used **${amount}** Resonance Record${amount > 1 ? "s" : ""}`,
        ``,
        `◈  **+${expGain.toLocaleString()}** Resonance EXP gained`,
        result.didLevelUp
          ? `◈  **Level Up!**  ${result.oldLevel} → **${result.newLevel}**`
          : `◈  EXP remaining to next level: **${(expToNextLevel(freshUser!.level) - freshUser!.resonanceExp).toLocaleString()}**`,
        result.hitCapAt
          ? `\n⚠️ You've hit the **Level ${result.hitCapAt}** cap — use **/ascend** to break through.`
          : "",
      ].filter(Boolean).join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Items" });

    await btn.editReply({ embeds: [resultEmbed], components: [] });
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") await interaction.editReply({ components: [] }).catch(() => {});
  });
}

async function handleFractonite(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const amount = interaction.options.getInteger("amount") ?? 1;
  const cost   = amount * 100;

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.guild?.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.username,
    interaction.user.displayAvatarURL({ size: 64, extension: "png" }),
  );
  const color = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;

  if (user.fractonite < cost) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`◈ Not enough Fractonite. Need **${cost}** — you have **${user.fractonite}**.`)
        .setFooter({ text: "CARTETHYIA  ·  Items" })],
    });
    return;
  }

  await prisma.user.update({
    where: { id: interaction.user.id },
    data:  { fractonite: { decrement: cost }, fractureKeys: { increment: amount } },
  });
  auditSpend(interaction.user.id, { fractonite: cost }, "use:fractonite");
  auditAward(interaction.user.id, { fractureKeys: amount }, "use:fractonite").catch(() => {});

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(color)
      .setDescription(
        `✦ Converted **${cost}** ${CE.ft} Fractonite → **${amount}** ${CE.fk} Fracture Key${amount !== 1 ? "s" : ""}.\n\n` +
        `Fractonite remaining: **${user.fractonite - cost}**`
      )
      .setFooter({ text: "CARTETHYIA  ·  Items" })],
  });
}

async function handleAuraPrism(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const amount = interaction.options.getInteger("amount") ?? 1;

  const user = await getOrCreateUser(
    interaction.user.id,
    interaction.guild?.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.username,
    interaction.user.displayAvatarURL({ size: 64, extension: "png" }),
  );
  const color = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;

  if ((user as any).auraPrisms < amount) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`◈ Not enough Aura Prisms. You have **${(user as any).auraPrisms ?? 0}**.`)
        .setFooter({ text: "CARTETHYIA  ·  Items" })],
    });
    return;
  }

  const maxAura  = getMaxAura((user as any).patronTier ?? 0);
  const auraState = computeAura((user as any).resonanceAura ?? 5, (user as any).auraUpdatedAt ?? new Date(), maxAura);
  const restore  = Math.min(amount * 3, maxAura - auraState.current);

  if (restore === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`◈ Your Resonance Aura is already full (**${auraState.current}/${maxAura}**).`)
        .setFooter({ text: "CARTETHYIA  ·  Items" })],
    });
    return;
  }

  const newAura = auraState.current + restore;
  // Only consume as many prisms as it actually took to fill the aura bar —
  // was previously decrementing the full requested `amount` even when `restore`
  // got clamped down near max aura, silently burning unused prisms.
  const prismsUsed = Math.ceil(restore / 3);
  await prisma.user.update({
    where: { id: interaction.user.id },
    data:  { auraPrisms: { decrement: prismsUsed }, resonanceAura: newAura, auraUpdatedAt: new Date() },
  });
  auditSpend(interaction.user.id, { auraPrisms: prismsUsed }, "use:aura-prism");

  const leftoverNote = prismsUsed < amount
    ? `\n-# Only **${prismsUsed}** of your requested ${amount} were needed — the rest stayed in your inventory.`
    : "";

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(color)
      .setDescription(
        `✦ Used **${prismsUsed}** ${CE.ap} Aura Prism${prismsUsed !== 1 ? "s" : ""} — restored **+${restore} ◈**.\n\n` +
        `Resonance Aura: **${newAura}/${maxAura}** ${"◈".repeat(newAura)}${"◇".repeat(maxAura - newAura)}${leftoverNote}`
      )
      .setFooter({ text: "CARTETHYIA  ·  Items" })],
  });
}

export default command;
