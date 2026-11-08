// Trapping for fur: deadfalls at the fox earths and beaver lodges, pelts brought home on the round of the
// traps, fur cloaks sewn from them for whoever feels the cold most, and the tusks kept from a boar.
import { describe, it, expect } from 'vitest';
import { BEAST, CARRY, Item, Person, FURS_PER_CLOAK, GARMENTS, TUSKS_PER_BOAR, TEETH_PER_DEER } from '../../src/sim/band';
import { DISCOVERIES } from '../../src/sim/know';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { deadfallNight, denFor, DEADFALL_RANGE } from '../../src/sim/beasts';
import { deposit } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo } from '../helpers';

const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);
const always = { chance: () => true };
const tileBy = (s: Sim, x: number, z: number) => s.tileOf({ x, z });

describe('trapping for fur', () => {
  it('is a discovery that builds on snares, made at the work with foxes and beavers', () => {
    const d = DISCOVERIES.find((q) => q.key === 'furs')!;
    expect(d.needs).toEqual(['snares']);
    expect(d.practice.fur).toBeGreaterThan(0);
  });

  it('takes a fox or a beaver in a deadfall at its earth or lodge, but never the last one there', () => {
    const s = sim(1);
    const den = s.dens.find((d) => d.kind === BEAST.Fox)!;
    const group = () => s.beasts.filter((b) => b.alive && b.den === den.id);
    expect(group().length).toBeGreaterThanOrEqual(2);
    const it: { tile?: number; catch?: number; pelt?: number } = { tile: tileBy(s, den.x, den.z) };
    expect(denFor(s, it.tile!)).toBe(den);
    deadfallNight(s, it, always);
    expect(it.catch).toBe(1);
    expect(it.pelt).toBe(BEAST.Fox);
    expect(s.beasts.some((b) => b.den === den.id && b.killed)).toBe(true);
    // down to the last of them: the deadfall takes nothing more there
    for (const b of group().slice(1)) b.alive = false;
    expect(denFor(s, it.tile!)).toBeUndefined();
    it.catch = 0;
    deadfallNight(s, it, always);
    expect(it.catch).toBe(0);
    expect(group().length).toBe(1);
  });

  it('brings the pelts home on the round of the traps, once the band knows how', () => {
    const s = sim(1);
    expect(s.dens.some((d) => d.kind === BEAST.Fox && hyp(d.x - s.camp.x, d.z - s.camp.z) < DEADFALL_RANGE)).toBe(true);
    s.camp.knows.push('snares', 'furs');
    let made = false;
    const end = s.tick + 160 * TICKS_PER_DAY;
    while (s.tick < end && !(s.camp.ledger?.total['gathered.furs'] ?? 0)) {
      s.step();
      made ||= s.items.some((i) => i.kind === 'deadfall' && (i.tile ?? -1) >= 0);
    }
    expect(made).toBe(true);
    expect(s.camp.ledger?.total['gathered.furs']).toBeGreaterThan(0);
  });

  it('sews the pelts into fur cloaks, which go to whoever feels the cold most, ahead of a hide cloak', () => {
    const s = sim(2);
    s.camp.knows.push('furs', 'cloaks');
    s.camp.stock.furs = FURS_PER_CLOAK;
    s.camp.stock.cordage = 3;
    expect(s.toolToMake()).toBe('furcloak');
    expect(GARMENTS.furcloak.warm).toBeGreaterThan(GARMENTS.cloak.warm);
    // a fur cloak laid on the pile is handed out, and the hide cloak it replaces goes back on the pile
    const old = s.living().sort((a, b) => s.age(b) - s.age(a))[0] as Person;
    const hide = { id: s.newId(), kind: 'cloak' as const, band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1 };
    s.items.push(hide);
    s.dress(old, hide);
    const fur: Item = { id: s.newId(), kind: 'furcloak', band: s.camp.id, holder: -1, wear: 0, made: s.tick, maker: -1 };
    s.items.push(fur);
    runTo(s, s.tick + TICKS_PER_DAY + 2);
    expect(fur.wearer).toBeDefined();
    const wearer = s.byId.get(fur.wearer!)!;
    expect(s.dressFlags(wearer) & 256).toBe(256);
    expect(s.coldKept(wearer)).toBeGreaterThanOrEqual(GARMENTS.furcloak.warm - 1e-9);
  });

  it('keeps a boar’s tusks with the teeth for ornaments', () => {
    const s = sim(1);
    const p = s.living().find((q) => s.age(q) >= 18)!;
    s.camp.stock.trinkets = 0;
    p.task = { kind: 'hunt', stage: 2, goal: 0, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false, boar: true };
    p.carry = CARRY.Meat;
    p.carryAmt = 10;
    deposit(s, p);
    expect(s.camp.stock.trinkets).toBe(TEETH_PER_DEER + TUSKS_PER_BOAR);
  });
});
