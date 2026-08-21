import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  Client,
  Collection,
} from "discord.js";

export interface Command {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export interface ExtendedClient extends Client {
  commands: Collection<string, Command>;
}
