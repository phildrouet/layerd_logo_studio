// Background: a slowly drifting, domain-warped noise gradient on a large
// back-facing sphere. It is part of the scene (not a screen-space layer), so
// it stays consistent under depth-of-field jitter and tiled rendering.

import * as THREE from 'three';

const OCTAVES = 3;   // fewer octaves = softer, less veiny
const SPEED = 0.05;  // gradient drift per unit of shape time

export class Background {
  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uBright: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uDark: { value: new THREE.Color() },
      uScale: { value: 1.1 },
      uSpeed: { value: SPEED },
      uWarp: { value: 2 },
      uBrightAmt: { value: 0.9 },
      uVignette: { value: 0.5 },
    };
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: this.uniforms,
      defines: { OCTAVES },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vDir;
        uniform float uTime, uScale, uSpeed, uWarp, uBrightAmt, uVignette;
        uniform vec3 uBright, uDark, uMid;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
          for (int i = 0; i < OCTAVES; i++) {
            v += a * noise(p);
            p = rot * p * 1.9 + 11.7;
            a *= 0.55;
          }
          return v;
        }

        void main() {
          // Flatten the view direction into a plane so the gradient reads as a
          // 2D wash behind the rings rather than a textured sphere.
          vec2 p = (vDir.xy / (1.0 + vDir.z * 0.35)) * uScale;
          float t = uTime * uSpeed;
          vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.8));
          vec2 r = vec2(fbm(p + uWarp * q + vec2(1.7, 9.2) + t * 1.3),
                        fbm(p + uWarp * q + vec2(8.3, 2.8) - t * 1.1));
          float f = fbm(p + uWarp * r);
          // dark -> mid across the body of the noise, bright where the warp folds
          vec3 col = mix(uDark, uMid, smoothstep(0.28, 0.62, f));
          float glow = smoothstep(0.46, 0.72, f) * smoothstep(0.25, 0.65, r.x);
          col = mix(col, uBright, glow * uBrightAmt);
          float edge = length(vDir.xy);
          col *= 1.0 - uVignette * smoothstep(0.35, 1.0, edge);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 32), material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  apply(p, t) {
    const b = p.background, u = this.uniforms;
    u.uTime.value = t;
    u.uBright.value.set(b.bright);
    u.uMid.value.set(b.mid);
    u.uDark.value.set(b.dark);
    u.uScale.value = b.scale;
    u.uWarp.value = b.warp;
    u.uBrightAmt.value = b.brightAmount;
    u.uVignette.value = b.vignette;
  }
}
