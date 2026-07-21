// src/lib/pagination.ts
// Shared 10-per-page pagination for select-menu-based item browsing (weapons,
// echoes, etc.) — used wherever a list can exceed Discord's 25-option select
// cap and a plain slice(0, 25) would silently hide the rest.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export const PAGE_SIZE = 10;

export function pageSlice<T>(items: T[], page: number): T[] {
  return items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
}

export function pageCount(itemCount: number): number {
  return Math.max(1, Math.ceil(itemCount / PAGE_SIZE));
}

// customIdPrefix should be unique per paginated list on screen at once (e.g.
// "wr_keeper_page" vs "wr_dupe_page") so two lists in the same flow never
// collide on button customId.
export function buildPageNavRow(customIdPrefix: string, page: number, count: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:prev`)
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:next`)
      .setLabel(`Page ${page + 1}/${count}  ▶`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= count - 1),
  );
}
