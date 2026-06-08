/**
 * GIF fetcher using nekos.best — free anime GIF API, no key required.
 * Docs: https://nekos.best/docs
 */

export type ActionType =
  // Physical (target required)
  | "pat" | "hug" | "kiss" | "slap" | "bite" | "poke" | "cuddle" | "handhold" | "bonk" | "highfive"
  | "lick" | "kick" | "punch"
  // Expressive (self)
  | "dance" | "cry" | "blush" | "sleep" | "smug" | "wave" | "thumbsup" | "nom" | "wink" | "shrug"
  // Emotional (react)
  | "angry" | "happy" | "cringe" | "bored" | "nervous";

export type ActionCategory = "physical" | "expressive" | "emotional";

export const ACTION_META: Record<ActionType, {
  category:    ActionCategory;
  verb:        string;   // "pats"
  selfVerb?:   string;   // used for return action e.g. "pats back"
  returnLabel?: string;  // button label
  nekoEndpoint: string;  // nekos.best endpoint
}> = {
  // ── Physical ─────────────────────────────────────────────
  pat:      { category: "physical",   verb: "pats",     selfVerb: "pats back",      returnLabel: "↩️ Pat Back",      nekoEndpoint: "pat"      },
  hug:      { category: "physical",   verb: "hugs",     selfVerb: "hugs back",      returnLabel: "🤗 Hug Back",      nekoEndpoint: "hug"      },
  kiss:     { category: "physical",   verb: "kisses",   selfVerb: "kisses back",    returnLabel: "💋 Kiss Back",     nekoEndpoint: "kiss"     },
  slap:     { category: "physical",   verb: "slaps",    selfVerb: "slaps back",     returnLabel: "👋 Slap Back",     nekoEndpoint: "slap"     },
  bite:     { category: "physical",   verb: "bites",    selfVerb: "bites back",     returnLabel: "😤 Bite Back",     nekoEndpoint: "bite"     },
  poke:     { category: "physical",   verb: "pokes",    selfVerb: "pokes back",     returnLabel: "👉 Poke Back",     nekoEndpoint: "poke"     },
  cuddle:   { category: "physical",   verb: "cuddles",  selfVerb: "cuddles back",   returnLabel: "🥰 Cuddle Back",   nekoEndpoint: "cuddle"   },
  handhold: { category: "physical",   verb: "holds hands with", selfVerb: "holds hands back", returnLabel: "🤝 Hold Back",    nekoEndpoint: "handhold" },
  bonk:     { category: "physical",   verb: "bonks",            selfVerb: "bonks back",       returnLabel: "🔨 Bonk Back",   nekoEndpoint: "bonk"     },
  highfive: { category: "physical",   verb: "high-fives",       selfVerb: "high-fives back",  returnLabel: "🙌 High Five!",  nekoEndpoint: "highfive" },
  lick:     { category: "physical",   verb: "licks",            selfVerb: "licks back",       returnLabel: "😛 Lick Back",   nekoEndpoint: "bleh"     },
  kick:     { category: "physical",   verb: "kicks",            selfVerb: "kicks back",       returnLabel: "🦵 Kick Back",   nekoEndpoint: "kick"     },
  punch:    { category: "physical",   verb: "punches",          selfVerb: "punches back",     returnLabel: "👊 Punch Back",  nekoEndpoint: "punch"    },
  // ── Expressive ───────────────────────────────────────────
  dance:    { category: "expressive", verb: "dances",                               nekoEndpoint: "dance"    },
  cry:      { category: "expressive", verb: "cries",                                nekoEndpoint: "cry"      },
  blush:    { category: "expressive", verb: "blushes",                              nekoEndpoint: "blush"    },
  sleep:    { category: "expressive", verb: "sleeps",                               nekoEndpoint: "sleep"    },
  smug:     { category: "expressive", verb: "acts smug",                            nekoEndpoint: "smug"     },
  wave:     { category: "expressive", verb: "waves",                                nekoEndpoint: "wave"     },
  thumbsup: { category: "expressive", verb: "gives a thumbs up",                   nekoEndpoint: "thumbsup" },
  nom:      { category: "expressive", verb: "noms",                                 nekoEndpoint: "nom"      },
  wink:     { category: "expressive", verb: "winks",                                nekoEndpoint: "wink"     },
  shrug:    { category: "expressive", verb: "shrugs",                               nekoEndpoint: "shrug"    },
  // ── Emotional ────────────────────────────────────────────
  angry:    { category: "emotional",  verb: "is angry",                             nekoEndpoint: "angry"    },
  happy:    { category: "emotional",  verb: "is happy",                             nekoEndpoint: "happy"    },
  cringe:   { category: "emotional",  verb: "cringes",                              nekoEndpoint: "facepalm" },
  bored:    { category: "emotional",  verb: "is bored",                             nekoEndpoint: "bored"    },
  nervous:  { category: "emotional",  verb: "is nervous",                           nekoEndpoint: "stare"    },
};

interface NekosBestResponse {
  results: Array<{ anime_name: string; url: string }>;
}

/**
 * Fetch a random anime GIF URL for the given action from nekos.best
 */
export async function fetchGif(action: ActionType): Promise<string | null> {
  try {
    const res = await fetch(`https://nekos.best/api/v2/${ACTION_META[action].nekoEndpoint}`);
    if (!res.ok) return null;
    const data = await res.json() as NekosBestResponse;
    return data.results?.[0]?.url ?? null;
  } catch {
    return null;
  }
}
