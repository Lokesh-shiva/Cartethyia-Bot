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
  MAIN_STAT_LABELS, SUBSTAT_LABELS, FLAT_STATS,
  SUBSTAT_POOL, rollSubstats, rollSubstatValue, formatStatValue, substatCount,
} from "../../lib/echoes";
import { generateEchoCard, echoRowToCard } from "../../lib/echoCard";
import { CE } from "../../lib/emojiManager";
import { Element } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("echo-reroll")
  .setDescription("Reroll an echo's unlocked substats using a Paradox Core.");

// Stasis Lock cost: 1st lock = 1, 2nd = 3, 3rd = 6 (exponential)
function stasisLockCost(locksAlreadySet: number): number {
  return locksAlreadySet === 0 ? 1 : locksAlreadySet === 1 ? 3 : 6;
}

function buildSubstatLines(
  echo: any,
  revealed: number,
  lockedOverride?: Set<number>,
): string {
  const total  = substatCount(echo.rarity);
  const lines: string[] = [];
  for (let i = 1; i <= total; i++) {
    const type   = echo[`substat${i}Type`]  as string;
    const value  = echo[`substat${i}Value`] as number;
    const locked = lockedOverride
      ? lockedOverride.has(i)
      : (echo[`substat${i}Locked`] as boolean);
    const label  = SUBSTAT_LABELS[type] ?? type;
    const hidden = i > revealed;

    if (hidden) {
      lines.push(`${locked ? CE.sl : "◇"} *— sealed —*`);
    } else {
      lines.push(`${locked ? CE.sl : "◇"} **${label}**  +${formatStatValue(type, value)}${locked ? "  *(locked)*" : ""}`);
    }
  }
  return lines.join("\n");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });
  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, paradoxCores: true, stasisLocks: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element];

  // Only echoes with at least 1 revealed substat (something to see before rerolling)
  const echoes = await prisma.echo.findMany({
    where:   { userId: interaction.user.id },
    orderBy: [{ rarity: "desc" }, { createdAt: "desc" }],
  });

  const rerollable = echoes.filter(e => e.revealedSubstats > 0);

  if (rerollable.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription("You need to reveal at least one substat (via `/echo-reveal`) before rerolling.")
        .setFooter({ text: "CARTETHYIA  ·  Echo Reroll" })],
    });
    return;
  }

  // Step 1: pick echo
  const options = rerollable.slice(0, 25).map(e => {
    const locked     = [1,2,3,4,5].filter(i => e[`substat${i}Locked` as keyof typeof e]).length;
    const mainLabel  = MAIN_STAT_LABELS[e.mainStatType] ?? e.mainStatType;
    return {
      label:       `${e.name}  ${RARITY_STARS[e.rarity]}  (${locked} locked)`,
      description: `Main: ${mainLabel}  ·  ${ELEMENT_EMOJI[e.element as Element]} ${e.element}`,
      value:       e.id,
    };
  });

  const echoSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("reroll_echo_select")
      .setPlaceholder("Select an echo to reroll…")
      .addOptions(options)
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${ELEMENT_EMOJI[dbUser.element as Element]}  Echo Reroll`)
      .setDescription(
        `You have **${dbUser.paradoxCores} ${CE.pc} Paradox Cores** and **${dbUser.stasisLocks} ${CE.sl} Stasis Locks**.\n\n` +
        `**Rerolling** costs **1 Paradox Core** and randomises all *unlocked* substats.\n` +
        `**Stasis Locks** protect a substat from being rerolled:\n` +
        `› 1st lock: 1 ${CE.sl}  ·  2nd lock: 3 ${CE.sl}  ·  3rd lock: 6 ${CE.sl}\n\n` +
        `*Only revealed substats can be locked. All revealed unlocked substats will be rerolled.*`
      )
      .setFooter({ text: "CARTETHYIA  ·  Echo Reroll  ·  Expires in 60s" })],
    components: [echoSelectRow],
  });

  const echoCollector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "reroll_echo_select",
    time:   60_000,
    max:    1,
  });

  echoCollector?.on("collect", async (echoSel: StringSelectMenuInteraction) => {
    await echoSel.deferUpdate();
    const echo = await prisma.echo.findUnique({ where: { id: echoSel.values[0] } });
    if (!echo || echo.userId !== interaction.user.id) {
      await echoSel.editReply({ content: "Echo not found.", components: [], embeds: [] });
      return;
    }

    const echoElem  = echo.element as Element;
    const total     = substatCount(echo.rarity);
    const revealed  = echo.revealedSubstats;

    // Current locked substats (from DB)
    const lockedSet = new Set<number>(
      [1,2,3,4,5].filter(i => echo[`substat${i}Locked` as keyof typeof echo] === true)
    );
    const lockedCount = lockedSet.size;

    // Step 2: show preview + lock/reroll buttons
    const lockBtn = new ButtonBuilder()
      .setCustomId("reroll_lock")
      .setLabel(`Lock a Substat  (${stasisLockCost(lockedCount)} SL cost)`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(dbUser.stasisLocks < stasisLockCost(lockedCount) || lockedCount >= Math.min(revealed, 3));

    const rerollBtn = new ButtonBuilder()
      .setCustomId("reroll_confirm")
      .setLabel("Reroll Unlocked Substats  (1 PC cost)")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(dbUser.paradoxCores < 1);

    const cancelBtn = new ButtonBuilder()
      .setCustomId("reroll_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(lockBtn, rerollBtn, cancelBtn);

    await echoSel.editReply({
      embeds: [new EmbedBuilder()
        .setColor(ELEMENT_COLORS[echoElem])
        .setTitle(`${ELEMENT_EMOJI[echoElem]}  ${echo.name}  ${RARITY_STARS[echo.rarity]}`)
        .setDescription(
          `**Substats:**\n${buildSubstatLines(echo, revealed, lockedSet)}\n\n` +
          `Lock a substat first to protect it, then reroll. Sealed substats are unaffected.`
        )
        .setFooter({ text: `CARTETHYIA  ·  Reroll Preview  ·  ${lockedCount} locked` })],
      components: [actionRow],
    });

    // Step 3: handle lock or reroll
    const btnCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: b => b.user.id === interaction.user.id && ["reroll_lock","reroll_confirm","reroll_cancel"].includes(b.customId),
      time:   90_000,
    });

    btnCollector?.on("collect", async (btn: ButtonInteraction) => {
      if (btn.customId === "reroll_cancel") {
        btnCollector.stop();
        await btn.update({ embeds: [new EmbedBuilder().setColor(color).setDescription("Reroll cancelled.")], components: [] });
        return;
      }

      if (btn.customId === "reroll_lock") {
        // Show another select to pick which revealed unlocked substat to lock
        const unlocked = [];
        for (let i = 1; i <= revealed; i++) {
          if (!lockedSet.has(i)) {
            const type  = echo[`substat${i}Type` as keyof typeof echo] as string;
            const value = echo[`substat${i}Value` as keyof typeof echo] as number;
            unlocked.push({ index: i, type, value });
          }
        }
        if (unlocked.length === 0) {
          await btn.reply({ content: "No unlocked revealed substats to lock.", flags: 64 });
          return;
        }

        const lockSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("reroll_lock_pick")
            .setPlaceholder("Choose a substat to lock…")
            .addOptions(unlocked.map(u => ({
              label:       `${SUBSTAT_LABELS[u.type] ?? u.type}  +${formatStatValue(u.type, u.value)}`,
              description: `Substat ${u.index} of ${total}`,
              value:       String(u.index),
            })))
        );

        const lockCost = stasisLockCost(lockedCount);
        await btn.reply({
          embeds: [new EmbedBuilder()
            .setColor(ELEMENT_COLORS[echoElem])
            .setDescription(`Choose which substat to lock. This costs **${lockCost} ${CE.sl} Stasis Lock${lockCost !== 1 ? "s" : ""}**.`)],
          components: [lockSelectRow],
          flags: 64,
        });

        const lockPickCollector = interaction.channel?.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          filter: i => i.user.id === interaction.user.id && i.customId === "reroll_lock_pick",
          time:   30_000,
          max:    1,
        });

        lockPickCollector?.on("collect", async (lockSel: StringSelectMenuInteraction) => {
          await lockSel.deferUpdate();
          const idx       = parseInt(lockSel.values[0]);
          const lockCost2 = stasisLockCost(lockedCount);
          const freshUser = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { stasisLocks: true } });

          if ((freshUser?.stasisLocks ?? 0) < lockCost2) {
            await lockSel.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription(`⚠  Not enough Stasis Locks. Need ${lockCost2}, have ${freshUser?.stasisLocks ?? 0}.`)], components: [] });
            return;
          }

          // Lock in DB
          await prisma.$transaction([
            prisma.echo.update({
              where: { id: echo.id },
              data:  { [`substat${idx}Locked`]: true },
            }),
            prisma.user.update({
              where: { id: interaction.user.id },
              data:  { stasisLocks: { decrement: lockCost2 } },
            }),
          ]);

          lockedSet.add(idx);
          const type  = echo[`substat${idx}Type` as keyof typeof echo] as string;
          const label = SUBSTAT_LABELS[type] ?? type;

          await lockSel.editReply({
            embeds: [new EmbedBuilder()
              .setColor(ELEMENT_COLORS[echoElem])
              .setDescription(`${CE.sl} **${label}** is now locked and will survive rerolling.\n\n**Substats:**\n${buildSubstatLines(echo, revealed, lockedSet)}`)
              .setFooter({ text: `${(freshUser?.stasisLocks ?? lockCost2) - lockCost2} ${CE.sl} remaining` })],
            components: [],
          });
        });
        return;
      }

      if (btn.customId === "reroll_confirm") {
        btnCollector.stop();
        await btn.deferUpdate();

        const freshUser = await prisma.user.findUnique({ where: { id: interaction.user.id }, select: { paradoxCores: true } });
        if ((freshUser?.paradoxCores ?? 0) < 1) {
          await btn.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("⚠  Not enough Paradox Cores.")], components: [] });
          return;
        }

        // Re-fetch echo for latest locked state
        const freshEcho = await prisma.echo.findUnique({ where: { id: echo.id } });
        if (!freshEcho) { await btn.editReply({ content: "Echo not found.", components: [], embeds: [] }); return; }

        // Roll new types + values for unlocked revealed substats
        const updateData: Record<string, any> = {};
        const total2 = substatCount(freshEcho.rarity);

        // Gather types that must not be duplicated: locked + sealed substats + main stat
        const reservedTypes = new Set<string>([freshEcho.mainStatType]);
        for (let i = 1; i <= total2; i++) {
          const isLocked   = freshEcho[`substat${i}Locked` as keyof typeof freshEcho] as boolean;
          const isRevealed = i <= freshEcho.revealedSubstats;
          if (isLocked || !isRevealed) {
            const t = freshEcho[`substat${i}Type` as keyof typeof freshEcho] as string;
            if (t) reservedTypes.add(t);
          }
        }

        // Collect which slots need a new type
        const slotsToReroll: number[] = [];
        for (let i = 1; i <= total2; i++) {
          const isLocked   = freshEcho[`substat${i}Locked` as keyof typeof freshEcho] as boolean;
          const isRevealed = i <= freshEcho.revealedSubstats;
          if (!isLocked && isRevealed) slotsToReroll.push(i);
        }

        // Roll fresh unique types from the unreserved pool
        const pool = SUBSTAT_POOL.filter(s => !reservedTypes.has(s));
        const newTypes: string[] = [];
        for (const _ of slotsToReroll) {
          const available = pool.filter(s => !newTypes.includes(s));
          newTypes.push(available[Math.floor(Math.random() * available.length)]);
        }

        for (let j = 0; j < slotsToReroll.length; j++) {
          const idx     = slotsToReroll[j];
          const newType = newTypes[j];
          updateData[`substat${idx}Type`]  = newType;
          updateData[`substat${idx}Value`] = rollSubstatValue(newType);
        }

        await prisma.$transaction([
          prisma.echo.update({ where: { id: freshEcho.id }, data: updateData }),
          prisma.user.update({ where: { id: interaction.user.id }, data: { paradoxCores: { decrement: 1 } } }),
        ]);

        const finalEcho = await prisma.echo.findUnique({ where: { id: freshEcho.id } })!;
        const cardBuf = await generateEchoCard(echoRowToCard(finalEcho));

        await btn.editReply({
          embeds: [new EmbedBuilder()
            .setColor(ELEMENT_COLORS[echoElem])
            .setImage("attachment://echo.png")
            .setDescription(`${ELEMENT_EMOJI[echoElem]}  **${freshEcho.name}** — substats rerolled.`)
            .setFooter({ text: `CARTETHYIA  ·  Echo Reroll  ·  ${(freshUser?.paradoxCores ?? 1) - 1} ${CE.pc} remaining` })],
          files: [new AttachmentBuilder(cardBuf, { name: "echo.png" })],
          components: [],
        });
      }
    });

    btnCollector?.on("end", async (col) => {
      if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
    });
  });

  echoCollector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
