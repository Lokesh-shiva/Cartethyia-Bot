import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, TextChannel, ComponentType, ButtonInteraction,
} from "discord.js";
import prisma from "./prisma";
import {
  rollRarity, rollMainStat, rollSubstats, rollSubstatValue,
  calcMainStatValue, substatCount, ELEMENT_COLORS, ELEMENT_EMOJI,
} from "./echoes";
import { generateEchoCard, echoRowToCard } from "./echoCard";
import { awardUser } from "./economy";
import { GuildMember } from "discord.js";

// ── Wave definitions — deliberately weak for a level-1 player ────────────────
const WAVES = [
  { name: "Ember Wisp",     element: "FUSION",  cost: 1, hp: 55,  atk: 10, def: 4,  emoji: "🔥" },
  { name: "Shadow Flicker", element: "HAVOC",   cost: 1, hp: 65,  atk: 12, def: 5,  emoji: "🌑" },
  { name: "Storm Harbinger",element: "AERO",    cost: 3, hp: 110, atk: 16, def: 8,  emoji: "🌪️" },
] as const;

const SKILL_COOLDOWN = 2;
const PLAYER_BASE_HP = 120;
const PLAYER_BASE_ATK = 30;

function elementColor(el: string): number {
  const map: Record<string, number> = {
    FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
    AERO: 0x10B981,   HAVOC: 0xEC4899,  SPECTRO: 0xEAB308,
  };
  return map[el] ?? 0x6366F1;
}

function hpBar(now: number, max: number, len = 14): string {
  const fill = Math.max(0, Math.round((now / max) * len));
  return `${"█".repeat(fill)}${"░".repeat(len - fill)} ${now}/${max}`;
}

async function dropEcho(userId: string, wave: typeof WAVES[number]): Promise<Buffer> {
  const rarity   = rollRarity([92, 8, 0] as [number, number, number]);
  const mainStat = rollMainStat(wave.cost as 1 | 3 | 4, undefined);
  const subCount = substatCount(rarity);
  const substats = rollSubstats(subCount, mainStat);

  const echoData: any = {
    userId,
    name: wave.name,
    rarity,
    element: wave.element,
    cost: wave.cost,
    mainStatType:  mainStat,
    mainStatValue: calcMainStatValue(mainStat, 0, rarity),
  };
  substats.forEach((s, i) => {
    echoData[`substat${i + 1}Type`]  = s;
    echoData[`substat${i + 1}Value`] = rollSubstatValue(s);
  });

  await prisma.echo.create({ data: echoData });
  return generateEchoCard({ ...echoRowToCard(echoData), revealedSubstats: 0 });
}

// ── Main expedition runner ────────────────────────────────────────────────────
export async function runFirstExpedition(member: GuildMember, channel: TextChannel) {
  const userId      = member.id;
  const displayName = member.displayName;

  // Idempotency guard
  const dbUser = await prisma.user.findUnique({
    where:  { id: userId },
    select: { firstExpeditionDone: true },
  });
  if (dbUser?.firstExpeditionDone) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x4A4A5A)
        .setDescription("◈ You have already completed the First Expedition.")],
    });
    return;
  }

  // ── Intro ─────────────────────────────────────────────────────────────────
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x6366F1)
      .setTitle("⚔️  First Expedition")
      .setDescription(
        `**${displayName}**, the resonance field is unstable.\n` +
        `Three echoes have broken free — defeat them and they become yours.\n\n` +
        `› 3 waves · echoes dropped on each kill · 10 Fracture Keys on completion\n\n` +
        `*Use **Attack** for steady damage or **Skill** for a heavy hit (${SKILL_COOLDOWN}-turn cooldown).*`
      )
      .setFooter({ text: "CARTETHYIA  ·  First Expedition  ·  Wave 1 incoming…" })],
  });

  await new Promise(r => setTimeout(r, 1500));

  let playerHp  = PLAYER_BASE_HP;
  const playerAtk = PLAYER_BASE_ATK;
  let skillCD   = 0;

  // ── 3 waves ───────────────────────────────────────────────────────────────
  for (let waveIdx = 0; waveIdx < WAVES.length; waveIdx++) {
    const wave    = WAVES[waveIdx];
    let   enemyHp: number = wave.hp;

    const buildEmbed = (log: string) =>
      new EmbedBuilder()
        .setColor(elementColor(wave.element))
        .setTitle(`${wave.emoji}  Wave ${waveIdx + 1} — ${wave.name}`)
        .setDescription(
          `**${wave.element} Echo** · ${wave.cost}-Cost\n\n` +
          `**Enemy HP**\n\`${hpBar(enemyHp, wave.hp)}\`\n\n` +
          `**Your HP**\n\`${hpBar(playerHp, PLAYER_BASE_HP)}\`\n\n` +
          (log ? `> ${log}` : "")
        )
        .setFooter({ text: `CARTETHYIA  ·  First Expedition  ·  Wave ${waveIdx + 1} of ${WAVES.length}` });

    const buildRow = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`exp_attack_${userId}`)
        .setLabel("⚔️  Attack")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`exp_skill_${userId}`)
        .setLabel(skillCD > 0 ? `🌀  Skill (${skillCD})` : "🌀  Skill")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(skillCD > 0),
    );

    const waveMsg = await channel.send({ embeds: [buildEmbed("")], components: [buildRow()] });

    // ── Turn loop for this wave ──────────────────────────────────────────────
    let waveWon = false;
    while (enemyHp > 0 && playerHp > 0) {
      let btn: ButtonInteraction | null = null;
      try {
        btn = await waveMsg.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: b => b.user.id === userId && b.customId.startsWith("exp_"),
          time: 5 * 60 * 1000,
        });
      } catch {
        // Timeout — auto-win for tutorial
        break;
      }

      await btn.deferUpdate();

      const isSkill  = btn.customId === `exp_skill_${userId}`;
      const pDmg     = Math.floor(playerAtk * (isSkill ? 2.2 : 1.0) * (0.85 + Math.random() * 0.3));
      const eDmg     = Math.max(1, Math.floor(wave.atk * (0.8 + Math.random() * 0.4)));

      if (isSkill) skillCD = SKILL_COOLDOWN;

      enemyHp  = Math.max(0, enemyHp - pDmg);
      if (skillCD > 0) skillCD--;

      let log = `You hit **${wave.name}** for **${pDmg}** damage!`;

      if (enemyHp <= 0) {
        log += `\n✅ **${wave.name}** defeated!`;
        waveWon = true;
        await waveMsg.edit({ embeds: [buildEmbed(log)], components: [] });
        break;
      }

      // Enemy counter-attacks
      playerHp = Math.max(1, playerHp - eDmg); // can't die in tutorial
      log += `\n${wave.name} hits back for **${eDmg}** damage.`;

      await waveMsg.edit({ embeds: [buildEmbed(log)], components: [buildRow()] });
    }

    if (!waveWon) enemyHp = 0; // timeout auto-win

    await new Promise(r => setTimeout(r, 800));

    // ── Echo drop ────────────────────────────────────────────────────────────
    const cardBuf  = await dropEcho(userId, wave);
    const attach   = new AttachmentBuilder(cardBuf, { name: "echo.webp" });
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(elementColor(wave.element))
        .setTitle(`${ELEMENT_EMOJI[wave.element]}  Echo Captured — ${wave.name}`)
        .setDescription(
          `The **${wave.name}** has been bound to your resonance.\n` +
          `Equip it with \`/echo-equip\`.`
        )
        .setImage("attachment://echo.webp")
        .setFooter({ text: `CARTETHYIA  ·  Wave ${waveIdx + 1} cleared` })],
      files: [attach],
    });

    if (waveIdx < WAVES.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
      await channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x6366F1)
          .setDescription(`◈ Resonance stabilising… **Wave ${waveIdx + 2}** incoming.`)],
      });
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // ── Completion ────────────────────────────────────────────────────────────
  await prisma.user.update({
    where: { id: userId },
    data:  { firstExpeditionDone: true },
  });
  await awardUser(userId, { fractonite: 300 }, "first-expedition");

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xF5A623)
      .setTitle("✦  First Expedition Complete")
      .setDescription(
        `All three echoes have been claimed, **${displayName}**.\n\n` +
        `**Rewards:**\n🔷  **300 Fractonite** — convert 100 → 1 Fracture Key with \`/use fractonite\`, then \`/wish\`\n` +
        `🌀  **3 Echoes** added to your inventory — equip them with \`/echo-equip\`\n\n` +
        `**What's next:**\n` +
        `› \`/daily\` — claim your first daily bonus\n` +
        `› \`/echoes\` — view your echo grid\n` +
        `› \`/wish\` — spend your keys on a 10-pull\n` +
        `› Keep chatting — every message earns Resonance EXP`
      )
      .setFooter({ text: "CARTETHYIA  ·  Your journey has begun." })],
  });
}
