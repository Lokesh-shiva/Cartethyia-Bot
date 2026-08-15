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
import {
  resolveRoster, nextAliveFallback, isTeamWiped, swappableTargets, positionLabel, positionValue,
  ResolvedRoster, PositionIndex,
} from "../../lib/teamPositions";
import { StringSelectMenuBuilder, StringSelectMenuInteraction } from "discord.js";

interface DuelAllyBundle {
  characterId: string; kit: PlayableCharacterKit; hp: number; hpMax: number;
  mechanicState: unknown; basicLevel: number; skillLevel: number; ultimateLevel: number;
  introLevel: number; forteLevel: number; constellation: number; solaceStats: any;
}

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
  // Legacy "player"|"ally" flag — kept exactly as before so the ~900 lines of
  // per-character dispatch logic below don't need to change at all. Derived
  // each turn from cActivePosition/cRoster via syncSide(); the REAL source of
  // truth for which of the 3 roster positions is active is cActivePosition.
  cActiveUnit: "player" | "ally"; cAllyHp: number; cAllyHpMax: number;
  cActivePosition: PositionIndex; cRoster: ResolvedRoster; cAllyBundles: Partial<Record<PositionIndex, DuelAllyBundle>>;
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
  dActivePosition: PositionIndex; dRoster: ResolvedRoster; dAllyBundles: Partial<Record<PositionIndex, DuelAllyBundle>>;
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

// Each side's field must show whichever unit is CURRENTLY active, not
// always the literal player — otherwise a swapped-in ally's HP never
// appears anywhere prominent (same bug already fixed in the battle-card
// loops and raid.ts's Resonators list).
function duelActiveIdentity(state: DuelState, isChallenger: boolean): { name: string; element: string; hp: number; hpMax: number } {
  const activeUnit = isChallenger ? state.cActiveUnit : state.dActiveUnit;
  if (activeUnit === "player") {
    return isChallenger
      ? { name: state.challengerName, element: state.cElement, hp: state.cHp, hpMax: state.cHpMax }
      : { name: state.challengedName, element: state.dElement, hp: state.dHp, hpMax: state.dHpMax };
  }
  const kit = isChallenger ? state.cAllyKit : state.dAllyKit;
  const hp = isChallenger ? state.cAllyHp : state.dAllyHp;
  const hpMax = isChallenger ? state.cAllyHpMax : state.dAllyHpMax;
  const ownerName = isChallenger ? state.challengerName : state.challengedName;
  return { name: kit ? `${ownerName}'s ${kit.label}` : ownerName, element: kit?.element ?? (isChallenger ? state.cElement : state.dElement), hp, hpMax };
}

function duelEmbed(state: DuelState, lastMove: string, _color: number): EmbedBuilder {
  const turnName  = state.currentTurn === state.challengerId ? state.challengerName : state.challengedName;
  const turnElem  = state.currentTurn === state.challengerId ? state.cElement : state.dElement;
  const themeColor = ELEMENT_DUEL_HEX[turnElem] ?? 0x6366F1;

  const cTurn = state.currentTurn === state.challengerId ? "▸ " : "";
  const dTurn = state.currentTurn === state.challengedId ? "▸ " : "";
  const cActive = duelActiveIdentity(state, true);
  const dActive = duelActiveIdentity(state, false);

  return new EmbedBuilder()
    .setColor(themeColor)
    .setTitle(`⚔️  Duel  ·  Turn ${state.turn}`)
    .addFields(
      {
        name:   `${cTurn}${elementEmoji(cActive.element)}  ${cActive.name}`,
        value:  `${hpBar(cActive.hp, cActive.hpMax)}\n` +
                `\`HP ${cActive.hp}/${cActive.hpMax}\`\n` +
                `⚡ ${energyBar(state.cEnergy)} ${state.cEnergy}${state.cSkillCd > 0 ? `   ✦cd ${state.cSkillCd}` : ""}`,
        inline: true,
      },
      {
        name:   `${dTurn}${elementEmoji(dActive.element)}  ${dActive.name}`,
        value:  `${hpBar(dActive.hp, dActive.hpMax)}\n` +
                `\`HP ${dActive.hp}/${dActive.hpMax}\`\n` +
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
  if (state.cHasSolace) lines.push(duelSideStatusLine(state, true));
  if (state.dHasSolace) lines.push(duelSideStatusLine(state, false));
  return lines.length > 0 ? lines.join("\n") : null;
}

// With 3 positions there can be up to 2 benched units at once on a side —
// this line only has room for one, so it shows whichever benched bundle
// exists first (position order), same tradeoff ascend.ts's teamStatusLine
// makes.
function duelSideStatusLine(state: DuelState, isChallenger: boolean): string {
  const name           = isChallenger ? state.challengerName : state.challengedName;
  const activeUnit      = isChallenger ? state.cActiveUnit : state.dActiveUnit;
  const activePosition   = isChallenger ? state.cActivePosition : state.dActivePosition;
  const roster             = isChallenger ? state.cRoster : state.dRoster;
  const allyBundles          = isChallenger ? state.cAllyBundles : state.dAllyBundles;
  const concertoEnergy         = isChallenger ? state.cConcertoEnergy : state.dConcertoEnergy;
  const debuffs                  = isChallenger ? state.cPlayerDebuffs : state.dPlayerDebuffs;
  const allyKit                    = isChallenger ? state.cAllyKit : state.dAllyKit;
  const allyHp                      = isChallenger ? state.cAllyHp : state.dAllyHp;
  const allyHpMax                    = isChallenger ? state.cAllyHpMax : state.dAllyHpMax;
  const allyMechanicState              = isChallenger ? state.cAllyMechanicState : state.dAllyMechanicState;

  const debuffLine = debuffs.length > 0 ? `  ·  ${debuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}` : "";
  const soloLine = activeUnit === "ally" && allyKit ? `  ·  ${allyKit.label} ${allyHp}/${allyHpMax} HP` : "";
  const kitLine = allyKit ? `  ·  ${allyKit.statusLineText(allyMechanicState)}` : "";

  const benchPositions = ([1, 2, 3] as PositionIndex[]).filter(p => p !== activePosition && allyBundles[p]);
  const benchBundle = benchPositions.length > 0 ? allyBundles[benchPositions[0]]! : null;
  const benchLine = benchBundle ? `  ·  Benched: ${benchBundle.kit.label} ${benchBundle.hp}/${benchBundle.hpMax} HP` : "";

  return `🔄 **${name}**: Concerto Energy **${concertoEnergy}/100**${soloLine}${kitLine}${benchLine}${debuffLine}`;
}

// CRITICAL: real read-only ownership lookup, NOT getOrCreateCharacterProgress
// — that helper CREATES a row if missing, which would silently re-grant
// ownership to anyone whose roster names a character they don't own,
// bypassing the gacha entirely.
async function buildDuelSideRoster(
  userId: string,
  dbRow: { teamPosition1: string | null; teamPosition2: string | null; teamPosition3: string | null },
): Promise<{ roster: ResolvedRoster; bundles: Partial<Record<PositionIndex, DuelAllyBundle>>; hasSolace: boolean }> {
  const roster: ResolvedRoster = resolveRoster(dbRow);
  const bundles: Partial<Record<PositionIndex, DuelAllyBundle>> = {};
  for (const pos of ([1, 2, 3] as PositionIndex[])) {
    const value = positionValue(roster, pos);
    if (value === null || value === "self") continue;
    const kit = CHARACTER_KITS[value];
    if (!kit) continue;
    const progress = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId, characterId: value } },
    });
    if (!progress) continue; // not actually owned — treat this position as unfilled
    const solaceStats = await kit.resolveStats(userId);
    // Use the ally's own gear/level-resolved HP, not the fixed level-90 base.
    const hpMax = solaceStats.hp;
    bundles[pos] = {
      characterId: value, kit, hp: hpMax, hpMax, mechanicState: kit.createInitialMechanicState(),
      basicLevel: progress.basicLevel ?? 1, skillLevel: progress.skillLevel ?? 1, ultimateLevel: progress.ultimateLevel ?? 1,
      introLevel: progress.introLevel ?? 1, forteLevel: progress.forteLevel ?? 1, constellation: progress.constellation ?? 0,
      solaceStats,
    };
  }
  return { roster, bundles, hasSolace: Object.keys(bundles).length > 0 };
}

function duelPositionHp(state: DuelState, isChallenger: boolean, pos: PositionIndex): number {
  const roster  = isChallenger ? state.cRoster : state.dRoster;
  const bundles = isChallenger ? state.cAllyBundles : state.dAllyBundles;
  const selfHp  = isChallenger ? state.cHp : state.dHp;
  return positionValue(roster, pos) === "self" ? selfHp : (bundles[pos]?.hp ?? 0);
}

function buildDuelButtons(state: DuelState, forUserId: string, isDevGuild: boolean): (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] {
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
  const myActiveAllyCharacterId = isChallenger ? state.cActiveAllyCharacterId : state.dActiveAllyCharacterId;
  const myRoster                = isChallenger ? state.cRoster : state.dRoster;
  const myActivePosition        = isChallenger ? state.cActivePosition : state.dActivePosition;

  const rows: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] = [];

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
    const targets = swappableTargets(myRoster, myActivePosition)
      .filter(pos => duelPositionHp(state, isChallenger, pos) > 0);
    if (targets.length === 1) {
      const pos = targets[0];
      const label = positionLabel(myRoster, pos, myName, id => CHARACTER_KITS[id]?.label ?? null);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`duel_swap_${pos}`).setLabel(`🔄  Swap to ${label}`).setStyle(ButtonStyle.Secondary),
      ));
    } else if (targets.length > 1) {
      const select = new StringSelectMenuBuilder().setCustomId("duel_swap_select").setPlaceholder("🔄  Swap to…")
        .addOptions(targets.map(pos => ({
          label: positionLabel(myRoster, pos, myName, id => CHARACTER_KITS[id]?.label ?? null),
          value: `${pos}`,
        })));
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }
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

export async function startDuelMatch(
  challengerId: string, challengedId: string, isPublic: boolean,
  challengerDb: any, challengedDb: any,
  cBonuses: PlayerBonuses, dBonuses: PlayerBonuses,
  cStats: ResolvedStats, dStats: ResolvedStats,
  cName: string, dName: string, cAvatar: string, dAvatar: string,
  guildId: string, channel: TextChannel,
  postStatus: (payload: any) => Promise<any>,
  onComplete?: (winnerId: string | null, threadId: string) => void,
  onThreadCreated?: (threadId: string) => void,
): Promise<void> {
    await postStatus({ components: [] });

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
    // ownership to anyone whose roster names a character they don't own,
    // bypassing the gacha entirely.
    //
    // Full any-to-any 3-position swapping: each side gets its own resolved
    // roster + a bundle per owned, non-"self" filled position. activePosition
    // always starts at Position 1 (matches the roster order set via /team —
    // /team only lets you pick owned characters, so if Position 1 names a
    // character, its bundle is guaranteed to exist).
    const [cSide, dSide] = await Promise.all([
      buildDuelSideRoster(challengerId, challengerDb),
      buildDuelSideRoster(challengedId, challengedDb),
    ]);
    const isDevGuild = cSide.hasSolace || dSide.hasSolace;
    const cActivePosition: PositionIndex = 1;
    const dActivePosition: PositionIndex = 1;
    const cInitialBundle = positionValue(cSide.roster, cActivePosition) === "self" ? null : (cSide.bundles[cActivePosition] ?? null);
    const dInitialBundle = positionValue(dSide.roster, dActivePosition) === "self" ? null : (dSide.bundles[dActivePosition] ?? null);
    const cHasSolaceGate = cSide.hasSolace;
    const dHasSolaceGate = dSide.hasSolace;
    const cActiveAllyCharacterId = cInitialBundle?.characterId ?? null;
    const dActiveAllyCharacterId = dInitialBundle?.characterId ?? null;
    const cAllyKit: PlayableCharacterKit | null = cInitialBundle?.kit ?? null;
    const dAllyKit: PlayableCharacterKit | null = dInitialBundle?.kit ?? null;
    const cAllySolaceStats = cInitialBundle?.solaceStats as (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null;
    const dAllySolaceStats = dInitialBundle?.solaceStats as (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null;

    const state: DuelState = {
      challengerId: challengerId, challengedId: challengedId,
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
      cSolaceBasicLevel: cInitialBundle?.basicLevel ?? 1, cSolaceSkillLevel: cInitialBundle?.skillLevel ?? 1,
      cSolaceUltimateLevel: cInitialBundle?.ultimateLevel ?? 1, cSolaceIntroLevel: cInitialBundle?.introLevel ?? 1,
      cSolaceForteLevel: cInitialBundle?.forteLevel ?? 1,
      cSolaceConstellation: cInitialBundle?.constellation ?? 0,
      cActiveUnit: cInitialBundle ? "ally" : "player", cAllyHp: cInitialBundle?.hp ?? 0, cAllyHpMax: cInitialBundle?.hpMax ?? 0,
      cActivePosition, cRoster: cSide.roster, cAllyBundles: cSide.bundles,
      cConcertoEnergy: 0, cPlayerDebuffs: [],
      cAttunement: { mode: null }, cAttunementDoubleTurnsLeft: 0,
      cSolaceForte: { phase: 0, charge: 0 }, cForteEmpoweredTurnsLeft: 0,
      cActiveAllyCharacterId, cAllyKit, cAllyMechanicState: cInitialBundle?.mechanicState ?? null,
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
      dSolaceBasicLevel: dInitialBundle?.basicLevel ?? 1, dSolaceSkillLevel: dInitialBundle?.skillLevel ?? 1,
      dSolaceUltimateLevel: dInitialBundle?.ultimateLevel ?? 1, dSolaceIntroLevel: dInitialBundle?.introLevel ?? 1,
      dSolaceForteLevel: dInitialBundle?.forteLevel ?? 1,
      dSolaceConstellation: dInitialBundle?.constellation ?? 0,
      dActiveUnit: dInitialBundle ? "ally" : "player", dAllyHp: dInitialBundle?.hp ?? 0, dAllyHpMax: dInitialBundle?.hpMax ?? 0,
      dActivePosition, dRoster: dSide.roster, dAllyBundles: dSide.bundles,
      dConcertoEnergy: 0, dPlayerDebuffs: [],
      dAttunement: { mode: null }, dAttunementDoubleTurnsLeft: 0,
      dSolaceForte: { phase: 0, charge: 0 }, dForteEmpoweredTurnsLeft: 0,
      dActiveAllyCharacterId, dAllyKit, dAllyMechanicState: dInitialBundle?.mechanicState ?? null,
      // Higher SPD acts first; ties keep the challenger-first default
      currentTurn: dStats.spd > cStats.spd ? challengedId : challengerId,
      turn: 1,
    };

    // Create thread (public or private based on user choice)
    let thread;
    try {
      thread = await (channel as TextChannel).threads.create({
        name:                `⚔️ ${cName} vs ${dName}`,
        autoArchiveDuration: 60,
        type:                isPublic ? ChannelType.PublicThread : ChannelType.PrivateThread,
      });
      await thread.members.add(challengerId);
      await thread.members.add(challengedId);
      await registerFight(challengerId, thread.id, guildId, "Duel");
      await registerFight(challengedId, thread.id, guildId, "Duel");
      onThreadCreated?.(thread.id);
    } catch {
      releaseLock(challengerId);
      releaseLock(challengedId);
      await postStatus({ content: "I need **Create Threads** + **Send Messages in Threads** permissions here to run the duel. Ask an admin, or try another channel.", embeds: [], components: [] }).catch(() => {});
      return;
    }

    await postStatus({
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
      content: `<@${challengerId}> <@${challengedId}>`,
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
      releaseLock(challengerId);
      releaseLock(challengedId);
      await clearFight(challengerId);
      await clearFight(challengedId);
      if (won && winnerId) {
        const loserId = winnerId === challengerId ? challengedId : challengerId;
        await awardUser(winnerId, { credits: WIN_CREDITS, resonanceExp: WIN_EXP }, "duel");
        await prisma.user.update({ where: { id: winnerId }, data: { duelWins:   { increment: 1 } } }).catch(() => {});
        await prisma.user.update({ where: { id: loserId },  data: { duelLosses: { increment: 1 } } }).catch(() => {});
        await incrementWeaponBond(winnerId).catch(() => null);
      }
      // Post outcome back to the original channel
      await postStatus({
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
      onComplete?.(won ? winnerId : null, thread.id);
    };

    const runDuelTurn = () => {
      const turnUserId = state.currentTurn;

      const collector = battleMsg.createMessageComponentCollector({
        time:   10 * 60 * 1000,
        max:    1,
        filter: (b: any) => {
          if (b.user.id !== turnUserId) {
            b.reply({ content: "It's not your turn.", flags: 64 }).catch(() => {});
            return false;
          }
          return true;
        },
      });

      collector.on("collect", async (btn: ButtonInteraction | StringSelectMenuInteraction) => {
        await btn.deferUpdate();

        const isChallenger = turnUserId === state.challengerId;
        // Swap is either a single button (duel_swap_<pos>) or a select menu
        // (duel_swap_select, value = position) depending on how many valid
        // swap targets buildDuelButtons found this render.
        const isSwapAction = btn.customId === "duel_swap_select" || btn.customId.startsWith("duel_swap_");
        const swapTargetPos: PositionIndex | null = btn.customId === "duel_swap_select"
          ? (Number((btn as StringSelectMenuInteraction).values[0]) as PositionIndex)
          : btn.customId.startsWith("duel_swap_")
          ? (Number(btn.customId.replace("duel_swap_", "")) as PositionIndex)
          : null;
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
        // Captured now, appended after moveLine's branch-specific assignment
        // (which OVERWRITES moveLine, not appends) — see the append near the
        // shared damage-tail below.
        let radiantTurnHealAmount = 0;
        if (mySetId === "RADIANT_CONVERGENCE") {
          const heal = radiantConvergenceOnTurnHeal(myNamedState, myHpMax, myBonus.healingBonus);
          if (isChallenger) state.cHp = Math.min(state.cHpMax, state.cHp + heal.healAmount);
          else              state.dHp = Math.min(state.dHpMax, state.dHp + heal.healAmount);
          radiantDmgMult = heal.dmgMult;
          radiantTurnHealAmount = heal.healAmount;
          myHp = isChallenger ? state.cHp : state.dHp;
        }

        let damage = 0;
        let moveLine = "";

        // Debuffs tick down at the start of the acting side's own turn.
        if (isDevGuild) {
          const tickResult = tickDebuffs(myPlayerDebuffs);
          if (isChallenger) state.cPlayerDebuffs = tickResult.state; else state.dPlayerDebuffs = tickResult.state;
        }

        // Any-to-any 3-position swap — always consumes the turn, falls through
        // to the shared tail below, same as every other action. Resolves BOTH
        // outgoing and incoming units independently by PositionIndex, since a
        // swap can be ally-to-ally (neither side being the currently-active
        // legacy-synced unit).
        if (isSwapAction && swapTargetPos !== null && isDevGuild && myHasSolace) {
          const myRoster       = isChallenger ? state.cRoster : state.dRoster;
          const myAllyBundles  = isChallenger ? state.cAllyBundles : state.dAllyBundles;
          const myActivePos    = isChallenger ? state.cActivePosition : state.dActivePosition;
          const outgoingIsPlayer = positionValue(myRoster, myActivePos) === "self";
          const incomingIsPlayer = positionValue(myRoster, swapTargetPos) === "self";
          const incomingBundle = incomingIsPlayer ? null : (myAllyBundles[swapTargetPos] ?? null);
          const incomingCharacterId = incomingBundle?.characterId ?? null;
          const comboReady = myConcertoEnergy >= 100;

          if (comboReady && (outgoingIsPlayer || myAllyKit) && (incomingIsPlayer || incomingBundle)) {
            const incomingHpBefore = incomingIsPlayer ? myHp : (incomingBundle?.hp ?? 0);
            const incomingHpMaxVal = incomingIsPlayer ? myHpMax : (incomingBundle?.hpMax ?? 0);
            const incomingTarget: AllyActionTarget = { hp: incomingHpBefore, hpMax: incomingHpMaxVal };

            const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : myAllyKit!.outroEffect(mySolaceConstellation);
            const introEffect: IntroOutroEffect = incomingIsPlayer ? PLAYER_SELF_INTRO : incomingBundle!.kit.introEffect(incomingBundle!.introLevel, incomingBundle!.constellation);
            const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
            const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

            // Incoming-side mechanic grants — gated on the INCOMING unit's own
            // identity (not the outgoing unit's), fixing a pre-existing dead-code
            // bug: these were previously gated on myActiveAllyCharacterId (the
            // OUTGOING ally's id), which is null whenever the player swaps out,
            // so Vesper/Rilo's intro grants never actually fired in that case.
            let incomingMechanicState: unknown = incomingBundle?.mechanicState ?? null;
            if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "kaelith") {
              const grant = (introEffect.newMechanicState as any).grantStacksOnIntro as number | undefined;
              if (grant) {
                const cur = (incomingMechanicState as KaelithMechanicState).stacks;
                const cap = kaelithStackCap(incomingBundle!.constellation);
                incomingMechanicState = { ...(incomingMechanicState as KaelithMechanicState), stacks: Math.min(cap, cur + grant) };
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
            if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "vesper") {
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
            if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "rilo") {
              const grant = (introEffect.newMechanicState as any).grantShieldOnIntro as number | undefined;
              if (grant) {
                const rIncoming = incomingMechanicState as RiloMechanicState;
                incomingMechanicState = { ...rIncoming, shield: Math.min(riloMaxShield(incomingBundle!.constellation), rIncoming.shield + grant) };
              }
            }

            if (!incomingIsPlayer) {
              if (isChallenger) state.cNextCritArmed = true; else state.dNextCritArmed = true;
            }

            const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta + riloShieldTransferBonus;
            const incomingHpAfter = Math.min(incomingHpMaxVal, incomingHpBefore + totalBonus);
            const actualGain = incomingHpAfter - incomingHpBefore;

            // Commit the OUTGOING unit's final state into its bundle slot
            // BEFORE overwriting the legacy fields with the incoming unit —
            // the outgoing bundle only needs an entry if it's a real ally
            // (the player's own HP already lives in state.cHp/dHp directly).
            if (!outgoingIsPlayer && myAllyBundles[myActivePos]) {
              myAllyBundles[myActivePos]!.hp = myAllyHpVal;
              myAllyBundles[myActivePos]!.mechanicState = isChallenger ? state.cAllyMechanicState : state.dAllyMechanicState;
            }
            // Write the incoming unit's post-combo HP into ITS bundle slot too
            // (or into state.cHp/dHp if incoming is the player) — legacy-field
            // sync below then reads it back out, keeping one source of truth.
            if (!incomingIsPlayer && incomingBundle) {
              incomingBundle.hp = incomingHpAfter;
              incomingBundle.mechanicState = incomingMechanicState;
            } else if (incomingIsPlayer) {
              if (isChallenger) state.cHp = incomingHpAfter; else state.dHp = incomingHpAfter;
            }

            moveLine = actualGain > 0
              ? `${myName} — 🔄 Swapped to **${incomingIsPlayer ? myName : incomingBundle!.kit.label}** — Outro+Intro combo! +${actualGain} HP.`
              : `${myName} — 🔄 Swapped to **${incomingIsPlayer ? myName : incomingBundle!.kit.label}** — Outro+Intro combo! (already full HP, no heal needed)`;
            const newConcerto = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART
            if (isChallenger) state.cConcertoEnergy = newConcerto; else state.dConcertoEnergy = newConcerto;
          } else {
            const incomingLabel = incomingIsPlayer ? myName : (incomingBundle?.kit.label ?? "Ally");
            moveLine = `${myName} — 🔄 Swapped to **${incomingLabel}** — Concerto Energy not full, no combo triggered.`;
            // No combo — still commit outgoing state and move incoming's
            // stored HP/mechanicState in as-is (no heal/buff applied).
            if (!outgoingIsPlayer && myAllyBundles[myActivePos]) {
              myAllyBundles[myActivePos]!.hp = myAllyHpVal;
              myAllyBundles[myActivePos]!.mechanicState = isChallenger ? state.cAllyMechanicState : state.dAllyMechanicState;
            }
          }

          // Resync the legacy fields from whichever position is now active.
          const finalBundle = incomingIsPlayer ? null : (myAllyBundles[swapTargetPos] ?? incomingBundle);
          if (isChallenger) {
            state.cActivePosition = swapTargetPos;
            state.cActiveUnit = incomingIsPlayer ? "player" : "ally";
            state.cActiveAllyCharacterId = finalBundle?.characterId ?? null;
            state.cAllyKit = finalBundle?.kit ?? null;
            state.cAllyHp = finalBundle?.hp ?? 0;
            state.cAllyHpMax = finalBundle?.hpMax ?? 0;
            state.cAllyMechanicState = finalBundle?.mechanicState ?? null;
            state.cSolaceBasicLevel = finalBundle?.basicLevel ?? 1;
            state.cSolaceSkillLevel = finalBundle?.skillLevel ?? 1;
            state.cSolaceUltimateLevel = finalBundle?.ultimateLevel ?? 1;
            state.cSolaceIntroLevel = finalBundle?.introLevel ?? 1;
            state.cSolaceForteLevel = finalBundle?.forteLevel ?? 1;
            state.cSolaceConstellation = finalBundle?.constellation ?? 0;
            state.cAllySolaceStats = finalBundle?.solaceStats ?? null;
          } else {
            state.dActivePosition = swapTargetPos;
            state.dActiveUnit = incomingIsPlayer ? "player" : "ally";
            state.dActiveAllyCharacterId = finalBundle?.characterId ?? null;
            state.dAllyKit = finalBundle?.kit ?? null;
            state.dAllyHp = finalBundle?.hp ?? 0;
            state.dAllyHpMax = finalBundle?.hpMax ?? 0;
            state.dAllyMechanicState = finalBundle?.mechanicState ?? null;
            state.dSolaceBasicLevel = finalBundle?.basicLevel ?? 1;
            state.dSolaceSkillLevel = finalBundle?.skillLevel ?? 1;
            state.dSolaceUltimateLevel = finalBundle?.ultimateLevel ?? 1;
            state.dSolaceIntroLevel = finalBundle?.introLevel ?? 1;
            state.dSolaceForteLevel = finalBundle?.forteLevel ?? 1;
            state.dSolaceConstellation = finalBundle?.constellation ?? 0;
            state.dAllySolaceStats = finalBundle?.solaceStats ?? null;
          }
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
            const scaledEchoHeal = Math.floor(echoResult.healHp * (1 + myBonus.healingBonus));
            if (isChallenger) state.cHp = Math.min(state.cHpMax, state.cHp + scaledEchoHeal);
            else              state.dHp = Math.min(state.dHpMax, state.dHp + scaledEchoHeal);
            const myRoster = isChallenger ? state.cRoster : state.dRoster;
            const myActivePos = isChallenger ? state.cActivePosition : state.dActivePosition;
            const myAllyBundlesForHeal = isChallenger ? state.cAllyBundles : state.dAllyBundles;
            const benchPos = ([1, 2, 3] as PositionIndex[]).find(pos => pos !== myActivePos && myAllyBundlesForHeal[pos] && myAllyBundlesForHeal[pos]!.hp > 0);
            if (benchPos) {
              const b = myAllyBundlesForHeal[benchPos]!;
              b.hp = Math.min(b.hpMax, b.hp + scaledEchoHeal);
              moveLine += `\n💚 +${scaledEchoHeal} HP (also healed ${b.kit.label})`;
            } else {
              moveLine += `\n💚 +${scaledEchoHeal} HP`;
            }
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
        const ar: AbilityAttackResult = isSwapAction
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
        if (state.turn === 1 && mySpd > oppSpd && !isSwapAction &&
            !(btn.customId === "duel_ultimate" && isDevGuild && myActiveUnit === "ally" && myActiveAllyCharacterId === "solace")) {
          const bonusDmg = Math.floor(damage * 0.15);
          damage += bonusDmg;
          moveLine += `\n⚡ **First Strike** — you got the jump on them! +${bonusDmg} bonus DMG!`;
        }

        if (radiantTurnHealAmount > 0) moveLine += `\n✨ Radiant Convergence — turn-heal +${radiantTurnHealAmount} HP!`;
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
          if (!isSwapAction) state.cFirstAction = false;
        } else {
          state.dHp = Math.min(state.dHpMax, state.dHp + Math.max(0, healed));
          state.dEnergy = Math.min(100, state.dEnergy + ar.bonusEnergy);
          if (!isSwapAction) state.dFirstAction = false;
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
        if (!isSwapAction) {
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
            const burst = radiantConvergenceCheckBurstHeal(oppNamedState, oppHpNow, oppHpMaxNow, oppBonus.healingBonus);
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

        // Active unit KO'd — auto-fallback to the next alive position in
        // 1->2->3->1 order (not always back to the player) rather than ending
        // the duel over one benched unit's HP. If NO other position is alive,
        // isTeamWiped() below catches the genuine loss. Checked for whichever
        // side just took damage (the opponent of whoever acted this turn).
        const applyDuelKoFallback = (defenderIsChallenger: boolean) => {
          const roster       = defenderIsChallenger ? state.cRoster : state.dRoster;
          const activePos     = defenderIsChallenger ? state.cActivePosition : state.dActivePosition;
          const bundles         = defenderIsChallenger ? state.cAllyBundles : state.dAllyBundles;
          const defenderName      = defenderIsChallenger ? state.challengerName : state.challengedName;
          const koLabel             = (defenderIsChallenger ? state.cAllyKit : state.dAllyKit)?.label ?? "Their ally";
          const fallback = nextAliveFallback(roster, activePos, pos => duelPositionHp(state, defenderIsChallenger, pos));
          if (fallback === null) return; // team wiped — loss handled below
          const bundle = positionValue(roster, fallback) === "self" ? null : (bundles[fallback] ?? null);
          const fields = {
            ActivePosition: fallback,
            ActiveUnit: (bundle ? "ally" : "player") as "player" | "ally",
            ActiveAllyCharacterId: bundle?.characterId ?? null,
            AllyKit: bundle?.kit ?? null,
            AllyHp: bundle?.hp ?? 0,
            AllyHpMax: bundle?.hpMax ?? 0,
            AllyMechanicState: bundle?.mechanicState ?? null,
            SolaceBasicLevel: bundle?.basicLevel ?? 1,
            SolaceSkillLevel: bundle?.skillLevel ?? 1,
            SolaceUltimateLevel: bundle?.ultimateLevel ?? 1,
            SolaceIntroLevel: bundle?.introLevel ?? 1,
            SolaceForteLevel: bundle?.forteLevel ?? 1,
            SolaceConstellation: bundle?.constellation ?? 0,
            AllySolaceStats: bundle?.solaceStats ?? null,
          };
          if (defenderIsChallenger) {
            state.cActivePosition = fields.ActivePosition; state.cActiveUnit = fields.ActiveUnit;
            state.cActiveAllyCharacterId = fields.ActiveAllyCharacterId; state.cAllyKit = fields.AllyKit;
            state.cAllyHp = fields.AllyHp; state.cAllyHpMax = fields.AllyHpMax; state.cAllyMechanicState = fields.AllyMechanicState;
            state.cSolaceBasicLevel = fields.SolaceBasicLevel; state.cSolaceSkillLevel = fields.SolaceSkillLevel;
            state.cSolaceUltimateLevel = fields.SolaceUltimateLevel; state.cSolaceIntroLevel = fields.SolaceIntroLevel;
            state.cSolaceForteLevel = fields.SolaceForteLevel; state.cSolaceConstellation = fields.SolaceConstellation;
            state.cAllySolaceStats = fields.AllySolaceStats;
          } else {
            state.dActivePosition = fields.ActivePosition; state.dActiveUnit = fields.ActiveUnit;
            state.dActiveAllyCharacterId = fields.ActiveAllyCharacterId; state.dAllyKit = fields.AllyKit;
            state.dAllyHp = fields.AllyHp; state.dAllyHpMax = fields.AllyHpMax; state.dAllyMechanicState = fields.AllyMechanicState;
            state.dSolaceBasicLevel = fields.SolaceBasicLevel; state.dSolaceSkillLevel = fields.SolaceSkillLevel;
            state.dSolaceUltimateLevel = fields.SolaceUltimateLevel; state.dSolaceIntroLevel = fields.SolaceIntroLevel;
            state.dSolaceForteLevel = fields.SolaceForteLevel; state.dSolaceConstellation = fields.SolaceConstellation;
            state.dAllySolaceStats = fields.AllySolaceStats;
          }
          const fallbackLabel = bundle ? bundle.kit.label : defenderName;
          moveLine += `\n◇ **${koLabel} was knocked out** — ${defenderName}'s team falls back to **${fallbackLabel}**.`;
        };
        if (isDevGuild) {
          if (isChallenger && state.dActiveUnit === "ally" && state.dAllyHp <= 0) {
            state.dAllyHp = 0; applyDuelKoFallback(false);
          } else if (!isChallenger && state.cActiveUnit === "ally" && state.cAllyHp <= 0) {
            state.cAllyHp = 0; applyDuelKoFallback(true);
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
          if (forcedCritActive && !isSwapAction) state.cNextCritArmed = false;
        } else {
          if (state.dGlacioShieldTurnsLeft > 0) state.dGlacioShieldTurnsLeft--;
          if (state.dRiloDefBuffTurnsLeft > 0) state.dRiloDefBuffTurnsLeft--;
          if (state.dStormBuffTurnsLeft > 0) state.dStormBuffTurnsLeft--;
          if (state.dNamedState.spectroFractureTurnsLeft > 0) state.dNamedState.spectroFractureTurnsLeft--;
          if (state.dEchoSkillCd > 0) state.dEchoSkillCd--;
          if (state.dDefShredTurnsLeft > 0) state.dDefShredTurnsLeft--;
          if (isDevGuild && state.dAttunementDoubleTurnsLeft > 0) state.dAttunementDoubleTurnsLeft--;
          if (isDevGuild && state.dForteEmpoweredTurnsLeft > 0) state.dForteEmpoweredTurnsLeft--;
          if (forcedCritActive && !isSwapAction) state.dNextCritArmed = false;
        }

        // Check win — every filled roster position on the defender's side
        // knocked out, not just their own literal HP. /team lets a player
        // fully bench themselves (no "self" in any position), in which case
        // their own HP field never takes damage and never changes — checking
        // it alone would make the duel unwinnable against such a roster.
        const loserRoster = isChallenger ? state.dRoster : state.cRoster;
        const loserWiped = isTeamWiped(loserRoster, pos => duelPositionHp(state, !isChallenger, pos));
        if (loserWiped) {
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
}

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
      select: { baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true, critRate: true, critDmg: true, element: true, level: true, dispatchStatus: true, dispatchEndsAt: true, teamPosition1: true, teamPosition2: true, teamPosition3: true },
    }),
    prisma.user.findUnique({
      where:  { id: target.id },
      select: { baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true, critRate: true, critDmg: true, element: true, level: true, teamPosition1: true, teamPosition2: true, teamPosition3: true },
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
    await startDuelMatch(
      interaction.user.id, target.id, isPublic,
      challengerDb, challengedDb, cBonuses, dBonuses, cStats, dStats,
      cName, dName, cAvatar, dAvatar,
      interaction.guildId!, interaction.channel as TextChannel,
      (payload: any) => interaction.editReply(payload),
    );
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
