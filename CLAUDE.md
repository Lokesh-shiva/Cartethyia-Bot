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
- `GLOBAL=true npm run deploy` for production. Key IDs: `CLIENT_ID=1510163339177623642`, `GUILD_ID=1495681992082194432`, owner=`979379636586819746`

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

Boss trials for all 9 in `dungeons.ts`. Field bosses (6, one/element) in `src/lib/fieldBosses.ts` → `/field-boss` command. **TODO**: field bosses need 4-cost echo drops + their own BOSS_ECHO_DEFINITIONS (Ignis Behemoth/Permafrost Sovereign/Voltaic Aberrant/Tempest Ancient/Null Ravager/Luminal Specter). Art goes in `Bosses/`.

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

## Gotchas
- Prisma v7: no `url` in datasource — adapter only. After schema changes: `npm run db:push` then `npx prisma generate`.
- `ephemeral: true` → `flags: 64`. `fetchReply` → `withResponse: true`. p-queue must be v7.
- New command → `npm run deploy`. AI: `max_tokens ~40`, hardcoded fallbacks for offline LM Studio.
- Whisper Crystals: removed. Don't re-add. Multi-server: `loadAllGuildSettings()` on ready.
- BOSS_ART_FILENAMES defined in 3 places: `echoCard.ts`, `gridCard.ts`, `canvas.ts` — update all three when adding bosses.
- `gearAwareScale` in combat.ts: HP capped at gearRatio 3.0 (prevents 400k+ HP slogs), ATK uncapped.
- `/boss` re-challenge: uses `boss.worldLevel` (not `user.worldLevel`) in gearAwareScale call.
