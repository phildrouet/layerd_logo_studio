# Layerd Logo Studio - project memory

Context file for Claude Code sessions on any workstation. Keep it updated when decisions change.

## What this is

Standalone static web tool that generates LayerdAI brand visuals from the Layerd mark (glass rings) as print-resolution stills and seamless loop videos, each from a deterministic recipe.

- Repo: https://github.com/phildrouet/layerd_logo_studio (owner phildrouet; public for now, may go private)
- Deploy: Netlify, no build command, publish directory `/`; pushes to `main` deploy
- This repo is independent: never reference other projects or repos in it

## Brand

- Swatches: charcoal `#292929`, periwinkle `#6371F7` (primary), lime `#A6E247` (accent only, sparingly: lime light in the mix tints the glass green), pale `#EBEDF5`
- The mark: rings sharing one horizontal diameter (the hinge), tilted about 20, 49 and 68 degrees (outer ring, middle band, centre lens); strokes swell towards the hinge
- UI font: Aspekta (kept until told otherwise). Logo assets are cropped SVGs converted from the brand PDFs (`reference/brand/`), fills set to the brand hexes

## House rules

- British spelling in all user-facing copy; no em-dashes in rendered strings
- Descriptive multi-line commit messages
- No build step, ever: plain ES modules, dependencies vendored and pinned in `vendor/`
- `reference/` is gitignored local-only material (brand logo suite, swatch PDF). If missing, the app still works

## Priorities (from Phil)

1. All three layouts (Mark, Sphere, Ripple) selectable; Sphere can drift and gather into the logo, with a settable ring count (2026-11-07)
2. "Generate new" compositions on demand, each a deterministic recipe (JSON) that re-renders pixel-faithful at any size; copyable in the UI and exported as a `.recipe.json` sidecar with every export
3. Print-ready exports: A0/A1/A2 portrait+landscape, roller banner 850x2000 mm, 4K/1080p, custom mm+dpi and custom px. Default 300 dpi. RGB PNG only

## Architecture decisions

- `js/presets.js` - parameter model. A recipe is the full params object, `RECIPE_VERSION` 3, merged over defaults on load so partial recipes work; older or foreign recipes (no `rings` block) are rejected with a message. `LAYOUTS` (Mark = `hinged`, Sphere = `stack`, Ripple = `ripple`) set the rings block plus a framing (camera, rotation, focus, aperture, fade); `LOOKS` (Hero, Light) set only colours/materials/lights. Neither touches the other.
- `js/rings.js` - the geometry. Each ring is one InstancedMesh of annular-sector glass tiles (extruded along local z, so the shader's |normal.z| face/bevel split works) inside a pivot whose local xy is the ring plane. Mark and Sphere share the same rings: radius 2, 3 rows x 110 tiles. The mark pose tilts ring `slot` about the hinge (world x) by `markTilt(k, n)` (curve through the logo's 20/49/68 degrees, signs alternating); band width follows `widthMin + (widthMax - widthMin) |cos theta|^p` (theta from the hinge), so tiles swell as they flow past it. The stack pose lays ring j horizontal (a quarter turn about the hinge, on the side it will open to) at height y_j with sphere radius sqrt(R^2 - y^2), drifting on whole-cycle sines; layers map to mark slots by distance from the equator. `assembly(mode, u)` blends the two (off / loop: hold 0-0.15, open 0.15-0.35, drift, gather 0.6-0.85, hold / reveal: gather 0.3-0.75 then hold), staggered per ring; the stack also leans 18 degrees towards the camera until it is the mark. Tangential tile scale follows the radius so rings stay closed while they grow. Ripple builds ~83 rings (one tile row each, alpha-faded outside 70% of the radius) displaced by a radial wave with tiles tilted to the slope. Construction constants live in `RINGS`; changing one changes every image, so bump the recipe version. Per-tile randomness (facet tint/tilt, drift phases) is a stateless hash of (seed, tile, ring). Shader injection (`makeInjector`) adds the distance fade, IBL gloss split and depth-faded sheen; its string replacements target three r185 chunks, so re-check them on any three upgrade.
- `js/scene.js` - orchestrator. `clocks(p, u)` gives the background clock (`phase.time` swinging by `loop.swing`, periodic in u); the rings take u directly. Seamless loops: rings turn integer `spin` revolutions, drift and the ripple wave run whole cycles, tiles keep their identity (no re-labelling), so u = 0 and u = 1 are byte-identical except in Reveal. `focusDistance` (tile nearest the frame centre) and `clearance` support Focus on rings and Generate new.
- `js/studio_env.js` - 7 soft radial-falloff light planes plus a wash sphere, baked with `PMREMGenerator.fromScene(env, 0.02)`, re-baked only when the light params change. `js/background.js` - domain-warped fbm on a back-facing sphere (in-scene, so it is consistent under DoF jitter and tiles).
- `js/render.js` - accumulation depth of field: camera jittered on a sunflower aperture disc (aperture = world-unit radius), frustum built manually per sample via `projectionMatrix.makePerspective` from the vertical FOV, with thin-lens shear (focal plane invariant) plus tile window plus subpixel AA jitter. Never use screen-space post (bokeh, tilt-shift, bloom, FXAA): it is resolution dependent and seams under tiling. A soft per-sample highlight cap (default 1.6) stops defocused speculars blooming. Renderer tone mapping is NoToneMapping; the finish shader does three's ACESFilmic (exposure 1.05) -> sRGB -> text fade -> vignette -> grain. Colours mixed after the curve are display-space: set uniforms with `setHex(n, LinearSRGBColorSpace)` (no conversion), and remember `Color.set('#hex')` already linearises (never add `convertSRGBToLinear`). Half-float accumulation target, 4x MSAA scene target.
- `js/compose.js` - Generate new: 12 candidates from `mulberry32(seed)` using per-layout ranges, each focused on the rings, rendered at 320 px x 4 samples and scored. Two weight sets: `object` (Mark, Sphere: centred light mass, comfortable fill, balance; no thirds or horizon) and `field` (Ripple: highlight on a third, calm horizon, readable foreground). Rejects clearance < 0.7. The winner is written into the recipe; the recipe, not the seed, is the record.
- `js/export_still.js` - 2048 px tiles, 64 samples each, stitched with putImageData; text fade, vignette and grain applied post-stitch in full-frame coordinates (grain uses a JS port of the finish shader's `hash12`), processed in horizontal bands to bound memory (roller banner at 300 dpi is 237 megapixels, near Chrome's canvas area limit; 150 dpi offered and usually right for banners).
- `js/export_video.js` - deterministic frame loop, 24 samples per frame (aperture sequence must be built for 24, not the preview's 64), WebCodecs VideoEncoder (H.264, codec candidates tried high-to-low) + vendored mp4-muxer, fastStart in-memory. MediaRecorder WebM fallback records in real time with a visible note; the `recording` flag in app.js stops the preview loop shrinking the canvas back to preview size mid-capture. The status line says when a Reveal export does not loop.
- `js/app.js` - binds `CONTROLS` (slider / colour / toggle / select) to param paths; `LAYOUT_ONLY` hides ring controls that do not apply to the current layout. The top-bar layout switch calls `applyLayout`. `window.__ts` exposes params, time and the scene for console checks.
- `vendor/` - three.js 0.185.0 (`three.module.js` + `three.core.js`, from npm, licence alongside) and mp4-muxer 5.1.3.
- Preview canvas aspect follows the selected still format, so framing matches the print target. Paused preview refines progressively to 64 samples; playback uses 1 jittered sample per frame.

## Verification notes

- Local serve: `python3 -m http.server 8091` (8090 is used by another tool on Phil's machine; 3000/4000/6000/6001 unavailable). `.claude/launch.json` has it as "layerd-studio"
- The browser pane throttles requestAnimationFrame while hidden; console-driven checks should run frame waits on timers
- 2026-11-07 checks: all three layouts render; u=0 and u=1 frames byte-identical for Mark, Sphere (Loop) and Ripple; the same recipe re-renders byte-identical; Sphere Loop/Reveal assemble into the mark at 3 and 11 rings; Generate new runs for every layout
- Looks are a first pass from the swatches; balancing Hero and Light (and the lime accent) is still to do
