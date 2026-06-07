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
  pickEncounterEnemy, ELEMENT_COLORS, ELEMENT_EMOJI, RARITY_STARS,
} from "./echoes";
import { echoToBoss, calcPlayerDamage, calcEnemyDamage, COUNTER_ELEMENT, gearAwareScale, baselineAtk } from "./combat";
import { echoEmoji } from "./emojiManager";
import { generateBattleCard, BattleCardState } from "./battleCard";
import {
  resolvePlayerBonuses, applyBonuses, applyAbilityAttack,
  abilityCritRate, abilityVib, applyLifesteal,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit,
} from "./setBonus";
import { compositeHasSecondWind } from "./abilityEffects";
import { generateEchoCard, echoRowToCard } from "./echoCard";

// ── In-memory state ──────────────────────────────────────────────────────────

// guildId → config (refreshed from DB on change)
const exploreChannels   = new Map<string, Set<string>>();
const encounterChannels = new Map<string, Set<string>>();   // empty set = everywhere
const encountersEnabled = new Map<string, boolean>();

export async function loadExploreChannels(guildId: string): Promise<void> {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId } });
  exploreChannels.set(guildId,   new Set(settings?.exploreChannelIds   ?? []));
  encounterChannels.set(guildId, new Set(settings?.encounterChannelIds ?? []));
  encountersEnabled.set(guildId, settings?.encountersEnabled ?? true);
}

// Load config for ALL guilds the bot is in (called on ready for multi-server)
export async function loadAllGuildSettings(): Promise<void> {
  const all = await prisma.guildSettings.findMany();
  for (const s of all) {
    exploreChannels.set(s.guildId,   new Set(s.exploreChannelIds));
    encounterChannels.set(s.guildId, new Set(s.encounterChannelIds));
    encountersEnabled.set(s.guildId, s.encountersEnabled);
  }
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

export function isExploreChannel(guildId: string, channelId: string): boolean {
  return exploreChannels.get(guildId)?.has(channelId) ?? false;
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

export function shouldSpawnEncounter(guildId: string, channelId: string): boolean {
  // Master toggle — admins can disable chat encounters entirely
  if (encountersEnabled.get(guildId) === false) return false;

  const explore = isExploreChannel(guildId, channelId);

  // Allowlist: if encounter channels are configured, only fire there (+ explore channels).
  // Empty allowlist = fire everywhere (good for small/test servers).
  const allow = encounterChannels.get(guildId);
  if (allow && allow.size > 0 && !allow.has(channelId) && !explore) return false;

  const cooldown = explore ? COOLDOWN_EXPLORE_MS : COOLDOWN_NORMAL_MS;
  const chance   = explore ? CHANCE_EXPLORE      : CHANCE_NORMAL;
  const last     = channelCooldowns.get(channelId) ?? 0;
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
  await interaction.deferUpdate();

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { level: true, baseAtk: true, baseDef: true, baseHp: true,
              worldLevel: true, element: true, critRate: true, critDmg: true },
  });

  if (!dbUser) {
    await interaction.followUp({ content: "You need to `/start` before you can fight!", flags: 64 });
    removeEncounter(interaction.message.id);
    return;
  }

  const displayName = (interaction.member as any)?.displayName ?? interaction.user.displayName;

  // Resolve full combat stats (echoes + weapon + set bonuses + unique ability)
  const bonuses = await resolvePlayerBonuses(interaction.user.id);
  const stats   = applyBonuses(dbUser, bonuses);
  let secondWindUsed = false;

  // Scale enemy to the fighter's progression + gear (lighter gear weight — encounters stay quick)
  const gearRatio = stats.atk / baselineAtk(dbUser.level);
  const gs = gearAwareScale(
    { hp: enc.enemy.hp, atk: enc.enemy.atk, def: enc.enemy.def },
    dbUser.level, dbUser.worldLevel, gearRatio, 0.5, 0.40,
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
  let shatterTurnsLeft  = 0;
  let firstActionDone   = false;

  function buildEncounterButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("enc_basic").setLabel("⚔️  Basic").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("enc_skill")
        .setLabel(state.skillCooldown === 0 ? "✦  Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(state.skillCooldown > 0),
      new ButtonBuilder().setCustomId("enc_ultimate").setLabel("⚡  Ultimate")
        .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
      new ButtonBuilder().setCustomId("enc_flee").setLabel("↩  Flee").setStyle(ButtonStyle.Danger),
    );
  }

  // Send the battle card as a new message
  let battleMsg = await (async () => {
    const buf    = await generateBattleCard(state);
    const attach = new AttachmentBuilder(buf, { name: "encounter.png" });
    const embed  = new EmbedBuilder()
      .setColor(ELEMENT_COLORS[enc.enemy.element])
      .setImage("attachment://encounter.png");
    return (interaction.channel as TextChannel).send({ embeds: [embed], files: [attach], components: [buildEncounterButtons()] });
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

      if (btn.customId === "enc_flee") {
        removeEncounter(interaction.message.id);
        const fleeEmbed = new EmbedBuilder()
          .setColor(0x4A4A5A)
          .setDescription(`*${displayName} retreated. The echo dissipates into the ether.*`)
          .setFooter({ text: "CARTETHYIA  ·  Encounter" });
        await battleMsg!.edit({ embeds: [fleeEmbed], components: [], files: [] }).catch(() => {});
        return;
      }

      const defVal     = state.isShattered ? 0 : enc.enemy.def;
      const enemyHpPct = state.bossHpNow / state.bossHpMax;
      const radCrit    = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
      const cRate      = abilityCritRate(bonuses, Math.min(1, stats.critRate + radCrit), state.playerHp, state.playerHpMax);
      const vibMult    = abilityVib(bonuses);
      let   vibFrac    = 0.3;
      let   moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
      let   isCrit = false;

      if (btn.customId === "enc_basic") {
        const r  = calcPlayerDamage(stats.atk, defVal, cRate, stats.critDmg, 1.0, isWeak, state.isShattered);
        let base = Math.floor(r.damage * (1 + stats.elemDmgBonus));
        base     = Math.floor(base * elemWindstrideMult(bonuses.elementPassive, state.turn, "BASIC"));
        const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "BASIC"; vibFrac = 0.3;
        moveName  = r.isCrit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));
      }

      if (btn.customId === "enc_skill") {
        const r  = calcPlayerDamage(stats.atk, defVal, Math.min(1, cRate + 0.1), stats.critDmg, 1.8, isWeak, state.isShattered);
        let base = Math.floor(r.damage * (1 + stats.elemDmgBonus));
        base     = Math.floor(base * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
        const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
        playerDmg = base + ignite.dmg; isCrit = r.isCrit;
        moveType = "SKILL"; vibFrac = 0.6;
        moveName  = `Resonance Skill — ${playerDmg} DMG${r.isCrit ? " **(CRIT)**" : ""}`;
        if (ignite.tag) moveName += `  ✦${ignite.tag}`;
        state.skillCooldown = SKILL_COOLDOWN;
        state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, r.isCrit));
      }

      if (btn.customId === "enc_ultimate") {
        const r = calcPlayerDamage(stats.atk, defVal, 1.0, stats.critDmg, 3.5, isWeak, state.isShattered);
        playerDmg = Math.floor(r.damage * (1 + stats.elemDmgBonus)); isCrit = true;
        moveType = "ULT"; vibFrac = 0.8;
        moveName  = `⚡ ULTIMATE — ${playerDmg} DMG`;
        state.playerEnergy = 0;
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
      state.playerHp = applyLifesteal(stats.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
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

      // ── Win ────────────────────────────────────────────────────────────────
      if (state.bossHpNow <= 0) {
        removeEncounter(interaction.message.id);

        const rarity   = rollRarity(enc.enemy.rarityWeights as [number, number, number]);
        const mainStat = rollMainStat(enc.enemy.cost as 1 | 3 | 4, dbUser.element);
        const subCount = substatCount(rarity);
        const substats = rollSubstats(subCount, mainStat);

        const echoData: any = {
          userId: interaction.user.id, name: enc.enemy.name,
          rarity, element: enc.enemy.element, cost: enc.enemy.cost,
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
        const cardAttach = new AttachmentBuilder(cardBuf, { name: "echo.png" });

        const winEmbed = new EmbedBuilder()
          .setColor(ELEMENT_COLORS[enc.enemy.element])
          .setTitle(`${ELEMENT_EMOJI[enc.enemy.element]}  Echo Captured`)
          .setDescription(
            `**${displayName}** defeated the **${enc.enemy.name}**!\n\n` +
            `› ${subCount} substats sealed — reveal with \`/echo-reveal\`. View all with \`/echoes\`.`
          )
          .setImage("attachment://echo.png")
          .setFooter({ text: "CARTETHYIA  ·  Echo Acquired" });

        await battleMsg!.edit({ embeds: [winEmbed], components: [], files: [cardAttach] }).catch(() => {});
        return;
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
        let bossDmg    = calcEnemyDamage(scaledEnemy.atk, stats.def, move.damage);
        const shield   = elemFrostShield(bonuses.elementPassive, bossDmg);
        bossDmg        = shield.dmg;
        state.playerHp = Math.max(0, state.playerHp - bossDmg);
        const radRegen = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
        if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
        state.lastMove += `\n◇ ${enc.enemy.name} ${move.effect} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
        state.playerEnergy = Math.min(100, state.playerEnergy + 15);
      }

      state.turn++;
      if (state.skillCooldown > 0) state.skillCooldown--;

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
      const attach = new AttachmentBuilder(buf, { name: "encounter.png" });
      const embed  = new EmbedBuilder()
        .setColor(ELEMENT_COLORS[enc.enemy.element])
        .setImage("attachment://encounter.png");
      await battleMsg!.edit({
        embeds: [embed], files: [attach],
        components: [buildEncounterButtons()],
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
