import { SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, EmbedBuilder } from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { resolvePlayerBonuses, applyBonuses } from "../../lib/setBonus";
import { ELEMENT_EMOJI } from "../../lib/echoes";
import { describeEchoSkill } from "../../lib/echoSkills";
import { describeWeaponPassiveForRow } from "../../lib/weapons";
import { ALL_WISH_WEAPONS, calcWishSubStat } from "../../lib/wishWeapons";
import { bondMultiplier } from "../../lib/weaponAwakening";
import { CHARACTER_KITS } from "../../lib/characterKit";
import "../../lib/kits";
import { ownedCharacterChoices } from "../../lib/characterChoices";
import {
  classifyBonusLabels,
  autocompleteTargetUserId,
  formatCharacterKitLines,
  formatCombatStatBlock,
  truncateDiscordField,
} from "../../lib/statsDisplay";
import { Element } from "@prisma/client";

const ELEMENT_HEX: Record<string, number> = {
  FUSION: 0xFF6B35, GLACIO: 0x38BDF8, ELECTRO: 0xA855F7,
  AERO:   0x10B981, HAVOC:  0xEC4899, SPECTRO: 0xEAB308, NONE: 0x6366F1,
};

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View your final combat stats — all weapon, echo and element bonuses applied.")
  .addUserOption(o =>
    o.setName("user").setDescription("View another player's stats").setRequired(false)
  )
  .addStringOption(o =>
    o.setName("character")
      .setDescription("View one of that player's obtained characters separately")
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const targetId = autocompleteTargetUserId(interaction.options.get("user")?.value, interaction.user.id);
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = (await ownedCharacterChoices(targetId))
    .filter(choice => choice.value !== "self")
    .filter(choice => choice.name.toLowerCase().includes(focused))
    .slice(0, 25);
  await interaction.respond(choices).catch(() => {});
}

function baseStatBlock(base: { hpMax: number; baseAtk: number; baseDef: number; baseSpeed: number; critRate: number; critDmg: number }): string {
  return [
    `❤️ HP — **${base.hpMax.toLocaleString()}**`,
    `⚔️ ATK — **${base.baseAtk.toLocaleString()}**`,
    `🛡️ DEF — **${base.baseDef.toLocaleString()}**`,
    `💨 SPD — **${base.baseSpeed}**`,
    `🎯 Crit Rate — **${(base.critRate * 100).toFixed(1)}%**`,
    `💥 Crit DMG — **${(base.critDmg * 100).toFixed(1)}%**`,
  ].join("\n");
}

function formatWeaponSubstat(type: string | null, value: number | null): string | null {
  if (!type || value == null || value === 0) return null;
  switch (type) {
    case "HP_PERCENT":      return `HP +${value}%`;
    case "ATK_PERCENT":     return `ATK +${value}%`;
    case "DEF_PERCENT":     return `DEF +${value}%`;
    case "CRIT_RATE":       return `Crit Rate +${value}%`;
    case "CRIT_DMG":        return `Crit DMG +${value}%`;
    case "ELEMENTAL_DMG":   return `Elemental DMG +${value}%`;
    case "ENERGY_REGEN":    return `Energy/turn +${value / 2}`;
    case "SPEED":            return `SPD +${value}`;
    default:                 return `${type} +${value}`;
  }
}

function weaponStatLines(weapon: {
  name: string; level: number; subStatType: string | null; subStatVal: number | null;
  hiddenSub1Type: string | null; hiddenSub1Val: number | null;
  hiddenSub2Type: string | null; hiddenSub2Val: number | null;
  awakened: boolean; weaponBond: number;
}): string[] {
  const bondMult = weapon.awakened ? bondMultiplier(weapon.weaponBond ?? 0) : 1;
  const lines: string[] = [];
  if (weapon.subStatVal != null) {
    const raw = Math.round((weapon.subStatVal * (1 + (weapon.level - 1) * 0.8 / 89)) * 10) / 10;
    const value = Math.round(raw * bondMult * 10) / 10;
    const line = formatWeaponSubstat(weapon.subStatType, value);
    if (line) lines.push(`◌ ${line}`);
  }
  const wishDef = ALL_WISH_WEAPONS.find(w => w.name === weapon.name);
  const hidden = [
    { type: weapon.hiddenSub1Type, value: weapon.hiddenSub1Val, unlock: 20, scale: wishDef?.hiddenSub1Scale ?? 1.8 },
    { type: weapon.hiddenSub2Type, value: weapon.hiddenSub2Val, unlock: 50, scale: wishDef?.hiddenSub2Scale ?? 1.8 },
  ];
  for (const slot of hidden) {
    if (weapon.level < slot.unlock || slot.value == null) continue;
    const value = Math.round(calcWishSubStat(slot.value, slot.scale, weapon.level) * bondMult * 10) / 10;
    const line = formatWeaponSubstat(slot.type, value);
    if (line) lines.push(`◌ Hidden ${line}`);
  }
  return lines;
}

async function renderCharacterStats(
  interaction: ChatInputCommandInteraction,
  target: NonNullable<ReturnType<ChatInputCommandInteraction["options"]["getUser"]>>,
  displayName: string,
  characterId: string,
  color: number,
): Promise<void> {
  const kit = CHARACTER_KITS[characterId];
  if (!kit) {
    await interaction.editReply({ content: "That character is not available." });
    return;
  }

  // Do not use getOrCreateCharacterProgress here: viewing stats must never
  // create ownership for a character the player has not obtained.
  const progress = await prisma.characterProgress.findUnique({
    where: { userId_characterId: { userId: target.id, characterId } },
  });
  if (!progress) {
    await interaction.editReply({ content: `${displayName} hasn't obtained **${kit.label}**.` });
    return;
  }

  const [resolved, bonuses, weapon, echoes] = await Promise.all([
    kit.resolveStats(target.id),
    resolvePlayerBonuses(target.id, characterId),
    prisma.weapon.findFirst({
      where: { userId: target.id, characterId, isEquipped: true },
      select: {
        name: true, level: true, rarity: true, refinement: true,
        subStatType: true, subStatVal: true,
        hiddenSub1Type: true, hiddenSub1Val: true, hiddenSub2Type: true, hiddenSub2Val: true,
        weaponBond: true,
        awakened: true, awakenedName: true, awakenedPassive: true,
      },
    }),
    prisma.echo.findMany({
      where: { userId: target.id, characterId, isEquipped: true },
      orderBy: { equippedSlot: "asc" },
      select: { name: true, cost: true, level: true, element: true, equippedSlot: true },
    }),
  ]);

  const base = kit.statsAtLevel(progress.level);
  const statBlock = formatCombatStatBlock(
    {
      hp: base.hpMax, atk: base.baseAtk, def: base.baseDef, spd: base.baseSpeed,
      critRate: base.critRate, critDmg: base.critDmg,
    },
    resolved,
    bonuses,
    ELEMENT_EMOJI[kit.element as Element] ?? "◇",
  );
  const sources = classifyBonusLabels(bonuses.activeLabels);

  const weaponLines = weapon
    ? [
        `${sources.weapon[0] ?? `🗡️ ${weapon.name} Lv${weapon.level}`} · R${weapon.refinement}`,
        ...weaponStatLines(weapon),
        describeWeaponPassiveForRow(weapon) || "*No passive effect.*",
      ]
    : ["*No weapon equipped.*"];

  const echoLines = echoes.length > 0
    ? echoes.map(e => `${e.equippedSlot === 0 ? "Main" : `Sub ${e.equippedSlot ?? "?"}`} · **${e.name}** · Lv${e.level}`)
    : ["*No echoes equipped.*"];
  if (bonuses.echoSkill) {
    echoLines.push(`🌟 **${bonuses.echoSkill.name}** — ${describeEchoSkill(bonuses.echoSkill)}`);
  }
  if (sources.echoes.length > 0) echoLines.push(...sources.echoes);

  const effectLines = sources.effects.length > 0
    ? sources.effects.map(line => `› ${line}`)
    : ["*No active elemental or set effects.*"];
  const abilityLines = formatCharacterKitLines({
    basicLevel: progress.basicLevel,
    basicMultiplier: kit.basicDamageMult(progress.basicLevel),
    skillLevel: progress.skillLevel,
    skillCooldownTurns: kit.skillCooldownTurns,
    ultimateLevel: progress.ultimateLevel,
    introLevel: progress.introLevel,
    forteLevel: progress.forteLevel,
    constellation: progress.constellation,
    maxConstellation: kit.maxConstellation,
  });

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${displayName}  ·  ${kit.emoji} ${kit.label}  ·  Lv${progress.level}`,
      iconURL: target.displayAvatarURL({ size: 64, extension: "png" }),
    })
    .addFields(
      { name: "◈  Final Character Stats (all bonuses applied)", value: statBlock, inline: false },
      { name: "◇  Base Stats (before equipment and effects)", value: baseStatBlock(base), inline: true },
      { name: "⚔️  Abilities & Progress", value: abilityLines.join("\n"), inline: true },
      { name: "🗡️  Weapon Effects", value: truncateDiscordField(weaponLines.join("\n")), inline: false },
      { name: "◈  Echoes & Echo Skill", value: truncateDiscordField(echoLines.join("\n")), inline: false },
      { name: "✦  Element & Set Effects", value: truncateDiscordField(effectLines.join("\n")), inline: false },
    )
    .setFooter({ text: "CARTETHYIA  ·  Character Stats  ·  Exact numbers used in combat" });

  await interaction.editReply({ embeds: [embed] });
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const target      = interaction.options.getUser("user") ?? interaction.user;
  const characterId = interaction.options.getString("character");
  const member      = interaction.guild?.members.cache.get(target.id);
  const displayName = member?.displayName ?? target.displayName;

  const dbUser = await prisma.user.findUnique({
    where:  { id: target.id },
    select: {
      level: true, worldLevel: true, element: true,
      baseHp: true, baseAtk: true, baseDef: true, baseSpeed: true,
      critRate: true, critDmg: true,
    },
  });
  if (!dbUser) {
    if (target.id === interaction.user.id) { await replyNotStarted(interaction); return; }
    await interaction.editReply({ content: `${displayName} hasn't started their journey yet.` });
    return;
  }

  if (characterId && characterId !== "self") {
    const kit = CHARACTER_KITS[characterId];
    const color = kit ? (ELEMENT_HEX[kit.element] ?? ELEMENT_HEX.NONE) : ELEMENT_HEX.NONE;
    await renderCharacterStats(interaction, target, displayName, characterId, color);
    return;
  }

  const bonuses = await resolvePlayerBonuses(target.id);
  const stats   = applyBonuses(dbUser, bonuses);
  const element = dbUser.element as Element;
  const color   = ELEMENT_HEX[element] ?? ELEMENT_HEX.NONE;

  const statBlock = formatCombatStatBlock(
    {
      hp: dbUser.baseHp, atk: dbUser.baseAtk, def: dbUser.baseDef, spd: dbUser.baseSpeed,
      critRate: dbUser.critRate, critDmg: dbUser.critDmg,
    },
    stats,
    bonuses,
    ELEMENT_EMOJI[element] ?? "◇",
  );

  const bonusText = bonuses.activeLabels.length === 0
    ? "*No active bonuses — equip a weapon and echoes to power up.*"
    : bonuses.activeLabels.map(l => `› ${l}`).join("\n");
  const bonusValue = truncateDiscordField(bonusText);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: `${displayName}  ·  Combat Stats  ·  Lv${dbUser.level}  WL${dbUser.worldLevel}`,
      iconURL: target.displayAvatarURL({ size: 64, extension: "png" }),
    })
    .addFields(
      { name: "◈  Final Stats (all bonuses applied)", value: statBlock, inline: false },
      { name: "✦  Bonus Sources", value: bonusValue, inline: false },
    )
    .setFooter({ text: "CARTETHYIA  ·  Stats  ·  These are the exact numbers used in combat" });

  await interaction.editReply({ embeds: [embed] });
}
