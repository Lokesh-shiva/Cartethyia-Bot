/**
 * One-time migration: recalculate baseHp / baseAtk / baseDef for every
 * existing player based on their current level, using the new per-level
 * growth values (HP+126, ATK+4, DEF+11) and new starting stats (HP 800,
 * ATK 40, DEF 50). Run once on the server after deploying this build.
 *
 * Usage: npx tsx scripts/migrate-stats.ts
 */

import prisma from "../src/lib/prisma";

const HP_START  = 800;
const ATK_START = 40;
const DEF_START = 50;
const HP_PER_LVL  = 126;
const ATK_PER_LVL = 4;
const DEF_PER_LVL = 11;

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, level: true } });
  console.log(`Migrating ${users.length} players…`);

  let updated = 0;
  for (const u of users) {
    const gained = Math.max(0, u.level - 1);
    await prisma.user.update({
      where: { id: u.id },
      data: {
        baseHp:  HP_START  + gained * HP_PER_LVL,
        baseAtk: ATK_START + gained * ATK_PER_LVL,
        baseDef: DEF_START + gained * DEF_PER_LVL,
      },
    });
    updated++;
    if (updated % 50 === 0) console.log(`  ${updated}/${users.length}`);
  }

  console.log(`Done — ${updated} players updated.`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
