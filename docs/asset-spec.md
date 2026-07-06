# Art Asset Spec — Cards

Guidance for any new echo/weapon/background art (hand-made or AI-generated) so it
renders cleanly in the existing card generators without code changes.

## Echo art (`assets/echoes/{1,3}-cost/*.png`, `Bosses/*.png` for 4-cost)

The existing library is either **square** (1:1, e.g. 500×500) or **landscape**
(~1.83 ratio, e.g. 676×369) — no true portrait art exists today. Both are
supported, fit differently:

- **Square/near-square (ratio ≤ 1.15):** cover-fit, so keep the subject centered
  and reasonably contained — a small crop (~13%) happens at the panel edges.
- **Landscape (ratio > 1.15):** blended contain/cover fit (halfway between "show
  everything, small" and "fill the panel, crop the sides") — a small trim off
  the far left/right edges is possible, so keep the subject reasonably centered,
  but it won't be cropped as aggressively as a pure cover-fit would.
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

The weapon card is a top-art / stats-below layout (not side-by-side) — the art
strip's own ratio (1.8) is built to match the art's native ratio, so cover-fit
only trims a few percent, never a heavy crop.

- **Aspect ratio:** landscape scene art, ~1.75-1.85 ratio (matches the existing
  library, all of which is painted-background scenes, not transparent icons).
  Staying in that range keeps the crop minimal; straying further (e.g. a
  square or portrait weapon shot) will get cropped more heavily by cover-fit.
- **Resolution:** at least 1600px on the long edge (matches existing art, which
  is ~1670-1700px wide).
- **Background:** fully painted is expected and fine — the strip fills
  edge-to-edge with a soft top/bottom vignette blending any residual trim, no
  dead letterbox bars regardless of background content.

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
