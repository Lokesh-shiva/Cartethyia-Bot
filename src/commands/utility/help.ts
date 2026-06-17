import { SlashCommandBuilder } from "discord.js";
import guide from "./guide";
import { Command } from "../../types";

// Alias for /guide
const command: Command = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Full CARTETHYIA guide — every system explained.") as SlashCommandBuilder,
  execute: guide.execute,
};

export default command;
