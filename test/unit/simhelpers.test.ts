import { describe, it, expect } from 'vitest';
import { compass, clamp, clamp01, art, hyp, b64, unb64, isTreeType, treeSpecies, treeStage } from '../../src/sim/sim';
import { treeId, PROP_NAMES, propId, SPECIES, STAGES, TREE_VARIANTS } from '../../src/sim/types';
import { foodTotal } from '../../src/sim/band';

describe('compass', () => {
  it('names the eight directions (north is -z)', () => {
    expect(compass(0, -1)).toBe('north');
    expect(compass(1, -1)).toBe('north-east');
    expect(compass(1, 0)).toBe('east');
    expect(compass(1, 1)).toBe('south-east');
    expect(compass(0, 1)).toBe('south');
    expect(compass(-1, 1)).toBe('south-west');
    expect(compass(-1, 0)).toBe('west');
    expect(compass(-1, -1)).toBe('north-west');
  });
});

describe('small helpers', () => {
  it('clamps needs to 0..100 and fractions to a range', () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(50)).toBe(50);
    expect(clamp(150)).toBe(100);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(5, 2, 4)).toBe(4);
  });

  it('picks the right article', () => {
    expect(art('oak')).toBe('an');
    expect(art('pine')).toBe('a');
    expect(art('Elder')).toBe('an');
  });

  it('measures distance', () => {
    expect(hyp(3, 4)).toBe(5);
  });

  it('adds up food but not wood or fiber', () => {
    expect(foodTotal({ berries: 1, meat: 2, fish: 3, preserved: 4, wood: 100, fiber: 7, cordage: 5, mud: 9, stone: 11 })).toBe(10);
  });
});

describe('base64 for typed arrays', () => {
  it('round-trips bytes, including a large array and a view into a larger buffer', () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 31) & 255);
    expect(Array.from(unb64(b64(big)))).toEqual(Array.from(big));
    const f = new Float32Array([1.5, -2.25, Math.PI, 0]);
    const back = new Float32Array(unb64(b64(f)).buffer);
    expect(Array.from(back)).toEqual(Array.from(f));
    const view = new Uint8Array([9, 9, 1, 2, 3, 9]).subarray(2, 5);
    expect(Array.from(unb64(b64(view)))).toEqual([1, 2, 3]);
  });
});

describe('prop catalogue', () => {
  it('encodes and decodes tree species and stage', () => {
    for (let sp = 0; sp < SPECIES.length; sp++)
      for (let st = 0; st < STAGES; st++)
        for (let v = 0; v < TREE_VARIANTS; v++) {
          const id = treeId(sp, st, v);
          expect(isTreeType(id)).toBe(true);
          expect(treeSpecies(id)).toBe(sp);
          expect(treeStage(id)).toBe(st);
        }
  });

  it('has unique names that look themselves up', () => {
    expect(new Set(PROP_NAMES).size).toBe(PROP_NAMES.length);
    PROP_NAMES.forEach((n, i) => expect(propId(n)).toBe(i));
  });
});
