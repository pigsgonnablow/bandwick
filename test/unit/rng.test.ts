import { describe, it, expect } from 'vitest';
import { Rng, hashString, hash3, hash01 } from '../../src/sim/rng';

describe('hashString', () => {
  it('is 32-bit FNV-1a', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });
});

describe('hash3 / hash01', () => {
  it('is a pure function of its inputs', () => {
    expect(hash3(1, 2, 3)).toBe(hash3(1, 2, 3));
    expect(hash3(1, 2, 3)).not.toBe(hash3(3, 2, 1));
  });
  it('returns unsigned 32-bit integers and floats in [0,1)', () => {
    for (let i = 0; i < 1000; i++) {
      const h = hash3(i, -i, i * 7);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
      const f = hash01(i, 3, 9);
      expect(f >= 0 && f < 1).toBe(true);
    }
  });
});

describe('Rng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('gives different sequences for different seeds', () => {
    const a = new Rng(1), b = new Rng(2);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    expect(sa).not.toEqual(sb);
  });

  it('survives an all-zero seed', () => {
    const r = new Rng(0);
    const vals = new Set(Array.from({ length: 16 }, () => r.nextU32()));
    expect(vals.size).toBeGreaterThan(1);
  });

  it('keeps every helper within its bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 5000; i++) {
      const f = r.next();
      expect(f >= 0 && f < 1).toBe(true);
      const x = r.range(-3, 5);
      expect(x >= -3 && x < 5).toBe(true);
      const n = r.int(2, 6);
      expect(Number.isInteger(n) && n >= 2 && n < 6).toBe(true);
    }
  });

  it('reaches every value of int() and pick()', () => {
    const r = new Rng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(0, 5));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    const picked = new Set<string>();
    for (let i = 0; i < 500; i++) picked.add(r.pick(['a', 'b', 'c']));
    expect(picked.size).toBe(3);
  });

  it('chance(p) lands near p', () => {
    const r = new Rng(11);
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (r.chance(0.3)) hits++;
    expect(hits / 20000).toBeCloseTo(0.3, 1);
    expect(r.chance(0)).toBe(false);
  });

  it('round-trips its state exactly (saves depend on this)', () => {
    const a = new Rng(123);
    for (let i = 0; i < 37; i++) a.next();
    const b = new Rng(999);
    b.setState(a.getState());
    for (let i = 0; i < 100; i++) expect(b.nextU32()).toBe(a.nextU32());
  });

  it('gives named streams that do not depend on each other', () => {
    const life = Rng.stream(5, 'life');
    const ai = Rng.stream(5, 'ai');
    expect(life.nextU32()).not.toBe(ai.nextU32());
    // drawing from one stream leaves another untouched
    const fresh = Rng.stream(5, 'ai');
    const used = Rng.stream(5, 'ai');
    Rng.stream(5, 'life').next();
    expect(used.nextU32()).toBe(fresh.nextU32());
  });
});
