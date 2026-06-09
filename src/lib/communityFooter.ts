const MAIN_GUILD_ID = process.env.GUILD_ID ?? "1495681992082194432";
const COMMUNITY_URL = "discord.gg/HwkdQbN3Ec";

/**
 * Returns a footer object for embeds in non-main servers, nudging users
 * toward the official community. Returns the default footer in main server.
 */
export function communityFooter(
  guildId: string | null | undefined,
  defaultText = "CARTETHYIA"
): { text: string } {
  if (guildId && guildId !== MAIN_GUILD_ID) {
    return { text: `${defaultText}  ·  Join the community → ${COMMUNITY_URL}` };
  }
  return { text: defaultText };
}
