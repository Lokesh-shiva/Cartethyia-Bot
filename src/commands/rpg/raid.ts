import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ChannelType,
  AttachmentBuilder, PermissionFlagsBits,
} from "discord.js";
import * as path from "path";
import * as fs   from "fs";
import prisma    from "../../lib/prisma";
import { getBoss, scaledBoss }      from "../../lib/bosses";
import { ALL_FIELD_BOSSES, FieldBoss }  from "../../lib/fieldBosses";
import { calcPlayerDamage, calcEnemyDamage, hpBar, buildRewardText } from "../../lib/combat";
import { awardUser } from "../../lib/economy";
import { registerFight, clearFight } from "../../lib/fightTracker";
import {
  resolvePlayerBonuses, applyBonuses, applyAbilityAttack,
  abilityCritRate, abilityVib, applyLifesteal, PlayerBonuses,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit,
  effectiveSkillCooldown, ResolvedStats,
} from "../../lib/setBonus";
import { compositeHasSecondWind } from "../../lib/abilityEffects";
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
import { incrementWeaponBond }    from "../../lib/weaponAwakening";
import { generateRaidCard }       from "../../lib/versusCard";
import { isOwner }                from "../../lib/owner";
import {
  BOSS_ECHO_DEFINITIONS, rollRarity, rollMainStat, substatCount,
  rollSubstats, rollSubstatValue, calcMainStatValue, scaledFieldBossRarityWeights,
} from "../../lib/echoes";
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

// ── Unified boss handle (works for both World bosses and Field bosses) ─────────
interface RaidBossConfig {
  id:       string;
  name:     string;
  title:    string;
  element:  string;
  weakness: string;
  artFile:  string;
  baseHp:   number;
  baseAtk:  number;
  baseDef:  number;
  vibBar:   number;
  moves:    { name: string; damage: number; effect: string }[];
  defeatLoot: {
    credits: number; tuningModules: number; sealingTubes: number;
    forgingOres: number; paradoxCores: number; resonanceExp: number;
  };
}

/** Encode / decode a boss choice value ("wl:0" or "field:ignis_behemoth") */
function encodeBossChoice(type: "wl" | "field", key: string | number): string {
  return `${type}:${key}`;
}

function getRaidBoss(choiceValue: string): RaidBossConfig | null {
  const [type, key] = choiceValue.split(":");
  if (type === "wl") {
    const wl   = parseInt(key, 10);
    const boss = getBoss(wl);
    if (!boss) return null;
    return boss as RaidBossConfig; // Boss already has defeatLoot
  }
  if (type === "field") {
    const fb = ALL_FIELD_BOSSES.find(b => b.id === key);
    if (!fb) return null;
    // Generate loot scaled to field boss difficulty
    return {
      ...fb,
      defeatLoot: fieldBossLoot(fb),
    };
  }
  return null;
}

/** Derive loot for a field boss (they have no fixed loot table) */
function fieldBossLoot(fb: FieldBoss) {
  // Scale based on baseHp as a proxy for difficulty
  const tier = fb.baseHp / 2000; // ~1.8 for weakest, up to ~2.94 for toughest (post +20% balance pass)
  return {
    credits:       Math.floor(4000  * tier),
    tuningModules: Math.floor(9     * tier),
    sealingTubes:  Math.floor(7     * tier),
    forgingOres:   Math.floor(6     * tier),
    paradoxCores:  Math.floor(3     * tier),
    resonanceExp:  Math.floor(1200  * tier),
  };
}

// ── Smart party-aware boss scaling ─────────────────────────────────────────────
//
// Boss HP = f(total party ATK) → a geared squad faces a proportionally harder boss
// Boss ATK = f(avg player HP)  → boss damage reflects actual player survivability
// More players → more total HP pool so boss hits slightly harder + more HP total
//
// Raw ATK alone understates real damage output once crit rate/dmg and elemental
// DMG bonus are stacked. This folds in the same multipliers combat actually
// applies: expected crit multiplier (1 + critRate * (critDmg - 1)) and the
// elemental DMG bonus (1 + elemDmg).
// 2026-07-04 correction: the first version of this (full linear multiply)
// overcorrected badly. It was calibrated against one maxed-out outlier account,
// but ANY invested player has non-trivial crit/elemDmg — every element grants
// ~20% elemDmg baseline alone — so the full multiplier (7-11×+ for a normal
// built character) inflated bossHp/DEF/vibBar for basically everyone, not just
// extreme accounts. A 2-player raid of decently-built (not even maxed) Aero
// characters got a computed bossHp of ~8.3M and nearly wiped by turn 4 with the
// boss barely scratched. Dampened via sqrt so the correction is real but far
// gentler: a rawMult of 7.56 (the wipe case) becomes a 2.75× power multiplier
// instead of 7.56×, and the extreme maxed-outlier case (rawMult ~11) becomes
// ~3.3× instead of ~11×.
function effectivePower(p: RaidParticipant): number {
  const critMult = 1 + Math.min(1, p.critRate) * Math.max(0, p.critDmg - 1);
  const elemMult = 1 + Math.max(0, p.elemDmg);
  return p.atk * Math.sqrt(critMult * elemMult);
}

function computeRaidBossStats(
  boss: RaidBossConfig,
  participants: RaidParticipant[],
): { hp: number; atk: number; def: number; vibBar: number } {
  const n          = participants.length;
  const totalPower = participants.reduce((s, p) => s + effectivePower(p), 0);
  const totalHp    = participants.reduce((s, p) => s + p.hpMax, 0);
  const totalAtk   = participants.reduce((s, p) => s + p.atk, 0);
  const avgPower   = totalPower / n;
  const avgHp      = totalHp    / n;
  const avgAtk     = totalAtk   / n;

  // ── HP ──────────────────────────────────────────────────────────────────────
  // Target ~28 skill-cycle turns of the full party to clear the boss.
  // Per turn, an average player deals avgPower * ~2.2 (basic/skill/ult average).
  // We want total HP ≈ totalPower * 2.2 * 28 * 0.80 so geared parties still feel pressure.
  // 2026-07-02 balance pass: multiplied by 1.35 (raids should hit noticeably harder
  // than a solo /field-boss fight).
  // 2026-07-03 difficulty pass: another ×1.37 on top (players reported raids/bosses
  // as too easy — accumulated power from named sets/evolved abilities/awakened
  // weapons had outpaced these targets since they were last tuned).
  // 2026-07-03 (2nd pass): HP/ATK/DEF are now PURELY party-derived — no floor tied
  // to boss.baseHp/baseAtk/baseDef at all. Previously a boss's own base stats could
  // override the party-scaled target (e.g. WL8's huge baseDef vs. a field boss's
  // tiny one), so which boss you picked mattered far more than your party's actual
  // size/gear — a WL0 or field boss raid was trivial next to a WL8 one. The chosen
  // boss is now purely cosmetic (name/element/moves/loot); difficulty is uniform
  // across every raid option for the same party.
  // 2026-07-04: totalAtk → totalPower (folds in crit/elemDmg, see effectivePower above).
  const bossHp  = Math.floor(totalPower * 2.2 * 28 * 0.80 * 1.35 * 1.37);

  // ── ATK ─────────────────────────────────────────────────────────────────────
  // Each AoE round should drain ~12–18% of a player's HP after their DEF.
  // With more players the boss attacks proportionally more per round (one attack
  // per player turn, so damage-per-player stays constant; no extra scaling needed).
  // Baseline: boss ATK that deals ~15% avgHp against avgDef ≈ avgHp / 7 defense.
  // calcEnemyDamage → dmg = base * (1 - def / (def + 250))
  // Solve: 0.15 * avgHp = baseAtk * 0.6  →  baseAtk ≈ avgHp * 0.25
  // 2026-07-02 balance pass: bumped 0.25 → 0.34 (+36%) so raid boss hits land
  // meaningfully harder than the equivalent solo field-boss fight.
  // 2026-07-03 difficulty pass: bumped again 0.34 → 0.46 (+35%).
  const bossAtk = Math.floor(avgHp * 0.46);

  // ── DEF ─────────────────────────────────────────────────────────────────────
  // Party-derived baseline (150) instead of the selected boss's own baseDef —
  // that ranged 60 (WL0) to 1080 (WL8), an 18× spread that made boss choice
  // dominate difficulty far more than party size/gear ever could.
  // Uses raw avgAtk, NOT avgPower — DEF received shouldn't also get the
  // crit/elemDmg correction on top of HP and vibBar. Stacking the same
  // correction three times (HP harder to burn down, damage-dealt reduced by
  // higher DEF, AND vib bar harder to drain) is what caused the 2026-07-04
  // near-wipe above. DEF only needs to track raw gear investment.
  const gearMult = Math.max(1.55, Math.sqrt(avgAtk / 300));
  const bossDef  = Math.floor(150 * gearMult);

  // ── Vibration bar ───────────────────────────────────────────────────────────
  // Previously scaled off boss.vibBar/boss.baseHp ratio applied to the new
  // totalAtk-scaled bossHp. That's the wrong basis: a single attack's damage
  // only ever comes from ONE player's ATK, not the party's total — so for a
  // minimum-size raid (2 players), vibBar came out sized for roughly one hit.
  // A crit ultimate + weakness hit measured at ~107% of the bar in one attack.
  // Vib bar now scales off avgPower directly (independent of party size) so a
  // single strong hit only ever takes a meaningful bite — target ~15% of the
  // bar for a worst-case crit ultimate + weakness hit.
  const vibBar = Math.max(200, Math.floor(avgPower * 45));

  return { hp: Math.floor(bossHp), atk: Math.floor(bossAtk), def: Math.floor(bossDef), vibBar };
}

// ── In-memory raid state ───────────────────────────────────────────────────────
interface RaidParticipant {
  userId:         string;
  name:           string;
  element:        string;
  worldLevel:     number;
  hp:             number;
  hpMax:          number;
  energy:         number;
  skillCd:        number;
  atk:            number;
  def:            number;
  spd:            number;
  critRate:       number;
  critDmg:        number;
  elemDmg:        number;
  lifesteal:      number;
  bonuses:        PlayerBonuses;
  firstAction:    boolean;
  secondWindUsed: boolean;
  dmgDealt:       number;
  isDefeated:     boolean;
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
  echoSkillCd:           number;
  nextCritArmed:         boolean;
  // ── Milestone 3d: per-participant team state (dev guild only) ────────────────
  hasSolace:      boolean;
  allySolaceStats: (ResolvedStats & { hasWellspring?: boolean; wellspringRefinement?: number }) | null; // each participant's own resolved stats
  solaceBasicLevel: number;
  solaceSkillLevel: number;
  solaceUltimateLevel: number;
  solaceIntroLevel: number;
  solaceForteLevel: number;
  solaceConstellation: number;
  activeUnit:     "player" | "ally";
  allyHp:         number;
  allyHpMax:      number;
  concertoEnergy: number;
  playerDebuffs:  DebuffState;
  attunement:     AttunementState;
  attunementDoubleTurnsLeft: number;
  solaceForte:    ForteState;
  forteEmpoweredTurnsLeft:   number;
  activeAllyCharacterId: string | null;
  allyKit: PlayableCharacterKit | null;
  allyMechanicState: unknown;
}

interface ActiveRaid {
  bossChoice:    string;
  bossHp:        number;
  bossHpMax:     number;
  bossAtk:       number;   // scaled after party is known
  bossDef:       number;   // scaled after party is known
  bossVib:       number;
  bossVibMax:    number;
  isShattered:   boolean;
  shatterLeft:   number;
  bossDefShredTurnsLeft: number; // Permafrost Sovereign echo skill — shared, since the boss is a single shared target
  bossDefShredPct:       number;
  phase:         "RECRUITING" | "FIGHTING";
  participants:  RaidParticipant[];
  currentIdx:    number;
  turn:          number;
  channelId:     string;
  guildId:       string;
  organizerId:   string;
  recruitMsg?:   any;      // reference to the recruiting embed message for live updates
  joinCollector?: any;     // stopped when the raid ends so stale collectors don't bleed into new raids
  isDevGuild:    boolean;  // Milestone 3d: gates team-mechanic state/buttons/status line
}

const activeRaids  = new Map<string, ActiveRaid>(); // channelId → raid
const joiningUsers = new Map<string, string>();      // userId → channelId
const ENERGY_PER_TURN = 20;
const SKILL_CD        = 3;
const JOIN_WINDOW_MS  = 5 * 60 * 1000;
const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_PLAYERS     = 2;
const MAX_PLAYERS     = 6;

function canManageRaids(interaction: ChatInputCommandInteraction): boolean {
  if (isOwner(interaction.user.id)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function elementEmoji(el: string): string {
  const m: Record<string, string> = {
    FUSION:"🔥", GLACIO:"❄️", ELECTRO:"⚡", AERO:"🌪️", HAVOC:"🌑", SPECTRO:"✨", NONE:"◇"
  };
  return m[el] ?? "◇";
}

/**
 * Milestone 3d: party-wide team status line. Empty string outside dev guilds.
 * Lists every participant who has Solace unlocked, their currently-active unit,
 * and (for whoever is piloting Solace right now) her HP + Concerto Energy —
 * this visibility gap (missing Concerto Energy) was the exact bug that shipped
 * in /dungeon's Milestone 3a port, so it's called out explicitly here.
 */
function raidTeamStatusLine(raid: ActiveRaid): string {
  if (!raid.isDevGuild) return "";
  const withSolace = raid.participants.filter(p => p.hasSolace);
  if (withSolace.length === 0) return "";

  const lines = withSolace.map(p => {
    const label = p.allyKit?.label ?? "Ally";
    const kitLine = p.allyKit ? `  ·  ${p.allyKit.statusLineText(p.allyMechanicState)}` : "";
    if (p.activeUnit === "ally") {
      const debuffTag = p.playerDebuffs.length > 0
        ? `  ·  ${p.playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
        : "";
      return `🔄 **${p.name}** → *${label}* — ${p.allyHp}/${p.allyHpMax} HP  ·  Concerto Energy: **${p.concertoEnergy}/100**${kitLine}${debuffTag}`;
    }
    return `◇ **${p.name}** — *${label}* benched  ·  Concerto Energy: **${p.concertoEnergy}/100**${kitLine}`;
  });

  return `\n\n${lines.join("\n")}`;
}

function raidEmbed(raid: ActiveRaid, boss: RaidBossConfig, lastAction: string): EmbedBuilder {
  const alive = raid.participants.filter(p => !p.isDefeated);
  const current = raid.participants[raid.currentIdx];

  const participantLines = raid.participants.map(p => {
    const s = p.isDefeated ? "~~" : "";
    return `${elementEmoji(p.element)} ${s}**${p.name}**${s}  ${hpBar(p.hp, p.hpMax, 12)}`;
  });

  return new EmbedBuilder()
    .setColor(0xEC4899)
    .setTitle(`☄️  Calamity Raid — Turn ${raid.turn}`)
    .setDescription(raidTeamStatusLine(raid) || null)
    .addFields(
      {
        name:  `⚔️  ${boss.name}`,
        value: `*${boss.title}*\n` +
               `${hpBar(raid.bossHp, raid.bossHpMax)}  **${raid.bossHp.toLocaleString()}**/${raid.bossHpMax.toLocaleString()}\n` +
               `Vibration: ${hpBar(raid.bossVib, raid.bossVibMax, 10)}${raid.isShattered ? "  **⚡ SHATTERED**" : ""}`,
        inline: false,
      },
      {
        name:  `Resonators  [${alive.length}/${raid.participants.length} standing]`,
        value: participantLines.join("\n"),
        inline: false,
      },
      {
        name:  "Last Action",
        value: lastAction || "*The raid begins.*",
        inline: false,
      },
    )
    .setFooter({ text: `CARTETHYIA  ·  Raid  ·  ${current?.name ?? "?"}'s turn  ·  5 min/turn` });
}

function buildRaidButtons(p: RaidParticipant, isDevGuild: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (isDevGuild && p.hasSolace && p.activeUnit === "ally" && p.activeAllyCharacterId === "kaelith") {
    const skillReady = p.skillCd === 0;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("raid_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("raid_skill")
        .setLabel(skillReady ? "🌑  Umbral Detonation" : `🌑  Detonation (${p.skillCd}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder().setCustomId("raid_ultimate").setLabel("🌑  Umbral Cataclysm")
        .setStyle(ButtonStyle.Success).setDisabled(p.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("raid_retreat")
        .setLabel("↩  Retreat").setStyle(ButtonStyle.Danger),
    ));
  } else if (isDevGuild && p.hasSolace && p.activeUnit === "ally" && p.activeAllyCharacterId === "vesper") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("raid_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("raid_skill").setLabel("⚡  Discharge").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("raid_ultimate").setLabel("⚡  Overload")
        .setStyle(ButtonStyle.Success).setDisabled(p.energy < 100),
      new ButtonBuilder().setCustomId("raid_retreat")
        .setLabel("↩  Retreat").setStyle(ButtonStyle.Danger),
    ));
  } else if (isDevGuild && p.hasSolace && p.activeUnit === "ally" && p.activeAllyCharacterId === "rilo") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("raid_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("raid_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("raid_ultimate").setLabel("🛡️  Avalanche Slam")
        .setStyle(ButtonStyle.Success).setDisabled(p.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("raid_retreat")
        .setLabel("↩  Retreat").setStyle(ButtonStyle.Danger),
    ));
  } else if (isDevGuild && p.hasSolace && p.activeUnit === "ally") {
    const modeLabel = p.attunement.mode ? `(${p.attunement.mode})` : "(inactive)";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("raid_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("raid_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("raid_ultimate").setLabel("⚡  Convergence")
        .setStyle(ButtonStyle.Success).setDisabled(p.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("raid_retreat")
        .setLabel("↩  Retreat").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("raid_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("raid_skill")
        .setLabel(p.skillCd === 0 ? "✦  Skill" : `✦  Skill (${p.skillCd}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(p.skillCd > 0),
      new ButtonBuilder().setCustomId("raid_ultimate")
        .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(p.energy < 100),
    );
    if (p.bonuses.echoSkill) {
      const echoReady = p.echoSkillCd === 0;
      row.addComponents(
        new ButtonBuilder().setCustomId("raid_echoskill")
          .setLabel(echoReady ? `🌀  ${p.bonuses.echoSkill.name}` : `🌀  ${p.bonuses.echoSkill.name} (${p.echoSkillCd}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId("raid_retreat")
        .setLabel("↩  Retreat").setStyle(ButtonStyle.Danger),
    );
    rows.push(row);
  }

  if (isDevGuild && p.hasSolace) {
    const swapDisabled = p.activeUnit === "player" && p.allyHp <= 0;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("raid_swap")
        .setLabel(p.activeUnit === "player" ? `🔄  Swap to ${p.allyKit?.label ?? "Ally"}` : `🔄  Swap to ${p.name}`)
        .setStyle(ButtonStyle.Secondary).setDisabled(swapDisabled),
    ));
  }

  return rows;
}

function nextParticipant(raid: ActiveRaid): RaidParticipant | null {
  const alive = raid.participants.filter(p => !p.isDefeated);
  if (alive.length === 0) return null;
  let idx      = (raid.currentIdx + 1) % raid.participants.length;
  let attempts = 0;
  while (raid.participants[idx].isDefeated && attempts < raid.participants.length) {
    idx = (idx + 1) % raid.participants.length;
    attempts++;
  }
  raid.currentIdx = idx;
  return raid.participants[idx];
}

// Milestone 3d Task 3: folds together Attunement/Wellspring/Forte contributions
// from EVERY participant currently `activeUnit === "ally"` — unlike boss.ts's
// solo case (exactly one owner, or none), a raid can have 0, 1, or several
// participants with their own Solace active simultaneously (each on their own
// turn). Multiplicative mults are folded via product (stacking naturally),
// additive bonuses via sum. Applies party-wide: the caller uses this result for
// whichever participant is acting/being hit, regardless of whose ally is active.
function partyWideTeamBonuses(raid: ActiveRaid): {
  atkMult: number; critBonus: number; defMult: number;
} {
  let atkMult   = 1;
  let critBonus = 0;
  let defMult   = 1;
  for (const ally of raid.participants) {
    // Only Solace's kit contributes party-wide Attunement/Wellspring/Forte-ATK
    // standing bonuses — Kaelith's Forte payoff ("keeps stacks") isn't a stat
    // buff, so his active-ally participants simply contribute nothing here.
    if (ally.activeUnit !== "ally" || ally.isDefeated || ally.activeAllyCharacterId !== "solace") continue;
    const attuneAtkBonus = solaceAttunementAtkCritBonus(ally.solaceSkillLevel);
    const attuneDefBonus = solaceAttunementDefBonus(ally.solaceSkillLevel);
    const doubled = ally.attunementDoubleTurnsLeft > 0;
    const forteActive = ally.forteEmpoweredTurnsLeft > 0;

    const allyHasWellspring = ally.allySolaceStats?.hasWellspring ?? false;
    const allyWellspringRefinement = ally.allySolaceStats?.wellspringRefinement ?? 1;

    atkMult *= getAttunementAtkMult(ally.attunement, attuneAtkBonus, doubled, ally.solaceConstellation >= 6);
    critBonus += getAttunementCritRateBonus(ally.attunement, attuneAtkBonus, doubled, ally.solaceConstellation >= 6);
    if (allyHasWellspring) critBonus += getWellspringCritRateBonus(ally.attunement, allyWellspringRefinement);
    critBonus += getSolaceForteCritRateBonus(ally.solaceForteLevel, forteActive);
    if (allyHasWellspring) atkMult *= 1 + getWellspringAtkBonus(ally.attunement, allyWellspringRefinement);
    atkMult *= 1 + getSolaceForteAtkBonus(ally.solaceForteLevel, forteActive);
    defMult *= getAttunementDefMult(ally.attunement, attuneDefBonus, doubled, ally.solaceConstellation >= 6);
    if (allyHasWellspring) defMult *= 1 + getWellspringDefBonus(ally.attunement, allyWellspringRefinement);
    defMult *= 1 + getSolaceForteDefBonus(ally.solaceForteLevel, forteActive);
  }
  return { atkMult, critBonus, defMult };
}

// ── Command definition ────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("raid")
  .setDescription("Calamity Raid — co-op boss fight (2–6 players).")
  .addSubcommand(sub =>
    sub.setName("start")
      .setDescription("[Admin] Spawn a raid boss in this channel.")
      .addStringOption(o =>
        o.setName("boss")
          .setDescription("Which boss to summon")
          .setRequired(true)
          .addChoices(
            // ── World Bosses ──────────────────────────────────────────────────
            { name: "WL0 · Resonant Wraith  (HAVOC)",          value: encodeBossChoice("wl", 0) },
            { name: "WL1 · Tidecaller Sovereign  (GLACIO)",    value: encodeBossChoice("wl", 1) },
            { name: "WL2 · Fractured Arbiter  (SPECTRO)",      value: encodeBossChoice("wl", 2) },
            { name: "WL3 · Nullfire Construct  (ELECTRO)",     value: encodeBossChoice("wl", 3) },
            { name: "WL4 · Sable Harbinger  (HAVOC)",          value: encodeBossChoice("wl", 4) },
            { name: "WL5 · Auric Colossus  (SPECTRO)",         value: encodeBossChoice("wl", 5) },
            { name: "WL6 · Embercrown Tyrant  (FUSION)",       value: encodeBossChoice("wl", 6) },
            { name: "WL7 · Galeborne Phantom  (AERO)",         value: encodeBossChoice("wl", 7) },
            { name: "WL8 · The Resonant Absolute  (SPECTRO)",  value: encodeBossChoice("wl", 8) },
            // ── Field Bosses ──────────────────────────────────────────────────
            { name: "Field · Ignis Behemoth  (FUSION)",        value: encodeBossChoice("field", "ignis_behemoth")       },
            { name: "Field · Permafrost Sovereign  (GLACIO)",  value: encodeBossChoice("field", "permafrost_sovereign") },
            { name: "Field · Voltaic Aberrant  (ELECTRO)",     value: encodeBossChoice("field", "voltaic_aberrant")     },
            { name: "Field · Tempest Ancient  (AERO)",         value: encodeBossChoice("field", "tempest_ancient")      },
            { name: "Field · Null Ravager  (HAVOC)",           value: encodeBossChoice("field", "null_ravager")         },
            { name: "Field · Luminal Specter  (SPECTRO)",      value: encodeBossChoice("field", "luminal_specter")      },
            // ── Named Echo Set Field Bosses (WL2+) ───────────────────────────────
            { name: "Field · Cinderbound Colossus  (FUSION)",  value: encodeBossChoice("field", "cinderbound_colossus") },
            { name: "Field · Cryoveil Warden  (GLACIO)",       value: encodeBossChoice("field", "cryoveil_warden")      },
            { name: "Field · Thundercrown Herald  (ELECTRO)",  value: encodeBossChoice("field", "thundercrown_herald")  },
            { name: "Field · Galebound Sovereign  (AERO)",     value: encodeBossChoice("field", "galebound_sovereign")  },
            { name: "Field · Voidmaw Devourer  (HAVOC)",       value: encodeBossChoice("field", "voidmaw_devourer")     },
            { name: "Field · Lumenwrought Seraph  (SPECTRO)",  value: encodeBossChoice("field", "lumenwrought_seraph")  },
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName("join").setDescription("Join the active raid in this channel.")
  )
  .addSubcommand(sub =>
    sub.setName("begin").setDescription("[Admin] Start the raid with current participants.")
  )
  .addSubcommand(sub =>
    sub.setName("end").setDescription("[Admin] Cancel and end the active raid in this channel.")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "start")  await startRaid(interaction);
  else if (sub === "join")  await joinRaid(interaction);
  else if (sub === "begin") await beginRaid(interaction);
  else if (sub === "end")   await endRaid(interaction);
}

// ── /raid start ───────────────────────────────────────────────────────────────
async function startRaid(interaction: ChatInputCommandInteraction) {
  if (!canManageRaids(interaction)) {
    await interaction.reply({ content: "You need **Manage Server** to start raids.", flags: 64 }); return;
  }
  await interaction.deferReply();

  if (activeRaids.has(interaction.channelId)) {
    await interaction.editReply({ content: "A raid is already active in this channel." }); return;
  }


  const choice = interaction.options.getString("boss", true);
  const boss   = getRaidBoss(choice);
  if (!boss) { await interaction.editReply({ content: "Boss not found." }); return; }

  const raid: ActiveRaid = {
    bossChoice:   choice,
    bossHp:       boss.baseHp,    // placeholder until launchRaid scales it
    bossHpMax:    boss.baseHp,
    bossAtk:      boss.baseAtk,
    bossDef:      boss.baseDef,
    bossVib:      boss.vibBar,
    bossVibMax:   boss.vibBar,
    isShattered:  false,
    shatterLeft:  0,
    bossDefShredTurnsLeft: 0,
    bossDefShredPct:       0,
    phase:        "RECRUITING",
    participants: [],
    currentIdx:   0,
    turn:         1,
    channelId:    interaction.channelId,
    guildId:      interaction.guildId!,
    organizerId:  interaction.user.id,
    // NOTE: `isDevGuild` is a legacy name — team-mechanic code paths are
    // always enabled now; real per-player gating happens via each
    // participant's own `hasSolace` (set at join time from their actual
    // /team pick, see joinRaid below). Was hard-gated to the dev guild only
    // during development; that gate is exactly the bug that blocked Solace
    // everywhere after launch.
    isDevGuild:   true,
  };
  activeRaids.set(interaction.channelId, raid);

  const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("raid_join_btn").setLabel("⚔️  Join Raid").setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({ embeds: [buildRecruitEmbed(raid, boss)], components: [joinRow] });
  const recruitMsg = await interaction.fetchReply();
  raid.recruitMsg  = recruitMsg;

  const joinCollector = (interaction.channel as TextChannel).createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: b => b.customId === "raid_join_btn" && b.message.id === recruitMsg.id,
    time: JOIN_WINDOW_MS,
  });
  raid.joinCollector = joinCollector;

  joinCollector.on("collect", async (btn: ButtonInteraction) => {
    const r = activeRaids.get(interaction.channelId);
    if (!r || r.phase !== "RECRUITING") { await btn.reply({ content: "Raid already started.", flags: 64 }); return; }
    if (r.participants.some(p => p.userId === btn.user.id) || joiningUsers.get(btn.user.id) === interaction.channelId) {
      await btn.reply({ content: "You already joined.", flags: 64 }); return;
    }
    if (r.participants.length >= MAX_PLAYERS) { await btn.reply({ content: "Raid is full.", flags: 64 }); return; }

    joiningUsers.set(btn.user.id, interaction.channelId);
    await btn.deferUpdate();
    let added = false;
    try {
      added = await addParticipant(r, btn.user.id, btn.guild!.members.cache.get(btn.user.id)?.displayName ?? btn.user.displayName);
    } catch (err) {
      console.error("[Raid] addParticipant failed:", err);
    } finally {
      joiningUsers.delete(btn.user.id);
    }

    if (!added) {
      await btn.followUp({ content: "◈ Failed to join — you may not be started (`/start`) or there was a connection issue. Try again.", flags: 64 });
      return;
    }
    await (recruitMsg as any).edit({ embeds: [buildRecruitEmbed(r, boss)], components: [joinRow] });
  });

  setTimeout(async () => {
    const r = activeRaids.get(interaction.channelId);
    if (!r || r.phase !== "RECRUITING") return;
    if (r.participants.length < MIN_PLAYERS) {
      activeRaids.delete(interaction.channelId);
      await (recruitMsg as any).edit({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription(`Not enough players joined (need ${MIN_PLAYERS}). Raid cancelled.`)
          .setFooter({ text: "CARTETHYIA  ·  Raid" })],
        components: [],
      }).catch(() => {});
      return;
    }
    joinCollector.stop();
    await launchRaid(interaction.channel as TextChannel, interaction.channelId, boss, recruitMsg as any);
  }, JOIN_WINDOW_MS);
}

function buildRecruitEmbed(raid: ActiveRaid, boss: RaidBossConfig): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xEC4899)
    .setTitle(`☄️  Calamity Raid — ${boss.name}`)
    .setDescription(
      `*${boss.title}*\n\n` +
      `${elementEmoji(boss.element)} **${boss.element}**  ·  Weakness: ${elementEmoji(boss.weakness)} **${boss.weakness}**\n\n` +
      `**Players:** ${raid.participants.length}/${MAX_PLAYERS}\n` +
      (raid.participants.length
        ? raid.participants.map(p => `${elementEmoji(p.element)} **${p.name}**`).join("  ") + "\n\n"
        : "\n") +
      `Boss power **scales to your party's gear** — bring your best!\n` +
      `Minimum **${MIN_PLAYERS} players** to begin. Admin uses \`/raid begin\` when ready.\n` +
      `Auto-starts in 5 minutes.`
    )
    .setFooter({ text: "CARTETHYIA  ·  Calamity Raid  ·  Recruiting…" });
}

/** Returns true if the participant was added, false if the user wasn't found or not onboarded. */
async function addParticipant(raid: ActiveRaid, userId: string, displayName: string): Promise<boolean> {
  const db = await prisma.user.findUnique({
    where:  { id: userId },
    select: { baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true, critRate: true, critDmg: true, element: true, isOnboarded: true, worldLevel: true, teamAllyCharacterId: true },
  });
  if (!db?.isOnboarded) return false;

  const bonuses = await resolvePlayerBonuses(userId);
  const stats   = applyBonuses(db, bonuses);

  // Milestone 3d: per-participant Solace progress — requires this participant
  // to have picked Solace via /team.
  // CRITICAL: real read-only ownership lookup, NOT getOrCreateCharacterProgress
  // — that helper CREATES a row if missing, which would silently re-grant
  // Solace ownership to anyone whose teamAllyCharacterId flag is "solace"
  // but doesn't actually own her, bypassing the gacha entirely.
  const activeAllyCharacterId: string | null =
    db.teamAllyCharacterId && CHARACTER_KITS[db.teamAllyCharacterId] ? db.teamAllyCharacterId : null;
  const solaceProgress = activeAllyCharacterId
    ? await prisma.characterProgress.findUnique({ where: { userId_characterId: { userId, characterId: activeAllyCharacterId } } })
    : null;
  const hasSolaceGate = solaceProgress !== null;
  const allyKit: PlayableCharacterKit | null = activeAllyCharacterId ? CHARACTER_KITS[activeAllyCharacterId] : null;
  // This participant's own ally's resolved stats.
  const allySolaceStatsRaw = hasSolaceGate && allyKit ? await allyKit.resolveStats(userId) : null;
  const allySolaceStats = allySolaceStatsRaw as (typeof allySolaceStatsRaw & { hasWellspring?: boolean; wellspringRefinement?: number });

  raid.participants.push({
    userId, name: displayName, element: db.element, worldLevel: db.worldLevel,
    hp: stats.hp, hpMax: stats.hp, energy: 0, skillCd: 0,
    atk: stats.atk, def: stats.def, spd: stats.spd,
    critRate: stats.critRate, critDmg: stats.critDmg,
    elemDmg: stats.elemDmgBonus, lifesteal: stats.lifesteal, bonuses,
    firstAction: true, secondWindUsed: false,
    dmgDealt: 0, isDefeated: false,
    namedState: initNamedSetState(),
    glacioShieldTurnsLeft: 0, glacioShieldElemBonus: 0,
    riloDefBuffTurnsLeft: 0, riloDefBuffPct: 0,
    stormBuffTurnsLeft: 0, stormBuffCritBonus: 0,
    havocFrenzyAtkMult: 1.0, havocFrenzyLifesteal: 0, havocFrenzyDefIgnore: 0,
    echoSkillCd: 0, nextCritArmed: false,
    hasSolace: hasSolaceGate,
    allySolaceStats,
    solaceBasicLevel:    solaceProgress?.basicLevel    ?? 1,
    solaceSkillLevel:    solaceProgress?.skillLevel    ?? 1,
    solaceUltimateLevel: solaceProgress?.ultimateLevel ?? 1,
    solaceIntroLevel:    solaceProgress?.introLevel    ?? 1,
    solaceForteLevel:    solaceProgress?.forteLevel    ?? 1,
    solaceConstellation: solaceProgress?.constellation ?? 0,
    activeUnit: "player",
    allyHp: allyKit ? allyKit.statsAtLevel(90).hpMax : 0, allyHpMax: allyKit ? allyKit.statsAtLevel(90).hpMax : 0,
    concertoEnergy: 0,
    playerDebuffs: [],
    attunement: { mode: null },
    attunementDoubleTurnsLeft: 0,
    solaceForte: resetForte(),
    forteEmpoweredTurnsLeft: 0,
    activeAllyCharacterId, allyKit, allyMechanicState: allyKit ? allyKit.createInitialMechanicState() : null,
  });
  return true;
}

// ── /raid join ────────────────────────────────────────────────────────────────
async function joinRaid(interaction: ChatInputCommandInteraction) {
  const raid = activeRaids.get(interaction.channelId);
  if (!raid || raid.phase !== "RECRUITING") {
    await interaction.reply({ content: "No raid is recruiting in this channel.", flags: 64 }); return;
  }
  if (raid.participants.some(p => p.userId === interaction.user.id) || joiningUsers.get(interaction.user.id) === interaction.channelId) {
    await interaction.reply({ content: "You already joined this raid.", flags: 64 }); return;
  }
  if (raid.participants.length >= MAX_PLAYERS) {
    await interaction.reply({ content: "Raid is full.", flags: 64 }); return;
  }

  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.displayName;
  joiningUsers.set(interaction.user.id, interaction.channelId);
  await interaction.deferReply({ flags: 64 });
  let added = false;
  try {
    added = await addParticipant(raid, interaction.user.id, displayName);
  } catch (err) {
    console.error("[Raid] addParticipant failed:", err);
  } finally {
    joiningUsers.delete(interaction.user.id);
  }

  if (!added) {
    await interaction.editReply({ content: "◈ You need to use `/start` before joining a raid." });
    return;
  }

  const boss = getRaidBoss(raid.bossChoice)!;
  await raid.recruitMsg?.edit({ embeds: [buildRecruitEmbed(raid, boss)], components: [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("raid_join_btn").setLabel("⚔️  Join Raid").setStyle(ButtonStyle.Success),
    ),
  ]}).catch(() => {});

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x4CAF50)
      .setDescription(`${elementEmoji(raid.participants[raid.participants.length - 1]!.element)} **${displayName}** joined the raid. [${raid.participants.length}/${MAX_PLAYERS}]`)
      .setFooter({ text: "CARTETHYIA  ·  Raid" })],
  });
}

// ── /raid end ─────────────────────────────────────────────────────────────────
async function endRaid(interaction: ChatInputCommandInteraction) {
  if (!canManageRaids(interaction)) {
    await interaction.reply({ content: "You need **Manage Server** to end raids.", flags: 64 }); return;
  }
  const raid = activeRaids.get(interaction.channelId);
  if (!raid) {
    await interaction.reply({ content: "No active raid in this channel.", flags: 64 }); return;
  }
  activeRaids.delete(interaction.channelId);
  for (const p of raid.participants) await clearFight(p.userId).catch(() => {});
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0x4A4A5A)
      .setDescription("☄️  The raid has been cancelled by the server admin.")
      .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
  });
}

// ── /raid begin ───────────────────────────────────────────────────────────────
async function beginRaid(interaction: ChatInputCommandInteraction) {
  if (!canManageRaids(interaction)) {
    await interaction.reply({ content: "You need **Manage Server** to begin raids.", flags: 64 }); return;
  }
  const raid = activeRaids.get(interaction.channelId);
  if (!raid || raid.phase !== "RECRUITING") {
    await interaction.reply({ content: "No raid is recruiting in this channel.", flags: 64 }); return;
  }
  if (raid.participants.length < MIN_PLAYERS) {
    await interaction.reply({ content: `Need at least ${MIN_PLAYERS} players to begin.`, flags: 64 }); return;
  }

  await interaction.reply({ content: "⚔️ Raid is beginning!", flags: 64 });
  const boss = getRaidBoss(raid.bossChoice)!;
  await launchRaid(interaction.channel as TextChannel, interaction.channelId, boss, null);
}

// ── Core fight loop ───────────────────────────────────────────────────────────
async function launchRaid(
  channel:     TextChannel,
  channelId:   string,
  boss:        RaidBossConfig,
  recruitMsg:  any,
) {
  const raid = activeRaids.get(channelId);
  if (!raid) return;

  raid.joinCollector?.stop();
  raid.phase      = "FIGHTING";
  raid.participants.sort((a, b) => b.spd - a.spd); // higher SPD acts earlier each round
  raid.currentIdx = 0;

  // ── Scale boss stats to this party ──────────────────────────────────────────
  const scaled     = computeRaidBossStats(boss, raid.participants);
  raid.bossHp      = scaled.hp;
  raid.bossHpMax   = scaled.hp;
  raid.bossAtk     = scaled.atk;
  raid.bossDef     = scaled.def;
  raid.bossVib     = scaled.vibBar;
  raid.bossVibMax  = scaled.vibBar;

  // ── Show scaling summary in the recruit embed ────────────────────────────────
  const n          = raid.participants.length;
  const avgAtk     = Math.round(raid.participants.reduce((s, p) => s + p.atk, 0) / n);
  const avgHp      = Math.round(raid.participants.reduce((s, p) => s + p.hpMax, 0) / n);

  // Create thread
  let thread;
  try {
    thread = await channel.threads.create({
      name: `☄️ Calamity Raid — ${boss.name}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
    });
  } catch {
    activeRaids.delete(channelId);
    await channel.send({ content: "☄️ I need **Create Public Threads** + **Send Messages in Threads** permissions to run raids here." }).catch(() => {});
    return;
  }

  for (const p of raid.participants) await thread.members.add(p.userId).catch(() => {});
  for (const p of raid.participants) await registerFight(p.userId, thread.id, channel.guildId, "Calamity Raid").catch(() => {});
  if (recruitMsg) await recruitMsg.edit({ components: [] }).catch(() => {});

  await channel.send({
    embeds: [new EmbedBuilder().setColor(0xEC4899)
      .setTitle(`☄️  Calamity Raid — ${boss.name}`)
      .setDescription(
        `*${boss.title}*\n\n` +
        `**${n} Resonators** answered the call.\n` +
        `**Avg ATK:** ${avgAtk.toLocaleString()}  ·  **Avg HP:** ${avgHp.toLocaleString()}\n\n` +
        `Calamity has calibrated — **Boss HP: ${scaled.hp.toLocaleString()}** · **Boss ATK: ${scaled.atk.toLocaleString()}**\n\n` +
        `The fight thread: <#${thread.id}>`
      )
      .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
  });

  // Raid intro card
  const bossArtPath = path.join(process.cwd(), "Bosses", boss.artFile);
  const introCard   = await generateRaidCard(
    boss.name, boss.element,
    fs.existsSync(bossArtPath) ? bossArtPath : null,
    raid.participants.map(p => ({ name: p.name, element: p.element })),
  );
  await thread.send({
    content: raid.participants.map(p => `<@${p.userId}>`).join(" "),
    files:   [new AttachmentBuilder(introCard, { name: "raid-intro.webp" })],
  });

  let battleMsg = await thread.send({
    embeds:     [raidEmbed(raid, boss, "*The Calamity manifests. First Resonator, strike!*")],
    components: buildRaidButtons(raid.participants[0]!, raid.isDevGuild),
  });

  const finishRaid = async (won: boolean) => {
    raid.joinCollector?.stop();
    activeRaids.delete(channelId);
    for (const p of raid.participants) await clearFight(p.userId).catch(() => {});

    if (won) {
      const loot     = boss.defeatLoot;
      const perPlayer = {
        credits:       Math.floor(loot.credits       / n * 1.5),
        tuningModules: Math.floor(loot.tuningModules  / n * 1.5),
        sealingTubes:  Math.floor(loot.sealingTubes   / n * 1.5),
        forgingOres:   Math.floor(loot.forgingOres     / n * 1.5),
        paradoxCores:  Math.floor(loot.paradoxCores    / n * 1.5),
        resonanceExp:  Math.floor(loot.resonanceExp    / n * 1.5),
      };

      await Promise.all(raid.participants.map(p => awardUser(p.userId, perPlayer, "raid")));
      await Promise.all(
        raid.participants.filter(p => !p.isDefeated).map(p =>
          prisma.user.update({ where: { id: p.userId }, data: { raidWins: { increment: 1 } } }).catch(() => {})
        )
      );
      await Promise.all(
        raid.participants.filter(p => !p.isDefeated).map(p =>
          incrementWeaponBond(p.userId).catch(() => null)
        )
      );

      // Each participant gets a guaranteed 4-cost echo drop matching the boss,
      // mirroring solo /field-boss's guaranteed drop (also covers WL bosses,
      // which have their own BOSS_ECHO_DEFINITIONS entries by name).
      const raidEchoDef = BOSS_ECHO_DEFINITIONS.find(e => e.name === boss.name);
      const isFieldBossRaid = raid.bossChoice.startsWith("field:");
      let raidEchoLine = "";
      if (raidEchoDef) {
        await Promise.all(raid.participants.map(async p => {
          // Field-boss echoes use a flat table that needs WL scaling (same as solo
          // /field-boss); WL-boss echoes already have their own escalating table baked in.
          const weights = isFieldBossRaid
            ? scaledFieldBossRarityWeights(raidEchoDef.rarityWeights as [number, number, number], p.worldLevel)
            : raidEchoDef.rarityWeights as [number, number, number];
          const rarity   = rollRarity(weights);
          const mainSt   = rollMainStat(4, boss.element as any);
          const subCount = substatCount(rarity);
          const substats = rollSubstats(subCount, mainSt);
          const echoData: any = {
            userId: p.userId, name: raidEchoDef.name,
            rarity, element: boss.element, cost: 4,
            ...(raidEchoDef.setId ? { setId: raidEchoDef.setId } : {}),
            mainStatType: mainSt, mainStatValue: calcMainStatValue(mainSt, 0, rarity),
          };
          substats.forEach((s, idx) => {
            echoData[`substat${idx + 1}Type`]  = s;
            echoData[`substat${idx + 1}Value`] = rollSubstatValue(s);
          });
          await prisma.echo.create({ data: echoData });
        }));
        raidEchoLine = `\n🌀 **${raidEchoDef.name}** (4-cost) awarded to every participant!`;
      }

      const contribLines = [...raid.participants]
        .sort((a, b) => b.dmgDealt - a.dmgDealt)
        .map((p, i) => `${i + 1}. ${elementEmoji(p.element)} ${p.name} — **${p.dmgDealt.toLocaleString()} DMG**`);

      const winCard = await generateRaidCard(
        boss.name, boss.element,
        fs.existsSync(bossArtPath) ? bossArtPath : null,
        raid.participants.map(p => ({ name: p.name, element: p.element })),
        { victory: true },
      );

      await battleMsg.edit({
        embeds: [new EmbedBuilder().setColor(0xF5A623)
          .setTitle("☄️  Raid — Victory!")
          .setDescription(
            `**${boss.name}** has been defeated!\n\n` +
            `**Rewards per player:**\n${buildRewardText(perPlayer)}${raidEchoLine}\n\n` +
            `**Damage Standings:**\n${contribLines.join("\n")}`
          )
          .setImage("attachment://raid-victory.webp")
          .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
        files:      [new AttachmentBuilder(winCard, { name: "raid-victory.webp" })],
        components: [],
      }).catch(() => {});
    } else {
      const loseCard = await generateRaidCard(
        boss.name, boss.element,
        fs.existsSync(bossArtPath) ? bossArtPath : null,
        raid.participants.map(p => ({ name: p.name, element: p.element })),
        { defeat: true },
      );
      await battleMsg.edit({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setTitle("☄️  Raid — Defeated")
          .setDescription(`All Resonators fell before **${boss.name}**.\n*The Calamity retreats… for now.*`)
          .setImage("attachment://raid-defeat.webp")
          .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
        files:      [new AttachmentBuilder(loseCard, { name: "raid-defeat.webp" })],
        components: [],
      }).catch(() => {});
    }

    await thread.setArchived(true).catch(() => {});
    setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
  };

  // ── Turn loop ─────────────────────────────────────────────────────────────
  const runRaidTurn = () => {
    const current = raid.participants[raid.currentIdx];
    if (!current || current.isDefeated) {
      const next = nextParticipant(raid);
      if (!next) { finishRaid(false); return; }
      runRaidTurn();
      return;
    }

    const collector = battleMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: TURN_TIMEOUT_MS,
      max:  1,
      filter: (b: ButtonInteraction) => {
        if (b.user.id !== current.userId) {
          b.reply({ content: "It's not your turn.", flags: 64 }).catch(() => {});
          return false;
        }
        return true;
      },
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      const isWeak    = current.element === boss.weakness;
      const mySetId   = current.bonuses.activeNamedSetId;
      const havocFrenzyActive = mySetId === "VOIDBORN_REMNANT" && voidbornRemnantFrenzyActive(current.namedState);
      const havocAtkMult   = havocFrenzyActive ? current.havocFrenzyAtkMult : 1.0;
      const havocLifesteal = havocFrenzyActive ? current.havocFrenzyLifesteal : 0;
      const havocDefIgnore = havocFrenzyActive ? current.havocFrenzyDefIgnore : 0;
      // Use the live raid.bossDef; zero when shattered
      const defShredActive = raid.bossDefShredTurnsLeft > 0;
      const defVal    = raid.isShattered ? 0 : raid.bossDef * (1 - havocDefIgnore) * (defShredActive ? (1 - raid.bossDefShredPct) : 1);
      const extraElemBonus = current.glacioShieldTurnsLeft > 0 ? current.glacioShieldElemBonus : 0;
      const radCrit   = elemRadianceCrit(current.bonuses.elementPassive, current.hp, current.hpMax);
      const stormCritBuff = current.stormBuffTurnsLeft > 0 ? current.stormBuffCritBonus : 0;
      // Milestone 3.5b: while this participant's Solace is active, use HER
      // OWN resolved stats for offense — safe unconditionally since
      // activeUnit is guaranteed "player" whenever the player's own branches run.
      const currentIsAllyActing = current.activeUnit === "ally" && current.allySolaceStats !== null;
      const activeAtk      = currentIsAllyActing ? current.allySolaceStats!.atk      : current.atk;
      const activeCritDmg  = currentIsAllyActing ? current.allySolaceStats!.critDmg  : current.critDmg;
      const activeCritBase = currentIsAllyActing ? current.allySolaceStats!.critRate : current.critRate;
      const aCrit     = abilityCritRate(current.bonuses, Math.min(1, activeCritBase + radCrit + stormCritBuff), current.hp, current.hpMax);
      const vibMult   = abilityVib(current.bonuses);
      const bossHpPct = raid.bossHp / raid.bossHpMax;
      const forcedCritActive = current.nextCritArmed && btn.customId !== "raid_retreat";

      let radiantDmgMult = 1.0;
      if (mySetId === "RADIANT_CONVERGENCE") {
        const heal = radiantConvergenceOnTurnHeal(current.namedState, current.hpMax);
        current.hp = Math.min(current.hpMax, current.hp + heal.healAmount);
        radiantDmgMult = heal.dmgMult;
      }

      let moveLine  = "";
      let damage    = 0;
      let vibFrac   = 0;
      let moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
      let isCrit    = false;
      let forteAnnounce = "";
      // Convergence resets concertoEnergy to 0 — the generic per-move gain
      // below must skip granting anything back on the same turn, or
      // Convergence would silently refund a chunk of the bar it just spent
      // (built in from the start here, per boss.ts's Milestone 3a fix).
      let convergenceUsedThisTurn = false;

      // Milestone 3d: swap — always consumes the turn, falls through to the
      // shared tail below (AoE counter-attack / decrements / next-turn send),
      // same as every other action. Ported from boss.ts's Milestone 3b Task 2
      // swap handler, adapted to per-participant team state.
      if (btn.customId === "raid_swap" && raid.isDevGuild && current.hasSolace && current.allyKit && !(current.activeUnit === "player" && current.allyHp <= 0)) {
        const outgoingIsPlayer = current.activeUnit === "player";
        const comboReady = current.concertoEnergy >= 100;

        if (comboReady) {
          const incomingTarget: AllyActionTarget = outgoingIsPlayer
            ? { hp: current.allyHp, hpMax: current.allyHpMax }
            : { hp: current.hp, hpMax: current.hpMax };

          const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : current.allyKit.outroEffect(current.solaceConstellation);
          const introEffect: IntroOutroEffect = outgoingIsPlayer ? current.allyKit.introEffect(current.solaceIntroLevel, current.solaceConstellation) : PLAYER_SELF_INTRO;
          const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
          const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

          if (!outgoingIsPlayer && introEffect.newMechanicState && current.activeAllyCharacterId === "kaelith") {
            const grant = (introEffect.newMechanicState as any).grantStacksOnIntro as number | undefined;
            if (grant) {
              const cur = (current.allyMechanicState as KaelithMechanicState).stacks;
              const cap = kaelithStackCap(current.solaceConstellation);
              current.allyMechanicState = { ...(current.allyMechanicState as KaelithMechanicState), stacks: Math.min(cap, cur + grant) };
            }
          }
          if (!outgoingIsPlayer && outroEffect.enemyDebuff) {
            // Raid's boss is one shared target — the debuff lands on the
            // raid-wide boss fields, not a per-participant one.
            raid.bossDefShredTurnsLeft = outroEffect.enemyDebuff.turns + 1;
            raid.bossDefShredPct = outroEffect.enemyDebuff.value;
          }
          if (!outgoingIsPlayer && outroEffect.newMechanicState && current.activeAllyCharacterId === "vesper") {
            const grantMark = (outroEffect.newMechanicState as any).grantMarkOnOutro === true;
            const charged = (outroEffect.newMechanicState as any).chargedMark === true;
            if (grantMark) {
              current.allyMechanicState = { ...(current.allyMechanicState as VesperMechanicState), markPresent: true, chargedMark: charged };
            }
          }
          if (outgoingIsPlayer && introEffect.newMechanicState && current.activeAllyCharacterId === "vesper") {
            const energyGrant = (introEffect.newMechanicState as any).grantEnergyOnIntro as number | undefined;
            if (energyGrant) current.energy = Math.min(100, current.energy + energyGrant);
          }
          let riloShieldTransferBonus = 0;
          if (!outgoingIsPlayer && outroEffect.newMechanicState && current.activeAllyCharacterId === "rilo") {
            const rOutgoing = current.allyMechanicState as RiloMechanicState;
            const transferFrac = (outroEffect.newMechanicState as any).grantShieldTransferOnOutro as number;
            riloShieldTransferBonus = Math.floor(rOutgoing.shield * transferFrac);
            if ((outroEffect.newMechanicState as any).grantDefBuffOnOutro) {
              current.riloDefBuffTurnsLeft = ((outroEffect.newMechanicState as any).defBuffTurns as number) + 1;
              current.riloDefBuffPct = 0.15;
            }
          }
          if (outgoingIsPlayer && introEffect.newMechanicState && current.activeAllyCharacterId === "rilo") {
            const grant = (introEffect.newMechanicState as any).grantShieldOnIntro as number | undefined;
            if (grant) {
              const rIncoming = current.allyMechanicState as RiloMechanicState;
              current.allyMechanicState = { ...rIncoming, shield: Math.min(riloMaxShield(current.solaceConstellation), rIncoming.shield + grant) };
            }
          }

          if (!outgoingIsPlayer) current.nextCritArmed = true;

          const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta + riloShieldTransferBonus;

          let actualGain: number;
          if (outgoingIsPlayer) {
            const before = current.allyHp;
            current.allyHp = Math.min(current.allyHpMax, current.allyHp + totalBonus);
            actualGain = current.allyHp - before;
          } else {
            const before = current.hp;
            current.hp = Math.min(current.hpMax, current.hp + totalBonus);
            actualGain = current.hp - before;
          }

          moveLine = actualGain > 0
            ? `🔄 ${current.name} swapped to **${outgoingIsPlayer ? current.allyKit.label : current.name}** — Outro+Intro combo! +${actualGain} HP.`
            : `🔄 ${current.name} swapped to **${outgoingIsPlayer ? current.allyKit.label : current.name}** — Outro+Intro combo! (already at full HP, no heal needed)`;
          current.concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART in boss.ts
        } else {
          moveLine = `🔄 ${current.name} swapped to **${outgoingIsPlayer ? current.allyKit.label : current.name}** — Concerto Energy not full, no combo triggered.`;
        }

        current.activeUnit = outgoingIsPlayer ? "ally" : "player";
      }

      if (btn.customId === "raid_retreat") {
        current.isDefeated = true;
        current.activeUnit = "player";
        moveLine = `${current.name} retreated from the raid.`;

      } else if (btn.customId === "raid_basic") {
        const windExplosion = mySetId === "WINDSTRIDERS_LEGACY"
          ? windstridersLegacyCheckExplosion(current.namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
        const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(current.namedState) : 1;
        const forcedCrit = forcedCritActive || windExplosion.guaranteedCrit;
        // Milestone 3d: party-wide Attunement/Wellspring/Forte bonuses from
        // whichever participant(s) currently have their Solace active, folded
        // into WHOEVER is acting this turn (not just the ally's own owner).
        const party = raid.isDevGuild ? partyWideTeamBonuses(raid) : { atkMult: 1, critBonus: 0, defMult: 1 };
        const weakenedMult = raid.isDevGuild ? getWeakenedMult(current.playerDebuffs) : 1;
        // Solace's own Basic ("Chime Strike") uses her own level-scaled
        // multiplier instead of the player's plain Basic — and gets Wellspring's
        // base +18% ATK on top, same as boss.ts's single-owner case.
        const isAllyActing = raid.isDevGuild && current.activeUnit === "ally";
        const isSolaceActing = isAllyActing && current.activeAllyCharacterId === "solace";
        const isKaelithActing = isAllyActing && current.activeAllyCharacterId === "kaelith";
        const isVesperActing = isAllyActing && current.activeAllyCharacterId === "vesper";
        const basicMoveMult = isAllyActing && current.allyKit ? current.allyKit.basicDamageMult(current.solaceBasicLevel) : 1.0;
        const wellspringSelfAtkMult = isSolaceActing && current.allySolaceStats?.hasWellspring ? getWellspringBaseAtkMult(current.allySolaceStats.wellspringRefinement!) : 1;
        const teamMult = weakenedMult * party.atkMult * wellspringSelfAtkMult * basicMoveMult;
        // Forte fills only from the active ally's own Basic Attack — announce
        // only on the turn a threshold is actually crossed (mirrors boss.ts).
        if (isSolaceActing) {
          const forteBefore = current.solaceForte;
          current.solaceForte = addForteCharge(current.solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
          const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
          const isHalf  = current.solaceForte.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(current.solaceForte, SOLACE_FORTE_CONFIG);
          if (isForteMaxed(current.solaceForte, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
            forteAnnounce = `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
          } else if (isHalf && !wasHalf) {
            forteAnnounce = `\n✨ Forte is **HALF CHARGED**.`;
          }
        } else if (isKaelithActing) {
          const kState = current.allyMechanicState as KaelithMechanicState;
          const gain = kaelithBasicStackGain(current.solaceConstellation);
          const cap = kaelithStackCap(current.solaceConstellation);
          current.allyMechanicState = { ...kState, stacks: Math.min(cap, kState.stacks + gain) };
          forteAnnounce = `\n🌑 +${gain} stack${gain === 1 ? "" : "s"} (${(current.allyMechanicState as KaelithMechanicState).stacks}/${cap})`;

          const forteBefore = current.solaceForte;
          current.solaceForte = addForteCharge(current.solaceForte, KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(current.solaceForte, KAELITH_FORTE_CONFIG) && !isForteMaxed(forteBefore, KAELITH_FORTE_CONFIG)) {
            forteAnnounce += `\n✨ Forte is **FULLY CHARGED** — next Umbral Cataclysm will keep your stacks!`;
          }
        } else if (isVesperActing) {
          const vState = current.allyMechanicState as VesperMechanicState;
          current.allyMechanicState = { ...vState, markPresent: true };
          forteAnnounce = `\n⚡ Static Mark applied!`;

          const forteBefore = current.solaceForte;
          current.solaceForte = addForteCharge(current.solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(current.solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
            forteAnnounce += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
          }
        }
        const isRiloActing = isAllyActing && current.activeAllyCharacterId === "rilo";
        const r    = calcPlayerDamage(activeAtk * smolderMult * havocAtkMult * teamMult, defVal, forcedCrit ? 1 : Math.min(1, aCrit + party.critBonus), activeCritDmg, 1.0, isWeak, raid.isShattered);
        if (isRiloActing) {
          const rState = current.allyMechanicState as RiloMechanicState;
          const maxShield = riloMaxShield(current.solaceConstellation);
          const critBonus = r.isCrit ? Math.floor(RILO_SHIELD_GAIN_PER_BASIC * (current.solaceConstellation >= 1 ? 0.5 : 0)) : 0;
          current.allyMechanicState = { ...rState, shield: Math.min(maxShield, rState.shield + RILO_SHIELD_GAIN_PER_BASIC + critBonus) };
          forteAnnounce += `\n🛡️ +${RILO_SHIELD_GAIN_PER_BASIC + critBonus} Shield (${(current.allyMechanicState as RiloMechanicState).shield}/${maxShield})`;

          const forteBefore = current.solaceForte;
          current.solaceForte = addForteCharge(current.solaceForte, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(current.solaceForte, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
            forteAnnounce += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
          }
        }
        let base   = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        base       = Math.floor(base * elemWindstrideMult(current.bonuses.elementPassive, raid.turn, "BASIC"));
        if (mySetId === "WINDSTRIDERS_LEGACY") {
          base = windExplosion.proc
            ? Math.floor(base * (1 + windExplosion.bonusMult))
            : Math.floor(base * windstridersLegacyOnHit(current.namedState));
        }
        let thunderboltEnergy = 0;
        if (mySetId === "STORMCALLERS_OATH") {
          const tb = stormcallersOathOnBasic(current.namedState);
          if (tb.proc) { base += Math.floor(current.atk * tb.bonusMult); thunderboltEnergy = tb.bonusEnergy; }
        }
        const ign  = elemIgniteProc(current.bonuses.elementPassive, current.atk);
        if (mySetId === "RADIANT_CONVERGENCE" && r.isCrit) radiantConvergenceOnCrit(current.namedState, current.hp, current.hpMax);
        damage = base + ign.dmg; isCrit = r.isCrit; vibFrac = 0.3;
        moveLine = `${current.name} — ${isSolaceActing ? "✦ Chime Strike" : "Basic Attack"}${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ign.tag ? `  ✦${ign.tag}` : ""}${forteAnnounce}`;
        current.energy = Math.min(100, current.energy + ENERGY_PER_TURN + Math.floor(current.bonuses.spdFlat / 20) + elemDischargeEnergy(current.bonuses.elementPassive, r.isCrit) + thunderboltEnergy);
        if (mySetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(current.namedState, current.energy);

      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "solace" && btn.customId === "raid_skill") {
        // Solace's Skill is Attunement — a mode cycle, not a damage move.
        // The ORIGINAL player Skill logic below is untouched and only runs
        // when this branch's condition is false.
        current.attunement.mode = cycleAttunementMode(current.attunement.mode);
        if (current.solaceConstellation >= 3) current.concertoEnergy = addConcertoEnergy(current.concertoEnergy, 25);
        // NOTE: WEAKENED deliberately NOT folded in here — it's a debuff on
        // the player, not on Solace, and this is her own Attunement-cycle hit.
        const crit = forcedCritActive || Math.random() < aCrit;
        const r = calcPlayerDamage(activeAtk * havocAtkMult, defVal, crit ? 1 : 0, activeCritDmg, 0.6, isWeak, raid.isShattered);
        const base = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        damage = base; isCrit = r.isCrit; vibFrac = 0.3;
        moveLine = `${current.name} — ✦ Attunement — now in **${current.attunement.mode}** mode!`;

      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "kaelith" && current.allyKit && btn.customId === "raid_skill") {
        const kState = current.allyMechanicState as KaelithMechanicState;
        if (kState.stacks <= 0) {
          moveLine = `${current.name} — 🌑 Umbral Detonation — no stacks to consume! (0 DMG bonus)`;
          damage = 0;
        } else {
          const crit = forcedCritActive || Math.random() < aCrit;
          const result = current.allyKit.onSkill(
            { playerHp: current.hp, playerHpMax: current.hpMax, allyHp: current.allyHp, allyHpMax: current.allyHpMax, turn: raid.turn, isShattered: raid.isShattered, mechanicState: kState },
            { basicLevel: current.solaceBasicLevel, skillLevel: current.solaceSkillLevel, ultimateLevel: current.solaceUltimateLevel, introLevel: current.solaceIntroLevel, forteLevel: current.solaceForteLevel },
            current.solaceConstellation,
          );
          current.allyMechanicState = result.newMechanicState;
          const r = calcPlayerDamage(activeAtk * havocAtkMult, defVal, crit ? 1 : 0, activeCritDmg, result.damageMult, isWeak, raid.isShattered);
          const base = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
          damage = base; isCrit = r.isCrit; vibFrac = result.vibFrac;
          moveLine = `${current.name} — 🌑 ${result.moveLabel}${crit ? " **(CRIT)**" : ""}`;
        }
        current.skillCd = current.allyKit.skillCooldownTurns;

      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "vesper" && current.allyKit && btn.customId === "raid_skill") {
        const vState = current.allyMechanicState as VesperMechanicState;
        const crit = forcedCritActive || Math.random() < aCrit;
        const forteEmpowered = isForteMaxed(current.solaceForte, VESPER_FORTE_CONFIG);
        const result = current.allyKit.onSkill(
          { playerHp: current.hp, playerHpMax: current.hpMax, allyHp: current.allyHp, allyHpMax: current.allyHpMax, turn: raid.turn, isShattered: raid.isShattered, mechanicState: vState, forteEmpowered } as any,
          { basicLevel: current.solaceBasicLevel, skillLevel: current.solaceSkillLevel, ultimateLevel: current.solaceUltimateLevel, introLevel: current.solaceIntroLevel, forteLevel: current.solaceForteLevel },
          current.solaceConstellation,
        ) as VesperSkillResult;
        current.allyMechanicState = result.newMechanicState;
        if (forteEmpowered) current.solaceForte = resetForte();

        const effectiveDefVal = defVal * (1 - result.defIgnorePct);
        const perHit = calcPlayerDamage(activeAtk * havocAtkMult, effectiveDefVal, crit ? 1 : 0, activeCritDmg, result.damageMult / result.hits, isWeak, raid.isShattered);
        const perHitDmg = Math.floor(perHit.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);

        if (result.hits > 1) {
          const hitLines = Array.from({ length: result.hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
          damage = perHitDmg * result.hits;
          moveLine = `${current.name} — ⚡ ${result.moveLabel}\n${hitLines}\n**Total: ${damage} DMG**${crit ? " **(CRIT)**" : ""}`;
        } else {
          damage = perHitDmg;
          moveLine = `${current.name} — ⚡ ${result.moveLabel}${crit ? " **(CRIT)**" : ""}`;
        }
        isCrit = crit; vibFrac = result.vibFrac;

        if (!forteEmpowered) {
          const forteBefore = current.solaceForte;
          current.solaceForte = addForteCharge(current.solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(current.solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
            moveLine += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
          }
        }
        current.skillCd = current.allyKit.skillCooldownTurns;

      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "rilo" && current.allyKit && btn.customId === "raid_skill") {
        const rState = current.allyMechanicState as RiloMechanicState;
        const crit = true;
        const forteEmpowered = isForteMaxed(current.solaceForte, RILO_FORTE_CONFIG);
        const result = current.allyKit.onSkill(
          { playerHp: current.hp, playerHpMax: current.hpMax, allyHp: current.allyHp, allyHpMax: current.allyHpMax, turn: raid.turn, isShattered: raid.isShattered, mechanicState: rState, forteEmpowered } as any,
          { basicLevel: current.solaceBasicLevel, skillLevel: current.solaceSkillLevel, ultimateLevel: current.solaceUltimateLevel, introLevel: current.solaceIntroLevel, forteLevel: current.solaceForteLevel },
          current.solaceConstellation,
        ) as RiloSkillResult;
        current.allyMechanicState = result.newMechanicState;
        if (forteEmpowered) current.solaceForte = resetForte();

        const r = calcPlayerDamage(activeAtk, defVal, 1.0, activeCritDmg, result.damageMult, isWeak, raid.isShattered);
        damage = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        moveLine = `${current.name} — 🛡️ ${result.moveLabel} **(CRIT)** (consumed ${result.shieldConsumed} Shield)`;
        if (result.defShredApplied) {
          raid.bossDefShredTurnsLeft = 2 + 1;
          raid.bossDefShredPct = RILO_C2_DEF_SHRED_PCT;
          moveLine += `\n❄️ Enemy DEF shredded 10% for 2 turns!`;
        }
        isCrit = crit; vibFrac = result.vibFrac;

        if (!forteEmpowered) {
          const forteBefore = current.solaceForte;
          current.solaceForte = addForteCharge(current.solaceForte, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(current.solaceForte, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
            moveLine += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
          }
        }
        current.skillCd = current.allyKit.skillCooldownTurns;

      } else if (btn.customId === "raid_skill") {
        const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(current.namedState) : 1;
        const party = raid.isDevGuild ? partyWideTeamBonuses(raid) : { atkMult: 1, critBonus: 0, defMult: 1 };
        const weakenedMult = raid.isDevGuild ? getWeakenedMult(current.playerDebuffs) : 1;
        const teamMult = weakenedMult * party.atkMult;
        const r    = calcPlayerDamage(current.atk * smolderMult * havocAtkMult * teamMult, defVal, forcedCritActive ? 1 : Math.min(1, aCrit + 0.1 + party.critBonus), current.critDmg, 1.8, isWeak, raid.isShattered);
        let base   = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        base       = Math.floor(base * elemWindstrideMult(current.bonuses.elementPassive, raid.turn, "SKILL"));
        if (mySetId === "WINDSTRIDERS_LEGACY") base = Math.floor(base * windstridersLegacyOnHit(current.namedState));
        if (mySetId === "SMOLDERING_SOVEREIGN") {
          const sov = smolderingSovereignOnSkill(current.namedState);
          if (sov.doubleHit) base = Math.floor(base * sov.bonusMult * 2);
        }
        const ign  = elemIgniteProc(current.bonuses.elementPassive, current.atk);
        if (mySetId === "RADIANT_CONVERGENCE" && r.isCrit) radiantConvergenceOnCrit(current.namedState, current.hp, current.hpMax);
        damage = base + ign.dmg; isCrit = r.isCrit; moveType = "SKILL"; vibFrac = 0.6;
        moveLine = `${current.name} — Resonance Skill${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ign.tag ? `  ✦${ign.tag}` : ""}`;
        current.skillCd = effectiveSkillCooldown(current.bonuses, SKILL_CD);
        current.energy  = Math.min(100, current.energy + ENERGY_PER_TURN + Math.floor(current.bonuses.spdFlat / 20) + elemDischargeEnergy(current.bonuses.elementPassive, r.isCrit));

      } else if (btn.customId === "raid_ultimate" && !(raid.isDevGuild && current.activeUnit === "ally")) {
        const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(current.namedState) : 1;
        const party = raid.isDevGuild ? partyWideTeamBonuses(raid) : { atkMult: 1, critBonus: 0, defMult: 1 };
        const weakenedMult = raid.isDevGuild ? getWeakenedMult(current.playerDebuffs) : 1;
        const teamMult = weakenedMult * party.atkMult;
        const r  = calcPlayerDamage(current.atk * smolderMult * havocAtkMult * teamMult, defVal, 1.0, current.critDmg, 3.5, isWeak, raid.isShattered);
        let base = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        if (mySetId === "WINDSTRIDERS_LEGACY") base = Math.floor(base * windstridersLegacyOnHit(current.namedState));
        if (mySetId === "RADIANT_CONVERGENCE") radiantConvergenceOnCrit(current.namedState, current.hp, current.hpMax);
        damage = base; isCrit = true; moveType = "ULT"; vibFrac = 0.8;
        moveLine = `${current.name} — ⚡ **ULTIMATE**${isWeak ? " **(WEAK)**" : ""}`;
        current.energy = 0;
        if (mySetId === "STORMCALLERS_OATH") {
          const surge = stormcallersOathOnUltimate();
          current.stormBuffTurnsLeft = surge.turnsLeft + 1;
          current.stormBuffCritBonus = surge.critRateBonus;
        }
      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "solace" && btn.customId === "raid_ultimate") {
        // Solace's Ultimate (Convergence) spends Concerto Energy, not personal
        // Energy, and heals the WHOLE living party (not just the caster) —
        // this is the one place /raid genuinely diverges from boss.ts's
        // single-owner shape.
        const healPct = solaceConvergenceHealPct(current.solaceUltimateLevel, current.solaceConstellation);
        const healLines: string[] = [];
        for (const p of raid.participants.filter(pp => !pp.isDefeated)) {
          const bodyResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
            { type: "CLEANSE_ALLY", value: solaceConvergenceCleanseCount(current.solaceConstellation) },
          ] }, { hp: p.hp, hpMax: p.hpMax });
          const allyResult = resolveIntroOutroEffect({ actions: [
            { type: "HEAL_ALLY", value: healPct },
          ] }, { hp: p.allyHp, hpMax: p.allyHpMax });

          const beforeBody = p.hp;
          p.hp = Math.min(p.hpMax, p.hp + bodyResult.hpDelta);
          const actualBody = p.hp - beforeBody;

          const beforeAlly = p.allyHp;
          p.allyHp = Math.min(p.allyHpMax, p.allyHp + allyResult.hpDelta);
          const actualAlly = p.allyHp - beforeAlly;

          p.playerDebuffs = cleanseDebuffs(p.playerDebuffs, bodyResult.cleanseCount);

          if (actualBody > 0 || actualAlly > 0) {
            healLines.push(`${p.name} +${actualBody} HP${p.hasSolace ? `, ${p.allyKit?.label ?? "Solace"} +${actualAlly} HP` : ""}`);
          }
        }

        current.concertoEnergy = 0;
        convergenceUsedThisTurn = true;
        damage = 0; isCrit = false; moveType = "ULT";

        const healSummary = healLines.length > 0 ? healLines.join("  ·  ") : "party already at full HP";

        if (isForteMaxed(current.solaceForte, SOLACE_FORTE_CONFIG)) {
          current.forteEmpoweredTurnsLeft = solaceUltimateDoubleTurns(current.solaceConstellation) + 1; // +1 compensates for the same-round decrement
          current.attunementDoubleTurnsLeft = 0;
          current.solaceForte = resetForte();
          moveLine = `${current.name} — ⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
            `**all 3 Attunement Modes empowered for ${solaceUltimateDoubleTurns(current.solaceConstellation)} turns!**`;
        } else {
          current.attunementDoubleTurnsLeft = solaceUltimateDoubleTurns(current.solaceConstellation) + 1; // +1 compensates for the same-round decrement
          current.forteEmpoweredTurnsLeft = 0;
          moveLine = `${current.name} — ⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
            `**${current.attunement.mode ?? "no"} mode doubled for ${solaceUltimateDoubleTurns(current.solaceConstellation)} turns!**`;
        }
      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "kaelith" && current.allyKit && btn.customId === "raid_ultimate") {
        const kState = current.allyMechanicState as KaelithMechanicState;
        const stacksConsumed = kState.stacks;

        const ultDamageMult = current.solaceConstellation >= 6
          ? stacksConsumed * (KAELITH_PER_STACK_ULT_BONUS * 1.6)
          : kaelithUltimateBaseMult(current.solaceUltimateLevel) + stacksConsumed * KAELITH_PER_STACK_ULT_BONUS;

        const result = current.allyKit.onUltimate(
          { playerHp: current.hp, playerHpMax: current.hpMax, allyHp: current.allyHp, allyHpMax: current.allyHpMax, turn: raid.turn, isShattered: raid.isShattered, mechanicState: kState },
          { basicLevel: current.solaceBasicLevel, skillLevel: current.solaceSkillLevel, ultimateLevel: current.solaceUltimateLevel, introLevel: current.solaceIntroLevel, forteLevel: current.solaceForteLevel },
          current.solaceConstellation,
        );
        current.allyMechanicState = result.newMechanicState;

        const r = calcPlayerDamage(activeAtk * havocAtkMult * ultDamageMult, defVal, 1.0, activeCritDmg, 1.0, isWeak, raid.isShattered);
        const base = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        damage = base; isCrit = true; moveType = "ULT"; vibFrac = 0.8;
        moveLine = `${current.name} — 🌑 ${result.moveLabel}`;

        if (result.healResult.actions.length > 0) {
          const healResult = resolveIntroOutroEffect(result.healResult, { hp: current.allyHp, hpMax: current.allyHpMax });
          current.allyHp = Math.min(current.allyHpMax, current.allyHp + healResult.hpDelta);
        }
        if (result.resetsConcertoEnergy) { current.concertoEnergy = 0; convergenceUsedThisTurn = true; }
      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "vesper" && current.allyKit && btn.customId === "raid_ultimate") {
        const vState = current.allyMechanicState as VesperMechanicState;
        const consumedMark = vState.markPresent;
        const energyPct = Math.min(100, current.energy) / 100;
        const markBonus = consumedMark ? 0.8 : 0;
        const c6Bonus = current.solaceConstellation >= 6 ? vState.dischargesSinceUltimate * 0.15 : 0;
        const c3Bonus = current.solaceConstellation >= 3 ? energyPct * 0.5 : 0;
        const ultDamageMult = vesperUltimateBaseMult(current.solaceUltimateLevel) + markBonus + c6Bonus + c3Bonus;

        const result = current.allyKit.onUltimate(
          { playerHp: current.hp, playerHpMax: current.hpMax, allyHp: current.allyHp, allyHpMax: current.allyHpMax, turn: raid.turn, isShattered: raid.isShattered, mechanicState: vState, playerEnergy: current.energy, playerEnergyMax: 100 },
          { basicLevel: current.solaceBasicLevel, skillLevel: current.solaceSkillLevel, ultimateLevel: current.solaceUltimateLevel, introLevel: current.solaceIntroLevel, forteLevel: current.solaceForteLevel },
          current.solaceConstellation,
        );
        current.allyMechanicState = result.newMechanicState;

        const r = calcPlayerDamage(activeAtk * havocAtkMult * ultDamageMult, defVal, 1.0, activeCritDmg, 1.0, isWeak, raid.isShattered);
        const base = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        damage = base; isCrit = true; moveType = "ULT"; vibFrac = 0.8;
        moveLine = `${current.name} — ⚡ ${result.moveLabel}`;
      } else if (raid.isDevGuild && current.activeUnit === "ally" && current.activeAllyCharacterId === "rilo" && current.allyKit && btn.customId === "raid_ultimate") {
        const rState = current.allyMechanicState as RiloMechanicState;
        const result = current.allyKit.onUltimate(
          { playerHp: current.hp, playerHpMax: current.hpMax, allyHp: current.allyHp, allyHpMax: current.allyHpMax, turn: raid.turn, isShattered: raid.isShattered, mechanicState: rState },
          { basicLevel: current.solaceBasicLevel, skillLevel: current.solaceSkillLevel, ultimateLevel: current.solaceUltimateLevel, introLevel: current.solaceIntroLevel, forteLevel: current.solaceForteLevel },
          current.solaceConstellation,
        );
        const maxShield = riloMaxShield(current.solaceConstellation);
        const c6DoubleHit = current.solaceConstellation >= 6 && rState.shield >= maxShield;
        const hits = c6DoubleHit ? 2 : 1;

        const perHit = calcPlayerDamage(activeAtk, defVal, 1.0, activeCritDmg, riloUltimateBaseMult(current.solaceUltimateLevel) / hits, isWeak, raid.isShattered);
        const perHitDmg = Math.floor(perHit.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);
        const totalDmg = perHitDmg * hits;

        const c4Bonus = riloUltimateShieldFromDamage(totalDmg, current.solaceConstellation);
        current.allyMechanicState = {
          ...(result.newMechanicState as RiloMechanicState),
          shield: Math.min(maxShield, (result.newMechanicState as RiloMechanicState).shield + c4Bonus),
        };

        if (hits > 1) {
          const hitLines = Array.from({ length: hits }, (_, i) => `Hit ${i + 1}: ${perHitDmg} dmg`).join("\n");
          damage = totalDmg;
          moveLine = `${current.name} — 🛡️ ${result.moveLabel}\n${hitLines}\n**Total: ${damage} DMG**`;
        } else {
          damage = totalDmg;
          moveLine = `${current.name} — 🛡️ ${result.moveLabel} — ${damage} DMG`;
        }
        isCrit = true; moveType = "ULT"; vibFrac = 0.8;

        if (result.healResult.actions.length > 0) {
          current.playerDebuffs = cleanseDebuffs(current.playerDebuffs, 1);
        }
      } else if (btn.customId === "raid_echoskill" && current.bonuses.echoSkill) {
        const def = current.bonuses.echoSkill;
        const echoCrit = forcedCritActive || def.kind === "GUARANTEED_CRIT" || Math.random() < aCrit;
        isCrit = echoCrit; moveType = "SKILL"; vibFrac = 0.5;
        const smolderMult = mySetId === "SMOLDERING_SOVEREIGN" ? smolderingSovereignOnAction(current.namedState) : 1;
        const r = calcPlayerDamage(current.atk * smolderMult * havocAtkMult, defVal, echoCrit ? 1 : 0, current.critDmg, echoSkillBaseMult(), isWeak, raid.isShattered);
        let base = Math.floor(r.damage * (1 + current.elemDmg + extraElemBonus) * radiantDmgMult);

        const result = applyEchoSkill(def, {
          atk: current.atk, enemyHp: raid.bossHp, enemyHpMax: raid.bossHpMax,
          playerHp: current.hp, playerHpMax: current.hpMax,
          playerEnergy: current.energy, turn: raid.turn, bossVibMax: raid.bossVibMax, crit: echoCrit,
        });
        base = Math.floor(base * result.dmgMult);
        if (result.doubleHit) base *= 2;
        if (result.noDamage) base = 0;

        let namedTriggerTag = "";
        if (def.kind === "NAMED_SET_TRIGGER" && mySetId === def.setId) {
          switch (def.setId) {
            case "SMOLDERING_SOVEREIGN":
              current.namedState.fusionAtkStacks = 4; current.namedState.fusionSkillDoubleArmed = true;
              namedTriggerTag = "ATK stacks maxed!";
              break;
            case "FROSTVEIL_BASTION":
              if (!current.namedState.glacioShieldUsed) {
                current.namedState.glacioShieldUsed = true;
                const shieldAmt = Math.floor(current.hpMax * 0.28);
                current.hp = Math.min(current.hpMax, current.hp + shieldAmt);
                current.glacioShieldTurnsLeft = 5; current.glacioShieldElemBonus = 0.22;
                namedTriggerTag = `+${shieldAmt} HP shield!`;
              }
              break;
            case "STORMCALLERS_OATH":
              current.namedState.electroThunderboltArmed = true;
              namedTriggerTag = "Thunderbolt armed!";
              break;
            case "WINDSTRIDERS_LEGACY":
              current.namedState.aeroWindstacks = 6;
              namedTriggerTag = "Windstacks maxed!";
              break;
            case "VOIDBORN_REMNANT":
              if (!current.namedState.havocFrenzyUsed) {
                current.namedState.havocFrenzyUsed = true;
                current.namedState.havocFrenzyTurnsLeft = 4;
                current.havocFrenzyAtkMult = 1.25; current.havocFrenzyLifesteal = 0.15; current.havocFrenzyDefIgnore = 0.20;
                namedTriggerTag = "Frenzy triggered!";
              }
              break;
            case "RADIANT_CONVERGENCE":
              current.namedState.spectroHealStacks = 5;
              namedTriggerTag = "Heal-stacks maxed!";
              break;
          }
        }

        const ign = result.noDamage ? { dmg: 0, tag: "" } : elemIgniteProc(current.bonuses.elementPassive, current.atk);
        damage = base + ign.dmg;
        moveLine = `${current.name} — 🌀 ${def.name}${echoCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}`;
        if (namedTriggerTag) moveLine += `\n✦ ${namedTriggerTag}`;
        if (ign.tag) moveLine += `  ✦${ign.tag}`;

        const echoEnGain = ENERGY_PER_TURN + Math.floor(current.bonuses.spdFlat / 20) + elemDischargeEnergy(current.bonuses.elementPassive, echoCrit) + result.bonusEnergy;
        current.echoSkillCd = (result.resetCdOnCrit && echoCrit) ? 0 : 4;
        current.energy = result.setEnergyFull ? 100 : Math.min(100, current.energy + echoEnGain);
        if (result.healHp > 0) current.hp = Math.min(current.hpMax, current.hp + result.healHp);
        if (result.armsNextCrit) current.nextCritArmed = true;
        if (result.defShredTurns > 0) {
          raid.bossDefShredTurnsLeft = result.defShredTurns + 1;
          raid.bossDefShredPct = result.defShredPct;
        }
        if (!result.noDamage) {
          raid.bossVib = Math.max(0, raid.bossVib - result.extraVibDrain); // vibFrac-based drain applied below by the shared block
        }
      }
      const echoFlatLifesteal = (btn.customId === "raid_echoskill" && current.bonuses.echoSkill?.kind === "FLAT_LIFESTEAL")
        ? current.bonuses.echoSkill.pct : 0;

      // Apply ability effects and element hooks (attack moves only)
      if (btn.customId !== "raid_retreat") {
        const ar = applyAbilityAttack(current.bonuses, damage, isCrit, {
          moveType, currentHp: current.hp, maxHp: current.hpMax,
          enemyHpPct: bossHpPct, turn: raid.turn, isFirstAction: current.firstAction,
        });
        damage = ar.dmg;
        if (ar.tag) moveLine += `  ✦${ar.tag}`;
        moveLine += ` — **${damage.toLocaleString()} DMG**`;
        current.hp        = Math.min(current.hpMax, applyLifesteal(current.lifesteal + havocLifesteal + echoFlatLifesteal, damage, current.hp, current.hpMax) + ar.healHp);
        current.energy    = Math.min(100, current.energy + ar.bonusEnergy);
        current.firstAction = false;
        raid.bossVib       = Math.max(0, raid.bossVib - Math.floor(damage * vibFrac * vibMult));

        if (raid.bossVib <= 0 && !raid.isShattered) {
          raid.isShattered  = true;
          raid.shatterLeft  = 2;
          moveLine += "\n✦ **SHATTER!** Boss stunned — next 2 attacks guaranteed CRIT!";
          const voidHeal = elemVoidSurgeHeal(current.bonuses.elementPassive, current.hpMax);
          if (voidHeal > 0) {
            current.hp = Math.min(current.hpMax, current.hp + voidHeal);
            moveLine  += `\n✦ **${current.name}'s Void Surge** — +${voidHeal} HP!`;
          }
          if (mySetId === "VOIDBORN_REMNANT") {
            const remnant  = voidbornRemnantOnShatter();
            const bonusDmg = Math.floor(current.atk * remnant.bonusMult);
            raid.bossHp    = Math.max(0, raid.bossHp - bonusDmg);
            const healAmt  = Math.floor(current.hpMax * remnant.healPct);
            current.hp     = Math.min(current.hpMax, current.hp + healAmt);
            moveLine += `\n🌑 **${current.name}'s Voidborn Rupture** — +${bonusDmg} bonus DMG, +${healAmt} HP!`;
          }
        }
      }

      // Concerto Energy builds from combat actions, never from swapping —
      // and Convergence itself must not refund energy on the same turn it
      // spends the bar (see convergenceUsedThisTurn declaration above).
      const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
        raid_basic: 10, raid_skill: 20, raid_echoskill: 20, raid_ultimate: 35,
      };
      if (raid.isDevGuild && !convergenceUsedThisTurn) {
        let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
        if (concertoGain > 0 && current.activeUnit === "ally" && current.allySolaceStats?.hasWellspring) concertoGain += getWellspringBaseEnergyBonus(current.allySolaceStats.wellspringRefinement);
        if (concertoGain > 0) current.concertoEnergy = addConcertoEnergy(current.concertoEnergy, concertoGain);
      }

      current.dmgDealt += damage;
      raid.bossHp       = Math.max(0, raid.bossHp - damage);

      // Victory
      if (raid.bossHp <= 0) {
        await battleMsg.edit({ embeds: [raidEmbed(raid, boss, moveLine)], components: [] });
        await finishRaid(true);
        return;
      }

      // ── Boss counter-attack (AoE vs all living players) ──────────────────────
      nextParticipant(raid);   // advance pointer (side effect: sets raid.currentIdx)

      // Milestone 3d: debuffs tick down at the START of resolving the boss's
      // turn — mirrors boss.ts's Milestone 3b Task 3 timing, so any WEAKENED
      // applied by the AoE below isn't touched until NEXT round's tick.
      if (raid.isDevGuild) {
        const tickResult = tickDebuffs(current.playerDebuffs);
        current.playerDebuffs = tickResult.state;
      }

      if (raid.shatterLeft > 0) {
        raid.shatterLeft--;
        if (raid.shatterLeft === 0) {
          raid.isShattered = false;
          raid.bossVib     = raid.bossVibMax;
          moveLine += "\n◇ Boss recovers from Shatter. Vibration bar reset.";
        } else {
          moveLine += `\n◇ Boss stunned (${raid.shatterLeft} turn${raid.shatterLeft > 1 ? "s" : ""} left).`;
        }
      } else {
        const move    = boss.moves[Math.floor(Math.random() * boss.moves.length)];
        const aoeBase = Math.floor(raid.bossAtk * move.damage * 0.6); // AoE = 60% of single-target
        const alive   = raid.participants.filter(p => !p.isDefeated);
        const dmgLines: string[] = [];
        // Milestone 3d: party-wide DEF bonuses (Attunement DEF-mode/Wellspring/
        // Forte) from whoever currently has their Solace active apply to
        // EVERY living participant's damage taken, not just the owner's.
        const party = raid.isDevGuild ? partyWideTeamBonuses(raid) : { atkMult: 1, critBonus: 0, defMult: 1 };

        for (const p of alive) {
          // Milestone 3.5b: while this participant's Solace is defending,
          // damage reduction uses HER OWN DEF, not the player's own.
          const pDefendingWithAlly = raid.isDevGuild && p.activeUnit === "ally" && p.allySolaceStats !== null;
          const pActiveDef = pDefendingWithAlly ? p.allySolaceStats!.def : p.def;
          const pRiloDefBuffMult = p.riloDefBuffTurnsLeft > 0 ? (1 + p.riloDefBuffPct) : 1;
          let bossDmg    = calcEnemyDamage(aoeBase, pActiveDef * party.defMult * pRiloDefBuffMult, 1.0);
          const shield   = elemFrostShield(p.bonuses.elementPassive, bossDmg);
          bossDmg        = shield.dmg;
          const radRegen = elemRadianceRegen(p.bonuses.elementPassive, p.hpMax);

          // Milestone 3d: while a participant's own Solace is active, AoE
          // damage routes into her ally HP pool instead of the participant's
          // own HP — depleting it is NOT a defeat, just a forced swap back.
          const hitsAlly = raid.isDevGuild && p.activeUnit === "ally";
          if (hitsAlly && p.activeAllyCharacterId === "rilo") {
            const rState = p.allyMechanicState as RiloMechanicState;
            const hitResult = riloOnHitTaken(rState, bossDmg, p.allyHp, p.allyHpMax, p.solaceConstellation);
            p.allyMechanicState = hitResult.newMechanicState;
            bossDmg = hitResult.actualDamageTaken;
            if (hitResult.forteGain > 0) p.solaceForte = addForteCharge(p.solaceForte, RILO_FORTE_CONFIG, hitResult.forteGain);
          }
          if (hitsAlly) {
            p.allyHp = Math.max(0, p.allyHp - bossDmg);
            if (radRegen > 0) p.allyHp = Math.min(p.allyHpMax, p.allyHp + radRegen);
          } else {
            p.hp = Math.max(0, p.hp - bossDmg);
            if (radRegen > 0) p.hp = Math.min(p.hpMax, p.hp + radRegen);
          }

          const pSetId = p.bonuses.activeNamedSetId;
          if (pSetId === "SMOLDERING_SOVEREIGN") smolderingSovereignOnDamageTaken(p.namedState);
          if (pSetId === "WINDSTRIDERS_LEGACY") windstridersLegacyOnBigHitTaken(p.namedState, bossDmg, p.hpMax);
          if (pSetId === "VOIDBORN_REMNANT" && p.hp > 0) {
            const frenzy = voidbornRemnantCheckFrenzy(p.namedState, p.hp, p.hpMax);
            if (frenzy.triggered) {
              p.havocFrenzyAtkMult = frenzy.atkMult; p.havocFrenzyLifesteal = frenzy.lifesteal; p.havocFrenzyDefIgnore = frenzy.defIgnorePct;
              dmgLines.push(`${p.name} 🌑Frenzy!`);
            }
          }
          if (pSetId === "RADIANT_CONVERGENCE" && p.hp > 0) {
            radiantConvergenceOnHitTaken(p.namedState, bossDmg, p.hpMax);
            const burst = radiantConvergenceCheckBurstHeal(p.namedState, p.hp, p.hpMax);
            if (burst > 0) { p.hp = Math.min(p.hpMax, p.hp + burst); dmgLines.push(`${p.name} +${burst}✨Fracture`); }
          }
          if (pSetId === "FROSTVEIL_BASTION" && p.hp > 0) {
            const counter = frostveilBastionOnHitTaken(p.namedState);
            if (counter.counterProc) {
              raid.bossVib = Math.max(0, raid.bossVib - Math.floor(raid.bossVibMax * counter.vibDrain));
              dmgLines.push(`${p.name} ❄️Counter-Frost`);
            }
            const panic = frostveilBastionCheckPanicShield(p.namedState, p.hp, p.hpMax);
            if (panic.triggered) {
              p.hp = Math.min(p.hpMax, p.hp + panic.shieldAmount);
              p.glacioShieldTurnsLeft = panic.turnsLeft + 1;
              p.glacioShieldElemBonus = panic.elemDmgBonus;
              dmgLines.push(`${p.name} +${panic.shieldAmount}❄️Shield`);
            }
          }

          if (hitsAlly) {
            // Ally HP hitting 0 forces a swap back to the player — this is
            // NOT a defeat (only the player's own p.hp <= 0 is).
            if (p.allyHp <= 0) {
              p.allyHp = 0;
              p.activeUnit = "player";
              dmgLines.push(`${p.name}'s ${p.allyKit?.label ?? "ally"} -${bossDmg} — swapped back!`);
            } else {
              const suffix = shield.blocked ? " 🛡" : radRegen > 0 ? ` +${radRegen}✨` : "";
              dmgLines.push(`${p.name}'s ${p.allyKit?.label ?? "ally"} -${bossDmg}${suffix}`);
            }
          } else if (p.hp <= 0) {
            if (compositeHasSecondWind(p.bonuses.abilityEffects) && !p.secondWindUsed) {
              p.secondWindUsed = true; p.hp = 1;
              dmgLines.push(`${p.name} -${bossDmg} ✦UNDYING`);
            } else {
              p.hp = 0; p.isDefeated = true;
              dmgLines.push(`${p.name} -${bossDmg} 💀`);
            }
          } else {
            const suffix = shield.blocked ? " 🛡" : radRegen > 0 ? ` +${radRegen}✨` : "";
            dmgLines.push(`${p.name} -${bossDmg}${suffix}`);
          }

          // Milestone 3d: WEAKENED — independent 25% roll per participant hit
          // by the AoE (not one shared roll for the whole AoE), matching the
          // recommendation to treat each hit as its own chance, since the AoE
          // already loops over every living participant individually.
          // Milestone 3.5a fix: gated on THIS participant's own hasSolace, not
          // raid.isDevGuild — a participant who never opted into team
          // mechanics via /team shouldn't be affected.
          if (p.hasSolace && !p.isDefeated && Math.random() < 0.25) {
            p.playerDebuffs = applyDebuff(p.playerDebuffs, "WEAKENED", 0.2, 2);
            dmgLines.push(`${p.name} WEAKENED`);
          }

          if (p.glacioShieldTurnsLeft > 0) p.glacioShieldTurnsLeft--;
          if (p.riloDefBuffTurnsLeft > 0) p.riloDefBuffTurnsLeft--;
          if (p.stormBuffTurnsLeft > 0) p.stormBuffTurnsLeft--;
          if (p.namedState.spectroFractureTurnsLeft > 0) p.namedState.spectroFractureTurnsLeft--;
        }
        moveLine += `\n◇ **${boss.name}** ${move.effect} (AoE) — ${dmgLines.join("  ·  ")}`;
        current.energy = Math.min(100, current.energy + 15);
      }

      if (current.skillCd > 0) current.skillCd--;
      if (current.echoSkillCd > 0) current.echoSkillCd--;
      if (raid.isDevGuild && current.attunementDoubleTurnsLeft > 0) current.attunementDoubleTurnsLeft--;
      if (raid.isDevGuild && current.forteEmpoweredTurnsLeft > 0) current.forteEmpoweredTurnsLeft--;
      if (raid.bossDefShredTurnsLeft > 0) raid.bossDefShredTurnsLeft--;
      if (forcedCritActive && btn.customId !== "raid_swap") current.nextCritArmed = false;

      // All defeated?
      if (raid.participants.every(p => p.isDefeated)) {
        await battleMsg.edit({ embeds: [raidEmbed(raid, boss, moveLine)], components: [] });
        await finishRaid(false);
        return;
      }

      raid.turn++;
      const nextP    = raid.participants[raid.currentIdx];
      const newMsg   = await thread.send({
        embeds:     [raidEmbed(raid, boss, moveLine)],
        components: nextP ? buildRaidButtons(nextP, raid.isDevGuild) : [],
      });
      await battleMsg.edit({ components: [] }).catch(() => {});
      battleMsg = newMsg;
      runRaidTurn();
    });

    collector.on("end", async (_, reason) => {
      if (reason !== "time") return;
      current.skillCd = Math.max(0, current.skillCd - 1);
      const skip  = `⏱ ${current.name} took too long — turn skipped.`;
      const nextP = raid.participants[raid.currentIdx];
      raid.turn++;
      const newMsg = await thread.send({
        embeds:     [raidEmbed(raid, boss, skip)],
        components: nextP ? buildRaidButtons(nextP, raid.isDevGuild) : [],
      });
      await battleMsg.edit({ components: [] }).catch(() => {});
      battleMsg = newMsg;
      runRaidTurn();
    });
  };

  runRaidTurn();
}
