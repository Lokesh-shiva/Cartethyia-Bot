// src/commands/rpg/weapon-refine.ts
// Milestone 3.5c — merge a duplicate weapon pull into +1 Refinement (R1-R5) on
// a kept copy. See design spec docs/superpowers/specs/2026-07-16-milestone3-5-per-character-loadouts-design.md §6.
// The magnitude scaling itself lives in weapons.ts's REFINEMENT_MULT, applied
// at read-time in setBonus.ts — this file is purely the merge UI/DB write.

import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { invalidateBonusCache } from "../../lib/setBonus";
import { WEAPON_PASSIVES, REFINEMENT_MULT, MAX_REFINEMENT, RARITY_STARS, WEAPON_TYPE_EMOJI, describeWeaponPassive } from "../../lib/weapons";
import { ELEMENT_COLORS } from "../../lib/echoes";
import { Element, WeaponType } from "@prisma/client";

export const data = new SlashCommandBuilder()
  .setName("weapon-refine")
  .setDescription("Merge a duplicate weapon into +1 Refinement on a kept copy (max R5).");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element] ?? 0x6366F1;

  const weapons = await prisma.weapon.findMany({ where: { userId: interaction.user.id } });

  // Group by name — a weapon can only be refined if there's at least one
  // OTHER unequipped copy of the same name to consume as fodder, and the
  // keeper itself must have room to grow (below R5) and a real passive to
  // scale (no WEAPON_PASSIVES entry = nothing for refinement to amplify).
  const byName = new Map<string, typeof weapons>();
  for (const w of weapons) {
    if (!byName.has(w.name)) byName.set(w.name, []);
    byName.get(w.name)!.push(w);
  }

  const refinable = weapons.filter(w => {
    if (w.refinement >= MAX_REFINEMENT) return false;
    if (!WEAPON_PASSIVES[w.name]) return false;
    const dupes = byName.get(w.name)!.filter(x => x.id !== w.id && !x.isEquipped);
    return dupes.length > 0;
  });

  if (refinable.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color)
        .setDescription(
          "◈ No weapons available to refine.\n\n" +
          "You need an **unequipped duplicate** of the same weapon (matching name) to merge into a kept copy, " +
          "and the kept copy must be below **R5** and have a real passive to scale."
        )
        .setFooter({ text: "CARTETHYIA  ·  Weapon Refinement" })],
    });
    return;
  }

  const keeperOptions = refinable.slice(0, 25).map(w => {
    const dupeCount = byName.get(w.name)!.filter(x => x.id !== w.id && !x.isEquipped).length;
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${(w.awakened && w.awakenedName) ? w.awakenedName : w.name}  R${w.refinement}${w.isEquipped ? "  ← equipped" : ""}`)
      .setDescription(`Lv${w.level}  ·  ${RARITY_STARS[w.rarity]}  ·  ${dupeCount} duplicate${dupeCount !== 1 ? "s" : ""} available`)
      .setValue(w.id)
      .setEmoji(WEAPON_TYPE_EMOJI[w.weaponType as WeaponType]);
  });

  const keeperRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("wr_keeper_select")
      .setPlaceholder("Choose a weapon to refine…")
      .addOptions(keeperOptions),
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle("◈  Weapon Refinement")
      .setDescription(
        "Choose which weapon to refine. R1 → R5 scales that weapon's passive magnitude by up to **+60%**, " +
        "stacking independently with Ego Weapon Awakening.\n\n*This consumes one unequipped duplicate per rank.*"
      )
      .setFooter({ text: "CARTETHYIA  ·  Weapon Refinement  ·  Expires in 90s" })],
    components: [keeperRow],
  });

  const keeperCollector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "wr_keeper_select",
    time: 90_000, max: 1,
  });

  keeperCollector?.on("collect", async (sel) => {
    await sel.deferUpdate();
    const keeperId = sel.values[0];
    const keeper   = weapons.find(w => w.id === keeperId);
    if (!keeper) { await sel.editReply({ content: "Weapon not found.", embeds: [], components: [] }); return; }

    const dupes = byName.get(keeper.name)!.filter(x => x.id !== keeper.id && !x.isEquipped);
    const dupeOptions = dupes.slice(0, 25).map(w =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${w.name}  Lv${w.level}  ${RARITY_STARS[w.rarity]}`)
        .setDescription(`Consumed to raise ${keeper.name} to R${keeper.refinement + 1}`)
        .setValue(w.id)
        .setEmoji(WEAPON_TYPE_EMOJI[w.weaponType as WeaponType]),
    );

    const dupeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("wr_dupe_select")
        .setPlaceholder("Choose a duplicate to consume…")
        .addOptions(dupeOptions),
    );

    const displayName = (keeper.awakened && keeper.awakenedName) ? keeper.awakenedName : keeper.name;
    await sel.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle(`◈  Refine — ${displayName}`)
        .setDescription(
          `Currently **R${keeper.refinement}** (\`${Math.round((REFINEMENT_MULT[keeper.refinement] ?? 1) * 100)}%\` passive magnitude).\n` +
          `${describeWeaponPassive(keeper.name) || "*No base passive to describe.*"}\n\n` +
          `Choose a duplicate copy to consume — this **permanently deletes** the consumed copy.`
        )
        .setFooter({ text: "CARTETHYIA  ·  Weapon Refinement" })],
      components: [dupeRow],
    });

    const dupeCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId === "wr_dupe_select",
      time: 60_000, max: 1,
    });

    dupeCollector?.on("collect", async (dsel) => {
      await dsel.deferUpdate();
      const dupeId = dsel.values[0];
      const dupe   = dupes.find(w => w.id === dupeId);
      if (!dupe) { await dsel.editReply({ content: "Duplicate not found.", embeds: [], components: [] }); return; }

      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("wr_confirm").setLabel(`Refine to R${keeper.refinement + 1}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("wr_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      );

      await dsel.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFCD34D)
          .setTitle(`◈  Confirm — Refine ${displayName} to R${keeper.refinement + 1}`)
          .setDescription(`Consuming **${dupe.name}** (Lv${dupe.level}, unequipped) — this cannot be undone.`)
          .setFooter({ text: "CARTETHYIA  ·  Weapon Refinement  ·  Confirm to proceed" })],
        components: [confirmRow],
      });

      const btnCol = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && ["wr_confirm", "wr_cancel"].includes(i.customId),
        time: 30_000, max: 1,
      });

      btnCol?.on("collect", async (btn: ButtonInteraction) => {
        try { await btn.deferUpdate(); } catch { return; }

        if (btn.customId === "wr_cancel") {
          await btn.editReply({ embeds: [new EmbedBuilder().setColor(0x334155).setDescription("Cancelled. No changes made.")], components: [] });
          return;
        }

        // Re-verify both rows still exist and are in the expected state
        // (guards against a stale selection from a second concurrent command).
        const [freshKeeper, freshDupe] = await Promise.all([
          prisma.weapon.findUnique({ where: { id: keeper.id } }),
          prisma.weapon.findUnique({ where: { id: dupe.id } }),
        ]);
        if (!freshKeeper || freshKeeper.userId !== interaction.user.id || freshKeeper.refinement >= MAX_REFINEMENT) {
          await btn.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("⚠ That weapon can no longer be refined (already changed).")], components: [] });
          return;
        }
        if (!freshDupe || freshDupe.userId !== interaction.user.id || freshDupe.isEquipped || freshDupe.name !== freshKeeper.name) {
          await btn.editReply({ embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("⚠ That duplicate is no longer available (already equipped or consumed).")], components: [] });
          return;
        }

        const newRefinement = freshKeeper.refinement + 1;
        await prisma.$transaction([
          prisma.weapon.update({ where: { id: freshKeeper.id }, data: { refinement: newRefinement } }),
          prisma.weapon.delete({ where: { id: freshDupe.id } }),
        ]);
        invalidateBonusCache(interaction.user.id, freshKeeper.characterId);

        await btn.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xFCD34D)
            .setTitle(`✦  Refined — ${displayName} is now R${newRefinement}`)
            .setDescription(
              `Passive magnitude: \`${Math.round((REFINEMENT_MULT[newRefinement] ?? 1) * 100)}%\`` +
              (newRefinement < MAX_REFINEMENT ? `\n\nFind another duplicate to push it further, up to R${MAX_REFINEMENT}.` : "\n\n**Max refinement reached.**")
            )
            .setFooter({ text: "CARTETHYIA  ·  Weapon Refinement" })],
          components: [],
        });
      });

      btnCol?.on("end", async (col) => {
        if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
      });
    });

    dupeCollector?.on("end", async (col) => {
      if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
    });
  });

  keeperCollector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}
