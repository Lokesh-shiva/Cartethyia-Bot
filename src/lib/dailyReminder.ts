import { Client, EmbedBuilder } from "discord.js";
import prisma from "./prisma";

const pendingReminders       = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPatronReminders = new Map<string, ReturnType<typeof setTimeout>>();

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

export function schedulePatronDailyReminder(client: Client, userId: string, fireAt: Date): void {
  const existing = pendingPatronReminders.get(userId);
  if (existing) clearTimeout(existing);

  const delay = fireAt.getTime() - Date.now();
  if (delay <= 0) return;

  const timer = setTimeout(async () => {
    pendingPatronReminders.delete(userId);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { dailyReminderEnabled: true, patronTier: true },
    });
    if (!user?.dailyReminderEnabled || user.patronTier === 0) return;

    try {
      const discordUser = await client.users.fetch(userId);
      await discordUser.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFCD34D)
          .setTitle("✦  Patron Daily Ready")
          .setDescription("Your **Patron Daily Pass** is ready to claim!\nUse `/patron daily` to collect your rewards.")
          .setFooter({ text: "CARTETHYIA  ·  Patron Reminder  ·  /patron daily to disable" })],
      });
    } catch {
      // DMs disabled
    }
  }, delay);

  pendingPatronReminders.set(userId, timer);
}

export function clearPatronDailyReminder(userId: string): void {
  const t = pendingPatronReminders.get(userId);
  if (t) { clearTimeout(t); pendingPatronReminders.delete(userId); }
}

// Restore pending reminders on bot restart
export async function rescheduleOnReady(client: Client): Promise<void> {
  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000);

  const [dailyUsers, patronUsers] = await Promise.all([
    prisma.user.findMany({
      where:  { dailyReminderEnabled: true, lastDaily: { gte: cutoff } },
      select: { id: true, lastDaily: true },
    }),
    prisma.user.findMany({
      where:  { dailyReminderEnabled: true, patronTier: { gt: 0 }, patronDailyClaimed: { gte: cutoff } },
      select: { id: true, patronDailyClaimed: true },
    }),
  ]);

  for (const u of dailyUsers) {
    if (!u.lastDaily) continue;
    scheduleReminder(client, u.id, new Date(u.lastDaily.getTime() + 20 * 60 * 60 * 1000));
  }

  for (const u of patronUsers) {
    if (!u.patronDailyClaimed) continue;
    schedulePatronDailyReminder(client, u.id, new Date(u.patronDailyClaimed.getTime() + 20 * 60 * 60 * 1000));
  }

  const total = dailyUsers.length + patronUsers.length;
  if (total > 0) {
    console.log(`[DailyReminder] Rescheduled ${dailyUsers.length} daily + ${patronUsers.length} patron-daily reminder(s).`);
  }
}
