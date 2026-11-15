// Accidents and the hurts they leave: a lame leg, one eye, a crippled hand. Some mend in months, some last
// for life; while they last they slow someone down, keep them off the hunt and spoil their throw.
import { describe, it, expect } from 'vitest';
import { Person } from '../../src/sim/band';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/time';
import { sim } from '../helpers';
import { decide } from '../../src/sim/ai';
import type { Sim } from '../../src/sim/sim';

const grownUp = (s: Sim): Person => s.members().find((p) => s.age(p) >= 20 && s.age(p) < 40)!;

describe('a lasting hurt', () => {
  it('mends in its time, and then is gone', () => {
    const s = sim(1);
    const p = grownUp(s);
    p.lame = s.tick + 3 * TICKS_PER_DAY;
    expect(s.hurt(p, 'lame')).toBe(true);
    s.camp = s.campOf(p);
    while (s.tick < p.lame! + TICKS_PER_DAY) s.step();
    expect(s.hurt(p, 'lame')).toBe(false);
    expect(p.lame).toBeUndefined();
    expect(p.memories.some((m) => m.kind === 'healed')).toBe(true);
  });

  it('for life stays for life, and a later mend does not cut it short', () => {
    const s = sim(1);
    const p = grownUp(s);
    p.oneEye = -1;
    for (let i = 0; i < 20; i++) s.maim(p, 'oneEye', 1, 0, [5, 10]);
    expect(p.oneEye).toBe(-1);
    s.camp = s.campOf(p);
    const end = s.tick + TICKS_PER_YEAR / 4;
    while (s.tick < end) s.step();
    expect(s.hurt(p, 'oneEye')).toBe(true);
  });

  it('keeps the lame off the hunt and the swim, and shows on the card', () => {
    const s = sim(1);
    const p = grownUp(s);
    p.lame = -1;
    for (let i = 0; i < 400; i++) {
      p.task = null;
      decide(s, p);
      expect((p.task as { kind: string } | null)?.kind).not.toBe('hunt');
      expect((p.task as { kind: string } | null)?.kind).not.toBe('swim');
    }
    expect(s.inspect(p.id)!.hurts).toEqual(['lame']);
    p.badHand = s.tick + TICKS_PER_DAY * 10;
    expect(s.inspect(p.id)!.hurts).toEqual(['lame', 'a bad hand, mending']);
  });
});

describe('accidents', () => {
  it('hurt but never kill outright, and leave fresh wounds and lasting hurts among many', () => {
    const s = sim(1);
    const people = s.members().filter((p) => s.age(p) >= 5);
    const before = s.stats.deaths;
    let wounded = 0, hurt = 0;
    for (let i = 0; i < 300; i++) {
      const p = people[i % people.length];
      p.health = 100;
      delete p.lame; delete p.oneEye; delete p.badHand; delete p.wounded;
      s.accident(p);
      expect(p.health).toBeGreaterThan(0);
      if ((p.wounded ?? 0) > s.tick) wounded++;
      if (s.hurt(p, 'lame') || s.hurt(p, 'oneEye') || s.hurt(p, 'badHand')) hurt++;
    }
    expect(s.stats.deaths).toBe(before);
    expect(wounded).toBeGreaterThan(50);
    expect(hurt).toBeGreaterThan(50);
    expect(s.events.some((e) => e.kind === 'injury')).toBe(true);
  });

  it('tells a death from a wound gone bad, a fall or a bite as such', () => {
    const s = sim(1);
    const [a, b, c] = s.members().filter((p) => s.age(p) >= 14);
    s.kill(a, 'wound');
    expect(s.events.at(-1)!.text).toContain('died of a wound gone bad');
    s.kill(b, 'fall');
    expect(s.events.at(-1)!.text).toContain('died in a fall');
    s.kill(c, 'bite');
    expect(s.events.at(-1)!.text).toContain('died of an adder bite');
  });
});
