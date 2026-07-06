# Art Asset Spec — Cards

Guidance for any new echo/weapon/background art (hand-made or AI-generated) so it
renders cleanly in the existing card generators without code changes.

## Echo art (`assets/echoes/{1,3}-cost/*.png`, `Bosses/*.png` for 4-cost)

- **Aspect ratio:** portrait, 2:3 to 3:4 (matches the echo card's art panel, which
  is wider-than-tall-safe but expects a standing/centered subject).
- **Resolution:** at least 900px on the short edge. Larger is fine — the renderer
  now step-downscales sharply (see `src/lib/canvasUtil.ts`), so oversized source
  art is not a problem.
- **Safe zone:** keep the subject within the center ~80% of the frame. The bottom
  ~40% of the panel gets a dark fade overlay for text — avoid putting essential
  detail (face, key silhouette) in the very bottom 15%, since it will be dimmed.
- **Background:** transparent or a dark/simple background preferred, but not
  required — the bottom fade now compensates for busy/bright art.

## Weapon art (`assets/weapons/{Type}/*.png`, `assets/weapons/awakened/*.png`, `assets/weapons/unique/*.png`)

- **Aspect ratio:** landscape scene art, ~1.6-1.9 ratio (matches the existing
  library, all of which is painted-background scenes, not transparent icons).
  The art panel always `cover`-fits and crops to fill — keep the weapon/subject
  centered so cropping the top/bottom or left/right edges doesn't cut it off.
- **Resolution:** at least 1600px on the long edge (matches existing art, which
  is ~1670-1700px wide).
- **Background:** fully painted is expected and fine — the panel always fills
  edge-to-edge with a soft top/bottom vignette, no letterboxing regardless of
  background content.

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
