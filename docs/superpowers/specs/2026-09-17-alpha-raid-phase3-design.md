# Alpha Raid Phase 3 — Real Per-Character Boss AI Design

## Goal

Make the Alpha Raid boss actually run the chosen character's real `onSkill()`/`onUltimate()` kit logic (heal, self-buff, own mechanic-state progression) instead of Phase 2's flavor-name-only move with a generic debuff — **without introducing any per-character maintenance cost**. A brand-new character shipped after this lands should automatically work as an Alpha Raid boss the moment their kit is added to `CHARACTER_KITS`, the same way they automatically become selectable in `/owner-alpharaid start`'s autocomplete today.

## Background

Phase 2 (shipped) built the boss's moves from the character's real Basic/Skill/Ultimate **names** only, applying a generic `damage` multiplier and a hardcoded VULNERABLE/WEAKENED debuff on players — it never calls the character's actual kit functions. This was a deliberate scope decision at the time: each character's kit-specific *extension* result type (`BrenSkillResult`, `FeyraUltimateResult`, etc.) differs per character, and every one of the 6 normal combat loops (duel/ascend/boss/dungeon/field-boss/raid) hand-branches on `activeAllyCharacterId === "bren"` etc. to read those bespoke fields — an accepted, standing maintenance cost for *player-side* kits (documented in CLAUDE.md), but one the user explicitly does not want repeated for the boss AI.

**The key enabler**: `PlayableCharacterKit`'s *base* interface (`src/lib/characterKit.ts`) — the part every character implements identically, not the bespoke extensions — already carries everything needed for a real, generic boss AI:
- `onSkill()`/`onUltimate()` are callable with the same generic `CharacterCombatContext` for any character.
- `SkillEffectResult.damageMult` / `newMechanicState` are generic.
- `UltimateEffectResult.healResult: { actions: AllyAction[] }` is generic — and `src/lib/allyActions.ts`'s `applyAllyAction()` is a pure, already-built interpreter that turns any `AllyAction` (HEAL_ALLY/SHIELD_ALLY/BUFF_ALLY_ATK/BUFF_ALLY_CRIT_RATE/CLEANSE_ALLY) into concrete numbers without the caller needing to know which character produced it.
- `kit.skillCooldownTurns` and `kit.createInitialMechanicState()` are generic per-kit fields already.

Bespoke extension fields (Bren's `hpCost`, Feyra's enemy-facing `weaken`, etc.) are deliberately **not** read — reading them requires knowing the specific character's extension shape, which is exactly the cost this phase avoids. A future character's Ultimate that only does bespoke things with no generic `healResult` content will simply deal damage and debuff, same as Phase 2 — never a build error, never a missing branch.

## Boss Turn Logic

Replaces Phase 2's fixed "random move, or Ultimate-tier move if enraged" selection:

- **Enraged** (≤40% HP, existing Phase 2 threshold): casts the character's real `onUltimate()`.
- **Else if the boss's own Skill is off cooldown**: casts the real `onSkill()`, then sets the boss's cooldown to `kit.skillCooldownTurns`.
- **Else**: Basic Attack (unchanged — flavor name only, `damage: 1.0`, as in Phase 2).

New per-boss-fight state (lives on `ActiveRaid`, alongside the existing `bossHp`/`bossDef`/etc. fields, not a new DB table — this is in-memory combat state exactly like everything else `/raid` tracks):
- `bossMechanicState: unknown` — seeded from `kit.createInitialMechanicState()` at fight start, threaded through `newMechanicState` after every Skill/Ultimate cast, exactly like a player's `allyMechanicState` already round-trips.
- `bossSkillCdTurns: number` — starts at 0 (Skill available turn 1), set to `kit.skillCooldownTurns` after each Skill cast, decremented once per boss turn.

## Applying the Result Generically

The boss's synthetic `CharacterCombatContext` passed into `onSkill()`/`onUltimate()`:
```typescript
{
  playerHp: raid.bossHp, playerHpMax: raid.bossHpMax,
  allyHp:   raid.bossHp, allyHpMax:   raid.bossHpMax, // boss IS "the active ally" from the kit's own perspective — matches the established playerHp-vs-allyHp convention every kit already follows
  turn: raid.turn,
  isShattered: false, // no per-boss shatter concept distinct from the existing vib-bar shatter already modeled elsewhere in raid.ts
  mechanicState: raid.bossMechanicState,
}
```

After the call:
- `result.damageMult` scales `aoeBase` for that counter-attack the same way it already scales a player's own hit.
- `result.newMechanicState` → `raid.bossMechanicState`.
- For `UltimateEffectResult.healResult.actions`: each `AllyAction` is run through `applyAllyAction(action, { hp: raid.bossHp, hpMax: raid.bossHpMax })`, and the result is applied to the boss's own state:
  - `hpDelta` → `raid.bossHp = min(bossHpMax, bossHp + hpDelta)` (the Solace-boss-heals-itself case).
  - `shieldDelta` → two **new** `ActiveRaid` fields, `bossShieldHp: number` and `bossShieldTurnsLeft: number` (set to a fixed 3-turn duration on grant), read by the existing player-attack-damage-application step: incoming player damage is absorbed by `bossShieldHp` first (down to 0) before touching `raid.bossHp`, mirroring how `bossDefShredTurnsLeft` already sits alongside the boss's core stats and gets read at damage-calc time.
  - `atkBuffPct` → a **new** `bossAtkBuffPct`/`bossAtkBuffTurnsLeft` pair, read the same way `raid.bossAtk` is already read when computing `aoeBase`, for a fixed 3-turn duration.
  - `critRateBuffPct` → intentionally a no-op. The boss's own counter-attack damage calc has no crit-roll concept today (unlike a player's attack), so there's nothing for a crit-rate buff to modify. Not adding a boss-side crit system is a deliberate scope line for this phase.
  - `cleanseCount` → also a no-op — the boss has no debuffs applied to itself by players today, so there's nothing to cleanse.
- `moveLabel` replaces the Phase 2 flavor string in the turn log.
- Phase 2's generic VULNERABLE (on Skill-tier casts)/WEAKENED (on Ultimate-tier casts) debuff on players is **kept, layered on top** — unconditional on move tier, independent of whatever the real kit call produced.

## What This Does Not Do

- Does not read or apply any character-specific extension field (`hpCost`, enemy-facing `weaken`, `forceCrit`, etc.) — those stay exclusive to the 6 player-facing combat loops.
- Does not give the boss a Basic Attack upgrade — Basic stays flavor-name-only as in Phase 2 (the base kit interface has no generic `onBasic()` hook to call; only Skill/Ultimate do).
- Does not change `computeRaidBossStats()`, the ×1.5 Alpha stat multiplier, evasion, or the enrage HP threshold itself — only what happens *once* enraged/on-cooldown-clear changes.

## Testing

Manual, via `test-guild-id`. Specifically verify: a Solace-boss actually regains HP on its Ultimate cast (visible in the boss HP bar/turn log), a character whose kit produces no `healResult` content (e.g. a pure-damage Ultimate) doesn't error or silently do nothing unexpected, and the boss's Skill cooldown visibly gates repeat Skill casts turn-to-turn.
