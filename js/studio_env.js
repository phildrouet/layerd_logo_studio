// Reflection environment: a synthetic studio of soft coloured lights around
// the rings. Each light is a plane with a radial alpha falloff, so the glass
// mirrors a feathered pool of colour rather than a hard-edged panel. Baked to
// a PMREM cube for the physical material; re-baked only when the lights change.

import * as THREE from 'three';

// Placement of the seven studio lights (colour and strength come from the recipe).
export const STUDIO_LIGHTS = [
  { key: 'key',      w: 10, h: 3.5, pos: [-6, 5, 4] },
  { key: 'kicker',   w: 11, h: 5,   pos: [7, -2, 5] },
  { key: 'pool',     w: 7,  h: 7,   pos: [1, 6, -4] },
  { key: 'overhead', w: 20, h: 20,  pos: [-3, 8, -1] },
  { key: 'bounce',   w: 8,  h: 8,   pos: [4, -7, -2] },
  { key: 'backdrop', w: 14, h: 14,  pos: [0, 0, -12] },
  { key: 'sideBand', w: 4,  h: 14,  pos: [-9, -1, -3] },
];

export class StudioEnvironment {
  constructor() {
    this.env = new THREE.Scene();
    this.wash = new THREE.Mesh(
      new THREE.SphereGeometry(30, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    this.env.add(this.wash);

    // Shared radial falloff: opaque centre to transparent rim.
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const glow = new THREE.CanvasTexture(cv);

    this.lights = STUDIO_LIGHTS.map((def) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(def.w, def.h),
        new THREE.MeshBasicMaterial({ map: glow, transparent: true, side: THREE.DoubleSide }));
      mesh.position.fromArray(def.pos);
      mesh.lookAt(0, 0, 0);
      this.env.add(mesh);
      return { key: def.key, mesh };
    });

    this._pmrem = null;
    this._target = null;
    this._bakedKey = null;
  }

  // Colours are linear HDR: the hex colour scaled by its intensity.
  apply(renderer, scene, p) {
    const key = JSON.stringify([p.wash, p.lights]);
    if (key === this._bakedKey) return;
    this._bakedKey = key;
    this.wash.material.color.set(p.wash.hex).multiplyScalar(p.wash.intensity);
    for (const { key: name, mesh } of this.lights) {
      const L = p.lights[name];
      mesh.material.color.set(L.hex).multiplyScalar(L.intensity);
      mesh.material.opacity = L.opacity;
    }
    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(renderer);
    const next = this._pmrem.fromScene(this.env, 0.02);
    this._target?.dispose();
    this._target = next;
    scene.environment = next.texture;
  }
}
