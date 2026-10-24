// Shared fixtures for the test suite.
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS, WorldData, WATER, T } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR } from '../src/sim/time';

const worlds = new Map<string, WorldData>();
/** A generated world (cached per seed and size: the simulation never writes to it). */
export function world(seed: number, size = DEFAULT_PARAMS.size): WorldData {
  const key = `${seed}:${size}`;
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld({ ...DEFAULT_PARAMS, seed, size })));
  return w;
}

/** A fresh simulation of a seed's world. */
export function sim(seed: number, size = DEFAULT_PARAMS.size): Sim {
  return new Sim(world(seed, size));
}

/** Step a simulation up to an absolute tick. */
export function runTo(s: Sim, tick: number): Sim {
  while (s.tick < tick) s.step();
  return s;
}

/** Step a simulation forward by some game years. */
export function runYears(s: Sim, years: number): Sim {
  return runTo(s, s.tick + years * TICKS_PER_YEAR);
}

/**
 * A hand-made flat world for pathfinding tests: every tile grass at `level`, except where `paint`
 * says otherwise. Only the fields the pathfinder reads are filled in.
 */
export function flatWorld(N: number, paint?: (x: number, z: number) => { level?: number; terrain?: number; water?: number } | void): WorldData {
  const level = new Uint8Array(N * N).fill(6);
  const terrain = new Uint8Array(N * N).fill(T.Grass);
  const water = new Uint8Array(N * N).fill(WATER.None);
  const waterY = new Float32Array(N * N).fill(-1000);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const p = paint?.(x, z);
      if (!p) continue;
      const i = z * N + x;
      if (p.level !== undefined) level[i] = p.level;
      if (p.terrain !== undefined) terrain[i] = p.terrain;
      if (p.water !== undefined) {
        water[i] = p.water;
        waterY[i] = 6 * 0.45;
      }
    }
  return { size: N, level, terrain, water, waterY } as unknown as WorldData;
}
