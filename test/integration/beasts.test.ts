// Wild boar, foxes and beavers: where they live, what they do to the land, and the band's dealings with them.
import { describe, it, expect } from 'vitest';
import { BEAST, CARRY, Person, Task } from '../../src/sim/band';
import { TICKS_PER_DAY, TICKS_PER_SEASON, seasonOf } from '../../src/sim/time';
import { WATER } from '../../src/sim/types';
import { runTask } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo } from '../helpers';

const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);
const notes = (s: Sim, start: string) => [...s.propNote.values()].filter((n) => n.startsWith(start));
const adult = (s: Sim) => s.living().find((q) => s.age(q) >= 18 && s.age(q) <= 50)! as Person;

describe('the wild beasts', () => {
  it('live away from the camp: sounders and earths on dry land, lodges in the water', () => {
    const s = sim(1);
    for (const k of [BEAST.Boar, BEAST.Fox, BEAST.Beaver]) expect(s.beasts.some((b) => b.alive && b.kind === k)).toBe(true);
    for (const d of s.dens) {
      expect(hyp(d.x - s.camp.x, d.z - s.camp.z)).toBeGreaterThan(8);
      const w = s.world.water[s.tileOf(d)];
      if (d.kind === BEAST.Beaver) expect(w === WATER.River || w === WATER.Lake).toBe(true);
      else expect(w).toBe(WATER.None);
    }
  });

  it('keep boar and foxes on dry land as they go about', () => {
    const s = sim(2);
    const end = s.tick + 20 * TICKS_PER_DAY;
    while (s.tick < end) {
      s.step();
      if (s.tick % 60) continue;
      for (const b of s.beasts) if (b.alive && b.kind !== BEAST.Beaver) expect(s.world.water[s.tileOf(b)]).toBe(WATER.None);
    }
  });
});

describe('beavers', () => {
  it('fell the birches along the bank, and leave the wood lying for anyone to take', () => {
    const s = sim(1);
    runTo(s, s.tick + 60 * TICKS_PER_DAY);
    expect(notes(s, 'A birch felled by beavers').length).toBeGreaterThan(0);
    expect(notes(s, 'A young birch gnawed through').length + notes(s, 'A mature birch gnawed through').length).toBeGreaterThan(0);
  });

  it('build their dam across the river', () => {
    const s = sim(1);
    const den = s.dens.find((d) => d.kind === BEAST.Beaver && (d.dam ?? -1) >= 0)!;
    expect(den).toBeDefined();
    expect(s.world.water[den.dam!]).toBe(WATER.River);
    runTo(s, s.tick + 30 * TICKS_PER_DAY);
    expect(den.built ?? 0).toBeGreaterThan(0);
  });
});

describe('foxes', () => {
  it('take the hare from a snare left out overnight near their earth', () => {
    const s = sim(1);
    const den = s.dens.find((d) => d.kind === BEAST.Fox)!;
    let tile = -1;
    for (let r = 1; r < 5 && tile < 0; r++)
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const i = s.tileOf({ x: den.x + dx, z: den.z + dz });
        if (s.world.water[i] === WATER.None && s.grid.walkable(i)) { tile = i; break; }
      }
    // (a snare of some band long gone, so nobody comes round to empty it first)
    const snare = { id: s.newId(), kind: 'snare' as const, band: 999, holder: -1, wear: 0, made: s.tick, maker: -1, tile, catch: 2 };
    s.items.push(snare);
    const end = s.tick + 4 * TICKS_PER_DAY;
    while (s.tick < end && snare.catch) s.step();
    expect(snare.catch).toBe(0);
    expect(s.camp.ledger?.total['robbed.snares']).toBe(1);
  });
});

describe('wild boar', () => {
  it('root up the acorns under the oaks in autumn', () => {
    const s = sim(1);
    runTo(s, s.tick + TICKS_PER_SEASON * 2.2);
    expect(seasonOf(s.tick)).toBe(2);
    runTo(s, s.tick + TICKS_PER_SEASON * 0.7);
    const eaten = notes(s, 'Wild boar rooted up and ate the acorns');
    expect(eaten.length).toBeGreaterThan(0);
  });

  it('are hunted only once the band has learned how', () => {
    const s = sim(1);
    const p = adult(s);
    const boar = s.beasts.find((b) => b.alive && b.kind === BEAST.Boar)!;
    p.x = boar.x + 3;
    p.z = boar.z;
    s.camp.stock.meat = 0;
    for (let k = 0; k < 30 * 4; k++) {
      s.step();
      // (without the know-how a hunter only ever goes after deer)
      expect(s.living().every((q) => !q.task?.boar)).toBe(true);
    }
  });

  it('can be brought down by a hunter who knows how, for a lot of meat (and a risk of the tusks)', () => {
    const s = sim(1);
    s.camp.knows.push('boar');
    const p = adult(s);
    p.skills[3] = 16;
    p.health = 100;
    const b = s.beasts.find((q) => q.alive && q.kind === BEAST.Boar && !q.young)!;
    p.x = b.x + 1.5;
    p.z = b.z;
    p.path = null;
    const t: Task = { kind: 'hunt', stage: 0, goal: s.tileOf(b), gx: b.x, gz: b.z, ref: b.id, timer: 0, started: s.tick, amount: 0, near: false, deadline: s.tick + 400, boar: true };
    p.task = t;
    for (let i = 0; i < 400 && p.task === t && t.stage === 0 && p.alive; i++) {
      runTask(s, p);
      s.tick++;
    }
    expect(p.alive).toBe(true);
    expect(b.alive).toBe(false);
    expect(b.killed).toBe(true);
    expect(p.carry).toBe(CARRY.Meat);
    expect(p.carryAmt).toBe(10);
    expect(s.stats.boarKills).toBe(1);
  });
});
