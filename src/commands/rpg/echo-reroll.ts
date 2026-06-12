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

// Total SL cost for `newCount` new locks on top of `existingCount` already-locked
function calcPendingSLCost(existingCount: number, newCount: number): number {
  let total = 0;
  for (let i = 0; i < newCount; i++) total += stasisLockCost(existingCount + i);
  return total;
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
        `**Stasis Locks** protect a substat from rerolling:\n` +
        `› 1st lock: 1 ${CE.sl}  ·  2nd lock: 3 ${CE.sl}  ·  3rd lock: 6 ${CE.sl}\n\n` +
        `*Stasis Lock cost is charged only when you confirm the reroll — locking is free to undo by cancelling.*`
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
      await interaction.editReply({ content: "Echo not found.", components: [], embeds: [] });
      return;
    }

    const echoElem  = echo.element as Element;
    const total     = substatCount(echo.rarity);
    const revealed  = echo.revealedSubstats;

    // DB-persisted locks (already paid for in a prior session)
    const lockedSet = new Set<number>(
      [1,2,3,4,5].filter(i => echo[`substat${i}Locked` as keyof typeof echo] === true)
    );
    const startingLockedCount = lockedSet.size;

    // Locks added THIS session — not charged yet, deferred to reroll confirm
    const pendingLocks = new Set<number>();

    function allLocked() { return new Set([...lockedSet, ...pendingLocks]); }

    async function renderPreview() {
      const locked    = allLocked();
      const pendingSL = calcPendingSLCost(startingLockedCount, pendingLocks.size);
      const nextCost  = stasisLockCost(locked.size);
      const canLock   = dbUser!.stasisLocks >= pendingSL + nextCost && locked.size < Math.min(revealed, 3);
      const canReroll = dbUser!.paradoxCores >= 1 && dbUser!.stasisLocks >= pendingSL;

      const rerollLabel = pendingSL > 0
        ? `Reroll  (1 ${CE.pc} + ${pendingSL} ${CE.sl})`
        : `Reroll Unlocked  (1 PC)`;

      const lockBtn = new ButtonBuilder()
        .setCustomId("reroll_lock")
        .setLabel(`Lock a Substat  (${nextCost} SL)`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canLock);

      const rerollBtn = new ButtonBuilder()
        .setCustomId("reroll_confirm")
        .setLabel(rerollLabel)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!canReroll);

      const cancelBtn = new ButtonBuilder()
        .setCustomId("reroll_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

      const pendingNote = pendingLocks.size > 0
        ? `\n\n*(${pendingLocks.size} pending lock${pendingLocks.size > 1 ? "s" : ""} — ${pendingSL} ${CE.sl} charged on reroll, free to cancel)*`
        : "";

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(ELEMENT_COLORS[echoElem])
          .setTitle(`${ELEMENT_EMOJI[echoElem]}  ${echo!.name}  ${RARITY_STARS[echo!.rarity]}`)
          .setDescription(
            `**Substats:**\n${buildSubstatLines(echo!, revealed, locked)}\n\n` +
            `Lock a substat to protect it, then reroll. Sealed substats are unaffected.${pendingNote}`
          )
          .setFooter({ text: `CARTETHYIA  ·  Reroll Preview  ·  ${locked.size} locked  ·  ${dbUser!.stasisLocks} ${CE.sl} available` })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(lockBtn, rerollBtn, cancelBtn)],
      });
    }

    await renderPreview();

    // Step 3: handle lock or reroll
    const btnCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: b => b.user.id === interaction.user.id && ["reroll_lock","reroll_confirm","reroll_cancel"].includes(b.customId),
      time:   90_000,
    });

    btnCollector?.on("collect", async (btn: ButtonInteraction) => {
      if (btn.customId === "reroll_cancel") {
        btnCollector.stop();
        await btn.update({ embeds: [new EmbedBuilder().setColor(color).setDescription("Reroll cancelled. No resources were charged.")], components: [] });
        return;
      }

      if (btn.customId === "reroll_lock") {
        await btn.deferUpdate();

        const locked = allLocked();
        const unlocked: { index: number; type: string; value: number }[] = [];
        for (let i = 1; i <= revealed; i++) {
          if (!locked.has(i)) {
            unlocked.push({
              index: i,
              type:  echo[`substat${i}Type`  as keyof typeof echo] as string,
              value: echo[`substat${i}Value` as keyof typeof echo] as number,
            });
          }
        }
        if (unlocked.length === 0) { await renderPreview(); return; }

        const lockCost = stasisLockCost(locked.size);
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(ELEMENT_COLORS[echoElem])
            .setDescription(`Choose which substat to lock. Cost: **${lockCost} ${CE.sl}** — charged when you confirm the reroll.`)],
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("reroll_lock_pick")
              .setPlaceholder("Choose a substat to lock…")
              .addOptions(unlocked.map(u => ({
                label:       `${SUBSTAT_LABELS[u.type] ?? u.type}  +${formatStatValue(u.type, u.value)}`,
                description: `Substat ${u.index} of ${total}`,
                value:       String(u.index),
              })))
          )],
        });

        const lockPickCollector = interaction.channel?.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          filter: i => i.user.id === interaction.user.id && i.customId === "reroll_lock_pick",
          time:   30_000,
          max:    1,
        });

        lockPickCollector?.on("collect", async (lockSel: StringSelectMenuInteraction) => {
          await lockSel.deferUpdate();
          pendingLocks.add(parseInt(lockSel.values[0]));
          await renderPreview();
        });

        lockPickCollector?.on("end", async (col) => {
          if (col.size === 0) await renderPreview();
        });
        return;
      }

      if (btn.customId === "reroll_confirm") {
        btnCollector.stop();
        await btn.deferUpdate();

        // Re-check resources with fresh DB values
        const freshUser = await prisma.user.findUnique({
          where:  { id: interaction.user.id },
          select: { paradoxCores: true, stasisLocks: true },
        });
        const pendingSL = calcPendingSLCost(startingLockedCount, pendingLocks.size);

        if ((freshUser?.paradoxCores ?? 0) < 1) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("⚠  Not enough Paradox Cores.")], components: [] });
          return;
        }
        if ((freshUser?.stasisLocks ?? 0) < pendingSL) {
          await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription(`⚠  Not enough Stasis Locks. Need ${pendingSL}, have ${freshUser?.stasisLocks ?? 0}.`)], components: [] });
          return;
        }

        // Re-fetch echo for latest state
        const freshEcho = await prisma.echo.findUnique({ where: { id: echo.id } });
        if (!freshEcho) { await interaction.editReply({ content: "Echo not found.", components: [], embeds: [] }); return; }

        // Build echo update: write pending locks + reroll unlocked slots
        const updateData: Record<string, any> = {};
        for (const idx of pendingLocks) updateData[`substat${idx}Locked`] = true;

        const total2 = substatCount(freshEcho.rarity);
        const allLockedNow = new Set([
          ...[1,2,3,4,5].filter(i => freshEcho[`substat${i}Locked` as keyof typeof freshEcho] === true),
          ...pendingLocks,
        ]);

        // Reserved: main stat + locked + sealed substats
        const reservedTypes = new Set<string>([freshEcho.mainStatType]);
        for (let i = 1; i <= total2; i++) {
          if (allLockedNow.has(i) || i > freshEcho.revealedSubstats) {
            const t = freshEcho[`substat${i}Type` as keyof typeof freshEcho] as string;
            if (t) reservedTypes.add(t);
          }
        }

        const slotsToReroll: number[] = [];
        for (let i = 1; i <= total2; i++) {
          if (!allLockedNow.has(i) && i <= freshEcho.revealedSubstats) slotsToReroll.push(i);
        }

        const pool = SUBSTAT_POOL.filter(s => !reservedTypes.has(s));
        const newTypes: string[] = [];
        for (const _ of slotsToReroll) {
          const available = pool.filter(s => !newTypes.includes(s));
          newTypes.push(available[Math.floor(Math.random() * available.length)]);
        }
        for (let j = 0; j < slotsToReroll.length; j++) {
          updateData[`substat${slotsToReroll[j]}Type`]  = newTypes[j];
          updateData[`substat${slotsToReroll[j]}Value`] = rollSubstatValue(newTypes[j]);
        }

        // Atomic: write all locks + reroll + deduct PC + deduct SL (if any)
        const txOps: any[] = [
          prisma.echo.update({ where: { id: freshEcho.id }, data: updateData }),
          prisma.user.update({ where: { id: interaction.user.id }, data: {
            paradoxCores: { decrement: 1 },
            ...(pendingSL > 0 ? { stasisLocks: { decrement: pendingSL } } : {}),
          }}),
        ];
        await prisma.$transaction(txOps);

        const finalEcho = await prisma.echo.findUnique({ where: { id: freshEcho.id } });
        const cardBuf   = await generateEchoCard(echoRowToCard(finalEcho!));
        const slNote    = pendingSL > 0 ? ` + ${pendingSL} ${CE.sl}` : "";

        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(ELEMENT_COLORS[echoElem])
            .setImage("attachment://echo.png")
            .setDescription(`${ELEMENT_EMOJI[echoElem]}  **${freshEcho.name}** — substats rerolled.`)
            .setFooter({ text: `CARTETHYIA  ·  Echo Reroll  ·  Charged: 1 ${CE.pc}${slNote}` })],
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
