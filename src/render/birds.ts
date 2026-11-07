// Birds: small flocks of finches feeding on open ground near the camera that flush when anyone comes close and
// land again further off; skeins of geese passing high over in spring and autumn; a pair of birds fluttering and
// scolding round a tree while someone robs their nest, and bees boiling out of a hive being smoked. All of it is
// for show: the simulation knows only the eggs and the honey.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { T, WATER, WorldData } from '../sim/types';
import { seasonOf, TICKS_PER_DAY, DAYS_PER_SEASON } from '../sim/time';
import { addCommon } from './shaderlib';

/** A finch flock on about one open grass tile in this many near the camera. */
const FLOCK_EVERY = 260;
const RADIUS = 30, ZOOM_MAX = 60;
/** How close a person comes before a flock goes up (tiles). */
const FLUSH = 2.3;
/** Finch flight: ground speed (tiles a second) and how high the flight arcs (tiles). */
const FINCH_SPEED = 2.6, FINCH_HIGH = 0.7;
/** Geese: how high over the land they pass, their speed, and how many seconds (at normal speed) between skeins. */
const GOOSE_HIGH = 2.6, GOOSE_SPEED = 1.5, SKEIN_EVERY = 70;
/** Drawn bigger than life, as the hares and deer are. */
const FINCH_SIZE = 2.0, GOOSE_SIZE = 1.6;

interface Finch {
  /** offset in the flock while feeding, and where it is */
  ox: number; oz: number; x: number; y: number; z: number;
  angle: number;
  /** a short hop on the ground: from, to, 0..1 */
  hx: number; hz: number; hop: number; hopT: number;
  peck: number; peckT: number;
  /** the flight: from, to, how far along (0..1, below 0 not yet off), its own height and wobble */
  fx: number; fz: number; fy: number; tx: number; tz: number; ty: number; t: number; high: number;
  phase: number; flap: number; fold: number;
  seed: number;
}
interface Flock {
  key: number;
  x: number; z: number;
  birds: Finch[];
  flying: boolean;
  timer: number;
  shown: number; going: boolean;
}
interface Goose { side: number; rank: number; phase: number }
interface Skein {
  x: number; z: number; y: number; angle: number;
  geese: Goose[];
  left: number;
}
interface Scold {
  /** the person robbing the nest, the tree, and how long since anyone was there */
  id: number; x: number; z: number; y: number;
  birds: { a: number; r: number; h: number; phase: number }[];
  gone: number;
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
const smooth = (t: number) => t * t * (3 - 2 * t);

export class BirdLayer {
  group = new THREE.Group();
  private finchMesh: THREE.InstancedMesh;
  private gooseMesh: THREE.InstancedMesh;
  private bees: THREE.InstancedMesh;
  private flocks = new Map<number, Flock>();
  private skeins: Skein[] = [];
  private scolds = new Map<number, Scold>();
  private cx = -999;
  private cz = -999;
  private tick = 0;
  private skeinOwed = 0.6;
  private rand = 11;
  private clock = 0;

  constructor(private world: WorldData, private groundAt: (x: number, z: number) => number, geoms: Map<string, THREE.BufferGeometry>) {
    this.finchMesh = this.makeMesh(geoms, 'finch', [0.006, 0.017, 0.002], 320);
    this.gooseMesh = this.makeMesh(geoms, 'goose', [0.012, 0.006, 0.004], 48);
    const bm = new THREE.MeshBasicMaterial({ color: 0x2a2208 });
    this.bees = new THREE.InstancedMesh(new THREE.BoxGeometry(0.009, 0.006, 0.012), bm, 64);
    this.bees.count = 0;
    this.bees.frustumCulled = false;
    this.group.add(this.finchMesh, this.gooseMesh, this.bees);
  }

  setTick(t: number) {
    this.tick = t;
  }

  private rnd() {
    this.rand = (Math.imul(this.rand, 1664525) + 1013904223) >>> 0;
    return this.rand / 4294967296;
  }
  private tileAt(x: number, z: number) {
    const N = this.world.size, tx = Math.floor(x), tz = Math.floor(z);
    return tx < 0 || tz < 0 || tx >= N || tz >= N ? -1 : tz * N + tx;
  }
  /** Open grass a flock can come down on. */
  private grass(x: number, z: number) {
    const i = this.tileAt(x, z);
    return i >= 0 && this.world.water[i] === WATER.None && this.world.terrain[i] === T.Grass;
  }

  private refresh(cx: number, cz: number) {
    const N = this.world.size;
    const want = new Set<number>();
    const x0 = Math.max(0, Math.floor(cx - RADIUS)), x1 = Math.min(N - 1, Math.floor(cx + RADIUS));
    const z0 = Math.max(0, Math.floor(cz - RADIUS)), z1 = Math.min(N - 1, Math.floor(cz + RADIUS));
    for (let tz = z0; tz <= z1; tz++)
      for (let tx = x0; tx <= x1; tx++) {
        if ((tx + 0.5 - cx) ** 2 + (tz + 0.5 - cz) ** 2 > RADIUS * RADIUS) continue;
        const i = tz * N + tx;
        if (this.world.terrain[i] === T.Grass && this.world.water[i] === WATER.None && hash01(i, 91) * FLOCK_EVERY < 1) want.add(i);
      }
    for (const [key, f] of this.flocks) if (!want.has(key)) f.going = true;
    for (const key of want) {
      const f = this.flocks.get(key);
      if (f) { f.going = false; continue; }
      const x = (key % N) + 0.5, z = Math.floor(key / N) + 0.5;
      const n = 4 + Math.floor(hash01(key, 92) * 6);
      const birds: Finch[] = [];
      for (let k = 0; k < n; k++) {
        const a = hash01(key, 100 + k) * Math.PI * 2, r = 0.08 + hash01(key, 200 + k) * 0.32;
        const bx = x + Math.sin(a) * r, bz = z + Math.cos(a) * r;
        birds.push({ ox: bx - x, oz: bz - z, x: bx, y: this.groundAt(bx, bz), z: bz, angle: hash01(key, 300 + k) * 6.28,
          hx: bx, hz: bz, hop: 1, hopT: hash01(key, 400 + k) * 2, peck: 0, peckT: hash01(key, 500 + k), fx: bx, fz: bz, fy: 0, tx: bx, tz: bz, ty: 0, t: 1,
          high: 1, phase: hash01(key, 600 + k), flap: 0, fold: 1, seed: hash01(key, 700 + k) * 50 });
      }
      this.flocks.set(key, { key, x, z, birds, flying: false, timer: 20 + hash01(key, 93) * 60, shown: 0, going: false });
    }
  }

  /** The flock goes up together and comes down somewhere open a few tiles off, away from whatever put it up. */
  private flush(f: Flock, fromX?: number, fromZ?: number) {
    let tx = f.x, tz = f.z;
    for (let k = 0; k < 12; k++) {
      const away = fromX !== undefined ? Math.atan2(f.x - fromX, f.z - fromZ!) : this.rnd() * Math.PI * 2;
      const a = away + (this.rnd() - 0.5) * (fromX !== undefined ? 1.4 : 6.28), d = 3 + this.rnd() * 5;
      const x = f.x + Math.sin(a) * d, z = f.z + Math.cos(a) * d;
      if (this.grass(x, z)) { tx = x; tz = z; break; }
    }
    f.flying = true;
    f.x = tx;
    f.z = tz;
    for (const b of f.birds) {
      b.fx = b.x; b.fz = b.z; b.fy = b.y;
      b.tx = tx + b.ox * (0.8 + this.rnd() * 0.5);
      b.tz = tz + b.oz * (0.8 + this.rnd() * 0.5);
      b.ty = this.groundAt(b.tx, b.tz);
      // they don't all go at once: a ripple through the flock from the nearest
      b.t = -this.rnd() * 0.25 - (fromX !== undefined ? Math.hypot(b.x - fromX, b.z - fromZ!) * 0.03 : 0.1);
      b.high = FINCH_HIGH * (0.8 + this.rnd() * 0.5);
    }
  }

  /**
   * Per render frame. `dt` game-paced (zero while paused), `night` 0..1, `people` where everyone is drawn,
   * `gleaners` anyone robbing a nest (kind 0) or smoking a hive (kind 1), at the tree they face.
   */
  update(dt: number, cam: THREE.Vector3, zoom: number, night: number, people: { x: number; z: number }[],
    gleaners: { id: number; kind: number; x: number; z: number; y: number }[]) {
    this.clock += dt;
    const off = zoom > ZOOM_MAX;
    if (!off && Math.hypot(cam.x - this.cx, cam.z - this.cz) > 3) {
      this.cx = cam.x;
      this.cz = cam.z;
      this.refresh(cam.x, cam.z);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const fa = this.finchMesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
    let n = 0;
    // flocks roost at night: they fade away at dusk and come back in the morning
    const awake = night < 0.55;
    for (const [key, f] of this.flocks) {
      f.shown += (f.going || !awake ? -dt : dt) / 1.2;
      if (f.shown <= 0 && f.going) { this.flocks.delete(key); continue; }
      f.shown = Math.min(1, Math.max(0, f.shown));
      if (dt > 0 && f.shown > 0) this.stepFlock(f, dt, people);
      if (off || f.shown <= 0) continue;
      for (const b of f.birds) {
        if (n >= fa.count) break;
        pos.set(b.x, b.y, b.z);
        const pitch = b.t >= 0 && b.t < 1 ? -0.15 : b.peck * 0.6;
        q.setFromEuler(e.set(pitch, b.angle, 0));
        scl.setScalar(FINCH_SIZE * f.shown);
        this.finchMesh.setMatrixAt(n, m4.compose(pos, q, scl));
        fa.setXYZW(n, b.phase, b.flap, b.fold, 0);
        n++;
      }
    }
    // a pair of birds round each nest being robbed, scolding
    for (const g of gleaners) {
      if (g.kind !== 0) continue;
      let s = this.scolds.get(g.id);
      if (!s || Math.hypot(s.x - g.x, s.z - g.z) > 0.6) {
        s = { id: g.id, x: g.x, z: g.z, y: g.y, gone: 0, birds: [0, 1].map((k) => ({ a: this.rnd() * 6.28 + k * 3.1, r: 0.35 + this.rnd() * 0.2, h: 0.45 + this.rnd() * 0.25, phase: this.rnd() })) };
        this.scolds.set(g.id, s);
      }
      s.gone = 0;
    }
    for (const [id, s] of this.scolds) {
      if (!gleaners.some((g) => g.kind === 0 && g.id === id)) s.gone += dt;
      if (s.gone > 3) { this.scolds.delete(id); continue; }
      for (const b of s.birds) {
        if (off || n >= fa.count) break;
        // round and round the tree, dipping at the thief and up again; once they leave, away up and off
        b.a += dt * 2.2;
        b.phase = (b.phase + dt * 9) % 1;
        const away = s.gone * 2.5;
        const x = s.x + Math.sin(b.a) * (b.r + away), z = s.z + Math.cos(b.a) * (b.r + away);
        const y = s.y + b.h + Math.sin(b.a * 2.3) * 0.12 + away * 0.6;
        pos.set(x, y, z);
        q.setFromEuler(e.set(-0.1, b.a + Math.PI / 2, -0.35));
        scl.setScalar(FINCH_SIZE * Math.max(0, 1 - s.gone / 3));
        this.finchMesh.setMatrixAt(n, m4.compose(pos, q, scl));
        fa.setXYZW(n, b.phase, 1, 0, 0);
        n++;
      }
    }
    this.finchMesh.count = n;
    this.finchMesh.instanceMatrix.needsUpdate = true;
    fa.needsUpdate = true;
    this.updateGeese(dt, cam, off);
    this.updateBees(gleaners, off);
  }

  private stepFlock(f: Flock, dt: number, people: { x: number; z: number }[]) {
    if (!f.flying) {
      let pd = 99, px = 0, pz = 0;
      for (const p of people) {
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        if (d < pd) { pd = d; px = p.x; pz = p.z; }
      }
      f.timer -= dt;
      if (pd < FLUSH) this.flush(f, px, pz);
      else if (f.timer <= 0) { f.timer = 25 + this.rnd() * 60; this.flush(f); }
    }
    let landed = true;
    for (const b of f.birds) {
      if (b.t < 1) {
        landed = false;
        b.t += dt / (Math.hypot(b.tx - b.fx, b.tz - b.fz) / FINCH_SPEED + 0.4);
        const t = Math.max(0, Math.min(1, b.t));
        if (b.t >= 0) {
          // up steeply, a bounding flight across, and a flutter down to land
          const u = smooth(t);
          b.x = b.fx + (b.tx - b.fx) * u;
          b.z = b.fz + (b.tz - b.fz) * u;
          b.y = b.fy + (b.ty - b.fy) * u + Math.sin(Math.PI * Math.pow(t, 0.8)) * b.high + Math.sin(t * 40 + b.seed) * 0.02;
          b.angle += shortest(b.angle, Math.atan2(b.tx - b.fx, b.tz - b.fz)) * Math.min(1, dt * 10);
          // finches fly in bounds: a burst of beats, then wings shut for a moment
          const burst = t < 0.12 || t > 0.85 || Math.sin(t * 26 + b.seed) > -0.35;
          b.phase = (b.phase + dt * 13) % 1;
          b.flap += ((burst ? 1 : 0) - b.flap) * Math.min(1, dt * 18);
          b.fold += ((burst ? 0 : 0.8) - b.fold) * Math.min(1, dt * 18);
        }
        if (b.t >= 1) { b.hx = b.x; b.hz = b.z; b.hop = 1; b.flap = 0; }
        continue;
      }
      // on the ground: wings folded, pecking, now and then a hop
      b.flap += (0 - b.flap) * Math.min(1, dt * 10);
      b.fold += (1 - b.fold) * Math.min(1, dt * 10);
      b.peckT -= dt;
      if (b.peckT <= 0) { b.peckT = 0.25 + this.rnd() * 0.9; b.peck = b.peck > 0.5 ? 0 : 1; }
      b.hopT -= dt;
      if (b.hop >= 1 && b.hopT <= 0) {
        b.hopT = 0.6 + this.rnd() * 2.5;
        const a = this.rnd() * 6.28, d = 0.04 + this.rnd() * 0.08;
        const x = b.x + Math.sin(a) * d, z = b.z + Math.cos(a) * d;
        if (this.grass(x, z) && Math.hypot(x - f.x, z - f.z) < 0.6) { b.hx = b.x; b.hz = b.z; b.tx = x; b.tz = z; b.hop = 0; b.angle = a; b.peck = 0; }
      }
      if (b.hop < 1) {
        b.hop = Math.min(1, b.hop + dt * 5);
        b.x = b.hx + (b.tx - b.hx) * b.hop;
        b.z = b.hz + (b.tz - b.hz) * b.hop;
        b.y = this.groundAt(b.x, b.z) + Math.sin(Math.PI * b.hop) * 0.025;
      } else b.y = this.groundAt(b.x, b.z);
    }
    if (f.flying && landed) {
      f.flying = false;
      for (const b of f.birds) { b.ox = b.x - f.x; b.oz = b.z - f.z; }
    }
  }

  private updateGeese(dt: number, cam: THREE.Vector3, off: boolean) {
    // geese go over on passage: north in the first half of spring, south through the middle of autumn
    const season = seasonOf(this.tick), day = Math.floor(this.tick / TICKS_PER_DAY) % DAYS_PER_SEASON;
    const passage = (season === 0 && day < 7) || (season === 2 && day >= 3 && day < 10);
    if (passage && dt > 0 && !off) {
      this.skeinOwed += dt / SKEIN_EVERY;
      if (this.skeinOwed >= 1) {
        this.skeinOwed = 0;
        // across the view, a little off the straight north-south line
        const angle = (season === 0 ? Math.PI : 0) + (this.rnd() - 0.5) * 0.7;
        const n = 7 + Math.floor(this.rnd() * 7), along = 34;
        const side = (this.rnd() - 0.5) * 16;
        this.skeins.push({
          x: cam.x - Math.sin(angle) * along + Math.cos(angle) * side, z: cam.z - Math.cos(angle) * along - Math.sin(angle) * side,
          y: this.groundAt(cam.x, cam.z) + GOOSE_HIGH, angle, left: (along * 2) / GOOSE_SPEED,
          geese: Array.from({ length: n }, (_, k) => ({ side: k === 0 ? 0 : k % 2 ? 1 : -1, rank: Math.ceil(k / 2), phase: this.rnd() })),
        });
      }
    }
    const ga = this.gooseMesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(GOOSE_SIZE, GOOSE_SIZE, GOOSE_SIZE);
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    let n = 0;
    for (let k = this.skeins.length - 1; k >= 0; k--) {
      const s = this.skeins[k];
      s.left -= dt;
      if (s.left <= 0) { this.skeins.splice(k, 1); continue; }
      s.x += Math.sin(s.angle) * GOOSE_SPEED * dt;
      s.z += Math.cos(s.angle) * GOOSE_SPEED * dt;
      const fx = Math.sin(s.angle), fz = Math.cos(s.angle);
      for (const g of s.geese) {
        if (off || n >= ga.count) break;
        // a V: each rank further back and out to its side, the line breathing a little
        g.phase = (g.phase + dt * 2.4) % 1;
        const back = g.rank * 0.32, out = g.side * g.rank * 0.26 + Math.sin(this.clock * 0.7 + g.rank) * 0.03;
        pos.set(s.x - fx * back + fz * out, s.y + Math.sin(this.clock * 1.3 + g.rank * 0.9) * 0.04 - g.rank * 0.02, s.z - fz * back - fx * out);
        q.setFromEuler(e.set(0, s.angle, 0));
        this.gooseMesh.setMatrixAt(n, m4.compose(pos, q, scl));
        ga.setXYZW(n, g.phase, 0.8, 0, 0);
        n++;
      }
    }
    this.gooseMesh.count = n;
    this.gooseMesh.instanceMatrix.needsUpdate = true;
    ga.needsUpdate = true;
  }

  /** Bees boiling out round a hive being smoked: dark specks darting about the tree. */
  private updateBees(gleaners: { kind: number; x: number; z: number; y: number; id: number }[], off: boolean) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const g of gleaners) {
      if (g.kind !== 1 || off) continue;
      for (let k = 0; k < 18 && n < 64; k++) {
        const t = this.clock * (1.6 + (k % 5) * 0.37) + k * 1.7 + g.id;
        const r = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t * 0.7 + k));
        pos.set(g.x + Math.sin(t * 2.1) * r + Math.sin(t * 7.3) * 0.03, g.y + 0.28 + Math.sin(t * 1.3 + k) * 0.16, g.z + Math.cos(t * 1.9) * r + Math.cos(t * 6.1) * 0.03);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 3);
        this.bees.setMatrixAt(n, m4.compose(pos, q, one));
        n++;
      }
    }
    this.bees.count = n;
    this.bees.instanceMatrix.needsUpdate = true;
  }

  private makeMesh(geoms: Map<string, THREE.BufferGeometry>, kind: string, shoulder: [number, number, number], cap: number) {
    const list: THREE.BufferGeometry[] = [];
    for (const [name, id, sx] of [['body', 0, 0], ['wingL', 1, -1], ['wingR', 2, 1]] as [string, number, number][]) {
      const g0 = geoms.get(`${kind}__${name}`);
      if (!g0) continue;
      const g = g0.index ? g0.toNonIndexed() : g0.clone();
      if (g.attributes.aCenter) g.deleteAttribute('aCenter');
      const n = g.attributes.position.count;
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
      const pv = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) pv.set([shoulder[0] * sx, shoulder[1], shoulder[2]], k * 3);
      g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
      list.push(g);
    }
    const geo = list.length ? mergeGeometries(list)! : new THREE.BufferGeometry();
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.customProgramCacheKey = () => `bird-${kind}`;
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          attribute vec3 aPivot;
          // wingbeat phase (0..1), how hard the wings beat (0: held out to glide), folded (1: shut along the body)
          attribute vec4 iAnim;
          mat3 bry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
          mat3 brz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
          mat3 brx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          void birdPose(inout vec3 p, out mat3 R) {
            R = mat3(1.0);
            if (aPart < 0.5) return;
            float side = aPart < 1.5 ? -1.0 : 1.0;
            float ph = iAnim.x * 6.2831853, flap = iAnim.y, fold = iAnim.z;
            // folded: the wing swung back along the flank, tipped down over the side, its tip crossed over the tail
            mat3 F = brz(-side * 1.25 * fold) * brx(0.25 * fold) * bry(side * 1.45 * fold);
            // the beat: a quick downstroke and a slower recovery, the wing lifting high above the back
            float beat = sin(ph) + 0.3 * sin(2.0 * ph);
            mat3 B = brz(side * (0.15 + 0.85 * beat) * flap);
            R = B * F;
            p = R * (p - aPivot) + aPivot;
          }`)
        .replace('#include <beginnormal_vertex>', `
          vec3 poseP = vec3(position);
          mat3 poseR;
          birdPose(poseP, poseR);
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
}
