// The dugout canoe: where a band draws one up, and where its fisher paddles out to.
// A canoe lies on a bank of a lake, a wide river or the sea; from there it reaches the open water, the fishing water
// (lake, river or the shallows along the coast) with no bank beside it, which nobody fishing from the shore can get at.
import type { Sim, Camp } from './sim';
import type { Building } from './band';
import { CANOE_REACH, CANOE_OPEN } from './band';
import { WATER, DIRS4 } from './types';
import { freshFrozen } from './time';

/** Fishing water with no dry ground beside it: out of the reach of anyone on the bank. */
export function openWater(s: Sim, i: number) {
  const N = s.N;
  if (s.world.water[i] === WATER.None || s.fishCap[i] <= 0) return false;
  const x = i % N, z = Math.floor(i / N);
  for (const [dx, dz] of DIRS4) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) return false;
    if (s.world.water[nz * N + nx] === WATER.None) return false;
  }
  return true;
}

/** Whether a canoe can be paddled in a straight line from one point to another, over water all the way (the first step off the bank aside). */
export function clearRun(s: Sim, x0: number, z0: number, x1: number, z1: number) {
  const N = s.N;
  const d = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(d / 0.25);
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
    if (Math.hypot(x - x0, z - z0) < 0.8) continue;
    if (s.world.water[Math.floor(z) * N + Math.floor(x)] === WATER.None) return false;
  }
  return true;
}

const reachCache = new WeakMap<object, Map<number, number[]>>();
/** The open water a canoe drawn up here could fish (tiles within its reach, over clear water). The water never moves: kept once worked out. */
export function openReach(s: Sim, tile: number) {
  let m = reachCache.get(s.world);
  if (!m) reachCache.set(s.world, (m = new Map()));
  let out = m.get(tile);
  if (!out) m.set(tile, (out = reach(s, tile)));
  return out;
}
function reach(s: Sim, tile: number) {
  const N = s.N, x0 = (tile % N) + 0.5, z0 = Math.floor(tile / N) + 0.5;
  const out: number[] = [];
  const R = CANOE_REACH;
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R) continue;
      const x = Math.floor(x0) + dx, z = Math.floor(z0) + dz;
      if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
      const i = z * N + x;
      if (!openWater(s, i)) continue;
      if (!clearRun(s, x0, z0, x + 0.5, z + 0.5)) continue;
      out.push(i);
    }
  return out;
}

/** Where a band draws up its canoe: a bank near camp with the most open water within reach (-1: none good enough). */
export function canoeSite(s: Sim, c: Camp) {
  const N = s.N;
  const cx = Math.floor(c.x), cz = Math.floor(c.z);
  const R = 22;
  let best = -1, bestS = -Infinity;
  for (const i of s.fishingSpots) {
    const x = i % N, z = Math.floor(i / N);
    if (Math.abs(x - cx) > R || Math.abs(z - cz) > R) continue;
    const d = Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z);
    if (d > R || d < 3) continue;
    if (!s.grid.walkable(i)) continue;
    if (s.buildings.some((b) => b.tile === i)) continue;
    if ((s.unreachable.get(-3 * N * N - (i + 1)) ?? 0) > s.tick) continue;
    const open = openReach(s, i);
    if (open.length < CANOE_OPEN) continue;
    const sc = Math.min(40, open.length) - d * 0.6;
    if (sc > bestS) { bestS = sc; best = i; }
  }
  if (best >= 0 && !s.grid.find(c.tile, best)) {
    s.unreachable.set(-3 * N * N - (best + 1), s.tick + 20 * 240);
    return -1;
  }
  return best;
}

/** The band's canoe, drawn up on the bank and free to take out (none while the lakes are frozen). */
export function freeCanoe(s: Sim, c: Camp): Building | undefined {
  if (freshFrozen(s.tick)) return undefined;
  return s.buildings.find((b) => b.kind === 'canoe' && b.built && b.band === c.id && b.out === undefined);
}

/** The open water to paddle out to from a canoe's landing: the most fish, not too far (-1: none worth it). */
export function canoeTarget(s: Sim, b: Building) {
  const x0 = b.x + 0.5, z0 = b.z + 0.5;
  let best = -1, bestS = -Infinity;
  for (const i of openReach(s, b.tile)) {
    if (s.fish[i] < 2) continue;
    const d = Math.hypot((i % s.N) + 0.5 - x0, Math.floor(i / s.N) + 0.5 - z0);
    const sc = s.fish[i] / (d + 4);
    if (sc > bestS) { bestS = sc; best = i; }
  }
  return best;
}

/** How rich the open water within a canoe's reach is, from 0 (fished out) to 1. */
export function openStock(s: Sim, b: Building) {
  let have = 0, cap = 0;
  for (const i of openReach(s, b.tile)) { have += s.fish[i]; cap += s.fishCap[i]; }
  return cap > 0 ? have / cap : 0;
}

/** How a canoe drawn up on a bank lies: its bow to the water (quarter turns; +z at none, each turn swinging +z round toward +x). */
export function canoeRot(s: Sim, tile: number) {
  const N = s.N, x = tile % N, z = Math.floor(tile / N);
  let best = 0, bestN = -1;
  const dirs: [number, number, number][] = [[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]];
  for (const [dx, dz, rot] of dirs) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
    // (toward the most water: a bend's open side)
    let n = 0;
    for (let k = 1; k <= 3; k++) {
      const i = (z + dz * k) * N + x + dx * k;
      if (z + dz * k < 0 || z + dz * k >= N || x + dx * k < 0 || x + dx * k >= N) break;
      if (s.world.water[i] !== WATER.None) n++;
      else break;
    }
    if (n > bestN) { bestN = n; best = rot; }
  }
  return best;
}
