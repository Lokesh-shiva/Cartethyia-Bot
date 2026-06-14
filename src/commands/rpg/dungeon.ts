import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ChannelType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { DUNGEONS, getDungeon, getScaledWaveEnemy, DungeonDefinition } from "../../lib/dungeons";
import { resolvePlayerBonuses, applyBonuses, apply4pcSkillBonus, apply4pcUltBonus, roll4pcDoubleHit, roll4pcBlock, apply5pcLowHpCrit, apply5pcFirstHit, apply5pcFullHpDmg, get5pcVibDrainMult, applyLifesteal, elemIgniteProc, elemFrostShield, elemDischargeEnergy, elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit, applyAbilityAttack, abilityV2TurnRegen } from "../../lib/setBonus";
import { compositeVibMult, compositeHasSecondWind } from "../../lib/abilityEffects";
import { hpBar, energyBar, baselineAtk } from "../../lib/combat";
import { voteNudge } from "../../lib/voteNudge";
import { rollRarity, rollMainStat, rollSubstats, rollSubstatValue, calcMainStatValue, substatCount, RARITY_STARS, ELEMENT_EMOJI } from "../../lib/echoes";
import { awardUser, isOnDispatch, replyNotStarted } from "../../lib/economy";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { checkLevelUp } from "../../lib/progression";
import { computeAura, consumeAura, auraBar, fmtAuraRegen, MAX_AURA } from "../../lib/aura";
import { CE } from "../../lib/emojiManager";
import { trackEvolutionProgress } from "../../lib/abilityEvolution";
import { incrementWeaponBond } from "../../lib/weaponAwakening";

const SKILL_CD     = 3;
const TURN_TIMEOUT = 8 * 60 * 1000; // 8 min per turn

// ── Active dungeon guard ──────────────────────────────────────────────────────
// activeDungeons replaced by shared combatLock

function elementEmoji(el: string): string {
  return (ELEMENT_EMOJI as any)[el] ?? "◇";
}

// ── Command ───────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("dungeon")
  .setDescription("Enter a dungeon — fight multiple waves and earn echoes or materials.");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { level: true, worldLevel: true, element: true,
              baseHp: true, baseAtk: true, baseDef: true,
              critRate: true, critDmg: true,
              resonanceAura: true, auraUpdatedAt: true },
  });

  if (!dbUser) { await replyNotStarted(interaction); return; }
  if (await isOnDispatch(interaction.user.id)) {
    await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before entering combat." });
    return;
  }
  // Aura check
  const auraState = computeAura(dbUser.resonanceAura, dbUser.auraUpdatedAt);

  // Build select menu options
  const available = DUNGEONS.filter(d =>
    dbUser.level      >= d.levelReq &&
    dbUser.worldLevel >= d.worldLevelReq
  );

  if (available.length === 0) {
    releaseLock(interaction.user.id);
    await interaction.editReply({ content: "No dungeons available yet. Reach Level 3 to unlock your first." });
    return;
  }

  const options = available.map(d => {
    const canAfford = auraState.current >= d.auraCost;
    return {
      label:       `${d.emoji}  ${d.name}  (${d.auraCost} ◈)${canAfford ? "" : "  ✗ not enough aura"}`,
      description: d.description.slice(0, 100),
      value:       d.id,
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("dungeon_pick")
    .setPlaceholder("Choose a dungeon…")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  // Overview embed — split available vs locked
  const isUnlocked = (d: DungeonDefinition) =>
    dbUser.level >= d.levelReq && dbUser.worldLevel >= d.worldLevelReq;

  const lockHint = (d: DungeonDefinition): string => {
    const parts: string[] = [];
    if (dbUser.level      < d.levelReq)      parts.push(`Lv${d.levelReq}`);
    if (dbUser.worldLevel < d.worldLevelReq) parts.push(`WL${d.worldLevelReq}`);
    return parts.join(" · ");
  };

  const fmtUnlocked = (d: DungeonDefinition) =>
    `${d.emoji} **${d.name}** — ${d.description.split(".")[0]}`;
  const fmtLocked   = (d: DungeonDefinition) =>
    `🔒 ~~${d.name}~~ *(${lockHint(d)})*`;

  const buildField = (type: "ECHO" | "MATERIAL") => {
    const all       = DUNGEONS.filter(d => d.type === type);
    const unlocked  = all.filter(isUnlocked).map(fmtUnlocked);
    const locked    = all.filter(d => !isUnlocked(d)).map(fmtLocked);
    return [...unlocked, ...(locked.length ? ["", ...locked] : [])].join("\n") || "None";
  };

  const nextRegen = auraState.current < MAX_AURA
    ? `Next charge in **${fmtAuraRegen(auraState.nextRegenMs)}**`
    : "Aura full";

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("◈  Dungeons")
      .setDescription(
        `**Resonance Aura:** ${auraBar(auraState.current)}  ${auraState.current}/${MAX_AURA}  ·  ${nextRegen}\n` +
        `*Regens 1 charge every 3 hours. Normal dungeons cost 1 ◈, Boss Trials cost 2 ◈.*`
      )
      .addFields(
        { name: `${CE.pc}  Echo Dungeons`,      value: buildField("ECHO"),     inline: false },
        { name: `${CE.fo}  Material Dungeons`,  value: buildField("MATERIAL"), inline: false },
      )
      .setFooter({ text: "CARTETHYIA  ·  Dungeons  ·  Select a dungeon below" })],
    components: [row],
  });

  const pickCollector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "dungeon_pick",
    time:   60_000, max: 1,
  });

  pickCollector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    const dungeon = getDungeon(sel.values[0]);
    if (!dungeon) {
      await sel.update({ content: "Dungeon not found.", components: [], embeds: [] });
      return;
    }

    // Re-check aura at entry time
    const freshAura = computeAura(dbUser.resonanceAura, dbUser.auraUpdatedAt);
    if (freshAura.current < dungeon.auraCost) {
      await sel.update({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription(
            `◈  Not enough **Resonance Aura**.\n` +
            `**${dungeon.name}** costs **${dungeon.auraCost} ◈** — you have **${freshAura.current}/${MAX_AURA}**.\n` +
            `Next charge in **${fmtAuraRegen(freshAura.nextRegenMs)}**.`
          )
          .setFooter({ text: "CARTETHYIA  ·  Dungeons" })],
        components: [],
      });
      return;
    }

    // Show dungeon detail + confirm
    const confirmBtn = new ButtonBuilder()
      .setCustomId("dungeon_enter")
      .setLabel(`⚔️  Enter ${dungeon.name}`)
      .setStyle(ButtonStyle.Success);
    const cancelBtn = new ButtonBuilder()
      .setCustomId("dungeon_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const rewardLines = buildRewardPreview(dungeon);

    await sel.update({
      embeds: [new EmbedBuilder()
        .setColor(dungeon.color)
        .setTitle(`${dungeon.emoji}  ${dungeon.name}`)
        .setDescription(`*${dungeon.flavor}*\n\n${dungeon.description}`)
        .addFields(
          {
            name:   "⚔️  Waves",
            value:  dungeon.waves.map((w, i) => `Wave ${i + 1}: **${w.enemyName}**`).join("\n"),
            inline: true,
          },
          {
            name:   "🎁  Rewards on Clear",
            value:  rewardLines,
            inline: true,
          },
        )
        .setFooter({ text: `CARTETHYIA  ·  Dungeons  ·  Lv${dungeon.levelReq}+ required  ·  Costs ${dungeon.auraCost} ◈ Aura` })],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn)],
    });

    const confirmCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: b => b.user.id === interaction.user.id && (b.customId === "dungeon_enter" || b.customId === "dungeon_cancel"),
      time:   30_000, max: 1,
    });

    confirmCollector?.on("collect", async (btn: ButtonInteraction) => {
      if (btn.customId === "dungeon_cancel") {
        await btn.update({ embeds: [new EmbedBuilder().setColor(0x4A4A5A).setDescription("Dungeon entry cancelled.")], components: [] });
        return;
      }

      // Acquire lock only now — user is actually entering the fight
      if (!acquireLock(interaction.user.id, "Dungeon")) {
        await btn.update({ content: alreadyInCombatMsg(interaction.user.id), embeds: [], components: [] });
        return;
      }

      await btn.deferUpdate();
      await interaction.editReply({ components: [] });

      // Consume aura immediately on entry
      await consumeAura(interaction.user.id, dungeon.auraCost);

      try {
        await runDungeon(interaction, dungeon, dbUser);
      } catch (err) {
        console.error("[Dungeon] run failed:", err);
        await interaction.editReply({ content: "◈ The dungeon collapsed unexpectedly. Your combat lock has been cleared — try again.", embeds: [], components: [] }).catch(() => {});
      } finally {
        releaseLock(interaction.user.id);
        await clearFight(interaction.user.id);
      }
    });

    confirmCollector?.on("end", async (col) => {
      if (col.size === 0) {
        await interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  });

  pickCollector?.on("end", async (col) => {
    if (col.size === 0) {
      await interaction.editReply({ components: [] }).catch(() => {});
    }
  });
}

// ── Core dungeon runner ───────────────────────────────────────────────────────
async function runDungeon(
  interaction: ChatInputCommandInteraction,
  dungeon:     DungeonDefinition,
  dbUser:      { level: number; worldLevel: number; element: string; baseHp: number; baseAtk: number; baseDef: number; critRate: number; critDmg: number },
) {
  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName;

  // Resolve bonuses once
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
  const stats   = applyBonuses(dbUser, bonuses);

  // Create private thread
  let thread;
  try {
    thread = await (interaction.channel as TextChannel).threads.create({
      name:                `${dungeon.emoji} ${displayName} — ${dungeon.name}`,
      autoArchiveDuration: 60,
      type:                ChannelType.PrivateThread,
    });
    await thread.members.add(interaction.user.id);
  } catch {
    await interaction.editReply({ content: "I need **Create Private Threads** + **Send Messages in Threads** permissions here to run dungeons. Ask an admin, or try another channel.", embeds: [], components: [] }).catch(() => {});
    return;
  }

  await interaction.editReply({ content: `${dungeon.emoji} Dungeon entered! <#${thread.id}>`, embeds: [], components: [] });
  await registerFight(interaction.user.id, thread.id, interaction.guildId!, "Dungeon");

  // Intro
  await thread.send({
    embeds: [new EmbedBuilder()
      .setColor(dungeon.color)
      .setTitle(`${dungeon.emoji}  ${dungeon.name}`)
      .setDescription(`*${dungeon.flavor}*\n\n**3 waves stand between you and your reward.**\nDefeat them all to claim your spoils.`)
      .setFooter({ text: "CARTETHYIA  ·  Dungeon" })],
  });

  // Track player HP across waves (shared)
  let playerHp    = stats.hp;
  const playerHpMax = stats.hp;
  let playerEnergy = 0;
  let skillCooldown = 0;
  let firstActionDone = false;
  let firstSkillUsed  = false;
  let v2Stacks        = 0;

  for (let waveIdx = 0; waveIdx < dungeon.waves.length; waveIdx++) {
    const result = await runWave(
      thread, interaction.user.id, dungeon, waveIdx, dbUser, stats, bonuses,
      { playerHp, playerHpMax, playerEnergy, skillCooldown, firstActionDone, firstSkillUsed, v2Stacks },
      displayName,
    );

    if (!result.survived) {
      // Died — no reward
      await thread.send({
        embeds: [new EmbedBuilder()
          .setColor(0x4A4A5A)
          .setTitle("💀  Dungeon Failed")
          .setDescription(
            `You fell on **Wave ${waveIdx + 1}** of 3.\n\n` +
            `No rewards this run. The dungeon cooldown still applies.\n` +
            `Come back stronger.`
          )
          .setFooter({ text: "CARTETHYIA  ·  Dungeon" })],
      });
      await thread.setArchived(true).catch(() => {});
      setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
      return;
    }

    // Carry HP/energy between waves
    playerHp       = result.playerHp;
    playerEnergy   = result.playerEnergy;
    skillCooldown  = Math.max(0, result.skillCooldown - 1);
    firstActionDone = result.firstActionDone;
    firstSkillUsed  = result.firstSkillUsed;
    v2Stacks        = result.v2Stacks;

    if (waveIdx < dungeon.waves.length - 1) {
      await thread.send({
        embeds: [new EmbedBuilder()
          .setColor(dungeon.color)
          .setDescription(`✦  **Wave ${waveIdx + 1} cleared!**  HP carries over.\n\n*Wave ${waveIdx + 2} approaching…*`)
          .setFooter({ text: "CARTETHYIA  ·  Dungeon" })],
      });
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // All 3 waves cleared — grant rewards
  await grantRewards(thread, interaction.user.id, dungeon, dbUser.worldLevel, displayName);
  await prisma.user.update({ where: { id: interaction.user.id }, data: { dungeonClears: { increment: 1 }, fractureKeys: { increment: 1 } } }).catch(() => {});
  await checkLevelUp(interaction.user.id);
  await thread.setArchived(true).catch(() => {});
}

// ── Single wave fight ─────────────────────────────────────────────────────────
interface WaveState {
  playerHp:        number;
  playerHpMax:     number;
  playerEnergy:    number;
  skillCooldown:   number;
  firstActionDone: boolean;
  firstSkillUsed:  boolean;
  v2Stacks:        number;
}

interface WaveResult extends WaveState {
  survived: boolean;
}

async function runWave(
  thread:      any,
  userId:      string,
  dungeon:     DungeonDefinition,
  waveIdx:     number,
  dbUser:      any,
  stats:       any,
  bonuses:     any,
  ws:          WaveState,
  displayName: string,
): Promise<WaveResult> {
  const rawScaled = getScaledWaveEnemy(dungeon, waveIdx, dbUser.worldLevel);
  // Gear-aware bump so geared players don't trivialize waves (light gear weight)
  const gearRatio = stats.atk / baselineAtk(dbUser.level);
  const gearScale = 1 + Math.max(0, gearRatio - 1) * 0.40;
  const scaled    = {
    def:  rawScaled.def,
    hp:   Math.max(1, Math.floor(rawScaled.hp * gearScale)),
    atk:  rawScaled.atk,
    def_: rawScaled.def_,
  };
  const enemy    = scaled.def;
  const isWeak   = dbUser.element === (enemy.element === "FUSION" ? "GLACIO"
    : enemy.element === "GLACIO" ? "FUSION"
    : enemy.element === "ELECTRO" ? "AERO"
    : enemy.element === "AERO" ? "ELECTRO"
    : enemy.element === "HAVOC" ? "SPECTRO"
    : enemy.element === "SPECTRO" ? "HAVOC" : "NONE");

  let enemyHp  = scaled.hp;
  let vibBar   = 50;
  let isShattered = false;
  let shatterLeft = 0;
  const vibMult   = get5pcVibDrainMult(bonuses);

  function buildWaveEmbed(lastAction: string): EmbedBuilder {
    const ePct = Math.round((enemyHp / scaled.hp) * 100);
    const pPct = Math.round((ws.playerHp / ws.playerHpMax) * 100);
    return new EmbedBuilder()
      .setColor(dungeon.color)
      .setTitle(`${dungeon.emoji}  Wave ${waveIdx + 1} / ${dungeon.waves.length} — ${enemy.name}`)
      .addFields(
        {
          name:   `${elementEmoji(enemy.element)}  ${enemy.name}  (${enemy.cost}-cost)`,
          value:  `${hpBar(enemyHp, scaled.hp)}  ${enemyHp}/${scaled.hp}\n` +
                  `Vibration: ${hpBar(vibBar, 50, 10)}${isShattered ? "  ⚡ **SHATTERED**" : ""}`,
          inline: false,
        },
        {
          name:   `${elementEmoji(dbUser.element)}  ${displayName}`,
          value:  `${hpBar(ws.playerHp, ws.playerHpMax)}  ${ws.playerHp}/${ws.playerHpMax}\n` +
                  `Energy: ${energyBar(ws.playerEnergy)}  ${ws.playerEnergy}/100`,
          inline: false,
        },
        {
          name:   "Last Action",
          value:  lastAction || "*The wave begins.*",
          inline: false,
        },
      )
      .setFooter({ text: `CARTETHYIA  ·  Dungeon  ·  8 min per turn` });
  }

  function buildButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("dg_skill")
        .setLabel(ws.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${ws.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(ws.skillCooldown > 0),
      new ButtonBuilder().setCustomId("dg_ultimate")
        .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(ws.playerEnergy < 100),
      new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
    );
  }

  let battleMsg = await thread.send({
    embeds: [buildWaveEmbed(`*${enemy.name} emerged. Strike it down.*`)],
    components: [buildButtons()],
  });

  return new Promise<WaveResult>((resolve) => {
    const runTurn = () => {
      const collector = battleMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === userId,
        time:   TURN_TIMEOUT,
        max:    1,
      });

      collector.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate().catch(() => {});

        if (btn.customId === "dg_flee") {
          await battleMsg.edit({ components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
          return;
        }

        const defVal       = isShattered ? 0 : scaled.def_;
        const defReduction = Math.min(0.75, defVal / (defVal + 1500));
        const radCrit = elemRadianceCrit(bonuses.elementPassive, ws.playerHp, ws.playerHpMax);
        const cRate   = apply5pcLowHpCrit(bonuses, Math.min(1, stats.critRate + radCrit), ws.playerHp, ws.playerHpMax);
        const totalVibMult = vibMult * compositeVibMult(bonuses.abilityEffects);
        const abilCtxBase = {
          currentHp: ws.playerHp, maxHp: ws.playerHpMax,
          enemyHpPct: enemyHp / scaled.hp, turn: 1, isFirstAction: !ws.firstActionDone,
          isWeak, isShattered, v2Stacks: ws.v2Stacks,
        };
        let playerDmg = 0;
        let moveLine  = "";
        let abilCrit  = false;

        if (btn.customId === "dg_basic") {
          const crit   = Math.random() < cRate; abilCrit = crit;
          let dmg      = Math.max(1, Math.floor(stats.atk * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          if (roll4pcDoubleHit(bonuses)) dmg *= 2;
          dmg          = apply5pcFirstHit(bonuses, dmg, !ws.firstActionDone);
          dmg          = apply5pcFullHpDmg(bonuses, dmg, ws.playerHp, ws.playerHpMax);
          dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, 1, "BASIC"));
          const ar_b   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "BASIC" });
          dmg          = ar_b.dmg;
          if (ar_b.newStacks !== undefined) ws.v2Stacks = ar_b.newStacks;
          const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
          playerDmg    = dmg + ignite.dmg;
          moveLine     = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
          if (ar_b.tag) moveLine += `  ✦${ar_b.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;
          vibBar           = Math.max(0, vibBar - Math.floor(playerDmg * 0.3 * totalVibMult));
          ws.playerEnergy  = Math.min(100, ws.playerEnergy + Math.floor(stats.energyPerTurn) + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_b.bonusEnergy);
          ws.playerHp      = Math.min(ws.playerHpMax, ws.playerHp + ar_b.healHp);
          ws.playerHp      = applyLifesteal(bonuses.lifesteal, playerDmg, ws.playerHp, ws.playerHpMax);
        }

        if (btn.customId === "dg_skill") {
          const crit   = Math.random() < Math.min(1, cRate + 0.1); abilCrit = crit;
          let dmg      = Math.max(1, Math.floor(stats.atk * 1.8 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          dmg          = apply4pcSkillBonus(bonuses, dmg, !ws.firstSkillUsed);
          dmg          = apply5pcFirstHit(bonuses, dmg, !ws.firstActionDone);
          dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, 1, "SKILL"));
          const ar_s   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "SKILL" });
          dmg          = ar_s.dmg;
          if (ar_s.newStacks !== undefined) ws.v2Stacks = ar_s.newStacks;
          const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
          playerDmg    = dmg + ignite.dmg;
          moveLine     = `Resonance Skill — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          if (ar_s.tag) moveLine += `  ✦${ar_s.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;
          vibBar           = Math.max(0, vibBar - Math.floor(playerDmg * 0.6 * totalVibMult));
          ws.skillCooldown  = SKILL_CD;
          ws.playerEnergy   = Math.min(100, ws.playerEnergy + Math.floor(stats.energyPerTurn) + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_s.bonusEnergy);
          ws.playerHp       = Math.min(ws.playerHpMax, ws.playerHp + ar_s.healHp);
          ws.playerHp       = applyLifesteal(bonuses.lifesteal, playerDmg, ws.playerHp, ws.playerHpMax);
          ws.firstSkillUsed = true;
        }

        if (btn.customId === "dg_ultimate") {
          abilCrit  = true;
          let dmg   = Math.max(1, Math.floor(stats.atk * 3.5 * stats.critDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          dmg       = apply4pcUltBonus(bonuses, dmg);
          const ar_u = applyAbilityAttack(bonuses, dmg, true, { ...abilCtxBase, moveType: "ULT" });
          dmg        = ar_u.dmg;
          if (ar_u.newStacks !== undefined) ws.v2Stacks = ar_u.newStacks;
          playerDmg  = dmg;
          moveLine   = `⚡ ULTIMATE — ${playerDmg} DMG`;
          if (ar_u.tag) moveLine += `  ✦${ar_u.tag}`;
          vibBar    = Math.max(0, vibBar - Math.floor(playerDmg * 0.8 * totalVibMult));
          ws.playerEnergy = Math.min(100, ar_u.bonusEnergy); // drain to 0 then apply any ability energy gain
          ws.playerHp     = Math.min(ws.playerHpMax, ws.playerHp + ar_u.healHp);
          ws.playerHp     = applyLifesteal(bonuses.lifesteal, playerDmg, ws.playerHp, ws.playerHpMax);
          if (bonuses.set5pc?.type === "POST_ULT_SKILL") ws.skillCooldown = 0;
        }

        // V2 turn-start regen (applied each enemy counter phase = start of next player turn)
        const v2Regen = abilityV2TurnRegen(bonuses, ws.playerHpMax);
        if (v2Regen.healHp  > 0) ws.playerHp     = Math.min(ws.playerHpMax, ws.playerHp + v2Regen.healHp);
        if (v2Regen.energy  > 0) ws.playerEnergy = Math.min(100, ws.playerEnergy + v2Regen.energy);

        ws.firstActionDone = true;
        enemyHp = Math.max(0, enemyHp - playerDmg);

        if (vibBar <= 0 && !isShattered) {
          isShattered  = true;
          shatterLeft  = 2;
          moveLine    += "\n✦ **SHATTER!** Enemy stunned — all hits critical!";
          const voidHeal = elemVoidSurgeHeal(bonuses.elementPassive, ws.playerHpMax);
          if (voidHeal > 0) {
            ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + voidHeal);
            moveLine   += `\n✦ **Void Surge** — +${voidHeal} HP!`;
          }
        }

        // Win
        if (enemyHp <= 0) {
          await battleMsg.edit({ embeds: [buildWaveEmbed(moveLine + " — **DEFEATED!**")], components: [] }).catch(() => {});
          resolve({ ...ws, survived: true });
          return;
        }

        // Enemy counter
        if (shatterLeft > 0) {
          shatterLeft--;
          if (shatterLeft === 0) { isShattered = false; vibBar = 50; moveLine += "\n◇ Enemy recovers."; }
          else moveLine += `\n◇ Enemy stunned (${shatterLeft} turn${shatterLeft > 1 ? "s" : ""} left).`;
        } else {
          const move    = ["strikes back", "retaliates", "lashes out"][Math.floor(Math.random() * 3)];
          let bossDmg   = Math.max(1, Math.floor(scaled.atk * 0.9 - stats.def * 0.4));
          bossDmg       = roll4pcBlock(bonuses, bossDmg);
          const shield  = elemFrostShield(bonuses.elementPassive, bossDmg);
          bossDmg       = shield.dmg;
          ws.playerHp   = Math.max(0, ws.playerHp - bossDmg);
          const radRegen = elemRadianceRegen(bonuses.elementPassive, ws.playerHpMax);
          if (radRegen > 0) ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + radRegen);
          ws.playerEnergy = Math.min(100, ws.playerEnergy + 15);
          moveLine      += `\n◇ ${enemy.name} ${move} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
        }

        if (ws.skillCooldown > 0) ws.skillCooldown--;

        // Lose
        if (ws.playerHp <= 0) {
          ws.playerHp = 0;
          await battleMsg.edit({ embeds: [buildWaveEmbed(moveLine + " — **YOU FELL.**")], components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
          return;
        }

        // Next turn
        try {
          const newMsg = await thread.send({
            embeds: [buildWaveEmbed(moveLine)],
            components: [buildButtons()],
          });
          await battleMsg.edit({ components: [] }).catch(() => {});
          battleMsg = newMsg;
          runTurn();
        } catch (err) {
          console.error("[Dungeon] wave message failed:", err);
          resolve({ ...ws, survived: false });
        }
      });

      collector.on("end", async (_: any, reason: string) => {
        if (reason === "time") {
          await battleMsg.edit({ components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
        }
      });
    };

    runTurn();
  });
}

// ── Grant rewards ─────────────────────────────────────────────────────────────
async function grantRewards(
  thread:      any,
  userId:      string,
  dungeon:     DungeonDefinition,
  worldLevel:  number,
  displayName: string,
) {
  const r      = dungeon.rewards;
  const gained: Record<string, any> = {};
  const lines:  string[] = [];

  // WL reward multiplier: WL0=1.0×  WL1=1.4×  WL2=1.8×  WL4=2.6×  WL8=4.2×
  const wlMult = 1 + worldLevel * 0.4;
  const scale  = (n: number) => Math.floor(n * wlMult);

  // Materials — all scaled with WL
  const credits = scale(r.credits ?? (dungeon.type === "ECHO" ? 300 : 0));
  if (credits > 0)          { gained.credits          = credits;              lines.push(`${CE.cr} ${credits} Credits`); }
  if (r.tuningModules)    { gained.tuningModules    = scale(r.tuningModules);    lines.push(`${CE.tm} ${scale(r.tuningModules)} Tuning Modules`); }
  if (r.sealingTubes)     { gained.sealingTubes     = scale(r.sealingTubes);     lines.push(`${CE.st} ${scale(r.sealingTubes)} Sealing Tubes`); }
  if (r.forgingOres)      { gained.forgingOres      = scale(r.forgingOres);      lines.push(`${CE.fo} ${scale(r.forgingOres)} Forging Ores`); }
  if (r.paradoxCores)     { gained.paradoxCores     = scale(r.paradoxCores);     lines.push(`${CE.pc} ${scale(r.paradoxCores)} Paradox Cores`); }
  if (r.resonanceRecords) { gained.resonanceRecords = scale(r.resonanceRecords); lines.push(`${CE.rr} ${scale(r.resonanceRecords)} Resonance Records`); }

  // Fracture Key — always +1 per dungeon clear (awarded separately after grantRewards, shown here)
  lines.push(`${CE.fk} 1 Fracture Key`);

  // EXP (with dungeon multiplier AND WL multiplier)
  const totalExp = Math.floor(r.resonanceExp * r.resonanceExpMult * wlMult);
  if (totalExp > 0) { gained.resonanceExp = totalExp; lines.push(`✨ ${totalExp} Resonance EXP${r.resonanceExpMult > 1 ? ` (${r.resonanceExpMult}×)` : ""}${worldLevel > 0 ? ` (+${Math.round((wlMult - 1) * 100)}% WL bonus)` : ""}`); }

  // Echo drops for echo dungeons — build all data first, then atomic write
  const echoLines:    string[] = [];
  const echoPayloads: any[]    = [];
  if (dungeon.type === "ECHO" && r.echoElement && r.echoWeights) {
    const isBossTrial = dungeon.id.startsWith("boss_");
    const dropCount   = isBossTrial ? 1 : 2 + Math.floor(worldLevel * 0.5);

    const baseWeights = r.echoWeights as [number, number, number];
    const wlRarityShift = Math.floor(worldLevel * 5);
    const scaledWeights: [number, number, number] = [
      Math.max(0, baseWeights[0] - wlRarityShift * 1.5),
      Math.min(95, baseWeights[1] + wlRarityShift),
      Math.min(95, baseWeights[2] + wlRarityShift * 0.5),
    ];

    const { ECHO_DEFINITIONS, BOSS_ECHO_DEFINITIONS } = await import("../../lib/echoes");

    for (let i = 0; i < dropCount; i++) {
      const rarity  = rollRarity(scaledWeights);
      const element = r.echoElement;

      let echoName: string;
      let cost: number;

      if (isBossTrial) {
        const bossEcho = BOSS_ECHO_DEFINITIONS.find(e => e.element === element);
        echoName = bossEcho?.name ?? element;
        cost     = 4;
      } else {
        const candidates = ECHO_DEFINITIONS.filter(e => e.element === element);
        const enemy      = candidates[Math.floor(Math.random() * candidates.length)];
        echoName = enemy?.name ?? "Echo";
        cost     = enemy?.cost ?? 1;
      }

      const mainStat = rollMainStat(cost as 1 | 3 | 4, element as any);
      const subCount = substatCount(rarity);
      const substats = rollSubstats(subCount, mainStat);

      const echoData: any = {
        userId: userId, name: echoName,
        rarity, element, cost,
        mainStatType: mainStat, mainStatValue: calcMainStatValue(mainStat, 0, rarity),
      };
      substats.forEach((s, idx) => {
        echoData[`substat${idx + 1}Type`]  = s;
        echoData[`substat${idx + 1}Value`] = rollSubstatValue(s);
      });
      echoPayloads.push(echoData);
      echoLines.push(`${elementEmoji(element)} **${echoName}**  ${RARITY_STARS[rarity]}  (${cost}-cost)`);
    }
  }

  // Atomic: award currency + all echo drops in one transaction
  const txOps: any[] = [
    prisma.user.update({
      where: { id: userId },
      data:  {
        credits:          { increment: gained.credits          ?? 0 },
        tuningModules:    { increment: gained.tuningModules    ?? 0 },
        sealingTubes:     { increment: gained.sealingTubes     ?? 0 },
        forgingOres:      { increment: gained.forgingOres      ?? 0 },
        paradoxCores:     { increment: gained.paradoxCores     ?? 0 },
        resonanceRecords: { increment: gained.resonanceRecords ?? 0 },
        fractureKeys:     { increment: gained.fractureKeys     ?? 0 },
        resonanceExp:     { increment: gained.resonanceExp     ?? 0 },
      },
    }),
    ...echoPayloads.map(data => prisma.echo.create({ data })),
  ];
  await prisma.$transaction(txOps);

  const evoLine    = await trackEvolutionProgress(userId, { kind: "dungeon" }).catch(() => null);
  const bondResult = await incrementWeaponBond(userId).catch(() => null);

  await thread.send({
    embeds: [new EmbedBuilder()
      .setColor(dungeon.color)
      .setTitle(`${dungeon.emoji}  Dungeon Cleared!`)
      .setDescription(
        `**${displayName}** conquered all 3 waves of **${dungeon.name}**!\n\n` +
        (echoLines.length ? `**Echoes Dropped:**\n${echoLines.join("\n")}\n\n` : "") +
        `**Materials Earned:**\n${lines.join("\n")}` + voteNudge() +
        (evoLine ? `\n\n${evoLine}` : "") +
        (bondResult ? `\n✦ Weapon Bond **${bondResult.bond}/10**${bondResult.milestone ? ` — *${bondResult.milestone}*` : ""}` : "")
      )
      .setFooter({ text: "CARTETHYIA  ·  Dungeon  ·  Aura regens 1 charge every 3h" })],
  });
}

// ── Reward preview helper ─────────────────────────────────────────────────────
function buildRewardPreview(dungeon: DungeonDefinition): string {
  const r     = dungeon.rewards;
  const lines = [];
  if (dungeon.type === "ECHO")  lines.push(`${dungeon.emoji} Echo drop (element-matched)`);
  if (r.credits)          lines.push(`${CE.cr} ${r.credits} Credits`);
  if (r.tuningModules)    lines.push(`${CE.tm} ${r.tuningModules} Tuning Modules`);
  if (r.sealingTubes)     lines.push(`${CE.st} ${r.sealingTubes} Sealing Tubes`);
  if (r.forgingOres)      lines.push(`${CE.fo} ${r.forgingOres} Forging Ores`);
  if (r.paradoxCores)     lines.push(`${CE.pc} ${r.paradoxCores} Paradox Cores`);
  if (r.resonanceRecords) lines.push(`${CE.rr} ${r.resonanceRecords} Resonance Records`);
  const exp = r.resonanceExp * r.resonanceExpMult;
  if (exp > 0) lines.push(`✨ ${exp} EXP${r.resonanceExpMult > 1 ? ` (${r.resonanceExpMult}×)` : ""}`);
  return lines.join("\n") || "Materials";
}
