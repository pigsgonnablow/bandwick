import { describe, it, expect } from 'vitest';
import { generateWorld, resolveShape } from '../../src/sim/worldgen';
import { Grid } from '../../src/sim/path';
import { DEFAULT_PARAMS, NEW_WORLD_PARAMS, MAP_SHAPES, WATER, T, LEVELS, DIRS4 } from '../../src/sim/types';
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { runChecked } from '../../tools/lib/invariants';
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

  it('makes the larger map the game offers, an island a band can settle and live on', () => {
    const w = world(4471, 256);
    const N = w.size;
    expect(N).toBe(256);
    for (let k = 0; k < N; k++)
      for (const i of [k, (N - 1) * N + k, k * N, k * N + N - 1]) expect(w.water[i]).toBe(WATER.Sea);
    let land = 0;
    for (let i = 0; i < N * N; i++) if (w.water[i] === WATER.None) land++;
    expect(land / (N * N)).toBeGreaterThan(0.2);
    const s = new Sim(w);
    expect(s.living().length).toBe(10);
    for (const p of s.living()) expect(s.grid.walkable(s.tileOf(p))).toBe(true);
    // a season on it breaks nothing
    const checker = runChecked(s, 0.25);
    expect(checker.report()).toEqual([]);
    expect(s.tick).toBeGreaterThan(12 * TICKS_PER_DAY);
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

  it('keeps an old world (one with no lie of land named) an island, and picks a lie of land from the seed for a new one', () => {
    expect(resolveShape({ ...DEFAULT_PARAMS, seed: 5 })).toBe('island');
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) seen.add(resolveShape({ ...NEW_WORLD_PARAMS, seed }));
    expect([...seen].sort()).toEqual([...MAP_SHAPES].sort());
  });

  // the first band comes in by boat: whatever the lie of the land, there is sea, and a beach on it the band can walk up from to its camp
  for (const shape of MAP_SHAPES)
    it(`gives every ${shape} sea to sail in on and a beach the first camp can be walked to from`, () => {
      for (const seed of [11, 12, 13, 14]) {
        const w = generateWorld({ ...DEFAULT_PARAMS, seed, shape });
        expect(w.shape).toBe(shape);
        const N = w.size;
        let sea = 0, land = 0;
        for (let i = 0; i < N * N; i++) {
          if (w.water[i] === WATER.Sea) sea++;
          if (w.water[i] === WATER.None) land++;
        }
        expect(sea / (N * N), `${shape} ${seed}: sea`).toBeGreaterThan(0.04);
        expect(land / (N * N), `${shape} ${seed}: land`).toBeGreaterThan(0.3);
        const s = new Sim(w);
        const camp = s.camps[0];
        expect(camp, `${shape} ${seed}: a camp`).toBeTruthy();
        // walk out from the camp, as the opening scene does, until a step from the sea
        const g = new Grid(w);
        const dry = (i: number) => w.water[i] === WATER.None && g.walkable(i);
        const seen = new Uint8Array(N * N);
        const q = [camp.tile];
        seen[camp.tile] = 1;
        let beach = -1;
        for (let k = 0; k < q.length && beach < 0; k++) {
          const i = q[k], x = i % N, z = (i / N) | 0;
          for (const [dx, dz] of DIRS4) {
            const nx = x + dx, nz = z + dz;
            if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue;
            const j = nz * N + nx;
            if (w.water[j] === WATER.Sea) { beach = i; break; }
            if (!seen[j] && dry(j) && g.step(i, j)) { seen[j] = 1; q.push(j); }
          }
        }
        expect(beach, `${shape} ${seed}: a beach to land on`).toBeGreaterThanOrEqual(0);
      }
    });

  it('lets a band live a season on land that runs off the edge of the map', () => {
    const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed: 21, shape: 'lakeland' }));
    const checker = runChecked(s, 0.25);
    expect(checker.report()).toEqual([]);
  });
});

describe('land that runs on past the edge of the map', () => {
  it('keeps the animals on the map', () => {
    for (const [shape, seed] of [['coast', 1], ['peninsula', 3]] as const) {
      const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, shape }));
      const N = s.N;
      for (let day = 0; day < 40; day++) {
        for (let k = 0; k < TICKS_PER_DAY; k++) s.step();
        for (const a of [...s.deer, ...s.wolves, ...s.beasts]) {
          if (!a.alive) continue;
          const on = a.x >= 0 && a.z >= 0 && a.x <= N && a.z <= N;
          expect(on, `${shape} ${seed}, day ${day}: an animal at ${a.x.toFixed(1)}, ${a.z.toFixed(1)}`).toBe(true);
        }
      }
    }
  });

  it('pairs nobody off with a band across a sound they cannot walk to', () => {
    const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed: 3, shape: 'strait' }));
    const any = s as any;
    const a = s.camps[0];
    const b = any.foundBand(true);
    expect(s.reaches(a, b)).toBe(false);
    // bring the far band's camp to just across the water, near enough as the crow flies to meet
    const N = s.N, g = s.grid;
    let tile = -1;
    for (let i = 0; i < N * N && tile < 0; i++) {
      const x = i % N, z = (i / N) | 0, d = Math.hypot(x - a.x, z - a.z);
      if (d > 18 && d < 36 && s.world.water[i] === WATER.None && g.walkable(i) && !g.find(a.tile, i, true, 40000)) tile = i;
    }
    expect(tile).toBeGreaterThanOrEqual(0);
    b.tile = tile;
    b.x = (tile % N) + 0.5;
    b.z = ((tile / N) | 0) + 0.5;
    expect(s.reaches(a, b)).toBe(false);
    // (and young people on both sides who would pair off, if they could meet)
    for (const p of s.people) p.samesex = false;
    const bandOf = new Map(s.people.map((p) => [p.id, p.band]));
    for (let k = 0; k < 300; k++) any.considerMatches();
    for (const p of s.people) expect(p.band, `${p.name} went across the water`).toBe(bandOf.get(p.id));
  });
});
