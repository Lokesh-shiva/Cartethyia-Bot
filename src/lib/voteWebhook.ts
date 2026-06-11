import express from "express";
import { Client } from "discord.js";
import { awardUser } from "./economy";
import { CE } from "./emojiManager";
import prisma from "./prisma";

const DBL_WEBHOOK_AUTH = process.env.DBL_WEBHOOK_AUTH ?? "";
const WEBHOOK_PORT     = parseInt(process.env.WEBHOOK_PORT ?? "3000", 10);
const VOTE_URL         = "https://discordbotlist.com/bots/cartethyia/upvote";

function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

export function startVoteWebhook(client: Client) {
  if (!DBL_WEBHOOK_AUTH) {
    console.log("⚠️  DBL_WEBHOOK_AUTH not set — vote webhook disabled.");
    return;
  }

  const app = express();
  app.use(express.json());

  // Allow DBL's browser test button to reach this endpoint
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  app.post("/dbl-vote", (req, res) => {
    // Verify DBL authorization header
    if (req.headers.authorization !== DBL_WEBHOOK_AUTH) {
      res.sendStatus(401);
      return;
    }

    // DBL sends { id, username, avatar }
    const userId = req.body?.id as string | undefined;
    if (!userId) { res.sendStatus(400); return; }

    res.sendStatus(200); // ack immediately

    const weekend = isWeekend();
    const rewards = {
      credits:      weekend ? 2000 : 1000,
      fractureKeys: weekend ? 2    : 1,
    };

    (async () => {
      try {
        await Promise.all([
          awardUser(userId, rewards),
          prisma.user.update({
            where: { id: userId },
            data:  { lastVoted: new Date() },
          }).catch(() => {}),
        ]);

        const weekendTag = weekend ? "  *(Weekend ×2!)*" : "";
        const dmMsg =
          `## ✅  Upvote received — thank you!\n` +
          `Your support helps Cartethyia grow and reach more players.\n\n` +
          `**Rewards${weekendTag}:**\n` +
          `${CE.cr} **${rewards.credits}** Credits\n` +
          `${CE.fk} **${rewards.fractureKeys}** Fracture Key${rewards.fractureKeys !== 1 ? "s" : ""}\n\n` +
          `You can upvote again in **12 hours** — [click here](${VOTE_URL})`;

        const user = await client.users.fetch(userId).catch(() => null);
        if (user) {
          const dm = await user.createDM().catch(() => null);
          if (dm) await dm.send(dmMsg).catch(() => {});
        }

        console.log(`[vote] ${userId} upvoted — ${rewards.credits}cr + ${rewards.fractureKeys}fk (weekend=${weekend})`);
      } catch (e) {
        console.error("[vote] Failed to process upvote for", userId, e);
      }
    })();
  });

  app.listen(WEBHOOK_PORT, () => {
    console.log(`🗳️  DBL vote webhook listening on port ${WEBHOOK_PORT}`);
  });
}
