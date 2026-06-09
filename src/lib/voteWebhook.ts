import express from "express";
import { Webhook, WebhookPayload } from "@top-gg/sdk";
import { Client } from "discord.js";
import { awardUser } from "./economy";
import { CE } from "./emojiManager";
import prisma from "./prisma";

const TOPGG_WEBHOOK_AUTH = process.env.TOPGG_WEBHOOK_AUTH ?? "";
const WEBHOOK_PORT       = parseInt(process.env.WEBHOOK_PORT ?? "3000", 10);

// Weekend = Saturday (6) or Sunday (0)
function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

export function startVoteWebhook(client: Client) {
  if (!TOPGG_WEBHOOK_AUTH) {
    console.log("⚠️  TOPGG_WEBHOOK_AUTH not set — vote webhook disabled.");
    return;
  }

  const app     = express();
  const webhook = new Webhook(TOPGG_WEBHOOK_AUTH);

  app.post("/topgg-vote", webhook.listener(async (vote: WebhookPayload) => {
    const userId  = vote.user;
    const weekend = isWeekend();

    const rewards = {
      credits:     weekend ? 2000 : 1000,
      fractureKeys: weekend ? 2 : 1,
    };

    // Record the vote time & grant rewards
    try {
      await Promise.all([
        awardUser(userId, rewards),
        prisma.user.update({
          where: { id: userId },
          data:  { lastVoted: new Date() },
        }).catch(() => {}), // user might not be registered yet
      ]);

      // Try to DM the user
      const weekendTag = weekend ? "  *(Weekend ×2!)*" : "";
      const dmMsg =
        `## ✅  Vote received — thank you!\n` +
        `Your support helps Cartethyia grow.\n\n` +
        `**Rewards${weekendTag}:**\n` +
        `${CE.cr} **${rewards.credits}** Credits\n` +
        `${CE.fk} **${rewards.fractureKeys}** Fracture Key${rewards.fractureKeys !== 1 ? "s" : ""}\n\n` +
        `Vote again in **12 hours** at <https://top.gg/bot/1510163339177623642/vote>`;

      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        const dm = await user.createDM().catch(() => null);
        if (dm) await dm.send(dmMsg).catch(() => {});
      }

      console.log(`[vote] ${userId} voted — awarded ${rewards.credits}cr + ${rewards.fractureKeys}fk (weekend=${weekend})`);
    } catch (e) {
      console.error("[vote] Failed to process vote for", userId, e);
    }
  }));

  app.listen(WEBHOOK_PORT, () => {
    console.log(`🗳️  Vote webhook listening on port ${WEBHOOK_PORT}`);
  });
}
