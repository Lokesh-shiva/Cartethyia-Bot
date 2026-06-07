import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction, TextChannel, ChannelType,
  AttachmentBuilder, PermissionFlagsBits,
} from "discord.js";
import * as path from "path";
import * as fs   from "fs";
import prisma    from "../../lib/prisma";
import { getBoss, scaledBoss }      from "../../lib/bosses";
import { FIELD_BOSSES, FieldBoss }  from "../../lib/fieldBosses";
import { calcPlayerDamage, calcEnemyDamage, hpBar, buildRewardText } from "../../lib/combat";
import { awardUser } from "../../lib/economy";
import {
  resolvePlayerBonuses, applyBonuses, applyAbilityAttack,
  abilityCritRate, abilityVib, applyLifesteal, PlayerBonuses,
  elemIgniteProc, elemFrostShield, elemDischargeEnergy,
  elemWindstrideMult, elemVoidSurgeHeal, elemRadianceRegen, elemRadianceCrit,
} from "../../lib/setBonus";
import { compositeHasSecondWind } from "../../lib/abilityEffects";
import { generateRaidCard }       from "../../lib/versusCard";
import { isOwner }                from "../../lib/owner";

// ── Unified boss handle (works for both World bosses and Field bosses) ─────────
interface RaidBossConfig {
  id:       string;
  name:     string;
  title:    string;
  element:  string;
  weakness: string;
  artFile:  string;
  baseHp:   number;
  baseAtk:  number;
  baseDef:  number;
  vibBar:   number;
  moves:    { name: string; damage: number; effect: string }[];
  defeatLoot: {
    credits: number; tuningModules: number; sealingTubes: number;
    forgingOres: number; paradoxCores: number; resonanceExp: number;
  };
}

/** Encode / decode a boss choice value ("wl:0" or "field:ignis_behemoth") */
function encodeBossChoice(type: "wl" | "field", key: string | number): string {
  return `${type}:${key}`;
}

function getRaidBoss(choiceValue: string): RaidBossConfig | null {
  const [type, key] = choiceValue.split(":");
  if (type === "wl") {
    const wl   = parseInt(key, 10);
    const boss = getBoss(wl);
    if (!boss) return null;
    return boss as RaidBossConfig; // Boss already has defeatLoot
  }
  if (type === "field") {
    const fb = FIELD_BOSSES.find(b => b.id === key);
    if (!fb) return null;
    // Generate loot scaled to field boss difficulty
    return {
      ...fb,
      defeatLoot: fieldBossLoot(fb),
    };
  }
  return null;
}

/** Derive loot for a field boss (they have no fixed loot table) */
function fieldBossLoot(fb: FieldBoss) {
  // Scale based on baseHp as a proxy for difficulty
  const tier = fb.baseHp / 2000; // 1.0 for weakest, up to ~1.05 for toughest
  return {
    credits:       Math.floor(4000  * tier),
    tuningModules: Math.floor(9     * tier),
    sealingTubes:  Math.floor(7     * tier),
    forgingOres:   Math.floor(6     * tier),
    paradoxCores:  Math.floor(3     * tier),
    resonanceExp:  Math.floor(1200  * tier),
  };
}

// ── Smart party-aware boss scaling ─────────────────────────────────────────────
//
// Boss HP = f(total party ATK) → a geared squad faces a proportionally harder boss
// Boss ATK = f(avg player HP)  → boss damage reflects actual player survivability
// More players → more total HP pool so boss hits slightly harder + more HP total
//
function computeRaidBossStats(
  boss: RaidBossConfig,
  participants: RaidParticipant[],
): { hp: number; atk: number; def: number } {
  const n        = participants.length;
  const totalAtk = participants.reduce((s, p) => s + p.atk, 0);
  const totalHp  = participants.reduce((s, p) => s + p.hpMax, 0);
  const avgAtk   = totalAtk / n;
  const avgHp    = totalHp  / n;

  // ── HP ──────────────────────────────────────────────────────────────────────
  // Target ~18 skill-cycle turns of the full party to clear the boss.
  // Per turn, an average player deals avgAtk * ~2.2 (basic/skill/ult average).
  // We want total HP ≈ totalAtk * 2.2 * 18 * 0.80 (not too long but not trivial).
  // Clamp to min of the boss's own intended base so low-gear raids still feel epic.
  const targetHp = Math.floor(totalAtk * 2.2 * 18 * 0.80);
  const bossHp   = Math.max(boss.baseHp * (1 + n * 0.25), targetHp);

  // ── ATK ─────────────────────────────────────────────────────────────────────
  // Each AoE round should drain ~12–18% of a player's HP after their DEF.
  // With more players the boss attacks proportionally more per round (one attack
  // per player turn, so damage-per-player stays constant; no extra scaling needed).
  // Baseline: boss ATK that deals ~15% avgHp against avgDef ≈ avgHp / 7 defense.
  // calcEnemyDamage → dmg = base * (1 - def / (def + 250))
  // Solve: 0.15 * avgHp = baseAtk * 0.6  →  baseAtk ≈ avgHp * 0.25
  const targetAtk = Math.floor(avgHp * 0.25);
  const bossAtk   = Math.max(boss.baseAtk, targetAtk);

  // ── DEF ─────────────────────────────────────────────────────────────────────
  // Scale DEF with avg ATK so player penetration stays meaningful (not trivial,
  // not impenetrable). At avgAtk=300 it stays near boss base. Scales with sqrt.
  const gearMult = Math.max(1, Math.sqrt(avgAtk / 300));
  const bossDef  = Math.floor(boss.baseDef * gearMult);

  return { hp: Math.floor(bossHp), atk: Math.floor(bossAtk), def: Math.floor(bossDef) };
}

// ── In-memory raid state ───────────────────────────────────────────────────────
interface RaidParticipant {
  userId:         string;
  name:           string;
  element:        string;
  hp:             number;
  hpMax:          number;
  energy:         number;
  skillCd:        number;
  atk:            number;
  def:            number;
  critRate:       number;
  critDmg:        number;
  elemDmg:        number;
  lifesteal:      number;
  bonuses:        PlayerBonuses;
  firstAction:    boolean;
  secondWindUsed: boolean;
  dmgDealt:       number;
  isDefeated:     boolean;
}

interface ActiveRaid {
  bossChoice:   string;
  bossHp:       number;
  bossHpMax:    number;
  bossAtk:      number;   // scaled after party is known
  bossDef:      number;   // scaled after party is known
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
const joiningUsers = new Map<string, string>();      // userId → channelId
const ENERGY_PER_TURN = 20;
const SKILL_CD        = 3;
const JOIN_WINDOW_MS  = 5 * 60 * 1000;
const TURN_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_PLAYERS     = 2;
const MAX_PLAYERS     = 6;

function canManageRaids(interaction: ChatInputCommandInteraction): boolean {
  if (isOwner(interaction.user.id)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function elementEmoji(el: string): string {
  const m: Record<string, string> = {
    FUSION:"🔥", GLACIO:"❄️", ELECTRO:"⚡", AERO:"🌪️", HAVOC:"🌑", SPECTRO:"✨", NONE:"◇"
  };
  return m[el] ?? "◇";
}

function raidEmbed(raid: ActiveRaid, boss: RaidBossConfig, lastAction: string): EmbedBuilder {
  const alive = raid.participants.filter(p => !p.isDefeated);
  const current = raid.participants[raid.currentIdx];

  const participantLines = raid.participants.map(p => {
    const s = p.isDefeated ? "~~" : "";
    return `${elementEmoji(p.element)} ${s}**${p.name}**${s}  ${hpBar(p.hp, p.hpMax, 12)}`;
  });

  return new EmbedBuilder()
    .setColor(0xEC4899)
    .setTitle(`☄️  Calamity Raid — Turn ${raid.turn}`)
    .addFields(
      {
        name:  `⚔️  ${boss.name}`,
        value: `*${boss.title}*\n` +
               `${hpBar(raid.bossHp, raid.bossHpMax)}  **${raid.bossHp.toLocaleString()}**/${raid.bossHpMax.toLocaleString()}\n` +
               `Vibration: ${hpBar(raid.bossVib, raid.bossVibMax, 10)}${raid.isShattered ? "  **⚡ SHATTERED**" : ""}`,
        inline: false,
      },
      {
        name:  `Resonators  [${alive.length}/${raid.participants.length} standing]`,
        value: participantLines.join("\n"),
        inline: false,
      },
      {
        name:  "Last Action",
        value: lastAction || "*The raid begins.*",
        inline: false,
      },
    )
    .setFooter({ text: `CARTETHYIA  ·  Raid  ·  ${current?.name ?? "?"}'s turn  ·  5 min/turn` });
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

function nextParticipant(raid: ActiveRaid): RaidParticipant | null {
  const alive = raid.participants.filter(p => !p.isDefeated);
  if (alive.length === 0) return null;
  let idx      = (raid.currentIdx + 1) % raid.participants.length;
  let attempts = 0;
  while (raid.participants[idx].isDefeated && attempts < raid.participants.length) {
    idx = (idx + 1) % raid.participants.length;
    attempts++;
  }
  raid.currentIdx = idx;
  return raid.participants[idx];
}

// ── Command definition ────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("raid")
  .setDescription("Calamity Raid — co-op boss fight (2–6 players).")
  .addSubcommand(sub =>
    sub.setName("start")
      .setDescription("[Admin] Spawn a raid boss in this channel.")
      .addStringOption(o =>
        o.setName("boss")
          .setDescription("Which boss to summon")
          .setRequired(true)
          .addChoices(
            // ── World Bosses ──────────────────────────────────────────────────
            { name: "WL0 · Resonant Wraith  (HAVOC)",          value: encodeBossChoice("wl", 0) },
            { name: "WL1 · Tidecaller Sovereign  (GLACIO)",    value: encodeBossChoice("wl", 1) },
            { name: "WL2 · Fractured Arbiter  (SPECTRO)",      value: encodeBossChoice("wl", 2) },
            { name: "WL3 · Nullfire Construct  (ELECTRO)",     value: encodeBossChoice("wl", 3) },
            { name: "WL4 · Sable Harbinger  (HAVOC)",          value: encodeBossChoice("wl", 4) },
            { name: "WL5 · Auric Colossus  (SPECTRO)",         value: encodeBossChoice("wl", 5) },
            { name: "WL6 · Embercrown Tyrant  (FUSION)",       value: encodeBossChoice("wl", 6) },
            { name: "WL7 · Galeborne Phantom  (AERO)",         value: encodeBossChoice("wl", 7) },
            { name: "WL8 · The Resonant Absolute  (SPECTRO)",  value: encodeBossChoice("wl", 8) },
            // ── Field Bosses ──────────────────────────────────────────────────
            { name: "Field · Ignis Behemoth  (FUSION)",        value: encodeBossChoice("field", "ignis_behemoth")       },
            { name: "Field · Permafrost Sovereign  (GLACIO)",  value: encodeBossChoice("field", "permafrost_sovereign") },
            { name: "Field · Voltaic Aberrant  (ELECTRO)",     value: encodeBossChoice("field", "voltaic_aberrant")     },
            { name: "Field · Tempest Ancient  (AERO)",         value: encodeBossChoice("field", "tempest_ancient")      },
            { name: "Field · Null Ravager  (HAVOC)",           value: encodeBossChoice("field", "null_ravager")         },
            { name: "Field · Luminal Specter  (SPECTRO)",      value: encodeBossChoice("field", "luminal_specter")      },
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName("join").setDescription("Join the active raid in this channel.")
  )
  .addSubcommand(sub =>
    sub.setName("begin").setDescription("[Admin] Start the raid with current participants.")
  )
  .addSubcommand(sub =>
    sub.setName("end").setDescription("[Admin] Cancel and end the active raid in this channel.")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "start")  await startRaid(interaction);
  else if (sub === "join")  await joinRaid(interaction);
  else if (sub === "begin") await beginRaid(interaction);
  else if (sub === "end")   await endRaid(interaction);
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

  const choice = interaction.options.getString("boss", true);
  const boss   = getRaidBoss(choice);
  if (!boss) { await interaction.editReply({ content: "Boss not found." }); return; }

  const raid: ActiveRaid = {
    bossChoice:   choice,
    bossHp:       boss.baseHp,    // placeholder until launchRaid scales it
    bossHpMax:    boss.baseHp,
    bossAtk:      boss.baseAtk,
    bossDef:      boss.baseDef,
    bossVib:      boss.vibBar,
    bossVibMax:   boss.vibBar,
    isShattered:  false,
    shatterLeft:  0,
    phase:        "RECRUITING",
    participants: [],
    currentIdx:   0,
    turn:         1,
    channelId:    interaction.channelId,
    guildId:      interaction.guildId!,
    organizerId:  interaction.user.id,
  };
  activeRaids.set(interaction.channelId, raid);

  const joinRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("raid_join_btn").setLabel("⚔️  Join Raid").setStyle(ButtonStyle.Success),
  );

  const recruitEmbed = () => new EmbedBuilder()
    .setColor(0xEC4899)
    .setTitle(`☄️  Calamity Raid — ${boss.name}`)
    .setDescription(
      `*${boss.title}*\n\n` +
      `${elementEmoji(boss.element)} **${boss.element}**  ·  Weakness: ${elementEmoji(boss.weakness)} **${boss.weakness}**\n\n` +
      `**Players:** ${raid.participants.length}/${MAX_PLAYERS}\n` +
      (raid.participants.length
        ? raid.participants.map(p => `${elementEmoji(p.element)} **${p.name}**`).join("  ") + "\n\n"
        : "\n") +
      `Boss power **scales to your party's gear** — bring your best!\n` +
      `Minimum **${MIN_PLAYERS} players** to begin. Admin uses \`/raid begin\` when ready.\n` +
      `Auto-starts in 5 minutes.`
    )
    .setFooter({ text: "CARTETHYIA  ·  Calamity Raid  ·  Recruiting…" });

  await interaction.editReply({ embeds: [recruitEmbed()], components: [joinRow] });
  const recruitMsg = await interaction.fetchReply();

  const joinCollector = (interaction.channel as TextChannel).createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: b => b.customId === "raid_join_btn",
    time: JOIN_WINDOW_MS,
  });

  joinCollector.on("collect", async (btn: ButtonInteraction) => {
    const r = activeRaids.get(interaction.channelId);
    if (!r || r.phase !== "RECRUITING") { await btn.reply({ content: "Raid already started.", flags: 64 }); return; }
    if (r.participants.some(p => p.userId === btn.user.id) || joiningUsers.get(btn.user.id) === interaction.channelId) {
      await btn.reply({ content: "You already joined.", flags: 64 }); return;
    }
    if (r.participants.length >= MAX_PLAYERS) { await btn.reply({ content: "Raid is full.", flags: 64 }); return; }

    joiningUsers.set(btn.user.id, interaction.channelId);
    await btn.deferUpdate();
    await addParticipant(r, btn.user.id, btn.guild!.members.cache.get(btn.user.id)?.displayName ?? btn.user.displayName);
    joiningUsers.delete(btn.user.id);

    await (recruitMsg as any).edit({ embeds: [recruitEmbed()], components: [joinRow] });
  });

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
    await launchRaid(interaction.channel as TextChannel, interaction.channelId, boss, recruitMsg as any);
  }, JOIN_WINDOW_MS);
}

async function addParticipant(raid: ActiveRaid, userId: string, displayName: string) {
  const db = await prisma.user.findUnique({
    where:  { id: userId },
    select: { baseHp: true, baseAtk: true, baseDef: true, critRate: true, critDmg: true, element: true },
  });
  if (!db) return;

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

  const last = raid.participants[raid.participants.length - 1]!;
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x4CAF50)
      .setDescription(`${elementEmoji(last.element)} **${displayName}** joined the raid. [${raid.participants.length}/${MAX_PLAYERS}]`)
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
    embeds: [new EmbedBuilder().setColor(0x4A4A5A)
      .setDescription("☄️  The raid has been cancelled by the server admin.")
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
    await interaction.reply({ content: `Need at least ${MIN_PLAYERS} players to begin.`, flags: 64 }); return;
  }

  await interaction.reply({ content: "⚔️ Raid is beginning!", flags: 64 });
  const boss = getRaidBoss(raid.bossChoice)!;
  await launchRaid(interaction.channel as TextChannel, interaction.channelId, boss, null);
}

// ── Core fight loop ───────────────────────────────────────────────────────────
async function launchRaid(
  channel:     TextChannel,
  channelId:   string,
  boss:        RaidBossConfig,
  recruitMsg:  any,
) {
  const raid = activeRaids.get(channelId);
  if (!raid) return;

  raid.phase      = "FIGHTING";
  raid.currentIdx = 0;

  // ── Scale boss stats to this party ──────────────────────────────────────────
  const scaled     = computeRaidBossStats(boss, raid.participants);
  raid.bossHp      = scaled.hp;
  raid.bossHpMax   = scaled.hp;
  raid.bossAtk     = scaled.atk;
  raid.bossDef     = scaled.def;

  // ── Show scaling summary in the recruit embed ────────────────────────────────
  const n          = raid.participants.length;
  const avgAtk     = Math.round(raid.participants.reduce((s, p) => s + p.atk, 0) / n);
  const avgHp      = Math.round(raid.participants.reduce((s, p) => s + p.hpMax, 0) / n);

  // Create thread
  let thread;
  try {
    thread = await channel.threads.create({
      name: `☄️ Calamity Raid — ${boss.name}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
    });
  } catch {
    activeRaids.delete(channelId);
    await channel.send({ content: "☄️ I need **Create Public Threads** + **Send Messages in Threads** permissions to run raids here." }).catch(() => {});
    return;
  }

  for (const p of raid.participants) await thread.members.add(p.userId).catch(() => {});
  if (recruitMsg) await recruitMsg.edit({ components: [] }).catch(() => {});

  await channel.send({
    embeds: [new EmbedBuilder().setColor(0xEC4899)
      .setTitle(`☄️  Calamity Raid — ${boss.name}`)
      .setDescription(
        `*${boss.title}*\n\n` +
        `**${n} Resonators** answered the call.\n` +
        `**Avg ATK:** ${avgAtk.toLocaleString()}  ·  **Avg HP:** ${avgHp.toLocaleString()}\n\n` +
        `Calamity has calibrated — **Boss HP: ${scaled.hp.toLocaleString()}** · **Boss ATK: ${scaled.atk.toLocaleString()}**\n\n` +
        `The fight thread: <#${thread.id}>`
      )
      .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
  });

  // Raid intro card
  const bossArtPath = path.join(process.cwd(), "Bosses", boss.artFile);
  const introCard   = await generateRaidCard(
    boss.name, boss.element,
    fs.existsSync(bossArtPath) ? bossArtPath : null,
    raid.participants.map(p => ({ name: p.name, element: p.element })),
  );
  await thread.send({
    content: raid.participants.map(p => `<@${p.userId}>`).join(" "),
    files:   [new AttachmentBuilder(introCard, { name: "raid-intro.png" })],
  });

  let battleMsg = await thread.send({
    embeds:     [raidEmbed(raid, boss, "*The Calamity manifests. First Resonator, strike!*")],
    components: [buildRaidButtons(raid.participants[0]!)],
  });

  const finishRaid = async (won: boolean) => {
    activeRaids.delete(channelId);

    if (won) {
      const loot     = boss.defeatLoot;
      const perPlayer = {
        credits:       Math.floor(loot.credits       / n * 1.5),
        tuningModules: Math.floor(loot.tuningModules  / n * 1.5),
        sealingTubes:  Math.floor(loot.sealingTubes   / n * 1.5),
        forgingOres:   Math.floor(loot.forgingOres     / n * 1.5),
        paradoxCores:  Math.floor(loot.paradoxCores    / n * 1.5),
        resonanceExp:  Math.floor(loot.resonanceExp    / n * 1.5),
      };

      await Promise.all(raid.participants.map(p => awardUser(p.userId, perPlayer)));
      await Promise.all(
        raid.participants.filter(p => !p.isDefeated).map(p =>
          prisma.user.update({ where: { id: p.userId }, data: { raidWins: { increment: 1 } } }).catch(() => {})
        )
      );

      const contribLines = [...raid.participants]
        .sort((a, b) => b.dmgDealt - a.dmgDealt)
        .map((p, i) => `${i + 1}. ${elementEmoji(p.element)} ${p.name} — **${p.dmgDealt.toLocaleString()} DMG**`);

      const winCard = await generateRaidCard(
        boss.name, boss.element,
        fs.existsSync(bossArtPath) ? bossArtPath : null,
        raid.participants.map(p => ({ name: p.name, element: p.element })),
        { victory: true },
      );

      await battleMsg.edit({
        embeds: [new EmbedBuilder().setColor(0xF5A623)
          .setTitle("☄️  Raid — Victory!")
          .setDescription(
            `**${boss.name}** has been defeated!\n\n` +
            `**Rewards per player:**\n${buildRewardText(perPlayer)}\n\n` +
            `**Damage Standings:**\n${contribLines.join("\n")}`
          )
          .setImage("attachment://raid-victory.png")
          .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
        files:      [new AttachmentBuilder(winCard, { name: "raid-victory.png" })],
        components: [],
      }).catch(() => {});
    } else {
      const loseCard = await generateRaidCard(
        boss.name, boss.element,
        fs.existsSync(bossArtPath) ? bossArtPath : null,
        raid.participants.map(p => ({ name: p.name, element: p.element })),
        { defeat: true },
      );
      await battleMsg.edit({
        embeds: [new EmbedBuilder().setColor(0x4A4A5A)
          .setTitle("☄️  Raid — Defeated")
          .setDescription(`All Resonators fell before **${boss.name}**.\n*The Calamity retreats… for now.*`)
          .setImage("attachment://raid-defeat.png")
          .setFooter({ text: "CARTETHYIA  ·  Calamity Raid" })],
        files:      [new AttachmentBuilder(loseCard, { name: "raid-defeat.png" })],
        components: [],
      }).catch(() => {});
    }

    await thread.setArchived(true).catch(() => {});
    setTimeout(() => thread.delete().catch(() => {}), 5 * 60 * 1000);
  };

  // ── Turn loop ─────────────────────────────────────────────────────────────
  const runRaidTurn = () => {
    const current = raid.participants[raid.currentIdx];
    if (!current || current.isDefeated) {
      const next = nextParticipant(raid);
      if (!next) { finishRaid(false); return; }
      runRaidTurn();
      return;
    }

    const collector = battleMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: TURN_TIMEOUT_MS,
      max:  1,
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

      const isWeak    = current.element === boss.weakness;
      // Use the live raid.bossDef; zero when shattered
      const defVal    = raid.isShattered ? 0 : raid.bossDef;
      const radCrit   = elemRadianceCrit(current.bonuses.elementPassive, current.hp, current.hpMax);
      const aCrit     = abilityCritRate(current.bonuses, Math.min(1, current.critRate + radCrit), current.hp, current.hpMax);
      const vibMult   = abilityVib(current.bonuses);
      const bossHpPct = raid.bossHp / raid.bossHpMax;

      let moveLine  = "";
      let damage    = 0;
      let vibFrac   = 0;
      let moveType: "BASIC" | "SKILL" | "ULT" = "BASIC";
      let isCrit    = false;

      if (btn.customId === "raid_retreat") {
        current.isDefeated = true;
        moveLine = `${current.name} retreated from the raid.`;

      } else if (btn.customId === "raid_basic") {
        const r    = calcPlayerDamage(current.atk, defVal, aCrit, current.critDmg, 1.0, isWeak, raid.isShattered);
        let base   = Math.floor(r.damage * (1 + current.elemDmg));
        base       = Math.floor(base * elemWindstrideMult(current.bonuses.elementPassive, raid.turn, "BASIC"));
        const ign  = elemIgniteProc(current.bonuses.elementPassive, current.atk);
        damage = base + ign.dmg; isCrit = r.isCrit; vibFrac = 0.3;
        moveLine = `${current.name} — Basic Attack${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ign.tag ? `  ✦${ign.tag}` : ""}`;
        current.energy = Math.min(100, current.energy + ENERGY_PER_TURN + elemDischargeEnergy(current.bonuses.elementPassive, r.isCrit));

      } else if (btn.customId === "raid_skill") {
        const r    = calcPlayerDamage(current.atk, defVal, Math.min(1, aCrit + 0.1), current.critDmg, 1.8, isWeak, raid.isShattered);
        let base   = Math.floor(r.damage * (1 + current.elemDmg));
        base       = Math.floor(base * elemWindstrideMult(current.bonuses.elementPassive, raid.turn, "SKILL"));
        const ign  = elemIgniteProc(current.bonuses.elementPassive, current.atk);
        damage = base + ign.dmg; isCrit = r.isCrit; moveType = "SKILL"; vibFrac = 0.6;
        moveLine = `${current.name} — Resonance Skill${r.isCrit ? " **(CRIT)**" : ""}${isWeak ? " **(WEAK)**" : ""}${ign.tag ? `  ✦${ign.tag}` : ""}`;
        current.skillCd = SKILL_CD;
        current.energy  = Math.min(100, current.energy + ENERGY_PER_TURN + elemDischargeEnergy(current.bonuses.elementPassive, r.isCrit));

      } else if (btn.customId === "raid_ultimate") {
        const r  = calcPlayerDamage(current.atk, defVal, 1.0, current.critDmg, 3.5, isWeak, raid.isShattered);
        damage = Math.floor(r.damage * (1 + current.elemDmg)); isCrit = true; moveType = "ULT"; vibFrac = 0.8;
        moveLine = `${current.name} — ⚡ **ULTIMATE**${isWeak ? " **(WEAK)**" : ""}`;
        current.energy = 0;
      }

      // Apply ability effects and element hooks (attack moves only)
      if (btn.customId !== "raid_retreat") {
        const ar = applyAbilityAttack(current.bonuses, damage, isCrit, {
          moveType, currentHp: current.hp, maxHp: current.hpMax,
          enemyHpPct: bossHpPct, turn: raid.turn, isFirstAction: current.firstAction,
        });
        damage = ar.dmg;
        if (ar.tag) moveLine += `  ✦${ar.tag}`;
        moveLine += ` — **${damage.toLocaleString()} DMG**`;
        current.hp        = Math.min(current.hpMax, applyLifesteal(current.lifesteal, damage, current.hp, current.hpMax) + ar.healHp);
        current.energy    = Math.min(100, current.energy + ar.bonusEnergy);
        current.firstAction = false;
        raid.bossVib       = Math.max(0, raid.bossVib - Math.floor(damage * vibFrac * vibMult));

        if (raid.bossVib <= 0 && !raid.isShattered) {
          raid.isShattered  = true;
          raid.shatterLeft  = 2;
          moveLine += "\n✦ **SHATTER!** Boss stunned — next 2 attacks guaranteed CRIT!";
          const voidHeal = elemVoidSurgeHeal(current.bonuses.elementPassive, current.hpMax);
          if (voidHeal > 0) {
            current.hp = Math.min(current.hpMax, current.hp + voidHeal);
            moveLine  += `\n✦ **${current.name}'s Void Surge** — +${voidHeal} HP!`;
          }
        }
      }

      current.dmgDealt += damage;
      raid.bossHp       = Math.max(0, raid.bossHp - damage);

      // Victory
      if (raid.bossHp <= 0) {
        await battleMsg.edit({ embeds: [raidEmbed(raid, boss, moveLine)], components: [] });
        await finishRaid(true);
        return;
      }

      // ── Boss counter-attack (AoE vs all living players) ──────────────────────
      nextParticipant(raid);   // advance pointer (side effect: sets raid.currentIdx)

      if (raid.shatterLeft > 0) {
        raid.shatterLeft--;
        if (raid.shatterLeft === 0) {
          raid.isShattered = false;
          raid.bossVib     = boss.vibBar;
          moveLine += "\n◇ Boss recovers from Shatter. Vibration bar reset.";
        } else {
          moveLine += `\n◇ Boss stunned (${raid.shatterLeft} turn${raid.shatterLeft > 1 ? "s" : ""} left).`;
        }
      } else {
        const move    = boss.moves[Math.floor(Math.random() * boss.moves.length)];
        const aoeBase = Math.floor(raid.bossAtk * move.damage * 0.6); // AoE = 60% of single-target
        const alive   = raid.participants.filter(p => !p.isDefeated);
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
              dmgLines.push(`${p.name} -${bossDmg} ✦UNDYING`);
            } else {
              p.hp = 0; p.isDefeated = true;
              dmgLines.push(`${p.name} -${bossDmg} 💀`);
            }
          } else {
            const suffix = shield.blocked ? " 🛡" : radRegen > 0 ? ` +${radRegen}✨` : "";
            dmgLines.push(`${p.name} -${bossDmg}${suffix}`);
          }
        }
        moveLine += `\n◇ **${boss.name}** ${move.effect} (AoE) — ${dmgLines.join("  ·  ")}`;
        current.energy = Math.min(100, current.energy + 15);
      }

      if (current.skillCd > 0) current.skillCd--;

      // All defeated?
      if (raid.participants.every(p => p.isDefeated)) {
        await battleMsg.edit({ embeds: [raidEmbed(raid, boss, moveLine)], components: [] });
        await finishRaid(false);
        return;
      }

      raid.turn++;
      const nextP    = raid.participants[raid.currentIdx];
      const newMsg   = await thread.send({
        embeds:     [raidEmbed(raid, boss, moveLine)],
        components: nextP ? [buildRaidButtons(nextP)] : [],
      });
      await battleMsg.edit({ components: [] }).catch(() => {});
      battleMsg = newMsg;
      runRaidTurn();
    });

    collector.on("end", async (_, reason) => {
      if (reason !== "time") return;
      current.skillCd = Math.max(0, current.skillCd - 1);
      const skip  = `⏱ ${current.name} took too long — turn skipped.`;
      const nextP = raid.participants[raid.currentIdx];
      raid.turn++;
      const newMsg = await thread.send({
        embeds:     [raidEmbed(raid, boss, skip)],
        components: nextP ? [buildRaidButtons(nextP)] : [],
      });
      await battleMsg.edit({ components: [] }).catch(() => {});
      battleMsg = newMsg;
      runRaidTurn();
    });
  };

  runRaidTurn();
}
