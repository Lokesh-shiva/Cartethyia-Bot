const VOTE_URL = "https://discordbotlist.com/bots/cartethyia/upvote";

// ~20% chance nudge — shown occasionally at end of reward messages
export function voteNudge(chance = 0.20): string {
  if (Math.random() > chance) return "";
  return `\n-# 💜 Enjoying Cartethyia? [Upvote us](${VOTE_URL}) — it really helps!`;
}
