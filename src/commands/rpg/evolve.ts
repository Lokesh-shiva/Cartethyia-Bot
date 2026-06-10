import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, AttachmentBuilder,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import { sanitizeEffects, formatEffects } from "../../lib/abilityEffects";
import {
  EVO_LEVEL_REQUIRED, EVO_DUNGEONS_NEEDED, EVO_BOSS_WL_REQUIRED, EVO_COST,
  EVOLVED_LORE_LINE, evolveEffects, evolvedName, generateEvolution,
} from "../../lib/abilityEvolution";
import { generateAbilityCard } from "../../lib/abilityCard";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};
const EVOLVED_GOLD = 0xFCD34D;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("evolve")
    .setDescription("Evolve your unique ability into its awakened form (Lv50)."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const user = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: {
        level: true, element: true,
        uniqueAbilityName: true, uniqueAbilityLore: true, uniqueAbilityEffects: true,
        abilityEvolved: true, abilityEvoStep: true, abilityEvoDungeons: true,
        paradoxCores: true, stasisLocks: true,
      },
    });
    if (!user) { await replyNotStarted(interaction); return; }

    const color = ELEMENT_HEX[user.element as string] ?? ELEMENT_HEX.NONE;
    const fail = async (msg: string) => {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(color)
          .setTitle("✦  Ability Evolution")
          .setDescription(msg)
          .setFooter({ text: "CARTETHYIA  ·  Unique Ability Evolution" })],
      });
    };

    if (user.abilityEvolved) {
      await fail(`Your ability **${user.uniqueAbilityName}** has already evolved. Its awakened form is permanent.`);
      return;
    }
    if (!user.uniqueAbilityName) {
      await fail("You haven't forged a unique ability yet. Win your first **Ascension Trial** (`/ascend`) first.");
      return;
    }
    if (user.level < EVO_LEVEL_REQUIRED) {
      await fail(`Your resonance isn't ready. Reach **Level ${EVO_LEVEL_REQUIRED}** to begin the evolution quest. (You are Level ${user.level}.)`);
      return;
    }

    // ── Quest status / start ──────────────────────────────────────────────────
    const questLines = (step: number, dungeons: number) => [
      `${step > 1 ? "✅" : step === 1 ? "🔸" : "◇"} **I. Trials of Resonance** — clear **${Math.min(dungeons, EVO_DUNGEONS_NEEDED)}/${EVO_DUNGEONS_NEEDED}** dungeons (\`/dungeon\`)`,
      `${step > 2 ? "✅" : step === 2 ? "🔸" : "◇"} **II. Proof of Strength** — defeat a **World Level ${EVO_BOSS_WL_REQUIRED}+** boss (\`/boss\`)`,
      `${step === 3 ? "🔸" : "◇"} **III. The Awakening** — offer ${CE.pc} **${EVO_COST.paradoxCores} Paradox Cores** + ${CE.sl} **${EVO_COST.stasisLocks} Stasis Locks**`,
    ].join("\n");

    if (user.abilityEvoStep === 0) {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("✦  Ability Evolution — The Awakening Calls")
        .setDescription([
          `**${user.uniqueAbilityName}** strains against its current form. Three trials stand between you and its evolution:`,
          ``,
          questLines(0, 0),
          ``,
          `*Evolution strengthens every effect of your ability and awakens a fourth, dormant power. The trials must be completed in order.*`,
        ].join("\n"))
        .setFooter({ text: "CARTETHYIA  ·  Unique Ability Evolution" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("evo_start").setLabel("Begin the Quest").setStyle(ButtonStyle.Primary).setEmoji("✦"),
      );
      const msg = await interaction.editReply({ embeds: [embed], components: [row] });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
        time: 5 * 60 * 1000, max: 1,
      });
      collector.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate();
        await prisma.user.update({
          where: { id: interaction.user.id },
          data:  { abilityEvoStep: 1, abilityEvoDungeons: 0 },
        });
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(color)
            .setTitle("✦  Evolution Quest — Begun")
            .setDescription([
              `The first trial awaits.`,
              ``,
              questLines(1, 0),
            ].join("\n"))
            .setFooter({ text: "CARTETHYIA  ·  Unique Ability Evolution" })],
          components: [],
        });
      });
      collector.on("end", async (_: any, reason: string) => {
        if (reason === "time") await interaction.editReply({ components: [] }).catch(() => {});
      });
      return;
    }

    // ── Mid-quest progress ────────────────────────────────────────────────────
    if (user.abilityEvoStep === 1 || user.abilityEvoStep === 2) {
      await fail([
        `**${user.uniqueAbilityName}** — evolution quest in progress:`,
        ``,
        questLines(user.abilityEvoStep, user.abilityEvoDungeons),
      ].join("\n"));
      return;
    }

    // ── Step 3 — ready to pay & evolve ───────────────────────────────────────
    const canAfford = user.paradoxCores >= EVO_COST.paradoxCores && user.stasisLocks >= EVO_COST.stasisLocks;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle("✦  Ability Evolution — The Final Offering")
      .setDescription([
        `Both trials are complete. **${user.uniqueAbilityName}** trembles at the threshold.`,
        ``,
        questLines(3, EVO_DUNGEONS_NEEDED),
        ``,
        `**Cost:** ${CE.pc} ${EVO_COST.paradoxCores} Paradox Cores (you have ${user.paradoxCores}) · ${CE.sl} ${EVO_COST.stasisLocks} Stasis Locks (you have ${user.stasisLocks})`,
        canAfford ? "" : `\n⚠️ You can't afford the offering yet. Paradox Cores drop from bosses; Stasis Locks from ascension wins.`,
      ].filter(Boolean).join("\n"))
      .setFooter({ text: "CARTETHYIA  ·  Unique Ability Evolution" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("evo_confirm").setLabel("Complete the Awakening").setStyle(ButtonStyle.Success).setEmoji("✦").setDisabled(!canAfford),
    );
    const msg = await interaction.editReply({ embeds: [embed], components: [row] });
    if (!canAfford) return;

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
      time: 5 * 60 * 1000, max: 1,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      // Re-check + pay atomically
      const paid = await prisma.user.updateMany({
        where: {
          id: interaction.user.id,
          abilityEvolved: false,
          abilityEvoStep: 3,
          paradoxCores: { gte: EVO_COST.paradoxCores },
          stasisLocks:  { gte: EVO_COST.stasisLocks },
        },
        data: {
          paradoxCores: { decrement: EVO_COST.paradoxCores },
          stasisLocks:  { decrement: EVO_COST.stasisLocks },
        },
      });
      if (paid.count === 0) {
        await interaction.editReply({ components: [] }).catch(() => {});
        return;
      }

      const element = (user.element as string) ?? "NONE";

      // AI-personalized evolution (weapon, build, bonds, combat record, personality).
      // Falls back to deterministic element tables if LM Studio is offline.
      const evo = await generateEvolution(interaction.user.id).catch(() => null);
      const oldFx    = sanitizeEffects(user.uniqueAbilityEffects);
      const newFx    = evo?.effects ?? evolveEffects(oldFx, element, interaction.user.id);
      const newName  = evo?.name    ?? evolvedName(user.uniqueAbilityName!, element);
      const loreLine = EVOLVED_LORE_LINE[element] ?? EVOLVED_LORE_LINE.NONE;
      const newLore  = evo?.lore    ?? (user.uniqueAbilityLore ? `${user.uniqueAbilityLore} ${loreLine}` : loreLine);

      await prisma.user.update({
        where: { id: interaction.user.id },
        data:  {
          abilityEvolved:       true,
          uniqueAbilityName:    newName,
          uniqueAbilityLore:    newLore,
          ...(evo?.effect ? { uniqueAbilityEffect: evo.effect } : {}),
          uniqueAbilityEffects: newFx as any,
        },
      });

      const effectLines = formatEffects(sanitizeEffects(newFx, true)).split("\n").filter(Boolean);
      const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
        ?? interaction.user.displayName ?? interaction.user.username;

      const cardBuffer = await generateAbilityCard({
        displayName,
        avatarUrl:   interaction.user.displayAvatarURL({ size: 128, extension: "png" }),
        element,
        abilityName: newName,
        effects:     effectLines,
        lore:        newLore,
        evolved:     true,
      });

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(EVOLVED_GOLD)
          .setTitle("✦  ABILITY EVOLVED")
          .setDescription(`*${newLore}*\n\n**${user.uniqueAbilityName}** has become **${newName}**.\nAll effects strengthened — and a fourth, dormant power awakens.`)
          .setImage("attachment://ability.png")
          .setFooter({ text: "CARTETHYIA  ·  This awakened form is yours alone." })],
        files:      [new AttachmentBuilder(cardBuffer, { name: "ability.png" })],
        components: [],
      });
    });

    collector.on("end", async (_: any, reason: string) => {
      if (reason === "time") await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};

export default command;
