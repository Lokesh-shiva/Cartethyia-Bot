/**
 * Run this ONCE to register slash commands with Discord.
 * Run again whenever you add or change commands.
 *
 * Usage: npx tsx src/deploy-commands.ts
 */
import "dotenv/config";
import { REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";

const commands: object[] = [];

function loadCommandData(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommandData(fullPath);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(fullPath);
      const command = mod.default ?? mod;
      if (command?.data) {
        commands.push(command.data.toJSON());
        console.log(`  ✓ Queued: /${command.data.name}`);
      }
    }
  }
}

loadCommandData(path.join(__dirname, "commands"));

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    console.log(`\n🔄 Deploying ${commands.length} slash commands...`);

    // GLOBAL=true → deploy globally (every server, ~1h propagation).
    // Otherwise deploy to GUILD_ID (instant — best for dev/test).
    const guildId = process.env.GUILD_ID;
    const global  = process.env.GLOBAL === "true" || !guildId;

    if (global) {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID!),
        { body: commands }
      );
      console.log("✅ GLOBAL commands deployed — available in every server (may take up to 1 hour to appear).");
    } else {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID!, guildId!),
        { body: commands }
      );
      console.log(`✅ Guild commands deployed to ${guildId} (instant). Set GLOBAL=true to deploy everywhere.`);
    }
  } catch (error) {
    console.error("❌ Deployment failed:", error);
  }
})();
