// src/lib/solace.ts
// The first real banner character — see design spec §6 for the full kit
// rationale. Replaces src/lib/placeholderAlly.ts, which was always meant to be
// thrown away once a real character existed.
//
// Forte, Wellspring, and Constellations are NOT part of this file — they're
// separate follow-up milestones (2b/2c/2d). Her Ultimate here is the base
// version only (doubles the current Attunement mode for 3 turns); the
// Forte-triggered "Empowered Ultimate -> all 3 modes at once" upgrade requires
// the Forte gauge to exist first.

import { IntroOutroEffect } from "./introOutro";

export const SOLACE = {
  name:  "Solace",
  hpMax: 1100,

  // Intro Skill: instant heal + cleanse, zero ramp-up (design spec §6).
  intro: {
    actions: [
      { type: "HEAL_ALLY",    value: 0.20 },
      { type: "CLEANSE_ALLY", value: 1 },
    ],
  } as IntroOutroEffect,

  // Outro Skill: shields the incoming ally. The "guarantees their next attack
  // crits" half of her Outro (per spec) has no AllyAction primitive for it yet
  // (HEAL/SHIELD/BUFF_ATK/CLEANSE don't cover "arm a guaranteed crit") — a
  // later task wires that part directly in encounter.ts by reusing the
  // existing nextAttackCritArmed variable already in that file (from the Echo
  // Skill system), rather than inventing a new primitive for a single one-off
  // use.
  outro: {
    actions: [
      { type: "SHIELD_ALLY", value: 0.15 },
    ],
  } as IntroOutroEffect,
};

// Ultimate's doubled-Attunement-effect duration (design spec §6: "3 turns").
export const SOLACE_ULTIMATE_DOUBLE_TURNS = 3;

// The player's own personalized character still gets the universal, generic
// Intro/Outro pair from design spec §2 — unrelated to which banner character
// is in the other slot. These lived in the now-deleted placeholderAlly.ts;
// they move here rather than getting a separate file of their own.
export const PLAYER_SELF_INTRO: IntroOutroEffect = { actions: [{ type: "HEAL_ALLY", value: 0.05 }] };
export const PLAYER_SELF_OUTRO: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.05 }] };
