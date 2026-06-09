import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, PermissionFlagsBits,
  TextChannel, ThreadChannel, StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, awardUser, isOnDispatch } from "../../lib/economy";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { checkLevelUp } from "../../lib/progression";
import { BOSSES, getBoss, veteranScale } from "../../lib/bosses";
import { gearAwareScale, baselineAtk, buildRewardText } from "../../lib/combat";
import { generateBattleCard, BattleCardState } from "../../lib/battleCard";
import {
  resolvePlayerBonuses, applyBonuses,
  apply4pcSkillBonus, apply4pcUltBonus, roll4pcDoubleHit, roll4pcBlock,
  apply5pcLowHpCrit, apply5pcFirstHit, apply5pcFullHpDmg,
  get5pcVibDrainMult, get5pcHpRegen, applyLifesteal,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit,
} from "../../lib/setBonus";
import {
  compositeDamageMult, compositeVibMult, compositeHealOnHit,
  compositeEnergyOnHit, compositeHasSecondWind,
} from "../../lib/abilityEffects";
import { computeAura, consumeAura, auraBar, fmtAuraRegen, MAX_AURA } from "../../lib/aura";

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
  buttons: ActionRowBuilder<ButtonBuilder>,
) {
  const buffer = await generateBattleCard(state);
  const attach = new AttachmentBuilder(buffer, { name: "battle.png" });
  const embed  = new EmbedBuilder()
    .setColor(ELEMENT_HEX[state.playerElement] ?? 0x6366F1)
    .setImage("attachment://battle.png");
  return thread.send({ embeds: [embed], files: [attach], components: [buttons] });
}

function buildButtons(state: BattleCardState): ActionRowBuilder<ButtonBuilder> {
  const skillReady = state.skillCooldown === 0;
  const ultReady   = state.playerEnergy >= 100;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("boss_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("boss_skill")
      .setLabel(skillReady ? "✦  Resonance Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
      .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
    new ButtonBuilder()
      .setCustomId("boss_ultimate").setLabel("⚡  Ultimate")
      .setStyle(ButtonStyle.Success).setDisabled(!ultReady),
    new ButtonBuilder().setCustomId("boss_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
  );
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
    const auraState = computeAura(user.resonanceAura ?? MAX_AURA, user.auraUpdatedAt ?? new Date());
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

    if (await isOnDispatch(interaction.user.id)) {
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
          `**Resonance Aura:** ${auraBar(auraState.current)}  ${auraState.current}/${MAX_AURA}` +
          (auraState.current < MAX_AURA ? `  ·  next in **${fmtAuraRegen(auraState.nextRegenMs)}**` : "") + `\n\n` +
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
      const freshAura = computeAura(user.resonanceAura ?? MAX_AURA, user.auraUpdatedAt ?? new Date());
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
      const fightLevel  = user.level;
      const gearRatio   = stats.atk / baselineAtk(fightLevel);
      const vScale      = veteranScale(fightLevel, wl);
      const scaledBase  = {
        hp:  Math.floor(boss.baseHp  * vScale),
        atk: Math.floor(boss.baseAtk * vScale),
        def: Math.floor(boss.baseDef * vScale),
      };
      const scaled = gearAwareScale(scaledBase, fightLevel, boss.worldLevel, gearRatio);

      // ── State ────────────────────────────────────────────────────────────────
      let firstSkillUsed  = false;
      let firstActionDone = false;
      let secondWindUsed  = false;
      let isEnraged       = false;
      let shatterTurnsLeft = 0;
      let battleMsg: any   = null;

      const ENERGY_PER_TURN = Math.floor(stats.energyPerTurn);

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
          // 1–3 Fracture Keys based on world level (WL0-2 → 1, WL3-5 → 2, WL6+ → 3)
          const bossKeys = boss.worldLevel >= 6 ? 3 : boss.worldLevel >= 3 ? 2 : 1;
          const loot = {
            credits:       Math.floor(boss.defeatLoot.credits       * LOOT_MULT),
            tuningModules: Math.floor(boss.defeatLoot.tuningModules * LOOT_MULT),
            sealingTubes:  Math.floor(boss.defeatLoot.sealingTubes  * LOOT_MULT),
            forgingOres:   Math.floor(boss.defeatLoot.forgingOres   * LOOT_MULT),
            paradoxCores:  Math.floor(boss.defeatLoot.paradoxCores  * LOOT_MULT),
            resonanceExp:  Math.floor(boss.defeatLoot.resonanceExp  * LOOT_MULT),
            fractureKeys:  bossKeys,
          };
          await awardUser(interaction.user.id, loot);
          const lvlResult = await checkLevelUp(interaction.user.id);
          await thread.send({
            embeds: [new EmbedBuilder()
              .setColor(0xFCD34D)
              .setTitle("✦  Boss Defeated")
              .setDescription([
                `**${boss.name}** has been put to rest again.`,
                ``,
                `**Rewards (70%):**\n${buildRewardText(loot)}`,
                lvlResult.didLevelUp ? `\n◈ Level **${lvlResult.oldLevel}** → **${lvlResult.newLevel}**` : "",
              ].filter(Boolean).join("\n"))
              .setFooter({ text: `CARTETHYIA  ·  Boss Challenge` })],
          });
        }
        await thread.setArchived(true).catch(() => {});
      };

      // ── Battle loop ──────────────────────────────────────────────────────────
      const runTurn = async () => {
        const buttons = buildButtons(state);
        if (battleMsg) await battleMsg.edit({ components: [] }).catch(() => {});
        battleMsg = await sendBattleCard(thread as any, state, buttons);

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

          const isWeak        = user.element === boss.weakness;
          const defVal        = state.isShattered ? 0 : scaled.def;
          const vibMult       = get5pcVibDrainMult(bonuses);
          const radCrit       = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
          const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, stats.critRate + radCrit), state.playerHp, state.playerHpMax);

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
          };
          let abilCrit = false;

          if (btn.customId === "boss_basic") {
            const crit   = Math.random() < activeCritRate; abilCrit = crit;
            const base   = Math.max(1, stats.atk - defVal);
            let dmg      = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            dmg          = apply5pcFirstHit(bonuses, dmg, !firstActionDone);
            dmg          = apply5pcFullHpDmg(bonuses, dmg, state.playerHp, state.playerHpMax);
            if (roll4pcDoubleHit(bonuses)) dmg *= 2;
            dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "BASIC"));
            const am     = compositeDamageMult(bonuses.abilityEffects, { ...abilCtxBase, moveType: "BASIC" });
            dmg          = Math.floor(dmg * am.mult);
            const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
            playerDmg    = dmg + ignite.dmg;
            moveName     = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
            if (am.tags.length) moveName += `  ✦${am.tags.join("·")}`;
            if (ignite.tag)     moveName += `  ✦${ignite.tag}`;
            state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
            state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit));
            state.playerHp     = applyLifesteal(bonuses.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
          }

          if (btn.customId === "boss_skill") {
            const crit   = Math.random() < Math.min(1, activeCritRate + 0.1); abilCrit = crit;
            const base   = Math.max(1, stats.atk * 1.8 - defVal);
            let dmg      = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            dmg          = apply4pcSkillBonus(bonuses, dmg, !firstSkillUsed);
            dmg          = apply5pcFirstHit(bonuses, dmg, !firstActionDone);
            dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
            const am     = compositeDamageMult(bonuses.abilityEffects, { ...abilCtxBase, moveType: "SKILL" });
            dmg          = Math.floor(dmg * am.mult);
            const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
            playerDmg    = dmg + ignite.dmg;
            moveName     = `Resonance Skill — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            if (am.tags.length)  moveName += `  ✦${am.tags.join("·")}`;
            if (ignite.tag)      moveName += `  ✦${ignite.tag}`;
            state.bossVibNow    = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.6 * totalVibMult));
            state.skillCooldown = SKILL_COOLDOWN;
            state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit));
            state.playerHp      = applyLifesteal(bonuses.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
            firstSkillUsed = true;
          }

          if (btn.customId === "boss_ultimate") {
            abilCrit     = true;
            const base   = Math.max(1, stats.atk * 3.5 - defVal);
            let dmg      = Math.floor(base * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            dmg          = apply4pcUltBonus(bonuses, dmg);
            const am     = compositeDamageMult(bonuses.abilityEffects, { ...abilCtxBase, moveType: "ULT" });
            dmg          = Math.floor(dmg * am.mult);
            playerDmg    = dmg;
            moveName     = `⚡ ULTIMATE — ${playerDmg} DMG`;
            if (am.tags.length) moveName += `  ✦${am.tags.join("·")}`;
            state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.8 * totalVibMult));
            state.playerEnergy = 0;
            state.playerHp     = applyLifesteal(bonuses.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
            if (bonuses.set5pc?.type === "POST_ULT_SKILL") state.skillCooldown = 0;
          }

          if (playerDmg > 0) {
            const healHp = compositeHealOnHit(bonuses.abilityEffects, abilCrit, state.playerHpMax);
            const enRgy  = compositeEnergyOnHit(bonuses.abilityEffects, abilCrit);
            if (healHp > 0) state.playerHp     = Math.min(state.playerHpMax, state.playerHp + healHp);
            if (enRgy  > 0) state.playerEnergy = Math.min(100, state.playerEnergy + enRgy);
          }

          firstActionDone = true;
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
          }

          state.lastMove = moveName;

          // Win
          if (state.bossHpNow <= 0) {
            await sendBattleCard(thread as any, { ...state, lastMove: `${moveName} — **BOSS DEFEATED!**` }, buildButtons(state));
            collector.stop();
            await cleanup(true);
            return;
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
            let bossDmg   = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - stats.def * 0.4));
            bossDmg       = roll4pcBlock(bonuses, bossDmg);
            const shield  = elemFrostShield(bonuses.elementPassive, bossDmg);
            bossDmg       = shield.dmg;
            state.playerHp = Math.max(0, state.playerHp - bossDmg);
            const hpRegen  = get5pcHpRegen(bonuses, state.playerHpMax);
            if (hpRegen > 0 && typeof bonuses.set5pc?.value === "number" && bonuses.set5pc.value < 1) {
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + hpRegen);
            }
            const radRegen = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
            if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
            state.lastMove += `\n◇ ${boss.name} ${move.effect} — **${bossDmg} DMG**${isEnraged ? " 🔴" : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
            state.playerEnergy = Math.min(100, state.playerEnergy + 15);
          }

          state.turn++;
          if (state.skillCooldown > 0) state.skillCooldown--;

          // Second Wind
          if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
            secondWindUsed = true;
            state.playerHp = 1;
            state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
          }

          // Lose
          if (state.playerHp <= 0) {
            state.playerHp = 0;
            await sendBattleCard(thread as any, { ...state, lastMove: state.lastMove + " — **YOU FELL.**" }, buildButtons(state));
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
