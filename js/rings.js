// The glass rings: bands of bevelled glass tiles laid around circles, after
// the Layerd mark. The mark is a set of rings sharing one horizontal
// diameter (the hinge), fanned at different tilts; each band swells where it
// meets the hinge. Every tile is an instance of its ring's tile geometry,
// re-posed each frame.
//
// Three layouts (recipe.rings.layout):
//  - hinged: the mark itself in glass. Tiles flow round each ring and the
//            fan breathes about the hinge.
//  - stack:  the rings as horizontal layers of a sphere, drifting. With
//            assembly on, the layers swing up round the hinge and gather
//            into the mark ("loop": hold, open out, drift, re-form, hold;
//            "reveal": drift, then form the mark and hold to the end).
//  - ripple: a wide disc of concentric rings with a wave travelling outwards.
//
// Poses are a pure function of the recipe and loop phase u. Rings turn whole
// revolutions per loop, drift and waves run whole cycles, and each tile keeps
// its identity, so u = 0 and u = 1 are the same frame (except "reveal",
// which ends on the mark by design).

import * as THREE from 'three';

// Fixed construction. A recipe assumes these values: changing any of them
// changes every image, so bump RECIPE_VERSION in presets.js if you do.
export const RINGS = {
  radius: 2,                  // shared radius of the mark's rings
  rows: 3,                    // tile rows across each band
  tiles: 110,                 // tiles round each ring
  extrude: 0.03, bevel: 0.009, gap: 0.006,
  widthMin: 0.2,              // mark band width at the top and bottom of a ring
  widthMax: 0.42,             // mark band width at the hinge
  widthPower: 2,              // how quickly the band swells towards the hinge
  stackWidth: 0.2,            // band width while stacked or drifting
  // The mark's three ellipses (outer ring, middle band, centre lens) sit at
  // about 20, 49 and 68 degrees; other ring counts follow the same curve.
  tiltCurve: [20, 68, -20],   // tilt(t) = a + b t + c t^2 for t in 0..1
  stackViewTilt: 18,          // degrees: the stack leans to show its layers, upright once it is the mark
  stackStagger: 0.12,         // loop fraction spread across the rings as they gather
  maxCount: 15,
  ripple: {
    inner: 0.5, outer: 22,
    spacing: 0.26,            // ring pitch (one tile row per ring)
    tileLength: 0.3,
    edgeFade: 0.7,            // fraction of the outer radius where rings start fading
    extrude: 0.04, bevel: 0.013, gap: 0.008,
    position: [0, -1.6, -6],
  },
};

const TAU = Math.PI * 2;
const deg = THREE.MathUtils.degToRad;
const lerp = THREE.MathUtils.lerp;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (6 * x - 15) + 10));

// Signed tilt of ring k of n in the mark: magnitudes follow the mark's
// curve, signs alternate so neighbouring rings open to opposite sides.
export function markTilt(k, n) {
  const t = n > 1 ? k / (n - 1) : 0;
  const [a, b, c] = RINGS.tiltCurve;
  return (k % 2 ? -1 : 1) * (a + b * t + c * t * t);
}

// How far the stack has gathered into the mark at loop phase u (0 drifting,
// 1 the mark).
export function assembly(mode, u) {
  if (mode === 'loop') {
    u = ((u % 1) + 1) % 1;
    if (u < 0.15) return 1;
    if (u < 0.35) return 1 - ease((u - 0.15) / 0.2);
    if (u < 0.6) return 0;
    if (u < 0.85) return ease((u - 0.6) / 0.25);
    return 1;
  }
  if (mode === 'reveal') return ease((u - 0.3) / 0.45);
  return 0;
}

// Annular-sector tile: radial along local x, tangential along y, extruded
// along z (so |normal.z| ~ 1 on the faces, which the gloss split relies on).
// Built round radius r, then moved so the tile centre sits at the origin.
function buildSectorTile(r, dTheta, width, extrude, bevel, gap) {
  const inset = gap * 0.5 + bevel;
  const ri = Math.max(0.01, r - width / 2 + inset);
  const ro = r + width / 2 - inset;
  const half = Math.max(0.001, dTheta / 2 - inset / r);
  const shape = new THREE.Shape();
  shape.moveTo(ri * Math.cos(-half), ri * Math.sin(-half));
  shape.absarc(0, 0, ro, -half, half, false);
  shape.absarc(0, 0, ri, half, -half, true);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrude,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 6,
  });
  geo.translate(-r, 0, -extrude / 2);
  geo.computeVertexNormals();
  return geo;
}

// Shader additions: distance fade, face / bevel IBL gloss split and
// depth-faded sheen. The string replacements target three r185 chunks;
// re-check them on any three upgrade.
function makeInjector(uniforms) {
  return (shader) => {
    shader.uniforms.uFadeDepth = uniforms.fadeDepth;
    shader.uniforms.uFaceGloss = uniforms.faceGloss;
    shader.uniforms.uBevelBoost = uniforms.bevelBoost;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vDepthFade;\nvarying float vBevel;\nuniform vec2 uFadeDepth;')
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvBevel = 1.0 - smoothstep(0.9, 0.995, abs(normal.z));')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvDepthFade = 1.0 - smoothstep(uFadeDepth.x, uFadeDepth.y, -mvPosition.z);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDepthFade;\nvarying float vBevel;\nuniform float uFaceGloss, uBevelBoost;')
      .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps
        .replace('radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
          'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * mix(uFaceGloss, 1.0 + uBevelBoost, vBevel);')
        .replace('clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );',
          'clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * mix(uFaceGloss, 1.0 + uBevelBoost, vBevel);'))
      .replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment
        .replace('material.sheenColor = sheenColor;', 'material.sheenColor = sheenColor * (vDepthFade * vDepthFade);'))
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vDepthFade;');
  };
}

// Stateless per-tile random in [0, 1), keyed on ring and tile index.
function hash01(seed, id, ring, salt) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(id | 0, 0xc2b2ae35);
  h ^= Math.imul(ring + 0x632be5ab, 0x27d4eb2f);
  h ^= Math.imul(salt + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Rings {
  constructor() {
    this.group = new THREE.Group();     // recipe rotation
    this.inner = new THREE.Group();     // layout placement and the stack's lean
    this.group.add(this.inner);
    this.uniforms = {
      fadeDepth: { value: new THREE.Vector2(14, 30) },
      faceGloss: { value: 1 },
      bevelBoost: { value: 0 },
    };
    this.inject = makeInjector(this.uniforms);
    this.base = new THREE.MeshPhysicalMaterial({
      color: 0x24274d,
      metalness: 0,
      roughness: 0.22,
      ior: 1.55,
      iridescence: 0.5,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [120, 420],
      clearcoat: 1,
      clearcoatRoughness: 0.2,
      specularIntensity: 1,
      attenuationColor: new THREE.Color(0xd9ddff),
      attenuationDistance: 3.5,
      side: THREE.FrontSide,
    });
    this.built = null;
    this.rings = [];

    this._m = new THREE.Matrix4(); this._t = new THREE.Matrix4(); this._r = new THREE.Matrix4();
    this._s = new THREE.Matrix4(); this._j = new THREE.Matrix4();
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._fc = new THREE.Color(); this._ft = new THREE.Color();
    this._v = new THREE.Vector3();
  }

  _addRing(spec) {
    const geo = buildSectorTile(spec.radius, TAU / spec.tiles, spec.tileWidth, spec.extrude, spec.bevel, spec.gap);
    const mat = this.base.clone();
    mat.transparent = true;
    mat.onBeforeCompile = this.inject;
    mat.customProgramCacheKey = () => 'rings-glass';
    const count = spec.tiles * spec.rows;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    for (let k = 0; k < count; k++) inst.setColorAt(k, new THREE.Color(1, 1, 1));
    const pivot = new THREE.Object3D();
    pivot.rotation.order = 'ZYX';       // tilt about the hinge first, then the drift roll
    pivot.add(inst);
    this.inner.add(pivot);
    this.rings.push({ alpha: 1, ...spec, inst, mat, pivot });
  }

  // (Re)build for a layout and ring count.
  _build(layout, count) {
    for (const ring of this.rings) {
      ring.pivot.removeFromParent();
      ring.inst.geometry.dispose();
      ring.mat.dispose();
    }
    this.rings = [];
    this.built = `${layout}:${count}`;
    this.inner.position.set(0, 0, 0);
    this.inner.rotation.set(0, 0, 0);

    if (layout === 'ripple') {
      const P = RINGS.ripple;
      this.inner.position.fromArray(P.position);
      const n = Math.floor((P.outer - P.inner) / P.spacing) + 1;
      for (let j = 0; j < n; j++) {
        const radius = P.inner + j * P.spacing;
        this._addRing({
          index: j, radius, rows: 1,
          tiles: Math.max(8, Math.round((TAU * radius) / P.tileLength)),
          tileWidth: P.spacing, extrude: P.extrude, bevel: P.bevel, gap: P.gap,
          alpha: 1 - THREE.MathUtils.smoothstep(radius, P.edgeFade * P.outer, P.outer),
        });
      }
      return;
    }

    // Hinged and stack share the same rings: stack layer j (bottom to top)
    // forms the mark's ring `slot`, ranked by distance from the equator, so
    // the widest layer becomes the outer ring and the small ones the lens.
    const R = RINGS.radius;
    const span = THREE.MathUtils.clamp(0.3 + 0.055 * count, 0.45, 0.9);
    const ys = Array.from({ length: count }, (_, j) => (count > 1 ? R * span * ((2 * j) / (count - 1) - 1) : 0));
    const order = ys.map((y, j) => j).sort((a, b) => Math.abs(ys[a]) - Math.abs(ys[b]) || a - b);
    const slotOf = new Array(count);
    order.forEach((j, rank) => { slotOf[j] = rank; });
    for (let j = 0; j < count; j++) {
      const slot = slotOf[j];
      const tilt = markTilt(slot, count);
      this._addRing({
        index: j, slot, tilt, y: ys[j],
        stackRadius: Math.sqrt(Math.max(0.04, R * R - ys[j] * ys[j])),
        radius: R, rows: RINGS.rows, tiles: RINGS.tiles,
        tileWidth: RINGS.widthMax / RINGS.rows,
        extrude: RINGS.extrude, bevel: RINGS.bevel, gap: RINGS.gap,
      });
    }
  }

  // Materials, fades and placement from the recipe.
  applyLook(p) {
    const rg = p.rings;
    const count = THREE.MathUtils.clamp(Math.round(rg.count) || 1, 1, RINGS.maxCount);
    const key = rg.layout === 'ripple' ? 'ripple:0' : `${rg.layout}:${count}`;
    if (key !== this.built) this._build(rg.layout, rg.layout === 'ripple' ? 0 : count);
    this.layout = rg.layout;
    const g = p.glass;
    for (const { mat, alpha } of this.rings) {
      mat.color.set(g.color);
      mat.opacity = alpha * g.opacity;
      mat.envMapIntensity = g.reflections * alpha * alpha;
      mat.specularIntensity = alpha;
      mat.clearcoat = alpha;
      mat.clearcoatRoughness = g.glintSoftness;
      mat.iridescence = g.iridescence * alpha;
      mat.sheen = g.edgeTintAmount * alpha;
      mat.sheenColor.set(g.edgeTint);
      mat.sheenRoughness = 0.45;
    }
    this.uniforms.fadeDepth.value.set(rg.fadeNear, Math.max(rg.fadeFar, rg.fadeNear + 0.5));
    this.uniforms.faceGloss.value = g.faceGloss;
    this.uniforms.bevelBoost.value = g.bevelBoost;
    const rot = p.rotation;
    this.group.rotation.set(deg(rot.x), deg(rot.y), deg(rot.z));
  }

  // Pose every tile at loop phase u.
  update(p, u) {
    const rg = p.rings;
    const seed = p.seed | 0;
    const F = p.facets;
    const jitAmt = deg(F.jitter || 0);
    const tintAmt = F.tint || 0;
    this._ft.set(F.tintColor);
    const spin = Math.round(rg.spin);            // whole turns per loop keep the loop seamless
    const cycles = Math.max(1, Math.round(rg.cycles));
    const R = RINGS.radius;
    const { _m, _t, _r, _s, _j, _q, _e, _fc, _ft } = this;
    const markWidth = (th) => RINGS.widthMin + (RINGS.widthMax - RINGS.widthMin) * Math.pow(Math.abs(Math.cos(th)), RINGS.widthPower);

    // Ripple surface (height and slope at radius r).
    const k = TAU / Math.max(0.2, rg.waveLength);
    const ph = TAU * cycles * u;
    const ripple = (r) => {
      const a = rg.wave * THREE.MathUtils.smoothstep(r, 0, 2.5);
      return [a * Math.sin(k * r - ph), a * k * Math.cos(k * r - ph)];
    };

    const n = this.rings.length;
    let meanA = 0;
    for (const ring of this.rings) {
      const { inst, pivot, tiles, rows, index } = ring;
      const dTheta = TAU / tiles;
      let turn = 0;           // in-plane rotation of the tile flow
      let a = 1;              // 0 stacked / drifting, 1 the mark
      let radius = ring.radius;

      if (this.layout === 'ripple') {
        pivot.position.set(0, 0, 0);
        pivot.rotation.set(-Math.PI / 2, 0, 0);
        turn = index * 0.61;
      } else {
        const dir = index % 2 ? -1 : 1;
        turn = dir * spin * TAU * u + index * 0.37;
        if (this.layout === 'stack') {
          const stagger = n > 1 ? (RINGS.stackStagger * ring.slot) / (n - 1) : 0;
          a = assembly(rg.assemble, u - stagger);
        }
        meanA += a;
        // Stacked / drifting pose: a horizontal layer of the sphere (tilted a
        // quarter turn about the hinge, on the side it will open towards),
        // drifting on whole-cycle sines.
        const d = rg.drift * (1 - a);
        const h = (s) => hash01(seed, index, 7, s) * TAU;
        const sx = d * 0.8 * Math.sin(TAU * u + h(1));
        const sz = d * 0.8 * Math.sin(TAU * u + h(2));
        const sy = ring.y + d * 0.3 * Math.sin(TAU * u - index * 0.9);
        const roll = d * deg(16) * Math.sin(TAU * u + h(3));
        const sign = Math.sign(ring.tilt) || 1;
        const markTiltNow = ring.tilt + rg.breathe * Math.sin(TAU * u + ring.slot * 2.1);
        pivot.position.set(sx, sy * (1 - a), sz);
        pivot.rotation.set(deg(lerp(sign * 90, markTiltNow, a)), 0, roll);
        radius = lerp(ring.stackRadius, R, a);
      }

      const tScale = radius / ring.radius;   // tangential stretch keeps the tiles closed up
      let i = 0;
      for (let kTile = 0; kTile < tiles; kTile++) {
        const th = kTile * dTheta + turn;
        const w = this.layout === 'ripple' ? ring.tileWidth : lerp(RINGS.stackWidth, markWidth(th), a);
        for (let row = 0; row < rows; row++) {
          const rr = radius + (row - (rows - 1) / 2) * (w / rows);
          let hgt = 0, slope = 0;
          if (this.layout === 'ripple') [hgt, slope] = ripple(rr);
          _m.makeRotationZ(th);
          _m.multiply(_t.makeTranslation(rr, 0, hgt));
          if (slope) _m.multiply(_r.makeRotationY(-Math.atan(slope)));
          const sxs = w / rows / ring.tileWidth;
          if (sxs !== 1 || tScale !== 1) _m.multiply(_s.makeScale(sxs, tScale, 1));
          const id = kTile * rows + row;
          if (jitAmt > 0) {
            _q.setFromEuler(_e.set(
              (hash01(seed, id, index, 1) * 2 - 1) * jitAmt,
              (hash01(seed, id, index, 2) * 2 - 1) * jitAmt, 0));
            _m.multiply(_j.makeRotationFromQuaternion(_q));
          }
          inst.setMatrixAt(i, _m);
          const ta = tintAmt * hash01(seed, id, index, 0);
          _fc.setRGB(1 + (_ft.r - 1) * ta, 1 + (_ft.g - 1) * ta, 1 + (_ft.b - 1) * ta);
          inst.setColorAt(i, _fc);
          i++;
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;
    }

    // The stack leans towards the camera to show its layers, and stands
    // upright as it becomes the mark.
    if (this.layout === 'stack') this.inner.rotation.set(deg(RINGS.stackViewTilt * (1 - meanA / n)), 0, 0);
  }

  // World-space tile centres (after update), for focus and clearance.
  forEachWorldPoint(fn) {
    this.group.updateMatrixWorld(true);
    const v = this._v, m = this._m;
    for (const { inst } of this.rings) {
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, m);
        fn(v.setFromMatrixPosition(m).applyMatrix4(inst.matrixWorld));
      }
    }
  }
}
