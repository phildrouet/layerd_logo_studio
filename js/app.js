// Layerd Logo Studio: application glue. Binds the control panel to the
// parameter model, runs the progressive preview, and drives exports.

import { LogoScene } from './scene.js';
import { AccumRenderer } from './render.js';
import { exportStill, STILL_SAMPLES } from './export_still.js';
import { exportVideoMp4, exportVideoWebm, webCodecsAvailable, VIDEO_SAMPLES } from './export_video.js';
import { candidates, scoreFrame } from './compose.js';
import {
  defaultParams, applyLook, applyLayout, LAYOUTS, LIGHT_NAMES, encodeRecipe, decodeRecipe,
  STILL_FORMATS, formatPixels,
} from './presets.js';

const PREVIEW_SAMPLES = 64;
const PREVIEW_MAX_W = 1280;
const PREVIEW_MAX_H = 800;
const SCORE_W = 320;      // candidate render width for Generate new
const SCORE_SAMPLES = 4;

let params = defaultParams();
let playing = false;
let busy = false;
let recording = false;    // WebM fallback capture: canvas held at the video size
let timeU = 0;            // loop phase 0..1
let lastTick = 0;
let samplesDone = 0;
let frameCounter = 0;
let sceneDirty = true;

const canvas = document.getElementById('view');
const world = new LogoScene();
const accum = new AccumRenderer(canvas);

// ---------------------------------------------------------------- controls

// [section, label, path, min, max, step, unit] for sliders;
// [section, label, path, 'colour'] and [section, label, path, 'toggle'].
const CONTROLS = [
  ['sec-camera', 'Distance', 'camera.distance', 1, 16, 0.05, ''],
  ['sec-camera', 'Height', 'camera.height', -3, 4, 0.05, ''],
  ['sec-camera', 'Look down', 'camera.lookAtY', -4, 2, 0.05, ''],
  ['sec-camera', 'Field of view', 'camera.fov', 15, 90, 1, 'deg'],
  ['sec-camera', 'Rotate X', 'rotation.x', -45, 45, 0.5, 'deg'],
  ['sec-camera', 'Rotate Y', 'rotation.y', -90, 90, 0.5, 'deg'],
  ['sec-camera', 'Rotate Z', 'rotation.z', -45, 45, 0.5, 'deg'],
  ['sec-rings', 'Rings', 'rings.count', 1, 15, 1, ''],
  ['sec-rings', 'Assembly', 'rings.assemble', 'select', [
    ['off', 'Off (drift only)'],
    ['loop', 'Loop (mark and back)'],
    ['reveal', 'Reveal (ends on mark)'],
  ]],
  ['sec-rings', 'Drift', 'rings.drift', 0, 1.5, 0.01, ''],
  ['sec-rings', 'Turns per loop', 'rings.spin', -3, 3, 1, ''],
  ['sec-rings', 'Breathe', 'rings.breathe', 0, 20, 0.5, 'deg'],
  ['sec-rings', 'Wave height', 'rings.wave', 0, 0.8, 0.01, ''],
  ['sec-rings', 'Wave length', 'rings.waveLength', 0.8, 8, 0.05, ''],
  ['sec-rings', 'Wave cycles', 'rings.cycles', 1, 4, 1, ''],
  ['sec-rings', 'Fade start', 'rings.fadeNear', 1, 40, 0.5, ''],
  ['sec-rings', 'Fade end', 'rings.fadeFar', 2, 60, 0.5, ''],
  ['sec-glass', 'Colour', 'glass.color', 'colour'],
  ['sec-glass', 'Opacity', 'glass.opacity', 0, 1, 0.01, ''],
  ['sec-glass', 'Reflections', 'glass.reflections', 0, 3, 0.01, ''],
  ['sec-glass', 'Glint softness', 'glass.glintSoftness', 0.02, 0.6, 0.01, ''],
  ['sec-glass', 'Iridescence', 'glass.iridescence', 0, 1, 0.01, ''],
  ['sec-glass', 'Face gloss', 'glass.faceGloss', 0, 1, 0.01, ''],
  ['sec-glass', 'Bevel boost', 'glass.bevelBoost', 0, 8, 0.05, ''],
  ['sec-glass', 'Edge tint', 'glass.edgeTint', 'colour'],
  ['sec-glass', 'Edge tint amount', 'glass.edgeTintAmount', 0, 1.5, 0.01, ''],
  ['sec-glass', 'Facet tilt', 'facets.jitter', 0, 6, 0.1, 'deg'],
  ['sec-glass', 'Facet tint', 'facets.tint', 0, 1, 0.01, ''],
  ['sec-glass', 'Facet tint colour', 'facets.tintColor', 'colour'],
  ['sec-background', 'Bright', 'background.bright', 'colour'],
  ['sec-background', 'Mid', 'background.mid', 'colour'],
  ['sec-background', 'Dark', 'background.dark', 'colour'],
  ['sec-background', 'Scale', 'background.scale', 0.2, 4, 0.01, ''],
  ['sec-background', 'Swirl', 'background.warp', 0, 5, 0.01, ''],
  ['sec-background', 'Bright amount', 'background.brightAmount', 0, 1.5, 0.01, ''],
  ['sec-background', 'Edge darkening', 'background.vignette', 0, 1, 0.01, ''],
  ['sec-background', 'Drift phase', 'phase.time', 0, 600, 0.1, ''],
  ['sec-focus', 'Focus distance', 'optics.focus', 0.5, 30, 0.05, ''],
  ['sec-focus', 'Aperture', 'optics.aperture', 0, 0.15, 0.001, ''],
  ['sec-focus', 'Highlight cap', 'optics.highlightCap', 0, 6, 0.1, ''],
  ['sec-focus', 'Exposure', 'optics.exposure', 0.3, 2.5, 0.01, ''],
  ['sec-finish', 'Vignette', 'finish.vignette', 0, 1, 0.01, ''],
  ['sec-finish', 'Grain', 'finish.grain', 0, 0.15, 0.002, ''],
  ['sec-finish', 'Text fade', 'finish.textFade.enabled', 'toggle'],
  ['sec-finish', 'Fade colour', 'finish.textFade.color', 'colour'],
  ['sec-finish', 'Fade opacity', 'finish.textFade.opacity', 0, 1, 0.01, ''],
  ['sec-finish', 'Fade size', 'finish.textFade.size', 20, 250, 1, '%'],
  ['sec-finish', 'Fade centre X', 'finish.textFade.x', -60, 160, 1, '%'],
  ['sec-finish', 'Fade centre Y', 'finish.textFade.y', -60, 160, 1, '%'],
  ['sec-finish', 'Fade softness', 'finish.textFade.blur', 0, 30, 0.1, '%'],
  ['sec-loop', 'Duration', 'loop.duration', 4, 60, 1, 's'],
  ['sec-loop', 'Background swing', 'loop.swing', 0, 3, 0.05, ''],
];

// The seven studio lights and the two direct lights.
for (const [key, label] of Object.entries(LIGHT_NAMES)) {
  CONTROLS.push(['sec-lighting', label, `lights.${key}.hex`, 'colour']);
  CONTROLS.push(['sec-lighting', `${label} strength`, `lights.${key}.intensity`, 0, 24, 0.1, '']);
}
CONTROLS.push(
  ['sec-lighting', 'Wash', 'wash.hex', 'colour'],
  ['sec-lighting', 'Wash strength', 'wash.intensity', 0, 2, 0.01, ''],
  ['sec-lighting', 'Key glint', 'sun.key.color', 'colour'],
  ['sec-lighting', 'Key glint strength', 'sun.key.intensity', 0, 3, 0.01, ''],
  ['sec-lighting', 'Rim glint', 'sun.rim.color', 'colour'],
  ['sec-lighting', 'Rim glint strength', 'sun.rim.intensity', 0, 3, 0.01, ''],
);

// Ring controls that only apply to some layouts.
const LAYOUT_ONLY = {
  'rings.count': ['hinged', 'stack'],
  'rings.assemble': ['stack'],
  'rings.drift': ['stack'],
  'rings.spin': ['hinged', 'stack'],
  'rings.breathe': ['hinged', 'stack'],
  'rings.wave': ['ripple'],
  'rings.waveLength': ['ripple'],
  'rings.cycles': ['ripple'],
};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

const controlEls = [];
function buildControls() {
  for (const [sec, label, path, a, b, step, unit] of CONTROLS) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement(a === 'select' ? 'select' : 'input');
    let show = () => {};
    let read;
    if (a === 'select') {
      for (const [value, text] of b) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        input.appendChild(o);
      }
      read = () => input.value;
    } else if (a === 'colour') {
      input.type = 'color';
      read = () => input.value;
    } else if (a === 'toggle') {
      input.type = 'checkbox';
      read = () => input.checked;
    } else {
      input.type = 'range';
      input.min = a; input.max = b; input.step = step;
      read = () => parseFloat(input.value);
      const val = document.createElement('span');
      val.className = 'val';
      show = (v) => { val.textContent = `${v}${unit ? ' ' + unit : ''}`; };
      row.append(lab, input, val);
    }
    if (!row.children.length) row.append(lab, input);
    input.addEventListener('input', () => {
      setPath(params, path, read());
      show(input.value);
      invalidate();
    });
    document.getElementById(sec).appendChild(row);
    controlEls.push({ input, path, show, kind: a, row });
  }
}

function syncControls() {
  const layout = params.rings.layout;
  for (const { input, path, show, kind, row } of controlEls) {
    const v = getPath(params, path);
    if (kind === 'toggle') input.checked = !!v;
    else input.value = v;
    show(v);
    row.hidden = !!LAYOUT_ONLY[path] && !LAYOUT_ONLY[path].includes(layout);
  }
  document.getElementById('seed').value = params.seed;
  document.getElementById('preset-hero').classList.toggle('on', params.preset === 'hero');
  document.getElementById('preset-light').classList.toggle('on', params.preset === 'light');
  for (const name of Object.keys(LAYOUTS)) {
    document.getElementById(`layout-${name}`).classList.toggle('on', layout === name);
  }
}

function invalidate() {
  sceneDirty = true;
  samplesDone = 0;
}

// ------------------------------------------------------------ preview loop

function previewSize() {
  const [fw, fh] = currentStillPixels();
  const aspect = fw / fh;
  let w = PREVIEW_MAX_W, h = Math.round(w / aspect);
  if (h > PREVIEW_MAX_H) { h = PREVIEW_MAX_H; w = Math.round(h * aspect); }
  return [w, h];
}

function applyPreviewSize() {
  if (recording) return;
  const [w, h] = previewSize();
  if (canvas.width !== w || canvas.height !== h) {
    accum.renderer.setSize(w, h, false);
    canvas.style.aspectRatio = `${w} / ${h}`;
    invalidate();
  }
  accum.ensureTargets(w, h);
}

function tick(now) {
  requestAnimationFrame(tick);
  if (busy) return;
  applyPreviewSize();
  accum.buildSequences(PREVIEW_SAMPLES);
  const frame = { fullW: canvas.width, fullH: canvas.height, x0: 0, y0: 0, w: canvas.width, h: canvas.height };

  if (playing) {
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    timeU = (timeU + dt / params.loop.duration) % 1;
    document.getElementById('scrub').value = timeU;
    world.applyParams(accum.renderer, params, timeU);
    accum.beginAccum();
    accum.renderSample(world, params, frameCounter++, 1, frame);
    accum.finish(params, 1, 1, frame, { overlays: true, grainSeed: frameCounter % 997 });
    setStatus('Playing');
  } else {
    if (sceneDirty) {
      world.applyParams(accum.renderer, params, timeU);
      accum.beginAccum();
      samplesDone = 0;
      sceneDirty = false;
    }
    if (samplesDone < PREVIEW_SAMPLES) {
      const burst = Math.min(2, PREVIEW_SAMPLES - samplesDone);
      for (let i = 0; i < burst; i++) {
        accum.renderSample(world, params, samplesDone, PREVIEW_SAMPLES, frame);
        samplesDone++;
      }
      accum.finish(params, samplesDone, PREVIEW_SAMPLES, frame, { overlays: true, grainSeed: 0 });
      setStatus(`Refining ${Math.round((samplesDone / PREVIEW_SAMPLES) * 100)}%`);
    } else {
      setStatus('Ready');
    }
  }
  lastTick = now;
  document.getElementById('status-time').textContent =
    `Loop ${(timeU * params.loop.duration).toFixed(1)} s of ${params.loop.duration} s`;
}

function setStatus(text) {
  document.getElementById('status-samples').textContent = text;
}

// ------------------------------------------------------- composition tools

function previewAspect() {
  const [w, h] = currentStillPixels();
  return w / h;
}

// Focus distance on the rings at the centre of the frame, for recipe p.
function ringsFocus(p) {
  world.applyParams(accum.renderer, p, timeU);
  return Math.round(world.focusDistance(p, previewAspect()) * 100) / 100;
}

// Generate new: score seeded candidates on small renders, keep the best.
async function generateNew() {
  if (busy) return;
  busy = true;
  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  try {
    const seed = 1 + Math.floor(Math.random() * 999998);
    const list = candidates(params, seed);
    const aspect = previewAspect();
    const w = SCORE_W, h = Math.max(16, Math.round(SCORE_W / aspect));
    const frame = { fullW: w, fullH: h, x0: 0, y0: 0, w, h };
    accum.ensureTargets(w, h);
    accum.buildSequences(SCORE_SAMPLES);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      setStatus(`Composing ${i + 1} of ${list.length}`);
      c.optics.focus = ringsFocus(c);
      const clearance = world.clearance(c);
      accum.beginAccum();
      for (let s = 0; s < SCORE_SAMPLES; s++) accum.renderSample(world, c, s, SCORE_SAMPLES, frame);
      accum.finish(c, SCORE_SAMPLES, SCORE_SAMPLES, frame, { toCanvas: false, overlays: false });
      const { total } = scoreFrame(accum.readLuma(w, h, 2), clearance, c.rings.layout);
      if (!best || total > bestScore) { best = c; bestScore = total; }
      await new Promise((r) => requestAnimationFrame(r));
    }
    params = best;
    syncControls();
  } finally {
    busy = false;
    btn.disabled = false;
    invalidate();
  }
}

// ------------------------------------------------------------------ export

function currentStillFormat() {
  return STILL_FORMATS.find((f) => f.id === document.getElementById('still-format').value) || STILL_FORMATS[0];
}

function currentStillPixels() {
  const fmt = currentStillFormat();
  return formatPixels(fmt, {
    dpi: parseInt(document.getElementById('still-dpi').value, 10),
    portrait: document.getElementById('orient-portrait').classList.contains('on'),
    customMm: [num('custom-mm-w'), num('custom-mm-h')],
    customPx: [num('custom-px-w'), num('custom-px-h')],
  });
}

function num(id) {
  return parseFloat(document.getElementById(id).value) || 0;
}

function updateStillUI() {
  const fmt = currentStillFormat();
  document.getElementById('row-custom-mm').hidden = fmt.custom !== 'mm';
  document.getElementById('row-custom-px').hidden = fmt.custom !== 'px';
  document.getElementById('row-dpi').hidden = !(fmt.mm || fmt.custom === 'mm');
  document.getElementById('row-orientation').hidden = !!fmt.fixedOrientation || fmt.custom === 'px';
  const [w, h] = currentStillPixels();
  const mp = ((w * h) / 1e6).toFixed(0);
  document.getElementById('still-size-note').textContent = `Will render ${w} x ${h} px (${mp} megapixels).`;
  applyPreviewSize();
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

function exportBaseName(w, h) {
  const t = (timeU * params.loop.duration).toFixed(2);
  return `layerd-logo-studio_${params.rings.layout}_${params.preset}_seed${params.seed}_t${t}s_${w}x${h}`;
}

function downloadRecipeSidecar(baseName, extra) {
  const sidecar = { tool: 'Layerd Logo Studio', recipe: params, export: extra };
  download(new Blob([JSON.stringify(sidecar, null, 2)], { type: 'application/json' }), `${baseName}.recipe.json`);
}

async function doExportStill() {
  if (busy) return;
  busy = true;
  const btn = document.getElementById('btn-export-still');
  const prog = document.getElementById('still-progress');
  const status = document.getElementById('still-status');
  btn.disabled = true;
  prog.hidden = false;
  const [w, h] = currentStillPixels();
  const started = performance.now();
  try {
    world.applyParams(accum.renderer, params, timeU);
    const grainSeed = params.seed % 997;
    const blob = await exportStill(world, accum, params, w, h, grainSeed, (f, stage) => {
      prog.value = f;
      status.textContent = `${stage}: ${Math.round(f * 100)}%`;
    });
    const base = exportBaseName(w, h);
    download(blob, `${base}.png`);
    downloadRecipeSidecar(base, { type: 'still', width: w, height: h, time: timeU, samples: STILL_SAMPLES });
    const secs = ((performance.now() - started) / 1000).toFixed(0);
    status.textContent = `Done in ${secs} s. Saved ${base}.png with its recipe file.`;
  } catch (err) {
    status.textContent = `Export failed: ${err.message}`;
  } finally {
    busy = false;
    btn.disabled = false;
    prog.hidden = true;
    invalidate();
  }
}

async function doExportVideo() {
  if (busy) return;
  busy = true;
  const btn = document.getElementById('btn-export-video');
  const prog = document.getElementById('video-progress');
  const status = document.getElementById('video-status');
  btn.disabled = true;
  prog.hidden = false;
  const [w, h] = document.getElementById('video-res').value.split('x').map(Number);
  const fps = parseInt(document.getElementById('video-fps').value, 10);
  const lengthSel = document.getElementById('video-length').value;
  const seconds = lengthSel === 'loop' ? params.loop.duration : parseFloat(lengthSel);
  const started = performance.now();
  try {
    let blob, ext;
    if (webCodecsAvailable()) {
      accum.renderer.setSize(w, h, false);
      accum.ensureTargets(w, h);
      // The sunflower disc must be built for the sample count actually used,
      // or the first VIDEO_SAMPLES points only cover the inner aperture.
      accum.buildSequences(VIDEO_SAMPLES);
      const frame = { fullW: w, fullH: h, x0: 0, y0: 0, w, h };
      blob = await exportVideoMp4(world, accum, params, { width: w, height: h, fps, seconds },
        async (u, _w, _h, frameIndex) => {
          world.applyParams(accum.renderer, params, u);
          accum.beginAccum();
          for (let s = 0; s < VIDEO_SAMPLES; s++) {
            accum.renderSample(world, params, s, VIDEO_SAMPLES, frame);
          }
          accum.finish(params, VIDEO_SAMPLES, VIDEO_SAMPLES, frame, { overlays: true, grainSeed: frameIndex % 997 });
          if (frameIndex % 5 === 0) await new Promise((r) => requestAnimationFrame(r));
        },
        (f, stage) => {
          prog.value = f;
          status.textContent = `${stage}: ${Math.round(f * 100)}%`;
        });
      ext = 'mp4';
    } else {
      status.textContent = 'WebCodecs is not available in this browser, recording a WebM in real time instead.';
      accum.renderer.setSize(w, h, false);
      accum.ensureTargets(w, h);
      const wasPlaying = playing;
      blob = await exportVideoWebm(accum, { fps, seconds },
        () => { recording = true; playing = true; busy = false; },
        () => { recording = false; playing = wasPlaying; busy = true; },
        (f, stage) => {
          prog.value = f;
          status.textContent = `${stage}: ${Math.round(f * 100)}%`;
        });
      ext = 'webm';
    }
    const base = `${exportBaseName(w, h)}_${fps}fps`;
    download(blob, `${base}.${ext}`);
    downloadRecipeSidecar(base, { type: 'video', width: w, height: h, fps, seconds });
    const mins = ((performance.now() - started) / 60000).toFixed(1);
    const reveal = params.rings.layout === 'stack' && params.rings.assemble === 'reveal';
    const loops = lengthSel !== 'loop' ? 'Test clip, does not loop.'
      : reveal ? 'Ends on the mark (reveal), so it does not loop.' : 'Loops seamlessly.';
    status.textContent = `Done in ${mins} min. ${loops}`;
  } catch (err) {
    status.textContent = `Export failed: ${err.message}`;
  } finally {
    busy = false;
    recording = false;
    btn.disabled = false;
    prog.hidden = true;
    applyPreviewSize();
    invalidate();
  }
}

// --------------------------------------------------------------- UI wiring

function wire() {
  const fmtSel = document.getElementById('still-format');
  for (const f of STILL_FORMATS) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.label;
    fmtSel.appendChild(o);
  }
  fmtSel.value = 'a2';
  fmtSel.addEventListener('change', updateStillUI);
  document.getElementById('still-dpi').addEventListener('change', updateStillUI);
  for (const id of ['custom-mm-w', 'custom-mm-h', 'custom-px-w', 'custom-px-h']) {
    document.getElementById(id).addEventListener('input', updateStillUI);
  }
  document.getElementById('orient-landscape').addEventListener('click', () => setOrientation(false));
  document.getElementById('orient-portrait').addEventListener('click', () => setOrientation(true));

  document.getElementById('btn-generate').addEventListener('click', generateNew);
  document.getElementById('btn-reseed').addEventListener('click', () => {
    const seed = 1 + Math.floor(Math.random() * 999998);
    params.seed = seed;
    document.getElementById('seed').value = seed;
    invalidate();
  });
  document.getElementById('seed').addEventListener('change', (e) => {
    params.seed = Math.max(1, parseInt(e.target.value, 10) || 1);
    invalidate();
  });

  for (const name of Object.keys(LAYOUTS)) {
    document.getElementById(`layout-${name}`).addEventListener('click', () => setLayout(name));
  }
  document.getElementById('preset-hero').addEventListener('click', () => setLook('hero'));
  document.getElementById('preset-light').addEventListener('click', () => setLook('light'));
  document.getElementById('btn-reset-look').addEventListener('click', () => setLook(params.preset));
  document.getElementById('btn-focus-band').addEventListener('click', () => {
    params.optics.focus = ringsFocus(params);
    syncControls();
    invalidate();
  });

  document.getElementById('btn-play').addEventListener('click', () => {
    playing = !playing;
    document.getElementById('btn-play').textContent = playing ? 'Pause' : 'Play';
    if (!playing) invalidate();
  });
  document.getElementById('scrub').addEventListener('input', (e) => {
    timeU = parseFloat(e.target.value);
    invalidate();
  });

  document.getElementById('btn-copy-recipe').addEventListener('click', async () => {
    await navigator.clipboard.writeText(encodeRecipe(params));
    flash('btn-copy-recipe', 'Copied');
  });
  document.getElementById('btn-load-recipe').addEventListener('click', () => {
    document.getElementById('recipe-loader').hidden = false;
  });
  document.getElementById('btn-cancel-recipe').addEventListener('click', () => {
    document.getElementById('recipe-loader').hidden = true;
  });
  document.getElementById('btn-apply-recipe').addEventListener('click', () => {
    const text = document.getElementById('recipe-text').value.trim();
    try {
      const obj = JSON.parse(text);
      params = decodeRecipe(JSON.stringify(obj.recipe && obj.tool ? obj.recipe : obj));
      document.getElementById('recipe-loader').hidden = true;
      document.getElementById('recipe-text').value = '';
      syncControls();
      invalidate();
    } catch (err) {
      alert(`Could not read that recipe: ${err.message}`);
    }
  });

  document.getElementById('btn-export-still').addEventListener('click', doExportStill);
  document.getElementById('btn-export-video').addEventListener('click', doExportVideo);

  if (!webCodecsAvailable()) {
    document.getElementById('btn-export-video').textContent = 'Export WebM';
    document.getElementById('video-status').textContent =
      'This browser lacks WebCodecs, so video export records a WebM in real time. Chrome or Edge will export MP4.';
  }
}

function setOrientation(portrait) {
  document.getElementById('orient-landscape').classList.toggle('on', !portrait);
  document.getElementById('orient-portrait').classList.toggle('on', portrait);
  updateStillUI();
}

function setLayout(name) {
  applyLayout(params, name);
  syncControls();
  invalidate();
}

function setLook(name) {
  applyLook(params, name);
  syncControls();
  invalidate();
}

function flash(id, text) {
  const el = document.getElementById(id);
  const old = el.textContent;
  el.textContent = text;
  setTimeout(() => { el.textContent = old; }, 1200);
}

window.__ts = {
  world, accum,
  getParams: () => params,
  setParams: (p) => { params = p; syncControls(); invalidate(); },
  set: (path, v) => { setPath(params, path, v); syncControls(); invalidate(); },
  setTime: (u) => { timeU = u; invalidate(); },
  ringsFocus: () => ringsFocus(params),
};

buildControls();
wire();
syncControls();
updateStillUI();
requestAnimationFrame(tick);
