import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, PermissionFlagsBits,
  TextChannel, ThreadChannel,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, awardUser, isOnDispatch } from "../../lib/economy";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { WORLD_LEVEL_CAPS, checkLevelUp } from "../../lib/progression";
import { getBoss, scaledBoss } from "../../lib/bosses";
import { gearAwareScale, baselineAtk } from "../../lib/combat";
import { generateBattleCard, BattleCardState } from "../../lib/battleCard";
import { generateUniqueAbility } from "../../lib/uniqueAbility";
import { resolvePlayerBonuses, applyBonuses, apply4pcSkillBonus, apply4pcUltBonus, roll4pcDoubleHit, roll4pcBlock, apply5pcLowHpCrit, apply5pcFirstHit, apply5pcFullHpDmg, get5pcVibDrainMult, get5pcHpRegen, applyLifesteal, elemIgniteProc, elemFrostShield, elemDischargeEnergy, elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit } from "../../lib/setBonus";
import { compositeDamageMult, compositeVibMult, compositeHealOnHit, compositeEnergyOnHit, compositeHasSecondWind, formatEffects, sanitizeEffects } from "../../lib/abilityEffects";
import { generateAbilityCard } from "../../lib/abilityCard";
import prisma from "../../lib/prisma";

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
  buttons: ActionRowBuilder<ButtonBuilder>
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
    new ButtonBuilder()
      .setCustomId("battle_flee")
      .setLabel("🚪  Flee")
      .setStyle(ButtonStyle.Danger),
  );
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
    if (await isOnDispatch(interaction.user.id)) {
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
    let secondWindUsed = false;
    let isEnraged      = false;
    const ENERGY_PER_TURN_ASCEND = Math.floor(stats.energyPerTurn);

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

    const runTurn = async () => {
      const buttons = buildButtons(state);
      if (battleMsg) {
        // Edit previous message — remove old buttons
        await battleMsg.edit({ components: [] }).catch(() => {});
      }
      battleMsg = await sendBattleCard(thread as any, state, buttons);

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

        const isWeak   = user.element === boss.weakness;
        const defVal   = state.isShattered ? 0 : scaled.def;
        const vibMult  = get5pcVibDrainMult(bonuses);
        const radCrit       = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
        const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, stats.critRate + radCrit), state.playerHp, state.playerHpMax);

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
        };
        let abilCrit = false;

        if (btn.customId === "battle_basic") {
          const crit   = Math.random() < activeCritRate; abilCrit = crit;
          const base   = Math.max(1, stats.atk - defVal);
          let dmg      = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
          dmg          = apply5pcFirstHit(bonuses, dmg, !firstActionDone);
          dmg          = apply5pcFullHpDmg(bonuses, dmg, state.playerHp, state.playerHpMax);
          if (roll4pcDoubleHit(bonuses)) { dmg *= 2; }
          dmg          = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "BASIC"));
          const am     = compositeDamageMult(bonuses.abilityEffects, { ...abilCtxBase, moveType: "BASIC" });
          dmg          = Math.floor(dmg * am.mult);
          const ignite = elemIgniteProc(bonuses.elementPassive, stats.atk);
          playerDmg    = dmg + ignite.dmg;
          moveName     = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
          if (am.tags.length) moveName += `  ✦${am.tags.join("·")}`;
          if (ignite.tag) moveName += `  ✦${ignite.tag}`;
          state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
          state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN_ASCEND + elemDischargeEnergy(bonuses.elementPassive, crit));
          state.playerHp     = applyLifesteal(bonuses.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
        }

        if (btn.customId === "battle_skill") {
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
          if (am.tags.length) moveName += `  ✦${am.tags.join("·")}`;
          if (ignite.tag) moveName += `  ✦${ignite.tag}`;
          state.bossVibNow    = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.6 * totalVibMult));
          state.skillCooldown = SKILL_COOLDOWN;
          state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN_ASCEND + elemDischargeEnergy(bonuses.elementPassive, crit));
          state.playerHp      = applyLifesteal(bonuses.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
          firstSkillUsed = true;
        }

        if (btn.customId === "battle_ultimate") {
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

        // Ability on-hit effects (heal on crit, crit momentum energy)
        if (playerDmg > 0) {
          const healHp = compositeHealOnHit(bonuses.abilityEffects, abilCrit, state.playerHpMax);
          const enRgy  = compositeEnergyOnHit(bonuses.abilityEffects, abilCrit);
          if (healHp > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + healHp);
          if (enRgy  > 0) state.playerEnergy = Math.min(100, state.playerEnergy + enRgy);
        }

        firstActionDone = true;
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
        }

        state.lastMove = moveName;

        // ── Win check ─────────────────────────────────────────────────────────
        if (state.bossHpNow <= 0) {
          await sendBattleCard(thread as any, { ...state, lastMove: `${moveName} — **BOSS DEFEATED!**` }, buildButtons(state));

          const isFirstAscension = user.worldLevel === 0;
          const newWL            = Math.min(user.worldLevel + 1, 8);
          const newCap           = WORLD_LEVEL_CAPS[newWL] ?? 90;

          // Award loot + raise WL
          await awardUser(interaction.user.id, boss.defeatLoot);
          await prisma.user.update({
            where: { id: interaction.user.id },
            data:  { worldLevel: { increment: 1 }, ascensionWins: { increment: 1 }, fractureKeys: { increment: 2 } },
          });

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

            const ability = await generateUniqueAbility(interaction.user.id);

            await generatingMsg.delete().catch(() => {});

            if (ability) {
              // Read the persisted composite effects for the reveal card
              const me = await prisma.user.findUnique({
                where:  { id: interaction.user.id },
                select: { uniqueAbilityEffects: true },
              });
              const effList = formatEffects(sanitizeEffects(me?.uniqueAbilityEffects)).split("\n").filter(Boolean);

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
                  .setImage("attachment://ability.png")
                  .setDescription(`**${ability.name}** — *${ability.effect}*`)
                  .setFooter({ text: "CARTETHYIA  ·  This ability is yours alone." })],
                files: [new AttachmentBuilder(abilityCardBuf, { name: "ability.png" })],
              });
            }
          }

          collector.stop();
          await cleanup(true);
          return;
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
          let bossDmg     = Math.max(1, Math.floor(scaled.atk * move.damage * enrageMult - stats.def * 0.4));
          bossDmg         = roll4pcBlock(bonuses, bossDmg);
          const shield    = elemFrostShield(bonuses.elementPassive, bossDmg);
          bossDmg         = shield.dmg;
          state.playerHp  = Math.max(0, state.playerHp - bossDmg);
          const hpRegen   = get5pcHpRegen(bonuses, state.playerHpMax);
          if (hpRegen > 0 && typeof bonuses.set5pc?.value === "number" && bonuses.set5pc.value < 1) {
            state.playerHp = Math.min(state.playerHpMax, state.playerHp + hpRegen);
          }
          const radRegen  = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
          if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
          state.lastMove += `\n◇ ${boss.name} ${move.effect} — **${bossDmg} DMG**${isEnraged ? " 🔴" : ""}${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
          state.playerEnergy = Math.min(100, state.playerEnergy + 15);
        }

        state.turn++;
        if (state.skillCooldown > 0) state.skillCooldown--;

        // ── Second Wind — survive a lethal blow once ──────────────────────────
        if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
          secondWindUsed = true;
          state.playerHp = 1;
          state.lastMove += `\n✦ **UNDYING WILL** — you cling to life at 1 HP!`;
        }

        // ── Lose check ────────────────────────────────────────────────────────
        if (state.playerHp <= 0) {
          state.playerHp = 0;
          await sendBattleCard(thread as any, { ...state, lastMove: state.lastMove + " — **YOU FELL.**" }, buildButtons(state));
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
