import "dotenv/config";
import { attachProcessHandlers, logInfo } from "./lib/logger";
attachProcessHandlers(); // must be first — catches everything from this point on

import {
  Client,
  GatewayIntentBits,
  Collection,
  Partials,
} from "discord.js";
import fs from "fs";
import path from "path";
import { ExtendedClient, Command } from "./types";

// ── Create client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
}) as ExtendedClient;

client.commands = new Collection<string, Command>();

// ── Load Commands ─────────────────────────────────────────────────────────────
function loadCommands(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(fullPath);
      const command: Command = mod.default ?? mod;

      if (command?.data && typeof command.execute === "function") {
        client.commands.set(command.data.name, command);
        console.log(`  ✓ Loaded command: /${command.data.name}`);
      }
    }
  }
}

console.log("📦 Loading commands...");
loadCommands(path.join(__dirname, "commands"));

// ── Load Events ───────────────────────────────────────────────────────────────
function loadEvents(dir: string) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const event = require(path.join(dir, file));

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }

    console.log(`  ✓ Loaded event: ${event.name}`);
  }
}

console.log("⚡ Loading events...");
loadEvents(path.join(__dirname, "events"));

// ── Login ─────────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN is missing from .env!");
  process.exit(1);
}

const TOPGG_TOKEN  = process.env.TOPGG_TOKEN ?? "";
const BOT_ID       = process.env.CLIENT_ID ?? "1510163339177623642";

async function postTopggStats() {
  if (!TOPGG_TOKEN) return;
  const serverCount = client.guilds.cache.size;
  try {
    const res = await fetch(`https://top.gg/api/bots/${BOT_ID}/stats`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": TOPGG_TOKEN },
      body:    JSON.stringify({ server_count: serverCount }),
    });
    if (res.ok) console.log(`[topgg] Posted stats: ${serverCount} servers`);
    else console.warn(`[topgg] Stats post failed: ${res.status}`);
  } catch (e) {
    console.error("[topgg] Stats post error:", e);
  }
}

client.login(token).then(() => {
  console.log("🚀 Cartethyia is starting up...");
  logInfo("Bot started successfully");

  // Start vote webhook (DBL + top.gg — no-op if auth env vars unset)
  const { startVoteWebhook } = require("./lib/voteWebhook");
  startVoteWebhook(client);

  // Post server count to top.gg once ready, then every 30 min
  client.once("ready", () => {
    setTimeout(postTopggStats, 10_000); // wait 10s for guild cache
    setInterval(postTopggStats, 30 * 60 * 1000);
  });
});
