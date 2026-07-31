// src/lib/teamPositions.ts
// Shared helpers for the 3-position team roster (teamPosition1/2/3 on User).
// "self" represents the player's own character occupying a position;
// anything else is a characterId. Centralizes position-resolution, KO
// fallback, and swap-dropdown construction so all 7 combat loops don't
// each reimplement this bookkeeping by hand.

export type TeamPositionValue = "self" | string; // "self" | characterId
export type PositionIndex = 1 | 2 | 3;

export interface ResolvedRoster {
  position1: TeamPositionValue;
  position2: TeamPositionValue | null;
  position3: TeamPositionValue | null;
}

// Reads the raw DB columns into a typed roster, defaulting position1 to
// "self" if somehow null (shouldn't happen given the schema default, but
// combat loops shouldn't crash on a malformed row).
export function resolveRoster(dbUser: { teamPosition1: string | null; teamPosition2: string | null; teamPosition3: string | null }): ResolvedRoster {
  return {
    position1: dbUser.teamPosition1 ?? "self",
    position2: dbUser.teamPosition2,
    position3: dbUser.teamPosition3,
  };
}

export function positionValue(roster: ResolvedRoster, pos: PositionIndex): TeamPositionValue | null {
  if (pos === 1) return roster.position1;
  if (pos === 2) return roster.position2;
  return roster.position3;
}

export function isPositionFilled(roster: ResolvedRoster, pos: PositionIndex): boolean {
  return positionValue(roster, pos) !== null;
}

// Every position actually in play (1 is always filled per the schema
// default; 2/3 may be null).
export function filledPositions(roster: ResolvedRoster): PositionIndex[] {
  const out: PositionIndex[] = [1];
  if (roster.position2 !== null) out.push(2);
  if (roster.position3 !== null) out.push(3);
  return out;
}

// KO fallback: walks 1->2->3->1 from the current position, skipping
// itself, returning the first OTHER filled position whose HP (per the
// caller-supplied lookup) is > 0. Returns null if no other position is
// alive (fight-ending condition — caller checks for this).
export function nextAliveFallback(
  roster: ResolvedRoster,
  currentPos: PositionIndex,
  hpLookup: (pos: PositionIndex) => number,
): PositionIndex | null {
  const order: PositionIndex[] = [1, 2, 3];
  const startIdx = order.indexOf(currentPos);
  for (let i = 1; i <= 3; i++) {
    const candidate = order[(startIdx + i) % 3];
    if (candidate === currentPos) continue;
    if (!isPositionFilled(roster, candidate)) continue;
    if (hpLookup(candidate) > 0) return candidate;
  }
  return null;
}

// All filled positions dead -> defeat.
export function isTeamWiped(roster: ResolvedRoster, hpLookup: (pos: PositionIndex) => number): boolean {
  return filledPositions(roster).every(pos => hpLookup(pos) <= 0);
}

// Positions available to swap TO from the current one (excludes current,
// excludes unfilled). Used to decide single-button vs dropdown swap UX.
export function swappableTargets(roster: ResolvedRoster, currentPos: PositionIndex): PositionIndex[] {
  return filledPositions(roster).filter(p => p !== currentPos);
}

// Label for a position, given the resolved kit for non-"self" positions.
// playerName is the player's own display name (for "self").
export function positionLabel(
  roster: ResolvedRoster,
  pos: PositionIndex,
  playerName: string,
  kitLabel: (characterId: string) => string | null,
): string {
  const value = positionValue(roster, pos);
  if (value === "self") return playerName;
  if (value === null) return "(empty)";
  return kitLabel(value) ?? value;
}
