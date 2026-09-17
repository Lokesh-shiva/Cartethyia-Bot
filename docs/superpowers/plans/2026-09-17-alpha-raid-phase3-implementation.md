# Alpha Raid Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Alpha Raid boss actually call the chosen character's real `onSkill()`/`onUltimate()` kit functions and apply the result generically (damage multiplier, mechanic-state progression, self-heal/shield/ATK-buff via the existing `AllyAction` system) — so a Solace boss really heals itself and a future character's kit works automatically with zero new per-character code.

**Architecture:** All new state lives on the existing in-memory `ActiveRaid` object (`bossMechanicState`, `bossSkillCdTurns`, `bossShieldHp`/`bossShieldTurnsLeft`, `bossAtkBuffPct`/`bossAtkBuffTurnsLeft`) — no DB schema change needed, this is pure combat-loop state exactly like `bossDefShredTurnsLeft` already is. The boss's move-tier selection (enrage → Ultimate, cooldown-ready → Skill, else Basic) replaces Phase 2's random pick. Once a tier is chosen, if it's Skill or Ultimate, the real `kit.onSkill()`/`kit.onUltimate()` is called with a synthetic `CharacterCombatContext` and the result is applied using only the interface's generic fields (`damageMult`, `newMechanicState`, `healResult.actions` via the already-built `applyAllyAction()` interpreter) — never a character-specific extension field.

**Tech Stack:** Existing `raid.ts` engine, `characterKit.ts`'s `PlayableCharacterKit`/`CharacterCombatContext`, `allyActions.ts`'s `AllyAction`/`applyAllyAction`.

---

### Task 1: New `ActiveRaid` fields + `AlphaRaidOptions.characterId`

**Files:**
- Modify: `src/commands/rpg/raid.ts`

- [ ] **Step 1: Add the new imports**

Find:
```typescript
import { AllyActionTarget } from "../../lib/allyActions";
```
Replace with:
```typescript
import { AllyAction, AllyActionTarget, applyAllyAction } from "../../lib/allyActions";
```

Find:
```typescript
import { getOrCreateCharacterProgress } from "../../lib/characterProgress";
import { CHARACTER_KITS, PlayableCharacterKit } from "../../lib/characterKit";
```
Replace with:
```typescript
import { getOrCreateCharacterProgress, MAX_KIT_LEVEL } from "../../lib/characterProgress";
import { CHARACTER_KITS, PlayableCharacterKit, CharacterCombatContext } from "../../lib/characterKit";
```

- [ ] **Step 2: Add the new `ActiveRaid` fields**

Find:
```typescript
  feyraBossWeakenTurnsLeft: number; // Feyra's Ultimate — separate shared counter, same shape as Rhoven's own
  feyraBossWeakenPct:       number;
  phase:         "RECRUITING" | "FIGHTING";
```
Replace with:
```typescript
  feyraBossWeakenTurnsLeft: number; // Feyra's Ultimate — separate shared counter, same shape as Rhoven's own
  feyraBossWeakenPct:       number;
  // ── Alpha Raid Phase 3: real per-character boss AI state ──────────────────
  // Only ever populated when alphaOptions is present — undefined/0 for every
  // normal /raid boss. Mirrors how a player's own allyMechanicState/skillCd
  // round-trip, but for the boss itself.
  bossMechanicState: unknown;
  bossSkillCdTurns:  number;
  bossShieldHp:         number; // absorbs incoming player damage before bossHp, from a kit's SHIELD_ALLY action
  bossShieldTurnsLeft:  number;
  bossAtkBuffPct:        number; // from a kit's BUFF_ALLY_ATK action
  bossAtkBuffTurnsLeft:  number;
  phase:         "RECRUITING" | "FIGHTING";
```

- [ ] **Step 3: Add `characterId` to `AlphaRaidOptions`**

Find:
```typescript
export interface AlphaRaidOptions {
  statMultiplier: number;      // applied to every axis of computeRaidBossStats()'s output
  evasionChance: number;       // 0-1, boss dodges a player hit entirely
  bossArtPathOverride: string | null;
  bonusReward: { fractureKeys: number; radiantKeys: number; fractonite: number };
  onComplete: (won: boolean) => Promise<void>; // fired once, after the fight resolves
}
```
Replace with:
```typescript
export interface AlphaRaidOptions {
  characterId: string;         // CHARACTER_KITS id — which kit the boss's real Skill/Ultimate calls use
  statMultiplier: number;      // applied to every axis of computeRaidBossStats()'s output
  evasionChance: number;       // 0-1, boss dodges a player hit entirely
  bossArtPathOverride: string | null;
  bonusReward: { fractureKeys: number; radiantKeys: number; fractonite: number };
  onComplete: (won: boolean) => Promise<void>; // fired once, after the fight resolves
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: errors about the two object-literal call sites of `ActiveRaid`/`AlphaRaidOptions` missing the new required fields — expected at this point, fixed in Task 2. Confirm the errors are ONLY in `raid.ts` and `interactionCreate.ts` (the two places that construct these types) and nowhere else.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "feat(alpha-raid): new boss-AI state fields on ActiveRaid/AlphaRaidOptions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(This commit will leave the build red until Task 2 — that's fine, both tasks land in the same session before anything is deployed. If you want a green build at every commit instead, merge Task 1 and Task 2 into one commit — either is fine here since this isn't a shared branch.)

---

### Task 2: Wire `characterId` through + initialize new state

**Files:**
- Modify: `src/commands/rpg/raid.ts`
- Modify: `src/events/interactionCreate.ts`

- [ ] **Step 1: Initialize the new fields in `startAlphaRaidFight`**

Find:
```typescript
  const raid: ActiveRaid = {
    bossChoice:  `alpha:${boss.id}`,
    bossHp: 1, bossHpMax: 1, bossAtk: 0, bossDef: 0, bossVib: 1, bossVibMax: 1, // placeholders — launchRaid rescales immediately
    isShattered: false, shatterLeft: 0,
    bossDefShredTurnsLeft: 0, bossDefShredPct: 0,
    bossWeakenTurnsLeft: 0, bossWeakenPct: 0,
    feyraBossWeakenTurnsLeft: 0, feyraBossWeakenPct: 0,
    phase: "RECRUITING", participants: [], currentIdx: 0, turn: 1,
    channelId, guildId, organizerId, isDevGuild: true,
  };
```
Replace with:
```typescript
  const raid: ActiveRaid = {
    bossChoice:  `alpha:${boss.id}`,
    bossHp: 1, bossHpMax: 1, bossAtk: 0, bossDef: 0, bossVib: 1, bossVibMax: 1, // placeholders — launchRaid rescales immediately
    isShattered: false, shatterLeft: 0,
    bossDefShredTurnsLeft: 0, bossDefShredPct: 0,
    bossWeakenTurnsLeft: 0, bossWeakenPct: 0,
    feyraBossWeakenTurnsLeft: 0, feyraBossWeakenPct: 0,
    bossMechanicState: null, bossSkillCdTurns: 0,
    bossShieldHp: 0, bossShieldTurnsLeft: 0,
    bossAtkBuffPct: 0, bossAtkBuffTurnsLeft: 0,
    phase: "RECRUITING", participants: [], currentIdx: 0, turn: 1,
    channelId, guildId, organizerId, isDevGuild: true,
  };
```

- [ ] **Step 2: Seed `bossMechanicState` from the real kit once stats are scaled**

Find:
```typescript
  // ── Scale boss stats to this party ──────────────────────────────────────────
  const scaled     = computeRaidBossStats(boss, raid.participants);
  const statMult   = alphaOptions?.statMultiplier ?? 1;
  raid.bossHp      = Math.floor(scaled.hp * statMult);
  raid.bossHpMax   = raid.bossHp;
  raid.bossAtk     = Math.floor(scaled.atk * statMult);
  raid.bossDef     = Math.floor(scaled.def * statMult);
  raid.bossVib     = Math.floor(scaled.vibBar * statMult);
  raid.bossVibMax  = raid.bossVib;
```
Replace with:
```typescript
  // ── Scale boss stats to this party ──────────────────────────────────────────
  const scaled     = computeRaidBossStats(boss, raid.participants);
  const statMult   = alphaOptions?.statMultiplier ?? 1;
  raid.bossHp      = Math.floor(scaled.hp * statMult);
  raid.bossHpMax   = raid.bossHp;
  raid.bossAtk     = Math.floor(scaled.atk * statMult);
  raid.bossDef     = Math.floor(scaled.def * statMult);
  raid.bossVib     = Math.floor(scaled.vibBar * statMult);
  raid.bossVibMax  = raid.bossVib;

  // Alpha Raid Phase 3: seed the boss's own mechanic-state from its real kit,
  // exactly like a player's allyMechanicState is seeded at join time.
  if (alphaOptions) {
    const bossKit = CHARACTER_KITS[alphaOptions.characterId];
    raid.bossMechanicState = bossKit?.createInitialMechanicState() ?? null;
  }
```

- [ ] **Step 3: Pass `characterId` from `interactionCreate.ts`'s Begin handler**

Find (in `src/events/interactionCreate.ts`, inside the `alpharaid_begin_` handler added in Phase 2):
```typescript
        {
          statMultiplier: 1.5,
          evasionChance: 0.18,
          bossArtPathOverride: alphaRaidBossArtPath(instance.event.bossCharacterId),
```
Replace with:
```typescript
        {
          characterId: instance.event.bossCharacterId,
          statMultiplier: 1.5,
          evasionChance: 0.18,
          bossArtPathOverride: alphaRaidBossArtPath(instance.event.bossCharacterId),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean — no output.

- [ ] **Step 5: Commit**

```bash
git add src/commands/rpg/raid.ts src/events/interactionCreate.ts
git commit -m "feat(alpha-raid): thread characterId through, seed boss mechanic-state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Real boss move selection + generic application

**Files:**
- Modify: `src/commands/rpg/raid.ts`

This is the core of Phase 3: replace Phase 2's random/enrage-only move-tier pick with the cooldown-gated real cadence, and when a Skill/Ultimate tier is chosen, call the real kit function and apply its generic fields.

- [ ] **Step 1: Replace the move-tier selection block**

Find:
```typescript
      } else {
        const enraged = !!alphaOptions && raid.bossHp / raid.bossHpMax <= 0.4;
        const move    = enraged ? boss.moves[boss.moves.length - 1]! : boss.moves[Math.floor(Math.random() * boss.moves.length)]!;
        const enrageAtkMult = enraged ? 1.6 : 1;
        const bossWeakenActive = raid.bossWeakenTurnsLeft > 0;
        const feyraBossWeakenActive = raid.feyraBossWeakenTurnsLeft > 0;
        const aoeBase = Math.floor(raid.bossAtk * move.damage * 0.6 * enrageAtkMult * (bossWeakenActive ? (1 - raid.bossWeakenPct) : 1) * (feyraBossWeakenActive ? (1 - raid.feyraBossWeakenPct) : 1)); // AoE = 60% of single-target
        const alive   = raid.participants.filter(p => !p.isDefeated);
        if (enraged && alphaOptions) moveLine += `\n🔥 **${boss.name}** enrages, striking with everything it has!`;
        const dmgLines: string[] = [];
```
Replace with:
```typescript
      } else {
        const enraged = !!alphaOptions && raid.bossHp / raid.bossHpMax <= 0.4;
        // Alpha Raid Phase 3 cadence: enrage -> real Ultimate, cooldown-ready
        // -> real Skill, else Basic (flavor-name-only, unchanged from Phase 2).
        // Normal /raid bosses (alphaOptions absent) keep Phase 2's fully
        // random tier pick, since they never had real-kit moves to gate.
        const moveIdx = !alphaOptions
          ? Math.floor(Math.random() * boss.moves.length)
          : enraged ? 2 : (raid.bossSkillCdTurns === 0 ? 1 : 0);
        const move = boss.moves[moveIdx]!;
        const enrageAtkMult = enraged ? 1.6 : 1;
        const bossWeakenActive = raid.bossWeakenTurnsLeft > 0;
        const feyraBossWeakenActive = raid.feyraBossWeakenTurnsLeft > 0;
        const alphaAtkBuffActive = !!alphaOptions && raid.bossAtkBuffTurnsLeft > 0;
        const alive   = raid.participants.filter(p => !p.isDefeated);
        if (enraged && alphaOptions) moveLine += `\n🔥 **${boss.name}** enrages, striking with everything it has!`;
        const dmgLines: string[] = [];

        // Alpha Raid Phase 3: run the real kit call for Skill/Ultimate tiers,
        // applying ONLY the generic base-interface fields — damageMult,
        // mechanic-state, and healResult.actions via applyAllyAction(). Never
        // reads a character-specific extension field (hpCost, enemy-facing
        // weaken, etc.) — that's the whole point: a brand-new character's
        // kit works here with zero new code, the same day it's added to
        // CHARACTER_KITS.
        let kitDamageMult = 1;
        if (alphaOptions && moveIdx > 0) {
          const bossKit = CHARACTER_KITS[alphaOptions.characterId];
          if (bossKit) {
            const ctx: CharacterCombatContext = {
              playerHp: raid.bossHp, playerHpMax: raid.bossHpMax,
              allyHp:   raid.bossHp, allyHpMax:   raid.bossHpMax,
              turn: raid.turn, isShattered: false,
              mechanicState: raid.bossMechanicState,
            };
            const kitLevels = {
              basicLevel: MAX_KIT_LEVEL, skillLevel: MAX_KIT_LEVEL, ultimateLevel: MAX_KIT_LEVEL,
              introLevel: MAX_KIT_LEVEL, forteLevel: MAX_KIT_LEVEL,
            };
            const healActions: AllyAction[] = [];
            if (moveIdx === 2) {
              const ult = bossKit.onUltimate(ctx, kitLevels, 0);
              raid.bossMechanicState = ult.newMechanicState;
              if (ult.moveLabel) moveLine += `\n⚡ ${ult.moveLabel}`;
              healActions.push(...ult.healResult.actions);
            } else {
              const sk = bossKit.onSkill(ctx, kitLevels, 0);
              raid.bossMechanicState = sk.newMechanicState;
              kitDamageMult = sk.damageMult;
              raid.bossSkillCdTurns = bossKit.skillCooldownTurns;
              if (sk.moveLabel) moveLine += `\n✦ ${sk.moveLabel}`;
            }
            for (const action of healActions) {
              const result = applyAllyAction(action, { hp: raid.bossHp, hpMax: raid.bossHpMax });
              if (result.hpDelta > 0) {
                raid.bossHp = Math.min(raid.bossHpMax, raid.bossHp + result.hpDelta);
                moveLine += `\n💚 **${boss.name}** heals for ${result.hpDelta}!`;
              }
              if (result.shieldDelta > 0) {
                raid.bossShieldHp = result.shieldDelta;
                raid.bossShieldTurnsLeft = 3;
                moveLine += `\n🛡 **${boss.name}** shields itself for ${result.shieldDelta}!`;
              }
              if (result.atkBuffPct > 0) {
                raid.bossAtkBuffPct = result.atkBuffPct;
                raid.bossAtkBuffTurnsLeft = 3;
                moveLine += `\n💢 **${boss.name}**'s ATK rises!`;
              }
              // critRateBuffPct/cleanseCount: no boss-side analog (bosses don't
              // crit-roll their own attacks, and take no debuffs today) —
              // intentional no-op, not a missing branch.
            }
          }
        }

        // aoeBase is computed AFTER the real-kit call above so kitDamageMult
        // (only known once a Skill cast resolves) can fold in — move.damage
        // stays the Phase 2 baseline (1.0/1.3/1.6 by tier), kitDamageMult
        // multiplies on top, defaulting to 1 for Basic/Ultimate/non-Alpha bosses.
        const aoeBase = Math.floor(raid.bossAtk * move.damage * kitDamageMult * 0.6 * enrageAtkMult * (alphaAtkBuffActive ? (1 + raid.bossAtkBuffPct) : 1) * (bossWeakenActive ? (1 - raid.bossWeakenPct) : 1) * (feyraBossWeakenActive ? (1 - raid.feyraBossWeakenPct) : 1)); // AoE = 60% of single-target
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "feat(alpha-raid): boss casts real Skill/Ultimate, applies generic kit effects

Enrage -> real Ultimate, cooldown-ready -> real Skill, else Basic
(unchanged flavor-only). Only the base PlayableCharacterKit interface is
read (damageMult, mechanicState, healResult.actions via the existing
applyAllyAction() interpreter) — a future character's kit works here
automatically, no per-character branch ever needed.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Shield absorbs incoming player damage

**Files:**
- Modify: `src/commands/rpg/raid.ts`

A kit's `SHIELD_ALLY` action (Task 3) grants `bossShieldHp`. This task makes that shield actually absorb the player's own damage into the boss before `bossHp` takes the hit.

- [ ] **Step 1: Absorb into the shield first**

Find:
```typescript
      if (alphaOptions && Math.random() < alphaOptions.evasionChance) {
        damage = 0;
        moveLine += `\n◇ **${boss.name}** evades the strike!`;
      }

      current.dmgDealt += damage;
      raid.bossHp       = Math.max(0, raid.bossHp - damage);
```
Replace with:
```typescript
      if (alphaOptions && Math.random() < alphaOptions.evasionChance) {
        damage = 0;
        moveLine += `\n◇ **${boss.name}** evades the strike!`;
      }

      if (alphaOptions && raid.bossShieldHp > 0 && damage > 0) {
        const absorbed = Math.min(raid.bossShieldHp, damage);
        raid.bossShieldHp -= absorbed;
        damage -= absorbed;
        moveLine += `\n🛡 **${boss.name}**'s shield absorbs ${absorbed} damage!`;
      }

      current.dmgDealt += damage;
      raid.bossHp       = Math.max(0, raid.bossHp - damage);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "feat(alpha-raid): boss shield absorbs incoming player damage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Per-turn ticks for the new counters

**Files:**
- Modify: `src/commands/rpg/raid.ts`

- [ ] **Step 1: Tick down the new turn counters**

Find:
```typescript
      if (raid.bossDefShredTurnsLeft > 0) raid.bossDefShredTurnsLeft--;
      if (raid.bossWeakenTurnsLeft > 0) raid.bossWeakenTurnsLeft--;
      if (raid.feyraBossWeakenTurnsLeft > 0) raid.feyraBossWeakenTurnsLeft--;
```
Replace with:
```typescript
      if (raid.bossDefShredTurnsLeft > 0) raid.bossDefShredTurnsLeft--;
      if (raid.bossWeakenTurnsLeft > 0) raid.bossWeakenTurnsLeft--;
      if (raid.feyraBossWeakenTurnsLeft > 0) raid.feyraBossWeakenTurnsLeft--;
      if (raid.bossSkillCdTurns > 0) raid.bossSkillCdTurns--;
      if (raid.bossShieldTurnsLeft > 0) { raid.bossShieldTurnsLeft--; if (raid.bossShieldTurnsLeft === 0) raid.bossShieldHp = 0; }
      if (raid.bossAtkBuffTurnsLeft > 0) { raid.bossAtkBuffTurnsLeft--; if (raid.bossAtkBuffTurnsLeft === 0) raid.bossAtkBuffPct = 0; }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/commands/rpg/raid.ts
git commit -m "feat(alpha-raid): tick down boss shield/ATK-buff/skill-cooldown each turn

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Build, deploy, live test

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: clean, no errors.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
```
```bash
ssh -i "D:/Projects/Bot/ssh-key-2026-06-05.key" -o StrictHostKeyChecking=no ubuntu@140.245.202.30 "bash -lc 'export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; cd ~/bot && git pull && npm run build && pm2 restart cartethyia'"
```
(No schema change this phase — `npx prisma generate` isn't needed.)

- [ ] **Step 3: Live test in the dev server**

Run `/owner-alpharaid start character:solace test-guild-id:1495681992082194432`, join with 2+ accounts, click Begin, and confirm:
- The boss's turn log shows real move labels (e.g. Solace's actual Skill/Ultimate flavor text), not just the Phase 2 generic name.
- A Solace boss visibly regains HP on an Ultimate cast (watch the boss HP bar/turn log for a "heals for N" line).
- The boss's Skill doesn't repeat every single turn — confirm a cooldown gap (Basic Attacks in between) matching Solace's `skillCooldownTurns`.
- Enrage (boss ≤40% HP) triggers the real Ultimate cast, not just a flavor-text "enrages" message.
- Run a second test with a character whose kit produces no `healResult` content (e.g. a pure-damage-focused Ultimate) and confirm no crash and no unexpected heal/shield message — the loop over an empty `actions` array should be a silent no-op.
- Confirm normal `/raid` (no `alphaOptions`) is completely unaffected — a normal raid boss still picks a fully random move each counter-attack, exactly as before this plan.

---

## Out of scope for this plan

Character-specific extension fields (Bren's `hpCost`, enemy-facing `weaken` fields, forte/tempo-stack mechanics) — reading those requires per-character code, which is exactly what this phase avoids. A boss-side crit-roll system (needed for `critRateBuffPct` to do anything). Debuffs applied TO the boss by players (needed for `cleanseCount` to do anything) — no such mechanic exists in `/raid` today.
