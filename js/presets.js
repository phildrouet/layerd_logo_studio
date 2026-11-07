// Parameter model, layouts, looks, recipe serialisation and print formats.
// A recipe is the full parameter set as JSON; identical recipe + size = identical pixels.

// v3: the glass rings scene (Layerd Logo Studio). Earlier versions described
// other geometry and cannot be re-rendered by this one.
export const RECIPE_VERSION = 3;

// Names of the seven studio lights, in panel order (see studio_env.js).
export const LIGHT_NAMES = {
  key: 'Key',
  kicker: 'Kicker',
  pool: 'Pool',
  overhead: 'Overhead',
  bounce: 'Bounce',
  backdrop: 'Backdrop',
  sideBand: 'Side band',
};

// A layout is the geometry half of a recipe plus a framing that suits it.
// Choosing one sets the rings block, camera, rotation and focus, never the
// colours.
export const LAYOUTS = {
  // The mark in glass: rings hinged on one axis, fanned like the logo.
  hinged: {
    label: 'Mark',
    rings: { count: 3, spin: 1, breathe: 6, fadeNear: 60, fadeFar: 100 },
    camera: { distance: 24, height: 0, lookAtY: 0, fov: 11.8 },
    rotation: { x: 12, y: 32, z: -8 },
    optics: { focus: 24, aperture: 0.08 },
  },
  // Rings as the layers of a sphere, drifting, gathering into the mark.
  // A long lens (nearly orthographic) keeps the formed mark's ellipses
  // symmetric, like the flat logo: close up, perspective pulls the near
  // half of each tilted ring down and the eye loses its lids.
  stack: {
    label: 'Sphere',
    rings: { count: 3, assemble: 'loop', drift: 0.6, spin: 1, breathe: 0, fadeNear: 60, fadeFar: 100 },
    camera: { distance: 40, height: 0, lookAtY: 0, fov: 7.1 },
    rotation: { x: 0, y: 0, z: 0 },
    optics: { focus: 40, aperture: 0.08 },
  },
  // A disc of concentric rings with a wave travelling outwards.
  ripple: {
    label: 'Ripple',
    rings: { wave: 0.22, waveLength: 3.2, cycles: 1, fadeNear: 9, fadeFar: 22 },
    camera: { distance: 5, height: 0.2, lookAtY: -1.1, fov: 40 },
    rotation: { x: 0, y: 0, z: 0 },
    optics: { focus: 11, aperture: 0.04 },
  },
};

export function applyLayout(p, name) {
  const L = LAYOUTS[name];
  p.rings.layout = name;
  Object.assign(p.rings, L.rings);
  Object.assign(p.camera, L.camera);
  Object.assign(p.rotation, L.rotation);
  Object.assign(p.optics, L.optics);
  return p;
}

// A look is the colour and material half of a recipe. Applying one never
// touches the layout, camera, phase or loop.
export const LOOKS = {
  // Dark look from the Layerd swatches: charcoal #292929, periwinkle
  // #6371F7, lime #A6E247 (accent only), pale #EBEDF5. The glass is the
  // brand periwinkle so the formed mark reads as the logo's solid strokes.
  hero: {
    label: 'Hero',
    glass: {
      color: '#6371f7', opacity: 0.95, reflections: 1.2, glintSoftness: 0.2, iridescence: 0.5,
      faceGloss: 1, bevelBoost: 0, edgeTint: '#6371f7', edgeTintAmount: 0.5,
    },
    facets: { jitter: 0, tint: 0, tintColor: '#a6e247' },
    // Glass ribbon surface: a nearly clear body; reflections, edges and
    // iridescence carry it (see RIBBON_OUT in rings.js).
    ribbon: { color: '#c9cefc', opacity: 0.18, edge: 0.9, iridescence: 1 },
    wash: { hex: '#ebedf5', intensity: 0 },
    lights: {
      key: { hex: '#6371f7', intensity: 12, opacity: 1 },
      kicker: { hex: '#7d89ff', intensity: 12, opacity: 1 },
      pool: { hex: '#ebedf5', intensity: 9, opacity: 1 },
      overhead: { hex: '#141418', intensity: 4.6, opacity: 1 },
      bounce: { hex: '#b8bfff', intensity: 11, opacity: 1 },
      backdrop: { hex: '#4b57d9', intensity: 5, opacity: 0.97 },
      sideBand: { hex: '#a6e247', intensity: 3, opacity: 1 },
    },
    sun: { key: { color: '#ebedf5', intensity: 0.3 }, rim: { color: '#a6e247', intensity: 0.2 } },
    background: { bright: '#6371f7', mid: '#30347a', dark: '#1c1c22' },
    textFade: { color: '#161618', opacity: 0.68 },
    wordmark: { color: '#ebedf5' },
  },
  // Light look, first pass: pale periwinkle glass on a #EBEDF5 ground.
  light: {
    label: 'Light',
    glass: {
      color: '#aab2f8', opacity: 0.6, reflections: 0.9, glintSoftness: 0.12, iridescence: 0.5,
      faceGloss: 0.6, bevelBoost: 3, edgeTint: '#6371f7', edgeTintAmount: 0.8,
    },
    facets: { jitter: 0, tint: 0, tintColor: '#a6e247' },
    ribbon: { color: '#9aa4f5', opacity: 0.35, edge: 1, iridescence: 1 },
    wash: { hex: '#ffffff', intensity: 0.1 },
    lights: {
      key: { hex: '#6371f7', intensity: 14, opacity: 1 },
      kicker: { hex: '#7d89ff', intensity: 16, opacity: 1 },
      pool: { hex: '#ffffff', intensity: 14, opacity: 1 },
      overhead: { hex: '#ffffff', intensity: 8, opacity: 1 },
      bounce: { hex: '#8f99ff', intensity: 10, opacity: 1 },
      backdrop: { hex: '#ebedf5', intensity: 3, opacity: 1 },
      sideBand: { hex: '#6371f7', intensity: 14, opacity: 1 },
    },
    sun: { key: { color: '#ffffff', intensity: 2.6 }, rim: { color: '#6371f7', intensity: 1.4 } },
    background: { bright: '#f6f7fb', mid: '#ebedf5', dark: '#c3c8ee' },
    textFade: { color: '#ebedf5', opacity: 0.35 },
    wordmark: { color: '#292929' },
  },
};

export function applyLook(p, name) {
  const L = LOOKS[name];
  p.preset = name;
  p.glass = { ...L.glass };
  p.facets = { ...L.facets };
  p.ribbon = { ...L.ribbon };
  p.wash = { ...L.wash };
  p.lights = JSON.parse(JSON.stringify(L.lights));
  p.sun = JSON.parse(JSON.stringify(L.sun));
  Object.assign(p.background, L.background);
  Object.assign(p.finish.textFade, L.textFade);
  p.wordmark.color = L.wordmark.color;
  return p;
}

export function defaultParams() {
  const p = {
    version: RECIPE_VERSION,
    preset: 'hero',
    seed: 1,
    camera: { distance: 40, height: 0, lookAtY: 0, fov: 7.1 },
    rotation: { x: 0, y: 0, z: 0 },
    // layout: hinged | stack | ripple (see rings.js). count: rings in the
    // mark and the stack. assemble: off | loop | reveal (stack only).
    // spin: whole turns per loop. breathe: degrees the mark's fan swings.
    // drift: how far stacked rings wander. wave, waveLength, cycles: ripple.
    // surface: tiles (bevelled glass tiles) | ribbon (one continuous glass
    // band per ring, ribbonThickness deep). Layouts leave the surface alone.
    rings: {
      layout: 'stack', count: 3, assemble: 'loop', drift: 0.6, spin: 1, breathe: 0,
      wave: 0.22, waveLength: 3.2, cycles: 1, fadeNear: 60, fadeFar: 100,
      surface: 'tiles', ribbonThickness: 0.05,
    },
    // The Layerd wordmark beside the mark (see wordmark.js): position
    // right | left | below | above; size and gap scale the brand lockup;
    // withMark fades it in as the Sphere forms the mark; centre shifts the
    // lens so mark and wordmark sit centred together.
    wordmark: {
      enabled: false, position: 'right', size: 1, gap: 1, color: '#ebedf5', opacity: 1,
      withMark: true, centre: true,
    },
    phase: { time: 0 },
    background: { scale: 1.1, warp: 2, brightAmount: 1.15, vignette: 0.35 },
    // focus: depth of the rings at the frame centre ("Focus on rings").
    optics: { focus: 40, aperture: 0.08, highlightCap: 1.6, exposure: 1.05 },
    finish: {
      vignette: 0, grain: 0,
      textFade: { enabled: false, size: 88, x: 5, y: 55, blur: 12.5 },
    },
    loop: { duration: 15, swing: 1 },
  };
  applyLayout(p, 'stack');
  return applyLook(p, 'hero');
}

// Deterministic PRNG so a seed always produces the same composition.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function encodeRecipe(p) {
  return JSON.stringify(p);
}

export function decodeRecipe(text) {
  const obj = JSON.parse(text);
  if (typeof obj !== 'object' || obj === null || !obj.version) {
    throw new Error('Not a Layerd Logo Studio recipe');
  }
  if (obj.version < RECIPE_VERSION || !obj.rings) {
    throw new Error('This recipe was made for a different scene and cannot be re-rendered here');
  }
  // Merge over defaults so partial recipes still load.
  const merged = deepMerge(defaultParams(), obj);
  merged.version = RECIPE_VERSION;
  return merged;
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else if (over[k] !== undefined) {
      out[k] = over[k];
    }
  }
  return out;
}

// Print formats. mm-based entries compute pixels from the chosen dpi.
export const STILL_FORMATS = [
  { id: 'a0', label: 'A0 (1189 x 841 mm)', mm: [1189, 841] },
  { id: 'a1', label: 'A1 (841 x 594 mm)', mm: [841, 594] },
  { id: 'a2', label: 'A2 (594 x 420 mm)', mm: [594, 420] },
  { id: 'banner', label: 'Roller banner (850 x 2000 mm)', mm: [850, 2000], fixedOrientation: true },
  { id: '4k', label: '4K screen (3840 x 2160 px)', px: [3840, 2160] },
  { id: '1080p', label: 'Full HD screen (1920 x 1080 px)', px: [1920, 1080] },
  { id: 'custom-mm', label: 'Custom size in mm', custom: 'mm' },
  { id: 'custom-px', label: 'Custom size in px', custom: 'px' },
];

export const MM_PER_INCH = 25.4;

export function formatPixels(format, { dpi = 300, portrait = false, customMm = [600, 400], customPx = [4096, 2730] }) {
  let w, h;
  if (format.custom === 'mm') {
    w = Math.round((customMm[0] / MM_PER_INCH) * dpi);
    h = Math.round((customMm[1] / MM_PER_INCH) * dpi);
  } else if (format.custom === 'px') {
    [w, h] = customPx.map((v) => Math.round(v));
  } else if (format.mm) {
    w = Math.round((format.mm[0] / MM_PER_INCH) * dpi);
    h = Math.round((format.mm[1] / MM_PER_INCH) * dpi);
  } else {
    [w, h] = format.px;
  }
  if (!format.fixedOrientation && !format.custom) {
    const long = Math.max(w, h), short = Math.min(w, h);
    [w, h] = portrait ? [short, long] : [long, short];
  }
  return [Math.max(16, w), Math.max(16, h)];
}
