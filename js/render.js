// Accumulation renderer. Depth of field is done by jittering the camera
// across an aperture disc and shearing the frustum so the focal plane is
// invariant, then averaging passes. This is resolution independent and has
// no screen-space pass, so tiled renders stitch without seams.

import * as THREE from 'three';
import { rasteriseWordmark } from './wordmark.js';

const BLIT_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Each sample is added at 1 / totalSamples weight. The highlight cap softly
// compresses linear HDR values above `cap` before they are averaged, so a
// defocused specular spreads as a soft disc rather than a glowing blob (the
// physical counterpart of a highlight clamp before a blur). 0 = off.
const ADD_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform float weight;
  uniform float cap;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb;
    if (cap > 0.0) {
      float m = max(c.r, max(c.g, c.b));
      if (m > cap) c *= (cap + (m - cap) / (1.0 + (m - cap) / cap)) / m;
    }
    gl_FragColor = vec4(c * weight, weight);
  }
`;

// Finishing pass: average -> exposure + filmic curve (three's ACES fit) ->
// sRGB -> text fade -> vignette -> grain -> wordmark, in full-frame pixel
// coordinates. For tiled stills the fade, vignette and grain
// are applied on the stitched canvas with the same maths (export_still.js),
// and overlaysOn is 0 here; stills draw the wordmark from its SVG there too. Colours mixed after the curve are display-space
// sRGB values, set with setDisplayColour below.
const FINISH_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform float scale;
  uniform float overlaysOn;
  uniform float vignetteStrength;
  uniform float grainAmount;
  uniform vec3 vignetteColour;
  uniform vec2 frameSize;
  uniform vec2 frameOffset;
  uniform float grainSeed;
  uniform vec4 fade;          // centre x, centre y (fractions, y from the top), radius, blur (fractions of width)
  uniform vec3 fadeColour;
  uniform float fadeOpacity;
  uniform sampler2D tWord;    // white wordmark, alpha = coverage
  uniform vec4 wordRect;      // x, y (from the top), w, h in full-frame pixels
  uniform vec3 wordColour;
  uniform float wordOpacity;

  #include <tonemapping_pars_fragment>

  vec3 toSrgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * scale;
    c = toSrgb(clamp(ACESFilmicToneMapping(c), 0.0, 1.0));
    vec2 px = vUv * frameSize + frameOffset;
    if (overlaysOn > 0.5) {
      if (fadeOpacity > 0.0) {
        float aspect = frameSize.x / max(frameSize.y, 1.0);
        vec2 p = vec2(px.x / frameSize.x, (1.0 - px.y / frameSize.y) / aspect);
        float d = distance(p, vec2(fade.x, fade.y / aspect));
        float b = max(fade.w, 1e-4);
        c = mix(c, fadeColour, (1.0 - smoothstep(fade.z - b, fade.z + b, d)) * fadeOpacity);
      }
      vec2 n = (px / max(frameSize, vec2(1.0))) - 0.5;
      float d = length(n * vec2(2.0, 2.0)) * 0.70710678;
      float v = smoothstep(0.45, 1.05, d) * vignetteStrength;
      c = mix(c, vignetteColour, v);
    }
    float g = (hash12(px + vec2(grainSeed * 101.7, grainSeed * 57.3)) - 0.5) * 2.0;
    c += g * grainAmount;
    c += (hash12(px + vec2(7.77, grainSeed)) - 0.5) / 255.0; // dither
    if (overlaysOn > 0.5 && wordOpacity > 0.0) {
      vec2 q = (vec2(px.x, frameSize.y - px.y) - wordRect.xy) / wordRect.zw;
      if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
        float a = texture2D(tWord, vec2(q.x, 1.0 - q.y)).a;
        c = mix(c, wordColour, a * wordOpacity);
      }
    }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

// Display-space colour for the finish shader: the raw sRGB channel values,
// with no conversion to the linear working space.
function setDisplayColour(target, hex) {
  target.setHex(parseInt(hex.slice(1), 16), THREE.LinearSRGBColorSpace);
}

export class AccumRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.NoToneMapping;
    // All clears are explicit: the add pass must not wipe the accumulation
    // target between samples.
    this.renderer.autoClear = false;

    this.rtScene = null;
    this.rtAccum = null;
    this.rtRead = null;
    this._rtW = 0; this._rtH = 0;

    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.PlaneGeometry(2, 2);
    this._addMat = new THREE.ShaderMaterial({
      vertexShader: BLIT_VERT,
      fragmentShader: ADD_FRAG,
      uniforms: { tSrc: { value: null }, weight: { value: 1 }, cap: { value: 0 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    this._finishMat = new THREE.ShaderMaterial({
      vertexShader: BLIT_VERT,
      fragmentShader: FINISH_FRAG,
      uniforms: {
        tSrc: { value: null },
        scale: { value: 1 },
        toneMappingExposure: { value: 1 },
        overlaysOn: { value: 1 },
        vignetteStrength: { value: 0 },
        grainAmount: { value: 0 },
        vignetteColour: { value: new THREE.Color() },
        frameSize: { value: new THREE.Vector2(1920, 1080) },
        frameOffset: { value: new THREE.Vector2(0, 0) },
        grainSeed: { value: 0 },
        fade: { value: new THREE.Vector4() },
        fadeColour: { value: new THREE.Color() },
        fadeOpacity: { value: 0 },
        tWord: { value: null },
        wordRect: { value: new THREE.Vector4() },
        wordColour: { value: new THREE.Color() },
        wordOpacity: { value: 0 },
      },
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this._quad = new THREE.Mesh(geo, this._addMat);
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);

    this._apertureSamples = [];
    this._aaSamples = [];
    this._lockup = null;          // wordmark lockup of the frame being rendered
    this._wordCanvas = document.createElement('canvas');
    this._wordTex = null;
    this._wordSize = '';
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._clear = new THREE.Color();
  }

  ensureTargets(w, h) {
    if (this._rtW === w && this._rtH === h) return;
    this._rtW = w; this._rtH = h;
    this.rtScene?.dispose();
    this.rtAccum?.dispose();
    this.rtRead?.dispose();
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: 4,
      depthBuffer: true,
    });
    this.rtAccum = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
    });
    this.rtRead = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
    });
  }

  // Deterministic aperture disc (sunflower spiral) and subpixel AA offsets.
  buildSequences(n) {
    if (this._apertureSamples.length === n) return;
    const golden = Math.PI * (3 - Math.sqrt(5));
    this._apertureSamples = [];
    this._aaSamples = [];
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt((i + 0.5) / n);
      const th = i * golden;
      this._apertureSamples.push([r * Math.cos(th), r * Math.sin(th)]);
      this._aaSamples.push([halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
    }
  }

  beginAccum() {
    const r = this.renderer;
    r.setRenderTarget(this.rtAccum);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setRenderTarget(null);
  }

  // Render one accumulation sample.
  // frame: { fullW, fullH, x0, y0, w, h } in pixels of the full image.
  renderSample(world, p, sampleIndex, totalSamples, frame) {
    const { camera } = world;
    const r = this.renderer;
    const seqLen = this._apertureSamples.length;
    const [ax, ay] = this._apertureSamples[sampleIndex % seqLen];
    const [jx, jy] = this._aaSamples[sampleIndex % seqLen];
    const focus = Math.max(0.2, p.optics.focus);
    const near = 0.1, far = 400;

    // Aperture radius in world units.
    const base = world.cameraBase(p);
    const ox = ax * p.optics.aperture;
    const oy = ay * p.optics.aperture;

    // Offset the camera on the aperture disc in its own right/up plane.
    const right = this._right.set(1, 0, 0).applyQuaternion(base.quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(base.quat);
    camera.position.copy(base.pos).addScaledVector(right, ox).addScaledVector(up, oy);
    camera.quaternion.copy(base.quat);
    camera.updateMatrixWorld(true);

    // Full-image symmetric frustum from the vertical field of view.
    const top0 = near * Math.tan(THREE.MathUtils.degToRad(p.camera.fov) / 2);
    const right0 = top0 * (frame.fullW / frame.fullH);

    // A wordmark lockup can shift the lens (content moves by offX, offY
    // frame fractions, so the window moves the other way) and widen it to
    // fit (zoom). Both apply to the whole frustum, so tiles still meet.
    this._lockup = world.lockup ? world.lockup(p, frame.fullW / frame.fullH) : null;
    const lk = this._lockup;
    const zoom = lk ? lk.zoom : 1;
    const cxw = lk ? -lk.offX * 2 * right0 : 0;
    const cyw = lk ? lk.offY * 2 * top0 : 0;
    const R0 = right0 * zoom, T0 = top0 * zoom;
    const zx = (2 * R0) / frame.fullW, zy = (2 * T0) / frame.fullH;

    // Tile window plus AA jitter, in full-image pixel coordinates.
    let left = cxw - R0 + (frame.x0 + jx) * zx;
    let rightF = cxw - R0 + (frame.x0 + frame.w + jx) * zx;
    let top = cyw + T0 - (frame.y0 + jy) * zy;
    let bottom = cyw + T0 - (frame.y0 + frame.h + jy) * zy;

    // Thin-lens shear: keep the focal plane fixed under the aperture offset.
    const shX = ox * near / focus;
    const shY = oy * near / focus;
    left -= shX; rightF -= shX; top -= shY; bottom -= shY;

    camera.projectionMatrix.makePerspective(left, rightF, top, bottom, near, far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    r.setRenderTarget(this.rtScene);
    r.setViewport(0, 0, frame.w, frame.h);
    // Color.set already converts the sRGB hex to the linear working space.
    r.setClearColor(this._clear.set(p.background.dark), 1);
    r.clear(true, true, false);
    r.render(world.scene, camera);

    // Add into the accumulation target.
    this._quad.material = this._addMat;
    this._addMat.uniforms.tSrc.value = this.rtScene.texture;
    this._addMat.uniforms.weight.value = 1 / totalSamples;
    this._addMat.uniforms.cap.value = p.optics.highlightCap;
    r.setRenderTarget(this.rtAccum);
    r.setViewport(0, 0, frame.w, frame.h);
    r.render(this._quadScene, this._quadCam);
    r.setRenderTarget(null);
  }

  // Finish pass to the canvas (preview, video) or to rtRead (still tiles,
  // composition scoring). overlays = text fade, vignette and grain; stills
  // apply those after stitching instead.
  finish(p, samplesDone, totalSamples, frame, { toCanvas = true, overlays = true, grainSeed = 0 } = {}) {
    const r = this.renderer;
    const u = this._finishMat.uniforms;
    const tf = p.finish.textFade;
    this._quad.material = this._finishMat;
    u.tSrc.value = this.rtAccum.texture;
    u.scale.value = totalSamples / Math.max(1, samplesDone);
    u.toneMappingExposure.value = p.optics.exposure;
    u.overlaysOn.value = overlays ? 1 : 0;
    u.vignetteStrength.value = p.finish.vignette;
    u.grainAmount.value = overlays ? p.finish.grain : 0; // grain joins the overlays on the stitched canvas for stills
    setDisplayColour(u.vignetteColour.value, p.background.dark);
    u.fade.value.set(tf.x / 100, tf.y / 100, tf.size / 200, tf.blur / 100);
    setDisplayColour(u.fadeColour.value, tf.color);
    u.fadeOpacity.value = tf.enabled ? tf.opacity : 0;
    u.frameSize.value.set(frame.fullW, frame.fullH);
    u.frameOffset.value.set(frame.x0, frame.y0);
    u.grainSeed.value = grainSeed;
    u.wordOpacity.value = 0;
    const lk = this._lockup;
    if (overlays && lk && lk.rect && lk.opacity > 0) {
      const rw = lk.rect.w * frame.fullW, rh = lk.rect.h * frame.fullH;
      if (this._prepareWordmark(rw, rh)) {
        u.tWord.value = this._wordTex;
        u.wordRect.value.set(lk.rect.x * frame.fullW, lk.rect.y * frame.fullH, rw, rh);
        setDisplayColour(u.wordColour.value, p.wordmark.color);
        u.wordOpacity.value = lk.opacity;
      }
    }
    r.setRenderTarget(toCanvas ? null : this.rtRead);
    r.setViewport(0, 0, frame.w, frame.h);
    r.render(this._quadScene, this._quadCam);
    r.setRenderTarget(null);
  }

  // Rasterise the wordmark at (about) its on-screen size, once per size.
  _prepareWordmark(w, h) {
    const scale = Math.min(1, 4096 / Math.max(w, h, 1));
    const cw = Math.max(2, Math.ceil(w * scale)), ch = Math.max(2, Math.ceil(h * scale));
    const key = `${cw}x${ch}`;
    if (key === this._wordSize && this._wordTex) return true;
    if (!rasteriseWordmark(this._wordCanvas, cw, ch)) return false;
    this._wordTex?.dispose();
    this._wordTex = new THREE.CanvasTexture(this._wordCanvas);
    this._wordTex.colorSpace = THREE.NoColorSpace;
    this._wordTex.minFilter = THREE.LinearFilter;
    this._wordTex.generateMipmaps = false;
    this._wordSize = key;
    return true;
  }

  readTile(w, h) {
    const buf = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(this.rtRead, 0, 0, w, h, buf);
    // Flip vertically into ImageData row order.
    const out = new ImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      out.data.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    return out;
  }

  // Sub-sampled luminance (0..1) of the last finish into rtRead, GL row order
  // (row 0 is the bottom), for composition scoring.
  readLuma(w, h, step = 2) {
    const buf = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(this.rtRead, 0, 0, w, h, buf);
    const sw = Math.floor(w / step), sh = Math.floor(h / step);
    const lum = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * step * w + x * step) * 4;
        lum[y * sw + x] = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      }
    }
    return { w: sw, h: sh, lum };
  }
}

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}
