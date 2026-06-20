import "dotenv/config";
import prisma from "../src/lib/prisma";

async function main() {
  const result = await prisma.guildSettings.upsert({
    where:  { guildId: "1410663578624725045" },
    update: { welcomeChannelId: "1516679873438027776" },
    create: { guildId: "1410663578624725045", welcomeChannelId: "1516679873438027776" },
  });
  console.log("Done:", result.guildId, "→ welcomeChannelId =", result.welcomeChannelId);
}

main().catch(console.error).finally(() => prisma.$disconnect());
