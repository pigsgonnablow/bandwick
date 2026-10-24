import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/path';
import { T, WATER } from '../../src/sim/types';
import { flatWorld } from '../helpers';

const N = 12;
const idx = (x: number, z: number) => z * N + x;
const coords = (path: Int32Array) => Array.from(path, (i) => [i % N, Math.floor(i / N)]);
/** every consecutive pair of tiles in a path (including the start) is a legal single move */
function expectLegal(g: Grid, from: number, path: Int32Array) {
  let prev = from;
  for (const t of path) {
    const dx = Math.abs((t % N) - (prev % N)), dz = Math.abs(Math.floor(t / N) - Math.floor(prev / N));
    expect(Math.max(dx, dz)).toBe(1);
    expect(g.step(prev, t)).toBe(true);
    prev = t;
  }
}

describe('Grid', () => {
  it('walks a straight line on open ground', () => {
    const g = new Grid(flatWorld(N));
    const path = g.find(idx(1, 5), idx(8, 5))!;
    expect(path).not.toBeNull();
    expect(path.length).toBe(7);
    expect(path[path.length - 1]).toBe(idx(8, 5));
    expectLegal(g, idx(1, 5), path);
  });

  it('returns an empty path when already there', () => {
    expect(new Grid(flatWorld(N)).find(idx(3, 3), idx(3, 3))!.length).toBe(0);
  });

  it('goes around deep water and can wade shallow water', () => {
    const deep = new Grid(flatWorld(N, (x, z) => (x === 5 && z < 10 ? { terrain: T.DeepWater, water: WATER.Lake } : undefined)));
    const around = deep.find(idx(2, 2), idx(8, 2))!;
    expect(around).not.toBeNull();
    expect(coords(around).some(([x, z]) => x === 5 && z >= 10)).toBe(true);
    expectLegal(deep, idx(2, 2), around);

    const wall = new Grid(flatWorld(N, (x) => (x === 5 ? { terrain: T.DeepWater, water: WATER.Lake } : undefined)));
    expect(wall.find(idx(2, 2), idx(8, 2))).toBeNull();

    const ford = new Grid(flatWorld(N, (x) => (x === 5 ? { terrain: T.ShallowWater, water: WATER.River } : undefined)));
    expect(ford.find(idx(2, 2), idx(8, 2))).not.toBeNull();
  });

  it('climbs one terrace at a time but not a cliff', () => {
    const step = new Grid(flatWorld(N, (x) => (x >= 6 ? { level: 7 } : undefined)));
    expect(step.find(idx(2, 2), idx(9, 2))).not.toBeNull();
    const cliff = new Grid(flatWorld(N, (x) => (x >= 6 ? { level: 8 } : undefined)));
    expect(cliff.find(idx(2, 2), idx(9, 2))).toBeNull();
  });

  it('never cuts a corner past a blocked tile', () => {
    // a single blocked tile at (5,5): going (4,4) -> (6,6) must not squeeze diagonally past it
    const g = new Grid(flatWorld(N, (x, z) => (x === 5 && z === 5 ? { terrain: T.DeepWater, water: WATER.Lake } : undefined)));
    const path = g.find(idx(4, 4), idx(6, 6))!;
    expect(path).not.toBeNull();
    expectLegal(g, idx(4, 4), path);
    let prev = idx(4, 4);
    for (const t of path) {
      const px = prev % N, pz = Math.floor(prev / N), tx = t % N, tz = Math.floor(t / N);
      if (px !== tx && pz !== tz) {
        expect(g.walkable(idx(tx, pz))).toBe(true);
        expect(g.walkable(idx(px, tz))).toBe(true);
      }
      prev = t;
    }
  });

  it('with `near`, stops next to an unreachable goal', () => {
    const g = new Grid(flatWorld(N, (x, z) => (x === 8 && z === 8 ? { terrain: T.DeepWater, water: WATER.Lake } : undefined)));
    expect(g.find(idx(2, 2), idx(8, 8))).toBeNull();
    const path = g.find(idx(2, 2), idx(8, 8), true)!;
    expect(path).not.toBeNull();
    const [ex, ez] = coords(path).at(-1)!;
    expect(Math.max(Math.abs(ex - 8), Math.abs(ez - 8))).toBe(1);
  });

  it('gives the same path again after the cache is cleared', () => {
    const g = new Grid(flatWorld(N, (x, z) => (x === 5 && z > 1 ? { level: 9 } : undefined)));
    const a = Array.from(g.find(idx(1, 9), idx(10, 9))!);
    g.invalidate();
    expect(Array.from(g.find(idx(1, 9), idx(10, 9))!)).toEqual(a);
  });
});
