# Layerd Logo Studio

A self-serve generator for LayerdAI brand visuals built from the Layerd mark: rings of bevelled glass tiles, lit in a soft studio and shot with real depth of field. Marketing can produce print-resolution stills for event stands and seamless brand loop videos at any size, on demand.

## Headline features

**Three layouts.** Pick one from the top bar:

- **Mark**: the logo itself in glass. The mark is a set of rings that share one horizontal axis, each tilted to a different angle; here they are glass hoops whose tiles flow round them while the fan gently breathes.
- **Sphere**: the rings as the layers of a sphere, drifting. Turn on **Assembly** and the layers swing up round the shared axis and gather into the mark. *Loop* holds the mark, opens out, drifts and re-forms (seamless). *Reveal* drifts first and ends on the mark (for intros and stings). Set the number of rings to taste: 3 gives the exact logo, more gives a denser globe with the same eye.
- **Ripple**: a wide field of concentric glass rings with a wave travelling outwards. Good for backgrounds behind copy.

**The LayerdAI wordmark.** Turn on the wordmark to set the brand lettering beside the mark, to the right, left, below or above, in the brand lockup proportions. It can fade in as the Sphere forms the mark, and the framing shifts and zooms so mark and wordmark sit centred together. It is drawn from the logo's own vector paths, so stills are crisp at any print size.

**Generate new compositions.** "Generate new" draws a dozen seeded compositions for the current layout (camera, rotation, light balance, layout settings), scores each one (exposure, clipping, contrast, placement, balance) and keeps the best. Two looks are built in: Hero (dark) and Light. Every composition is a deterministic recipe: copy it, keep it with the artwork, and any approved image can be re-rendered pixel for pixel at any size later. Each export also downloads a `.recipe.json` sidecar containing the full recipe.

**Print-ready exports.** Size presets cover A0, A1 and A2 (portrait and landscape), roller banner 850 x 2000 mm, 4K and Full HD screens, plus fully custom sizes in mm + dpi (the tool computes the pixels) or raw pixels. Default 300 dpi. Exports are RGB PNG; give print shops the full-resolution PNG and let them handle any CMYK conversion.

**Loop videos.** Rings turn whole revolutions and drift and waves run whole cycles per loop, so exported videos loop seamlessly (except Reveal, which ends on the mark by design). MP4 (H.264) at 1080p or 4K, 30 or 60 fps, encoded in the browser with WebCodecs. Browsers without WebCodecs fall back to a real-time WebM recording.

## Running it

It is a static site with no build step. Open it on Netlify, or serve the folder with any static server:

```
python3 -m http.server 8091
```

then open http://localhost:8091. Everything (three.js, the MP4 muxer, the Aspekta UI font) is vendored, so it works offline once loaded. Chrome or Edge recommended for MP4 export.

## How it works

- Each ring is a band of bevelled glass tiles (annular sectors), one `InstancedMesh` per ring, re-posed every frame. In the mark, bands swell towards the shared axis like the logo's strokes.
- Reflections come from a PMREM-baked studio of seven soft coloured light planes; two directional lights add sharp glints. The background is a domain-warped noise gradient on a sphere inside the scene.
- Depth of field is accumulation based: the camera jitters across an aperture disc with the frustum sheared so the focal plane stays fixed, and passes are averaged. This is resolution independent, so tiled renders never seam.
- Stills render as 2048 px tiles via per-tile frustum windows, stitched on a canvas; the optional text fade (a soft dark area behind copy), vignette and grain are applied after stitching in full-frame coordinates.
- Videos render frame by frame (non-realtime) into a WebCodecs H.264 encoder muxed with [mp4-muxer](https://github.com/Vanilagy/mp4-muxer).

Large exports take a while: expect a few minutes for A0 or the roller banner depending on the machine. The page stays responsive and shows progress.

## Repo layout

- `index.html`, `css/`, `js/` - the app, plain ES modules, no build step
- `vendor/` - pinned dependencies (three.js 0.185.0, mp4-muxer 5.1.3), committed
- `assets/AspektaVF.woff2` - UI font (Aspekta, OFL licensed)
- `assets/layerd-logo.svg`, `assets/layerd-wordmark.svg`, `assets/favicon.svg` - LayerdAI logo, wordmark and mark
- `reference/` - gitignored local reference material (brand files)

## Deploying

Live at https://layerdlogostudio.netlify.app (noindex). Netlify builds from `main` on every push: no build command, publish directory `/`. See `netlify.toml`.
