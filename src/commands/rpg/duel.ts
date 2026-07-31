import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ThreadChannel,
  ChannelType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { calcPlayerDamage, calcEnemyDamage, hpBar, energyBar, COUNTER_ELEMENT } from "../../lib/combat";
import { awardUser, isDispatchBlocked, replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import {
  resolvePlayerBonuses, applyBonuses, applyAbilityAttack,
  abilityCritRate, applyLifesteal, PlayerBonuses,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemRadianceRegen, elemRadianceCrit,
  effectiveSkillCooldown, AbilityAttackResult, ResolvedStats,
} from "../../lib/setBonus";
import { compositeHasSecondWind, abilityLabel } from "../../lib/abilityEffects";
import {
  initNamedSetState, NamedSetState,
  smolderingSovereignOnAction, smolderingSovereignOnDamageTaken, smolderingSovereignOnSkill,
  frostveilBastionOnHitTaken, frostveilBastionCheckPanicShield,
  stormcallersOathOnUltimate, stormcallersOathCheckThunderbolt, stormcallersOathOnBasic,
  windstridersLegacyOnHit, windstridersLegacyOnBigHitTaken, windstridersLegacyCheckExplosion,
  voidbornRemnantCheckFrenzy, voidbornRemnantFrenzyActive,
  radiantConvergenceOnTurnHeal, radiantConvergenceOnHitTaken, radiantConvergenceOnCrit, radiantConvergenceCheckBurstHeal,
} from "../../lib/namedSets";
import { echoSkillBaseMult, applyEchoSkill } from "../../lib/echoSkills";
import { incrementWeaponBond } from "../../lib/weaponAwakening";
import { generateVersusCard, Fighter } from "../../lib/versusCard";
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
import { AttachmentBuilder } from "discord.js";
import { CHARACTER_KITS, PlayableCharacterKit } from "../../lib/characterKit";
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

// ── In-memory active duels ────────────────────────────────────────────────────
// activeDuels replaced by shared combatLock

interface DuelState {
  challengerId:   string;
  challengedId:   string;
  challengerName: string;
  challengedName: string;
  // Challenger stats
  cHp:     number; cHpMax: number; cEnergy: number; cSkillCd: number;
  cAtk:    number; cDef:   number; cSpd: number; cCritRate: number; cCritDmg: number; cElement: string;
  cElemDmg: number; cLifesteal: number; cBonuses: PlayerBonuses;
  cFirstAction: boolean; cSecondWindUsed: boolean; cV2Stacks: number;
  cNamedState: NamedSetState;
  cGlacioShieldTurnsLeft: number; cGlacioShieldElemBonus: number;
  cRiloDefBuffTurnsLeft: number; cRiloDefBuffPct: number;
  cStormBuffTurnsLeft: number; cStormBuffCritBonus: number;
  cHavocFrenzyAtkMult: number; cHavocFrenzyLifesteal: number; cHavocFrenzyDefIgnore: number;
  cEchoSkillCd: number; cDefShredTurnsLeft: number; cDefShredPct: number; cNextCritArmed: boolean;
  // Milestone 3e: challenger team state (dev guild only)
  cHasSolace: boolean;
  cAllySolaceStats: (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null; // each side's own resolved stats
  cSolaceBasicLevel: number; cSolaceSkillLevel: number; cSolaceUltimateLevel: number;
  cSolaceIntroLevel: number; cSolaceForteLevel: number; cSolaceConstellation: number;
  cActiveUnit: "player" | "ally"; cAllyHp: number; cAllyHpMax: number;
  cConcertoEnergy: number; cPlayerDebuffs: DebuffState;
  cAttunement: AttunementState; cAttunementDoubleTurnsLeft: number;
  cSolaceForte: ForteState; cForteEmpoweredTurnsLeft: number;
  cActiveAllyCharacterId: string | null; cAllyKit: PlayableCharacterKit | null; cAllyMechanicState: unknown;
  // Challenged stats
  dHp:     number; dHpMax: number; dEnergy:  number; dSkillCd: number;
  dAtk:    number; dDef:   number; dSpd: number; dCritRate: number; dCritDmg: number; dElement: string;
  dElemDmg: number; dLifesteal: number; dBonuses: PlayerBonuses;
  dFirstAction: boolean; dSecondWindUsed: boolean; dV2Stacks: number;
  dNamedState: NamedSetState;
  dGlacioShieldTurnsLeft: number; dGlacioShieldElemBonus: number;
  dRiloDefBuffTurnsLeft: number; dRiloDefBuffPct: number;
  dStormBuffTurnsLeft: number; dStormBuffCritBonus: number;
  dHavocFrenzyAtkMult: number; dHavocFrenzyLifesteal: number; dHavocFrenzyDefIgnore: number;
  dEchoSkillCd: number; dDefShredTurnsLeft: number; dDefShredPct: number; dNextCritArmed: boolean;
  // Milestone 3e: challenged team state (dev guild only)
  dHasSolace: boolean;
  dAllySolaceStats: (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null; // each side's own resolved stats
  dSolaceBasicLevel: number; dSolaceSkillLevel: number; dSolaceUltimateLevel: number;
  dSolaceIntroLevel: number; dSolaceForteLevel: number; dSolaceConstellation: number;
  dActiveUnit: "player" | "ally"; dAllyHp: number; dAllyHpMax: number;
  dConcertoEnergy: number; dPlayerDebuffs: DebuffState;
  dAttunement: AttunementState; dAttunementDoubleTurnsLeft: number;
  dSolaceForte: ForteState; dForteEmpoweredTurnsLeft: number;
  dActiveAllyCharacterId: string | null; dAllyKit: PlayableCharacterKit | null; dAllyMechanicState: unknown;
  // Turn tracking
  currentTurn: string; // userId
  turn:        number;
}

const ENERGY_PER_TURN = 20;
const SKILL_CD        = 3;
const WIN_CREDITS     = 300;
const WIN_EXP         = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────
// Element-themed colour for the active turn
const ELEMENT_DUEL_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x4FC3F7, ELECTRO: 0xB39DDB,
  AERO: 0x80CBC4, HAVOC: 0x9C27B0, SPECTRO: 0xFFD54F, NONE: 0x6366F1,
};

function duelEmbed(state: DuelState, lastMove: string, _color: number): EmbedBuilder {
  const turnName  = state.currentTurn === state.challengerId ? state.challengerName : state.challengedName;
  const turnElem  = state.currentTurn === state.challengerId ? state.cElement : state.dElement;
  const themeColor = ELEMENT_DUEL_HEX[turnElem] ?? 0x6366F1;

  const cTurn = state.currentTurn === state.challengerId ? "▸ " : "";
  const dTurn = state.currentTurn === state.challengedId ? "▸ " : "";

  return new EmbedBuilder()
    .setColor(themeColor)
    .setTitle(`⚔️  Duel  ·  Turn ${state.turn}`)
    .addFields(
      {
        name:   `${cTurn}${elementEmoji(state.cElement)}  ${state.challengerName}`,
        value:  `${hpBar(state.cHp, state.cHpMax)}\n` +
                `\`HP ${state.cHp}/${state.cHpMax}\`\n` +
                `⚡ ${energyBar(state.cEnergy)} ${state.cEnergy}${state.cSkillCd > 0 ? `   ✦cd ${state.cSkillCd}` : ""}`,
        inline: true,
      },
      {
        name:   `${dTurn}${elementEmoji(state.dElement)}  ${state.challengedName}`,
        value:  `${hpBar(state.dHp, state.dHpMax)}\n` +
                `\`HP ${state.dHp}/${state.dHpMax}\`\n` +
                `⚡ ${energyBar(state.dEnergy)} ${state.dEnergy}${state.dSkillCd > 0 ? `   ✦cd ${state.dSkillCd}` : ""}`,
        inline: true,
      },
      {
        name:   "◈  Combat Log",
        value:  lastMove || "*The duel begins.*",
        inline: false,
      },
    )
    .setDescription(duelTeamStatusLine(state))
    .setFooter({ text: `CARTETHYIA  ·  ${turnName}'s turn  ·  10 min to act` });
}

function duelTeamStatusLine(state: DuelState): string | null {
  const lines: string[] = [];
  if (state.cHasSolace) lines.push(duelSideStatusLine(state.challengerName, state.cActiveUnit, state.cAllyHp, state.cAllyHpMax, state.cConcertoEnergy, state.cPlayerDebuffs, state.cAllyKit, state.cAllyMechanicState));
  if (state.dHasSolace) lines.push(duelSideStatusLine(state.challengedName, state.dActiveUnit, state.dAllyHp, state.dAllyHpMax, state.dConcertoEnergy, state.dPlayerDebuffs, state.dAllyKit, state.dAllyMechanicState));
  return lines.length > 0 ? lines.join("\n") : null;
}

function duelSideStatusLine(
  name: string, activeUnit: "player" | "ally", allyHp: number, allyHpMax: number,
  concertoEnergy: number, debuffs: DebuffState, allyKit: PlayableCharacterKit | null, allyMechanicState: unknown,
): string {
  const debuffLine = debuffs.length > 0 ? `  ·  ${debuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}` : "";
  const soloLine = activeUnit === "ally" && allyKit ? `  ·  ${allyKit.label} ${allyHp}/${allyHpMax} HP` : "";
  const kitLine = allyKit ? `  ·  ${allyKit.statusLineText(allyMechanicState)}` : "";
  return `🔄 **${name}**: Concerto Energy **${concertoEnergy}/100**${soloLine}${kitLine}${debuffLine}`;
}

function buildDuelButtons(state: DuelState, forUserId: string, isDevGuild: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const isChallenger  = forUserId === state.challengerId;
  const myEnergy       = isChallenger ? state.cEnergy  : state.dEnergy;
  const mySkillCd       = isChallenger ? state.cSkillCd : state.dSkillCd;
  const myBonus         = isChallenger ? state.cBonuses : state.dBonuses;
  const myEchoCd         = isChallenger ? state.cEchoSkillCd : state.dEchoSkillCd;
  const myHasSolace       = isChallenger ? state.cHasSolace : state.dHasSolace;
  const myActiveUnit       = isChallenger ? state.cActiveUnit : state.dActiveUnit;
  const myConcertoEnergy    = isChallenger ? state.cConcertoEnergy : state.dConcertoEnergy;
  const myAttunement          = isChallenger ? state.cAttunement : state.dAttunement;
  const myName                 = isChallenger ? state.challengerName : state.challengedName;
  const myAllyHp                = isChallenger ? state.cAllyHp : state.dAllyHp;
  const myActiveAllyCharacterId = isChallenger ? state.cActiveAllyCharacterId : state.dActiveAllyCharacterId;
  const myAllyKit               = isChallenger ? state.cAllyKit : state.dAllyKit;

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (isDevGuild && myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "kaelith") {
    const skillReady = mySkillCd === 0;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("duel_skill")
        .setLabel(skillReady ? "🌑  Umbral Detonation" : `🌑  Detonation (${mySkillCd}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder().setCustomId("duel_ultimate").setLabel("🌑  Umbral Cataclysm")
        .setStyle(ButtonStyle.Success).setDisabled(myConcertoEnergy < 100),
      new ButtonBuilder().setCustomId("duel_forfeit").setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
    ));
  } else if (isDevGuild && myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "vesper") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("duel_skill").setLabel("⚡  Discharge").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("duel_ultimate").setLabel("⚡  Overload")
        .setStyle(ButtonStyle.Success).setDisabled(myEnergy < 100),
      new ButtonBuilder().setCustomId("duel_forfeit").setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
    ));
  } else if (isDevGuild && myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "rilo") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("duel_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("duel_ultimate").setLabel("🛡️  Avalanche Slam")
        .setStyle(ButtonStyle.Success).setDisabled(myConcertoEnergy < 100),
      new ButtonBuilder().setCustomId("duel_forfeit").setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
    ));
  } else if (isDevGuild && myHasSolace && myActiveUnit === "ally") {
    const modeLabel = myAttunement.mode ? `(${myAttunement.mode})` : "(inactive)";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("duel_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("duel_ultimate").setLabel("⚡  Convergence")
        .setStyle(ButtonStyle.Success).setDisabled(myConcertoEnergy < 100),
      new ButtonBuilder().setCustomId("duel_forfeit").setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("duel_skill")
        .setLabel(mySkillCd === 0 ? "✦  Skill" : `✦  Skill (${mySkillCd}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(mySkillCd > 0),
      new ButtonBuilder().setCustomId("duel_ultimate")
        .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(myEnergy < 100),
    );
    if (myBonus.echoSkill) {
      const echoReady = myEchoCd === 0;
      row.addComponents(
        new ButtonBuilder().setCustomId("duel_echoskill")
          .setLabel(echoReady ? `🌀  ${myBonus.echoSkill.name}` : `🌀  ${myBonus.echoSkill.name} (${myEchoCd}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId("duel_forfeit").setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
    );
    rows.push(row);
  }

  if (isDevGuild && myHasSolace) {
    const swapDisabled = myActiveUnit === "player" && myAllyHp <= 0;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("duel_swap")
        .setLabel(myActiveUnit === "player" ? `🔄  Swap to ${myAllyKit?.label ?? "Ally"}` : `🔄  Swap to ${myName}`)
        .setStyle(ButtonStyle.Secondary).setDisabled(swapDisabled),
    ));
  }

  return rows;
}

function elementEmoji(el: string): string {
  const m: Record<string, string> = {
    FUSION:"🔥", GLACIO:"❄️", ELECTRO:"⚡", AERO:"🌪️", HAVOC:"🌑", SPECTRO:"✨", NONE:"◇"
  };
  return m[el] ?? "◇";
}

// ── Command ───────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("duel")
  .setDescription("Challenge another player to a turn-based 1v1 duel.")
  .addUserOption(o =>
    o.setName("target").setDescription("Who to challenge").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("visibility")
      .setDescription("Who can see the duel (default: private)")
      .addChoices(
        { name: "🔒 Private — only you two",       value: "private" },
        { name: "👁️ Public — anyone can spectate", value: "public"  },
      )
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target    = interaction.options.getUser("target", true);
  const isPublic  = (interaction.options.getString("visibility") ?? "private") === "public";

  if (target.id === interaction.user.id) {
    await interaction.editReply({ content: "You can't duel yourself." }); return;
  }
  if (target.bot) {
    await interaction.editReply({ content: "Bots don't duel." }); return;
  }
  if (!acquireLock(interaction.user.id, "Duel")) {
    await interaction.editReply({ content: alreadyInCombatMsg(interaction.user.id) }); return;
  }
  if (!acquireLock(target.id, "Duel")) {
    releaseLock(interaction.user.id);
    await interaction.editReply({ content: `◈ **${target.displayName}** is already in combat and can't duel right now.` }); return;
  }
  const [challengerDb, challengedDb] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true, critRate: true, critDmg: true, element: true, level: true, dispatchStatus: true, dispatchEndsAt: true, teamAllyCharacterId: true },
    }),
    prisma.user.findUnique({
      where:  { id: target.id },
      select: { baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true, critRate: true, critDmg: true, element: true, level: true, teamAllyCharacterId: true },
    }),
  ]);

  if (!challengerDb) { await replyNotStarted(interaction); return; }
  if (!challengedDb) { await interaction.editReply({ content: `${target.displayName} hasn't started yet.` }); return; }
  if (isDispatchBlocked(challengerDb)) {
    await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before duelling." });
    return;
  }

  // Resolve full combat stats (echoes + weapon + set bonuses + unique ability) for both
  const [cBonuses, dBonuses] = await Promise.all([
    resolvePlayerBonuses(interaction.user.id),
    resolvePlayerBonuses(target.id),
  ]);
  const cStats = applyBonuses(challengerDb, cBonuses);
  const dStats = applyBonuses(challengedDb, dBonuses);

  const cName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.displayName;
  const dName = interaction.guild?.members.cache.get(target.id)?.displayName ?? target.displayName;
  const cAvatar = interaction.user.displayAvatarURL({ size: 256, extension: "png" });
  const dAvatar = target.displayAvatarURL({ size: 256, extension: "png" });

  // ── Challenge embed ───────────────────────────────────────────────────────
  const acceptRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("duel_accept").setLabel("⚔️  Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("duel_decline").setLabel("✖  Decline").setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({
    content: `<@${target.id}>`,
    embeds: [new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("⚔️  Duel Challenge")
      .setDescription(
        `**${cName}** challenges **${dName}** to a duel!\n\n` +
        `${elementEmoji(challengerDb.element)} ${cName}  ·  Lv ${challengerDb.level}  ·  ${cStats.hp.toLocaleString()} HP  ·  ${cStats.atk} ATK\n` +
        `${elementEmoji(challengedDb.element)} ${dName}  ·  Lv ${challengedDb.level}  ·  ${dStats.hp.toLocaleString()} HP  ·  ${dStats.atk} ATK\n\n` +
        `Winner gets **${WIN_CREDITS} Credits** + **${WIN_EXP} EXP**.\n` +
        `${isPublic ? "👁️ **Public duel** — anyone can spectate in the thread." : "🔒 **Private duel** — only participants can see the thread."}\n\n` +
        `*${dName} has 60 seconds to accept.*`
      )
      .setFooter({ text: "CARTETHYIA  ·  Duel" })],
    components: [acceptRow],
  });

  const challengeMsg = await interaction.fetchReply();

  const challengeCollector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: b => b.user.id === target.id && (b.customId === "duel_accept" || b.customId === "duel_decline"),
    time:   60_000,
    max:    1,
  });

  challengeCollector?.on("collect", async (btn: ButtonInteraction) => {
    if (btn.customId === "duel_decline") {
      releaseLock(interaction.user.id);
      releaseLock(target.id);
      await btn.update({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription(`**${dName}** declined the duel.`)
          .setFooter({ text: "CARTETHYIA  ·  Duel" })],
        components: [],
      });
      return;
    }

    // Accept — start duel
    await btn.deferUpdate();
    await interaction.editReply({ components: [] });

    // locks already held for both players

    // Requires each side to have actually picked Solace via /team.
    // NOTE: `isDevGuild` is a legacy name kept to avoid touching the many
    // downstream usages below (myAttunement/oppAttunement math etc.) — it no
    // longer means "in the dev guild", it means "either side has an active
    // Solace ally this match". Per-side gating (cHasSolace/dHasSolace,
    // myHasSolace/oppHasSolace) already governs whose bonuses actually
    // apply; this blanket flag was hard-gated to the dev guild only during
    // development, which is exactly the bug that blocked Solace everywhere
    // after launch.
    // CRITICAL: real read-only ownership lookup, NOT getOrCreateCharacterProgress
    // — that helper CREATES a row if missing, which would silently re-grant
    // Solace ownership to anyone whose teamAllyCharacterId flag is "solace"
    // but doesn't actually own her, bypassing the gacha entirely.
    const cActiveAllyCharacterId: string | null =
      challengerDb.teamAllyCharacterId && CHARACTER_KITS[challengerDb.teamAllyCharacterId] ? challengerDb.teamAllyCharacterId : null;
    const dActiveAllyCharacterId: string | null =
      challengedDb.teamAllyCharacterId && CHARACTER_KITS[challengedDb.teamAllyCharacterId] ? challengedDb.teamAllyCharacterId : null;
    const [cSolaceProgress, dSolaceProgress] = await Promise.all([
      cActiveAllyCharacterId
        ? prisma.characterProgress.findUnique({ where: { userId_characterId: { userId: interaction.user.id, characterId: cActiveAllyCharacterId } } })
        : Promise.resolve(null),
      dActiveAllyCharacterId
        ? prisma.characterProgress.findUnique({ where: { userId_characterId: { userId: target.id, characterId: dActiveAllyCharacterId } } })
        : Promise.resolve(null),
    ]);
    const cHasSolaceGate = cSolaceProgress !== null;
    const dHasSolaceGate = dSolaceProgress !== null;
    const isDevGuild = cHasSolaceGate || dHasSolaceGate;
    const cAllyKit: PlayableCharacterKit | null = cActiveAllyCharacterId ? CHARACTER_KITS[cActiveAllyCharacterId] : null;
    const dAllyKit: PlayableCharacterKit | null = dActiveAllyCharacterId ? CHARACTER_KITS[dActiveAllyCharacterId] : null;
    // Each side's own resolved stats (own base + OWN echoes/weapon).
    const [cAllySolaceStatsRaw, dAllySolaceStatsRaw] = await Promise.all([
      cHasSolaceGate && cAllyKit ? cAllyKit.resolveStats(interaction.user.id) : Promise.resolve(null),
      dHasSolaceGate && dAllyKit ? dAllyKit.resolveStats(target.id) : Promise.resolve(null),
    ]);
    const cAllySolaceStats = cAllySolaceStatsRaw as (typeof cAllySolaceStatsRaw & { hasWellspring?: boolean; wellspringRefinement?: number });
    const dAllySolaceStats = dAllySolaceStatsRaw as (typeof dAllySolaceStatsRaw & { hasWellspring?: boolean; wellspringRefinement?: number });

    const state: DuelState = {
      challengerId: interaction.user.id, challengedId: target.id,
      challengerName: cName, challengedName: dName,
      cHp: cStats.hp, cHpMax: cStats.hp, cEnergy: 0, cSkillCd: 0,
      cAtk: cStats.atk, cDef: cStats.def, cSpd: cStats.spd,
      cCritRate: cStats.critRate, cCritDmg: cStats.critDmg,
      cElement: challengerDb.element,
      cElemDmg: cStats.elemDmgBonus, cLifesteal: cStats.lifesteal, cBonuses,
      cFirstAction: true, cSecondWindUsed: false, cV2Stacks: 0,
      cNamedState: initNamedSetState(),
      cGlacioShieldTurnsLeft: 0, cGlacioShieldElemBonus: 0,
      cRiloDefBuffTurnsLeft: 0, cRiloDefBuffPct: 0,
      cStormBuffTurnsLeft: 0, cStormBuffCritBonus: 0,
      cHavocFrenzyAtkMult: 1.0, cHavocFrenzyLifesteal: 0, cHavocFrenzyDefIgnore: 0,
      cEchoSkillCd: 0, cDefShredTurnsLeft: 0, cDefShredPct: 0, cNextCritArmed: false,
      cHasSolace: cHasSolaceGate,
      cAllySolaceStats,
      cSolaceBasicLevel: cSolaceProgress?.basicLevel ?? 1, cSolaceSkillLevel: cSolaceProgress?.skillLevel ?? 1,
      cSolaceUltimateLevel: cSolaceProgress?.ultimateLevel ?? 1, cSolaceIntroLevel: cSolaceProgress?.introLevel ?? 1,
      cSolaceForteLevel: cSolaceProgress?.forteLevel ?? 1,
      cSolaceConstellation: cSolaceProgress?.constellation ?? 0,
      cActiveUnit: "player", cAllyHp: cAllyKit ? cAllyKit.statsAtLevel(90).hpMax : 0, cAllyHpMax: cAllyKit ? cAllyKit.statsAtLevel(90).hpMax : 0,
      cConcertoEnergy: 0, cPlayerDebuffs: [],
      cAttunement: { mode: null }, cAttunementDoubleTurnsLeft: 0,
      cSolaceForte: { phase: 0, charge: 0 }, cForteEmpoweredTurnsLeft: 0,
      cActiveAllyCharacterId, cAllyKit, cAllyMechanicState: cAllyKit ? cAllyKit.createInitialMechanicState() : null,
      dHp: dStats.hp, dHpMax: dStats.hp, dEnergy: 0, dSkillCd: 0,
      dAtk: dStats.atk, dDef: dStats.def, dSpd: dStats.spd,
      dCritRate: dStats.critRate, dCritDmg: dStats.critDmg,
      dElement: challengedDb.element,
      dElemDmg: dStats.elemDmgBonus, dLifesteal: dStats.lifesteal, dBonuses,
      dFirstAction: true, dSecondWindUsed: false, dV2Stacks: 0,
      dNamedState: initNamedSetState(),
      dGlacioShieldTurnsLeft: 0, dGlacioShieldElemBonus: 0,
      dRiloDefBuffTurnsLeft: 0, dRiloDefBuffPct: 0,
      dStormBuffTurnsLeft: 0, dStormBuffCritBonus: 0,
      dHavocFrenzyAtkMult: 1.0, dHavocFrenzyLifesteal: 0, dHavocFrenzyDefIgnore: 0,
      dEchoSkillCd: 0, dDefShredTurnsLeft: 0, dDefShredPct: 0, dNextCritArmed: false,
      dHasSolace: dHasSolaceGate,
      dAllySolaceStats,
      dSolaceBasicLevel: dSolaceProgress?.basicLevel ?? 1, dSolaceSkillLevel: dSolaceProgress?.skillLevel ?? 1,
      dSolaceUltimateLevel: dSolaceProgress?.ultimateLevel ?? 1, dSolaceIntroLevel: dSolaceProgress?.introLevel ?? 1,
      dSolaceForteLevel: dSolaceProgress?.forteLevel ?? 1,
      dSolaceConstellation: dSolaceProgress?.constellation ?? 0,
      dActiveUnit: "player", dAllyHp: dAllyKit ? dAllyKit.statsAtLevel(90).hpMax : 0, dAllyHpMax: dAllyKit ? dAllyKit.statsAtLevel(90).hpMax : 0,
      dConcertoEnergy: 0, dPlayerDebuffs: [],
      dAttunement: { mode: null }, dAttunementDoubleTurnsLeft: 0,
      dSolaceForte: { phase: 0, charge: 0 }, dForteEmpoweredTurnsLeft: 0,
      dActiveAllyCharacterId, dAllyKit, dAllyMechanicState: dAllyKit ? dAllyKit.createInitialMechanicState() : null,
      // Higher SPD acts first; ties keep the challenger-first default
      currentTurn: dStats.spd > cStats.spd ? target.id : interaction.user.id,
      turn: 1,
    };

    // Create thread (public or private based on user choice)
    let thread;
    try {
      thread = await (interaction.channel as TextChannel).threads.create({
        name:                `⚔️ ${cName} vs ${dName}`,
        autoArchiveDuration: 60,
        type:                isPublic ? ChannelType.PublicThread : ChannelType.PrivateThread,
      });
      await thread.members.add(interaction.user.id);
      await thread.members.add(target.id);
      await registerFight(interaction.user.id, thread.id, interaction.guildId!, "Duel");
      await registerFight(target.id, thread.id, interaction.guildId!, "Duel");
    } catch {
      releaseLock(interaction.user.id);
      releaseLock(target.id);
      await interaction.editReply({ content: "I need **Create Threads** + **Send Messages in Threads** permissions here to run the duel. Ask an admin, or try another channel.", embeds: [], components: [] }).catch(() => {});
      return;
    }

    await interaction.editReply({
      content: `${isPublic ? "👁️" : "🔒"} Duel started! <#${thread.id}>${isPublic ? "  ·  *Anyone can spectate.*" : ""}`,
    });

    const color = 0x6366F1;

    // Hybrid visual: intro versus card
    const introCard = await generateVersusCard(
      { name: cName, avatarUrl: cAvatar, element: challengerDb.element, level: challengerDb.level, hp: cStats.hp, atk: cStats.atk },
      { name: dName, avatarUrl: dAvatar, element: challengedDb.element, level: challengedDb.level, hp: dStats.hp, atk: dStats.atk },
      { subtitle: "The duel begins — challenger strikes first" },
    );
    await thread.send({
      content: `<@${interaction.user.id}> <@${target.id}>`,
      files: [new AttachmentBuilder(introCard, { name: "duel-intro.webp" })],
    });

    let battleMsg = await thread.send({
      embeds:  [duelEmbed(state, "*The duel begins.*", color)],
      components: buildDuelButtons(state, state.currentTurn, isDevGuild),
    });

    const cleanup = async (
      won: boolean, winnerId: string | null,
      outcomeDesc: string,
    ) => {
      releaseLock(interaction.user.id);
      releaseLock(target.id);
      await clearFight(interaction.user.id);
      await clearFight(target.id);
      if (won && winnerId) {
        const loserId = winnerId === interaction.user.id ? target.id : interaction.user.id;
        await awardUser(winnerId, { credits: WIN_CREDITS, resonanceExp: WIN_EXP }, "duel");
        await prisma.user.update({ where: { id: winnerId }, data: { duelWins:   { increment: 1 } } }).catch(() => {});
        await prisma.user.update({ where: { id: loserId },  data: { duelLosses: { increment: 1 } } }).catch(() => {});
        await incrementWeaponBond(winnerId).catch(() => null);
      }
      // Post outcome back to the original channel
      await interaction.editReply({
        content: "",
        embeds: [new EmbedBuilder()
          .setColor(won ? 0x4CAF50 : 0x4A4A5A)
          .setTitle("⚔️  Duel Concluded")
          .setDescription(outcomeDesc)
          .addFields(
            { name: elementEmoji(state.cElement) + "  " + cName, value: `\`HP\` **${state.cHp}** / ${state.cHpMax}`, inline: true },
            { name: elementEmoji(state.dElement) + "  " + dName, value: `\`HP\` **${state.dHp}** / ${state.dHpMax}`, inline: true },
            { name: "Turns", value: `${state.turn}`, inline: true },
          )
          .setFooter({ text: "CARTETHYIA  ·  Duel" })],
        components: [],
      }).catch(() => {});
      await thread.setArchived(true).catch(() => {});
      setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
    };

    const runDuelTurn = () => {
      const turnUserId = state.currentTurn;

      const collector = battleMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time:   10 * 60 * 1000,
        max:    1,
        filter: (b: ButtonInteraction) => {
          if (b.user.id !== turnUserId) {
            b.reply({ content: "It's not your turn.", flags: 64 }).catch(() => {});
            return false;
          }
          return true;
        },
      });

      collector.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate();

        const isChallenger = turnUserId === state.challengerId;
        const myAtk    = isChallenger ? state.cAtk      : state.dAtk;
        const oppDef   = isChallenger ? state.dDef      : state.cDef;
        const myCrit   = isChallenger ? state.cCritRate : state.dCritRate;
        const myCritDmg= isChallenger ? state.cCritDmg  : state.dCritDmg;
        const myElem   = isChallenger ? state.cElement  : state.dElement;
        const oppElem  = isChallenger ? state.dElement  : state.cElement;
        const myName   = isChallenger ? state.challengerName : state.challengedName;
        const myElemDmg= isChallenger ? state.cElemDmg  : state.dElemDmg;
        const myLife   = isChallenger ? state.cLifesteal: state.dLifesteal;
        const myBonus  = isChallenger ? state.cBonuses  : state.dBonuses;
        let   myHp     = isChallenger ? state.cHp       : state.dHp;
        const myHpMax  = isChallenger ? state.cHpMax    : state.dHpMax;
        const oppHp    = isChallenger ? state.dHp       : state.cHp;
        const oppHpMax = isChallenger ? state.dHpMax    : state.cHpMax;
        const firstAct = isChallenger ? state.cFirstAction : state.dFirstAction;
        const mySpd    = isChallenger ? state.cSpd : state.dSpd;
        const oppSpd   = isChallenger ? state.dSpd : state.cSpd;
        const isWeak   = myElem === COUNTER_ELEMENT[oppElem];

        // Milestone 3e: per-side team-state locals
        const myHasSolace          = isChallenger ? state.cHasSolace : state.dHasSolace;
        const myActiveUnit         = isChallenger ? state.cActiveUnit : state.dActiveUnit;
        const myAllyHpVal          = isChallenger ? state.cAllyHp : state.dAllyHp;
        const myAllyHpMaxVal       = isChallenger ? state.cAllyHpMax : state.dAllyHpMax;
        const myConcertoEnergy     = isChallenger ? state.cConcertoEnergy : state.dConcertoEnergy;
        const myPlayerDebuffs      = isChallenger ? state.cPlayerDebuffs : state.dPlayerDebuffs;
        const myAttunement         = isChallenger ? state.cAttunement : state.dAttunement;
        const myAttunementDblTurns = isChallenger ? state.cAttunementDoubleTurnsLeft : state.dAttunementDoubleTurnsLeft;
        const mySolaceForte        = isChallenger ? state.cSolaceForte : state.dSolaceForte;
        const myForteEmpoweredTurns= isChallenger ? state.cForteEmpoweredTurnsLeft : state.dForteEmpoweredTurnsLeft;
        const mySolaceBasicLevel   = isChallenger ? state.cSolaceBasicLevel : state.dSolaceBasicLevel;
        const mySolaceSkillLevel   = isChallenger ? state.cSolaceSkillLevel : state.dSolaceSkillLevel;
        const mySolaceUltimateLvl  = isChallenger ? state.cSolaceUltimateLevel : state.dSolaceUltimateLevel;
        const mySolaceIntroLevel   = isChallenger ? state.cSolaceIntroLevel : state.dSolaceIntroLevel;
        const mySolaceForteLevel   = isChallenger ? state.cSolaceForteLevel : state.dSolaceForteLevel;
        const mySolaceConstellation = isChallenger ? state.cSolaceConstellation : state.dSolaceConstellation;
        const myActiveAllyCharacterId = isChallenger ? state.cActiveAllyCharacterId : state.dActiveAllyCharacterId;
        const myAllyKit               = isChallenger ? state.cAllyKit : state.dAllyKit;
        const myAllyMechanicState     = isChallenger ? state.cAllyMechanicState : state.dAllyMechanicState;
        const isMySolaceAlly = myHasSolace && myActiveAllyCharacterId === "solace";
        let convergenceUsedThisTurn = false;

        const myNamedState  = isChallenger ? state.cNamedState : state.dNamedState;
        const mySetId       = myBonus.activeNamedSetId;
        const myGlacioTurns = isChallenger ? state.cGlacioShieldTurnsLeft : state.dGlacioShieldTurnsLeft;
        const myGlacioBonus = isChallenger ? state.cGlacioShieldElemBonus : state.dGlacioShieldElemBonus;
        const myStormTurns  = isChallenger ? state.cStormBuffTurnsLeft : state.dStormBuffTurnsLeft;
        const myStormCrit   = isChallenger ? state.cStormBuffCritBonus : state.dStormBuffCritBonus;
        const havocFrenzyActive = mySetId === "VOIDBORN_REMNANT" && voidbornRemnantFrenzyActive(myNamedState);
        const myHavocAtkMult   = havocFrenzyActive ? (isChallenger ? state.cHavocFrenzyAtkMult   : state.dHavocFrenzyAtkMult)   : 1.0;
        const myHavocLifesteal = havocFrenzyActive ? (isChallenger ? state.cHavocFrenzyLifesteal : state.dHavocFrenzyLifesteal) : 0;
        const myHavocDefIgnore = havocFrenzyActive ? (isChallenger ? state.cHavocFrenzyDefIgnore  : state.dHavocFrenzyDefIgnore) : 0;
        const oppDefShredTurns = isChallenger ? state.dDefShredTurnsLeft : state.cDefShredTurnsLeft;
        const oppDefShredPct   = isChallenger ? state.dDefShredPct      : state.cDefShredPct;

        // Milestone 3e fix: defender-side (opp) Attunement/Wellspring/Forte DEF
        // bonuses — mirror the my* locals but from the OPPOSITE side (opp relative
        // to the acting player), matching boss.ts's un-gated (not activeUnit-gated)
        // standing-bonus pattern.
        const oppAttunement          = isChallenger ? state.dAttunement : state.cAttunement;
        const oppAttunementDblTurns  = isChallenger ? state.dAttunementDoubleTurnsLeft : state.cAttunementDoubleTurnsLeft;
        const oppSolaceSkillLevel    = isChallenger ? state.dSolaceSkillLevel : state.cSolaceSkillLevel;
        const oppForteEmpoweredTurns = isChallenger ? state.dForteEmpoweredTurnsLeft : state.cForteEmpoweredTurnsLeft;
        const oppSolaceForteLevel    = isChallenger ? state.dSolaceForteLevel : state.cSolaceForteLevel;
        const oppSolaceConstellation = isChallenger ? state.dSolaceConstellation : state.cSolaceConstellation;
        const oppActiveAllyCharacterId = isChallenger ? state.dActiveAllyCharacterId : state.cActiveAllyCharacterId;
        const oppHasSolaceForDef = isChallenger ? state.dHasSolace : state.cHasSolace;
        const isOppSolaceAlly = oppHasSolaceForDef && oppActiveAllyCharacterId === "solace";
        const oppAllySolaceStatsForDef = isChallenger ? state.dAllySolaceStats : state.cAllySolaceStats;
        const oppWellspringDefBonus  = isOppSolaceAlly && oppAllySolaceStatsForDef?.hasWellspring ? getWellspringDefBonus(oppAttunement, oppAllySolaceStatsForDef.wellspringRefinement!) : 0;
        const oppForteDefBonus       = isOppSolaceAlly ? getSolaceForteDefBonus(oppSolaceForteLevel, oppForteEmpoweredTurns > 0) : 0;
        const oppAttunementDefBonus  = solaceAttunementDefBonus(oppSolaceSkillLevel);
        const oppAttunementDefMult   = (isOppSolaceAlly ? getAttunementDefMult(oppAttunement, oppAttunementDefBonus, oppAttunementDblTurns > 0, oppSolaceConstellation >= 6) : 1)
          * (1 + oppWellspringDefBonus) * (1 + oppForteDefBonus);

        // Milestone 3.5b: whichever unit is currently acting/defending on
        // EACH side uses ITS OWN resolved stats — my own ATK/Crit for my
        // outgoing hit, the opponent's own DEF for what I'm hitting into.
        const myAllySolaceStats  = isChallenger ? state.cAllySolaceStats : state.dAllySolaceStats;
        const oppAllySolaceStats = isChallenger ? state.dAllySolaceStats : state.cAllySolaceStats;
        const myIsAllyActing     = myActiveUnit === "ally" && myAllySolaceStats !== null;
        const oppIsAllyDefending = (isChallenger ? state.dActiveUnit : state.cActiveUnit) === "ally" && oppAllySolaceStats !== null;
        const activeAtk       = myIsAllyActing ? myAllySolaceStats!.atk      : myAtk;
        const activeCritDmg   = myIsAllyActing ? myAllySolaceStats!.critDmg  : myCritDmg;
        const activeCritBase  = myIsAllyActing ? myAllySolaceStats!.critRate : myCrit;
        const oppActiveDef    = oppIsAllyDefending ? oppAllySolaceStats!.def : oppDef;

        const oppRiloDefBuffTurns = isChallenger ? state.dRiloDefBuffTurnsLeft : state.cRiloDefBuffTurnsLeft;
        const oppRiloDefBuffPct   = isChallenger ? state.dRiloDefBuffPct : state.cRiloDefBuffPct;
        const oppRiloDefBuffMult  = oppRiloDefBuffTurns > 0 ? (1 + oppRiloDefBuffPct) : 1;
        const effectiveOppDef  = oppActiveDef * (1 - myHavocDefIgnore) * (oppDefShredTurns > 0 ? (1 - oppDefShredPct) : 1) * oppAttunementDefMult * oppRiloDefBuffMult;
        const extraElemBonus   = myGlacioTurns > 0 ? myGlacioBonus : 0;
        const myEchoCd         = isChallenger ? state.cEchoSkillCd : state.dEchoSkillCd;
        const myNextCritArmed  = isChallenger ? state.cNextCritArmed : state.dNextCritArmed;
        const forcedCritActive = myNextCritArmed && btn.customId !== "duel_forfeit";
        let radiantDmgMult = 1.0;
        if (mySetId === "RADIANT_CONVERGENCE") {
          const heal = radiantConvergenceOnTurnHeal(myNamedState, myHpMax);
          if (isChallenger) state.cHp = Math.min(state.cHpMax, state.cHp + heal.healAmount);
          else              state.dHp = Math.min(state.dHpMax, state.dHp + heal.healAmount);
          radiantDmgMult = heal.dmgMult;
          myHp = isChallenger ? state.cHp : state.dHp;
        }

        let damage = 0;
        let moveLine = "";

        // Debuffs tick down at the start of the acting side's own turn.
        if (isDevGuild) {
          const tickResult = tickDebuffs(myPlayerDebuffs);
          if (isChallenger) state.cPlayerDebuffs = tickResult.state; else state.dPlayerDebuffs = tickResult.state;
        }

        // Milestone 3e: swap — always consumes the turn, falls through to the
        // shared tail below, same as every other action. Ported from
        // boss.ts's Milestone 3b swap handler.
        if (btn.customId === "duel_swap" && isDevGuild && myHasSolace && myAllyKit && !(myActiveUnit === "player" && myAllyHpVal <= 0)) {
          const outgoingIsPlayer = myActiveUnit === "player";
          const comboReady = myConcertoEnergy >= 100;

          if (comboReady) {
            const incomingTarget: AllyActionTarget = outgoingIsPlayer
              ? { hp: myAllyHpVal, hpMax: myAllyHpMaxVal }
              : { hp: myHp, hpMax: myHpMax };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : myAllyKit.outroEffect(mySolaceConstellation);
            const introEffect: IntroOutroEffect = outgoingIsPlayer ? myAllyKit.introEffect(mySolaceIntroLevel, mySolaceConstellation) : PLAYER_SELF_INTRO;
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            if (!outgoingIsPlayer && introEffect.newMechanicState && myActiveAllyCharacterId === "kaelith") {
              const grant = (introEffect.newMechanicState as any).grantStacksOnIntro as number | undefined;
              if (grant) {
                const cur = (myAllyMechanicState as KaelithMechanicState).stacks;
                const cap = kaelithStackCap(mySolaceConstellation);
                const newState = { ...(myAllyMechanicState as KaelithMechanicState), stacks: Math.min(cap, cur + grant) };
                if (isChallenger) state.cAllyMechanicState = newState; else state.dAllyMechanicState = newState;
              }
            }
            if (!outgoingIsPlayer && outroEffect.enemyDebuff) {
              // Debuff targets the OPPONENT's side, not the caster's own.
              if (isChallenger) { state.dDefShredTurnsLeft = outroEffect.enemyDebuff.turns + 1; state.dDefShredPct = outroEffect.enemyDebuff.value; }
              else              { state.cDefShredTurnsLeft = outroEffect.enemyDebuff.turns + 1; state.cDefShredPct = outroEffect.enemyDebuff.value; }
            }
            if (!outgoingIsPlayer && outroEffect.newMechanicState && myActiveAllyCharacterId === "vesper") {
              const grantMark = (outroEffect.newMechanicState as any).grantMarkOnOutro === true;
              const charged = (outroEffect.newMechanicState as any).chargedMark === true;
              if (grantMark) {
                const newState = { ...(myAllyMechanicState as VesperMechanicState), markPresent: true, chargedMark: charged };
                if (isChallenger) state.cAllyMechanicState = newState; else state.dAllyMechanicState = newState;
              }
            }
            if (outgoingIsPlayer && introEffect.newMechanicState && myActiveAllyCharacterId === "vesper") {
              const energyGrant = (introEffect.newMechanicState as any).grantEnergyOnIntro as number | undefined;
              if (energyGrant) {
                const curEnergy = isChallenger ? state.cEnergy : state.dEnergy;
                const newEnergy = Math.min(100, curEnergy + energyGrant);
                if (isChallenger) state.cEnergy = newEnergy; else state.dEnergy = newEnergy;
              }
            }
            let riloShieldTransferBonus = 0;
            if (!outgoingIsPlayer && outroEffect.newMechanicState && myActiveAllyCharacterId === "rilo") {
              const rOutgoing = myAllyMechanicState as RiloMechanicState;
              const transferFrac = (outroEffect.newMechanicState as any).grantShieldTransferOnOutro as number;
              riloShieldTransferBonus = Math.floor(rOutgoing.shield * transferFrac);
              if ((outroEffect.newMechanicState as any).grantDefBuffOnOutro) {
                const turns = ((outroEffect.newMechanicState as any).defBuffTurns as number) + 1;
                if (isChallenger) { state.cRiloDefBuffTurnsLeft = turns; state.cRiloDefBuffPct = 0.15; }
                else              { state.dRiloDefBuffTurnsLeft = turns; state.dRiloDefBuffPct = 0.15; }
              }
            }
            if (outgoingIsPlayer && introEffect.newMechanicState && myActiveAllyCharacterId === "rilo") {
              const grant = (introEffect.newMechanicState as any).grantShieldOnIntro as number | undefined;
              if (grant) {
                const rIncoming = myAllyMechanicState as RiloMechanicState;
                const newState = { ...rIncoming, shield: Math.min(riloMaxShield(mySolaceConstellation), rIncoming.shield + grant) };
                if (isChallenger) state.cAllyMechanicState = newState; else state.dAllyMechanicState = newState;
              }
            }

            if (!outgoingIsPlayer) {
              if (isChallenger) state.cNextCritArmed = true; else state.dNextCritArmed = true;
            }

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta + riloShieldTransferBonus;
            let actualGain: number;
            if (outgoingIsPlayer) {
              const before = myAllyHpVal;
              const after  = Math.min(myAllyHpMaxVal, myAllyHpVal + totalBonus);
              actualGain = after - before;
              if (isChallenger) state.cAllyHp = after; else state.dAllyHp = after;
            } else {
              const before = myHp;
              const after  = Math.min(myHpMax, myHp + totalBonus);
              actualGain = after - before;
              if (isChallenger) state.cHp = after; else state.dHp = after;
            }

            moveLine = actualGain > 0
              ? `${myName} — 🔄 Swapped to **${outgoingIsPlayer ? myAllyKit.label : myName}** — Outro+Intro combo! +${actualGain} HP.`
              : `${myName} — 🔄 Swapped to **${outgoingIsPlayer ? myAllyKit.label : myName}** — Outro+Intro combo! (already full HP, no heal needed)`;
            const newConcerto = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART
            if (isChallenger) state.cConcertoEnergy = newConcerto; else state.dConcertoEnergy = newConcerto;
          } else {
            moveLine = `${myName} — 🔄 Swapped to **${outgoingIsPlayer ? myAllyKit.label : myName}** — Concerto Energy not full, no combo triggered.`;
          }

          if (isChallenger) state.cActiveUnit = outgoingIsPlayer ? "ally" : "player";
          else              state.dActiveUnit = outgoingIsPlayer ? "ally" : "player";
          damage = 0;
        }

        if (btn.customId === "duel_forfeit") {
          const winnerId = isChallenger ? state.challengedId : state.challengerId;
          const winName  = isChallenger ? state.challengedName : state.challengerName;
          await battleMsg.edit({
            embeds: [new EmbedBuilder().setColor(color)
              .setTitle("⚔️  Duel Over")
              .setDescription(`**${myName}** forfeited.\n**${winName}** wins! +${WIN_CREDITS} ${CE.cr} +${WIN_EXP} EXP`)
              .setFooter({ text: "CARTETHYIA  ·  Duel" })],
            components: [],
          });
          await cleanup(true, winnerId,
            `**${myName}** forfeited.\n🏆 **${winName}** wins! +${WIN_CREDITS} ${CE.cr}  +${WIN_EXP} EXP`);
          return;
        }

        // Crit rate incl. ability (Desperation etc.) + Radiance low-HP bonus + Stormcaller buff
        const radCrit = elemRadianceCrit(myBonus.elementPassive, myHp, myHpMax);
        const stormCritBuff = myStormTurns > 0 ? myStormCrit : 0;
        const aCrit   = abilityCritRate(myBonus, Math.min(1, activeCritBase + radCrit + stormCritBuff), myHp, myHpMax);
        let moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
        let isCrit = false;

        if (btn.customId === "duel_basic") {
          const teamAtkMult   = isMySolaceAlly ? getAttunementAtkMult(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0, mySolaceConstellation >= 6) : 1;
          const teamCritBonus = isMySolaceAlly ? getAttunementCritRateBonus(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0, mySolaceConstellation >= 6) : 0;
          const wellspringAtkMult   = isMySolaceAlly && myActiveUnit === "ally" && myAllySolaceStats?.hasWellspring ? getWellspringBaseAtkMult(myAllySolaceStats.wellspringRefinement!) : 1;
          const wellspringAtkBonus  = isMySolaceAlly && myAllySolaceStats?.hasWellspring ? getWellspringAtkBonus(myAttunement, myAllySolaceStats.wellspringRefinement!) : 0;
          const wellspringCritBonus = isMySolaceAlly && myAllySolaceStats?.hasWellspring ? getWellspringCritRateBonus(myAttunement, myAllySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus  = isMySolaceAlly ? getSolaceForteAtkBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const forteCritBonus = isMySolaceAlly ? getSolaceForteCritRateBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const teamMult = getWeakenedMult(myPlayerDebuffs) * teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const basicMoveMult = myHasSolace && myActiveUnit === "ally" && myAllyKit ? myAllyKit.basicDamageMult(mySolaceBasicLevel) : 1.0;
          const windExplosion = mySetId === "WINDSTRIDERS_LEGACY"
            ? windstridersLegacyCheckExplosion(myNamedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const forcedCrit = forcedCritActive || windExplosion.guaranteedCrit;
          const r      = calcPlayerDamage(activeAtk * teamMult * basicMoveMult * smolderMult * myHavocAtkMult, effectiveOppDef, forcedCrit ? 1 : Math.min(1, aCrit + teamCritBonus + wellspringCritBonus + forteCritBonus), activeCritDmg, 1.0, isWeak, false);
          let base     = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus) * radiantDmgMult);
          base         = Math.floor(base * elemWindstrideMult(myBonus.elementPassive, state.turn, "BASIC"));
          if (mySetId === "WINDSTRIDERS_LEGACY") {
            base = windExplosion.proc
              ? Math.floor(base * (1 + windExplosion.bonusMult))
              : Math.floor(base * windstridersLegacyOnHit(myNamedState));
          }
          let thunderboltEnergy = 0;
          if (mySetId === "STORMCALLERS_OATH") {
            const tb = stormcallersOathOnBasic(myNamedState);
            if (tb.proc) { base += Math.floor(myAtk * tb.bonusMult); thunderboltEnergy = tb.bonusEnergy; }
          }
          const ignite = elemIgniteProc(myBonus.elementPassive, myAtk);
          if (mySetId === "RADIANT_CONVERGENCE" && r.isCrit) radiantConvergenceOnCrit(myNamedState, myHp, myHpMax);
          damage = base + ignite.dmg; isCrit = r.isCrit; moveType = "BASIC";
          moveLine = `${myName} — Basic Attack${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ignite.tag ? `  ✦${ignite.tag}` : ""}`;
          const enGain = ENERGY_PER_TURN + Math.floor(myBonus.spdFlat / 20) + elemDischargeEnergy(myBonus.elementPassive, r.isCrit) + thunderboltEnergy;
          if (isChallenger) state.cEnergy = Math.min(100, state.cEnergy + enGain);
          else              state.dEnergy = Math.min(100, state.dEnergy + enGain);
          if (mySetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(myNamedState, isChallenger ? state.cEnergy : state.dEnergy);

          if (myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "kaelith") {
            const kState = myAllyMechanicState as KaelithMechanicState;
            const gain = kaelithBasicStackGain(mySolaceConstellation);
            const cap = kaelithStackCap(mySolaceConstellation);
            const newState = { ...kState, stacks: Math.min(cap, kState.stacks + gain) };
            if (isChallenger) state.cAllyMechanicState = newState; else state.dAllyMechanicState = newState;
            moveLine += `\n🌑 +${gain} stack${gain === 1 ? "" : "s"} (${newState.stacks}/${cap})`;
          }
          if (myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "vesper") {
            const vState = myAllyMechanicState as VesperMechanicState;
            const newState = { ...vState, markPresent: true };
            if (isChallenger) state.cAllyMechanicState = newState; else state.dAllyMechanicState = newState;
            moveLine += `\n⚡ Static Mark applied!`;
          }
          if (myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "rilo") {
            const rState = myAllyMechanicState as RiloMechanicState;
            const maxShield = riloMaxShield(mySolaceConstellation);
            const critBonus = r.isCrit ? Math.floor(RILO_SHIELD_GAIN_PER_BASIC * (mySolaceConstellation >= 1 ? 0.5 : 0)) : 0;
            const newState = { ...rState, shield: Math.min(maxShield, rState.shield + RILO_SHIELD_GAIN_PER_BASIC + critBonus) };
            if (isChallenger) state.cAllyMechanicState = newState; else state.dAllyMechanicState = newState;
            moveLine += `\n🛡️ +${RILO_SHIELD_GAIN_PER_BASIC + critBonus} Shield (${newState.shield}/${maxShield})`;
          }

          // Forte fills only from the active ally's own Basic Attack.
          if (isMySolaceAlly) {
            const forteBefore = mySolaceForte;
            const forteAfter  = addForteCharge(forteBefore, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
            if (isChallenger) state.cSolaceForte = forteAfter; else state.dSolaceForte = forteAfter;
            const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
            const isHalf  = forteAfter.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(forteAfter, SOLACE_FORTE_CONFIG);
            if (isForteMaxed(forteAfter, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
            } else if (isHalf && !wasHalf) {
              moveLine += `\n✨ Forte is **HALF CHARGED**.`;
            }
          } else if (myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "kaelith") {
            const forteBefore = mySolaceForte;
            const forteAfter  = addForteCharge(forteBefore, KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC);
            if (isChallenger) state.cSolaceForte = forteAfter; else state.dSolaceForte = forteAfter;
            if (isForteMaxed(forteAfter, KAELITH_FORTE_CONFIG) && !isForteMaxed(forteBefore, KAELITH_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Umbral Cataclysm will keep your stacks!`;
            }
          } else if (myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "vesper") {
            const forteBefore = mySolaceForte;
            const forteAfter  = addForteCharge(forteBefore, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
            if (isChallenger) state.cSolaceForte = forteAfter; else state.dSolaceForte = forteAfter;
            if (isForteMaxed(forteAfter, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
            }
          } else if (myHasSolace && myActiveUnit === "ally" && myActiveAllyCharacterId === "rilo") {
            const forteBefore = mySolaceForte;
            const forteAfter  = addForteCharge(forteBefore, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
            if (isChallenger) state.cSolaceForte = forteAfter; else state.dSolaceForte = forteAfter;
            if (isForteMaxed(forteAfter, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
            }
          }
        }

        if (btn.customId === "duel_skill" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "solace") {
          // Solace's Skill is Attunement — a mode cycle, not a damage move.
          const newMode = cycleAttunementMode(myAttunement.mode);
          if (isChallenger) state.cAttunement.mode = newMode; else state.dAttunement.mode = newMode;
          if (mySolaceConstellation >= 3) {
            if (isChallenger) state.cConcertoEnergy = addConcertoEnergy(state.cConcertoEnergy, 25);
            else state.dConcertoEnergy = addConcertoEnergy(state.dConcertoEnergy, 25);
          }
          const crit = Math.random() < aCrit;
          const r    = calcPlayerDamage(activeAtk * 0.6, effectiveOppDef, crit ? 1 : 0, activeCritDmg, 1.0, isWeak, false);
          damage = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus));
          isCrit = r.isCrit; moveType = "SKILL";
          moveLine = `${myName} — ✦ Attunement — now in **${newMode}** mode!`;
          const enGain = ENERGY_PER_TURN;
          if (isChallenger) state.cEnergy = Math.min(100, state.cEnergy + enGain);
          else              state.dEnergy = Math.min(100, state.dEnergy + enGain);
        } else if (btn.customId === "duel_skill" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "kaelith" && myAllyKit) {
          const kState = myAllyMechanicState as KaelithMechanicState;
          if (kState.stacks <= 0) {
            moveLine = `${myName} — 🌑 Umbral Detonation — no stacks to consume! (0 DMG bonus)`;
            damage = 0;
          } else {
            const crit = Math.random() < aCrit;
            const result = myAllyKit.onSkill(
              { playerHp: myHp, playerHpMax: myHpMax, allyHp: myAllyHpVal, allyHpMax: myAllyHpMaxVal, turn: state.turn, isShattered: false, mechanicState: kState },
              { basicLevel: mySolaceBasicLevel, skillLevel: mySolaceSkillLevel, ultimateLevel: mySolaceUltimateLvl, introLevel: mySolaceIntroLevel, forteLevel: mySolaceForteLevel },
              mySolaceConstellation,
            );
            if (isChallenger) state.cAllyMechanicState = result.newMechanicState; else state.dAllyMechanicState = result.newMechanicState;
            const r = calcPlayerDamage(activeAtk * result.damageMult, effectiveOppDef, crit ? 1 : 0, activeCritDmg, 1.0, isWeak, false);
            damage = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus));
            isCrit = r.isCrit; moveType = "SKILL";
            moveLine = `${myName} — 🌑 ${result.moveLabel}${crit ? " **(CRIT)**" : ""}`;
          }
          const mySkillCdKaelith = myAllyKit.skillCooldownTurns;
          if (isChallenger) state.cSkillCd = mySkillCdKaelith; else state.dSkillCd = mySkillCdKaelith;
        } else if (btn.customId === "duel_skill" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "vesper" && myAllyKit) {
          const vState = myAllyMechanicState as VesperMechanicState;
          const crit = forcedCritActive || Math.random() < aCrit;
          const forteEmpowered = isForteMaxed(mySolaceForte, VESPER_FORTE_CONFIG);
          const result = myAllyKit.onSkill(
            { playerHp: myHp, playerHpMax: myHpMax, allyHp: myAllyHpVal, allyHpMax: myAllyHpMaxVal, turn: state.turn, isShattered: false, mechanicState: vState, forteEmpowered } as any,
            { basicLevel: mySolaceBasicLevel, skillLevel: mySolaceSkillLevel, ultimateLevel: mySolaceUltimateLvl, introLevel: mySolaceIntroLevel, forteLevel: mySolaceForteLevel },
            mySolaceConstellation,
          ) as VesperSkillResult;
          if (isChallenger) state.cAllyMechanicState = result.newMechanicState; else state.dAllyMechanicState = result.newMechanicState;
          if (forteEmpowered) { const reset = resetForte(); if (isChallenger) state.cSolaceForte = reset; else state.dSolaceForte = reset; }

          const effectiveDefIgnored = effectiveOppDef * (1 - result.defIgnorePct);
          const perHit = calcPlayerDamage(activeAtk * (result.damageMult / result.hits), effectiveDefIgnored, crit ? 1 : 0, activeCritDmg, 1.0, isWeak, false);
          const perHitDmg = Math.floor(perHit.damage * (1 + myElemDmg + extraElemBonus));

          if (result.hits > 1) {
            const hitLines = Array.from({ length: result.hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
            damage = perHitDmg * result.hits;
            moveLine = `${myName} — ⚡ ${result.moveLabel}\n${hitLines}\n**Total: ${damage} DMG**${crit ? " **(CRIT)**" : ""}`;
          } else {
            damage = perHitDmg;
            moveLine = `${myName} — ⚡ ${result.moveLabel}${crit ? " **(CRIT)**" : ""}`;
          }
          isCrit = crit; moveType = "SKILL";

          if (!forteEmpowered) {
            const forteBefore = mySolaceForte;
            const forteAfter  = addForteCharge(forteBefore, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
            if (isChallenger) state.cSolaceForte = forteAfter; else state.dSolaceForte = forteAfter;
            if (isForteMaxed(forteAfter, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
            }
          }
        } else if (btn.customId === "duel_skill" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "rilo" && myAllyKit) {
          const rState = myAllyMechanicState as RiloMechanicState;
          const crit = true;
          const forteEmpowered = isForteMaxed(mySolaceForte, RILO_FORTE_CONFIG);
          const result = myAllyKit.onSkill(
            { playerHp: myHp, playerHpMax: myHpMax, allyHp: myAllyHpVal, allyHpMax: myAllyHpMaxVal, turn: state.turn, isShattered: false, mechanicState: rState, forteEmpowered } as any,
            { basicLevel: mySolaceBasicLevel, skillLevel: mySolaceSkillLevel, ultimateLevel: mySolaceUltimateLvl, introLevel: mySolaceIntroLevel, forteLevel: mySolaceForteLevel },
            mySolaceConstellation,
          ) as RiloSkillResult;
          if (isChallenger) state.cAllyMechanicState = result.newMechanicState; else state.dAllyMechanicState = result.newMechanicState;
          if (forteEmpowered) { const reset = resetForte(); if (isChallenger) state.cSolaceForte = reset; else state.dSolaceForte = reset; }

          const r = calcPlayerDamage(activeAtk, effectiveOppDef, 1.0, activeCritDmg, result.damageMult, isWeak, false);
          damage = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus));
          moveLine = `${myName} — 🛡️ ${result.moveLabel} **(CRIT)** (consumed ${result.shieldConsumed} Shield)`;
          if (result.defShredApplied) {
            const turns = 2 + 1;
            if (isChallenger) { state.dDefShredTurnsLeft = turns; state.dDefShredPct = RILO_C2_DEF_SHRED_PCT; }
            else              { state.cDefShredTurnsLeft = turns; state.cDefShredPct = RILO_C2_DEF_SHRED_PCT; }
            moveLine += `\n❄️ Enemy DEF shredded 10% for 2 turns!`;
          }
          isCrit = crit; moveType = "SKILL";

          if (!forteEmpowered) {
            const forteBefore = mySolaceForte;
            const forteAfter  = addForteCharge(forteBefore, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
            if (isChallenger) state.cSolaceForte = forteAfter; else state.dSolaceForte = forteAfter;
            if (isForteMaxed(forteAfter, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
              moveLine += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
            }
          }
        } else if (btn.customId === "duel_skill") {
          const isSolaceAllySkill = isMySolaceAlly;
          const teamAtkMult    = isSolaceAllySkill ? getAttunementAtkMult(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0, mySolaceConstellation >= 6) : 1;
          const teamCritBonus  = isSolaceAllySkill ? getAttunementCritRateBonus(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0, mySolaceConstellation >= 6) : 0;
          const wellspringAtkBonus  = isSolaceAllySkill && myAllySolaceStats?.hasWellspring ? getWellspringAtkBonus(myAttunement, myAllySolaceStats.wellspringRefinement!) : 0;
          const wellspringCritBonus = isSolaceAllySkill && myAllySolaceStats?.hasWellspring ? getWellspringCritRateBonus(myAttunement, myAllySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus  = isSolaceAllySkill ? getSolaceForteAtkBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const forteCritBonus = isSolaceAllySkill ? getSolaceForteCritRateBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const teamMult = getWeakenedMult(myPlayerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const r      = calcPlayerDamage(myAtk * teamMult * smolderMult * myHavocAtkMult, effectiveOppDef, forcedCritActive ? 1 : Math.min(1, aCrit + 0.1 + teamCritBonus + wellspringCritBonus + forteCritBonus), myCritDmg, 1.8, isWeak, false);
          let base     = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus) * radiantDmgMult);
          base         = Math.floor(base * elemWindstrideMult(myBonus.elementPassive, state.turn, "SKILL"));
          if (mySetId === "WINDSTRIDERS_LEGACY") base = Math.floor(base * windstridersLegacyOnHit(myNamedState));
          if (mySetId === "SMOLDERING_SOVEREIGN") {
            const sov = smolderingSovereignOnSkill(myNamedState);
            if (sov.doubleHit) base = Math.floor(base * sov.bonusMult * 2);
          }
          const ignite = elemIgniteProc(myBonus.elementPassive, myAtk);
          if (mySetId === "RADIANT_CONVERGENCE" && r.isCrit) radiantConvergenceOnCrit(myNamedState, myHp, myHpMax);
          damage = base + ignite.dmg; isCrit = r.isCrit; moveType = "SKILL";
          moveLine = `${myName} — Resonance Skill${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ignite.tag ? `  ✦${ignite.tag}` : ""}`;
          const enGain = ENERGY_PER_TURN + Math.floor(myBonus.spdFlat / 20) + elemDischargeEnergy(myBonus.elementPassive, r.isCrit);
          const mySkillCd = effectiveSkillCooldown(myBonus, SKILL_CD);
          if (isChallenger) { state.cSkillCd = mySkillCd; state.cEnergy = Math.min(100, state.cEnergy + enGain); }
          else              { state.dSkillCd = mySkillCd; state.dEnergy = Math.min(100, state.dEnergy + enGain); }
        }

        if (btn.customId === "duel_ultimate" && !(isDevGuild && myActiveUnit === "ally")) {
          const teamAtkMult   = isMySolaceAlly ? getAttunementAtkMult(myAttunement, solaceAttunementAtkCritBonus(mySolaceSkillLevel), myAttunementDblTurns > 0, mySolaceConstellation >= 6) : 1;
          const wellspringAtkBonus = isMySolaceAlly && myAllySolaceStats?.hasWellspring ? getWellspringAtkBonus(myAttunement, myAllySolaceStats.wellspringRefinement!) : 0;
          const forteAtkBonus = isMySolaceAlly ? getSolaceForteAtkBonus(mySolaceForteLevel, myForteEmpoweredTurns > 0) : 0;
          const teamMult = getWeakenedMult(myPlayerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const r  = calcPlayerDamage(myAtk * teamMult * smolderMult * myHavocAtkMult, effectiveOppDef, 1.0, myCritDmg, 3.5, isWeak, false);
          let base = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus) * radiantDmgMult);
          if (mySetId === "WINDSTRIDERS_LEGACY") base = Math.floor(base * windstridersLegacyOnHit(myNamedState));
          if (mySetId === "RADIANT_CONVERGENCE") radiantConvergenceOnCrit(myNamedState, myHp, myHpMax);
          damage = base; isCrit = true; moveType = "ULT";
          moveLine = `${myName} — ⚡ **ULTIMATE**${isWeak ? " **(WEAK)**" : ""}`;
          if (isChallenger) state.cEnergy = 0;
          else              state.dEnergy = 0;
          if (mySetId === "STORMCALLERS_OATH") {
            const surge = stormcallersOathOnUltimate();
            if (isChallenger) { state.cStormBuffTurnsLeft = surge.turnsLeft + 1; state.cStormBuffCritBonus = surge.critRateBonus; }
            else              { state.dStormBuffTurnsLeft = surge.turnsLeft + 1; state.dStormBuffCritBonus = surge.critRateBonus; }
          }
        } else if (btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "solace") {
          // Solace's Ultimate spends Concerto Energy, not personal Energy, and
          // heals the 2-unit side (player + Solace) — no party to heal in a
          // duel, matching /dungeon's/`boss.ts`'s 2-unit Convergence, not
          // /raid's party-wide version.
          const healPct = solaceConvergenceHealPct(mySolaceUltimateLvl, mySolaceConstellation);
          const playerHealResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
            { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(mySolaceConstellation) },
          ] }, { hp: myHp, hpMax: myHpMax });
          const allyHealResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
          ] }, { hp: myAllyHpVal, hpMax: myAllyHpMaxVal });

          const beforePlayer = myHp;
          const afterPlayer  = Math.min(myHpMax, myHp + playerHealResult.hpDelta);
          const actualHealPlayer = afterPlayer - beforePlayer;
          const beforeAlly = myAllyHpVal;
          const afterAlly  = Math.min(myAllyHpMaxVal, myAllyHpVal + allyHealResult.hpDelta);
          const actualHealAlly = afterAlly - beforeAlly;
          const cleansedDebuffs = cleanseDebuffs(myPlayerDebuffs, playerHealResult.cleanseCount);

          if (isChallenger) {
            state.cHp = afterPlayer; state.cAllyHp = afterAlly; state.cPlayerDebuffs = cleansedDebuffs;
            state.cConcertoEnergy = 0;
          } else {
            state.dHp = afterPlayer; state.dAllyHp = afterAlly; state.dPlayerDebuffs = cleansedDebuffs;
            state.dConcertoEnergy = 0;
          }
          convergenceUsedThisTurn = true;
          damage = 0; isCrit = false; moveType = "ULT";

          const healSummary = `${myName} +${actualHealPlayer} HP, ${myAllyKit?.label ?? "Solace"} +${actualHealAlly} HP`;
          if (isForteMaxed(mySolaceForte, SOLACE_FORTE_CONFIG)) {
            const emp = solaceUltimateDoubleTurns(mySolaceConstellation) + 1;
            const reset = resetForte();
            if (isChallenger) { state.cForteEmpoweredTurnsLeft = emp; state.cAttunementDoubleTurnsLeft = 0; state.cSolaceForte = reset; }
            else              { state.dForteEmpoweredTurnsLeft = emp; state.dAttunementDoubleTurnsLeft = 0; state.dSolaceForte = reset; }
            moveLine = `${myName} — ⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**all 3 Attunement Modes empowered for ${solaceUltimateDoubleTurns(mySolaceConstellation)} turns!**`;
          } else {
            const dbl = solaceUltimateDoubleTurns(mySolaceConstellation) + 1;
            if (isChallenger) { state.cAttunementDoubleTurnsLeft = dbl; state.cForteEmpoweredTurnsLeft = 0; }
            else              { state.dAttunementDoubleTurnsLeft = dbl; state.dForteEmpoweredTurnsLeft = 0; }
            moveLine = `${myName} — ⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
              `**${myAttunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(mySolaceConstellation)} turns!**`;
          }
        } else if (btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "kaelith" && myAllyKit) {
          const kState = myAllyMechanicState as KaelithMechanicState;
          const stacksConsumed = kState.stacks;

          const ultDamageMult = mySolaceConstellation >= 6
            ? stacksConsumed * (KAELITH_PER_STACK_ULT_BONUS * 1.6)
            : kaelithUltimateBaseMult(mySolaceUltimateLvl) + stacksConsumed * KAELITH_PER_STACK_ULT_BONUS;

          const result = myAllyKit.onUltimate(
            { playerHp: myHp, playerHpMax: myHpMax, allyHp: myAllyHpVal, allyHpMax: myAllyHpMaxVal, turn: state.turn, isShattered: false, mechanicState: kState },
            { basicLevel: mySolaceBasicLevel, skillLevel: mySolaceSkillLevel, ultimateLevel: mySolaceUltimateLvl, introLevel: mySolaceIntroLevel, forteLevel: mySolaceForteLevel },
            mySolaceConstellation,
          );
          if (isChallenger) state.cAllyMechanicState = result.newMechanicState; else state.dAllyMechanicState = result.newMechanicState;

          const r = calcPlayerDamage(activeAtk * ultDamageMult, effectiveOppDef, 1.0, activeCritDmg, 1.0, isWeak, false);
          damage = r.damage; isCrit = true; moveType = "ULT";
          moveLine = `${myName} — 🌑 ${result.moveLabel}`;

          if (result.healResult.actions.length > 0) {
            const healResult = resolveIntroOutroEffect(result.healResult, { hp: myAllyHpVal, hpMax: myAllyHpMaxVal });
            const afterAlly = Math.min(myAllyHpMaxVal, myAllyHpVal + healResult.hpDelta);
            if (isChallenger) state.cAllyHp = afterAlly; else state.dAllyHp = afterAlly;
          }
          if (result.resetsConcertoEnergy) {
            convergenceUsedThisTurn = true;
            if (isChallenger) state.cConcertoEnergy = 0; else state.dConcertoEnergy = 0;
          }
        } else if (btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "vesper" && myAllyKit) {
          const vState = myAllyMechanicState as VesperMechanicState;
          const consumedMark = vState.markPresent;
          const curEnergyForUlt = isChallenger ? state.cEnergy : state.dEnergy;
          const energyPct = Math.min(100, curEnergyForUlt) / 100;
          const markBonus = consumedMark ? 0.8 : 0;
          const c6Bonus = mySolaceConstellation >= 6 ? vState.dischargesSinceUltimate * 0.15 : 0;
          const c3Bonus = mySolaceConstellation >= 3 ? energyPct * 0.5 : 0;
          const ultDamageMult = vesperUltimateBaseMult(mySolaceUltimateLvl) + markBonus + c6Bonus + c3Bonus;

          const result = myAllyKit.onUltimate(
            { playerHp: myHp, playerHpMax: myHpMax, allyHp: myAllyHpVal, allyHpMax: myAllyHpMaxVal, turn: state.turn, isShattered: false, mechanicState: vState, playerEnergy: curEnergyForUlt, playerEnergyMax: 100 },
            { basicLevel: mySolaceBasicLevel, skillLevel: mySolaceSkillLevel, ultimateLevel: mySolaceUltimateLvl, introLevel: mySolaceIntroLevel, forteLevel: mySolaceForteLevel },
            mySolaceConstellation,
          );
          if (isChallenger) state.cAllyMechanicState = result.newMechanicState; else state.dAllyMechanicState = result.newMechanicState;

          const r = calcPlayerDamage(activeAtk * ultDamageMult, effectiveOppDef, 1.0, activeCritDmg, 1.0, isWeak, false);
          damage = r.damage; isCrit = true; moveType = "ULT";
          moveLine = `${myName} — ⚡ ${result.moveLabel}`;
        } else if (btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "rilo" && myAllyKit) {
          const rState = myAllyMechanicState as RiloMechanicState;
          const result = myAllyKit.onUltimate(
            { playerHp: myHp, playerHpMax: myHpMax, allyHp: myAllyHpVal, allyHpMax: myAllyHpMaxVal, turn: state.turn, isShattered: false, mechanicState: rState },
            { basicLevel: mySolaceBasicLevel, skillLevel: mySolaceSkillLevel, ultimateLevel: mySolaceUltimateLvl, introLevel: mySolaceIntroLevel, forteLevel: mySolaceForteLevel },
            mySolaceConstellation,
          );
          const maxShield = riloMaxShield(mySolaceConstellation);
          const c6DoubleHit = mySolaceConstellation >= 6 && rState.shield >= maxShield;
          const hits = c6DoubleHit ? 2 : 1;

          const perHit = calcPlayerDamage(activeAtk, effectiveOppDef, 1.0, activeCritDmg, riloUltimateBaseMult(mySolaceUltimateLvl) / hits, isWeak, false);
          const perHitDmg = perHit.damage;
          const totalDmg = perHitDmg * hits;

          const c4Bonus = riloUltimateShieldFromDamage(totalDmg, mySolaceConstellation);
          const finalState = {
            ...(result.newMechanicState as RiloMechanicState),
            shield: Math.min(maxShield, (result.newMechanicState as RiloMechanicState).shield + c4Bonus),
          };
          if (isChallenger) state.cAllyMechanicState = finalState; else state.dAllyMechanicState = finalState;

          if (hits > 1) {
            const hitLines = Array.from({ length: hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
            damage = totalDmg;
            moveLine = `${myName} — 🛡️ ${result.moveLabel}\n${hitLines}\n**Total: ${damage} DMG**`;
          } else {
            damage = totalDmg;
            moveLine = `${myName} — 🛡️ ${result.moveLabel} — ${damage} DMG`;
          }
          isCrit = true; moveType = "ULT";

          if (result.healResult.actions.length > 0) {
            const cleansed = cleanseDebuffs(isChallenger ? state.cPlayerDebuffs : state.dPlayerDebuffs, 1);
            if (isChallenger) state.cPlayerDebuffs = cleansed; else state.dPlayerDebuffs = cleansed;
          }
        }

        let echoResult: ReturnType<typeof applyEchoSkill> | null = null;
        let echoNamedTriggerTag = "";
        if (btn.customId === "duel_echoskill" && myBonus.echoSkill) {
          const def = myBonus.echoSkill;
          const echoCrit = forcedCritActive || def.kind === "GUARANTEED_CRIT" || Math.random() < aCrit;
          isCrit = echoCrit; moveType = "SKILL";
          const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(myNamedState) : 1;
          const r = calcPlayerDamage(myAtk * smolderMult * myHavocAtkMult, effectiveOppDef, echoCrit ? 1 : 0, myCritDmg, echoSkillBaseMult(), isWeak, false);
          let base = Math.floor(r.damage * (1 + myElemDmg + extraElemBonus) * radiantDmgMult);

          echoResult = applyEchoSkill(def, {
            atk: myAtk, enemyHp: oppHp, enemyHpMax: oppHpMax,
            playerHp: myHp, playerHpMax: myHpMax,
            playerEnergy: isChallenger ? state.cEnergy : state.dEnergy,
            turn: state.turn, bossVibMax: oppHpMax * 0.1, crit: echoCrit,
          });
          base = Math.floor(base * echoResult.dmgMult);
          if (echoResult.doubleHit) base *= 2;
          if (echoResult.noDamage) base = 0;
          base += echoResult.extraVibDrain; // no vib bar in duels — treat as bonus flat damage

          if (def.kind === "NAMED_SET_TRIGGER" && mySetId === def.setId) {
            switch (def.setId) {
              case "SMOLDERING_SOVEREIGN":
                myNamedState.fusionAtkStacks = 4; myNamedState.fusionSkillDoubleArmed = true;
                echoNamedTriggerTag = "ATK stacks maxed!";
                break;
              case "FROSTVEIL_BASTION":
                if (!myNamedState.glacioShieldUsed) {
                  myNamedState.glacioShieldUsed = true;
                  const shieldAmt = Math.floor(myHpMax * 0.28);
                  if (isChallenger) { state.cHp = Math.min(state.cHpMax, state.cHp + shieldAmt); state.cGlacioShieldTurnsLeft = 5; state.cGlacioShieldElemBonus = 0.22; }
                  else              { state.dHp = Math.min(state.dHpMax, state.dHp + shieldAmt); state.dGlacioShieldTurnsLeft = 5; state.dGlacioShieldElemBonus = 0.22; }
                  echoNamedTriggerTag = `+${shieldAmt} HP shield!`;
                }
                break;
              case "STORMCALLERS_OATH":
                myNamedState.electroThunderboltArmed = true;
                echoNamedTriggerTag = "Thunderbolt armed!";
                break;
              case "WINDSTRIDERS_LEGACY":
                myNamedState.aeroWindstacks = 6;
                echoNamedTriggerTag = "Windstacks maxed!";
                break;
              case "VOIDBORN_REMNANT":
                if (!myNamedState.havocFrenzyUsed) {
                  myNamedState.havocFrenzyUsed = true;
                  myNamedState.havocFrenzyTurnsLeft = 4;
                  if (isChallenger) { state.cHavocFrenzyAtkMult = 1.25; state.cHavocFrenzyLifesteal = 0.15; state.cHavocFrenzyDefIgnore = 0.20; }
                  else              { state.dHavocFrenzyAtkMult = 1.25; state.dHavocFrenzyLifesteal = 0.15; state.dHavocFrenzyDefIgnore = 0.20; }
                  echoNamedTriggerTag = "Frenzy triggered!";
                }
                break;
              case "RADIANT_CONVERGENCE":
                myNamedState.spectroHealStacks = 5;
                echoNamedTriggerTag = "Heal-stacks maxed!";
                break;
            }
          }

          damage = base; isCrit = echoCrit;
          moveLine = `${myName} — 🌀 ${def.name}${echoCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}`;
          if (echoNamedTriggerTag) moveLine += `\n✦ ${echoNamedTriggerTag}`;

          const echoEnGain = ENERGY_PER_TURN + Math.floor(myBonus.spdFlat / 20) + elemDischargeEnergy(myBonus.elementPassive, echoCrit) + echoResult.bonusEnergy;
          const newCd = (echoResult.resetCdOnCrit && echoCrit) ? 0 : 4;
          if (isChallenger) { state.cEchoSkillCd = newCd; state.cEnergy = echoResult.setEnergyFull ? 100 : Math.min(100, state.cEnergy + echoEnGain); }
          else              { state.dEchoSkillCd = newCd; state.dEnergy = echoResult.setEnergyFull ? 100 : Math.min(100, state.dEnergy + echoEnGain); }

          if (echoResult.armsNextCrit) { if (isChallenger) state.cNextCritArmed = true; else state.dNextCritArmed = true; }
          if (echoResult.defShredTurns > 0) {
            if (isChallenger) { state.dDefShredTurnsLeft = echoResult.defShredTurns + 1; state.dDefShredPct = echoResult.defShredPct; }
            else              { state.cDefShredTurnsLeft = echoResult.defShredTurns + 1; state.cDefShredPct = echoResult.defShredPct; }
          }
          if (echoResult.healHp > 0) {
            if (isChallenger) state.cHp = Math.min(state.cHpMax, state.cHp + echoResult.healHp);
            else              state.dHp = Math.min(state.dHpMax, state.dHp + echoResult.healHp);
          }
        }

        // Concerto Energy builds from combat actions, never from swapping.
        const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
          duel_basic: 10, duel_skill: 20, duel_echoskill: 20, duel_ultimate: 35,
        };
        if (isDevGuild && !convergenceUsedThisTurn) {
          let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
          if (concertoGain > 0 && myActiveUnit === "ally" && myAllySolaceStats?.hasWellspring) concertoGain += getWellspringBaseEnergyBonus(myAllySolaceStats.wellspringRefinement);
          if (concertoGain > 0) {
            const newVal = addConcertoEnergy(myConcertoEnergy, concertoGain);
            if (isChallenger) state.cConcertoEnergy = newVal; else state.dConcertoEnergy = newVal;
          }
        }

        // Apply unique ability effects — skipped for swap (no real attack occurred, damage is
        // always 0), so ON_HIT/ON_BASIC effects like heals/energy/stacking buffs can't be farmed.
        const myV2Stacks = isChallenger ? state.cV2Stacks : state.dV2Stacks;
        const ar: AbilityAttackResult = btn.customId === "duel_swap"
          ? { dmg: damage, healHp: 0, bonusEnergy: 0, tag: "" }
          : applyAbilityAttack(myBonus, damage, isCrit, {
              moveType, currentHp: myHp, maxHp: myHpMax,
              enemyHpPct: oppHp / oppHpMax, turn: state.turn, isFirstAction: firstAct,
              isWeak, isShattered: false, v2Stacks: myV2Stacks,
            });
        damage = ar.dmg;
        if (ar.newStacks !== undefined) {
          if (isChallenger) state.cV2Stacks = ar.newStacks;
          else              state.dV2Stacks = ar.newStacks;
        }

        // SPD first-strike — whoever has the SPD edge gets bonus damage on the duel's very first action.
        // Excludes swap (free repositioning, deals 0 damage anyway) and Solace's Convergence
        // (a real action, but shouldn't get a damage bonus it can't use), mirroring the
        // Quick-Strike exclusion already applied to Convergence in /boss and /ascend.
        if (state.turn === 1 && mySpd > oppSpd && btn.customId !== "duel_swap" &&
            !(btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "solace")) {
          const bonusDmg = Math.floor(damage * 0.15);
          damage += bonusDmg;
          moveLine += `\n⚡ **First Strike** — you got the jump on them! +${bonusDmg} bonus DMG!`;
        }

        if (ar.tag) moveLine += `  ✦${ar.tag}`;
        moveLine += ` — **${damage} DMG**`;

        // Frost Shield: defender's Glacio passive absorbs part of incoming hit
        const oppBonus = isChallenger ? state.dBonuses : state.cBonuses;
        const shieldResult = elemFrostShield(oppBonus.elementPassive, damage);
        if (shieldResult.blocked) {
          damage = shieldResult.dmg;
          moveLine += ` *(Frost Shield!)*`;
        }

        // Self heal (lifesteal + heal-on-crit), energy
        const echoLifestealPct = echoResult && myBonus.echoSkill?.kind === "FLAT_LIFESTEAL" ? myBonus.echoSkill.pct : 0;
        const healed = applyLifesteal(myLife + myHavocLifesteal + echoLifestealPct, damage, myHp, myHpMax) - myHp + ar.healHp;
        if (isChallenger) {
          state.cHp = Math.min(state.cHpMax, state.cHp + Math.max(0, healed));
          state.cEnergy = Math.min(100, state.cEnergy + ar.bonusEnergy);
          if (btn.customId !== "duel_swap") state.cFirstAction = false;
        } else {
          state.dHp = Math.min(state.dHpMax, state.dHp + Math.max(0, healed));
          state.dEnergy = Math.min(100, state.dEnergy + ar.bonusEnergy);
          if (btn.customId !== "duel_swap") state.dFirstAction = false;
        }

        // Apply damage to opponent — routes into their Solace's HP pool
        // instead of their own HP if their Solace is currently active.
        // Symmetric: both branches need this check, not just one (the
        // biggest copy-paste risk in this file's c*/d* duplication pattern).
        if (isChallenger) {
          if (isDevGuild && state.dActiveUnit === "ally" && state.dActiveAllyCharacterId === "rilo") {
            const rState = state.dAllyMechanicState as RiloMechanicState;
            const hitResult = riloOnHitTaken(rState, damage, state.dAllyHp, state.dAllyHpMax, state.dSolaceConstellation);
            state.dAllyMechanicState = hitResult.newMechanicState;
            damage = hitResult.actualDamageTaken;
            if (hitResult.forteGain > 0) state.dSolaceForte = addForteCharge(state.dSolaceForte, RILO_FORTE_CONFIG, hitResult.forteGain);
          }
          if (isDevGuild && state.dActiveUnit === "ally") state.dAllyHp = Math.max(0, state.dAllyHp - damage);
          else                                            state.dHp     = Math.max(0, state.dHp - damage);
        } else {
          if (isDevGuild && state.cActiveUnit === "ally" && state.cActiveAllyCharacterId === "rilo") {
            const rState = state.cAllyMechanicState as RiloMechanicState;
            const hitResult = riloOnHitTaken(rState, damage, state.cAllyHp, state.cAllyHpMax, state.cSolaceConstellation);
            state.cAllyMechanicState = hitResult.newMechanicState;
            damage = hitResult.actualDamageTaken;
            if (hitResult.forteGain > 0) state.cSolaceForte = addForteCharge(state.cSolaceForte, RILO_FORTE_CONFIG, hitResult.forteGain);
          }
          if (isDevGuild && state.cActiveUnit === "ally") state.cAllyHp = Math.max(0, state.cAllyHp - damage);
          else                                            state.cHp     = Math.max(0, state.cHp - damage);
        }

        // Milestone 3e: landing a real attack has a 25% chance to leave the
        // opponent WEAKENED, mirroring /boss's retaliation-side chance.
        // Excluded from swap (damage === 0 anyway, so this is a no-op safety
        // net, not load-bearing). Gated on the DEFENDING side's own hasSolace
        // (Milestone 3.5a fix) — a player who never opted into team mechanics
        // via /team shouldn't have their fight affected by them.
        const oppHasSolace = isChallenger ? state.dHasSolace : state.cHasSolace;
        if (oppHasSolace && damage > 0 && Math.random() < 0.25) {
          if (isChallenger) state.dPlayerDebuffs = applyDebuff(state.dPlayerDebuffs, "WEAKENED", 0.2, 2);
          else              state.cPlayerDebuffs = applyDebuff(state.cPlayerDebuffs, "WEAKENED", 0.2, 2);
          moveLine += `\n◇ *Leaves ${isChallenger ? state.challengedName : state.challengerName}* **WEAKENED** *(-20% ATK, 2 turns)*`;
        }

        // Opponent's reactive named-set mechanics (they just took a hit) — skipped for swap,
        // since swap deals 0 damage and isn't a real attack the opponent "took."
        if (btn.customId !== "duel_swap") {
          const oppNamedState = isChallenger ? state.dNamedState : state.cNamedState;
          const oppSetId       = oppBonus.activeNamedSetId;
          const oppHpNow       = isChallenger ? state.dHp    : state.cHp;
          const oppHpMaxNow    = isChallenger ? state.dHpMax : state.cHpMax;
          if (oppSetId === "SMOLDERING_SOVEREIGN") smolderingSovereignOnDamageTaken(oppNamedState);
          if (oppSetId === "WINDSTRIDERS_LEGACY") windstridersLegacyOnBigHitTaken(oppNamedState, damage, oppHpMaxNow);
          if (oppSetId === "VOIDBORN_REMNANT") {
            const frenzy = voidbornRemnantCheckFrenzy(oppNamedState, oppHpNow, oppHpMaxNow);
            if (frenzy.triggered) {
              if (isChallenger) { state.dHavocFrenzyAtkMult = frenzy.atkMult; state.dHavocFrenzyLifesteal = frenzy.lifesteal; state.dHavocFrenzyDefIgnore = frenzy.defIgnorePct; }
              else              { state.cHavocFrenzyAtkMult = frenzy.atkMult; state.cHavocFrenzyLifesteal = frenzy.lifesteal; state.cHavocFrenzyDefIgnore = frenzy.defIgnorePct; }
              moveLine += `\n🌑 **Void Frenzy** — ${isChallenger ? state.challengedName : state.challengerName} gains ATK +${Math.floor((frenzy.atkMult - 1) * 100)}%, Lifesteal +${Math.floor(frenzy.lifesteal * 100)}%!`;
            }
          }
          if (oppSetId === "RADIANT_CONVERGENCE") {
            radiantConvergenceOnHitTaken(oppNamedState, damage, oppHpMaxNow);
            const burst = radiantConvergenceCheckBurstHeal(oppNamedState, oppHpNow, oppHpMaxNow);
            if (burst > 0) {
              if (isChallenger) state.dHp = Math.min(state.dHpMax, state.dHp + burst);
              else              state.cHp = Math.min(state.cHpMax, state.cHp + burst);
              moveLine += `\n✨ **Radiant Convergence** — burst-heal +${burst} HP!`;
            }
          }
          if (oppSetId === "FROSTVEIL_BASTION") {
            const counter = frostveilBastionOnHitTaken(oppNamedState);
            if (counter.counterProc) {
              const counterDmg = Math.floor(myHpMax * counter.vibDrain * 0.35);
              if (isChallenger) state.cHp = Math.max(0, state.cHp - counterDmg);
              else              state.dHp = Math.max(0, state.dHp - counterDmg);
              moveLine += `\n❄️ **Counter-Frost** — ${isChallenger ? state.challengedName : state.challengerName} strikes back for ${counterDmg} DMG!`;
            }
            const panic = frostveilBastionCheckPanicShield(oppNamedState, oppHpNow, oppHpMaxNow);
            if (panic.triggered) {
              if (isChallenger) { state.dHp = Math.min(state.dHpMax, state.dHp + panic.shieldAmount); state.dGlacioShieldTurnsLeft = panic.turnsLeft + 1; state.dGlacioShieldElemBonus = panic.elemDmgBonus; }
              else              { state.cHp = Math.min(state.cHpMax, state.cHp + panic.shieldAmount); state.cGlacioShieldTurnsLeft = panic.turnsLeft + 1; state.cGlacioShieldElemBonus = panic.elemDmgBonus; }
              moveLine += `\n❄️ **Frostveil Shield** — ${isChallenger ? state.challengedName : state.challengerName} gains +${panic.shieldAmount} HP, +${Math.floor(panic.elemDmgBonus * 100)}% Glacio DMG for ${panic.turnsLeft} turns!`;
            }
          }
        }

        // Ally KO'd — auto-swap back to the player rather than ending the
        // duel over a benched unit's HP. Checked for whichever side just
        // took damage (the opponent of whoever acted this turn).
        if (isDevGuild) {
          if (isChallenger && state.dActiveUnit === "ally" && state.dAllyHp <= 0) {
            state.dAllyHp = 0; state.dActiveUnit = "player";
            moveLine += `\n◇ **${state.dAllyKit?.label ?? "Their ally"} was knocked out** — ${state.challengedName} swapped back.`;
          } else if (!isChallenger && state.cActiveUnit === "ally" && state.cAllyHp <= 0) {
            state.cAllyHp = 0; state.cActiveUnit = "player";
            moveLine += `\n◇ **${state.cAllyKit?.label ?? "Their ally"} was knocked out** — ${state.challengerName} swapped back.`;
          }
        }

        // Second Wind on opponent (survive lethal once)
        if (isChallenger) {
          if (state.dHp <= 0 && compositeHasSecondWind(state.dBonuses.abilityEffects) && !state.dSecondWindUsed) {
            state.dSecondWindUsed = true; state.dHp = 1;
            moveLine += `\n✦ ${state.challengedName}'s **Undying Will** — survives at 1 HP!`;
          }
        } else {
          if (state.cHp <= 0 && compositeHasSecondWind(state.cBonuses.abilityEffects) && !state.cSecondWindUsed) {
            state.cSecondWindUsed = true; state.cHp = 1;
            moveLine += `\n✦ ${state.challengerName}'s **Undying Will** — survives at 1 HP!`;
          }
        }

        // Spectro Radiance regen — both players heal if they have RADIANCE
        const cRegen = elemRadianceRegen(state.cBonuses.elementPassive, state.cHpMax);
        const dRegen = elemRadianceRegen(state.dBonuses.elementPassive, state.dHpMax);
        if (cRegen > 0) state.cHp = Math.min(state.cHpMax, state.cHp + cRegen);
        if (dRegen > 0) state.dHp = Math.min(state.dHpMax, state.dHp + dRegen);

        // Cooldown tick
        if (isChallenger && state.cSkillCd > 0) state.cSkillCd--;
        else if (!isChallenger && state.dSkillCd > 0) state.dSkillCd--;

        // Named-set buff timers tick down on the acting player's own turns
        if (isChallenger) {
          if (state.cGlacioShieldTurnsLeft > 0) state.cGlacioShieldTurnsLeft--;
          if (state.cRiloDefBuffTurnsLeft > 0) state.cRiloDefBuffTurnsLeft--;
          if (state.cStormBuffTurnsLeft > 0) state.cStormBuffTurnsLeft--;
          if (state.cNamedState.spectroFractureTurnsLeft > 0) state.cNamedState.spectroFractureTurnsLeft--;
          if (state.cEchoSkillCd > 0) state.cEchoSkillCd--;
          if (state.cDefShredTurnsLeft > 0) state.cDefShredTurnsLeft--;
          if (isDevGuild && state.cAttunementDoubleTurnsLeft > 0) state.cAttunementDoubleTurnsLeft--;
          if (isDevGuild && state.cForteEmpoweredTurnsLeft > 0) state.cForteEmpoweredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "duel_swap") state.cNextCritArmed = false;
        } else {
          if (state.dGlacioShieldTurnsLeft > 0) state.dGlacioShieldTurnsLeft--;
          if (state.dRiloDefBuffTurnsLeft > 0) state.dRiloDefBuffTurnsLeft--;
          if (state.dStormBuffTurnsLeft > 0) state.dStormBuffTurnsLeft--;
          if (state.dNamedState.spectroFractureTurnsLeft > 0) state.dNamedState.spectroFractureTurnsLeft--;
          if (state.dEchoSkillCd > 0) state.dEchoSkillCd--;
          if (state.dDefShredTurnsLeft > 0) state.dDefShredTurnsLeft--;
          if (isDevGuild && state.dAttunementDoubleTurnsLeft > 0) state.dAttunementDoubleTurnsLeft--;
          if (isDevGuild && state.dForteEmpoweredTurnsLeft > 0) state.dForteEmpoweredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "duel_swap") state.dNextCritArmed = false;
        }

        // Check win
        const loserHp = isChallenger ? state.dHp : state.cHp;
        if (loserHp <= 0) {
          const winnerName = isChallenger ? state.challengerName : state.challengedName;
          const winnerId   = isChallenger ? state.challengerId   : state.challengedId;
          const finalEmbed = duelEmbed(state, moveLine, color);
          finalEmbed.setTitle("⚔️  Duel Over")
            .setDescription(`**${winnerName}** wins the duel!\n+${WIN_CREDITS} ${CE.cr}  +${WIN_EXP} EXP`);
          await battleMsg.edit({ embeds: [finalEmbed], components: [] });

          // Hybrid visual: result versus card
          const resultCard = await generateVersusCard(
            { name: cName, avatarUrl: cAvatar, element: state.cElement, level: challengerDb.level, hp: state.cHpMax, atk: state.cAtk },
            { name: dName, avatarUrl: dAvatar, element: state.dElement, level: challengedDb.level, hp: state.dHpMax, atk: state.dAtk },
            { winner: winnerId === state.challengerId ? "left" : "right" },
          );
          await thread.send({ files: [new AttachmentBuilder(resultCard, { name: "duel-result.webp" })] }).catch(() => {});

          await cleanup(true, winnerId,
            `🏆 **${winnerName}** defeats **${winnerId === state.challengerId ? state.challengedName : state.challengerName}**!\n+${WIN_CREDITS} ${CE.cr}  +${WIN_EXP} EXP`);
          return;
        }

        // Switch turns
        state.currentTurn = isChallenger ? state.challengedId : state.challengerId;
        state.turn++;

        const updated = duelEmbed(state, moveLine, color);
        const newMsg  = await thread.send({
          content:    `<@${state.currentTurn}>`,
          embeds:     [updated],
          components: buildDuelButtons(state, state.currentTurn, isDevGuild),
        });
        await battleMsg.edit({ components: [] }).catch(() => {});
        battleMsg = newMsg;

        runDuelTurn();
      });

      collector.on("end", async (_, reason) => {
        if (reason === "time") {
          const timeoutUserId = state.currentTurn;
          const winnerName    = timeoutUserId === state.challengerId ? state.challengedName : state.challengerName;
          const winnerId      = timeoutUserId === state.challengerId ? state.challengedId   : state.challengerId;
          await battleMsg.edit({
            embeds: [new EmbedBuilder().setColor(color)
              .setTitle("⚔️  Duel — Timeout")
              .setDescription(`**${timeoutUserId === state.challengerId ? state.challengerName : state.challengedName}** didn't act in time.\n**${winnerName}** wins by default!`)
              .setFooter({ text: "CARTETHYIA  ·  Duel" })],
            components: [],
          });
          await cleanup(true, winnerId,
            `⏱️ **${timeoutUserId === state.challengerId ? state.challengerName : state.challengedName}** timed out.\n🏆 **${winnerName}** wins by default! +${WIN_CREDITS} ${CE.cr}  +${WIN_EXP} EXP`);
        }
      });
    };

    runDuelTurn();
  });

  challengeCollector?.on("end", async (col) => {
    if (col.size === 0) {
      releaseLock(interaction.user.id);
      releaseLock(target.id);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription(`**${dName}** didn't respond in time. Challenge expired.`)
          .setFooter({ text: "CARTETHYIA  ·  Duel" })],
        components: [],
      }).catch(() => {});
    }
  });
}
