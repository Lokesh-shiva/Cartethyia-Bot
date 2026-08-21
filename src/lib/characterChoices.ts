// src/lib/characterChoices.ts
// Shared autocomplete source for the "character" option that shows up on
// echo/weapon/team-adjacent commands. Discord slash-command choices
// (addChoices) are static and identical for every user, which is why these
// commands used to hardcode "Yourself"/"Solace" only — a player who owns
// Kaelith/Rilo/Vesper had no way to select them at all, and everyone saw
// characters they didn't own. Autocomplete is queried live per invocation,
// so it can be scoped to what the invoking user actually owns.
import { AutocompleteInteraction } from "discord.js";
import prisma from "./prisma";
import { CHARACTER_KITS } from "./characterKit";
import "./kits";

export interface CharacterChoice {
  name:  string;
  value: string;
}

/** "Yourself" plus every character this user owns (has a CharacterProgress row for). */
export async function ownedCharacterChoices(userId: string): Promise<CharacterChoice[]> {
  const owned = await prisma.characterProgress.findMany({
    where:  { userId },
    select: { characterId: true },
  });
  const allyChoices = owned
    .map(o => CHARACTER_KITS[o.characterId])
    .filter((kit): kit is NonNullable<typeof kit> => !!kit)
    .map(kit => ({ name: kit.label, value: kit.id }));
  return [{ name: "Yourself", value: "self" }, ...allyChoices];
}

/**
 * Standard autocomplete handler for a "character" option: shows "Yourself"
 * plus whichever owned characters match what's been typed so far.
 */
export async function handleCharacterAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = await ownedCharacterChoices(interaction.user.id);
  const filtered = choices.filter(c => c.name.toLowerCase().includes(focused)).slice(0, 25);
  await interaction.respond(filtered).catch(() => {});
}
