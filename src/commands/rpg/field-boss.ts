import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, TextChannel, ThreadChannel,
  StringSelectMenuBuilder, StringSelectMenuInteraction,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, awardUser, isDispatchBlocked } from "../../lib/economy";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { checkLevelUp } from "../../lib/progression";
import { ALL_FIELD_BOSSES, FieldBoss } from "../../lib/fieldBosses";
import {
  initFieldBossMechanicState,
  moltenBuildupOnBossTurn, frostBarrierOnBossTurn, energySurgeOnBossTurn,
  momentumGustOnBossTurn, lifestealFrenzyOnBossTurn, steadyRegenOnBossTurn,
} from "../../lib/fieldBossMechanics";
import { gearAwareScale, baselineAtk } from "../../lib/combat";
import { incrementWeaponBond } from "../../lib/weaponAwakening";
import { voteNudge, supportNudge } from "../../lib/voteNudge";
import { mailNudge } from "../../lib/mailNudge";
import { generateBattleCard, BattleCardState } from "../../lib/battleCard";
import {
  resolvePlayerBonuses, applyBonuses,
  apply4pcSkillBonus, apply4pcUltBonus, roll4pcDoubleHit, roll4pcBlock,
  apply5pcLowHpCrit, apply5pcFirstHit, apply5pcFullHpDmg,
  get5pcVibDrainMult, get5pcHpRegen, applyLifesteal,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit,
  applyAbilityAttack, abilityV2TurnRegen, effectiveSkillCooldown, hasQuickStrike,
} from "../../lib/setBonus";
import { compositeVibMult, compositeHasSecondWind } from "../../lib/abilityEffects";
import {
  initNamedSetState,
  smolderingSovereignOnAction, smolderingSovereignOnDamageTaken, smolderingSovereignOnSkill,
  frostveilBastionOnHitTaken, frostveilBastionCheckPanicShield,
  stormcallersOathOnUltimate, stormcallersOathCheckThunderbolt, stormcallersOathOnBasic,
  windstridersLegacyOnHit, windstridersLegacyOnBigHitTaken, windstridersLegacyCheckExplosion,
  voidbornRemnantOnShatter, voidbornRemnantCheckFrenzy, voidbornRemnantFrenzyActive,
  radiantConvergenceOnTurnHeal, radiantConvergenceOnHitTaken, radiantConvergenceOnCrit, radiantConvergenceCheckBurstHeal,
} from "../../lib/namedSets";
import { echoSkillBaseMult, applyEchoSkill } from "../../lib/echoSkills";
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
import {
  rollRarity, rollMainStat, rollSubstats, rollSubstatValue,
  calcMainStatValue, substatCount, RARITY_STARS,
  ELEMENT_EMOJI, ELEMENT_COLORS, scaledFieldBossRarityWeights,
} from "../../lib/echoes";
import { Boss } from "../../lib/bosses";
import { computeAura, consumeAura, auraBar, fmtAuraRegen, getMaxAura } from "../../lib/aura";
import { CE } from "../../lib/emojiManager";
import prisma from "../../lib/prisma";
import * as path from "path";
import * as fs   from "fs";

const SKILL_COOLDOWN = 3;

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

// activeSessions replaced by shared combatLock

// Convert a FieldBoss to the Boss shape the battle card expects
function fieldToBoss(fb: FieldBoss): Boss {
  // Resolve art: try Bosses/ folder first, then echoes/ subfolders
  const artCandidates = [
    path.join(process.cwd(), "Bosses", fb.artFile),
    path.join(process.cwd(), "assets", "echoes", "3-cost", fb.artFile),
    path.join(process.cwd(), "assets", "echoes", "1-cost", fb.artFile),
  ];
  const artFile = artCandidates.find(p => fs.existsSync(p)) ?? "";

  return {
    id: fb.id, name: fb.name, title: fb.title,
    worldLevel: 0, element: fb.element, weakness: fb.weakness,
    artFile,
    baseHp: fb.baseHp, baseAtk: fb.baseAtk, baseDef: fb.baseDef,
    vibBar: fb.vibBar,
    moves: fb.moves,
    defeatLoot: { credits: 0, tuningModules: 0, sealingTubes: 0, forgingOres: 0, paradoxCores: 0, fractonite: 0, stasisLocks: 0, resonanceExp: 0 },
  };
}

async function sendBattleCard(
  thread: TextChannel | ThreadChannel,
  state: BattleCardState,
  buttons: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[],
  teamStatus?: string,
) {
  const buffer = await generateBattleCard(state);
  const attach = new AttachmentBuilder(buffer, { name: "battle.webp" });
  const embed  = new EmbedBuilder()
    .setColor(ELEMENT_HEX[state.playerElement] ?? 0x6366F1)
    .setImage("attachment://battle.webp")
    .setDescription(teamStatus || null);
  return thread.send({ embeds: [embed], files: [attach], components: buttons });
}

interface TeamButtonContext {
  isDevGuild: boolean;
  isPlayerActiveNow: boolean; // whether the CURRENTLY active position is "self"
  displayName: string;
  attunement: AttunementState;
  concertoEnergy: number;
  activeAllyCharacterId: string | null;
  // Positions the player could swap TO from the current one, each already
  // filtered to filled + label-resolved. Empty = no swap row at all;
  // length 1 = single button; length 2 = dropdown.
  swapTargets: { pos: PositionIndex; label: string; hp: number }[];
}

type BattleActionRow = ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>;

function buildButtons(
  state: BattleCardState,
  echoSkill?: { name: string; cooldown: number } | null,
  team?: TeamButtonContext | null,
): BattleActionRow[] {
  const rows: BattleActionRow[] = [];

  if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "kaelith") {
    const skillReady = state.skillCooldown === 0;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("fb_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("fb_skill")
        .setLabel(skillReady ? "🌑  Umbral Detonation" : `🌑  Detonation (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder().setCustomId("fb_ultimate").setLabel("🌑  Umbral Cataclysm")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("fb_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "vesper") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("fb_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("fb_skill").setLabel("⚡  Discharge").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("fb_ultimate").setLabel("⚡  Overload")
        .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
      new ButtonBuilder().setCustomId("fb_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "rilo") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("fb_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("fb_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("fb_ultimate").setLabel("🛡️  Avalanche Slam")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("fb_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow) {
    const modeLabel = team.attunement.mode ? `(${team.attunement.mode})` : "(inactive)";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("fb_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("fb_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("fb_ultimate").setLabel("⚡  Convergence")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("fb_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const skillReady = state.skillCooldown === 0;
    const ultReady   = state.playerEnergy >= 100;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("fb_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("fb_skill")
        .setLabel(skillReady ? "✦  Resonance Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder().setCustomId("fb_ultimate").setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(!ultReady),
    );
    if (echoSkill) {
      const echoReady = echoSkill.cooldown === 0;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("fb_echoskill")
          .setLabel(echoReady ? `🌀  ${echoSkill.name}` : `🌀  ${echoSkill.name} (${echoSkill.cooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId("fb_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    );
    rows.push(row);
  }

  // Only alive positions are offered — a KO'd position simply isn't a valid
  // swap target (matches the old single-ally behavior of disabling the swap
  // button rather than letting the player swap into a dead unit).
  const aliveSwapTargets = (team?.swapTargets ?? []).filter(t => t.hp > 0);
  if (team?.isDevGuild && aliveSwapTargets.length === 1) {
    const target = aliveSwapTargets[0];
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("fb_swap")
        .setLabel(`🔄  Swap to ${target.label}`)
        .setStyle(ButtonStyle.Secondary),
    ));
  } else if (team?.isDevGuild && aliveSwapTargets.length >= 2) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("fb_swap_select")
        .setPlaceholder("🔄  Swap to…")
        .addOptions(aliveSwapTargets.map(t => ({
          label: `Swap to ${t.label}`,
          value: String(t.pos),
        }))),
    ));
  }

  return rows;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("field-boss")
    .setDescription("Challenge a field boss — no WL requirement, scales with your strength. Costs 1 ◈ Aura."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const bonuses = await resolvePlayerBonuses(interaction.user.id);
    const stats   = applyBonuses(user, bonuses);
    const auraState = computeAura(user.resonanceAura ?? 5, user.auraUpdatedAt ?? new Date(), getMaxAura(user.patronTier ?? 0));

    if (user.level < 5) {
      await interaction.editReply({ content: "◈ Reach **Level 5** to challenge field bosses." });
      return;
    }

    if (isDispatchBlocked(user)) {
      await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before entering combat." });
      return;
    }

    if (!acquireLock(interaction.user.id, "Field Boss")) {
      await interaction.editReply({ content: alreadyInCombatMsg(interaction.user.id) });
      return;
    }

    const options = ALL_FIELD_BOSSES.map(fb => {
      const elemEmoji = (ELEMENT_EMOJI as any)[fb.element] ?? "◇";
      const locked = (fb.unlockWorldLevel ?? 0) > user.worldLevel;
      const dropNote = fb.id === "luminal_specter"      ? "  ✦ drops Starfall Shards"
                      : fb.id === "null_ravager"         ? "  ✦ drops Umbral Shards"
                      : fb.id === "voltaic_aberrant"     ? "  ✦ drops Voltaic Shards"
                      : fb.id === "permafrost_sovereign" ? "  ✦ drops Glacial Shards"
                      : "";
      return {
        label:       locked ? `🔒 ${fb.name}  (WL${fb.unlockWorldLevel} required)` : `${elemEmoji}  ${fb.name}`,
        description: locked ? `Reach World Level ${fb.unlockWorldLevel} to unlock` : `${fb.element}  ·  Weakness: ${fb.weakness}${dropNote}`,
        value:       fb.id,
      };
    });

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("fb_select")
        .setPlaceholder("Choose a field boss…")
        .addOptions(options)
    );

    const nextRegen = auraState.current < auraState.max
      ? `  ·  next in **${fmtAuraRegen(auraState.nextRegenMs)}**` : "";

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(ELEMENT_HEX[user.element] ?? 0x6366F1)
        .setTitle("🌿  Field Bosses")
        .setDescription(
          `Field bosses appear across the world and scale to your strength — no World Level required.\n\n` +
          `**Resonance Aura:** ${auraBar(auraState.current, auraState.max)}  ${auraState.current}/${auraState.max}${nextRegen}\n\n` +
          `› Costs **1 ◈ Aura** per fight — no cooldown\n` +
          `› Drops **1 guaranteed 4-cost echo** of that element\n` +
          `› No enrage — field bosses are fair fights`
        )
        .setFooter({ text: "CARTETHYIA  ·  Field Boss  ·  Expires in 60s" })],
      components: [selectRow],
    });

    const selCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId === "fb_select",
      time:   60_000, max: 1,
    });

    selCollector?.on("collect", async (sel: StringSelectMenuInteraction) => {
      await sel.deferUpdate();
      const fb = ALL_FIELD_BOSSES.find(b => b.id === sel.values[0]);
      if (!fb) { await sel.editReply({ content: "Boss not found.", components: [], embeds: [] }); return; }

      if ((fb.unlockWorldLevel ?? 0) > user.worldLevel) {
        releaseLock(interaction.user.id);
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setDescription(`◈ **${fb.name}** requires **World Level ${fb.unlockWorldLevel}**. You are WL${user.worldLevel}.`)
            .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
          components: [],
        });
        return;
      }

      // Aura check
      const freshAura = computeAura(user.resonanceAura ?? 5, user.auraUpdatedAt ?? new Date(), getMaxAura(user.patronTier ?? 0));
      if (freshAura.current < 1) {
        releaseLock(interaction.user.id);
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setDescription(`◈ Not enough **Resonance Aura**. Field bosses cost **1 ◈**.\nNext in **${fmtAuraRegen(freshAura.nextRegenMs)}**.`)
            .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
          components: [],
        });
        return;
      }

      // lock already held from command entry

      // Create thread
      const channel = interaction.channel as TextChannel;
      let thread;
      try {
        thread = await channel.threads.create({
          name:                `🌿 ${displayName} vs ${fb.name}`,
          autoArchiveDuration: 60,
          type:                ChannelType.PrivateThread,
          reason:              "Field Boss",
        });
        await thread.members.add(interaction.user.id);
      } catch {
        releaseLock(interaction.user.id);
        await sel.editReply({ content: "◈ I need **Create Private Threads** permissions here.", components: [], embeds: [] });
        return;
      }

      await sel.editReply({ content: `◈ A field boss emerges. <#${thread.id}>`, components: [], embeds: [] });
      await consumeAura(interaction.user.id, 1);
      await registerFight(interaction.user.id, thread.id, interaction.guildId!, "Field Boss");
      // lock already held

      // Scale to player
      const fightLevel = user.level;
      const gearRatio  = stats.atk / baselineAtk(fightLevel);
      const boss       = fieldToBoss(fb);
      const scaled     = gearAwareScale(
        { hp: fb.baseHp, atk: fb.baseAtk, def: fb.baseDef },
        fightLevel, user.worldLevel, gearRatio,
      );

      let shatterTurnsLeft = 0;
      let secondWindUsed   = false;
      let battleMsg: any   = null;
      let v2Stacks = 0;
      let quickStrikeUsed = false; // SPD-driven bonus action — once per fight
      const ECHO_SKILL_COOLDOWN = 4;
      let echoSkillCooldown      = 0;
      let enemyDefShredTurnsLeft = 0;
      let enemyDefShredPct       = 0;
      let nextAttackCritArmed    = false;
      const ENERGY_PER_TURN = Math.floor(stats.energyPerTurn);

      // Named Echo Set per-fight state (all sets — no-op unless bonuses.activeNamedSetId matches)
      const namedState = initNamedSetState();
      const bossMechState = initFieldBossMechanicState();
      let glacioShieldTurnsLeft  = 0;   // Frostveil Bastion 5pc — elem DMG buff duration
      let glacioShieldElemBonus  = 0;   // active elem DMG bonus while shield buff is up
      let riloDefBuffTurnsLeft   = 0;   // Rilo C1's Outro DEF buff on whoever swaps in
      let riloDefBuffPct         = 0;
      let stormBuffTurnsLeft     = 0;   // Stormcaller's Oath 4pc — crit rate buff duration
      let stormBuffCritBonus     = 0;   // active crit rate bonus while post-ult buff is up
      let havocFrenzyAtkMult     = 1.0; // Voidborn Remnant 5pc — active buff values while frenzyActive
      let havocFrenzyLifesteal   = 0;
      let havocFrenzyDefIgnore   = 0;

      // ── Milestone 3.5c: 3-position team state ─────────────────────────────────
      // Replaces the old single fixed "ally" bundle with a resolved 3-position
      // roster (teamPosition1/2/3). See docs/superpowers/specs/2026-07-31-
      // three-slot-team-design.md and teamPositions.ts.
      // NOTE: `isDevGuild` is a legacy name kept to avoid touching the many
      // downstream usages below and in shared helpers (TeamButtonContext) —
      // it no longer means "in the dev guild", it means "has AT LEAST ONE
      // active non-self ally position". Was hard-gated to the dev guild only
      // during development; that gate is exactly the bug that blocked Solace
      // everywhere after launch.
      const roster: ResolvedRoster = resolveRoster(user);

      interface AllyBundle {
        characterId: string;
        kit: PlayableCharacterKit;
        hp: number;
        hpMax: number;
        mechanicState: unknown;
        basicLevel: number;
        skillLevel: number;
        ultimateLevel: number;
        introLevel: number;
        forteLevel: number;
        constellation: number;
        solaceStats: any;
      }

      // CRITICAL: this does a real read-only ownership lookup, NOT
      // getOrCreateCharacterProgress — that helper CREATES a row if missing,
      // which would silently re-grant ownership to anyone whose teamPositionN
      // points at a character they don't actually own (e.g. after an admin
      // correction), bypassing the gacha entirely.
      const allyBundles: Partial<Record<PositionIndex, AllyBundle>> = {};
      for (const pos of ([1, 2, 3] as PositionIndex[])) {
        const value = pos === 1 ? roster.position1 : pos === 2 ? roster.position2 : roster.position3;
        if (value === null || value === "self") continue;
        const kit = CHARACTER_KITS[value];
        if (!kit) continue;
        const progress = await prisma.characterProgress.findUnique({
          where: { userId_characterId: { userId: interaction.user.id, characterId: value } },
        });
        if (!progress) continue; // not actually owned — treat this position as unfilled
        const resolvedStats = await kit.resolveStats(interaction.user.id);
        const hpMax = kit.statsAtLevel(90).hpMax;
        allyBundles[pos] = {
          characterId:   value,
          kit,
          hp:            hpMax,
          hpMax,
          mechanicState: kit.createInitialMechanicState(),
          basicLevel:    progress.basicLevel    ?? 1,
          skillLevel:    progress.skillLevel    ?? 1,
          ultimateLevel: progress.ultimateLevel ?? 1,
          introLevel:    progress.introLevel    ?? 1,
          forteLevel:    progress.forteLevel    ?? 1,
          constellation: progress.constellation ?? 0,
          solaceStats:   resolvedStats,
        };
      }

      // `hasSolace`/`isDevGuild` are legacy names kept to avoid a blanket rename
      // across the many call sites below — they now mean "the roster has ANY
      // active non-self position", not specifically Solace or the dev guild.
      const hasSolace = Object.keys(allyBundles).length > 0;
      const isDevGuild = hasSolace;

      let activeUnit: PositionIndex = 1;
      let concertoEnergy: number = 0;
      let playerDebuffs: DebuffState = [];
      let attunement: AttunementState = { mode: null };
      let attunementDoubleTurnsLeft = 0;
      let solaceForte: ForteState = { phase: 0, charge: 0 };
      let forteEmpoweredTurnsLeft = 0;

      // Legacy single-ally variables — every existing per-character Basic/
      // Skill/Ultimate branch below reads these exactly as before. They're
      // reassigned every turn (via syncActiveBundle()) to reflect whichever
      // position is CURRENTLY active, instead of representing one fixed ally.
      let activeAllyCharacterId: string | null = null;
      let allyKit: PlayableCharacterKit | null = null;
      let allyHp = 0;
      let allyHpMax = 0;
      let allyMechanicState: unknown = null;
      let allyBasicLevel = 1;
      let allySkillLevel = 1;
      let allyUltimateLevel = 1;
      let allyIntroLevel = 1;
      let allyForteLevel = 1;
      let allyConstellation = 0;
      let allySolaceStats: any = null;

      function positionValueOf(pos: PositionIndex): string | null {
        return pos === 1 ? roster.position1 : pos === 2 ? roster.position2 : roster.position3;
      }
      function isPlayerActive(): boolean {
        return positionValueOf(activeUnit) === "self";
      }
      // Copies whichever position's bundle is now active into the legacy
      // `ally*` variables (or clears them to "no ally" if the active position
      // is "self"). Returns the bundle reference so callers can write mutated
      // hp/mechanicState back into it before the turn ends.
      function syncActiveBundle(): AllyBundle | null {
        const bundle = isPlayerActive() ? null : (allyBundles[activeUnit] ?? null);
        activeAllyCharacterId = bundle?.characterId ?? null;
        allyKit               = bundle?.kit ?? null;
        allyHp                = bundle?.hp ?? 0;
        allyHpMax             = bundle?.hpMax ?? 0;
        allyMechanicState     = bundle?.mechanicState ?? null;
        allyBasicLevel        = bundle?.basicLevel ?? 1;
        allySkillLevel        = bundle?.skillLevel ?? 1;
        allyUltimateLevel     = bundle?.ultimateLevel ?? 1;
        allyIntroLevel        = bundle?.introLevel ?? 1;
        allyForteLevel        = bundle?.forteLevel ?? 1;
        allyConstellation     = bundle?.constellation ?? 0;
        allySolaceStats       = bundle?.solaceStats ?? null;
        return bundle;
      }
      function currentPositionHp(pos: PositionIndex): number {
        if (positionValueOf(pos) === "self") return state.playerHp;
        return allyBundles[pos]?.hp ?? 0;
      }
      function kitLabelFor(characterId: string): string | null {
        const kit = CHARACTER_KITS[characterId];
        return kit ? kit.label : null;
      }
      // Battle card's main panel must show whichever unit is CURRENTLY
      // active, not always the human player — previously the card looked
      // frozen after a swap since only the small "Benched:" line updated.
      function activeCardIdentity(): { playerName: string; playerHp: number; playerHpMax: number; playerElement: string } {
        if (isPlayerActive()) {
          return { playerName: displayName, playerHp: state.playerHp, playerHpMax: state.playerHpMax, playerElement: user.element };
        }
        const b = allyBundles[activeUnit];
        return {
          playerName:    b?.kit.label ?? "Ally",
          playerHp:      b?.hp ?? 0,
          playerHpMax:   b?.hpMax ?? 0,
          playerElement: b?.kit.element ?? user.element,
        };
      }

      // Render-time sync so buttons/status line at the TOP of a turn (before
      // the player has acted) reflect whichever position became active at the
      // end of the previous turn (swap or KO-fallback).
      syncActiveBundle();

      function teamStatusLine(): string {
        if (!hasSolace) return "";
        const isPlayerNow = isPlayerActive();
        // Pick ONE benched (non-active) ally position to summarize — with 3
        // positions there can be up to 2 benched allies at once; this line
        // only has room for one, so we show whichever benched ally bundle
        // exists first (position order). Not exhaustive, but preserves the
        // original single-ally display for the common 2-position case.
        const benchPositions = ([1, 2, 3] as PositionIndex[]).filter(p => p !== activeUnit && allyBundles[p]);
        const benchBundle = benchPositions.length > 0 ? allyBundles[benchPositions[0]]! : null;
        const benchedName = isPlayerNow ? (benchBundle?.kit.label ?? "Ally") : displayName;
        const benchedHp   = isPlayerNow ? (benchBundle?.hp ?? 0) : state.playerHp;
        const benchedMax  = isPlayerNow ? (benchBundle?.hpMax ?? 0) : state.playerHpMax;
        const debuffLine  = playerDebuffs.length > 0
          ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
          : "";
        const mechanicLine = benchBundle ? `  ·  ${benchBundle.kit.statusLineText(benchBundle.mechanicState)}` : "";
        return `\n\n🔄 Benched: **${benchedName}** — ${benchedHp}/${benchedMax} HP  ·  ` +
               `Concerto Energy: **${concertoEnergy}/100**${mechanicLine}${debuffLine}`;
      }

      function teamButtonContext(): TeamButtonContext {
        const swapTargets = swappableTargets(roster, activeUnit).map(pos => ({
          pos,
          label: positionLabel(roster, pos, displayName, kitLabelFor),
          hp: currentPositionHp(pos),
        }));
        return {
          isDevGuild: hasSolace,
          isPlayerActiveNow: isPlayerActive(),
          displayName, attunement, concertoEnergy,
          activeAllyCharacterId,
          swapTargets,
        };
      }

      const state: BattleCardState = {
        boss,
        bossHpNow:     scaled.hp,
        bossHpMax:     scaled.hp,
        bossVibNow:    fb.vibBar,
        playerHp:      stats.hp,
        playerHpMax:   stats.hp,
        playerEnergy:  0,
        playerName:    displayName,
        playerElement: user.element,
        turn:          1,
        lastMove:      `${fb.name} emerges from the field. Engage!`,
        isShattered:   false,
        skillCooldown: 0,
      };

      await thread.send({
        embeds: [new EmbedBuilder()
          .setColor(ELEMENT_HEX[fb.element] ?? 0x6366F1)
          .setTitle(`🌿  Field Boss — ${fb.name}`)
          .setDescription([
            `**${fb.name}** — *${fb.title}*`,
            ``,
            `◈  Element: **${fb.element}**  ·  Weakness: **${fb.weakness}** deals **1.5×** damage`,
            `◈  Shatter the Vibration Bar to stun for 1 turn`,
            `◈  Win to collect **2–4 echoes** of ${fb.element}`,
          ].join("\n"))
          .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
      });

      // Cleanup
      const cleanup = async (won: boolean) => {
        releaseLock(interaction.user.id);
        await clearFight(interaction.user.id);
        if (won) {
          // Drop 1 guaranteed 4-cost echo matching this field boss
          const { BOSS_ECHO_DEFINITIONS } = await import("../../lib/echoes");
          const echoDef = BOSS_ECHO_DEFINITIONS.find(e => e.name === fb.name);
          const echoLines: string[] = [];

          if (echoDef) {
            const rarity   = rollRarity(scaledFieldBossRarityWeights(echoDef.rarityWeights as [number, number, number], user.worldLevel));
            const mainSt   = rollMainStat(4, fb.element as any);
            const subCount = substatCount(rarity);
            const substats = rollSubstats(subCount, mainSt);

            const echoData: any = {
              userId: interaction.user.id, name: echoDef.name,
              rarity, element: fb.element, cost: 4,
              ...(echoDef.setId ? { setId: echoDef.setId } : {}),
              mainStatType: mainSt, mainStatValue: calcMainStatValue(mainSt, 0, rarity),
            };
            substats.forEach((s, idx) => {
              echoData[`substat${idx + 1}Type`]  = s;
              echoData[`substat${idx + 1}Value`] = rollSubstatValue(s);
            });
            await prisma.echo.create({ data: echoData });
            echoLines.push(`${(ELEMENT_EMOJI as any)[fb.element] ?? "◇"} **${echoDef.name}**  ${RARITY_STARS[rarity]}  (4-cost)`);
          }

          const credits = 300 + user.worldLevel * 120;
          await awardUser(interaction.user.id, { credits, resonanceExp: 100 + user.worldLevel * 40, fractonite: 60 }, "field-boss");

          // Always drops, not a roll — Starfall Shards are the only source of
          // this material and Solace's ascension already gates behind a
          // Spectro field-boss kill count, so the kill itself is the gate,
          // not an additional RNG layer on top of it.
          let starfallShardsDropped = 0;
          if (fb.id === "luminal_specter") {
            starfallShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { starfallShards: { increment: 1 } },
            });
          }
          let umbralShardsDropped = 0;
          if (fb.id === "null_ravager") {
            umbralShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { umbralShards: { increment: 1 } },
            });
          }
          let voltaicShardsDropped = 0;
          if (fb.id === "voltaic_aberrant") {
            voltaicShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { voltaicShards: { increment: 1 } },
            });
          }
          let glacialShardsDropped = 0;
          if (fb.id === "permafrost_sovereign") {
            glacialShardsDropped = 1;
            await prisma.user.update({
              where: { id: interaction.user.id },
              data: { glacialShards: { increment: 1 } },
            });
          }

          const lvl        = await checkLevelUp(interaction.user.id);
          const bondResult = await incrementWeaponBond(interaction.user.id).catch(() => null);

          await thread.send({
            embeds: [new EmbedBuilder()
              .setColor(ELEMENT_COLORS[fb.element as keyof typeof ELEMENT_COLORS] ?? 0x6366F1)
              .setTitle("🌿  Field Boss Defeated")
              .setDescription(
                `**${fb.name}** has been driven off.\n\n` +
                (echoLines.length ? `**Echo Dropped:**\n${echoLines.join("\n")}\n\n` : "") +
                `${CE.cr} ${credits} Credits  ·  ${CE.ft ?? "🔷"} 60 Fractonite` +
                (starfallShardsDropped ? `\n${CE.sf} **1 Starfall Shard**` : "") +
                (umbralShardsDropped ? `\n${CE.us} **1 Umbral Shard**` : "") +
                (voltaicShardsDropped ? `\n${CE.vs} **1 Voltaic Shard**` : "") +
                (glacialShardsDropped ? `\n${CE.gs} **1 Glacial Shard**` : "") +
                (lvl.didLevelUp ? `\n◈ Level **${lvl.oldLevel}** → **${lvl.newLevel}**` : "") +
                (bondResult ? `\n✦ Weapon Bond **${bondResult.bond}/10**${bondResult.milestone ? ` — *${bondResult.milestone}*` : ""}` : "") +
                voteNudge() + supportNudge() + await mailNudge(interaction.user.id)
              )
              .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
          });
        }
        await thread.setArchived(true).catch(() => {});
      };

      // Battle loop
      const runTurn = async () => {
        // Re-sync the legacy ally* vars for whichever position is active NOW
        // (may have changed via swap/KO-fallback at the end of the previous
        // turn) before rendering this turn's buttons/status line.
        syncActiveBundle();
        const buttons = buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext());
        if (battleMsg) await battleMsg.edit({ components: [] }).catch(() => {});
        battleMsg = await sendBattleCard(thread as any, { ...state, ...activeCardIdentity() }, buttons, teamStatusLine());

        // NOTE: deliberately no `componentType` restriction here (unlike
        // ascend.ts's reference collector, which sets `componentType:
        // ComponentType.Button` — that silently excludes the fb_swap_select
        // StringSelectMenu from ever being collected, since discord.js
        // filters collected interactions to the given componentType. With 3
        // roster positions the 2-swap-target case needs the select menu to
        // actually fire, so this collector accepts any component type and
        // relies on the customId/user filter below instead.
        const collector = battleMsg.createMessageComponentCollector({
          filter: (b: ButtonInteraction | StringSelectMenuInteraction) => b.user.id === interaction.user.id,
          time: 15 * 60 * 1000, max: 1,
        });

        collector.on("collect", async (btn: any) => {
          await btn.deferUpdate();

          // Re-sync the legacy ally* vars for the position active at the
          // START of this turn (may be stale if buildButtons wasn't the last
          // thing to call syncActiveBundle — cheap enough to just redo it).
          let activeBundle = syncActiveBundle();
          let isPlayerActiveNow = isPlayerActive();
          // Both the single-button and dropdown swap variants consume the
          // turn as a non-attack action — anywhere the old code checked
          // `!== "fb_swap"` needs to exclude both customIds now.
          const isSwapAction = btn.customId === "fb_swap" || btn.customId === "fb_swap_select";

          let playerDmg = 0;
          let moveName  = "";
          state.hitBadge = undefined;
          let radiantDmgMult = 1.0;
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && btn.customId !== "fb_flee") {
            const heal = radiantConvergenceOnTurnHeal(namedState, state.playerHpMax, bonuses.healingBonus);
            state.playerHp  = Math.min(state.playerHpMax, state.playerHp + heal.healAmount);
            radiantDmgMult  = heal.dmgMult;
          }

          const isWeak        = user.element === fb.weakness;
          const havocFrenzyActive = bonuses.activeNamedSetId === "VOIDBORN_REMNANT" && voidbornRemnantFrenzyActive(namedState);
          const defShredActive = enemyDefShredTurnsLeft > 0;
          const effectiveDef  = (havocFrenzyActive ? scaled.def * (1 - havocFrenzyDefIgnore) : scaled.def) * (defShredActive ? (1 - enemyDefShredPct) : 1);
          const defVal        = state.isShattered ? 0 : effectiveDef;
          const defReduction  = Math.min(0.75, defVal / (defVal + 1500));
          const havocAtkMult  = havocFrenzyActive ? havocFrenzyAtkMult : 1.0;
          const havocLifesteal = havocFrenzyActive ? havocFrenzyLifesteal : 0;
          const vibMult       = get5pcVibDrainMult(bonuses);
          const radCrit       = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
          const stormCritBuff  = stormBuffTurnsLeft > 0 ? stormBuffCritBonus : 0;
          // Milestone 3.5b: whichever unit is currently acting/defending uses
          // ITS OWN resolved stats.
          const isAllyActingOrDefending = !isPlayerActiveNow && allySolaceStats !== null;
          const activeAtk     = isAllyActingOrDefending ? allySolaceStats!.atk     : stats.atk;
          const activeDef     = isAllyActingOrDefending ? allySolaceStats!.def     : stats.def;
          const activeCritDmg = isAllyActingOrDefending ? allySolaceStats!.critDmg : stats.critDmg;
          const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, (isAllyActingOrDefending ? allySolaceStats!.critRate : stats.critRate) + radCrit + stormCritBuff), state.playerHp, state.playerHpMax);
          const forcedCritActive = nextAttackCritArmed && btn.customId !== "fb_flee";
          const totalVibMult  = vibMult * compositeVibMult(bonuses.abilityEffects);
          const abilCtxBase   = {
            currentHp: state.playerHp, maxHp: state.playerHpMax,
            enemyHpPct: state.bossHpNow / state.bossHpMax,
            turn: state.turn, isFirstAction: state.turn === 1,
            isWeak, isShattered: state.isShattered, v2Stacks,
          };
          let abilCrit = false;

          // Milestone 3.5c: swap — always consumes the turn, falls through to
          // the shared tail below (Win-check/Boss-turn/decrements/Lose-check/
          // next turn), same as every other action. Generalized from the old
          // binary player<->ally swap to any-to-any across the 3 positions —
          // this needs BOTH the outgoing and incoming positions' bundles at
          // once (an ally-to-ally swap involves neither position being
          // "self"), so it reads/writes allyBundles directly by position
          // rather than the copy-in/copy-out convention used everywhere else
          // in this file.
          const swapTargetPos: PositionIndex | null = (() => {
            if (btn.customId === "fb_swap_select" && btn.isStringSelectMenu?.()) {
              const parsed = Number(btn.values[0]);
              return (parsed === 1 || parsed === 2 || parsed === 3) ? (parsed as PositionIndex) : null;
            }
            if (btn.customId === "fb_swap") {
              const aliveTargets = swappableTargets(roster, activeUnit).filter(p => currentPositionHp(p) > 0);
              return aliveTargets.length === 1 ? aliveTargets[0] : null;
            }
            return null;
          })();

          if (swapTargetPos !== null && hasSolace && currentPositionHp(activeUnit) > 0) {
            const outgoingPos = activeUnit;
            const incomingPos = swapTargetPos;
            const outgoingIsPlayer = positionValueOf(outgoingPos) === "self";
            const incomingIsPlayer = positionValueOf(incomingPos) === "self";
            const outgoingBundle = outgoingIsPlayer ? null : (allyBundles[outgoingPos] ?? null);
            const incomingBundle = incomingIsPlayer ? null : (allyBundles[incomingPos] ?? null);
            const outgoingCharacterId = outgoingBundle?.characterId ?? null;
            const incomingCharacterId = incomingBundle?.characterId ?? null;
            const outgoingKit = outgoingBundle?.kit ?? null;
            const incomingKit = incomingBundle?.kit ?? null;
            const outgoingConstellation = outgoingBundle?.constellation ?? 0;
            const incomingConstellation = incomingBundle?.constellation ?? 0;
            const incomingIntroLevel = incomingBundle?.introLevel ?? 1;
            const incomingLabel = incomingIsPlayer ? displayName : (incomingKit?.label ?? "Ally");

            const comboReady = concertoEnergy >= 100;

            if (comboReady) {
              const incomingTarget: AllyActionTarget = incomingIsPlayer
                ? { hp: state.playerHp, hpMax: state.playerHpMax }
                : { hp: incomingBundle!.hp, hpMax: incomingBundle!.hpMax };

              const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : outgoingKit!.outroEffect(outgoingConstellation);
              const introEffect: IntroOutroEffect = incomingIsPlayer ? PLAYER_SELF_INTRO : incomingKit!.introEffect(incomingIntroLevel, incomingConstellation);
              const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
              const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

              if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "kaelith") {
                const grant = (introEffect.newMechanicState as any).grantStacksOnIntro as number | undefined;
                if (grant) {
                  const cur = (incomingBundle!.mechanicState as KaelithMechanicState).stacks;
                  const cap = kaelithStackCap(incomingConstellation);
                  incomingBundle!.mechanicState = { ...(incomingBundle!.mechanicState as KaelithMechanicState), stacks: Math.min(cap, cur + grant) };
                }
              }
              if (!outgoingIsPlayer && outroEffect.enemyDebuff) {
                enemyDefShredTurnsLeft = outroEffect.enemyDebuff.turns + 1;
                enemyDefShredPct = outroEffect.enemyDebuff.value;
              }
              if (!outgoingIsPlayer && outroEffect.newMechanicState && outgoingCharacterId === "vesper") {
                const grantMark = (outroEffect.newMechanicState as any).grantMarkOnOutro === true;
                const charged = (outroEffect.newMechanicState as any).chargedMark === true;
                if (grantMark) {
                  outgoingBundle!.mechanicState = { ...(outgoingBundle!.mechanicState as VesperMechanicState), markPresent: true, chargedMark: charged };
                }
              }
              if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "vesper") {
                const energyGrant = (introEffect.newMechanicState as any).grantEnergyOnIntro as number | undefined;
                if (energyGrant) {
                  state.playerEnergy = Math.min(100, state.playerEnergy + energyGrant);
                }
              }
              let riloShieldTransferBonus = 0;
              if (!outgoingIsPlayer && outroEffect.newMechanicState && outgoingCharacterId === "rilo") {
                const rOutgoing = outgoingBundle!.mechanicState as RiloMechanicState;
                const transferFrac = (outroEffect.newMechanicState as any).grantShieldTransferOnOutro as number;
                riloShieldTransferBonus = Math.floor(rOutgoing.shield * transferFrac);
                if ((outroEffect.newMechanicState as any).grantDefBuffOnOutro) {
                  riloDefBuffTurnsLeft = ((outroEffect.newMechanicState as any).defBuffTurns as number) + 1; // +1 compensates for the same-round decrement
                  riloDefBuffPct = 0.15;
                }
              }
              if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "rilo") {
                const grant = (introEffect.newMechanicState as any).grantShieldOnIntro as number | undefined;
                if (grant) {
                  const rIncoming = incomingBundle!.mechanicState as RiloMechanicState;
                  incomingBundle!.mechanicState = { ...rIncoming, shield: Math.min(riloMaxShield(incomingConstellation), rIncoming.shield + grant) };
                }
              }

              if (!outgoingIsPlayer) nextAttackCritArmed = true;

              const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta + riloShieldTransferBonus;

              let actualGain: number;
              if (incomingIsPlayer) {
                const before = state.playerHp;
                state.playerHp = Math.min(state.playerHpMax, state.playerHp + totalBonus);
                actualGain = state.playerHp - before;
              } else {
                const before = incomingBundle!.hp;
                incomingBundle!.hp = Math.min(incomingBundle!.hpMax, incomingBundle!.hp + totalBonus);
                actualGain = incomingBundle!.hp - before;
              }

              moveName = actualGain > 0
                ? `🔄 Swapped to **${incomingLabel}** — Outro+Intro combo! +${actualGain} HP.`
                : `🔄 Swapped to **${incomingLabel}** — Outro+Intro combo! (already at full HP, no heal needed)`;
              concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART in encounter.ts
            } else {
              moveName = `🔄 Swapped to **${incomingLabel}** — Concerto Energy not full, no combo triggered.`;
            }

            activeUnit = incomingPos;
            isPlayerActiveNow = incomingIsPlayer;
            activeBundle = syncActiveBundle();
            playerDmg = 0;
          }

          if (btn.customId === "fb_flee") {
            await thread.send({
              embeds: [new EmbedBuilder().setColor(0x334155)
                .setDescription("◈ You retreated. No rewards. The boss returns in 2h.")
                .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
            });
            collector.stop();
            await cleanup(false);
            return;
          }

          if (btn.customId === "fb_basic") {
            const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
              ? windstridersLegacyCheckExplosion(namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
            const isSolaceAlly = isDevGuild && activeAllyCharacterId === "solace";
            const teamAtkMult  = isSolaceAlly ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
            const teamCritBonus = isSolaceAlly ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0;
            const wellspringAtkMult   = isSolaceAlly && !isPlayerActiveNow && allySolaceStats?.hasWellspring ? getWellspringBaseAtkMult(allySolaceStats.wellspringRefinement!) : 1;
            const wellspringAtkBonus  = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const wellspringCritBonus = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const forteAtkBonus  = isSolaceAlly ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const forteCritBonus = isSolaceAlly ? getSolaceForteCritRateBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const basicMoveMult = isDevGuild && !isPlayerActiveNow && allyKit ? allyKit.basicDamageMult(allyBasicLevel) : 1.0;
            const crit = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < Math.min(1, activeCritRate + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base = Math.max(1, Math.floor(activeAtk * teamMult * basicMoveMult * smolderMult * havocAtkMult * radiantDmgMult * (1 - defReduction)));
            const extraElemBonus = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
            let dmg    = Math.floor(base * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonus));
            if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") {
              dmg = windExplosion.proc
                ? Math.floor(dmg * (1 + windExplosion.bonusMult))
                : Math.floor(dmg * windstridersLegacyOnHit(namedState));
            }
            let thunderboltEnergy = 0;
            if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") {
              const tb = stormcallersOathOnBasic(namedState);
              if (tb.proc) {
                dmg += Math.floor(stats.atk * tb.bonusMult); // intentionally flat/unscaled, matching elemIgniteProc's pattern below (raw-ATK elemental proc, not crit/weakness-scaled)
                thunderboltEnergy = tb.bonusEnergy;
              }
            }
            dmg        = apply5pcFirstHit(bonuses, dmg, state.turn === 1);
            dmg        = apply5pcFullHpDmg(bonuses, dmg, state.playerHp, state.playerHpMax);
            if (roll4pcDoubleHit(bonuses)) dmg *= 2;
            dmg        = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "BASIC"));
            const ar_b = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "BASIC" });
            dmg        = ar_b.dmg;
            if (ar_b.newStacks !== undefined) v2Stacks = ar_b.newStacks;
            const ign  = elemIgniteProc(bonuses.elementPassive, stats.atk);
            if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
            if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(namedState, state.playerHp, state.playerHpMax);
            playerDmg  = dmg + ign.dmg;
            moveName   = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
            if (ign.tag) moveName += `  ✦${ign.tag}`;
            state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
            state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_b.bonusEnergy + thunderboltEnergy);
            state.playerHp     = Math.min(state.playerHpMax, applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_b.lifesteal ?? 0), playerDmg, state.playerHp, state.playerHpMax) + ar_b.healHp);
            if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(namedState, state.playerEnergy);

            if (isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "kaelith") {
              const kState = allyMechanicState as KaelithMechanicState;
              const gain = kaelithBasicStackGain(allyConstellation);
              const cap = kaelithStackCap(allyConstellation);
              allyMechanicState = { ...kState, stacks: Math.min(cap, kState.stacks + gain) };
              moveName += `\n🌑 +${gain} stack${gain === 1 ? "" : "s"} (${(allyMechanicState as KaelithMechanicState).stacks}/${cap})`;
            }
            if (isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "vesper") {
              const vState = allyMechanicState as VesperMechanicState;
              allyMechanicState = { ...vState, markPresent: true };
              moveName += `\n⚡ Static Mark applied!`;
            }
            if (isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "rilo") {
              const rState = allyMechanicState as RiloMechanicState;
              const maxShield = riloMaxShield(allyConstellation);
              const critBonus = crit ? Math.floor(RILO_SHIELD_GAIN_PER_BASIC * (allyConstellation >= 1 ? 0.5 : 0)) : 0;
              allyMechanicState = { ...rState, shield: Math.min(maxShield, rState.shield + RILO_SHIELD_GAIN_PER_BASIC + critBonus) };
              moveName += `\n🛡️ +${RILO_SHIELD_GAIN_PER_BASIC + critBonus} Shield (${(allyMechanicState as RiloMechanicState).shield}/${maxShield})`;
            }

            // Forte fills only from the active ally's own Basic Attack — announce
            // only on the turn a threshold is actually crossed.
            if (isSolaceAlly) {
              const forteBefore = solaceForte;
              solaceForte = addForteCharge(solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
              const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
              const isHalf  = solaceForte.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG);
              if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
                moveName += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
              } else if (isHalf && !wasHalf) {
                moveName += `\n✨ Forte is **HALF CHARGED**.`;
              }
            } else if (isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "kaelith") {
              const forteBefore = solaceForte;
              solaceForte = addForteCharge(solaceForte, KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC);
              if (isForteMaxed(solaceForte, KAELITH_FORTE_CONFIG) && !isForteMaxed(forteBefore, KAELITH_FORTE_CONFIG)) {
                moveName += `\n✨ Forte is **FULLY CHARGED** — next Umbral Cataclysm will keep your stacks!`;
              }
            } else if (isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "vesper") {
              const forteBefore = solaceForte;
              solaceForte = addForteCharge(solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
              if (isForteMaxed(solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
                moveName += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
              }
            } else if (isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "rilo") {
              const forteBefore = solaceForte;
              solaceForte = addForteCharge(solaceForte, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
              if (isForteMaxed(solaceForte, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
                moveName += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
              }
            }
          }

          const isSolaceAllySkill = isDevGuild && activeAllyCharacterId === "solace";

          if (btn.customId === "fb_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "solace") {
            // Solace's Skill is Attunement — a mode cycle, not a damage move.
            attunement.mode = cycleAttunementMode(attunement.mode);
            if (allyConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
            const crit = Math.random() < activeCritRate; abilCrit = crit;
            const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
            playerDmg  = dmg;
            moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
          } else if (btn.customId === "fb_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "kaelith" && allyKit) {
            const kState = allyMechanicState as KaelithMechanicState;
            if (kState.stacks <= 0) {
              moveName = `🌑 Umbral Detonation — no stacks to consume! (0 DMG bonus)`;
              playerDmg = 0;
            } else {
              const crit = Math.random() < activeCritRate; abilCrit = crit;
              const result = allyKit.onSkill(
                { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: kState },
                { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
                allyConstellation,
              );
              allyMechanicState = result.newMechanicState;
              const base = Math.max(1, Math.floor(activeAtk * result.damageMult * (1 - defReduction)));
              const dmg  = Math.floor(base * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
              playerDmg  = dmg;
              moveName   = `🌑 ${result.moveLabel} — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
              state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * result.vibFrac * totalVibMult));
            }
            state.skillCooldown = allyKit.skillCooldownTurns;
          } else if (btn.customId === "fb_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "vesper" && allyKit) {
            const vState = allyMechanicState as VesperMechanicState;
            const crit = Math.random() < activeCritRate; abilCrit = crit;
            const forteEmpowered = isForteMaxed(solaceForte, VESPER_FORTE_CONFIG);
            const result = allyKit.onSkill(
              { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: vState, forteEmpowered } as any,
              { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
              allyConstellation,
            ) as VesperSkillResult;
            allyMechanicState = result.newMechanicState;
            if (forteEmpowered) solaceForte = resetForte();

            const effectiveDefReduction = 1 - (1 - defReduction) * (1 - result.defIgnorePct);
            const perHitBase = Math.max(1, Math.floor(activeAtk * (result.damageMult / result.hits) * (1 - effectiveDefReduction)));
            const perHitDmg  = Math.floor(perHitBase * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));

            if (result.hits > 1) {
              const hitLines = Array.from({ length: result.hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
              playerDmg = perHitDmg * result.hits;
              moveName  = `⚡ ${result.moveLabel}\n${hitLines}\n**Total: ${playerDmg} DMG**${crit ? " **(CRIT)**" : ""}`;
              state.hitBadge = result.hits;
            } else {
              playerDmg = perHitDmg;
              moveName  = `⚡ ${result.moveLabel} — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
              state.hitBadge = undefined;
            }
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * result.vibFrac * totalVibMult));

            if (!forteEmpowered) {
              const forteBefore = solaceForte;
              solaceForte = addForteCharge(solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
              if (isForteMaxed(solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
                moveName += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
              }
            }
          } else if (btn.customId === "fb_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "rilo" && allyKit) {
            const rState = allyMechanicState as RiloMechanicState;
            const crit = true; abilCrit = crit;
            const forteEmpowered = isForteMaxed(solaceForte, RILO_FORTE_CONFIG);
            const result = allyKit.onSkill(
              { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: rState, forteEmpowered } as any,
              { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
              allyConstellation,
            ) as RiloSkillResult;
            allyMechanicState = result.newMechanicState;
            if (forteEmpowered) solaceForte = resetForte();

            const base = Math.max(1, Math.floor(activeAtk * result.damageMult * (1 - defReduction)));
            const dmg  = Math.floor(base * activeCritDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            playerDmg  = dmg;
            moveName   = `🛡️ ${result.moveLabel} — ${playerDmg} DMG **(CRIT)** (consumed ${result.shieldConsumed} Shield)`;
            if (result.defShredApplied) {
              enemyDefShredTurnsLeft = 2 + 1;
              enemyDefShredPct = RILO_C2_DEF_SHRED_PCT;
              moveName += `\n❄️ Enemy DEF shredded 10% for 2 turns!`;
            }
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * result.vibFrac * totalVibMult));
          } else if (btn.customId === "fb_skill") {
            const teamAtkMult  = isSolaceAllySkill ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
            const teamCritBonus = isSolaceAllySkill ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0;
            const wellspringAtkBonus  = isSolaceAllySkill && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const wellspringCritBonus = isSolaceAllySkill && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const forteAtkBonus  = isSolaceAllySkill ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const forteCritBonus = isSolaceAllySkill ? getSolaceForteCritRateBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const crit = forcedCritActive || Math.random() < Math.min(1, activeCritRate + 0.1 + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * radiantDmgMult * 1.8 * (1 - defReduction)));
            const extraElemBonusSkill = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
            let dmg    = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusSkill));
            dmg        = apply4pcSkillBonus(bonuses, dmg, state.skillCooldown === 0);
            if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(namedState));
            dmg        = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
            if (bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN") {
              const sov = smolderingSovereignOnSkill(namedState);
              if (sov.doubleHit) dmg = Math.floor(dmg * sov.bonusMult * 2);
            }
            const ar_s = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "SKILL" });
            dmg        = ar_s.dmg;
            if (ar_s.newStacks !== undefined) v2Stacks = ar_s.newStacks;
            const ign  = elemIgniteProc(bonuses.elementPassive, stats.atk);
            if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
            if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(namedState, state.playerHp, state.playerHpMax);
            playerDmg  = dmg + ign.dmg;
            moveName   = `Resonance Skill — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            if (ign.tag) moveName += `  ✦${ign.tag}`;
            state.bossVibNow    = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.6 * totalVibMult));
            state.skillCooldown = effectiveSkillCooldown(bonuses, SKILL_COOLDOWN);
            state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_s.bonusEnergy);
            state.playerHp      = Math.min(state.playerHpMax, applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_s.lifesteal ?? 0), playerDmg, state.playerHp, state.playerHpMax) + ar_s.healHp);
            if (bonuses.set5pc?.type === "POST_ULT_SKILL") state.skillCooldown = 0;
          }

          // Set inside Solace's Convergence branch below — Convergence resets
          // concertoEnergy to 0, so the generic per-move gain further down
          // must skip granting anything back on the same turn, or Convergence
          // would silently refund 35-47% of the bar it just spent (a bug
          // caught and fixed in Milestone 3a's port — built in from the start
          // here instead).
          let convergenceUsedThisTurn = false;

          if (btn.customId === "fb_ultimate" && !(isDevGuild && !isPlayerActiveNow)) {
            abilCrit   = true;
            const teamAtkMult = isSolaceAllySkill ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
            const wellspringAtkBonus = isSolaceAllySkill && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const forteAtkBonus = isSolaceAllySkill ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * radiantDmgMult * 3.5 * stats.critDmg * (1 - defReduction)));
            const extraElemBonusUlt = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
            let dmg    = Math.floor(base * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusUlt));
            dmg        = apply4pcUltBonus(bonuses, dmg);
            if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(namedState));
            const ar_u = applyAbilityAttack(bonuses, dmg, true, { ...abilCtxBase, moveType: "ULT" });
            dmg        = ar_u.dmg;
            if (ar_u.newStacks !== undefined) v2Stacks = ar_u.newStacks;
            if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
            if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE") radiantConvergenceOnCrit(namedState, state.playerHp, state.playerHpMax);
            playerDmg  = dmg;
            moveName   = `⚡ ULTIMATE — ${playerDmg} DMG`;
            state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));
            state.playerEnergy = Math.min(100, ar_u.bonusEnergy);
            state.playerHp     = Math.min(state.playerHpMax, applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_u.lifesteal ?? 0), playerDmg, state.playerHp, state.playerHpMax) + ar_u.healHp);
            if (bonuses.set5pc?.type === "POST_ULT_SKILL") state.skillCooldown = 0;
            if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") {
              const surge = stormcallersOathOnUltimate();
              state.playerEnergy = Math.min(100, state.playerEnergy + surge.bonusEnergy);
              stormBuffTurnsLeft = surge.turnsLeft + 1; // +1 compensates for the same-round decrement that fires immediately after this triggers (same pattern/reason as Frostveil Bastion's shield fix)
              stormBuffCritBonus = surge.critRateBonus;
            }
          } else if (btn.customId === "fb_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "solace") {
            // Solace's Ultimate spends Concerto Energy, not personal Energy.
            const healPct = solaceConvergenceHealPct(allyUltimateLevel, allyConstellation);
            const healResult = resolveIntroOutroEffect({ actions: [
              { type: "HEAL_ALLY", value: healPct },
              { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(allyConstellation) },
            ] }, { hp: state.playerHp, hpMax: state.playerHpMax });
            const allyHealResult = resolveIntroOutroEffect({ actions: [
              { type: "HEAL_ALLY", value: healPct },
            ] }, { hp: allyHp, hpMax: allyHpMax });

            const beforePlayer = state.playerHp;
            state.playerHp = Math.min(state.playerHpMax, state.playerHp + healResult.hpDelta);
            const actualHealPlayer = state.playerHp - beforePlayer;

            const beforeAlly = allyHp;
            allyHp = Math.min(allyHpMax, allyHp + allyHealResult.hpDelta);
            const actualHealAlly = allyHp - beforeAlly;

            playerDebuffs = cleanseDebuffs(playerDebuffs, healResult.cleanseCount);

            concertoEnergy = 0;
            convergenceUsedThisTurn = true;
            playerDmg = 0; abilCrit = false;

            const healSummary = `${displayName} +${actualHealPlayer} HP, ${allyKit?.label ?? "Solace"} +${actualHealAlly} HP`;

            if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
              forteEmpoweredTurnsLeft = solaceUltimateDoubleTurns(allyConstellation) + 1; // +1 compensates for the same-round decrement
              attunementDoubleTurnsLeft = 0;
              solaceForte = resetForte();
              moveName = `⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
                `**all 3 Attunement Modes empowered for ${solaceUltimateDoubleTurns(allyConstellation)} turns!**`;
            } else {
              attunementDoubleTurnsLeft = solaceUltimateDoubleTurns(allyConstellation) + 1; // +1 compensates for the same-round decrement
              forteEmpoweredTurnsLeft = 0;
              moveName = `⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
                `**${attunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(allyConstellation)} turns!**`;
            }
          } else if (btn.customId === "fb_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "kaelith" && allyKit) {
            const kState = allyMechanicState as KaelithMechanicState;
            const stacksConsumed = kState.stacks;

            const ultDamageMult = allyConstellation >= 6
              ? stacksConsumed * (KAELITH_PER_STACK_ULT_BONUS * 1.6)
              : kaelithUltimateBaseMult(allyUltimateLevel) + stacksConsumed * KAELITH_PER_STACK_ULT_BONUS;

            const result = allyKit.onUltimate(
              { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: kState },
              { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
              allyConstellation,
            );
            allyMechanicState = result.newMechanicState;

            const base = Math.max(1, Math.floor(activeAtk * ultDamageMult * (1 - defReduction)));
            const dmg  = Math.floor(base * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            playerDmg = dmg;
            moveName  = `🌑 ${result.moveLabel} — ${playerDmg} DMG`;
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));

            if (result.healResult.actions.length > 0) {
              const healResult = resolveIntroOutroEffect(result.healResult, { hp: allyHp, hpMax: allyHpMax });
              allyHp = Math.min(allyHpMax, allyHp + healResult.hpDelta);
            }
            if (result.resetsConcertoEnergy) { concertoEnergy = 0; convergenceUsedThisTurn = true; }
          } else if (btn.customId === "fb_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "vesper" && allyKit) {
            const vState = allyMechanicState as VesperMechanicState;
            const consumedMark = vState.markPresent;
            const energyPct = Math.min(100, state.playerEnergy) / 100;
            const markBonus = consumedMark ? 0.8 : 0;
            const c6Bonus = allyConstellation >= 6 ? vState.dischargesSinceUltimate * 0.15 : 0;
            const c3Bonus = allyConstellation >= 3 ? energyPct * 0.5 : 0;
            const ultDamageMult = vesperUltimateBaseMult(allyUltimateLevel) + markBonus + c6Bonus + c3Bonus;

            const result = allyKit.onUltimate(
              { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: vState, playerEnergy: state.playerEnergy, playerEnergyMax: 100 },
              { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
              allyConstellation,
            );
            allyMechanicState = result.newMechanicState;

            const base = Math.max(1, Math.floor(activeAtk * ultDamageMult * (1 - defReduction)));
            const dmg  = Math.floor(base * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            playerDmg = dmg;
            moveName  = `⚡ ${result.moveLabel} — ${playerDmg} DMG`;
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));
          } else if (btn.customId === "fb_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "rilo" && allyKit) {
            const rState = allyMechanicState as RiloMechanicState;
            const result = allyKit.onUltimate(
              { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: rState },
              { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
              allyConstellation,
            );
            const maxShield = riloMaxShield(allyConstellation);
            const c6DoubleHit = allyConstellation >= 6 && rState.shield >= maxShield;
            const hits = c6DoubleHit ? 2 : 1;

            const perHitBase = Math.max(1, Math.floor(activeAtk * (riloUltimateBaseMult(allyUltimateLevel) / hits) * (1 - defReduction)));
            const perHitDmg  = Math.floor(perHitBase * activeCritDmg * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            const totalDmg   = perHitDmg * hits;

            const c4Bonus = riloUltimateShieldFromDamage(totalDmg, allyConstellation);
            allyMechanicState = {
              ...(result.newMechanicState as RiloMechanicState),
              shield: Math.min(maxShield, (result.newMechanicState as RiloMechanicState).shield + c4Bonus),
            };

            if (hits > 1) {
              const hitLines = Array.from({ length: hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
              playerDmg = totalDmg;
              moveName  = `🛡️ ${result.moveLabel}\n${hitLines}\n**Total: ${playerDmg} DMG**`;
              state.hitBadge = hits;
            } else {
              playerDmg = totalDmg;
              moveName  = `🛡️ ${result.moveLabel} — ${playerDmg} DMG`;
              state.hitBadge = undefined;
            }
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));

            if (result.healResult.actions.length > 0) {
              playerDebuffs = cleanseDebuffs(playerDebuffs, 1);
            }
          }

          if (btn.customId === "fb_echoskill" && bonuses.echoSkill) {
            const def = bonuses.echoSkill;
            const crit = forcedCritActive || def.kind === "GUARANTEED_CRIT" || Math.random() < activeCritRate;
            abilCrit = crit;
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base = Math.max(1, Math.floor(stats.atk * smolderMult * havocAtkMult * echoSkillBaseMult() * (1 - defReduction)));
            const extraElemBonusEcho = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
            let dmg = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusEcho) * radiantDmgMult);

            const result = applyEchoSkill(def, {
              atk: stats.atk, enemyHp: state.bossHpNow, enemyHpMax: state.bossHpMax,
              playerHp: state.playerHp, playerHpMax: state.playerHpMax,
              playerEnergy: state.playerEnergy, turn: state.turn, bossVibMax: fb.vibBar, crit,
            });
            dmg = Math.floor(dmg * result.dmgMult);
            if (result.doubleHit) dmg *= 2;
            if (result.noDamage) dmg = 0;

            let namedTriggerTag = "";
            if (def.kind === "NAMED_SET_TRIGGER" && bonuses.activeNamedSetId === def.setId) {
              switch (def.setId) {
                case "SMOLDERING_SOVEREIGN":
                  namedState.fusionAtkStacks = 4; namedState.fusionSkillDoubleArmed = true;
                  namedTriggerTag = "ATK stacks maxed!";
                  break;
                case "FROSTVEIL_BASTION":
                  if (!namedState.glacioShieldUsed) {
                    namedState.glacioShieldUsed = true;
                    const shieldAmt = Math.floor(state.playerHpMax * 0.28);
                    state.playerHp = Math.min(state.playerHpMax, state.playerHp + shieldAmt);
                    glacioShieldTurnsLeft = 5; glacioShieldElemBonus = 0.22;
                    namedTriggerTag = `+${shieldAmt} HP shield!`;
                  }
                  break;
                case "STORMCALLERS_OATH":
                  namedState.electroThunderboltArmed = true;
                  namedTriggerTag = "Thunderbolt armed!";
                  break;
                case "WINDSTRIDERS_LEGACY":
                  namedState.aeroWindstacks = 6;
                  namedTriggerTag = "Windstacks maxed!";
                  break;
                case "VOIDBORN_REMNANT":
                  if (!namedState.havocFrenzyUsed) {
                    namedState.havocFrenzyUsed = true;
                    namedState.havocFrenzyTurnsLeft = 4;
                    havocFrenzyAtkMult = 1.25; havocFrenzyLifesteal = 0.15; havocFrenzyDefIgnore = 0.20;
                    namedTriggerTag = "Frenzy triggered!";
                  }
                  break;
                case "RADIANT_CONVERGENCE":
                  namedState.spectroHealStacks = 5;
                  namedTriggerTag = "Heal-stacks maxed!";
                  break;
              }
            }

            const ar_e = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "SKILL" });
            dmg = ar_e.dmg;
            if (ar_e.newStacks !== undefined) v2Stacks = ar_e.newStacks;
            const ignite = result.noDamage ? { dmg: 0, tag: "" } : elemIgniteProc(bonuses.elementPassive, stats.atk);
            playerDmg = dmg + ignite.dmg;
            moveName  = result.noDamage ? `🌀 ${def.name}` : `🌀 ${def.name}${crit ? " **(CRIT)**" : ""} — ${playerDmg} DMG`;
            if (namedTriggerTag) moveName += `\n✦ ${namedTriggerTag}`;
            if (ar_e.tag)   moveName += `  ✦${ar_e.tag}`;
            if (ignite.tag) moveName += `  ✦${ignite.tag}`;

            if (!result.noDamage) {
              state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.5 * totalVibMult) - result.extraVibDrain);
            }
            echoSkillCooldown = (result.resetCdOnCrit && crit) ? 0 : ECHO_SKILL_COOLDOWN;

            const energyGain = ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit) + result.bonusEnergy;
            state.playerEnergy = result.setEnergyFull ? 100 : Math.min(100, state.playerEnergy + energyGain);

            let echoLifesteal = bonuses.lifesteal + havocLifesteal + (ar_e.lifesteal ?? 0);
            if (def.kind === "FLAT_LIFESTEAL") echoLifesteal += def.pct;
            const scaledEchoHeal = Math.floor(result.healHp * (1 + bonuses.healingBonus));
            state.playerHp = Math.min(state.playerHpMax, applyLifesteal(echoLifesteal, playerDmg, state.playerHp, state.playerHpMax) + ar_e.healHp + scaledEchoHeal);
            if (scaledEchoHeal > 0) {
              const benchPos = ([1, 2, 3] as PositionIndex[]).find(pos => pos !== activeUnit && allyBundles[pos] && allyBundles[pos]!.hp > 0);
              if (benchPos) {
                const b = allyBundles[benchPos]!;
                b.hp = Math.min(b.hpMax, b.hp + scaledEchoHeal);
              }
            }

            if (result.armsNextCrit) nextAttackCritArmed = true;
            if (result.defShredTurns > 0) {
              enemyDefShredTurnsLeft = result.defShredTurns + 1;
              enemyDefShredPct = result.defShredPct;
            }
          }

          // Concerto Energy builds from combat actions, never from swapping.
          const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
            fb_basic: 10, fb_skill: 20, fb_echoskill: 20, fb_ultimate: 35,
          };
          if (isDevGuild && !convergenceUsedThisTurn) {
            let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
            if (concertoGain > 0 && !isPlayerActiveNow && allySolaceStats?.hasWellspring) concertoGain += getWellspringBaseEnergyBonus(allySolaceStats.wellspringRefinement);
            if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
          }

          // SPD quick-strike — once per fight, if invested SPD clears the boss's derived SPD
          const isSolaceConvergence = btn.customId === "fb_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "solace";
          if (!quickStrikeUsed && btn.customId !== "fb_flee" && !isSwapAction && !isSolaceConvergence && hasQuickStrike(stats.spd, fightLevel)) {
            quickStrikeUsed = true;
            const bonusDmg = Math.max(1, Math.floor(stats.atk * (1 - defReduction)));
            playerDmg += bonusDmg;
            moveName  += `\n⚡ **Quick Strike** — your speed caught them off guard! +${bonusDmg} bonus DMG!`;
          }

          state.bossHpNow = Math.max(0, state.bossHpNow - playerDmg);

          // Shatter
          if (state.bossVibNow <= 0 && !state.isShattered) {
            state.isShattered = true;
            shatterTurnsLeft  = 1;
            moveName += "\n✦ **SHATTER!** Boss stunned 1 turn — all attacks critical!";
            const voidHeal = elemVoidSurgeHeal(bonuses.elementPassive, state.playerHpMax);
            if (voidHeal > 0) {
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + voidHeal);
              moveName += `\n✦ **Void Surge** — +${voidHeal} HP!`;
            }
            if (bonuses.activeNamedSetId === "VOIDBORN_REMNANT") {
              const remnant = voidbornRemnantOnShatter();
              const bonusDmg = Math.floor(stats.atk * remnant.bonusMult);
              state.bossHpNow = Math.max(0, state.bossHpNow - bonusDmg);
              const healAmt = Math.floor(state.playerHpMax * remnant.healPct);
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + healAmt);
              moveName += `\n🌑 **Voidborn Rupture** — +${bonusDmg} bonus DMG, +${healAmt} HP!`;
            }
          }

          state.lastMove = moveName;

          if (state.bossHpNow <= 0) {
            await sendBattleCard(thread as any, { ...state, ...activeCardIdentity(), lastMove: `${moveName} — **DEFEATED!**` }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());
            collector.stop();
            await cleanup(true);
            return;
          }

          // Debuffs tick down at the START of resolving the boss's turn — this
          // way any WEAKENED applied by the attack below isn't touched until
          // NEXT round's tick, giving it the full 2 turns its own flavor text
          // advertises, instead of being decremented in the same cycle it's
          // created.
          if (isDevGuild) {
            const tickResult = tickDebuffs(playerDebuffs);
            playerDebuffs = tickResult.state;
          }

          // Boss turn
          if (shatterTurnsLeft > 0) {
            shatterTurnsLeft--;
            if (shatterTurnsLeft === 0) {
              state.isShattered = false;
              state.bossVibNow  = fb.vibBar;
              state.lastMove   += "\n◇ Boss recovers from Shatter.";
            } else {
              state.lastMove += `\n◇ Boss stunned (${shatterTurnsLeft} turn left).`;
            }
          } else {
            const move    = fb.moves[Math.floor(Math.random() * fb.moves.length)];
            const isSolaceAllyForDef = isDevGuild && activeAllyCharacterId === "solace";
            const wellspringDefBonus = isSolaceAllyForDef && allySolaceStats?.hasWellspring ? getWellspringDefBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const forteDefBonus = isSolaceAllyForDef ? getSolaceForteDefBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const attunementDefBonus = solaceAttunementDefBonus(allySkillLevel);
            const riloDefBuffMult = riloDefBuffTurnsLeft > 0 ? (1 + riloDefBuffPct) : 1;
            const attunementDefMult = (isSolaceAllyForDef ? getAttunementDefMult(attunement, attunementDefBonus, attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus) * riloDefBuffMult;
            let bossDmg   = Math.max(1, Math.floor(scaled.atk * move.damage - activeDef * attunementDefMult * 0.4));
            if (fb.mechanicId === "MOLTEN_BUILDUP") {
              const interrupted = btn.customId === "fb_skill" || btn.customId === "fb_ultimate";
              const molten = moltenBuildupOnBossTurn(bossMechState, interrupted);
              if (molten.erupted) {
                bossDmg = Math.floor(bossDmg * (1 + molten.bonusDmgMult));
                state.lastMove = (state.lastMove ?? "") + `\n🔥 **Molten Eruption** — the buildup releases in a devastating burst! (+75% DMG)`;
              }
            }
            if (fb.mechanicId === "FROST_BARRIER") {
              const barrier = frostBarrierOnBossTurn(bossMechState, playerDmg, scaled.hp);
              if (barrier.healed > 0) {
                state.bossHpNow = Math.min(scaled.hp, state.bossHpNow + barrier.healed);
                state.lastMove = (state.lastMove ?? "") + `\n❄️ **Frost Barrier** — the Warden mends itself for +${barrier.healed} HP!`;
              }
            }
            if (fb.mechanicId === "ENERGY_SURGE") {
              const surge = energySurgeOnBossTurn(bossMechState);
              if (surge.overcharged) {
                bossDmg = Math.floor(bossDmg * (1 + surge.bonusDmgMult));
                state.lastMove = (state.lastMove ?? "") + `\n⚡ **Overcharge** — the Herald's stormcrown discharges at full power! (+90% DMG)`;
              }
            }
            if (fb.mechanicId === "MOMENTUM_GUST") {
              const gust = momentumGustOnBossTurn(bossMechState, playerDmg, scaled.hp);
              if (gust.released) {
                bossDmg = Math.floor(bossDmg * (1 + gust.bonusDmgMult));
                state.lastMove = (state.lastMove ?? "") + `\n🌪️ **Momentum Release** — pent-up wind erupts into a devastating gust! (+100% DMG)`;
              }
            }
            if (fb.mechanicId === "STEADY_REGEN") {
              const regen = steadyRegenOnBossTurn(bossMechState, playerDmg, scaled.hp);
              if (regen.healed > 0) {
                state.bossHpNow = Math.min(scaled.hp, state.bossHpNow + regen.healed);
                state.lastMove = (state.lastMove ?? "") + `\n✨ **Steady Regeneration** — the Seraph mends itself for +${regen.healed} HP!`;
              } else if (regen.regenBroken) {
                state.lastMove = (state.lastMove ?? "") + `\n✨ Your relentless pressure disrupts the Seraph's regeneration!`;
              }
            }
            bossDmg       = roll4pcBlock(bonuses, bossDmg);
            const shield  = elemFrostShield(bonuses.elementPassive, bossDmg);
            bossDmg       = shield.dmg;
            if (fb.mechanicId === "LIFESTEAL_FRENZY") {
              const frenzy = lifestealFrenzyOnBossTurn(bossMechState, bossDmg, state.bossHpNow, scaled.hp);
              if (frenzy.selfHeal > 0) state.bossHpNow = Math.min(scaled.hp, state.bossHpNow + frenzy.selfHeal);
              if (frenzy.frenzyTriggered) state.lastMove = (state.lastMove ?? "") + `\n🌑 **Devourer's Frenzy** — the Devourer senses weakness and surges with hunger! (+35% ATK for 3 turns)`;
              if (frenzy.frenzyActive) bossDmg = Math.floor(bossDmg * frenzy.atkMult);
            }
            const allyIsActive = isDevGuild && !isPlayerActiveNow;
            if (allyIsActive && activeAllyCharacterId === "rilo") {
              const rState = allyMechanicState as RiloMechanicState;
              const hitResult = riloOnHitTaken(rState, bossDmg, allyHp, allyHpMax, allyConstellation);
              allyMechanicState = hitResult.newMechanicState;
              bossDmg = hitResult.actualDamageTaken;
              if (hitResult.forteGain > 0) solaceForte = addForteCharge(solaceForte, RILO_FORTE_CONFIG, hitResult.forteGain);
              if (hitResult.blockedByC3) state.lastMove = (state.lastMove ?? "") + `\n🛡️ **Guard Break Save!** Rilo's Shield fully absorbed a lethal blow!`;
              if (hitResult.zeroShieldSaveTriggered) state.lastMove = (state.lastMove ?? "") + `\n❄️ **Unbreakable Guard** — Shield surges back from nothing!`;
            }
            if (allyIsActive) {
              allyHp = Math.max(0, allyHp - bossDmg);
            } else {
              state.playerHp = Math.max(0, state.playerHp - bossDmg);
            }
            if (bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN") smolderingSovereignOnDamageTaken(namedState);
            if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") windstridersLegacyOnBigHitTaken(namedState, bossDmg, state.playerHpMax);
            if (bonuses.activeNamedSetId === "VOIDBORN_REMNANT") {
              const frenzy = voidbornRemnantCheckFrenzy(namedState, state.playerHp, state.playerHpMax);
              if (frenzy.triggered) {
                havocFrenzyAtkMult   = frenzy.atkMult;
                havocFrenzyLifesteal = frenzy.lifesteal;
                havocFrenzyDefIgnore = frenzy.defIgnorePct;
                state.lastMove = (state.lastMove ?? "") + `\n🌑 **Void Frenzy** — ATK +${Math.floor((frenzy.atkMult - 1) * 100)}%, Lifesteal +${Math.floor(frenzy.lifesteal * 100)}%, ignoring ${Math.floor(frenzy.defIgnorePct * 100)}% enemy DEF!`;
              }
            }
            if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE") {
              radiantConvergenceOnHitTaken(namedState, bossDmg, state.playerHpMax);
              const burst = radiantConvergenceCheckBurstHeal(namedState, state.playerHp, state.playerHpMax, bonuses.healingBonus);
              if (burst > 0) {
                state.playerHp = Math.min(state.playerHpMax, state.playerHp + burst);
                state.lastMove = (state.lastMove ?? "") + `\n✨ **Radiant Convergence** — burst-heal +${burst} HP!`;
              }
            }
            if (bonuses.activeNamedSetId === "FROSTVEIL_BASTION") {
              const counter = frostveilBastionOnHitTaken(namedState);
              if (counter.counterProc) {
                state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(fb.vibBar * counter.vibDrain));
                state.lastMove  += `\n❄️ **Counter-Frost** — drained ${Math.floor(counter.vibDrain * 100)}% enemy vibration!`;
              }
              const panic = frostveilBastionCheckPanicShield(namedState, state.playerHp, state.playerHpMax);
              if (panic.triggered) {
                state.playerHp = Math.min(state.playerHpMax, state.playerHp + panic.shieldAmount);
                glacioShieldTurnsLeft = panic.turnsLeft + 1; // +1 compensates for the same-round decrement that fires immediately after this triggers (shield is granted mid-round, after the player already acted, so the triggering round's decrement would otherwise eat into the advertised duration)
                glacioShieldElemBonus = panic.elemDmgBonus;
                state.lastMove += `\n❄️ **Frostveil Shield** — +${panic.shieldAmount} HP, +${Math.floor(panic.elemDmgBonus * 100)}% Glacio DMG for ${panic.turnsLeft} turns!`;
              }
            }
            const hpRegen  = get5pcHpRegen(bonuses, state.playerHpMax);
            if (hpRegen > 0 && typeof bonuses.set5pc?.value === "number" && bonuses.set5pc.value < 1)
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + hpRegen);
            const radRegen = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
            if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
            state.lastMove += `\n◇ ${fb.name} ${move.effect} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
            state.playerEnergy = Math.min(100, state.playerEnergy + 15);
            const v2Regen = abilityV2TurnRegen(bonuses, state.playerHpMax);
            if (v2Regen.healHp > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + v2Regen.healHp);
            if (v2Regen.energy > 0) state.playerEnergy = Math.min(100, state.playerEnergy + v2Regen.energy);

            // Milestone 3c-ii: exercises the debuff system inside a real fight.
            // 25% chance per enemy attack, only when the player has actually
            // opted into team mechanics via /team (Milestone 3.5a).
            if (hasSolace && Math.random() < 0.25) {
              playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.2, 2);
              state.lastMove += `\n◇ *${fb.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
            }
          }

          state.turn++;
          if (state.skillCooldown > 0) state.skillCooldown--;
          if (glacioShieldTurnsLeft > 0) glacioShieldTurnsLeft--;
          if (riloDefBuffTurnsLeft > 0) riloDefBuffTurnsLeft--;
          if (stormBuffTurnsLeft > 0) stormBuffTurnsLeft--;
          if (namedState.spectroFractureTurnsLeft > 0) namedState.spectroFractureTurnsLeft--;
          if (echoSkillCooldown > 0) echoSkillCooldown--;
          if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
          if (isDevGuild && attunementDoubleTurnsLeft > 0) attunementDoubleTurnsLeft--;
          if (isDevGuild && forteEmpoweredTurnsLeft > 0) forteEmpoweredTurnsLeft--;
          if (forcedCritActive && !isSwapAction) nextAttackCritArmed = false;

          // Write the mutated ally* legacy vars back into whichever position's
          // bundle is currently active — the turn's damage/mechanic mutations
          // only touched the local copies, not the bundle object itself.
          if (activeBundle) {
            activeBundle.hp = allyHp;
            activeBundle.mechanicState = allyMechanicState;
          }

          // Active unit KO'd — fall back to the next living position in
          // roster order (wrapping 1→2→3→1), same flavor text shape as the
          // old single-ally "swapped back to player" message, generalized to
          // name whichever position/character it's falling back to. If no
          // other position is alive, the team is wiped — handled by the Lose
          // check below (isTeamWiped will be true).
          if (isDevGuild && currentPositionHp(activeUnit) <= 0) {
            const koedLabel = positionLabel(roster, activeUnit, displayName, kitLabelFor);
            if (activeBundle) activeBundle.hp = 0;
            const fallback = nextAliveFallback(roster, activeUnit, currentPositionHp);
            if (fallback !== null) {
              activeUnit = fallback;
              isPlayerActiveNow = isPlayerActive();
              activeBundle = syncActiveBundle();
              const fallbackLabel = positionLabel(roster, fallback, displayName, kitLabelFor);
              state.lastMove += `\n◇ **${koedLabel} was knocked out** — swapped to ${fallbackLabel}.`;
            }
          }

          // ── Second Wind — survive a lethal blow once ──────────────────────────
          if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
            secondWindUsed = true;
            state.playerHp = 1;
            state.lastMove += `\n✦ **UNDYING WILL** — 1 HP!`;
          }

          // ── Lose check ────────────────────────────────────────────────────────
          // Generalized from "player HP <= 0" to "every filled position is
          // down" — for a solo roster (no ally positions filled) this reduces
          // to exactly the old check, since filledPositions() is just [1]
          // ("self") in that case.
          if (isTeamWiped(roster, currentPositionHp)) {
            state.playerHp = 0;
            await sendBattleCard(thread as any, { ...state, ...activeCardIdentity(), lastMove: state.lastMove + " — **YOU FELL.**" }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());
            await thread.send({
              embeds: [new EmbedBuilder().setColor(0x334155)
                .setDescription(`◈ Defeated by **${fb.name}**. Use **/field-boss** to try again.`)
                .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
            });
            collector.stop();
            releaseLock(interaction.user.id);
            await clearFight(interaction.user.id);
            await thread.setArchived(true).catch(() => {});
            return;
          }

          runTurn();
        });

        collector.on("end", async (_: any, reason: string) => {
          if (reason === "time") {
            await thread.send({
              embeds: [new EmbedBuilder().setColor(0x334155)
                .setDescription("◈ Fight timed out.")
                .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
            });
            releaseLock(interaction.user.id);
            await clearFight(interaction.user.id);
            await thread.setArchived(true).catch(() => {});
          }
        });
      };

      runTurn();
    });

    selCollector?.on("end", async (col) => {
      if (col.size === 0) {
        releaseLock(interaction.user.id);
        await interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  },
};

export default command;
export const { data, execute } = command;
