// One-time currency bundles — bought via the Ko-fi shop, then claimed in-game
// with a code the owner generates via /patron-code create-bundle. Unlike
// PATRON_TIERS (recurring monthly subs, stay on Patreon) these never touch
// patronTier — pure currency grants. Prices include a ~10% markup over the
// old Patreon one-time-pledge prices to cover Ko-fi's 5% shop fee + PayPal's
// ~2.9%+$0.30 processing fee (2026-07-20).

export interface LunakiteBundle {
  id:          string;
  name:        string;
  price:       string;
  emoji:       string;
  desc:        string;
  koFiUrl:     string;
  rewards: {
    lunakite:   number;
    auraPrisms: number;
    fractonite: number;
  };
}

export const LUNAKITE_BUNDLES: Record<string, LunakiteBundle> = {
  starter: {
    id: "starter", name: "Starter Pack", price: "$4.25", emoji: "🔹",
    desc: "A small boost to get going.",
    koFiUrl: "https://ko-fi.com/s/ea2c57241c",
    rewards: { lunakite: 3, auraPrisms: 1, fractonite: 100 },
  },
  wanderer: {
    id: "wanderer", name: "Wanderer's Bundle", price: "$5.99", emoji: "🔷",
    desc: "Solid value for regular play.",
    koFiUrl: "https://ko-fi.com/s/67ae3bed84",
    rewards: { lunakite: 8, auraPrisms: 2, fractonite: 250 },
  },
  voyager: {
    id: "voyager", name: "Voyager Bundle", price: "$11.99", emoji: "💠",
    desc: "For players pushing through world levels.",
    koFiUrl: "https://ko-fi.com/s/719224c10f",
    rewards: { lunakite: 18, auraPrisms: 5, fractonite: 600 },
  },
  vault: {
    id: "vault", name: "Resonance Vault", price: "$22.99", emoji: "🌌",
    desc: "Best value — for the truly devoted.",
    koFiUrl: "https://ko-fi.com/s/f04dda5050",
    rewards: { lunakite: 40, auraPrisms: 10, fractonite: 1500 },
  },
};
