import {
  SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction,
  EmbedBuilder, AttachmentBuilder,
} from "discord.js";
import prisma from "../../lib/prisma";
import {
  ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS,
  MAIN_STAT_LABELS, SUBSTAT_LABELS,
  calcMainStatValue, calcSubstatValue, formatStatValue,
} from "../../lib/echoes";
import { echoEmoji } from "../../lib/emojiManager";
import { resolvePlayerBonuses } from "../../lib/setBonus";
import { generateGridCard } from "../../lib/gridCard";
import { Element } from "@prisma/client";
import { NAMED_SETS, NamedSetId } from "../../lib/namedSets";
import { getEchoSkillDef, genericEchoSkill } from "../../lib/echoSkills";
import { handleCharacterAutocomplete } from "../../lib/characterChoices";
import { CHARACTER_KITS } from "../../lib/characterKit";
import "../../lib/kits";

export const data = new SlashCommandBuilder()
  .setName("echoes")
  .setDescription("View your Echo collection and equipped resonance grid.")
  .addUserOption(o =>
    o.setName("user").setDescription("View another player's echoes").setRequired(false)
  )
  .addStringOption(o =>
    o.setName("character")
      .setDescription("Which unit's grid to view (default: yourself)")
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction: AutocompleteInteraction) {
  await handleCharacterAutocomplete(interaction);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target = interaction.options.getUser("user") ?? interaction.user;
  const member = interaction.guild?.members.cache.get(target.id);
  const displayName = member?.displayName ?? target.displayName;

  const dbUser = await prisma.user.findUnique({
    where:   { id: target.id },
    select:  { element: true, worldLevel: true },
  });

  if (!dbUser) {
    await interaction.editReply({ content: `${displayName} hasn't started their journey yet.`,});
    return;
  }

  // Equipped grids are always per-character (each unit has its own separate
  // 12-point budget, tracked by Echo.characterId) — there's no coherent
  // notion of "the equipped grid" without picking exactly one, so default to
  // "self" rather than leaving it unfiltered. Leaving it unfiltered used to
  // pull every character's equipped echoes into one merged list, double
  // (or more) counting grid points and showing whichever character's icons
  // happened to win each slot's collision in the display.
  const filterCharacterId = interaction.options.getString("character") ?? "self";
  const CHARACTER_LABEL: Record<string, string> = { self: "Yourself" };

  const [equipped, unequipped] = await Promise.all([
    prisma.echo.findMany({
      where:   { userId: target.id, isEquipped: true, characterId: filterCharacterId },
      orderBy: [{ equippedSlot: "asc" }],
    }),
    // Unequipped echoes aren't tied to any character's grid until equipped
    // (they default to characterId "self" until then), so the inventory
    // list stays unfiltered regardless of which grid is being viewed.
    prisma.echo.findMany({
      where:   { userId: target.id, isEquipped: false },
      orderBy: [{ rarity: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const echoes = [...equipped, ...unequipped];

  const element  = dbUser.element as Element;
  const color    = ELEMENT_COLORS[element];

  if (echoes.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle(`${ELEMENT_EMOJI[element]}  ${displayName}'s Echoes`)
        .setDescription("*No echoes collected yet.*\n\nEngage enemies that appear while chatting to capture their echoes.")
        .setFooter({ text: "CARTETHYIA  ·  Echo Collection" })],
    });
    return;
  }

  const gridPoints = equipped.reduce((sum, e) => sum + e.cost, 0);

  // Resolve bonuses for the grid card panel — scoped to whichever
  // character's grid is being viewed, not always the player's own.
  const bonuses = await resolvePlayerBonuses(target.id, filterCharacterId);

  // Render the Resonance Grid card
  const gridBuf = await generateGridCard({
    displayName,
    element:    dbUser.element,
    slots:      equipped.filter(e => e.equippedSlot !== null).map(e => ({
      slot: e.equippedSlot!, name: e.name, element: e.element,
      rarity: e.rarity, cost: e.cost, level: e.level,
    })),
    gridPoints,
    bonusLabels: bonuses.activeLabels.flatMap(l => l.split("\n")).map(l => l.replace(/^\s*[›✦]\s*/, "").trim()).filter(Boolean),
  });
  const gridAttach = new AttachmentBuilder(gridBuf, { name: "grid.webp" });

  // Inventory list (first 12)
  const invLines: string[] = unequipped.slice(0, 12).map(e => {
    const elem    = e.element as Element;
    const icon    = echoEmoji(e.name, ELEMENT_EMOJI[elem]);
    return `${icon} ${e.isLocked ? "🔒 " : ""}**${e.name}**  ${RARITY_STARS[e.rarity]}  ·  ${e.cost}-cost · Lv${e.level}`;
  });
  if (unequipped.length > 12) invLines.push(`*… and ${unequipped.length - 12} more*`);

  // ── Grid detail: per-slot breakdown ──────────────────────────────────────
  const SLOT_NAMES = ["Main Slot", "Sub Slot 1", "Sub Slot 2", "Sub Slot 3", "Sub Slot 4"];
  const gridDetail = SLOT_NAMES.map((slotName, slot) => {
    const e = equipped.find(x => x.equippedSlot === slot);
    if (!e) return `**${slotName}** ·  ○ Empty`;
    const mainVal   = calcMainStatValue(e.mainStatType, e.level, e.rarity);
    const mainLabel = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
    const subs = [
      [e.substat1Type, e.substat1Value],
      [e.substat2Type, e.substat2Value],
      [e.substat3Type, e.substat3Value],
      [e.substat4Type, e.substat4Value],
      [e.substat5Type, e.substat5Value],
    ].filter(([t], i) => t && i < (e.revealedSubstats ?? 0)) as [string, number][];
    const subLine = subs.length > 0
      ? subs.slice(0, 3).map(([t, v]) => `${SUBSTAT_LABELS[t] ?? t} ${formatStatValue(t, calcSubstatValue(t, v, e.level))}`).join("  ·  ")
      : "*substats unrevealed*";
    const setInfo = e.setId ? NAMED_SETS[e.setId as NamedSetId] : null;
    const icon    = echoEmoji(e.name, ELEMENT_EMOJI[e.element as Element]);
    const echoSkillLine = slot === 0
      ? `\n  🌀 \`${(e.cost === 4 ? getEchoSkillDef(e) : genericEchoSkill(e.element))?.name ?? "Echo Strike"}\``
      : "";
    return `**${slotName}** ·  ${icon} **${e.name}**${setInfo ? `  ·  ✦ ${setInfo.name}` : ""}${e.isLocked ? "  · 🔒" : ""}  ${RARITY_STARS[e.rarity]}  Lv${e.level}  (${e.cost}-cost)\n  \`${mainLabel}: ${formatStatValue(e.mainStatType, mainVal)}\`  ·  ${subLine}${echoSkillLine}`;
  }).join("\n");

  // Full active bonus text for the embed (canvas may wrap long lines)
  const bonusText = bonuses.activeLabels.length === 0
    ? "*No active bonuses — equip echoes of the same element to activate set effects.*"
    : bonuses.activeLabels.map(l => `› ${l}`).join("\n");
  const bonusValue = bonusText.length > 1024 ? bonusText.slice(0, 1020) + "…" : bonusText;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${ELEMENT_EMOJI[element]}  ${displayName}'s Echoes  ·  ${CHARACTER_LABEL[filterCharacterId] ?? CHARACTER_KITS[filterCharacterId]?.label ?? filterCharacterId}'s Grid`)
    .setImage("attachment://grid.webp")
    .addFields(
      {
        name:   "◈  Equipped Grid",
        value:  gridDetail,
        inline: false,
      },
      {
        name:   "✦  Active Bonuses",
        value:  bonusValue,
        inline: false,
      },
      {
        name:   `◇  Inventory  [${unequipped.length} echo${unequipped.length !== 1 ? "es" : ""}]`,
        value:  invLines.length ? invLines.join("\n") : "*All echoes equipped or none collected.*",
        inline: false,
      },
    )
    .setFooter({ text: `CARTETHYIA  ·  ${echoes.length} echoes  ·  /echo to view a card · /echo-equip to slot` });

  await interaction.editReply({ embeds: [embed], files: [gridAttach] });
}
