// src/lib/characterElements.ts
// Maps a playable ally's characterId to their own fixed element — used so an
// ally's innate element bonus (setBonus.ts's ELEMENT_PASSIVES) comes from
// THEIR element, not whichever element the human player happens to have
// chosen. A standalone file rather than importing CHARACTER_KITS here:
// setBonus.ts is imported very broadly across the codebase, and
// characterKit.ts already imports ResolvedStats FROM setBonus.ts — importing
// the kit registry back into setBonus.ts would create a circular import.
// Keep this map in sync by hand when a new character is added (matches the
// project's existing convention of small per-character lookup tables, e.g.
// character.ts's CHARACTERS registry itself).
export const CHARACTER_ELEMENTS: Record<string, string> = {
  solace: "SPECTRO",
};
