// src/lib/placeholderAlly.ts
// Milestone 1 test fixture — a single hardcoded teammate used ONLY to prove the
// multi-unit swap mechanic works in one real combat loop. NOT real character
// content (that's Milestone 2's Solace). Delete or replace this file once real
// banner characters exist.
//
// Also defines the player's own character's Intro/Outro — per design spec §2,
// the player's personalized character gets a universal, generic, non-authored
// pair (not a real kit) so the "swap = Outro + Intro" turn-cost payoff doesn't
// structurally break for 1 of every team's slots.

import { IntroOutroEffect } from "./introOutro";

export const PLACEHOLDER_ALLY = {
  name:  "Training Dummy",
  hpMax: 800,
  intro: { actions: [{ type: "HEAL_ALLY", value: 0.15 }] } as IntroOutroEffect,
  outro: { actions: [{ type: "SHIELD_ALLY", value: 0.10 }] } as IntroOutroEffect,
};

export const PLAYER_SELF_INTRO: IntroOutroEffect = { actions: [{ type: "HEAL_ALLY", value: 0.05 }] };
export const PLAYER_SELF_OUTRO: IntroOutroEffect = { actions: [{ type: "SHIELD_ALLY", value: 0.05 }] };
