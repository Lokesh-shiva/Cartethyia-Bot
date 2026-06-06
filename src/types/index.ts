import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Client,
  Collection,
} from "discord.js";

export interface Command {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface ExtendedClient extends Client {
  commands: Collection<string, Command>;
}
