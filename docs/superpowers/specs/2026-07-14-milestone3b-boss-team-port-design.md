# Milestone 3b — Team Mechanics in /boss Design

**Status:** Approved, ready for planning.

## 1. What this is

Ports the fully-built `/encounter`/`/dungeon` team-combat system (swap, Solace's kit, Wellspring, Forte, kit-leveling) into `/boss` — the second of the top-level [multi-character-teams design spec](2026-07-11-multi-character-teams-design.md)'s "Milestone 3: roll out to the remaining 6 combat surfaces." Same discipline as Milestone 3a: this is a port, not new design work, reusing every existing primitive and Solace-specific function as-is.

**Explicitly deferred, not touched here:**
- Any other combat surface (`/ascend`, `/duel`, `/raid`, `/field-boss`).
- Boss balance/rebalancing to account for team-mechanic power growth (noted by the user as a real future concern, explicitly deferred to a later milestone once this port has been live long enough to observe actual impact).
- New Solace mechanics, new Forte phases, new Wellspring ranks — none needed.

## 2. Architecture — same proven pattern as Milestone 3a, applied to a simpler (single-fight) structure

`/boss`'s `src/commands/rpg/boss.ts` shares `/dungeon`'s exact architecture: raw inline multiplicative damage formulas per move (no shared `calcPlayerDamage()` helper), and a per-turn message-recreation loop (`runTurn()` sends a new message + fresh single-use collector each turn, rather than one long-lived collector). Since `/boss` is a single continuous fight (no waves), team state is simpler to introduce than in `/dungeon` — no cross-wave threading needed, just standard per-fight initialization (matching `/encounter`'s pattern) feeding directly into the same turn-handling collector `/dungeon`'s port already proved out.

Team state fields (`activeUnit`, `allyHp`, `allyHpMax`, `concertoEnergy`, `playerDebuffs`, `attunement`, `attunementDoubleTurnsLeft`, `solaceForte`, `forteEmpoweredTurnsLeft`, `solaceBasicLevel`/`solaceSkillLevel`/`solaceUltimateLevel`/`solaceIntroLevel`/`solaceForteLevel`, `isDevGuild`) are declared once before the turn loop and read/written directly by the same closures the existing solo-play state already uses (no wave-boundary carry-over logic needed, unlike Milestone 3a).

## 3. Enrage interaction

`/boss`'s enrage phase (triggers at ≤40% HP: `ATK ×1.6`, always uses the highest-damage move) multiplies the enemy's attack-side term in the retaliation formula (`scaled.atk * move.damage * enrageMult - stats.def * 0.4`). Attunement/Wellspring/Forte DEF bonuses multiply the player's DEF-side term (`stats.def * attunementDefMult * 0.4`) — the two compose independently with no interaction risk, identical to how enrage already composes with existing DEF-reduction terms in this formula today.

## 4. What gets wired in

Identical to Milestone 3a: Solace's full kit (Basic/Skill/Ultimate/Intro/Outro), Wellspring's passive, Forte's gauge, Convergence's dual-target heal, kit-level scaling — reusing the exact same functions from `solace.ts`/`attunement.ts`/`wellspring.ts`/`forte.ts`/`characterProgress.ts`, zero new primitive code.

## 5. Lessons carried forward from Milestone 3a's bug history (built in from the start, not discovered after the fact)

- **Swap must fall through to the shared enemy-turn/decrement tail** — set `moveName`/`playerDmg = 0` and let execution continue into the existing Win-check → Enemy-counter → per-turn-decrements → Lose-check → Next-turn-send sequence, exactly like every other action. No independent message-send-and-return inside the swap branch.
- **`firstActionDone`/Quick-Strike/crit-reset must correctly exclude swap** (a free repositioning action, not a real attack) **but NOT exclude Solace's Convergence** (a real action that should set `firstActionDone`) **except from Quick Strike specifically** (Convergence deals 0 damage, so the SPD-driven bonus damage effect shouldn't fire on it).
- **WEAKENED must actually be wired in** — `applyDebuff`/`tickDebuffs`/`getWeakenedMult` must be called, not just imported for parity's sake. Tick before enemy retaliation resolves; apply with 25% chance on enemy retaliation; fold `getWeakenedMult(playerDebuffs)` into the player's own Basic/Skill/Ultimate damage formulas (not Solace's Attunement-cycle small hit, matching `/encounter`'s scoping).
- **`teamStatusLine()` must be added to the embed** showing Concerto Energy, the benched unit's HP, and active debuffs — this must ship in the SAME task that adds the team state, not be discovered missing afterward.
- **Convergence must not immediately refund Concerto Energy** — the same `convergenceUsedThisTurn` guard fix already applied to `/encounter` and `/dungeon` must be included in `/boss`'s port from the start (skip the generic per-move Concerto Energy gain on the same turn Convergence resets it to 0).

## 6. Testing

- `npx tsc --noEmit` clean.
- No new unit tests needed — same reasoning as Milestone 3a (all reused functions are already tested; this is integration wiring only).
- Manual Discord playtest in the dev guild: full boss fight through both pre-enrage and enrage phases, confirm swap/Solace's kit/Attunement/Wellspring/Forte/Convergence/WEAKENED/teamStatusLine all work exactly as they do in `/dungeon`, confirm enrage's ATK multiplier and Attunement's DEF bonus compose correctly (both apply, neither overrides the other), confirm non-dev-guild `/boss` is completely unaffected.
