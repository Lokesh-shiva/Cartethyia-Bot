# Combat Statistics Design

## Goal

Expose useful combat performance totals while a fight is active and in its final result, with raid participants and party totals visible to everyone.

## Metrics

Each combatant/raid participant owns an ephemeral `CombatStats` record:

- `damageTaken`: actual HP lost from enemy attacks after mitigation, shields, and guard effects.
- `damageDone`: actual enemy HP damage after modifiers. Damage absorbed entirely by a boss shield is excluded.
- `healed`: actual HP restored by direct/non-lifesteal healing. Overhealing is excluded.
- `lifesteal`: actual HP restored by lifesteal. This is separate from `healed`, and overhealing is excluded.
- `vibrationDamage`: actual amount removed from the enemy vibration bar, including explicit bonus drains.
- `shatters`: number of transitions from an active vibration bar to a shatter state.

Stats reset for every new fight and are not persisted to the database.

## Attribution

Solo and team-enabled fights report one player-owned total, including damage/healing performed by that player's active ally. Duels maintain one record per side. Raids maintain one record per participant; shared boss vibration damage and shatters are credited to the participant whose action caused them.

## Display

During combat, the existing battle status area gets a compact live line:

`📊 Stats — DMG 1,234 · Taken 456 · Heal 300 · LS 120 · Vib 90 · Shatters 1`

Final results add a readable `Combat Summary` section. Raid results show one row per participant and a `TOTAL` row summing all six metrics. Raid live embeds show the compact party total so every participant can see contribution progress between turns.

## Implementation constraints

- Record metrics at authoritative HP/vibration mutations, not by parsing combat-log text.
- Preserve existing combat mechanics and reward behavior.
- Use a shared formatter and aggregation helper so solo, duel, and raid displays use identical labels and math.
- Keep the existing raid damage standings, expanding them into the six-stat contribution table.
