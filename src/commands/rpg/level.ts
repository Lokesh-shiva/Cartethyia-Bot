import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { expProgressBar, WORLD_LEVEL_CAPS, expToNextLevel } from "../../lib/progression";
import { resolvePlayerBonuses, applyBonuses } from "../../lib/setBonus";
import { generateLevelCard } from "../../lib/levelCard";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("View your resonance level and EXP progress.")
    .addUserOption((o) =>
      o.setName("user").setDescription("Check another player's level.").setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target      = interaction.options.getUser("user") ?? interaction.user;
    const avatarUrl   = target.displayAvatarURL({ size: 128, extension: "png" });
    const displayName = interaction.guild?.members.cache.get(target.id)?.displayName
      ?? target.displayName ?? target.username;

    const user    = await getOrCreateUser(target.id, displayName, avatarUrl);
    const color   = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
    const prog    = expProgressBar(user.resonanceExp, user.level, user.worldLevel);
    const bonuses = await resolvePlayerBonuses(target.id);
    const stats   = applyBonuses(user, bonuses);

    const cardBuffer = await generateLevelCard({
      displayName,
      avatarUrl,
      level:        user.level,
      worldLevel:   user.worldLevel,
      element:      user.element,
      resonanceExp: prog.current,
      expNeeded:    prog.needed,
      expPercent:   prog.percent,
      isCapped:     prog.capped,
      hp:           stats.hp,
      atk:          stats.atk,
      def:          stats.def,
      critRate:     stats.critRate,
      critDmg:      stats.critDmg,
    });

    const attachment = new AttachmentBuilder(cardBuffer, { name: "level.png" });

    const embed = new EmbedBuilder()
      .setColor(color)
      .setImage("attachment://level.png")
      .setFooter({ text: `CARTETHYIA  ·  ${displayName}'s Resonance Level` });

    await interaction.editReply({ embeds: [embed], files: [attachment] });
  },
};

export default command;
