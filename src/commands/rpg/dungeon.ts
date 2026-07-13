import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ChannelType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { DUNGEONS, getDungeon, getScaledWaveEnemy, DungeonDefinition } from "../../lib/dungeons";
import { resolvePlayerBonuses, applyBonuses, apply4pcSkillBonus, apply4pcUltBonus, roll4pcDoubleHit, roll4pcBlock, apply5pcLowHpCrit, apply5pcFirstHit, apply5pcFullHpDmg, get5pcVibDrainMult, get5pcHpRegen, applyLifesteal, elemIgniteProc, elemFrostShield, elemDischargeEnergy, elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit, applyAbilityAttack, abilityV2TurnRegen, effectiveSkillCooldown, hasQuickStrike } from "../../lib/setBonus";
import { compositeVibMult, compositeHasSecondWind } from "../../lib/abilityEffects";
import {
  initNamedSetState, NamedSetState,
  smolderingSovereignOnAction, smolderingSovereignOnDamageTaken, smolderingSovereignOnSkill,
  frostveilBastionOnHitTaken, frostveilBastionCheckPanicShield,
  stormcallersOathOnUltimate, stormcallersOathCheckThunderbolt, stormcallersOathOnBasic,
  windstridersLegacyOnHit, windstridersLegacyOnBigHitTaken, windstridersLegacyCheckExplosion,
  voidbornRemnantOnShatter, voidbornRemnantCheckFrenzy, voidbornRemnantFrenzyActive,
  radiantConvergenceOnTurnHeal, radiantConvergenceOnHitTaken, radiantConvergenceOnCrit, radiantConvergenceCheckBurstHeal,
} from "../../lib/namedSets";
import { echoSkillBaseMult, applyEchoSkill } from "../../lib/echoSkills";
import { hpBar, energyBar, baselineAtk, COUNTER_ELEMENT } from "../../lib/combat";
import { voteNudge, supportNudge } from "../../lib/voteNudge";
import { mailNudge } from "../../lib/mailNudge";
import { rollRarity, rollMainStat, rollSubstats, rollSubstatValue, calcMainStatValue, substatCount, RARITY_STARS, ELEMENT_EMOJI } from "../../lib/echoes";
import { awardUser, isDispatchBlocked, replyNotStarted } from "../../lib/economy";
import { auditAward } from "../../lib/antiCheat";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { checkLevelUp } from "../../lib/progression";
import { computeAura, consumeAura, auraBar, fmtAuraRegen, getMaxAura } from "../../lib/aura";
import { CE, echoEmoji } from "../../lib/emojiManager";
import { trackEvolutionProgress } from "../../lib/abilityEvolution";
import { incrementWeaponBond } from "../../lib/weaponAwakening";
import {
  SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  solaceIntroEffect, solaceBasicDamageMult, solaceAttunementAtkCritBonus,
  solaceAttunementDefBonus, solaceConvergenceHealPct,
} from "../../lib/solace";
import { resolveIntroOutroEffect, IntroOutroEffect } from "../../lib/introOutro";
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "../../lib/attunement";
import {
  WELLSPRING_BASE_ATK_MULT, WELLSPRING_BASE_ENERGY_BONUS,
  getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus,
} from "../../lib/wellspring";
import { ForteState, addForteCharge, isForteMaxed, resetForte } from "../../lib/forte";
import { AllyActionTarget } from "../../lib/allyActions";
import { addConcertoEnergy } from "../../lib/concertoEnergy";
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult, cleanseDebuffs } from "../../lib/debuffs";
import { getOrCreateCharacterProgress } from "../../lib/characterProgress";

const SKILL_CD     = 3;
const ECHO_SKILL_COOLDOWN = 4;
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
              baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true,
              critRate: true, critDmg: true,
              resonanceAura: true, auraUpdatedAt: true, patronTier: true,
              dispatchStatus: true, dispatchEndsAt: true },
  });

  if (!dbUser) { await replyNotStarted(interaction); return; }
  if (isDispatchBlocked(dbUser)) {
    await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before entering combat." });
    return;
  }
  // Aura check
  const auraState = computeAura(dbUser.resonanceAura, dbUser.auraUpdatedAt, getMaxAura(dbUser.patronTier ?? 0));

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

  const nextRegen = auraState.current < auraState.max
    ? `Next charge in **${fmtAuraRegen(auraState.nextRegenMs)}**`
    : "Aura full";

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("◈  Dungeons")
      .setDescription(
        `**Resonance Aura:** ${auraBar(auraState.current, auraState.max)}  ${auraState.current}/${auraState.max}  ·  ${nextRegen}\n` +
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
    const freshAura = computeAura(dbUser.resonanceAura, dbUser.auraUpdatedAt, getMaxAura(dbUser.patronTier ?? 0));
    if (freshAura.current < dungeon.auraCost) {
      await sel.update({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription(
            `◈  Not enough **Resonance Aura**.\n` +
            `**${dungeon.name}** costs **${dungeon.auraCost} ◈** — you have **${freshAura.current}/${freshAura.max}**.\n` +
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
type DungeonUser = { level: number; worldLevel: number; element: string; baseHp: number; baseAtk: number; baseDef: number; critRate: number; critDmg: number };

async function runDungeon(
  interaction: ChatInputCommandInteraction,
  dungeon:     DungeonDefinition,
  dbUser:      DungeonUser,
) {
  const isDevGuild = interaction.guildId === process.env.GUILD_ID;
  const solaceProgress = isDevGuild ? await getOrCreateCharacterProgress(interaction.user.id, "solace") : null;
  const solaceBasicLevel    = solaceProgress?.basicLevel    ?? 1;
  const solaceSkillLevel    = solaceProgress?.skillLevel    ?? 1;
  const solaceUltimateLevel = solaceProgress?.ultimateLevel ?? 1;
  const solaceIntroLevel    = solaceProgress?.introLevel    ?? 1;
  const solaceForteLevel    = solaceProgress?.forteLevel    ?? 1;

  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
    ?? interaction.user.displayName;

  // Create private thread (reused across rechallenges — no new thread per run)
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

  let currentDbUser = dbUser;
  let runNumber     = 1;

  while (true) {
    // Resolve bonuses/stats fresh each run — level or gear may have changed since the last clear
    const bonuses = await resolvePlayerBonuses(interaction.user.id);
    const stats   = applyBonuses(currentDbUser, bonuses);

    await thread.send({
      embeds: [new EmbedBuilder()
        .setColor(dungeon.color)
        .setTitle(`${dungeon.emoji}  ${dungeon.name}${runNumber > 1 ? `  ·  Run ${runNumber}` : ""}`)
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
    const namedState = initNamedSetState();
    let glacioShieldTurnsLeft = 0;
    let glacioShieldElemBonus = 0;
    let stormBuffTurnsLeft    = 0;
    let stormBuffCritBonus    = 0;
    let havocFrenzyAtkMult    = 1.0;
    let havocFrenzyLifesteal  = 0;
    let havocFrenzyDefIgnore  = 0;
    let quickStrikeUsed       = false; // SPD-driven bonus action — once per dungeon run, not per wave
    let echoSkillCooldown      = 0;
    let enemyDefShredTurnsLeft = 0;
    let enemyDefShredPct       = 0;
    let nextAttackCritArmed    = false;
    let survivedAll            = true;

    // ── Milestone 3a: team state (dev guild only), carried across waves the
    // same way playerHp/skillCooldown/etc. already are above. ────────────────
    let activeUnit: "player" | "ally" = "player";
    let allyHp    = SOLACE.hpMax;
    const allyHpMax = SOLACE.hpMax;
    let concertoEnergy: number = 0;
    let playerDebuffs: DebuffState = [];
    let attunement: AttunementState = { mode: null };
    let attunementDoubleTurnsLeft = 0;
    let solaceForte: ForteState = { phase: 0, charge: 0 };
    let forteEmpoweredTurnsLeft = 0;

    for (let waveIdx = 0; waveIdx < dungeon.waves.length; waveIdx++) {
      const result = await runWave(
        thread, interaction.user.id, dungeon, waveIdx, currentDbUser, stats, bonuses,
        {
          playerHp, playerHpMax, playerEnergy, skillCooldown, firstActionDone, firstSkillUsed, v2Stacks,
          namedState, glacioShieldTurnsLeft, glacioShieldElemBonus, stormBuffTurnsLeft, stormBuffCritBonus,
          havocFrenzyAtkMult, havocFrenzyLifesteal, havocFrenzyDefIgnore, quickStrikeUsed,
          echoSkillCooldown, enemyDefShredTurnsLeft, enemyDefShredPct, nextAttackCritArmed,
          isDevGuild, activeUnit, allyHp, allyHpMax, concertoEnergy, playerDebuffs, attunement,
          attunementDoubleTurnsLeft, solaceForte, forteEmpoweredTurnsLeft,
          solaceBasicLevel, solaceSkillLevel, solaceUltimateLevel, solaceIntroLevel, solaceForteLevel,
          displayName,
        },
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
        survivedAll = false;
        break;
      }

      // Carry HP/energy between waves
      playerHp       = result.playerHp;
      playerEnergy   = result.playerEnergy;
      skillCooldown  = Math.max(0, result.skillCooldown - 1);
      firstActionDone = result.firstActionDone;
      firstSkillUsed  = result.firstSkillUsed;
      v2Stacks        = result.v2Stacks;
      glacioShieldTurnsLeft = result.glacioShieldTurnsLeft;
      glacioShieldElemBonus = result.glacioShieldElemBonus;
      stormBuffTurnsLeft    = result.stormBuffTurnsLeft;
      stormBuffCritBonus    = result.stormBuffCritBonus;
      havocFrenzyAtkMult    = result.havocFrenzyAtkMult;
      havocFrenzyLifesteal  = result.havocFrenzyLifesteal;
      havocFrenzyDefIgnore  = result.havocFrenzyDefIgnore;
      quickStrikeUsed       = result.quickStrikeUsed;
      echoSkillCooldown       = result.echoSkillCooldown;
      enemyDefShredTurnsLeft  = result.enemyDefShredTurnsLeft;
      enemyDefShredPct        = result.enemyDefShredPct;
      nextAttackCritArmed     = result.nextAttackCritArmed;

      // Milestone 3a: carry team state between waves too, same mechanism.
      // attunementDoubleTurnsLeft/forteEmpoweredTurnsLeft get the same
      // between-wave decrement skillCooldown already gets above — a wave
      // transition is treated as consuming a turn-equivalent for any
      // cooldown-shaped state, per design spec §2.
      activeUnit    = result.activeUnit;
      allyHp        = result.allyHp;
      concertoEnergy = result.concertoEnergy;
      playerDebuffs = result.playerDebuffs;
      attunement    = result.attunement;
      attunementDoubleTurnsLeft = Math.max(0, result.attunementDoubleTurnsLeft - 1);
      solaceForte   = result.solaceForte;
      forteEmpoweredTurnsLeft = Math.max(0, result.forteEmpoweredTurnsLeft - 1);

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

    if (!survivedAll) {
      await thread.setArchived(true).catch(() => {});
      setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
      return;
    }

    // All 3 waves cleared — grant rewards
    await grantRewards(thread, interaction.user.id, dungeon, currentDbUser.worldLevel, displayName);
    await prisma.user.update({ where: { id: interaction.user.id }, data: { dungeonClears: { increment: 1 }, fractonite: { increment: 40 } } }).catch(() => {});
    await checkLevelUp(interaction.user.id);

    // Offer a rechallenge in the same thread if aura allows — no need to leave and re-pick
    const freshUser = await prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { level: true, worldLevel: true, element: true, baseHp: true, baseAtk: true, baseDef: true,
                critRate: true, critDmg: true, resonanceAura: true, auraUpdatedAt: true, patronTier: true },
    });
    if (!freshUser) { await thread.setArchived(true).catch(() => {}); return; }

    const auraNow  = computeAura(freshUser.resonanceAura, freshUser.auraUpdatedAt, getMaxAura(freshUser.patronTier ?? 0));
    const canAfford = auraNow.current >= dungeon.auraCost;

    const rechallengeBtn = new ButtonBuilder()
      .setCustomId("dg_rechallenge")
      .setLabel(`🔁  Rechallenge  (${dungeon.auraCost} ◈)`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canAfford);
    const leaveBtn = new ButtonBuilder()
      .setCustomId("dg_leave")
      .setLabel("Leave Dungeon")
      .setStyle(ButtonStyle.Secondary);

    const promptMsg = await thread.send({
      embeds: [new EmbedBuilder()
        .setColor(dungeon.color)
        .setDescription(
          canAfford
            ? `Run it back? Rechallenging costs **${dungeon.auraCost} ◈** — you have **${auraNow.current}/${auraNow.max}**.`
            : `Not enough **Resonance Aura** to rechallenge (need **${dungeon.auraCost} ◈**, have **${auraNow.current}/${auraNow.max}**). Next charge in **${fmtAuraRegen(auraNow.nextRegenMs)}**.`
        )
        .setFooter({ text: "CARTETHYIA  ·  Dungeon  ·  Expires in 60s" })],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(rechallengeBtn, leaveBtn)],
    });

    const choice = await new Promise<string>(resolve => {
      const col = promptMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === interaction.user.id && ["dg_rechallenge", "dg_leave"].includes(b.customId),
        time: 60_000, max: 1,
      });
      col.on("collect", async (btn: ButtonInteraction) => { await btn.deferUpdate().catch(() => {}); resolve(btn.customId); });
      col.on("end", (collected) => { if (collected.size === 0) resolve("dg_leave"); });
    });

    await promptMsg.edit({ components: [] }).catch(() => {});

    if (choice !== "dg_rechallenge") {
      await thread.setArchived(true).catch(() => {});
      return;
    }

    await consumeAura(interaction.user.id, dungeon.auraCost);
    currentDbUser = freshUser;
    runNumber++;
  }
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
  namedState:            NamedSetState;
  glacioShieldTurnsLeft: number;
  glacioShieldElemBonus: number;
  stormBuffTurnsLeft:    number;
  stormBuffCritBonus:    number;
  havocFrenzyAtkMult:    number;
  havocFrenzyLifesteal:  number;
  havocFrenzyDefIgnore:  number;
  quickStrikeUsed:       boolean;
  echoSkillCooldown:     number;
  enemyDefShredTurnsLeft: number;
  enemyDefShredPct:       number;
  nextAttackCritArmed:    boolean;
  // ── Milestone 3a: team state ──────────────────────────────────────────
  isDevGuild: boolean;
  activeUnit: "player" | "ally";
  allyHp: number;
  allyHpMax: number;
  concertoEnergy: number;
  playerDebuffs: DebuffState;
  attunement: AttunementState;
  attunementDoubleTurnsLeft: number;
  solaceForte: ForteState;
  forteEmpoweredTurnsLeft: number;
  solaceBasicLevel: number;
  solaceSkillLevel: number;
  solaceUltimateLevel: number;
  solaceIntroLevel: number;
  solaceForteLevel: number;
  // Staged ahead of Tasks 3/5 (swap handler, Solace's Convergence) — those will
  // read ws.displayName inside runWave's turn-handling logic for swap/heal
  // messages, mirroring how encounter.ts reads displayName from function
  // scope. Not consumed yet; not dead weight.
  displayName: string;
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
  const isWeak   = dbUser.element === (COUNTER_ELEMENT[enemy.element] ?? "NONE");

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

  function buildButtons(): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    if (ws.isDevGuild && ws.activeUnit === "ally") {
      const modeLabel = ws.attunement.mode ? `(${ws.attunement.mode})` : "(inactive)";
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dg_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dg_ultimate").setLabel("⚡  Convergence")
          .setStyle(ButtonStyle.Success).setDisabled(ws.concertoEnergy < 100),
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      ));
    } else {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dg_skill")
          .setLabel(ws.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${ws.skillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(ws.skillCooldown > 0),
        new ButtonBuilder().setCustomId("dg_ultimate")
          .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(ws.playerEnergy < 100),
      );
      if (bonuses.echoSkill) {
        const echoReady = ws.echoSkillCooldown === 0;
        row.addComponents(
          new ButtonBuilder().setCustomId("dg_echoskill")
            .setLabel(echoReady ? `🌀  ${bonuses.echoSkill.name}` : `🌀  ${bonuses.echoSkill.name} (${ws.echoSkillCooldown}🔄)`)
            .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
        );
      }
      row.addComponents(
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    }

    if (ws.isDevGuild) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_swap")
          .setLabel(ws.activeUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${ws.displayName}`)
          .setStyle(ButtonStyle.Secondary),
      ));
    }

    return rows;
  }

  let battleMsg = await thread.send({
    embeds: [buildWaveEmbed(`*${enemy.name} emerged. Strike it down.*`)],
    components: buildButtons(),
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

        // Milestone 3a: swap — always consumes the turn, but the Outro
        // (outgoing) + Intro (incoming) combo only fires if Concerto Energy
        // is full at the moment of swap. Ported from encounter.ts's Milestone
        // 1/2a swap handler — same logic, same field names via `ws.` instead
        // of `state.`.
        if (btn.customId === "dg_swap" && ws.isDevGuild) {
          const outgoingIsPlayer = ws.activeUnit === "player";
          const comboReady = ws.concertoEnergy >= 100;
          let swapMoveLine: string;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = outgoingIsPlayer
              ? { hp: ws.allyHp, hpMax: ws.allyHpMax }
              : { hp: ws.playerHp, hpMax: ws.playerHpMax };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
            const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(ws.solaceIntroLevel) : PLAYER_SELF_INTRO;
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            if (!outgoingIsPlayer) ws.nextAttackCritArmed = true;

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;

            let actualGain: number;
            if (outgoingIsPlayer) {
              const before = ws.allyHp;
              ws.allyHp = Math.min(ws.allyHpMax, ws.allyHp + totalBonus);
              actualGain = ws.allyHp - before;
            } else {
              const before = ws.playerHp;
              ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + totalBonus);
              actualGain = ws.playerHp - before;
            }

            swapMoveLine = actualGain > 0
              ? `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : ws.displayName}** — Outro+Intro combo! +${actualGain} HP.`
              : `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : ws.displayName}** — Outro+Intro combo! (already at full HP, no heal needed)`;
            ws.concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART in encounter.ts
          } else {
            swapMoveLine = `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : ws.displayName}** — Concerto Energy not full, no combo triggered.`;
          }

          ws.activeUnit = outgoingIsPlayer ? "ally" : "player";

          try {
            const newMsg = await thread.send({
              embeds: [buildWaveEmbed(swapMoveLine)],
              components: buildButtons(),
            });
            await battleMsg.edit({ components: [] }).catch(() => {});
            battleMsg = newMsg;
            runTurn();
          } catch (err) {
            console.error("[Dungeon] wave message failed:", err);
            resolve({ ...ws, survived: false });
          }
          return;
        }

        let radiantDmgMult = 1.0;
        if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE") {
          const heal = radiantConvergenceOnTurnHeal(ws.namedState, ws.playerHpMax);
          ws.playerHp    = Math.min(ws.playerHpMax, ws.playerHp + heal.healAmount);
          radiantDmgMult = heal.dmgMult;
        }

        const havocFrenzyActive = bonuses.activeNamedSetId === "VOIDBORN_REMNANT" && voidbornRemnantFrenzyActive(ws.namedState);
        const defShredActive = ws.enemyDefShredTurnsLeft > 0;
        const effectiveDef = (havocFrenzyActive ? scaled.def_ * (1 - ws.havocFrenzyDefIgnore) : scaled.def_) * (defShredActive ? (1 - ws.enemyDefShredPct) : 1);
        const defVal       = isShattered ? 0 : effectiveDef;
        const defReduction = Math.min(0.75, defVal / (defVal + 1500));
        const havocAtkMult   = havocFrenzyActive ? ws.havocFrenzyAtkMult : 1.0;
        const havocLifesteal = havocFrenzyActive ? ws.havocFrenzyLifesteal : 0;
        const radCrit = elemRadianceCrit(bonuses.elementPassive, ws.playerHp, ws.playerHpMax);
        const stormCritBuff = ws.stormBuffTurnsLeft > 0 ? ws.stormBuffCritBonus : 0;
        const cRate   = apply5pcLowHpCrit(bonuses, Math.min(1, stats.critRate + radCrit + stormCritBuff), ws.playerHp, ws.playerHpMax);
        const forcedCritActive = ws.nextAttackCritArmed && btn.customId !== "dg_flee";
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
          const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(ws.namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < cRate; abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonus = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg      = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonus) * radiantDmgMult));
          if (roll4pcDoubleHit(bonuses)) dmg *= 2;
          dmg          = apply5pcFirstHit(bonuses, dmg, !ws.firstActionDone);
          dmg          = apply5pcFullHpDmg(bonuses, dmg, ws.playerHp, ws.playerHpMax);
          dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, 1, "BASIC"));
          if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") {
            dmg = windExplosion.proc
              ? Math.floor(dmg * (1 + windExplosion.bonusMult))
              : Math.floor(dmg * windstridersLegacyOnHit(ws.namedState));
          }
          let thunderboltEnergy = 0;
          if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") {
            const tb = stormcallersOathOnBasic(ws.namedState);
            if (tb.proc) { dmg += Math.floor(stats.atk * tb.bonusMult); thunderboltEnergy = tb.bonusEnergy; }
          }
          const ar_b   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "BASIC" });
          dmg          = ar_b.dmg;
          if (ar_b.newStacks !== undefined) ws.v2Stacks = ar_b.newStacks;
          const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && ws.namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(ws.namedState, ws.playerHp, ws.playerHpMax);
          playerDmg    = dmg + ignite.dmg;
          moveLine     = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
          if (ar_b.tag) moveLine += `  ✦${ar_b.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;
          vibBar           = Math.max(0, vibBar - Math.floor(playerDmg * 0.3 * totalVibMult));
          ws.playerEnergy  = Math.min(100, ws.playerEnergy + Math.floor(stats.energyPerTurn) + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_b.bonusEnergy + thunderboltEnergy);
          ws.playerHp      = Math.min(ws.playerHpMax, ws.playerHp + ar_b.healHp);
          ws.playerHp      = applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_b.lifesteal ?? 0), playerDmg, ws.playerHp, ws.playerHpMax);
          if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(ws.namedState, ws.playerEnergy);
        }

        if (btn.customId === "dg_skill") {
          const crit   = forcedCritActive || Math.random() < Math.min(1, cRate + 0.1); abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonusSkill = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg      = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * 1.8 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusSkill) * radiantDmgMult));
          dmg          = apply4pcSkillBonus(bonuses, dmg, !ws.firstSkillUsed);
          dmg          = apply5pcFirstHit(bonuses, dmg, !ws.firstActionDone);
          dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, 1, "SKILL"));
          if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(ws.namedState));
          if (bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN") {
            const sov = smolderingSovereignOnSkill(ws.namedState);
            if (sov.doubleHit) dmg = Math.floor(dmg * sov.bonusMult * 2);
          }
          const ar_s   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "SKILL" });
          dmg          = ar_s.dmg;
          if (ar_s.newStacks !== undefined) ws.v2Stacks = ar_s.newStacks;
          const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && ws.namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(ws.namedState, ws.playerHp, ws.playerHpMax);
          playerDmg    = dmg + ignite.dmg;
          moveLine     = `Resonance Skill — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          if (ar_s.tag) moveLine += `  ✦${ar_s.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;
          vibBar           = Math.max(0, vibBar - Math.floor(playerDmg * 0.6 * totalVibMult));
          ws.skillCooldown  = effectiveSkillCooldown(bonuses, SKILL_CD);
          ws.playerEnergy   = Math.min(100, ws.playerEnergy + Math.floor(stats.energyPerTurn) + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_s.bonusEnergy);
          ws.playerHp       = Math.min(ws.playerHpMax, ws.playerHp + ar_s.healHp);
          ws.playerHp       = applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_s.lifesteal ?? 0), playerDmg, ws.playerHp, ws.playerHpMax);
          ws.firstSkillUsed = true;
        }

        if (btn.customId === "dg_ultimate") {
          abilCrit  = true;
          const smolderMultUlt = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonusUlt = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg   = Math.max(1, Math.floor(stats.atk * smolderMultUlt * havocAtkMult * 3.5 * stats.critDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusUlt) * radiantDmgMult));
          dmg       = apply4pcUltBonus(bonuses, dmg);
          if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(ws.namedState));
          const ar_u = applyAbilityAttack(bonuses, dmg, true, { ...abilCtxBase, moveType: "ULT" });
          dmg        = ar_u.dmg;
          if (ar_u.newStacks !== undefined) ws.v2Stacks = ar_u.newStacks;
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && ws.namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE") radiantConvergenceOnCrit(ws.namedState, ws.playerHp, ws.playerHpMax);
          playerDmg  = dmg;
          moveLine   = `⚡ ULTIMATE — ${playerDmg} DMG`;
          if (ar_u.tag) moveLine += `  ✦${ar_u.tag}`;
          vibBar    = Math.max(0, vibBar - Math.floor(playerDmg * 0.8 * totalVibMult));
          ws.playerEnergy = Math.min(100, ar_u.bonusEnergy); // drain to 0 then apply any ability energy gain
          ws.playerHp     = Math.min(ws.playerHpMax, ws.playerHp + ar_u.healHp);
          ws.playerHp     = applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_u.lifesteal ?? 0), playerDmg, ws.playerHp, ws.playerHpMax);
          if (bonuses.set5pc?.type === "POST_ULT_SKILL") ws.skillCooldown = 0;
          if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") {
            const surge = stormcallersOathOnUltimate();
            ws.stormBuffTurnsLeft = surge.turnsLeft + 1;
            ws.stormBuffCritBonus = surge.critRateBonus;
          }
        }

        if (btn.customId === "dg_echoskill" && bonuses.echoSkill) {
          const def = bonuses.echoSkill;
          const crit = forcedCritActive || def.kind === "GUARANTEED_CRIT" || Math.random() < cRate;
          abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const base = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * echoSkillBaseMult() * (1 - defReduction)));
          const extraElemBonusEcho = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusEcho) * radiantDmgMult);

          const result = applyEchoSkill(def, {
            atk: stats.atk, enemyHp, enemyHpMax: scaled.hp,
            playerHp: ws.playerHp, playerHpMax: ws.playerHpMax,
            playerEnergy: ws.playerEnergy, turn: 1, bossVibMax: 50, crit,
          });
          dmg = Math.floor(dmg * result.dmgMult);
          if (result.doubleHit) dmg *= 2;
          if (result.noDamage) dmg = 0;

          let namedTriggerTag = "";
          if (def.kind === "NAMED_SET_TRIGGER" && bonuses.activeNamedSetId === def.setId) {
            switch (def.setId) {
              case "SMOLDERING_SOVEREIGN":
                ws.namedState.fusionAtkStacks = 4; ws.namedState.fusionSkillDoubleArmed = true;
                namedTriggerTag = "ATK stacks maxed!";
                break;
              case "FROSTVEIL_BASTION":
                if (!ws.namedState.glacioShieldUsed) {
                  ws.namedState.glacioShieldUsed = true;
                  const shieldAmt = Math.floor(ws.playerHpMax * 0.28);
                  ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + shieldAmt);
                  ws.glacioShieldTurnsLeft = 5; ws.glacioShieldElemBonus = 0.22;
                  namedTriggerTag = `+${shieldAmt} HP shield!`;
                }
                break;
              case "STORMCALLERS_OATH":
                ws.namedState.electroThunderboltArmed = true;
                namedTriggerTag = "Thunderbolt armed!";
                break;
              case "WINDSTRIDERS_LEGACY":
                ws.namedState.aeroWindstacks = 6;
                namedTriggerTag = "Windstacks maxed!";
                break;
              case "VOIDBORN_REMNANT":
                if (!ws.namedState.havocFrenzyUsed) {
                  ws.namedState.havocFrenzyUsed = true;
                  ws.namedState.havocFrenzyTurnsLeft = 4;
                  ws.havocFrenzyAtkMult = 1.25; ws.havocFrenzyLifesteal = 0.15; ws.havocFrenzyDefIgnore = 0.20;
                  namedTriggerTag = "Frenzy triggered!";
                }
                break;
              case "RADIANT_CONVERGENCE":
                ws.namedState.spectroHealStacks = 5;
                namedTriggerTag = "Heal-stacks maxed!";
                break;
            }
          }

          const ar_e = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "SKILL" });
          dmg = ar_e.dmg;
          if (ar_e.newStacks !== undefined) ws.v2Stacks = ar_e.newStacks;
          const ignite = result.noDamage ? { dmg: 0, tag: "" } : elemIgniteProc(bonuses.elementPassive, stats.atk);
          playerDmg = dmg + ignite.dmg;
          moveLine  = result.noDamage ? `🌀 ${def.name}` : `🌀 ${def.name}${crit ? " **(CRIT)**" : ""} — ${playerDmg} DMG`;
          if (namedTriggerTag) moveLine += `\n✦ ${namedTriggerTag}`;
          if (ar_e.tag)   moveLine += `  ✦${ar_e.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;

          if (!result.noDamage) {
            vibBar = Math.max(0, vibBar - Math.floor(playerDmg * 0.5 * totalVibMult) - result.extraVibDrain);
          }
          ws.echoSkillCooldown = (result.resetCdOnCrit && crit) ? 0 : ECHO_SKILL_COOLDOWN;

          const energyGain = Math.floor(stats.energyPerTurn) + elemDischargeEnergy(bonuses.elementPassive, crit) + result.bonusEnergy;
          ws.playerEnergy = result.setEnergyFull ? 100 : Math.min(100, ws.playerEnergy + energyGain);
          ws.playerHp     = Math.min(ws.playerHpMax, ws.playerHp + ar_e.healHp + result.healHp);

          let echoLifesteal = bonuses.lifesteal + havocLifesteal + (ar_e.lifesteal ?? 0);
          if (def.kind === "FLAT_LIFESTEAL") echoLifesteal += def.pct;
          ws.playerHp = applyLifesteal(echoLifesteal, playerDmg, ws.playerHp, ws.playerHpMax);

          if (result.armsNextCrit) ws.nextAttackCritArmed = true;
          if (result.defShredTurns > 0) {
            ws.enemyDefShredTurnsLeft = result.defShredTurns + 1;
            ws.enemyDefShredPct = result.defShredPct;
          }
        }

        // V2 turn-start regen (applied each enemy counter phase = start of next player turn)
        const v2Regen = abilityV2TurnRegen(bonuses, ws.playerHpMax);
        if (v2Regen.healHp  > 0) ws.playerHp     = Math.min(ws.playerHpMax, ws.playerHp + v2Regen.healHp);
        if (v2Regen.energy  > 0) ws.playerEnergy = Math.min(100, ws.playerEnergy + v2Regen.energy);

        ws.firstActionDone = true;

        // SPD quick-strike — once per dungeon run, if invested SPD clears the wave enemy's derived SPD
        if (!ws.quickStrikeUsed && btn.customId !== "dg_flee" && hasQuickStrike(stats.spd, dbUser.level)) {
          ws.quickStrikeUsed = true;
          const bonusDmg = Math.max(1, Math.floor(stats.atk * (1 - defReduction)));
          playerDmg += bonusDmg;
          moveLine  += `\n⚡ **Quick Strike** — your speed caught them off guard! +${bonusDmg} bonus DMG!`;
        }

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
          if (bonuses.activeNamedSetId === "VOIDBORN_REMNANT") {
            const remnant  = voidbornRemnantOnShatter();
            const bonusDmg = Math.floor(stats.atk * remnant.bonusMult);
            enemyHp = Math.max(0, enemyHp - bonusDmg);
            const healAmt  = Math.floor(ws.playerHpMax * remnant.healPct);
            ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + healAmt);
            moveLine += `\n🌑 **Voidborn Rupture** — +${bonusDmg} bonus DMG, +${healAmt} HP!`;
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
          if (bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN") smolderingSovereignOnDamageTaken(ws.namedState);
          if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") windstridersLegacyOnBigHitTaken(ws.namedState, bossDmg, ws.playerHpMax);
          if (bonuses.activeNamedSetId === "VOIDBORN_REMNANT") {
            const frenzy = voidbornRemnantCheckFrenzy(ws.namedState, ws.playerHp, ws.playerHpMax);
            if (frenzy.triggered) {
              ws.havocFrenzyAtkMult   = frenzy.atkMult;
              ws.havocFrenzyLifesteal = frenzy.lifesteal;
              ws.havocFrenzyDefIgnore = frenzy.defIgnorePct;
              moveLine += `\n🌑 **Void Frenzy** — ATK +${Math.floor((frenzy.atkMult - 1) * 100)}%, Lifesteal +${Math.floor(frenzy.lifesteal * 100)}%, ignoring ${Math.floor(frenzy.defIgnorePct * 100)}% enemy DEF!`;
            }
          }
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE") {
            radiantConvergenceOnHitTaken(ws.namedState, bossDmg, ws.playerHpMax);
            const burst = radiantConvergenceCheckBurstHeal(ws.namedState, ws.playerHp, ws.playerHpMax);
            if (burst > 0) {
              ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + burst);
              moveLine += `\n✨ **Radiant Convergence** — burst-heal +${burst} HP!`;
            }
          }
          if (bonuses.activeNamedSetId === "FROSTVEIL_BASTION") {
            const counter = frostveilBastionOnHitTaken(ws.namedState);
            if (counter.counterProc) {
              vibBar = Math.max(0, vibBar - Math.floor(50 * counter.vibDrain));
              moveLine += `\n❄️ **Counter-Frost** — drained ${Math.floor(counter.vibDrain * 100)}% enemy vibration!`;
            }
            const panic = frostveilBastionCheckPanicShield(ws.namedState, ws.playerHp, ws.playerHpMax);
            if (panic.triggered) {
              ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + panic.shieldAmount);
              ws.glacioShieldTurnsLeft = panic.turnsLeft + 1;
              ws.glacioShieldElemBonus = panic.elemDmgBonus;
              moveLine += `\n❄️ **Frostveil Shield** — +${panic.shieldAmount} HP, +${Math.floor(panic.elemDmgBonus * 100)}% Glacio DMG for ${panic.turnsLeft} turns!`;
            }
          }
          const hpRegen = get5pcHpRegen(bonuses, ws.playerHpMax);
          if (hpRegen > 0 && typeof bonuses.set5pc?.value === "number" && bonuses.set5pc.value < 1) {
            ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + hpRegen);
          }
          const radRegen = elemRadianceRegen(bonuses.elementPassive, ws.playerHpMax);
          if (radRegen > 0) ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + radRegen);
          ws.playerEnergy = Math.min(100, ws.playerEnergy + 15);
          moveLine      += `\n◇ ${enemy.name} ${move} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
        }

        if (ws.skillCooldown > 0) ws.skillCooldown--;
        if (ws.glacioShieldTurnsLeft > 0) ws.glacioShieldTurnsLeft--;
        if (ws.stormBuffTurnsLeft > 0) ws.stormBuffTurnsLeft--;
        if (ws.namedState.spectroFractureTurnsLeft > 0) ws.namedState.spectroFractureTurnsLeft--;
        if (ws.echoSkillCooldown > 0) ws.echoSkillCooldown--;
        if (ws.enemyDefShredTurnsLeft > 0) ws.enemyDefShredTurnsLeft--;
        if (forcedCritActive) ws.nextAttackCritArmed = false;

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
            components: buildButtons(),
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

  // Fractonite — always +40 per dungeon clear (awarded separately after grantRewards, shown here)
  lines.push(`${CE.ft} 40 Fractonite`);

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

    const { ECHO_DEFINITIONS, BOSS_ECHO_DEFINITIONS, NAMED_SET_ECHO_DEFINITIONS } = await import("../../lib/echoes");

    for (let i = 0; i < dropCount; i++) {
      const rarity  = rollRarity(scaledWeights);
      const element = r.echoElement;

      let echoName: string;
      let cost: number;
      let echoSetId: string | undefined;

      if (isBossTrial) {
        const bossEcho = BOSS_ECHO_DEFINITIONS.find(e => e.element === element);
        echoName  = bossEcho?.name ?? element;
        cost      = 4;
        echoSetId = bossEcho?.setId;
      } else {
        // Includes named-set 1/3-cost echoes alongside the original plain-element pool
        const candidates = [...ECHO_DEFINITIONS, ...NAMED_SET_ECHO_DEFINITIONS].filter(e => e.element === element);
        const enemy       = candidates[Math.floor(Math.random() * candidates.length)];
        echoName  = enemy?.name ?? "Echo";
        cost      = enemy?.cost ?? 1;
        echoSetId = enemy?.setId;
      }

      const mainStat = rollMainStat(cost as 1 | 3 | 4, element as any);
      const subCount = substatCount(rarity);
      const substats = rollSubstats(subCount, mainStat);

      const echoData: any = {
        userId: userId, name: echoName,
        rarity, element, cost,
        ...(echoSetId ? { setId: echoSetId } : {}),
        mainStatType: mainStat, mainStatValue: calcMainStatValue(mainStat, 0, rarity),
      };
      substats.forEach((s, idx) => {
        echoData[`substat${idx + 1}Type`]  = s;
        echoData[`substat${idx + 1}Value`] = rollSubstatValue(s);
      });
      echoPayloads.push(echoData);
      echoLines.push(`${echoEmoji(echoName, elementEmoji(element))} **${echoName}**  ${RARITY_STARS[rarity]}  (${cost}-cost)`);
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
        fractonite:       { increment: gained.fractonite        ?? 0 },
        resonanceExp:     { increment: gained.resonanceExp     ?? 0 },
      },
    }),
    ...echoPayloads.map(data => prisma.echo.create({ data })),
  ];
  await prisma.$transaction(txOps);
  auditAward(userId, {
    credits:          gained.credits          ?? 0,
    tuningModules:    gained.tuningModules    ?? 0,
    sealingTubes:     gained.sealingTubes     ?? 0,
    forgingOres:      gained.forgingOres      ?? 0,
    paradoxCores:     gained.paradoxCores     ?? 0,
    resonanceRecords: gained.resonanceRecords ?? 0,
    fractonite:       gained.fractonite        ?? 0,
  }, "dungeon").catch(() => {});

  const evoLine    = await trackEvolutionProgress(userId, { kind: "dungeon" }).catch(() => null);
  const bondResult = await incrementWeaponBond(userId).catch(() => null);

  await thread.send({
    embeds: [new EmbedBuilder()
      .setColor(dungeon.color)
      .setTitle(`${dungeon.emoji}  Dungeon Cleared!`)
      .setDescription(
        `**${displayName}** conquered all 3 waves of **${dungeon.name}**!\n\n` +
        (echoLines.length ? `**Echoes Dropped:**\n${echoLines.join("\n")}\n\n` : "") +
        `**Materials Earned:**\n${lines.join("\n")}` + voteNudge() + supportNudge() +
        (evoLine ? `\n\n${evoLine}` : "") +
        (bondResult ? `\n✦ Weapon Bond **${bondResult.bond}/10**${bondResult.milestone ? ` — *${bondResult.milestone}*` : ""}` : "") +
        await mailNudge(userId)
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
  lines.push(`${CE.ft} 40 Fractonite`);
  const exp = r.resonanceExp * r.resonanceExpMult;
  if (exp > 0) lines.push(`✨ ${exp} EXP${r.resonanceExpMult > 1 ? ` (${r.resonanceExpMult}×)` : ""}`);
  return lines.join("\n") || "Materials";
}
