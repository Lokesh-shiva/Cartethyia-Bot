# Card & Embed Visual Polish — Design

## Problem

Several existing visual surfaces have concrete defects, not just subjective dullness:

1. **Echo thumbnails in the grid card** ([gridCard.ts](../../../src/lib/gridCard.ts)) look blurry when large source art (esp. 4-cost boss art from `Bosses/`) is downscaled hard to small slot thumbnails (~90px). Canvas's single-pass `drawImage` downscale has no mipmapping and looks soft on big ratio drops.
2. **Weapon card art** ([weaponCard.ts](../../../src/lib/weaponCard.ts)) force-fits every source image into a portrait `contain`-fit panel. Landscape (16:9-ish) art — e.g. the awakened "Symphony of the Unbound" pistols scene — gets letterboxed with dead black bars, looking out of place next to portrait/icon-style art.
3. **Echo card text-on-art** ([echoCard.ts](../../../src/lib/echoCard.ts)) draws the name/element/level text directly over the bottom of the art image. The fade gradient covering that zone isn't strong/tall enough, so bright or busy art (e.g. "Thunder Drake") competes with the text instead of sitting behind it cleanly.
4. **No asset spec** — there's no documented target resolution/aspect ratio/safe zone for echo art, weapon art, or backgrounds, so new art (hand-made or AI-generated) has no guardrail against reproducing #2/#3.
5. **Plain-text embeds** (shop listings, purchase confirmations, etc.) have no thumbnails and, for the shop purchase moment specifically, no canvas treatment — even though the loot-card pattern ([lootCard.ts](../../../src/lib/lootCard.ts)) already exists and is used elsewhere (daily/dispatch/vibe).

## Goals

- Fix the three concrete rendering defects (blur, letterboxing, text-on-art).
- Document an asset spec so future art (including user-designed art) doesn't reintroduce these issues.
- Extend the proven loot-card visual language to the shop purchase-confirmation embed, and add thumbnails to shop embeds that currently have none.

## Non-goals

- Redesigning the profile card (already considered good).
- A general embed-theming overhaul across every command — scope is shop embeds only for this pass.
- New art assets themselves (the user may produce these separately per the asset spec).

## Design

### 1. Shared sharp-downscale helper

Add `drawImageSharp(ctx, img, x, y, w, h)` to a shared canvas util (new export in `src/lib/canvasUtil.ts`, or colocated in an existing shared module if one already fits). Implementation: repeatedly halve a source image via intermediate off-screen canvases until the next halving would undershoot the target size, then do a final single draw to the exact target — the standard "step-down" technique for crisp thumbnails from `@napi-rs/canvas` (no built-in mipmapping).

Use it in `gridCard.ts`'s `drawSlot()` in place of the current direct `ctx.drawImage(img, ...)` call for slot art.

### 2. Weapon card aspect-aware fit

In `generateWeaponCard`, after loading the image, compute `ratio = img.width / img.height`:
- `ratio <= 1.15` (portrait/near-square, current icon-style art): keep existing `contain`-fit, unchanged.
- `ratio > 1.15` (landscape scene art): switch to `cover`-fit (scale so the image fills the panel, centered, cropping overflow) and add a soft vignette overlay (radial or edge linear gradient matching panel background) so the crop edges blend rather than hard-cutting the scene.

No new asset metadata needed — this is a pure runtime check.

### 3. Echo card fade strengthening

In `generateEchoCard`, extend the bottom fade gradient region (currently `artY + artH - 80` to `artY + artH`) and increase its opacity ramp so the last ~35-40% of the art panel reads as solidly dark under text, regardless of source art brightness. Verify against at least one bright/busy piece (e.g. Thunder Drake) and one dark piece to confirm no regression on already-good art.

### 4. Asset spec doc

Add a standalone `docs/asset-spec.md` (for discoverability outside the specs folder) covering:
- Echo art: recommended portrait ratio (e.g. 2:3 to 3:4), min resolution, transparent or dark-bottom-safe backgrounds preferred.
- Weapon art: recommended portrait ratio to match the art panel; if landscape art is intentional, note that it will be `cover`-fit and cropped, so keep the subject centered.
- Awakened weapon art (`assets/weapons/awakened/*.png`): same guidance, called out separately since these are highest-visibility.
- Safe-zone margins: keep the focal subject within the center ~80% of the frame so fades/crops don't cut into it.

### 5. Shop embed upgrade

- Add `setThumbnail()` to shop listing and purchase-related embeds in [shop.ts](../../../src/commands/rpg/shop.ts) using existing emoji/icon assets from `emojiManager.ts`.
- Replace the plain-text "Purchase Complete" embed with a small canvas card reusing the loot-card visual pattern (element/rarity accent, Rajdhani type, consistent with echo/weapon card language) rather than introducing a new visual style.

## Testing

- Visual check via the dev preview/screenshot workflow is not applicable (this is a Discord bot, not a browser app) — verify by running the relevant commands against a dev guild/test account and inspecting the generated images directly, comparing before/after for: a grid card with 4-cost echoes equipped, an awakened weapon with landscape art, an echo card with bright/busy art, and a shop purchase.
