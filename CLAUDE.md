# CARTETHYIA — Project Memory
<!-- TARGET: keep this file under 100 lines. Cut prose; use tables and bullets. -->

## Tech Stack
| Layer | Choice |
|---|---|
| Language | TypeScript (CommonJS, tsx) |
| Discord | discord.js v14 |
| Database | Neon PostgreSQL — project `cartethyia` (`restless-waterfall-87620987`) |
| ORM | Prisma v7 + `@prisma/adapter-pg` (see `src/lib/prisma.ts`) |
| AI | LM Studio `http://localhost:1234/v1`, model `qwen2.5-7b-instruct`, p-queue v7 concurrency 1 |
| Canvas | `@napi-rs/canvas` — all image cards in `src/lib/*Card.ts` and `src/lib/canvas.ts` |

## Scripts & Env
- `npm run dev` / `npm start` / `npm run deploy` (auto-discovers all `src/commands/**/*.ts`) / `npm run db:push`
- `GLOBAL=true npm run deploy` for production. Key IDs: `CLIENT_ID=1510163339177623642`, `GUILD_ID=1495681992082194432` (dev server), `MAIN_GUILD_ID=1410663578624725045` (Eureka Society — production main server), owner=`979379636586819746`

## Structure
```
src/commands/{social,rpg,utility}/   src/events/   src/lib/   src/index.ts
assets/{backgrounds,icons,fonts,echoes/1-cost,echoes/3-cost}
Bosses/  ← boss art PNGs, Title Case with spaces. Never snake_case.
```

## Core Systems
- **Combat**: `resolvePlayerBonuses` (setBonus.ts) → `applyBonuses` → fight loop. Used in ascend/boss/field-boss/encounter/dungeon/duel/raid.
- **Element trigger at Lv20**: `messageCreate.ts` AND `use.ts` both call `sendElementSelection`. Don't add a third path.
- **Bosses WL0–8**: `src/lib/bosses.ts`. Art in `Bosses/`. `getBoss(wl)` returns null for WL9+.
- **Resonance Aura**: `src/lib/aura.ts` — 5 charges max, 1/3h regen. Dungeons cost 1◈, boss trials cost 2◈, `/boss` costs 1◈, `/field-boss` costs 1◈. No more per-dungeon cooldowns.
- **Echo substats**: scale with echo level via `calcSubstatValue(type, base, level)` in echoes.ts — 1.5× at Lv25. Base roll stored in DB, computed on read everywhere.
- **Echo upgrade**: `/echo-upgrade` has +1/+5/Auto buttons + Auto-Reveal toggle (Sealing Tubes at Lv 5/10/15/20/25).
- **Weapon upgrade**: `/weapon-upgrade` has +1/+10/Auto buttons.
- **Shop**: Records = 500 credits each. `/use record` max = 5 per use.
- **Named Echo Sets**: 6 lore sets in `src/lib/namedSets.ts` (setId on Echo, distinct from plain `element`). 2pc stat bonuses apply everywhere via setBonus.ts; 4pc/5pc mechanic hooks wired into all 6 combat loops (field-boss/boss/ascend/dungeon/duel/raid) — duel/raid needed adapted triggers since they lack a shatter/vib concept. `NAMED_SET_ECHO_DEFINITIONS` (18 new 1/3-cost) + 6 new 4-cost `BOSS_ECHO_DEFINITIONS` guardians in `/field-boss`.
- **Echo lock**: `isLocked` on Echo — `/echo-lock` toggles; excluded from `/echo-discard` and `/echo-reroll` candidate pools.
- **Custom icons**: `src/lib/emojiManager.ts` — app emojis (bot-owned, work in every server) for currencies (`CE.xx`) and 1/3-cost echoes (`echoEmoji()`/`echoEmojiResolvable()` for select-menu emoji). 4-cost echoes have no icon by design (full card art instead). New echo added → register in both `EMOJI_ASSETS` and `ECHO_EMOJI_MAP` or its icon silently no-ops.
- **Canvas text**: Rajdhani font has no unicode symbol glyphs (✦, likely ◈ too) and the system-font fallback isn't reliable on the Oracle VM — use plain ASCII (`*`) in any `ctx.fillText()`. Discord embed text is unaffected (rendered by Discord's client, not our server).

## World Levels & Bosses
| WL | Boss | Element | Weakness | Level Cap |
|---|---|---|---|---|
| 0 | Resonant Wraith | HAVOC | SPECTRO | 20 |
| 1 | Tidecaller Sovereign | GLACIO | FUSION | 40 |
| 2 | Fractured Arbiter | SPECTRO | HAVOC | 50 |
| 3 | Nullfire Construct | ELECTRO | AERO | 60 |
| 4 | Sable Harbinger | HAVOC | SPECTRO | 70 |
| 5 | Auric Colossus | SPECTRO | HAVOC | 80 |
| 6 | Embercrown Tyrant | FUSION | GLACIO | 84 |
| 7 | Galeborne Phantom | AERO | ELECTRO | 88 |
| 8 | The Resonant Absolute | SPECTRO | HAVOC | 90 |

Boss trials for all 9 in `dungeons.ts`. Field bosses (6, one/element) in `src/lib/fieldBosses.ts` → `/field-boss` command. Each field boss drops a 4-cost echo; BOSS_ECHO_DEFINITIONS for all 6 are in `src/lib/echoes.ts`. Art in `Bosses/`.

## Elements & Innate Bonuses
| Element | Stat Bonuses | Hook |
|---|---|---|
| 🔥 Fusion | +15% ATK, +15% Crit, +20% Elem DMG | IGNITE 35% → +25% ATK hit |
| ❄️ Glacio | +30% DEF, +15% HP, +20% Elem DMG | FROST_SHIELD 25% → absorb 40% |
| ⚡ Electro | +5% Crit, +20% Crit DMG, +25 Energy/turn | DISCHARGE crit → +20 energy |
| 🌪️ Aero | +15% ATK, +40% Crit DMG, +20% Elem DMG | WINDSTRIDE +8% DMG/turn ×5 |
| 🌑 Havoc | +15% ATK, +20% Lifesteal, +20% Elem DMG | VOID_SURGE Shatter → +25% HP |
| ✨ Spectro | +30% HP, +20% Elem DMG | RADIANCE 2% regen + <40%HP: +25% Crit |

## Currencies & Progression
- 8 currencies: Credits · Lunakite · Tuning Modules · Sealing Tubes · Forging Ores · Paradox Cores · Stasis Locks · Resonance Records
- Chat EXP: **3–8/message** (reduced), 3s cooldown. Formula: `100 * level^1.6`
- Per level: +12 HP, +3 ATK, +2 DEF, +1 SPD. Element at Lv20. Unique ability on first ascension win.
- Boss enrage at ≤40% HP in ascend/boss: ATK ×1.6, always uses highest-damage move, shatter recovery 60% vib.

## Ability Evolution (Lv50)
- `/evolve` — ordered quest: start → 3 dungeon clears → WL5+ `/boss` kill → pay 5 Paradox Cores + 8 Stasis Locks.
- `src/lib/abilityEvolution.ts`: effects ×1.3 (over-cap to 1.3× registry max) + 4th primitive. `generateEvolution()` uses AI with FULL player context (personality, bonds, combat record, equipped weapon, echo build) for evolved name/effect/lore/4th pick; deterministic element-epithet fallback if LM Studio offline.
- `sanitizeEffects(raw, evolved)` — evolved=true allows 4 effects + 1.3× max clamp. Pass `user.abilityEvolved` wherever stored effects are read (setBonus.ts and ability.ts do).
- Quest hooks: `trackEvolutionProgress()` in dungeon.ts `grantRewards` + boss.ts win cleanup.
- Evolved card: gold accents, 540px tall, 4 effect slots (`evolved` flag on `generateAbilityCard`).

## Ego Weapon Awakening (Lv60)
- `/awaken` — requires player Lv60+, evolved ability, equipped weapon. Cost: 20 Forging Ores + 8 Paradox Cores + 20k Credits. One-time, permanent.
- `src/lib/weaponAwakening.ts`: `generateAwakening()` — AI (full player context + evolved ability + weapon) generates name/lore/artPrompt/new effect; deterministic element-epithet fallback. Refunds cost on hard failure.
- Stats ×AWAKEN_STAT_MULT by rarity (3★ 1.15 / 4★ 1.20 / 5★ 1.25) applied to baseAtk + subStatVal + hidden sub vals. Existing passive amplified ×1.25 (cap 1.3× registry max) + 1 new effect (value position in range scales with rarity).
- Weapon row keeps original `name`; awakened identity in `awakened*` fields. `awakenedPassive` JSON `{desc, elemDmg?, effects[]}` replaces WEAPON_PASSIVES lookup in setBonus.
- Awakened art: drop PNG at `assets/weapons/awakened/{awakenedName}.png` — `getWeaponImagePath` checks it first, card auto-upgrades. Art prompt stored in DB + shown on awakening embed.
- **Hidden substats now apply in combat** (setBonus, Lv20/Lv50 gates) — they were display-only before.

## TODO Next
1. **Echo Skills** — give echoes their own skill/variety, new "Echo Skill" attack button alongside Basic/Skill/Ultimate. Design so far: Main-slot echo only grants it, skill determined by (element, cost tier) not per-echo, own cooldown separate from Resonance Skill. Not yet built.
2. Consider: `/echo-compare`, upgrade cost preview, DB-backed dismantle/merge alternative if dismantle-for-currency ever feels insufficient, SPD dodge/evasion mechanic (deferred — turn order shipped first).
3. Long-term/no rush: animated fight/boss visuals (currently only `/wish` has animation) — would need a real client-side animation approach (GIF sequence? external renderer?), not a small addition.

**SPD is now a real combat stat** (was purely cosmetic): `bonuses.spdFlat` (setBonus.ts) aggregates echo Speed substats only — NOT `baseSpeed`, which grows +1/level for everyone regardless of build and shouldn't drive build-reward mechanics. `ResolvedStats.spd = baseSpeed + spdFlat` is the total used for turn-order comparisons. Four hooks: `effectiveSkillCooldown()` (-1 turn Skill CD at 40+ spdFlat), `+1 energy/turn per 20 spdFlat` (baked into `energyPerTurn` in ascend/boss/dungeon/field-boss/encounter via `stats.energyPerTurn` — but duel/raid use a flat `ENERGY_PER_TURN` constant instead, so they need the spdFlat bonus added manually, don't double-add), `hasQuickStrike()` (solo fights: one-time bonus Basic Attack if `stats.spd` clears `derivedBossSpd(level)` by 20+), and SPD-based turn order/first-strike in duel + raid (participants sorted by `stats.spd` in raid, faster player goes first + gets a first-action damage bonus in duel).

## Gotchas
- Prisma v7: no `url` in datasource — adapter only. After schema changes: `npm run db:push` then `npx prisma generate`. DB client lives in `src/lib/prisma.ts` (Neon adapter + retry — don't revert to adapter-pg).
- `ephemeral: true` → `flags: 64`. `fetchReply` → `withResponse: true`. p-queue must be v7.
- New command → `npm run deploy`. AI: `max_tokens ~40`, hardcoded fallbacks for offline LM Studio.
- Whisper Crystals: removed. Don't re-add. Multi-server: `loadAllGuildSettings()` on ready.
- BOSS_ART_FILENAMES defined in 3 places: `echoCard.ts`, `gridCard.ts`, `canvas.ts` — update all three when adding bosses.
- `gearAwareScale` in combat.ts: ALL axes hard-capped (levelScale ≤3.0, hpScale ≤2.8, atkScale ≤2.4, defScale ≤2.0; gearRatio capped 2.7 HP / 3.4 ATK; defaults levelWeight=0.65, gearWeight=1.0). Uncapped, stacked level×WL×gear terms one-shot WL5+ players. 2026-07-03: caps + encounter/`/boss` weights bumped ~35-40% — stacked player-power systems (named sets, evolved abilities, awakened weapons) had outpaced these ceilings.
- `/boss` re-challenge: fightLevel capped at WL's level ceiling, gearRatio capped at 2.7 (was 2.0), weights 0.55/0.40 (was 0.40/0.30) — farmable but not trivial.
- `/raid` `computeRaidBossStats` (raid.ts): HP/ATK/DEF/vibBar are PURELY party-derived (totalAtk/avgHp/avgAtk of participants) — the selected boss's own baseHp/baseAtk/baseDef/vibBar no longer factor into scaling at all, only into name/element/moves/loot. Previously a boss's own base stats could override the party-scaled target (WL8's baseDef 1080 vs. a field boss's ~100), making boss choice matter far more than party size/gear. Don't reintroduce a `Math.max(boss.baseX, target)` floor — that's exactly what caused it.
- `communityFooter(guildId)` in `src/lib/communityFooter.ts` — shows invite link only outside MAIN_GUILD_ID. `voteNudge()` in `src/lib/voteNudge.ts` — 20% chance upvote prompt in reward messages.
