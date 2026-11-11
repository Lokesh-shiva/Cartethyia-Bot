# Chapter 1 design system - "The Cost of Ember"

One look for every card, scene, icon and animation in the chapter. Anything new must match this.

## Mood and style
Dark, quiet, sorrowful fantasy. Stylized anime game illustration in the style of Wuthering Waves, painterly shading, cinematic lighting, no text, no watermark. Every scene has one light source (embers, moonlight, or flame) and a lot of dark negative space.

## Palette (use these exact roles)
| Role | Hex | Used for |
|---|---|---|
| Ash black | `#120a08` | backgrounds, shadows |
| Ash grey | `#5a4a44` | stone, ground, robes |
| Ember orange | `#ff7a3d` | glow, cracks, relic, UI accent |
| Deep red | `#7a2c14` | sky, danger |
| Moon silver | `#cfe6f5` | rest, pool, calm |
| Memory violet | `#b48cf0` | flashback only |
| Bone gold | `#ffd479` | rewards, weapon, victory |

## Node colors (map card, icons, UI)
Fight `#e0523a`, Event `#d9a441`, Rest `#4aa3df`, Flashback `#b48cf0`, Boss `#ff3b30`. The same five colors tint the node icons.

## Shape language
Broken, cracked and jagged forms; glowing cracks instead of outlines; no clean geometric symmetry in environments. Characters and enemies are drawn with a strong silhouette against the dark. Enemies are centered on a plain dark background so they can be cut out and glow-lit by the bot.

## Icons
Flat, single-color glyph on a dark rounded square, thick strokes, no gradients, no text. Five glyphs: crossed blades (fight), hooded lantern (event), still water drop (rest), cracked hourglass (flashback), flaming crown (boss).

## Cards and text
Image first, minimal text. Canvas text is plain ASCII. HP bars: green above 60%, amber 30-60%, red below 30%. A boss is the only thing allowed to use `#ff3b30` as a large fill.

## Animation (only four moments)
Slow parallax or zoom with drifting embers; no fast cuts. Same palette and grain as the stills. Moments: chapter title, boss intro, flashback transition, victory.

## Consistency rules for prompts
1. Attach an existing approved image (backdrop for scenes, Ignis Behemoth for bosses, Gravemaw for the weapon) as the style reference.
2. End every prompt with the style line above.
3. Generate sets (icons, the two enemies) in one image, then crop, so they share a hand.
