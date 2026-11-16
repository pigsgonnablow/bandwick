// Mocking that won't stop: the tally of who has mocked whom, and what comes of it once it is relentless
// (the band stepping in, turning its back on the bully, and at last driving them out).
import { describe, it, expect } from 'vitest';
import { Person, PICKED_ON, RELENTLESS } from '../../src/sim/band';
import { TICKS_PER_YEAR, TICKS_PER_SEASON } from '../../src/sim/time';
import { sim } from '../helpers';
import type { Sim } from '../../src/sim/sim';

/** Two grown, unrelated members of the first band: a cruel one and a timid one; no one else will step in. */
function pair(s: Sim): [Person, Person] {
  const adults = s.members().filter((p) => s.age(p) >= 16);
  const bully = adults[0];
  const victim = adults.find((q) => q !== bully && !s.isKin(q, bully) && q.partner !== bully.id)!;
  for (const p of s.members()) p.traits = ['cautious'];
  bully.traits = ['cruel'];
  return [bully, victim];
}

describe('being mocked', () => {
  it('is tallied per mocker, and forgotten after a year', () => {
    const s = sim(1);
    const [bully, victim] = pair(s);
    s.mocked(bully, victim);
    s.mocked(bully, victim);
    expect(s.mockings(bully, victim)).toBe(2);
    expect(s.mockings(victim, bully)).toBe(0);
    expect(s.tormentor(victim)).toBeUndefined();
    s.tick += TICKS_PER_YEAR + 1;
    expect(s.mockings(bully, victim)).toBe(0);
  });

  it('wears the victim down once it is relentless, and marks who is tormenting them', () => {
    const s = sim(1);
    const [bully, victim] = pair(s);
    victim.belonging = 80;
    for (let i = 0; i < RELENTLESS; i++) s.mocked(bully, victim);
    expect(PICKED_ON).toBeLessThan(RELENTLESS);
    expect(s.tormentor(victim)).toBe(bully);
    expect(victim.memories.some((m) => m.kind === 'tormented' && m.subject === bully.id)).toBe(true);
    expect(victim.belonging).toBeLessThanOrEqual(50);
  });

  it('turns the band against a bully who keeps on after being told to stop, then drives them out', () => {
    const s = sim(1);
    const [bully, victim] = pair(s);
    const home = bully.band;
    bully.rebuked = s.tick;
    const others = s.members().filter((x) => x !== bully && x !== victim);
    const before = others.reduce((a, x) => a + s.opinion(x, bully), 0);
    for (let i = 0; i < RELENTLESS; i++) s.mocked(bully, victim);
    expect(s.events.some((e) => e.kind === 'bully_shun')).toBe(true);
    expect(bully.shunned).toBe(s.tick);
    expect(others.reduce((a, x) => a + s.opinion(x, bully), 0)).toBeLessThan(before);
    // and a while later, at it again
    s.tick += TICKS_PER_SEASON + 1;
    for (const x of others) s.adjust(x, bully, -100);
    for (let i = 0; i < PICKED_ON; i++) s.mocked(bully, victim);
    const out = s.events.find((e) => e.kind === 'exile');
    expect(out?.text).toContain('would not stop tormenting');
    expect(bully.band).not.toBe(home);
  });

  it('stops while the bully has been made to leave them be', () => {
    const s = sim(1);
    const [bully, victim] = pair(s);
    expect(s.spares(bully, victim)).toBe(false);
    victim.spared = [[bully.id, s.tick + 10]];
    expect(s.spares(bully, victim)).toBe(true);
    s.tick += 11;
    expect(s.spares(bully, victim)).toBe(false);
  });

  it('only counts a tormentor who still lives in the same band', () => {
    const s = sim(1);
    const [bully, victim] = pair(s);
    for (let i = 0; i < RELENTLESS; i++) s.mocked(bully, victim);
    expect(s.tormentor(victim)).toBe(bully);
    bully.band = -99;
    expect(s.tormentor(victim)).toBeUndefined();
  });

  it('never sends the one they tormented into exile with the bully, even their own partner', () => {
    const s = sim(1);
    const bully = s.members().find((p) => p.partner >= 0 && s.age(p) >= 16)!;
    const victim = s.byId.get(bully.partner)!;
    for (const p of s.members()) p.traits = ['cautious'];
    bully.traits = ['cruel'];
    s.adjust(victim, bully, 100);
    bully.shunned = s.tick - 2 * TICKS_PER_SEASON;
    for (const x of s.members()) if (x !== victim) s.adjust(x, bully, -200);
    for (let i = 0; i < PICKED_ON; i++) s.mocked(bully, victim);
    expect(s.events.some((e) => e.kind === 'exile')).toBe(true);
    expect(victim.band).not.toBe(bully.band);
  });

  it('does not count a small child\'s spite as bullying', () => {
    const s = sim(1);
    const [bully, victim] = pair(s);
    const child = s.members().find((x) => s.age(x) < 12)!;
    for (let i = 0; i < RELENTLESS + 2; i++) s.mocked(child, victim);
    expect(s.mockings(child, victim)).toBe(0);
    expect(child.shunned).toBeUndefined();
    expect(bully.band).toBe(victim.band);
  });
});
