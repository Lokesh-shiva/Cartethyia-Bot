import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { generateLootCard } from "../../lib/lootCard";
import { checkLevelUp } from "../../lib/progression";
import prisma from "../../lib/prisma";
import { scheduleReminder, clearReminder } from "../../lib/dailyReminder";

const ELEMENT_HEX: Record<string, string> = {
  FUSION: "#FF6B35", GLACIO: "#38BDF8", ELECTRO: "#A855F7",
  AERO:   "#10B981", HAVOC:  "#EC4899", SPECTRO: "#EAB308", NONE: "#6366F1",
};

// Streak milestones → bonus multiplier
function streakBonus(streak: number): number {
  if (streak >= 30) return 3.0;
  if (streak >= 14) return 2.0;
  if (streak >= 7)  return 1.5;
  if (streak >= 3)  return 1.25;
  return 1.0;
}

function streakLabel(streak: number): string {
  if (streak >= 30) return "🔥🔥🔥 30-Day Devotion";
  if (streak >= 14) return "🔥🔥 2-Week Resonance";
  if (streak >= 7)  return "🔥 Weekly Surge";
  if (streak >= 3)  return "⚡ 3-Day Streak";
  return "";
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily Resonance rewards."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const avatarUrl  = interaction.user.displayAvatarURL({ size: 128, extension: "png" });
    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;

    const user = await getOrCreateUser(interaction.user.id, displayName, avatarUrl) as any;

    // Check cooldown — 20 hours (allows slight flexibility)
    const now      = Date.now();
    const lastDaily = (user as any).lastDaily as Date | null;
    const cooldown  = 20 * 60 * 60 * 1000;

    if (lastDaily && now - lastDaily.getTime() < cooldown) {
      const remaining = cooldown - (now - lastDaily.getTime());
      const hrs  = Math.floor(remaining / 3_600_000);
      const mins = Math.floor((remaining % 3_600_000) / 60_000);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x334155)
            .setAuthor({ name: `${displayName}  ·  Daily Rewards`, iconURL: avatarUrl })
            .setDescription(`You already claimed today.\nCome back in **${hrs}h ${mins}m**.`)
            .setFooter({ text: "CARTETHYIA  ·  Daily System" }),
        ],
      });
      return;
    }

    // Streak logic — 44h window. If missed, check for streak shield
    const withinWindow  = lastDaily && now - lastDaily.getTime() < 44 * 3_600_000;
    const currentStreak = (user as any).dailyStreak as number ?? 0;
    const shields       = (user as any).streakShields as number ?? 0;
    let shieldUsed      = false;

    let streak: number;
    if (withinWindow) {
      streak = currentStreak + 1;
    } else if (shields > 0 && currentStreak > 0) {
      // Use a streak shield to preserve streak
      streak     = currentStreak + 1;
      shieldUsed = true;
      await prisma.user.update({
        where: { id: interaction.user.id },
        data:  { streakShields: { decrement: 1 } },
      });
    } else {
      streak = 1; // reset
    }

    const multiplier = streakBonus(streak);

    // Base rewards — scale gently with level
    const base = {
      credits:       Math.floor((100 + user.level * 5) * multiplier),
      resonanceExp:  Math.floor((30  + user.level * 2) * multiplier),
      tuningModules: streak >= 3  ? Math.floor(1 * multiplier) : 0,
      sealingTubes:  streak >= 7  ? 1 : 0,
      forgingOres:   streak >= 7  ? 1 : 0,
      lunakite:      streak >= 14 ? 1 : 0,
      streakShield:  streak % 7 === 0, // get a shield every 7 days
    };

    // Write to DB
    await prisma.user.update({
      where: { id: interaction.user.id },
      data:  {
        credits:          { increment: base.credits       },
        resonanceExp:     { increment: base.resonanceExp  },
        tuningModules:    { increment: base.tuningModules },
        sealingTubes:     { increment: base.sealingTubes  },
        forgingOres:      { increment: base.forgingOres   },
        lunakite:         { increment: base.lunakite      },
        streakShields:    base.streakShield ? { increment: 1 } : undefined,
        lastDaily:        new Date(),
        dailyStreak:      streak,
      } as any,
    });

    await checkLevelUp(interaction.user.id);

    // Loot card
    const lootResult = {
      credits:       base.credits,
      resonanceExp:  base.resonanceExp,
      tuningModules: base.tuningModules,
      sealingTubes:  base.sealingTubes,
      forgingOres:   base.forgingOres,
      paradoxCores:     0,
      stasisLocks:      0,
      resonanceRecords: 0,
      isMultiplied:     multiplier > 1,
    };

    const elHex  = ELEMENT_HEX[user.element] ?? "#6366F1";
    const card   = await generateLootCard({
      loot:         lootResult,
      actorName:    displayName,
      elementColor: elHex,
      affinity:     null,
      isReturn:     false,
    });

    const attachment = new AttachmentBuilder(card, { name: "daily.png" });
    const sLabel = streakLabel(streak);
    const shieldLine = shieldUsed
      ? `\n🛡️ *Streak Shield used — streak preserved!*`
      : base.streakShield
      ? `\n🛡️ **Streak Shield earned!** Protects your streak if you miss a day.`
      : "";

    const embed = new EmbedBuilder()
      .setColor(parseInt(elHex.slice(1), 16))
      .setAuthor({ name: `${displayName}  ·  Daily Rewards`, iconURL: avatarUrl })
      .setDescription([
        sLabel ? `${sLabel}  ·  **${streak}-day streak**` : `Day **${streak}**`,
        multiplier > 1 ? `\n◈  **${multiplier}×** multiplier active` : "",
        shieldLine,
        shields > 0 && !shieldUsed ? `\n🛡️ Shields remaining: **${shields}**` : "",
      ].filter(Boolean).join(""))
      .setImage("attachment://daily.png")
      .setFooter({ text: "CARTETHYIA  ·  Come back tomorrow to keep your streak!" });

    // Reminder toggle button
    const reminderEnabled = (user as any).dailyReminderEnabled as boolean ?? false;
    const reminderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("daily_reminder_toggle")
        .setLabel(reminderEnabled ? "🔕  Disable Daily Reminder" : "🔔  Remind Me Tomorrow")
        .setStyle(reminderEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary),
    );

    await interaction.editReply({ embeds: [embed], files: [attachment], components: [reminderRow] });

    // Schedule or clear reminder
    const fireAt = new Date(Date.now() + 20 * 60 * 60 * 1000);
    if (reminderEnabled) scheduleReminder(interaction.client, interaction.user.id, fireAt);

    // Handle toggle (60s window, multiple clicks allowed)
    let currentEnabled = reminderEnabled;

    const collector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (b: ButtonInteraction) => b.user.id === interaction.user.id && b.customId === "daily_reminder_toggle",
      time:   60_000,
    });

    collector?.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();
      currentEnabled = !currentEnabled;

      await prisma.user.update({
        where: { id: interaction.user.id },
        data:  { dailyReminderEnabled: currentEnabled } as any,
      });

      if (currentEnabled) {
        scheduleReminder(btn.client, interaction.user.id, fireAt);
      } else {
        clearReminder(interaction.user.id);
      }

      await btn.editReply({
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("daily_reminder_toggle")
            .setLabel(currentEnabled ? "🔕  Disable Daily Reminder" : "🔔  Remind Me Tomorrow")
            .setStyle(currentEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary),
        )],
      });
    });

    collector?.on("end", () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
