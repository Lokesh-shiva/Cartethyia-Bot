import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ChannelType,
  AttachmentBuilder, PermissionFlagsBits,
} from "discord.js";
import * as path from "path";
import * as fs from "fs";
import prisma from "../../lib/prisma";
import { BOSSES, getBoss, scaledBoss } from "../../lib/bosses";
import { calcPlayerDamage, calcEnemyDamage, hpBar, buildRewardText } from "../../lib/combat";
import { awardUser } from "../../lib/economy";
import {
  resolvePlayerBonuses, applyBonuses, applyAbilityAttack,
  abilityCritRate, abilityVib, applyLifesteal, PlayerBonuses,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit,
} from "../../lib/setBonus";
import { compositeHasSecondWind } from "../../lib/abilityEffects";
import { generateRaidCard } from "../../lib/versusCard";
import { isOwner } from "../../lib/owner";

// ── In-memory raid state ──────────────────────────────────────────────────────
interface RaidParticipant {
  userId:    string;
  name:      string;
  element:   string;
  hp:        number;
  hpMax:     number;
  energy:    number;
  skillCd:   number;
  atk:       number;
  def:       number;
  critRate:  number;
  critDmg:   number;
  elemDmg:   number;
  lifesteal: number;
  bonuses:   PlayerBonuses;
  firstAction: boolean;
  secondWindUsed: boolean;
  dmgDealt:  number;
  isDefeated:boolean;
}

interface ActiveRaid {
  bossWL:       number;
  bossHp:       number;
  bossHpMax:    number;
  bossVib:      number;
  bossVibMax:   number;
  isShattered:  boolean;
  shatterLeft:  number;
  phase:        "RECRUITING" | "FIGHTING";
  participants: RaidParticipant[];
  currentIdx:   number;
  turn:         number;
  channelId:    string;
  guildId:      string;
  organizerId:  string;
}

const activeRaids  = new Map<string, ActiveRaid>(); // channelId → raid
const joiningUsers = new Map<string, string>();     // userId → channelId (race-condition guard)
const ENERGY_PER_TURN = 20;
const SKILL_CD        = 3;
const JOIN_WINDOW_MS  = 5 * 60 * 1000;
const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_PLAYERS     = 2;
const MAX_PLAYERS     = 6;

// Raid admin = anyone with Manage Server (or the bot owner as fallback)
function canManageRaids(interaction: ChatInputCommandInteraction): boolean {
  if (isOwner(interaction.user.id)) return true;
  const perms = interaction.memberPermissions;
  return perms?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function elementEmoji(el: string): string {
  const m: Record<string, string> = {
    FUSION:"🔥", GLACIO:"❄️", ELECTRO:"⚡", AERO:"🌪️", HAVOC:"🌑", SPECTRO:"✨", NONE:"◇"
  };
  return m[el] ?? "◇";
}

function raidEmbed(raid: ActiveRaid, bossName: string, bossTitle: string, lastAction: string): EmbedBuilder {
  const alive = raid.participants.filter(p => !p.isDefeated);
  const current = raid.participants[raid.currentIdx];

  const participantLines = raid.participants.map(p => {
    const status = p.isDefeated ? "~~" : "";
    return `${elementEmoji(p.element)} ${status}**${p.name}**${status}  ${hpBar(p.hp, p.hpMax, 12)}`;
  });

  return new EmbedBuilder()
    .setColor(0xEC4899)
    .setTitle(`☄️  Calamity Raid — Turn ${raid.turn}`)
    .addFields(
      {
        name:   `⚔️  ${bossName}`,
        value:  `*${bossTitle}*\n${hpBar(raid.bossHp, raid.bossHpMax)}  ${raid.bossHp.toLocaleString()}/${raid.bossHpMax.toLocaleString()}\n` +
                `Vibration: ${hpBar(raid.bossVib, raid.bossVibMax, 10)}${raid.isShattered ? "  **⚡ SHATTERED**" : ""}`,
        inline: false,
      },
      {
        name:   `Resonators  [${alive.length}/${raid.participants.length} standing]`,
        value:  participantLines.join("\n"),
        inline: false,
      },
      {
        name:   "Last Action",
        value:  lastAction || "*The raid begins.*",
        inline: false,
      },
    )
    .setFooter({ text: `CARTETHYIA  ·  Raid  ·  ${current?.name ?? "?"}'s turn  ·  5 min per turn` });
}

function buildRaidButtons(p: RaidParticipant): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("raid_basic").setLabel("⚔️  Basic Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("raid_skill")
      .setLabel(p.skillCd === 0 ? "✦  Skill" : `✦  Skill (${p.skillCd}🔄)`)
      .setStyle(ButtonStyle.Secondary).setDisabled(p.skillCd > 0),
    new ButtonBuilder().setCustomId("raid_ultimate")
      .setLabel("⚡  Ultimate").setStyle(ButtonStyle.Success).setDisabled(p.energy < 100),
    new ButtonBuilder().setCustomId("raid_retreat")
      .setLabel("↩  Retreat").setStyle(ButtonStyle.Danger),
  );
}

// Advance to the next alive participant
function nextParticipant(raid: ActiveRaid): RaidParticipant | null {
  const alive = raid.participants.filter(p => !p.isDefeated);
  if (alive.length === 0) return null;
  let idx = (raid.currentIdx + 1) % raid.participants.length;
  let attempts = 0;
  while (raid.participants[idx].isDefeated && attempts < raid.participants.length) {
    idx = (idx + 1) % raid.participants.length;
    attempts++;
  }
  raid.currentIdx = idx;
  return raid.participants[idx];
}

// ── Command ───────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("raid")
  .setDescription("Calamity Raid — co-op boss fight.")
  .addSubcommand(sub =>
    sub.setName("start")
      .setDescription("[Owner] Spawn a raid boss in this channel.")
      .addIntegerOption(o =>
        o.setName("world_level")
          .setDescription("Which boss to spawn (matches World Level)")
          .setRequired(true)
          .addChoices(
            { name: "WL0 — Resonant Wraith",     value: 0 },
            { name: "WL1 — Tidecaller Sovereign", value: 1 },
            { name: "WL2 — Fractured Arbiter",    value: 2 },
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName("join").setDescription("Join the active raid in this channel.")
  )
  .addSubcommand(sub =>
    sub.setName("begin").setDescription("[Owner] Start the raid with current participants.")
  )
  .addSubcommand(sub =>
    sub.setName("end").setDescription("[Owner] Cancel and end the active raid in this channel.")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "start") await startRaid(interaction);
  else if (sub === "join") await joinRaid(interaction);
  else if (sub === "begin") await beginRaid(interaction);
  else if (sub === "end") await endRaid(interaction);
}

// ── /raid start ───────────────────────────────────────────────────────────────
async function startRaid(interaction: ChatInputCommandInteraction) {
  if (!canManageRaids(interaction)) {
    await interaction.reply({ content: "You need **Manage Server** to start raids.", flags: 64 }); return;
  }

  await interaction.deferReply();

  if (activeRaids.has(interaction.channelId)) {
    await interaction.editReply({ content: "A raid is already active in this channel." }); return;
  }

  const wl   = interaction.options.getInteger("world_level", true);
  const boss = getBoss(wl);
  if (!boss) { await interaction.editReply({ content: "No boss defined for that World Level." }); return; }

  const scaled = scaledBoss(boss, 30 + wl * 10); // raid boss scales harder than normal

  const raid: ActiveRaid = {
    bossWL:      wl,
    bossHp:      scaled.hp,
    bossHpMax:   scaled.hp,
    bossVib:     boss.vibBar,
    bossVibMax:  boss.vibBar,
    isShattered: false,
    shatterLeft: 0,
    phase:       "RECRUITING",
    participants: [],
    currentIdx:  0,
    turn:        1,
    channelId:   interaction.channelId,
    guildId:     interaction.guildId!,
    organizerId: interaction.user.id,
  };
  activeRaids.set(interaction.channelId, raid);

  const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("raid_join_btn").setLabel("⚔️  Join Raid").setStyle(ButtonStyle.Success),
  );

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0xEC4899)
      .setTitle(`☄️  Calamity Raid — ${boss.name}`)
      .setDescription(
        `*${boss.title}*\n\n` +
        `A powerful echo has manifested. Resonators, unite!\n\n` +
        `**Boss HP:** ${scaled.hp.toLocaleString()}\n` +
        `**Weakness:** ${elementEmoji(boss.weakness)} ${boss.weakness}\n` +
        `**Players:** 0/${MAX_PLAYERS} joined\n\n` +
        `Click **Join Raid** or use \`/raid join\`. Minimum ${MIN_PLAYERS} players needed.\n` +
        `Owner uses \`/raid begin\` when ready, or raid auto-starts in 5 minutes.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Calamity Raid  ·  Recruiting…" })],
    components: [joinRow],
  });

  const recruitMsg = await interaction.fetchReply();

  // Button-based join
  const joinCollector = (interaction.channel as TextChannel).createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: b => b.customId === "raid_join_btn",
    time:   JOIN_WINDOW_MS,
  });

  joinCollector.on("collect", async (btn: ButtonInteraction) => {
    const r = activeRaids.get(interaction.channelId);
    if (!r || r.phase !== "RECRUITING") { await btn.reply({ content: "Raid already started.", flags: 64 }); return; }
    if (r.participants.some(p => p.userId === btn.user.id) || joiningUsers.get(btn.user.id) === interaction.channelId) {
      await btn.reply({ content: "You already joined.", flags: 64 }); return;
    }
    if (r.participants.length >= MAX_PLAYERS) {
      await btn.reply({ content: "Raid is full.", flags: 64 }); return;
    }

    joiningUsers.set(btn.user.id, interaction.channelId);
    await btn.deferUpdate();
    await addParticipant(r, btn.user.id, btn.guild!.members.cache.get(btn.user.id)?.displayName ?? btn.user.displayName);
    joiningUsers.delete(btn.user.id);

    const embed = EmbedBuilder.from((recruitMsg as any).embeds[0])
      .setDescription(
        `*${boss.title}*\n\n` +
        `A powerful echo has manifested. Resonators, unite!\n\n` +
        `**Boss HP:** ${scaled.hp.toLocaleString()}\n` +
        `**Weakness:** ${elementEmoji(boss.weakness)} ${boss.weakness}\n` +
        `**Players:** ${r.participants.length}/${MAX_PLAYERS} joined:\n` +
        r.participants.map((p: RaidParticipant) => `${elementEmoji(p.element)} ${p.name}`).join("\n") + "\n\n" +
        `Owner uses \`/raid begin\` when ready.`
      );
    await (recruitMsg as any).edit({ embeds: [embed], components: [joinRow] });
  });

  // Auto-begin after window
  setTimeout(async () => {
    const r = activeRaids.get(interaction.channelId);
    if (!r || r.phase !== "RECRUITING") return;
    if (r.participants.length < MIN_PLAYERS) {
      activeRaids.delete(interaction.channelId);
      await (recruitMsg as any).edit({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setDescription(`Not enough players joined (need ${MIN_PLAYERS}). Raid cancelled.`)
          .setFooter({ text: "CARTETHYIA  ·  Raid" })],
        components: [],
      }).catch(() => {});
      return;
    }
    joinCollector.stop();
    await launchRaid(interaction.channel as TextChannel, interaction.channelId, boss.name, boss.title, recruitMsg as any);
  }, JOIN_WINDOW_MS);
}

async function addParticipant(raid: ActiveRaid, userId: string, displayName: string) {
  const db = await prisma.user.findUnique({
    where:  { id: userId },
    select: { baseHp: true, baseAtk: true, baseDef: true, critRate: true, critDmg: true, element: true },
  });
  if (!db) return;

  // Resolve full combat stats (echoes + weapon + set bonuses + unique ability)
  const bonuses = await resolvePlayerBonuses(userId);
  const stats   = applyBonuses(db, bonuses);

  raid.participants.push({
    userId, name: displayName, element: db.element,
    hp: stats.hp, hpMax: stats.hp, energy: 0, skillCd: 0,
    atk: stats.atk, def: stats.def,
    critRate: stats.critRate, critDmg: stats.critDmg,
    elemDmg: stats.elemDmgBonus, lifesteal: stats.lifesteal, bonuses,
    firstAction: true, secondWindUsed: false,
    dmgDealt: 0, isDefeated: false,
  });
}

// ── /raid join ────────────────────────────────────────────────────────────────
async function joinRaid(interaction: ChatInputCommandInteraction) {
  const raid = activeRaids.get(interaction.channelId);
  if (!raid || raid.phase !== "RECRUITING") {
    await interaction.reply({ content: "No raid is recruiting in this channel.", flags: 64 }); return;
  }
  if (raid.participants.some(p => p.userId === interaction.user.id) || joiningUsers.get(interaction.user.id) === interaction.channelId) {
    await interaction.reply({ content: "You already joined this raid.", flags: 64 }); return;
  }
  if (raid.participants.length >= MAX_PLAYERS) {
    await interaction.reply({ content: "Raid is full.", flags: 64 }); return;
  }

  const displayName = interaction.guild?.members.cache.get(interaction.user.id)?.displayName ?? interaction.user.displayName;
  joiningUsers.set(interaction.user.id, interaction.channelId);
  await interaction.deferReply({ flags: 64 });
  await addParticipant(raid, interaction.user.id, displayName);
  joiningUsers.delete(interaction.user.id);

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x4CAF50)
      .setDescription(`${elementEmoji(raid.participants[raid.participants.length - 1]!.element)} **${displayName}** joined the raid. [${raid.participants.length}/${MAX_PLAYERS}]`)
      .setFooter({ text: "CARTETHYIA  ·  Raid" })],
  });
}

// ── /raid end ─────────────────────────────────────────────────────────────────
async function endRaid(interaction: ChatInputCommandInteraction) {
  if (!canManageRaids(interaction)) {
    await interaction.reply({ content: "You need **Manage Server** to end raids.", flags: 64 }); return;
  }

  const raid = activeRaids.get(interaction.channelId);
  if (!raid) {
    await interaction.reply({ content: "No active raid in this channel.", flags: 64 }); return;
  }

  activeRaids.delete(interaction.channelId);

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x4A4A5A)
      .setDescription("☄️  The raid has been cancelled by the server owner.")
      .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
  });
}

// ── /raid begin ───────────────────────────────────────────────────────────────
async function beginRaid(interaction: ChatInputCommandInteraction) {
  if (!canManageRaids(interaction)) {
    await interaction.reply({ content: "You need **Manage Server** to begin raids.", flags: 64 }); return;
  }

  const raid = activeRaids.get(interaction.channelId);
  if (!raid || raid.phase !== "RECRUITING") {
    await interaction.reply({ content: "No raid is recruiting in this channel.", flags: 64 }); return;
  }
  if (raid.participants.length < MIN_PLAYERS) {
    await interaction.reply({ content: `Need at least ${MIN_PLAYERS} players.`, flags: 64 }); return;
  }

  await interaction.reply({ content: "⚔️ Raid is beginning!", flags: 64 });

  const boss = getBoss(raid.bossWL)!;
  await launchRaid(interaction.channel as TextChannel, interaction.channelId, boss.name, boss.title, null);
}

// ── Core raid fight loop ──────────────────────────────────────────────────────
async function launchRaid(
  channel: TextChannel,
  channelId: string,
  bossName: string,
  bossTitle: string,
  recruitMsg: any,
) {
  const raid = activeRaids.get(channelId);
  if (!raid) return;

  raid.phase      = "FIGHTING";
  raid.currentIdx = 0;

  // Scale boss HP to party size + total gear so a geared squad isn't trivial.
  // Party factor: 1 player = 1.0x, scales ~0.5x per extra member.
  const n = raid.participants.length;
  const baselinePartyAtk = n * 200; // rough no-gear expectation
  const totalAtk = raid.participants.reduce((s, p) => s + p.atk, 0);
  const gearFactor = 1 + Math.max(0, totalAtk / baselinePartyAtk - 1) * 0.5;
  const partyFactor = (0.6 + 0.45 * n) * gearFactor;
  raid.bossHp    = Math.floor(raid.bossHpMax * partyFactor);
  raid.bossHpMax = raid.bossHp;

  const boss = getBoss(raid.bossWL)!;

  // Create fight thread
  let thread;
  try {
    thread = await channel.threads.create({
      name:                `☄️ Calamity Raid — ${bossName}`,
      autoArchiveDuration: 1440,
      type:                ChannelType.PublicThread,
    });
  } catch {
    activeRaids.delete(channelId);
    await channel.send({ content: "☄️ I need **Create Public Threads** + **Send Messages in Threads** permissions here to run the raid. Ask an admin, or try another channel." }).catch(() => {});
    return;
  }

  for (const p of raid.participants) {
    await thread.members.add(p.userId).catch(() => {});
  }

  if (recruitMsg) {
    await recruitMsg.edit({ components: [] }).catch(() => {});
  }

  await channel.send({
    embeds: [new EmbedBuilder().setColor(0xEC4899)
      .setDescription(`☄️ The raid has begun! <#${thread.id}>`)],
  });

  // Hybrid visual: raid roster card
  const bossArtPath = path.join(process.cwd(), "Bosses", boss.artFile);
  const introCard = await generateRaidCard(
    bossName, boss.element, fs.existsSync(bossArtPath) ? bossArtPath : null,
    raid.participants.map(p => ({ name: p.name, element: p.element })),
  );
  await thread.send({
    content: raid.participants.map(p => `<@${p.userId}>`).join(" "),
    files: [new AttachmentBuilder(introCard, { name: "raid-intro.png" })],
  });

  let battleMsg = await thread.send({
    embeds:  [raidEmbed(raid, bossName, bossTitle, "*The Calamity manifests. First Resonator, strike!*")],
    components: [buildRaidButtons(raid.participants[0])],
  });

  const endRaid = async (won: boolean) => {
    activeRaids.delete(channelId);

    if (won) {
      const loot = boss.defeatLoot;
      // Scale loot per participant
      const perPlayer = {
        credits:      Math.floor(loot.credits      / raid.participants.length * 1.5),
        tuningModules: Math.floor(loot.tuningModules / raid.participants.length * 1.5),
        sealingTubes:  Math.floor(loot.sealingTubes  / raid.participants.length * 1.5),
        forgingOres:   Math.floor(loot.forgingOres    / raid.participants.length * 1.5),
        paradoxCores:  Math.floor(loot.paradoxCores   / raid.participants.length * 1.5),
        resonanceExp:  Math.floor(loot.resonanceExp   / raid.participants.length * 1.5),
      };

      await Promise.all(
        raid.participants.map(p => awardUser(p.userId, perPlayer))
      );
      // Raid win credited to all survivors
      await Promise.all(
        raid.participants.filter(p => !p.isDefeated).map(p =>
          prisma.user.update({ where: { id: p.userId }, data: { raidWins: { increment: 1 } } }).catch(() => {})
        )
      );

      const rewardText = buildRewardText(perPlayer);
      const contribLines = [...raid.participants]
        .sort((a: RaidParticipant, b: RaidParticipant) => b.dmgDealt - a.dmgDealt)
        .map((p: RaidParticipant, i: number) => `${i + 1}. ${p.name} — ${p.dmgDealt.toLocaleString()} DMG`);

      const bossArt = path.join(process.cwd(), "Bosses", boss.artFile);
      const winCard = await generateRaidCard(
        bossName, boss.element, fs.existsSync(bossArt) ? bossArt : null,
        raid.participants.map(p => ({ name: p.name, element: p.element })),
        { victory: true },
      );

      await battleMsg.edit({
        embeds: [new EmbedBuilder().setColor(0xF5A623)
          .setTitle("☄️  Raid — Victory!")
          .setDescription(
            `**${bossName}** has been defeated!\n\n` +
            `**Rewards per player:**\n${rewardText}\n\n` +
            `**Damage Dealt:**\n${contribLines.join("\n")}`
          )
          .setImage("attachment://raid-victory.png")
          .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
        files: [new AttachmentBuilder(winCard, { name: "raid-victory.png" })],
        components: [],
      }).catch(() => {});
    } else {
      const bossArt = path.join(process.cwd(), "Bosses", boss.artFile);
      const loseCard = await generateRaidCard(
        bossName, boss.element, fs.existsSync(bossArt) ? bossArt : null,
        raid.participants.map(p => ({ name: p.name, element: p.element })),
        { defeat: true },
      );

      await battleMsg.edit({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setTitle("☄️  Raid — Defeated")
          .setDescription(`All Resonators fell before **${bossName}**.\n*The Calamity retreats… for now.*`)
          .setImage("attachment://raid-defeat.png")
          .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
        files: [new AttachmentBuilder(loseCard, { name: "raid-defeat.png" })],
        components: [],
      }).catch(() => {});
    }

    await thread.setArchived(true).catch(() => {});
    setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
  };

  const runRaidTurn = () => {
    const current = raid.participants[raid.currentIdx];
    if (!current || current.isDefeated) {
      const next = nextParticipant(raid);
      if (!next) { endRaid(false); return; }
      runRaidTurn();
      return;
    }

    const collector = battleMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time:   TURN_TIMEOUT_MS,
      max:    1,
      filter: (b: ButtonInteraction) => {
        if (b.user.id !== current.userId) {
          b.reply({ content: "It's not your turn.", flags: 64 }).catch(() => {});
          return false;
        }
        return true;
      },
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();

      const isWeak  = current.element === boss.weakness;
      const defVal  = raid.isShattered ? 0 : scaledBoss(boss, 30 + raid.bossWL * 10).def;
      const radCrit = elemRadianceCrit(current.bonuses.elementPassive, current.hp, current.hpMax);
      const aCrit   = abilityCritRate(current.bonuses, Math.min(1, current.critRate + radCrit), current.hp, current.hpMax);
      const vibMult = abilityVib(current.bonuses);
      const bossHpPct = raid.bossHp / raid.bossHpMax;
      let moveLine  = "";
      let damage    = 0;
      let vibFrac   = 0;
      let moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
      let isCrit = false;

      if (btn.customId === "raid_retreat") {
        current.isDefeated = true;
        moveLine = `${current.name} retreated from the raid.`;
      } else if (btn.customId === "raid_basic") {
        const r      = calcPlayerDamage(current.atk, defVal, aCrit, current.critDmg, 1.0, isWeak, raid.isShattered);
        let base     = Math.floor(r.damage * (1 + current.elemDmg));
        base         = Math.floor(base * elemWindstrideMult(current.bonuses.elementPassive, raid.turn, "BASIC"));
        const ignite = elemIgniteProc(current.bonuses.elementPassive, current.atk);
        damage = base + ignite.dmg; isCrit = r.isCrit; moveType = "BASIC"; vibFrac = 0.3;
        moveLine = `${current.name} — Basic Attack${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ignite.tag ? `  ✦${ignite.tag}` : ""}`;
        current.energy = Math.min(100, current.energy + ENERGY_PER_TURN + elemDischargeEnergy(current.bonuses.elementPassive, r.isCrit));
      } else if (btn.customId === "raid_skill") {
        const r      = calcPlayerDamage(current.atk, defVal, Math.min(1, aCrit + 0.1), current.critDmg, 1.8, isWeak, raid.isShattered);
        let base     = Math.floor(r.damage * (1 + current.elemDmg));
        base         = Math.floor(base * elemWindstrideMult(current.bonuses.elementPassive, raid.turn, "SKILL"));
        const ignite = elemIgniteProc(current.bonuses.elementPassive, current.atk);
        damage = base + ignite.dmg; isCrit = r.isCrit; moveType = "SKILL"; vibFrac = 0.6;
        moveLine = `${current.name} — Resonance Skill${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ignite.tag ? `  ✦${ignite.tag}` : ""}`;
        current.skillCd = SKILL_CD;
        current.energy  = Math.min(100, current.energy + ENERGY_PER_TURN + elemDischargeEnergy(current.bonuses.elementPassive, r.isCrit));
      } else if (btn.customId === "raid_ultimate") {
        const r  = calcPlayerDamage(current.atk, defVal, 1.0, current.critDmg, 3.5, isWeak, raid.isShattered);
        damage = Math.floor(r.damage * (1 + current.elemDmg)); isCrit = true; moveType = "ULT"; vibFrac = 0.8;
        moveLine = `${current.name} — ⚡ **ULTIMATE**${isWeak ? " **(WEAK)**" : ""}`;
        current.energy  = 0;
      }

      // Apply unique ability effects + element hooks (only for attacks, not retreat)
      if (btn.customId !== "raid_retreat") {
        const ar = applyAbilityAttack(current.bonuses, damage, isCrit, {
          moveType, currentHp: current.hp, maxHp: current.hpMax,
          enemyHpPct: bossHpPct, turn: raid.turn, isFirstAction: current.firstAction,
        });
        damage = ar.dmg;
        if (ar.tag) moveLine += `  ✦${ar.tag}`;
        moveLine += ` — **${damage} DMG**`;
        current.hp = Math.min(current.hpMax, applyLifesteal(current.lifesteal, damage, current.hp, current.hpMax) + ar.healHp);
        current.energy = Math.min(100, current.energy + ar.bonusEnergy);
        current.firstAction = false;
        raid.bossVib = Math.max(0, raid.bossVib - Math.floor(damage * vibFrac * vibMult));

        // Void Surge (Havoc) — heal on Shatter
        if (raid.bossVib <= 0 && !raid.isShattered) {
          raid.isShattered = true;
          raid.shatterLeft = 2;
          moveLine += "\n✦ **SHATTER!** Boss stunned — all hits critical!";
          const voidHeal = elemVoidSurgeHeal(current.bonuses.elementPassive, current.hpMax);
          if (voidHeal > 0) {
            current.hp = Math.min(current.hpMax, current.hp + voidHeal);
            moveLine  += `\n✦ **${current.name}'s Void Surge** — +${voidHeal} HP!`;
          }
        }
      }

      current.dmgDealt += damage;
      raid.bossHp       = Math.max(0, raid.bossHp - damage);

      // Win
      if (raid.bossHp <= 0) {
        await battleMsg.edit({ embeds: [raidEmbed(raid, bossName, bossTitle, moveLine)], components: [] });
        await endRaid(true);
        return;
      }

      // After last player's turn: boss attacks all
      const nextP = nextParticipant(raid);
      const isLastInRound = raid.currentIdx <= (raid.participants.findIndex(p => p === current));

      // Boss counter — boss attacks after EVERY player turn (AoE)
      if (raid.shatterLeft > 0) {
        raid.shatterLeft--;
        if (raid.shatterLeft === 0) {
          raid.isShattered = false;
          raid.bossVib     = boss.vibBar;
          moveLine += "\n◇ Boss recovers from Shatter.";
        } else {
          moveLine += `\n◇ Boss stunned (${raid.shatterLeft} turn${raid.shatterLeft > 1 ? "s" : ""} left).`;
        }
      } else {
        const move    = boss.moves[Math.floor(Math.random() * boss.moves.length)];
        const bossScaled = scaledBoss(boss, 30 + raid.bossWL * 10);
        const aoeBase    = Math.floor(bossScaled.atk * move.damage * 0.6); // AoE = 60% of single target
        const alive = raid.participants.filter(p => !p.isDefeated);
        const dmgLines: string[] = [];
        for (const p of alive) {
          let bossDmg    = calcEnemyDamage(aoeBase, p.def, 1.0);
          const shield   = elemFrostShield(p.bonuses.elementPassive, bossDmg);
          bossDmg        = shield.dmg;
          const radRegen = elemRadianceRegen(p.bonuses.elementPassive, p.hpMax);
          p.hp = Math.max(0, p.hp - bossDmg);
          if (radRegen > 0) p.hp = Math.min(p.hpMax, p.hp + radRegen);
          if (p.hp <= 0) {
            if (compositeHasSecondWind(p.bonuses.abilityEffects) && !p.secondWindUsed) {
              p.secondWindUsed = true; p.hp = 1;
              dmgLines.push(`${p.name}: -${bossDmg} ✦UNDYING`);
            } else {
              p.hp = 0; p.isDefeated = true;
              dmgLines.push(`${p.name}: -${bossDmg} 💀`);
            }
          } else {
            const suffix = shield.blocked ? "🛡" : radRegen > 0 ? `+${radRegen}✨` : "";
            dmgLines.push(`${p.name}: -${bossDmg}${suffix ? ` ${suffix}` : ""}`);
          }
        }
        moveLine += `\n◇ ${boss.name} ${move.effect} (AoE) — ${dmgLines.join(", ")}`;
        current.energy = Math.min(100, current.energy + 15);
      }

      if (current.skillCd > 0) current.skillCd--;

      // Check all defeated
      const allDown = raid.participants.every(p => p.isDefeated);
      if (allDown) {
        await battleMsg.edit({ embeds: [raidEmbed(raid, bossName, bossTitle, moveLine)], components: [] });
        await endRaid(false);
        return;
      }

      raid.turn++;

      const newMsg = await thread.send({
        embeds:     [raidEmbed(raid, bossName, bossTitle, moveLine)],
        components: nextP ? [buildRaidButtons(nextP)] : [],
      });
      await battleMsg.edit({ components: [] }).catch(() => {});
      battleMsg = newMsg;

      runRaidTurn();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        // Skip this player's turn
        current.skillCd = Math.max(0, current.skillCd - 1);
        const skipLine = `${current.name} took too long — turn skipped.`;
        const next     = nextParticipant(raid);
        raid.turn++;
        const newMsg = await thread.send({
          embeds:     [raidEmbed(raid, bossName, bossTitle, skipLine)],
          components: next ? [buildRaidButtons(next)] : [],
        });
        await battleMsg.edit({ components: [] }).catch(() => {});
        battleMsg = newMsg;
        runRaidTurn();
      }
    });
  };

  runRaidTurn();
}
