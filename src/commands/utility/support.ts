import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { Command } from "../../types";
import { PATREON_URL, KOFI_URL } from "../../lib/voteNudge";

const TOPGG_URL   = "https://top.gg/bot/1510163339177623642/vote";
const DBL_URL     = "https://discordbotlist.com/bots/cartethyia/upvote";
const RANKTOP_URL = "https://rank.top/bot/cartethyia";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("support")
    .setDescription("Support CARTETHYIA — vote links and Patreon tiers."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xFCD34D)
        .setTitle("✦  Support CARTETHYIA")
        .setDescription(
          `CARTETHYIA is free to play and kept alive by its community.\n` +
          `Here's how you can help:\n\n` +

          `**🗳️ Free — Vote Daily**\n` +
          `Voting takes 10 seconds and earns you **Credits + Fractonite** each time.\n` +
          `[top.gg](${TOPGG_URL})  ·  [discordbotlist.com](${DBL_URL})  ·  [rank.top](${RANKTOP_URL})\n\n` +

          `**✦ Patreon — Monthly Bundles + Perks**\n` +
          `[patreon.com/Cartethyia_bot](${PATREON_URL})\n\n` +
          `> **Attuned** — $3/mo\n` +
          `> 2 Lunakite · 80 Fractonite\n\n` +
          `> **Ascendant** — $5/mo\n` +
          `> 5 Lunakite · 200 Fractonite · 1 Aura Prism · Aura cap +1 (→6)\n\n` +
          `> **Calamity** — $10/mo\n` +
          `> 12 Lunakite · 500 Fractonite · 3 Aura Prisms · Aura cap +3 (→8)\n\n` +

          `**✦ Ko-fi — One-Time Bundles**\n` +
          `[ko-fi.com/cartethyiabot](${KOFI_URL})\n` +
          `One-time Lunakite/Fractonite packs — see \`/patron bundles\` for the full list.\n\n` +
          `*Already pledged or bought a bundle? Use \`/patron redeem <code>\` with the code sent to you.*`
        )
        .setFooter({ text: "CARTETHYIA  ·  Every vote and pledge genuinely helps. Thank you." })],
      flags: 64,
    });
  },
};

export default command;
