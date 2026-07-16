import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, PermissionFlagsBits,
  TextChannel, ThreadChannel, StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { Command } from "../../types";
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
  SOLACE, SOLACE_ULTIMATE_DOUBLE_TURNS, PLAYER_SELF_INTRO, PLAYER_SELF_OUTRO,
  SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC, SOLACE_FORTE_EMPOWERED_TURNS,
  getSolaceForteAtkBonus, getSolaceForteCritRateBonus, getSolaceForteDefBonus,
  solaceIntroEffect, solaceBasicDamageMult, solaceAttunementAtkCritBonus,
  solaceAttunementDefBonus, solaceConvergenceHealPct, resolveSolaceStats,
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

const LOOT_MULT      = 0.70;               // 70% of ascension loot
const SKILL_COOLDOWN = 3;

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

  if (team?.isDevGuild) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("boss_swap")
        .setLabel(team.activeUnit === "player" ? `🔄  Swap to ${SOLACE.name}` : `🔄  Swap to ${team.displayName}`)
        .setStyle(ButtonStyle.Secondary),
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

      // ── Milestone 3b: team state (dev guild only) ─────────────────────────────
      // Milestone 3.5a: also requires the player to have actually picked
      // Solace via /team, not just being in the dev guild.
      const isDevGuild = interaction.guildId === process.env.GUILD_ID;
      const hasSolace = isDevGuild && user.teamAllyCharacterId === "solace";
      const solaceProgress = hasSolace ? await getOrCreateCharacterProgress(interaction.user.id, "solace") : null;
      // Milestone 3.5b: her own resolved stats (her base + HER OWN echoes/weapon),
      // fetched once for the whole fight — bonuses don't change mid-fight.
      const allySolaceStats = hasSolace ? await resolveSolaceStats(interaction.user.id) : null;
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
        // Milestone 3.5a: gate button visibility on hasSolace (owns + selected
        // her via /team), not just isDevGuild — the field is still named
        // isDevGuild in TeamButtonContext (defined once, shared shape), but
        // the VALUE passed here is the narrower gate.
        return { isDevGuild: hasSolace, activeUnit, displayName, attunement, concertoEnergy };
      }

      const ENERGY_PER_TURN = Math.floor(stats.energyPerTurn);

      // Named Echo Set per-fight state (all sets — no-op unless bonuses.activeNamedSetId matches)
      const namedState = initNamedSetState();
      let glacioShieldTurnsLeft  = 0;   // Frostveil Bastion 5pc — elem DMG buff duration
      let glacioShieldElemBonus  = 0;   // active elem DMG bonus while shield buff is up
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
        battleMsg = await sendBattleCard(thread as any, state, buttons, teamStatusLine());

        const collector = battleMsg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
          time: 30 * 60 * 1000,
          max:  1,
        });

        collector.on("collect", async (btn: ButtonInteraction) => {
          await btn.deferUpdate();

          let playerDmg   = 0;
          let moveName    = "";
          let radiantDmgMult = 1.0;
          if (bonuses.activeNamedSetId === "RADIANT_CONVERGENCE" && btn.customId !== "boss_flee") {
            const heal = radiantConvergenceOnTurnHeal(namedState, state.playerHpMax);
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
          const isAllyActingOrDefending = activeUnit === "ally" && allySolaceStats !== null;
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

          // Milestone 3b: swap — always consumes the turn, falls through to the
          // shared tail below (Win-check/Boss-turn/decrements/Lose-check/next
          // turn), same as every other action. Ported from encounter.ts's
          // Milestone 1/2a swap handler.
          if (btn.customId === "boss_swap" && hasSolace) {
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

          if (btn.customId === "boss_basic") {
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

            // Forte fills only from Solace's own Chime Strike — announce only
            // on the turn a threshold is actually crossed.
            if (isDevGuild && activeUnit === "ally") {
              const forteBefore = solaceForte;
              solaceForte = addForteCharge(solaceForte, SOLACE_FORTE_CONFIG, SOLACE_FORTE_GAIN_PER_BASIC);
              const wasHalf = forteBefore.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2;
              const isHalf  = solaceForte.charge >= SOLACE_FORTE_CONFIG.phaseThresholds[0] / 2 && !isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG);
              if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG) && !isForteMaxed(forteBefore, SOLACE_FORTE_CONFIG)) {
                moveName += `\n✨ Forte is **FULLY CHARGED** — next Convergence will be Empowered!`;
              } else if (isHalf && !wasHalf) {
                moveName += `\n✨ Forte is **HALF CHARGED**.`;
              }
            }
          }

          if (btn.customId === "boss_skill" && isDevGuild && activeUnit === "ally") {
            // Solace's Skill is Attunement — a mode cycle, not a damage move.
            attunement.mode = cycleAttunementMode(attunement.mode);
            const crit = Math.random() < activeCritRate; abilCrit = crit;
            const dmg  = Math.max(1, Math.floor(activeAtk * 0.6 * (1 - defReduction) * (crit ? activeCritDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus)));
            playerDmg  = dmg;
            moveName   = `✦ Attunement — now in **${attunement.mode}** mode! ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            state.bossVibNow = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
          } else if (btn.customId === "boss_skill") {
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

          if (btn.customId === "boss_ultimate" && !(isDevGuild && activeUnit === "ally")) {
            abilCrit     = true;
            const teamAtkMult = isDevGuild ? getAttunementAtkMult(attunement, solaceAttunementAtkCritBonus(solaceSkillLevel), attunementDoubleTurnsLeft > 0) : 1;
            const wellspringAtkBonus = isDevGuild ? getWellspringAtkBonus(attunement) : 0;
            const forteAtkBonus = isDevGuild ? getSolaceForteAtkBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
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
          } else if (btn.customId === "boss_ultimate" && isDevGuild && activeUnit === "ally") {
            // Solace's Ultimate spends Concerto Energy, not personal Energy.
            const healPct = solaceConvergenceHealPct(solaceUltimateLevel);
            const healResult = resolveIntroOutroEffect({ actions: [
              { type: "HEAL_ALLY", value: healPct },
              { type: "CLEANSE_ALLY", value: 1 },
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

            const healSummary = `${displayName} +${actualHealPlayer} HP, ${SOLACE.name} +${actualHealAlly} HP`;

            if (isForteMaxed(solaceForte, SOLACE_FORTE_CONFIG)) {
              forteEmpoweredTurnsLeft = SOLACE_FORTE_EMPOWERED_TURNS + 1; // +1 compensates for the same-round decrement
              attunementDoubleTurnsLeft = 0;
              solaceForte = resetForte();
              moveName = `⚡ **Empowered Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
                `**all 3 Attunement Modes empowered for ${SOLACE_FORTE_EMPOWERED_TURNS} turns!**`;
            } else {
              attunementDoubleTurnsLeft = SOLACE_ULTIMATE_DOUBLE_TURNS + 1; // +1 compensates for the same-round decrement
              forteEmpoweredTurnsLeft = 0;
              moveName = `⚡ **Convergence!** Team healed (${healSummary}), debuffs cleansed, ` +
                `**${attunement.mode ?? "no"} mode doubled for ${SOLACE_ULTIMATE_DOUBLE_TURNS} turns!**`;
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
            if (concertoGain > 0 && activeUnit === "ally") concertoGain += WELLSPRING_BASE_ENERGY_BONUS;
            if (concertoGain > 0) concertoEnergy = addConcertoEnergy(concertoEnergy, concertoGain);
          }

          // V2 turn-start regen (fires each turn)
          const v2Regen = abilityV2TurnRegen(bonuses, state.playerHpMax);
          if (v2Regen.healHp > 0) state.playerHp     = Math.min(state.playerHpMax, state.playerHp + v2Regen.healHp);
          if (v2Regen.energy > 0) state.playerEnergy = Math.min(100, state.playerEnergy + v2Regen.energy);

          // SPD quick-strike — once per fight, if invested SPD clears the boss's derived SPD
          const isSolaceConvergence = btn.customId === "boss_ultimate" && isDevGuild && activeUnit === "ally";
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
            await sendBattleCard(thread as any, { ...state, lastMove: `${moveName} — **BOSS DEFEATED!**` }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());
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
            const wellspringDefBonus = isDevGuild ? getWellspringDefBonus(attunement) : 0;
            const forteDefBonus = isDevGuild ? getSolaceForteDefBonus(solaceForteLevel, forteEmpoweredTurnsLeft > 0) : 0;
            const attunementDefBonus = solaceAttunementDefBonus(solaceSkillLevel);
            const attunementDefMult = (isDevGuild ? getAttunementDefMult(attunement, attunementDefBonus, attunementDoubleTurnsLeft > 0) : 1) * (1 + wellspringDefBonus) * (1 + forteDefBonus);
            let bossDmg   = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - activeDef * attunementDefMult * 0.4));
            bossDmg       = roll4pcBlock(bonuses, bossDmg);
            const shield  = elemFrostShield(bonuses.elementPassive, bossDmg);
            bossDmg       = shield.dmg;
            const allyIsActive = isDevGuild && activeUnit === "ally";
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
          if (isDevGuild && attunementDoubleTurnsLeft > 0) attunementDoubleTurnsLeft--;
          if (isDevGuild && forteEmpoweredTurnsLeft > 0) forteEmpoweredTurnsLeft--;
          if (forcedCritActive && btn.customId !== "boss_swap") nextAttackCritArmed = false;

          // Ally KO'd — auto-swap back to the player rather than ending the
          // fight over a benched unit's HP.
          if (isDevGuild && activeUnit === "ally" && allyHp <= 0) {
            allyHp = 0;
            activeUnit = "player";
            state.lastMove += `\n◇ **${SOLACE.name} was knocked out** — swapped back to ${displayName}.`;
          }

          // Second Wind
          if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
            secondWindUsed = true;
            state.playerHp = 1;
            state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
          }

          // Lose
          if (state.playerHp <= 0) {
            state.playerHp = 0;
            await sendBattleCard(thread as any, { ...state, lastMove: state.lastMove + " — **YOU FELL.**" }, buildButtons(state, bonuses.echoSkill ? { name: bonuses.echoSkill.name, cooldown: echoSkillCooldown } : null, teamButtonContext()), teamStatusLine());
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
