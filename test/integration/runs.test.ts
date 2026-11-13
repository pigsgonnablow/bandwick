// The autumn runs and the fish weirs: salmon up the rivers from the sea in the first days of autumn, eels down them
// from the lakes at its end, each keeping the water it passes thick with fish for a few days; and a weir, built
// across a narrow stretch near camp by a band that has thought of it, that leads the run into a basket trap.
import { describe, it, expect } from 'vitest';
import { Building, CARRY, RUN_DAYS, RUN_REACH, RUN_SPEED, WEIR_HOLDS, WEIR_LOAD, BUILD } from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { TICKS_PER_DAY, TICKS_PER_YEAR, DAYS_PER_YEAR, dayOf } from '../../src/sim/time';
import { WATER, DIRS4 } from '../../src/sim/types';
import { Sim } from '../../src/sim/sim';
import { runTask, setup } from '../../src/sim/ai';
import { mapRuns, runOn, runStart, runExtra, runsTick, runNear, weirSite, weirBank, weirRot, weirWater } from '../../src/sim/runs';
import { sim, world, runYears } from '../helpers';

const N = 128;
const near = (s: Sim, i: number, pred: (j: number) => boolean) =>
  DIRS4.some(([dx, dz]) => {
    const x = (i % s.N) + dx, z = Math.floor(i / s.N) + dz;
    return x >= 0 && z >= 0 && x < s.N && z < s.N && pred(z * s.N + x);
  });
/** Move the clock to a day of the year, a few years on, without running the world. */
const onDay = (s: Sim, day: number, hour = 12) => {
  s.tick = (Math.floor(s.tick / TICKS_PER_YEAR) + 1) * TICKS_PER_YEAR + day * TICKS_PER_DAY + hour * 10;
};
/** A built weir across the stretch the camp would choose. */
function withWeir(s: Sim) {
  const c = s.camp;
  const tile = weirSite(s, c);
  expect(tile).toBeGreaterThanOrEqual(0);
  const b = s.newBuilding('weir', tile, -1);
  b.rot = weirRot(s.world.flow[tile]);
  b.built = true;
  return b;
}

describe('the autumn runs', () => {
  it('go up every river from the sea, and down from the lakes', () => {
    const w = world(1, N);
    const m = mapRuns(w);
    let mouths = 0, outlets = 0;
    for (let i = 0; i < N * N; i++) {
      if (m.salmon[i] >= 0) expect(w.water[i]).toBe(WATER.River);
      if (m.eel[i] >= 0) expect(w.water[i]).toBe(WATER.River);
      expect(m.salmon[i]).toBeLessThanOrEqual(RUN_REACH);
    }
    const s = sim(1, N);
    for (let i = 0; i < N * N; i++) {
      if (m.salmon[i] === 0) { mouths++; expect(near(s, i, (j) => w.water[j] === WATER.Sea)).toBe(true); }
      // (the river's breadth beside its outlet counts as the outlet too)
      if (m.eel[i] === 0) { outlets++; expect(near(s, i, (j) => w.water[j] === WATER.Lake || m.eel[j] === 0)).toBe(true); }
    }
    // (an outlet is where a lake drains: no river runs into it from upstream)
    for (let i = 0; i < N * N; i++) {
      if (m.eel[i] !== 0 || near(s, i, (j) => m.eel[j] === 0 && j !== i && !near(s, j, (k) => w.water[k] === WATER.Lake))) continue;
      const fed = DIRS4.some(([dx, dz]) => {
        const x = (i % N) + dx, z = Math.floor(i / N) + dz, j = z * N + x;
        if (x < 0 || z < 0 || x >= N || z >= N || w.water[j] !== WATER.River || w.flow[j] < 0) return false;
        const [fx, fz] = DIRS4[w.flow[j]];
        return (z + fz) * N + x + fx === i;
      });
      expect(fed).toBe(false);
    }
    expect(mouths).toBeGreaterThan(0);
    expect(outlets).toBeGreaterThan(0);
    expect(m.tiles.length).toBeGreaterThan(100);
  });

  it('reach the mouths in the first days of autumn, and the water upstream later, for a few days each', () => {
    const s = sim(1, N);
    const year = 3;
    const start = runStart(s, year);
    expect(start).toBeGreaterThanOrEqual(24);
    expect(start).toBeLessThan(30);
    const mouth = s.runs.tiles.find((i) => s.runs.salmon[i] === 0)!;
    const far = s.runs.tiles.find((i) => s.runs.salmon[i] >= 30)!;
    const days = (i: number) => Array.from({ length: DAYS_PER_YEAR }, (_, d) => d).filter((d) => runOn(s, i, d, year) === 1);
    expect(days(mouth)).toEqual(Array.from({ length: RUN_DAYS }, (_, k) => start + k));
    const upstream = days(far);
    expect(upstream.length).toBe(RUN_DAYS);
    expect(upstream[0]).toBe(start + Math.floor(s.runs.salmon[far] / RUN_SPEED));
    // (and the salmon are gone before the rivers freeze)
    expect(upstream[upstream.length - 1]).toBeLessThan(38);
  });

  it('fill the river they pass however hard it is fished, and leave it as it was once gone by', () => {
    const s = runYears(sim(1, N), 1);
    const mouth = s.runs.tiles.find((i) => s.runs.salmon[i] === 0 && s.fishCap[i] > 0)!;
    const year = Math.floor(s.tick / TICKS_PER_YEAR) + 2;
    onDay(s, runStart(s, year) + 1);
    expect(runOn(s, mouth)).toBe(1);
    expect(runExtra(s, mouth)).toBeGreaterThan(0);
    s.fish[mouth] = 0.5;
    for (let k = 0; k < 8; k++) runsTick(s);
    expect(s.fish[mouth]).toBeGreaterThan(s.fishCap[mouth]);
    // the run gone by
    onDay(s, runStart(s, year) + RUN_DAYS + 1);
    runsTick(s);
    expect(s.fish[mouth]).toBe(s.fishCap[mouth]);
  });

  it('are not told of under the ice', () => {
    const s = runYears(sim(1, N), 1);
    const year = Math.floor(s.tick / TICKS_PER_YEAR) + 2;
    onDay(s, runStart(s, year) + 2);
    expect(runNear(s, s.camp, 200)).toBeGreaterThan(0);
    onDay(s, 40);
    expect(runNear(s, s.camp, 200)).toBe(0);
  });

  it('make the news, and the morning plan, at a camp by a river', () => {
    const s = runYears(sim(1, N), 1);
    const year = Math.floor(s.tick / TICKS_PER_YEAR) + 2;
    onDay(s, runStart(s, year) + 2, 0);
    // (step to the morning, when the day's news and the plan are made)
    const until = s.tick + TICKS_PER_DAY;
    let told = false;
    while (s.tick < until) {
      s.step();
      if (s.events.some((e) => e.kind === 'run' && /salmon/.test(e.text))) told = true;
    }
    expect(told).toBe(true);
    expect(s.camp.plan.some((l) => /salmon are running/.test(l))).toBe(true);
    expect(s.camp.salmonYear).toBe(year);
  });
});

describe('the fish weir', () => {
  it('is thought of by a fisher who builds, fishing the run, once the band knows the fish trap', () => {
    const d = DISCOVERY.get('weir')!;
    expect(d.needs).toEqual(['fishtraps']);
    expect(d.practice.run).toBeGreaterThan(0);
    expect(BUILD.weir.wood).toBeGreaterThan(0);
  });

  it('is planned across a narrow stretch of river near camp, its point downstream, and built from the bank', () => {
    const s = runYears(sim(1, N), 1);
    const c = s.camp;
    c.knows.push('fishtraps', 'weir');
    onDay(s, 10);
    s.plan();
    const b = s.buildings.find((q) => q.kind === 'weir' && q.band === c.id)!;
    expect(b).toBeDefined();
    expect(c.plan).toContain('Build a fish weir across the river');
    expect(s.world.water[b.tile]).toBe(WATER.River);
    expect(b.rot).toBe(weirRot(s.world.flow[b.tile]));
    // dry banks either side to work from
    const bank = weirBank(s, b.tile);
    expect(bank).toBeGreaterThanOrEqual(0);
    expect(s.world.water[bank]).toBe(WATER.None);
    expect(Math.hypot(b.x + 0.5 - c.x, b.z + 0.5 - c.z)).toBeLessThanOrEqual(20);
    // only one
    s.plan();
    expect(s.buildings.filter((q) => q.kind === 'weir' && q.band === c.id).length).toBe(1);
  });

  it('fills its basket from the run, and thins the run above it', () => {
    const s = runYears(sim(1, N), 1);
    const b = withWeir(s);
    // a run passing the weir and the water upstream of it
    const year = Math.floor(s.tick / TICKS_PER_YEAR) + 2;
    let day = runStart(s, year);
    while (!runOn(s, b.tile, day, year) && day < 40) day++;
    onDay(s, day + 1);
    expect(runOn(s, b.tile)).toBe(1);
    for (let k = 0; k < 8; k++) runsTick(s);
    expect(b.catch ?? 0).toBeGreaterThan(4);
    expect(b.catch!).toBeLessThanOrEqual(WEIR_HOLDS);
    // the water just above it gets less of the run than it would with no weir
    const up = weirWater(s, b.tile).find((k) => k !== b.tile && s.runs.salmon[k] > s.runs.salmon[b.tile]);
    if (up !== undefined && runOn(s, up)) {
      const thinned = runExtra(s, up);
      b.built = false;
      expect(runExtra(s, up)).toBeGreaterThan(thinned);
      b.built = true;
    }
    // outside the runs it catches only a little
    const s2 = runYears(sim(1, N), 1);
    const b2 = withWeir(s2);
    onDay(s2, 8);
    for (let k = 0; k < 4; k++) runsTick(s2);
    expect(b2.catch ?? 0).toBeLessThan(1);
  });

  it('fishes nothing once its band has gone', () => {
    const s = runYears(sim(1, N), 1);
    const b = withWeir(s);
    const year = Math.floor(s.tick / TICKS_PER_YEAR) + 2;
    let day = runStart(s, year);
    while (!runOn(s, b.tile, day, year) && day < 40) day++;
    onDay(s, day + 1);
    s.camp.gone = s.tick;
    for (let k = 0; k < 8; k++) runsTick(s);
    expect(b.catch ?? 0).toBe(0);
  });

  it('is emptied by someone who carries the fish home to the stores', () => {
    const s = runYears(sim(1, N), 1);
    const c = s.camp;
    const b = withWeir(s);
    b.catch = 14.6;
    onDay(s, 10);
    const p = s.members().filter((q) => s.age(q) >= 18 && s.age(q) <= 50)[0];
    p.task = null;
    p.carry = CARRY.None;
    p.task = setup(s, p, 'weir');
    expect(p.task?.kind).toBe('weir');
    const before = c.stock.fish;
    for (let k = 0; k < 2000 && p.task; k++) {
      runTask(s, p);
      s.tick++;
    }
    expect(p.task).toBeNull();
    expect(c.stock.fish - before).toBeCloseTo(Math.min(WEIR_LOAD, 14));
    expect(b.catch).toBeCloseTo(14.6 - Math.min(WEIR_LOAD, 14));
  });

  it('keeps what is in its basket through a save', () => {
    const s = runYears(sim(1, N), 1);
    const b = withWeir(s);
    b.catch = 7.25;
    const r = new Sim(s.world, s.serialize());
    const w = r.buildings.find((q) => q.id === b.id) as Building;
    expect(w.kind).toBe('weir');
    expect(w.catch).toBe(7.25);
    expect(dayOf(r.tick)).toBe(dayOf(s.tick));
  });
});
