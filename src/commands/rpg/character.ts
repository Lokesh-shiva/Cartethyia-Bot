// src/commands/rpg/character.ts
// Milestone 2d — the seed of the eventual multi-page character profile
// (design spec §9: Stats/Weapon/Echoes/Kit Levels/Constellations/Lore). This
// milestone only implements the Kit Levels page. Deliberately named
// /character (not /solace-kit) so future characters slot into the same
// command's select menu without a new command being added each time.

import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ButtonInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { auditSpend } from "../../lib/antiCheat";
import { CE } from "../../lib/emojiManager";
import {
  MAX_KIT_LEVEL, KitTrack, TRACK_FIELD, getTrackLevel, kitLevelUpCost,
  getOrCreateCharacterProgress,
} from "../../lib/characterProgress";

// Only "solace" exists today — future characters add entries here, and the
// select menu below automatically grows to offer them. No other code in this
// file needs to change when that happens.
const CHARACTERS: Record<string, { label: string; emoji: string }> = {
  solace: { label: "Solace", emoji: "✨" },
};

const TRACK_LABELS: Record<KitTrack, string> = {
  basic:    "⚔️  Chime Strike",
  skill:    "✦  Attunement",
  ultimate: "⚡  Convergence",
  intro:    "🔷  Intro Skill",
  forte:    "🌟  Forte",
};

const VALID_TRACKS = new Set<string>(Object.keys(TRACK_LABELS));
function isKitTrack(value: string): value is KitTrack {
  return VALID_TRACKS.has(value);
}

// ── Constellations (Milestone 3.5d) ───────────────────────────────────────
// Schema-only until Milestone 4's gacha exists — constellation/constellationTokens
// sit at 0 for every player today (see design spec §7). This is the read-only
// display: rank, the 6-tier effect table, and an honest note about the missing
// earn path. Combat-effect wiring is explicitly deferred to Milestone 4, per
// the same design spec section — nothing here should imply these effects are
// live in a fight yet.
const CONSTELLATION_EFFECTS: Record<string, string[]> = {
  solace: [
    "Outro's guaranteed-crit buff also grants the incoming ally +15% ATK for their first action after the swap.",
    "**(Kit change)** Ultimate's heal significantly increased; cleanses 2 debuffs instead of 1.",
    "Switching Attunement Mode (Skill) also grants a team-wide Concerto Energy burst.",
    "**(Kit change)** Intro Skill's heal also grants a shield equal to 30% of the amount healed.",
    "Ultimate's doubled-mode-effect duration extends from 3 turns to 4.",
    "**(Defining)** While one Attunement Mode is active, allies ALSO gain 50% of the other two modes' effects.",
  ],
};
const MAX_CONSTELLATION = 6;

async function buildConstellationsView(userId: string, characterId: string) {
  const progress = await getOrCreateCharacterProgress(userId, characterId);
  const char = CHARACTERS[characterId];
  const tiers = CONSTELLATION_EFFECTS[characterId] ?? [];

  const lines = tiers.map((effect, i) => {
    const tier = i + 1;
    const unlocked = progress.constellation >= tier;
    return `${unlocked ? "✦" : "◇"}  **C${tier}**${unlocked ? "" : " *(locked)*"} — ${effect}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x6366F1)
    .setTitle(`${char.emoji}  ${char.label} — Constellations`)
    .setDescription(
      `**Resonance Chain:** C${progress.constellation}/${MAX_CONSTELLATION}  ·  ` +
      `**Tokens:** ${progress.constellationTokens}\n\n` +
      `${lines.join("\n\n")}\n\n` +
      `*Tokens are earned from duplicate pulls once ${char.label}'s banner exists — this system isn't live yet, ` +
      `so every player is at C0 with 0 tokens for now.*`
    )
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Constellations" });

  return { embed };
}

function navButtons(characterId: string, activePage: "kit" | "con"): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`charnav:${characterId}:kit`).setLabel("⚔️  Kit Levels")
      .setStyle(activePage === "kit" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(activePage === "kit"),
    new ButtonBuilder().setCustomId(`charnav:${characterId}:con`).setLabel("📜  Constellations")
      .setStyle(activePage === "con" ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(activePage === "con"),
  );
}

async function buildKitLevelsView(userId: string, characterId: string) {
  const [progress, dbUser] = await Promise.all([
    getOrCreateCharacterProgress(userId, characterId),
    prisma.user.findUnique({ where: { id: userId }, select: { forgingOres: true } }),
  ]);
  const ores = dbUser?.forgingOres ?? 0;
  const char = CHARACTERS[characterId];

  const tracks: KitTrack[] = ["basic", "skill", "ultimate", "intro", "forte"];
  const lines = tracks.map(t => {
    const lvl = getTrackLevel(progress, t);
    const maxed = lvl >= MAX_KIT_LEVEL;
    const cost = maxed ? null : kitLevelUpCost(lvl);
    return `${TRACK_LABELS[t]} — **Lv ${lvl}/${MAX_KIT_LEVEL}**` +
      (maxed ? "" : `  ·  ${cost}${CE.fo} to Lv ${lvl + 1}`);
  });

  const embed = new EmbedBuilder()
    .setColor(0x6366F1)
    .setTitle(`${char.emoji}  ${char.label} — Kit Levels`)
    .setDescription(`You have **${ores}${CE.fo} Forging Ores**.\n\n${lines.join("\n")}`)
    .setFooter({ text: "CARTETHYIA  ·  Character  ·  Kit Levels" });

  const trackButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    tracks.map(t => {
      const lvl = getTrackLevel(progress, t);
      const maxed = lvl >= MAX_KIT_LEVEL;
      const cost = maxed ? 0 : kitLevelUpCost(lvl);
      return new ButtonBuilder()
        .setCustomId(`charlvl:${characterId}:${t}`)
        .setLabel(maxed ? `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (MAX)` : `${TRACK_LABELS[t].replace(/^\S+\s+/, "")} (${cost}${"⛭"})`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(maxed || ores < cost);
    })
  );

  return { embed, trackButtons };
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("character")
    .setDescription("View and level up your characters' kits.") as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const dbUser = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { id: true } });
    if (!dbUser) { await replyNotStarted(interaction); return; }

    const select = new StringSelectMenuBuilder()
      .setCustomId("character_cmd_select")
      .setPlaceholder("Choose a character…")
      .addOptions(
        Object.entries(CHARACTERS).map(([value, c]) => ({
          label: `${c.emoji}  ${c.label}`,
          value,
        }))
      );
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const overview = new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("◈  Characters")
      .setDescription("Select a character to view their Kit Levels.")
      .setFooter({ text: "CARTETHYIA  ·  Character" });

    await interaction.editReply({ embeds: [overview], components: [selectRow] });

    const collector = interaction.channel?.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id &&
        (i.customId === "character_cmd_select" || i.customId.startsWith("charlvl:") || i.customId.startsWith("charnav:")),
      time: 5 * 60 * 1000,
    });

    collector?.on("collect", async i => {
      if (i.customId === "character_cmd_select" && i.isStringSelectMenu()) {
        const sel = i as StringSelectMenuInteraction;
        const characterId = sel.values[0];
        if (!CHARACTERS[characterId]) { await sel.deferUpdate().catch(() => {}); return; }
        const { embed, trackButtons } = await buildKitLevelsView(interaction.user.id, characterId);
        await sel.update({ embeds: [embed], components: [selectRow, navButtons(characterId, "kit"), trackButtons] }).catch(() => {});
        return;
      }

      if (i.customId.startsWith("charnav:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, page] = btn.customId.split(":");
        if (!CHARACTERS[characterId] || (page !== "kit" && page !== "con")) {
          await btn.deferUpdate().catch(() => {});
          return;
        }
        if (page === "con") {
          const { embed } = await buildConstellationsView(interaction.user.id, characterId);
          await btn.update({ embeds: [embed], components: [selectRow, navButtons(characterId, "con")] }).catch(() => {});
        } else {
          const { embed, trackButtons } = await buildKitLevelsView(interaction.user.id, characterId);
          await btn.update({ embeds: [embed], components: [selectRow, navButtons(characterId, "kit"), trackButtons] }).catch(() => {});
        }
        return;
      }

      if (i.customId.startsWith("charlvl:") && i.isButton()) {
        const btn = i as ButtonInteraction;
        const [, characterId, trackRaw] = btn.customId.split(":");

        // Never trust the customId or the disabled-button state alone — a
        // forged/malformed customId could reference a nonexistent character
        // or track, so validate both before touching the DB (mirrors the
        // select-menu handler's CHARACTERS check above).
        if (!CHARACTERS[characterId] || !isKitTrack(trackRaw)) {
          await btn.deferUpdate().catch(() => {});
          return;
        }
        const track = trackRaw;

        // Never trust the disabled-button state alone — re-verify affordability
        // and max-level server-side, since the message could be stale.
        const [progress, dbUser2] = await Promise.all([
          getOrCreateCharacterProgress(interaction.user.id, characterId),
          prisma.user.findUnique({ where: { id: interaction.user.id }, select: { forgingOres: true } }),
        ]);
        const lvl  = getTrackLevel(progress, track);
        const ores = dbUser2?.forgingOres ?? 0;
        const cost = kitLevelUpCost(lvl);

        if (lvl >= MAX_KIT_LEVEL || ores < cost) {
          await btn.deferUpdate().catch(() => {});
          return;
        }

        try {
          await prisma.$transaction(async (tx) => {
            // Guarded, atomic decrement: only succeeds if the balance is
            // still sufficient at write time. If a concurrent click already
            // spent the balance down between our read above and now, this
            // updateMany matches zero rows — treat that as insufficient
            // funds and roll back rather than letting the balance go
            // negative.
            const spend = await tx.user.updateMany({
              where: { id: interaction.user.id, forgingOres: { gte: cost } },
              data:  { forgingOres: { decrement: cost } },
            });
            if (spend.count === 0) {
              throw new Error("insufficient-funds-race");
            }
            // Same guard shape as the currency spend above: only increment if
            // the track is still below max at write time. If a concurrent
            // click already maxed it out between our read above and now,
            // this updateMany matches zero rows — roll back rather than
            // silently pushing the level past MAX_KIT_LEVEL.
            const levelUp = await tx.characterProgress.updateMany({
              where: {
                userId: interaction.user.id, characterId,
                [TRACK_FIELD[track]]: { lt: MAX_KIT_LEVEL },
              },
              data: { [TRACK_FIELD[track]]: { increment: 1 } },
            });
            if (levelUp.count === 0) {
              throw new Error("already-maxed-race");
            }
          });
          auditSpend(interaction.user.id, { forgingOres: cost }, "character-kit-level");

          const { embed, trackButtons } = await buildKitLevelsView(interaction.user.id, characterId);
          await btn.update({ embeds: [embed], components: [selectRow, navButtons(characterId, "kit"), trackButtons] }).catch(() => {});
        } catch (err) {
          console.error("[character] kit-level-up transaction failed", err);
          await btn.deferUpdate().catch(() => {});
        }
      }
    });

    collector?.on("end", async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
