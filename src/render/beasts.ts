// The smaller wild things, drawn from the simulation: wild boar rooting through the woods (striped piglets at
// the sows' heels), red foxes trotting their rounds, mousing in the grass with a stiff-legged pounce and curled
// up by their earths through the day, and beavers swimming low in the water with a wake behind, waddling up
// the bank to sit up and gnaw round a birch, and diving with a slap of the tail when anyone comes near; and
// the lodges and dams the beavers build.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BEAST, BOAR, FOX, BEAVER } from '../sim/band';
import { STEP, WATER } from '../sim/types';
import { addCommon } from './shaderlib';
import type { TrackLayer } from './tracks';

const STRIDE = 7, DEN_STRIDE = 5;
const WORLD_NONE = WATER.None;
/** Poses the shader knows (the same for every kind). */
const P = { Stand: 0, Walk: 1, Run: 2, Nose: 3, Lie: 4, Crouch: 5, Charge: 6, Gnaw: 7, Swim: 8, Curl: 9 } as const;

interface Kind {
  name: string;
  /** stride lengths at the walk and the run (tiles, grown), the pace a walk turns into a run, and half the body's length */
  walk: number; run: number; runFrom: number; runFull: number; half: number;
  /** how big the grown and the young are drawn */
  size: number; young: number;
  /** the size of a print in the snow (0: none) */
  print: number;
}
const KINDS: Kind[] = [
  { name: 'boar', walk: 0.16, run: 0.42, runFrom: 0.9, runFull: 2.0, half: 0.07, size: 1, young: 0.5, print: 0.85 },
  { name: 'fox', walk: 0.17, run: 0.42, runFrom: 1.0, runFull: 2.2, half: 0.048, size: 1, young: 0.55, print: 0.5 },
  { name: 'beaver', walk: 0.07, run: 0.12, runFrom: 0.6, runFull: 1.2, half: 0.05, size: 1.6, young: 1.0, print: 0 },
];

interface Shown {
  kind: number;
  x: number; z: number; sx: number; sz: number; t0: number; dur: number; movedAt: number;
  dx: number; dz: number; yf: number; yb: number; y: number; pitch: number;
  angle: number; want: number; phase: number; gait: number; moving: number;
  state: number; young: boolean; seen: number;
  sit: number; lie: number;
  trail: number; foot: number;
  /** a beaver's tail slap (1 fresh, fading), when it last left a ring on the water, and whether it is in the water */
  slap: number; wake: number; wet: boolean;
  /** when it last threw up earth (rooting) or chips (gnawing) */
  spray: number;
}

export interface Spray { (x: number, y: number, z: number, n: number, rgb: [number, number, number], up: number): void }
export interface Mark { (x: number, z: number, y: number, size: number, drops: number): void }

export class BeastLayer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private lodges: THREE.InstancedMesh;
  private dams: THREE.InstancedMesh;
  private shown = new Map<number, Shown>();
  private dens = new Float32Array(0);
  /** the beasts on screen, for clicking and for the camera */
  visible: { id: number; kind: number; x: number; y: number; z: number; young: boolean; state: number }[] = [];

  constructor(
    geoms: Map<string, THREE.BufferGeometry>,
    private world: { size: number; water: Uint8Array; waterY: Float32Array },
    private groundAt: (x: number, z: number) => number,
    private tracks: TrackLayer,
    private mark: Mark,
    private spray: Spray,
  ) {
    this.meshes = [
      this.makeMesh(geoms, 'boar', 160, {
        parts: [['body', 0, [0, 0, 0]], ['head', 1, [0, 0.130, 0.095]], ['tail', 3, [0, 0.128, -0.118]], ['legFL', 4, [-0.028, 0.098, 0.070]],
          ['legFR', 5, [0.028, 0.098, 0.070]], ['legBL', 6, [-0.028, 0.104, -0.076]], ['legBR', 7, [0.028, 0.104, -0.076]], ['stripes', 8, [0, 0, 0]]],
        hip: [0, 0.104, -0.076], poll: [0, 0.14, 0.11], pollFrom: 9, jaw: [0, 0, 0], sit: 0.4, lieDrop: 0.052, sitDrop: 0.03, stand: 0.09,
      }),
      this.makeMesh(geoms, 'fox', 64, {
        parts: [['body', 0, s7([0, 0, 0])], ['head', 1, s7([0, 0.165, 0.080])], ['jaw', 2, s7([0, 0.165, 0.080])], ['tail', 3, s7([0, 0.170, -0.104])],
          ['legFL', 4, s7([-0.021, 0.163, 0.066])], ['legFR', 5, s7([0.021, 0.163, 0.066])], ['legBL', 6, s7([-0.021, 0.168, -0.068])], ['legBR', 7, s7([0.021, 0.168, -0.068])]],
        hip: s7([0, 0.168, -0.068]), poll: s7([0, 0.205, 0.113]), pollFrom: 0.105 * 0.7, jaw: s7([0, 0.198, 0.141]), sit: 0.55, lieDrop: 0.118 * 0.7, sitDrop: 0.045 * 0.7, stand: 0.16 * 0.7,
      }),
      this.makeMesh(geoms, 'beaver', 64, {
        parts: [['body', 0, [0, 0, 0]], ['head', 1, [0, 0.044, 0.040]], ['tail', 3, [0, 0.026, -0.062]], ['legFL', 4, [-0.019, 0.028, 0.030]],
          ['legFR', 5, [0.019, 0.028, 0.030]], ['legBL', 6, [-0.026, 0.034, -0.030]], ['legBR', 7, [0.026, 0.034, -0.030]]],
        hip: [0, 0.018, -0.026], poll: [0, 0.05, 0.06], pollFrom: 9, jaw: [0, 0, 0], sit: 1.15, lieDrop: 0.008, sitDrop: -0.004, stand: 0.03,
      }),
    ];
    const plain = (key: string) => {
      const m = new THREE.MeshLambertMaterial({ vertexColors: true });
      m.onBeforeCompile = (sh) => addCommon(sh);
      m.customProgramCacheKey = () => key;
      return m;
    };
    this.lodges = new THREE.InstancedMesh(geoms.get('lodge__beaver') ?? new THREE.BufferGeometry(), plain('lodge'), 8);
    this.dams = new THREE.InstancedMesh(geoms.get('dam__beaver') ?? new THREE.BufferGeometry(), plain('dam'), 8);
    for (const m of [this.lodges, this.dams]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = true;
    }
    this.group.add(...this.meshes, this.lodges, this.dams);
  }

  /** A new frame of beasts from the simulation (moved every other tick), and the lodges and dams. */
  setBeasts(B: Float32Array, dens: Float32Array, now: number, tickMs: number, seen: number) {
    for (let o = 0; o < B.length; o += STRIDE) {
      const kind = B[o], id = B[o + 1], nx = B[o + 2], nz = B[o + 3];
      let b = this.shown.get(id);
      if (!b) {
        const gy = this.groundAt(nx, nz);
        b = { kind, x: nx, z: nz, sx: nx, sz: nz, t0: now, dur: tickMs * 2, movedAt: 0, dx: nx, dz: nz, yf: gy, yb: gy, y: gy, pitch: 0,
          angle: Math.random() * 6.28, want: 0, phase: Math.random(), gait: 0, moving: 0, state: -1, young: false, seen, sit: 0, lie: 0,
          trail: 0, foot: 0, slap: 0, wake: 0, wet: false, spray: 0 };
        this.shown.set(id, b);
      } else if (Math.abs(nx - b.x) + Math.abs(nz - b.z) > 1e-5) {
        const t = Math.min(1, (now - b.t0) / b.dur);
        b.sx += (b.x - b.sx) * t;
        b.sz += (b.z - b.sz) * t;
        const gap = now - b.movedAt;
        b.dur = gap < 1200 ? Math.min(900, Math.max(16, b.dur * 0.5 + gap * 0.5)) : tickMs * 2;
        b.t0 = now;
        b.movedAt = now;
        b.x = nx;
        b.z = nz;
      }
      const fx = B[o + 4] - nx, fz = B[o + 5] - nz;
      if (fx * fx + fz * fz > 1e-4) b.want = Math.atan2(fx, fz);
      const st = B[o + 6] % 10;
      // a beaver diving: a slap of the tail on the water
      if (kind === BEAST.Beaver && st === BEAVER.Dive && b.state !== BEAVER.Dive && b.state >= 0) b.slap = 1;
      b.state = st;
      b.young = B[o + 6] >= 10;
      b.seen = seen;
    }
    for (const [id, b] of this.shown) if (b.seen !== seen) this.shown.delete(id);
    this.dens = dens;
  }

  /** Where a beaver swims: low in the water, only its head and back showing (null: not in water). */
  private waterAt(x: number, z: number) {
    const N = this.world.size, tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= N || tz >= N) return null;
    const i = tz * N + tx;
    return this.world.water[i] === WORLD_NONE ? null : this.world.waterY[i];
  }

  /** Per render frame: `dt` real seconds, `cam` the middle of the view (effects only near it). */
  update(dt: number, now: number, follow: number, cam: THREE.Vector3) {
    const n = [0, 0, 0];
    this.visible.length = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (const [id, b] of this.shown) {
      const K = KINDS[b.kind];
      const t = Math.min(1, (now - b.t0) / b.dur);
      const tx = b.sx + (b.x - b.sx) * t, tz = b.sz + (b.z - b.sz) * t;
      const ox = b.dx, oz = b.dz;
      if (Math.abs(tx - b.dx) + Math.abs(tz - b.dz) > 1.5) { b.dx = tx; b.dz = tz; }
      else { b.dx += (tx - b.dx) * follow; b.dz += (tz - b.dz) * follow; }
      const size = (b.young ? K.young : K.size);
      const near = Math.hypot(b.dx - cam.x, b.dz - cam.z) < 26;
      // a beaver in its lodge is out of sight
      if (b.kind === BEAST.Beaver && b.state === BEAVER.Home) continue;
      const moved = this.stride(b, K, ox, oz, dt, size);
      // the pose
      let pose: number = P.Stand, sit = 0, lie = 0, flag = 0;
      if (b.kind === BEAST.Boar) {
        pose = b.state === BOAR.Root ? P.Nose : b.state === BOAR.Lie ? P.Lie : b.state === BOAR.Charge ? P.Charge : b.moving > 0.1 ? P.Walk : P.Stand;
        lie = b.state === BOAR.Lie ? 1 : 0;
        flag = b.young ? 1 : 0;
        // rooting turns the earth over: a spurt of it now and then
        if (b.state === BOAR.Root && near && now > b.spray) {
          b.spray = now + 900 + Math.random() * 1800;
          const hx = b.dx + Math.sin(b.angle) * 0.17 * size, hz = b.dz + Math.cos(b.angle) * 0.17 * size;
          this.spray(hx, this.groundAt(hx, hz) + 0.01, hz, 3, [0.32, 0.24, 0.17], 0.35);
        }
      } else if (b.kind === BEAST.Fox) {
        pose = b.state === FOX.Mouse ? P.Crouch : b.state === FOX.Curl ? P.Curl : b.state === FOX.Raid ? P.Nose : b.moving > 0.1 ? P.Walk : P.Stand;
        sit = b.state === FOX.Sit && b.moving < 0.1 ? 1 : 0;
        lie = b.state === FOX.Curl && b.moving < 0.1 ? 1 : 0;
      } else {
        const wy = this.waterAt(b.dx, b.dz);
        b.wet = wy !== null && wy - this.groundAt(b.dx, b.dz) > 0.02;
        pose = b.wet ? P.Swim : b.state === BEAVER.Gnaw ? P.Gnaw : b.moving > 0.1 ? P.Walk : P.Stand;
        sit = b.state === BEAVER.Gnaw ? 1 : b.state === BEAVER.Sit && !b.wet ? 0.45 : 0;
        if (b.wet) b.y = wy! - 0.032 * size;
        b.slap = Math.max(0, b.slap - dt * 2.2);
        flag = b.slap;
        if (near && b.slap > 0.75 && b.wet && b.wake >= 0) {
          this.mark(b.dx - Math.sin(b.angle) * 0.1, b.dz - Math.cos(b.angle) * 0.1, wy!, 0.45, 7);
          b.wake = -1;
        }
        if (b.slap < 0.5 && b.wake < 0) b.wake = 0;
        // a V of ripples behind a swimming beaver, and chips flying from the trunk it gnaws
        if (b.wet && near && moved > 0.0005 && now > b.wake && b.wake >= 0) {
          b.wake = now + 650;
          this.mark(b.dx - Math.sin(b.angle) * 0.06, b.dz - Math.cos(b.angle) * 0.06, wy!, 0.16, 0);
        }
        if (b.state === BEAVER.Gnaw && near && now > b.spray) {
          b.spray = now + 500 + Math.random() * 700;
          const hx = b.dx + Math.sin(b.angle) * 0.08, hz = b.dz + Math.cos(b.angle) * 0.08;
          this.spray(hx, this.groundAt(hx, hz) + 0.1, hz, 2, [0.86, 0.76, 0.56], 0.25);
        }
      }
      const kk = 1 - Math.exp(-dt * 3);
      b.sit += (sit - b.sit) * kk;
      b.lie += (lie - b.lie) * kk;
      const mesh = this.meshes[b.kind];
      const i = n[b.kind];
      if (i >= mesh.instanceMatrix.count) continue;
      n[b.kind]++;
      q.setFromAxisAngle(up, b.angle).multiply(pq.setFromAxisAngle(xAxis, b.wet ? 0 : -b.pitch * (1 - b.lie)));
      mesh.setMatrixAt(i, m4.compose(pos.set(b.dx, b.y, b.dz), q, scl.set(size, size, size)));
      (mesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute).setXYZW(i, pose, (id % 97) * 0.61, flag, b.sit);
      (mesh.geometry.attributes.iAnim2 as THREE.InstancedBufferAttribute).setXYZW(i, b.phase, b.gait, b.moving, b.lie);
      this.visible.push({ id, kind: b.kind, x: b.dx, y: b.y + 0.06 * size, z: b.dz, young: b.young, state: b.state });
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = n[k];
      mesh.instanceMatrix.needsUpdate = true;
      (mesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute).needsUpdate = true;
      (mesh.geometry.attributes.iAnim2 as THREE.InstancedBufferAttribute).needsUpdate = true;
    });
    this.drawDens();
  }

  /** The lodge in the water against the bank, and the dam across the river (as far as it is built). */
  private drawDens() {
    const D = this.dens, N = this.world.size;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let nl = 0, nd = 0;
    for (let o = 0; o < D.length; o += DEN_STRIDE) {
      const x = D[o + 1], z = D[o + 2], dam = D[o + 3], built = D[o + 4];
      const wy = this.waterAt(x, z) ?? this.groundAt(x, z);
      if (nl < this.lodges.instanceMatrix.count) {
        q.setFromAxisAngle(up, ((Math.floor(x * 13) * 7 + Math.floor(z * 11)) % 628) / 100);
        this.lodges.setMatrixAt(nl++, m4.compose(new THREE.Vector3(x, wy, z), q, new THREE.Vector3(1, 1, 1)));
      }
      if (dam >= 0 && built > 0.05 && nd < this.dams.instanceMatrix.count) {
        const dx = (dam % N) + 0.5, dz = Math.floor(dam / N) + 0.5;
        const w = this.world.water;
        // laid from bank to bank: along x where the land is to the east and west, else along z
        const ew = w[dam - 1] === WORLD_NONE && w[dam + 1] === WORLD_NONE;
        q.setFromAxisAngle(up, ew ? 0 : Math.PI / 2);
        const dy = this.waterAt(dx, dz) ?? this.groundAt(dx, dz);
        const k = Math.min(1, built);
        this.dams.setMatrixAt(nd++, m4.compose(new THREE.Vector3(dx, dy + 0.03 * k, dz), q, new THREE.Vector3(0.35 + 0.65 * k, 0.4 + 0.6 * k, 1)));
      }
    }
    this.lodges.count = nl;
    this.dams.count = nd;
    this.lodges.instanceMatrix.needsUpdate = true;
    this.dams.instanceMatrix.needsUpdate = true;
  }

  /** Legs that step with the ground covered, the walk breaking into a run, the body on its footing, prints in snow. */
  private stride(b: Shown, K: Kind, ox: number, oz: number, dt: number, size: number) {
    const moved = Math.hypot(b.dx - ox, b.dz - oz);
    const speed = dt > 0 ? moved / dt / size : 0;
    const k = 1 - Math.exp(-dt * 6);
    b.moving += (Math.min(1, speed / 0.25) - b.moving) * k;
    const g = Math.min(1, Math.max(0, (speed - K.runFrom) / (K.runFull - K.runFrom)));
    b.gait += (g * g * (3 - 2 * g) - b.gait) * k;
    const stride = (K.walk + (K.run - K.walk) * b.gait) * size;
    if (moved > 0) b.phase = (b.phase + Math.min(moved / stride, 7 * dt)) % 1;
    const want = moved > 0.0015 * dt * 60 ? Math.atan2(b.dx - ox, b.dz - oz) : b.want;
    let turn = want - b.angle;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    b.angle += turn * (1 - Math.exp(-dt * 7));
    const hx = Math.sin(b.angle) * K.half * size, hz = Math.cos(b.angle) * K.half * size;
    const kf = Math.min(1, dt * 16);
    b.yf += (this.groundAt(b.dx + hx, b.dz + hz) - b.yf) * kf;
    b.yb += (this.groundAt(b.dx - hx, b.dz - hz) - b.yb) * kf;
    const rise = b.yf - b.yb;
    const pitchGoal = Math.max(-0.6, Math.min(0.6, Math.atan2(rise, K.half * 2 * size)));
    b.pitch += (pitchGoal - b.pitch) * Math.min(1, dt * 14);
    const leap = Math.min(1, Math.abs(rise) / (STEP * 0.5));
    b.y = (b.yf + b.yb) / 2 + leap * (1 - leap * 0.5) * 0.05 * size;
    if (K.print && this.tracks.snowy && moved > 0 && moved < 1) {
      b.trail += moved;
      const gap = stride * 0.5;
      while (b.trail > gap) {
        b.trail -= gap;
        b.foot = 1 - b.foot;
        const side = (b.foot ? 1 : -1) * 0.02 * size, back = b.trail;
        const px = b.dx + Math.cos(b.angle) * side - Math.sin(b.angle) * back, pz = b.dz - Math.sin(b.angle) * side - Math.cos(b.angle) * back;
        this.tracks.press(px, this.groundAt(px, pz) + 0.003, pz, b.angle, size * K.print);
      }
    }
    return moved;
  }

  private makeMesh(geoms: Map<string, THREE.BufferGeometry>, prefix: string, cap: number, sp: {
    parts: [string, number, number[]][]; hip: number[]; poll: number[]; pollFrom: number; jaw: number[];
    sit: number; lieDrop: number; sitDrop: number; stand: number;
  }) {
    const list: THREE.BufferGeometry[] = [];
    for (const [name, id, pivot] of sp.parts) {
      const g0 = geoms.get(`${prefix}__${name}`);
      if (!g0) continue;
      const g = g0.index ? g0.toNonIndexed() : g0.clone();
      if (g.attributes.aCenter) g.deleteAttribute('aCenter');
      const n = g.attributes.position.count;
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
      const pv = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) pv.set(pivot, k * 3);
      g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
      list.push(g);
    }
    const geo = list.length ? mergeGeometries(list)! : new THREE.BufferGeometry();
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('iAnim2', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const f = (x: number) => x.toFixed(4);
    const v3 = (v: number[]) => `vec3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
    const kind = prefix === 'boar' ? 0 : prefix === 'fox' ? 1 : 2;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => `beast-${prefix}`;
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          attribute vec3 aPivot;
          attribute vec4 iAnim;
          attribute vec4 iAnim2;
          mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
          mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
          void about(mat3 R, vec3 p, inout mat3 M, inout vec3 t) { M = R * M; t = R * t + p - R * p; }
          float is(float st, float k) { return step(k - 0.5, st) * step(st, k + 0.5); }
          // KIND 0 boar, 1 fox, 2 beaver
          void beastPose(out mat3 M, out vec3 t) {
            const float KIND = ${kind}.0;
            float st = iAnim.x, seed = iAnim.y, flag = iAnim.z, sit = iAnim.w;
            float ph = iAnim2.x * 6.2831853, gait = iAnim2.y, mv = iAnim2.z, lie = iAnim2.w;
            float nose = is(st, 3.0), crouch = is(st, 5.0), charge = is(st, 6.0), gnaw = is(st, 7.0), swim = is(st, 8.0), curl = is(st, 9.0);
            float tm = uTime + seed;
            M = mat3(1.0);
            t = vec3(0.0);
            // a piglet's stripes are worn by the young only
            if (aPart > 7.5) { if (flag < 0.5) { M = mat3(0.0); return; } }
            // the fox's pounce: a long crouch, ears forward, then a high stiff-legged leap onto the mouse
            float cyc = fract(tm / 3.4);
            float jump = crouch * smoothstep(0.72, 0.80, cyc) * (1.0 - smoothstep(0.86, 0.95, cyc));
            float arc = crouch * sin(clamp((cyc - 0.72) / 0.22, 0.0, 1.0) * 3.14159);
            float paddleK = swim * (0.6 + 0.4 * mv);
            if (aPart > 3.5 && aPart < 7.5) {
              bool front = aPart < 5.5;
              bool left = aPart < 4.5 || (aPart > 5.5 && aPart < 6.5);
              // a trot (diagonal pairs) into a gallop
              float offT = front ? (left ? 0.0 : 0.5) : (left ? 0.5 : 0.0);
              float offG = front ? (left ? 0.5 : 0.6) : (left ? 0.0 : 0.1);
              float sw = sin(ph + mix(offT, offG, gait) * 6.2831853);
              float a = (sw + 0.2 * sin(2.0 * (ph + mix(offT, offG, gait) * 6.2831853))) * mix(0.42, 0.85, gait) * mv * (1.0 - swim);
              // swimming: the hind feet row, the forepaws held to the chest
              a += paddleK * (front ? -0.9 : sin(tm * 7.0 + (left ? 0.0 : 3.14)) * 0.9 + 0.4);
              // rooting: braced, shoving forward
              a += nose * (KIND < 0.5 ? (front ? -0.18 : 0.12) : (front ? -0.25 : 0.1));
              a += charge * (front ? -0.2 : 0.25);
              // the crouch before the pounce, the forelegs thrown forward in the air, the hind legs trailing
              a += crouch * (1.0 - arc) * (front ? -0.35 : 0.55) + jump * (front ? -1.0 : 0.9);
              // sitting up: forelegs straight (a fox) or lifted to the trunk (a beaver gnawing), hind legs folded
              a += sit * (front ? (KIND > 1.5 ? -0.9 - 0.15 * gnaw * sin(tm * 9.0) : 0.5) : -1.25);
              a = mix(a, front ? -1.45 : -1.3, lie);
              about(rx(a), aPivot, M, t);
            } else if (aPart > 0.5 && aPart < 2.5) {
              float look = (1.0 - mv) * (1.0 - lie) * (1.0 - nose) * (1.0 - crouch) * 0.18 * sin(tm * 0.7);
              // the boar shoves its snout through the leaf litter, nodding and swinging; a fox at a snare tears at the hare
              float root = nose * (KIND < 0.5 ? 0.75 + 0.12 * sin(tm * 6.0) + 0.06 * sin(tm * 13.0) : 0.85 + 0.1 * sin(tm * 9.0));
              float neck = 0.2 * gait * mv + root + 0.3 * charge + crouch * (0.55 - 0.9 * jump) + 0.5 * lie
                + sin(ph * 2.0) * 0.05 * mv * (1.0 - gait) - 0.3 * swim - sit * (KIND > 1.5 ? 0.35 : 0.15);
              look += nose * (KIND < 0.5 ? 0.25 * sin(tm * 2.1) : 0.0) + gnaw * 0.35 * sin(tm * 2.6);
              // a beaver gnaws in quick bites, its head working round the trunk
              neck += gnaw * 0.12 * sin(tm * 15.0);
              // a fox curled up tucks its head round to its flank
              look += curl * 1.9;
              neck += curl * 0.2;
              float tilt = KIND > 0.5 && KIND < 1.5 ? 0.25 * nose + crouch * 0.25 - 0.3 * lie + look * 0.5 : 0.0;
              if (aPart > 1.5) {
                float open = nose * (0.25 + 0.2 * sin(tm * 9.0));
                about(rx(open), ${v3(sp.jaw)}, M, t);
                if (open < 0.03) M = mat3(0.0);
              }
              about(rx(tilt * smoothstep(${f(sp.pollFrom)}, ${f(sp.pollFrom + 0.013)}, position.z)), ${v3(sp.poll)}, M, t);
              about(ry(look), aPivot, M, t);
              about(rx(neck), aPivot, M, t);
            } else if (aPart > 2.5) {
              float lift, sway;
              if (KIND < 0.5) {
                // a boar's tail swishes, and stands straight up when it runs
                lift = -1.4 * gait * mv - 0.6 * charge;
                sway = 0.35 * sin(tm * 5.0) * (1.0 - gait);
              } else if (KIND < 1.5) {
                // the brush carried level, low in the crouch, out straight at the run, wrapped round a curled fox
                lift = -0.25 * gait * mv + 0.25 * crouch - 0.6 * jump + 0.35 * lie;
                sway = 0.12 * sin(tm * 1.2) * (1.0 - crouch) - curl * 1.9;
              } else {
                // the beaver's tail sculls in the water, lies flat behind it sat on the bank, and slaps the water
                lift = swim * (0.2 * sin(tm * 5.0)) * mv - flag * 1.6 * sin(flag * 3.14159) + sit * 1.0;
                sway = swim * 0.25 * sin(tm * 2.5) * mv;
              }
              about(ry(sway), aPivot, M, t);
              about(rx(lift), aPivot, M, t);
            }
            // the whole body: up on the haunches, flat on the ground, low in the crouch, airborne in the pounce
            vec3 hip = ${v3(sp.hip)};
            about(rx(-${f(sp.sit)} * sit), hip, M, t);
            about(rx(0.25 * jump - 0.35 * crouch * smoothstep(0.88, 0.95, cyc) * (1.0 - smoothstep(0.95, 1.0, cyc))), hip, M, t);
            // a fox curled up: round on itself (the body bent about the middle)
            about(ry(curl * 1.1 * clamp(position.z * 10.0, -1.0, 1.0)), vec3(0.0), M, t);
            t.y -= sit * ${f(sp.sitDrop)} + lie * ${f(sp.lieDrop)} + crouch * (1.0 - arc) * ${f(sp.stand * 0.18)} + charge * ${f(sp.stand * 0.06)};
            t.y += arc * ${f(sp.stand * 0.7)};
            t.y += abs(sin(ph)) * mix(0.004, 0.02, gait) * mv * (1.0 - swim) * ${f(sp.stand * 5.0)};
            // swimming: a slow rise and fall on the water
            t.y += swim * 0.003 * sin(tm * 2.0);
          }`)
        .replace('#include <beginnormal_vertex>', `
          mat3 poseR; vec3 poseT;
          beastPose(poseR, poseT);
          vec3 objectNormal = poseR * vec3(normal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = poseR * vec3(position) + poseT;`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    return mesh;
  }
}
function s7(v: number[]) {
  return v.map((x) => x * 0.7);
}
