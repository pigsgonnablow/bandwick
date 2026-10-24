// Falling snow around the camera during winter storms.
import * as THREE from 'three';

export class Snowfall {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor(count = 3000) {
    const pos = new Float32Array(count * 3);
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) pos.set([rnd(), rnd(), rnd()], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector3(60, 14, 60) },
        uAmount: { value: 0 },
        uPx: { value: 3 },
        uLight: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uSize;
        uniform float uAmount;
        uniform float uPx;
        varying float vA;
        void main() {
          vec3 p = position;
          float speed = 0.06 + 0.05 * fract(p.x * 17.31);
          p.y = fract(p.y - uTime * speed);
          p.x = fract(p.x + sin(uTime * 0.7 + p.z * 31.0) * 0.004 + uTime * 0.004);
          vec3 w = uCenter + (p - vec3(0.5, 0.15, 0.5)) * uSize;
          vA = step(fract(position.z * 91.7 + position.x * 13.1), uAmount);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          gl_PointSize = uPx * (0.7 + 0.6 * fract(position.y * 53.0));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying float vA;
        void main() {
          if (vA < 0.5) discard;
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.15, length(d));
          gl_FragColor = vec4(uLight, a * 0.9);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  update(time: number, center: THREE.Vector3, zoom: number, amount: number, pixelRatio: number, light: THREE.Color) {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uCenter.value.copy(center);
    u.uSize.value.set(zoom * 1.9, Math.max(10, zoom * 0.35), zoom * 1.9);
    u.uAmount.value = amount;
    u.uPx.value = Math.min(5, Math.max(1.6, 140 / zoom)) * pixelRatio;
    u.uLight.value.copy(light);
    this.points.visible = amount > 0.01;
  }
}
