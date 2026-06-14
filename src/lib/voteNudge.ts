const TOPGG_URL = "https://top.gg/bot/1510163339177623642/vote";
const DBL_URL   = "https://discordbotlist.com/bots/cartethyia/upvote";

// ~20% chance nudge — shown occasionally at end of reward messages
export function voteNudge(chance = 0.20): string {
  if (Math.random() > chance) return "";
  return `\n-# 💜 Enjoying Cartethyia? [Vote on top.gg](${TOPGG_URL}) or [discordbotlist.com](${DBL_URL}) — it really helps!`;
}
