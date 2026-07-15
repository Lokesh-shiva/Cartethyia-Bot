# Milestone 3d — Team Mechanics in /raid Design

**Status:** Approved, ready for planning.

## What this is

Ports the team-combat system into `/raid` — the one combat surface that's architecturally different from the other 5 (`/encounter`, `/dungeon`, `/boss`, `/ascend`, `/field-boss`), which all use a "1 player + their own 2-unit bench" model. `/raid` has real multiplayer (`RaidParticipant[]`, shared boss target, turn order via `currentIdx`), so the port isn't a 1:1 structural copy — it adapts the same primitives (Attunement/Wellspring/Forte/Convergence/Concerto Energy, all already built and battle-tested) to a party context.

## Confirmed design

1. **Solace is not shared.** Each participant has their own personal Solace — their own `CharacterProgress` row, their own kit levels — same ownership model as every other surface. Nobody pilots anyone else's Solace.
2. **Swap replaces the swapper's own turn.** No new turn slot is added to `currentIdx`'s rotation — swapping to Solace is a choice on the current turn-holder's own turn, exactly like swap works everywhere else, just happening inside a multiplayer turn order instead of a solo one.
3. **While a participant's Solace is active, her standing effects go party-wide**: Attunement's mode, Wellspring's passive, and Forte's Empowered mode all benefit every participant's actions, not just the owner's. Her direct-damage moves (Basic/Skill) stay single-target as normal.
4. **Convergence (Ultimate) heals the whole party**, not just 2 units.
5. **Solace has her own HP pool** (`allyHp`/`allyHpMax`) per owner, same pattern as every other surface. Boss retaliation against the owner's turn while Solace is active hits that pool, not the owner's own HP. KO auto-swaps back to the owner (existing pattern, reused as-is).
6. **Concerto Energy accrues exactly like solo fights** — only from the owner's own actions (whether acting as themselves or as Solace). No new cross-participant plumbing needed.
7. **Emergent stacking, not separately built:** since each owner has their own independent Solace instance, if multiple participants have unlocked her, more than one could have their Solace active on their own respective turns — their party-wide buffs simply stack. This isn't a special case to implement, it falls out naturally from "her buffs go party-wide" applying per-owner.

## Deferred to a follow-up

Separately raised: with team buffs now able to compound party-wide in raid (and similar stacking already seen elsewhere from named sets/evolved abilities/awakened weapons — see `CLAUDE.md`'s "Gotchas" section on the 2026-07-03 `gearAwareScale` cap bump), there's a fairness concern that boss difficulty may need another tuning pass across `/raid` and possibly other surfaces. That is being scoped as its own follow-up discussion, not bundled into this port.

## Testing

Same as Milestones 3a–3c: `npx tsc --noEmit` clean, no new unit tests (pure integration reusing already-tested primitives), manual Discord playtest with 2+ real participants confirming per-owner swap, party-wide buff propagation, Convergence's party heal, the ally HP pool, KO auto-swap-back, and that non-dev-guild raids are unaffected.
