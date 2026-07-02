// One-time currency bundles — bought via a Patreon one-time/extra pledge, then
// claimed in-game with a code the owner generates via /patron-code create-bundle.
// Unlike PATRON_TIERS these never touch patronTier — pure currency grants.

export interface LunakiteBundle {
  id:          string;
  name:        string;
  price:       string;
  emoji:       string;
  desc:        string;
  rewards: {
    lunakite:   number;
    auraPrisms: number;
    fractonite: number;
  };
}

export const LUNAKITE_BUNDLES: Record<string, LunakiteBundle> = {
  starter: {
    id: "starter", name: "Starter Pack", price: "$2", emoji: "🔹",
    desc: "A small boost to get going.",
    rewards: { lunakite: 3, auraPrisms: 1, fractonite: 100 },
  },
  wanderer: {
    id: "wanderer", name: "Wanderer's Bundle", price: "$5", emoji: "🔷",
    desc: "Solid value for regular play.",
    rewards: { lunakite: 8, auraPrisms: 2, fractonite: 250 },
  },
  voyager: {
    id: "voyager", name: "Voyager Bundle", price: "$10", emoji: "💠",
    desc: "For players pushing through world levels.",
    rewards: { lunakite: 18, auraPrisms: 5, fractonite: 600 },
  },
  vault: {
    id: "vault", name: "Resonance Vault", price: "$20", emoji: "🌌",
    desc: "Best value — for the truly devoted.",
    rewards: { lunakite: 40, auraPrisms: 10, fractonite: 1500 },
  },
};
