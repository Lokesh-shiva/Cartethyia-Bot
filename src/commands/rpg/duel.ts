import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ThreadChannel,
  ChannelType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { calcPlayerDamage, calcEnemyDamage, hpBar, energyBar, COUNTER_ELEMENT } from "../../lib/combat";
import { awardUser, isOnDispatch, replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import { acquireLock, releaseLock, alreadyInCombatMsg } from "../../lib/combatLock";
import {
  resolvePlayerBonuses, applyBonuses, applyAbilityAttack,
  abilityCritRate, applyLifesteal, PlayerBonuses,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemRadianceRegen, elemRadianceCrit,
} from "../../lib/setBonus";
import { compositeHasSecondWind, abilityLabel } from "../../lib/abilityEffects";
import { generateVersusCard, Fighter } from "../../lib/versusCard";
import { AttachmentBuilder } from "discord.js";

// ── In-memory active duels ────────────────────────────────────────────────────
// activeDuels replaced by shared combatLock

interface DuelState {
  challengerId:   string;
  challengedId:   string;
  challengerName: string;
  challengedName: string;
  // Challenger stats
  cHp:     number; cHpMax: number; cEnergy: number; cSkillCd: number;
  cAtk:    number; cDef:   number; cCritRate: number; cCritDmg: number; cElement: string;
  cElemDmg: number; cLifesteal: number; cBonuses: PlayerBonuses;
  cFirstAction: boolean; cSecondWindUsed: boolean;
  // Challenged stats
  dHp:     number; dHpMax: number; dEnergy:  number; dSkillCd: number;
  dAtk:    number; dDef:   number; dCritRate: number; dCritDmg: number; dElement: string;
  dElemDmg: number; dLifesteal: number; dBonuses: PlayerBonuses;
  dFirstAction: boolean; dSecondWindUsed: boolean;
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

function duelEmbed(state: DuelState, lastMove: string, _color: number): EmbedBuilder {
  const turnName  = state.currentTurn === state.challengerId ? state.challengerName : state.challengedName;
  const turnElem  = state.currentTurn === state.challengerId ? state.cElement : state.dElement;
  const themeColor = ELEMENT_DUEL_HEX[turnElem] ?? 0x6366F1;

  const cTurn = state.currentTurn === state.challengerId ? "▸ " : "";
  const dTurn = state.currentTurn === state.challengedId ? "▸ " : "";

  return new EmbedBuilder()
    .setColor(themeColor)
    .setTitle(`⚔️  Duel  ·  Turn ${state.turn}`)
    .addFields(
      {
        name:   `${cTurn}${elementEmoji(state.cElement)}  ${state.challengerName}`,
        value:  `${hpBar(state.cHp, state.cHpMax)}\n` +
                `\`HP ${state.cHp}/${state.cHpMax}\`\n` +
                `⚡ ${energyBar(state.cEnergy)} ${state.cEnergy}${state.cSkillCd > 0 ? `   ✦cd ${state.cSkillCd}` : ""}`,
        inline: true,
      },
      {
        name:   `${dTurn}${elementEmoji(state.dElement)}  ${state.challengedName}`,
        value:  `${hpBar(state.dHp, state.dHpMax)}\n` +
                `\`HP ${state.dHp}/${state.dHpMax}\`\n` +
                `⚡ ${energyBar(state.dEnergy)} ${state.dEnergy}${state.dSkillCd > 0 ? `   ✦cd ${state.dSkillCd}` : ""}`,
        inline: true,
      },
      {
        name:   "◈  Combat Log",
        value:  lastMove || "*The duel begins.*",
        inline: false,
      },
    )
    .setFooter({ text: `CARTETHYIA  ·  ${turnName}'s turn  ·  10 min to act` });
}

function buildDuelButtons(state: DuelState, forUserId: string): ActionRowBuilder<ButtonBuilder> {
  const isChallenger = forUserId === state.challengerId;
  const myEnergy     = isChallenger ? state.cEnergy  : state.dEnergy;
  const mySkillCd    = isChallenger ? state.cSkillCd : state.dSkillCd;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("duel_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("duel_skill")
      .setLabel(mySkillCd === 0 ? "✦  Skill" : `✦  Skill (${mySkillCd}🔄)`)
      .setStyle(ButtonStyle.Secondary).setDisabled(mySkillCd > 0),
    new ButtonBuilder().setCustomId("duel_ultimate")
      .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(myEnergy < 100),
    new ButtonBuilder().setCustomId("duel_forfeit")
      .setLabel("🏳️  Forfeit").setStyle(ButtonStyle.Danger),
  );
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
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target = interaction.options.getUser("target", true);

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
  if (await isOnDispatch(interaction.user.id)) {
    await interaction.editReply({ content: "◈ You are on an expedition. Use **/dispatch claim** first before duelling." });
    return;
  }

  const [challengerDb, challengedDb] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: interaction.user.id },
      select: { baseHp: true, baseAtk: true, baseDef: true, critRate: true, critDmg: true, element: true, level: true },
    }),
    prisma.user.findUnique({
      where:  { id: target.id },
      select: { baseHp: true, baseAtk: true, baseDef: true, critRate: true, critDmg: true, element: true, level: true },
    }),
  ]);

  if (!challengerDb) { await replyNotStarted(interaction); return; }
  if (!challengedDb) { await interaction.editReply({ content: `${target.displayName} hasn't started yet.` }); return; }

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
        `Winner gets **${WIN_CREDITS} Credits** + **${WIN_EXP} EXP**.\n\n` +
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
    await interaction.editReply({ components: [] });

    // locks already held for both players

    const state: DuelState = {
      challengerId: interaction.user.id, challengedId: target.id,
      challengerName: cName, challengedName: dName,
      cHp: cStats.hp, cHpMax: cStats.hp, cEnergy: 0, cSkillCd: 0,
      cAtk: cStats.atk, cDef: cStats.def,
      cCritRate: cStats.critRate, cCritDmg: cStats.critDmg,
      cElement: challengerDb.element,
      cElemDmg: cStats.elemDmgBonus, cLifesteal: cStats.lifesteal, cBonuses,
      cFirstAction: true, cSecondWindUsed: false,
      dHp: dStats.hp, dHpMax: dStats.hp, dEnergy: 0, dSkillCd: 0,
      dAtk: dStats.atk, dDef: dStats.def,
      dCritRate: dStats.critRate, dCritDmg: dStats.critDmg,
      dElement: challengedDb.element,
      dElemDmg: dStats.elemDmgBonus, dLifesteal: dStats.lifesteal, dBonuses,
      dFirstAction: true, dSecondWindUsed: false,
      currentTurn: interaction.user.id, // challenger goes first
      turn: 1,
    };

    // Create private thread
    let thread;
    try {
      thread = await (interaction.channel as TextChannel).threads.create({
        name:                `⚔️ ${cName} vs ${dName}`,
        autoArchiveDuration: 60,
        type:                ChannelType.PrivateThread,
      });
      await thread.members.add(interaction.user.id);
      await thread.members.add(target.id);
    } catch {
      releaseLock(interaction.user.id);
      releaseLock(target.id);
      await interaction.editReply({ content: "I need **Create Private Threads** + **Send Messages in Threads** permissions here to run the duel. Ask an admin, or try another channel.", embeds: [], components: [] }).catch(() => {});
      return;
    }

    await interaction.editReply({ content: `⚔️ Duel started! <#${thread.id}>` });

    const color = 0x6366F1;

    // Hybrid visual: intro versus card
    const introCard = await generateVersusCard(
      { name: cName, avatarUrl: cAvatar, element: challengerDb.element, level: challengerDb.level, hp: cStats.hp, atk: cStats.atk },
      { name: dName, avatarUrl: dAvatar, element: challengedDb.element, level: challengedDb.level, hp: dStats.hp, atk: dStats.atk },
      { subtitle: "The duel begins — challenger strikes first" },
    );
    await thread.send({
      content: `<@${interaction.user.id}> <@${target.id}>`,
      files: [new AttachmentBuilder(introCard, { name: "duel-intro.png" })],
    });

    let battleMsg = await thread.send({
      embeds:  [duelEmbed(state, "*The duel begins.*", color)],
      components: [buildDuelButtons(state, state.currentTurn)],
    });

    const cleanup = async (won: boolean, winnerId: string | null) => {
      releaseLock(interaction.user.id);
      releaseLock(target.id);
      if (won && winnerId) {
        const loserId = winnerId === interaction.user.id ? target.id : interaction.user.id;
        await awardUser(winnerId, { credits: WIN_CREDITS, resonanceExp: WIN_EXP });
        await prisma.user.update({ where: { id: winnerId }, data: { duelWins:   { increment: 1 } } }).catch(() => {});
        await prisma.user.update({ where: { id: loserId },  data: { duelLosses: { increment: 1 } } }).catch(() => {});
      }
      await thread.setArchived(true).catch(() => {});
      setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
    };

    const runDuelTurn = () => {
      const turnUserId = state.currentTurn;

      const collector = battleMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time:   10 * 60 * 1000,
        max:    1,
        filter: (b: ButtonInteraction) => {
          if (b.user.id !== turnUserId) {
            b.reply({ content: "It's not your turn.", flags: 64 }).catch(() => {});
            return false;
          }
          return true;
        },
      });

      collector.on("collect", async (btn: ButtonInteraction) => {
        await btn.deferUpdate();

        const isChallenger = turnUserId === state.challengerId;
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
        const myHp     = isChallenger ? state.cHp       : state.dHp;
        const myHpMax  = isChallenger ? state.cHpMax    : state.dHpMax;
        const oppHp    = isChallenger ? state.dHp       : state.cHp;
        const oppHpMax = isChallenger ? state.dHpMax    : state.cHpMax;
        const firstAct = isChallenger ? state.cFirstAction : state.dFirstAction;
        const isWeak   = myElem === COUNTER_ELEMENT[oppElem];

        let damage = 0;
        let moveLine = "";

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
          await cleanup(true, winnerId);
          return;
        }

        // Crit rate incl. ability (Desperation etc.) + Radiance low-HP bonus
        const radCrit = elemRadianceCrit(myBonus.elementPassive, myHp, myHpMax);
        const aCrit   = abilityCritRate(myBonus, Math.min(1, myCrit + radCrit), myHp, myHpMax);
        let moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
        let isCrit = false;

        if (btn.customId === "duel_basic") {
          const r      = calcPlayerDamage(myAtk, oppDef, aCrit, myCritDmg, 1.0, isWeak, false);
          let base     = Math.floor(r.damage * (1 + myElemDmg));
          base         = Math.floor(base * elemWindstrideMult(myBonus.elementPassive, state.turn, "BASIC"));
          const ignite = elemIgniteProc(myBonus.elementPassive, myAtk);
          damage = base + ignite.dmg; isCrit = r.isCrit; moveType = "BASIC";
          moveLine = `${myName} — Basic Attack${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ignite.tag ? `  ✦${ignite.tag}` : ""}`;
          const enGain = ENERGY_PER_TURN + elemDischargeEnergy(myBonus.elementPassive, r.isCrit);
          if (isChallenger) state.cEnergy = Math.min(100, state.cEnergy + enGain);
          else              state.dEnergy = Math.min(100, state.dEnergy + enGain);
        }

        if (btn.customId === "duel_skill") {
          const r      = calcPlayerDamage(myAtk, oppDef, Math.min(1, aCrit + 0.1), myCritDmg, 1.8, isWeak, false);
          let base     = Math.floor(r.damage * (1 + myElemDmg));
          base         = Math.floor(base * elemWindstrideMult(myBonus.elementPassive, state.turn, "SKILL"));
          const ignite = elemIgniteProc(myBonus.elementPassive, myAtk);
          damage = base + ignite.dmg; isCrit = r.isCrit; moveType = "SKILL";
          moveLine = `${myName} — Resonance Skill${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ignite.tag ? `  ✦${ignite.tag}` : ""}`;
          const enGain = ENERGY_PER_TURN + elemDischargeEnergy(myBonus.elementPassive, r.isCrit);
          if (isChallenger) { state.cSkillCd = SKILL_CD; state.cEnergy = Math.min(100, state.cEnergy + enGain); }
          else              { state.dSkillCd = SKILL_CD; state.dEnergy = Math.min(100, state.dEnergy + enGain); }
        }

        if (btn.customId === "duel_ultimate") {
          const r  = calcPlayerDamage(myAtk, oppDef, 1.0, myCritDmg, 3.5, isWeak, false);
          damage = Math.floor(r.damage * (1 + myElemDmg)); isCrit = true; moveType = "ULT";
          moveLine = `${myName} — ⚡ **ULTIMATE**${isWeak ? " **(WEAK)**" : ""}`;
          if (isChallenger) state.cEnergy = 0;
          else              state.dEnergy = 0;
        }

        // Apply unique ability effects
        const ar = applyAbilityAttack(myBonus, damage, isCrit, {
          moveType, currentHp: myHp, maxHp: myHpMax,
          enemyHpPct: oppHp / oppHpMax, turn: state.turn, isFirstAction: firstAct,
        });
        damage = ar.dmg;
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
        const healed = applyLifesteal(myLife, damage, myHp, myHpMax) - myHp + ar.healHp;
        if (isChallenger) {
          state.cHp = Math.min(state.cHpMax, state.cHp + Math.max(0, healed));
          state.cEnergy = Math.min(100, state.cEnergy + ar.bonusEnergy);
          state.cFirstAction = false;
        } else {
          state.dHp = Math.min(state.dHpMax, state.dHp + Math.max(0, healed));
          state.dEnergy = Math.min(100, state.dEnergy + ar.bonusEnergy);
          state.dFirstAction = false;
        }

        // Apply damage to opponent
        if (isChallenger) state.dHp = Math.max(0, state.dHp - damage);
        else              state.cHp = Math.max(0, state.cHp - damage);

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

        // Check win
        const loserHp = isChallenger ? state.dHp : state.cHp;
        if (loserHp <= 0) {
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
          await thread.send({ files: [new AttachmentBuilder(resultCard, { name: "duel-result.png" })] }).catch(() => {});

          await cleanup(true, winnerId);
          return;
        }

        // Switch turns
        state.currentTurn = isChallenger ? state.challengedId : state.challengerId;
        state.turn++;

        const updated = duelEmbed(state, moveLine, color);
        const newMsg  = await thread.send({
          content:    `<@${state.currentTurn}>`,
          embeds:     [updated],
          components: [buildDuelButtons(state, state.currentTurn)],
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
          await cleanup(true, winnerId);
        }
      });
    };

    runDuelTurn();
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
