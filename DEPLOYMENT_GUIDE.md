# CARTETHYIA — Deployment, Hosting, Legal & Monetization Guide

A practical, honest walkthrough to take the bot from your test server to a public, hosted,
legally-compliant, monetizable Discord bot. Read top to bottom the first time.

---

## 0. Reality check on "free"

There are three things that must run somewhere:

| Piece | What it needs | Truly-free option |
|---|---|---|
| **The bot** (Node process) | A machine that stays on 24/7 with a persistent gateway connection | **Oracle Cloud Always Free VM** or a home PC/Pi |
| **The AI** (narration + abilities) | An OpenAI-compatible chat endpoint | **Groq** free API (best) or Google Gemini free tier |
| **The database** | Postgres | **Neon free tier** (already using it) |

> ⚠️ Most "free" app hosts (Render free, Replit free, Railway) **sleep after inactivity or cap monthly hours**.
> A Discord bot must stay connected 24/7, so a sleeping host = an offline bot. The two reliable free paths
> are **Oracle Always Free** (a real always-on VM) or **self-hosting** (home PC / Raspberry Pi). Everything
> else costs ~$5/mo once you outgrow trials.

---

## 1. Swap the AI to a free hosted model (do this first)

Right now the bot talks to **LM Studio at `http://localhost:1234`** — that only works on your PC with a GPU.
For hosting, point it at **Groq** (free, fast, OpenAI-compatible — drops straight into the existing code).

### Steps
1. Make a free account at **console.groq.com** → create an API key.
2. In your `.env`, change:
   ```
   LM_STUDIO_URL=https://api.groq.com/openai/v1
   LM_STUDIO_MODEL=llama-3.3-70b-versatile
   GROQ_API_KEY=gsk_...        # your key
   ```
3. In `src/lib/ai.ts`, the client uses `apiKey: "lm-studio"`. Change it to read the real key:
   ```ts
   const client = new OpenAI({
     baseURL: process.env.LM_STUDIO_URL || "http://localhost:1234/v1",
     apiKey:  process.env.GROQ_API_KEY || "lm-studio",
   });
   ```
4. Done. The bot already has hardcoded fallbacks for every AI call, so if Groq is rate-limited or down,
   nothing breaks — you just get the fallback text.

**Alternatives:** Google **Gemini** (free tier, has an OpenAI-compatible URL), **OpenRouter** (some free models),
**Cloudflare Workers AI**. All swap in the same way (change baseURL + key + model). Keep LM Studio only if you
self-host on a machine that has a GPU.

---

## 2. Host the bot — Option A: Oracle Cloud Always Free (recommended free 24/7)

Oracle gives a genuinely-free-forever ARM VM (up to 4 cores / 24 GB RAM). Plenty for this bot.

1. Sign up at **cloud.oracle.com** (needs a card for identity check; not charged on Always Free).
2. Create a **VM instance** → shape **VM.Standard.A1.Flex** (ARM, Always Free eligible), Ubuntu 22.04.
3. SSH in. Install Node 20+:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```
4. Clone your repo, `npm install`, create the `.env` (Discord token, Neon `DATABASE_URL`, Groq vars).
5. Run it persistently with **pm2** so it restarts on crash/reboot:
   ```bash
   sudo npm i -g pm2
   pm2 start "npm start" --name cartethyia
   pm2 save && pm2 startup     # auto-start on reboot
   ```
6. `pm2 logs cartethyia` to watch output. (Your `logs/*.txt` error files are also written there.)

### Option B: Self-host (home PC / Raspberry Pi)
Same as above minus Oracle — just run `pm2 start "npm start"` on a machine you leave on. Cheapest if you
already have a Pi. Downside: your home IP/uptime/power.

### Option C: Paid PaaS (when you want zero-ops, ~$5/mo)
**Railway** or **Fly.io** — push the repo, set env vars, deploy. Easiest but not free long-term.
Make sure it's a **worker / always-on service**, not a web service that sleeps.

> **@napi-rs/canvas note:** the canvas cards need system libs. On Ubuntu they ship prebuilt, but if image
> generation errors on the host, install: `sudo apt-get install -y libfontconfig1`. Also copy the
> `assets/` and `Bosses/` folders to the server (they hold fonts, echo art, boss art).

---

## 3. Deploy commands globally + invite to servers

### Make commands appear in every server
On your test server you deploy to one guild (instant). For public use, deploy **globally**:
```bash
GLOBAL=true npm run deploy
```
(or remove `GUILD_ID` from `.env`). Global commands take up to ~1 hour to propagate the first time.

### Enable privileged intents (required)
Discord Dev Portal → your app → **Bot** → enable:
- **Message Content Intent** (chat EXP + AI narration context + encounters)
- **Server Members Intent** (member-join onboarding)

### Generate the invite link
Dev Portal → **OAuth2 → URL Generator**:
- **Scopes:** `bot` + `applications.commands`
- **Bot Permissions:** Send Messages · Embed Links · Attach Files · Read Message History ·
  Create Public Threads · Create Private Threads · Send Messages in Threads · Use External Emojis ·
  Add Reactions
- Copy the generated URL → that's your invite link. Share it / put it on a landing page.

> **Manage Emojis is NOT needed** — the bot uses application emojis now.

### Public vs private
Dev Portal → Bot → **Public Bot** toggle. ON = anyone can invite it. OFF = only you can.

### First-run in a new server
An admin should run **`/setup encounter-channel #some-channel`** so encounters don't fire everywhere,
and optionally **`/setup welcome-channel #welcome`** for auto-onboarding. Without setup, encounters
default to all channels and onboarding is opt-in via `/start`.

---

## 4. Legal — Terms of Service & Privacy Policy (required at scale)

Discord **requires** a Terms of Service URL and Privacy Policy URL for verified bots, and you must verify
once you hit **100 servers** (they check identity + these documents). Have them ready before you grow.

### What your Privacy Policy must cover
- **What you store:** Discord user IDs, usernames/display names, avatars (URL), and game progress
  (levels, currencies, echoes, bonds, combat records). You do **not** store message content beyond the
  transient recent-message context passed to the AI (state this).
- **Why:** to run the game (persist progress, render cards, generate AI narration).
- **Third parties:** Neon (database hosting), Groq/Google (AI processing of the short prompt text).
- **Retention & deletion:** how a user can request deletion (e.g. "DM the bot owner / run `/reset` /
  email X") and that data is removed.
- **Contact:** an email or Discord server for privacy requests.

### What your Terms of Service must cover
- The bot is provided "as is", no warranty.
- Users must follow Discord's Terms & Community Guidelines.
- You may rate-limit / ban abusers and reset data.
- No real-money value to in-game items (important — see monetization).
- Right to change the service.

### Where to host the two documents (free)
- **GitHub Pages** — put `privacy.md` and `terms.md` in a repo, enable Pages → you get public URLs.
- Or a **GitHub Gist**, **Carrd** (free one-page site), or **Notion public page**.
- Paste both URLs into Dev Portal → **General Information → Terms of Service URL / Privacy Policy URL**.

> Use a generator to start (e.g. a "Discord bot privacy policy template") then edit to match the data list
> above. Don't ship a blank one — Discord verification reviewers read them.

---

## 5. Monetization — how to actually earn from it (legally)

**Golden rule:** sell **cosmetics & convenience, never power.** Selling combat advantage, or real-money
loot boxes / gambling mechanics, violates Discord's monetization terms and app-store-style rules in many
regions. Keep paid stuff fair.

### A. Discord's native monetization (the legit, built-in way)
Discord has **Premium App Subscriptions** + **one-time purchases (SKUs)**:
- Dev Portal → **Monetization**. Requires: app is **verified**, you're in a supported country, have a
  team set up, and accept the monetization terms.
- You create **SKUs** (e.g. "Resonant Patron — $3/mo"). Discord handles billing and gives you an entitlement
  your bot checks (`entitlements`), then unlocks perks in-game. Discord takes a cut (~10–15%).
- This is the cleanest path: payments, tax, refunds handled by Discord; users buy in-client.

### B. External (Ko-fi / Patreon) + linked perks
- Take donations/subscriptions on **Ko-fi** or **Patreon**.
- Grant perks via **Patreon → Discord linked roles**, or a simple **redeem-code** command you generate for
  supporters, or by checking a "patron" role in their server.
- Pros: no verification needed, you keep more. Cons: you handle delivery/fraud yourself.

### C. What to sell (fair, ToS-safe ideas)
- **Cosmetic profile backgrounds / card frames / name colors** (you already render cards — perfect surface).
- **Extra Dispatch slots / shorter cooldowns** (convenience, not power).
- **Custom unique-ability re-roll token** (cosmetic flavor; keep effect power within normal bounds).
- **Vanity titles, badges, animated card effects.**
- **"Supporter" tag** on the profile card.
- A **global premium currency** that only buys cosmetics (NOT Tuning Modules / combat materials).

### D. What to avoid
- ❌ Selling Tuning Modules / Paradox Cores / echoes / anything that makes you stronger (pay-to-win).
- ❌ Real-money loot boxes / randomized paid rewards (gambling — restricted/illegal in many places).
- ❌ Gating core gameplay behind payment in a way that feels like a paywall on a Discord feature.

### E. Practical first step
Start with **Ko-fi + a `/redeem code` command** that flips a `premiumUntil` field on the user and unlocks
a couple of cosmetic card backgrounds. It's a day of work, needs no verification, and validates whether
people will pay before you invest in Discord's full monetization setup.

---

## 6. Pre-launch checklist

- [ ] AI swapped to Groq (or chosen free provider); fallbacks verified
- [ ] `.env` on host has: `DISCORD_TOKEN`, `CLIENT_ID`, `DATABASE_URL` (Neon), AI vars — **no GUILD_ID** (or use GLOBAL)
- [ ] `assets/` + `Bosses/` folders copied to the host
- [ ] `npx prisma generate` run on the host; DB reachable
- [ ] Privileged intents enabled (Message Content + Server Members)
- [ ] `GLOBAL=true npm run deploy` run once
- [ ] App emojis uploaded (happens automatically on first `ready`)
- [ ] Privacy Policy + ToS written, hosted, and linked in the Dev Portal
- [ ] Bot running under pm2 with `pm2 save && pm2 startup`
- [ ] Tested in a fresh server: `/start`, an encounter, `/setup`, `/profile`
- [ ] Error logs (`logs/*.txt`) being written and readable

---

## 7. When you hit 100 servers

- Discord will require **verification** (identity + the ToS/Privacy URLs above).
- Consider moving DB off Neon free tier (row/storage limits) and the bot to a small paid VM for headroom.
- Add **sharding** (discord.js ShardingManager) only when you approach ~2,000 servers — not before.

---

*Keep this file updated as hosting choices change. The bot itself is multi-server-ready; the work left is
ops + legal + a cosmetic monetization layer.*
