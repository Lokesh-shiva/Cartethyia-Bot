# ◈ CARTETHYIA — Resonance RPG

A fully-featured turn-based RPG Discord bot. Enemies spawn while your members chat, echoes are collected from battles, and every player forges a unique AI-generated ability on their first ascension.

---

## ✨ Features

- **Turn-based combat** — Basic Attack · Resonance Skill · Ultimate · Vibration Bar / Shatter system
- **Echo System** — 30+ echoes, Resonance Grid (12-point budget), set bonuses, substat scaling to Lv25
- **6 Elements** — each with innate stats and a unique combat hook, chosen at Lv20
- **9 World Levels** — broken by defeating ascension bosses, up to Lv90
- **AI Unique Ability** — generated on first ascension win, powered by a local LLM (Ollama)
- **Dungeons** — echo dungeons, material dungeons, boss trials (Resonance Aura system)
- **Field Bosses** — 6 open-world bosses, one per element
- **Boss Challenges** — re-fight any cleared ascension boss
- **Social System** — 21 `/vibe` actions, Affinity ranks, Friend/Partner/Adoption bonds
- **Dispatch** — passive AFK farming (4h / 8h / 12h)
- **Daily rewards** — 20h cooldown, streak multipliers up to 3×, Streak Shields
- **Weapons & Forge** — 4 weapon types, upgrade to Lv90
- **Duels** — 1v1 PvP in private threads
- **Raids** — co-op boss fights (2–6 players)
- **Canvas cards** — profile, echo, resonance grid — all rendered with `@napi-rs/canvas`
- **Multi-server** — per-server configuration, encounter channel allowlists, explore zones

---

## 🛠 Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (CommonJS, tsx) |
| Discord | discord.js v14 |
| Database | Neon PostgreSQL |
| ORM | Prisma v7 + `@prisma/adapter-pg` |
| AI | Ollama — `qwen2.5:0.5b` (local, no external API) |
| Canvas | `@napi-rs/canvas` |
| Process Manager | PM2 |

---

## 🚀 Self-Hosting

### Prerequisites
- Node.js 20+
- Neon PostgreSQL database
- Ollama (optional — fallback strings handle offline AI)

### 1. Clone & install
```bash
git clone https://github.com/Lokesh-shiva/Cartethyia-Bot.git
cd Cartethyia-Bot
npm install
```

### 2. Environment variables
Create a `.env` file:
```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id
DATABASE_URL=your_neon_connection_string

# Optional — AI narration (Ollama)
LM_STUDIO_URL=http://localhost:11434/v1
LM_STUDIO_MODEL=qwen2.5:0.5b
```

### 3. Database
```bash
npx prisma generate
npm run db:push
```

### 4. Deploy commands
```bash
npm run deploy              # guild only (instant)
GLOBAL=true npm run deploy  # all servers (up to 1 hour)
```

### 5. Start
```bash
npm start

# or with PM2 (production)
npm install -g pm2
pm2 start npm --name "cartethyia" -- start
pm2 save && pm2 startup
```

---

## ⚙️ Admin Setup (in Discord)

After inviting the bot, configure your server:

```
/setup encounters enabled:true
/setup encounter-channel #your-chat-channel
/setup explore-channel #your-grind-channel
/setup welcome-channel #your-welcome-channel
```

---

## 🤖 AI (Local LLM)

Cartethyia uses a **local LLM via Ollama** — no external AI APIs, no user data sent anywhere.

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull model
ollama pull qwen2.5:0.5b   # lightweight (397MB)
# or
ollama pull qwen2.5:7b     # higher quality (4.4GB, needs 8GB+ RAM)
```

If Ollama is offline, hardcoded fallback strings handle all AI responses gracefully.

---

## 📁 Project Structure

```
src/
├── commands/
│   ├── rpg/          # ascend, boss, dungeon, echo-*, field-boss, etc.
│   ├── social/       # vibe, affinity, bond
│   └── utility/      # guide, ping, setup, start
├── events/           # clientReady, interactionCreate, messageCreate, guildMemberAdd
├── lib/              # canvas cards, combat engine, echo system, set bonuses, AI
└── index.ts

assets/
├── backgrounds/      # profile card backgrounds
├── echoes/           # 1-cost and 3-cost echo art
├── fonts/            # Rajdhani-Bold.ttf
└── icons/

Bosses/               # boss art PNGs (Title Case with spaces)
prisma/               # schema.prisma
```

---

## 📜 Commands

| Category | Commands |
|---|---|
| **RPG** | `/start` `/profile` `/level` `/ascend` `/boss` `/field-boss` `/dungeon` `/dispatch` `/daily` `/ability` `/element` |
| **Echoes** | `/echoes` `/echo` `/echo-equip` `/echo-upgrade` `/echo-reveal` `/echo-reroll` `/echo-preset` |
| **Weapons** | `/forge` `/equip` `/weapon` `/weapon-upgrade` |
| **Economy** | `/inventory` `/shop` `/use` |
| **Social** | `/vibe` `/affinity` `/bond` |
| **PvP** | `/duel` `/raid` |
| **Utility** | `/guide` `/ping` `/leaderboard` `/setup` |

---

## 🌍 World Levels & Bosses

| WL | Boss | Element | Level Cap |
|---|---|---|---|
| 0 | Resonant Wraith | HAVOC | 20 |
| 1 | Tidecaller Sovereign | GLACIO | 40 |
| 2 | Fractured Arbiter | SPECTRO | 50 |
| 3 | Nullfire Construct | ELECTRO | 60 |
| 4 | Sable Harbinger | HAVOC | 70 |
| 5 | Auric Colossus | SPECTRO | 80 |
| 6 | Embercrown Tyrant | FUSION | 84 |
| 7 | Galeborne Phantom | AERO | 88 |
| 8 | The Resonant Absolute | SPECTRO | 90 |

---

## 📄 License

MIT — free to self-host and modify. Please don't claim as your own work.

---

<div align="center">
  <sub>Built with discord.js · Prisma · @napi-rs/canvas · Ollama</sub>
</div>
