import { Events, GuildChannel } from "discord.js";

export const name = Events.ChannelCreate;
export const once = false;

export async function execute(channel: GuildChannel) {
  // Fetching the channel adds it to the client cache, making it visible
  // in slash command channel dropdowns without needing a bot restart.
  await channel.fetch().catch(() => {});
}
