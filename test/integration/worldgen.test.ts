import { describe, it, expect } from 'vitest';
import { generateWorld } from '../../src/sim/worldgen';
import { DEFAULT_PARAMS, WATER, T, LEVELS } from '../../src/sim/types';
import { world } from '../helpers';

describe('generateWorld', () => {
  it('makes the same world from the same seed', () => {
    const a = generateWorld({ ...DEFAULT_PARAMS, seed: 77, size: 64 });
    const b = generateWorld({ ...DEFAULT_PARAMS, seed: 77, size: 64 });
    expect(a.hash).toBe(b.hash);
    expect(Buffer.from(a.level).equals(Buffer.from(b.level))).toBe(true);
    expect(Buffer.from(a.propPos.buffer).equals(Buffer.from(b.propPos.buffer))).toBe(true);
  });

  it('makes different worlds from different seeds', () => {
    expect(world(1, 64).hash).not.toBe(world(2, 64).hash);
  });

  for (const seed of [1, 2, 3]) {
    it(`gives seed ${seed} a well-formed island`, () => {
      const w = world(seed);
      const N = w.size;
      expect(N).toBe(DEFAULT_PARAMS.size);
      for (const a of [w.level, w.groundY, w.terrain, w.water, w.waterY, w.flow, w.moisture, w.fertility]) expect(a.length).toBe(N * N);
      expect(w.colorTex.length).toBe(w.texSize * w.texSize * 4);

      // (problems are counted rather than asserted tile by tile: 16k expects would be slow)
      let land = 0, sea = 0;
      const bad: Record<string, number> = {};
      const no = (k: string) => (bad[k] = (bad[k] ?? 0) + 1);
      for (let i = 0; i < N * N; i++) {
        if (w.level[i] >= LEVELS) no('level too high');
        if (w.terrain[i] > T.Mountain) no('unknown terrain');
        if (!Number.isFinite(w.groundY[i])) no('ground height not finite');
        if (w.water[i] === WATER.None) land++;
        if (w.water[i] === WATER.Sea) sea++;
        // dry land has no water surface; water lies above its bed
        if (w.water[i] === WATER.None ? w.waterY[i] !== -1000 : w.waterY[i] < w.groundY[i] - 1e-6) no('water surface wrong');
      }
      // it is an island: the edge of the map is sea
      for (let k = 0; k < N; k++)
        for (const i of [k, (N - 1) * N + k, k * N, k * N + N - 1]) if (w.water[i] !== WATER.Sea) no('edge not sea');
      // props sit on the map, on their own tile
      for (let k = 0; k < w.propCount; k++) {
        const x = w.propPos[k * 3], z = w.propPos[k * 3 + 2];
        if (!(x >= 0 && x < N && z >= 0 && z < N)) no('prop off the map');
        else if (w.propTile[k] !== Math.floor(z) * N + Math.floor(x)) no('prop on the wrong tile');
      }
      expect(bad).toEqual({});
      expect(land / (N * N)).toBeGreaterThan(0.2);
      expect(sea).toBeGreaterThan(0);
      expect(w.propCount).toBeGreaterThan(100);
    });
  }
});
