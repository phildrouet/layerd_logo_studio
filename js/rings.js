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
  // The mark's strokes as seen front-on, matched to the logo: hairline at
  // the top and bottom of every ring (0.035 R), swelling into the solid mass
  // at the hinge (0.13 R). Each ring's band is widened by its foreshortening
  // so the front view matches whatever its tilt.
  strokeTop: 0.07,
  strokeSide: 0.26,
  strokePower: 3,
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
  // Glass ribbon surface (rings.surface = 'ribbon'): each ring is one
  // continuous band with a rounded cross-section instead of tiles, posed
  // exactly like the tiles (same radius, tilt and stroke width).
  ribbon: {
    segments: 240,            // segments round each mark / stack ring
    rippleSegment: 0.35,      // segment length on the ripple's rings
    maxSegments: 420,
    cornerSteps: 3,           // arc steps per rounded corner of the cross-section
    rippleWidth: 0.8,         // ripple band width as a fraction of the ring pitch
    faceGloss: 0.35,          // IBL reflections on the flat faces (clear glass reflects little face-on)
    edgeBoost: 3,             // extra IBL reflections on the rounded edges
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
//
// The ribbon variant reads the face / edge split from an attribute (its
// mesh is not extruded along local z), fades per ring (aAlpha, the ripple's
// rim) and writes premultiplied clear glass: the body colour is scaled by
// the ribbon opacity, but reflections, glints and sheen are added at full
// strength, and the surface turns opaque towards grazing angles (Fresnel,
// scaled by uEdgeShine), so a nearly clear ribbon still has bright edges.
// Towards the rims, reflections shift through a cyan / periwinkle / pink
// cycle with the viewing angle (uSpectrum), a stylised stand-in for the
// dispersion fringes of real glass; three's thin-film iridescence alone is
// too faint on faces this flat.
// It blends with ONE, ONE_MINUS_SRC_ALPHA (see Rings._buildRibbon).
const RIBBON_PARS = `
vec3 ribbonSpectrum(float t) {
  t = fract(t) * 3.0;
  vec3 c0 = vec3(0.30, 0.85, 1.00);   // cyan
  vec3 c1 = vec3(0.42, 0.45, 1.00);   // periwinkle
  vec3 c2 = vec3(1.00, 0.48, 0.92);   // pink
  return t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : mix(c2, c0, t - 2.0);
}`;
const RIBBON_OUT = `{
  vec3 dPart = totalDiffuse;
  #ifdef USE_CLEARCOAT
    dPart *= 1.0 - material.clearcoat * Fcc;
  #endif
  vec3 sPart = max(outgoingLight - dPart, vec3(0.0));
  float body = diffuseColor.a;
  float nv = clamp(abs(dot(geometryNormal, geometryViewDir)), 0.0, 1.0);
  float rim = smoothstep(0.1, 0.85, 1.0 - nv) * uSpectrum;
  sPart *= mix(vec3(1.0), ribbonSpectrum(nv * 1.7 + 0.15) * 1.7, rim);
  float fres = pow(1.0 - nv, 4.0) * uEdgeShine;
  float aOut = clamp(body + (1.0 - body) * fres, 0.0, 1.0);
  float fade = vDepthFade * vAlpha;
  gl_FragColor = vec4((dPart * body + sPart) * fade, aOut * fade);
}`;

function makeInjector(uniforms, ribbon = false) {
  return (shader) => {
    shader.uniforms.uFadeDepth = uniforms.fadeDepth;
    shader.uniforms.uFaceGloss = uniforms.faceGloss;
    shader.uniforms.uBevelBoost = uniforms.bevelBoost;
    shader.uniforms.uEdgeShine = uniforms.edgeShine;
    shader.uniforms.uSpectrum = uniforms.spectrum;
    const vertDecl = ribbon
      ? 'attribute float aFace;\nattribute float aAlpha;\nvarying float vAlpha;\n'
      : '';
    const faceOf = ribbon ? 'aFace' : 'abs(normal.z)';
    const gloss = ribbon
      ? `mix(${RINGS.ribbon.faceGloss.toFixed(3)}, ${(1 + RINGS.ribbon.edgeBoost).toFixed(3)}, vBevel)`
      : 'mix(uFaceGloss, 1.0 + uBevelBoost, vBevel)';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertDecl}varying float vDepthFade;\nvarying float vBevel;\nuniform vec2 uFadeDepth;`)
      .replace('#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>\nvBevel = 1.0 - smoothstep(0.9, 0.995, ${faceOf});${ribbon ? '\nvAlpha = aAlpha;' : ''}`)
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvDepthFade = 1.0 - smoothstep(uFadeDepth.x, uFadeDepth.y, -mvPosition.z);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ribbon ? 'varying float vAlpha;\nuniform float uEdgeShine, uSpectrum;\n' + RIBBON_PARS + '\n' : ''}varying float vDepthFade;\nvarying float vBevel;\nuniform float uFaceGloss, uBevelBoost;`)
      .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps
        .replace('radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
          `radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * ${gloss};`)
        .replace('clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );',
          `clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness ) * ${gloss};`))
      .replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment
        .replace('material.sheenColor = sheenColor;', 'material.sheenColor = sheenColor * (vDepthFade * vDepthFade);'));
    shader.fragmentShader = ribbon
      ? shader.fragmentShader.replace('#include <opaque_fragment>', RIBBON_OUT)
      : shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vDepthFade;');
  };
}

// Cross-section of the ribbon: a rounded rectangle, as unit corner
// directions (c, s) at each of four corners (signs sx, sy), counter-
// clockwise from the outer edge. Point = corner centre + corner radius x
// (c, s); its normal is (c, s). Consecutive corners share an end normal,
// so the four flat sides come out flat.
function ribbonProfile(steps) {
  const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const pts = [];
  for (let q = 0; q < 4; q++) {
    for (let i = 0; i <= steps; i++) {
      const ang = ((q + i / steps) * Math.PI) / 2;
      pts.push({ sx: signs[q][0], sy: signs[q][1], c: Math.cos(ang), s: Math.sin(ang) });
    }
  }
  return pts;
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
      edgeShine: { value: 1 },
      spectrum: { value: 1 },
    };
    this.inject = makeInjector(this.uniforms);
    this.profile = ribbonProfile(RINGS.ribbon.cornerSteps);
    this.ribbonMesh = null;
    this._inv = new THREE.Matrix4();
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
    // three sorts transparent meshes by their bounding sphere's centre, and
    // an InstancedMesh computes that sphere once, from whatever pose its
    // tiles had the first time it was drawn, then caches it. That made the
    // draw order of overlapping rings depend on preview history. A fixed
    // sphere round the ring's own centre keeps the order a function of the
    // recipe and u alone: rings sharing a centre (Mark, Ripple) draw in ring
    // order, drifting Sphere layers by the depth of their centres.
    inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), spec.radius + spec.tileWidth * spec.rows + 0.5);
    for (let k = 0; k < count; k++) inst.setColorAt(k, new THREE.Color(1, 1, 1));
    const pivot = new THREE.Object3D();
    pivot.rotation.order = 'ZYX';       // tilt about the hinge first, then the drift roll
    pivot.add(inst);
    this.inner.add(pivot);
    this.rings.push({ alpha: 1, ...spec, inst, mat, pivot });
  }

  // (Re)build for a layout, ring count and surface.
  _build(layout, count, surface) {
    for (const ring of this.rings) {
      ring.pivot.removeFromParent();
      ring.inst.geometry.dispose();
      ring.mat.dispose();
    }
    if (this.ribbonMesh) {
      this.ribbonMesh.removeFromParent();
      this.ribbonMesh.geometry.dispose();
      this.ribbonMesh.material.dispose();
      this.ribbonMesh = null;
    }
    this.rings = [];
    this.built = `${layout}:${count}:${surface}`;
    this.inner.position.set(0, 0, 0);
    this.inner.rotation.set(0, 0, 0);
    this._buildRings(layout, count);
    if (surface === 'ribbon') this._buildRibbon(layout);
  }

  _buildRings(layout, count) {
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
        tileWidth: RINGS.strokeSide / RINGS.rows,
        extrude: RINGS.extrude, bevel: RINGS.bevel, gap: RINGS.gap,
      });
    }
  }

  // One mesh holds every ring's ribbon, in `inner` space, so the triangles
  // of all rings can be sorted together (sortRibbon). Positions and normals
  // are rewritten each frame (_poseRibbon); the cross-section's face / edge
  // split (aFace) and the ripple rim fade (aAlpha) are fixed.
  _buildRibbon(layout) {
    const RB = RINGS.ribbon, P = this.profile.length;
    let verts = 0, segs = 0;
    for (const ring of this.rings) {
      ring.ribS = layout === 'ripple'
        ? THREE.MathUtils.clamp(Math.round((TAU * ring.radius) / RB.rippleSegment), 48, RB.maxSegments)
        : RB.segments;
      ring.ribWidth = RINGS.ripple.spacing * RB.rippleWidth;
      ring.ribBase = verts;
      ring.ribSeg = segs;
      verts += ring.ribS * P;
      segs += ring.ribS;
    }
    this.ribPos = new Float32Array(verts * 3);
    this.ribNor = new Float32Array(verts * 3);
    this.ribCen = new Float32Array(segs * 3);
    this.ribKeys = new Float32Array(segs);
    this.ribOrder = new Uint32Array(segs);
    this.ribIndex = new Uint32Array(segs * P * 6);
    this.segRing = new Array(segs);
    const face = new Float32Array(verts), alpha = new Float32Array(verts);
    for (const ring of this.rings) {
      for (let s = 0; s < ring.ribS; s++) {
        this.segRing[ring.ribSeg + s] = ring;
        for (let k = 0; k < P; k++) {
          const v = ring.ribBase + s * P + k;
          face[v] = Math.abs(this.profile[k].s);
          alpha[v] = ring.alpha;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.ribPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.ribNor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFace', new THREE.BufferAttribute(face, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setIndex(new THREE.BufferAttribute(this.ribIndex, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = this.base.clone();
    mat.transparent = true;
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;         // draw order comes from the sorted index
    mat.depthWrite = true;
    mat.blending = THREE.CustomBlending; // premultiplied clear glass (RIBBON_OUT)
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.iridescenceIOR = 1.6;
    mat.iridescenceThicknessRange = [100, 800];  // thicker film: more hue change with angle
    mat.onBeforeCompile = makeInjector(this.uniforms, true);
    mat.customProgramCacheKey = () => 'rings-ribbon';
    this.ribbonMesh = new THREE.Mesh(geo, mat);
    this.ribbonMesh.frustumCulled = false;
    this.inner.add(this.ribbonMesh);
  }

  // Ribbon cross-sections round one ring at its current pose. Same frame as
  // a tile: radial along x, ring axis along z, tilted to the ripple's slope.
  _poseRibbon(ring, radius, a, tilt, rippleAt, markWidth, thick) {
    const pr = this.profile, P = pr.length;
    const pos = this.ribPos, nor = this.ribNor, cen = this.ribCen;
    ring.pivot.updateMatrix();
    const e = ring.pivot.matrix.elements;
    const ripple = this.layout === 'ripple';
    let hgt = 0, slope = 0;
    if (ripple) [hgt, slope] = rippleAt(radius);
    const ca = 1 / Math.sqrt(1 + slope * slope), sa = slope * ca;
    const ht = thick / 2;
    let v = ring.ribBase * 3;
    for (let s = 0; s < ring.ribS; s++) {
      const phi = (s * TAU) / ring.ribS;
      const c = Math.cos(phi), sn = Math.sin(phi);
      const w = ripple ? ring.ribWidth : lerp(RINGS.stackWidth, markWidth(phi, tilt), a);
      const hw = w / 2, rc = Math.min(hw, ht);
      const rx = ca * c, ry = ca * sn, rz = sa;     // across the band
      const zx = -sa * c, zy = -sa * sn, zz = ca;   // through the band
      const ox = radius * c, oy = radius * sn, oz = hgt;
      const g = (ring.ribSeg + s) * 3;
      cen[g] = e[0] * ox + e[4] * oy + e[8] * oz + e[12];
      cen[g + 1] = e[1] * ox + e[5] * oy + e[9] * oz + e[13];
      cen[g + 2] = e[2] * ox + e[6] * oy + e[10] * oz + e[14];
      for (let k = 0; k < P; k++) {
        const q = pr[k];
        const lx = q.sx * (hw - rc) + rc * q.c, ly = q.sy * (ht - rc) + rc * q.s;
        const px = ox + lx * rx + ly * zx, py = oy + lx * ry + ly * zy, pz = oz + lx * rz + ly * zz;
        const nx = q.c * rx + q.s * zx, ny = q.c * ry + q.s * zy, nz = q.c * rz + q.s * zz;
        pos[v] = e[0] * px + e[4] * py + e[8] * pz + e[12];
        pos[v + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13];
        pos[v + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
        nor[v] = e[0] * nx + e[4] * ny + e[8] * nz;
        nor[v + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
        nor[v + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
        v += 3;
      }
    }
  }

  // Order the ribbon's triangles back to front for a camera at world
  // position camPos (call after update): segments by distance, and within
  // each segment the faces turned away from the camera first, so clear
  // glass shows its far surface through the near one.
  sortRibbon(camPos) {
    const mesh = this.ribbonMesh;
    if (!mesh || !mesh.visible) return;
    this.group.updateMatrixWorld(true);
    const cam = this._v.copy(camPos).applyMatrix4(this._inv.copy(this.inner.matrixWorld).invert());
    const cx = cam.x, cy = cam.y, cz = cam.z;
    const { ribCen: cen, ribNor: nor, ribKeys: keys, ribOrder: order, ribIndex: idx, segRing } = this;
    const P = this.profile.length;
    const nSeg = keys.length;
    for (let g = 0; g < nSeg; g++) {
      const dx = cen[3 * g] - cx, dy = cen[3 * g + 1] - cy, dz = cen[3 * g + 2] - cz;
      keys[g] = dx * dx + dy * dy + dz * dz;
      order[g] = g;
    }
    order.sort((x, y) => keys[y] - keys[x] || x - y);
    let o = 0;
    for (let i = 0; i < nSeg; i++) {
      const g = order[i];
      const ring = segRing[g];
      const s = g - ring.ribSeg;
      const a0 = ring.ribBase + s * P, b0 = ring.ribBase + ((s + 1) % ring.ribS) * P;
      const vx = cx - cen[3 * g], vy = cy - cen[3 * g + 1], vz = cz - cen[3 * g + 2];
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < P; k++) {
          const k1 = (k + 1) % P;
          const ia = (a0 + k) * 3, ib = (a0 + k1) * 3;
          const d = (nor[ia] + nor[ib]) * vx + (nor[ia + 1] + nor[ib + 1]) * vy + (nor[ia + 2] + nor[ib + 2]) * vz;
          if ((d >= 0) !== (pass === 1)) continue;
          const A = a0 + k, B = a0 + k1, C = b0 + k1, D = b0 + k;
          idx[o++] = A; idx[o++] = D; idx[o++] = C;
          idx[o++] = A; idx[o++] = C; idx[o++] = B;
        }
      }
    }
    mesh.geometry.index.needsUpdate = true;
  }

  // Materials, fades and placement from the recipe.
  applyLook(p) {
    const rg = p.rings;
    const count = THREE.MathUtils.clamp(Math.round(rg.count) || 1, 1, RINGS.maxCount);
    const surface = rg.surface === 'ribbon' ? 'ribbon' : 'tiles';
    const key = rg.layout === 'ripple' ? `ripple:0:${surface}` : `${rg.layout}:${count}:${surface}`;
    if (key !== this.built) this._build(rg.layout, rg.layout === 'ripple' ? 0 : count, surface);
    this.layout = rg.layout;
    this.surface = surface;
    const g = p.glass;
    if (this.ribbonMesh) {
      const rb = p.ribbon;
      const mat = this.ribbonMesh.material;
      mat.color.set(rb.color);
      mat.opacity = rb.opacity;
      mat.envMapIntensity = g.reflections;
      mat.clearcoat = 1;
      mat.clearcoatRoughness = g.glintSoftness;
      mat.iridescence = 0.6 * rb.iridescence;
      mat.sheen = g.edgeTintAmount;
      mat.sheenColor.set(g.edgeTint);
      mat.sheenRoughness = 0.45;
      this.uniforms.edgeShine.value = rb.edge;
      this.uniforms.spectrum.value = rb.iridescence;
    }
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
    // World band width at angle th (from the hinge) for a ring tilted
    // `tilt` degrees: the logo's stroke divided by the ring's foreshortening.
    const markWidth = (th, tilt) => {
      const c = Math.cos(th), s = Math.sin(th), ct = Math.cos(deg(tilt));
      const stroke = RINGS.strokeTop + (RINGS.strokeSide - RINGS.strokeTop) * Math.pow(Math.abs(c), RINGS.strokePower);
      return stroke / Math.max(0.3, Math.sqrt(c * c + s * s * ct * ct));
    };

    // Ripple surface (height and slope at radius r).
    const k = TAU / Math.max(0.2, rg.waveLength);
    const ph = TAU * cycles * u;
    const ripple = (r) => {
      const a = rg.wave * THREE.MathUtils.smoothstep(r, 0, 2.5);
      return [a * Math.sin(k * r - ph), a * k * Math.cos(k * r - ph)];
    };

    const ribbonOn = !!this.ribbonMesh;
    const thick = THREE.MathUtils.clamp(rg.ribbonThickness ?? 0.05, 0.005, 0.5);

    const n = this.rings.length;
    let meanA = 0;
    for (const ring of this.rings) {
      const { inst, pivot, tiles, rows, index } = ring;
      const dTheta = TAU / tiles;
      let turn = 0;           // in-plane rotation of the tile flow
      let a = 1;              // 0 stacked / drifting, 1 the mark
      let radius = ring.radius;
      let tiltNow = 0;

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
        tiltNow = markTiltNow;
        pivot.position.set(sx, sy * (1 - a), sz);
        pivot.rotation.set(deg(lerp(sign * 90, markTiltNow, a)), 0, roll);
        radius = lerp(ring.stackRadius, R, a);
      }

      // The ribbon follows the same pose. The tiles stay posed (hidden) so
      // focus, clearance and Generate new work the same on either surface.
      inst.visible = !ribbonOn;
      if (ribbonOn) this._poseRibbon(ring, radius, a, tiltNow, ripple, markWidth, thick);

      const tScale = radius / ring.radius;   // tangential stretch keeps the tiles closed up
      let i = 0;
      for (let kTile = 0; kTile < tiles; kTile++) {
        const th = kTile * dTheta + turn;
        const w = this.layout === 'ripple' ? ring.tileWidth : lerp(RINGS.stackWidth, markWidth(th, tiltNow), a);
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
    if (ribbonOn) {
      this.ribbonMesh.geometry.attributes.position.needsUpdate = true;
      this.ribbonMesh.geometry.attributes.normal.needsUpdate = true;
    }

    // The stack leans towards the camera to show its layers, and stands
    // upright as it becomes the mark.
    this.markAmount = this.layout === 'ripple' ? 1 : meanA / n;
    if (this.layout === 'stack') this.inner.rotation.set(deg(RINGS.stackViewTilt * (1 - this.markAmount)), 0, 0);
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
