# Milestone 3e — Team Mechanics in /duel Design

**Status:** Draft, needs review.

## 1. What this is

Ports the team-combat system (Solace, Attunement/Wellspring/Forte/Convergence/Concerto Energy) into `/duel` — the last of the 6 combat surfaces (`/encounter`, `/dungeon`, `/boss`, `/ascend`, `/field-boss`, `/raid` all done). `/duel` is PvP: two players, symmetric per-side state (`DuelState`'s `c*`/`d*` field pairs, `src/commands/rpg/duel.ts`), turn order by SPD, no shared enemy — each player's outgoing damage is the other player's incoming damage, resolved inline (no shared `calcPlayerDamage` boss-formula split like `/dungeon`/`/boss`, but `/duel` already calls `calcPlayerDamage` directly, so damage-formula shape isn't new ground).

## 2. Architecture — closer to /boss than /raid

Unlike `/raid` (real multiparty, shared boss target, AoE retaliation), `/duel` is two independent 1-vs-1 combatants — structurally this is **two solo `/boss`-style fights mirrored against each other**, not a party. Each player:

- Has their own personal Solace (own `CharacterProgress` row) — same ownership model as every other surface.
- Gets their own full team-state block: `activeUnit`, `allyHp`/`allyHpMax`, `concertoEnergy`, `playerDebuffs`, `attunement`, `attunementDoubleTurnsLeft`, `solaceForte`, `forteEmpoweredTurnsLeft`, `solaceBasicLevel`/`solaceSkillLevel`/`solaceUltimateLevel`/`solaceIntroLevel`/`solaceForteLevel` — mirrored as `c*`/`d*` pairs in `DuelState`, exactly like every other stat pair already there (`cHp`/`dHp`, `cNamedState`/`dNamedState`, etc.).

**No party-wide propagation** (that concept doesn't exist here — a duel side is one player, not a party of several). Attunement/Wellspring/Forte's standing bonuses apply only to their owner's own side, same scoping as solo `/dungeon`/`/boss`/`/ascend`/`/field-boss`.

## 3. Confirmed design

1. **Solace is not shared** — own `CharacterProgress`, own kit levels, per player.
2. **Swap replaces the swapper's own turn** — same as every other surface, happening on whichever side's turn it currently is (`state.currentTurn`).
3. **Standing effects (Attunement mode, Wellspring passive, Forte Empowered) apply only to the owner's own side** while their Solace is active — this is 1:1 with `/boss`'s scoping, not `/raid`'s party-wide propagation, since a duel side has no party to propagate to.
4. **Convergence (Ultimate) heals the 2-unit side** (the acting player + their own Solace), matching `/dungeon`/`/boss`'s pattern — not a party heal (no party exists).
5. **Solace has her own HP pool** (`cAllyHp`/`cAllyHpMax`, `dAllyHp`/`dAllyHpMax`) per side. **This is the one genuinely new wrinkle versus solo surfaces**: incoming damage in `/duel` comes from the opposing *player's* move, not a fixed boss retaliation formula — so the existing player-vs-player damage-application step (`state.dHp = Math.max(0, state.dHp - damage)` / `state.cHp = Math.max(0, state.cHp - damage)`) must route into `allyHp` instead of `hp` when the defending side's `activeUnit === "ally"`. KO on `allyHp` auto-swaps back to the owner (existing pattern, reused as-is) — this does NOT count as that side losing the duel (only `hp <= 0` on the player's own pool ends the duel).
6. **Concerto Energy accrues exactly like solo fights** — only from the owning side's own actions.
7. **Both players may have Solace active on their own respective turns** — since each side's state is fully independent, this falls out naturally with no special-casing (mirrors Milestone 3d's point 7, adapted: here it's "both sides can have her active," not "buffs stack," since there's no shared party to stack in).
8. **SPD-based first-strike bonus (`/duel`-specific, not present in other surfaces):** `/duel` already has a turn-1 SPD-edge bonus-damage mechanic (`state.turn === 1 && mySpd > oppSpd` → +15% dmg). Swap must be excluded from ever triggering or consuming this, same exclusion logic as `firstActionDone`/Quick-Strike-equivalent handling in every prior port (swap is a free repositioning action, not a real attack).

## 4. What gets wired in

Same primitive set as every prior port: Solace's full kit (Basic/Skill/Ultimate/Intro/Outro), Wellspring's passive, Forte's gauge + Empowered mode, Convergence's 2-unit heal, kit-level scaling, WEAKENED debuff — reusing the exact same functions from `solace.ts`/`attunement.ts`/`wellspring.ts`/`forte.ts`/`characterProgress.ts`/`debuffs.ts`, zero new primitive code. `isDevGuild` gating (checked once at duel-accept time, same as every other surface) so non-dev-guild duels are unaffected.

## 5. Lessons carried forward (same discipline as every prior milestone)

- **Swap must fall through to the shared per-turn tail** (damage/heal/energy application → win-check → cooldown ticks → turn switch → next message) — no independent early-return branch, the exact bug class every prior port had to guard against.
- **WEAKENED must be wired for real**: `applyDebuff`/`tickDebuffs`/`getWeakenedMult` actually called on both sides, ticked at the start of the opponent's damage-resolution step, folded into the player's own Basic/Skill/Ultimate formulas (not into Solace's Attunement-cycle hit).
- **A duel status line addition** showing both sides' active unit, Solace HP (if active), and Concerto Energy — must ship in the same task that introduces the state, matching the `teamStatusLine()` lesson from Milestone 3b.
- **Convergence must not immediately refund Concerto Energy** — same `convergenceUsedThisTurn` guard as every prior surface.
- **Ally-HP routing is per-side, symmetric** — both the `isChallenger` and `!isChallenger` damage-application branches need the `activeUnit === "ally"` check, not just one side (an easy asymmetric-copy-paste risk given `DuelState`'s existing `c*`/`d*` duplication pattern throughout the file).

## 6. Deferred / out of scope

- Boss-scaling/difficulty tuning discussion — not applicable to `/duel` (PvP, no boss).
- Any new Solace mechanics, new Forte phases, new Wellspring ranks — none needed, pure port.

## 7. Testing

Same bar as Milestones 3a–3d: `npx tsc --noEmit` clean, no new unit tests (pure integration reusing already-tested primitives), manual Discord playtest with 2 real dev-guild accounts confirming per-side swap, Solace's kit on both sides, Convergence's 2-unit heal, the ally HP pool absorbing opponent damage while active, KO auto-swap-back not ending the duel, WEAKENED application/decay, and that non-dev-guild duels are completely unaffected.
