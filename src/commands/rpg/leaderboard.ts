import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ComponentType,
} from "discord.js";
import prisma from "../../lib/prisma";
import { Element } from "@prisma/client";

const ELEMENT_COLORS: Record<string, number> = {
  NONE: 0x6366F1, FUSION: 0xFF6B35, GLACIO: 0x4FC3F7,
  ELECTRO: 0xB39DDB, AERO: 0x80CBC4, HAVOC: 0x9C27B0, SPECTRO: 0xFFD54F,
};

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

interface LeaderboardType {
  id:        string;
  label:     string;
  emoji:     string;
  desc:      string;
  unit:      string;
  orderBy:   object;
  select:    object;
  getValue:  (row: any) => number;
  getExtra?: (row: any) => string;
  // Returns count of onboarded users strictly ranked above the given value
  countAbove: (value: number) => Promise<number>;
}

const LEADERBOARD_TYPES: LeaderboardType[] = [
  {
    id: "level", label: "Resonance Level", emoji: "📈",
    desc: "Highest character levels",
    unit: "Level",
    orderBy: [{ level: "desc" }, { resonanceExp: "desc" }],
    select:  { id: true, username: true, level: true, worldLevel: true, element: true },
    getValue: r => r.level,
    getExtra: r => `WL${r.worldLevel}`,
    countAbove: v => prisma.user.count({ where: { isOnboarded: true, level: { gt: v } } }),
  },
  {
    id: "world_level", label: "World Level", emoji: "⚡",
    desc: "Most Ascension Trials completed",
    unit: "WL",
    orderBy: [{ worldLevel: "desc" }, { level: "desc" }],
    select:  { id: true, username: true, worldLevel: true, level: true, element: true },
    getValue: r => r.worldLevel,
    getExtra: r => `Lv ${r.level}`,
    countAbove: v => prisma.user.count({ where: { isOnboarded: true, worldLevel: { gt: v } } }),
  },
  {
    id: "social", label: "Social Activity", emoji: "💬",
    desc: "Total /vibe interactions across all categories",
    unit: "Interactions",
    orderBy: [{ vibePhysicalCount: "desc" }],
    select: {
      id: true, username: true, element: true,
      vibePhysicalCount: true, vibeExpressiveCount: true, vibeEmotionalCount: true,
    },
    getValue: r => r.vibePhysicalCount + r.vibeExpressiveCount + r.vibeEmotionalCount,
    getExtra: r => {
      const total = r.vibePhysicalCount + r.vibeExpressiveCount + r.vibeEmotionalCount;
      if (total === 0) return "No interactions";
      return r.vibePhysicalCount >= r.vibeExpressiveCount && r.vibePhysicalCount >= r.vibeEmotionalCount
        ? "Physical" : r.vibeExpressiveCount >= r.vibeEmotionalCount ? "Expressive" : "Emotional";
    },
    countAbove: v => prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(*) as c FROM users
      WHERE "isOnboarded" = true
      AND ("vibePhysicalCount" + "vibeExpressiveCount" + "vibeEmotionalCount") > ${v}
    `.then(r => Number(r[0].c)),
  },
  {
    id: "echoes", label: "Echo Collection", emoji: "🎴",
    desc: "Largest echo inventories",
    unit: "Echoes",
    orderBy: [{ echoes: { _count: "desc" } }],
    select:  { id: true, username: true, element: true, _count: { select: { echoes: true } } },
    getValue: r => r._count?.echoes ?? 0,
    getExtra: r => { const n = r._count?.echoes ?? 0; return n === 1 ? "1 echo" : `${n} echoes`; },
    countAbove: v => prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(*) as c FROM (
        SELECT u.id FROM users u
        LEFT JOIN echoes e ON e."userId" = u.id
        WHERE u."isOnboarded" = true
        GROUP BY u.id
        HAVING COUNT(e.id) > ${v}
      ) sub
    `.then(r => Number(r[0].c)),
  },
  {
    id: "credits", label: "Credits", emoji: "💠",
    desc: "Wealthiest players by Credits balance",
    unit: "Credits",
    orderBy: [{ credits: "desc" }],
    select:  { id: true, username: true, element: true, credits: true },
    getValue: r => r.credits,
    getExtra: r => r.credits.toLocaleString() + " cr",
    countAbove: v => prisma.user.count({ where: { isOnboarded: true, credits: { gt: v } } }),
  },
  {
    id: "streak", label: "Daily Streak", emoji: "🔥",
    desc: "Longest active /daily streaks",
    unit: "Days",
    orderBy: [{ dailyStreak: "desc" }],
    select:  { id: true, username: true, element: true, dailyStreak: true, streakShields: true },
    getValue: r => r.dailyStreak,
    getExtra: r => r.streakShields > 0 ? `${r.streakShields} 🛡️` : "",
    countAbove: v => prisma.user.count({ where: { isOnboarded: true, dailyStreak: { gt: v } } }),
  },
  {
    id: "duels", label: "Duel Wins", emoji: "⚔️",
    desc: "Most PvP duel victories",
    unit: "Wins",
    orderBy: [{ duelWins: "desc" }],
    select:  { id: true, username: true, element: true, duelWins: true, duelLosses: true },
    getValue: r => r.duelWins,
    getExtra: r => {
      const total = r.duelWins + r.duelLosses;
      return total === 0 ? "no duels" : `${Math.round((r.duelWins / total) * 100)}% WR`;
    },
    countAbove: v => prisma.user.count({ where: { isOnboarded: true, duelWins: { gt: v } } }),
  },
  {
    id: "dungeons", label: "Dungeon Clears", emoji: "🏯",
    desc: "Most dungeon runs completed",
    unit: "Clears",
    orderBy: [{ dungeonClears: "desc" }],
    select:  { id: true, username: true, element: true, dungeonClears: true },
    getValue: r => r.dungeonClears,
    getExtra: () => "",
    countAbove: v => prisma.user.count({ where: { isOnboarded: true, dungeonClears: { gt: v } } }),
  },
];

// ── Command ───────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View server rankings across levels, social activity, echoes, and more.");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });

  const color = ELEMENT_COLORS[(dbUser?.element as string) ?? "NONE"] ?? 0x6366F1;

  const select = new StringSelectMenuBuilder()
    .setCustomId("lb_type")
    .setPlaceholder("Choose a leaderboard…")
    .addOptions(LEADERBOARD_TYPES.map(t => ({
      label:       `${t.emoji}  ${t.label}`,
      description: t.desc,
      value:       t.id,
    })));

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const overviewEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle("⬥  Server Rankings")
    .setDescription(
      LEADERBOARD_TYPES
        .map(t => `${t.emoji}  **${t.label}** — ${t.desc}`)
        .join("\n")
    )
    .setFooter({ text: "CARTETHYIA  ·  Leaderboard  ·  Select a category below" });

  await interaction.editReply({ embeds: [overviewEmbed], components: [row] });

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && i.customId === "lb_type",
    time:   120_000,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    const type = LEADERBOARD_TYPES.find(t => t.id === sel.values[0]);
    if (!type) { await sel.deferUpdate(); return; }

    await sel.deferUpdate();

    // Fetch top 10 + requester's own row in parallel
    const [rows, myRow] = await Promise.all([
      (prisma.user.findMany as any)({
        orderBy: type.orderBy,
        select:  type.select,
        take:    10,
        where:   { isOnboarded: true },
      }),
      (prisma.user.findUnique as any)({
        where:  { id: interaction.user.id },
        select: { id: true, ...type.select },
      }),
    ]);

    // Count how many onboarded users rank above the requester (avoids full-table fetch)
    let myRank = 0;
    if (myRow) {
      const myValue = type.getValue(myRow);
      myRank = await type.countAbove(myValue) + 1;
    }

    // Build member display name map
    const memberCache = interaction.guild?.members.cache;

    const lines = rows.map((r: any, i: number) => {
      const rank      = i + 1;
      const medal     = rank <= 3 ? RANK_MEDALS[rank - 1] : `\`#${rank}\``;
      const name      = memberCache?.get(r.id)?.displayName ?? r.username;
      const value     = type.getValue(r);
      const extra     = type.getExtra ? type.getExtra(r) : "";
      const elemEmoji = elementEmoji(r.element);

      const valueStr = type.id === "credits"
        ? value.toLocaleString()
        : value.toString();

      return `${medal}  ${elemEmoji} **${name}** — ${valueStr} ${type.unit}${extra ? `  ·  ${extra}` : ""}`;
    });

    if (lines.length === 0) {
      lines.push("*No data yet — be the first!*");
    }

    // Show requester's position
    let footerText = `CARTETHYIA  ·  ${type.label} Leaderboard`;
    if (myRank > 10 && myRow) {
      const myName  = memberCache?.get(interaction.user.id)?.displayName ?? interaction.user.displayName;
      const myValue = type.getValue(myRow);
      footerText += `  ·  Your rank: #${myRank} (${myValue} ${type.unit})`;
    } else if (myRank > 0 && myRank <= 10) {
      footerText += `  ·  You're #${myRank}!`;
    }

    const lbEmbed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${type.emoji}  ${type.label} — Top ${Math.min(rows.length, 10)}`)
      .setDescription(lines.join("\n") || "*No entries yet.*")
      .setFooter({ text: footerText });

    await interaction.editReply({ embeds: [lbEmbed], components: [row] });
  });

  collector?.on("end", async () => {
    await interaction.editReply({ components: [] }).catch(() => {});
  });
}

function elementEmoji(element: string): string {
  const map: Record<string, string> = {
    FUSION: "🔥", GLACIO: "❄️", ELECTRO: "⚡",
    AERO: "🌪️", HAVOC: "🌑", SPECTRO: "✨", NONE: "◇",
  };
  return map[element] ?? "◇";
}
