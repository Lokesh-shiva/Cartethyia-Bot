import {
  TextChannel, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, AttachmentBuilder,
  ComponentType, ButtonInteraction, Message,
  StringSelectMenuBuilder, StringSelectMenuInteraction,
} from "discord.js";
import * as fs   from "fs";
import * as path from "path";
import prisma from "./prisma";
import {
  EchoDefinition, rollRarity, rollMainStat, rollSubstats,
  rollSubstatValue, calcMainStatValue, substatCount,
  pickEncounterEnemy, scaleEncounterRarity, ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS,
} from "./echoes";
import { echoToBoss, calcPlayerDamage, calcEnemyDamage, COUNTER_ELEMENT, gearAwareScale, baselineAtk } from "./combat";
import { echoEmoji } from "./emojiManager";
import { generateBattleCard, BattleCardState } from "./battleCard";
import {
  resolvePlayerBonuses, applyBonuses, applyAbilityAttack,
  abilityCritRate, abilityVib, applyLifesteal,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit,
  effectiveSkillCooldown,
} from "./setBonus";
import { compositeHasSecondWind } from "./abilityEffects";
import { echoSkillBaseMult, applyEchoSkill } from "./echoSkills";
import { generateEchoCard, echoRowToCard } from "./echoCard";
import {
  SOLACE, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  solaceIntroEffect, solaceOutroEffect, solaceBasicDamageMult, solaceAttunementAtkCritBonus,
  solaceAttunementDefBonus, solaceConvergenceHealPct, solaceConvergenceCleanseCount,
  solaceUltimateDoubleTurns, resolveSolaceStats,
} from "./solace";
import { resolveIntroOutroEffect } from "./introOutro";
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "./attunement";
import {
  getWellspringBaseAtkMult, getWellspringBaseEnergyBonus,
  getWellspringAtkBonus, getWellspringCritRateBonus, getWellspringDefBonus,
} from "./wellspring";
import { ForteState, addForteCharge, isForteMaxed, resetForte } from "./forte";
import { AllyActionTarget } from "./allyActions";
import { addConcertoEnergy } from "./concertoEnergy";
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult, cleanseDebuffs } from "./debuffs";
import { CHARACTER_KITS, PlayableCharacterKit } from "./characterKit";
import {
  resolveRoster, nextAliveFallback, isTeamWiped, swappableTargets, positionLabel,
  ResolvedRoster, PositionIndex,
} from "./teamPositions";
import {
  kaelithStackCap, kaelithBasicStackGain, kaelithUltimateBaseMult, KAELITH_PER_STACK_ULT_BONUS,
  KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC, KaelithMechanicState,
} from "./kits/kaelithKit";
import {
  VesperMechanicState, VesperSkillResult, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC, vesperUltimateBaseMult,
} from "./kits/vesperKit";
import {
  RiloMechanicState, RiloSkillResult, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC,
  RILO_SHIELD_GAIN_PER_BASIC, RILO_C2_DEF_SHRED_PCT, riloMaxShield, riloUltimateBaseMult, riloUltimateShieldFromDamage, riloOnHitTaken,
} from "./kits/riloKit";
import "./kits";

// ── In-memory guild settings cache ───────────────────────────────────────────

const exploreChannels    = new Map<string, Set<string>>();
const encounterChannels  = new Map<string, Set<string>>();   // empty = everywhere
const encounterBlacklist = new Map<string, Set<string>>();   // always blocked
const encountersEnabled  = new Map<string, boolean>();
const levelUpChannelIds  = new Map<string, string | null>();
const notifChannelIds    = new Map<string, string | null>();
const levelUpEnabledMap  = new Map<string, boolean>();
const expEnabledMap      = new Map<string, boolean>();
const botChannelIdsMap   = new Map<string, Set<string>>();   // empty = all channels

// Getters used by messageCreate.ts / interactionCreate.ts
export function getLevelUpChannelId(guildId: string): string | null {
  return levelUpChannelIds.get(guildId) ?? null;
}
export function getNotifChannelId(guildId: string): string | null {
  return notifChannelIds.get(guildId) ?? null;
}
export function isLevelUpEnabled(guildId: string): boolean {
  return levelUpEnabledMap.get(guildId) ?? true;
}
export function isExpEnabled(guildId: string): boolean {
  return expEnabledMap.get(guildId) ?? true;
}
/** Returns the set of allowed command channels, or empty set (= allow everywhere). */
export function getBotChannelIds(guildId: string): Set<string> {
  return botChannelIdsMap.get(guildId) ?? new Set();
}

function cacheSettings(s: any): void {
  exploreChannels.set(s.guildId,    new Set(s.exploreChannelIds));
  encounterChannels.set(s.guildId,  new Set(s.encounterChannelIds));
  encounterBlacklist.set(s.guildId, new Set(s.encounterBlacklist ?? []));
  encountersEnabled.set(s.guildId,  s.encountersEnabled);
  levelUpChannelIds.set(s.guildId,  s.levelUpChannelId  ?? null);
  notifChannelIds.set(s.guildId,    s.notifChannelId    ?? null);
  levelUpEnabledMap.set(s.guildId,  s.levelUpEnabled    ?? true);
  expEnabledMap.set(s.guildId,      s.expEnabled        ?? true);
  botChannelIdsMap.set(s.guildId,   new Set(s.botChannelIds ?? []));
}

export async function loadExploreChannels(guildId: string): Promise<void> {
  const s = await prisma.guildSettings.findUnique({ where: { guildId } });
  if (s) cacheSettings(s);
}

// Load config for ALL guilds the bot is in (called on ready for multi-server)
export async function loadAllGuildSettings(): Promise<void> {
  const all = await prisma.guildSettings.findMany();
  for (const s of all) cacheSettings(s);
}

// Restore persisted encounters into memory on startup + clear expired ones
export async function restoreEncounters(client: import("discord.js").Client): Promise<void> {
  const now   = new Date();
  const rows  = await prisma.activeEncounter.findMany();
  let restored = 0, expired = 0;

  for (const row of rows) {
    // Delete expired encounters from DB
    if (row.expiresAt <= now) {
      await prisma.activeEncounter.deleteMany({ where: { messageId: row.messageId } }).catch(() => {});
      // Try to disable buttons on the orphaned message
      try {
        const ch  = await client.channels.fetch(row.channelId);
        if (ch && "messages" in ch) {
          const msg = await (ch as TextChannel).messages.fetch(row.messageId);
          await msg.edit({ components: [] }).catch(() => {});
        }
      } catch { /* message may be gone */ }
      expired++;
      continue;
    }

    // Find the matching enemy definition
    const enemy = [...(await import("./echoes")).ECHO_DEFINITIONS,
                   ...(await import("./echoes")).BOSS_ECHO_DEFINITIONS]
      .find(e => e.name === row.enemyName);

    if (!enemy) {
      await prisma.activeEncounter.deleteMany({ where: { messageId: row.messageId } }).catch(() => {});
      continue;
    }

    // Restore into memory
    activeEncounters.set(row.messageId, {
      enemy,
      channelId:  row.channelId,
      guildId:    row.guildId,
      fighterId:  row.fighterId,
      expiresAt:  row.expiresAt.getTime(),
    });

    // Set remaining expire timer
    const remaining = row.expiresAt.getTime() - now.getTime();
    setTimeout(async () => {
      if (!activeEncounters.has(row.messageId)) return;
      activeEncounters.delete(row.messageId);
      await prisma.activeEncounter.deleteMany({ where: { messageId: row.messageId } }).catch(() => {});
      try {
        const ch = await client.channels.fetch(row.channelId);
        if (ch && "messages" in ch) {
          const msg = await (ch as TextChannel).messages.fetch(row.messageId);
          await msg.edit({ components: [] }).catch(() => {});
        }
      } catch { /* message may be gone */ }
    }, remaining);

    restored++;
  }

  if (restored > 0 || expired > 0) {
    console.log(`[Encounters] Restored ${restored} active, cleaned ${expired} expired.`);
  }
}

export function isExploreChannel(guildId: string, channelId: string, parentId?: string | null): boolean {
  const set = exploreChannels.get(guildId);
  if (!set) return false;
  return set.has(channelId) || (!!parentId && set.has(parentId));
}

// channelId → timestamp of last encounter spawn
const channelCooldowns = new Map<string, number>();

// messageId → active encounter data
interface ActiveEncounter {
  enemy:      EchoDefinition;
  channelId:  string;
  guildId:    string;
  fighterId:  string | null;  // userId who clicked Fight (null = open)
  expiresAt:  number;
}
const activeEncounters = new Map<string, ActiveEncounter>();

function removeEncounter(messageId: string): void {
  activeEncounters.delete(messageId);
  // deleteMany never throws if the record is already gone (unlike delete)
  prisma.activeEncounter.deleteMany({ where: { messageId } }).catch(() => {});
}

const COOLDOWN_NORMAL_MS  = 2 * 60 * 1000;   // 2 min — regular channels
const COOLDOWN_EXPLORE_MS = 30 * 1000;       // 30 sec — explore channels
const CHANCE_NORMAL       = 0.13;            // 13% per message
const CHANCE_EXPLORE      = 0.38;            // 38% per message
const ENCOUNTER_TTL_MS    = 3 * 60 * 1000;   // encounter expires after 3 min

// ── Spawn check ──────────────────────────────────────────────────────────────

// Where a triggered encounter actually posts: the configured encounter channel,
// falling back to the configured bot-command channel, falling back to wherever
// the triggering message was sent (servers with no restrictions keep spawning
// in-place). This lets chat ANYWHERE on the server count toward a spawn roll
// while keeping the actual encounter confined to one channel.
export function resolveEncounterTargetChannel(guildId: string, fallbackChannelId: string): string {
  // Bug (reported 2026-07-04): this always returned the FIRST channel ever added
  // to the allowlist, regardless of which allowlisted channel the chat actually
  // happened in — so with multiple encounter channels configured, only the
  // first one ever got spawns; the rest counted toward the roll but never
  // produced anything, which felt broken to players chatting there.
  // Fix: if the triggering channel is itself one of the allowed channels, spawn
  // there directly. Only fall back to the first allowed channel if the trigger
  // channel isn't an allowed one at all (e.g. chat-anywhere-counts channels
  // outside the allowlist funneling into a dedicated spawn channel).
  const encounterAllow = encounterChannels.get(guildId);
  if (encounterAllow && encounterAllow.size > 0) {
    if (encounterAllow.has(fallbackChannelId)) return fallbackChannelId;
    return [...encounterAllow][0];
  }
  const botAllow = botChannelIdsMap.get(guildId);
  if (botAllow && botAllow.size > 0) {
    if (botAllow.has(fallbackChannelId)) return fallbackChannelId;
    return [...botAllow][0];
  }
  return fallbackChannelId;
}

export function shouldSpawnEncounter(guildId: string, channelId: string, parentId?: string | null): boolean {
  // Master toggle — admins can disable chat encounters entirely
  if (encountersEnabled.get(guildId) === false) return false;

  // Blacklist overrides everything — channel or its category is always silent
  const blacklist = encounterBlacklist.get(guildId);
  if (blacklist?.has(channelId) || (parentId && blacklist?.has(parentId))) return false;

  // Chat anywhere (not blacklisted) counts toward the roll — the encounter
  // itself always lands in resolveEncounterTargetChannel(), not necessarily here.
  const explore  = isExploreChannel(guildId, channelId, parentId);
  const cooldown = explore ? COOLDOWN_EXPLORE_MS : COOLDOWN_NORMAL_MS;
  const chance   = explore ? CHANCE_EXPLORE      : CHANCE_NORMAL;

  const targetId = resolveEncounterTargetChannel(guildId, channelId);
  const last     = channelCooldowns.get(targetId) ?? 0;
  if (Date.now() - last < cooldown) return false;
  return Math.random() < chance;
}

export async function spawnEncounter(
  channel: TextChannel,
  worldLevel: number,
): Promise<void> {
  channelCooldowns.set(channel.id, Date.now());

  const enemy = pickEncounterEnemy(worldLevel);

  // Resolve PNG asset — cost subfolders first, then Bosses/ for 4-cost, then root
  const BOSS_FILENAMES: Record<string, string> = {
    "Resonant Wraith":     "The Resonant Wraith.png",
    "Tidecaller Sovereign": "Tidecaller Sovereign.png",
    "Fractured Arbiter":   "The Fractured Arbiter.png",
  };
  const subfolderPath = path.join(process.cwd(), "assets", "echoes", `${enemy.cost}-cost`, `${enemy.name}.png`);
  const bossPath      = path.join(process.cwd(), "Bosses", BOSS_FILENAMES[enemy.name] ?? `${enemy.name}.png`);
  const snakePath     = path.join(process.cwd(), "assets", "echoes", enemy.assetFile.replace(".svg", ".png"));
  const assetPath     = fs.existsSync(subfolderPath)                ? subfolderPath
                      : (enemy.cost === 4 && fs.existsSync(bossPath)) ? bossPath
                      : fs.existsSync(snakePath)                    ? snakePath
                      : null;

  const color = ELEMENT_COLORS[enemy.element];
  const emoji = ELEMENT_EMOJI[enemy.element];

  const echoEmojiStr = echoEmoji(enemy.name, emoji);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${echoEmojiStr}  ${enemy.name}  ◈  ${enemy.cost}-Cost Echo`)
    .setDescription(
      `*A resonance signature has manifested in the area.*\n\n` +
      `**HP** ◇ ${enemy.hp}   **ATK** ◇ ${enemy.atk}   **DEF** ◇ ${enemy.def}\n\n` +
      `› Defeat it to claim its echo.`
    )
    .setFooter({ text: `CARTETHYIA  ·  Encounter  ·  Expires in 3 min` });

  const files: AttachmentBuilder[] = [];
  if (assetPath) {
    const file = new AttachmentBuilder(assetPath, { name: `echo.png` });
    embed.setThumbnail(`attachment://echo.png`);
    files.push(file);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("encounter_fight")
      .setLabel("⚔  Fight")
      .setStyle(ButtonStyle.Danger),
  );

  const msg = await channel.send({
    embeds: [embed],
    components: [row],
    files,
  }).catch(() => null);

  if (!msg) return;

  const expiresAt = new Date(Date.now() + ENCOUNTER_TTL_MS);

  activeEncounters.set(msg.id, {
    enemy,
    channelId: channel.id,
    guildId:   channel.guildId,
    fighterId: null,
    expiresAt: expiresAt.getTime(),
  });

  // Persist to DB so the encounter survives bot restarts
  await prisma.activeEncounter.create({
    data: {
      messageId:    msg.id,
      channelId:    channel.id,
      guildId:      channel.guildId,
      enemyName:    enemy.name,
      enemyElement: enemy.element,
      enemyCost:    enemy.cost,
      enemyHp:      enemy.hp,
      enemyAtk:     enemy.atk,
      enemyDef:     enemy.def,
      fighterId:    null,
      expiresAt,
    },
  }).catch(() => {});

  // Auto-expire
  setTimeout(async () => {
    if (!activeEncounters.has(msg.id)) return;
    removeEncounter(msg.id);
    const disabled = disableButtons(row);
    await msg.edit({ components: [disabled] }).catch(() => {});
  }, ENCOUNTER_TTL_MS);
}

// ── Button handlers ──────────────────────────────────────────────────────────

export async function handleEncounterFight(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  const enc = activeEncounters.get(interaction.message.id);
  if (!enc) {
    await interaction.reply({ content: "This encounter has already ended.", flags: 64 });
    return;
  }
  if (enc.fighterId) {
    await interaction.reply({ content: "Someone already engaged this echo. Be faster next time.", flags: 64 });
    return;
  }
  if (Date.now() > enc.expiresAt) {
    removeEncounter(interaction.message.id);
    await interaction.reply({ content: "The echo dissolved before you could act.", flags: 64 });
    return;
  }

  enc.fighterId = interaction.user.id;
  try {
    await interaction.deferUpdate();
  } catch (err: any) {
    if (err?.code === 10062) { enc.fighterId = null; return; } // interaction expired
    throw err;
  }

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { level: true, baseAtk: true, baseDef: true, baseHp: true,
              worldLevel: true, element: true, critRate: true, critDmg: true,
              isOnboarded: true, teamPosition1: true, teamPosition2: true, teamPosition3: true },
  });

  // A user row can exist without /start (some commands auto-create) — require
  // completed onboarding, not just row existence.
  if (!dbUser?.isOnboarded) {
    enc.fighterId = null; // free the encounter for someone who has started
    await interaction.followUp({ content: "You need to `/start` before you can fight!", flags: 64 });
    return;
  }

  const displayName = (interaction.member as any)?.displayName ?? interaction.user.displayName;

  // Milestone 1: team mechanics (swap, Intro/Outro, Concerto Energy, debuffs)
  // require the player to actually own + have picked Solace via /team.
  // NOTE: `isDevGuild` is a legacy name kept to avoid touching the many
  // downstream usages below — it no longer means "in the dev guild", it
  // means "has an active Solace ally". Was hard-gated to the dev guild only
  // during development; that gate is exactly the bug that blocked Solace
  // everywhere after launch.
  // CRITICAL: real read-only ownership lookup, NOT getOrCreateCharacterProgress
  // — that helper CREATES a row if missing, which would silently re-grant
  // Solace ownership to anyone whose teamAllyCharacterId flag is "solace"
  // but doesn't actually own her, bypassing the gacha entirely.
  // Resolve full combat stats (echoes + weapon + set bonuses + unique ability)
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
  const stats   = applyBonuses(dbUser, bonuses);
  let secondWindUsed = false;

  // ── 3-position roster state ──────────────────────────────────────────────
  interface AllyBundle {
    characterId: string; kit: PlayableCharacterKit;
    hp: number; hpMax: number; mechanicState: unknown;
    basicLevel: number; skillLevel: number; ultimateLevel: number; introLevel: number; forteLevel: number;
    constellation: number; solaceStats: any;
  }
  const roster: ResolvedRoster = resolveRoster(dbUser);
  const allyBundles: Partial<Record<PositionIndex, AllyBundle>> = {};
  for (const pos of [1, 2, 3] as PositionIndex[]) {
    const val = pos === 1 ? roster.position1 : pos === 2 ? roster.position2 : roster.position3;
    if (val === null || val === "self") continue;
    const kit = CHARACTER_KITS[val];
    if (!kit) continue;
    const progress = await prisma.characterProgress.findUnique({ where: { userId_characterId: { userId: interaction.user.id, characterId: val } } });
    if (!progress) continue;
    const solaceStats = await kit.resolveStats(interaction.user.id);
    const hpMax = kit.statsAtLevel(90).hpMax;
    allyBundles[pos] = {
      characterId: val, kit, hp: hpMax, hpMax, mechanicState: kit.createInitialMechanicState(),
      basicLevel: progress.basicLevel, skillLevel: progress.skillLevel, ultimateLevel: progress.ultimateLevel,
      introLevel: progress.introLevel, forteLevel: progress.forteLevel, constellation: progress.constellation,
      solaceStats,
    };
  }
  // Legacy names — now mean "roster has ≥1 non-self filled position".
  const hasSolace = Object.keys(allyBundles).length > 0;
  const isDevGuild = hasSolace;

  let activeUnit: PositionIndex = 1;
  function posValue(pos: PositionIndex): string | null {
    return pos === 1 ? roster.position1 : pos === 2 ? roster.position2 : roster.position3;
  }
  function isPlayerActive(): boolean { return posValue(activeUnit) === "self"; }

  let activeAllyCharacterId: string | null = null;
  let allyKit: PlayableCharacterKit | null = null;
  let allyHp = 0, allyHpMax = 0;
  let allyMechanicState: unknown = null;
  let allyBasicLevel = 1, allySkillLevel = 1, allyUltimateLevel = 1, allyIntroLevel = 1, allyForteLevel = 1, allyConstellation = 0;
  let allySolaceStats: any = null;

  // Resyncs the legacy ally* vars from whichever bundle activeUnit points to,
  // so every existing per-character dispatch branch works unchanged.
  function syncActiveBundle() {
    if (isPlayerActive()) {
      activeAllyCharacterId = null; allyKit = null; allyHp = 0; allyHpMax = 0; allyMechanicState = null;
      allyBasicLevel = 1; allySkillLevel = 1; allyUltimateLevel = 1; allyIntroLevel = 1; allyForteLevel = 1; allyConstellation = 0; allySolaceStats = null;
      return;
    }
    const b = allyBundles[activeUnit];
    activeAllyCharacterId = b?.characterId ?? null;
    allyKit = b?.kit ?? null;
    allyHp = b?.hp ?? 0; allyHpMax = b?.hpMax ?? 0;
    allyMechanicState = b?.mechanicState ?? null;
    allyBasicLevel = b?.basicLevel ?? 1; allySkillLevel = b?.skillLevel ?? 1; allyUltimateLevel = b?.ultimateLevel ?? 1;
    allyIntroLevel = b?.introLevel ?? 1; allyForteLevel = b?.forteLevel ?? 1; allyConstellation = b?.constellation ?? 0;
    allySolaceStats = b?.solaceStats ?? null;
  }
  function commitActiveBundle() {
    const b = allyBundles[activeUnit];
    if (b) { b.hp = allyHp; b.mechanicState = allyMechanicState; }
  }
  function currentPositionHp(pos: PositionIndex): number {
    return posValue(pos) === "self" ? state.playerHp : (allyBundles[pos]?.hp ?? 0);
  }
  syncActiveBundle();

  let concertoEnergy: number = 0;
  let playerDebuffs: DebuffState = [];
  let attunement: AttunementState = { mode: null };
  let attunementDoubleTurnsLeft = 0; // set by a normal (non-Empowered) Convergence
  let solaceForte: ForteState = { phase: 0, charge: 0 };
  let forteEmpoweredTurnsLeft = 0; // set by an Empowered Convergence; mutually exclusive with attunementDoubleTurnsLeft

  // Scale enemy to the fighter's progression + gear (still lighter than dedicated boss
  // fights, but bumped 2026-07-03 — chat encounters were reported as trivially easy)
  const gearRatio = stats.atk / baselineAtk(dbUser.level);
  const gs = gearAwareScale(
    { hp: enc.enemy.hp, atk: enc.enemy.atk, def: enc.enemy.def },
    dbUser.level, dbUser.worldLevel, gearRatio, 0.65, 0.55,
  );
  const scaledEnemy = { ...enc.enemy, hp: gs.hp, atk: gs.atk, def: gs.def };
  const boss    = echoToBoss(scaledEnemy);
  const isWeak  = dbUser.element === boss.weakness;

  // Disable the encounter message buttons while fight runs
  await interaction.message.edit({
    embeds: [new EmbedBuilder()
      .setColor(ELEMENT_COLORS[enc.enemy.element])
      .setDescription(
        `⚔️  **${displayName}** engaged the **${enc.enemy.name}**!\n` +
        `*Strength calibrated to Lv${dbUser.level} · WL${dbUser.worldLevel}*`
      )
      .setFooter({ text: "CARTETHYIA  ·  Encounter Combat" })],
    components: [],
    files: [],
  }).catch(() => {});

  // Build initial battle state using resolved combat stats
  const state: BattleCardState = {
    boss,
    bossHpNow:     scaledEnemy.hp,
    bossHpMax:     scaledEnemy.hp,
    bossVibNow:    boss.vibBar,
    playerHp:      stats.hp,
    playerHpMax:   stats.hp,
    playerEnergy:  0,
    playerName:    displayName,
    playerElement: dbUser.element,
    turn:          1,
    lastMove:      `${enc.enemy.name} materialised. Strike it down.`,
    isShattered:   false,
    skillCooldown: 0,
  };

  const ENERGY_PER_TURN = Math.floor(stats.energyPerTurn);
  const SKILL_COOLDOWN  = 3;
  const ECHO_SKILL_COOLDOWN = 4;
  let shatterTurnsLeft  = 0;
  let firstActionDone   = false;
  let echoSkillCooldown      = 0;
  let enemyDefShredTurnsLeft = 0;
  let enemyDefShredPct       = 0;
  let riloDefBuffTurnsLeft   = 0;
  let riloDefBuffPct         = 0;
  let nextAttackCritArmed    = false;

  function buildEncounterButtons(): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    // Milestone 2a: Solace has a real kit now, so BOTH activeUnit states get a
    // full Basic/Skill/Ultimate/Flee row — the player's row keeps its Echo
    // Skill button (from her own equipped echo), Solace's row never has one
    // (she has no echoes equipped in this test context). Skill/Ultimate labels
    // differ because Solace's Skill is Attunement (no cooldown, always
    // available — it's a mode switch, not a charge-gated move) and her
    // Ultimate spends Concerto Energy rather than personal Energy.
    if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith") {
      const skillReady = state.skillCooldown === 0;
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill")
          .setLabel(skillReady ? "🌑  Umbral Detonation" : `🌑  Detonation (${state.skillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("🌑  Umbral Cataclysm")
          .setStyle(ButtonStyle.Success).setDisabled(concertoEnergy < 100),
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    } else if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper") {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill").setLabel("⚡  Discharge").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("⚡  Overload")
          .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    } else if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo") {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("🛡️  Avalanche Slam")
          .setStyle(ButtonStyle.Success).setDisabled(concertoEnergy < 100),
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    } else if (isDevGuild && !isPlayerActive()) {
      const modeLabel = attunement.mode ? `(${attunement.mode})` : "(inactive)";
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("⚡  Convergence")
          .setStyle(ButtonStyle.Success).setDisabled(concertoEnergy < 100),
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    } else {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("enc_skill")
          .setLabel(state.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(state.skillCooldown > 0),
        new ButtonBuilder().setCustomId("enc_ultimate").setLabel("⚡  Ultimate")
          .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
      );
      if (bonuses.echoSkill) {
        const echoReady = echoSkillCooldown === 0;
        row.addComponents(
          new ButtonBuilder().setCustomId("enc_echoskill")
            .setLabel(echoReady ? `🌀  ${bonuses.echoSkill.name}` : `🌀  ${bonuses.echoSkill.name} (${echoSkillCooldown}🔄)`)
            .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
        );
      }
      row.addComponents(
        new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
      );
      rows.push(row);
    }

    if (hasSolace) {
      const targets = swappableTargets(roster, activeUnit).map(pos => ({
        pos, label: positionLabel(roster, pos, displayName, (id) => CHARACTER_KITS[id]?.label ?? null),
      }));
      if (targets.length === 1) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId("enc_swap")
            .setLabel(`🔄  Swap to ${targets[0].label}`)
            .setStyle(ButtonStyle.Secondary),
        ));
      } else if (targets.length > 1) {
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("enc_swap_select")
            .setPlaceholder("🔄  Swap to…")
            .addOptions(targets.map(t => ({ label: t.label, value: String(t.pos) }))),
        ) as unknown as ActionRowBuilder<ButtonBuilder>);
      }
    }

    return rows;
  }

  function teamStatusLine(): string {
    if (!hasSolace) return "";
    const benchedLines = ([1, 2, 3] as PositionIndex[])
      .filter(p => p !== activeUnit && posValue(p) !== null)
      .map(p => {
        if (posValue(p) === "self") return `${displayName} — ${state.playerHp}/${state.playerHpMax} HP`;
        const b = allyBundles[p];
        return b ? `${b.kit.label} — ${b.hp}/${b.hpMax} HP  ·  ${b.kit.statusLineText(b.mechanicState)}` : null;
      })
      .filter((x): x is string => x !== null);
    if (benchedLines.length === 0) return "";
    const debuffLine = playerDebuffs.length > 0
      ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
      : "";
    return `\n\n🔄 Benched: ${benchedLines.join("  |  ")}\n` +
           `Concerto Energy: **${concertoEnergy}/100**${debuffLine}`;
  }

  // Send the battle card as a new message
  let battleMsg = await (async () => {
    const buf    = await generateBattleCard(state);
    const attach = new AttachmentBuilder(buf, { name: "encounter.webp" });
    const embed  = new EmbedBuilder()
      .setColor(ELEMENT_COLORS[enc.enemy.element])
      .setImage("attachment://encounter.webp")
      .setDescription(teamStatusLine() || null);
    return (interaction.channel as TextChannel).send({ embeds: [embed], files: [attach], components: buildEncounterButtons() });
  })();

  if (!battleMsg) { removeEncounter(interaction.message.id); return; }

  const runTurn = async () => {
    const collector = battleMsg!.createMessageComponentCollector({
      filter: (b: any) => b.user.id === interaction.user.id,
      time:   5 * 60 * 1000,
      max:    1,
    });

    collector.on("collect", async (btn: ButtonInteraction | StringSelectMenuInteraction) => {
      await btn.deferUpdate();
      syncActiveBundle();
      const swapSelectTarget = btn.customId === "enc_swap_select" && btn.isStringSelectMenu()
        ? (Number(btn.values[0]) as PositionIndex) : null;

      let moveName = "";
      let playerDmg = 0;
      state.hitBadge = undefined;
      let forcedCritActive = false; // set inside the damage-dealing branch below; a swap never arms/consumes it

      // Milestone 3.5b: whichever unit is currently acting/defending uses ITS
      // OWN resolved stats — declared here (not inside the swap if/else) since
      // both the damage-dealing branches AND the shared enemy-turn retaliation
      // tail below need to read it.
      const isAllyActingOrDefending = !isPlayerActive() && allySolaceStats !== null;
      const activeAtk     = isAllyActingOrDefending ? allySolaceStats!.atk     : stats.atk;
      const activeDef     = isAllyActingOrDefending ? allySolaceStats!.def     : stats.def;
      const activeCritDmg = isAllyActingOrDefending ? allySolaceStats!.critDmg : stats.critDmg;

      if (btn.customId === "enc_flee") {
        removeEncounter(interaction.message.id);
        const fleeEmbed = new EmbedBuilder()
          .setColor(0x4A4A5A)
          .setDescription(`*${displayName} retreated. The echo dissipates into the ether.*`)
          .setFooter({ text: "CARTETHYIA  ·  Encounter" });
        await battleMsg!.edit({ embeds: [fleeEmbed], components: [], files: [] }).catch(() => {});
        return;
      }

      // ── Milestone 1: swap — always consumes the turn, but the Outro (outgoing)
      // + Intro (incoming) combo only fires if Concerto Energy is full at the
      // moment of swap (built from combat actions, not from swapping itself —
      // see design spec §4.1/§4.2, corrected 2026-07-11 after playtesting
      // showed the original "fires on every swap" version made the energy bar
      // meaningless). If not full, this is just a plain reposition: activeUnit
      // flips, nothing else happens. Falls through to the shared enemy-turn
      // block below either way (skipping the damage-dealing section, since a
      // swap never deals damage) since swapping still costs the turn. ────────
      const swapTargetsNow = hasSolace ? swappableTargets(roster, activeUnit) : [];
      const swapTargetPos: PositionIndex | null = swapSelectTarget
        ?? ((btn.customId === "enc_swap" && swapTargetsNow.length === 1) ? swapTargetsNow[0] : null);
      const isSwapAction = (btn.customId === "enc_swap" || btn.customId === "enc_swap_select")
        && hasSolace && swapTargetPos !== null
        && (posValue(swapTargetPos) === "self" ? state.playerHp : (allyBundles[swapTargetPos]?.hp ?? 0)) > 0;

      if (isSwapAction) {
        const outgoingPos = activeUnit;
        const incomingPos = swapTargetPos!;
        const outgoingIsPlayer = posValue(outgoingPos) === "self";
        const incomingIsPlayer = posValue(incomingPos) === "self";
        const outgoingBundle = outgoingIsPlayer ? null : (allyBundles[outgoingPos] ?? null);
        const incomingBundle = incomingIsPlayer ? null : (allyBundles[incomingPos] ?? null);
        const outgoingCharacterId = outgoingBundle?.characterId ?? null;
        const incomingCharacterId = incomingBundle?.characterId ?? null;
        const incomingHpBefore = incomingIsPlayer ? state.playerHp : (incomingBundle?.hp ?? 0);
        const incomingHpMax = incomingIsPlayer ? state.playerHpMax : (incomingBundle?.hpMax ?? 0);
        const incomingLabel = incomingIsPlayer ? displayName : (incomingBundle?.kit.label ?? "Ally");
        const comboReady = concertoEnergy >= 100;

        if (comboReady) {
          const incomingTarget: AllyActionTarget = { hp: incomingHpBefore, hpMax: incomingHpMax };
          const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : outgoingBundle!.kit.outroEffect(outgoingBundle!.constellation);
          const introEffect = incomingIsPlayer ? PLAYER_SELF_INTRO : incomingBundle!.kit.introEffect(incomingBundle!.introLevel, incomingBundle!.constellation);
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
          if (incomingIsPlayer && introEffect.newMechanicState && outgoingCharacterId === "vesper") {
            const energyGrant = (introEffect.newMechanicState as any).grantEnergyOnIntro as number | undefined;
            if (energyGrant) state.playerEnergy = Math.min(100, state.playerEnergy + energyGrant);
          }
          let riloShieldTransferBonus = 0;
          if (!outgoingIsPlayer && outroEffect.newMechanicState && outgoingCharacterId === "rilo") {
            const rOutgoing = outgoingBundle!.mechanicState as RiloMechanicState;
            const transferFrac = (outroEffect.newMechanicState as any).grantShieldTransferOnOutro as number;
            riloShieldTransferBonus = Math.floor(rOutgoing.shield * transferFrac);
            if ((outroEffect.newMechanicState as any).grantDefBuffOnOutro) {
              riloDefBuffTurnsLeft = ((outroEffect.newMechanicState as any).defBuffTurns as number) + 1;
              riloDefBuffPct = 0.15;
            }
          }
          if (!incomingIsPlayer && introEffect.newMechanicState && incomingCharacterId === "rilo") {
            const grant = (introEffect.newMechanicState as any).grantShieldOnIntro as number | undefined;
            if (grant) {
              const rIncoming = incomingBundle!.mechanicState as RiloMechanicState;
              incomingBundle!.mechanicState = { ...rIncoming, shield: Math.min(riloMaxShield(incomingBundle!.constellation), rIncoming.shield + grant) };
            }
          }

          if (!outgoingIsPlayer) nextAttackCritArmed = true;

          const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta + riloShieldTransferBonus;
          const after = Math.min(incomingHpMax, incomingHpBefore + totalBonus);
          const actualGain = after - incomingHpBefore;
          if (incomingIsPlayer) { state.playerHp = after; } else { incomingBundle!.hp = after; }

          const CONCERTO_INTRO_HEADSTART = 20;
          concertoEnergy = addConcertoEnergy(0, CONCERTO_INTRO_HEADSTART);

          activeUnit = incomingPos;
          syncActiveBundle();
          moveName = actualGain > 0
            ? `🔄 **Concerto Combo!** Swapped to **${incomingLabel}** — Outro + Intro triggered, +${actualGain} HP.`
            : `🔄 **Concerto Combo!** Swapped to **${incomingLabel}** — Outro + Intro triggered (already at full HP, no heal needed).`;
        } else {
          activeUnit = incomingPos;
          syncActiveBundle();
          moveName = `🔄 Swapped to **${incomingLabel}** — Concerto Energy not full, no combo triggered.`;
        }

        state.lastMove = moveName;
      } else {

      const defShredActive = enemyDefShredTurnsLeft > 0;
      const defVal     = state.isShattered ? 0 : scaledEnemy.def * (defShredActive ? (1 - enemyDefShredPct) : 1);
      const enemyHpPct = state.bossHpNow / state.bossHpMax;
      const radCrit    = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
      const cRate      = abilityCritRate(bonuses, Math.min(1, (isAllyActingOrDefending ? allySolaceStats!.critRate : stats.critRate) + radCrit), state.playerHp, state.playerHpMax);
      const vibMult    = abilityVib(bonuses);
      forcedCritActive = nextAttackCritArmed && btn.customId !== "enc_flee";
      let   vibFrac    = 0.3;
      let   moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
      let   isCrit = false;

      if (btn.customId === "enc_basic") {
        // Wellspring: base ATK boost only while Solace is actually attacking
        // (it's hardcoded onto her, not the player's own weapon); the mode
        // amplifier applies regardless of who's attacking, same scope as
        // Attunement's own bonus.
        const isSolaceAlly = isDevGuild && activeAllyCharacterId === "solace";
        const wellspringAtkMult   = isSolaceAlly && !isPlayerActive() && allySolaceStats?.hasWellspring ? getWellspringBaseAtkMult(allySolaceStats.wellspringRefinement!) : 1;
        const wellspringAtkBonus  = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
        const wellspringCritBonus = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
        const forteAtkBonus  = isSolaceAlly ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const forteCritBonus = isSolaceAlly ? getSolaceForteCritRateBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const attunementAtkBonus  = solaceAttunementAtkCritBonus(allySkillLevel);
        const attunementCritBonus = solaceAttunementAtkCritBonus(allySkillLevel);
        // Milestone 2e: this move's OWN base multiplier (separate from the
        // Attunement/Wellspring/Forte bonuses above) is the active ally's
        // Basic-track level scaling — only applies while they're actually
        // attacking, since this handler is shared with the player's own Basic
        // Attack and the ally's level shouldn't affect the player's damage.
        const basicMoveMult = isDevGuild && !isPlayerActive() && allyKit ? allyKit.basicDamageMult(allyBasicLevel) : 1.0;
        const atkMult = getWeakenedMult(playerDebuffs) * (isSolaceAlly ? getAttunementAtkMult(attunement, attunementAtkBonus, attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1) * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r  = calcPlayerDamage(activeAtk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isSolaceAlly ? getAttunementCritRateBonus(attunement, attunementCritBonus, attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0) + wellspringCritBonus + forteCritBonus), activeCritDmg, basicMoveMult, isWeak, state.isShattered);
        let base = Math.floor(r.damage * (1 + stats.elemDmgBonus));
        base     = Math.floor(base * elemWindstrideMult(bonuses.elementPassive, state.turn, "BASIC"));
        // Ignite is a separate proc effect, not part of the base attack roll —
        // intentionally NOT scoped by WEAKENED, unlike the calcPlayerDamage call above.
        const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "BASIC"; vibFrac = 0.3;
        moveName  = r.isCrit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));

        if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith") {
          const kState = allyMechanicState as KaelithMechanicState;
          const gain = kaelithBasicStackGain(allyConstellation);
          const cap = kaelithStackCap(allyConstellation);
          allyMechanicState = { ...kState, stacks: Math.min(cap, kState.stacks + gain) };
          moveName += `\n🌑 +${gain} stack${gain === 1 ? "" : "s"} (${(allyMechanicState as KaelithMechanicState).stacks}/${cap})`;
        }
        if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper") {
          const vState = allyMechanicState as VesperMechanicState;
          allyMechanicState = { ...vState, markPresent: true };
          moveName += `\n⚡ Static Mark applied!`;
        }
        if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo") {
          const rState = allyMechanicState as RiloMechanicState;
          const maxShield = riloMaxShield(allyConstellation);
          const critBonus = r.isCrit ? Math.floor(RILO_SHIELD_GAIN_PER_BASIC * (allyConstellation >= 1 ? 0.5 : 0)) : 0;
          allyMechanicState = { ...rState, shield: Math.min(maxShield, rState.shield + RILO_SHIELD_GAIN_PER_BASIC + critBonus) };
          moveName += `\n🛡️ +${RILO_SHIELD_GAIN_PER_BASIC + critBonus} Shield (${(allyMechanicState as RiloMechanicState).shield}/${maxShield})`;
        }

        // Forte fills only from the active ally's own Basic Attack — announce
        // only on the turn a threshold is actually crossed, not every hit (no
        // permanent visible bar, per design spec §3).
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
        } else if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith") {
          const forteBefore = solaceForte;
          solaceForte = addForteCharge(solaceForte, KAELITH_FORTE_CONFIG, KAELITH_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(solaceForte, KAELITH_FORTE_CONFIG) && !isForteMaxed(forteBefore, KAELITH_FORTE_CONFIG)) {
            moveName += `\n✨ Forte is **FULLY CHARGED** — next Umbral Cataclysm will keep your stacks!`;
          }
        } else if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper") {
          const forteBefore = solaceForte;
          solaceForte = addForteCharge(solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
            moveName += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
          }
        } else if (isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo") {
          const forteBefore = solaceForte;
          solaceForte = addForteCharge(solaceForte, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(solaceForte, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
            moveName += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
          }
        }
      }

      if (btn.customId === "enc_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith" && allyKit) {
        const kState = allyMechanicState as KaelithMechanicState;
        if (kState.stacks <= 0) {
          moveName = `🌑 Umbral Detonation — no stacks to consume! (0 DMG bonus)`;
          playerDmg = 0;
        } else {
          const result = allyKit.onSkill(
            { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: kState },
            { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
            allyConstellation,
          );
          allyMechanicState = result.newMechanicState;
          const r = calcPlayerDamage(activeAtk, defVal, forcedCritActive ? 1 : cRate, activeCritDmg, result.damageMult, isWeak, state.isShattered);
          playerDmg = r.damage; isCrit = r.isCrit;
          moveType = "SKILL"; vibFrac = result.vibFrac;
          moveName = `🌑 ${result.moveLabel} — ${playerDmg} DMG${r.isCrit ? " **(CRIT)**" : ""}`;
        }
        state.skillCooldown = allyKit.skillCooldownTurns;
      }

      if (btn.customId === "enc_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper" && allyKit) {
        const vState = allyMechanicState as VesperMechanicState;
        const crit = forcedCritActive || Math.random() < cRate;
        const forteEmpowered = isForteMaxed(solaceForte, VESPER_FORTE_CONFIG);
        const result = allyKit.onSkill(
          { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: vState, forteEmpowered } as any,
          { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
          allyConstellation,
        ) as VesperSkillResult;
        allyMechanicState = result.newMechanicState;
        if (forteEmpowered) solaceForte = resetForte();

        const effectiveDefVal = defVal * (1 - result.defIgnorePct);
        const perHit = calcPlayerDamage(activeAtk, effectiveDefVal, crit ? 1 : 0, activeCritDmg, result.damageMult / result.hits, isWeak, state.isShattered);
        const perHitDmg = perHit.damage;

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
        isCrit = crit; moveType = "SKILL"; vibFrac = result.vibFrac;

        if (!forteEmpowered) {
          const forteBefore = solaceForte;
          solaceForte = addForteCharge(solaceForte, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(solaceForte, VESPER_FORTE_CONFIG) && !isForteMaxed(forteBefore, VESPER_FORTE_CONFIG)) {
            moveName += `\n✨ Forte is **FULLY CHARGED** — next Discharge will be an Arc Discharge!`;
          }
        }
      }

      if (btn.customId === "enc_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo" && allyKit) {
        const rState = allyMechanicState as RiloMechanicState;
        const crit = true;
        const forteEmpowered = isForteMaxed(solaceForte, RILO_FORTE_CONFIG);
        const result = allyKit.onSkill(
          { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: rState, forteEmpowered } as any,
          { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
          allyConstellation,
        ) as RiloSkillResult;
        allyMechanicState = result.newMechanicState;
        if (forteEmpowered) solaceForte = resetForte();

        const r = calcPlayerDamage(activeAtk, defVal, 1.0, activeCritDmg, result.damageMult, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus));
        moveName  = `🛡️ ${result.moveLabel} — ${playerDmg} DMG **(CRIT)** (consumed ${result.shieldConsumed} Shield)`;
        if (result.defShredApplied) {
          enemyDefShredTurnsLeft = 2 + 1;
          enemyDefShredPct = RILO_C2_DEF_SHRED_PCT;
          moveName += `\n❄️ Enemy DEF shredded 10% for 2 turns!`;
        }
        isCrit = crit; moveType = "SKILL"; vibFrac = result.vibFrac;

        if (!forteEmpowered) {
          const forteBefore = solaceForte;
          solaceForte = addForteCharge(solaceForte, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC);
          if (isForteMaxed(solaceForte, RILO_FORTE_CONFIG) && !isForteMaxed(forteBefore, RILO_FORTE_CONFIG)) {
            moveName += `\n✨ Forte is **FULLY CHARGED** — next Guard Break will be Braced!`;
          }
        }
      }

      if (btn.customId === "enc_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace") {
        // Solace's Skill is Attunement — a mode cycle, not a damage move. No
        // cooldown (always available), no personal Energy interaction. Deals a
        // small hit so it's not purely administrative, using HER OWN resolved
        // stats (Milestone 3.5b) — activeAtk/activeCritDmg already resolve to
        // allySolaceStats here since this branch only runs while she's active.
        attunement.mode = cycleAttunementMode(attunement.mode);
        if (allyConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
        const r  = calcPlayerDamage(activeAtk, defVal, cRate, activeCritDmg, 0.6, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus)); isCrit = r.isCrit;
        moveType = "SKILL"; vibFrac = 0.3;
        moveName = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${r.isCrit ? " **(CRIT)**" : ""}`;
      } else if (btn.customId === "enc_skill") {
        const r  = calcPlayerDamage(stats.atk * getWeakenedMult(playerDebuffs), defVal, forcedCritActive ? 1 : Math.min(1, cRate + 0.1), stats.critDmg, 1.8, isWeak, state.isShattered);
        let base = Math.floor(r.damage * (1 + stats.elemDmgBonus));
        base     = Math.floor(base * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
        // Ignite is a separate proc effect, not part of the base attack roll —
        // intentionally NOT scoped by WEAKENED, unlike the calcPlayerDamage call above.
        const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "SKILL"; vibFrac = 0.6;
        moveName  = `Resonance Skill — ${playerDmg} DMG${r.isCrit ? " **(CRIT)**" : ""}`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.skillCooldown = effectiveSkillCooldown(bonuses, SKILL_COOLDOWN);
        state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));
      }

      // Set inside Solace's Convergence branch below — Convergence resets
      // concertoEnergy to 0, so the generic per-move gain further down must
      // skip granting anything back on the same turn, or Convergence would
      // silently refund ~35-47% of the bar it just spent.
      let convergenceUsedThisTurn = false;

      if (btn.customId === "enc_ultimate" && !(isDevGuild && !isPlayerActive())) {
        // No base ATK boost here — this branch only ever runs for the
        // player's own Ultimate (Solace's Ultimate is the else-if branch
        // below, which deals no damage), and the base boost is Solace-only.
        const wellspringAtkBonus = isDevGuild && activeAllyCharacterId === "solace" && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
        const forteAtkBonus = isDevGuild && activeAllyCharacterId === "solace" ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const attunementAtkBonus = solaceAttunementAtkCritBonus(allySkillLevel);
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild && activeAllyCharacterId === "solace" ? getAttunementAtkMult(attunement, attunementAtkBonus, attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1) * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus)); isCrit = true;
        moveType = "ULT"; vibFrac = 0.8;
        moveName  = `⚡ ULTIMATE — ${playerDmg} DMG`;
        state.playerEnergy = 0;
      } else if (btn.customId === "enc_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace") {
        // Solace's Ultimate spends Concerto Energy, not personal Energy — team
        // heal (BOTH units — Milestone 2e fix; previously this only ever
        // healed state.playerHp regardless of who was active, contradicting
        // its own "Team healed" message) + cleanse + doubles the current
        // Attunement mode's effect for 3 turns (base version). Heal % scales
        // with Ultimate level. If Forte is maxed, this instead becomes an
        // Empowered Convergence — all 3 modes empowered at once — see below.
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
        playerDmg = 0; isCrit = false; moveType = "ULT"; vibFrac = 0;

        const healSummary = `${displayName} +${actualHealPlayer} HP, ${allyKit?.label ?? "Solace"} +${actualHealAlly} HP`;

        if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
          // Empowered Convergence — instead of doubling only the active mode,
          // a smaller version of all 3 applies at once (design spec §3).
          // Mutually exclusive with the normal doubling path below — both
          // counters are explicitly set here so tuning either duration
          // constant can't accidentally leave both nonzero at once.
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
      } else if (btn.customId === "enc_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith" && allyKit) {
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

        const r = calcPlayerDamage(activeAtk, defVal, 1.0, activeCritDmg, ultDamageMult, isWeak, state.isShattered);
        playerDmg = r.damage; isCrit = true;
        moveType = "ULT"; vibFrac = 0.8;
        moveName = `🌑 ${result.moveLabel} — ${playerDmg} DMG`;

        if (result.healResult.actions.length > 0) {
          const healResult = resolveIntroOutroEffect(result.healResult, { hp: allyHp, hpMax: allyHpMax });
          allyHp = Math.min(allyHpMax, allyHp + healResult.hpDelta);
        }
        if (result.resetsConcertoEnergy) { concertoEnergy = 0; convergenceUsedThisTurn = true; }
      } else if (btn.customId === "enc_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper" && allyKit) {
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

        const r = calcPlayerDamage(activeAtk, defVal, 1.0, activeCritDmg, ultDamageMult, isWeak, state.isShattered);
        playerDmg = r.damage; isCrit = true;
        moveType = "ULT"; vibFrac = 0.8;
        moveName = `⚡ ${result.moveLabel} — ${playerDmg} DMG`;
      } else if (btn.customId === "enc_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo" && allyKit) {
        const rState = allyMechanicState as RiloMechanicState;
        const result = allyKit.onUltimate(
          { playerHp: state.playerHp, playerHpMax: state.playerHpMax, allyHp, allyHpMax, turn: state.turn, isShattered: state.isShattered, mechanicState: rState },
          { basicLevel: allyBasicLevel, skillLevel: allySkillLevel, ultimateLevel: allyUltimateLevel, introLevel: allyIntroLevel, forteLevel: allyForteLevel },
          allyConstellation,
        );
        const maxShield = riloMaxShield(allyConstellation);
        const c6DoubleHit = allyConstellation >= 6 && rState.shield >= maxShield;
        const hits = c6DoubleHit ? 2 : 1;

        const perHit = calcPlayerDamage(activeAtk, defVal, 1.0, activeCritDmg, riloUltimateBaseMult(allyUltimateLevel) / hits, isWeak, state.isShattered);
        const perHitDmg = perHit.damage;
        const totalDmg = perHitDmg * hits;

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
        isCrit = true; moveType = "ULT"; vibFrac = 0.8;

        if (result.healResult.actions.length > 0) {
          playerDebuffs = cleanseDebuffs(playerDebuffs, 1);
        }
      }

      let echoLifestealPct = 0;
      if (btn.customId === "enc_echoskill" && bonuses.echoSkill) {
        const def = bonuses.echoSkill;
        const echoCrit = forcedCritActive || def.kind === "GUARANTEED_CRIT" || Math.random() < cRate;
        isCrit = echoCrit; moveType = "SKILL"; vibFrac = 0.5;
        const r = calcPlayerDamage(stats.atk, defVal, echoCrit ? 1 : 0, stats.critDmg, echoSkillBaseMult(), isWeak, state.isShattered);
        let base = Math.floor(r.damage * (1 + stats.elemDmgBonus));

        const result = applyEchoSkill(def, {
          atk: stats.atk, enemyHp: state.bossHpNow, enemyHpMax: state.bossHpMax,
          playerHp: state.playerHp, playerHpMax: state.playerHpMax,
          playerEnergy: state.playerEnergy, turn: state.turn, bossVibMax: boss.vibBar, crit: echoCrit,
        });
        base = Math.floor(base * result.dmgMult);
        if (result.doubleHit) base *= 2;
        if (result.noDamage) base = 0;
        // NAMED_SET_TRIGGER has no named-set state in casual encounters — falls back to a plain hit.

        const ignite = result.noDamage ? { dmg: 0, tag: "" } : elemIgniteProc(bonuses.elementPassive, stats.atk);
        playerDmg = base + ignite.dmg;
        moveName  = result.noDamage ? `🌀 ${def.name}` : `🌀 ${def.name}${echoCrit ? " **(CRIT)**" : ""} — ${playerDmg} DMG`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;

        echoSkillCooldown = (result.resetCdOnCrit && echoCrit) ? 0 : ECHO_SKILL_COOLDOWN;
        state.playerEnergy = result.setEnergyFull ? 100 : Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, echoCrit) + result.bonusEnergy);
        if (result.healHp > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + result.healHp);
        if (result.armsNextCrit) nextAttackCritArmed = true;
        if (result.defShredTurns > 0) {
          enemyDefShredTurnsLeft = result.defShredTurns + 1;
          enemyDefShredPct = result.defShredPct;
        }
        if (def.kind === "FLAT_LIFESTEAL") echoLifestealPct = def.pct;
        if (!result.noDamage) state.bossVibNow = Math.max(0, state.bossVibNow - result.extraVibDrain);
      }

      // Concerto Energy builds from combat actions (any of the 4 branches
      // above), never from swapping — see the swap branch's header comment.
      // Scaled by move weight (roughly matching each move's damage multiplier:
      // Basic 1.0x / Skill 1.8x / Echo Skill 2.2x / Ultimate 3.5x) so a flurry
      // of Basics doesn't fill the bar just as fast as committing to bigger
      // moves — a flat rate made every fight feel slow regardless of playstyle.
      // moveType alone can't distinguish Skill from Echo Skill (both set
      // moveType = "SKILL"), so this keys off the button id directly instead.
      const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
        enc_basic:    10,
        enc_skill:    20,
        enc_echoskill: 20,
        enc_ultimate: 35,
      };
      if (isDevGuild && !convergenceUsedThisTurn) {
        let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
        // Wellspring's Energy Regen passive — only while Solace is the one
        // acting (it's hardcoded onto her, not a shared account-level weapon,
        // so it shouldn't boost the player's own turns).
        if (concertoGain > 0 && !isPlayerActive() && allySolaceStats?.hasWellspring) concertoGain += getWellspringBaseEnergyBonus(allySolaceStats.wellspringRefinement);
        if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
      }

      // Apply unique ability effects to this attack
      const ar = applyAbilityAttack(bonuses, playerDmg, isCrit, {
        moveType, currentHp: state.playerHp, maxHp: state.playerHpMax,
        enemyHpPct, turn: state.turn, isFirstAction: !firstActionDone,
      });
      playerDmg = ar.dmg;
      if (ar.tag) moveName += `  ✦${ar.tag}`;
      if (ar.healHp > 0)      state.playerHp     = Math.min(state.playerHpMax, state.playerHp + ar.healHp);
      if (ar.bonusEnergy > 0) state.playerEnergy = Math.min(100, state.playerEnergy + ar.bonusEnergy);
      // Lifesteal from echoes/abilities
      state.playerHp = applyLifesteal(stats.lifesteal + echoLifestealPct, playerDmg, state.playerHp, state.playerHpMax);
      firstActionDone = true;

      state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * vibFrac * vibMult));
      state.bossHpNow  = Math.max(0, state.bossHpNow - playerDmg);

      if (state.bossVibNow <= 0 && !state.isShattered) {
        state.isShattered = true;
        shatterTurnsLeft  = 2;
        moveName += "\n✦ **SHATTER!** Echo stunned — all hits critical!";
        const voidHeal = elemVoidSurgeHeal(bonuses.elementPassive, state.playerHpMax);
        if (voidHeal > 0) {
          state.playerHp = Math.min(state.playerHpMax, state.playerHp + voidHeal);
          moveName += `\n✦ **Void Surge** — +${voidHeal} HP!`;
        }
      }

      state.lastMove = moveName;

      } // end of the damage-dealing else-branch opened in the swap check above

      // ── Win ────────────────────────────────────────────────────────────────
      if (state.bossHpNow <= 0) {
        removeEncounter(interaction.message.id);

        const rarity   = rollRarity(scaleEncounterRarity(enc.enemy.rarityWeights as [number, number, number], dbUser.worldLevel));
        const mainStat = rollMainStat(enc.enemy.cost as 1 | 3 | 4, dbUser.element);
        const subCount = substatCount(rarity);
        const substats = rollSubstats(subCount, mainStat);

        const echoData: any = {
          userId: interaction.user.id, name: enc.enemy.name,
          rarity, element: enc.enemy.element, cost: enc.enemy.cost,
          ...(enc.enemy.setId ? { setId: enc.enemy.setId } : {}),
          mainStatType: mainStat, mainStatValue: calcMainStatValue(mainStat, 0, rarity),
        };
        substats.forEach((s, i) => {
          echoData[`substat${i + 1}Type`]  = s;
          echoData[`substat${i + 1}Value`] = rollSubstatValue(s);
        });
        await prisma.echo.create({ data: echoData });
        await prisma.user.update({ where: { id: interaction.user.id }, data: { encountersWon: { increment: 1 } } }).catch(() => {});

        // Render the captured echo as a card
        const cardBuf = await generateEchoCard({
          ...echoRowToCard(echoData), revealedSubstats: 0,
        });
        const cardAttach = new AttachmentBuilder(cardBuf, { name: "echo.webp" });

        const winEmbed = new EmbedBuilder()
          .setColor(ELEMENT_COLORS[enc.enemy.element])
          .setTitle(`${ELEMENT_EMOJI[enc.enemy.element]}  Echo Captured`)
          .setDescription(
            `**${displayName}** defeated the **${enc.enemy.name}**!\n\n` +
            `› ${subCount} substats sealed — reveal with \`/echo-reveal\`. View all with \`/echoes\`.`
          )
          .setImage("attachment://echo.webp")
          .setFooter({ text: "CARTETHYIA  ·  Echo Acquired" });

        await battleMsg!.edit({ embeds: [winEmbed], components: [], files: [cardAttach] }).catch(() => {});
        return;
      }

      // Debuffs tick down at the START of resolving the enemy's turn — this way
      // any WEAKENED applied by the attack below isn't touched until NEXT round's
      // tick, giving it the full 2 turns its own flavor text advertises, instead
      // of being decremented in the same cycle it's created.
      if (isDevGuild) {
        const tickResult = tickDebuffs(playerDebuffs);
        playerDebuffs = tickResult.state;
        // No BLEED sources exist yet in this milestone, but tickDebuffs still
        // needs calling every round to decrement WEAKENED's duration correctly.
      }

      // ── Enemy turn ─────────────────────────────────────────────────────────
      if (shatterTurnsLeft > 0) {
        shatterTurnsLeft--;
        if (shatterTurnsLeft === 0) {
          state.isShattered = false;
          state.bossVibNow  = boss.vibBar;
          state.lastMove   += "\n◇ Echo recovers from Shatter.";
        } else {
          state.lastMove += `\n◇ Echo stunned (${shatterTurnsLeft} turn${shatterTurnsLeft > 1 ? "s" : ""} remaining).`;
        }
      } else {
        const move     = boss.moves[Math.floor(Math.random() * boss.moves.length)];
        const isSolaceAllyForDef = isDevGuild && activeAllyCharacterId === "solace";
        const wellspringDefBonus = isSolaceAllyForDef && allySolaceStats?.hasWellspring ? getWellspringDefBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
        const forteDefBonus = isSolaceAllyForDef ? getSolaceForteDefBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
        const attunementDefBonus = solaceAttunementDefBonus(allySkillLevel);
        const riloDefBuffMult = riloDefBuffTurnsLeft > 0 ? (1 + riloDefBuffPct) : 1;
        const attunementDefMult = (isSolaceAllyForDef ? getAttunementDefMult(attunement, attunementDefBonus, attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus) * riloDefBuffMult;
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, activeDef * attunementDefMult, move.damage);
        const shield   = elemFrostShield(bonuses.elementPassive, bossDmg);
        bossDmg        = shield.dmg;

        // Milestone 1 bug fix (caught in playtesting): this always hit
        // state.playerHp regardless of who was actually active, so benching
        // yourself behind the dummy did nothing protective — swap was purely
        // cosmetic. Solace doesn't have her own independent stat block yet in
        // this test milestone, so the damage math (DEF, elemental procs)
        // still uses the player's stats — only WHICH HP pool actually takes
        // the hit changes.
        const allyIsActive = isDevGuild && !isPlayerActive();
        if (allyIsActive && activeAllyCharacterId === "rilo") {
          const rState = allyMechanicState as RiloMechanicState;
          const hitResult = riloOnHitTaken(rState, bossDmg, allyHp, allyHpMax, allyConstellation);
          allyMechanicState = hitResult.newMechanicState;
          bossDmg = hitResult.actualDamageTaken;
          if (hitResult.forteGain > 0) solaceForte = addForteCharge(solaceForte, RILO_FORTE_CONFIG, hitResult.forteGain);
          if (hitResult.blockedByC3) state.lastMove = (state.lastMove ?? "") + `\n🛡️ **Guard Break Save!** Rilo's Shield fully absorbed a lethal blow!`;
          if (hitResult.zeroShieldSaveTriggered) state.lastMove = (state.lastMove ?? "") + `\n❄️ **Unbreakable Guard** — Shield surges back from nothing!`;
        }
        const targetHpMax  = allyIsActive ? allyHpMax : state.playerHpMax;
        const radRegen     = elemRadianceRegen(bonuses.elementPassive, targetHpMax);
        if (allyIsActive) {
          allyHp = Math.max(0, allyHp - bossDmg);
          if (radRegen > 0) allyHp = Math.min(allyHpMax, allyHp + radRegen);
        } else {
          state.playerHp = Math.max(0, state.playerHp - bossDmg);
          if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
        }
        state.lastMove += `\n◇ ${enc.enemy.name} ${move.effect} — **${bossDmg} DMG**${allyIsActive ? ` *(hit ${allyKit?.label ?? "your ally"})*` : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + 15);

        // Solace has no AI-driven turn of her own (the player controls her
        // directly via the button row when she's active) — if she goes down,
        // auto-swap back to the player rather than ending the whole encounter
        // over her HP hitting 0.
        commitActiveBundle();
        if (isDevGuild && currentPositionHp(activeUnit) <= 0) {
          const fallback = nextAliveFallback(roster, activeUnit, currentPositionHp);
          if (fallback !== null) {
            const koLabel = positionLabel(roster, activeUnit, displayName, (id) => CHARACTER_KITS[id]?.label ?? null);
            activeUnit = fallback;
            syncActiveBundle();
            const fbLabel = positionLabel(roster, fallback, displayName, (id) => CHARACTER_KITS[id]?.label ?? null);
            state.lastMove += `\n◇ **${koLabel} was knocked out** — swapped to ${fbLabel}.`;
          }
        }

        // Milestone 1: exercises the debuff system inside a real fight.
        // 25% chance per enemy attack, only when the player has actually
        // opted into team mechanics via /team (Milestone 3.5a) — keeps this
        // invisible to everyone else, dev-guild or not.
        if (hasSolace && Math.random() < 0.25) {
          playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.2, 2);
          state.lastMove += `\n◇ *${enc.enemy.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
        }
      }

      state.turn++;
      if (state.skillCooldown > 0) state.skillCooldown--;
      if (echoSkillCooldown > 0) echoSkillCooldown--;
      if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
      if (riloDefBuffTurnsLeft > 0) riloDefBuffTurnsLeft--;
      if (isDevGuild && attunementDoubleTurnsLeft > 0) attunementDoubleTurnsLeft--;
      if (isDevGuild && forteEmpoweredTurnsLeft > 0) forteEmpoweredTurnsLeft--;
      if (forcedCritActive) nextAttackCritArmed = false;

      // ── Second Wind: survive a lethal blow once at 1 HP ────────────────────
      if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
        secondWindUsed = true;
        state.playerHp = 1;
        state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
      }

      // ── Lose — every filled position knocked out ───────────────────────────
      if (isTeamWiped(roster, currentPositionHp)) {
        removeEncounter(interaction.message.id);
        const loseEmbed = new EmbedBuilder()
          .setColor(0x4A4A5A)
          .setDescription(`**${displayName}** was defeated by the **${enc.enemy.name}**.\n*The echo escapes.*`)
          .setFooter({ text: "CARTETHYIA  ·  Encounter" });
        await battleMsg!.edit({ embeds: [loseEmbed], components: [], files: [] }).catch(() => {});
        return;
      }

      // ── Next turn: update battle card ──────────────────────────────────────
      const buf    = await generateBattleCard(state);
      const attach = new AttachmentBuilder(buf, { name: "encounter.webp" });
      // The card image only ever shows state.lastMove's FIRST line (see
      // battleCard.ts's `.split("\n")[0]`, a hard 90-char single-line budget
      // under the character art) — every line after that (Forte status
      // notes, Shatter, Void Surge, WEAKENED, boss-retaliation flavor, etc.)
      // was previously appended to lastMove but never actually rendered
      // anywhere. Surface those extra lines in the embed description instead.
      const moveExtraLines = state.lastMove.split("\n").slice(1).join("\n");
      const description = [moveExtraLines, teamStatusLine()].filter(Boolean).join("\n");
      const embed  = new EmbedBuilder()
        .setColor(ELEMENT_COLORS[enc.enemy.element])
        .setImage("attachment://encounter.webp")
        .setDescription(description || null);
      await battleMsg!.edit({
        embeds: [embed], files: [attach],
        components: buildEncounterButtons(),
        attachments: [],
      } as any).catch(() => {});

      runTurn();
    });

    collector.on("end", async (_col: any, reason: string) => {
      if (reason === "time") {
        removeEncounter(interaction.message.id);
        await battleMsg!.edit({
          embeds: [new EmbedBuilder().setColor(0x4A4A5A)
            .setDescription("*Combat timed out — the echo dissipated.*")
            .setFooter({ text: "CARTETHYIA  ·  Encounter" })],
          components: [], files: [],
        }).catch(() => {});
      }
    });
  };

  runTurn();
}

// ── Util ─────────────────────────────────────────────────────────────────────

function disableButtons(
  row: ActionRowBuilder<ButtonBuilder>,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    row.components.map(b =>
      ButtonBuilder.from(b.toJSON() as any).setDisabled(true)
    )
  );
}
