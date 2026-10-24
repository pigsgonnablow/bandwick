import { describe, it, expect } from 'vitest';
import { worldName, Tongue } from '../../src/sim/names';
import { Rng } from '../../src/sim/rng';

describe('worldName', () => {
  it('is stable for a seed and varies between seeds', () => {
    expect(worldName(4471)).toBe(worldName(4471));
    const names = new Set(Array.from({ length: 20 }, (_, i) => worldName(i + 1)));
    expect(names.size).toBeGreaterThan(15);
  });

  it('is capitalised', () => {
    for (let s = 1; s <= 50; s++) expect(worldName(s)).toMatch(/^(The Isle of )?[A-Z][a-z]+$/);
  });
});

describe('Tongue', () => {
  it('makes short capitalised names, the same from the same stream', () => {
    const a = new Tongue(new Rng(5)), b = new Tongue(new Rng(5));
    for (let i = 0; i < 200; i++) {
      const sex = (i & 1) as 0 | 1;
      const n = a.name(sex);
      expect(n).toBe(b.name(sex));
      expect(n).toMatch(/^[A-Z][a-z]+$/);
      expect(n.length).toBeLessThanOrEqual(9);
      expect(n).not.toMatch(/[aeiouy]{3}/);
    }
  });

  it('never hands out an awkward real word', () => {
    const bad = ['dead', 'kill', 'doom', 'grave', 'evil', 'god', 'king', 'man', 'boy', 'girl'];
    for (let seed = 1; seed <= 40; seed++) {
      const t = new Tongue(new Rng(seed));
      for (let i = 0; i < 100; i++) expect(bad).not.toContain(t.name((i & 1) as 0 | 1).toLowerCase());
    }
  });

  it('names places', () => {
    expect(new Tongue(new Rng(2)).place()).toMatch(/^[A-Z][a-z]+(ford|mere|holt|stead|wick|hollow|brook)$/);
  });
});
