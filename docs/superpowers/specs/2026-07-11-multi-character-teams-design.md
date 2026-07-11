# Multi-Character Teams — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans (recommended) to turn this spec into a task-by-task implementation plan before writing any code.

**Goal:** Evolve CARTETHYIA from "one personalized character per player" into "your personalized character + a 3-unit team of collectible banner characters," with WuWa-level cross-character combat depth (swap mechanics, shared team resources, kit-altering progression) — without discarding the AI-generated personalized-ability system that makes this bot distinct from a generic gacha bot.

**Architecture:** A layered build — a new multi-unit combat engine foundation first (proven in isolation and in one combat loop before any content or monetization is built on top), then the first banner character (Solace) as real content validating the engine, then rollout to the remaining 6 combat surfaces, then the gacha banner/economy layer.

**Tech Stack:** Existing stack (TypeScript/discord.js/Prisma), extending the already-proven composable-primitive pattern from `src/lib/abilityEffects.ts` and `src/lib/echoSkills.ts` rather than inventing a new architecture style.

---

## 1. Why this shape, not a flat feature list

This was originally pitched as "multi-character teams." It decomposes into six dependent layers — nothing above Layer 1 can be meaningfully designed, let alone built, until Layer 1's mechanics exist:

```
Layer 5 — Monetization:      Character gacha banner (50/50 pity, rotation)
Layer 4 — Depth:             Constellations + signature weapons per character
Layer 3 — Build depth:       Per-character echo grids, support-flavored named sets
Layer 2 — Content:           Roster characters (kits, roles, art)
Layer 1 — Foundation:        Multi-unit combat engine (ally-targeted actions,
                              swap mechanics, shared team resources)
```

This spec covers the full design (all 6 layers, at the depth needed to build them), but implementation is explicitly sequenced Layer 1 → Layer 2 → outward (see §9, Milestone Sequence). Do not build Layer 4/5 mechanics before Layer 1 is proven — that was the mistake this decomposition step was designed to prevent.

## 2. The one identity decision that shapes everything else

**Your own personalized character (AI-generated unique ability, evolves via Ascension) is NOT retrofitted with the new mechanics.** It keeps its existing ability-evolution system exactly as it is today. It becomes one of the 3 team slots and benefits from team-wide effects (Concerto Energy generation, banner-character buffs like Solace's Attunement Modes, swap participation) — but it does not get a full Intro/Outro/Forte/Attunement kit like banner characters do.

**Banner characters carry all the new mechanical depth.** This is a deliberate, low-risk boundary: it protects the single most distinctive thing about this bot (personalization) from being diluted or destabilized by a large new system, while still making your existing character feel meaningfully stronger as part of a team.

**Exception — a universal Intro/Outro pair.** Since your own character is *always* one of the 3 team slots, giving it zero Intro/Outro would mean the "swap consumes a turn, but both Outro and Intro fire as the payoff" rule (§4.2) structurally breaks for 1 of every team's 3 members, on every single team, all the time — not a rare edge case. Fix: the player's own character gets **one universal, generic, non-authored Intro/Outro pair** — e.g. Intro: a small flat shield; Outro: a small flat Energy boost to whoever swaps in. Not personalized content (that isn't feasible per-player), just enough to keep the swap economy consistent regardless of team composition.

## 3. Engine architecture — how this stays evolvable

The codebase already has two proven examples of exactly the "adaptable, evolves without rewrites" property this system needs:

- `abilityEffects.ts` — unique abilities/weapon passives are composed from a small registry of primitives (`SKILL_POWER`, `EXECUTE`, `BERSERK`, `LIFESTEAL`, etc.), applied generically by shared functions (`compositeDamageMult`, `compositeHealOnHit`, ...). Adding new content almost never touches combat-loop code.
- `echoSkills.ts` — Echo Skill mechanics are a discriminated union of ~15 "kinds" with one shared `applyEchoSkill()` dispatcher, reused across all 6 existing combat loops.

**Every new system in this spec (debuffs, Attunement Modes, Intro/Outro hooks) follows this same shape**: a small typed vocabulary + shared apply/resolve functions. A new character's kit should, in the common case, be a new *combination* of existing primitives (zero engine changes). A genuinely novel mechanic means adding ONE new primitive to a registry — a small, isolated change — not touching all 7 combat loops.

### Testing strategy (answers "how do we test this")

1. **Unit-test primitives in isolation** — each primitive (a debuff type, an Attunement Mode, an Intro/Outro hook) is a small pure function, testable without a full fight.
2. **Batch simulation harness** — run N simulated team fights with varied comps/stats, report win rate / avg turns-to-clear / avg damage taken. Same technique already used this project to verify the field-boss rarity math and the raid vibBar/effectivePower fixes before either shipped.
3. **Dev-guild gradual rollout** — ship behind non-global command registration first (the project's existing pattern for new commands), so a small group can bash on it before it's globally visible.

## 4. New Layer 1 primitives

### 4.1 Concerto Energy
A new **shared, team-wide** resource (distinct from each character's existing personal Energy meter). Only one character acts per turn (the others are benched), so this fills from whichever character is currently active — the distinction from personal Energy is that it **persists across swaps** rather than being tied to one character's turns (personal Energy is per-character and doesn't carry over when that character is swapped out). Gates team-wide payoff moments (e.g. Solace's Constellation 3 grants a burst on mode-switch). Does not replace per-character Energy — sits alongside it.

### 4.2 Swap mechanics
Swapping the active character **consumes the turn** (not free). Rejected alternative: free swap + a per-character cooldown to prevent spam — rejected because it effectively grants 2 actions per turn in a system where the enemy only acts once per player turn, a real exploit surface.

The compensating design lever: **both the outgoing character's Outro Skill AND the incoming character's Intro Skill fire on the same swap action** — one turn "spent" buys two payoffs, which is what makes the cost feel worthwhile instead of purely administrative.

### 4.3 Ally-targeted actions
New action category: heal an ally, shield an ally, buff an ally, cleanse an ally's debuffs. Doesn't exist today — combat is currently solo-vs-enemy or shared-boss-vs-many, with no concept of "an ally to target."

### 4.4 Intro / Outro Skill hook points
Two new trigger points per banner character:
- **Intro Skill** — fires when the character is swapped IN.
- **Outro Skill** — fires when the character is swapped OUT. **Does not level up** (stays fixed regardless of investment) — this is a deliberate asymmetry, not an oversight; see §7.

Both hooks can optionally include a **damage component** against the enemy, alongside (or instead of) ally-targeted utility effects — matching WuWa, where Intro Skills especially are often a real attack, not just a buff. Solace's Intro/Outro are pure-utility by design (she's a support), but the hook type itself supports damage so a future DPS-archetype character's Intro/Outro can hit hard, not just buff.

### 4.5 Minimal debuff system
The current codebase has exactly one debuff-shaped mechanic (DEF Shred), and it only targets the *enemy*. Nothing currently applies a debuff to the player's own team. This spec adds a small, composable vocabulary — same "typed list + shared apply/tick/cleanse function" shape as `AbilityEffect`:

| Type | Effect |
|---|---|
| `WEAKENED` | -X% ATK for N turns |
| `VULNERABLE` | +X% damage taken for N turns |
| `BLEED` | Flat damage at the start of the affected unit's turn, for N turns |

**Deliberately excluded from this minimal version: Silence-style debuffs** (can't-use-Skill/Ultimate). That requires conditionally disabling specific Discord buttons mid-fight — real UI-state engineering that doesn't exist today. Add later once that infrastructure exists; don't block this system on it.

A future 4th+ debuff type is one addition to the vocabulary + one case in the shared tick/cleanse functions — not a rewrite, matching the composability goal in §3.

## 5. Team combat UI

- Extends the existing multi-participant HP-bar text pattern already used in `/raid` — one HP bar line per teammate.
- Two button rows: **row 1** = the active character's moves (Basic/Skill/Ultimate + their Echo-Skill-equivalent if any); **row 2** = swap targets (select which benched ally to bring in).
- **Rendering**: a one-time team splash render at fight START only — not per-turn. Routine turns stay text-only exactly like today (reuses the existing "Last Action" damage-number pattern, already confirmed present in both `/encounter` and `raid.ts`). This keeps latency identical to today's fights; the "looks cooler" payoff comes from the one-time splash, not from re-rendering images every turn.

## 6. Character #1 — "Solace," Universal Support

**Element:** Spectro (matches existing lore — Spectro already owns the "life/light/regen" identity in the element table). **Weapon type:** Rectifier. **Role:** universal support — buffs apply regardless of which element or character she's paired with; she is not element-locked to any team.

| Hook | Name | Effect |
|---|---|---|
| Basic Attack | Chime Strike | Modest elemental damage. Builds Concerto Energy + her own Forte gauge. Not her value — keeps her relevant on-field. |
| Skill | Attunement | Sets her buff to one of 3 switchable modes — **ATK Mode**, **Crit Mode**, or **DEF Mode** — a moderate % team buff matching whichever mode is active. The core strategic lever: switch modes to match your active DPS's build. |
| Ultimate | Convergence | Team-wide heal + cleanses 1 debuff (2 at Constellation 2) + doubles her active Attunement Mode's effect for 3 turns (4 at Constellation 5). |
| Intro Skill | — | Instant team heal + immediately applies her current Attunement Mode with zero ramp-up. Makes reactive swaps (after a big hit) feel good. |
| Outro Skill | — (does not level) | Shields the incoming ally + guarantees their next attack crits. Rewards swapping her out strategically to set up the next character's big hit. |

### Forte
Single long bar (not two-phase — a steady "build up, then unleash one big moment" identity fits a support better than a burst-phase design). Fills from Basic Attacks. At full charge, her **next Ultimate is Empowered**: instead of doubling only her currently-active mode, it applies a smaller version of **all three** Attunement Modes at once. This is deliberately the same effect Constellation 6 makes *permanent* — Forte lets every player taste what C6 feels like periodically; C6 rewards going all-in on her with the permanent version.

Communicated via text status lines in the battle log ("✨ Solace's Forte is HALF CHARGED" / "✨ Solace's Forte is FULLY CHARGED — her next Ultimate will be Empowered!"), not a visible bar — avoids cluttering an already-busy fight embed (enemy HP + Vib bar + 3 teammate HP bars + Concerto Energy already compete for space).

### Resonance Chain (Constellations)
Odd tiers = utility. Even tiers = real kit changes, not flat numbers. C6 is the defining, hardest-to-get upgrade.

| Tier | Effect |
|---|---|
| C1 | Outro's guaranteed-crit buff also grants the incoming ally +15% ATK for their first action after the swap. |
| C2 (kit change) | Ultimate's heal significantly increased; cleanses 2 debuffs instead of 1. |
| C3 | Switching Attunement Mode (Skill) also grants a team-wide Concerto Energy burst. |
| C4 (kit change) | Intro Skill's heal also grants a shield equal to 30% of the amount healed. |
| C5 | Ultimate's doubled-mode-effect duration extends from 3 turns to 4. |
| C6 (defining) | While one Attunement Mode is active, allies ALSO gain 50% of the other two modes' effects — she becomes a true all-in-one buffer. |

## 7. Signature Weapon — "Wellspring" (Rectifier)

**Not character-exclusive** — any character with a Rectifier slot can equip it, matching the existing weapon system's architecture (nothing in `weapons.ts`/`wishWeapons.ts` locks a weapon to one character today). Its passive is *authored around* Solace's kit without *requiring* her to have value.

**Base passive (any wielder):** +Energy Regen substat, modest flat ATK% — real value even for a player who never pulls Solace.
**Bonus passive (only if the wielder has an active Attunement Mode, i.e. is Solace):** amplifies the currently active mode further; reduces the Attunement-switch (Skill) cooldown at higher refinement.

**Stats:** Main stat ATK · Substat Energy Regen · Hidden Sub 1 (Lv20) HP% · Hidden Sub 2 (Lv50) Elemental DMG.

**Refinement (R1–R5):** Evolves the Attunement synergy rather than scaling a flat number. R3 and R5 specifically preview smaller versions of what Constellations C6 and C5 fully unlock — so owning both weapon and character copies compounds meaningfully, without either being required for the other to function.

| Rank | Effect |
|---|---|
| R1 | Amplifies the active Attunement Mode by +X%. |
| R2 | Mode-switch (Skill) also grants a small single-target burst of the new mode to one ally. |
| R3 (previews C6) | Amplification extends to the two inactive modes at reduced value. |
| R4 | Amplification increases further; Skill cooldown -1 turn. |
| R5 (previews C5) | Full amplification; Ultimate's doubled-mode-effect duration extends by 1 additional turn (stacks with C5). |

## 8. Kit-leveling (out-of-combat Forte progression)

Basic Attack, Skill (Attunement), Ultimate, Intro Skill, and the Forte node system **each have their own individual level**, raised via a **single unified per-character material** (explicitly not per-move-track materials — multiple distinct currencies per character was rejected as a player-facing complexity/frustration risk). **Outro Skill does not level** — stays fixed regardless of investment, mirroring its "does not level" status in §6.

**Deferred to a later milestone, NOT part of initial launch scope:** the weekly-capped material economy (target shape, for future reference: a specific boss drops the material, capped at 3 kills/week, 3 items per kill = 9/week ceiling, ~26+ materials needed to fully level a single track). For initial launch, materials drop through a simpler, uncapped mechanism (e.g. an existing boss's loot table) — the scarcity/weekly-reset economy is explicitly a follow-up system once the core leveling mechanic is live and proven.

## 9. Character profile UI

Multi-page switchable view — reuses the existing `/guide` command's proven pattern (a Select Menu that swaps the embed/image on selection). No new interaction paradigm needed.

**Pages:** Stats → Weapon → Echoes (this character's own equipped echo grid, not shared with the account's other characters) → Kit Levels (Forte gauge status + individual Basic/Skill/Ultimate/Intro levels) → Constellations (Resonance Chain progress) → Lore (background + "daily life" flavor text).

**Card format:** 16:9 landscape (distinct from the 9:16 portrait splash art used for the banner pull-reveal moment — different UI moments, different needs). Rendered as canvas images, not plain text embeds, for visual consistency with the rest of the game. Reuses **3-4 shared template shapes**, not 6 bespoke designs:
- Stats + Kit Levels → shared "stat bars + numbers" template
- Echoes + Constellations → shared "grid of slots, some filled/locked" template
- Weapon → reuses the existing weapon card almost as-is
- Lore → its own simpler "portrait + styled text" template

## 10. Art direction

Both character and weapon art **keep their painted backgrounds** (not transparent) — an explicit choice overriding the initially-recommended transparent-cutout approach. **Implementation note:** the existing card-render code (`weaponCard.ts` et al.) draws its own tinted background behind the art panel before compositing — with backgrounds baked into source art, this may double-layer; resolve during implementation by either skipping the card's own background tint for character/weapon art, or accepting the layered look if it still reads cleanly.

**Aspect ratio:** 9:16 for the character standing-model splash (the pull-reveal moment) — standard convention for full-body character portrait art, matches Genshin/WuWa's character detail screens.

Full detailed art-generation prompts for Solace and Wellspring were produced during brainstorming and are available on request — not duplicated here to keep this spec focused on mechanics/architecture.

## 11. Banner economics

- **The character banner is fully independent of the existing weapon banner (`/wish`).** Separate pity counter, separate 50/50 tracking, no shared pool. `/wish`'s existing weapon gacha is untouched by any of this — forcing players to choose between "the character I want" and "the weapon I want" on a shared pity counter is exactly the kind of frustrating gacha design every successful game in this genre avoids by keeping banner types independent.
- **1 character released per banner, ~23-day run.**
- **Banner #1 (Solace) is guaranteed, not a 50/50** — there is no existing standard-pool character to lose the coin flip into yet. Every 5★ pull on banner #1 is Solace.
- **From banner #2 onward**, standard mechanic applies: lose the 50/50 → still receive a 5★ (the previous banner character, now "graduated" into the standard pool) → your very next 5★ pull on that banner is then guaranteed to be the new featured character (no re-flip; nobody walks away with nothing).
- **Standard-pool characters should be reliably solid, not weak.** Explicitly rejected: literally "below average" standard-pool units — that breeds "I lost AND got trash" resentment. The target is "no gimmick, less flashy than the current banner unit, but still genuinely good to own" (matches how Genshin/HSR actually tune their standard pools).
- **Only 5★ characters for now**, due to limited art-team capacity.
- **The 8 previously-designed new weapons (Warden's Bulwark, Bloodfeast Render, Aetherclock Blade, Zephyr's Verdict, Twin Requiem, Riftcaller's Cadence, Fracturelight Prism, Hollowmind Cipher) are cut from scope entirely** — not part of this plan, not repurposed. The **existing 4 five-star wish weapons** (Oathbreaker's Edge, Ruin Sovereign, Null Fangs, Abyssal Tome) remain as-is and are unrelated to this system.

## 12. Implementation milestone sequence

**Each milestone gets its own implementation plan, not one plan covering all six.** This spec describes the full picture so every milestone is designed with the end state in mind, but planning and building happen one milestone at a time — starting with Milestone 0 only.

1. **Milestone 0 — Engine primitives in isolation.** Debuff system, Concerto Energy, ally-targeting, Intro/Outro hooks — built and unit-tested/batch-simulated with zero live wiring into any real combat loop.
2. **Milestone 1 — Prove it in ONE combat loop.** Wire multi-unit party mechanics into `/encounter` (the simplest existing combat surface — no named-set state, per the project's own notes). Use a placeholder dummy ally, not real content. Dev-guild only.
3. **Milestone 2 — Build Solace for real.** Full kit, Wellspring + refinement, constellations, using the now-proven primitive system.
4. **Milestone 3 — Roll out to the remaining 6 combat surfaces.** Ascend, boss, dungeon, duel, raid, field-boss — one at a time, since each has its own existing bespoke state to integrate with.
5. **Milestone 4 — The gacha banner + economy.** Pull mechanics, currency, the guaranteed-banner-#1 rule, banner UI.
6. **Milestone 5 — Art integration + launch.** Wire finished art into the pull reveal and profile cards, polish, ship.

## 13. Explicitly deferred (noted, not forgotten, not in initial scope)

- Weekly-capped Forte material economy (target: 3 boss kills/week, 3 items/kill, ~26+ per character) — see §8.
- Silence-style debuffs — needs button-disabling UI infrastructure that doesn't exist yet — see §4.5.
- Elemental application + reaction matrix between teammates' hits (a full Genshin-vaporize-style interaction system) — compelling, but a significant scope addition; explore as its own future layer once Milestone 1 ships, not folded into this spec.
- Generic "Coordinated Attack" assist-hit mechanic (raised as a flavor idea during brainstorming, not committed into Solace's kit specifically) — a candidate primitive for a future character.
