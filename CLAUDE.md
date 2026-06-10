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

## Upcoming Features (next sessions)
- **Weapon Bond/Closeness**: post-awakening, weapon starts at partial power and grows to full through use (battles fought with it). Touches every combat loop.
- **Profile/weapon canvas overhaul**: more impactful awakened weapon art on profile card (user wants bigger than current small PNG).

## Gotchas
- Prisma v7: no `url` in datasource — adapter only. After schema changes: `npm run db:push` then `npx prisma generate`.
- `ephemeral: true` → `flags: 64`. `fetchReply` → `withResponse: true`. p-queue must be v7.
- New command → `npm run deploy`. AI: `max_tokens ~40`, hardcoded fallbacks for offline LM Studio.
- Whisper Crystals: removed. Don't re-add. Multi-server: `loadAllGuildSettings()` on ready.
- BOSS_ART_FILENAMES defined in 3 places: `echoCard.ts`, `gridCard.ts`, `canvas.ts` — update all three when adding bosses.
- `gearAwareScale` in combat.ts: ALL axes hard-capped (levelScale ≤2.2, hpScale ≤2.0, atkScale ≤1.7, defScale ≤1.5; gearRatio capped 2.0 HP / 2.5 ATK). Boss bases already encode WL progression — uncapped stacking one-shot every WL5+ player and made 300k+ HP slogs. Target: ~24-turn fights, avg hit ~32% player HP.
- `/boss` re-challenge: fightLevel capped at WL's level ceiling, gearRatio capped at 2.0, weights 0.40/0.30 (farmable but not trivial).
- `communityFooter(guildId)` in `src/lib/communityFooter.ts` — shows invite link only outside MAIN_GUILD_ID. `voteNudge()` in `src/lib/voteNudge.ts` — 20% chance upvote prompt in reward messages.
