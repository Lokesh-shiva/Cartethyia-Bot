// Shared combat lock — prevents a player from being in two fights simultaneously.
// Each command acquires the lock on entry and releases it on exit (win/lose/flee/timeout).

const locks = new Map<string, string>(); // userId → command name

/** Try to acquire the lock. Returns false if already locked. */
export function acquireLock(userId: string, command: string): boolean {
  if (locks.has(userId)) return false;
  locks.set(userId, command);
  return true;
}

/** Release the lock for a user. Call this in every exit path. */
export function releaseLock(userId: string): void {
  locks.delete(userId);
}

/** Returns the command name currently holding the lock, or undefined if free. */
export function getLock(userId: string): string | undefined {
  return locks.get(userId);
}

/** Human-readable message when a player is already in combat. */
export function alreadyInCombatMsg(userId: string): string {
  const cmd = locks.get(userId);
  return cmd
    ? `◈ You are already in a **${cmd}** fight. Finish or flee it first.`
    : "◈ You are already in combat.";
}
