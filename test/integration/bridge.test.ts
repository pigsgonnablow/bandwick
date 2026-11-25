// Fords and footbridges: wading is slow and, in the cold, chilling. A band counts the steps waded at the fords near
// camp, and once it knows how, lays a log footbridge over the one it wades most: crossed dry-shod and at a walk.
import { describe, it, expect } from 'vitest';
import { SK, BUILD, BRIDGE_USE, BRIDGE_SPAN, WADE_COLD } from '../../src/sim/band';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { WATER } from '../../src/sim/types';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/time';
import { setup, completeBuilding, go } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runYears } from '../helpers';

/** A band a couple of years on by a river, with an axe, wood put by, and the idea of a footbridge. */
function band(seed = 4471) {
  const s = runYears(sim(seed, 128), 2);
  const c = s.camp;
  for (const k of ['axe', 'bridge']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.wood += 60;
  c.stock.grain += 2000;
  c.stock.preserved += 500;
  return s;
}
const bridgeOf = (s: Sim) => s.buildings.find((b) => b.band === s.camp.id && b.kind === 'bridge');
function planned(s: Sim) {
  for (let k = 0; k < 20 * TICKS_PER_DAY && !bridgeOf(s); k++) s.step();
  const b = bridgeOf(s)!;
  expect(b).toBeDefined();
  return b;
}

describe('footbridge', () => {
  it('is thought of by a woodcutter with an axe who can build, wading the ford', () => {
    const d = DISCOVERY.get('bridge')!;
    expect(d.needs).toEqual(['axe']);
    expect(d.requires).toEqual([{ kind: 'skill', skill: SK.wood, level: 13 }, { kind: 'skill', skill: SK.build, level: 9 }]);
    expect(d.practice.wade).toBeGreaterThan(0);
    expect(knowHowFor({ kind: 'bridge' })).toEqual(['bridge']);
    expect(BUILD.bridge.wood).toBeGreaterThan(0);
  });

  it('counts the steps waded at the fords near camp, but not those wading in to fish', () => {
    const s = runYears(sim(4471, 128), 1);
    const c = s.camp, N = s.N;
    const p = s.members().find((q) => s.age(q) >= 18)!;
    // a river tile near camp
    let ford = -1;
    for (let d = 1; d < 16 && ford < 0; d++)
      for (let dz = -d; dz <= d && ford < 0; dz++)
        for (let dx = -d; dx <= d && ford < 0; dx++) {
          const i = (Math.floor(c.z) + dz) * N + Math.floor(c.x) + dx;
          if (s.world.water[i] === WATER.River) ford = i;
        }
    expect(ford).toBeGreaterThanOrEqual(0);
    const before = c.fords?.[ford] ?? 0;
    p.task = { kind: 'haul', stage: 0, goal: ford, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
    s.waded(p, ford);
    expect(c.fords![ford]).toBe(before + 1);
    p.task = { ...p.task, kind: 'fish' };
    s.waded(p, ford);
    expect(c.fords![ford]).toBe(before + 1);
  });

  it('is not laid by a band that has not thought of it', () => {
    const s = runYears(sim(4471, 128), 2);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'bridge');
    for (let k = 0; k < 3 * TICKS_PER_DAY; k++) s.step();
    expect(bridgeOf(s)).toBeUndefined();
  });

  it('is laid straight over the most waded ford it can bridge, bank to bank, from the near bank', () => {
    const s = band();
    const b = planned(s);
    const N = s.N, w = s.world;
    expect(b.span!.length).toBeGreaterThan(0);
    expect(b.span!.length).toBeLessThanOrEqual(BRIDGE_SPAN);
    for (const i of b.span!) expect(w.water[i]).toBe(WATER.River);
    // the builders' bank is dry land at one end, the far bank dry land at the other, in a straight line
    const step = b.rot % 2 ? N : 1;
    expect(b.span![0] - step).toBe(b.tile);
    expect(w.water[b.tile]).toBe(WATER.None);
    expect(w.water[b.span![b.span!.length - 1] + step]).toBe(WATER.None);
    // and the ford it bridged was waded often enough
    expect(b.span!.every((i) => !(i in (s.camp.fords ?? {})))).toBe(true);
    const p = s.members().find((q) => s.age(q) >= 18 && q.sick === 0)!;
    b.wood = BUILD.bridge.wood;
    b.cordage = BUILD.bridge.cordage;
    const t = setup(s, p, 'build');
    expect(t?.kind).toBe('build');
    expect(t!.goal).toBe(b.tile);
    expect(BRIDGE_USE).toBeGreaterThan(0);
  });

  it('once finished, is crossed dry-shod at a walk where the ford was slow', () => {
    const s = band();
    const b = planned(s);
    const i = b.span![0];
    const wadeCost = s.grid.cost[i];
    expect(wadeCost).toBeGreaterThan(10);
    completeBuilding(s, b, s.members()[0]);
    expect(s.grid.cost[i]).toBe(10);
    expect(s.grid.walkLevel[i]).toBe(b.deck);
    // (and stays so after a save and a load)
    const t = new Sim(s.world);
    (t as any).restore(JSON.parse(JSON.stringify(s.serialize())));
    expect(t.grid.cost[i]).toBe(10);
  });

  it('keeps the cold off the legs: wading in the cold chills, crossing the bridge does not', () => {
    const s = band();
    const b = planned(s);
    const i = b.span![0], N = s.N;
    const p = s.members().find((q) => s.age(q) >= 18 && q.sick === 0)!;
    s.tempAt = () => WADE_COLD - 8;
    // walk them from the near bank to the far bank
    const far = b.span![b.span!.length - 1] + (b.rot % 2 ? N : 1);
    const cross = () => {
      p.x = b.x + 0.5; p.z = b.z + 0.5; p.path = null; p.warmth = 80;
      p.task = { kind: 'haul', stage: 0, goal: far, gx: (far % N) + 0.5, gz: Math.floor(far / N) + 0.5, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
      const before = { ...s.camp.fords };
      let wet = false;
      for (let k = 0; k < 400 && go(s, p, p.task!) === 'moving'; k++) if (s.tileOf(p) === i) wet = true;
      return { warmth: p.warmth, wet, counted: (s.camp.fords?.[i] ?? 0) - (before[i] ?? 0) };
    };
    const wading = cross();
    expect(s.tileOf(p)).toBe(far);
    expect(wading.wet).toBe(true);
    expect(wading.warmth).toBeLessThan(80);
    expect(wading.counted).toBeGreaterThan(0);
    completeBuilding(s, b, p);
    const dry = cross();
    expect(dry.warmth).toBe(80);
    expect(dry.counted).toBe(0);
  });

  it('once fallen in, long after its band has gone, leaves the ford to be waded again', () => {
    const s = band();
    const b = planned(s);
    const i = b.span![0];
    const wadeCost = s.grid.cost[i], wadeLevel = s.grid.walkLevel[i];
    completeBuilding(s, b, s.members()[0]);
    expect(s.grid.cost[i]).toBe(10);
    // (its band gone a generation)
    s.camp.gone = s.tick - 13 * TICKS_PER_YEAR;
    (s as any).ruinsFall();
    expect(s.buildings.includes(b)).toBe(false);
    expect(s.grid.cost[i]).toBe(wadeCost);
    expect(s.grid.walkLevel[i]).toBe(wadeLevel);
  });
});
