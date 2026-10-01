export interface CombatStats {
  damageTaken: number;
  damageDone: number;
  healed: number;
  lifesteal: number;
  vibrationDamage: number;
  shatters: number;
}

export function emptyCombatStats(): CombatStats {
  return {
    damageTaken: 0,
    damageDone: 0,
    healed: 0,
    lifesteal: 0,
    vibrationDamage: 0,
    shatters: 0,
  };
}

export function addCombatStats(target: CombatStats, source: CombatStats): CombatStats {
  target.damageTaken += source.damageTaken;
  target.damageDone += source.damageDone;
  target.healed += source.healed;
  target.lifesteal += source.lifesteal;
  target.vibrationDamage += source.vibrationDamage;
  target.shatters += source.shatters;
  return target;
}

export function sumCombatStats(records: readonly CombatStats[]): CombatStats {
  return records.reduce((total, record) => addCombatStats(total, record), emptyCombatStats());
}

function positiveDelta(before: number, after: number): number {
  return Math.max(0, Math.floor(after - before));
}

function positiveLoss(before: number, after: number): number {
  return Math.max(0, Math.floor(before - after));
}

export function recordDamageDone(stats: CombatStats, enemyHpBefore: number, enemyHpAfter: number): number {
  const amount = positiveLoss(enemyHpBefore, enemyHpAfter);
  stats.damageDone += amount;
  return amount;
}

export function recordDamageTaken(stats: CombatStats, hpBefore: number, hpAfter: number): number {
  const amount = positiveLoss(hpBefore, hpAfter);
  stats.damageTaken += amount;
  return amount;
}

export function recordDirectHeal(stats: CombatStats, hpBefore: number, hpAfter: number): number {
  const amount = positiveDelta(hpBefore, hpAfter);
  stats.healed += amount;
  return amount;
}

export function recordLifesteal(stats: CombatStats, hpBefore: number, hpAfter: number): number {
  const amount = positiveDelta(hpBefore, hpAfter);
  stats.lifesteal += amount;
  return amount;
}

export function recordVibrationDamage(stats: CombatStats, vibrationBefore: number, vibrationAfter: number): number {
  const amount = positiveLoss(vibrationBefore, vibrationAfter);
  stats.vibrationDamage += amount;
  return amount;
}

export function recordShatter(stats: CombatStats): void {
  stats.shatters += 1;
}

function number(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString();
}

export function formatCombatStats(stats: CombatStats): string {
  return `📊 Stats — DMG ${number(stats.damageDone)} · Taken ${number(stats.damageTaken)} · Heal ${number(stats.healed)} · LS ${number(stats.lifesteal)} · Vib ${number(stats.vibrationDamage)} · Shatters ${number(stats.shatters)}`;
}

export function formatCombatStatsSummary(stats: CombatStats): string {
  return [
    `Damage done: **${number(stats.damageDone)}**`,
    `Damage taken: **${number(stats.damageTaken)}**`,
    `Healed: **${number(stats.healed)}**`,
    `Lifesteal: **${number(stats.lifesteal)}**`,
    `Vibration damage: **${number(stats.vibrationDamage)}**`,
    `Shatters: **${number(stats.shatters)}**`,
  ].join("  ·  ");
}
