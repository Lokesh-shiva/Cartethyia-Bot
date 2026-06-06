import prisma from "./prisma";

// guildId → prefix (null = disabled)
const prefixCache = new Map<string, string | null>();

export function getPrefix(guildId: string): string | null {
  return prefixCache.get(guildId) ?? null;
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
