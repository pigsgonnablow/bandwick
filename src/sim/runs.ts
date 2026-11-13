// The autumn runs and the fish weirs. In the first days of autumn the salmon come in from the sea and run up every
// river that reaches it, passing each stretch of water in a few days, arriving later the further upstream; late in
// autumn the eels run down out of the lakes toward the sea. While a run is passing, the river is thick with fish
// however hard it is fished, and a band by such a river can fill its drying rack before winter. A band that knows
// how fences a narrow stretch with a weir, which leads the fish into a basket trap and thins the run above it.
// The runs follow from the world and the year alone (nothing about them is saved): only the fish in the water,
// and in a weir's basket, are.
import { WorldData, WATER, DIRS4 } from './types';
import { hash3 } from './rng';
import {
  Building, RUN_FISH, EEL_FISH, RUN_DAY, RUN_SPEED, RUN_DAYS, RUN_REACH, EEL_DAY, EEL_DAYS, EEL_REACH, RUN_FILL,
  WEIR_TAKE, WEIR_TRICKLE, WEIR_HOLDS, WEIR_PASS,
} from './band';
import { DAYS_PER_YEAR, TICKS_PER_DAY, freshFrozen, dayOf, yearOf } from './time';
import type { Sim, Camp } from './sim';

/** Where the runs go: for each tile, how far up from the sea the salmon have come, and how far down from its lake the eels (-1: no run). */
export interface RunMap {
  salmon: Int16Array;
  eel: Int16Array;
  /** the river tiles either run passes through */
  tiles: number[];
}

/** Step from a tile in a flow direction (0 N, 1 E, 2 S, 3 W), or -1 off the map. */
function stepOf(N: number, i: number, dir: number) {
  const [dx, dz] = DIRS4[dir];
  const x = (i % N) + dx, z = Math.floor(i / N) + dz;
  return x < 0 || z < 0 || x >= N || z >= N ? -1 : z * N + x;
}
/** DIRS4 in the order the world's flow directions use (N, E, S, W). */
const FLOW: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
function down(N: number, i: number, flow: number) {
  const x = (i % N) + FLOW[flow][0], z = Math.floor(i / N) + FLOW[flow][1];
  return x < 0 || z < 0 || x >= N || z >= N ? -1 : z * N + x;
}

export function mapRuns(w: WorldData): RunMap {
  const N = w.size, NN = N * N;
  const salmon = new Int16Array(NN).fill(-1);
  const eel = new Int16Array(NN).fill(-1);
  // the salmon: up every river from where it meets the sea, through the lakes on the way, as far as they go
  const queue: number[] = [];
  for (let i = 0; i < NN; i++) {
    if (w.water[i] !== WATER.River) continue;
    for (let d = 0; d < 4; d++) {
      const j = stepOf(N, i, d);
      if (j >= 0 && w.water[j] === WATER.Sea) { salmon[i] = 0; queue.push(i); break; }
    }
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    if (salmon[i] >= RUN_REACH) continue;
    for (let d = 0; d < 4; d++) {
      const j = stepOf(N, i, d);
      if (j < 0 || salmon[j] >= 0) continue;
      if (w.water[j] !== WATER.River && w.water[j] !== WATER.Lake) continue;
      salmon[j] = salmon[i] + 1;
      queue.push(j);
    }
  }
  // the eels: down the river out of each lake, toward the sea
  for (let i = 0; i < NN; i++) {
    if (w.water[i] !== WATER.River || w.flow[i] < 0) continue;
    const out = down(N, i, w.flow[i]);
    if (out < 0 || w.water[out] === WATER.Lake) continue;
    let fromLake = false;
    for (let d = 0; d < 4; d++) {
      const j = stepOf(N, i, d);
      if (j >= 0 && w.water[j] === WATER.Lake) fromLake = true;
    }
    if (!fromLake) continue;
    // the outlet: follow the water down (and the river's breadth either side of it)
    let at = i;
    for (let dist = 0; at >= 0 && dist <= EEL_REACH && w.water[at] === WATER.River; dist++) {
      if (eel[at] < 0 || eel[at] > dist) eel[at] = dist;
      for (const side of [1, 3]) {
        const j = down(N, at, (w.flow[at] + side) & 3);
        if (j >= 0 && w.water[j] === WATER.River && w.flow[j] === w.flow[at] && (eel[j] < 0 || eel[j] > dist)) eel[j] = dist;
      }
      if (w.flow[at] < 0) break;
      at = down(N, at, w.flow[at]);
    }
  }
  // (only the rivers: a lake the salmon pass through holds no more fish for it)
  for (let i = 0; i < NN; i++) if (w.water[i] !== WATER.River) salmon[i] = -1;
  const tiles: number[] = [];
  for (let i = 0; i < NN; i++) if (salmon[i] >= 0 || eel[i] >= 0) tiles.push(i);
  return { salmon, eel, tiles };
}

/** How strong this year's runs are: thin in a lean year, thick in a year of plenty, and otherwise as the year falls out. */
export function runYear(s: Sim, year: number) {
  if (s.blightYear === year) return 0.5;
  if (s.plentyYear === year) return 1.4;
  return 0.75 + (hash3(s.world.params.seed, year, 4111) % 1000) / 1000 * 0.45;
}
/** The day of the year the salmon reach the river mouths this year. */
export function runStart(s: Sim, year: number) {
  return RUN_DAY - 1 + (hash3(s.world.params.seed, year, 4127) % 3);
}

/** Which run is passing a tile on a day of the year: 1 salmon, 2 eels, 0 none. */
export function runOn(s: Sim, i: number, dayOfYear = dayOf(s.tick) % DAYS_PER_YEAR, year = yearOf(s.tick)) {
  const sd = s.runs.salmon[i];
  if (sd >= 0) {
    const from = runStart(s, year) + Math.floor(sd / RUN_SPEED);
    if (dayOfYear >= from && dayOfYear < from + RUN_DAYS) return 1;
  }
  const ed = s.runs.eel[i];
  if (ed >= 0) {
    const from = EEL_DAY + Math.floor(ed / RUN_SPEED);
    if (dayOfYear >= from && dayOfYear < from + EEL_DAYS) return 2;
  }
  return 0;
}

/** The built weirs, by the tile they stand in. */
function weirTiles(s: Sim) {
  const out = new Map<number, Building>();
  for (const b of s.buildings) if (b.kind === 'weir' && b.built) out.set(b.tile, b);
  return out;
}

/**
 * Whether a weir stands between a tile and where its run comes from: below it on the way to the sea for the
 * salmon, above it on the way down from the lake for the eels.
 */
function weirBetween(s: Sim, i: number, run: number, weirs: Map<number, Building>) {
  if (!weirs.size) return false;
  const w = s.world, N = s.N;
  if (run === 1) {
    // down the river to the sea: a weir on the way (the river's breadth either side counts too: it spans it)
    let at = i;
    for (let k = 0; k <= RUN_REACH && at >= 0 && w.water[at] === WATER.River; k++) {
      if (k > 0 && weirs.has(at)) return true;
      if (w.flow[at] < 0) break;
      at = down(N, at, w.flow[at]);
    }
    return false;
  }
  // from each weir down the river: does the way pass this tile?
  for (const t of weirs.keys()) {
    if (s.runs.eel[t] < 0 || s.runs.eel[t] >= s.runs.eel[i]) continue;
    let at = t;
    for (let k = 0; k <= EEL_REACH && at >= 0 && w.water[at] === WATER.River; k++) {
      if (k > 0 && at === i) return true;
      if (w.flow[at] < 0) break;
      at = down(N, at, w.flow[at]);
    }
  }
  return false;
}

/** How many more fish a tile holds while a run passes it this year (0: no run there now). */
export function runExtra(s: Sim, i: number, weirs = weirTiles(s)) {
  const run = runOn(s, i);
  if (!run || (freshFrozen(s.tick) && s.world.water[i] !== WATER.Sea)) return 0;
  const k = runYear(s, yearOf(s.tick)) * (weirBetween(s, i, run, weirs) ? WEIR_PASS : 1);
  return run === 1 ? RUN_FISH * (1 - (0.6 * s.runs.salmon[i]) / RUN_REACH) * k : EEL_FISH * (1 - (0.5 * s.runs.eel[i]) / EEL_REACH) * k;
}

/**
 * Every six hours: the runs keep the rivers they are passing full (the water fished down filling again as
 * more come up), the run gone by leaves them as they were, and each weir's basket takes its share.
 */
export function runsTick(s: Sim) {
  const weirs = weirTiles(s);
  let changed = false;
  for (const i of s.runs.tiles) {
    const cap = s.fishCap[i];
    if (cap <= 0) continue;
    const extra = runExtra(s, i, weirs);
    if (extra > 0) {
      const want = cap + extra;
      if (s.fish[i] < want) { s.fish[i] += (want - s.fish[i]) * RUN_FILL; changed = true; }
    } else if (s.fish[i] > cap) {
      // the run has gone by: what is left of it has gone on up (or down) the river
      s.fish[i] = cap;
      changed = true;
    }
  }
  // the weirs: the fish nosing along the fence for a way through find the trap at its point
  if (!freshFrozen(s.tick)) {
    for (const b of weirs.values()) {
      for (const k of weirWater(s, b.tile)) {
        const room = WEIR_HOLDS - (b.catch ?? 0);
        if (room <= 0) break;
        const cap = s.fishCap[k];
        const take = Math.min(room, Math.max(0, s.fish[k] - cap) * WEIR_TAKE + Math.max(0, Math.min(s.fish[k], cap) - 1) * WEIR_TRICKLE);
        if (take <= 0) continue;
        s.fish[k] -= take;
        b.catch = (b.catch ?? 0) + take;
        changed = true;
      }
    }
  }
  if (changed) s.fishVersion++;
}

/** The water a weir fishes: the stretch it stands in, and the river just above and below it. */
export function weirWater(s: Sim, tile: number) {
  const f = s.world.flow[tile];
  const out = [tile];
  if (f < 0) return out;
  for (const d of [f, (f + 2) & 3]) {
    const j = down(s.N, tile, d);
    if (j >= 0 && s.fishCap[j] > 0) out.push(j);
  }
  return out;
}

/** A dry, walkable bank beside a weir to work from (-1: none). */
export function weirBank(s: Sim, tile: number) {
  const f = s.world.flow[tile];
  for (const d of f >= 0 ? [(f + 1) & 3, (f + 3) & 3] : [0, 1, 2, 3]) {
    const j = down(s.N, tile, d);
    if (j >= 0 && s.world.water[j] === WATER.None && s.grid.walkable(j)) return j;
  }
  return -1;
}

/** A weir's quarter turn: laid across the river, its point (and the trap) downstream. */
export function weirRot(flow: number) {
  // (the model's point is to +z at no turn; each quarter turn swings +z round toward +x)
  return flow === 2 ? 0 : flow === 1 ? 1 : flow === 0 ? 2 : 3;
}

/** Where to build a camp's weir: a narrow stretch of river near camp, with a bank either side, best where a run passes. */
export function weirSite(s: Sim, c: Camp) {
  const N = s.N, w = s.world;
  const cx = Math.floor(c.x), cz = Math.floor(c.z);
  const R = 20;
  let best = -1, bestS = -Infinity;
  for (let z = Math.max(1, cz - R); z <= Math.min(N - 2, cz + R); z++)
    for (let x = Math.max(1, cx - R); x <= Math.min(N - 2, cx + R); x++) {
      const i = z * N + x;
      if (w.water[i] !== WATER.River || w.flow[i] < 0 || s.fishCap[i] <= 0) continue;
      const d = Math.sqrt((x + 0.5 - c.x) * (x + 0.5 - c.x) + (z + 0.5 - c.z) * (z + 0.5 - c.z));
      if (d > R || d < 3) continue;
      // narrow: dry land either side, river above and below
      const f = w.flow[i];
      const a = down(N, i, (f + 1) & 3), b = down(N, i, (f + 3) & 3), up = down(N, i, (f + 2) & 3), dn = down(N, i, f);
      if (a < 0 || b < 0 || up < 0 || dn < 0) continue;
      if (w.water[a] !== WATER.None || w.water[b] !== WATER.None || !s.grid.walkable(a) || !s.grid.walkable(b)) continue;
      if (w.water[up] !== WATER.River || w.water[dn] !== WATER.River) continue;
      if ((s.unreachable.get(-3 * N * N - (a + 1)) ?? 0) > s.tick) continue;
      // (not on another weir's stretch)
      if (s.buildings.some((o) => o.kind === 'weir' && Math.abs(o.x - x) + Math.abs(o.z - z) < 4)) continue;
      // the nearer the sea, the thicker the salmon; any run is better than none
      const run = (s.runs.salmon[i] >= 0 ? 8 - (s.runs.salmon[i] / RUN_REACH) * 5 : 0) + (s.runs.eel[i] >= 0 ? 3 : 0);
      const sc = run - d * 0.25;
      if (sc > bestS) { bestS = sc; best = i; }
    }
  // (a stretch nobody can get to from camp is set aside for a while, and another looked for the next morning)
  const bank = best >= 0 ? weirBank(s, best) : -1;
  if (bank >= 0 && !s.grid.find(c.tile, bank)) {
    s.unreachable.set(-3 * N * N - (bank + 1), s.tick + 20 * TICKS_PER_DAY);
    return -1;
  }
  return best;
}

/** The runs near a camp now (within a day's fishing of it): 1 salmon, 2 eels, 0 none. */
export function runNear(s: Sim, c: Camp, r = 28) {
  let got = 0;
  for (const i of s.runs.tiles) {
    const x = (i % s.N) + 0.5, z = Math.floor(i / s.N) + 0.5;
    if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) > r * r) continue;
    const run = runOn(s, i);
    if (run === 1) return 1;
    if (run) got = run;
  }
  return got;
}
