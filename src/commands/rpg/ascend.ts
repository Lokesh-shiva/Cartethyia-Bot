import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, PermissionFlagsBits,
  TextChannel, ThreadChannel,
  StringSelectMenuBuilder, MessageComponentInteraction,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, awardUser, isDispatchBlocked } from "../../lib/economy";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { WORLD_LEVEL_CAPS, checkLevelUp } from "../../lib/progression";
import { getBoss, scaledBoss } from "../../lib/bosses";
import { gearAwareScale, baselineAtk } from "../../lib/combat";
import { generateBattleCard, BattleCardState } from "../../lib/battleCard";
import { generateUniqueAbilityV2 } from "../../lib/uniqueAbility";
import { resolvePlayerBonuses, applyBonuses, apply4pcSkillBonus, apply4pcUltBonus, roll4pcDoubleHit, roll4pcBlock, apply5pcLowHpCrit, apply5pcFirstHit, apply5pcFullHpDmg, get5pcVibDrainMult, get5pcHpRegen, applyLifesteal, elemIgniteProc, elemFrostShield, elemDischargeEnergy, elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit, applyAbilityAttack, abilityV2TurnRegen, effectiveSkillCooldown, hasQuickStrike } from "../../lib/setBonus";
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
import { formatV2Effects } from "../../lib/abilityEngineV2";
import { generateAbilityCard } from "../../lib/abilityCard";
import { incrementWeaponBond } from "../../lib/weaponAwakening";
import { grantReferralMilestone } from "../../lib/referral";
import { mailNudge } from "../../lib/mailNudge";
import prisma from "../../lib/prisma";
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
import { VesperMechanicState, VesperSkillResult, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC, vesperUltimateBaseMult } from "../../lib/kits/vesperKit";
import {
  RiloMechanicState, RiloSkillResult, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC,
  RILO_SHIELD_GAIN_PER_BASIC, RILO_C2_DEF_SHRED_PCT, riloMaxShield, riloUltimateBaseMult, riloUltimateShieldFromDamage, riloOnHitTaken,
} from "../../lib/kits/riloKit";
import "../../lib/kits"; // registers CHARACTER_KITS side-effects (solaceKit, kaelithKit, vesperKit)

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

// Energy regens 25 per turn (reaches 100 in 4 turns)
const ENERGY_PER_TURN = 25;
const SKILL_COOLDOWN  = 3; // turns

// Active sessions — prevent double-fighting
// activeSessions replaced by shared combatLock

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
      new ButtonBuilder().setCustomId("battle_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("battle_skill")
        .setLabel(skillReady ? "🌑  Umbral Detonation" : `🌑  Detonation (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder().setCustomId("battle_ultimate").setLabel("🌑  Umbral Cataclysm")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("battle_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "vesper") {
    // Vesper's Skill has no cooldown (always ready) and her Ultimate spends
    // her own personal Energy, not Concerto Energy — unlike Solace/Kaelith's
    // ally-Ultimate button, which gates on team.concertoEnergy.
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("battle_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("battle_skill").setLabel("⚡  Discharge").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("battle_ultimate").setLabel("⚡  Overload")
        .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
      new ButtonBuilder().setCustomId("battle_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "rilo") {
    // Rilo's Ultimate gates on Concerto Energy like Kaelith/Solace's ally
    // buttons — her own resource is Shield, which isn't what gates the
    // button (matching Kaelith's precedent of two separate gauges).
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("battle_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("battle_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("battle_ultimate").setLabel("🛡️  Avalanche Slam")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("battle_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow) {
    const modeLabel = team.attunement.mode ? `(${team.attunement.mode})` : "(inactive)";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("battle_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("battle_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("battle_ultimate").setLabel("⚡  Convergence")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("battle_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const skillReady = state.skillCooldown === 0;
    const ultReady   = state.playerEnergy >= 100;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("battle_basic")
        .setLabel("⚔️  Basic Attack")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("battle_skill")
        .setLabel(skillReady ? "✦  Resonance Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!skillReady),
      new ButtonBuilder()
        .setCustomId("battle_ultimate")
        .setLabel("⚡  Ultimate")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!ultReady),
    );
    if (echoSkill) {
      const echoReady = echoSkill.cooldown === 0;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("battle_echoskill")
          .setLabel(echoReady ? `🌀  ${echoSkill.name}` : `🌀  ${echoSkill.name} (${echoSkill.cooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("battle_flee")
        .setLabel("🚪  Flee")
        .setStyle(ButtonStyle.Danger),
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
      new ButtonBuilder().setCustomId("battle_swap")
        .setLabel(`🔄  Swap to ${target.label}`)
        .setStyle(ButtonStyle.Secondary),
    ));
  } else if (team?.isDevGuild && aliveSwapTargets.length >= 2) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("battle_swap_select")
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
    .setName("ascend")
    .setDescription("Challenge the Ascension Trial — break your level cap."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const bonuses = await resolvePlayerBonuses(interaction.user.id);
    const stats   = applyBonuses(user, bonuses);
    const cap     = WORLD_LEVEL_CAPS[user.worldLevel] ?? 20;
    const boss    = getBoss(user.worldLevel);

    if (!boss) {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x334155)
          .setDescription(`◈ World Level **${user.worldLevel}** is the current content ceiling.\nThe next Ascension Trial is being prepared — check back in a future update.`)
          .setFooter({ text: "CARTETHYIA  ·  Ascension System" })],
      });
      return;
    }

    // Element check — must choose before ascending
    if (!user.element || user.element === "NONE") {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x334155)
            .setDescription(`◈ You must choose your **Elemental Resonance** before ascending.\nCheck your level-20 notification or use **/element** to choose.`)
            .setFooter({ text: "CARTETHYIA  ·  Ascension System" }),
        ],
      });
      return;
    }

    // Level check
    if (user.level < cap) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x334155)
            .setDescription(`◈ You must reach **Level ${cap}** to initiate an Ascension Trial.\nYou are currently **Level ${user.level}**.`)
            .setFooter({ text: "CARTETHYIA  ·  Ascension System" }),
        ],
      });
      return;
    }

    // Block duplicate sessions
    if (isDispatchBlocked(user)) {
      await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before entering combat." });
      return;
    }

    if (!acquireLock(interaction.user.id, "Ascension Trial")) {
      await interaction.editReply({ content: alreadyInCombatMsg(interaction.user.id) });
      return;
    }

    // ── Create private thread ────────────────────────────────────────────────
    const channel = interaction.channel as TextChannel;
    let thread;
    try {
      thread = await channel.threads.create({
        name:                 `⚔️ ${displayName} — Ascension Trial`,
        autoArchiveDuration:  10080,
        type:                 ChannelType.PrivateThread,
        reason:               "Ascension Trial",
      });
      await thread.members.add(interaction.user.id);
    } catch {
      releaseLock(interaction.user.id);
      await interaction.editReply({ content: "◈ I need **Create Private Threads** + **Send Messages in Threads** permissions in this channel to run the trial. Ask an admin to grant them, or try another channel." });
      return;
    }

    await interaction.editReply({
      content: `◈ Your Ascension Trial has begun. <#${thread.id}>`,
    });
    await registerFight(interaction.user.id, thread.id, interaction.guildId!, "Ascension Trial");

    // lock already acquired above — no re-acquire needed

    // Scale boss to player — gear-aware so fights stay engaging regardless of build
    const fightLevel = user.level;
    const gearRatio  = stats.atk / baselineAtk(fightLevel);
    const scaled = gearAwareScale(
      { hp: boss.baseHp, atk: boss.baseAtk, def: boss.baseDef },
      fightLevel, user.worldLevel, gearRatio,
    );

    // Build initial state (bonuses applied to base stats)
    let firstSkillUsed = false;
    let firstActionDone = false;
    let v2Stacks        = 0;
    let secondWindUsed = false;
    let isEnraged      = false;
    let quickStrikeUsed = false; // SPD-driven bonus action — once per fight
    const ECHO_SKILL_COOLDOWN = 4;
    let echoSkillCooldown      = 0;
    let enemyDefShredTurnsLeft = 0;
    let enemyDefShredPct       = 0;
    let nextAttackCritArmed    = false;
    const ENERGY_PER_TURN_ASCEND = Math.floor(stats.energyPerTurn);

    // Named Echo Set per-fight state (all sets — no-op unless bonuses.activeNamedSetId matches)
    const namedState = initNamedSetState();
    let glacioShieldTurnsLeft  = 0;   // Frostveil Bastion 5pc — elem DMG buff duration
    let glacioShieldElemBonus  = 0;   // active elem DMG bonus while shield buff is up
    let riloDefBuffTurnsLeft   = 0;   // Rilo C1's Outro DEF buff on whoever swaps in — no existing generic "buff own DEF for N turns" primitive, so this is a dedicated per-fight counter, same shape as glacioShieldTurnsLeft
    let riloDefBuffPct         = 0;
    let stormBuffTurnsLeft     = 0;   // Stormcaller's Oath 4pc — crit rate buff duration
    let stormBuffCritBonus     = 0;   // active crit rate bonus while post-ult buff is up
    let havocFrenzyAtkMult     = 1.0; // Voidborn Remnant 5pc — active buff values while frenzyActive
    let havocFrenzyLifesteal   = 0;
    let havocFrenzyDefIgnore   = 0;

    const state: BattleCardState = {
      boss,
      bossHpNow:     scaled.hp,
      bossHpMax:     scaled.hp,
      bossVibNow:    boss.vibBar,
      playerHp:      stats.hp,
      playerHpMax:   stats.hp,
      playerEnergy:  0,
      playerName:    displayName,
      playerElement: user.element,
      turn:          1,
      lastMove:      `The ${boss.name} stirs. Your trial begins.`,
      isShattered:   false,
      skillCooldown: 0,
    };

    // ── Opening message ───────────────────────────────────────────────────────
    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setColor(ELEMENT_HEX[user.element] ?? 0x6366F1)
          .setTitle(`⚔️ Ascension Trial — World Level ${user.worldLevel}`)
          .setDescription([
            `**${boss.name}** — *${boss.title}*`,
            ``,
            `◈  Element Weakness: **${boss.weakness}** deals **1.5×** damage`,
            `◈  Shatter the Vibration Bar to stun the boss for 2 turns`,
            `◈  Win to break your level cap and advance to **WL${user.worldLevel + 1}**`,
          ].filter(Boolean).join("\n"))
          .setFooter({ text: "CARTETHYIA  ·  Ascension Trial" }),
      ],
    });

    // ── Main battle loop ──────────────────────────────────────────────────────
    let shatterTurnsLeft = 0;
    let battleMsg: any    = null;

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
    // across the ~30 call sites below — they now mean "the roster has ANY
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
    // The battle card's main panel must show whichever unit is CURRENTLY
    // ACTIVE — previously it always showed the human player's own name/HP/
    // element even while an ally was fighting, which made the card look
    // static/wrong after a swap (the only place the active ally's real HP
    // appeared was buried in the small "Benched:" text line below it).
    function activeCardIdentity(): { playerName: string; playerHp: number; playerHpMax: number; playerElement: string } {
      if (isPlayerActive()) {
        return { playerName: displayName, playerHp: state.playerHp, playerHpMax: state.playerHpMax, playerElement: user.element };
      }
      const bundle = allyBundles[activeUnit];
      return {
        playerName:    bundle?.kit.label ?? "Ally",
        playerHp:      bundle?.hp ?? 0,
        playerHpMax:   bundle?.hpMax ?? 0,
        playerElement: bundle?.kit.element ?? user.element,
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

    const runTurn = async () => {
      // Re-sync the legacy ally* vars for whichever position is active NOW
      // (may have changed via swap/KO-fallback at the end of the previous
      // turn) before rendering this turn's buttons/status line.
      syncActiveBundle();
      const buttons = buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext());
      if (battleMsg) {
        // Edit previous message — remove old buttons
        await battleMsg.edit({ components: [] }).catch(() => {});
      }
      battleMsg = await sendBattleCard(thread as any, { ...state, ...activeCardIdentity() }, buttons, teamStatusLine());

      const collector = battleMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
        time: 30 * 60 * 1000, // 30 minutes per turn — plenty of time
        max:  1,
      });

      collector.on("collect", async (btn: MessageComponentInteraction) => {
        await btn.deferUpdate();

        // Re-sync the legacy ally* vars for the position active at the
        // START of this turn (may be stale if buildButtons wasn't the last
        // thing to call syncActiveBundle — cheap enough to just redo it).
        let activeBundle = syncActiveBundle();
        let isPlayerActiveNow = isPlayerActive();
        // Both the single-button and dropdown swap variants consume the
        // turn as a non-attack action — anywhere the old code checked
        // `!== "battle_swap"` needs to exclude both customIds now.
        const isSwapAction = btn.customId === "battle_swap" || btn.customId === "battle_swap_select";

        let playerDmg = 0;
        let moveName  = "";
        state.hitBadge = undefined; // cleared every turn — only Vesper's multi-hit Discharge branch sets it, otherwise a stale badge from a prior turn would incorrectly persist
        let radiantDmgMult = 1.0;
        if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && btn.customId !== "battle_flee") {
          const heal = radiantConvergenceOnTurnHeal(namedState, state.playerHpMax, bonuses.healingBonus);
          state.playerHp  = Math.min(state.playerHpMax, state.playerHp + heal.healAmount);
          radiantDmgMult  = heal.dmgMult;
        }

        const isWeak   = user.element === boss.weakness;
        const havocFrenzyActive = bonuses.activeNamedSetId === "VOIDBORN_REMNANT" && voidbornRemnantFrenzyActive(namedState);
        const defShredActive = enemyDefShredTurnsLeft > 0;
        const effectiveDef  = (havocFrenzyActive ? scaled.def * (1 - havocFrenzyDefIgnore) : scaled.def) * (defShredActive ? (1 - enemyDefShredPct) : 1);
        const defVal       = state.isShattered ? 0 : effectiveDef;
        const defReduction = Math.min(0.75, defVal / (defVal + 1500));
        const havocAtkMult  = havocFrenzyActive ? havocFrenzyAtkMult : 1.0;
        const havocLifesteal = havocFrenzyActive ? havocFrenzyLifesteal : 0;
        const vibMult  = get5pcVibDrainMult(bonuses);
        const radCrit       = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
        const stormCritBuff  = stormBuffTurnsLeft > 0 ? stormBuffCritBonus : 0;
        // Milestone 3.5b: whichever unit is currently acting/defending uses
        // ITS OWN resolved stats.
        const isAllyActingOrDefending = !isPlayerActiveNow && allySolaceStats !== null;
        const activeAtk     = isAllyActingOrDefending ? allySolaceStats!.atk     : stats.atk;
        const activeDef     = isAllyActingOrDefending ? allySolaceStats!.def     : stats.def;
        const activeCritDmg = isAllyActingOrDefending ? allySolaceStats!.critDmg : stats.critDmg;
        const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, (isAllyActingOrDefending ? allySolaceStats!.critRate : stats.critRate) + radCrit + stormCritBuff), state.playerHp, state.playerHpMax);
        const forcedCritActive = nextAttackCritArmed && btn.customId !== "battle_flee";

        // ── Player action ─────────────────────────────────────────────────────
        if (btn.customId === "battle_flee") {
          await thread.send({
            embeds: [new EmbedBuilder()
              .setColor(0x334155)
              .setDescription(`◈ You fled the trial. No rewards granted.\nYou may challenge again anytime with **/ascend**.`)
              .setFooter({ text: "CARTETHYIA  ·  Ascension Trial" })],
          });
          collector.stop();
          await cleanup(false);
          return;
        }

        const abilVibM = compositeVibMult(bonuses.abilityEffects);
        const totalVibMult = vibMult * abilVibM;
        const abilCtxBase = {
          currentHp: state.playerHp, maxHp: state.playerHpMax,
          enemyHpPct: state.bossHpNow / state.bossHpMax,
          turn: state.turn, isFirstAction: !firstActionDone,
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
          if (btn.customId === "battle_swap_select" && btn.isStringSelectMenu()) {
            const parsed = Number(btn.values[0]);
            return (parsed === 1 || parsed === 2 || parsed === 3) ? (parsed as PositionIndex) : null;
          }
          if (btn.customId === "battle_swap") {
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

            // Kaelith's intro grants stacks rather than a plain HP/shield bonus —
            // applied here via introEffect's newMechanicState side-channel since
            // AllyAction has no "grant stacks" primitive (deliberately kept out of
            // the shared ally-action vocabulary — stack-granting is Kaelith-only).
            // Gated on the INCOMING side now (introEffect always belongs to
            // whoever is entering) rather than the old fixed-ally identity.
            if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "kaelith") {
              const grant = (introEffect.newMechanicState as any).grantStacksOnIntro as number | undefined;
              if (grant) {
                const cur = (incomingBundle!.mechanicState as KaelithMechanicState).stacks;
                const cap = kaelithStackCap(incomingConstellation);
                incomingBundle!.mechanicState = { ...(incomingBundle!.mechanicState as KaelithMechanicState), stacks: Math.min(cap, cur + grant) };
              }
            }
            if (!outgoingIsPlayer && outroEffect.enemyDebuff) {
              // Non-stacking: refresh duration, never compound (explicit anti-exploit decision).
              enemyDefShredTurnsLeft = outroEffect.enemyDebuff.turns + 1;
              enemyDefShredPct = outroEffect.enemyDebuff.value;
            }
            // Vesper's Outro/Intro both work through her own mechanicState
            // side-channel rather than a generic ally-action or enemy-facing
            // debuff. Her Outro's "free mark for whoever swaps in next" is
            // scoped to HERSELF next time she's active — gated on the
            // OUTGOING side (outroEffect always belongs to whoever's leaving).
            if (!outgoingIsPlayer && outroEffect.newMechanicState && outgoingCharacterId === "vesper") {
              const grantMark = (outroEffect.newMechanicState as any).grantMarkOnOutro === true;
              const charged = (outroEffect.newMechanicState as any).chargedMark === true;
              if (grantMark) {
                outgoingBundle!.mechanicState = { ...(outgoingBundle!.mechanicState as VesperMechanicState), markPresent: true, chargedMark: charged };
              }
            }
            // Vesper's Intro burst grants ENERGY TO THE PLAYER'S OWN GAUGE
            // (a head-start for whenever the player is next active) — gated
            // on the INCOMING side being Vesper, regardless of who's leaving.
            if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "vesper") {
              const energyGrant = (introEffect.newMechanicState as any).grantEnergyOnIntro as number | undefined;
              if (energyGrant) {
                state.playerEnergy = Math.min(100, state.playerEnergy + energyGrant);
              }
            }
            // Rilo's Outro transfers a fraction of her remaining Shield to
            // whoever swaps in, applied as a flat HP-equivalent bonus (same
            // clamp-like-a-heal treatment the outroResult/introResult
            // hpDelta bonuses below already use) — no generic "shield buff"
            // primitive exists yet, so this is the simplest consistent
            // integration. C1's DEF buff on the incoming unit uses a
            // dedicated per-fight counter (riloDefBuffTurnsLeft) since no
            // generic "buff own DEF for N turns" primitive exists either.
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

        if (btn.customId === "battle_basic") {
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
          const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < Math.min(1, activeCritRate + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(namedState) : 1;
          const base   = Math.max(1, Math.floor(activeAtk * teamMult * basicMoveMult * smolderMult * havocAtkMult * (1 - defReduction)));
          const extraElemBonus = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
          let dmg      = Math.floor(base * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonus) * radiantDmgMult);
          dmg          = apply5pcFirstHit(bonuses, dmg, !firstActionDone);
          dmg          = apply5pcFullHpDmg(bonuses, dmg, state.playerHp, state.playerHpMax);
          if (roll4pcDoubleHit(bonuses)) { dmg *= 2; }
          dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "BASIC"));
          if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") {
            dmg = windExplosion.proc
              ? Math.floor(dmg * (1 + windExplosion.bonusMult))
              : Math.floor(dmg * windstridersLegacyOnHit(namedState));
          }
          let thunderboltEnergy = 0;
          if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") {
            const tb = stormcallersOathOnBasic(namedState);
            if (tb.proc) {
              dmg += Math.floor(stats.atk * tb.bonusMult);
              thunderboltEnergy = tb.bonusEnergy;
            }
          }
          const ar_b   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "BASIC" });
          dmg          = ar_b.dmg;
          if (ar_b.newStacks !== undefined) v2Stacks = ar_b.newStacks;
          const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(namedState, state.playerHp, state.playerHpMax);
          playerDmg    = dmg + ignite.dmg;
          moveName     = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
          if (ar_b.tag)   moveName += `  ✦${ar_b.tag}`;
          if (ignite.tag) moveName += `  ✦${ignite.tag}`;
          state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
          state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN_ASCEND + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_b.bonusEnergy + thunderboltEnergy);
          state.playerHp     = Math.min(state.playerHpMax, state.playerHp + ar_b.healHp);
          state.playerHp     = applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_b.lifesteal ?? 0), playerDmg, state.playerHp, state.playerHpMax);
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

        const isSolaceAlly = isDevGuild && activeAllyCharacterId === "solace";

        if (btn.customId === "battle_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "solace") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          attunement.mode = cycleAttunementMode(attunement.mode);
          if (allyConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
          const crit = Math.random() < activeCritRate; abilCrit = crit;
          const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          playerDmg  = dmg;
          moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
        } else if (btn.customId === "battle_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "kaelith" && allyKit) {
          const kState = allyMechanicState as KaelithMechanicState;
          if (kState.stacks <= 0) {
            moveName = `🌑 Umbral Detonation — no stacks to consume! (0 DMG bonus)`;
            playerDmg = 0;
            state.bossVibNow = Math.max(0, state.bossVibNow - 0);
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
          // Kaelith's Skill has its own 3-turn cooldown, unlike Solace's Skill
          // (Attunement), which has none.
          state.skillCooldown = allyKit.skillCooldownTurns;
        } else if (btn.customId === "battle_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "vesper" && allyKit) {
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
        } else if (btn.customId === "battle_skill" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "rilo" && allyKit) {
          const rState = allyMechanicState as RiloMechanicState;
          const crit = true; // Guard Break is always a guaranteed crit, per spec
          abilCrit = crit;
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
            enemyDefShredTurnsLeft = 2 + 1; // +1 compensates for the same-round decrement, matching every other user of this shared field
            enemyDefShredPct = RILO_C2_DEF_SHRED_PCT;
            moveName += `\n❄️ Enemy DEF shredded 10% for 2 turns!`;
          }
          state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * result.vibFrac * totalVibMult));
        } else if (btn.customId === "battle_skill") {
          const teamAtkMult  = isSolaceAlly ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
          const teamCritBonus = isSolaceAlly ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0;
          const wellspringAtkBonus  = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
          const wellspringCritBonus = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus  = isSolaceAlly ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const forteCritBonus = isSolaceAlly ? getSolaceForteCritRateBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const crit   = forcedCritActive || Math.random() < Math.min(1, activeCritRate + 0.1 + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(namedState) : 1;
          const base   = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * 1.8 * (1 - defReduction)));
          const extraElemBonusSkill = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
          let dmg      = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusSkill) * radiantDmgMult);
          dmg          = apply4pcSkillBonus(bonuses, dmg, !firstSkillUsed);
          dmg          = apply5pcFirstHit(bonuses, dmg, !firstActionDone);
          dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
          if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(namedState));
          if (bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN") {
            const sov = smolderingSovereignOnSkill(namedState);
            if (sov.doubleHit) dmg = Math.floor(dmg * sov.bonusMult * 2);
          }
          const ar_s   = applyAbilityAttack(bonuses, dmg, crit, { ...abilCtxBase, moveType: "SKILL" });
          dmg          = ar_s.dmg;
          if (ar_s.newStacks !== undefined) v2Stacks = ar_s.newStacks;
          const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && crit) radiantConvergenceOnCrit(namedState, state.playerHp, state.playerHpMax);
          playerDmg    = dmg + ignite.dmg;
          moveName     = `Resonance Skill — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          if (ar_s.tag)   moveName += `  ✦${ar_s.tag}`;
          if (ignite.tag) moveName += `  ✦${ignite.tag}`;
          state.bossVibNow    = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.6 * totalVibMult));
          state.skillCooldown = effectiveSkillCooldown(bonuses, SKILL_COOLDOWN);
          state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN_ASCEND + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_s.bonusEnergy);
          state.playerHp      = Math.min(state.playerHpMax, state.playerHp + ar_s.healHp);
          state.playerHp      = applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_s.lifesteal ?? 0), playerDmg, state.playerHp, state.playerHpMax);
          firstSkillUsed = true;
        }

        // Set inside Solace's Convergence branch below — Convergence resets
        // concertoEnergy to 0, so the generic per-move gain further down
        // must skip granting anything back on the same turn, or Convergence
        // would silently refund 35-47% of the bar it just spent (a bug
        // caught and fixed in Milestone 3a's port — built in from the start
        // here instead).
        let convergenceUsedThisTurn = false;

        if (btn.customId === "battle_ultimate" && !(isDevGuild && !isPlayerActiveNow)) {
          abilCrit     = true;
          const teamAtkMult = isSolaceAlly ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
          const wellspringAtkBonus = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus = isSolaceAlly ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const smolderMultUlt = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(namedState) : 1;
          const base   = Math.max(1, Math.floor(stats.atk * teamMult * smolderMultUlt * havocAtkMult * 3.5 * stats.critDmg * (1 - defReduction)));
          const extraElemBonusUlt = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
          let dmg      = Math.floor(base * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonusUlt) * radiantDmgMult);
          dmg          = apply4pcUltBonus(bonuses, dmg);
          if (bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY") dmg = Math.floor(dmg * windstridersLegacyOnHit(namedState));
          const ar_u   = applyAbilityAttack(bonuses, dmg, true, { ...abilCtxBase, moveType: "ULT" });
          dmg          = ar_u.dmg;
          if (ar_u.newStacks !== undefined) v2Stacks = ar_u.newStacks;
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && namedState.spectroFractureTurnsLeft > 0) dmg = Math.floor(dmg * 1.10);
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE") radiantConvergenceOnCrit(namedState, state.playerHp, state.playerHpMax);
          playerDmg    = dmg;
          moveName     = `⚡ ULTIMATE — ${playerDmg} DMG`;
          if (ar_u.tag) moveName += `  ✦${ar_u.tag}`;
          state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));
          state.playerEnergy = Math.min(100, ar_u.bonusEnergy);
          state.playerHp     = Math.min(state.playerHpMax, state.playerHp + ar_u.healHp);
          state.playerHp     = applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_u.lifesteal ?? 0), playerDmg, state.playerHp, state.playerHpMax);
          if (bonuses.set5pc?.type === "POST_ULT_SKILL") state.skillCooldown = 0;
          if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") {
            const surge = stormcallersOathOnUltimate();
            stormBuffTurnsLeft = surge.turnsLeft + 1;
            stormBuffCritBonus = surge.critRateBonus;
          }
        } else if (btn.customId === "battle_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "solace") {
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
        } else if (btn.customId === "battle_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "kaelith" && allyKit) {
          const kState = allyMechanicState as KaelithMechanicState;
          const stacksConsumed = kState.stacks;

          // UltimateEffectResult has no damage field (only healResult/moveLabel/
          // newMechanicState/resetsConcertoEnergy) — Kaelith's ultimate damage
          // multiplier is computed inline here, duplicating the 2-line formula
          // kaelithOnUltimate uses internally for its own bookkeeping, exactly
          // how Solace's own Ultimate damage is computed inline above rather
          // than returned from a shared helper.
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
        } else if (btn.customId === "battle_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "vesper" && allyKit) {
          const vState = allyMechanicState as VesperMechanicState;
          const consumedMark = vState.markPresent;
          // UltimateEffectResult has no damage field — Vesper's Overload
          // damage multiplier is duplicated here from vesperOnUltimate's
          // internal formula, exactly like Kaelith's Ultimate above.
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
        } else if (btn.customId === "battle_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "rilo" && allyKit) {
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

          // C4's damage-to-Shield conversion needs the actual damage dealt,
          // computed above — applied on top of onUltimate's own base refund
          // (already folded into result.newMechanicState.shield).
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

        if (btn.customId === "battle_echoskill" && bonuses.echoSkill) {
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
            playerEnergy: state.playerEnergy, turn: state.turn, bossVibMax: boss.vibBar, crit,
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

          const energyGain = ENERGY_PER_TURN_ASCEND + elemDischargeEnergy(bonuses.elementPassive, crit) + result.bonusEnergy;
          state.playerEnergy = result.setEnergyFull ? 100 : Math.min(100, state.playerEnergy + energyGain);
          const scaledEchoHeal = Math.floor(result.healHp * (1 + bonuses.healingBonus));
          state.playerHp = Math.min(state.playerHpMax, state.playerHp + ar_e.healHp + scaledEchoHeal);
          if (scaledEchoHeal > 0) {
            const benchPos = ([1, 2, 3] as PositionIndex[]).find(pos => pos !== activeUnit && allyBundles[pos] && allyBundles[pos]!.hp > 0);
            if (benchPos) {
              const b = allyBundles[benchPos]!;
              b.hp = Math.min(b.hpMax, b.hp + scaledEchoHeal);
            }
          }

          let echoLifesteal = bonuses.lifesteal + havocLifesteal + (ar_e.lifesteal ?? 0);
          if (def.kind === "FLAT_LIFESTEAL") echoLifesteal += def.pct;
          state.playerHp = applyLifesteal(echoLifesteal, playerDmg, state.playerHp, state.playerHpMax);

          if (result.armsNextCrit) nextAttackCritArmed = true;
          if (result.defShredTurns > 0) {
            enemyDefShredTurnsLeft = result.defShredTurns + 1;
            enemyDefShredPct = result.defShredPct;
          }
        }

        // Concerto Energy builds from combat actions, never from swapping.
        const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
          battle_basic: 10, battle_skill: 20, battle_echoskill: 20, battle_ultimate: 35,
        };
        if (isDevGuild && !convergenceUsedThisTurn) {
          let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
          if (concertoGain > 0 && !isPlayerActiveNow && allySolaceStats?.hasWellspring) concertoGain += getWellspringBaseEnergyBonus(allySolaceStats.wellspringRefinement);
          if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
        }

        // V2 turn-start regen
        const v2Regen = abilityV2TurnRegen(bonuses, state.playerHpMax);
        if (v2Regen.healHp > 0) state.playerHp     = Math.min(state.playerHpMax, state.playerHp + v2Regen.healHp);
        if (v2Regen.energy > 0) state.playerEnergy = Math.min(100, state.playerEnergy + v2Regen.energy);

        // SPD quick-strike — once per fight, if invested SPD clears the boss's derived SPD
        // Quick Strike is excluded only for Solace's Convergence (a pure heal,
        // deals 0 playerDmg) — Kaelith's Ultimate is a real damage move and
        // should still be eligible for the bonus.
        const isSolaceConvergence = btn.customId === "battle_ultimate" && isDevGuild && !isPlayerActiveNow && activeAllyCharacterId === "solace";
        if (!quickStrikeUsed && btn.customId !== "battle_flee" && !isSwapAction && !isSolaceConvergence && hasQuickStrike(stats.spd, WORLD_LEVEL_CAPS[boss.worldLevel] ?? 20)) {
          quickStrikeUsed = true;
          const bonusDmg = Math.max(1, Math.floor(stats.atk * (1 - defReduction)));
          playerDmg += bonusDmg;
          moveName  += `\n⚡ **Quick Strike** — your speed caught them off guard! +${bonusDmg} bonus DMG!`;
        }

        if (!isSwapAction) firstActionDone = true;
        state.bossHpNow = Math.max(0, state.bossHpNow - playerDmg);

        // Enrage check — triggers once when boss HP drops to 40%
        if (!isEnraged && state.bossHpNow / state.bossHpMax <= 0.40) {
          isEnraged = true;
          moveName += `\n🔴 **${boss.name} ENRAGES!** Its power surges — attacks grow far more dangerous!`;
        }

        // Shatter check + Void Surge (Havoc)
        if (state.bossVibNow <= 0 && !state.isShattered) {
          state.isShattered = true;
          shatterTurnsLeft  = 1;
          moveName += "\n✦ **SHATTER!** Boss stunned for 1 turn — all attacks critical!";
          const voidHeal = elemVoidSurgeHeal(bonuses.elementPassive, state.playerHpMax);
          if (voidHeal > 0) {
            state.playerHp = Math.min(state.playerHpMax, state.playerHp + voidHeal);
            moveName += `\n✦ **Void Surge** — +${voidHeal} HP restored!`;
          }
          if (bonuses.activeNamedSetId === "VOIDBORN_REMNANT") {
            const remnant  = voidbornRemnantOnShatter();
            const bonusDmg = Math.floor(stats.atk * remnant.bonusMult);
            state.bossHpNow = Math.max(0, state.bossHpNow - bonusDmg);
            const healAmt  = Math.floor(state.playerHpMax * remnant.healPct);
            state.playerHp = Math.min(state.playerHpMax, state.playerHp + healAmt);
            moveName += `\n🌑 **Voidborn Rupture** — +${bonusDmg} bonus DMG, +${healAmt} HP!`;
          }
        }

        state.lastMove = moveName;

        // ── Win check ─────────────────────────────────────────────────────────
        if (state.bossHpNow <= 0) {
          await sendBattleCard(thread as any, { ...state, ...activeCardIdentity(), lastMove: `${moveName} — **BOSS DEFEATED!**` }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());

          const isFirstAscension = user.worldLevel === 0;
          const newWL            = user.worldLevel + 1;
          const newCap           = WORLD_LEVEL_CAPS[newWL] ?? 90;

          // Award loot + raise WL
          await awardUser(interaction.user.id, boss.defeatLoot, "ascend");
          await prisma.user.update({
            where: { id: interaction.user.id },
            data:  { worldLevel: { increment: 1 }, ascensionWins: { increment: 1 }, fractonite: { increment: 60 } },
          });
          await incrementWeaponBond(interaction.user.id).catch(() => null);
          if (isFirstAscension) {
            grantReferralMilestone(interaction.user.id, "ascend", interaction.client).catch(() => {});
          }

          await thread.send({
            embeds: [new EmbedBuilder()
              .setColor(0xFCD34D)
              .setTitle("✦  Ascension Complete")
              .setDescription([
                `You have defeated **${boss.name}**.`,
                ``,
                `◈  World Level **${user.worldLevel}** → **${newWL}**`,
                `◈  Level cap raised to **${newCap}**`,
                isFirstAscension ? `◈  Your resonance signature is being forged…` : "",
                await mailNudge(interaction.user.id),
              ].filter(Boolean).join("\n"))
              .setFooter({ text: "CARTETHYIA  ·  Ascension Trial" })],
          });

          // First ascension — generate unique ability
          if (isFirstAscension) {
            const generatingMsg = await thread.send({
              embeds: [new EmbedBuilder()
                .setColor(ELEMENT_HEX[user.element] ?? 0x6366F1)
                .setDescription("*◈  Reading your resonance profile…  Calibrating playstyle…  Forging ability…*")
                .setFooter({ text: "CARTETHYIA  ·  Unique Ability Generation" })],
            });

            const ability = await generateUniqueAbilityV2(interaction.user.id);

            await generatingMsg.delete().catch(() => {});

            if (ability) {
              const effList = formatV2Effects(ability.v2Effects)
                .replace(/\*\*/g, "").replace(/\*([^*]+)\*/g, "$1")
                .split("\n").filter(Boolean);

              const abilityCardBuf = await generateAbilityCard({
                displayName,
                avatarUrl:   interaction.user.displayAvatarURL({ size: 128, extension: "png" }),
                element:     user.element,
                abilityName: ability.name,
                effects:     effList,
                lore:        ability.lore,
              });

              await thread.send({
                embeds: [new EmbedBuilder()
                  .setColor(ELEMENT_HEX[user.element] ?? 0x6366F1)
                  .setImage("attachment://ability.webp")
                  .setDescription(`**${ability.name}** — *${ability.effect}*`)
                  .setFooter({ text: "CARTETHYIA  ·  This ability is yours alone." })],
                files: [new AttachmentBuilder(abilityCardBuf, { name: "ability.webp" })],
              });
            }
          }

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

        // ── Boss turn (skip if shattered) ─────────────────────────────────────
        if (shatterTurnsLeft > 0) {
          shatterTurnsLeft--;
          if (shatterTurnsLeft === 0) {
            state.isShattered = false;
            // Enraged bosses recover 60% of their vib bar — harder to shatter again
            state.bossVibNow  = isEnraged ? Math.floor(boss.vibBar * 0.60) : boss.vibBar;
            state.lastMove += isEnraged
              ? "\n◇ Boss breaks free — **vib bar only partially recovered** (60%)."
              : "\n◇ Boss recovers from Shatter.";
          } else {
            state.lastMove += `\n◇ Boss stunned (${shatterTurnsLeft} turn left).`;
          }
        } else {
          // Enraged: prefer the highest-damage move, boss ATK is 1.6×
          const enrageMult = isEnraged ? 1.60 : 1.0;
          const move       = isEnraged
            ? boss.moves.reduce((a, b) => a.damage >= b.damage ? a : b)
            : boss.moves[Math.floor(Math.random() * boss.moves.length)];
          const isSolaceAllyForDef = isDevGuild && activeAllyCharacterId === "solace";
          const wellspringDefBonus = isSolaceAllyForDef && allySolaceStats?.hasWellspring ? getWellspringDefBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
          const forteDefBonus = isSolaceAllyForDef ? getSolaceForteDefBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const attunementDefBonus = solaceAttunementDefBonus(allySkillLevel);
          const riloDefBuffMult = riloDefBuffTurnsLeft > 0 ? (1 + riloDefBuffPct) : 1;
          const attunementDefMult = (isSolaceAllyForDef ? getAttunementDefMult(attunement, attunementDefBonus, attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus) * riloDefBuffMult;
          let bossDmg     = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - activeDef * attunementDefMult * 0.4));
          bossDmg         = roll4pcBlock(bonuses, bossDmg);
          const shield    = elemFrostShield(bonuses.elementPassive, bossDmg);
          bossDmg         = shield.dmg;
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
              state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(boss.vibBar * counter.vibDrain));
              state.lastMove  += `\n❄️ **Counter-Frost** — drained ${Math.floor(counter.vibDrain * 100)}% enemy vibration!`;
            }
            const panic = frostveilBastionCheckPanicShield(namedState, state.playerHp, state.playerHpMax);
            if (panic.triggered) {
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + panic.shieldAmount);
              glacioShieldTurnsLeft = panic.turnsLeft + 1;
              glacioShieldElemBonus = panic.elemDmgBonus;
              state.lastMove += `\n❄️ **Frostveil Shield** — +${panic.shieldAmount} HP, +${Math.floor(panic.elemDmgBonus * 100)}% Glacio DMG for ${panic.turnsLeft} turns!`;
            }
          }
          const hpRegen   = get5pcHpRegen(bonuses, state.playerHpMax);
          if (hpRegen > 0 && typeof bonuses.set5pc?.value === "number" && bonuses.set5pc.value < 1) {
            state.playerHp = Math.min(state.playerHpMax, state.playerHp + hpRegen);
          }
          const radRegen  = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
          if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
          state.lastMove += `\n◇ ${boss.name} ${move.effect} — **${bossDmg} DMG**${isEnraged ? " 🔴" : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
          state.playerEnergy = Math.min(100, state.playerEnergy + 15);

          // Milestone 3c-i: exercises the debuff system inside a real fight.
          // 25% chance per enemy attack, only when the player has actually
          // opted into team mechanics via /team (Milestone 3.5a).
          if (hasSolace && Math.random() < 0.25) {
            playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.2, 2);
            state.lastMove += `\n◇ *${boss.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
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
          state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
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
            embeds: [
              new EmbedBuilder()
                .setColor(0x334155)
                .setDescription(`◈ You were defeated by **${boss.name}**.\nYour EXP and items are safe. Use **/ascend** to try again.`)
                .setFooter({ text: "CARTETHYIA  ·  Ascension Trial" }),
            ],
          });
          collector.stop();
          await cleanup(false);
          return;
        }

        // Next turn
        runTurn();
      });

      collector.on("end", async (_: any, reason: string) => {
        if (reason === "time") {
          await thread.send({
            embeds: [new EmbedBuilder()
              .setColor(0x334155)
              .setDescription([
                `◈ **Turn timed out** — you took longer than 30 minutes.`,
                ``,
                `The trial has been suspended. Your progress is lost but your items are safe.`,
                `Use **/ascend** to start a fresh trial anytime.`,
              ].join("\n"))
              .setFooter({ text: "CARTETHYIA  ·  Ascension Trial" })],
          });
          await cleanup(false);
        }
      });
    };

    const cleanup = async (won: boolean) => {
      releaseLock(interaction.user.id);
      await clearFight(interaction.user.id);
      await thread.setArchived(true).catch(() => {});
      setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
    };

    await runTurn();
  },
};

export default command;
