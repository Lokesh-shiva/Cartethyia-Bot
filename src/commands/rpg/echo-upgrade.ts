import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, AttachmentBuilder,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import {
  ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS,
  MAIN_STAT_LABELS, SUBSTAT_LABELS, calcMainStatValue, upgradeCost,
  maxEchoLevel, formatStatValue, substatCount,
} from "../../lib/echoes";
import { generateEchoCard, echoRowToCard } from "../../lib/echoCard";
import { CE } from "../../lib/emojiManager";
import { Element } from "@prisma/client";

const REVEAL_MILESTONES = [5, 10, 15, 20, 25];

export const data = new SlashCommandBuilder()
  .setName("echo-upgrade")
  .setDescription("Level up an echo using Tuning Modules (max level 25).");

function modeButtons(echoId: string, ar: boolean) {
  const a = ar ? "1" : "0";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`eu:${echoId}:${a}:1`).setLabel("+1 Level").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`eu:${echoId}:${a}:5`).setLabel("+5 Levels").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`eu:${echoId}:${a}:auto`).setLabel("Auto Max").setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`eu:${echoId}:${a}:toggle`)
      .setLabel(`Auto-Reveal: ${ar ? "ON ✓" : "OFF"}`)
      .setStyle(ar ? ButtonStyle.Secondary : ButtonStyle.Danger),
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, tuningModules: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element];

  const echoes = await prisma.echo.findMany({
    where:   { userId: interaction.user.id },
    orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "asc" }],
    take:    25,
  });

  const upgradeable = echoes.filter(e => e.level < maxEchoLevel(e.rarity));

  if (upgradeable.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription("All your echoes are already at max level.")
        .setFooter({ text: "CARTETHYIA  ·  Echo Upgrade" })],
    });
    return;
  }

  const options = upgradeable.map(e => {
    const cost      = upgradeCost(e.level);
    const canAfford = dbUser.tuningModules >= cost;
    const maxLvl    = maxEchoLevel(e.rarity);
    const mainLabel = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
    return {
      label:       `${e.name}  ${RARITY_STARS[e.rarity]}  Lv${e.level}/${maxLvl}  (${cost} TM next)${canAfford ? "" : "  ✗"}`,
      description: `Main: ${mainLabel}  ·  ${ELEMENT_EMOJI[e.element as Element]} ${e.element}${e.isEquipped ? "  · EQUIPPED" : ""}`,
      value:       e.id,
    };
  });

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("echo_upgrade_select")
      .setPlaceholder("Select an echo to upgrade…")
      .addOptions(options)
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${ELEMENT_EMOJI[dbUser.element as Element]}  Echo Upgrade`)
      .setDescription(
        `You have **${dbUser.tuningModules} ${CE.tm} Tuning Modules**.\n\n` +
        `Cost per level: Lv 0–4: 1  ·  5–9: 2  ·  10–14: 3  ·  15–19: 4  ·  20–24: 5\n\n` +
        `**Auto-Reveal** spends ${CE.st} Sealing Tubes to uncover substats at Lv 5, 10, 15, 20, 25.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Echo Upgrade  ·  Expires in 60s" })],
    components: [selectRow],
  });

  const selCollector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "echo_upgrade_select",
    time:   60_000,
    max:    1,
  });

  selCollector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    await sel.deferUpdate();
    const echo = await prisma.echo.findUnique({ where: { id: sel.values[0] } });
    if (!echo || echo.userId !== interaction.user.id) {
      await sel.editReply({ content: "Echo not found.", components: [], embeds: [] });
      return;
    }
    if (echo.level >= maxEchoLevel(echo.rarity)) {
      await sel.editReply({
        embeds: [new EmbedBuilder().setColor(color).setDescription("That echo is already at max level.")],
        components: [],
      });
      return;
    }

    const freshUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { tuningModules: true, sealingTubes: true },
    });
    const mods  = freshUser?.tuningModules ?? 0;
    const tubes = freshUser?.sealingTubes ?? 0;
    const maxLvl    = maxEchoLevel(echo.rarity);
    const echoElem  = echo.element as Element;
    const mainLabel = MAIN_STAT_LABELS[echo.mainStatType] ?? echo.mainStatType;

    let autoReveal = true;

    function infoEmbed(ar: boolean) {
      return new EmbedBuilder()
        .setColor(ELEMENT_COLORS[echoElem])
        .setTitle(`${ELEMENT_EMOJI[echoElem]}  ${echo!.name}  ${RARITY_STARS[echo!.rarity]}`)
        .setDescription(
          `Level **${echo!.level}** / **${maxLvl}**\n` +
          `**${mainLabel}:** ${formatStatValue(echo!.mainStatType, calcMainStatValue(echo!.mainStatType, echo!.level, echo!.rarity))}\n\n` +
          `${CE.tm} **${mods}** Tuning Modules  ·  next level costs **${upgradeCost(echo!.level)}**\n` +
          `${CE.st} **${tubes}** Sealing Tubes\n\n` +
          `**Auto-Reveal ${ar ? "ON" : "OFF"}** — ${ar
            ? "substats will be revealed automatically at levels 5, 10, 15, 20, 25"
            : "substats won't be revealed automatically — use `/echo-reveal` manually"}`
        )
        .setFooter({ text: "CARTETHYIA  ·  Echo Upgrade  ·  Expires in 2min" });
    }

    await sel.editReply({
      embeds:     [infoEmbed(autoReveal)],
      components: [modeButtons(echo.id, autoReveal)],
    });

    const btnCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.user.id === interaction.user.id && i.customId.startsWith(`eu:${echo.id}:`),
      time:   120_000,
    });

    btnCollector?.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();
      const parts = btn.customId.split(":");
      const ar    = parts[2] === "1";
      const mode  = parts[3];

      if (mode === "toggle") {
        autoReveal = !ar;
        await btn.editReply({ embeds: [infoEmbed(autoReveal)], components: [modeButtons(echo.id, autoReveal)] });
        return;
      }

      btnCollector.stop("done");

      // Re-fetch latest state
      const latest = await prisma.echo.findUnique({ where: { id: echo.id } });
      if (!latest) { await btn.editReply({ content: "Echo not found.", components: [], embeds: [] }); return; }

      const latestUser = await prisma.user.findUnique({
        where:  { id: interaction.user.id },
        select: { tuningModules: true, sealingTubes: true },
      });
      const availMods  = latestUser?.tuningModules ?? 0;
      let   availTubes = latestUser?.sealingTubes ?? 0;

      const startLevel = latest.level;
      const maxLvl2    = maxEchoLevel(latest.rarity);

      const targetLevel =
        mode === "1"    ? Math.min(startLevel + 1, maxLvl2) :
        mode === "5"    ? Math.min(startLevel + 5, maxLvl2) :
        maxLvl2;

      // Calculate levels gained within budget
      let totalCost = 0;
      let endLevel  = startLevel;
      for (let lvl = startLevel; lvl < targetLevel; lvl++) {
        const c = upgradeCost(lvl);
        if (availMods < totalCost + c) break;
        totalCost += c;
        endLevel   = lvl + 1;
      }

      if (endLevel === startLevel) {
        await btn.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setDescription(`⚠  Not enough Tuning Modules. Need **${upgradeCost(startLevel)}**, have **${availMods}**.`)
            .setFooter({ text: "CARTETHYIA  ·  Echo Upgrade" })],
          components: [],
        });
        return;
      }

      // Auto-reveal at milestones
      const reveals: string[] = [];
      let tubesSpent   = 0;
      let revealedCount = latest.revealedSubstats;

      if (ar) {
        const totalSubs  = substatCount(latest.rarity);
        const milestones = REVEAL_MILESTONES.filter(m => m > startLevel && m <= endLevel);
        for (const _m of milestones) {
          if (revealedCount >= totalSubs) break;
          if (availTubes - tubesSpent < 1) break;
          tubesSpent++;
          revealedCount++;
          const subType  = latest[`substat${revealedCount}Type`  as keyof typeof latest] as string;
          const subVal   = latest[`substat${revealedCount}Value` as keyof typeof latest] as number;
          const subLabel = SUBSTAT_LABELS[subType] ?? subType;
          reveals.push(`› **${subLabel}** +${formatStatValue(subType, subVal)}`);
        }
      }

      const newMainVal = calcMainStatValue(latest.mainStatType, endLevel, latest.rarity);

      await prisma.$transaction([
        prisma.echo.update({
          where: { id: echo.id },
          data:  { level: endLevel, mainStatValue: newMainVal, revealedSubstats: revealedCount },
        }),
        prisma.user.update({
          where: { id: interaction.user.id },
          data:  {
            tuningModules: { decrement: totalCost },
            ...(tubesSpent > 0 ? { sealingTubes: { decrement: tubesSpent } } : {}),
          },
        }),
      ]);

      const cardBuf    = await generateEchoCard(echoRowToCard({ ...latest, level: endLevel, mainStatValue: newMainVal, revealedSubstats: revealedCount }));
      const oldMainVal = calcMainStatValue(latest.mainStatType, startLevel, latest.rarity);
      const mLabel     = MAIN_STAT_LABELS[latest.mainStatType] ?? latest.mainStatType;
      const isMax      = endLevel >= maxLvl2;

      let desc = `**${latest.name}** — Level **${startLevel}** → **${endLevel}**${isMax ? "  *(MAX)*" : ""}\n` +
                 `**${mLabel}:** ${formatStatValue(latest.mainStatType, oldMainVal)} → **${formatStatValue(latest.mainStatType, newMainVal)}**`;
      if (reveals.length > 0) {
        desc += `\n\n✨ **${reveals.length} substat${reveals.length > 1 ? "s" : ""} revealed:**\n${reveals.join("\n")}`;
      } else if (ar && tubesSpent === 0 && REVEAL_MILESTONES.some(m => m > startLevel && m <= endLevel)) {
        desc += `\n\n*(No Sealing Tubes available for auto-reveal)*`;
      }

      const footerParts = [`${availMods - totalCost} ${CE.tm} remaining`];
      if (tubesSpent > 0) footerParts.push(`${availTubes - tubesSpent} ${CE.st} remaining`);

      await btn.editReply({
        embeds: [new EmbedBuilder()
          .setColor(ELEMENT_COLORS[latest.element as Element])
          .setImage("attachment://echo.png")
          .setDescription(desc)
          .setFooter({ text: `CARTETHYIA  ·  Echo Upgrade  ·  ${footerParts.join("  ·  ")}` })],
        files:      [new AttachmentBuilder(cardBuf, { name: "echo.png" })],
        components: [],
      });
    });

    btnCollector?.on("end", async (_, reason) => {
      if (reason !== "done") await interaction.editReply({ components: [] }).catch(() => {});
    });
  });

  selCollector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
