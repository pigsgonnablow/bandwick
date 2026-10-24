import { describe, it, expect } from 'vitest';
import { Simplex } from '../../src/sim/noise';
import { Rng } from '../../src/sim/rng';

describe('Simplex', () => {
  it('is deterministic for a seed', () => {
    const a = new Simplex(new Rng(3)), b = new Simplex(new Rng(3));
    for (let i = 0; i < 200; i++) expect(a.noise(i * 0.37, i * -0.21)).toBe(b.noise(i * 0.37, i * -0.21));
  });

  it('differs between seeds', () => {
    const a = new Simplex(new Rng(3)), b = new Simplex(new Rng(4));
    let same = 0;
    for (let i = 0; i < 200; i++) if (a.noise(i * 0.37, i * 0.53) === b.noise(i * 0.37, i * 0.53)) same++;
    expect(same).toBeLessThan(10);
  });

  it('stays within [-1, 1] and actually varies', () => {
    const n = new Simplex(new Rng(8));
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < 60; x += 0.29) for (let y = 0; y < 60; y += 0.31) {
      const v = n.noise(x, y);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(1);
  });
});
