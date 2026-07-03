import { Client } from "discord.js";
import * as fs   from "fs";
import * as path from "path";

// ── Emoji definitions ─────────────────────────────────────────────────────────
// name (no spaces, max 32 chars) → asset path relative to process.cwd()

const EMOJI_ASSETS: { name: string; file: string }[] = [
  // Currencies
  { name: "cc_credits",  file: "assets/icons/Credits.png"        },
  { name: "cc_lunakite", file: "assets/icons/Lunakite.png"       },
  { name: "cc_tuning",   file: "assets/icons/Tuning Module.png"  },
  { name: "cc_sealing",  file: "assets/icons/Sealing Tube.png"   },
  { name: "cc_forging",  file: "assets/icons/Forging Ore.png"    },
  { name: "cc_paradox",  file: "assets/icons/Paradox Core.png"   },
  { name: "cc_stasis",   file: "assets/icons/Stasis Lock.png"    },
  { name: "cc_record",   file: "assets/icons/Resonance EXP.png"  },
  { name: "cc_fracture",   file: "assets/icons/Fracture Key.png"   },
  { name: "cc_fractonite", file: "assets/icons/Fractonite.png"     },
  { name: "cc_prism",      file: "assets/icons/Aura Prism.png"     },
  // 1-cost echoes
  { name: "ec_ember",    file: "assets/echoes/1-cost/Ember Wisp.png"     },
  { name: "ec_frost",    file: "assets/echoes/1-cost/Frost Mote.png"     },
  { name: "ec_static",   file: "assets/echoes/1-cost/Static Spark.png"   },
  { name: "ec_zephyr",   file: "assets/echoes/1-cost/Zephyr Mite.png"    },
  { name: "ec_shadow",   file: "assets/echoes/1-cost/Shadow Flicker.png" },
  { name: "ec_lumen",    file: "assets/echoes/1-cost/Lumen Speck.png"    },
  // 3-cost echoes
  { name: "ec_magma",    file: "assets/echoes/3-cost/Magma Sentinel.png"  },
  { name: "ec_glacial",  file: "assets/echoes/3-cost/Glacial Warden.png"  },
  { name: "ec_thunder",  file: "assets/echoes/3-cost/Thunder Drake.png"   },
  { name: "ec_storm",    file: "assets/echoes/3-cost/Storm Harbinger.png" },
  { name: "ec_void",     file: "assets/echoes/3-cost/Void Stalker.png"    },
  { name: "ec_radiant",  file: "assets/echoes/3-cost/Radiant Keeper.png"  },
  // Named Echo Set 1-cost echoes
  { name: "ec_kindling",    file: "assets/echoes/1-cost/Kindling Wretch.png"    },
  { name: "ec_scorchmite",  file: "assets/echoes/1-cost/Scorchmite.png"         },
  { name: "ec_frostbound",  file: "assets/echoes/1-cost/Frostbound Imp.png"     },
  { name: "ec_hoarfrost",   file: "assets/echoes/1-cost/Hoarfrost Crawler.png"  },
  { name: "ec_sparkmite",   file: "assets/echoes/1-cost/Sparkmite.png"          },
  { name: "ec_staticwisp",  file: "assets/echoes/1-cost/Static Wisp.png"        },
  { name: "ec_zephyrspr",   file: "assets/echoes/1-cost/Zephyr Sprite.png"      },
  { name: "ec_windnipper",  file: "assets/echoes/1-cost/Windnipper.png"         },
  { name: "ec_nullspawn",   file: "assets/echoes/1-cost/Nullspawn.png"          },
  { name: "ec_shadeleech",  file: "assets/echoes/1-cost/Shade Leech.png"        },
  { name: "ec_glimmermote", file: "assets/echoes/1-cost/Glimmermote.png"        },
  { name: "ec_halosprite",  file: "assets/echoes/1-cost/Halo Sprite.png"        },
  // Named Echo Set 3-cost echoes
  { name: "ec_ashfall",       file: "assets/echoes/3-cost/Ashfall Harrier.png"    },
  { name: "ec_rime",          file: "assets/echoes/3-cost/Rime Sentinel.png"     },
  { name: "ec_voltaicreaver", file: "assets/echoes/3-cost/Voltaic Reaver.png"    },
  { name: "ec_skyrend",       file: "assets/echoes/3-cost/Skyrend Talon.png"     },
  { name: "ec_duskfang",      file: "assets/echoes/3-cost/Duskfang Stalker.png"  },
  { name: "ec_prismwarden",   file: "assets/echoes/3-cost/Prism Warden.png"      },
];

// ── In-memory cache: emojiName → "<:name:id>" string ─────────────────────────
const emojiCache = new Map<string, string>();

// ── Maps echo/currency names to emoji keys ────────────────────────────────────
const ECHO_EMOJI_MAP: Record<string, string> = {
  "Ember Wisp":     "ec_ember",
  "Frost Mote":     "ec_frost",
  "Static Spark":   "ec_static",
  "Zephyr Mite":    "ec_zephyr",
  "Shadow Flicker": "ec_shadow",
  "Lumen Speck":    "ec_lumen",
  "Magma Sentinel": "ec_magma",
  "Glacial Warden": "ec_glacial",
  "Thunder Drake":  "ec_thunder",
  "Storm Harbinger":"ec_storm",
  "Void Stalker":   "ec_void",
  "Radiant Keeper": "ec_radiant",
  // Named Echo Set echoes
  "Kindling Wretch":   "ec_kindling",
  "Scorchmite":        "ec_scorchmite",
  "Ashfall Harrier":   "ec_ashfall",
  "Frostbound Imp":    "ec_frostbound",
  "Hoarfrost Crawler": "ec_hoarfrost",
  "Rime Sentinel":     "ec_rime",
  "Sparkmite":         "ec_sparkmite",
  "Static Wisp":       "ec_staticwisp",
  "Voltaic Reaver":    "ec_voltaicreaver",
  "Zephyr Sprite":     "ec_zephyrspr",
  "Windnipper":        "ec_windnipper",
  "Skyrend Talon":     "ec_skyrend",
  "Nullspawn":         "ec_nullspawn",
  "Shade Leech":       "ec_shadeleech",
  "Duskfang Stalker":  "ec_duskfang",
  "Glimmermote":       "ec_glimmermote",
  "Halo Sprite":       "ec_halosprite",
  "Prism Warden":      "ec_prismwarden",
};

const CURRENCY_EMOJI_MAP: Record<string, string> = {
  credits:          "cc_credits",
  lunakite:         "cc_lunakite",
  tuningModules:    "cc_tuning",
  sealingTubes:     "cc_sealing",
  forgingOres:      "cc_forging",
  paradoxCores:     "cc_paradox",
  stasisLocks:      "cc_stasis",
  resonanceRecords: "cc_record",
  fractureKeys:     "cc_fracture",
  fractonite:       "cc_fractonite",
  auraPrisms:       "cc_prism",
};

// ── Load / create APPLICATION emojis on startup ───────────────────────────────
// Application (bot) emojis live on the bot itself — usable in EVERY server it's in,
// without touching any server's emoji slots and without creating anything in member
// servers. Uploaded once to the application; reused forever.
export async function loadEmojis(client: Client): Promise<void> {
  if (!client.application) return;

  let existing;
  try {
    existing = await client.application.emojis.fetch();
  } catch (err: any) {
    console.warn(`[Emojis] Could not fetch application emojis: ${err?.message ?? err}`);
    return;
  }

  let created = 0, skipped = 0;

  for (const { name, file } of EMOJI_ASSETS) {
    const cached = existing.find(e => e.name === name);
    if (cached) {
      emojiCache.set(name, `<:${name}:${cached.id}>`);
      skipped++;
      continue;
    }

    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const emoji = await client.application.emojis.create({ attachment: fullPath, name });
      emojiCache.set(name, `<:${name}:${emoji.id}>`);
      created++;
    } catch (err: any) {
      console.warn(`[Emojis] Could not create app emoji ${name}: ${err?.message ?? err}`);
    }
  }

  console.log(`[Emojis] Application emojis ready — ${skipped} existing, ${created} uploaded. Usable in all servers.`);
}

// ── Public getters ────────────────────────────────────────────────────────────

/** Get emoji string for a currency field name (e.g. "credits") */
export function currencyEmoji(field: string, fallback: string): string {
  const key = CURRENCY_EMOJI_MAP[field];
  return key ? (emojiCache.get(key) ?? fallback) : fallback;
}

/** Get emoji string for an echo by name (e.g. "Ember Wisp") */
export function echoEmoji(name: string, fallback = "◈"): string {
  const key = ECHO_EMOJI_MAP[name];
  return key ? (emojiCache.get(key) ?? fallback) : fallback;
}

/** Get emoji string directly by internal key */
export function getEmoji(key: string, fallback = ""): string {
  return emojiCache.get(key) ?? fallback;
}

/**
 * Resolvable form of echoEmoji() for use with StringSelectMenuOptionBuilder /
 * select-option `emoji` fields — returns { id, name } for a registered custom
 * echo icon (1/3-cost), or the plain unicode fallback string otherwise (e.g.
 * 4-cost boss echoes, which have no registered icon since they show full art
 * on their own card instead).
 */
export function echoEmojiResolvable(name: string, fallback: string): { id: string; name: string } | string {
  const key = ECHO_EMOJI_MAP[name];
  return key ? getEmojiResolvable(key, fallback) : fallback;
}

/** Whether emojis are loaded and usable */
export function emojisReady(): boolean {
  return emojiCache.size > 0;
}

/**
 * Returns an emoji resolvable for use with ButtonBuilder.setEmoji().
 * Custom emojis return { id, name }; unicode fallback returns the string.
 */
export function getEmojiResolvable(key: string, fallback: string): { id: string; name: string } | string {
  const str = emojiCache.get(key);
  if (str) {
    const m = str.match(/^<:(\w+):(\d+)>$/);
    if (m) return { id: m[2], name: m[1] };
  }
  return fallback;
}

/**
 * Currency emoji shorthands — resolved lazily at call time so they work
 * even if called before `loadEmojis` completes (falls back to Unicode).
 * Import `CE` and use e.g. `CE.cr` for Credits, `CE.lk` for Lunakite, etc.
 */
export const CE = {
  get cr() { return getEmoji("cc_credits",  "💠"); },
  get lk() { return getEmoji("cc_lunakite", "🌙"); },
  get tm() { return getEmoji("cc_tuning",   "🔧"); },
  get st() { return getEmoji("cc_sealing",  "🧪"); },
  get fo() { return getEmoji("cc_forging",  "⚙️"); },
  get pc() { return getEmoji("cc_paradox",  "🔮"); },
  get sl() { return getEmoji("cc_stasis",   "🔒"); },
  get rr() { return getEmoji("cc_record",   "📀"); },
  get fk() { return getEmoji("cc_fracture",   "🗝️"); },
  get ft() { return getEmoji("cc_fractonite", "🔷"); },
  get ap() { return getEmoji("cc_prism",      "🔆"); },
};
