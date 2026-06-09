import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  AttachmentBuilder, ChannelType, TextChannel, ThreadChannel,
  StringSelectMenuBuilder, StringSelectMenuInteraction,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser, awardUser, isOnDispatch } from "../../lib/economy";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import { registerFight, clearFight } from "../../lib/fightTracker";
import { checkLevelUp } from "../../lib/progression";
import { FIELD_BOSSES, FieldBoss } from "../../lib/fieldBosses";
import { gearAwareScale, baselineAtk } from "../../lib/combat";
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
import {
  rollRarity, rollMainStat, rollSubstats, rollSubstatValue,
  calcMainStatValue, substatCount, RARITY_STARS,
  ELEMENT_EMOJI, ELEMENT_COLORS,
} from "../../lib/echoes";
import { Boss } from "../../lib/bosses";
import { computeAura, consumeAura, auraBar, fmtAuraRegen, MAX_AURA } from "../../lib/aura";
import { CE } from "../../lib/emojiManager";
import prisma from "../../lib/prisma";
import * as path from "path";
import * as fs   from "fs";

const SKILL_COOLDOWN = 3;

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

// activeSessions replaced by shared combatLock

// Convert a FieldBoss to the Boss shape the battle card expects
function fieldToBoss(fb: FieldBoss): Boss {
  // Resolve art: try Bosses/ folder first, then echoes/ subfolders
  const artCandidates = [
    path.join(process.cwd(), "Bosses", fb.artFile),
    path.join(process.cwd(), "assets", "echoes", "3-cost", fb.artFile),
    path.join(process.cwd(), "assets", "echoes", "1-cost", fb.artFile),
  ];
  const artFile = artCandidates.find(p => fs.existsSync(p)) ?? "";

  return {
    id: fb.id, name: fb.name, title: fb.title,
    worldLevel: 0, element: fb.element, weakness: fb.weakness,
    artFile,
    baseHp: fb.baseHp, baseAtk: fb.baseAtk, baseDef: fb.baseDef,
    vibBar: fb.vibBar,
    moves: fb.moves,
    defeatLoot: { credits: 0, tuningModules: 0, sealingTubes: 0, forgingOres: 0, paradoxCores: 0, fractureKeys: 0, resonanceExp: 0 },
  };
}

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
    new ButtonBuilder().setCustomId("fb_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("fb_skill")
      .setLabel(skillReady ? "✦  Resonance Skill" : `✦  Skill (${state.skillCooldown}🔄)`)
      .setStyle(ButtonStyle.Secondary).setDisabled(!skillReady),
    new ButtonBuilder().setCustomId("fb_ultimate").setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(!ultReady),
    new ButtonBuilder().setCustomId("fb_flee").setLabel("🚪  Flee").setStyle(ButtonStyle.Danger),
  );
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("field-boss")
    .setDescription("Challenge a field boss — no WL requirement, scales with your strength. Costs 1 ◈ Aura."),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: 64 });

    const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName
      ?? interaction.user.displayName ?? interaction.user.username;
    const avatarUrl = interaction.user.displayAvatarURL({ size: 128, extension: "png" });

    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const bonuses = await resolvePlayerBonuses(interaction.user.id);
    const stats   = applyBonuses(user, bonuses);
    const auraState = computeAura(user.resonanceAura ?? MAX_AURA, user.auraUpdatedAt ?? new Date());

    if (user.level < 5) {
      await interaction.editReply({ content: "◈ Reach **Level 5** to challenge field bosses." });
      return;
    }

    if (await isOnDispatch(interaction.user.id)) {
      await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before entering combat." });
      return;
    }

    if (!acquireLock(interaction.user.id, "Field Boss")) {
      await interaction.editReply({ content: alreadyInCombatMsg(interaction.user.id) });
      return;
    }

    const options = FIELD_BOSSES.map(fb => {
      const elemEmoji = (ELEMENT_EMOJI as any)[fb.element] ?? "◇";
      return {
        label:       `${elemEmoji}  ${fb.name}`,
        description: `${fb.element}  ·  Weakness: ${fb.weakness}`,
        value:       fb.id,
      };
    });

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("fb_select")
        .setPlaceholder("Choose a field boss…")
        .addOptions(options)
    );

    const nextRegen = auraState.current < MAX_AURA
      ? `  ·  next in **${fmtAuraRegen(auraState.nextRegenMs)}**` : "";

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(ELEMENT_HEX[user.element] ?? 0x6366F1)
        .setTitle("🌿  Field Bosses")
        .setDescription(
          `Field bosses appear across the world and scale to your strength — no World Level required.\n\n` +
          `**Resonance Aura:** ${auraBar(auraState.current)}  ${auraState.current}/${MAX_AURA}${nextRegen}\n\n` +
          `› Costs **1 ◈ Aura** per fight — no cooldown\n` +
          `› Drops **1 guaranteed 4-cost echo** of that element\n` +
          `› No enrage — field bosses are fair fights`
        )
        .setFooter({ text: "CARTETHYIA  ·  Field Boss  ·  Expires in 60s" })],
      components: [selectRow],
    });

    const selCollector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      filter: i => i.user.id === interaction.user.id && i.customId === "fb_select",
      time:   60_000, max: 1,
    });

    selCollector?.on("collect", async (sel: StringSelectMenuInteraction) => {
      await sel.deferUpdate();
      const fb = FIELD_BOSSES.find(b => b.id === sel.values[0]);
      if (!fb) { await sel.editReply({ content: "Boss not found.", components: [], embeds: [] }); return; }

      // Aura check
      const freshAura = computeAura(user.resonanceAura ?? MAX_AURA, user.auraUpdatedAt ?? new Date());
      if (freshAura.current < 1) {
        releaseLock(interaction.user.id);
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setDescription(`◈ Not enough **Resonance Aura**. Field bosses cost **1 ◈**.\nNext in **${fmtAuraRegen(freshAura.nextRegenMs)}**.`)
            .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
          components: [],
        });
        return;
      }

      // lock already held from command entry

      // Create thread
      const channel = interaction.channel as TextChannel;
      let thread;
      try {
        thread = await channel.threads.create({
          name:                `🌿 ${displayName} vs ${fb.name}`,
          autoArchiveDuration: 60,
          type:                ChannelType.PrivateThread,
          reason:              "Field Boss",
        });
        await thread.members.add(interaction.user.id);
      } catch {
        releaseLock(interaction.user.id);
        await sel.editReply({ content: "◈ I need **Create Private Threads** permissions here.", components: [], embeds: [] });
        return;
      }

      await sel.editReply({ content: `◈ A field boss emerges. <#${thread.id}>`, components: [], embeds: [] });
      await consumeAura(interaction.user.id, 1);
      await registerFight(interaction.user.id, thread.id, interaction.guildId!, "Field Boss");
      // lock already held

      // Scale to player
      const fightLevel = user.level;
      const gearRatio  = stats.atk / baselineAtk(fightLevel);
      const boss       = fieldToBoss(fb);
      const scaled     = gearAwareScale(
        { hp: fb.baseHp, atk: fb.baseAtk, def: fb.baseDef },
        fightLevel, user.worldLevel, gearRatio,
      );

      let shatterTurnsLeft = 0;
      let secondWindUsed   = false;
      let battleMsg: any   = null;
      const ENERGY_PER_TURN = Math.floor(stats.energyPerTurn);

      const state: BattleCardState = {
        boss,
        bossHpNow:     scaled.hp,
        bossHpMax:     scaled.hp,
        bossVibNow:    fb.vibBar,
        playerHp:      stats.hp,
        playerHpMax:   stats.hp,
        playerEnergy:  0,
        playerName:    displayName,
        playerElement: user.element,
        turn:          1,
        lastMove:      `${fb.name} emerges from the field. Engage!`,
        isShattered:   false,
        skillCooldown: 0,
      };

      await thread.send({
        embeds: [new EmbedBuilder()
          .setColor(ELEMENT_HEX[fb.element] ?? 0x6366F1)
          .setTitle(`🌿  Field Boss — ${fb.name}`)
          .setDescription([
            `**${fb.name}** — *${fb.title}*`,
            ``,
            `◈  Element: **${fb.element}**  ·  Weakness: **${fb.weakness}** deals **1.5×** damage`,
            `◈  Shatter the Vibration Bar to stun for 1 turn`,
            `◈  Win to collect **2–4 echoes** of ${fb.element}`,
          ].join("\n"))
          .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
      });

      // Cleanup
      const cleanup = async (won: boolean) => {
        releaseLock(interaction.user.id);
        await clearFight(interaction.user.id);
        if (won) {
          // Drop 1 guaranteed 4-cost echo matching this field boss
          const { BOSS_ECHO_DEFINITIONS } = await import("../../lib/echoes");
          const echoDef = BOSS_ECHO_DEFINITIONS.find(e => e.name === fb.name);
          const echoLines: string[] = [];

          if (echoDef) {
            const rarity   = rollRarity(echoDef.rarityWeights as [number, number, number]);
            const mainSt   = rollMainStat(4, fb.element as any);
            const subCount = substatCount(rarity);
            const substats = rollSubstats(subCount, mainSt);

            const echoData: any = {
              userId: interaction.user.id, name: echoDef.name,
              rarity, element: fb.element, cost: 4,
              mainStatType: mainSt, mainStatValue: calcMainStatValue(mainSt, 0, rarity),
            };
            substats.forEach((s, idx) => {
              echoData[`substat${idx + 1}Type`]  = s;
              echoData[`substat${idx + 1}Value`] = rollSubstatValue(s);
            });
            await prisma.echo.create({ data: echoData });
            echoLines.push(`${(ELEMENT_EMOJI as any)[fb.element] ?? "◇"} **${echoDef.name}**  ${RARITY_STARS[rarity]}  (4-cost)`);
          }

          const credits = 300 + user.worldLevel * 120;
          await awardUser(interaction.user.id, { credits, resonanceExp: 100 + user.worldLevel * 40, fractureKeys: 1 });
          const lvl = await checkLevelUp(interaction.user.id);

          await thread.send({
            embeds: [new EmbedBuilder()
              .setColor(ELEMENT_COLORS[fb.element as keyof typeof ELEMENT_COLORS] ?? 0x6366F1)
              .setTitle("🌿  Field Boss Defeated")
              .setDescription(
                `**${fb.name}** has been driven off.\n\n` +
                (echoLines.length ? `**Echo Dropped:**\n${echoLines.join("\n")}\n\n` : "") +
                `${CE.cr} ${credits} Credits  ·  ${CE.fk} 1 Fracture Key` +
                (lvl.didLevelUp ? `\n◈ Level **${lvl.oldLevel}** → **${lvl.newLevel}**` : "")
              )
              .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
          });
        }
        await thread.setArchived(true).catch(() => {});
      };

      // Battle loop
      const runTurn = async () => {
        const buttons = buildButtons(state);
        if (battleMsg) await battleMsg.edit({ components: [] }).catch(() => {});
        battleMsg = await sendBattleCard(thread as any, state, buttons);

        const collector = battleMsg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          filter: (b: ButtonInteraction) => b.user.id === interaction.user.id,
          time: 15 * 60 * 1000, max: 1,
        });

        collector.on("collect", async (btn: ButtonInteraction) => {
          await btn.deferUpdate();

          let playerDmg = 0;
          let moveName  = "";

          const isWeak        = user.element === fb.weakness;
          const defVal        = state.isShattered ? 0 : scaled.def;
          const vibMult       = get5pcVibDrainMult(bonuses);
          const radCrit       = elemRadianceCrit(bonuses.elementPassive, state.playerHp, state.playerHpMax);
          const activeCritRate = apply5pcLowHpCrit(bonuses, Math.min(1, stats.critRate + radCrit), state.playerHp, state.playerHpMax);
          const totalVibMult  = vibMult * compositeVibMult(bonuses.abilityEffects);
          const abilCtxBase   = {
            currentHp: state.playerHp, maxHp: state.playerHpMax,
            enemyHpPct: state.bossHpNow / state.bossHpMax,
            turn: state.turn, isFirstAction: state.turn === 1,
          };
          let abilCrit = false;

          if (btn.customId === "fb_flee") {
            await thread.send({
              embeds: [new EmbedBuilder().setColor(0x334155)
                .setDescription("◈ You retreated. No rewards. The boss returns in 2h.")
                .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
            });
            collector.stop();
            await cleanup(false);
            return;
          }

          if (btn.customId === "fb_basic") {
            const crit = Math.random() < activeCritRate; abilCrit = crit;
            const base = Math.max(1, stats.atk - defVal);
            let dmg    = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            dmg        = apply5pcFirstHit(bonuses, dmg, state.turn === 1);
            dmg        = apply5pcFullHpDmg(bonuses, dmg, state.playerHp, state.playerHpMax);
            if (roll4pcDoubleHit(bonuses)) dmg *= 2;
            dmg        = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "BASIC"));
            dmg        = Math.floor(dmg * compositeDamageMult(bonuses.abilityEffects, { ...abilCtxBase, moveType: "BASIC" }).mult);
            const ign  = elemIgniteProc(bonuses.elementPassive, stats.atk);
            playerDmg  = dmg + ign.dmg;
            moveName   = crit ? `Basic Attack — **CRITICAL** (${playerDmg} DMG)` : `Basic Attack — ${playerDmg} DMG`;
            if (ign.tag) moveName += `  ✦${ign.tag}`;
            state.bossVibNow   = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.3 * totalVibMult));
            state.playerEnergy = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit));
            state.playerHp     = applyLifesteal(bonuses.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
          }

          if (btn.customId === "fb_skill") {
            const crit = Math.random() < Math.min(1, activeCritRate + 0.1); abilCrit = crit;
            const base = Math.max(1, stats.atk * 1.8 - defVal);
            let dmg    = Math.floor(base * (crit ? stats.critDmg : 1) * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            dmg        = apply4pcSkillBonus(bonuses, dmg, state.skillCooldown === 0);
            dmg        = Math.floor(dmg * elemWindstrideMult(bonuses.elementPassive, state.turn, "SKILL"));
            dmg        = Math.floor(dmg * compositeDamageMult(bonuses.abilityEffects, { ...abilCtxBase, moveType: "SKILL" }).mult);
            const ign  = elemIgniteProc(bonuses.elementPassive, stats.atk);
            playerDmg  = dmg + ign.dmg;
            moveName   = `Resonance Skill — ${playerDmg} DMG${crit ? " **(CRIT)**" : ""}`;
            if (ign.tag) moveName += `  ✦${ign.tag}`;
            state.bossVibNow    = Math.max(0, state.bossVibNow - Math.floor(playerDmg * 0.6 * totalVibMult));
            state.skillCooldown = SKILL_COOLDOWN;
            state.playerEnergy  = Math.min(100, state.playerEnergy + ENERGY_PER_TURN + elemDischargeEnergy(bonuses.elementPassive, crit));
            state.playerHp      = applyLifesteal(bonuses.lifesteal, playerDmg, state.playerHp, state.playerHpMax);
            if (bonuses.set5pc?.type === "POST_ULT_SKILL") state.skillCooldown = 0;
          }

          if (btn.customId === "fb_ultimate") {
            abilCrit   = true;
            const base = Math.max(1, stats.atk * 3.5 - defVal);
            let dmg    = Math.floor(base * (isWeak ? 1.5 : 1) * (1 + bonuses.elemDmgBonus));
            dmg        = apply4pcUltBonus(bonuses, dmg);
            dmg        = Math.floor(dmg * compositeDamageMult(bonuses.abilityEffects, { ...abilCtxBase, moveType: "ULT" }).mult);
            playerDmg  = dmg;
            moveName   = `⚡ ULTIMATE — ${playerDmg} DMG`;
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

          state.bossHpNow = Math.max(0, state.bossHpNow - playerDmg);

          // Shatter
          if (state.bossVibNow <= 0 && !state.isShattered) {
            state.isShattered = true;
            shatterTurnsLeft  = 1;
            moveName += "\n✦ **SHATTER!** Boss stunned 1 turn — all attacks critical!";
            const voidHeal = elemVoidSurgeHeal(bonuses.elementPassive, state.playerHpMax);
            if (voidHeal > 0) {
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + voidHeal);
              moveName += `\n✦ **Void Surge** — +${voidHeal} HP!`;
            }
          }

          state.lastMove = moveName;

          if (state.bossHpNow <= 0) {
            await sendBattleCard(thread as any, { ...state, lastMove: `${moveName} — **DEFEATED!**` }, buildButtons(state));
            collector.stop();
            await cleanup(true);
            return;
          }

          // Boss turn
          if (shatterTurnsLeft > 0) {
            shatterTurnsLeft--;
            if (shatterTurnsLeft === 0) {
              state.isShattered = false;
              state.bossVibNow  = fb.vibBar;
              state.lastMove   += "\n◇ Boss recovers from Shatter.";
            } else {
              state.lastMove += `\n◇ Boss stunned (${shatterTurnsLeft} turn left).`;
            }
          } else {
            const move    = fb.moves[Math.floor(Math.random() * fb.moves.length)];
            let bossDmg   = Math.max(1, Math.floor(scaled.atk * move.damage - stats.def * 0.4));
            bossDmg       = roll4pcBlock(bonuses, bossDmg);
            const shield  = elemFrostShield(bonuses.elementPassive, bossDmg);
            bossDmg       = shield.dmg;
            state.playerHp = Math.max(0, state.playerHp - bossDmg);
            const hpRegen  = get5pcHpRegen(bonuses, state.playerHpMax);
            if (hpRegen > 0 && typeof bonuses.set5pc?.value === "number" && bonuses.set5pc.value < 1)
              state.playerHp = Math.min(state.playerHpMax, state.playerHp + hpRegen);
            const radRegen = elemRadianceRegen(bonuses.elementPassive, state.playerHpMax);
            if (radRegen > 0) state.playerHp = Math.min(state.playerHpMax, state.playerHp + radRegen);
            state.lastMove += `\n◇ ${fb.name} ${move.effect} — **${bossDmg} DMG**${shield.blocked ? " *(Frost Shield!)*" : ""}${radRegen > 0 ? ` *(+${radRegen} Radiance)*` : ""}`;
            state.playerEnergy = Math.min(100, state.playerEnergy + 15);
          }

          state.turn++;
          if (state.skillCooldown > 0) state.skillCooldown--;

          if (state.playerHp <= 0 && compositeHasSecondWind(bonuses.abilityEffects) && !secondWindUsed) {
            secondWindUsed = true;
            state.playerHp = 1;
            state.lastMove += `\n✦ **UNDYING WILL** — 1 HP!`;
          }

          if (state.playerHp <= 0) {
            state.playerHp = 0;
            await sendBattleCard(thread as any, { ...state, lastMove: state.lastMove + " — **YOU FELL.**" }, buildButtons(state));
            await thread.send({
              embeds: [new EmbedBuilder().setColor(0x334155)
                .setDescription(`◈ Defeated by **${fb.name}**. Use **/field-boss** to try again.`)
                .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
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
                .setDescription("◈ Fight timed out.")
                .setFooter({ text: "CARTETHYIA  ·  Field Boss" })],
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
        releaseLock(interaction.user.id);
        await interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  },
};

export default command;
export const { data, execute } = command;
