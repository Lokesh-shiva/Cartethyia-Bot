import "dotenv/config";
import prisma from "../src/lib/prisma";
import { awardUser } from "../src/lib/economy";

const USERS = [
  "1400767611746128005", // Adityaa (nyssa_editzz) — voted but got wrong ID
];

async function main() {
  for (const userId of USERS) {
    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) {
      console.log(`[skip] ${userId} — no account`);
      continue;
    }
    await awardUser(userId, { credits: 1000, fractureKeys: 1 });
    await prisma.user.update({ where: { id: userId }, data: { lastVoted: new Date() } });
    console.log(`[done] ${userId} — granted 1000cr + 1fk`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
