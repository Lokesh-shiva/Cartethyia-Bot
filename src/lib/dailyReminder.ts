import { Client, EmbedBuilder } from "discord.js";
import prisma from "./prisma";

const pendingReminders = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleReminder(client: Client, userId: string, fireAt: Date): void {
  const existing = pendingReminders.get(userId);
  if (existing) clearTimeout(existing);

  const delay = fireAt.getTime() - Date.now();
  if (delay <= 0) return;

  const timer = setTimeout(async () => {
    pendingReminders.delete(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { dailyReminderEnabled: true },
    });
    if (!user?.dailyReminderEnabled) return;

    try {
      const discordUser = await client.users.fetch(userId);
      await discordUser.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFBBF24)
          .setTitle("◈  Daily Reset Ready")
          .setDescription("Your **Daily Rewards** are available! Use `/daily` to claim.")
          .setFooter({ text: "CARTETHYIA  ·  Daily Reminder  ·  /daily to disable" })],
      });
    } catch {
      // DMs disabled — nothing we can do
    }
  }, delay);

  pendingReminders.set(userId, timer);
}

export function clearReminder(userId: string): void {
  const t = pendingReminders.get(userId);
  if (t) { clearTimeout(t); pendingReminders.delete(userId); }
}

// Restore pending reminders on bot restart
export async function rescheduleOnReady(client: Client): Promise<void> {
  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const users  = await prisma.user.findMany({
    where:  { dailyReminderEnabled: true, lastDaily: { gte: cutoff } },
    select: { id: true, lastDaily: true },
  });

  for (const u of users) {
    if (!u.lastDaily) continue;
    scheduleReminder(client, u.id, new Date(u.lastDaily.getTime() + 20 * 60 * 60 * 1000));
  }

  if (users.length > 0) {
    console.log(`[DailyReminder] Rescheduled ${users.length} pending reminder(s).`);
  }
}
