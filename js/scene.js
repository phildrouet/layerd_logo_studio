// Three.js scene: the glass rings over a drifting noise gradient, lit by a
// soft studio environment plus two directional lights for sharp glints.
// applyParams poses everything for a recipe at loop phase u in [0, 1).

import * as THREE from 'three';
import { Rings } from './rings.js';
import { StudioEnvironment } from './studio_env.js';
import { Background } from './background.js';

// The background clock at loop phase u: it swings forwards and back around
// its start time, so it is periodic in u. The rings themselves turn whole
// revolutions and drift and waves run whole cycles per loop (see rings.js),
// so u = 0 and u = 1 are the same frame.
export function clocks(p, u) {
  const P = p.loop.duration;
  return {
    time: p.phase.time + (p.loop.swing * P / (2 * Math.PI)) * Math.sin(2 * Math.PI * u),
  };
}

export class LogoScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);

    this.background = new Background();
    this.scene.add(this.background.mesh);

    this.rings = new Rings();
    this.scene.add(this.rings.group);

    this.studio = new StudioEnvironment();

    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.3);
    this.keyLight.position.set(-4, 5, 3);
    this.rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
    this.rimLight.position.set(5, -2, 4);
    this.scene.add(this.keyLight, this.rimLight);

    this._eye = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._yUp = new THREE.Vector3(0, 1, 0);
    this._m = new THREE.Matrix4();
  }

  applyParams(renderer, p, u) {
    const { time } = clocks(p, u);
    this.studio.apply(renderer, this.scene, p);
    this.background.apply(p, time);
    this.rings.applyLook(p);
    this.rings.update(p, u);
    this.keyLight.color.set(p.sun.key.color);
    this.keyLight.intensity = p.sun.key.intensity;
    this.rimLight.color.set(p.sun.rim.color);
    this.rimLight.intensity = p.sun.rim.intensity;
  }

  // Base camera pose (before depth-of-field jitter): on the axis at the given
  // height and distance, looking down at (0, lookAtY, 0).
  cameraBase(p) {
    const pos = new THREE.Vector3(0, p.camera.height, p.camera.distance);
    this._m.lookAt(pos, this._target.set(0, p.camera.lookAtY, 0), this._yUp);
    const quat = new THREE.Quaternion().setFromRotationMatrix(this._m);
    return { pos, quat };
  }

  // View depth of the visible rings at the centre of the frame (call after
  // applyParams): the tile nearest the screen centre, ignoring points
  // already dissolved by the distance fade.
  focusDistance(p, aspect) {
    const { pos, quat } = this.cameraBase(p);
    const inv = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)).invert();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(p.camera.fov) / 2);
    let best = Infinity, depth = p.optics.focus;
    const v = new THREE.Vector3();
    // The mark and the sphere are objects with an open middle: the tile
    // nearest the frame centre is often on the far side, so focus on the
    // object's centre plane instead.
    if (p.rings.layout !== 'ripple') return -v.set(0, 0, 0).applyMatrix4(inv).z;
    this.rings.forEachWorldPoint((w) => {
      v.copy(w).applyMatrix4(inv);
      const d = -v.z;
      if (d <= 0.2 || d > p.rings.fadeFar) return;
      const nx = v.x / d / (tanHalf * aspect), ny = v.y / d / tanHalf;
      const r = nx * nx + ny * ny;
      if (r < best) { best = r; depth = d; }
    });
    return depth;
  }

  // Smallest distance from the camera to the posed rings (call after applyParams).
  clearance(p) {
    const { pos } = this.cameraBase(p);
    let best = Infinity;
    this.rings.forEachWorldPoint((w) => { best = Math.min(best, w.distanceTo(pos)); });
    return best;
  }
}
