import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ChannelType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { DUNGEONS, getDungeon, getScaledWaveEnemy, DungeonDefinition } from "../../lib/dungeons";
import { resolvePlayerBonuses, applyBonuses, apply4pcSkillBonus, apply4pcUltBonus, roll4pcDoubleHit, roll4pcBlock, apply5pcLowHpCrit, apply5pcFirstHit, apply5pcFullHpDmg, get5pcVibDrainMult, get5pcHpRegen, applyLifesteal, elemIgniteProc, elemFrostShield, elemDischargeEnergy, elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit, applyAbilityAttack, abilityV2TurnRegen, effectiveSkillCooldown, hasQuickStrike, ResolvedStats, PlayerBonuses } from "../../lib/setBonus";
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
import { registerFight, clearFight, addFightAuraCost } from "../../lib/fightTracker";
import { checkLevelUp } from "../../lib/progression";
import { computeAura, consumeAura, auraBar, fmtAuraRegen, getMaxAura } from "../../lib/aura";
import { CE, echoEmoji } from "../../lib/emojiManager";
import { trackEvolutionProgress } from "../../lib/abilityEvolution";
import { incrementWeaponBond } from "../../lib/weaponAwakening";
import {
  SOLACE, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  solaceIntroEffect, solaceOutroEffect, solaceBasicDamageMult, solaceAttunementAtkCritBonus,
  solaceAttunementDefBonus, solaceConvergenceHealPct, solaceConvergenceCleanseCount,
  solaceUltimateDoubleTurns, resolveSolaceStats,
} from "../../lib/solace";
import { resolveIntroOutroEffect, IntroOutroEffect } from "../../lib/introOutro";
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "../../lib/attunement";
import {
  getWellspringBaseAtkMult, getWellspringBaseEnergyBonus,
  getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus,
} from "../../lib/wellspring";
import { ForteState, addForteCharge, isForteMaxed, resetForte } from "../../lib/forte";
import { AllyActionTarget } from "../../lib/allyActions";
import { addConcertoEnergy } from "../../lib/concertoEnergy";
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult, cleanseDebuffs } from "../../lib/debuffs";
import { getOrCreateCharacterProgress } from "../../lib/characterProgress";
import { CHARACTER_KITS, PlayableCharacterKit } from "../../lib/characterKit";
import {
  resolveRoster, nextAliveFallback, isTeamWiped, swappableTargets, positionLabel,
  ResolvedRoster, PositionIndex,
} from "../../lib/teamPositions";

// One roster position's full combat state. Mutated in place across waves so
// ally HP/mechanic state carries over exactly like the player's own HP does.
interface AllyBundle {
  characterId: string; kit: PlayableCharacterKit;
  hp: number; hpMax: number; mechanicState: unknown;
  basicLevel: number; skillLevel: number; ultimateLevel: number; introLevel: number; forteLevel: number;
  constellation: number; solaceStats: any; bonuses: PlayerBonuses;
}
import {
  kaelithStackCap, kaelithBasicStackGain, kaelithUltimateBaseMult, KAELITH_PER_STACK_ULT_BONUS,
  KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC, KaelithMechanicState,
} from "../../lib/kits/kaelithKit";
import {
  VesperMechanicState, VesperSkillResult, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC, vesperUltimateBaseMult,
} from "../../lib/kits/vesperKit";
import {
  RiloMechanicState, RiloSkillResult, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC,
  RILO_SHIELD_GAIN_PER_BASIC, RILO_C2_DEF_SHRED_PCT, riloMaxShield, riloUltimateBaseMult, riloUltimateShieldFromDamage, riloOnHitTaken,
} from "../../lib/kits/riloKit";
import "../../lib/kits";

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
  // Requires the player to actually own + have picked Solace via /team.
  // NOTE: `isDevGuild` is a legacy name kept to avoid touching the many
  // downstream usages below — it no longer means "in the dev guild", it
  // means "has an active Solace ally". Was hard-gated to the dev guild only
  // during development; that gate is exactly the bug that blocked Solace
  // everywhere after launch.
  const teamRow = await prisma.user.findUnique({
    where: { id: interaction.user.id },
    select: { teamPosition1: true, teamPosition2: true, teamPosition3: true },
  });
  // CRITICAL: real read-only ownership lookups, NOT getOrCreateCharacterProgress
  // — that helper CREATES a row if missing, which would silently re-grant
  // ownership to anyone whose roster names a character they don't own,
  // bypassing the gacha entirely.
  const roster: ResolvedRoster = resolveRoster(teamRow ?? { teamPosition1: "self", teamPosition2: null, teamPosition3: null });
  const allyBundles: Partial<Record<PositionIndex, AllyBundle>> = {};
  for (const pos of [1, 2, 3] as PositionIndex[]) {
    const val = pos === 1 ? roster.position1 : pos === 2 ? roster.position2 : roster.position3;
    if (val === null || val === "self") continue;
    const kit = CHARACTER_KITS[val];
    if (!kit) continue;
    const progress = await prisma.characterProgress.findUnique({ where: { userId_characterId: { userId: interaction.user.id, characterId: val } } });
    if (!progress) continue;
    const solaceStats = await kit.resolveStats(interaction.user.id);
    // Ally's own equipped grid's full bonus set — elemDmgBonus/lifesteal/
    // elementPassive/echoSkill/named-set mechanics, NOT the player's. Cheap:
    // resolvePlayerBonuses caches per (userId, characterId) for 30s and
    // kit.resolveStats() already calls it internally for the stat numbers.
    const allyBonuses = await resolvePlayerBonuses(interaction.user.id, val);
    // Use the ally's own gear/level-resolved HP, not the fixed level-90 base.
    const hpMax = solaceStats.hp;
    allyBundles[pos] = {
      characterId: val, kit, hp: hpMax, hpMax, mechanicState: kit.createInitialMechanicState(),
      basicLevel: progress.basicLevel, skillLevel: progress.skillLevel, ultimateLevel: progress.ultimateLevel,
      introLevel: progress.introLevel, forteLevel: progress.forteLevel, constellation: progress.constellation,
      solaceStats, bonuses: allyBonuses,
    };
  }
  // Legacy names — now mean "roster has ≥1 non-self filled position".
  const hasSolace = Object.keys(allyBundles).length > 0;
  const isDevGuild = hasSolace;

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
  await registerFight(interaction.user.id, thread.id, interaction.guildId!, "Dungeon", dungeon.auraCost);

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
    let riloDefBuffTurnsLeft  = 0;
    let riloDefBuffPct        = 0;
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
    let activeUnit: PositionIndex = 1;
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
          namedState, glacioShieldTurnsLeft, glacioShieldElemBonus, riloDefBuffTurnsLeft, riloDefBuffPct, stormBuffTurnsLeft, stormBuffCritBonus,
          havocFrenzyAtkMult, havocFrenzyLifesteal, havocFrenzyDefIgnore, quickStrikeUsed,
          echoSkillCooldown, enemyDefShredTurnsLeft, enemyDefShredPct, nextAttackCritArmed,
          isDevGuild, hasSolace, activeUnit, concertoEnergy, playerDebuffs, attunement,
          attunementDoubleTurnsLeft, solaceForte, forteEmpoweredTurnsLeft,
          roster, allyBundles,
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
      riloDefBuffTurnsLeft  = result.riloDefBuffTurnsLeft;
      riloDefBuffPct        = result.riloDefBuffPct;
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
      concertoEnergy = result.concertoEnergy;
      playerDebuffs = result.playerDebuffs;
      attunement    = result.attunement;
      attunementDoubleTurnsLeft = Math.max(0, result.attunementDoubleTurnsLeft - 1);
      solaceForte   = result.solaceForte;
      forteEmpoweredTurnsLeft = Math.max(0, result.forteEmpoweredTurnsLeft - 1);
      // allyBundles is mutated in place by runWave — HP/mechanicState carry
      // across waves automatically, no reassignment needed.

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
    await addFightAuraCost(interaction.user.id, dungeon.auraCost);
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
  riloDefBuffTurnsLeft:  number;
  riloDefBuffPct:        number;
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
  // Owns+selected an ally via /team, and their own resolved stats (own
  // echoes/weapon) — narrower than isDevGuild alone.
  hasSolace: boolean;
  activeUnit: PositionIndex;
  concertoEnergy: number;
  playerDebuffs: DebuffState;
  attunement: AttunementState;
  attunementDoubleTurnsLeft: number;
  solaceForte: ForteState;
  forteEmpoweredTurnsLeft: number;
  // 3-position roster — `allyBundles` is mutated in place so ally HP/mechanic
  // state carries across waves the same way playerHp already does.
  roster: ResolvedRoster;
  allyBundles: Partial<Record<PositionIndex, AllyBundle>>;
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
  // ── 3-position roster helpers ────────────────────────────────────────────
  // The legacy `ws.ally*`-shaped locals below are resynced from whichever
  // bundle `ws.activeUnit` points at, so every existing per-character
  // dispatch branch keeps working unchanged.
  function posValue(pos: PositionIndex): string | null {
    return pos === 1 ? ws.roster.position1 : pos === 2 ? ws.roster.position2 : ws.roster.position3;
  }
  function isPlayerActive(): boolean { return posValue(ws.activeUnit) === "self"; }
  let activeAllyCharacterId: string | null = null;
  let allyKit: PlayableCharacterKit | null = null;
  let allyHp = 0, allyHpMax = 0;
  let allyMechanicState: unknown = null;
  let allyBasicLevel = 1, allySkillLevel = 1, allyUltimateLevel = 1, allyIntroLevel = 1, allyForteLevel = 1, allyConstellation = 0;
  let allySolaceStats: any = null;
  let allyBonuses: PlayerBonuses | null = null;
  function syncActiveBundle() {
    if (isPlayerActive()) {
      activeAllyCharacterId = null; allyKit = null; allyHp = 0; allyHpMax = 0; allyMechanicState = null;
      allyBasicLevel = 1; allySkillLevel = 1; allyUltimateLevel = 1; allyIntroLevel = 1; allyForteLevel = 1; allyConstellation = 0; allySolaceStats = null;
      allyBonuses = null;
      return;
    }
    const b = ws.allyBundles[ws.activeUnit];
    activeAllyCharacterId = b?.characterId ?? null;
    allyKit = b?.kit ?? null;
    allyHp = b?.hp ?? 0; allyHpMax = b?.hpMax ?? 0;
    allyMechanicState = b?.mechanicState ?? null;
    allyBasicLevel = b?.basicLevel ?? 1; allySkillLevel = b?.skillLevel ?? 1; allyUltimateLevel = b?.ultimateLevel ?? 1;
    allyIntroLevel = b?.introLevel ?? 1; allyForteLevel = b?.forteLevel ?? 1; allyConstellation = b?.constellation ?? 0;
    allySolaceStats = b?.solaceStats ?? null;
    allyBonuses = b?.bonuses ?? null;
  }
  function commitActiveBundle() {
    const b = ws.allyBundles[ws.activeUnit];
    if (b) { b.hp = allyHp; b.mechanicState = allyMechanicState; }
  }
  function currentPositionHp(pos: PositionIndex): number {
    return posValue(pos) === "self" ? ws.playerHp : (ws.allyBundles[pos]?.hp ?? 0);
  }
  function kitLabelFor(id: string): string | null { return CHARACTER_KITS[id]?.label ?? null; }
  syncActiveBundle();

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

  function teamStatusLine(): string {
    if (!ws.hasSolace) return "";
    const benchedLines = ([1, 2, 3] as PositionIndex[])
      .filter(p => p !== ws.activeUnit && posValue(p) !== null)
      .map(p => {
        if (posValue(p) === "self") return `${ws.displayName} — ${ws.playerHp}/${ws.playerHpMax} HP`;
        const b = ws.allyBundles[p];
        return b ? `${b.kit.label} — ${b.hp}/${b.hpMax} HP  ·  ${b.kit.statusLineText(b.mechanicState)}` : null;
      })
      .filter((x): x is string => x !== null);
    if (benchedLines.length === 0) return "";
    const debuffLine = ws.playerDebuffs.length > 0
      ? `  ·  ${ws.playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
      : "";
    return `\n\n🔄 Benched: ${benchedLines.join("  |  ")}\n` +
           `Concerto Energy: **${ws.concertoEnergy}/100**${debuffLine}`;
  }

  // Field must show whichever unit is CURRENTLY active, not always the human
  // player — previously it looked frozen after a swap since only the small
  // "Benched:" status line updated.
  function activeCardIdentity(): { name: string; element: string; hp: number; hpMax: number } {
    if (isPlayerActive()) return { name: displayName, element: dbUser.element, hp: ws.playerHp, hpMax: ws.playerHpMax };
    const b = ws.allyBundles[ws.activeUnit];
    return { name: b?.kit.label ?? "Ally", element: b?.kit.element ?? dbUser.element, hp: b?.hp ?? 0, hpMax: b?.hpMax ?? 0 };
  }

  function buildWaveEmbed(lastAction: string): EmbedBuilder {
    const ePct = Math.round((enemyHp / scaled.hp) * 100);
    const active = activeCardIdentity();
    return new EmbedBuilder()
      .setColor(dungeon.color)
      .setTitle(`${dungeon.emoji}  Wave ${waveIdx + 1} / ${dungeon.waves.length} — ${enemy.name}`)
      .setDescription(teamStatusLine() || null)
      .addFields(
        {
          name:   `${elementEmoji(enemy.element)}  ${enemy.name}  (${enemy.cost}-cost)`,
          value:  `${hpBar(enemyHp, scaled.hp)}  ${enemyHp}/${scaled.hp}\n` +
                  `Vibration: ${hpBar(vibBar, 50, 10)}${isShattered ? "  ⚡ **SHATTERED**" : ""}`,
          inline: false,
        },
        {
          name:   `${elementEmoji(active.element)}  ${active.name}`,
          value:  `${hpBar(active.hp, active.hpMax)}  ${active.hp}/${active.hpMax}\n` +
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

    if (ws.hasSolace && !isPlayerActive() && activeAllyCharacterId === "kaelith") {
      const skillReady = ws.skillCooldown === 0;
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dg_skill")
          .setLabel(skillReady ? "🌑  Umbral Detonation" : `🌑  Detonation (${ws.skillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
        new ButtonBuilder().setCustomId("dg_ultimate").setLabel("🌑  Umbral Cataclysm")
          .setStyle(ButtonStyle.Success).setDisabled(ws.concertoEnergy < 100),
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      ));
    } else if (ws.hasSolace && !isPlayerActive() && activeAllyCharacterId === "vesper") {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dg_skill").setLabel("⚡  Discharge").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dg_ultimate").setLabel("⚡  Overload")
          .setStyle(ButtonStyle.Success).setDisabled(ws.playerEnergy < 100),
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      ));
    } else if (ws.hasSolace && !isPlayerActive() && activeAllyCharacterId === "rilo") {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("dg_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("dg_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dg_ultimate").setLabel("🛡️  Avalanche Slam")
          .setStyle(ButtonStyle.Success).setDisabled(ws.concertoEnergy < 100),
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      ));
    } else if (ws.hasSolace && !isPlayerActive()) {
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
      const renderBonuses = (!isPlayerActive() && allyBonuses) ? allyBonuses : bonuses;
      if (renderBonuses.echoSkill) {
        const echoReady = ws.echoSkillCooldown === 0;
        row.addComponents(
          new ButtonBuilder().setCustomId("dg_echoskill")
            .setLabel(echoReady ? `🌀  ${renderBonuses.echoSkill.name}` : `🌀  ${renderBonuses.echoSkill.name} (${ws.echoSkillCooldown}🔄)`)
            .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
        );
      }
      row.addComponents(
        new ButtonBuilder().setCustomId("dg_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    }

    if (ws.hasSolace) {
      const targets = swappableTargets(ws.roster, ws.activeUnit)
        .filter(p => currentPositionHp(p) > 0)
        .map(pos => ({ pos, label: positionLabel(ws.roster, pos, ws.displayName, kitLabelFor) }));
      if (targets.length === 1) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("dg_swap")
            .setLabel(`🔄  Swap to ${targets[0].label}`)
            .setStyle(ButtonStyle.Secondary),
        ));
      } else if (targets.length > 1) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("dg_swap_select")
            .setPlaceholder("🔄  Swap to…")
            .addOptions(targets.map(t => ({ label: t.label, value: String(t.pos) }))),
        ) as unknown as ActionRowBuilder<ButtonBuilder>);
      }
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
        filter: (b: any) => b.user.id === userId,
        time:   TURN_TIMEOUT,
        max:    1,
      });

      collector.on("collect", async (btn: any) => {
        await btn.deferUpdate().catch(() => {});
        syncActiveBundle();
        // Milestone 3.5b: whichever unit is currently acting/defending uses
        // ITS OWN full bonus set (elemDmgBonus/lifesteal/elementPassive/
        // echoSkill/named-set/etc.), not always the player's own equipped
        // grid — computed early since the RC turn-heal below already needs it.
        let isAllyActingOrDefending = !isPlayerActive() && allyBonuses !== null;
        let activeBonuses = isAllyActingOrDefending ? allyBonuses! : bonuses;
        const swapSelectTarget = btn.customId === "dg_swap_select" && btn.isStringSelectMenu?.()
          ? (Number(btn.values[0]) as PositionIndex) : null;

        if (btn.customId === "dg_flee") {
          await battleMsg.edit({ components: [] }).catch(() => {});
          resolve({ ...ws, survived: false });
          return;
        }

        let radiantDmgMult = 1.0;
        let radiantTurnHealAmount = 0;
        if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE") {
          const heal = radiantConvergenceOnTurnHeal(ws.namedState, ws.playerHpMax, activeBonuses.healingBonus);
          ws.playerHp    = Math.min(ws.playerHpMax, ws.playerHp + heal.healAmount);
          radiantDmgMult = heal.dmgMult;
          radiantTurnHealAmount = heal.healAmount;
        }

        const havocFrenzyActive = activeBonuses.activeNamedSetId === "VOIDBORN_REMNANT" && voidbornRemnantFrenzyActive(ws.namedState);
        const defShredActive = ws.enemyDefShredTurnsLeft > 0;
        const effectiveDef = (havocFrenzyActive ? scaled.def_ * (1 - ws.havocFrenzyDefIgnore) : scaled.def_) * (defShredActive ? (1 - ws.enemyDefShredPct) : 1);
        const defVal       = isShattered ? 0 : effectiveDef;
        const defReduction = Math.min(0.75, defVal / (defVal + 600));
        const havocAtkMult   = havocFrenzyActive ? ws.havocFrenzyAtkMult : 1.0;
        const havocLifesteal = havocFrenzyActive ? ws.havocFrenzyLifesteal : 0;
        const radCrit = elemRadianceCrit(activeBonuses.elementPassive, ws.playerHp, ws.playerHpMax);
        const stormCritBuff = ws.stormBuffTurnsLeft > 0 ? ws.stormBuffCritBonus : 0;
        // Solace's own ATK/DEF/Crit from her own echoes when active, the
        // player's own otherwise (isAllyActingOrDefending/activeBonuses
        // already computed above, right after syncActiveBundle()).
        const activeAtk     = isAllyActingOrDefending ? allySolaceStats!.atk     : stats.atk;
        const activeDef     = isAllyActingOrDefending ? allySolaceStats!.def     : stats.def;
        const activeCritDmg = isAllyActingOrDefending ? allySolaceStats!.critDmg : stats.critDmg;
        const cRate   = apply5pcLowHpCrit(activeBonuses, Math.min(1, (isAllyActingOrDefending ? allySolaceStats!.critRate : stats.critRate) + radCrit + stormCritBuff), ws.playerHp, ws.playerHpMax);
        const forcedCritActive = ws.nextAttackCritArmed && btn.customId !== "dg_flee";
        const totalVibMult = vibMult * compositeVibMult(activeBonuses.abilityEffects);
        const abilCtxBase = {
          currentHp: ws.playerHp, maxHp: ws.playerHpMax,
          enemyHpPct: enemyHp / scaled.hp, turn: 1, isFirstAction: !ws.firstActionDone,
          isWeak, isShattered, v2Stacks: ws.v2Stacks,
        };
        let playerDmg = 0;
        let moveLine  = "";
        let abilCrit  = false;

        // Milestone 3a: swap deals 0 damage and just sets moveLine, then falls
        // through to the shared turn-resolution tail below — same as every
        // other action — so the enemy still gets to act and all per-turn
        // state (cooldowns, buff durations, etc.) still ticks down, exactly
        // like /encounter's swap handler. The Outro (outgoing) + Intro
        // (incoming) combo only fires if Concerto Energy is full at the
        // moment of swap. Ported from encounter.ts's Milestone 1/2a swap
        // handler — same logic, same field names via `ws.` instead of `state.`.
        const dgSwapTargets = ws.hasSolace ? swappableTargets(ws.roster, ws.activeUnit) : [];
        const dgSwapTarget: PositionIndex | null = swapSelectTarget
          ?? ((btn.customId === "dg_swap" && dgSwapTargets.length === 1) ? dgSwapTargets[0] : null);
        if ((btn.customId === "dg_swap" || btn.customId === "dg_swap_select") && ws.hasSolace && dgSwapTarget !== null
            && currentPositionHp(dgSwapTarget) > 0) {
          const outgoingPos = ws.activeUnit;
          const incomingPos = dgSwapTarget;
          const outgoingIsPlayer = posValue(outgoingPos) === "self";
          const incomingIsPlayer = posValue(incomingPos) === "self";
          const outgoingBundle = outgoingIsPlayer ? null : (ws.allyBundles[outgoingPos] ?? null);
          const incomingBundle = incomingIsPlayer ? null : (ws.allyBundles[incomingPos] ?? null);
          const outgoingCharacterId = outgoingBundle?.characterId ?? null;
          const incomingCharacterId = incomingBundle?.characterId ?? null;
          const incomingHpBefore = incomingIsPlayer ? ws.playerHp : (incomingBundle?.hp ?? 0);
          const incomingHpMax = incomingIsPlayer ? ws.playerHpMax : (incomingBundle?.hpMax ?? 0);
          const incomingLabel = incomingIsPlayer ? ws.displayName : (incomingBundle?.kit.label ?? "Ally");
          const comboReady = ws.concertoEnergy >= 100;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = { hp: incomingHpBefore, hpMax: incomingHpMax };
            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : outgoingBundle!.kit.outroEffect(outgoingBundle!.constellation);
            const introEffect: IntroOutroEffect = incomingIsPlayer ? PLAYER_SELF_INTRO : incomingBundle!.kit.introEffect(incomingBundle!.introLevel, incomingBundle!.constellation);
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "kaelith") {
              const grant = (introEffect.newMechanicState as any).grantStacksOnIntro as number | undefined;
              if (grant) {
                const cur = (incomingBundle!.mechanicState as KaelithMechanicState).stacks;
                const cap = kaelithStackCap(incomingBundle!.constellation);
                incomingBundle!.mechanicState = { ...(incomingBundle!.mechanicState as KaelithMechanicState), stacks: Math.min(cap, cur + grant) };
              }
            }
            if (!outgoingIsPlayer && outroEffect.enemyDebuff) {
              ws.enemyDefShredTurnsLeft = outroEffect.enemyDebuff.turns + 1;
              ws.enemyDefShredPct = outroEffect.enemyDebuff.value;
            }
            if (!outgoingIsPlayer && outroEffect.newMechanicState && outgoingCharacterId === "vesper") {
              const grantMark = (outroEffect.newMechanicState as any).grantMarkOnOutro === true;
              const charged = (outroEffect.newMechanicState as any).chargedMark === true;
              if (grantMark) {
                outgoingBundle!.mechanicState = { ...(outgoingBundle!.mechanicState as VesperMechanicState), markPresent: true, chargedMark: charged };
              }
            }
            if (incomingIsPlayer && introEffect.newMechanicState && outgoingCharacterId === "vesper") {
              const energyGrant = (introEffect.newMechanicState as any).grantEnergyOnIntro as number | undefined;
              if (energyGrant) ws.playerEnergy = Math.min(100, ws.playerEnergy + energyGrant);
            }
            let riloShieldTransferBonus = 0;
            if (!outgoingIsPlayer && outroEffect.newMechanicState && outgoingCharacterId === "rilo") {
              const rOutgoing = outgoingBundle!.mechanicState as RiloMechanicState;
              const transferFrac = (outroEffect.newMechanicState as any).grantShieldTransferOnOutro as number;
              riloShieldTransferBonus = Math.floor(rOutgoing.shield * transferFrac);
              if ((outroEffect.newMechanicState as any).grantDefBuffOnOutro) {
                ws.riloDefBuffTurnsLeft = ((outroEffect.newMechanicState as any).defBuffTurns as number) + 1;
                ws.riloDefBuffPct = 0.15;
              }
            }
            if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "rilo") {
              const grant = (introEffect.newMechanicState as any).grantShieldOnIntro as number | undefined;
              if (grant) {
                const rIncoming = incomingBundle!.mechanicState as RiloMechanicState;
                incomingBundle!.mechanicState = { ...rIncoming, shield: Math.min(riloMaxShield(incomingBundle!.constellation), rIncoming.shield + grant) };
              }
            }

            if (!outgoingIsPlayer) ws.nextAttackCritArmed = true;

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta + riloShieldTransferBonus;
            const after = Math.min(incomingHpMax, incomingHpBefore + totalBonus);
            const actualGain = after - incomingHpBefore;
            if (incomingIsPlayer) { ws.playerHp = after; } else { incomingBundle!.hp = after; }

            moveLine = actualGain > 0
              ? `🔄 Swapped to **${incomingLabel}** — Outro+Intro combo! +${actualGain} HP.`
              : `🔄 Swapped to **${incomingLabel}** — Outro+Intro combo! (already at full HP, no heal needed)`;
            ws.concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART in encounter.ts
          } else {
            moveLine = `🔄 Swapped to **${incomingLabel}** — Concerto Energy not full, no combo triggered.`;
          }

          ws.activeUnit = incomingPos;
          syncActiveBundle();
          isAllyActingOrDefending = !isPlayerActive() && allyBonuses !== null;
          activeBonuses = isAllyActingOrDefending ? allyBonuses! : bonuses;
          playerDmg = 0;
        }

        if (btn.customId === "dg_basic") {
          const windExplosion = activeBonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(ws.namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          // Milestone 3a: same Attunement/Wellspring/Forte/kit-level terms as
          // /encounter's Basic Attack, folded into this move's crit-rate
          // computation and damage formula below instead of a shared
          // calcPlayerDamage() call (this file doesn't use that helper).
          const isSolaceAlly = ws.isDevGuild && activeAllyCharacterId === "solace";
          const teamAtkMult  = isSolaceAlly ? getAttunementAtkMult(ws.attunement, solaceAttunementAtkCritBonus(allySkillLevel), ws.attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
          const teamCritBonus = isSolaceAlly ? getAttunementCritRateBonus(ws.attunement, solaceAttunementAtkCritBonus(allySkillLevel), ws.attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0;
          const wellspringAtkMult   = isSolaceAlly && !isPlayerActive() && allySolaceStats?.hasWellspring ? getWellspringBaseAtkMult(allySolaceStats.wellspringRefinement!) : 1;
          const wellspringAtkBonus  = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(ws.attunement, allySolaceStats.wellspringRefinement!) : 0;
          const wellspringCritBonus = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(ws.attunement, allySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus  = isSolaceAlly ? getSolaceForteAtkBonus(allyForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const forteCritBonus = isSolaceAlly ? getSolaceForteCritRateBonus(allyForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = getWeakenedMult(ws.playerDebuffs) * teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          // The active ally's own Basic-track level multiplier — ally-only
          // (this handler is shared with the player's own Basic Attack).
          const basicMoveMult = ws.isDevGuild && !isPlayerActive() && allyKit ? allyKit.basicDamageMult(allyBasicLevel) : 1.0;
          const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < Math.min(1, cRate + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
          const smolderMult = activeBonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonus = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg      = Math.max(1, Math.floor(activeAtk * teamMult * basicMoveMult * smolderMult * havocAtkMult * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus + extraElemBonus) * radiantDmgMult));
          if (roll4pcDoubleHit(bonuses)) dmg *= 2;
          dmg          = apply5pcFirstHit(bonuses, dmg, !ws.firstActionDone);
          dmg          = apply5pcFullHpDmg(bonuses, dmg, ws.playerHp, ws.playerHpMax);
          dmg          = Math.floor(dmg * elemWindstrideMult(activeBonuses.elementPassive, 1, "BASIC"));
          if (activeBonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") {
            dmg = windExplosion.proc
              ? Math.floor(dmg * (1 + windExplosion.bonusMult))
              : Math.floor(dmg * windstridersLegacyOnHit(ws.namedState));
          }
          let thunderboltEnergy = 0;
          if (activeBonuses.activeNamedSetId === "STORMCALLERS_OATH") {
            const tb = stormcallersOathOnBasic(ws.namedState);
            if (tb.proc) { dmg += Math.floor(stats.atk * tb.bonusMult); thunderboltEnergy = tb.bonusEnergy; }
          }
          const ar_b   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "BASIC" });
          dmg          = ar_b.dmg;
          if (ar_b.newStacks !== undefined) ws.v2Stacks = ar_b.newStacks;
          const ignite = elemIgniteProc(activeBonuses.elementPassive, stats.atk);
          if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && ws.namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(ws.namedState, ws.playerHp, ws.playerHpMax);
          playerDmg    = dmg + ignite.dmg;
          moveLine     = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
          if (ar_b.tag) moveLine += `  ✦${ar_b.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;
          vibBar           = Math.max(0, vibBar - Math.floor(playerDmg * 0.3 * totalVibMult));
          ws.playerEnergy  = Math.min(100, ws.playerEnergy + Math.floor(stats.energyPerTurn) + elemDischargeEnergy(activeBonuses.elementPassive, crit) + ar_b.bonusEnergy + thunderboltEnergy);
          ws.playerHp      = Math.min(ws.playerHpMax, ws.playerHp + ar_b.healHp);
          ws.playerHp      = applyLifesteal(activeBonuses.lifesteal + havocLifesteal + (ar_b.lifesteal ?? 0), playerDmg, ws.playerHp, ws.playerHpMax);
          if (activeBonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(ws.namedState, ws.playerEnergy);

          if (ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith") {
            const kState = allyMechanicState as KaelithMechanicState;
            const gain = kaelithBasicStackGain(allyConstellation);
            const cap = kaelithStackCap(allyConstellation);
            allyMechanicState = { ...kState, stacks: Math.min(cap, kState.stacks + gain) };
            moveLine += `\n🌑 +${gain} stack${gain === 1 ? "" : "s"} (${(allyMechanicState as KaelithMechanicState).stacks}/${cap})`;
          }
          if (ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper") {
            const vState = allyMechanicState as VesperMechanicState;
            allyMechanicState = { ...vState, markPresent: true };
            moveLine += `\n⚡ Static Mark applied!`;
          }
          if (ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo") {
            const rState = allyMechanicState as RiloMechanicState;
            const maxShield = riloMaxShield(allyConstellation);
            const critBonus = crit ? Math.floor(RILO_SHIELD_GAIN_PER_BASIC * (allyConstellation >= 1 ? 0.5 : 0)) : 0;
            allyMechanicState = { ...rState, shield: Math.min(maxShield, rState.shield + RILO_SHIELD_GAIN_PER_BASIC + critBonus) };
            moveLine += `\n🛡️ +${RILO_SHIELD_GAIN_PER_BASIC + critBonus} Shield (${(allyMechanicState as RiloMechanicState).shield}/${maxShield})`;
          }

          // Forte fills only from the active ally's own Basic Attack — announce
          // only on the turn a threshold is actually crossed, matching
          // encounter.ts's Milestone 2c Forte-fill logic.
          if (isSolaceAlly) {
            const forteBefore = ws.solaceForte;
            ws.solaceForte = addForteCharge(ws.solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
            const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
            const isHalf  = ws.solaceForte.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(ws.solaceForte, SOLACE_FORTE_CONFIG);
            if (isForteMaxed(ws.solaceForte, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
            } else if (isHalf && !wasHalf) {
              moveLine += `\n✨ Forte is **HALF CHARGED**.`;
            }
          } else if (ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper") {
            const forteBefore = ws.solaceForte;
            ws.solaceForte = addForteCharge(ws.solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
            if (isForteMaxed(ws.solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
            }
          } else if (ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo") {
            const forteBefore = ws.solaceForte;
            ws.solaceForte = addForteCharge(ws.solaceForte, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
            if (isForteMaxed(ws.solaceForte, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
            }
          }
        }

        if (btn.customId === "dg_skill" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          // Deals a small hit using the player's own stat block (Solace has
          // no independent stat block yet — same simplification /encounter
          // uses). Ported from encounter.ts's Milestone 2a Skill branch.
          ws.attunement.mode = cycleAttunementMode(ws.attunement.mode);
          if (allyConstellation >= 3) ws.concertoEnergy = addConcertoEnergy(ws.concertoEnergy, 25);
          const crit = Math.random() < cRate; abilCrit = crit;
          const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus)));
          playerDmg  = dmg;
          moveLine   = `✦ Attunement — now in **${ws.attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          vibBar     = Math.max(0, vibBar - Math.floor(playerDmg * 0.3 * totalVibMult));
        } else if (btn.customId === "dg_skill" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith" && allyKit) {
          const kState = allyMechanicState as KaelithMechanicState;
          if (kState.stacks <= 0) {
            moveLine = `🌑 Umbral Detonation — no stacks to consume! (0 DMG bonus)`;
            playerDmg = 0;
          } else {
            const crit = Math.random() < cRate; abilCrit = crit;
            const result = allyKit.onSkill(
              { playerHp: ws.playerHp, playerHpMax: ws.playerHpMax, allyHp: allyHp, allyHpMax: allyHpMax, turn: 1, isShattered, mechanicState: kState },
              { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
              allyConstellation,
            );
            allyMechanicState = result.newMechanicState;
            const dmg = Math.max(1, Math.floor(activeAtk * result.damageMult * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus)));
            playerDmg = dmg;
            moveLine  = `🌑 ${result.moveLabel} — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            vibBar    = Math.max(0, vibBar - Math.floor(playerDmg * result.vibFrac * totalVibMult));
          }
          ws.skillCooldown = allyKit.skillCooldownTurns;
        } else if (btn.customId === "dg_skill" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper" && allyKit) {
          const vState = allyMechanicState as VesperMechanicState;
          const crit = Math.random() < cRate; abilCrit = crit;
          const forteEmpowered = isForteMaxed(ws.solaceForte, VESPER_FORTE_CONFIG);
          const result = allyKit.onSkill(
            { playerHp: ws.playerHp, playerHpMax: ws.playerHpMax, allyHp: allyHp, allyHpMax: allyHpMax, turn: 1, isShattered, mechanicState: vState, forteEmpowered } as any,
            { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
            allyConstellation,
          ) as VesperSkillResult;
          allyMechanicState = result.newMechanicState;
          if (forteEmpowered) ws.solaceForte = resetForte();

          const effectiveDefReduction = 1 - (1 - defReduction) * (1 - result.defIgnorePct);
          const perHitBase = Math.max(1, Math.floor(activeAtk * (result.damageMult / result.hits) * (1 - effectiveDefReduction)));
          const perHitDmg  = Math.floor(perHitBase * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus));

          if (result.hits > 1) {
            const hitLines = Array.from({ length: result.hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
            playerDmg = perHitDmg * result.hits;
            moveLine  = `⚡ ${result.moveLabel}\n${hitLines}\n**Total: ${playerDmg} DMG**${crit ? " **(CRIT)**" : ""}`;
          } else {
            playerDmg = perHitDmg;
            moveLine  = `⚡ ${result.moveLabel} — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          }
          vibBar = Math.max(0, vibBar - Math.floor(playerDmg * result.vibFrac * totalVibMult));

          if (!forteEmpowered) {
            const forteBefore = ws.solaceForte;
            ws.solaceForte = addForteCharge(ws.solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
            if (isForteMaxed(ws.solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
            }
          }
        } else if (btn.customId === "dg_skill" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo" && allyKit) {
          const rState = allyMechanicState as RiloMechanicState;
          const crit = true; abilCrit = crit;
          const forteEmpowered = isForteMaxed(ws.solaceForte, RILO_FORTE_CONFIG);
          const result = allyKit.onSkill(
            { playerHp: ws.playerHp, playerHpMax: ws.playerHpMax, allyHp: allyHp, allyHpMax: allyHpMax, turn: 1, isShattered, mechanicState: rState, forteEmpowered } as any,
            { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
            allyConstellation,
          ) as RiloSkillResult;
          allyMechanicState = result.newMechanicState;
          if (forteEmpowered) ws.solaceForte = resetForte();

          const base = Math.max(1, Math.floor(activeAtk * result.damageMult * (1 - defReduction)));
          const dmg  = Math.floor(base * activeCritDmg * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus));
          playerDmg  = dmg;
          moveLine   = `🛡️ ${result.moveLabel} — ${playerDmg} DMG **(CRIT)** (consumed ${result.shieldConsumed} Shield)`;
          if (result.defShredApplied) {
            ws.enemyDefShredTurnsLeft = 2 + 1;
            ws.enemyDefShredPct = RILO_C2_DEF_SHRED_PCT;
            moveLine += `\n❄️ Enemy DEF shredded 10% for 2 turns!`;
          }
          vibBar = Math.max(0, vibBar - Math.floor(playerDmg * result.vibFrac * totalVibMult));
        } else if (btn.customId === "dg_skill") {
          const isSolaceAllySkill = ws.isDevGuild && activeAllyCharacterId === "solace";
          const teamAtkMult  = isSolaceAllySkill ? getAttunementAtkMult(ws.attunement, solaceAttunementAtkCritBonus(allySkillLevel), ws.attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
          const teamCritBonus = isSolaceAllySkill ? getAttunementCritRateBonus(ws.attunement, solaceAttunementAtkCritBonus(allySkillLevel), ws.attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0;
          const wellspringAtkBonus  = isSolaceAllySkill && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(ws.attunement, allySolaceStats.wellspringRefinement!) : 0;
          const wellspringCritBonus = isSolaceAllySkill && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(ws.attunement, allySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus  = isSolaceAllySkill ? getSolaceForteAtkBonus(allyForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const forteCritBonus = isSolaceAllySkill ? getSolaceForteCritRateBonus(allyForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = getWeakenedMult(ws.playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const crit   = forcedCritActive || Math.random() < Math.min(1, cRate + 0.1 + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
          const smolderMult = activeBonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonusSkill = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg      = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * 1.8 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus + extraElemBonusSkill) * radiantDmgMult));
          dmg          = apply4pcSkillBonus(bonuses, dmg, !ws.firstSkillUsed);
          dmg          = apply5pcFirstHit(bonuses, dmg, !ws.firstActionDone);
          dmg          = Math.floor(dmg * elemWindstrideMult(activeBonuses.elementPassive, 1, "SKILL"));
          if (activeBonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(ws.namedState));
          if (activeBonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN") {
            const sov = smolderingSovereignOnSkill(ws.namedState);
            if (sov.doubleHit) dmg = Math.floor(dmg * sov.bonusMult * 2);
          }
          const ar_s   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "SKILL" });
          dmg          = ar_s.dmg;
          if (ar_s.newStacks !== undefined) ws.v2Stacks = ar_s.newStacks;
          const ignite = elemIgniteProc(activeBonuses.elementPassive, stats.atk);
          if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && ws.namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(ws.namedState, ws.playerHp, ws.playerHpMax);
          playerDmg    = dmg + ignite.dmg;
          moveLine     = `Resonance Skill — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          if (ar_s.tag) moveLine += `  ✦${ar_s.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;
          vibBar           = Math.max(0, vibBar - Math.floor(playerDmg * 0.6 * totalVibMult));
          ws.skillCooldown  = effectiveSkillCooldown(bonuses, SKILL_CD);
          ws.playerEnergy   = Math.min(100, ws.playerEnergy + Math.floor(stats.energyPerTurn) + elemDischargeEnergy(activeBonuses.elementPassive, crit) + ar_s.bonusEnergy);
          ws.playerHp       = Math.min(ws.playerHpMax, ws.playerHp + ar_s.healHp);
          ws.playerHp       = applyLifesteal(activeBonuses.lifesteal + havocLifesteal + (ar_s.lifesteal ?? 0), playerDmg, ws.playerHp, ws.playerHpMax);
          ws.firstSkillUsed = true;
        }

        // Set inside Solace's Convergence branch below — Convergence resets
        // ws.concertoEnergy to 0, so the generic per-move gain further down
        // must skip granting anything back on the same turn, or Convergence
        // would silently refund ~35-47% of the bar it just spent.
        let convergenceUsedThisTurn = false;

        if (btn.customId === "dg_ultimate" && !(ws.isDevGuild && !isPlayerActive())) {
          // No base ATK boost here — Wellspring's base boost is Solace-only,
          // and this branch only ever runs for the player's own Ultimate
          // (Solace's own Ultimate/Convergence is a separate branch, Task 5).
          abilCrit  = true;
          const isSolaceAllyUlt = ws.isDevGuild && activeAllyCharacterId === "solace";
          const teamAtkMult = isSolaceAllyUlt ? getAttunementAtkMult(ws.attunement, solaceAttunementAtkCritBonus(allySkillLevel), ws.attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
          const wellspringAtkBonus = isSolaceAllyUlt && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(ws.attunement, allySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus = isSolaceAllyUlt ? getSolaceForteAtkBonus(allyForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = getWeakenedMult(ws.playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const smolderMultUlt = activeBonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const extraElemBonusUlt = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg   = Math.max(1, Math.floor(stats.atk * teamMult * smolderMultUlt * havocAtkMult * 3.5 * stats.critDmg * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus + extraElemBonusUlt) * radiantDmgMult));
          dmg       = apply4pcUltBonus(bonuses, dmg);
          if (activeBonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(ws.namedState));
          const ar_u = applyAbilityAttack(bonuses, dmg, true, { ...abilCtxBase, moveType: "ULT" });
          dmg        = ar_u.dmg;
          if (ar_u.newStacks !== undefined) ws.v2Stacks = ar_u.newStacks;
          if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && ws.namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE") radiantConvergenceOnCrit(ws.namedState, ws.playerHp, ws.playerHpMax);
          playerDmg  = dmg;
          moveLine   = `⚡ ULTIMATE — ${playerDmg} DMG`;
          if (ar_u.tag) moveLine += `  ✦${ar_u.tag}`;
          vibBar    = Math.max(0, vibBar - Math.floor(playerDmg * 0.8 * totalVibMult));
          ws.playerEnergy = Math.min(100, ar_u.bonusEnergy); // drain to 0 then apply any ability energy gain
          ws.playerHp     = Math.min(ws.playerHpMax, ws.playerHp + ar_u.healHp);
          ws.playerHp     = applyLifesteal(activeBonuses.lifesteal + havocLifesteal + (ar_u.lifesteal ?? 0), playerDmg, ws.playerHp, ws.playerHpMax);
          if (activeBonuses.set5pc?.type === "POST_ULT_SKILL") ws.skillCooldown = 0;
          if (activeBonuses.activeNamedSetId === "STORMCALLERS_OATH") {
            const surge = stormcallersOathOnUltimate();
            ws.stormBuffTurnsLeft = surge.turnsLeft + 1;
            ws.stormBuffCritBonus = surge.critRateBonus;
          }
        } else if (btn.customId === "dg_ultimate" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace") {
          // Solace's Ultimate spends Concerto Energy, not personal Energy —
          // team heal (both HP pools, level-scaled %) + cleanse + doubles the
          // active Attunement mode for 3 turns (or, if Forte is maxed,
          // Empowered Convergence — all 3 modes at once). Ported from
          // encounter.ts's Milestone 2a/2c/2e Convergence branch.
          const healPct = solaceConvergenceHealPct(allyUltimateLevel, allyConstellation);
          const healResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
            { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(allyConstellation) },
          ] }, { hp: ws.playerHp, hpMax: ws.playerHpMax });
          const allyHealResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
          ] }, { hp: allyHp, hpMax: allyHpMax });

          const beforePlayer = ws.playerHp;
          ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + healResult.hpDelta);
          const actualHealPlayer = ws.playerHp - beforePlayer;

          const beforeAlly = allyHp;
          allyHp = Math.min(allyHpMax, allyHp + allyHealResult.hpDelta);
          const actualHealAlly = allyHp - beforeAlly;

          ws.playerDebuffs = cleanseDebuffs(ws.playerDebuffs, healResult.cleanseCount);

          ws.concertoEnergy = 0;
          convergenceUsedThisTurn = true;
          playerDmg = 0; abilCrit = false;

          const healSummary = `${ws.displayName} +${actualHealPlayer} HP, ${allyKit?.label ?? "Solace"} +${actualHealAlly} HP`;

          if (isForteMaxed(ws.solaceForte, SOLACE_FORTE_CONFIG)) {
            ws.forteEmpoweredTurnsLeft = solaceUltimateDoubleTurns(allyConstellation) + 1; // +1 compensates for the same-round decrement
            ws.attunementDoubleTurnsLeft = 0;
            ws.solaceForte = resetForte();
            moveLine = `⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**all 3 Attunement Modes empowered for ${solaceUltimateDoubleTurns(allyConstellation)} turns!**`;
          } else {
            ws.attunementDoubleTurnsLeft = solaceUltimateDoubleTurns(allyConstellation) + 1; // +1 compensates for the same-round decrement
            ws.forteEmpoweredTurnsLeft = 0;
            moveLine = `⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**${ws.attunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(allyConstellation)} turns!**`;
          }
        } else if (btn.customId === "dg_ultimate" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith" && allyKit) {
          const kState = allyMechanicState as KaelithMechanicState;
          const stacksConsumed = kState.stacks;

          const ultDamageMult = allyConstellation >= 6
            ? stacksConsumed * (KAELITH_PER_STACK_ULT_BONUS * 1.6)
            : kaelithUltimateBaseMult(allyUltimateLevel) + stacksConsumed * KAELITH_PER_STACK_ULT_BONUS;

          const result = allyKit.onUltimate(
            { playerHp: ws.playerHp, playerHpMax: ws.playerHpMax, allyHp: allyHp, allyHpMax: allyHpMax, turn: 1, isShattered, mechanicState: kState },
            { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
            allyConstellation,
          );
          allyMechanicState = result.newMechanicState;

          const dmg = Math.max(1, Math.floor(activeAtk * ultDamageMult * (1 - defReduction) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus)));
          playerDmg = dmg;
          moveLine  = `🌑 ${result.moveLabel} — ${playerDmg} DMG`;
          vibBar    = Math.max(0, vibBar - Math.floor(playerDmg * 0.8 * totalVibMult));

          if (result.healResult.actions.length > 0) {
            const healResult = resolveIntroOutroEffect(result.healResult, { hp: allyHp, hpMax: allyHpMax });
            allyHp = Math.min(allyHpMax, allyHp + healResult.hpDelta);
          }
          if (result.resetsConcertoEnergy) { ws.concertoEnergy = 0; convergenceUsedThisTurn = true; }
        } else if (btn.customId === "dg_ultimate" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper" && allyKit) {
          const vState = allyMechanicState as VesperMechanicState;
          const consumedMark = vState.markPresent;
          const energyPct = Math.min(100, ws.playerEnergy) / 100;
          const markBonus = consumedMark ? 0.8 : 0;
          const c6Bonus = allyConstellation >= 6 ? vState.dischargesSinceUltimate * 0.15 : 0;
          const c3Bonus = allyConstellation >= 3 ? energyPct * 0.5 : 0;
          const ultDamageMult = vesperUltimateBaseMult(allyUltimateLevel) + markBonus + c6Bonus + c3Bonus;

          const result = allyKit.onUltimate(
            { playerHp: ws.playerHp, playerHpMax: ws.playerHpMax, allyHp: allyHp, allyHpMax: allyHpMax, turn: 1, isShattered, mechanicState: vState, playerEnergy: ws.playerEnergy, playerEnergyMax: 100 },
            { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
            allyConstellation,
          );
          allyMechanicState = result.newMechanicState;

          const dmg = Math.max(1, Math.floor(activeAtk * ultDamageMult * (1 - defReduction) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus)));
          playerDmg = dmg;
          moveLine  = `⚡ ${result.moveLabel} — ${playerDmg} DMG`;
          vibBar    = Math.max(0, vibBar - Math.floor(playerDmg * 0.8 * totalVibMult));
        } else if (btn.customId === "dg_ultimate" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo" && allyKit) {
          const rState = allyMechanicState as RiloMechanicState;
          const result = allyKit.onUltimate(
            { playerHp: ws.playerHp, playerHpMax: ws.playerHpMax, allyHp: allyHp, allyHpMax: allyHpMax, turn: 1, isShattered, mechanicState: rState },
            { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
            allyConstellation,
          );
          const maxShield = riloMaxShield(allyConstellation);
          const c6DoubleHit = allyConstellation >= 6 && rState.shield >= maxShield;
          const hits = c6DoubleHit ? 2 : 1;

          const perHitBase = Math.max(1, Math.floor(activeAtk * (riloUltimateBaseMult(allyUltimateLevel) / hits) * (1 - defReduction)));
          const perHitDmg  = Math.floor(perHitBase * activeCritDmg * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus));
          const totalDmg   = perHitDmg * hits;

          const c4Bonus = riloUltimateShieldFromDamage(totalDmg, allyConstellation);
          allyMechanicState = {
            ...(result.newMechanicState as RiloMechanicState),
            shield: Math.min(maxShield, (result.newMechanicState as RiloMechanicState).shield + c4Bonus),
          };

          if (hits > 1) {
            const hitLines = Array.from({ length: hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
            playerDmg = totalDmg;
            moveLine  = `🛡️ ${result.moveLabel}\n${hitLines}\n**Total: ${playerDmg} DMG**`;
          } else {
            playerDmg = totalDmg;
            moveLine  = `🛡️ ${result.moveLabel} — ${playerDmg} DMG`;
          }
          vibBar = Math.max(0, vibBar - Math.floor(playerDmg * 0.8 * totalVibMult));

          if (result.healResult.actions.length > 0) {
            ws.playerDebuffs = cleanseDebuffs(ws.playerDebuffs, 1);
          }
        }

        if (btn.customId === "dg_echoskill" && activeBonuses.echoSkill) {
          const def = activeBonuses.echoSkill;
          const crit = forcedCritActive || def.kind === "GUARANTEED_CRIT" || Math.random() < cRate;
          abilCrit = crit;
          const smolderMult = activeBonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(ws.namedState) : 1;
          const base = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * echoSkillBaseMult() * (1 - defReduction)));
          const extraElemBonusEcho = ws.glacioShieldTurnsLeft > 0 ? ws.glacioShieldElemBonus : 0;
          let dmg = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + activeBonuses.elemDmgBonus + extraElemBonusEcho) * radiantDmgMult);

          const result = applyEchoSkill(def, {
            atk: stats.atk, enemyHp, enemyHpMax: scaled.hp,
            playerHp: ws.playerHp, playerHpMax: ws.playerHpMax,
            playerEnergy: ws.playerEnergy, turn: 1, bossVibMax: 50, crit,
          });
          dmg = Math.floor(dmg * result.dmgMult);
          if (result.doubleHit) dmg *= 2;
          if (result.noDamage) dmg = 0;

          let namedTriggerTag = "";
          if (def.kind === "NAMED_SET_TRIGGER" && activeBonuses.activeNamedSetId === def.setId) {
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
          const ignite = result.noDamage ? { dmg: 0, tag: "" } : elemIgniteProc(activeBonuses.elementPassive, stats.atk);
          playerDmg = dmg + ignite.dmg;
          moveLine  = result.noDamage ? `🌀 ${def.name}` : `🌀 ${def.name}${crit ? " **(CRIT)**" : ""} — ${playerDmg} DMG`;
          if (namedTriggerTag) moveLine += `\n✦ ${namedTriggerTag}`;
          if (ar_e.tag)   moveLine += `  ✦${ar_e.tag}`;
          if (ignite.tag) moveLine += `  ✦${ignite.tag}`;

          if (!result.noDamage) {
            vibBar = Math.max(0, vibBar - Math.floor(playerDmg * 0.5 * totalVibMult) - result.extraVibDrain);
          }
          ws.echoSkillCooldown = (result.resetCdOnCrit && crit) ? 0 : ECHO_SKILL_COOLDOWN;

          const energyGain = Math.floor(stats.energyPerTurn) + elemDischargeEnergy(activeBonuses.elementPassive, crit) + result.bonusEnergy;
          ws.playerEnergy = result.setEnergyFull ? 100 : Math.min(100, ws.playerEnergy + energyGain);
          const scaledEchoHeal = Math.floor(result.healHp * (1 + activeBonuses.healingBonus));
          ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + ar_e.healHp + scaledEchoHeal);
          if (scaledEchoHeal > 0) {
            const benchPos = ([1, 2, 3] as PositionIndex[]).find(pos => pos !== ws.activeUnit && ws.allyBundles[pos] && ws.allyBundles[pos]!.hp > 0);
            if (benchPos) {
              const b = ws.allyBundles[benchPos]!;
              b.hp = Math.min(b.hpMax, b.hp + scaledEchoHeal);
              moveLine += `\n💚 +${scaledEchoHeal} HP (also healed ${b.kit.label})`;
            } else {
              moveLine += `\n💚 +${scaledEchoHeal} HP`;
            }
          }

          let echoLifesteal = activeBonuses.lifesteal + havocLifesteal + (ar_e.lifesteal ?? 0);
          if (def.kind === "FLAT_LIFESTEAL") echoLifesteal += def.pct;
          ws.playerHp = applyLifesteal(echoLifesteal, playerDmg, ws.playerHp, ws.playerHpMax);

          if (result.armsNextCrit) ws.nextAttackCritArmed = true;
          if (result.defShredTurns > 0) {
            ws.enemyDefShredTurnsLeft = result.defShredTurns + 1;
            ws.enemyDefShredPct = result.defShredPct;
          }
        }

        // Concerto Energy builds from combat actions, never from swapping —
        // scaled by move weight, ported from encounter.ts's Milestone 1/2b
        // CONCERTO_GAIN_BY_MOVE logic.
        const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
          dg_basic: 10, dg_skill: 20, dg_echoskill: 20, dg_ultimate: 35,
        };
        if (ws.isDevGuild && !convergenceUsedThisTurn) {
          let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
          if (concertoGain > 0 && !isPlayerActive() && allySolaceStats?.hasWellspring) concertoGain += getWellspringBaseEnergyBonus(allySolaceStats.wellspringRefinement);
          if (concertoGain > 0) ws.concertoEnergy = addConcertoEnergy(ws.concertoEnergy, concertoGain);
        }

        // V2 turn-start regen (applied each enemy counter phase = start of next player turn)
        const v2Regen = abilityV2TurnRegen(bonuses, ws.playerHpMax);
        if (v2Regen.healHp  > 0) ws.playerHp     = Math.min(ws.playerHpMax, ws.playerHp + v2Regen.healHp);
        if (v2Regen.energy  > 0) ws.playerEnergy = Math.min(100, ws.playerEnergy + v2Regen.energy);

        // Milestone 3a: a swap isn't a real attack, so it shouldn't burn the
        // 5pc "first hit" set bonus before the player's first actual hit.
        if (btn.customId !== "dg_swap") ws.firstActionDone = true;

        // SPD quick-strike — once per dungeon run, if invested SPD clears the wave enemy's derived SPD
        // (excludes dg_swap too — a swap deals no damage, so Quick Strike shouldn't fire on it.
        // Also excludes Solace's Convergence — a zero-damage support Ultimate that deliberately
        // deals no damage, unlike the player's own Ultimate which remains eligible.)
        const isSolaceConvergence = btn.customId === "dg_ultimate" && ws.isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace";
        if (!ws.quickStrikeUsed && btn.customId !== "dg_flee" && btn.customId !== "dg_swap" && !isSolaceConvergence && hasQuickStrike(stats.spd, dbUser.level)) {
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
          const voidHeal = elemVoidSurgeHeal(activeBonuses.elementPassive, ws.playerHpMax);
          if (voidHeal > 0) {
            ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + voidHeal);
            moveLine   += `\n✦ **Void Surge** — +${voidHeal} HP!`;
          }
          if (activeBonuses.activeNamedSetId === "VOIDBORN_REMNANT") {
            const remnant  = voidbornRemnantOnShatter();
            const bonusDmg = Math.floor(stats.atk * remnant.bonusMult);
            enemyHp = Math.max(0, enemyHp - bonusDmg);
            const healAmt  = Math.floor(ws.playerHpMax * remnant.healPct);
            ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + healAmt);
            moveLine += `\n🌑 **Voidborn Rupture** — +${bonusDmg} bonus DMG, +${healAmt} HP!`;
          }
        }

        if (radiantTurnHealAmount > 0) moveLine += `\n✨ Radiant Convergence — turn-heal +${radiantTurnHealAmount} HP!`;

        // Win
        if (enemyHp <= 0) {
          await battleMsg.edit({ embeds: [buildWaveEmbed(moveLine + " — **DEFEATED!**")], components: [] }).catch(() => {});
          resolve({ ...ws, survived: true });
          return;
        }

        // Debuffs tick down at the START of resolving the enemy's turn — this way
        // any WEAKENED applied by the attack below isn't touched until NEXT round's
        // tick, giving it the full 2 turns its own flavor text advertises, instead
        // of being decremented in the same cycle it's created.
        if (ws.isDevGuild) {
          const tickResult = tickDebuffs(ws.playerDebuffs);
          ws.playerDebuffs = tickResult.state;
        }

        // Enemy counter
        if (shatterLeft > 0) {
          shatterLeft--;
          if (shatterLeft === 0) { isShattered = false; vibBar = 50; moveLine += "\n◇ Enemy recovers."; }
          else moveLine += `\n◇ Enemy stunned (${shatterLeft} turn${shatterLeft > 1 ? "s" : ""} left).`;
        } else {
          const move    = ["strikes back", "retaliates", "lashes out"][Math.floor(Math.random() * 3)];
          const isSolaceAllyForDef = ws.isDevGuild && activeAllyCharacterId === "solace";
          const wellspringDefBonus = isSolaceAllyForDef && allySolaceStats?.hasWellspring ? getWellspringDefBonus(ws.attunement, allySolaceStats.wellspringRefinement!) : 0;
          const forteDefBonus = isSolaceAllyForDef ? getSolaceForteDefBonus(allyForteLevel, ws.forteEmpoweredTurnsLeft > 0) : 0;
          const attunementDefBonus = solaceAttunementDefBonus(allySkillLevel);
          const riloDefBuffMult = ws.riloDefBuffTurnsLeft > 0 ? (1 + ws.riloDefBuffPct) : 1;
          const attunementDefMult = (isSolaceAllyForDef ? getAttunementDefMult(ws.attunement, attunementDefBonus, ws.attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus) * riloDefBuffMult;
          let bossDmg   = Math.max(1, Math.floor(scaled.atk * 0.9 - activeDef * attunementDefMult * 0.4));
          bossDmg       = roll4pcBlock(bonuses, bossDmg);
          const shield  = elemFrostShield(activeBonuses.elementPassive, bossDmg);
          bossDmg       = shield.dmg;
          // Milestone 3a: route damage to whichever unit is actually active,
          // fixing the same bug class Milestone 1 fixed in encounter.ts (damage
          // must not always hit the player regardless of who's benched).
          const allyIsActive = ws.isDevGuild && !isPlayerActive();
          if (allyIsActive && activeAllyCharacterId === "rilo") {
            const rState = allyMechanicState as RiloMechanicState;
            const hitResult = riloOnHitTaken(rState, bossDmg, allyHp, allyHpMax, allyConstellation);
            allyMechanicState = hitResult.newMechanicState;
            bossDmg = hitResult.actualDamageTaken;
            if (hitResult.forteGain > 0) ws.solaceForte = addForteCharge(ws.solaceForte, RILO_FORTE_CONFIG, hitResult.forteGain);
            if (hitResult.blockedByC3) moveLine += `\n🛡️ **Guard Break Save!** Rilo's Shield fully absorbed a lethal blow!`;
            if (hitResult.zeroShieldSaveTriggered) moveLine += `\n❄️ **Unbreakable Guard** — Shield surges back from nothing!`;
          }
          if (allyIsActive) {
            allyHp = Math.max(0, allyHp - bossDmg);
          } else {
            ws.playerHp = Math.max(0, ws.playerHp - bossDmg);
          }
          if (activeBonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN") smolderingSovereignOnDamageTaken(ws.namedState);
          if (activeBonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") windstridersLegacyOnBigHitTaken(ws.namedState, bossDmg, ws.playerHpMax);
          if (activeBonuses.activeNamedSetId === "VOIDBORN_REMNANT") {
            const frenzy = voidbornRemnantCheckFrenzy(ws.namedState, ws.playerHp, ws.playerHpMax);
            if (frenzy.triggered) {
              ws.havocFrenzyAtkMult   = frenzy.atkMult;
              ws.havocFrenzyLifesteal = frenzy.lifesteal;
              ws.havocFrenzyDefIgnore = frenzy.defIgnorePct;
              moveLine += `\n🌑 **Void Frenzy** — ATK +${Math.floor((frenzy.atkMult - 1) * 100)}%, Lifesteal +${Math.floor(frenzy.lifesteal * 100)}%, ignoring ${Math.floor(frenzy.defIgnorePct * 100)}% enemy DEF!`;
            }
          }
          if (activeBonuses.activeNamedSetId === "RADIANT_CONVERGENCE") {
            radiantConvergenceOnHitTaken(ws.namedState, bossDmg, ws.playerHpMax);
            const burst = radiantConvergenceCheckBurstHeal(ws.namedState, ws.playerHp, ws.playerHpMax, activeBonuses.healingBonus);
            if (burst > 0) {
              ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + burst);
              moveLine += `\n✨ **Radiant Convergence** — burst-heal +${burst} HP!`;
            }
          }
          if (activeBonuses.activeNamedSetId === "FROSTVEIL_BASTION") {
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
          if (hpRegen > 0 && typeof activeBonuses.set5pc?.value === "number" && activeBonuses.set5pc.value < 1) {
            ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + hpRegen);
          }
          const radRegen = elemRadianceRegen(activeBonuses.elementPassive, ws.playerHpMax);
          if (radRegen > 0) ws.playerHp = Math.min(ws.playerHpMax, ws.playerHp + radRegen);
          ws.playerEnergy = Math.min(100, ws.playerEnergy + 15);
          moveLine      += `\n◇ ${enemy.name} ${move} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;

          // Milestone 3a: exercises the debuff system inside a real fight. 25% chance
          // per enemy attack, only when dev-guild team mechanics are active.
          if (ws.hasSolace && Math.random() < 0.25) {
            ws.playerDebuffs = applyDebuff(ws.playerDebuffs, "WEAKENED", 0.2, 2);
            moveLine += `\n◇ *${enemy.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
          }
        }

        if (ws.skillCooldown > 0) ws.skillCooldown--;
        if (ws.glacioShieldTurnsLeft > 0) ws.glacioShieldTurnsLeft--;
        if (ws.riloDefBuffTurnsLeft > 0) ws.riloDefBuffTurnsLeft--;
        if (ws.stormBuffTurnsLeft > 0) ws.stormBuffTurnsLeft--;
        if (ws.namedState.spectroFractureTurnsLeft > 0) ws.namedState.spectroFractureTurnsLeft--;
        if (ws.echoSkillCooldown > 0) ws.echoSkillCooldown--;
        if (ws.enemyDefShredTurnsLeft > 0) ws.enemyDefShredTurnsLeft--;
        if (ws.isDevGuild && ws.attunementDoubleTurnsLeft > 0) ws.attunementDoubleTurnsLeft--;
        if (ws.isDevGuild && ws.forteEmpoweredTurnsLeft > 0) ws.forteEmpoweredTurnsLeft--;
        // Milestone 3a: don't consume an armed crit on a swap turn — swap
        // deals no damage, so the armed crit should survive to whenever the
        // player actually attacks next (encounter.ts achieves this structurally
        // via its swap branch being a separate if/else from the damage branch;
        // here we get the same outcome with an explicit customId exclusion).
        if (forcedCritActive && btn.customId !== "dg_swap") ws.nextAttackCritArmed = false;

        // Write mutated ally state back into the bundle before the KO check.
        commitActiveBundle();

        // Active position KO'd — fall back to the next living position in
        // order (wraps 1->2->3->1).
        if (ws.isDevGuild && currentPositionHp(ws.activeUnit) <= 0) {
          const fallback = nextAliveFallback(ws.roster, ws.activeUnit, currentPositionHp);
          if (fallback !== null) {
            const koLabel = positionLabel(ws.roster, ws.activeUnit, ws.displayName, kitLabelFor);
            ws.activeUnit = fallback;
            syncActiveBundle();
            const fbLabel = positionLabel(ws.roster, fallback, ws.displayName, kitLabelFor);
            moveLine += `\n◇ **${koLabel} was knocked out** — swapped to ${fbLabel}.`;
          }
        }

        // Lose — every filled position knocked out
        if (isTeamWiped(ws.roster, currentPositionHp)) {
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
