import prisma from "./prisma";

export async function mailNudge(userId: string, userCreatedAt?: Date): Promise<string> {
  const now = new Date();

  let createdAt = userCreatedAt;
  if (!createdAt) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    if (!u) return "";
    createdAt = u.createdAt;
  }

  const [globalCount, personalCount] = await Promise.all([
    prisma.mail.count({
      where: {
        AND: [
          { targetUserId: null },
          { sentAt: { gt: createdAt } },
          { claims: { none: { userId } } },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
    }),
    prisma.mail.count({
      where: {
        AND: [
          { targetUserId: userId },
          { claims: { none: { userId } } },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
    }),
  ]);

  const total = globalCount + personalCount;
  if (total === 0) return "";
  return `\n-# 📬 You have **${total} mail${total > 1 ? "s" : ""}** with unclaimed rewards — \`/mail\` to open.`;
}
