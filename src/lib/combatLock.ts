// Shared combat lock — prevents a player from being in two fights simultaneously.
// Each command acquires the lock on entry and releases it on exit (win/lose/flee/timeout).
//
// Locks carry an acquire timestamp and auto-expire: if a fight ever leaks its
// lock (hung promise, DB error escaping a handler, a code path that forgets to
// release), the stale lock is reclaimed instead of locking the player out until
// the next bot restart. No legit fight runs longer than LOCK_TTL_MS of active
// play — per-turn collectors time out at 8 min and resolve the fight.

const LOCK_TTL_MS = 20 * 60 * 1000; // 20 min — well past any real fight

interface LockEntry { command: string; at: number }
const locks = new Map<string, LockEntry>();

function isStale(entry: LockEntry): boolean {
  return Date.now() - entry.at > LOCK_TTL_MS;
}

/** Try to acquire the lock. Returns false if already locked by a fresh fight. */
export function acquireLock(userId: string, command: string): boolean {
  const existing = locks.get(userId);
  if (existing && !isStale(existing)) return false;
  if (existing) console.warn(`[combatLock] reclaimed stale "${existing.command}" lock for ${userId}`);
  locks.set(userId, { command, at: Date.now() });
  return true;
}

/** Release the lock for a user. Call this in every exit path. */
export function releaseLock(userId: string): void {
  locks.delete(userId);
}

/** Returns the command name currently holding a fresh lock, or undefined if free/stale. */
export function getLock(userId: string): string | undefined {
  const entry = locks.get(userId);
  if (!entry) return undefined;
  if (isStale(entry)) { locks.delete(userId); return undefined; }
  return entry.command;
}

/** Human-readable message when a player is already in combat. */
export function alreadyInCombatMsg(userId: string): string {
  const cmd = getLock(userId);
  return cmd
    ? `◈ You are already in a **${cmd}** fight. Finish or flee it first.`
    : "◈ You are already in combat.";
}
