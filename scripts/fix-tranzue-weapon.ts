import "dotenv/config";
import prisma from "../src/lib/prisma";

// Correct capped values: registry max × 1.3 (evolved weapon)
const FIXED_EFFECTS = [
  { type: "FIRST_STRIKE", value: 0.91  }, // Opening Gambit  (0.70 × 1.3)
  { type: "CRIT_DMG",     value: 0.39  }, // Lethal Edge     (0.30 × 1.3)
  { type: "ESCALATION",   value: 0.156 }, // Rising Tempo    (0.12 × 1.3)
  { type: "ULT_POWER",    value: 0.52  }, // Cataclysm       (0.40 × 1.3)
  { type: "ATK_BOOST",    value: 0.234 }, // Empowered Strikes (0.18 × 1.3)
  { type: "VIB_BREAKER",  value: 0.78  }, // Shatterpoint    (0.60 × 1.3)
];

async function main() {
  const TRANZUE_ID = "979379636586819746";

  const weapon = await prisma.weapon.findFirst({
    where: { userId: TRANZUE_ID, awakened: true },
    select: { id: true, name: true, awakenedName: true, awakenedPassive: true },
  });

  if (!weapon) {
    console.log("No awakened weapon found for Tranzue.");
    return;
  }

  const ap = weapon.awakenedPassive as any;
  console.log("Found:", weapon.awakenedName ?? weapon.name);
  console.log("Current effects:", JSON.stringify(ap?.effects, null, 2));

  const updated = { ...ap, effects: FIXED_EFFECTS };

  await prisma.weapon.update({
    where: { id: weapon.id },
    data:  { awakenedPassive: updated },
  });

  console.log("✅ Fixed. New effects:", JSON.stringify(FIXED_EFFECTS, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
