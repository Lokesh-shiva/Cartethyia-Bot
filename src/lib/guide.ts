import { EmbedBuilder } from "discord.js";

// ── Colour palette ────────────────────────────────────────────────────────────
export const C = {
  primary:  0x6366F1,
  fusion:   0xFF6B35,
  glacio:   0x4FC3F7,
  electro:  0xB39DDB,
  aero:     0x80CBC4,
  havoc:    0x9C27B0,
  spectro:  0xFFD54F,
  gold:     0xF5A623,
  green:    0x4CAF50,
  red:      0xFF4F6D,
  dark:     0x1E1F2E,
};

export interface GuideSection {
  label:       string;
  description: string;
  emoji:       string;
  embed:       () => EmbedBuilder;
}

// ── All guide sections ────────────────────────────────────────────────────────
export const GUIDE_SECTIONS: Record<string, GuideSection> = {

  getting_started: {
    label: "Getting Started",
    description: "New here? Start with this — your first 10 minutes explained",
    emoji: "🚀",
    embed: () => new EmbedBuilder()
      .setColor(C.primary)
      .setTitle("🚀  Getting Started — Your First 10 Minutes")
      .setDescription("Everything you need to go from zero to your first echo drop.")
      .addFields(
        {
          name:  "1️⃣  Create your character — `/start`",
          value: "Run `/start` to register. You'll answer a few onboarding questions — your answers shape your AI-generated unique ability later.",
          inline: false,
        },
        {
          name:  "2️⃣  Chat to level up",
          value: "Every message earns **3–8 Resonance EXP** (3s cooldown). Just talk. You'll level up automatically and see a level-up card in chat.",
          inline: false,
        },
        {
          name:  "3️⃣  Claim your daily — `/daily`",
          value: "Free Credits + EXP every 20 hours. Streak multipliers up to **3×** the longer you keep it going. Enable the DM reminder so you never miss it.",
          inline: false,
        },
        {
          name:  "4️⃣  Fight your first Echo",
          value: "Enemies spawn randomly while you chat. When one appears, click **⚔️ Fight** — it's **first-come, first-served** and the combat is private to you. Win to claim the echo.",
          inline: false,
        },
        {
          name:  "5️⃣  At Level 5 — run your first dungeon — `/dungeon`",
          value: "Echo Dungeons drop multiple echoes in one run. Start with an element that matches your playstyle. Costs **1 ◈ Resonance Aura** (5 max, 1 regens every 3h).",
          inline: false,
        },
        {
          name:  "6️⃣  At Level 20 — choose your Element",
          value: "A selection screen will appear automatically. **Permanent choice** — cannot be changed. Each element gives innate stat bonuses + a unique combat hook.",
          inline: false,
        },
        {
          name:  "7️⃣  At your level cap — `/ascend`",
          value: "Fight the World Level boss to break your cap and unlock the next tier. Your **first ascension win** generates your AI unique passive ability — real combat effects, no two players the same.",
          inline: false,
        },
        {
          name:  "📋  Key commands to know early",
          value: "`/profile` · `/inventory` · `/echoes` · `/daily` · `/dungeon` · `/guide`",
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  Use /guide to explore every system in detail" }),
  },

  progression: {
    label: "Progression & Leveling",
    description: "EXP, levels, World Levels, stat scaling",
    emoji: "📈",
    embed: () => new EmbedBuilder()
      .setColor(C.primary)
      .setTitle("📈  Progression & Leveling")
      .setDescription(
        `Every message earns **3–8 Resonance EXP** (3s cooldown). Genuine chat > spam.\n\n` +
        `**EXP to level up:** \`100 × level^1.6\`  ·  Use 📀 Resonance Records for an instant level.\n\n` +
        `**Per level:** +12 HP · +3 ATK · +2 DEF · +1 SPD\n\n` +
        `**World Levels** cap your max level — broken by winning \`/ascend\`:\n` +
        `› WL0→Lv20 · WL1→Lv40 · WL2→Lv50 · WL3→Lv60 · WL4→Lv70 · WL5→Lv80 · WL6→Lv84 · WL7→Lv88 · WL8→Lv90\n\n` +
        `**Milestone notifications** fire automatically in chat when you hit key levels:\n` +
        `Lv3 (dungeons) · Lv5 (echo dungeons + field bosses) · Lv15 (Wraith Trial) · Lv20 (ascension + element)\n` +
        `Lv25/30/35/45/50/55/65/70/80 (additional boss trials as they unlock)`
      )
      .setFooter({ text: "CARTETHYIA  ·  /level · /profile" }),
  },

  elements: {
    label: "Elements",
    description: "The 6 elements, innate bonuses, and combat hooks — chosen at Lv20",
    emoji: "✨",
    embed: () => new EmbedBuilder()
      .setColor(C.spectro)
      .setTitle("✨  Elements")
      .setDescription(
        `At **Level 20** you choose your element — permanent, cannot be changed.\n` +
        `Your element grants **innate stat bonuses** that are always active, plus a **passive hook** that triggers in combat.\n\n` +
        `Element also determines your echo **affinity bonuses** and which boss you fight at WL0.`
      )
      .addFields(
        {
          name:  "🔥 Fusion",
          value: "+15% ATK · +15% Crit Rate · +20% Elemental DMG\n**Hook — IGNITE:** 35% chance on hit → +25% ATK for that hit.",
          inline: false,
        },
        {
          name:  "❄️ Glacio",
          value: "+30% DEF · +15% HP · +20% Elemental DMG\n**Hook — FROST_SHIELD:** 25% chance on hit → absorb 40% of incoming damage.",
          inline: false,
        },
        {
          name:  "⚡ Electro",
          value: "+5% Crit Rate · +20% Crit DMG · +25 Energy per turn\n**Hook — DISCHARGE:** Landing a critical hit generates +20 bonus energy.",
          inline: false,
        },
        {
          name:  "🌪️ Aero",
          value: "+15% ATK · +40% Crit DMG · +20% Elemental DMG\n**Hook — WINDSTRIDE:** +8% damage bonus per turn, stacks up to 5× (max +40%).",
          inline: false,
        },
        {
          name:  "🌑 Havoc",
          value: "+15% ATK · +20% Lifesteal · +20% Elemental DMG\n**Hook — VOID_SURGE:** Shattering the enemy's Vibration Bar restores +25% of your max HP.",
          inline: false,
        },
        {
          name:  "✨ Spectro",
          value: "+30% HP · +20% Elemental DMG\n**Hook — RADIANCE:** Regenerate 2% max HP per turn. Below 40% HP: +25% Crit Rate.",
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  Element chosen at Lv20 · cannot change" }),
  },

  currencies: {
    label: "Currencies & Items",
    description: "What every item in your inventory is for",
    emoji: "💠",
    embed: () => new EmbedBuilder()
      .setColor(C.gold)
      .setTitle("💠  Currencies & Items")
      .setDescription("Every resource and exactly what it does:")
      .addFields(
        { name: "💠  Credits",          value: "Base currency. Spent in `/shop` and at `/forge`. Earned from `/vibe`, `/daily`, dungeon clears, Ascension rewards.", inline: false },
        { name: "🌙  Lunakite",          value: "Premium currency. Earned from 14-day streak milestones, Ascension wins, deep Dispatch. Better `/shop` bundle rates.", inline: false },
        { name: "🔧  Tuning Modules",    value: "Level up Echoes (0→25). Earned from `/vibe` physical (45%), `/daily`, Dispatch, Resonance Forge dungeon.", inline: false },
        { name: "🧪  Sealing Tubes",     value: "Reveal sealed Echo substats (1 per reveal). Earned from `/vibe` physical (20%), 7-day `/daily`, Dispatch, Sealed Archive dungeon.", inline: false },
        { name: "⚙️  Forging Ores",      value: "Craft weapons at `/forge`. Earned from `/vibe` physical (15%), 7-day `/daily`, Dispatch, Forging Grounds dungeon.", inline: false },
        { name: "🔮  Paradox Cores",     value: "**Endgame.** Reroll all Echo substats. Earned from Ascension wins, WL1+ Dispatch, Paradox Crucible dungeon.", inline: false },
        { name: "🔒  Stasis Locks",      value: "Lock a substat before rerolling so it's protected. Cost per lock: 1 / 3 / 6. Earned from Ascension boss drops.", inline: false },
        { name: "📀  Resonance Records", value: "Instant EXP — one level's worth. Use with `/use record`. Earned from `/vibe`, `/daily`, milestones, Bonds, Memory Vault dungeon.", inline: false },
        { name: "🗝️  Fracture Keys",     value: "Used for **Resonance Wishes** (`/wish`) — the gacha banner. Earned from: boss clears (1–3 keys by WL), dungeon clears (1), Ascension wins (2).", inline: false },
      )
      .setFooter({ text: "CARTETHYIA  ·  /inventory · /shop" }),
  },

  echoes: {
    label: "Echo System — Collecting",
    description: "What echoes are, how to get them, the Resonance Grid",
    emoji: "🔮",
    embed: () => new EmbedBuilder()
      .setColor(C.electro)
      .setTitle("🔮  Echo System — Collecting & Equipping")
      .setDescription(
        `Echoes are your **entire build system**. They drop from enemies while chatting, in dungeons, and from bosses.\n\n` +
        `**Resonance Grid** — 12-point budget, 1 Main Slot + up to 4 Sub Slots:\n` +
        `› 4-cost = Boss echoes (Crit Rate, Crit DMG, ATK%, HP%, Elem DMG%, DEF%)\n` +
        `› 3-cost = Field echoes (element-specific DMG Bonus, Healing%, ATK%, HP%, DEF%)\n` +
        `› 1-cost = Common echoes (HP flat/%, ATK flat/%, DEF flat/%)\n\n` +
        `**Rarities** determine substat count:\n` +
        `› 3★ = 3 substats  ·  4★ = 4 substats  ·  5★ = 5 substats (full)\n\n` +
        `**Commands:**\n` +
        `› \`/echoes\` — your Resonance Grid card + active set bonuses + inventory\n` +
        `› \`/echo\` — view any single echo as a detailed card\n` +
        `› \`/echo-equip\` — slot an echo into the grid`
      )
      .setFooter({ text: "CARTETHYIA  ·  /echoes · /echo · /echo-equip" }),
  },

  echo_upgrades: {
    label: "Echo System — Upgrading",
    description: "Level, reveal, reroll, lock substats",
    emoji: "⚙️",
    embed: () => new EmbedBuilder()
      .setColor(C.electro)
      .setTitle("⚙️  Echo System — Upgrading")
      .addFields(
        {
          name:  "🔧  /echo-upgrade — Level echoes (0 → 25)",
          value: "Costs 🔧 Tuning Modules. Cost scales: 1 (Lv0–4) → 2 (5–9) → 3 (10–14) → 4 (15–19) → 5 (20–24).\nMain stat grows with level. **Substats also scale — max 1.5× their base value at Lv25.**\nButtons: **+1**, **+5**, **Auto Max** + optional **Auto-Reveal** toggle.",
          inline: false,
        },
        {
          name:  "🧪  /echo-reveal — Unlock sealed substats",
          value: "Costs 1 🧪 Sealing Tube per reveal. Echoes drop with all substats hidden — reveal one at a time.",
          inline: false,
        },
        {
          name:  "🔮  /echo-reroll — Reroll substats",
          value: "Costs 1 🔮 Paradox Core. Randomises all **unlocked, revealed** substats. Types stay — values change.\nUse 🔒 Stasis Locks to protect specific substats first (1st = 1 lock, 2nd = 3, 3rd = 6).",
          inline: false,
        },
        {
          name:  "📋  /echo-preset — Save & load loadouts",
          value: "Save your current equipped echoes as a named preset (e.g. 'PvP', 'Farm'). Load it any time to swap your full grid instantly. Up to **10 presets** stored.",
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /echo-upgrade · /echo-reveal · /echo-reroll · /echo-preset" }),
  },

  set_bonuses: {
    label: "Set Bonuses & Unique Ability",
    description: "Element affinity, 2pc/4pc/5pc effects, your passive",
    emoji: "✨",
    embed: () => new EmbedBuilder()
      .setColor(C.spectro)
      .setTitle("✨  Set Bonuses & Unique Ability")
      .setDescription("All bonuses apply in **every** combat type — encounters, dungeons, duels, raids, ascension.")
      .addFields(
        {
          name:  "Element Affinity",
          value: "Each equipped echo matching your element = **+3% Elemental DMG**. Full mono (5 matching) = +15%.",
          inline: false,
        },
        {
          name:  "2-Piece Set Bonuses",
          value: "🔥 Fusion: +8% ATK  ·  ❄️ Glacio: +12% DEF  ·  ⚡ Electro: +12 Energy/turn\n🌪️ Aero: +5% Crit Rate  ·  🌑 Havoc: 6% Lifesteal  ·  ✨ Spectro: +8% HP",
          inline: false,
        },
        {
          name:  "4-Piece Set Bonuses",
          value: "🔥 First Skill +30% DMG  ·  ❄️ 25% chance block 30% DMG  ·  ⚡ Ultimate +30% DMG\n🌪️ Basic 20% chance ×2 hit  ·  🌑 Shatter heals 15% HP  ·  ✨ +10 Energy/turn",
          inline: false,
        },
        {
          name:  "5-Piece Set Bonuses",
          value: "🔥 Below 50% HP: +25% Crit Rate  ·  ❄️ Full HP: +20% DMG  ·  ⚡ Post-Ultimate: Skill resets\n🌪️ First action +50% DMG  ·  🌑 Vib drain +25% faster  ·  ✨ Regen 3% HP/turn",
          inline: false,
        },
        {
          name:  "Unique Passive Ability",
          value: "Generated by AI after your first Ascension win — based on your onboarding answers, playstyle, and element. Has real combat effects (ATK boost, Crit Rate, Lifesteal, conditional buffs, etc.). No two players get the same ability. View on `/profile`.",
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /echoes shows active bonuses" }),
  },

  encounters: {
    label: "Encounters",
    description: "How enemies spawn, turn-based combat, explore channels",
    emoji: "⚔️",
    embed: () => new EmbedBuilder()
      .setColor(C.red)
      .setTitle("⚔️  Encounters")
      .setDescription(
        `Enemies appear **while you chat**. Each message has a chance to spawn one.\n\n` +
        `**Spawn rates:**\n` +
        `› Regular channels: 13% per message, 2-min cooldown\n` +
        `› Explore channels: 38% per message, 30-sec cooldown\n\n` +
        `**3-cost field enemies** appear from WL0 (15% chance), scaling to 75% at WL8.\n` +
        `**Enemy strength scales to the fighter's level + gear** — same enemy, different challenge per player.`
      )
      .addFields(
        {
          name:  "Combat Flow",
          value: [
            `First to click ⚔️ **Fight** gets the battle (turn-based, private to them).`,
            `**Basic Attack** — always available, builds energy`,
            `**Resonance Skill** — 3-turn cooldown, 1.8× damage, bigger Vib drain`,
            `**Ultimate** — costs 100 energy, 3.5× damage`,
            `**Flee** — exit safely, no echo drop`,
            `Drain the **Vibration Bar** to **Shatter** — enemy stunned **1 turn**, DEF 0, all crits.`,
            `Win → guaranteed echo drop (rarity varies by enemy tier + WL).`,
          ].join("\n"),
          inline: false,
        },
        {
          name:  "Drop Rarity",
          value: "1-cost: mostly 3★  ·  3-cost: mostly 3★, some 4★\nAll set bonuses + unique ability apply in encounter fights.",
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  Enemies spawn while you chat" }),
  },

  dungeons: {
    label: "Dungeons",
    description: "Echo dungeons, material dungeons, boss trials — /dungeon",
    emoji: "🏯",
    embed: () => new EmbedBuilder()
      .setColor(C.primary)
      .setTitle("🏯  Dungeons")
      .setDescription(
        `Use \`/dungeon\` — choose a dungeon, fight **3 waves**, claim rewards.\n` +
        `HP carries between waves. Die mid-run → no reward.\n\n` +
        `**No hard cooldowns.** Dungeons use the **Resonance Aura** system instead:\n` +
        `◈◈◈◈◈ 5 charges max · Regens 1 charge every **3 hours** · Normal = 1 ◈ · Boss Trials = 2 ◈\n\n` +
        `Enemies scale with your World Level (+15% per WL).`
      )
      .addFields(
        {
          name:  "🔮  Echo Dungeons (Lv5+, 6 total — one per element, 1 ◈)",
          value: [
            `› 3 waves → element-matched echoes + 3× Resonance EXP`,
            `› Drop count: WL0–1: 5 echoes · WL2–3: 6 · WL4–5: 7 · WL6+: 8`,
            `🔥 Emberbrand · ❄️ Frostholm · ⚡ Stormwire · 🌪️ Galerift · 🌑 Voidshear · ✨ Radiant`,
          ].join("\n"),
          inline: false,
        },
        {
          name:  "⚙️  Material Dungeons (Lv3+, 5 total, 1 ◈)",
          value: [
            `› 🔧 Resonance Forge (Lv3) — **14** Tuning Modules`,
            `› 📀 Memory Vault (Lv3) — **6** Resonance Records + big EXP`,
            `› 🧪 Sealed Archive (Lv5) — **9** Sealing Tubes`,
            `› ⚙️ Forging Grounds (Lv5) — **12** Forging Ores`,
            `› 🔮 Paradox Crucible (Lv20 + WL1) — **5** Paradox Cores`,
          ].join("\n"),
          inline: false,
        },
        {
          name:  "💀  Boss Echo Trials (9 total, 2 ◈ each) — guaranteed 4-cost echo on win",
          value: [
            `› 🌑 Wraith's Trial (Lv15) · ❄️ Tidecaller's Trial (Lv25, WL1)`,
            `› 🔥 Embercrown's Trial (Lv30, WL1) · ⚡ Arbiter's Trial (Lv35, WL2)`,
            `› ⚡ Nullfire's Trial (Lv45, WL3) · 🌪️ Galeborne's Trial (Lv50, WL3)`,
            `› 🌑 Sable's Trial (Lv55, WL4) · ✨ Auric's Trial (Lv65, WL5)`,
            `› ✦ Trial of the Absolute (Lv80, WL7) — final challenge`,
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /dungeon" }),
  },

  social: {
    label: "Social: Vibe & Affinity",
    description: "Interactions, affinity ranks, loot categories",
    emoji: "💬",
    embed: () => new EmbedBuilder()
      .setColor(C.aero)
      .setTitle("💬  Social: Vibe & Affinity")
      .setDescription(
        `**Socializing is the primary resource generator.** You cannot reach endgame without interacting.\n\n` +
        `\`/vibe [action] @[target]\` — 21 actions across 3 categories:`
      )
      .addFields(
        { name: "Physical (hug, pat, poke, tackle...)", value: "Best loot. Drops Tuning Modules, Sealing Tubes, Forging Ores. Target gets a **Return** button — both get **2× loot** if clicked.", inline: false },
        { name: "Expressive (wave, cheer, dance...)",   value: "Credits + Resonance Records focus. Works solo.", inline: false },
        { name: "Emotional (comfort, encourage...)",    value: "EXP focus. Good for leveling through interaction.", inline: false },
        { name: "Affinity", value: "+10 per interaction, +20 for a returned action. 6 ranks: Strangers → Acquainted → Familiar → Warm Affinity → Deep Harmony → Resonant Soul.\nCheck: `/affinity @user`", inline: false },
      )
      .setFooter({ text: "CARTETHYIA  ·  /vibe" }),
  },

  bonds: {
    label: "Bonds",
    description: "Friend, Partner, and Adoption bonds",
    emoji: "🔗",
    embed: () => new EmbedBuilder()
      .setColor(C.spectro)
      .setTitle("🔗  Bonds")
      .setDescription("Permanent relationships that appear on both profile cards. Requires high Affinity.")
      .addFields(
        { name: "Friend Bond",          value: "Requires Familiar rank. Basic mutual bond.", inline: false },
        { name: "Partner Bond",         value: "Requires Warm Affinity. One Partner at a time.", inline: false },
        { name: "Adoption (Parent/Child)", value: "Requires Familiar rank. One player adopts the other.", inline: false },
        { name: "Forming & Breaking",   value: "`/bond create type:Friend target:@user` → they Accept/Decline. Both get a Resonance Record on formation.\n`/bond break` removes it from both profiles.", inline: false },
      )
      .setFooter({ text: "CARTETHYIA  ·  /bond create" }),
  },

  daily: {
    label: "Daily Reward",
    description: "/daily — streak system, multipliers, Streak Shields",
    emoji: "📅",
    embed: () => new EmbedBuilder()
      .setColor(C.gold)
      .setTitle("📅  Daily Reward")
      .setDescription(
        `Use \`/daily\` once every **20 hours**. Missing a day breaks your streak.\n\n` +
        `**Base rewards scale with your level:**\n` +
        `Credits: \`(100 + level × 5) × streak multiplier\`\n\n` +
        `**Streak Multipliers:**\n` +
        `› Day 3+: **1.25×**  ·  Day 7+: **1.5×**  ·  Day 14+: **2×**  ·  Day 30+: **3×**\n\n` +
        `**Bonus loot unlocks at streak milestones:**\n` +
        `› Day 3+: 🔧 Tuning Modules\n` +
        `› Day 7+: 🧪 Sealing Tubes · ⚙️ Forging Ores\n` +
        `› Day 14+: 🌙 Lunakite\n\n` +
        `**Every 7 days** of consecutive claims earns a **Streak Shield** — automatically protects your streak once if you miss a day (auto-consumed).\n\n` +
        `**DM Reminders:** Enable a 20h reminder DM so you never forget to claim. Toggle from the \`/daily\` response embed.`
      )
      .setFooter({ text: "CARTETHYIA  ·  /daily · 20h cooldown" }),
  },

  dispatch: {
    label: "Dispatch — Passive Farming",
    description: "Send your character on AFK expeditions",
    emoji: "🗺️",
    embed: () => new EmbedBuilder()
      .setColor(C.havoc)
      .setTitle("🗺️  Dispatch — Passive Farming")
      .setDescription(
        `Farm resources while offline.\n\n` +
        `\`/dispatch send\` — choose 4h / 8h / 12h\n` +
        `\`/dispatch claim\` — collect when done\n` +
        `\`/dispatch status\` — check remaining time\n\n` +
        `**Rewards scale with:** Level · World Level · Duration\n\n` +
        `**Drops:** Credits, Tuning Modules, Sealing Tubes, Forging Ores, Resonance Records\n` +
        `WL1+: Paradox Cores · Rare: Lunakite`
      )
      .setFooter({ text: "CARTETHYIA  ·  /dispatch send" }),
  },

  ascension: {
    label: "Ascension — Boss Trials",
    description: "Break your level cap, fight bosses, earn your unique ability",
    emoji: "⚡",
    embed: () => new EmbedBuilder()
      .setColor(C.fusion)
      .setTitle("⚡  Ascension — Boss Trials")
      .setDescription(
        `At your level cap, use \`/ascend\` — a private thread fight vs the current World Level boss.\n` +
        `**Same combat system:** Basic / Skill (3-turn cd) / Ultimate (100 energy) / Flee.\n\n` +
        `**Shatter:** drain the Vibration Bar → boss stunned **1 turn**, DEF 0, all crits.\n` +
        `**Enrage at ≤40% HP:** boss ATK ×1.6, always uses its strongest move, vib bar only recovers 60% after shatter.\n\n` +
        `**All 9 Ascension Bosses:**`
      )
      .addFields(
        {
          name: "WL0–4",
          value: [
            `🌑 WL0 — Resonant Wraith (Lv20 cap)`,
            `❄️ WL1 — Tidecaller Sovereign (Lv40 cap)`,
            `✨ WL2 — Fractured Arbiter (Lv50 cap)`,
            `⚡ WL3 — Nullfire Construct (Lv60 cap)`,
            `🌑 WL4 — Sable Harbinger (Lv70 cap)`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "WL5–8",
          value: [
            `✨ WL5 — Auric Colossus (Lv80 cap)`,
            `🔥 WL6 — Embercrown Tyrant (Lv84 cap)`,
            `🌪️ WL7 — Galeborne Phantom (Lv88 cap)`,
            `✨ WL8 — The Resonant Absolute (Lv90 max)`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Win Rewards",
          value: `WL +1 · Level cap raised · Materials\n**First ascension only:** AI-generated Unique Passive Ability — based on your playstyle, element, and onboarding. Real combat effects (ATK%, Crit, Lifesteal, conditional buffs...). No two players get the same ability. Shown as a cinematic card, viewable on \`/profile\`.`,
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /ascend when you hit your level cap" }),
  },

  boss_challenges: {
    label: "Boss Challenges & Field Bosses",
    description: "Re-fight cleared bosses, challenge field bosses — /boss · /field-boss",
    emoji: "👊",
    embed: () => new EmbedBuilder()
      .setColor(C.red)
      .setTitle("👊  Boss Challenges & Field Bosses")
      .setDescription(
        `Both commands cost **Resonance Aura (◈)** — same pool as dungeons.\n` +
        `Aura: 5 max · Regens 1 every 3 hours.`
      )
      .addFields(
        {
          name: "⚔️  /boss — Re-Challenge Cleared Bosses (1 ◈ Aura, no cooldown)",
          value: [
            `Fight any ascension boss you've already defeated.`,
            `**Veteran scaling** — the more overleveled you are, the harder the boss gets.`,
            `**Enrage at 40% HP** — same as ascension.`,
            `**Win:** 70% of normal ascension loot. Lose → no cooldown set, retry freely.`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "🌿  /field-boss — Open World Bosses (costs 1 ◈ Resonance Aura)",
          value: [
            `6 permanent bosses — one per element. Available from **Lv5**, no WL requirement.`,
            `Scale purely with your level + gear (no veteran penalty).`,
            `**Win:** 1 guaranteed **4-cost echo** of that element (4★/5★) + Credits.`,
            `🔥 Ignis Behemoth · ❄️ Permafrost Sovereign · ⚡ Voltaic Aberrant`,
            `🌪️ Tempest Ancient · 🌑 Null Ravager · ✨ Luminal Specter`,
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /boss · /field-boss" }),
  },

  wish: {
    label: "Resonance Wish — Gacha",
    description: "Pull 4★ and 5★ weapons with Fracture Keys — /wish",
    emoji: "🗝️",
    embed: () => new EmbedBuilder()
      .setColor(0xA855F7)
      .setTitle("🗝️  Resonance Wish — Gacha Banner")
      .setDescription(
        `Spend 🗝️ **Fracture Keys** to pull weapons from the Resonance Banner.\n` +
        `Each pull costs **1 Fracture Key**. Use \`/wish\` to open the banner.`
      )
      .addFields(
        {
          name: "Pull Rates",
          value: [
            `**5★** — 1.5% base · soft pity starts at pull 65 · hard pity at 80 (guaranteed)`,
            `**4★** — guaranteed every 10 pulls`,
            `**3★** — everything else → drops Forging Ores, Tuning Modules, or Credits instead of a weapon`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "50/50 System",
          value: [
            `Your first 5★ has a **50% chance** to be your chosen Resonance Target.`,
            `If you lose the 50/50, your **next 5★ is guaranteed** to be your target.`,
            `Set or change your target from the \`/wish\` banner with the dropdown.`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Weapon Stats & Hidden Substats",
          value: [
            `4★ and 5★ weapons show their **base ATK** and **primary substat** on the banner.`,
            `Each weapon has **hidden substats** — revealed as you level the weapon up (Lv20 / Lv50).`,
            `Stats scale with weapon level all the way to Lv90.`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Earning Fracture Keys",
          value: [
            `› Boss clears: **1–3 keys** depending on World Level (WL0–4: 1 · WL5–7: 2 · WL8: 3)`,
            `› Dungeon clears: **1 key** per clear`,
            `› Ascension wins: **2 keys** per win`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Wish Pool",
          value: [
            `**4★ Weapons:** Dawnbreaker (Sword) · Gravemaw (Broadblade) · Scatter Hex (Pistols) · Ether Codex (Rectifier)`,
            `**5★ Weapons:** Oathbreaker's Edge (Sword) · Ruin Sovereign (Broadblade) · Null Fangs (Pistols) · Abyssal Tome (Rectifier)`,
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /wish" }),
  },

  admin: {
    label: "Admin & Setup",
    description: "For server admins — the interactive /setup panel (Manage Server)",
    emoji: "🛠️",
    embed: () => new EmbedBuilder()
      .setColor(C.primary)
      .setTitle("🛠️  Admin & Setup")
      .setDescription(
        `Run \`/setup\` — a single interactive panel covering every server setting.\n` +
        `Requires **Manage Server**. All changes apply instantly.\n​`
      )
      .addFields(
        {
          name:  "⚔️  Chat Encounters toggle",
          value: "Enable or disable enemy spawns server-wide with one button click.",
          inline: false,
        },
        {
          name:  "📍  Encounter Channels",
          value: "Channel select menu — pick which channels enemies can spawn in. **Leave empty = spawns everywhere.** Use this to keep encounters out of serious channels.",
          inline: false,
        },
        {
          name:  "🗺️  Explore Channel",
          value: "Channel select — marks a channel as a high-rate grind zone (**38% spawn rate**, 30s cooldown vs 13% / 2min everywhere else).",
          inline: false,
        },
        {
          name:  "👋  Welcome Channel",
          value: "Channel select — new members are auto-onboarded here with a welcome card and prompt to `/start`. Clear to disable (members opt in manually).",
          inline: false,
        },
        {
          name:  "⌨️  Text Prefix",
          value: "Pick from preset options (`c!`, `cart!`, `!`, `bot!`) or choose **Custom…** to type your own. The global default is `c!` — no setup needed.",
          inline: false,
        },
        {
          name:  "Other",
          value: "`/raid start [world_level]` — launches a co-op Calamity Raid (Manage Server only). Players join via `/raid join`.",
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /setup — one command, everything in one place" }),
  },

  pvp: {
    label: "PvP: Duels",
    description: "1v1 turn-based PvP — /duel",
    emoji: "⚔️",
    embed: () => new EmbedBuilder()
      .setColor(C.red)
      .setTitle("⚔️  Duels — 1v1 PvP")
      .setDescription(
        `\`/duel @player\` — challenge someone. They have 60 seconds to accept.\n` +
        `Fight starts in a private thread with alternating turns.\n\n` +
        `**Element weaknesses apply:**\n` +
        `Fusion ↔ Glacio · Electro ↔ Aero · Havoc ↔ Spectro (counter-element = 1.5× damage)\n\n` +
        `**Actions:** Basic / Skill (3-turn cd) / Ultimate (100 energy) / Forfeit\n\n` +
        `**Rules:**\n` +
        `› First to reach 0 HP loses\n` +
        `› No action in 10 minutes = auto-loss\n` +
        `› **Winner:** +300 💠 Credits + 50 EXP\n` +
        `› Thread auto-deletes 5 minutes after the fight ends`
      )
      .setFooter({ text: "CARTETHYIA  ·  /duel @player" }),
  },

  raids: {
    label: "Calamity Raids",
    description: "Co-op boss fights — /raid",
    emoji: "☄️",
    embed: () => new EmbedBuilder()
      .setColor(0xEC4899)
      .setTitle("☄️  Calamity Raids — Co-op Boss")
      .setDescription(
        `Server-wide boss event. Owner starts with \`/raid start [world_level]\`.\n\n` +
        `**Flow:**\n` +
        `1. Join via \`/raid join\` or the **Join Raid** button (2–6 players)\n` +
        `2. Owner starts early with \`/raid begin\`, or auto-starts after 5 minutes\n` +
        `3. Fight in a public thread — **round-robin turns** (each player acts, then boss AoEs all)\n\n` +
        `**Mechanics:**\n` +
        `› Shatter system on the shared boss HP bar\n` +
        `› AoE boss attacks hit all alive participants each round\n` +
        `› Skipped turns (timeout) auto-advance\n` +
        `› Fallen players can't act but the raid continues\n\n` +
        `**Win rewards:** Split among all survivors (scaled 1.5×, divided by player count)\n` +
        `Contribution leaderboard shown at the end.\n\n` +
        `\`/raid end\` — cancel active raid (owner only)`
      )
      .setFooter({ text: "CARTETHYIA  ·  /raid start · /raid join · /raid begin" }),
  },

  weapons: {
    label: "Weapons & Forge",
    description: "Weapon types, forging, equipping",
    emoji: "🗡️",
    embed: () => new EmbedBuilder()
      .setColor(C.green)
      .setTitle("🗡️  Weapons & Forge")
      .setDescription(
        `Weapons add **base ATK** and a **sub-stat**. Equip one to boost combat power.\n\n` +
        `**Types:**\n` +
        `› Broadblade — high ATK, DEF sub\n` +
        `› Sword — balanced ATK, Crit Rate sub\n` +
        `› Pistols — lower ATK, Speed sub\n` +
        `› Rectifier — mid ATK, Energy Regen sub\n\n` +
        `**Rarities:** 1★ (2 ores) · 2★ (5 ores) · 3★ (12 ores)\n\n` +
        `**Upgrade:** \`/weapon-upgrade\` levels a weapon (1→90) with ⚙️ Forging Ores — ` +
        `ATK scales from base × 1 at Lv1 to base × 2.5–3.5 at Lv90 (by rarity). Sub-stat grows 1.8× by Lv90.\n` +
        `Buttons: **+1**, **+10**, **Auto Max** — one transaction regardless of how many levels.\n\n` +
        `\`/forge\` · \`/equip\` · \`/weapon\` · \`/weapon-upgrade\``
      )
      .setFooter({ text: "CARTETHYIA  ·  /forge · /equip · /weapon · /weapon-upgrade" }),
  },

  shop: {
    label: "Shop & Leaderboard",
    description: "Spend Credits/Lunakite, view server rankings",
    emoji: "🏪",
    embed: () => new EmbedBuilder()
      .setColor(C.gold)
      .setTitle("🏪  Shop & Leaderboard")
      .addFields(
        {
          name:  "💠  /shop — Resonance Shop",
          value: [
            `**Credits:** 🔧 80 · 🧪 120 · ⚙️ 100 · 🛡️ 300 · 🔒 500 · 📀 500 · 🔮 750`,
            `**Lunakite:** Bundle deals — 5 modules / 3 tubes / 3 records / 1 core for 1–2 🌙`,
            `Pick quantity (×1, ×3, ×5, ×10) then confirm.`,
          ].join("\n"),
          inline: false,
        },
        {
          name:  "📊  /leaderboard — Server Rankings",
          value: [
            `Select a category from the dropdown:`,
            `📈 Level  ·  ⚡ World Level  ·  💬 Social Activity`,
            `🎴 Echo Collection  ·  💠 Credits  ·  🔥 Daily Streak`,
            `Top 10 shown. Your rank appears in the footer if you're outside top 10.`,
          ].join("\n"),
          inline: false,
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  /shop · /leaderboard" }),
  },
};
