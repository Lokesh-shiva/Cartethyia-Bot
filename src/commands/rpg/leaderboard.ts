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
  id:      string;
  label:   string;
  emoji:   string;
  desc:    string;
  unit:    string;
  orderBy: object;
  select:  object;
  getValue: (row: any) => number;
  getExtra?: (row: any) => string;
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
  },
  {
    id: "world_level", label: "World Level", emoji: "⚡",
    desc: "Most Ascension Trials completed",
    unit: "WL",
    orderBy: [{ worldLevel: "desc" }, { level: "desc" }],
    select:  { id: true, username: true, worldLevel: true, level: true, element: true },
    getValue: r => r.worldLevel,
    getExtra: r => `Lv ${r.level}`,
  },
  {
    id: "social", label: "Social Activity", emoji: "💬",
    desc: "Total /vibe interactions across all categories",
    unit: "Interactions",
    orderBy: [
      { vibePhysicalCount: "desc" },
    ],
    select: {
      id: true, username: true, element: true,
      vibePhysicalCount: true, vibeExpressiveCount: true, vibeEmotionalCount: true,
    },
    getValue: r => r.vibePhysicalCount + r.vibeExpressiveCount + r.vibeEmotionalCount,
    getExtra: r => {
      const total = r.vibePhysicalCount + r.vibeExpressiveCount + r.vibeEmotionalCount;
      if (total === 0) return "No interactions";
      const dom = r.vibePhysicalCount >= r.vibeExpressiveCount && r.vibePhysicalCount >= r.vibeEmotionalCount
        ? "Physical"
        : r.vibeExpressiveCount >= r.vibeEmotionalCount ? "Expressive" : "Emotional";
      return dom;
    },
  },
  {
    id: "echoes", label: "Echo Collection", emoji: "🎴",
    desc: "Largest echo inventories",
    unit: "Echoes",
    orderBy: [{ echoes: { _count: "desc" } }],
    select:  { id: true, username: true, element: true, _count: { select: { echoes: true } } },
    getValue: r => r._count?.echoes ?? 0,
    getExtra: r => {
      const n = r._count?.echoes ?? 0;
      return n === 1 ? "1 echo" : `${n} echoes`;
    },
  },
  {
    id: "credits", label: "Credits", emoji: "💠",
    desc: "Wealthiest players by Credits balance",
    unit: "Credits",
    orderBy: [{ credits: "desc" }],
    select:  { id: true, username: true, element: true, credits: true },
    getValue: r => r.credits,
    getExtra: r => r.credits.toLocaleString() + " cr",
  },
  {
    id: "streak", label: "Daily Streak", emoji: "🔥",
    desc: "Longest active /daily streaks",
    unit: "Days",
    orderBy: [{ dailyStreak: "desc" }],
    select:  { id: true, username: true, element: true, dailyStreak: true, streakShields: true },
    getValue: r => r.dailyStreak,
    getExtra: r => r.streakShields > 0 ? `${r.streakShields} 🛡️` : "",
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
      if (total === 0) return "no duels";
      return `${Math.round((r.duelWins / total) * 100)}% WR`;
    },
  },
  {
    id: "dungeons", label: "Dungeon Clears", emoji: "🏯",
    desc: "Most dungeon runs completed",
    unit: "Clears",
    orderBy: [{ dungeonClears: "desc" }],
    select:  { id: true, username: true, element: true, dungeonClears: true },
    getValue: r => r.dungeonClears,
    getExtra: () => "",
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

    // Fetch top 10
    const rows = await (prisma.user.findMany as any)({
      orderBy: type.orderBy,
      select:  type.select,
      take:    10,
      where:   { isOnboarded: true },
    });

    // Find requester's rank
    const allRows = await (prisma.user.findMany as any)({
      orderBy: type.orderBy,
      select:  { id: true, ...type.select },
      where:   { isOnboarded: true },
    });
    const myRank = allRows.findIndex((r: any) => r.id === interaction.user.id) + 1;

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

    // Show requester's position if not in top 10
    let footerText = `CARTETHYIA  ·  ${type.label} Leaderboard`;
    if (myRank > 10 && myRank > 0) {
      const myRow   = allRows.find((r: any) => r.id === interaction.user.id);
      const myName  = memberCache?.get(interaction.user.id)?.displayName ?? interaction.user.displayName;
      const myValue = myRow ? type.getValue(myRow) : 0;
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
