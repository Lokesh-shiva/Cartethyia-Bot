import {
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ComponentType, ButtonInteraction,
  TextChannel, AttachmentBuilder,
} from "discord.js";
import prisma from "./prisma";

export const ELEMENTS = [
  { value: "FUSION",  emoji: "🔥", label: "Fusion",  color: 0xFF6B35, desc: "+15% ATK, +15% Crit, +20% Elem DMG  ·  IGNITE: 35% → +25% ATK"           },
  { value: "GLACIO",  emoji: "❄️", label: "Glacio",  color: 0x38BDF8, desc: "+30% DEF, +15% HP, +20% Elem DMG  ·  FROST_SHIELD: 25% → absorb 40%"   },
  { value: "ELECTRO", emoji: "⚡", label: "Electro", color: 0xA855F7, desc: "+5% Crit, +20% Crit DMG, +25 Eng/turn  ·  DISCHARGE: crit → +20 eng"    },
  { value: "AERO",    emoji: "🌪️", label: "Aero",    color: 0x10B981, desc: "+15% ATK, +40% Crit DMG, +20% Elem DMG  ·  WINDSTRIDE: +8% DMG/turn ×5" },
  { value: "HAVOC",   emoji: "🌑", label: "Havoc",   color: 0xEC4899, desc: "+15% ATK, +20% Lifesteal, +20% Elem DMG  ·  VOID_SURGE: Shatter → +25% HP" },
  { value: "SPECTRO", emoji: "✨", label: "Spectro", color: 0xEAB308, desc: "+30% HP, +20% Elem DMG  ·  RADIANCE: 2% regen + <40% HP: +25% Crit"      },
];

/**
 * Send the element selection prompt to a channel.
 * Called automatically when the player hits Level 20.
 */
export async function sendElementSelection(
  userId:      string,
  displayName: string,
  channel:     TextChannel
) {
  // Already has element — skip
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { element: true } });
  if (user?.element && user.element !== "NONE") return;

  const embed = new EmbedBuilder()
    .setColor(0x6366F1)
    .setTitle("✦ Resonance Awakening")
    .setDescription([
      `**${displayName}** — you have reached **Level 20**.`,
      ``,
      `The path to Ascension is open.`,
      `But first, you must choose your **Elemental Resonance**.`,
      ``,
      `This defines your combat identity, your profile, and will shape`,
      `the **unique ability** you forge at your first Ascension.`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ELEMENTS.map((e) => `${e.emoji}  **${e.label}** — ${e.desc}`).join("\n"),
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `*This choice is permanent. Choose with intention.*`,
    ].join("\n"))
    .setFooter({ text: "CARTETHYIA  ·  Resonance Awakening" });

  // Two rows of 3 buttons each
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ELEMENTS.slice(0, 3).map((e) =>
      new ButtonBuilder()
        .setCustomId(`element_select_${e.value}`)
        .setLabel(`${e.emoji}  ${e.label}`)
        .setStyle(ButtonStyle.Secondary)
    )
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ELEMENTS.slice(3).map((e) =>
      new ButtonBuilder()
        .setCustomId(`element_select_${e.value}`)
        .setLabel(`${e.emoji}  ${e.label}`)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const msg = await channel.send({
    content: `<@${userId}>`,
    embeds:  [embed],
    components: [row1, row2],
  });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (b) => b.user.id === userId && b.customId.startsWith("element_select_"),
    time:   24 * 60 * 60 * 1000, // 24 hours to decide
    max:    1,
  });

  collector.on("collect", async (btn: ButtonInteraction) => {
    await btn.deferUpdate();

    const chosen  = ELEMENTS.find((e) => `element_select_${e.value}` === btn.customId)!;

    // Save to DB
    await prisma.user.update({
      where: { id: userId },
      data:  { element: chosen.value as any },
    });

    // Update resonanceProfile element field
    const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { resonanceProfile: true } });
    if (dbUser?.resonanceProfile) {
      const profile = dbUser.resonanceProfile as any;
      profile.element = chosen.value;
      await prisma.user.update({ where: { id: userId }, data: { resonanceProfile: profile } });
    }

    // Disable all buttons
    const disabledRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ELEMENTS.slice(0, 3).map((e) =>
        new ButtonBuilder()
          .setCustomId(`d_${e.value}`)
          .setLabel(`${e.emoji}  ${e.label}`)
          .setStyle(e.value === chosen.value ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
    const disabledRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ELEMENTS.slice(3).map((e) =>
        new ButtonBuilder()
          .setCustomId(`d_${e.value}`)
          .setLabel(`${e.emoji}  ${e.label}`)
          .setStyle(e.value === chosen.value ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );

    await msg.edit({ components: [disabledRow1, disabledRow2] });

    // Confirmation
    await btn.followUp({
      embeds: [
        new EmbedBuilder()
          .setColor(chosen.color)
          .setTitle(`${chosen.emoji}  ${chosen.label} Resonance Awakened`)
          .setDescription([
            `Your element has been set to **${chosen.label}**.`,
            ``,
            `◈  ${chosen.desc}`,
            ``,
            `Your profile and profile card will now reflect your element.`,
            `Use **/ascend** when you are ready to face the trial.`,
          ].join("\n"))
          .setFooter({ text: "CARTETHYIA  ·  Resonance Awakening" }),
      ],
    });
  });
}
