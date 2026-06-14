import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuInteraction, ButtonBuilder, ButtonStyle,
  ComponentType, ButtonInteraction,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ModalSubmitInteraction, Events, Interaction,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { CE } from "../../lib/emojiManager";
import { Element } from "@prisma/client";

const ELEMENT_COLORS: Record<string, number> = {
  NONE: 0x6366F1, FUSION: 0xFF6B35, GLACIO: 0x4FC3F7,
  ELECTRO: 0xB39DDB, AERO: 0x80CBC4, HAVOC: 0x9C27B0, SPECTRO: 0xFFD54F,
};

// ── Shop catalogue ────────────────────────────────────────────────────────────
type Currency = "credits" | "lunakite";

interface ShopItem {
  id:          string;
  name:        string;
  description: string;
  emoji:       string;
  currency:    Currency;
  price:       number;
  gives:       Partial<Record<string, number>>; // DB field → amount
  quantities:  number[];
}

const SHOP_ITEMS: ShopItem[] = [
  // ── Credits section ────────────────────────────────────────────────────────
  {
    id: "tuning_module", name: "Tuning Module", emoji: "🔧",
    description: "Levels up an Echo's main stat. Cost scales per level.",
    currency: "credits", price: 80,
    gives: { tuningModules: 1 },
    quantities: [1, 3, 5, 10],
  },
  {
    id: "sealing_tube", name: "Sealing Tube", emoji: "🧪",
    description: "Reveals one hidden substat on an Echo.",
    currency: "credits", price: 120,
    gives: { sealingTubes: 1 },
    quantities: [1, 3, 5],
  },
  {
    id: "forging_ore", name: "Forging Ore", emoji: "⚙️",
    description: "Required to craft weapons at /forge.",
    currency: "credits", price: 100,
    gives: { forgingOres: 1 },
    quantities: [1, 3, 5, 10],
  },
  {
    id: "resonance_record", name: "Resonance Record", emoji: "📀",
    description: "Instantly grants one level's worth of EXP. Use with /use record.",
    currency: "credits", price: 500,
    gives: { resonanceRecords: 1 },
    quantities: [1, 3, 5],
  },
  {
    id: "streak_shield", name: "Streak Shield", emoji: "🛡️",
    description: "Automatically saves your /daily streak if you miss a day.",
    currency: "credits", price: 300,
    gives: { streakShields: 1 },
    quantities: [1, 3],
  },
  {
    id: "stasis_lock", name: "Stasis Lock", emoji: "🔒",
    description: "Locks a revealed Echo substat before rerolling. Cost per lock rises exponentially.",
    currency: "credits", price: 500,
    gives: { stasisLocks: 1 },
    quantities: [1, 3],
  },
  {
    id: "paradox_core", name: "Paradox Core", emoji: "🔮",
    description: "Rerolls all unlocked substats on an Echo. Endgame upgrade material.",
    currency: "credits", price: 750,
    gives: { paradoxCores: 1 },
    quantities: [1],
  },
  // ── Lunakite section ───────────────────────────────────────────────────────
  {
    id: "lk_module_bundle", name: "Module Bundle", emoji: "🔧",
    description: "5 Tuning Modules for 1 Lunakite. Better rate than Credits.",
    currency: "lunakite", price: 1,
    gives: { tuningModules: 5 },
    quantities: [1, 3],
  },
  {
    id: "lk_tube_bundle", name: "Tube Bundle", emoji: "🧪",
    description: "3 Sealing Tubes for 1 Lunakite.",
    currency: "lunakite", price: 1,
    gives: { sealingTubes: 3 },
    quantities: [1, 3],
  },
  {
    id: "lk_paradox", name: "Paradox Core", emoji: "🔮",
    description: "1 Paradox Core for 2 Lunakite. Skip the Credits grind.",
    currency: "lunakite", price: 2,
    gives: { paradoxCores: 1 },
    quantities: [1],
  },
  {
    id: "lk_record_bundle", name: "Record Bundle", emoji: "📀",
    description: "3 Resonance Records for 1 Lunakite.",
    currency: "lunakite", price: 1,
    gives: { resonanceRecords: 3 },
    quantities: [1, 3],
  },
];

const CREDITS_ITEMS  = SHOP_ITEMS.filter(i => i.currency === "credits");
const LUNAKITE_ITEMS = SHOP_ITEMS.filter(i => i.currency === "lunakite");

function currencyEmoji(c: Currency) { return c === "credits" ? CE.cr : CE.lk; }
function currencyLabel(c: Currency) { return c === "credits" ? "Credits" : "Lunakite"; }

// ── Command ───────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("shop")
  .setDescription("Browse the Resonance Shop — spend Credits and Lunakite on materials.");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, credits: true, lunakite: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as string] ?? 0x6366F1;

  await showShop(interaction, dbUser.credits, dbUser.lunakite, color);
}

async function showShop(
  interaction: ChatInputCommandInteraction,
  credits: number, lunakite: number, color: number,
) {
  const creditsSection = CREDITS_ITEMS
    .map(i => `${i.emoji}  **${i.name}** — ${i.price} ${CE.cr}  ·  ${i.description}`)
    .join("\n");

  const lunakiteSection = LUNAKITE_ITEMS
    .map(i => `${i.emoji}  **${i.name}** — ${i.price} ${CE.lk}  ·  ${i.description}`)
    .join("\n");

  const shopEmbed = new EmbedBuilder()
    .setColor(color)
    .setTitle("◈  Resonance Shop")
    .setDescription(`Your balance: **${credits.toLocaleString()} ${CE.cr} Credits** · **${lunakite} ${CE.lk} Lunakite**`)
    .addFields(
      { name: `━━  ${CE.cr} Credits Section  ━━`, value: creditsSection, inline: false },
      { name: `━━  ${CE.lk} Lunakite Section  ━━`, value: lunakiteSection, inline: false },
    )
    .setFooter({ text: "CARTETHYIA  ·  Shop  ·  Select an item below to purchase" });

  const creditsSelect = new StringSelectMenuBuilder()
    .setCustomId("shop_credits")
    .setPlaceholder("💠 Buy with Credits…")
    .addOptions(CREDITS_ITEMS.map(i => ({
      label:       `${i.name}  —  ${i.price} Credits`,
      description: i.description.slice(0, 100),
      value:       i.id,
      emoji:       i.emoji,
    })));

  const lunakiteSelect = new StringSelectMenuBuilder()
    .setCustomId("shop_lunakite")
    .setPlaceholder("🌙 Buy with Lunakite…")
    .addOptions(LUNAKITE_ITEMS.map(i => ({
      label:       `${i.name}  —  ${i.price} Lunakite`,
      description: i.description.slice(0, 100),
      value:       i.id,
      emoji:       i.emoji,
    })));

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(creditsSelect);
  const row2 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(lunakiteSelect);

  await interaction.editReply({ embeds: [shopEmbed], components: [row1, row2] });

  const collector = interaction.channel?.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: i => i.user.id === interaction.user.id && (i.customId === "shop_credits" || i.customId === "shop_lunakite"),
    time:   120_000,
    max:    1,
  });

  collector?.on("collect", async (sel: StringSelectMenuInteraction) => {
    const item = SHOP_ITEMS.find(i => i.id === sel.values[0]);
    if (!item) { await sel.update({ content: "Item not found.", components: [], embeds: [] }); return; }

    await showQuantityPicker(sel, item, color);
  });

  collector?.on("end", async (col) => {
    if (col.size === 0) await interaction.editReply({ components: [] }).catch(() => {});
  });
}

async function showQuantityPicker(
  sel: StringSelectMenuInteraction,
  item: ShopItem,
  color: number,
) {
  const qtyButtons = item.quantities.map(q =>
    new ButtonBuilder()
      .setCustomId(`shop_qty_${q}`)
      .setLabel(`×${q}  —  ${(item.price * q).toLocaleString()} ${currencyEmoji(item.currency)}`)
      .setStyle(ButtonStyle.Secondary)
  );

  const customBtn = new ButtonBuilder()
    .setCustomId("shop_custom")
    .setLabel("Custom Amount")
    .setStyle(ButtonStyle.Primary);

  const cancelBtn = new ButtonBuilder()
    .setCustomId("shop_cancel")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Danger);

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const allBtns = [...qtyButtons, customBtn, cancelBtn];
  for (let i = 0; i < allBtns.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(allBtns.slice(i, i + 5)));
  }

  const givesText = Object.entries(item.gives)
    .map(([k, v]) => `${v} ${k.replace(/([A-Z])/g, ' $1').trim()}`)
    .join(", ");

  await sel.update({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${item.emoji}  ${item.name}`)
      .setDescription(
        `${item.description}\n\n` +
        `**Gives:** ${givesText} per purchase\n` +
        `**Price:** ${item.price} ${currencyEmoji(item.currency)} ${currencyLabel(item.currency)} each\n\n` +
        `How many do you want?`
      )
      .setFooter({ text: "CARTETHYIA  ·  Shop  ·  Expires in 60s" })],
    components: rows,
  });

  const btnCollector = sel.channel?.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: b => b.user.id === sel.user.id && (b.customId.startsWith("shop_qty_") || b.customId === "shop_cancel" || b.customId === "shop_custom"),
    time:   60_000,
    max:    1,
  });

  btnCollector?.on("collect", async (btn: ButtonInteraction) => {
    if (btn.customId === "shop_cancel") {
      await btn.deferUpdate();
      await btn.editReply({ embeds: [new EmbedBuilder().setColor(color).setDescription("Purchase cancelled.")], components: [] });
      return;
    }

    if (btn.customId === "shop_custom") {
      const modal = new ModalBuilder()
        .setCustomId("shop_qty_modal")
        .setTitle(`Buy ${item.name}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("shop_qty_input")
              .setLabel(`Quantity (${item.price.toLocaleString()} ${currencyLabel(item.currency)} each)`)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("e.g. 50")
              .setMinLength(1).setMaxLength(6).setRequired(true)
          )
        );
      await btn.showModal(modal);

      // Listen for modal submit via client event
      const submitted = await new Promise<ModalSubmitInteraction | null>((resolve) => {
        const tid = setTimeout(() => {
          btn.client.off(Events.InteractionCreate, handler);
          resolve(null);
        }, 60_000);
        const handler = (intr: Interaction) => {
          if (
            intr.isModalSubmit() &&
            intr.customId === "shop_qty_modal" &&
            intr.user.id === btn.user.id
          ) {
            clearTimeout(tid);
            btn.client.off(Events.InteractionCreate, handler);
            resolve(intr as ModalSubmitInteraction);
          }
        };
        btn.client.on(Events.InteractionCreate, handler);
      });

      if (!submitted) { await sel.editReply({ components: [] }).catch(() => {}); return; }

      try { await (submitted as any).deferUpdate(); } catch {}

      const qtyStr = submitted.fields.getTextInputValue("shop_qty_input").trim();
      const qty    = parseInt(qtyStr);
      if (isNaN(qty) || qty < 1) {
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D).setDescription("⚠  Enter a valid number greater than 0.")],
          components: [],
        });
        return;
      }
      await processPurchase(sel, item, qty, color);
      return;
    }

    // Fixed quantity buttons
    await btn.deferUpdate();
    const qty = parseInt(btn.customId.replace("shop_qty_", ""));
    await processPurchase(sel, item, qty, color);
  });

  btnCollector?.on("end", async (col) => {
    if (col.size === 0) await sel.editReply({ components: [] }).catch(() => {});
  });
}

async function processPurchase(
  interaction: StringSelectMenuInteraction,
  item: ShopItem,
  qty: number,
  color: number,
) {
  const total     = item.price * qty;
  const freshUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { credits: true, lunakite: true },
  });

  const balance = item.currency === "credits" ? (freshUser?.credits ?? 0) : (freshUser?.lunakite ?? 0);
  if (balance < total) {
    const maxAffordable = Math.floor(balance / item.price);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF4F6D)
        .setDescription(
          `⚠  Not enough ${currencyLabel(item.currency)}.\n` +
          `Need **${total.toLocaleString()}**, have **${balance.toLocaleString()}**.\n` +
          (maxAffordable > 0 ? `You can afford up to **×${maxAffordable}**.` : "")
        )
        .setFooter({ text: "CARTETHYIA  ·  Shop" })],
      components: [],
    });
    return;
  }

  const deduct: Record<string, any> = { [item.currency]: { decrement: total } };
  const gains:  Record<string, any> = {};
  for (const [field, amt] of Object.entries(item.gives)) {
    gains[field] = { increment: (amt ?? 0) * qty };
  }

  await prisma.user.update({ where: { id: interaction.user.id }, data: { ...deduct, ...gains } });

  const givesLines = Object.entries(item.gives)
    .map(([k, v]) => `› +${(v ?? 0) * qty} ${k.replace(/([A-Z])/g, ' $1').trim()}`)
    .join("\n");

  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`${item.emoji}  Purchase Complete`)
      .setDescription(
        `**${item.name} × ${qty}** purchased for **${total.toLocaleString()} ${currencyEmoji(item.currency)}**.\n\n` +
        `${givesLines}\n\n` +
        `Remaining balance: **${(balance - total).toLocaleString()} ${currencyEmoji(item.currency)}**`
      )
      .setFooter({ text: "CARTETHYIA  ·  Shop" })],
    components: [],
  });
}
