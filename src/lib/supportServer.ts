import { Client } from "discord.js";

// The main/support server — CLAUDE.md refers to this as "Eureka Society".
// Same fallback pattern as guildMemberAdd.ts.
export const MAIN_GUILD_ID   = process.env.MAIN_GUILD_ID   ?? "1516679873438027776";
export const DRIFTER_ROLE_ID = process.env.DRIFTER_ROLE_ID ?? "1516691155104829523";

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

// Was declared (guildMemberAdd.ts) but never actually assigned anywhere — nobody
// ever got this role. Grants it if the user is a support-server member and doesn't
// already have it. Fetches the member from the main guild directly since /start
// can run in any guild the bot is in, not just the support server.
// Requires the bot's own role to sit ABOVE this role in the support server's role
// list — if that's not the case, .roles.add() throws and this silently returns false.
export async function grantDrifterRole(client: Client, userId: string): Promise<boolean> {
  const guild = client.guilds.cache.get(MAIN_GUILD_ID);
  if (!guild) return false;
  try {
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
    if (member.roles.cache.has(DRIFTER_ROLE_ID)) return false;
    await member.roles.add(DRIFTER_ROLE_ID);
    return true;
  } catch (err) {
    console.error("[supportServer] grantDrifterRole failed:", err);
    return false;
  }
}
