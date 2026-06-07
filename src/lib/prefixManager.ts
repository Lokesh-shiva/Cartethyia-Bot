import prisma from "./prisma";

// Default prefix for every guild — overridable per-guild via /setup prefix.
// Stored as "c" in DB (setup strips trailing !); the messageCreate handler
// always strips a leading ! from the remainder, so "c" matches "c!ping" → "ping".
export const GLOBAL_PREFIX = process.env.BOT_PREFIX ?? "c";

// guildId → prefix (null = use GLOBAL_PREFIX)
const prefixCache = new Map<string, string | null>();

/**
 * Returns the effective prefix for a guild.
 * Falls back to the global default (c!) if none has been set.
 */
export function getPrefix(guildId: string): string {
  const cached = prefixCache.get(guildId);
  // null means "explicitly cleared" or "never set" — both fall back to global
  return cached ?? GLOBAL_PREFIX;
}

export function setPrefix(guildId: string, prefix: string | null): void {
  prefixCache.set(guildId, prefix);
}

export async function loadAllPrefixes(): Promise<void> {
  const all = await prisma.guildSettings.findMany({ select: { guildId: true, prefix: true } });
  for (const s of all) {
    prefixCache.set(s.guildId, s.prefix ?? null);
  }
}

export async function savePrefixToDb(guildId: string, prefix: string | null): Promise<void> {
  await prisma.guildSettings.upsert({
    where:  { guildId },
    create: { guildId, prefix },
    update: { prefix },
  });
  prefixCache.set(guildId, prefix);
}
