const TOPGG_URL   = "https://top.gg/bot/1510163339177623642/vote";
const DBL_URL     = "https://discordbotlist.com/bots/cartethyia/upvote";
const RANKTOP_URL = "https://rank.top/bot/cartethyia";
export const PATREON_URL = "https://www.patreon.com/c/Cartethyia_bot/membership";
export const KOFI_URL = "https://ko-fi.com/cartethyiabot";

// ~20% chance nudge — shown occasionally at end of reward messages
export function voteNudge(chance = 0.20): string {
  if (Math.random() > chance) return "";
  return `\n-# 💜 Enjoying Cartethyia? [Vote on top.gg](${TOPGG_URL}), [discordbotlist.com](${DBL_URL}), or [rank.top](${RANKTOP_URL}) — it really helps!`;
}

// ~8% chance nudge — less frequent than vote, shown in same reward spots
export function supportNudge(chance = 0.08): string {
  if (Math.random() > chance) return "";
  return `\n-# ✦ Love the game? [Support on Patreon](${PATREON_URL}) for monthly bundles + permanent perks.`;
}
