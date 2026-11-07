// Tracks in the snow: whatever walks over snowy ground (the deer, for now) leaves a line of slots
// behind it, pressed blue-grey into the white, that slowly fill in again. Drawn only, not simulated;
// the hunters' easier tracking in winter is the simulation's side of the same thing.
import * as THREE from 'three';
import { addCommon } from './shaderlib';
import { U } from './env';

/** How many prints are kept at once (the oldest go first), and how long one lasts (game-paced seconds). */
const MAX = 3000;
const LIFE = 150;
/** Snow cover below which no prints are left (and old ones fade with it). */
const SNOW_FROM = 0.3;

/** A cloven hoof's slot: two narrow teardrops side by side, toes forward (+z), lying flat. */
function hoofGeometry() {
  const pos: number[] = [], idx: number[] = [];
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    const cx = side * 0.0105;
    pos.push(cx, 0, 0);
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      // pointed at the toe, rounded at the heel, the inner edge straight
      const rz = Math.cos(a) > 0 ? 0.03 : 0.018;
      let rx = 0.0085 * (1 - 0.35 * Math.max(0, Math.cos(a)));
      if (Math.sign(Math.sin(a)) === -side) rx *= 0.6;
      pos.push(cx + Math.sin(a) * rx, 0, Math.cos(a) * rz);
    }
    for (let k = 0; k < n; k++) idx.push(base, base + 1 + ((k + 1) % n), base + 1 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export class TrackLayer {
  readonly mesh: THREE.InstancedMesh;
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private a = new Float32Array(MAX);
  private s = new Float32Array(MAX);
  private age = new Float32Array(MAX).fill(LIFE);
  private next = 0;
  private alpha: THREE.InstancedBufferAttribute;

  constructor() {
    const g = hoofGeometry();
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    g.setAttribute('iAlpha', this.alpha);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.36, 0.43, 0.58), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    mat.customProgramCacheKey = () => 'tracks';
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = iAlpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;');
    };
    this.mesh = new THREE.InstancedMesh(g, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Whether snow lies deep enough to take a print. */
  get snowy() {
    return U.uSnow.value > SNOW_FROM;
  }

  /** Press a print at a spot, facing `angle` (radians about up, 0 = +z), scaled for the animal's size. */
  press(x: number, y: number, z: number, angle: number, size: number) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.a[i] = angle;
    this.s[i] = size;
    this.age[i] = 0;
  }

  /** Age the prints by game-paced time and lay them out; they fill in over time, and melt with the snow. */
  update(dt: number) {
    const snow = Math.min(1, Math.max(0, (U.uSnow.value - SNOW_FROM) / 0.3));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= LIFE) continue;
      this.age[i] += dt;
      const k = this.age[i] / LIFE;
      if (k >= 1 || snow <= 0) {
        this.age[i] = LIFE;
        continue;
      }
      // fresh prints are sharp and dark, then soften and fill in with drifting snow
      const fade = (1 - k) * (1 - k) * snow;
      q.setFromAxisAngle(up, this.a[i]);
      const grow = this.s[i] * (1 + k * 0.4);
      m4.compose(p.set(this.x[i], this.y[i], this.z[i]), q, sc.set(grow, 1, grow));
      this.mesh.setMatrixAt(n, m4);
      this.alpha.setX(n, 0.8 * fade);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
