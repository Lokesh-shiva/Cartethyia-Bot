# Art Asset Spec — Cards

Guidance for any new echo/weapon/background art (hand-made or AI-generated) so it
renders cleanly in the existing card generators without code changes.

## Echo art (`assets/echoes/{1,3}-cost/*.png`, `Bosses/*.png` for 4-cost)

The existing library is either **square** (1:1, e.g. 500×500) or **landscape**
(~1.83 ratio, e.g. 676×369) — no true portrait art exists today. Both are
supported, fit differently:

- **Square/near-square (ratio ≤ 1.15):** cover-fit, so keep the subject centered
  and reasonably contained — a small crop (~13%) happens at the panel edges.
- **Landscape (ratio > 1.15):** contain-fit (no crop at all) — the full image is
  shown, centered in the panel, with any surrounding gap filled by the panel's
  ambient element-tinted background. No need to crop-safe the composition.
- **Resolution:** at least 900px on the short edge for square art, at least
  1200px wide for landscape art. Larger is fine — the renderer step-downscales
  sharply (see `src/lib/canvasUtil.ts`).
- **Safe zone:** keep the subject within the center ~80% of the frame. The
  bottom ~40% of the panel gets a dark fade overlay for text — avoid putting
  essential detail (face, key silhouette) in the very bottom 15%.
- **Background:** transparent or simple preferred for square art (still gets
  cropped a little); painted backgrounds are fine for landscape art since it's
  never cropped.

## Weapon art (`assets/weapons/{Type}/*.png`, `assets/weapons/awakened/*.png`, `assets/weapons/unique/*.png`)

- **Aspect ratio:** landscape scene art, ~1.6-1.9 ratio (matches the existing
  library, all of which is painted-background scenes, not transparent icons).
  The art panel (420×[H-32], H varies ~310-450) is wide enough that most of
  this range covers with only a modest crop (~10-25% depending on card height
  variant) — keep the weapon/subject centered so that crop doesn't cut it off.
- **Resolution:** at least 1600px on the long edge (matches existing art, which
  is ~1670-1700px wide).
- **Background:** fully painted is expected and fine — the panel fills
  edge-to-edge with a soft top/bottom vignette blending any crop, no dead
  letterbox bars regardless of background content.

## General card backgrounds (`assets/backgrounds/*.png`)

- Match the card's canvas dimensions' aspect ratio as closely as possible
  (profile card is 820×340 landscape) — these are scaled to always-cover already,
  so extreme mismatches just mean more of the source gets cropped, not distorted.
- Resolution: at least 1200px wide.

## Rule of thumb

If new art doesn't fit these guidelines, prefer fixing the generator (as Tasks
2-4 in `docs/superpowers/plans/2026-07-06-card-visual-polish.md` did) over
manually retouching every asset — but following the spec avoids needing a fix
in the first place.
