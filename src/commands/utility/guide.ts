import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { GUIDE_SECTIONS, C } from "../../lib/guide";
import { communityFooter } from "../../lib/communityFooter";

// Discord select menus hard-cap at 25 options. GUIDE_SECTIONS has grown past
// that, so the topic picker pages — PAGE_SIZE leaves one slot per page for a
// "More topics" / "Back" nav option instead of a real topic.
const PAGE_SIZE = 24;
const NEXT_PAGE_VALUE = "__next_page__";
const PREV_PAGE_VALUE = "__prev_page__";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("guide")
    .setDescription("Full CARTETHYIA guide — every system explained.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const entries = Object.entries(GUIDE_SECTIONS);
    const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));

    const topicList = entries
      .map(([, s]) => `${s.emoji}  **${s.label}** — ${s.description}`)
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

    const buildRow = (page: number) => {
      const start = page * PAGE_SIZE;
      const pageEntries = entries.slice(start, start + PAGE_SIZE);
      const options = pageEntries.map(([value, s]) => ({
        label:       `${s.emoji}  ${s.label}`,
        description: s.description,
        value,
      }));
      if (page > 0) options.push({ label: "⬅️  Back", description: "Previous page of topics", value: PREV_PAGE_VALUE });
      if (start + PAGE_SIZE < entries.length) options.push({ label: "➡️  More Topics", description: "Next page of topics", value: NEXT_PAGE_VALUE });

      const select = new StringSelectMenuBuilder()
        .setCustomId("guide_cmd_select")
        .setPlaceholder(pageCount > 1 ? `Choose a topic to read… (page ${page + 1}/${pageCount})` : "Choose a topic to read…")
        .addOptions(options);
      return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    };

    let currentPage = 0;
    await interaction.editReply({ embeds: [overview], components: [buildRow(currentPage)] });

    const collector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId === "guide_cmd_select",
      time:   5 * 60 * 1000,
    });

    collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
      const value = sel.values[0];
      if (value === NEXT_PAGE_VALUE) {
        currentPage = Math.min(pageCount - 1, currentPage + 1);
        await sel.update({ components: [buildRow(currentPage)] }).catch(() => {});
        return;
      }
      if (value === PREV_PAGE_VALUE) {
        currentPage = Math.max(0, currentPage - 1);
        await sel.update({ components: [buildRow(currentPage)] }).catch(() => {});
        return;
      }
      const section = GUIDE_SECTIONS[value];
      if (!section) { await sel.deferUpdate().catch(() => {}); return; }
      // Update the main message to show the selected section, keep the menu
      await sel.update({ embeds: [section.embed()], components: [buildRow(currentPage)] }).catch(() => {});
    });

    collector?.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
