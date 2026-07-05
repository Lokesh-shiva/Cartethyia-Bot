import { Client } from "discord.js";

// The main/support server — CLAUDE.md refers to this as "Eureka Society".
// Same fallback pattern as guildMemberAdd.ts.
export const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID ?? "1516679873438027776";

// Checked at low-frequency touchpoints only (onboarding, /daily) — never per-message.
export async function isMemberOfSupportServer(client: Client, userId: string): Promise<boolean> {
  const guild = client.guilds.cache.get(MAIN_GUILD_ID);
  if (!guild) return false;
  if (guild.members.cache.has(userId)) return true;
  try {
    await guild.members.fetch(userId);
    return true;
  } catch {
    return false;
  }
}
