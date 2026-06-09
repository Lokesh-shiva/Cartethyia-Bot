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
  { name: "cc_fracture", file: "assets/icons/Fracture Key.png"   },
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

/** Whether emojis are loaded and usable */
export function emojisReady(): boolean {
  return emojiCache.size > 0;
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
  get fk() { return getEmoji("cc_fracture", "🗝️"); },
};
