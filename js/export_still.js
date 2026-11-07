import { wordmarkImage } from './wordmark.js';

// Print-resolution still export. The full frame is rendered as 2048 px tiles
// via per-tile frustum windows, each tile converged with the same aperture
// sample sequence, then stitched on a 2D canvas. Text fade, vignette and
// grain are applied after stitching, in full-frame coordinates, so nothing
// can seam.

const TILE = 2048;
export const STILL_SAMPLES = 64;

export async function exportStill(world, accum, params, width, height, grainSeed, onProgress) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  const tilesX = Math.ceil(width / TILE);
  const tilesY = Math.ceil(height / TILE);
  const totalTiles = tilesX * tilesY;
  let done = 0;

  // The scene is frozen at the current loop time; the caller has already
  // applied params. Render every tile with identical world state.
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * TILE;
      const y0 = ty * TILE;
      const w = Math.min(TILE, width - x0);
      const h = Math.min(TILE, height - y0);
      const frame = { fullW: width, fullH: height, x0, y0, w, h };

      accum.ensureTargets(w, h);
      accum.buildSequences(STILL_SAMPLES);
      accum.beginAccum();
      for (let s = 0; s < STILL_SAMPLES; s++) {
        accum.renderSample(world, params, s, STILL_SAMPLES, frame);
        if ((s & 7) === 7) {
          onProgress?.((done + s / STILL_SAMPLES) / totalTiles, 'Rendering tiles');
          await nextFrame();
        }
      }
      accum.finish(params, STILL_SAMPLES, STILL_SAMPLES, frame, { toCanvas: false, overlays: false });
      const img = accum.readTile(w, h);
      ctx.putImageData(img, x0, y0);
      done++;
      onProgress?.(done / totalTiles, 'Rendering tiles');
      await nextFrame();
    }
  }

  // Finishing pass on the stitched image, processed in horizontal bands to
  // bound memory. Same maths as the live preview shader.
  await applyFinish(ctx, width, height, params, grainSeed, (f) => {
    onProgress?.(f, 'Applying finish');
  });

  // The wordmark, drawn from its SVG at full resolution so it stays crisp.
  const lk = world.lockup ? world.lockup(params, width / height) : null;
  if (lk && lk.rect && lk.opacity > 0) {
    const img = await wordmarkImage(params.wordmark.color);
    ctx.globalAlpha = lk.opacity;
    ctx.drawImage(img, lk.rect.x * width, lk.rect.y * height, lk.rect.w * width, lk.rect.h * height);
    ctx.globalAlpha = 1;
  }

  onProgress?.(1, 'Encoding PNG');
  await nextFrame();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  canvas.width = canvas.height = 1; // release the large backing store promptly
  return blob;
}

async function applyFinish(ctx, width, height, p, grainSeed, onProgress) {
  const bandH = Math.max(64, Math.floor(8_000_000 / width));
  const vigCol = hexToRgb(p.background.dark);
  const strength = p.finish.vignette;
  const grain = p.finish.grain;
  const tf = p.finish.textFade;
  const fadeOpacity = tf.enabled ? tf.opacity : 0;
  const fadeCol = hexToRgb(tf.color);
  const aspect = width / height;
  const fcx = tf.x / 100, fcy = tf.y / 100 / aspect;
  const fr = tf.size / 200, fb = Math.max(tf.blur / 100, 1e-4);

  for (let y0 = 0; y0 < height; y0 += bandH) {
    const h = Math.min(bandH, height - y0);
    const img = ctx.getImageData(0, y0, width, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const py = y0 + y;
      const vTop = (py + 0.5) / height;        // fraction from the top
      const ny = (vTop - 0.5) * 2;
      // Shader pixel coordinates: centre of the pixel, y counted from the bottom.
      const gy = height - py - 0.5;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const gx = x + 0.5;
        const nx = (gx / width - 0.5) * 2;
        const dist = Math.sqrt(nx * nx + ny * ny) * 0.70710678;
        const v = smoothstep(0.45, 1.05, dist) * strength;
        let f = 0;
        if (fadeOpacity > 0) {
          const dx = gx / width - fcx, dy = vTop / aspect - fcy;
          f = (1 - smoothstep(fr - fb, fr + fb, Math.sqrt(dx * dx + dy * dy))) * fadeOpacity;
        }
        const g = (hash12(gx + grainSeed * 101.7, gy + grainSeed * 57.3) - 0.5) * 2 * grain * 255;
        const dith = (hash12(gx + 7.77, gy + grainSeed) - 0.5);
        for (let c = 0; c < 3; c++) {
          let val = d[i + c];
          if (f > 0) val = val + (fadeCol[c] - val) * f;
          if (v > 0) val = val + (vigCol[c] - val) * v;
          val += g + dith;
          d[i + c] = val < 0 ? 0 : val > 255 ? 255 : val;
        }
      }
    }
    ctx.putImageData(img, 0, y0);
    onProgress?.(Math.min(1, (y0 + h) / height));
    await nextFrame();
  }
}

// Port of hash12 in the render.js finish shader, so stills get the same grain
// as the preview and video.
function hash12(x, y) {
  let ax = fract(x * 0.1031), ay = fract(y * 0.1031), az = ax;
  const d = ax * (ay + 33.33) + ay * (az + 33.33) + az * (ax + 33.33);
  ax += d; ay += d; az += d;
  return fract((ax + ay) * az);
}

function fract(v) {
  return v - Math.floor(v);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(r));
}
