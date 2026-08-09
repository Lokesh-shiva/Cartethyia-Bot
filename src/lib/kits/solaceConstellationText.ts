// src/lib/kits/solaceConstellationText.ts
// Solace's 6 constellation flavor-text descriptions, moved here so
// solaceKit.ts can expose them via the PlayableCharacterKit interface
// without importing from a command file. character.ts's existing
// CONSTELLATION_EFFECTS["solace"] entry is untouched — this is a copy for
// the new kit object to reference, not a replacement (character.ts's map
// stays the source of truth used by the live /character command until
// Kaelith's build actually migrates character.ts to read from
// CHARACTER_KITS instead of CONSTELLATION_EFFECTS).
export const CONSTELLATION_EFFECTS_SOLACE: string[] = [
  "Outro's guaranteed-crit buff also grants the incoming ally +15% ATK for their first action after the swap.",
  "**(Kit change)** Ultimate's heal increased from 30-60% max HP to 45-75% max HP (scales with Ultimate level); cleanses 2 debuffs instead of 1.",
  "Switching Attunement Mode (Skill) also grants a team-wide Concerto Energy burst.",
  "**(Kit change)** Intro Skill's heal also grants a shield equal to 30% of the amount healed.",
  "Ultimate's doubled-mode-effect duration extends from 3 turns to 4.",
  "**(Defining)** While one Attunement Mode is active, allies ALSO gain 50% of the other two modes' effects.",
];
