// ── Per-fight mutable state for the 6 new field bosses' unique mechanics ─────
// One of these is created per fight (via initFieldBossMechanicState) and passed
// into whichever hook matches the fought boss's `mechanicId`. Every hook here is
// boss-turn-only — none of them need to see the player's attack roll, only the
// damage numbers already computed by the time the boss's turn runs.
export interface FieldBossMechanicState {
  moltenStacks:             number;  // Cinderbound Colossus — builds each boss turn, max 4
  frostBarrierCd:           number;  // Cryoveil Warden — turns until the self-heal can trigger again
  energySurge:              number;  // Thundercrown Herald — boss's own energy, 0-100
  momentumStacks:           number;  // Galebound Sovereign — builds while un-pressured, max 5
  lifestealFrenzyUsed:      boolean; // Voidmaw Devourer — once-per-fight low-HP frenzy
  lifestealFrenzyTurnsLeft: number;
  regenStreak:              number;  // Lumenwrought Seraph — consecutive pressured boss turns
}

export function initFieldBossMechanicState(): FieldBossMechanicState {
  return {
    moltenStacks: 0,
    frostBarrierCd: 0,
    energySurge: 0,
    momentumStacks: 0,
    lifestealFrenzyUsed: false, lifestealFrenzyTurnsLeft: 0,
    regenStreak: 0,
  };
}

// ── Cinderbound Colossus — Molten Buildup ──────────────────────────────────
// Builds a stack each boss turn (max 4). Using Skill/Ultimate that round fully
// vents the buildup (an "interrupt"). At 4 stacks, the boss's move gets +75%
// bonus damage and stacks reset.
export function moltenBuildupOnBossTurn(
  state: FieldBossMechanicState, interrupted: boolean,
): { bonusDmgMult: number; erupted: boolean } {
  if (interrupted) {
    // Full vent, not a partial reduction: with Skill's 3-turn cooldown and a 4-turn
    // buildup, a partial reduction (e.g. -2) still lets the boss rebuild to eruption
    // faster than Skill comes off cooldown again, making the "interrupt" counterplay
    // nearly unusable in practice (players don't see the boss's exact stack count).
    // A full reset gives clean, learnable counterplay: interrupt at least once every
    // 4 rounds and the eruption never happens.
    state.moltenStacks = 0;
    return { bonusDmgMult: 0, erupted: false };
  }
  state.moltenStacks = Math.min(4, state.moltenStacks + 1);
  if (state.moltenStacks >= 4) {
    state.moltenStacks = 0;
    return { bonusDmgMult: 0.75, erupted: true };
  }
  return { bonusDmgMult: 0, erupted: false };
}

// ── Cryoveil Warden — Frost Barrier ────────────────────────────────────────
// Every 3rd available turn (2-turn cooldown after triggering either way), the
// Warden heals 8% of its max HP — UNLESS the player's last hit crossed a burst
// threshold (6% of the Warden's max HP), in which case the heal is denied.
export function frostBarrierOnBossTurn(
  state: FieldBossMechanicState, playerDmgThisRound: number, bossMaxHp: number,
): { healed: number } {
  if (state.frostBarrierCd > 0) {
    state.frostBarrierCd--;
    return { healed: 0 };
  }
  state.frostBarrierCd = 2;
  // 6% (not 12%) of max HP — reachable by a solid Skill hit or crit even for
  // sustained-DPS builds. A higher threshold let sustained builds never deny the
  // heal at all while burst builds trivially denied it forever, an unfair
  // asymmetry against non-burst playstyles.
  const burstThreshold = bossMaxHp * 0.06;
  if (playerDmgThisRound >= burstThreshold) return { healed: 0 };
  return { healed: Math.floor(bossMaxHp * 0.08) };
}

// ── Thundercrown Herald — Energy Surge ─────────────────────────────────────
// Gains 30 energy every boss turn. At 100, unleashes an Overcharge — +90%
// bonus damage on top of its normal move — then resets to 0.
export function energySurgeOnBossTurn(
  state: FieldBossMechanicState,
): { overcharged: boolean; bonusDmgMult: number } {
  state.energySurge = Math.min(100, state.energySurge + 30);
  if (state.energySurge >= 100) {
    state.energySurge = 0;
    return { overcharged: true, bonusDmgMult: 0.90 };
  }
  return { overcharged: false, bonusDmgMult: 0 };
}

// ── Galebound Sovereign — Momentum Gust ────────────────────────────────────
// Builds a stack each boss turn the player's damage that round stayed below a
// pressure threshold (6% of the Sovereign's max HP — matching the precedent
// established for Frost Barrier, where ~4% of max HP is roughly an average
// single hit and 6% was found reachable by a solid hit/crit even for
// sustained-DPS builds; the original 10% threshold reproduced the same
// unreachable-for-sustained-builds bug, but with a worse consequence — a
// guaranteed periodic damage burst instead of a merely-denied heal) — being
// passive lets it build momentum. Landing hits above the threshold knocks a
// stack off instead. At 5 stacks, releases a bonus +100% damage gust and resets.
export function momentumGustOnBossTurn(
  state: FieldBossMechanicState, playerDmgThisRound: number, bossMaxHp: number,
): { bonusDmgMult: number; released: boolean } {
  const pressureThreshold = bossMaxHp * 0.06;
  if (playerDmgThisRound >= pressureThreshold) {
    state.momentumStacks = Math.max(0, state.momentumStacks - 1);
    return { bonusDmgMult: 0, released: false };
  }
  state.momentumStacks = Math.min(5, state.momentumStacks + 1);
  if (state.momentumStacks >= 5) {
    state.momentumStacks = 0;
    return { bonusDmgMult: 1.0, released: true };
  }
  return { bonusDmgMult: 0, released: false };
}

// ── Voidmaw Devourer — Lifesteal Frenzy ────────────────────────────────────
// Heals 25% of the damage it deals each turn. Once per fight, when its own HP
// drops below 40%, enters a 3-turn Frenzy granting +35% ATK. The trigger check
// and the "is Frenzy active this turn" read happen in the SAME call, before any
// decrement — so the triggering turn itself gets the bonus, and it decays
// cleanly over exactly 3 turns with no off-by-one compensation needed (unlike
// several of the player-side named-set buffs in the prior combat-wiring plan,
// which trigger-then-get-decremented across two separate points in the turn).
export function lifestealFrenzyOnBossTurn(
  state: FieldBossMechanicState, bossDmgDealt: number, bossHpNow: number, bossMaxHp: number,
): { selfHeal: number; frenzyTriggered: boolean; frenzyActive: boolean; atkMult: number } {
  const selfHeal = Math.floor(bossDmgDealt * 0.25);
  let frenzyTriggered = false;
  if (!state.lifestealFrenzyUsed && bossHpNow / bossMaxHp < 0.40) {
    state.lifestealFrenzyUsed = true;
    state.lifestealFrenzyTurnsLeft = 3;
    frenzyTriggered = true;
  }
  const frenzyActive = state.lifestealFrenzyTurnsLeft > 0;
  if (state.lifestealFrenzyTurnsLeft > 0) state.lifestealFrenzyTurnsLeft--;
  return { selfHeal, frenzyTriggered, frenzyActive, atkMult: frenzyActive ? 1.35 : 1.0 };
}

// ── Lumenwrought Seraph — Steady Regen ─────────────────────────────────────
// Heals 4% of its max HP every boss turn — UNLESS the player has landed hits
// above a pressure threshold (8% of the Seraph's max HP) for 2 consecutive
// rounds, which breaks the regen for that turn.
export function steadyRegenOnBossTurn(
  state: FieldBossMechanicState, playerDmgThisRound: number, bossMaxHp: number,
): { healed: number; regenBroken: boolean } {
  const pressureThreshold = bossMaxHp * 0.08;
  if (playerDmgThisRound >= pressureThreshold) {
    state.regenStreak = Math.min(2, state.regenStreak + 1);
  } else {
    state.regenStreak = 0;
  }
  if (state.regenStreak >= 2) return { healed: 0, regenBroken: true };
  return { healed: Math.floor(bossMaxHp * 0.04), regenBroken: false };
}
