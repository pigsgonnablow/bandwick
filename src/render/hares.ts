// Hares in the grass: a few of the hares the simulation counts on each tile, shown near the camera.
// The simulation keeps only a number of hares per tile (what the snares catch from); which of them are
// drawn, and how they hop about, sit up and bolt from people, is decided here and changes nothing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STEP, T } from '../sim/types';
import { addCommon } from './shaderlib';

/** Of the hares the simulation counts on a tile, the share shown: about one hare on every twenty-five grass tiles, and
 *  fewer in the woods (hares like open country, and under the trees they would hardly be seen). */
export const HARE_SHOWN = 0.02;
const IN_WOODS = 0.35;
/** Show hares on tiles this far from the middle of the view (tiles), and none once the view is wider than `HARE_ZOOM_MAX`. */
const RADIUS = 34, HARE_ZOOM_MAX = 70;
/** How close a person comes before a hare bolts, and before it sits up to watch them (tiles). */
const BOLT = 1.9, WATCH = 3.6;
/** Ground speeds (tiles a second at normal speed), and how far one bound carries. */
const HOP_SPEED = 0.32, RUN_SPEED = 2.4, HOP_LEN = 0.11, BOUND_LEN = 0.42;
/** Drawn a little bigger than the model (as people and deer are bigger than life), so a hare can be made out at all. */
const SIZE = 1.25;
/** The time a hare takes to appear or slip away (seconds). */
const FADE = 0.6;

type Mode = 'sit' | 'hop' | 'run' | 'watch';
interface Hare {
  /** its tile and which of the tile's hares it is */
  tile: number; slot: number;
  /** where it lives, and where it is */
  hx: number; hz: number; x: number; z: number; y: number;
  tx: number; tz: number;
  angle: number;
  mode: Mode;
  timer: number;
  /** hop cycle (0..1), how much it is hopping, sitting up, head down nibbling, ears laid back */
  phase: number; mv: number; sit: number; nib: number; flat: number;
  /** the person it is wary of (x, z), while watching */
  wx: number; wz: number;
  /** 0..1 shown; going: on its way out (no longer one of the tile's hares) */
  shown: number; going: boolean;
  seed: number;
}

/** A number from 0 to 1, the same every time for the same inputs. */
function hash01(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
const shortest = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class HareLayer {
  mesh: THREE.InstancedMesh;
  private hares = new Map<number, Hare>();
  /** hares per tile as the simulation sent them (see Sim.packGame), and when the list was last brought up to date */
  private game: Uint8Array | null = null;
  private dirty = true;
  private cx = -999;
  private cz = -999;
  private rand = 1;
  constructor(private N: number, private terrain: Uint8Array, private groundAt: (x: number, z: number) => number, geoms: Map<string, THREE.BufferGeometry>) {
    this.mesh = this.makeMesh(geoms);
  }

  private rnd() {
    this.rand = (Math.imul(this.rand, 1664525) + 1013904223) >>> 0;
    return this.rand / 4294967296;
  }

  setGame(g: Uint8Array) {
    this.game = g;
    this.dirty = true;
  }

  /** How many hares the simulation has on a tile (-1: no hares live there). */
  private count(i: number) {
    const v = this.game ? this.game[i] : 0;
    return v ? (v - 1) / 20 : -1;
  }
  private tileAt(x: number, z: number) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return -1;
    return tz * this.N + tx;
  }
  /** Whether a hare can go from one point to another: hare country all the way, no climb or drop of more than a terrace. */
  private open(x0: number, z0: number, x1: number, z1: number) {
    let py = this.groundAt(x0, z0);
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.3));
    for (let k = 1; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
      const i = this.tileAt(x, z);
      if (i < 0 || this.count(i) < 0) return false;
      const y = this.groundAt(x, z);
      if (Math.abs(y - py) > STEP * 1.05) return false;
      py = y;
    }
    return true;
  }

  /** The hares that belong in view: on each hare tile near the middle of the view, a few of the tile's hares. */
  private refresh(cx: number, cz: number) {
    const want = new Set<number>();
    if (this.game) {
      const N = this.N;
      const x0 = Math.max(0, Math.floor(cx - RADIUS)), x1 = Math.min(N - 1, Math.floor(cx + RADIUS));
      const z0 = Math.max(0, Math.floor(cz - RADIUS)), z1 = Math.min(N - 1, Math.floor(cz + RADIUS));
      for (let tz = z0; tz <= z1; tz++)
        for (let tx = x0; tx <= x1; tx++) {
          if ((tx + 0.5 - cx) ** 2 + (tz + 0.5 - cz) ** 2 > RADIUS * RADIUS) continue;
          const i = tz * N + tx;
          const n = this.count(i);
          if (n <= 0) continue;
          const share = HARE_SHOWN * (this.terrain[i] === T.Forest ? IN_WOODS : 1);
          // the tile's first hare is the likeliest to be shown, and the last to go as the snares empty it
          for (let k = 0; k < 3 && k < n; k++) if (hash01(i, k) < share * Math.min(1, n - k)) want.add(i * 4 + k);
        }
    }
    for (const [key, h] of this.hares) if (!want.has(key)) h.going = true;
    for (const key of want) {
      const h = this.hares.get(key);
      if (h) { h.going = false; continue; }
      const tile = key >> 2, slot = key & 3;
      const x = (tile % this.N) + 0.2 + hash01(tile, slot + 10) * 0.6, z = Math.floor(tile / this.N) + 0.2 + hash01(tile, slot + 20) * 0.6;
      this.hares.set(key, {
        tile, slot, hx: x, hz: z, x, z, y: this.groundAt(x, z), tx: x, tz: z, angle: hash01(tile, slot + 30) * Math.PI * 2,
        mode: 'sit', timer: 1 + hash01(tile, slot + 40) * 6, phase: 0, mv: 0, sit: 0, nib: 0, flat: 0, wx: 0, wz: 0,
        shown: 0, going: false, seed: hash01(tile, slot + 50) * 100,
      });
    }
  }

  /** Somewhere for a hare to hop to: a short way off, drawn back toward where it lives. */
  private wander(h: Hare) {
    for (let k = 0; k < 6; k++) {
      const back = Math.hypot(h.hx - h.x, h.hz - h.z) > 1.4;
      const a = back ? Math.atan2(h.hx - h.x, h.hz - h.z) + (this.rnd() - 0.5) * 1.2 : this.rnd() * Math.PI * 2;
      const d = 0.25 + this.rnd() * 0.9;
      const x = h.x + Math.sin(a) * d, z = h.z + Math.cos(a) * d;
      if (this.open(h.x, h.z, x, z)) {
        h.tx = x;
        h.tz = z;
        h.mode = 'hop';
        return;
      }
    }
    h.timer = 1 + this.rnd() * 3;
  }

  /** Away from someone, at a run, swerving a little; along the best open line it can find. */
  private bolt(h: Hare, px: number, pz: number) {
    const away = Math.atan2(h.x - px, h.z - pz);
    let best = -1, bx = h.x, bz = h.z;
    for (let k = 0; k < 7; k++) {
      const a = away + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45) + (this.rnd() - 0.5) * 0.3;
      for (const d of [3.5 + this.rnd() * 2, 2, 1]) {
        const x = h.x + Math.sin(a) * d, z = h.z + Math.cos(a) * d;
        if (!this.open(h.x, h.z, x, z)) continue;
        const sc = d - Math.abs(shortest(away, a)) * 1.5;
        if (sc > best) { best = sc; bx = x; bz = z; }
        break;
      }
    }
    h.tx = bx;
    h.tz = bz;
    h.mode = 'run';
    h.wx = px;
    h.wz = pz;
  }

  /**
   * Per render frame. `dt` is game-paced (zero while paused), `people` where everyone is drawn.
   */
  update(dt: number, cam: THREE.Vector3, zoom: number, people: { x: number; z: number }[]) {
    const off = zoom > HARE_ZOOM_MAX || !this.game;
    if (!off && (this.dirty || Math.hypot(cam.x - this.cx, cam.z - this.cz) > 3)) {
      this.dirty = false;
      this.cx = cam.x;
      this.cz = cam.z;
      this.refresh(cam.x, cam.z);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const anim = this.mesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
    const anim2 = this.mesh.geometry.attributes.iAnim2 as THREE.InstancedBufferAttribute;
    let n = 0;
    for (const [key, h] of this.hares) {
      h.shown += (h.going ? -dt : dt) / FADE;
      if (h.shown <= 0 && h.going) { this.hares.delete(key); continue; }
      h.shown = Math.min(1, Math.max(0, h.shown));
      if (dt > 0) this.step(h, dt, people);
      if (off || n >= anim.count) continue;
      pos.set(h.x, h.y, h.z);
      q.setFromAxisAngle(up, h.angle);
      scl.setScalar(SIZE * Math.max(0.001, h.shown));
      m4.compose(pos, q, scl);
      this.mesh.setMatrixAt(n, m4);
      anim.setXYZW(n, h.phase, h.mv, h.sit, h.nib);
      anim2.setXYZW(n, h.seed, h.flat, h.mode === 'run' ? 1 : 0, 0);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    anim.needsUpdate = anim2.needsUpdate = true;
  }

  private step(h: Hare, dt: number, people: { x: number; z: number }[]) {
    // the nearest person
    let pd = 99, px = 0, pz = 0;
    for (const p of people) {
      const d = Math.hypot(p.x - h.x, p.z - h.z);
      if (d < pd) { pd = d; px = p.x; pz = p.z; }
    }
    if (pd < BOLT && h.mode !== 'run') this.bolt(h, px, pz);
    else if (pd < WATCH && (h.mode === 'sit' || h.mode === 'hop')) {
      h.mode = 'watch';
      h.timer = 1.5 + this.rnd() * 2;
      h.wx = px;
      h.wz = pz;
    }
    let want = h.angle;
    let goal = 0;
    if (h.mode === 'hop' || h.mode === 'run') {
      const speed = h.mode === 'run' ? RUN_SPEED : HOP_SPEED;
      const dx = h.tx - h.x, dz = h.tz - h.z, len = Math.hypot(dx, dz);
      if (len < 0.05) {
        // a hare that has run sits up and looks back before it settles; one that hopped sits and feeds
        if (h.mode === 'run') { h.mode = 'watch'; h.timer = 2 + this.rnd() * 2.5; }
        else { h.mode = 'sit'; h.timer = 2.5 + this.rnd() * 7; }
      } else {
        // it covers ground in bounds: nearly all of it in the air, a moment on the ground between
        const d = Math.min(len, speed * dt);
        h.x += (dx / len) * d;
        h.z += (dz / len) * d;
        h.phase = (h.phase + d / (h.mode === 'run' ? BOUND_LEN : HOP_LEN)) % 1;
        want = Math.atan2(dx, dz);
        goal = 1;
      }
    } else if (h.mode === 'watch') {
      // sat up on its haunches, turned side-on to whoever it is watching
      want = Math.atan2(h.wx - h.x, h.wz - h.z) + Math.PI / 2;
      h.timer -= dt;
      if (h.timer <= 0) { h.mode = 'sit'; h.timer = 2 + this.rnd() * 5; }
    } else {
      h.timer -= dt;
      if (h.timer <= 0) {
        // now and then it sits up to look round; otherwise it hops on a little way
        if (this.rnd() < 0.25) { h.mode = 'watch'; h.timer = 1 + this.rnd() * 1.5; h.wx = h.x + this.rnd() - 0.5; h.wz = h.z + this.rnd() - 0.5; }
        else this.wander(h);
      }
    }
    const k = 1 - Math.exp(-dt * 8);
    h.mv += (goal - h.mv) * k;
    h.sit += ((h.mode === 'watch' ? 1 : 0) - h.sit) * (1 - Math.exp(-dt * 6));
    // feeding: the head goes down to the grass and comes up to chew and look round
    const feeding = h.mode === 'sit' ? (Math.sin((h.timer + h.seed) * 1.7) > -0.2 ? 1 : 0) : 0;
    h.nib += (feeding - h.nib) * (1 - Math.exp(-dt * 5));
    h.flat += ((h.mode === 'run' ? 1 : 0) - h.flat) * (1 - Math.exp(-dt * 7));
    h.angle += shortest(h.angle, want) * (1 - Math.exp(-dt * (h.mode === 'run' ? 14 : 7)));
    h.y += (this.groundAt(h.x, h.z) - h.y) * Math.min(1, dt * 12);
  }

  private makeMesh(geoms: Map<string, THREE.BufferGeometry>) {
    // pivots in game space (x, up, forward): the hip, the neck, the shoulder, and the root of the ears
    const parts: [string, number, [number, number, number]][] = [
      ['body', 0, [0, 0.032, -0.024]], ['head', 1, [0, 0.056, 0.035]], ['ears', 4, [0, 0.077, 0.040]],
      ['fore', 2, [0, 0.032, 0.026]], ['hind', 3, [0, 0.032, -0.024]],
    ];
    const list: THREE.BufferGeometry[] = [];
    for (const [name, id, pivot] of parts) {
      const g0 = geoms.get(`hare__${name}`);
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
    const cap = 256;
    const geo = list.length ? mergeGeometries(list)! : new THREE.BufferGeometry();
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('iAnim2', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => 'hare';
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          attribute vec3 aPivot;
          // hop phase (0..1), hopping, sitting up, nibbling
          attribute vec4 iAnim;
          // a number of its own, ears laid back, running
          attribute vec4 iAnim2;
          mat3 hrx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          // turn about a pivot: the point and the rotation so far
          void hTurn(inout vec3 p, inout mat3 R, mat3 M, vec3 at) { p = M * (p - at) + at; R = M * R; }
          void harePose(inout vec3 p, out mat3 R) {
            R = mat3(1.0);
            float ph = iAnim.x, mv = iAnim.y, sit = iAnim.z, nib = iAnim.w;
            float run = iAnim2.z;
            float tau = 6.2831853;
            vec3 hip = vec3(0.0, 0.032, -0.024), neck = vec3(0.0, 0.056, 0.035), shoulder = vec3(0.0, 0.032, 0.026);
            // ears: up and turning at a sound now and then, laid flat along the back at a run
            if (aPart > 3.5) {
              float tw = smoothstep(0.92, 1.0, sin(uTime * 1.3 + iAnim2.x * 7.0)) * 0.35 * (1.0 - iAnim2.y);
              hTurn(p, R, hrx(-1.0 * iAnim2.y + tw), vec3(0.0, 0.077, 0.040));
            }
            // the head down to the grass while it feeds
            if (aPart > 0.5 && aPart < 1.5 || aPart > 3.5) hTurn(p, R, hrx(0.65 * nib * (1.0 - sit)), neck);
            // the legs through a bound: hind feet thrust back at take-off and swing up past the forefeet to land,
            // forefeet reach out ahead and come down first
            float reach = mix(0.7, 1.1, run) * mv;
            if (aPart > 2.5 && aPart < 3.5) hTurn(p, R, hrx(reach * cos(tau * (ph - 0.08))), hip);
            if (aPart > 1.5 && aPart < 2.5) hTurn(p, R, hrx(-reach * cos(tau * (ph - 0.2))), shoulder);
            // sitting up: everything but the haunches rears back on the hips, the forepaws off the ground
            if (aPart < 2.5 || aPart > 3.5) hTurn(p, R, hrx(-0.85 * sit), hip);
            // the whole hare in the air on each bound (most of the cycle), pitched nose up leaving the ground
            // and nose down landing
            float air = ph < 0.7 ? sin(3.14159 * ph / 0.7) : 0.0;
            float u = ph < 0.7 ? ph / 0.7 : 1.0 + (ph - 0.7) / 0.3;
            hTurn(p, R, hrx(-0.32 * mv * cos(3.14159 * u)), vec3(0.0, 0.04, 0.0));
            p.y += air * mv * mix(0.022, 0.05, run);
          }`)
        .replace('#include <beginnormal_vertex>', `
          vec3 poseP = vec3(position);
          mat3 poseR;
          harePose(poseP, poseR);
          vec3 objectNormal = poseR * vec3(normal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = poseP;`);
    };
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    return m;
  }

  /** testing aid: where the hares are drawn */
  list() {
    return [...this.hares.values()].filter((h) => !h.going).map((h) => ({ x: h.x, y: h.y, z: h.z, mode: h.mode }));
  }
}
