import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
  EmbedBuilder,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { generateProfileCard } from "../../lib/canvas";
import { isOwner } from "../../lib/owner";
import path from "path";
import fs from "fs";

const ELEMENTS = ["NONE", "FUSION", "GLACIO", "ELECTRO", "AERO", "HAVOC", "SPECTRO"];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("debugprofile")
    .setDescription("🛠️ Preview the profile card for any element background.")
    .setDefaultMemberPermissions(0)
    .addStringOption((opt) =>
      opt
        .setName("element")
        .setDescription("Which element background to preview")
        .setRequired(true)
        .addChoices(
          { name: "🔥 Fusion",   value: "FUSION"  },
          { name: "❄️ Glacio",   value: "GLACIO"  },
          { name: "⚡ Electro",  value: "ELECTRO" },
          { name: "🌪️ Aero",    value: "AERO"    },
          { name: "🌑 Havoc",   value: "HAVOC"   },
          { name: "✨ Spectro",  value: "SPECTRO" },
          { name: "⚪ None / Default", value: "NONE" }
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: "❌ Owner only.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const element = interaction.options.getString("element", true);
    const avatarUrl = interaction.user.displayAvatarURL({ size: 256, extension: "png" });

    const user = await getOrCreateUser(
      interaction.user.id,
      interaction.user.username,
      avatarUrl
    );

    // Check which background file exists for this element
    const bgDir = path.join(process.cwd(), "assets", "backgrounds");
    const key = element.toLowerCase();
    const candidates = [
      `${key}.png`, `${key}.jpg`,
      `${key[0].toUpperCase() + key.slice(1)}.png`,
      "default.png", "Default.png", "default.jpg",
    ];

    let foundBg = "❌ None found (gradient fallback will be used)";
    for (const name of candidates) {
      if (fs.existsSync(path.join(bgDir, name))) {
        foundBg = `✅ \`assets/backgrounds/${name}\``;
        break;
      }
    }

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName;

    // Generate card with overridden element
    const buffer = await generateProfileCard({
      id: user.id, username: user.username, avatarUrl,
      element: user.element, level: user.level, worldLevel: user.worldLevel,
      resonanceExp: user.resonanceExp, baseHp: user.baseHp, baseAtk: user.baseAtk,
      baseDef: user.baseDef, baseSpeed: user.baseSpeed, critRate: user.critRate, critDmg: user.critDmg,
      credits: user.credits, lunakite: user.lunakite, paradoxCores: user.paradoxCores,
      resonanceAura: user.resonanceAura ?? 5,
      auraNextRegenMs: Infinity,
      uniqueAbilityName: user.uniqueAbilityName,
      displayName, bonds: [], echoes: [], weapon: null,
      overrideElement: element,
    });
    const attachment = new AttachmentBuilder(buffer, { name: "debug-profile.png" });

    const embed = new EmbedBuilder()
      .setColor(0x1E293B)
      .setTitle(`🛠️ Debug Preview — ${element}`)
      .setDescription(`**Background file:** ${foundBg}`)
      .addFields(
        {
          name: "All background files found",
          value: candidates
            .map((name) => {
              const exists = fs.existsSync(path.join(bgDir, name));
              return `${exists ? "✅" : "❌"} \`${name}\``;
            })
            .join("\n"),
        }
      )
      .setImage("attachment://debug-profile.png")
      .setFooter({ text: "Only visible to you • /debugprofile" });

    await interaction.editReply({ embeds: [embed], files: [attachment] });
  },
};

export default command;
