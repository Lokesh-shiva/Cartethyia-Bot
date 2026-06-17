import express from "express";
import { Client } from "discord.js";
import { awardUser } from "./economy";
import { CE } from "./emojiManager";
import prisma from "./prisma";

const DBL_WEBHOOK_AUTH      = process.env.DBL_WEBHOOK_AUTH      ?? "";
const TOPGG_WEBHOOK_AUTH    = process.env.TOPGG_WEBHOOK_AUTH    ?? "";
const RANKTOP_WEBHOOK_AUTH  = process.env.RANKTOP_WEBHOOK_AUTH  ?? "";
const WEBHOOK_PORT          = parseInt(process.env.WEBHOOK_PORT ?? "3000", 10);
const DBL_VOTE_URL     = "https://discordbotlist.com/bots/cartethyia/upvote";
const TOPGG_VOTE_URL   = "https://top.gg/bot/1510163339177623642/vote";
const RANKTOP_VOTE_URL = "https://rank.top/bot/1510163339177623642/vote";
const BOT_ID           = process.env.CLIENT_ID ?? "1510163339177623642";

function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

async function processVote(
  client: Client,
  userId: string,
  weekend: boolean,
  source: "dbl" | "topgg" | "ranktop",
) {
  const rewards = {
    credits:      weekend ? 2000 : 1000,
    fractureKeys: weekend ? 2    : 1,
  };

  // Skip users who haven't started the bot yet
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) {
    console.log(`[vote:${source}] ${userId} voted but has no account — skipping rewards`);
    return;
  }

  try {
    const voteField = source === "dbl" ? { dblVotes: { increment: 1 } }
                   : source === "topgg" ? { topggVotes: { increment: 1 } }
                   : { ranktopVotes: { increment: 1 } };
    await Promise.all([
      awardUser(userId, rewards),
      prisma.user.update({
        where: { id: userId },
        data:  { lastVoted: new Date(), ...voteField },
      }).catch(() => {}),
    ]);

    const weekendTag = weekend ? "  *(Weekend ×2!)*" : "";
    const sourceName = source === "topgg" ? "top.gg" : source === "dbl" ? "discordbotlist.com" : "rank.top";
    const voteUrl    = source === "topgg" ? TOPGG_VOTE_URL : source === "dbl" ? DBL_VOTE_URL : RANKTOP_VOTE_URL;
    const dmMsg =
      `## ✅  Upvote received — thank you!\n` +
      `Your support on **${sourceName}** helps Cartethyia grow and reach more players.\n\n` +
      `**Rewards${weekendTag}:**\n` +
      `${CE.cr} **${rewards.credits}** Credits\n` +
      `${CE.fk} **${rewards.fractureKeys}** Fracture Key${rewards.fractureKeys !== 1 ? "s" : ""}\n\n` +
      `You can upvote again in **12 hours** — [click here](${voteUrl})`;

    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      const dm = await user.createDM().catch(() => null);
      if (dm) await dm.send(dmMsg).catch(() => {});
    }

    console.log(`[vote:${source}] ${userId} upvoted — ${rewards.credits}cr + ${rewards.fractureKeys}fk (weekend=${weekend})`);
  } catch (e) {
    console.error(`[vote:${source}] Failed to process upvote for`, userId, e);
  }
}

export function startVoteWebhook(client: Client) {
  if (!DBL_WEBHOOK_AUTH && !TOPGG_WEBHOOK_AUTH && !RANKTOP_WEBHOOK_AUTH) {
    console.log("⚠️  No vote webhook auth env vars set — vote webhooks disabled.");
    return;
  }

  const app = express();
  app.use(express.json({ type: ["application/json", "text/plain", "*/*"] }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // ── Discord Bot List ────────────────────────────────────────────────────────
  if (DBL_WEBHOOK_AUTH) {
    app.post("/dbl-vote", (req, res) => {
      if (req.headers.authorization !== DBL_WEBHOOK_AUTH) { res.sendStatus(401); return; }
      // DBL sends { id, username, avatar }
      const userId = req.body?.id as string | undefined;
      if (!userId) { res.sendStatus(400); return; }
      res.sendStatus(200);
      processVote(client, userId, isWeekend(), "dbl");
    });
  }

  // ── Top.gg ─────────────────────────────────────────────────────────────────
  if (TOPGG_WEBHOOK_AUTH) {
    // GET handler for top.gg URL validation probe
    app.get("/topgg-vote", (_req, res) => { res.sendStatus(200); });

    app.post("/topgg-vote", (req, res) => {
      res.sendStatus(200);
      const type   = req.body?.type as string | undefined;
      const userId = req.body?.data?.user?.platform_id as string | undefined;
      // Ignore test pings, require a userId for everything else
      if (type === "webhook.test" || !userId) {
        console.log(`[vote:topgg] Ignored (type=${type})`);
        return;
      }
      console.log(`[vote:topgg] Incoming vote type=${type} userId=${userId}`);
      processVote(client, userId, isWeekend(), "topgg");
    });
  }

  // ── Rank.top ───────────────────────────────────────────────────────────────
  if (RANKTOP_WEBHOOK_AUTH) {
    app.post("/ranktop-vote", (req, res) => {
      // rank.top doesn't send the Authorization header — verify target_id instead
      const targetId = req.body?.target_id as string | undefined;
      if (targetId !== BOT_ID) { res.sendStatus(401); return; }
      res.status(200).json({ success: true });
      const { user_id, is_test, is_power_vote } = req.body ?? {};
      if (is_test) { console.log("[vote:ranktop] Test webhook received"); return; }
      if (!user_id) { console.warn("[vote:ranktop] Missing user_id"); return; }
      console.log(`[vote:ranktop] userId=${user_id} power=${is_power_vote}`);
      processVote(client, user_id, is_power_vote ?? isWeekend(), "ranktop");
    });
  }

  // Silently drop malformed requests (PHP probes, scanners, etc.)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.sendStatus(400);
  });

  app.listen(WEBHOOK_PORT, () => {
    const active = [DBL_WEBHOOK_AUTH && "/dbl-vote", TOPGG_WEBHOOK_AUTH && "/topgg-vote", RANKTOP_WEBHOOK_AUTH && "/ranktop-vote"].filter(Boolean).join(", ");
    console.log(`🗳️  Vote webhook server on port ${WEBHOOK_PORT} — endpoints: ${active}`);
  });
}
