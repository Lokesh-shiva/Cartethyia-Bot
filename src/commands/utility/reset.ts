import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { isOwner } from "../../lib/owner";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("reset")
    .setDescription("⚠️ Dev only — reset an account to a fresh state.")
    .setDefaultMemberPermissions(0)
    .addUserOption((o) =>
      o.setName("user")
        .setDescription("User to reset (defaults to yourself).")
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "❌ You don't have permission to use this.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const target = interaction.options.getUser("user") ?? interaction.user;
    const targetName = interaction.guild?.members.cache.get(target.id)?.displayName
      ?? target.username;

    await prisma.user.update({
      where: { id: target.id },
      data: {
        level:              1,
        worldLevel:         0,
        resonanceExp:       0,
        element:            "NONE",
        weaponType:         null,
        baseHp:             500,
        baseAtk:            50,
        baseDef:            30,
        baseSpeed:          100,
        critRate:           0.05,
        critDmg:            1.5,
        energy:             0,
        credits:            0,
        lunakite:           0,
        tuningModules:      0,
        sealingTubes:       0,
        forgingOres:        0,
        paradoxCores:       0,
        stasisLocks:        0,
        resonanceRecords:   0,
        lastDaily:          null,
        dailyStreak:        0,
        isOnboarded:        false,
        resonanceProfile:   undefined,
        uniqueAbilityName:  null,
        uniqueAbilityEffect:null,
        uniqueAbilityLore:  null,
        uniqueAbilityType:  null,
        uniqueAbilityValue: null,
        uniqueAbilityEffects: undefined,
        vibePhysicalCount:  0,
        vibeExpressiveCount:0,
        vibeEmotionalCount: 0,
        uniqueTargetCount:  0,
        duelWins:           0,
        duelLosses:         0,
        dungeonClears:      0,
        raidWins:           0,
        ascensionWins:      0,
        encountersWon:      0,
        dispatchStatus:     "IDLE",
        dispatchEndsAt:     null,
        dispatchHours:      null,
      },
    });

    // Also delete echoes, weapons, and dungeon cooldowns
    await prisma.echo.deleteMany({ where: { userId: target.id } });
    await prisma.weapon.deleteMany({ where: { userId: target.id } });
    await prisma.dungeonCooldown.deleteMany({ where: { userId: target.id } });

    const isSelf = target.id === interaction.user.id;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xEF4444)
          .setTitle("⚠️ Account Reset")
          .setDescription(
            isSelf
              ? `Your account has been wiped back to a fresh Drifter.\nUse **/start** to go through onboarding again.`
              : `**${targetName}**'s account has been wiped back to a fresh Drifter.`
          )
          .setFooter({ text: "CARTETHYIA  ·  Dev Tool" }),
      ],
    });
  },
};

export default command;
