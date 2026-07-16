import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { ELEMENT_COLORS, RARITY_STARS } from "../../lib/echoes";
import { Element } from "@prisma/client";
import { invalidateBonusCache } from "../../lib/setBonus";

const MAX_PRESETS = 10;

const SLOT_LABEL = (s: number) => s === 0 ? "Main" : `Sub ${s}`;

export const data = new SlashCommandBuilder()
  .setName("echo-preset")
  .setDescription("Save and swap echo loadout presets.")
  .addSubcommand(sub =>
    sub.setName("save")
      .setDescription("Save your current equipped echoes as a named preset.")
      .addStringOption(o =>
        o.setName("name").setDescription("Preset name, e.g. 'PvP' or 'Farm'").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("character").setDescription("Which unit's loadout (default: yourself)").setRequired(false)
          .addChoices({ name: "Yourself", value: "self" }, { name: "Solace", value: "solace" })
      )
  )
  .addSubcommand(sub =>
    sub.setName("load")
      .setDescription("Equip a saved preset (replaces current equipped echoes).")
      .addStringOption(o =>
        o.setName("name").setDescription("Preset name to load").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("character").setDescription("Which unit's loadout (default: yourself)").setRequired(false)
          .addChoices({ name: "Yourself", value: "self" }, { name: "Solace", value: "solace" })
      )
  )
  .addSubcommand(sub =>
    sub.setName("list")
      .setDescription("List all your saved presets.")
      .addStringOption(o =>
        o.setName("character").setDescription("Which unit's presets (default: yourself)").setRequired(false)
          .addChoices({ name: "Yourself", value: "self" }, { name: "Solace", value: "solace" })
      )
  )
  .addSubcommand(sub =>
    sub.setName("delete")
      .setDescription("Delete a saved preset.")
      .addStringOption(o =>
        o.setName("name").setDescription("Preset name to delete").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("character").setDescription("Which unit's loadout (default: yourself)").setRequired(false)
          .addChoices({ name: "Yourself", value: "self" }, { name: "Solace", value: "solace" })
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color   = ELEMENT_COLORS[dbUser.element as Element] ?? 0x6366F1;
  const sub     = interaction.options.getSubcommand();
  const characterId = interaction.options.getString("character") ?? "self";

  if      (sub === "save")   await savePreset(interaction, color, characterId);
  else if (sub === "load")   await loadPreset(interaction, color, characterId);
  else if (sub === "list")   await listPresets(interaction, color, characterId);
  else if (sub === "delete") await deletePreset(interaction, color, characterId);
}

// ── save ──────────────────────────────────────────────────────────────────────

async function savePreset(interaction: ChatInputCommandInteraction, color: number, characterId: string) {
  const rawName = interaction.options.getString("name", true).trim();
  const name    = rawName.slice(0, 32);

  const count = await prisma.echoPreset.count({ where: { userId: interaction.user.id, characterId } });
  if (count >= MAX_PRESETS) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setDescription(`⚠  You have ${MAX_PRESETS} presets saved (max). Delete one first.`)],
    });
    return;
  }

  const echoes = await prisma.echo.findMany({
    where:  { userId: interaction.user.id, characterId, isEquipped: true },
    select: { id: true, equippedSlot: true, name: true, rarity: true, cost: true, element: true },
  });

  const slots: Record<string, string | null> = { "0": null, "1": null, "2": null, "3": null, "4": null };
  for (const e of echoes) {
    if (e.equippedSlot !== null && e.equippedSlot !== undefined) {
      slots[String(e.equippedSlot)] = e.id;
    }
  }

  await (prisma as any).echoPreset.upsert({
    where:  { userId_characterId_name: { userId: interaction.user.id, characterId, name } },
    create: { userId: interaction.user.id, characterId, name, slots },
    update: { slots },
  });

  const lines = Object.entries(slots).map(([s, id]) => {
    const e = echoes.find(x => x.id === id);
    return e
      ? `◈  **${SLOT_LABEL(Number(s))}** — ${e.name}  ${RARITY_STARS[e.rarity]}  (${e.cost}-cost)`
      : `◇  **${SLOT_LABEL(Number(s))}** — *empty*`;
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`◈  Preset Saved`)
      .setDescription(`**"${name}"**\n\n${lines.join("\n")}`)
      .setFooter({ text: `CARTETHYIA  ·  Echo Preset  ·  ${echoes.length} echo(es) saved` })],
  });
}

// ── load ──────────────────────────────────────────────────────────────────────

async function loadPreset(interaction: ChatInputCommandInteraction, color: number, characterId: string) {
  const name = interaction.options.getString("name", true).trim();

  const preset = await (prisma as any).echoPreset.findUnique({
    where: { userId_characterId_name: { userId: interaction.user.id, characterId, name } },
  });
  if (!preset) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setDescription(`⚠  No preset named **"${name}"**. Use \`/echo-preset list\` to see yours.`)],
    });
    return;
  }

  const slots = preset.slots as Record<string, string | null>;
  const echoIds = Object.values(slots).filter(Boolean) as string[];

  // Verify ownership
  const valid = echoIds.length > 0
    ? await prisma.echo.findMany({
        where:  { id: { in: echoIds }, userId: interaction.user.id },
        select: { id: true, name: true, rarity: true, cost: true },
      })
    : [];
  const validIdSet = new Set(valid.map(e => e.id));

  // Unequip all current echoes then equip preset echoes atomically
  const equips = Object.entries(slots)
    .filter(([, echoId]) => echoId && validIdSet.has(echoId))
    .map(([slotStr, echoId]) => ({ slot: Number(slotStr), echoId: echoId! }));

  await prisma.$transaction([
    prisma.echo.updateMany({
      where: { userId: interaction.user.id, characterId, isEquipped: true },
      data:  { isEquipped: false, equippedSlot: null },
    }),
    ...equips.map(({ slot, echoId }) =>
      prisma.echo.update({ where: { id: echoId }, data: { isEquipped: true, equippedSlot: slot, characterId } })
    ),
  ]);
  invalidateBonusCache(interaction.user.id, characterId);

  const equipped: string[] = equips.map(({ slot, echoId }) => {
    const e = valid.find(x => x.id === echoId)!;
    return `◈  **${SLOT_LABEL(slot)}** — ${e.name}  ${RARITY_STARS[e.rarity]}`;
  });

  const skipped = echoIds.filter(id => !validIdSet.has(id)).length;
  const note = skipped > 0 ? `\n\n*${skipped} echo(es) no longer owned — those slots left empty.*` : "";

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`◈  Preset Loaded — "${name}"`)
      .setDescription(
        (equipped.length > 0 ? equipped.join("\n") : "*(all slots empty)*") + note
      )
      .setFooter({ text: "CARTETHYIA  ·  Echo Preset" })],
  });
}

// ── list ──────────────────────────────────────────────────────────────────────

async function listPresets(interaction: ChatInputCommandInteraction, color: number, characterId: string) {
  const presets = await (prisma as any).echoPreset.findMany({
    where:   { userId: interaction.user.id, characterId },
    orderBy: { createdAt: "asc" as const },
  });

  if (presets.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription("No presets saved yet.\nUse `/echo-preset save <name>` to save your current loadout.")
        .setFooter({ text: "CARTETHYIA  ·  Echo Presets" })],
    });
    return;
  }

  const lines = presets.map((p: any, i: number) => {
    const count = Object.values(p.slots as Record<string, string | null>).filter(Boolean).length;
    return `**${i + 1}.  ${p.name}**  ·  ${count}/5 echo${count !== 1 ? "es" : ""}`;
  });

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle("◈  Echo Presets")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `CARTETHYIA  ·  ${presets.length}/${MAX_PRESETS} presets used` })],
  });
}

// ── delete ────────────────────────────────────────────────────────────────────

async function deletePreset(interaction: ChatInputCommandInteraction, color: number, characterId: string) {
  const name = interaction.options.getString("name", true).trim();

  const result = await (prisma as any).echoPreset.deleteMany({
    where: { userId: interaction.user.id, characterId, name },
  });

  if (result.count === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setDescription(`⚠  No preset named **"${name}"**.`)],
    });
    return;
  }

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setDescription(`◈  Preset **"${name}"** deleted.`)
      .setFooter({ text: "CARTETHYIA  ·  Echo Presets" })],
  });
}
