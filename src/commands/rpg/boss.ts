import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, PermissionFlagsBits,
  TextChannel, ThreadChannel, StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { Command } from "../../types";
import prisma from "../../lib/prisma";
import { getOrCreateUser, awardUser, isDispatchBlocked } from "../../lib/economy";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { checkLevelUp } from "../../lib/progression";
import { BOSSES, getBoss, veteranScale } from "../../lib/bosses";
import { gearAwareScale, baselineAtk, buildRewardText } from "../../lib/combat";
import { voteNudge, supportNudge } from "../../lib/voteNudge";
import { mailNudge } from "../../lib/mailNudge";
import { trackEvolutionProgress } from "../../lib/abilityEvolution";
import { incrementWeaponBond } from "../../lib/weaponAwakening";
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
import { computeAura, consumeAura, auraBar, fmtAuraRegen, getMaxAura } from "../../lib/aura";
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
import { VesperMechanicState, VesperSkillResult, VESPER_FORTE_CONFIG, VESPER_FORTE_GAIN_PER_BASIC, vesperUltimateBaseMult } from "../../lib/kits/vesperKit";
import {
  RiloMechanicState, RiloSkillResult, RILO_FORTE_CONFIG, RILO_FORTE_GAIN_PER_BASIC,
  RILO_SHIELD_GAIN_PER_BASIC, RILO_C2_DEF_SHRED_PCT, riloMaxShield, riloUltimateBaseMult, riloUltimateShieldFromDamage, riloOnHitTaken,
} from "../../lib/kits/riloKit";
import "../../lib/kits";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

const LOOT_MULT      = 0.70;               // 70% of ascension loot
const SKILL_COOLDOWN = 3;

// activeSessions replaced by shared combatLock

async function sendBattleCard(
  thread: TextChannel | ThreadChannel,
  state: BattleCardState,
  buttons: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[],
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
  isPlayerActiveNow: boolean;
  displayName: string;
  attunement: AttunementState;
  concertoEnergy: number;
  activeAllyCharacterId: string | null;
  allyLabel: string;
  swapTargets: { pos: PositionIndex; label: string }[]; // positions swappable TO from wherever's active now
}

function buildButtons(
  state: BattleCardState,
  echoSkill?: { name: string; cooldown: number } | null,
  team?: TeamButtonContext | null,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "kaelith") {
    const skillReady = state.skillCooldown === 0;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("boss_skill")
        .setLabel(skillReady ? "🌑  Umbral Detonation" : `🌑  Detonation (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder().setCustomId("boss_ultimate").setLabel("🌑  Umbral Cataclysm")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "vesper") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("boss_skill").setLabel("⚡  Discharge").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("boss_ultimate").setLabel("⚡  Overload")
        .setStyle(ButtonStyle.Success).setDisabled(state.playerEnergy < 100),
      new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow && team.activeAllyCharacterId === "rilo") {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("boss_skill").setLabel("🛡️  Guard Break").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("boss_ultimate").setLabel("🛡️  Avalanche Slam")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else if (team?.isDevGuild && !team.isPlayerActiveNow) {
    const modeLabel = team.attunement.mode ? `(${team.attunement.mode})` : "(inactive)";
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Chime Strike").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("boss_skill").setLabel(`✦  Attunement ${modeLabel}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("boss_ultimate").setLabel("⚡  Convergence")
        .setStyle(ButtonStyle.Success).setDisabled(team.concertoEnergy < 100),
      new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const skillReady = state.skillCooldown === 0;
    const ultReady   = state.playerEnergy >= 100;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("boss_skill")
        .setLabel(skillReady ? "✦  Resonance Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
        .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
      new ButtonBuilder()
        .setCustomId("boss_ultimate").setLabel("⚡  Ultimate")
        .setStyle(ButtonStyle.Success).setDisabled(!ultReady),
    );
    if (echoSkill) {
      const echoReady = echoSkill.cooldown === 0;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("boss_echoskill")
          .setLabel(echoReady ? `🌀  ${echoSkill.name}` : `🌀  ${echoSkill.name} (${echoSkill.cooldown}🔄)`)
          .setStyle(ButtonStyle.Secondary).setDisabled(!echoReady),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
    );
    rows.push(row);
  }

  if (team?.isDevGuild && team.swapTargets.length === 1) {
    const target = team.swapTargets[0];
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_swap")
        .setLabel(`🔄  Swap to ${target.label}`)
        .setStyle(ButtonStyle.Secondary),
    ));
  } else if (team?.isDevGuild && team.swapTargets.length > 1) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("boss_swap_select")
        .setPlaceholder("🔄  Swap to…")
        .addOptions(team.swapTargets.map(t => ({ label: t.label, value: String(t.pos) }))),
    ));
  }

  return rows;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("boss")
    .setDescription("Re-challenge a boss you've already defeated. Costs 1 ◈ Resonance Aura."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const auraState = computeAura(user.resonanceAura ?? 5, user.auraUpdatedAt ?? new Date(), getMaxAura(user.patronTier ?? 0));
    const bonuses = await resolvePlayerBonuses(interaction.user.id);
    const stats   = applyBonuses(user, bonuses);

    if (!user.element || user.element === "NONE") {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x334155)
          .setDescription("◈ Choose your **Elemental Resonance** before challenging a boss.\nCheck your level-20 notification or use **/element**.")
          .setFooter({ text: "CARTETHYIA  ·  Boss Challenge" })],
      });
      return;
    }

    // Bosses the player has already cleared (worldLevel > boss.worldLevel)
    const clearedWLs = Object.keys(BOSSES)
      .map(Number)
      .filter(wl => user.worldLevel > wl);

    if (clearedWLs.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x334155)
          .setDescription("◈ You haven't defeated any bosses yet.\nUse **/ascend** to challenge the current trial first.")
          .setFooter({ text: "CARTETHYIA  ·  Boss Challenge" })],
      });
      return;
    }

    if (isDispatchBlocked(user)) {
      await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before entering combat." });
      return;
    }

    if (!acquireLock(interaction.user.id, "Boss Challenge")) {
      await interaction.editReply({ content: alreadyInCombatMsg(interaction.user.id) });
      return;
    }

    const options = clearedWLs.map(wl => {
      const boss   = BOSSES[wl]!;
      const vScale = veteranScale(user.level, wl);
      return {
        label:       `${boss.name}`,
        description: `WL${wl}  ·  ${boss.element}  ·  Weakness: ${boss.weakness}  ·  Veteran ×${vScale.toFixed(2)}`,
        value:       String(wl),
      };
    });

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("boss_select")
        .setPlaceholder("Select a boss to challenge…")
        .addOptions(options)
    );

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(ELEMENT_HEX[user.element] ?? 0x6366F1)
        .setTitle("⚔️  Boss Challenge")
        .setDescription(
          `Re-fight any boss you've already defeated.\n\n` +
          `**Resonance Aura:** ${auraBar(auraState.current, auraState.max)}  ${auraState.current}/${auraState.max}` +
          (auraState.current < auraState.max ? `  ·  next in **${fmtAuraRegen(auraState.nextRegenMs)}**` : "") + `\n\n` +
          `› Costs **1 ◈ Aura** per fight — no additional cooldown\n` +
          `› Loot: **70%** of ascension rewards\n` +
          `› Difficulty: scales harder the more overleveled you are (**Veteran ×** multiplier)\n` +
          `› Boss enrages at **40% HP** — fights back much harder`
        )
        .setFooter({ text: "CARTETHYIA  ·  Boss Challenge  ·  Expires in 60s" })],
      components: [selectRow],
    });

    const selCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId === "boss_select",
      time:   60_000,
      max:    1,
    });

    selCollector?.on("collect", async (sel: StringSelectMenuInteraction) => {
      await sel.deferUpdate();
      const wl   = parseInt(sel.values[0]);
      const boss = getBoss(wl);
      if (!boss) { await sel.editReply({ content: "Boss not found.", components: [], embeds: [] }); return; }

      // lock was already acquired at command entry — no re-check needed

      // Aura check
      const freshAura = computeAura(user.resonanceAura ?? 5, user.auraUpdatedAt ?? new Date(), getMaxAura(user.patronTier ?? 0));
      if (freshAura.current < 1) {
        releaseLock(interaction.user.id);
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setDescription(`◈ Not enough **Resonance Aura**. Boss challenges cost **1 ◈**.\nNext charge in **${fmtAuraRegen(freshAura.nextRegenMs)}**.`)
            .setFooter({ text: "CARTETHYIA  ·  Boss Challenge" })],
          components: [],
        });
        return;
      }

      // ── Create thread ────────────────────────────────────────────────────────
      const channel = interaction.channel as TextChannel;
      let thread;
      try {
        thread = await channel.threads.create({
          name:                `⚔️ ${displayName} vs ${boss.name}`,
          autoArchiveDuration: 10080,
          type:                ChannelType.PrivateThread,
          reason:              "Boss Challenge",
        });
        await thread.members.add(interaction.user.id);
      } catch {
        releaseLock(interaction.user.id);
        await sel.editReply({ content: "◈ I need **Create Private Threads** permissions here.", components: [], embeds: [] });
        return;
      }

      await sel.editReply({ content: `◈ The challenge begins. <#${thread.id}>`, components: [], embeds: [] });
      await consumeAura(interaction.user.id, 1);
      await registerFight(interaction.user.id, thread.id, interaction.guildId!, "Boss Challenge");
      // lock already held

      // ── Scale boss ───────────────────────────────────────────────────────────
      // Rechallenges are meant to be farmable, not a progression wall.
      // Cap fightLevel at the WL's intended ceiling so levelScale stays fair.
      // Cap gearRatio at 1.5 and use softer weights so boss ATK doesn't spike
      // to one-shot territory — veteranScale already handles the overleveled penalty.
      const WL_LEVEL_CAP: Record<number, number> = { 0: 20, 1: 40, 2: 50, 3: 60, 4: 70, 5: 80, 6: 84, 7: 88, 8: 90 };
      const fightLevel      = Math.min(user.level, WL_LEVEL_CAP[wl] ?? user.level);
      const rawGearRatio    = stats.atk / baselineAtk(fightLevel);
      const cappedGearRatio = Math.min(rawGearRatio, 2.7);
      const vScale          = veteranScale(user.level, wl);
      const scaledBase  = {
        hp:  Math.floor(boss.baseHp  * vScale),
        atk: Math.floor(boss.baseAtk * vScale),
        def: Math.floor(boss.baseDef * vScale),
      };
      const scaled = gearAwareScale(scaledBase, fightLevel, boss.worldLevel, cappedGearRatio, 0.55, 0.40);

      // ── State ────────────────────────────────────────────────────────────────
      let firstSkillUsed  = false;
      let firstActionDone = false;
      let v2Stacks        = 0;
      let secondWindUsed  = false;
      let isEnraged       = false;
      let shatterTurnsLeft = 0;
      let quickStrikeUsed  = false; // SPD-driven bonus action — once per fight
      let battleMsg: any   = null;

      // ── Milestone 3b: team state ──────────────────────────────────────────────
      // Requires the player to actually own + have picked Solace via /team.
      // NOTE: `isDevGuild` is a legacy name kept to avoid touching the many
      // downstream usages below and in shared helpers (TeamButtonContext) —
      // it no longer means "in the dev guild", it means "has an active
      // Solace ally". Was hard-gated to the dev guild only during
      // development; that gate is exactly the bug that blocked Solace
      // everywhere after launch.
      // CRITICAL: real read-only ownership lookup, NOT getOrCreateCharacterProgress
      // — that helper CREATES a row if missing, which would silently re-grant
      // Solace ownership to anyone whose teamAllyCharacterId flag is "solace"
      // but doesn't actually own her, bypassing the gacha entirely.
      interface AllyBundle {
        characterId: string; kit: PlayableCharacterKit;
        hp: number; hpMax: number; mechanicState: unknown;
        basicLevel: number; skillLevel: number; ultimateLevel: number; introLevel: number; forteLevel: number;
        constellation: number; solaceStats: any;
      }
      const roster: ResolvedRoster = resolveRoster(user);
      const allyBundles: Partial<Record<PositionIndex, AllyBundle>> = {};
      for (const pos of [1, 2, 3] as PositionIndex[]) {
        const val = pos === 1 ? roster.position1 : pos === 2 ? roster.position2 : roster.position3;
        if (val === null || val === "self") continue;
        const kit = CHARACTER_KITS[val];
        if (!kit) continue;
        const progress = await prisma.characterProgress.findUnique({ where: { userId_characterId: { userId: interaction.user.id, characterId: val } } });
        if (!progress) continue; // shouldn't happen if /team validated ownership, but guard anyway
        const solaceStats = await kit.resolveStats(interaction.user.id);
        const hpMax = kit.statsAtLevel(90).hpMax;
        allyBundles[pos] = {
          characterId: val, kit, hp: hpMax, hpMax, mechanicState: kit.createInitialMechanicState(),
          basicLevel: progress.basicLevel, skillLevel: progress.skillLevel, ultimateLevel: progress.ultimateLevel,
          introLevel: progress.introLevel, forteLevel: progress.forteLevel, constellation: progress.constellation,
          solaceStats,
        };
      }
      // `hasSolace`/`isDevGuild` are legacy names — now mean "roster has ≥1 non-self filled position".
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

      // Resyncs the legacy `ally*` variables above from whichever bundle
      // `activeUnit` currently points to — keeps every existing per-character
      // dispatch branch (Kaelith/Vesper/Rilo/Solace) working unchanged, since
      // they only ever read these variable names, not `activeUnit` directly.
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
      // Writes mutated allyHp/allyMechanicState back into the bundle — call
      // right before the KO-check each turn, since the turn's damage/mechanic
      // branches only mutate the local copy, not the bundle object itself.
      function commitActiveBundle() {
        const b = allyBundles[activeUnit];
        if (b) { b.hp = allyHp; b.mechanicState = allyMechanicState; }
      }
      function currentPositionHp(pos: PositionIndex): number {
        return posValue(pos) === "self" ? state.playerHp : (allyBundles[pos]?.hp ?? 0);
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
      syncActiveBundle();

      let concertoEnergy: number = 0;
      let playerDebuffs: DebuffState = [];
      let attunement: AttunementState = { mode: null };
      let attunementDoubleTurnsLeft = 0;
      let solaceForte: ForteState = { phase: 0, charge: 0 };
      let forteEmpoweredTurnsLeft = 0;

      function teamStatusLine(): string {
        if (!hasSolace) return "";
        const benchedLines = ([1, 2, 3] as PositionIndex[])
          .filter(p => p !== activeUnit && posValue(p) !== null)
          .map(p => {
            if (posValue(p) === "self") return `${displayName} — ${state.playerHp}/${state.playerHpMax} HP`;
            const b = allyBundles[p];
            if (!b) return null;
            return `${b.kit.label} — ${b.hp}/${b.hpMax} HP  ·  ${b.kit.statusLineText(b.mechanicState)}`;
          })
          .filter((x): x is string => x !== null);
        if (benchedLines.length === 0) return "";
        const debuffLine = playerDebuffs.length > 0
          ? `  ·  ${playerDebuffs.map(d => `${d.type} (${d.turnsLeft})`).join(", ")}`
          : "";
        return `\n\n🔄 Benched: ${benchedLines.join("  |  ")}\n` +
               `Concerto Energy: **${concertoEnergy}/100**${debuffLine}`;
      }

      function teamButtonContext(): TeamButtonContext {
        const targets = swappableTargets(roster, activeUnit).map(pos => ({
          pos,
          label: positionLabel(roster, pos, displayName, (id) => CHARACTER_KITS[id]?.label ?? null),
        }));
        return {
          isDevGuild: hasSolace, isPlayerActiveNow: isPlayerActive(), displayName, attunement, concertoEnergy,
          activeAllyCharacterId, allyLabel: allyKit?.label ?? "Ally", swapTargets: targets,
        };
      }

      const ENERGY_PER_TURN = Math.floor(stats.energyPerTurn);

      // Named Echo Set per-fight state (all sets — no-op unless bonuses.activeNamedSetId matches)
      const namedState = initNamedSetState();
      let glacioShieldTurnsLeft  = 0;   // Frostveil Bastion 5pc — elem DMG buff duration
      let glacioShieldElemBonus  = 0;   // active elem DMG bonus while shield buff is up
      let riloDefBuffTurnsLeft   = 0;   // Rilo C1's Outro DEF buff on whoever swaps in
      let riloDefBuffPct         = 0;
      let stormBuffTurnsLeft     = 0;   // Stormcaller's Oath 4pc — crit rate buff duration
      let stormBuffCritBonus     = 0;   // active crit rate bonus while post-ult buff is up
      let havocFrenzyAtkMult     = 1.0; // Voidborn Remnant 5pc — active buff values while frenzyActive
      let havocFrenzyLifesteal   = 0;
      let havocFrenzyDefIgnore   = 0;

      // Echo Skill — granted by the Main-slot echo, own cooldown separate from Resonance Skill
      const ECHO_SKILL_COOLDOWN = 4;
      let echoSkillCooldown     = 0;
      let enemyDefShredTurnsLeft = 0;
      let enemyDefShredPct       = 0;
      let nextAttackCritArmed    = false;

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
        lastMove:      `${boss.name} stirs from its defeated slumber. The challenge begins.`,
        isShattered:   false,
        skillCooldown: 0,
      };

      // ── Opening message ──────────────────────────────────────────────────────
      await thread.send({
        embeds: [new EmbedBuilder()
          .setColor(ELEMENT_HEX[user.element] ?? 0x6366F1)
          .setTitle(`⚔️ Boss Challenge — ${boss.name}`)
          .setDescription([
            `**${boss.name}** — *${boss.title}*`,
            ``,
            `◈  Veteran scaling: **×${vScale.toFixed(2)}** (you are overleveled for this boss)`,
            `◈  Element Weakness: **${boss.weakness}** deals **1.5×** damage`,
            `◈  Shatter the Vibration Bar to stun for 1 turn`,
            `◈  Rewards: **70%** of ascension loot on win`,
          ].join("\n"))
          .setFooter({ text: "CARTETHYIA  ·  Boss Challenge" })],
      });

      // ── Cleanup helper ───────────────────────────────────────────────────────
      const cleanup = async (won: boolean) => {
        releaseLock(interaction.user.id);
        await clearFight(interaction.user.id);
        if (won) {
          const loot = {
            credits:       Math.floor(boss.defeatLoot.credits       * LOOT_MULT),
            tuningModules: Math.floor(boss.defeatLoot.tuningModules * LOOT_MULT),
            sealingTubes:  Math.floor(boss.defeatLoot.sealingTubes  * LOOT_MULT),
            forgingOres:   Math.floor(boss.defeatLoot.forgingOres   * LOOT_MULT),
            paradoxCores:  Math.floor(boss.defeatLoot.paradoxCores  * LOOT_MULT),
            resonanceExp:  Math.floor(boss.defeatLoot.resonanceExp  * LOOT_MULT),
            fractonite:    Math.floor(boss.defeatLoot.fractonite     * LOOT_MULT),
          };
          await awardUser(interaction.user.id, loot, "boss");
          const lvlResult  = await checkLevelUp(interaction.user.id);
          const evoLine    = await trackEvolutionProgress(interaction.user.id, { kind: "boss", worldLevel: boss.worldLevel }).catch(() => null);
          const bondResult = await incrementWeaponBond(interaction.user.id).catch(() => null);
          await thread.send({
            embeds: [new EmbedBuilder()
              .setColor(0xFCD34D)
              .setTitle("✦  Boss Defeated")
              .setDescription([
                `**${boss.name}** has been put to rest again.`,
                ``,
                `**Rewards (70%):**\n${buildRewardText(loot)}` + voteNudge() + supportNudge() + await mailNudge(interaction.user.id),
                lvlResult.didLevelUp ? `\n◈ Level **${lvlResult.oldLevel}** → **${lvlResult.newLevel}**` : "",
                evoLine ? `\n${evoLine}` : "",
                bondResult ? `\n✦ Weapon Bond **${bondResult.bond}/${10}**${bondResult.milestone ? ` — *${bondResult.milestone}*` : ""}` : "",
              ].filter(Boolean).join("\n"))
              .setFooter({ text: `CARTETHYIA  ·  Boss Challenge` })],
          });
        }
        await thread.setArchived(true).catch(() => {});
      };

      // ── Battle loop ──────────────────────────────────────────────────────────
      const runTurn = async () => {
        const buttons = buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext());
        if (battleMsg) await battleMsg.edit({ components: [] }).catch(() => {});
        battleMsg = await sendBattleCard(thread as any, { ...state, ...activeCardIdentity() }, buttons, teamStatusLine());

        const collector = battleMsg.createMessageComponentCollector({
          filter: (b: ButtonInteraction | StringSelectMenuInteraction) => b.user.id === interaction.user.id,
          time: 30 * 60 * 1000,
          max:  1,
        });

        collector.on("collect", async (btn: ButtonInteraction | StringSelectMenuInteraction) => {
          await btn.deferUpdate();
          syncActiveBundle();
          const swapSelectTarget = btn.customId === "boss_swap_select" && btn.isStringSelectMenu()
            ? (Number(btn.values[0]) as PositionIndex) : null;

          let playerDmg   = 0;
          let moveName    = "";
          state.hitBadge = undefined; // cleared every turn — only Vesper's multi-hit Discharge branch sets it
          let radiantDmgMult = 1.0;
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && btn.customId !== "boss_flee") {
            const heal = radiantConvergenceOnTurnHeal(namedState, state.playerHpMax, bonuses.healingBonus);
            state.playerHp  = Math.min(state.playerHpMax, state.playerHp + heal.healAmount);
            radiantDmgMult  = heal.dmgMult;
          }

          const isWeak        = user.element === boss.weakness;
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
          // ITS OWN resolved stats — Solace's own ATK/DEF/Crit from her own
          // echoes when active, the player's own otherwise. Safe to use
          // unconditionally: activeUnit is guaranteed "player" whenever the
          // player's own branches run, so these equal stats.X there too.
          const isAllyActingOrDefending = !isPlayerActive() && allySolaceStats !== null;
          const activeAtk     = isAllyActingOrDefending ? allySolaceStats!.atk     : stats.atk;
          const activeDef     = isAllyActingOrDefending ? allySolaceStats!.def     : stats.def;
          const activeCritDmg = isAllyActingOrDefending ? allySolaceStats!.critDmg : stats.critDmg;
          const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, (isAllyActingOrDefending ? allySolaceStats!.critRate : stats.critRate) + radCrit + stormCritBuff), state.playerHp, state.playerHpMax);
          const forcedCritActive = nextAttackCritArmed && btn.customId !== "boss_flee";

          if (btn.customId === "boss_flee") {
            await thread.send({
              embeds: [new EmbedBuilder().setColor(0x334155)
                .setDescription("◈ You retreated. No rewards granted. Use **/boss** to try again.")
                .setFooter({ text: "CARTETHYIA  ·  Boss Challenge" })],
            });
            collector.stop();
            await cleanup(false);
            return;
          }

          const abilVibM   = compositeVibMult(bonuses.abilityEffects);
          const totalVibMult = vibMult * abilVibM;
          const abilCtxBase  = {
            currentHp: state.playerHp, maxHp: state.playerHpMax,
            enemyHpPct: state.bossHpNow / state.bossHpMax,
            turn: state.turn, isFirstAction: !firstActionDone,
            isWeak, isShattered: state.isShattered, v2Stacks,
          };
          let abilCrit = false;

          // Any-to-any position swap — always consumes the turn, falls
          // through to the shared tail below, same as every other action.
          if ((btn.customId === "boss_swap" || btn.customId === "boss_swap_select") && hasSolace) {
            const targets = swappableTargets(roster, activeUnit);
            const targetPos: PositionIndex | null = swapSelectTarget ?? (targets.length === 1 ? targets[0] : null);

            if (targetPos !== null) {
              const outgoingPos = activeUnit;
              const incomingPos = targetPos;
              const outgoingIsPlayer = posValue(outgoingPos) === "self";
              const incomingIsPlayer = posValue(incomingPos) === "self";
              const outgoingBundle = outgoingIsPlayer ? null : (allyBundles[outgoingPos] ?? null);
              const incomingBundle = incomingIsPlayer ? null : (allyBundles[incomingPos] ?? null);
              const outgoingCharacterId = outgoingBundle?.characterId ?? null;
              const incomingCharacterId = incomingBundle?.characterId ?? null;
              const incomingHpBefore = incomingIsPlayer ? state.playerHp : (incomingBundle?.hp ?? 0);
              const incomingHpMax = incomingIsPlayer ? state.playerHpMax : (incomingBundle?.hpMax ?? 0);

              if (incomingHpBefore > 0) {
                const incomingLabel = incomingIsPlayer ? displayName : (incomingBundle?.kit.label ?? "Ally");
                const comboReady = concertoEnergy >= 100;

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

                  moveName = actualGain > 0
                    ? `🔄 Swapped to **${incomingLabel}** — Outro+Intro combo! +${actualGain} HP.`
                    : `🔄 Swapped to **${incomingLabel}** — Outro+Intro combo! (already at full HP, no heal needed)`;
                  concertoEnergy = addConcertoEnergy(0, 20); // headstart, matches CONCERTO_INTRO_HEADSTART elsewhere
                } else {
                  moveName = `🔄 Swapped to **${incomingLabel}** — Concerto Energy not full, no combo triggered.`;
                }

                activeUnit = incomingPos;
                syncActiveBundle();
                playerDmg = 0;
              }
            }
          }

          if (btn.customId === "boss_basic") {
            const windExplosion = bonuses.activeNamedSetId === "WINDSTRIDERS_LEGACY"
              ? windstridersLegacyCheckExplosion(namedState) : { proc: false, guaranteedCrit: false, bonusMult: 1.0 };
            const isSolaceAlly = isDevGuild && activeAllyCharacterId === "solace";
            const teamAtkMult  = isSolaceAlly ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
            const teamCritBonus = isSolaceAlly ? getAttunementCritRateBonus(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 0;
            const wellspringAtkMult   = isSolaceAlly && !isPlayerActive() && allySolaceStats?.hasWellspring ? getWellspringBaseAtkMult(allySolaceStats.wellspringRefinement!) : 1;
            const wellspringAtkBonus  = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const wellspringCritBonus = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringCritRateBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const forteAtkBonus  = isSolaceAlly ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const forteCritBonus = isSolaceAlly ? getSolaceForteCritRateBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * wellspringAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const basicMoveMult = isDevGuild && !isPlayerActive() && allyKit ? allyKit.basicDamageMult(allyBasicLevel) : 1.0;
            const crit   = forcedCritActive || windExplosion.guaranteedCrit || Math.random() < Math.min(1, activeCritRate + teamCritBonus + wellspringCritBonus + forteCritBonus); abilCrit = crit;
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base   = Math.max(1, Math.floor(activeAtk * teamMult * basicMoveMult * smolderMult * havocAtkMult * (1 - defReduction)));
            const extraElemBonus = glacioShieldTurnsLeft > 0 ? glacioShieldElemBonus : 0;
            let dmg      = Math.floor(base * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus + extraElemBonus) * radiantDmgMult);
            dmg          = apply5pcFirstHit(bonuses, dmg, !firstActionDone);
            dmg          = apply5pcFullHpDmg(bonuses, dmg, state.playerHp, state.playerHpMax);
            if (roll4pcDoubleHit(bonuses)) dmg *= 2;
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
            state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_b.bonusEnergy + thunderboltEnergy);
            state.playerHp     = Math.min(state.playerHpMax, state.playerHp + ar_b.healHp);
            state.playerHp     = applyLifesteal(bonuses.lifesteal + havocLifesteal + (ar_b.lifesteal ?? 0), playerDmg, state.playerHp, state.playerHpMax);
            if (bonuses.activeNamedSetId === "STORMCALLERS_OATH") stormcallersOathCheckThunderbolt(namedState, state.playerEnergy);

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

          const isSolaceAlly = isDevGuild && activeAllyCharacterId === "solace";

          if (btn.customId === "boss_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace") {
            // Solace's Skill is Attunement — a mode cycle, not a damage move.
            attunement.mode = cycleAttunementMode(attunement.mode);
            if (allyConstellation >= 3) concertoEnergy = addConcertoEnergy(concertoEnergy, 25);
            const crit = Math.random() < activeCritRate; abilCrit = crit;
            const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
            playerDmg  = dmg;
            moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
          } else if (btn.customId === "boss_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith" && allyKit) {
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
          } else if (btn.customId === "boss_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper" && allyKit) {
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
          } else if (btn.customId === "boss_skill" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo" && allyKit) {
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
          } else if (btn.customId === "boss_skill") {
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
            state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit) + ar_s.bonusEnergy);
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

          if (btn.customId === "boss_ultimate" && !(isDevGuild && !isPlayerActive())) {
            abilCrit     = true;
            const teamAtkMult = isSolaceAlly ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(allySkillLevel), attunementDoubleTurnsLeft > 0, allyConstellation >= 6) : 1;
            const wellspringAtkBonus = isSolaceAlly && allySolaceStats?.hasWellspring ? getWellspringAtkBonus(attunement, allySolaceStats.wellspringRefinement!) : 0;
            const forteAtkBonus = isSolaceAlly ? getSolaceForteAtkBonus(allyForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const teamMult = getWeakenedMult(playerDebuffs) * teamAtkMult * (1 + wellspringAtkBonus) * (1 + forteAtkBonus);
            const smolderMult = bonuses.activeNamedSetId === "SMOLDERING_SOVEREIGN"
              ? smolderingSovereignOnAction(namedState) : 1;
            const base   = Math.max(1, Math.floor(stats.atk * teamMult * smolderMult * havocAtkMult * 3.5 * stats.critDmg * (1 - defReduction)));
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
              state.playerEnergy = Math.min(100, state.playerEnergy + surge.bonusEnergy);
              stormBuffTurnsLeft = surge.turnsLeft + 1; // +1 compensates for the same-round decrement that fires immediately after this triggers
              stormBuffCritBonus = surge.critRateBonus;
            }
          } else if (btn.customId === "boss_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace") {
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
          } else if (btn.customId === "boss_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "kaelith" && allyKit) {
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
          } else if (btn.customId === "boss_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "vesper" && allyKit) {
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
          } else if (btn.customId === "boss_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "rilo" && allyKit) {
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

          if (btn.customId === "boss_echoskill" && bonuses.echoSkill) {
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

            // NAMED_SET_TRIGGER — instantly triggers that set's own signature mechanic, bypassing its normal condition
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

            const energyGain = result.setEnergyFull ? 100 : ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit) + result.bonusEnergy;
            state.playerEnergy = result.setEnergyFull ? 100 : Math.min(100, state.playerEnergy + energyGain);
            state.playerHp     = Math.min(state.playerHpMax, state.playerHp + ar_e.healHp + result.healHp);

            let echoLifesteal = bonuses.lifesteal + havocLifesteal + (ar_e.lifesteal ?? 0);
            if (def.kind === "FLAT_LIFESTEAL") echoLifesteal += def.pct;
            state.playerHp = applyLifesteal(echoLifesteal, playerDmg, state.playerHp, state.playerHpMax);

            if (result.armsNextCrit) nextAttackCritArmed = true;
            if (result.defShredTurns > 0) {
              enemyDefShredTurnsLeft = result.defShredTurns + 1; // +1 compensates for the same-round decrement
              enemyDefShredPct = result.defShredPct;
            }
          }

          // Concerto Energy builds from combat actions, never from swapping.
          const CONCERTO_GAIN_BY_MOVE: Record<string, number> = {
            boss_basic: 10, boss_skill: 20, boss_echoskill: 20, boss_ultimate: 35,
          };
          if (isDevGuild && !convergenceUsedThisTurn) {
            let concertoGain = CONCERTO_GAIN_BY_MOVE[btn.customId] ?? 0;
            if (concertoGain > 0 && !isPlayerActive() && allySolaceStats?.hasWellspring) concertoGain += getWellspringBaseEnergyBonus(allySolaceStats.wellspringRefinement);
            if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
          }

          // V2 turn-start regen (fires each turn)
          const v2Regen = abilityV2TurnRegen(bonuses, state.playerHpMax);
          if (v2Regen.healHp > 0) state.playerHp     = Math.min(state.playerHpMax, state.playerHp + v2Regen.healHp);
          if (v2Regen.energy > 0) state.playerEnergy = Math.min(100, state.playerEnergy + v2Regen.energy);

          // SPD quick-strike — once per fight, if invested SPD clears the boss's derived SPD
          const isSolaceConvergence = btn.customId === "boss_ultimate" && isDevGuild && !isPlayerActive() && activeAllyCharacterId === "solace";
          if (!quickStrikeUsed && btn.customId !== "boss_flee" && btn.customId !== "boss_swap" && !isSolaceConvergence && hasQuickStrike(stats.spd, fightLevel)) {
            quickStrikeUsed = true;
            const bonusDmg = Math.max(1, Math.floor(stats.atk * (1 - defReduction)));
            playerDmg += bonusDmg;
            moveName  += `\n⚡ **Quick Strike** — your speed caught them off guard! +${bonusDmg} bonus DMG!`;
          }

          if (btn.customId !== "boss_swap") firstActionDone = true;
          state.bossHpNow = Math.max(0, state.bossHpNow - playerDmg);

          // Enrage check
          if (!isEnraged && state.bossHpNow / state.bossHpMax <= 0.40) {
            isEnraged = true;
            moveName += `\n🔴 **${boss.name} ENRAGES!** Veteran fury surges — it will not fall easily again!`;
          }

          // Shatter check
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
              const remnant = voidbornRemnantOnShatter();
              const bonusDmg = Math.floor(stats.atk * remnant.bonusMult);
              state.bossHpNow = Math.max(0, state.bossHpNow - bonusDmg);
              const healAmt = Math.floor(state.playerHpMax * remnant.healPct);
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + healAmt);
              moveName += `\n🌑 **Voidborn Rupture** — +${bonusDmg} bonus DMG, +${healAmt} HP!`;
            }
          }

          state.lastMove = moveName;

          // Win
          if (state.bossHpNow <= 0) {
            await sendBattleCard(thread as any, { ...state, ...activeCardIdentity(), lastMove: `${moveName} — **BOSS DEFEATED!**` }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());
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
              state.bossVibNow  = isEnraged ? Math.floor(boss.vibBar * 0.60) : boss.vibBar;
              state.lastMove   += isEnraged
                ? "\n◇ Boss breaks free — **vib bar only 60% recovered**."
                : "\n◇ Boss recovers from Shatter.";
            } else {
              state.lastMove += `\n◇ Boss stunned (${shatterTurnsLeft} turn left).`;
            }
          } else {
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
            let bossDmg   = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - activeDef * attunementDefMult * 0.4));
            bossDmg       = roll4pcBlock(bonuses, bossDmg);
            const shield  = elemFrostShield(bonuses.elementPassive, bossDmg);
            bossDmg       = shield.dmg;
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
                glacioShieldTurnsLeft = panic.turnsLeft + 1; // +1 compensates for the same-round decrement that fires immediately after this triggers
                glacioShieldElemBonus = panic.elemDmgBonus;
                state.lastMove += `\n❄️ **Frostveil Shield** — +${panic.shieldAmount} HP, +${Math.floor(panic.elemDmgBonus * 100)}% Glacio DMG for ${panic.turnsLeft} turns!`;
              }
            }
            const hpRegen  = get5pcHpRegen(bonuses, state.playerHpMax);
            if (hpRegen > 0 && typeof bonuses.set5pc?.value === "number" && bonuses.set5pc.value < 1) {
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + hpRegen);
            }
            const radRegen = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
            if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
            state.lastMove += `\n◇ ${boss.name} ${move.effect} — **${bossDmg} DMG**${isEnraged ? " 🔴" : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
            state.playerEnergy = Math.min(100, state.playerEnergy + 15);

            // Milestone 3b: exercises the debuff system inside a real fight.
            // 25% chance per enemy attack, only when the player has actually
            // opted into team mechanics via /team (Milestone 3.5a) — was
            // isDevGuild-only, which meant every dev-guild player took this
            // debuff regardless of whether they'd ever touched Solace.
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
          if (forcedCritActive && btn.customId !== "boss_swap") nextAttackCritArmed = false;

          // Write mutated ally state back into the bundle before checking KO.
          commitActiveBundle();

          // Active position KO'd — fall back to the next living position in
          // order (wraps 1->2->3->1), generalizing the old "ally KO'd, swap
          // back to player" rule to any-to-any.
          if (isDevGuild && currentPositionHp(activeUnit) <= 0) {
            const fallback = nextAliveFallback(roster, activeUnit, currentPositionHp);
            if (fallback !== null) {
              const koLabel = positionLabel(roster, activeUnit, displayName, (id) => CHARACTER_KITS[id]?.label ?? null);
              activeUnit = fallback;
              syncActiveBundle();
              const fallbackLabel = positionLabel(roster, fallback, displayName, (id) => CHARACTER_KITS[id]?.label ?? null);
              state.lastMove += `\n◇ **${koLabel} was knocked out** — swapped to ${fallbackLabel}.`;
            }
          }

          // Second Wind — only ever saves the player's own life, not a benched ally's.
          if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
            secondWindUsed = true;
            state.playerHp = 1;
            state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
          }

          // Lose — every filled position has been knocked out.
          if (isTeamWiped(roster, currentPositionHp)) {
            await sendBattleCard(thread as any, { ...state, ...activeCardIdentity(), lastMove: state.lastMove + " — **YOU FELL.**" }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());
            await thread.send({
              embeds: [new EmbedBuilder().setColor(0x334155)
                .setDescription(`◈ Defeated by **${boss.name}**.\nNo cooldown set — use **/boss** to try again.`)
                .setFooter({ text: "CARTETHYIA  ·  Boss Challenge" })],
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
                .setDescription("◈ Fight timed out. No cooldown set.")
                .setFooter({ text: "CARTETHYIA  ·  Boss Challenge" })],
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
        releaseLock(interaction.user.id);  // never picked — free the lock
        await interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  },
};

export default command;
export const { data, execute } = command;
