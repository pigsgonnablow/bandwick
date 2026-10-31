import { describe, it, expect } from 'vitest';
import { Sim, SaveData, LOGS } from '../../src/sim/sim';
import { generateWorld } from '../../src/sim/worldgen';
import { TICKS_PER_DAY, TICKS_PER_YEAR, START_TICK, DAYS_PER_SEASON, seasonOf } from '../../src/sim/time';
import { FAR_GRAVE, completeBuilding, standOn } from '../../src/sim/ai';
import { runChecked } from '../../tools/lib/invariants';
import { sim, world, runTo, runYears } from '../helpers';

describe('a new band', () => {
  it('arrives with ten people, a hearth and a stockpile', () => {
    const s = sim(1);
    expect(s.tick).toBe(START_TICK);
    expect(s.living().length).toBe(10);
    expect(s.liveCamps().length).toBe(1);
    const kinds = s.buildings.map((b) => b.kind);
    expect(kinds).toContain('hearth');
    expect(kinds).toContain('stockpile');
    for (const p of s.living()) {
      expect(p.band).toBe(s.camp.id);
      expect(s.grid.walkable(s.tileOf(p))).toBe(true);
    }
  });
});

describe('the simulation', () => {
  // every game day for a few years, nothing impossible happens (tools/invariants.ts runs this for decades)
  for (const seed of [1, 2, 3]) {
    it(`keeps every invariant for 4 years on seed ${seed}`, () => {
      const s = sim(seed);
      const checker = runChecked(s, 4);
      expect(checker.report()).toEqual([]);
      expect(s.living().length).toBeGreaterThan(0);
    });
  }

  it('gets on with life in the first year: people work, build and eat', () => {
    const s = runYears(sim(2), 1);
    const sum = s.summary();
    expect(sum.homes).toBeGreaterThan(0);
    expect(s.events.length).toBeGreaterThan(0);
    const total = (k: string) => s.camps.reduce((a, c) => a + (c.ledger?.total[k] ?? 0), 0);
    expect(total('gathered.wood')).toBeGreaterThan(0);
    expect(total('burned')).toBeGreaterThan(0);
    expect(['berries', 'meat', 'fish', 'preserved'].reduce((a, k) => a + total(`eaten.${k}`), 0)).toBeGreaterThan(0);
  });

  it('runs the same history twice from the same seed', () => {
    const a = sim(5), b = new Sim(generateWorld({ ...world(5).params }));
    const end = START_TICK + TICKS_PER_YEAR;
    while (a.tick < end) {
      a.step();
      b.step();
      if (a.tick % TICKS_PER_DAY === 0) expect(b.historyHash()).toBe(a.historyHash());
    }
    expect(b.events.map((e) => e.text)).toEqual(a.events.map((e) => e.text));
  });

  it('is only looked at, never changed, by everything the page asks of it', () => {
    // the info windows, the summary, the chronicle and the frames all read the simulation between steps
    const a = sim(7), b = new Sim(generateWorld({ ...world(7).params }));
    const end = START_TICK + TICKS_PER_YEAR / 2;
    while (a.tick < end) {
      a.step();
      b.step();
      if (b.tick % 97 === 0) {
        for (const c of b.camps) b.summary(c.id);
        b.summary();
        b.packPeople(); b.packDeer(); b.packBuildings(); b.packProps(); b.packPiles(); b.packTraps();
        for (const p of b.people) expect(b.inspect(p.id)).not.toBeNull();
        for (const x of b.buildings) expect(b.inspectThing({ kind: 'building', id: x.id })).not.toBeNull();
        for (const d of b.deer) b.inspectThing({ kind: 'deer', id: d.id });
        for (let k = 0; k < b.propCount; k += 11) b.inspectThing({ kind: 'prop', id: k });
        for (let i = 0; i < b.N * b.N; i += 97) b.inspectThing({ kind: 'tile', id: i });
        if (b.tick % (97 * 20) === 0) b.chronicle();
      }
      if (a.tick % TICKS_PER_DAY === 0) expect(b.historyHash(), `diverged at tick ${a.tick}`).toBe(a.historyHash());
    }
    expect(b.events.map((e) => e.text)).toEqual(a.events.map((e) => e.text));
  });

  it('runs different histories from different seeds', () => {
    expect(runYears(sim(1), 1).historyHash()).not.toBe(runYears(sim(2), 1).historyHash());
  });
});

/** A save as plain data, with the random streams' words read as unsigned (Rng.getState can hand back either sign for the same bits). */
function canonical(save: SaveData) {
  const d = JSON.parse(JSON.stringify(save)) as SaveData;
  for (const k of Object.keys(d.rng) as (keyof SaveData['rng'])[]) d.rng[k] = d.rng[k].map((v) => v >>> 0);
  return d;
}

describe('saving and loading', () => {
  // save mid-walk and mid-task, reload into a fresh simulation, and both must carry on identically
  for (const [seed, year] of [[3, 1], [7, 2]]) {
    it(`continues seed ${seed} identically after a save in year ${year + 1}`, () => {
      const a = runTo(sim(seed), year * TICKS_PER_YEAR + 137);
      const save = JSON.parse(JSON.stringify(a.serialize())) as SaveData;
      expect(save.tick).toBe(a.tick);
      expect(save.worldHash).toBe(a.world.hash);
      const b = new Sim(generateWorld(save.params), save);
      expect(b.historyHash()).toBe(a.historyHash());
      const end = a.tick + TICKS_PER_YEAR;
      while (a.tick < end) {
        a.step();
        b.step();
        if (a.tick % TICKS_PER_DAY === 0) expect(b.historyHash(), `diverged at tick ${a.tick}`).toBe(a.historyHash());
      }
      expect(JSON.stringify(b.history)).toBe(JSON.stringify(a.history));
      expect(canonical(b.serialize())).toEqual(canonical(a.serialize()));
    });
  }
});

describe('the props of the land', () => {
  it('make room for more when they outgrow their arrays, keeping every one, and save and load past that', () => {
    const s = sim(1);
    const cap = s.propType.length;
    const n = s.propCount;
    const first = [s.propType[0], s.propX[0], s.propZ[0], s.propTile[0], s.propAlive[0]];
    const last = [s.propType[n - 1], s.propX[n - 1], s.propZ[n - 1], s.propTile[n - 1], s.propAlive[n - 1]];
    const tile = s.camp.tile + 6;
    const x = (tile % s.N) + 0.5, z = Math.floor(tile / s.N) + 0.5;
    while (s.propCount <= cap) s.addProp(LOGS, x, 0, z, 0, 1);
    expect(s.propType.length).toBeGreaterThan(cap);
    for (const a of [s.propX, s.propY, s.propZ, s.propRot, s.propScale, s.propAlive, s.propVal, s.propTile]) expect(a.length).toBe(s.propType.length);
    expect([s.propType[0], s.propX[0], s.propZ[0], s.propTile[0], s.propAlive[0]]).toEqual(first);
    expect([s.propType[n - 1], s.propX[n - 1], s.propZ[n - 1], s.propTile[n - 1], s.propAlive[n - 1]]).toEqual(last);
    expect(s.propType[s.propCount - 1]).toBe(LOGS);
    expect(s.propTile[s.propCount - 1]).toBe(tile);
    const b = new Sim(generateWorld(s.world.params), JSON.parse(JSON.stringify(s.serialize())) as SaveData);
    expect(b.propCount).toBe(s.propCount);
    expect(b.historyHash()).toBe(s.historyHash());
    runTo(s, s.tick + TICKS_PER_DAY);
    runTo(b, b.tick + TICKS_PER_DAY);
    expect(b.historyHash()).toBe(s.historyHash());
  });
});

describe('a band that leaves its camp', () => {
  it('leaves its half-built sites to the land, and what it finished standing', () => {
    const s = runYears(sim(2), 1);
    const c = s.camp;
    const site = s.newBuilding('hut', c.tile + 5 * s.N + 2, -1);
    const built = s.buildings.filter((b) => b.band === c.id && b.built).map((b) => b.id);
    for (const p of s.members(c)) s.kill(p, 'fever');
    (s as any).emptied(c);
    expect(c.gone).toBeGreaterThan(0);
    expect(s.buildings.includes(site)).toBe(false);
    expect(s.buildings.filter((b) => b.band === c.id && !b.built)).toEqual([]);
    for (const id of built) expect(s.buildings.some((b) => b.id === id)).toBe(true);
    expect(s.buildings.some((b) => b.band === c.id && b.kind === 'hearth')).toBe(true);
  });

  it('leaves huts that fall in a dozen years on, all but the ring of the hearth', () => {
    const s = runYears(sim(2), 1);
    const c = s.camp;
    expect(s.buildings.filter((b) => b.band === c.id && b.kind !== 'hearth').length).toBeGreaterThan(0);
    for (const p of s.members(c)) s.kill(p, 'fever');
    (s as any).emptied(c);
    c.gone = s.tick - 11 * TICKS_PER_YEAR;
    (s as any).ruinsFall();
    expect(s.buildings.filter((b) => b.band === c.id && b.kind !== 'hearth').length).toBeGreaterThan(0);
    c.gone = s.tick - 13 * TICKS_PER_YEAR;
    (s as any).ruinsFall();
    expect(s.buildings.filter((b) => b.band === c.id).map((b) => b.kind)).toEqual(['hearth']);
    expect(s.people.some((p) => p.home >= 0 && !s.buildings.some((b) => b.id === p.home))).toBe(false);
  });
});

describe('an empty land', () => {
  it('has strangers come to it again', () => {
    const s = runYears(sim(2), 1);
    for (const c of s.liveCamps()) {
      for (const p of s.members(c)) s.kill(p, 'fever');
      (s as any).emptied(c);
    }
    expect(s.liveCamps().length).toBe(0);
    runYears(s, 4);
    expect(s.liveCamps().length).toBeGreaterThan(0);
    expect(s.living().length).toBeGreaterThan(0);
  });
});

describe('homes', () => {
  it('puts someone without a roof in with their partner', () => {
    const s = runYears(sim(1), 2);
    const p = s.members().find((q) => q.partner >= 0 && q.home >= 0 && s.byId.get(q.partner)?.home === q.home)!;
    expect(p).toBeTruthy();
    p.home = -1;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(p.home).toBe(s.byId.get(p.partner)!.home);
  });
});

describe('a hut', () => {
  it('finished after its owner went to live with another band stands empty for someone here', () => {
    const s = runYears(sim(2), 1);
    const home = s.camp;
    const owner = s.members().find((q) => s.age(q) >= 18)!;
    const site = s.newBuilding('hut', home.tile + 5 * s.N + 3, owner.id);
    const stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
    const away = s.foundCamp(home.tile + 30, stock, -1, -1);
    (s as any).join([owner], away);
    const moved = owner.home;
    s.camp = home;
    completeBuilding(s, site, s.members(home)[0]);
    expect(site.built).toBe(true);
    expect(owner.home).toBe(moved);
    expect(s.people.some((q) => q.home === site.id && q.band !== home.id)).toBe(false);
  });
});

describe('walking up to something', () => {
  it('stops on its own tile rather than a step over into deep water', () => {
    const s = sim(1);
    const N = s.N;
    let goal = -1;
    for (let i = N; i < N * N - N && goal < 0; i++)
      if (s.grid.walkable(i) && !s.grid.walkable(i + 1)) goal = i;
    expect(goal).toBeGreaterThan(0);
    const x0 = goal % N, z0 = Math.floor(goal / N);
    const [x, z] = standOn(s, { goal, gx: x0 + 1.2, gz: z0 + 0.5 } as any);
    expect(Math.floor(z) * N + Math.floor(x)).toBe(goal);
    // and anywhere dry is left as asked
    expect(standOn(s, { goal, gx: x0 + 0.7, gz: z0 + 0.4 } as any)).toEqual([x0 + 0.7, z0 + 0.4]);
  });
});

describe('the dead', () => {
  it('buries someone who died far out on the land where they fell, even in winter', () => {
    const s = sim(1);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    const c = s.camp;
    const p = s.members().find((q) => s.age(q) >= 20 && s.age(q) < 50)!;
    // somewhere walkable a good way out from camp
    let tile = -1;
    for (let r = FAR_GRAVE + 30; r < 60 && tile < 0; r++)
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const x = Math.floor(c.x) + dx, z = Math.floor(c.z) + dz;
        if (x < 2 || z < 2 || x >= s.N - 2 || z >= s.N - 2) continue;
        const i = z * s.N + x;
        if (s.grid.walkable(i) && s.world.water[i] === 0) { tile = i; break; }
      }
    expect(tile).toBeGreaterThanOrEqual(0);
    Object.assign(p, { x: (tile % s.N) + 0.5, z: Math.floor(tile / s.N) + 0.5, task: null, path: null });
    s.kill(p, 'wolves');
    const at = { x: p.x, z: p.z };
    // (within the time the daily checks allow a body far out: someone has to be well fed and the day mild enough)
    for (let d = 0; d < DAYS_PER_SEASON + 6 && !p.buried; d++) runTo(s, s.tick + TICKS_PER_DAY);
    expect(p.buried).toBe(true);
    // a grave out there, not in the camp's burial ground
    expect(Math.hypot(p.x - at.x, p.z - at.z)).toBeLessThan(3);
  });

  it('leaves someone who died far out to lie through a hard frost, rather than freeze going to them', () => {
    const s = sim(1);
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + 200);
    const c = s.camp;
    const p = s.members().find((q) => s.age(q) >= 20 && s.age(q) < 50)!;
    let tile = -1;
    for (let r = FAR_GRAVE + 30; r < 60 && tile < 0; r++)
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const x = Math.floor(c.x) + dx, z = Math.floor(c.z) + dz;
        if (x < 2 || z < 2 || x >= s.N - 2 || z >= s.N - 2) continue;
        const i = z * s.N + x;
        if (s.grid.walkable(i) && s.world.water[i] === 0) { tile = i; break; }
      }
    Object.assign(p, { x: (tile % s.N) + 0.5, z: Math.floor(tile / s.N) + 0.5, task: null, path: null });
    s.kill(p, 'wolves');
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      s.anomaly = -16;
      s.step();
      expect(s.people.some((q) => q.alive && q.task?.kind === 'bury' && q.task.ref === p.id)).toBe(false);
    }
    expect(p.buried).toBe(false);
  });
});

describe('children left on their own', () => {
  it('go to live with the nearest band at once, whatever the season', () => {
    const s = runYears(sim(2), 1);
    while (seasonOf(s.tick) !== 2) runTo(s, s.tick + 200);
    const home = s.camp;
    const kids = s.members().filter((p) => s.age(p) < 14).slice(0, 2);
    expect(kids.length).toBeGreaterThan(0);
    const stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
    const lone = s.foundCamp(home.tile + 30, stock, -1, -1);
    (s as any).join(kids, lone);
    s.camp = home;
    runTo(s, s.tick + TICKS_PER_DAY + 1);
    for (const k of kids) expect(k.band).toBe(home.id);
    expect(lone.gone).toBeGreaterThan(0);
  });
});
