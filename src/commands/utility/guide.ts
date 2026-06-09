import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { GUIDE_SECTIONS, C } from "../../lib/guide";
import { communityFooter } from "../../lib/communityFooter";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("guide")
    .setDescription("Full CARTETHYIA guide — every system explained.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const topicList = Object.values(GUIDE_SECTIONS)
      .map(s => `${s.emoji}  **${s.label}** — ${s.description}`)
      .join("\n");

    const overview = new EmbedBuilder()
      .setColor(C.primary)
      .setTitle("◈  CARTETHYIA — Player Guide")
      .setDescription(
        `Everything in the game, explained. **Select a topic** from the dropdown to read about it.\n` +
        `The menu stays open — browse as many topics as you like.\n\n` +
        `**Topics:**\n${topicList}`
      )
      .setFooter(communityFooter(interaction.guildId, "CARTETHYIA  ·  Player Guide  ·  Menu open for 5 minutes"));

    const select = new StringSelectMenuBuilder()
      .setCustomId("guide_cmd_select")
      .setPlaceholder("Choose a topic to read…")
      .addOptions(
        Object.entries(GUIDE_SECTIONS).map(([value, s]) => ({
          label:       `${s.emoji}  ${s.label}`,
          description: s.description,
          value,
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    await interaction.editReply({ embeds: [overview], components: [row] });

    const collector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId === "guide_cmd_select",
      time:   5 * 60 * 1000,
    });

    collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
      const section = GUIDE_SECTIONS[sel.values[0]];
      if (!section) { await sel.deferUpdate().catch(() => {}); return; }
      // Update the main message to show the selected section, keep the menu
      await sel.update({ embeds: [section.embed()], components: [row] }).catch(() => {});
    });

    collector?.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
