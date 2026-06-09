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

client.login(token).then(() => {
  console.log("🚀 Cartethyia is starting up...");
  logInfo("Bot started successfully");

  // Start top.gg vote webhook (no-op if TOPGG_WEBHOOK_AUTH is unset)
  const { startVoteWebhook } = require("./lib/voteWebhook");
  startVoteWebhook(client);
});
