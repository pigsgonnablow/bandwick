// The opening of a new world: the first band comes in from the sea in a boat, lands on the
// nearest shore, walks inland to where their camp will be, lays the hearth and marks out the
// stockpile. Only the picture changes: the simulation waits at its first tick until it is over
// (everyone ends exactly where the simulation already has them), so a world's history is the
// same with or without it.
import * as THREE from 'three';
import { ACT } from '../sim/band';
import { Grid } from '../sim/path';
import { WorldData, WATER, SEA_SURFACE } from '../sim/types';
import type { BandLayer, IntroPose } from './band';
import type { IsoCamera } from './camera';

const SAIL_MS = 8000;
/** how far out to sea the boat is first seen, in tiles */
const OFFSHORE = 18;
const WALK_SPEED = 1.5; // tiles per second
const MAX_WALK_MS = 11000;
const STAGGER_MS = 380;
const HEARTH_MS = 2600;
const STOCKPILE_MS = 2200;

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

interface Walker {
  id: number;
  /** seat in the boat, in the boat's own frame (along, across) */
  seat: [number, number];
  path: THREE.CatmullRomCurve3;
  start: number;
  dur: number;
  /** where they end up: the simulation's own position for them */
  end: { x: number; z: number };
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) * (1 - t) * (1 - t));

export class Intro {
  done = false;
  /** the player moved the camera: stop steering it */
  camFree = false;
  caption = '';
  private boat = new THREE.Group();
  private boatCurve: THREE.CatmullRomCurve3;
  private walkers: Walker[] = [];
  private t0 = -1;
  private hearth: { id: number; x: number; z: number };
  private stockpile: { id: number } | null;
  private landAt = 0;
  private hearthAt = 0;
  private endAt = 0;
  private boatPos = new THREE.Vector3();
  private boatDir = new THREE.Vector3(0, 0, 1);

  private constructor(
    private band: BandLayer,
    private parent: THREE.Object3D,
    boatPts: THREE.Vector3[],
    shore: { x: number; z: number },
    walkPts: { x: number; z: number }[],
    people: { id: number; x: number; z: number; age: number }[],
    hearth: { id: number; x: number; z: number },
    stockpile: { id: number } | null,
    private camp: string,
  ) {
    this.hearth = hearth;
    this.stockpile = stockpile;
    this.boatCurve = new THREE.CatmullRomCurve3(boatPts, false, 'centripetal');
    this.boatCurve.getPointAt(1, this.boatPos);
    this.boatCurve.getTangentAt(1, this.boatDir);
    this.makeBoat();
    // the grown-ups step out first, the children after, the little ones carried last
    const order = people.slice().sort((a, b) => (b.age >= 14 ? 1 : 0) - (a.age >= 14 ? 1 : 0) || b.age - a.age);
    const seats = people.slice().sort((a, b) => a.id - b.id);
    const end = this.boatPos.clone();
    const fwd = this.boatDir.clone();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    let last = 0;
    order.forEach((p, k) => {
      const si = seats.indexOf(p);
      const seat: [number, number] = [0.62 - Math.floor(si / 2) * 0.3, si % 2 ? 0.15 : -0.15];
      const sx = end.x + fwd.x * seat[0] + right.x * seat[1], sz = end.z + fwd.z * seat[0] + right.z * seat[1];
      // single file along the way, each a little to one side of the one in front
      const side = ((k % 3) - 1) * 0.16;
      const pts = [new THREE.Vector3(sx, 0, sz), new THREE.Vector3(shore.x, 0, shore.z)];
      for (let i = 0; i < walkPts.length; i++) {
        const a = walkPts[Math.max(0, i - 1)], b = walkPts[Math.min(walkPts.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        pts.push(new THREE.Vector3(walkPts[i].x - (dz / l) * side, 0, walkPts[i].z + (dx / l) * side));
      }
      pts.push(new THREE.Vector3(p.x, 0, p.z));
      // drop points too close together (they kink a smooth curve)
      const clean = pts.filter((q, i) => i === 0 || i === pts.length - 1 || q.distanceTo(pts[i - 1]) > 0.2);
      const path = new THREE.CatmullRomCurve3(clean, false, 'centripetal');
      const len = path.getLength();
      const dur = Math.min(MAX_WALK_MS, (len / WALK_SPEED) * 1000);
      const start = SAIL_MS + 500 + k * STAGGER_MS;
      last = Math.max(last, start + dur);
      if (k === 0) this.landAt = start + dur;
      this.walkers.push({ id: p.id, seat, path, start, dur, end: { x: p.x, z: p.z } });
    });
    this.hearthAt = this.landAt + 300;
    this.endAt = Math.max(last, this.hearthAt + HEARTH_MS + 600 + STOCKPILE_MS) + 1600;
    band.introPose = (id) => this.pose(id);
    band.introBuild.set(hearth.id, 0);
    if (stockpile) band.introBuild.set(stockpile.id, 0);
    parent.add(this.boat);
  }

  /** Work out the landing for the world's first band, or null if there is no sea to come in from. */
  static plan(world: WorldData, band: BandLayer, parent: THREE.Object3D, camp: string): Intro | null {
    const N = world.size;
    const hearthB = band.getBuildings().find((b) => b.kind === 'hearth');
    if (!hearthB) return null;
    const stock = band.getBuildings().find((b) => b.kind === 'stockpile' && b.band === hearthB.band);
    const people: { id: number; x: number; z: number; age: number }[] = [];
    band.each((id, s) => people.push({ id, x: s.x, z: s.z, age: s.age }));
    if (!people.length) return null;
    const grid = new Grid(world);
    const campTile = hearthB.z * N + hearthB.x;
    const dry = (i: number) => world.water[i] === WATER.None && grid.walkable(i);
    // the nearest dry shore with open sea beside it, as the band would walk it
    const seen = new Int32Array(N * N).fill(-1);
    const q = [campTile];
    seen[campTile] = campTile;
    let shore = -1, sea = -1;
    for (let h = 0; h < q.length && shore < 0; h++) {
      const i = q[h], x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue;
        const j = nz * N + nx;
        if (world.water[j] === WATER.Sea && dry(i)) { shore = i; sea = j; break; }
        if (seen[j] < 0 && dry(j) && grid.step(i, j)) { seen[j] = i; q.push(j); }
      }
    }
    if (shore < 0) return null;
    const route = grid.find(shore, campTile, false, 40000);
    if (!route) return null;
    // out to sea from the landing: as far as open water goes, up to OFFSHORE tiles
    const back = new Int32Array(N * N).fill(-1);
    const depth = new Int16Array(N * N);
    const sq = [sea];
    back[sea] = sea;
    let far = sea;
    const sx = sea % N, sz = (sea / N) | 0;
    for (let h = 0; h < sq.length; h++) {
      const i = sq[h];
      if (depth[i] >= OFFSHORE) continue;
      const x = i % N, z = (i / N) | 0;
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (back[j] >= 0 || world.water[j] !== WATER.Sea) continue;
        back[j] = i;
        depth[j] = depth[i] + 1;
        sq.push(j);
        const dj = Math.hypot(nx - sx, nz - sz), df = Math.hypot((far % N) - sx, ((far / N) | 0) - sz);
        if (dj > df) far = j;
      }
    }
    const chain: number[] = [];
    for (let i = far; ; i = back[i]) {
      chain.push(i);
      if (i === sea) break;
    }
    const c = (i: number) => ({ x: (i % N) + 0.5, z: ((i / N) | 0) + 0.5 });
    const shoreC = c(shore), seaC = c(sea);
    const out = { x: seaC.x - shoreC.x, z: seaC.z - shoreC.z };
    const edge = { x: (shoreC.x + seaC.x) / 2, z: (shoreC.z + seaC.z) / 2 };
    // the boat comes to rest with its bow on the sand
    const rest = { x: edge.x + out.x * 0.85, z: edge.z + out.z * 0.85 };
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < chain.length - 3; k += 2) pts.push(new THREE.Vector3(c(chain[k]).x, 0, c(chain[k]).z));
    pts.push(new THREE.Vector3(edge.x + out.x * 3.2, 0, edge.z + out.z * 3.2));
    pts.push(new THREE.Vector3(rest.x, 0, rest.z));
    if (pts.length < 2) return null;
    const walk = Array.from(route).map(c);
    return new Intro(band, parent, pts, shoreC, walk, people, { id: hearthB.id, x: hearthB.x + 0.5, z: hearthB.z + 0.5 }, stock ? { id: stock.id } : null, camp);
  }

  private makeBoat() {
    // a long dugout: the lower half of a stretched sphere, open at the top, with a few thwarts across
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.9, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.95 });
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), wood);
    hull.scale.set(0.36, 0.2, 1.2);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40), dark);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(0.36, 1.2, 1);
    this.boat.add(hull, rim);
    for (const z of [-0.75, 0.05, 0.85]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.06), dark);
      t.position.set(0, -0.02, z);
      this.boat.add(t);
    }
    // the bundles they brought: firewood and food
    const bundle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), dark);
    bundle.rotation.z = Math.PI / 2;
    bundle.position.set(0, -0.02, -0.98);
    this.boat.add(bundle);
    this.boat.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
  }

  /** The boat's place and heading at time t (ms into the intro). */
  private boatAt(t: number, now: number) {
    const u = easeOut(t / SAIL_MS) * 0.92 + ease(t / SAIL_MS) * 0.08;
    const p = this.boatCurve.getPointAt(Math.min(1, u));
    const d = this.boatCurve.getTangentAt(Math.min(1, Math.max(0.001, u)));
    const moving = t < SAIL_MS;
    const bob = Math.sin(now * 0.0021) * (moving ? 0.025 : 0.01);
    return { x: p.x, z: p.z, y: SEA_SURFACE + 0.07 + bob, dir: d, roll: Math.sin(now * 0.0016) * (moving ? 0.05 : 0.015) };
  }

  private seatPos(seat: [number, number], b: ReturnType<Intro['boatAt']>) {
    const f = b.dir, r = { x: f.z, z: -f.x };
    return { x: b.x + f.x * seat[0] + r.x * seat[1], z: b.z + f.z * seat[0] + r.z * seat[1] };
  }

  private bNow: ReturnType<Intro['boatAt']> | null = null;
  private tNow = 0;

  private pose(id: number): IntroPose | null {
    const w = this.walkers.find((q) => q.id === id);
    const b = this.bNow;
    if (!w || !b) return null;
    const t = this.tNow;
    const heading = Math.atan2(b.dir.x, b.dir.z);
    if (t < w.start) {
      const s = this.seatPos(w.seat, b);
      // sitting in the boat, facing the way it goes (until it lands and they stand to get out)
      return { x: s.x, z: s.z, y: b.y - 0.12, act: t < SAIL_MS + 200 ? ACT.Sit : ACT.Idle, angle: heading, afloat: true };
    }
    const k = Math.min(1, (t - w.start) / w.dur);
    if (k >= 1) {
      // there: stand about, turned to the fire
      return { x: w.end.x, z: w.end.z, act: ACT.Idle, angle: Math.atan2(this.hearth.x - w.end.x, this.hearth.z - w.end.z) };
    }
    const p = w.path.getPointAt(k);
    // still stepping over the side, in the shallows
    const wet = this.band.waterAt(p.x, p.z);
    return { x: p.x, z: p.z, y: wet ? Math.max(b.y - 0.12, wet.surface - 0.08) : undefined, act: ACT.Walk, afloat: !!wet };
  }

  /** Per render frame (dt in seconds). */
  update(dt: number, now: number, cam: IsoCamera, steer: boolean) {
    if (this.done) return;
    if (this.t0 < 0) {
      this.t0 = 0;
      const b0 = this.boatAt(0, now);
      if (steer) cam.frame(b0.x, b0.z, 15, true);
    } else {
      // its own clock, a frame at a time: a long stall (the first frames, a hidden tab) skips only a moment of it
      this.t0 += Math.min(dt, 0.25) * 1000;
    }
    const t = (this.tNow = this.t0);
    const b = (this.bNow = this.boatAt(t, now));
    this.boat.position.set(b.x, b.y, b.z);
    this.boat.rotation.set(0, Math.atan2(b.dir.x, b.dir.z), 0);
    this.boat.rotateZ(b.roll);
    // laying the hearth, then marking out the stockpile beside it
    const hk = (t - this.hearthAt) / HEARTH_MS;
    this.band.introBuild.set(this.hearth.id, hk >= 1 ? 1 : Math.max(0, hk));
    if (this.stockpile) {
      const sk = (t - this.hearthAt - HEARTH_MS - 600) / STOCKPILE_MS;
      this.band.introBuild.set(this.stockpile.id, sk >= 1 ? 1 : Math.max(0, sk));
    }
    if (t < SAIL_MS) this.caption = 'A boat comes in from the sea, with ten people in it.';
    else if (t < this.hearthAt) this.caption = 'They come ashore and walk inland to find a place to live.';
    else if (t < this.hearthAt + HEARTH_MS + 600) this.caption = `Here, by fresh water: they lay a hearth and light the fire.`;
    else this.caption = `They mark out a place for their stores. This is ${this.camp}.`;
    if (steer && !this.camFree) {
      if (t < SAIL_MS + 400) cam.frame(b.x, b.z, 15, false);
      else {
        // follow whoever leads the way, then settle on the camp
        const lead = this.walkers[0];
        const k = Math.min(1, (t - lead.start) / lead.dur);
        const p = k < 1 ? lead.path.getPointAt(Math.max(0, k)) : new THREE.Vector3(this.hearth.x, 0, this.hearth.z);
        cam.frame(p.x, p.z, k < 1 ? 15 : 17, false);
      }
    }
    if (t >= this.endAt) this.done = true;
  }

  /** Put everything back as the simulation has it. */
  dispose() {
    this.done = true;
    this.band.introPose = null;
    this.band.introBuild.clear();
    this.parent.remove(this.boat);
    this.boat.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
  }
}
