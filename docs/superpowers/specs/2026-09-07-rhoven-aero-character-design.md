# Rhoven — 5★ Aero Standard Character — Design Spec

## Identity
- **Name:** Rhoven
- **Rarity:** 5★
- **Element:** Aero (currently the only element with zero playable characters)
- **Gender:** Male
- **Banner tier:** Standard — added to `StandardBannerCharacter` via `/owner-banner pool-add` once his kit ships (no `/wish` code changes needed, same mechanism already used for Rilo). No signature weapon (signature weapons are a Featured-tier thing — see Solace/Wellspring).
- **Fantasy:** Aerial control/support-hybrid. Every existing kit centers on *how hard* a hit lands (Solace's Attunement stances, Kaelith's stacking, Rilo's shield economy, Vesper's energy plays). Rhoven is the first to center on *when* things happen — turn tempo/economy — leaning on Aero's existing Windstride hook (+8% DMG/turn ×5) without duplicating it outright.

## Roster context at time of writing
| Character | Element | Rarity | Banner tier |
|---|---|---|---|
| Solace | Spectro | 5★ | Featured (has signature weapon Wellspring — was meant to be Standard, this was a mistake, now stuck Featured) |
| Rilo | Glacio | 5★ | Standard |
| Kaelith | Havoc | 4★ | ? |
| Vesper | Electro | 4★ | ? |
| **Rhoven** | **Aero** | **5★** | **Standard (new)** |

Stated goal: keep releasing Standard characters until every element has one, before circling back to more Featured releases. Two elements still fully open after Rhoven ships: Fusion and whichever element the 2nd 4★ in this release cycle doesn't take (decision deferred — see below).

## Stat baseline
Same curve as Rilo (`statsAtLevel`/ascension/level-up costs) — deliberately average, not a power-creep entry, since Standard-tier characters should feel comparable to each other rather than each new one outclassing the last.

## Mechanics (concept-level — exact numbers are implementation-plan detail, not spec detail)
- **Resonance Skill — "Windward Step":** a modest direct hit that also grants a stacking **Tempo** buff (a few turns, a handful of stacks max) — each stack adds a flat damage bonus to the next hit any active unit lands.
- **Resonance Ultimate — "Eye of the Squall":** disrupts the enemy's tempo instead of doubling Rhoven's own turn (avoids overlapping with Solace's ultimate) — delays/weakens the boss's next move. A control-flavored payoff, distinct from every existing kit's damage-focused ultimate.
- **Constellations:** themed around Tempo stacks — deeper cons let stacks carry over between fights, extend duration, or let Tempo apply to allies too, not just Rhoven.
- Implementable with existing primitives (`IntroOutroEffect`, `ForteConfig`, a simple `mechanicState.tempoStacks` counter) — no new combat-loop-wide systems needed, same pattern Kaelith/Rilo/Vesper followed.

## Deferred to a later decision
- The 2nd 4★ character for this release cycle (element + concept) — explicitly deferred by the user until after Rhoven ships. Candidate note: with Rhoven (Aero) + a Fusion 4★ (per Alpha's original roadmap ask), all 6 elements would have exactly one character each — the 2nd 4★ would be the first *second* character for whichever element gets picked (Havoc was floated as one option, pairing with Kaelith, but not locked in).

## Status
Concept + mechanical direction approved by the user. Full numeric kit design + implementation plan (matching the depth of the existing Kaelith/Rilo/Vesper implementation plans) is the next step, as its own dedicated build cycle — not done as part of this spec.
