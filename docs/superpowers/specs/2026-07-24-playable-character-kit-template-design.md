# Playable Character Kit Template — Design

## Context

Solace is currently the only playable ally, and her entire kit — stat curves, Basic/Skill/Ultimate/Intro/Outro/Forte, and Constellations — is hardcoded by name (`resolveSolaceStats`, `solaceIntroEffect`, `SOLACE_FORTE_CONFIG`, etc.) directly inside `/character` and all 7 combat surfaces (`ascend.ts`, `boss.ts`, `dungeon.ts`, `duel.ts`, `raid.ts`, `field-boss.ts`, `encounter.ts`). Two new characters (Kaelith, Vesper — both standard-banner 4★s, releasing alongside a new standard 5★) are planned, plus the roadmap expects a steady cadence of future characters beyond that. Building each one the way Solace was built means re-touching all 7 combat files from scratch every time.

This spec covers building a **registry-based template** so that adding a new character becomes "write one kit module + register it," not "modify 7 combat files again." The line drawn (per design discussion): **plumbing is shared, content is not.** Every character gets their own entirely bespoke Basic/Skill/Ultimate/Intro/Outro/Forte/Constellations — what's shared is the *code path* combat loops use to resolve stats, call intro/outro, and invoke the character's own Skill/Ultimate logic, not the mechanics themselves.

## Architecture

### `PlayableCharacterKit` interface (new file: `src/lib/characterKit.ts`)

```typescript
export interface CharacterCombatContext {
  // Generic combat-state bag every combat loop already has in some form —
  // NOT Attunement-specific. Characters that don't need some of these fields
  // simply ignore them.
  playerHp: number; playerHpMax: number;
  allyHp: number; allyHpMax: number;
  turn: number;
  isShattered: boolean;
  mechanicState: unknown; // opaque per-character state (see below)
}

export interface SkillEffectResult {
  damageMult: number;      // multiplier on the acting unit's ATK for this hit
  vibFrac: number;         // vib-bar damage fraction (matches existing moveType conventions)
  moveLabel: string;       // display text, e.g. "Attunement — now in ATK mode!"
  newMechanicState: unknown;
  bonusConcertoEnergy?: number;
}

export interface UltimateEffectResult {
  healResult: { actions: import("./allyActions").AllyAction[] };  // fed through resolveIntroOutroEffect, same as today
  moveLabel: string;
  newMechanicState: unknown;
  resetsConcertoEnergy: boolean;
}

export interface PlayableCharacterKit {
  id:            string;   // "solace", "kaelith", "vesper"
  label:         string;
  emoji:         string;
  element:       string;
  portraitPath:  string;

  // Stats — same shape as solaceStatsAtLevel/resolveSolaceStats, different
  // numbers/floor-fractions per character.
  statsAtLevel(level: number): { hpMax: number; baseAtk: number; baseDef: number; baseSpeed: number; critRate: number; critDmg: number };
  resolveStats(userId: string): Promise<import("./setBonus").ResolvedStats & { hasSignatureWeapon: boolean; signatureWeaponRefinement: number }>;

  // Progression (mirrors solaceAscensionCost/solaceLevelUpCost/ASCENSION_LEVEL_CAP)
  ascensionLevelCap: number[];
  ascensionCost(currentPhase: number): { credits: number; forgingOres: number; paradoxCores: number; starfallShards: number };
  levelUpCost(currentLevel: number): { resonanceRecords: number; credits: number };

  // Kit-level-scaled curves — bespoke numbers, shared call shape
  basicDamageMult(basicLevel: number): number;
  introEffect(introLevel: number, constellation: number): import("./introOutro").IntroOutroEffect;
  outroEffect(constellation: number): import("./introOutro").IntroOutroEffect;

  // Forte
  forteConfig: import("./forte").ForteConfig;
  forteGainPerBasic: number;

  // Skill/Ultimate — fully bespoke, invoked as callbacks. This is the one
  // deliberately NOT-generic surface: each character's actual mechanic (mode
  // cycling, stack-and-detonate, mark-and-amplify, whatever) lives entirely
  // inside these two functions.
  createInitialMechanicState(): unknown;
  onSkill(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): SkillEffectResult;
  onUltimate(ctx: CharacterCombatContext, kitLevels: Record<string, number>, constellation: number): UltimateEffectResult;

  // Constellations — flavor text only; the mechanical gating lives inside
  // introEffect/outroEffect/onSkill/onUltimate reading the `constellation`
  // param, exactly like Solace's C1-C6 do today.
  constellationEffects: string[]; // exactly 6 entries
  maxConstellation: number; // always 6 today, but not hardcoded
}

export const CHARACTER_KITS: Record<string, PlayableCharacterKit> = {};
```

`mechanicState` is the key design choice: it's an **opaque blob** the combat loop stores once per fight (in the same state-object slot that currently holds Solace's `attunement`/`forte`/`concertoEnergy` fields) and passes back into `onSkill`/`onUltimate` on every call, without ever inspecting it. Solace's kit module internally treats it as `{ attunement: AttunementState, forte: ForteState, concertoEnergy: number }`; Kaelith's might treat it as `{ stacks: number }`; Vesper's as `{ marks: Map<string, number> }`. The combat loop never cares — it just threads the blob through.

### `/character` changes

`buildStatsView`/`buildWeaponView`/`buildKitLevelsView`/`buildConstellationsView`/`buildLoreView` currently call `resolveSolaceStats`, `solaceAscensionCost`, etc. by name. They change to `CHARACTER_KITS[characterId].resolveStats(userId)` etc. `CONSTELLATION_EFFECTS[characterId]` (already keyed generically) becomes `CHARACTER_KITS[characterId].constellationEffects` — same data, moved into the kit object so it lives next to the rest of that character's definition instead of a separate lookup table. The `CHARACTERS` registry (label/emoji/element/portraitPath) gets folded into `CHARACTER_KITS` too, so there's one registry instead of two.

### Combat-loop changes (all 7 files)

Each loop currently does, roughly:
```typescript
const hasSolace = user.teamAllyCharacterId === "solace";
const solaceProgress = hasSolace ? await prisma.characterProgress.findUnique(...) : null;
const allySolaceStats = hasSolace ? await resolveSolaceStats(userId) : null;
// ... later: solaceIntroEffect(introLevel, constellation), etc.
```

This becomes:
```typescript
const activeCharacterId = user.teamAllyCharacterId;
const kit = activeCharacterId ? CHARACTER_KITS[activeCharacterId] : null;
const hasAlly = kit !== null;
const allyProgress = hasAlly ? await prisma.characterProgress.findUnique({ where: { userId_characterId: { userId, characterId: activeCharacterId! } } }) : null;
const allyStats = hasAlly ? await kit!.resolveStats(userId) : null;
// ... later: kit!.introEffect(allyProgress.introLevel, allyProgress.constellation), etc.
```

The variable name `isDevGuild` (Solace's old placeholder name, kept everywhere per earlier fixes) gets renamed to `hasAlly` as part of this refactor — this is the natural point to fix that naming debt since every call site is being touched anyway.

Skill/Ultimate button branches change from Solace-specific inline logic to:
```typescript
if (btn.customId === "X_skill" && hasAlly && activeUnit === "ally") {
  const result = kit!.onSkill({ playerHp: state.playerHp, ..., mechanicState: state.allyMechanicState }, kitLevels, allyProgress.constellation);
  state.allyMechanicState = result.newMechanicState;
  playerDmg = Math.floor(calcPlayerDamage(activeAtk * result.damageMult, ...).damage);
  moveName = result.moveLabel;
  vibFrac = result.vibFrac;
}
```

### Migration: Solace onto the new shape

Solace's existing functions (`solaceIntroEffect`, `solaceOutroEffect`, `getAttunementAtkMult`/etc., `resolveSolaceStats`) **do not get rewritten** — they get wrapped. A new `src/lib/kits/solaceKit.ts` builds a `PlayableCharacterKit` object whose `introEffect`/`outroEffect`/`resolveStats` fields just call the existing `solace.ts` functions directly, and whose `onSkill`/`onUltimate` wrap the existing Attunement mode-cycle / Convergence heal logic (moving that inline combat-loop code into these two functions, reading/writing `mechanicState.attunement` instead of a loop-local `attunement` variable). This is the highest-risk part of the whole project — it touches Solace's live, working mechanics — so it's the first thing built and the most heavily manually-tested before any new character is added on top.

## Phasing (added after implementation-plan review)

The combat-loop rewiring described above (all 7 files dispatching through `CHARACTER_KITS`) is **deferred to Kaelith's implementation**, not built in this pass. Reasoning: Solace's Skill/Ultimate logic in each combat loop is more entangled with Forte/Wellspring/named-set bonuses than a clean extraction suggests, and rewiring it with nothing yet to *dispatch to* (no second character exists yet) is pure regression risk with no corresponding benefit. This pass builds and verifies `characterKit.ts` + `solaceKit.ts` in isolation (a standalone script confirms the wrapped functions produce identical output to the existing inline logic for representative inputs) — the actual combat-loop dispatch rewiring happens as the first step of Kaelith's own implementation plan, when a second character genuinely needs to be dispatched to.

## Non-goals

- No schema changes — `CharacterProgress` is already keyed generically by `characterId`.
- No change to Kaelith/Vesper/future-5★'s actual kit design — this spec is purely the scaffolding; their kits get their own specs once this lands.
- No multi-unit party (3+ simultaneous fighters) — out of scope, separate future project per earlier discussion.
- Standard-banner wish-pool integration (rolling characters alongside weapons) is a separate, smaller spec on top of this one — not covered here.

## Testing

- After the Solace migration: full manual playtest of every Solace-involving path in all 7 combat surfaces (swap, Skill, Convergence/Empowered Convergence, all 6 Constellations) to confirm zero behavior change from before the refactor — this is a pure refactor for her, any observable difference is a bug.
- `npx tsc --noEmit` after each file.
- A throwaway second kit (not Kaelith/Vesper — a minimal stub character with trivial Skill/Ultimate) wired in as a smoke test that the registry genuinely supports more than one character before either real character's spec starts, then removed once confirmed.
