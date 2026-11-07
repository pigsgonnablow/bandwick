// Wolves and the dogs tamed from them. The wolves come from the simulation (packs that roam the
// wilds, run deer down, feed, howl and slink off from people); each dog is drawn at the heels of
// whoever keeps it, trotting after them, lying at the door while they are indoors, nosing about when
// they stop. Both are one Blender model in parts (wolf__*, dog__*), posed in the vertex shader: a
// trot (diagonal pairs) breaking into a gallop, the head and lower jaw, the tail, sitting up to howl,
// lying curled, head down at a kill, slinking off low with the tail tucked.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WOLF } from '../sim/band';
import { STEP } from '../sim/types';
import { addCommon } from './shaderlib';
import type { TrackLayer } from './tracks';

const STRIDE = 6;
/** Stride lengths (tiles, for a grown wolf) at the trot and the gallop, the pace a trot turns into a
 *  gallop over (tiles a second), the fastest the legs cycle, and half the length from fore to hind feet. */
const STRIDE_TROT = 0.26, STRIDE_RUN = 0.62, GALLOP_FROM = 1.6, GALLOP_FULL = 3.0, MAX_CADENCE = 7, HALF = 0.068;
/** A dog trails its keeper this far back and to the side, and lies down after they have stood still this long (s). */
const HEEL = 0.34, SETTLE = 4;
/** Dog poses (the same numbers as the wolves' states, which the shader reads). */
const D = { Stand: WOLF.Rest, Walk: WOLF.Trot, Lie: WOLF.Lie, Sit: WOLF.Howl, Sniff: WOLF.Feed } as const;

interface Shown {
  x: number; z: number; sx: number; sz: number; t0: number; dur: number; movedAt: number;
  dx: number; dz: number; yf: number; yb: number; y: number; pitch: number;
  angle: number; want: number; phase: number; gait: number; moving: number;
  state: number; pup: boolean; seen: number;
  /** pose blends: sitting up, lying down (eased, so it settles and rises rather than snapping) */
  sit: number; lie: number;
  trail: number; foot: number;
  /** the point the simulation has it facing (for a wolf at a kill, the carcass) */
  kx: number; kz: number;
}
interface Dog extends Shown {
  /** where its keeper was last frame, how long they have stood still, which side it keeps to, and where it is nosing about */
  kx: number; kz: number; still: number; side: number; sniffAt: number; sniffX: number; sniffZ: number;
}

/** What band.ts knows of each keeper: where they are drawn and what they are doing. */
export interface Keeper { id: number; x: number; y: number; z: number; angle: number; indoors: boolean; pup: boolean; hunting: boolean }

export class WolfLayer {
  readonly group = new THREE.Group();
  private wolfMesh: THREE.InstancedMesh;
  private dogMesh: THREE.InstancedMesh;
  /** the deer a pack is feeding on */
  private carcass: THREE.InstancedMesh;
  private wolves = new Map<number, Shown>();
  private dogs = new Map<number, Dog>();
  /** wolves on screen, for clicking */
  visible: { id: number; x: number; y: number; z: number; pup: boolean; state: number }[] = [];
  /** where the dogs are drawn (hares and finches shy from them as from people) */
  dogSpots: { x: number; z: number }[] = [];

  constructor(geoms: Map<string, THREE.BufferGeometry>, private groundAt: (x: number, z: number) => number, private tracks: TrackLayer) {
    this.wolfMesh = this.makeMesh(geoms, 'wolf', 1, 128);
    this.dogMesh = this.makeMesh(geoms, 'dog', 0.82, 64);
    const cg = geoms.get('carcass__deer');
    const cm = new THREE.MeshLambertMaterial({ vertexColors: true });
    cm.onBeforeCompile = (sh) => addCommon(sh);
    cm.customProgramCacheKey = () => 'carcass';
    this.carcass = new THREE.InstancedMesh(cg ?? new THREE.BufferGeometry(), cm, 8);
    this.carcass.count = 0;
    this.carcass.frustumCulled = false;
    this.carcass.castShadow = true;
    this.group.add(this.wolfMesh, this.dogMesh, this.carcass);
  }

  private fresh(x: number, z: number, now: number, dur: number): Shown {
    const gy = this.groundAt(x, z);
    return { x, z, sx: x, sz: z, t0: now, dur, movedAt: 0, dx: x, dz: z, yf: gy, yb: gy, y: gy, pitch: 0, angle: 0, want: 0,
      phase: Math.random(), gait: 0, moving: 0, state: 0, pup: false, seen: 0, sit: 0, lie: 0, trail: 0, foot: 0, kx: x, kz: z };
  }

  /** A new frame of wolves from the simulation (moved every other tick). */
  setWolves(W: Float32Array, now: number, tickMs: number, seen: number) {
    for (let o = 0; o < W.length; o += STRIDE) {
      const id = W[o], nx = W[o + 1], nz = W[o + 2];
      let w = this.wolves.get(id);
      if (!w) {
        w = this.fresh(nx, nz, now, tickMs * 2);
        this.wolves.set(id, w);
      } else if (Math.abs(nx - w.x) + Math.abs(nz - w.z) > 1e-5) {
        const t = Math.min(1, (now - w.t0) / w.dur);
        w.sx += (w.x - w.sx) * t;
        w.sz += (w.z - w.sz) * t;
        const gap = now - w.movedAt;
        w.dur = gap < 1200 ? Math.min(900, Math.max(16, w.dur * 0.5 + gap * 0.5)) : tickMs * 2;
        w.t0 = now;
        w.movedAt = now;
        w.x = nx;
        w.z = nz;
      }
      w.kx = W[o + 3];
      w.kz = W[o + 4];
      const fx = W[o + 3] - nx, fz = W[o + 4] - nz;
      if (fx * fx + fz * fz > 1e-4) w.want = Math.atan2(fx, fz);
      w.state = W[o + 5] % 10;
      w.pup = W[o + 5] >= 10;
      w.seen = seen;
    }
    for (const [id, w] of this.wolves) if (w.seen !== seen) this.wolves.delete(id);
  }

  /**
   * Move the dogs after their keepers and draw everything. `follow` is the band's glide factor for
   * this frame, `dt` real seconds (the legs and the dogs' pace go by what is drawn, not game time).
   */
  update(dt: number, now: number, follow: number, keepers: Keeper[]) {
    // the wolves: glide to where the simulation has them
    let n = 0;
    this.visible.length = 0;
    for (const [id, w] of this.wolves) {
      const t = Math.min(1, (now - w.t0) / w.dur);
      const tx = w.sx + (w.x - w.sx) * t, tz = w.sz + (w.z - w.sz) * t;
      const ox = w.dx, oz = w.dz;
      if (Math.abs(tx - w.dx) + Math.abs(tz - w.dz) > 1.5) { w.dx = tx; w.dz = tz; }
      else { w.dx += (tx - w.dx) * follow; w.dz += (tz - w.dz) * follow; }
      const size = w.pup ? 0.6 : 1;
      this.stride(w, ox, oz, dt, size);
      this.settle(w, dt, w.state === WOLF.Howl ? 1 : 0, w.state === WOLF.Lie ? 1 : 0);
      if (n < this.wolfMesh.instanceMatrix.count) this.place(this.wolfMesh, n++, w, id, size, 0);
      this.visible.push({ id, x: w.dx, y: w.y + 0.12, z: w.dz, pup: w.pup, state: w.state });
    }
    this.finish(this.wolfMesh, n);
    // the kill they are feeding at
    const sites: [number, number][] = [];
    for (const w of this.wolves.values()) {
      if (w.state !== WOLF.Feed || sites.some(([x, z]) => Math.abs(x - w.kx) + Math.abs(z - w.kz) < 0.5)) continue;
      sites.push([w.kx, w.kz]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    let c = 0;
    for (const [x, z] of sites) {
      if (c >= this.carcass.instanceMatrix.count) break;
      q.setFromAxisAngle(up, ((Math.floor(x * 7) * 31 + Math.floor(z * 7) * 17) % 628) / 100);
      this.carcass.setMatrixAt(c++, m4.compose(new THREE.Vector3(x, this.groundAt(x, z), z), q, one));
    }
    this.carcass.count = c;
    this.carcass.instanceMatrix.needsUpdate = true;

    // the dogs: at their keeper's heels
    const seen = new Set<number>();
    let m = 0;
    this.dogSpots.length = 0;
    for (const k of keepers) {
      seen.add(k.id);
      let d = this.dogs.get(k.id);
      if (!d) {
        const bx = k.x - Math.sin(k.angle) * HEEL, bz = k.z - Math.cos(k.angle) * HEEL;
        d = { ...this.fresh(bx, bz, now, 100), kx: k.x, kz: k.z, still: 0, side: k.id % 2 ? 1 : -1, sniffAt: 0, sniffX: bx, sniffZ: bz };
        this.dogs.set(k.id, d);
      }
      d.pup = k.pup;
      const size = k.pup ? 0.6 : 1;
      const ox = d.dx, oz = d.dz;
      // where it wants to be: a little behind and to one side of its keeper (out ahead on a hunt), lying
      // across the doorway while they are indoors, and nosing about nearby when they stop for a while
      const ahead = k.hunting ? -1.4 : 1;
      let gx = k.x - Math.sin(k.angle) * HEEL * ahead + Math.cos(k.angle) * 0.16 * d.side;
      let gz = k.z - Math.cos(k.angle) * HEEL * ahead - Math.sin(k.angle) * 0.16 * d.side;
      const keeperMoved = Math.hypot(k.x - d.kx, k.z - d.kz) > 0.002;
      d.kx = k.x; d.kz = k.z;
      d.still = keeperMoved ? 0 : d.still + dt;
      if (!keeperMoved && d.still > 1.5 && !k.indoors && d.still < SETTLE + 6) {
        if (now > d.sniffAt) {
          d.sniffAt = now + 2500 + Math.random() * 3000;
          const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.5;
          d.sniffX = k.x + Math.cos(a) * r;
          d.sniffZ = k.z + Math.sin(a) * r;
        }
        gx = d.sniffX; gz = d.sniffZ;
      }
      const dist = Math.hypot(gx - d.dx, gz - d.dz);
      if (dist > 6) { d.dx = gx; d.dz = gz; }
      else if (dist > 0.03) {
        // trot to catch up, gallop when left far behind
        const pace = Math.min(dist, (dist > 1.2 ? 3.4 : dist > 0.4 ? 1.6 : 0.7) * size * dt * 1.4);
        d.dx += ((gx - d.dx) / dist) * pace;
        d.dz += ((gz - d.dz) / dist) * pace;
      }
      const moved = Math.hypot(d.dx - ox, d.dz - oz);
      d.want = moved > 0.002 ? Math.atan2(d.dx - ox, d.dz - oz) : k.indoors ? d.want : Math.atan2(k.x - d.dx, k.z - d.dz);
      d.state = moved / Math.max(dt, 1e-3) > 0.1 ? D.Walk : d.still > 1.5 && d.still < SETTLE + 6 && !k.indoors ? D.Sniff : D.Stand;
      const lie = k.indoors || d.still > SETTLE + 6 ? 1 : 0;
      const sit = !lie && d.still > SETTLE && d.state !== D.Walk ? 1 : 0;
      if (lie) d.state = D.Lie;
      this.stride(d, ox, oz, dt, size);
      this.settle(d, dt, sit, lie);
      if (m < this.dogMesh.instanceMatrix.count) this.place(this.dogMesh, m++, d, k.id, size, 1);
      if (!k.indoors) this.dogSpots.push({ x: d.dx, z: d.dz });
    }
    for (const id of this.dogs.keys()) if (!seen.has(id)) this.dogs.delete(id);
    this.finish(this.dogMesh, m);
  }

  /** Legs that step with the ground covered, a trot breaking into a gallop, the body on its footing, prints in snow. */
  private stride(w: Shown, ox: number, oz: number, dt: number, size: number) {
    const moved = Math.hypot(w.dx - ox, w.dz - oz);
    const speed = dt > 0 ? moved / dt / size : 0;
    const k = 1 - Math.exp(-dt * 6);
    w.moving += (Math.min(1, speed / 0.3) - w.moving) * k;
    const g = Math.min(1, Math.max(0, (speed - GALLOP_FROM) / (GALLOP_FULL - GALLOP_FROM)));
    w.gait += (g * g * (3 - 2 * g) - w.gait) * k;
    const stride = (STRIDE_TROT + (STRIDE_RUN - STRIDE_TROT) * w.gait) * size;
    if (moved > 0) w.phase = (w.phase + Math.min(moved / stride, MAX_CADENCE * dt)) % 1;
    const want = moved > 0.0015 * dt * 60 ? Math.atan2(w.dx - ox, w.dz - oz) : w.want;
    let turn = want - w.angle;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    w.angle += turn * (1 - Math.exp(-dt * (w.state === WOLF.Chase ? 12 : 7)));
    const hx = Math.sin(w.angle) * HALF * size, hz = Math.cos(w.angle) * HALF * size;
    const kf = Math.min(1, dt * 16);
    w.yf += (this.groundAt(w.dx + hx, w.dz + hz) - w.yf) * kf;
    w.yb += (this.groundAt(w.dx - hx, w.dz - hz) - w.yb) * kf;
    const rise = w.yf - w.yb;
    const pitchGoal = Math.max(-0.6, Math.min(0.6, Math.atan2(rise, HALF * 2 * size)));
    w.pitch += (pitchGoal - w.pitch) * Math.min(1, dt * 14);
    const leap = Math.min(1, Math.abs(rise) / (STEP * 0.5));
    w.y = (w.yf + w.yb) / 2 + leap * (1 - leap * 0.5) * 0.06 * size;
    if (this.tracks.snowy && moved > 0 && moved < 1) {
      w.trail += moved;
      const gap = stride * 0.5;
      while (w.trail > gap) {
        w.trail -= gap;
        w.foot = 1 - w.foot;
        const side = (w.foot ? 1 : -1) * 0.02 * size, back = w.trail;
        const px = w.dx + Math.cos(w.angle) * side - Math.sin(w.angle) * back, pz = w.dz - Math.sin(w.angle) * side - Math.cos(w.angle) * back;
        this.tracks.press(px, this.groundAt(px, pz) + 0.003, pz, w.angle, size * 0.65);
      }
    }
  }

  private settle(w: Shown, dt: number, sit: number, lie: number) {
    const k = 1 - Math.exp(-dt * 3);
    w.sit += (sit - w.sit) * k;
    w.lie += (lie - w.lie) * k;
  }

  private place(mesh: THREE.InstancedMesh, i: number, w: Shown, id: number, size: number, dog: number) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Quaternion();
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.angle).multiply(p.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -w.pitch * (1 - w.lie)));
    m4.compose(new THREE.Vector3(w.dx, w.y, w.dz), q, new THREE.Vector3(size, size, size));
    mesh.setMatrixAt(i, m4);
    const a = mesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
    const a2 = mesh.geometry.attributes.iAnim2 as THREE.InstancedBufferAttribute;
    a.setXYZW(i, w.state, (id % 97) * 0.61, dog, w.sit);
    a2.setXYZW(i, w.phase, w.gait, w.moving, w.lie);
  }

  private finish(mesh: THREE.InstancedMesh, n: number) {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute).needsUpdate = true;
    (mesh.geometry.attributes.iAnim2 as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  private makeMesh(geoms: Map<string, THREE.BufferGeometry>, prefix: string, s: number, cap: number) {
    const v = (x: number, y: number, z: number): [number, number, number] => [x * s, y * s, z * s];
    // pivots in game axes (x right, y up, +z forward): the neck's root, the tail's root, shoulders and hips
    const parts: [string, number, [number, number, number]][] = [
      ['body', 0, v(0, 0, 0)], ['head', 1, v(0, 0.165, 0.080)], ['jaw', 2, v(0, 0.165, 0.080)], ['tail', 3, v(0, 0.170, -0.104)],
      ['legFL', 4, v(-0.021, 0.163, 0.066)], ['legFR', 5, v(0.021, 0.163, 0.066)], ['legBL', 6, v(-0.021, 0.168, -0.068)], ['legBR', 7, v(0.021, 0.168, -0.068)],
    ];
    const list: THREE.BufferGeometry[] = [];
    for (const [name, id, pivot] of parts) {
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
    const geo = mergeGeometries(list)!;
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('iAnim2', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const f = (x: number) => (x * s).toFixed(4);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => `canid-${prefix}`;
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          attribute vec3 aPivot;
          // state, a per-animal seed, 1 for a dog, how far it is sat up
          attribute vec4 iAnim;
          // stride phase (0..1), trot-to-gallop, how much it is moving, how far it is lying down
          attribute vec4 iAnim2;
          mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
          // turn about a point, after whatever was done before (M, t)
          void about(mat3 R, vec3 p, inout mat3 M, inout vec3 t) { M = R * M; t = R * t + p - R * p; }
          void canidPose(out mat3 M, out vec3 t) {
            float st = iAnim.x, seed = iAnim.y, dog = iAnim.z, sit = iAnim.w;
            float ph = iAnim2.x * 6.2831853, gait = iAnim2.y, mv = iAnim2.z, lie = iAnim2.w;
            float chase = step(1.5, st) * step(st, 2.5), feed = step(2.5, st) * step(st, 3.5);
            float slink = step(3.5, st) * step(st, 4.5), howl = step(4.5, st) * step(st, 5.5);
            float tm = uTime + seed;
            M = mat3(1.0);
            t = vec3(0.0);
            // the howl: long rising notes with a breath between
            float note = howl * (dog > 0.5 ? 0.0 : smoothstep(0.0, 0.4, sin(tm * 0.8)));
            if (aPart > 3.5) {
              bool front = aPart < 5.5;
              bool left = aPart < 4.5 || (aPart > 5.5 && aPart < 6.5);
              // the trot moves diagonal pairs together; the gallop is a rotary bound, hind pair then fore
              float offT = front ? (left ? 0.0 : 0.5) : (left ? 0.5 : 0.0);
              float offG = front ? (left ? 0.5 : 0.6) : (left ? 0.0 : 0.1);
              float sw = sin(ph + mix(offT, offG, gait) * 6.2831853);
              float a = (sw + 0.2 * sin(2.0 * (ph + mix(offT, offG, gait) * 6.2831853))) * mix(0.45, 0.85, gait) * mv;
              // slinking: a crouch, every leg a little bent under; at a kill the forefeet are braced
              a += slink * (front ? -0.12 : 0.2) + feed * (front ? -0.25 : 0.1);
              // sitting: haunches down with the hind legs folded forward under them, forelegs straight
              a += sit * (front ? 0.5 : -1.25);
              // lying: forelegs stretched out in front, hind legs tucked alongside
              a = mix(a, front ? -1.45 : -1.3, lie);
              about(rx(a), aPivot, M, t);
            } else if (aPart > 0.5 && aPart < 2.5) {
              // the head: low and reaching at the gallop, down to the kill, low when slinking, thrown back to howl,
              // laid on the forepaws when lying; looking about now and then when stood; the brow nods at the poll
              float look = (1.0 - mv) * (1.0 - lie) * (1.0 - feed) * (1.0 - howl) * 0.15 * sin(tm * 0.7);
              float neck = 0.22 * gait * mv + 0.85 * feed + 0.35 * slink - 0.45 * howl * (0.6 + 0.4 * note) + 0.55 * lie
                + feed * 0.08 * sin(tm * 9.0) + sin(ph * 2.0) * 0.05 * mv * (1.0 - gait);
              float tilt = -0.9 * howl * (0.5 + 0.5 * note) + 0.25 * feed - 0.35 * lie + look * 0.6;
              float open = howl * (0.15 + 0.3 * note) + feed * (0.25 + 0.2 * sin(tm * 9.0));
              if (aPart > 1.5) {
                about(rx(open), vec3(0.0, ${f(0.198)}, ${f(0.141)}), M, t);
                if (open < 0.03) M = mat3(0.0);
              }
              about(rx(tilt * smoothstep(${f(0.105)}, ${f(0.118)}, position.z)), vec3(0.0, ${f(0.205)}, ${f(0.113)}), M, t);
              about(ry(look), aPivot, M, t);
              about(rx(neck), aPivot, M, t);
            } else if (aPart > 2.5) {
              // the tail: streaming out behind at the gallop, tucked between the legs slinking off, a slow
              // sway stood about; a dog's wags whenever it is on its feet
              float lift = -0.5 * gait * mv - 0.15 * mv + 0.7 * slink + 0.3 * lie - 0.2 * howl;
              float sway = (dog > 0.5 ? 0.45 * sin(uTime * 13.0 + seed) * (1.0 - lie) : 0.12 * sin(tm * 1.3)) * (1.0 - slink);
              about(ry(sway), aPivot, M, t);
              about(rx(lift), aPivot, M, t);
            }
            // the whole body: sat up on its haunches, or flat on the ground; a bound over each stride
            vec3 hip = vec3(0.0, ${f(0.168)}, ${f(-0.068)});
            about(rx(-0.55 * sit), hip, M, t);
            t.y -= sit * ${f(0.045)} + lie * ${f(0.118)} + slink * ${f(0.018)};
            t.y += abs(sin(ph)) * mix(0.004, 0.022, gait) * mv * ${f(1.0)};
          }`)
        .replace('#include <beginnormal_vertex>', `
          mat3 poseR; vec3 poseT;
          canidPose(poseR, poseT);
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
