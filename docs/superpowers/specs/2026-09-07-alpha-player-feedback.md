# Player Feedback — AlphaBeast (2026-09-06/07) — Structured Notes

Raw feedback was a long, informal Discord-message dump from the player AlphaBeast (he/alpha), mixed with a quoted exchange between him and Tranzue. Structured here for reference — nothing in this doc is committed to being built; it's a record of what was asked, triaged into status.

## 1. "Alpha Raid" — new weekly boss concept
A new raid variant, distinct from the existing `/raid`:
- Fights a 5★-caliber boss, hard but beatable with a full team ("bring your best")
- Damage/difficulty target: roughly **1.5×** whatever the normal `/raid` scaling currently is (his exact words: "what ever u doing that with make it 1.5")
- **Weekly cadence** — can only be called once a week
- **Admin/owner-only** to start (he first said "administrators", later narrowed to "only the owner")
- **72-hour timer** once launched (exact purpose of the timer — kill window vs. signup window — not specified, needs clarifying before spec'd)
- Reward is explicitly tied to **wishes** (Fracture Keys / Radiant Keys, presumably) so the boss can't be farmed for currency the way normal raids can
- Explicit goal: **group engagement** — the server has to coordinate to earn wish currency, not solo-grind it
- Status: **not started**. Needs its own brainstorm/spec — genuinely a new raid variant, not a tweak to `/raid`. Numbers (exact multiplier, exact timer purpose, reward amount) need pinning down before a spec can be written.

## 2. Character release roadmap (12 characters, 1 every 28 days)
His proposed cadence and pattern:
1. 5★ Aero (wind) male + 4★ Fusion (fire) male
2. 5★ Electro (lightning) + 4★ Glacio (ice)
3. 5★ Havoc + 4★ Spectro (light)
4. 5★ Fusion (fire) + 4★ Aero (wind)
- Roughly a "3 and 3" gender split across the 12, reversing partway through
- One character (well, one 5★/4★ pair) released every 28 days (~monthly) for a year
- Status: **partially adopted, reshaped**. The actual decision made in this session: build **Standard-tier** characters (no signature weapon, added to `/wish`'s Standard pool) one element at a time until every element has one, rather than following Alpha's exact pairing/cadence. First one locked in: **Rhoven**, 5★ Aero, male — see `2026-09-07-rhoven-aero-character-design.md`. The 2nd 4★ for this release and its element are explicitly deferred until after Rhoven ships.

## 3. Standard vs. Featured character split, signature weapons
- Quoted exchange: Tranzue confirmed there will be two character pools — **Standard** (no signature weapon) and **Featured** (has a signature weapon, like Solace's Wellspring)
- Alpha's counter-point: a weapon "signature" to one character shouldn't be *bad* on anyone else — if it's genuinely a signature weapon, "you can't buck on a weapon" (nerf it) later just because it's someone else's favorite
- Tranzue's reply: "they are signature for a reason" — implying it's intentional that a signature weapon underperforms outside its owning character's kit
- Status: **noted, not resolved**. Genuine design tension between "signature weapons should feel special to their character" and "a 4/5★ weapon shouldn't feel like dead weight for anyone who doesn't own that character." Worth a real decision before more signature weapons ship.

## 4. Wish pity carryover
- Alpha's original complaint: pity resets between banners, discouraging pulls ("I do 41 wishes and then the ban[ner] starts over... fuck it")
- **Verified in this session, twice** — once via code read, once by the user's own direct testing: pity (`wishPity`/`limitedCharBannerPity`/`limitedWeaponBannerPity`) is a persistent per-user field, never reset by anything except an actual 5★ pull. Each of the 3 banners (Standard/Featured Character/Featured Weapon) has its own independent counter — that's likely what read as "resetting" when he switched banners, not an actual bug.
- Status: **resolved/confirmed working as intended**. No code change needed.

## 5. Pistols/guns are too weak
- Alpha and "silver" (another player) both independently reported guns as clearly the weakest weapon type — no speed or energy-regen identity, worse than just running a Rectifier for elemental damage + crit
- Specific ask: build speed and energy regen into the weapon type's kit — "2★ +4 Regen and Speed, 4★ +8, 5★ +12" as a rough shape
- Status: **already shipped, same session** (before this feedback was relayed) — Pistols were found to have literally zero coded passive (their "hits 3× times" flavor text described a mechanic that never existed) and the lowest base ATK of any weapon type. Fixed: Static Barrel (R2) now gives **+10 Energy/turn**, Twin Sparks (R3) now gives **+40 SPD** — independently arrived at almost exactly what Alpha asked for. Worth telling him directly since he'll notice next time he checks.

## Testing offer
Alpha and "silver" offered to help test new features (specifically mentioned in the context of Alpha Raid). Worth keeping in mind once Alpha Raid reaches an actual build.
