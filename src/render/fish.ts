// Fish in the water: a few trout glimpsed under the surface near the camera, rises dimpling the water and now and
// then a fish leaping clear, all more often where the water is full of fish and less where it has been fished out.
// While the autumn run passes up a river, the water there is crowded with salmon nosing upstream against the current,
// and they leap far more often, upstream, higher and further. The simulation keeps only how full each water tile is
// (and whether a run is passing it); everything here is for show and changes nothing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WATER, WorldData } from '../sim/types';
import { freshFrozen } from '../sim/time';
import { addCommon } from './shaderlib';

/** How many fish are seen swimming: a share of the water tiles near the camera, by how full they are. */
const SWIMMERS = 0.045;
/** Show fish on water tiles this far from the middle of the view (tiles), and none once the view is wider than this. */
const RADIUS = 30, ZOOM_MAX = 60;
/** Rises a second across all the full water in view, per hundred tiles; and the share of rises that are a leap clear. */
const RISES = 1.2, LEAPS = 0.22;
/** Swimming speeds (tiles a second): cruising, and darting away from someone wading or a spear. */
const CRUISE = 0.16, DART = 1.3;
/** How near a person comes before the fish scatter (tiles). */
const SHY = 1.1;
/** Drawn a little bigger than the model, as the hares are. */
const SIZE = 1.15;
/** In a run: how many more salmon are seen than trout in full water, the rises a second per hundred tiles, and the share that are leaps. */
const RUN_SWIMMERS = 4, RUN_RISES = 5, RUN_LEAPS = 0.6;
/** The world's flow directions (0 N, 1 E, 2 S, 3 W) as steps. */
const FLOW: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

interface Swimmer {
  key: number;
  x: number; z: number; y: number;
  tx: number; tz: number;
  angle: number; speed: number; want: number;
  phase: number; wag: number;
  timer: number;
  shown: number; going: boolean;
  /** a salmon of the run, holding its head upstream */
  salmon: boolean;
}
interface Leap {
  x: number; z: number; y: number;
  angle: number; dist: number;
  t: number; dur: number; high: number;
  phase: number;
  salmon: boolean;
}

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

export class FishLayer {
  mesh: THREE.InstancedMesh;
  /** the salmon of the autumn run */
  salmonMesh: THREE.InstancedMesh;
  private fish: Uint8Array | null = null;
  private swimmers = new Map<number, Swimmer>();
  private leaps: Leap[] = [];
  /** the water tiles near the camera with fish in them, and how full each is (refreshed as the view moves) */
  private near: { i: number; f: number; run: number }[] = [];
  private nearFull = 0;
  private cx = -999;
  private cz = -999;
  private dirty = true;
  private tick = 0;
  private rand = 7;
  private riseOwed = 0;

  /**
   * @param mark a ring on the water (and a splash of drops when `drops`), drawn by the band layer
   */
  constructor(private world: WorldData, geoms: Map<string, THREE.BufferGeometry>,
    private mark: (x: number, z: number, y: number, size: number, drops: number) => void) {
    this.mesh = this.makeMesh(geoms, 'fish');
    this.salmonMesh = this.makeMesh(geoms, 'salmon');
  }

  setFish(f: Uint8Array) {
    this.fish = f;
    this.dirty = true;
  }
  setTick(t: number) {
    // the ice comes and goes with the season: look again when it does
    if (freshFrozen(t) !== freshFrozen(this.tick)) this.dirty = true;
    this.tick = t;
  }

  private rnd() {
    this.rand = (Math.imul(this.rand, 1664525) + 1013904223) >>> 0;
    return this.rand / 4294967296;
  }
  /** How full a water tile is of fish, 0..1 (-1: no fish live there, or it is iced over). */
  private full(i: number) {
    const v = this.fish ? this.fish[i] : 0;
    if (!v) return -1;
    if (this.world.water[i] !== WATER.Sea && freshFrozen(this.tick)) return -1;
    return v > 201 ? 1 : (v - 1) / 200;
  }
  /** How thick the salmon run is in a water tile, 0..1 (0: none passing; the eels run unseen, in the dark). */
  private salmonRun(i: number) {
    const v = this.fish ? this.fish[i] : 0;
    return v >= 202 && v <= 228 ? 0.3 + 0.7 * ((v - 202) / 26) : 0;
  }
  /** Upstream from a river tile, as an angle the fish face (null: still water). */
  private upstream(i: number) {
    const f = this.world.flow[i];
    if (f < 0) return null;
    const [dx, dz] = FLOW[f];
    return Math.atan2(-dx, -dz);
  }
  private tileAt(x: number, z: number) {
    const N = this.world.size, tx = Math.floor(x), tz = Math.floor(z);
    return tx < 0 || tz < 0 || tx >= N || tz >= N ? -1 : tz * N + tx;
  }
  /** Where a fish swims at a point: a little under the surface, never through the bed (null: not fish water). */
  private depthAt(x: number, z: number) {
    const i = this.tileAt(x, z);
    if (i < 0 || this.full(i) < 0) return null;
    const w = this.world;
    const surface = w.waterY[i], deep = surface - w.groundY[i];
    if (deep < 0.06) return null;
    return { surface, y: surface - Math.min(0.06, deep * 0.45) };
  }
  private open(x0: number, z0: number, x1: number, z1: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
    for (let k = 1; k <= n; k++) if (!this.depthAt(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n)) return false;
    return true;
  }

  private refresh(cx: number, cz: number) {
    this.near = [];
    this.nearFull = 0;
    const want = new Set<number>();
    if (this.fish) {
      const N = this.world.size;
      const x0 = Math.max(0, Math.floor(cx - RADIUS)), x1 = Math.min(N - 1, Math.floor(cx + RADIUS));
      const z0 = Math.max(0, Math.floor(cz - RADIUS)), z1 = Math.min(N - 1, Math.floor(cz + RADIUS));
      for (let tz = z0; tz <= z1; tz++)
        for (let tx = x0; tx <= x1; tx++) {
          if ((tx + 0.5 - cx) ** 2 + (tz + 0.5 - cz) ** 2 > RADIUS * RADIUS) continue;
          const i = tz * N + tx;
          const f = this.full(i);
          if (f <= 0.05 || !this.depthAt(tx + 0.5, tz + 0.5)) continue;
          // (a run passing counts for many times the rises of full water)
          const run = this.salmonRun(i);
          this.near.push({ i, f: f + run * RUN_RISES, run });
          this.nearFull += f + run * RUN_RISES;
          if (hash01(i, 77) < SWIMMERS * (f + run * RUN_SWIMMERS)) want.add(i);
        }
    }
    for (const [key, s] of this.swimmers) if (!want.has(key) || s.salmon !== this.salmonRun(key) > 0) s.going = true;
    for (const key of want) {
      const s = this.swimmers.get(key);
      const salmon = this.salmonRun(key) > 0;
      if (s && s.salmon === salmon) { s.going = false; continue; }
      if (s) continue;
      const N = this.world.size;
      const x = (key % N) + 0.5, z = Math.floor(key / N) + 0.5;
      const up = salmon ? this.upstream(key) : null;
      this.swimmers.set(key, {
        key, x, z, y: this.depthAt(x, z)!.y, tx: x, tz: z, angle: up ?? hash01(key, 3) * Math.PI * 2, speed: 0, want: up ?? 0,
        phase: hash01(key, 4), wag: 0, timer: hash01(key, 5) * 3, shown: 0, going: false, salmon,
      });
    }
  }

  /** Per render frame: `dt` game-paced (zero while paused); `people` where everyone is drawn, `splashes` where spears went in. */
  update(dt: number, cam: THREE.Vector3, zoom: number, people: { x: number; z: number }[], splashes: { x: number; z: number }[]) {
    const off = zoom > ZOOM_MAX || !this.fish;
    if (!off && (this.dirty || Math.hypot(cam.x - this.cx, cam.z - this.cz) > 3)) {
      this.dirty = false;
      this.cx = cam.x;
      this.cz = cam.z;
      this.refresh(cam.x, cam.z);
    }
    // rises and leaps: by how much full water is in view
    if (!off && dt > 0 && this.near.length) {
      this.riseOwed += dt * RISES * (this.nearFull / 100);
      while (this.riseOwed >= 1) {
        this.riseOwed -= 1;
        this.rise();
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const anims = [this.mesh, this.salmonMesh].map((m) => m.geometry.attributes.iAnim as THREE.InstancedBufferAttribute);
    const counts = [0, 0];
    /** the next instance of a trout (0) or a salmon (1), or -1 when there is no room */
    const slot = (k: number) => (off || counts[k] >= anims[k].count ? -1 : counts[k]++);
    for (const [key, s] of this.swimmers) {
      s.shown += (s.going ? -dt : dt) / 0.8;
      if (s.shown <= 0 && s.going) { this.swimmers.delete(key); continue; }
      s.shown = Math.min(1, Math.max(0, s.shown));
      if (dt > 0) this.swim(s, dt, people, splashes);
      const k = s.salmon ? 1 : 0, n = slot(k);
      if (n < 0) continue;
      pos.set(s.x, s.y, s.z);
      q.setFromEuler(e.set(0, s.angle, 0));
      scl.setScalar(SIZE * Math.max(0.001, s.shown));
      (k ? this.salmonMesh : this.mesh).setMatrixAt(n, m4.compose(pos, q, scl));
      anims[k].setXYZW(n, s.phase, s.wag, 0, 0);
    }
    for (let k = this.leaps.length - 1; k >= 0; k--) {
      const l = this.leaps[k];
      const was = l.t;
      l.t += dt / l.dur;
      if (was < 1 && l.t >= 1) this.mark(l.x + Math.sin(l.angle) * l.dist, l.z + Math.cos(l.angle) * l.dist, l.y, 0.42, 7);
      if (l.t >= 1) { this.leaps.splice(k, 1); continue; }
      l.phase = (l.phase + dt * 5) % 1;
      const kind = l.salmon ? 1 : 0, n = slot(kind);
      if (n < 0) continue;
      // up out of the water nose first, over the top, and back in head first: the body follows its path
      const t = l.t, h = 4 * t * (1 - t) * l.high;
      const climb = (4 * l.high * (1 - 2 * t)) / l.dist;
      pos.set(l.x + Math.sin(l.angle) * l.dist * t, l.y + h - 0.02, l.z + Math.cos(l.angle) * l.dist * t);
      q.setFromEuler(e.set(-Math.atan(climb), l.angle, Math.sin(t * 9) * 0.25));
      scl.setScalar(SIZE);
      (kind ? this.salmonMesh : this.mesh).setMatrixAt(n, m4.compose(pos, q, scl));
      anims[kind].setXYZW(n, l.phase, 0.9 * (1 - t * 0.5), 0, 0);
    }
    [this.mesh, this.salmonMesh].forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      anims[k].needsUpdate = true;
    });
  }

  /** A fish rises somewhere in view: a dimple and a ring, or now and then a leap clear of the water. */
  private rise() {
    // pick a tile by how full it is
    let r = this.rnd() * this.nearFull;
    let at = this.near[this.near.length - 1];
    for (const c of this.near) { r -= c.f; if (r <= 0) { at = c; break; } }
    const N = this.world.size;
    const x = (at.i % N) + 0.15 + this.rnd() * 0.7, z = Math.floor(at.i / N) + 0.15 + this.rnd() * 0.7;
    const d = this.depthAt(x, z);
    if (!d) return;
    // a salmon of the run throws itself upstream, high and far, as if at a fall; a trout leaps anywhere, low
    const up = at.run > 0 && this.rnd() < at.run * RUN_RISES / (at.f || 1) ? this.upstream(at.i) : null;
    if (up !== null && this.rnd() < RUN_LEAPS) {
      const angle = up + (this.rnd() - 0.5) * 0.7, dist = 0.26 + this.rnd() * 0.22;
      if (!this.depthAt(x + Math.sin(angle) * dist, z + Math.cos(angle) * dist)) return;
      this.leaps.push({ x, z, y: d.surface, angle, dist, t: 0, dur: 0.6 + this.rnd() * 0.2, high: 0.13 + this.rnd() * 0.1, phase: 0, salmon: true });
      this.mark(x, z, d.surface, 0.5, 8);
    } else if (this.rnd() < LEAPS) {
      const angle = this.rnd() * Math.PI * 2, dist = 0.16 + this.rnd() * 0.14;
      if (!this.depthAt(x + Math.sin(angle) * dist, z + Math.cos(angle) * dist)) return;
      this.leaps.push({ x, z, y: d.surface, angle, dist, t: 0, dur: 0.5 + this.rnd() * 0.15, high: 0.07 + this.rnd() * 0.06, phase: 0, salmon: false });
      this.mark(x, z, d.surface, 0.36, 5);
    } else this.mark(x, z, d.surface, (up !== null ? 0.26 : 0.18) + this.rnd() * 0.14, up !== null ? 3 : 0);
  }

  private swim(s: Swimmer, dt: number, people: { x: number; z: number }[], splashes: { x: number; z: number }[]) {
    // something to flee: someone in the water near by, or a spear going in
    let fx = 0, fz = 0, fd = SHY;
    for (const p of [...people, ...splashes]) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < fd) { fd = d; fx = p.x; fz = p.z; }
    }
    let speed = CRUISE;
    if (fd < SHY) {
      const a = Math.atan2(s.x - fx, s.z - fz);
      for (let k = 0; k < 5; k++) {
        const aa = a + (k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.6 : 0);
        const x = s.x + Math.sin(aa) * 1.6, z = s.z + Math.cos(aa) * 1.6;
        if (this.open(s.x, s.z, x, z)) { s.tx = x; s.tz = z; break; }
      }
      s.timer = 1.5;
      speed = DART;
    } else if ((s.timer -= dt) <= 0 || Math.hypot(s.tx - s.x, s.tz - s.z) < 0.08) {
      // cruise to somewhere near, or hang in the current a while
      s.timer = 2 + this.rnd() * 5;
      const N = this.world.size;
      const hx = (s.key % N) + 0.5, hz = Math.floor(s.key / N) + 0.5;
      const up = s.salmon ? this.upstream(this.tileAt(s.x, s.z)) : null;
      for (let k = 0; k < 5; k++) {
        // (a salmon works its way up the stretch against the current, and drops back to start again)
        let x = hx + (this.rnd() - 0.5) * 2.4, z = hz + (this.rnd() - 0.5) * 2.4;
        if (up !== null) {
          const ahead = this.rnd() < 0.75 ? 0.4 + this.rnd() * 0.5 : -0.6;
          x = s.x + Math.sin(up) * ahead + (this.rnd() - 0.5) * 0.3;
          z = s.z + Math.cos(up) * ahead + (this.rnd() - 0.5) * 0.3;
          if (Math.hypot(x - hx, z - hz) > 1.3) { x = hx - Math.sin(up) * 0.5; z = hz - Math.cos(up) * 0.5; }
        }
        if (this.open(s.x, s.z, x, z)) { s.tx = x; s.tz = z; break; }
      }
      if (this.rnd() < (s.salmon ? 0.15 : 0.3)) { s.tx = s.x; s.tz = s.z; }
    }
    const dx = s.tx - s.x, dz = s.tz - s.z, len = Math.hypot(dx, dz);
    const goal = len > 0.05 ? speed : 0;
    s.speed += (goal - s.speed) * (1 - Math.exp(-dt * (speed > CRUISE ? 10 : 2.5)));
    if (len > 0.05) s.want = Math.atan2(dx, dz);
    else if (s.salmon) s.want = this.upstream(this.tileAt(s.x, s.z)) ?? s.want;
    s.angle += shortest(s.angle, s.want) * (1 - Math.exp(-dt * (speed > CRUISE ? 12 : 3)));
    const step = Math.min(len, s.speed * dt);
    const nx = s.x + Math.sin(s.angle) * step, nz = s.z + Math.cos(s.angle) * step;
    const d = this.depthAt(nx, nz);
    if (d) { s.x = nx; s.z = nz; s.y += (d.y - s.y) * Math.min(1, dt * 4); }
    else { s.tx = s.x; s.tz = s.z; }
    // the tail beats faster the faster it swims, and keeps a slow scull even when it holds still
    s.phase = (s.phase + dt * (0.8 + s.speed * 9)) % 1;
    s.wag += (Math.min(1, 0.25 + s.speed * 1.5) - s.wag) * (1 - Math.exp(-dt * 6));
  }

  private makeMesh(geoms: Map<string, THREE.BufferGeometry>, model: 'fish' | 'salmon') {
    const list: THREE.BufferGeometry[] = [];
    for (const [name, id] of [['body', 0], ['tail', 1]] as [string, number][]) {
      const g0 = geoms.get(`${model}__${name}`);
      if (!g0) continue;
      const g = g0.index ? g0.toNonIndexed() : g0.clone();
      if (g.attributes.aCenter) g.deleteAttribute('aCenter');
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
      list.push(g);
    }
    const cap = 192;
    const geo = list.length ? mergeGeometries(list)! : new THREE.BufferGeometry();
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => 'fish';
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          // tail-beat phase (0..1), how hard it beats
          attribute vec4 iAnim;
          mat3 fry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
          // the body swings a little one way about its middle while the tail sweeps the other way from behind the
          // dorsal fin, a travelling wave from head to tail
          void fishPose(inout vec3 p, out mat3 R) {
            float ph = iAnim.x * 6.2831853, amp = iAnim.y;
            mat3 B = fry(sin(ph) * 0.12 * amp);
            R = B;
            if (aPart > 0.5) {
              vec3 at = vec3(0.0, 0.0, -0.014);
              mat3 T = fry(sin(ph - 1.3) * 0.55 * amp);
              p = T * (p - at) + at;
              R = B * T;
            }
            p = B * p;
          }`)
        .replace('#include <beginnormal_vertex>', `
          vec3 poseP = vec3(position);
          mat3 poseR;
          fishPose(poseP, poseR);
          vec3 objectNormal = poseR * vec3(normal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = poseP;`);
    };
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = false;
    return m;
  }
}
