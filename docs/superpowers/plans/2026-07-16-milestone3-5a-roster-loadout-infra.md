# Milestone 3.5a — Roster & Per-Character Loadout Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-character ownership to echoes/weapons, a `characterId`-aware `resolvePlayerBonuses`, and a `/team` command to choose your 2nd combat slot — the foundational data layer the rest of Milestone 3.5 (Solace's own stat block, weapon refinement, constellations) builds on.

**Architecture:** `Echo`/`Weapon` gain a `characterId` column (default `"self"`), so all existing rows keep working unmodified for anyone who never touches `/team`. `resolvePlayerBonuses` gains an optional `characterId` parameter defaulting to `"self"`, so every existing call site (13 files) needs zero changes. New/changed commands (`/team`, `/echo-equip`, `/equip`, `/echoes`, `/weapons`, `/echo-preset`) get a `character` option that defaults to `self`.

**Tech Stack:** TypeScript, Prisma v7 (adapter-only, no `url` in datasource — see `CLAUDE.md` Gotchas), discord.js v14.

See the [design spec](../specs/2026-07-16-milestone3-5-per-character-loadouts-design.md) §2-4 for full rationale.

---

### Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `characterId` to `Echo`**

Find (in `model Echo`):
```prisma
  isEquipped  Boolean    @default(false)
  isLocked    Boolean    @default(false) // player-set guard against accidental discard/reroll targeting
  equippedSlot Int?                    // 0 = main, 1-4 = sub slots
```

Replace with:
```prisma
  isEquipped  Boolean    @default(false)
  isLocked    Boolean    @default(false) // player-set guard against accidental discard/reroll targeting
  characterId String     @default("self") // "self" = player's own character; future values ("solace") = that unit's own gear — see docs/superpowers/specs/2026-07-16-milestone3-5-per-character-loadouts-design.md
  equippedSlot Int?                    // 0 = main, 1-4 = sub slots. Unique per (userId, characterId), not per userId alone.
```

- [ ] **Step 2: Add `characterId` and `refinement` to `Weapon`**

Find (in `model Weapon`):
```prisma
  weaponType  WeaponType
  name        String     @default("Rusted Blade")
  level       Int        @default(1)
  rarity      Int        @default(1)
  isEquipped  Boolean    @default(false)
```

Replace with:
```prisma
  weaponType  WeaponType
  name        String     @default("Rusted Blade")
  level       Int        @default(1)
  rarity      Int        @default(1)
  isEquipped  Boolean    @default(false)
  characterId String     @default("self") // see Echo.characterId above
  refinement  Int        @default(1)      // 1-5, raised by merging duplicate weapon pulls (Milestone 3.5c)
```

- [ ] **Step 3: Add `teamAllyCharacterId` to `User`**

Run: `grep -n "^model User" -A 5 prisma/schema.prisma` to find the exact start of the model, then locate a sensible insertion point (near other single-value account-level fields, not inside an unrelated block). Insert this line inside `model User { ... }`, anywhere among the other top-level scalar fields (not inside a relation block):
```prisma
  teamAllyCharacterId String?  // null = solo with own character. Non-null = an owned banner character filling the 2nd combat slot (ownership = a CharacterProgress row exists for this userId+characterId).
```

- [ ] **Step 4: Add `constellation` and `constellationTokens` to `CharacterProgress`**

Find:
```prisma
  basicLevel    Int @default(1)
  skillLevel    Int @default(1)
  ultimateLevel Int @default(1)
  introLevel    Int @default(1)
  forteLevel    Int @default(1)
  // Outro deliberately excluded — per design spec, it does not level.
```

Replace with:
```prisma
  basicLevel    Int @default(1)
  skillLevel    Int @default(1)
  ultimateLevel Int @default(1)
  introLevel    Int @default(1)
  forteLevel    Int @default(1)
  // Outro deliberately excluded — per design spec, it does not level.

  constellation       Int @default(0) // 0-6, Resonance Chain rank
  constellationTokens Int @default(0) // banked currency from duplicate pulls — Milestone 3.5 ships this at 0 for everyone; Milestone 4's gacha is what will ever increment it
```

- [ ] **Step 5: Push schema + regenerate client**

Run: `npm run db:push`
Expected: Prisma reports the 5 new columns added, no destructive-change warnings (all new columns have defaults).

Run: `npx prisma generate`
Expected: clean, no errors.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no code yet references the new fields, so nothing should break).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(teams): add per-character ownership + refinement + constellation schema fields (Milestone 3.5a Task 1)"
```

---

### Task 2: `resolvePlayerBonuses` Gains a `characterId` Parameter

**Files:**
- Modify: `src/lib/setBonus.ts`

**Context:** This function is called from 13 files. Every existing call site passes only `userId`, so the new parameter MUST default to `"self"` and the function's behavior for existing callers MUST be byte-identical to today (querying `Echo`/`Weapon` rows with `characterId: "self"`, which is exactly what every pre-migration row now has thanks to Task 1's schema default).

- [ ] **Step 1: Update the cache key to include `characterId`**

Find:
```typescript
// ── Bonus cache — 30s TTL, invalidated on any combat/equip write ──────────────
const bonusCache = new Map<string, { val: PlayerBonuses; at: number }>();
export function invalidateBonusCache(userId: string) { bonusCache.delete(userId); }
```

Replace with:
```typescript
// ── Bonus cache — 30s TTL, invalidated on any combat/equip write ──────────────
// Keyed by `${userId}:${characterId}` — a player's own bonuses and (once
// Milestone 3.5b wires her up) Solace's own bonuses are cached independently,
// since they resolve from different Echo/Weapon rows.
const bonusCache = new Map<string, { val: PlayerBonuses; at: number }>();
export function invalidateBonusCache(userId: string, characterId: string = "self") {
  bonusCache.delete(`${userId}:${characterId}`);
}
```

**Note:** every existing call site of `invalidateBonusCache(userId)` (search `grep -rn "invalidateBonusCache(" src/`) keeps working unchanged — the new parameter defaults to `"self"`, matching the row `characterId` that command mutates today (equip/upgrade commands only ever touch `"self"`-owned rows until Milestone 3.5b's character-aware commands exist).

- [ ] **Step 2: Update `resolvePlayerBonuses`'s signature and cache lookup**

Find:
```typescript
export async function resolvePlayerBonuses(userId: string): Promise<PlayerBonuses> {
  const cached = bonusCache.get(userId);
  if (cached && Date.now() - cached.at < 30_000) return cached.val;
  const [user, echoes, weapon] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { element: true, uniqueAbilityType: true, uniqueAbilityValue: true, uniqueAbilityEffects: true, uniqueAbilityName: true, abilityEvolved: true, abilityVersion: true },
    }),
    prisma.echo.findMany({
      where:  { userId, isEquipped: true },
      select: {
```

Replace with:
```typescript
export async function resolvePlayerBonuses(userId: string, characterId: string = "self"): Promise<PlayerBonuses> {
  const cacheKey = `${userId}:${characterId}`;
  const cached = bonusCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 30_000) return cached.val;
  const [user, echoes, weapon] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { element: true, uniqueAbilityType: true, uniqueAbilityValue: true, uniqueAbilityEffects: true, uniqueAbilityName: true, abilityEvolved: true, abilityVersion: true },
    }),
    prisma.echo.findMany({
      where:  { userId, characterId, isEquipped: true },
      select: {
```

Find (immediately below, the weapon query):
```typescript
    prisma.weapon.findFirst({
      where:  { userId, isEquipped: true },
```

Replace with:
```typescript
    prisma.weapon.findFirst({
      where:  { userId, characterId, isEquipped: true },
```

**Note:** the `user.element`/`uniqueAbilityType`/etc. lookup deliberately stays scoped to `userId` only (not `characterId`) — element and unique-ability data belongs to the account's own personalized character regardless of which unit's echoes are being resolved. This is intentional and matches how Milestone 3.5b will later have Solace read the player's `element`/ability fields for lore/flavor purposes while her own stats come from her own `SOLACE` constant — not a bug to "fix" in this task.

- [ ] **Step 3: Update the cache-write line to use the new key**

Find (near the end of the function, wherever the resolved `bonuses` object is cached before returning):

Run: `grep -n "bonusCache.set" src/lib/setBonus.ts`

At that line, change `bonusCache.set(userId, ...)` to `bonusCache.set(cacheKey, ...)`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Every existing call site (`resolvePlayerBonuses(someUserId)`) still compiles since the new parameter has a default.

- [ ] **Step 5: Commit**

```bash
git add src/lib/setBonus.ts
git commit -m "feat(teams): resolvePlayerBonuses + bonus cache become characterId-aware (Milestone 3.5a Task 2)"
```

---

### Task 3: `/echo-equip` Becomes Character-Aware

**Files:**
- Modify: `src/commands/rpg/echo-equip.ts`

**Context:** Read the current file first (`src/commands/rpg/echo-equip.ts`) — it queries `prisma.echo.findFirst`/`findMany` scoped to `userId` in 4 places (current-slot-occupant lookup, all-equipped-for-point-budget lookup, unequipped-echoes lookup, and the two `updateMany`/`update` writes in the confirm handler). Every one of these needs `characterId` added to its `where` clause. Grid point budget (`MAX_GRID_POINTS`) is also per-character, not per-account — each character has their own independent 12-point grid.

- [ ] **Step 1: Add a `character` option to the command definition**

Find:
```typescript
  .addIntegerOption(o =>
    o.setName("cost")
      .setDescription("Filter echoes by cost")
      .setRequired(false)
      .addChoices(
        { name: "1-cost  (common)", value: 1 },
        { name: "3-cost  (field)",  value: 3 },
        { name: "4-cost  (boss)",   value: 4 },
      )
  );
```

Replace with:
```typescript
  .addIntegerOption(o =>
    o.setName("cost")
      .setDescription("Filter echoes by cost")
      .setRequired(false)
      .addChoices(
        { name: "1-cost  (common)", value: 1 },
        { name: "3-cost  (field)",  value: 3 },
        { name: "4-cost  (boss)",   value: 4 },
      )
  )
  .addStringOption(o =>
    o.setName("character")
      .setDescription("Which unit's grid to edit (default: yourself)")
      .setRequired(false)
      .addChoices(
        { name: "Yourself",     value: "self"   },
        { name: "Solace",       value: "solace" },
      )
  );
```

- [ ] **Step 2: Read the character option and validate ownership**

Find:
```typescript
export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const slot          = interaction.options.getInteger("slot", true);
  const filterElement = interaction.options.getString("element")  ?? null;
  const filterCost    = interaction.options.getInteger("cost")    ?? null;

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }
```

Replace with:
```typescript
export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const slot          = interaction.options.getInteger("slot", true);
  const filterElement = interaction.options.getString("element")  ?? null;
  const filterCost    = interaction.options.getInteger("cost")    ?? null;
  const characterId   = interaction.options.getString("character") ?? "self";

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  if (characterId !== "self") {
    const owned = await prisma.characterProgress.findUnique({
      where: { userId_characterId: { userId: interaction.user.id, characterId } },
    });
    if (!owned) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xFF4F6D)
          .setDescription(`◈ You don't own **${characterId}** yet.`)
          .setFooter({ text: "CARTETHYIA  ·  Resonance Grid" })],
      });
      return;
    }
  }
```

- [ ] **Step 3: Scope every echo query to `characterId`**

Find:
```typescript
  const currentEcho = await prisma.echo.findFirst({
    where: { userId: interaction.user.id, isEquipped: true, equippedSlot: slot },
  });

  // ── Fetch all equipped (for point budget) ────────────────────────────────
  const allEquipped = await prisma.echo.findMany({
    where:  { userId: interaction.user.id, isEquipped: true },
    select: { cost: true, equippedSlot: true },
  });
```

Replace with:
```typescript
  const currentEcho = await prisma.echo.findFirst({
    where: { userId: interaction.user.id, characterId, isEquipped: true, equippedSlot: slot },
  });

  // ── Fetch all equipped (for point budget) ────────────────────────────────
  const allEquipped = await prisma.echo.findMany({
    where:  { userId: interaction.user.id, characterId, isEquipped: true },
    select: { cost: true, equippedSlot: true },
  });
```

Find:
```typescript
  // ── Fetch unequipped echoes ───────────────────────────────────────────────
  const where: any = { userId: interaction.user.id, isEquipped: false };
```

Replace with:
```typescript
  // ── Fetch unequipped echoes ───────────────────────────────────────────────
  // An echo counts as "available to equip onto this character" only if it's
  // not equipped anywhere — echoes are account-wide inventory but can only be
  // slotted onto ONE character at a time (see design spec §2).
  const where: any = { userId: interaction.user.id, isEquipped: false };
```

(No `characterId` filter needed on the *unequipped-pool* query — an unequipped echo has no meaningful `characterId` yet, since it isn't slotted anywhere. Its `characterId` column only becomes meaningful once equipped, at which point Step 4 below sets it correctly.)

- [ ] **Step 4: Scope the confirm-handler writes to `characterId`**

Find:
```typescript
      if (btn.customId === "clear_confirm") {
          await prisma.echo.update({ where: { id: currentEcho.id }, data: { isEquipped: false, equippedSlot: null } });
```

Leave this line as-is (clearing a slot doesn't need `characterId` in the write — it targets a specific echo `id`, and unequipping doesn't need to reset `characterId` back to anything since an unequipped echo's `characterId` is meaningless per Step 3's note).

Find:
```typescript
      if (btn.customId === "equip_confirm") {
        await prisma.$transaction([
          prisma.echo.updateMany({
            where: { userId: interaction.user.id, equippedSlot: slot, isEquipped: true },
            data:  { isEquipped: false, equippedSlot: null },
          }),
          prisma.echo.update({
            where: { id: incoming.id },
            data:  { isEquipped: true, equippedSlot: slot },
          }),
        ]);
        invalidateBonusCache(interaction.user.id);
```

Replace with:
```typescript
      if (btn.customId === "equip_confirm") {
        await prisma.$transaction([
          prisma.echo.updateMany({
            where: { userId: interaction.user.id, characterId, equippedSlot: slot, isEquipped: true },
            data:  { isEquipped: false, equippedSlot: null },
          }),
          prisma.echo.update({
            where: { id: incoming.id },
            data:  { isEquipped: true, equippedSlot: slot, characterId },
          }),
        ]);
        invalidateBonusCache(interaction.user.id, characterId);
```

**Critical:** the `echo.update` on `incoming.id` now sets `characterId` explicitly — this is the step that actually assigns an echo to a character. Since an echo can only be equipped in one place at a time (`isEquipped: true` is unique-ish per echo row, not per slot), re-equipping the same physical echo onto a DIFFERENT character later will correctly reassign its `characterId` at that point, matching design spec §2's "an echo belongs to one character at a time" rule.

- [ ] **Step 5: Update embed titles/footers to show which character's grid is being edited (cosmetic, but do it — otherwise players equipping Solace's grid see a UI indistinguishable from their own)**

Find every `Resonance Grid` embed title/footer string in this file (`grep -n "Resonance Grid" src/commands/rpg/echo-equip.ts`) and prepend the character name when `characterId !== "self"`. Add this helper near the top of the file (after the existing `MAX_GRID_POINTS`/`CLEAR_VALUE` constants):
```typescript
const CHARACTER_LABEL: Record<string, string> = { self: "Yourself", solace: "Solace" };
function gridTitle(characterId: string): string {
  return characterId === "self" ? "Resonance Grid" : `Resonance Grid — ${CHARACTER_LABEL[characterId] ?? characterId}`;
}
```
Then replace each hardcoded `"Resonance Grid"` footer/title text with `gridTitle(characterId)` (there are several — update all of them for consistency, not just one).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/echo-equip.ts
git commit -m "feat(teams): /echo-equip becomes per-character (Milestone 3.5a Task 3)"
```

---

### Task 4: `/equip` (Weapon) Becomes Character-Aware

**Files:**
- Modify: `src/commands/rpg/equip.ts`

**Context:** Same shape as Task 3 but for weapons — `isEquipped` becomes scoped per `(userId, characterId)` instead of per `userId`. Read the current file first.

- [ ] **Step 1: Add a `character` option**

Find:
```typescript
const command: Command = {
  data: new SlashCommandBuilder()
    .setName("equip")
    .setDescription("Switch your equipped weapon from your arsenal."),
```

Replace with:
```typescript
const command: Command = {
  data: new SlashCommandBuilder()
    .setName("equip")
    .setDescription("Switch your equipped weapon from your arsenal.")
    .addStringOption(o =>
      o.setName("character")
        .setDescription("Which unit's weapon slot to edit (default: yourself)")
        .setRequired(false)
        .addChoices(
          { name: "Yourself", value: "self"   },
          { name: "Solace",   value: "solace" },
        )
    ),
```

- [ ] **Step 2: Read + validate the character option**

Find:
```typescript
    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const color   = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
    const weapons = await prisma.weapon.findMany({
      where:   { userId: interaction.user.id },
      orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "desc" }],
    });
```

Replace with:
```typescript
    const user    = await getOrCreateUser(interaction.user.id, displayName, avatarUrl);
    const color   = ELEMENT_HEX[user.element] ?? ELEMENT_HEX.NONE;
    const characterId = interaction.options.getString("character") ?? "self";

    if (characterId !== "self") {
      const owned = await prisma.characterProgress.findUnique({
        where: { userId_characterId: { userId: interaction.user.id, characterId } },
      });
      if (!owned) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF4F6D)
            .setDescription(`◈ You don't own **${characterId}** yet.`)
            .setFooter({ text: "CARTETHYIA  ·  Arsenal" })],
        });
        return;
      }
    }

    const weapons = await prisma.weapon.findMany({
      where:   { userId: interaction.user.id },
      orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "desc" }],
    });
```

**Note:** this weapons query deliberately does NOT filter by `characterId` — the list shows the player's ENTIRE arsenal (every weapon they own, regardless of which character it's currently equipped to, or unequipped), so they can see what's available to move. The `equipped` lookup (next step) is what needs `characterId` scoping — "currently equipped BY THIS CHARACTER," not "equipped by anyone."

- [ ] **Step 3: Scope the "currently equipped" lookup to this character**

Find:
```typescript
    const equipped = weapons.find((w) => w.isEquipped);
```

Replace with:
```typescript
    const equipped = weapons.find((w) => w.isEquipped && w.characterId === characterId);
```

- [ ] **Step 4: Scope the swap-in-DB writes**

Find:
```typescript
        // Swap in DB
        await prisma.weapon.updateMany({ where: { userId: interaction.user.id, isEquipped: true }, data: { isEquipped: false } });
        await prisma.weapon.update({ where: { id: chosenId }, data: { isEquipped: true } });
        await prisma.user.update({ where: { id: interaction.user.id }, data: { weaponType: chosen.weaponType } });
        invalidateBonusCache(interaction.user.id);
```

Replace with:
```typescript
        // Swap in DB — only unequips this CHARACTER's previous weapon, not
        // every weapon on the account (another character's equipped weapon
        // must be untouched).
        await prisma.weapon.updateMany({ where: { userId: interaction.user.id, characterId, isEquipped: true }, data: { isEquipped: false } });
        await prisma.weapon.update({ where: { id: chosenId }, data: { isEquipped: true, characterId } });
        if (characterId === "self") {
          await prisma.user.update({ where: { id: interaction.user.id }, data: { weaponType: chosen.weaponType } });
        }
        invalidateBonusCache(interaction.user.id, characterId);
```

**Note:** `User.weaponType` is only updated when equipping onto `"self"` — it's a display/flavor field for the player's own character (used elsewhere for their own profile card), not meaningful for a banner character's weapon.

- [ ] **Step 5: Also re-check `chosen.isEquipped` guard against the right character**

Find:
```typescript
      if (chosen.isEquipped) {
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0x334155)
            .setDescription(`◈ **${(chosen.awakened && chosen.awakenedName) ? chosen.awakenedName : chosen.name}** is already equipped.`)],
          components: [],
        });
        return;
      }
```

Replace with:
```typescript
      if (chosen.isEquipped && chosen.characterId === characterId) {
        await sel.editReply({
          embeds: [new EmbedBuilder().setColor(0x334155)
            .setDescription(`◈ **${(chosen.awakened && chosen.awakenedName) ? chosen.awakenedName : chosen.name}** is already equipped.`)],
          components: [],
        });
        return;
      }
```

(If the chosen weapon is equipped by a DIFFERENT character, this guard now correctly falls through to the swap flow — moving a weapon from one character to another is a valid action, not a no-op.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/commands/rpg/equip.ts
git commit -m "feat(teams): /equip becomes per-character (Milestone 3.5a Task 4)"
```

---

### Task 5: `/echoes` and `/weapons` Gain a Character Filter

**Files:**
- Modify: `src/commands/rpg/echoes.ts`
- Modify: `src/commands/rpg/weapons.ts`

- [ ] **Step 1: Read both files**

Run: `grep -n "addStringOption\|addIntegerOption\|prisma.echo.findMany\|prisma.weapon.findMany\|SlashCommandBuilder" src/commands/rpg/echoes.ts src/commands/rpg/weapons.ts`

- [ ] **Step 2: Add a `character` filter option to each command's builder**, following the exact same pattern as Task 3 Step 1 / Task 4 Step 1 (a `.addStringOption(o => o.setName("character")...)` with `{ name: "Yourself", value: "self" }` / `{ name: "Solace", value: "solace" }` choices, `.setRequired(false)`).

- [ ] **Step 3: Wire the filter into each command's query**

Both `/echoes` and `/weapons` currently query the player's ENTIRE account inventory unfiltered (confirmed by reading both files: `echoes.ts:42-45` does `prisma.echo.findMany({ where: { userId: target.id }, ... })` with no `characterId`/`isEquipped` filter; `weapons.ts:43-46` does the same for weapons). Both commands are "browse your whole collection" views, not per-character grid views (that's `/echo-equip`'s job) — so the `character` option added in Step 2 is an optional NARROWING filter, not a hard default:

In `echoes.ts`, find:
```typescript
  const echoes = await prisma.echo.findMany({
    where:   { userId: target.id },
    orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { createdAt: "desc" }],
  });
```
Replace with:
```typescript
  const filterCharacterId = interaction.options.getString("character"); // null = show everything, no narrowing
  const echoes = await prisma.echo.findMany({
    where:   { userId: target.id, ...(filterCharacterId ? { characterId: filterCharacterId } : {}) },
    orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { createdAt: "desc" }],
  });
```

In `weapons.ts`, find:
```typescript
    const weapons = await prisma.weapon.findMany({
      where:   { userId: interaction.user.id },
      orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "desc" }],
    });
```
Replace with:
```typescript
    const filterCharacterId = interaction.options.getString("character"); // null = show everything, no narrowing
    const weapons = await prisma.weapon.findMany({
      where:   { userId: interaction.user.id, ...(filterCharacterId ? { characterId: filterCharacterId } : {}) },
      orderBy: [{ isEquipped: "desc" }, { rarity: "desc" }, { level: "desc" }],
    });
```

In both files, wherever an individual echo/weapon's "equipped" state is displayed (search each file for `isEquipped` in display/label code), append which character it's equipped BY when `isEquipped` is true and `characterId !== "self"` — e.g. append `` (equipped — Solace)`` to the existing "equipped" marker text, so a player viewing their unfiltered full list can tell at a glance which unit is using which item.

- [ ] **Step 4: Update embed titles/footers** in both files to show the character name when `characterId !== "self"`, reusing the same `CHARACTER_LABEL` map pattern from Task 3 Step 5 (duplicate the small `Record<string,string>` locally in each file rather than creating a shared import for a 2-entry map — YAGNI).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/commands/rpg/echoes.ts src/commands/rpg/weapons.ts
git commit -m "feat(teams): /echoes and /weapons gain a character filter (Milestone 3.5a Task 5)"
```

---

### Task 6: `/echo-preset` Becomes Per-Character

**Files:**
- Modify: `src/commands/rpg/echo-preset.ts`
- Modify: `prisma/schema.prisma` (add `characterId` to `EchoPreset`)

- [ ] **Step 1: Add `characterId` to the `EchoPreset` model**

Find:
```prisma
model EchoPreset {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  name      String
  slots     Json     // { "0": echoId|null, "1": echoId|null, ..., "4": echoId|null }
  createdAt DateTime @default(now())

  @@unique([userId, name])
  @@map("echo_presets")
}
```

Replace with:
```prisma
model EchoPreset {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  characterId String   @default("self") // which unit this preset's slots belong to
  name        String
  slots       Json     // { "0": echoId|null, "1": echoId|null, ..., "4": echoId|null }
  createdAt   DateTime @default(now())

  @@unique([userId, characterId, name])
  @@map("echo_presets")
}
```

**Note:** the unique constraint changes from `[userId, name]` to `[userId, characterId, name]` — the same preset NAME can now exist once per character (e.g. a "PvP" preset for your own character AND a separate "PvP" preset for Solace), which is the correct behavior, not a collision.

- [ ] **Step 2: Push schema + regenerate**

Run: `npm run db:push && npx prisma generate`
Expected: clean.

- [ ] **Step 3: Add a `character` option to all 4 subcommands**

In `src/commands/rpg/echo-preset.ts`, add `.addStringOption(o => o.setName("character")...)` (same pattern as prior tasks) to EACH of the 4 `.addSubcommand(...)` blocks (`save`, `load`, `list`, `delete`) — Discord requires the option on each subcommand individually, not once at the top level.

- [ ] **Step 4: Thread `characterId` through all 4 handler functions**

In `execute`, read `const characterId = interaction.options.getString("character") ?? "self";` once, and pass it as a parameter to `savePreset`/`loadPreset`/`listPresets`/`deletePreset` (add `characterId: string` as their 3rd parameter). Inside each:

- `savePreset`: the `prisma.echo.findMany` `where` gains `characterId`; the `echoPreset.upsert`'s `where`/`create` both gain `characterId`.
- `loadPreset`: the `echoPreset.findUnique`'s `where` becomes `{ userId_characterId_name: { userId: interaction.user.id, characterId, name } }` (matching the new compound unique key from Step 1); the ownership-verification `prisma.echo.findMany` gains `characterId` in its `where`; the `$transaction`'s `updateMany`(unequip-all) gains `characterId` in its `where`, and each `echo.update` in the `equips.map(...)` gains `characterId` in its `data`; `invalidateBonusCache` call gains the `characterId` argument.
- `listPresets`: the `echoPreset.findMany` `where` gains `characterId`.
- `deletePreset`: the `echoPreset.deleteMany` `where` gains `characterId`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/commands/rpg/echo-preset.ts
git commit -m "feat(teams): /echo-preset becomes per-character (Milestone 3.5a Task 6)"
```

---

### Task 7: `/team` Command (New)

**Files:**
- Create: `src/commands/rpg/team.ts`

- [ ] **Step 1: Write the command**

```typescript
// src/commands/rpg/team.ts
// New in Milestone 3.5a — lets a player choose which owned banner character
// (if any) fills their 2nd combat slot. The player's own character always
// fights turn-1 in every combat surface (unchanged) — this command only
// controls who's available to swap into. See design spec
// docs/superpowers/specs/2026-07-16-milestone3-5-per-character-loadouts-design.md §3.

import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
} from "discord.js";
import prisma from "../../lib/prisma";
import { replyNotStarted } from "../../lib/economy";
import { ELEMENT_COLORS } from "../../lib/echoes";
import { Element } from "@prisma/client";

// Only "solace" exists today — future characters add entries here, mirroring
// the same growth pattern already used by CHARACTERS in character.ts.
const BANNER_CHARACTERS: Record<string, { label: string; emoji: string }> = {
  solace: { label: "Solace", emoji: "✨" },
};

export const data = new SlashCommandBuilder()
  .setName("team")
  .setDescription("View or change your team's 2nd combat slot.")
  .addStringOption(o =>
    o.setName("ally")
      .setDescription("Which owned banner character to set as your ally (omit to just view your team)")
      .setRequired(false)
      .addChoices(
        { name: "None — solo",   value: "none"   },
        { name: "✨ Solace",     value: "solace" },
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: 64 });

  const dbUser = await prisma.user.findUnique({
    where:  { id: interaction.user.id },
    select: { element: true, teamAllyCharacterId: true },
  });
  if (!dbUser) { await replyNotStarted(interaction); return; }

  const color = ELEMENT_COLORS[dbUser.element as Element] ?? 0x6366F1;
  const choice = interaction.options.getString("ally");

  // ── View-only (no `ally` option passed) ───────────────────────────────────
  if (choice === null) {
    const current = dbUser.teamAllyCharacterId;
    const currentLabel = current ? (BANNER_CHARACTERS[current]?.label ?? current) : null;
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle("◈  Your Team")
        .setDescription(
          currentLabel
            ? `**Slot 1:** Yourself\n**Slot 2:** ${currentLabel}`
            : `**Slot 1:** Yourself\n**Slot 2:** *(solo — no ally set)*`
        )
        .setFooter({ text: "CARTETHYIA  ·  Team  ·  /team ally:<name> to change" })],
    });
    return;
  }

  // ── Clear to solo ──────────────────────────────────────────────────────────
  if (choice === "none") {
    await prisma.user.update({ where: { id: interaction.user.id }, data: { teamAllyCharacterId: null } });
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setDescription("◈ Team set to **solo** — no ally will join your fights.")
        .setFooter({ text: "CARTETHYIA  ·  Team" })],
    });
    return;
  }

  // ── Set an ally — verify ownership first ──────────────────────────────────
  const owned = await prisma.characterProgress.findUnique({
    where: { userId_characterId: { userId: interaction.user.id, characterId: choice } },
  });
  if (!owned) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xFF4F6D)
        .setDescription(`◈ You don't own **${BANNER_CHARACTERS[choice]?.label ?? choice}** yet.`)
        .setFooter({ text: "CARTETHYIA  ·  Team" })],
    });
    return;
  }

  await prisma.user.update({ where: { id: interaction.user.id }, data: { teamAllyCharacterId: choice } });
  const label = BANNER_CHARACTERS[choice]?.label ?? choice;
  const emoji = BANNER_CHARACTERS[choice]?.emoji ?? "◈";
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setDescription(`${emoji} **${label}** is now your team's 2nd slot — she'll be available to swap into during fights.`)
      .setFooter({ text: "CARTETHYIA  ·  Team" })],
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/commands/rpg/team.ts
git commit -m "feat(teams): add /team command for choosing the 2nd combat slot (Milestone 3.5a Task 7)"
```

---

### Task 8: Deploy + Verification

- [ ] **Step 1: Deploy the new/changed commands**

Run: `npm run deploy` (dev guild only — this milestone's new commands are not global yet, matching every prior milestone's staged-rollout discipline).

- [ ] **Step 2: Automated checks**

```bash
npx tsc --noEmit
grep -rn "characterId" prisma/schema.prisma   # confirm all 5 new fields present (Echo, Weapon x2, User, CharacterProgress x2, EchoPreset)
grep -c "resolvePlayerBonuses(" src/lib/setBonus.ts src/commands/rpg/*.ts src/lib/encounter.ts src/lib/uniqueAbility.ts   # sanity count, no call site should have broken
```

- [ ] **Step 3: Manual — deploy and playtest in the dev guild**

- [ ] `/team` with no argument shows "Slot 1: Yourself / Slot 2: (solo — no ally set)" for a fresh account
- [ ] `/team ally:solace` on an account with no `CharacterProgress` row for `solace` correctly rejects with "you don't own Solace yet"
- [ ] After using `/character` (which auto-creates a `CharacterProgress` row for `solace` when in the dev guild — confirm this is still true post-migration), `/team ally:solace` succeeds
- [ ] `/echo-equip character:solace` shows an independent, initially-empty grid (not sharing slots with your own character's grid)
- [ ] Equipping an echo onto Solace's grid does NOT remove it from your own character's grid (they're independent) — but equipping an echo that's currently equipped on your OWN grid onto Solace's grid instead DOES un-equip it from yours (since one echo belongs to one character at a time)
- [ ] `/equip character:solace` behaves the same way for weapons
- [ ] `/echoes` and `/weapons` correctly show/filter by character
- [ ] `/echo-preset save name:Test character:solace` then `/echo-preset load name:Test character:solace` round-trips correctly, and doesn't collide with a same-named preset under `character:self`
- [ ] Existing players' pre-migration echoes/weapons are unaffected — `/echoes`, `/weapons`, `/equip`, `/echo-equip` with no `character` argument behave identically to before this milestone

- [ ] **Step 4: Report findings back**

Same discipline as every prior milestone — describe exactly what you saw if something's off.
