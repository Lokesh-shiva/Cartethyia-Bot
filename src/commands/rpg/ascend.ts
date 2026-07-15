import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, PermissionFlagsBits,
  TextChannel, ThreadChannel,
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
  buttons: ActionRowBuilder<ButtonBuilder>[],
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
  activeUnit: "player" | "ally";
  displayName: string;
  attunement: AttunementState;
  concertoEnergy: number;
}

function buildButtons(
  state: BattleCardState,
  echoSkill?: { name: string; cooldown: number } | null,
  team?: TeamButtonContext | null,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (team?.isDevGuild && team.activeUnit === "ally") {
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

  if (team?.isDevGuild) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("battle_swap")
        .setLabel(team.activeUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${team.displayName}`)
        .setStyle(ButtonStyle.Secondary),
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

    // ── Milestone 3c: team state (dev guild only) ─────────────────────────────
    const isDevGuild = interaction.guildId === process.env.GUILD_ID;
    const solaceProgress = isDevGuild ? await getOrCreateCharacterProgress(interaction.user.id, "solace") : null;
    const solaceBasicLevel    = solaceProgress?.basicLevel    ?? 1;
    const solaceSkillLevel    = solaceProgress?.skillLevel    ?? 1;
    const solaceUltimateLevel = solaceProgress?.ultimateLevel ?? 1;
    const solaceIntroLevel    = solaceProgress?.introLevel    ?? 1;
    const solaceForteLevel    = solaceProgress?.forteLevel    ?? 1;
    let activeUnit: "player" | "ally" = "player";
    let allyHp    = SOLACE.hpMax;
    const allyHpMax = SOLACE.hpMax;
    let concertoEnergy: number = 0;
    let playerDebuffs: DebuffState = [];
    let attunement: AttunementState = { mode: null };
    let attunementDoubleTurnsLeft = 0;
    let solaceForte: ForteState = { phase: 0, charge: 0 };
    let forteEmpoweredTurnsLeft = 0;

    function teamStatusLine(): string {
      if (!isDevGuild) return "";
      const benchedName = activeUnit === "player" ? SOLACE.name : displayName;
      const benchedHp   = activeUnit === "player" ? allyHp : state.playerHp;
      const benchedMax  = activeUnit === "player" ? allyHpMax : state.playerHpMax;
      const debuffLine  = playerDebuffs.length > 0
        ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
        : "";
      return `\n\n🔄 Benched: **${benchedName}** — ${benchedHp}/${benchedMax} HP  ·  ` +
             `Concerto Energy: **${concertoEnergy}/100**${debuffLine}`;
    }

    function teamButtonContext(): TeamButtonContext {
      return { isDevGuild, activeUnit, displayName, attunement, concertoEnergy };
    }

    const runTurn = async () => {
      const buttons = buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext());
      if (battleMsg) {
        // Edit previous message — remove old buttons
        await battleMsg.edit({ components: [] }).catch(() => {});
      }
      battleMsg = await sendBattleCard(thread as any, state, buttons, teamStatusLine());

      const collector = battleMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
        time: 30 * 60 * 1000, // 30 minutes per turn — plenty of time
        max:  1,
      });

      collector.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate();

        let playerDmg = 0;
        let moveName  = "";
        let radiantDmgMult = 1.0;
        if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && btn.customId !== "battle_flee") {
          const heal = radiantConvergenceOnTurnHeal(namedState, state.playerHpMax);
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
        const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, stats.critRate + radCrit + stormCritBuff), state.playerHp, state.playerHpMax);
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

        // Milestone 3c: swap — always consumes the turn, falls through to the
        // shared tail below (Win-check/Boss-turn/decrements/Lose-check/next
        // turn), same as every other action. Ported from boss.ts's Milestone
        // 3b swap handler (itself ported from encounter.ts's Milestone 1/2a).
        if (btn.customId === "battle_swap" && isDevGuild) {
          const outgoingIsPlayer = activeUnit === "player";
          const comboReady = concertoEnergy >= 100;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = outgoingIsPlayer
              ? { hp: allyHp, hpMax: allyHpMax }
              : { hp: state.playerHp, hpMax: state.playerHpMax };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
            const introEffect: IntroOutroEffect = outgoingIsPlayer ? solaceIntroEffect(solaceIntroLevel) : PLAYER_SELF_INTRO;
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            if (!outgoingIsPlayer) nextAttackCritArmed = true;

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;

            let actualGain: number;
            if (outgoingIsPlayer) {
              const before = allyHp;
              allyHp = Math.min(allyHpMax, allyHp + totalBonus);
              actualGain = allyHp - before;
            } else {
              const before = state.playerHp;
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + totalBonus);
              actualGain = state.playerHp - before;
            }

            moveName = actualGain > 0
              ? `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Outro+Intro combo! +${actualGain} HP.`
              : `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Outro+Intro combo! (already at full HP, no heal needed)`;
            concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART in encounter.ts
          } else {
            moveName = `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Concerto Energy not full, no combo triggered.`;
          }

          activeUnit = outgoingIsPlayer ? "ally" : "player";
          playerDmg = 0;
        }

        if (btn.customId === "battle_basic") {
          const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          const teamAtkMult  = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
          const teamCritBonus = isDevGuild ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 0;
          const wellspringAtkMult   = isDevGuild && activeUnit === "ally" ? WELLSPRING_BASE_ATK_MULT : 1;
          const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
          const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
          const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const basicMoveMult = isDevGuild && activeUnit === "ally" ? solaceBasicDamageMult(solaceBasicLevel) : 1.0;
          const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < Math.min(1, activeCritRate + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
          const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
            ? smolderingSovereignOnAction(namedState) : 1;
          const base   = Math.max(1, Math.floor(stats.atk * teamMult * basicMoveMult * smolderMult * havocAtkMult * (1 - defReduction)));
          const extraElemBonus = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
          let dmg      = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonus) * radiantDmgMult);
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
        }

        if (btn.customId === "battle_skill" && isDevGuild && activeUnit === "ally") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          attunement.mode = cycleAttunementMode(attunement.mode);
          const crit = Math.random() < activeCritRate; abilCrit = crit;
          const dmg  = Math.max(1, Math.floor(stats.atk * 0.6 * (1 - defReduction) * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
          playerDmg  = dmg;
          moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
          state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
        } else if (btn.customId === "battle_skill") {
          const teamAtkMult  = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
          const teamCritBonus = isDevGuild ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 0;
          const wellspringAtkBonus  = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
          const wellspringCritBonus = isDevGuild ? getWellspringCritRateBonus(attunement) : 0;
          const forteAtkBonus  = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const forteCritBonus = isDevGuild ? getSolaceForteCritRateBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
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

        if (btn.customId === "battle_ultimate" && !(isDevGuild && activeUnit === "ally")) {
          abilCrit     = true;
          const teamAtkMult = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
          const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
          const forteAtkBonus = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
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
          state.playerHp     = Math.min(state.playerHpMax, state.playerHp + ar_e.healHp + result.healHp);

          let echoLifesteal = bonuses.lifesteal + havocLifesteal + (ar_e.lifesteal ?? 0);
          if (def.kind === "FLAT_LIFESTEAL") echoLifesteal += def.pct;
          state.playerHp = applyLifesteal(echoLifesteal, playerDmg, state.playerHp, state.playerHpMax);

          if (result.armsNextCrit) nextAttackCritArmed = true;
          if (result.defShredTurns > 0) {
            enemyDefShredTurnsLeft = result.defShredTurns + 1;
            enemyDefShredPct = result.defShredPct;
          }
        }

        // V2 turn-start regen
        const v2Regen = abilityV2TurnRegen(bonuses, state.playerHpMax);
        if (v2Regen.healHp > 0) state.playerHp     = Math.min(state.playerHpMax, state.playerHp + v2Regen.healHp);
        if (v2Regen.energy > 0) state.playerEnergy = Math.min(100, state.playerEnergy + v2Regen.energy);

        // SPD quick-strike — once per fight, if invested SPD clears the boss's derived SPD
        if (!quickStrikeUsed && btn.customId !== "battle_flee" && btn.customId !== "battle_swap" && hasQuickStrike(stats.spd, WORLD_LEVEL_CAPS[boss.worldLevel] ?? 20)) {
          quickStrikeUsed = true;
          const bonusDmg = Math.max(1, Math.floor(stats.atk * (1 - defReduction)));
          playerDmg += bonusDmg;
          moveName  += `\n⚡ **Quick Strike** — your speed caught them off guard! +${bonusDmg} bonus DMG!`;
        }

        if (btn.customId !== "battle_swap") firstActionDone = true;
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
          await sendBattleCard(thread as any, { ...state, lastMove: `${moveName} — **BOSS DEFEATED!**` }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());

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
          const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
          const forteDefBonus = isDevGuild ? getSolaceForteDefBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
          const attunementDefBonus = solaceAttunementDefBonus(solaceSkillLevel);
          const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDefBonus, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus);
          let bossDmg     = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - stats.def * attunementDefMult * 0.4));
          bossDmg         = roll4pcBlock(bonuses, bossDmg);
          const shield    = elemFrostShield(bonuses.elementPassive, bossDmg);
          bossDmg         = shield.dmg;
          state.playerHp  = Math.max(0, state.playerHp - bossDmg);
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
            const burst = radiantConvergenceCheckBurstHeal(namedState, state.playerHp, state.playerHpMax);
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
          // 25% chance per enemy attack, only when dev-guild team mechanics
          // are active.
          if (isDevGuild && Math.random() < 0.25) {
            playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.2, 2);
            state.lastMove += `\n◇ *${boss.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
          }
        }

        state.turn++;
        if (state.skillCooldown > 0) state.skillCooldown--;
        if (glacioShieldTurnsLeft > 0) glacioShieldTurnsLeft--;
        if (stormBuffTurnsLeft > 0) stormBuffTurnsLeft--;
        if (namedState.spectroFractureTurnsLeft > 0) namedState.spectroFractureTurnsLeft--;
        if (echoSkillCooldown > 0) echoSkillCooldown--;
        if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
        if (forcedCritActive && btn.customId !== "battle_swap") nextAttackCritArmed = false;

        // ── Second Wind — survive a lethal blow once ──────────────────────────
        if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
          secondWindUsed = true;
          state.playerHp = 1;
          state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
        }

        // ── Lose check ────────────────────────────────────────────────────────
        if (state.playerHp <= 0) {
          state.playerHp = 0;
          await sendBattleCard(thread as any, { ...state, lastMove: state.lastMove + " — **YOU FELL.**" }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());
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
