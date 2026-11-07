// "Generate new": draw several seeded compositions, render each one small,
// score the frame on composition and keep the best. Candidates come only from
// the seed; the winner is written into the recipe, so the recipe (not the
// seed) is the record that re-renders pixel for pixel.

import { LOOKS, mulberry32 } from './presets.js';

export const GENERATE = {
  candidates: 12,
  lightScale: [0.5, 1.8],   // studio light multipliers, relative to the look
  sunScale: [0.4, 2.0],     // directional light multipliers, relative to the look
  phase: { time: [0, 600] },
  minClearance: 0.7,        // reject compositions with rings this close to the camera
  // Per-layout ranges. The mark and the sphere are objects, framed round
  // the centre; the ripple is a field, framed like a landscape.
  layouts: {
    hinged: {
      camera: { distance: [9, 13], height: [-1, 1.5], lookAtY: [-0.4, 0.4], fov: [22, 34] },
      rotation: { x: [-20, 20], y: [-50, 50], z: [-15, 15] },
      rings: { breathe: [0, 10] },
    },
    stack: {
      camera: { distance: [8.5, 12], height: [-0.6, 1.5], lookAtY: [-0.3, 0.3], fov: [24, 34] },
      rotation: { x: [-12, 12], y: [-40, 40], z: [-10, 10] },
      rings: { drift: [0.3, 0.9] },
    },
    ripple: {
      camera: { distance: [3, 7], height: [-0.2, 1.2], lookAtY: [-2, -0.5], fov: [32, 50] },
      rotation: { x: [-8, 8], y: [-180, 180], z: [-8, 8] },
      rings: { wave: [0.12, 0.35], waveLength: [2.4, 4.5] },
    },
  },
  // Each term is roughly 0..1 before weighting; higher totals are better.
  weights: {
    // a field: highlight on a third, calm horizon, readable foreground
    field: {
      clipping: 3.0, exposure: 2.0, contrast: 1.5, thirds: 2.5, edge: 2.0,
      balance: 1.0, horizon: 1.5, foreground: 1.5, centre: 0, fill: 0,
    },
    // an object: the rings centred, filling a comfortable share of the frame
    object: {
      clipping: 3.0, exposure: 2.0, contrast: 1.5, thirds: 0, edge: 2.0,
      balance: 1.5, horizon: 0, foreground: 0, centre: 2.5, fill: 2.0,
    },
  },
};

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

// The seeded candidate list for a recipe. Light strengths scale the current
// look's values, so repeated generations never drift brighter or darker.
export function candidates(p, seed) {
  const rnd = mulberry32(seed);
  const pick = ([a, b]) => a + rnd() * (b - a);
  const look = LOOKS[p.preset] || LOOKS.hero;
  const G = GENERATE;
  const L = G.layouts[p.rings.layout] || G.layouts.stack;
  const out = [];
  for (let i = 0; i < G.candidates; i++) {
    const c = JSON.parse(JSON.stringify(p));
    c.seed = seed;
    for (const k of Object.keys(L.camera)) c.camera[k] = round(pick(L.camera[k]), 2);
    for (const k of Object.keys(L.rotation)) c.rotation[k] = round(pick(L.rotation[k]), 1);
    for (const k of Object.keys(L.rings)) c.rings[k] = round(pick(L.rings[k]), 2);
    for (const k of Object.keys(look.lights)) {
      c.lights[k].intensity = round(Math.min(24, look.lights[k].intensity * pick(G.lightScale)), 2);
    }
    for (const k of ['key', 'rim']) {
      c.sun[k].intensity = round(Math.min(3, look.sun[k].intensity * pick(G.sunScale)), 3);
    }
    c.phase = { time: round(pick(G.phase.time), 2) };
    out.push(c);
  }
  return out;
}

// Composition score for one candidate frame (luma rows bottom-up, 0..1).
export function scoreFrame({ w, h, lum }, clearance, layout) {
  const W = GENERATE.weights[layout === 'ripple' ? 'field' : 'object'];
  const terms = {};
  if (clearance < GENERATE.minClearance) return { total: -Infinity, terms: { clearance } };

  // exposure / clipping / contrast
  let sum = 0, sum2 = 0, clipped = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) { const v = lum[i]; sum += v; sum2 += v * v; if (v > 0.97) clipped++; }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const clipPct = (clipped / n) * 100;
  terms.clipping = -Math.max(0, clipPct - 1);
  terms.exposure = -(mean < 0.14 ? (0.14 - mean) / 0.14 : mean > 0.5 ? (mean - 0.5) / 0.3 : 0);
  terms.contrast = Math.min(1, std / 0.22);

  // highlight placement: centroid of the brightest 5% of samples
  const sorted = Float32Array.from(lum).sort();
  const thr = sorted[Math.floor(n * 0.95)];
  let cx = 0, cy = 0, cw = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x] - thr;
      if (v > 0) { cx += (x + 0.5) / w * v; cy += (y + 0.5) / h * v; cw += v; }
    }
  }
  if (cw > 0) { cx /= cw; cy /= cw; } else { cx = 0.5; cy = 0.5; }
  let dThirds = Infinity;
  for (const [tx, ty] of [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]]) {
    dThirds = Math.min(dThirds, Math.hypot(cx - tx, cy - ty));
  }
  terms.thirds = -Math.min(1, dThirds / 0.33);
  terms.centre = -Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.3);
  const edgeDist = Math.min(cx, 1 - cx, cy, 1 - cy);
  terms.edge = -(edgeDist < 0.12 ? (0.12 - edgeDist) / 0.12 : 0);

  // left / right balance of light mass
  let left = 0, right = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { if (x < w / 2) left += lum[y * w + x]; else right += lum[y * w + x]; }
  }
  const imbalance = Math.abs(left - right) / Math.max(1e-6, left + right);
  // fill: share of samples clearly brighter than the median (the rings)
  const med = sorted[Math.floor(n * 0.5)];
  let lit = 0;
  for (let i = 0; i < n; i++) if (lum[i] > med + 0.08) lit++;
  const share = lit / n;
  terms.fill = share < 0.08 ? -(0.08 - share) / 0.08 : share > 0.45 ? -Math.min(1, (share - 0.45) / 0.3) : 0;
  terms.balance = -Math.max(0, (imbalance - 0.25) / 0.5);

  // seam density per horizontal band: bottom quarter, middle half, top quarter
  const density = (y0, y1) => {
    let e = 0, c = 0;
    for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h) - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        if (Math.abs(lum[i + 1] - lum[i]) + Math.abs(lum[i + w] - lum[i]) > 0.06) e++;
        c++;
      }
    }
    return c ? e / c : 0;
  };
  const dBottom = density(0, 0.25), dMid = density(0.25, 0.75), dTop = density(0.75, 1);
  // the top of the frame should be calmer than the middle (the field dissolving)
  terms.horizon = dMid > 0 ? Math.min(1, Math.max(0, 1 - dTop / (dMid * 0.8))) : 0;
  // near tiles read best at a middling seam density (huge = wall, tiny = gravel)
  terms.foreground = dBottom < 0.02 ? -1 : dBottom > 0.3 ? -Math.min(1, (dBottom - 0.3) / 0.2) : Math.min(1, (dBottom - 0.02) / 0.06);

  let total = 0;
  for (const k of Object.keys(terms)) total += (W[k] ?? 1) * terms[k];
  return { total, terms };
}
