// The camp fire's comforts: a roof over the woodpile keeps firewood dry, a windbreak keeps the warmth in.
import { describe, it, expect } from 'vitest';
import { DAMP_BURN, WARM_RADIUS, WARM_RADIUS_SHELTERED, LOGS } from '../../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/sim/time';
import { seasonOf, TICKS_PER_YEAR } from '../../src/sim/time';
import { sim, runTo, runYears } from '../helpers';

describe('fire', () => {
  it('burns damp wood faster in autumn and winter, unless the woodpile has a roof', () => {
    const s = sim(1);
    // into the first autumn
    while (seasonOf(s.tick) !== 2) runTo(s, s.tick + 200);
    for (const b of s.buildings.filter((b) => b.kind === 'woodshed')) b.built = false;
    const h = s.hearth();
    const damp = s.burnRate(h);
    expect(s.dampWood()).toBe(true);
    const roof = s.buildings.find((b) => b.kind === 'woodshed' && b.band === s.camp.id) ?? s.newBuilding('woodshed', s.hearth().tile, -1);
    roof.built = true;
    expect(s.dampWood()).toBe(false);
    expect(damp / s.burnRate(h)).toBeCloseTo(DAMP_BURN, 5);
  });

  it('roofs the woodpile and raises a windbreak once it knows how, on the stockpile and the fire, with all their materials', () => {
    let checked = 0;
    for (const seed of [1, 4]) {
      const s = runYears(sim(seed), 3);
      for (const c of s.liveCamps()) {
        const mine = s.buildings.filter((b) => b.band === c.id);
        const roof = mine.find((b) => b.kind === 'woodshed' && b.built);
        const screen = mine.find((b) => b.kind === 'windbreak' && b.built);
        // a band only just founded may not have got to them yet, and one that hasn't thought of them won't
        if (s.tick - c.founded < 2 * TICKS_PER_YEAR || !s.knows('woodshed', c) || !s.knows('windbreak', c)) continue;
        checked++;
        expect(roof, `seed ${seed} band ${c.name}: woodpile roof`).toBeTruthy();
        expect(screen, `seed ${seed} band ${c.name}: windbreak`).toBeTruthy();
        expect(mine.some((b) => b.kind === 'stockpile' && b.tile === roof!.tile)).toBe(true);
        expect(screen!.tile).toBe(s.hearth(c).tile);
        for (const b of [roof!, screen!]) {
          expect(b.wood).toBeGreaterThanOrEqual(4 - 0.5);
          expect(b.cordage).toBeGreaterThanOrEqual(2 - 0.5);
        }
        // never more than one of each
        expect(mine.filter((b) => b.kind === 'woodshed').length).toBe(1);
        expect(mine.filter((b) => b.kind === 'windbreak').length).toBe(1);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('warms people further from the fire behind a windbreak', () => {
    const s = sim(1);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    const h = s.hearth();
    h.fuel = Math.max(h.fuel, 20);
    expect(s.hearthLit()).toBe(true);
    const p = s.members().find((q) => s.age(q) >= 20)!;
    // standing just outside the bare fire's warmth, but inside a sheltered one's
    const d = (WARM_RADIUS + WARM_RADIUS_SHELTERED) / 2;
    const warmth = (sheltered: boolean) => {
      for (const b of s.buildings.filter((b) => b.kind === 'windbreak' && b.band === s.camp.id)) b.built = sheltered;
      if (sheltered && !s.hasBuilt('windbreak')) s.newBuilding('windbreak', h.tile, -1).built = true;
      Object.assign(p, { x: s.camp.x + d, z: s.camp.z, indoors: false, warmth: 50 });
      (s as any).needs(p);
      return p.warmth;
    };
    expect(warmth(true)).toBeGreaterThan(warmth(false) + 1);
  });

  it('fells trees near camp rather than chasing logs left far out on the land', () => {
    const s = runYears(sim(1), 1);
    const c = s.camp;
    // logs left lying a long way off (by someone who died out there, say)
    const far = s.addProp(LOGS, Math.min(s.N - 3, c.x + 50), 6, c.z, 0, 1);
    s.propVal[far] = 15;
    c.stock.wood = 0;
    const felled = s.stats.felled;
    for (let i = 0; i < 2 * TICKS_PER_DAY; i += 10) {
      runTo(s, s.tick + 10);
      for (const p of s.members()) expect(p.task?.kind === 'haul' && p.task.ref === far, `${p.name} off for the far logs`).toBe(false);
    }
    // wood still came in, from trees felled near camp or logs lying close by
    expect(s.stats.felled > felled || c.stock.wood > 0).toBe(true);
  });
});

describe('the fire at night', () => {
  /** A winter evening, a tick before dark (or `hour` that evening). */
  const winterEvening = (seed: number, hour = 16) => {
    const s = sim(seed);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    runTo(s, Math.floor(s.tick / TICKS_PER_DAY) * TICKS_PER_DAY + TICKS_PER_DAY + hour * TICKS_PER_HOUR);
    return s;
  };

  it('knows how much wood will see it through to morning', () => {
    const s = winterEvening(1, 16);
    const need = s.fuelToMorning();
    // a winter night is long, and the fire burns hot in the dark: several hours of wood, but less than a full fire holds
    expect(need).toBeGreaterThan(5);
    expect(need).toBeLessThan(12);
    // later in the night there is less of it left to burn through
    const later = winterEvening(1, 23).fuelToMorning();
    expect(later).toBeLessThan(need);
    expect(later).toBeGreaterThan(0);
  });

  it('is short only when it will not last the night and there is wood to give it', () => {
    const s = winterEvening(1, 16);
    const h = s.hearth();
    h.fuel = 12;
    expect(s.fireShort()).toBe(false);
    h.fuel = 1;
    s.camp.stock.wood = 20;
    expect(s.fireShort()).toBe(true);
    s.camp.stock.wood = 0;
    expect(s.fireShort()).toBe(false);
  });

  it('has the same keeper all night: the eldest grown-up fit to get up, never the old or the sick', () => {
    const s = sim(1);
    const keeper = s.fireKeeper()!;
    expect(s.age(keeper)).toBeGreaterThanOrEqual(16);
    expect(s.age(keeper)).toBeLessThan(60);
    for (const p of s.members()) if (s.age(p) >= 16 && s.age(p) < 60) expect(p.birth).toBeGreaterThanOrEqual(keeper.birth);
    keeper.sick = 3;
    const next = s.fireKeeper()!;
    expect(next).not.toBe(keeper);
    expect(next.sick).toBe(0);
  });

  it('wakes the keeper to feed a fire that is burning low, and lets everyone else sleep', () => {
    const s = winterEvening(1, 23);
    const h = s.hearth();
    s.camp.stock.wood = 30;
    const keeper = s.fireKeeper()!;
    for (const p of s.members()) {
      if (p.task?.kind === 'fuel') p.task = null;
    }
    h.fuel = 1;
    for (const p of s.members().filter((p) => s.age(p) >= 2)) {
      Object.assign(p, { food: 80, rest: 50, warmth: 80, health: 90 });
      p.task = { kind: 'sleep', stage: 1, goal: s.tileOf(p), gx: p.x, gz: p.z, ref: -1, timer: 0, started: s.tick, amount: 0, near: true };
      p.nextThink = s.tick + 600;
    }
    // within the hour the keeper is up and carrying wood to the fire, and nobody else has stirred
    let up: string | undefined;
    for (let i = 0; i < TICKS_PER_HOUR && !up; i++) {
      s.step();
      up = s.members().find((p) => p.task?.kind === 'fuel')?.name;
    }
    expect(up).toBe(keeper.name);
    expect(s.members().filter((p) => s.age(p) >= 2 && p !== keeper && p.task?.kind !== 'sleep')).toEqual([]);
    // and the fire is fed before it goes out, then the keeper goes back to bed
    for (let i = 0; i < TICKS_PER_HOUR * 3; i++) s.step();
    expect(h.fuel).toBeGreaterThan(1);
    expect(s.fireShort()).toBe(false);
  });
});
