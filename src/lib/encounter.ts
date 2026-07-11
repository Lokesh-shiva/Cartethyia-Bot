import {
  TextChannel, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, AttachmentBuilder,
  ComponentType, ButtonInteraction, Message,
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
import { SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO } from "./solace";
import { resolveIntroOutroEffect } from "./introOutro";
import {
  AttunementState, cycleAttunementMode,
  getAttunementAtkMult, getAttunementCritRateBonus, getAttunementDefMult,
} from "./attunement";
import { AllyActionTarget } from "./allyActions";
import { addConcertoEnergy } from "./concertoEnergy";
import { DebuffState, applyDebuff, tickDebuffs, getWeakenedMult } from "./debuffs";

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
              isOnboarded: true },
  });

  // A user row can exist without /start (some commands auto-create) — require
  // completed onboarding, not just row existence.
  if (!dbUser?.isOnboarded) {
    enc.fighterId = null; // free the encounter for someone who has started
    await interaction.followUp({ content: "You need to `/start` before you can fight!", flags: 64 });
    return;
  }

  const displayName = (interaction.member as any)?.displayName ?? interaction.user.displayName;

  // Milestone 1: team mechanics (swap, Intro/Outro, Concerto Energy, debuffs) are
  // gated to the dev guild only. Every other server keeps the exact current 1v1
  // /encounter flow, byte-for-byte unchanged. See design spec + Milestone 1 plan.
  const isDevGuild = interaction.guildId === process.env.GUILD_ID;

  // Resolve full combat stats (echoes + weapon + set bonuses + unique ability)
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
  const stats   = applyBonuses(dbUser, bonuses);
  let secondWindUsed = false;

  // ── Milestone 1/2a: two-unit team state (dev guild only) ─────────────────────
  let activeUnit: "player" | "ally" = "player";
  let allyHp    = SOLACE.hpMax;
  const allyHpMax = SOLACE.hpMax;
  let concertoEnergy: number = 0;
  let playerDebuffs: DebuffState = [];
  let attunement: AttunementState = { mode: null };
  let attunementDoubleTurnsLeft = 0; // set by Solace's Ultimate; see Task 4

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
    if (isDevGuild && activeUnit === "ally") {
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

    if (isDevGuild) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("enc_swap")
          .setLabel(activeUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${displayName}`)
          .setStyle(ButtonStyle.Secondary),
      ));
    }

    return rows;
  }

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
      componentType: ComponentType.Button,
      filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
      time:   5 * 60 * 1000,
      max:    1,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      let moveName = "";
      let playerDmg = 0;
      let forcedCritActive = false; // set inside the damage-dealing branch below; a swap never arms/consumes it

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
      if (btn.customId === "enc_swap" && isDevGuild) {
        const outgoingIsPlayer = activeUnit === "player";
        const comboReady = concertoEnergy >= 100;

        if (comboReady) {
          const incomingTarget: AllyActionTarget = outgoingIsPlayer
            ? { hp: allyHp, hpMax: allyHpMax }
            : { hp: state.playerHp, hpMax: state.playerHpMax };

          const outroEffect = outgoingIsPlayer ? PLAYER_SELF_OUTRO : SOLACE.outro;
          const introEffect = outgoingIsPlayer ? SOLACE.intro : PLAYER_SELF_INTRO;
          const outroResult = resolveIntroOutroEffect(outroEffect, incomingTarget);
          const introResult = resolveIntroOutroEffect(introEffect, incomingTarget);

          // Solace's Outro also arms a guaranteed crit for whoever swaps in —
          // no AllyAction primitive covers this, so it reuses the existing
          // nextAttackCritArmed variable (already wired for the Echo Skill
          // system elsewhere in this file) rather than inventing a new one.
          if (!outgoingIsPlayer) nextAttackCritArmed = true;

          // Milestone 1 has no separate shield stat yet — shieldDelta is folded
          // into a flat HP bonus, capped at max HP like a heal. Real shield state
          // (absorbing damage before HP) is a later-milestone concern once a
          // second real character exists to make the distinction matter.
          const totalBonus = outroResult.hpDelta + introResult.hpDelta + outroResult.shieldDelta + introResult.shieldDelta;

          // Report what actually landed (post-clamp), not the raw theoretical
          // amount — if the incoming unit was already at/near max HP, the real
          // gain is smaller than totalBonus (or zero), and the message should
          // say so rather than claiming a heal that got silently capped away.
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

          // Combo consumes the bar, then Intro grants a partial head-start back
          // rather than leaving the incoming character to build from zero.
          const CONCERTO_INTRO_HEADSTART = 20;
          concertoEnergy = addConcertoEnergy(0, CONCERTO_INTRO_HEADSTART);

          activeUnit = outgoingIsPlayer ? "ally" : "player";
          moveName = actualGain > 0
            ? `🔄 **Concerto Combo!** Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Outro + Intro triggered, +${actualGain} HP.`
            : `🔄 **Concerto Combo!** Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Outro + Intro triggered (already at full HP, no heal needed).`;
        } else {
          activeUnit = outgoingIsPlayer ? "ally" : "player";
          moveName = `🔄 Swapped to **${outgoingIsPlayer ? SOLACE.name : displayName}** — Concerto Energy not full, no combo triggered.`;
        }

        state.lastMove = moveName;
      } else {

      const defShredActive = enemyDefShredTurnsLeft > 0;
      const defVal     = state.isShattered ? 0 : scaledEnemy.def * (defShredActive ? (1 - enemyDefShredPct) : 1);
      const enemyHpPct = state.bossHpNow / state.bossHpMax;
      const radCrit    = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
      const cRate      = abilityCritRate(bonuses, Math.min(1, stats.critRate + radCrit), state.playerHp, state.playerHpMax);
      const vibMult    = abilityVib(bonuses);
      forcedCritActive = nextAttackCritArmed && btn.customId !== "enc_flee";
      let   vibFrac    = 0.3;
      let   moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
      let   isCrit = false;

      if (btn.customId === "enc_basic") {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement) : 1);
        const r  = calcPlayerDamage(stats.atk * atkMult, defVal, forcedCritActive ? 1 : Math.min(1, cRate + (isDevGuild ? getAttunementCritRateBonus(attunement) : 0)), stats.critDmg, 1.0, isWeak, state.isShattered);
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
      }

      if (btn.customId === "enc_skill" && isDevGuild && activeUnit === "ally") {
        // Solace's Skill is Attunement — a mode cycle, not a damage move. No
        // cooldown (always available), no personal Energy interaction. Deals a
        // small hit so it's not purely administrative, using her own baseline
        // (reuses the player's ATK/DEF context since Solace has no stat block
        // of her own yet in this test milestone, same simplification the
        // placeholder ally used).
        attunement.mode = cycleAttunementMode(attunement.mode);
        const r  = calcPlayerDamage(stats.atk, defVal, cRate, stats.critDmg, 0.6, isWeak, state.isShattered);
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

      if (btn.customId === "enc_ultimate" && !(isDevGuild && activeUnit === "ally")) {
        const atkMult = getWeakenedMult(playerDebuffs) * (isDevGuild ? getAttunementAtkMult(attunement) : 1);
        const r = calcPlayerDamage(stats.atk * atkMult, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus)); isCrit = true;
        moveType = "ULT"; vibFrac = 0.8;
        moveName  = `⚡ ULTIMATE — ${playerDmg} DMG`;
        state.playerEnergy = 0;
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
      if (isDevGuild) {
        const concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
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
        const attunementDefMult = isDevGuild ? getAttunementDefMult(attunement, attunementDoubleTurnsLeft > 0) : 1;
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def * attunementDefMult, move.damage);
        const shield   = elemFrostShield(bonuses.elementPassive, bossDmg);
        bossDmg        = shield.dmg;

        // Milestone 1 bug fix (caught in playtesting): this always hit
        // state.playerHp regardless of who was actually active, so benching
        // yourself behind the dummy did nothing protective — swap was purely
        // cosmetic. The placeholder ally has no stat block of its own, so the
        // damage math (DEF, elemental procs) still uses the player's stats —
        // only WHICH HP pool actually takes the hit changes.
        const allyIsActive = isDevGuild && activeUnit === "ally";
        const targetHpMax  = allyIsActive ? allyHpMax : state.playerHpMax;
        const radRegen     = elemRadianceRegen(bonuses.elementPassive, targetHpMax);
        if (allyIsActive) {
          allyHp = Math.max(0, allyHp - bossDmg);
          if (radRegen > 0) allyHp = Math.min(allyHpMax, allyHp + radRegen);
        } else {
          state.playerHp = Math.max(0, state.playerHp - bossDmg);
          if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
        }
        state.lastMove += `\n◇ ${enc.enemy.name} ${move.effect} — **${bossDmg} DMG**${allyIsActive ? ` *(hit ${SOLACE.name})*` : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + 15);

        // The placeholder ally has no real kit and can't act — if it goes
        // down, auto-swap back to the player rather than ending the whole
        // encounter over a fixture NPC's HP hitting 0.
        if (allyIsActive && allyHp <= 0) {
          activeUnit = "player";
          state.lastMove += `\n◇ **${SOLACE.name} was knocked out** — swapped back to ${displayName}.`;
        }

        // Milestone 1: exercises the debuff system inside a real fight.
        // 25% chance per enemy attack, only when the dev-guild team mechanics are
        // active — keeps this invisible to every other server.
        if (isDevGuild && Math.random() < 0.25) {
          playerDebuffs = applyDebuff(playerDebuffs, "WEAKENED", 0.2, 2);
          state.lastMove += `\n◇ *${enc.enemy.name}'s strike leaves you* **WEAKENED** *(-20% ATK, 2 turns)*`;
        }
      }

      state.turn++;
      if (state.skillCooldown > 0) state.skillCooldown--;
      if (echoSkillCooldown > 0) echoSkillCooldown--;
      if (enemyDefShredTurnsLeft > 0) enemyDefShredTurnsLeft--;
      if (forcedCritActive) nextAttackCritArmed = false;

      // ── Second Wind: survive a lethal blow once at 1 HP ────────────────────
      if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
        secondWindUsed = true;
        state.playerHp = 1;
        state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
      }

      // ── Lose ───────────────────────────────────────────────────────────────
      if (state.playerHp <= 0) {
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
      const embed  = new EmbedBuilder()
        .setColor(ELEMENT_COLORS[enc.enemy.element])
        .setImage("attachment://encounter.webp")
        .setDescription(teamStatusLine() || null);
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
