// Gardens: plots dug once a band thinks of them, sown in spring, weeded, raided by beasts, harvested before
// the frost; grain sown from seed kept back; fences and storage pits.
import { describe, it, expect } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR, TICKS_PER_HOUR, seasonOf, yearOf } from '../../src/sim/time';
import { CROP, CARRY, SK, SKILLS, SEED_PER_PLOT, SOIL_FALLOW, SOIL_TIRE, PLOT_YIELD, GROW_DAYS, LEAN_GARDEN, newPlot, gardenSkill, foodTotal, specOf, Building, Person, Stock, Task, TaskKind } from '../../src/sim/band';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { runTask } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { runChecked } from '../../tools/lib/invariants';
import { sim, runTo, runYears } from '../helpers';

const total = (s: Sim, k: string) => s.camps.reduce((n, c) => n + (c.ledger?.total?.[k] ?? 0), 0);
/** A dug plot right by the camp. */
function plot(s: Sim, dx = 3, dz = 2): Building {
  const b = s.newBuilding('plot', s.camp.tile + dx + dz * s.N, -1);
  b.built = true;
  b.work = 60;
  b.plot = newPlot();
  return b;
}

/** A grown-up of the band, and the band the simulation looks at set to theirs. */
const adult = (s: Sim, skip: Person[] = []) => {
  const p = s.living().find((q) => s.age(q) >= 18 && s.age(q) <= 50 && !skip.includes(q))!;
  s.camp = s.campOf(p);
  return p;
};
/** The first tick of a day of the year (0..47), in the year after `s.tick`'s, at mid-morning. */
const dayTick = (s: Sim, doy: number) => (yearOf(s.tick)) * TICKS_PER_YEAR + doy * TICKS_PER_DAY + 9 * TICKS_PER_HOUR;
/** Someone set to a piece of garden work at a plot, standing on it, and the work run to its end. */
function work(s: Sim, p: Person, kind: TaskKind, b: Building, amount = 0) {
  const t: Task = { kind, stage: 0, goal: b.tile, gx: b.x + 0.5, gz: b.z + 0.5, ref: b.id, timer: 0, started: s.tick, amount, near: false };
  p.x = b.x + 0.5;
  p.z = b.z + 0.5;
  p.path = null;
  p.carry = CARRY.None;
  p.carryAmt = 0;
  p.task = t;
  for (let i = 0; i < 1500 && p.task === t; i++) {
    runTask(s, p);
    s.tick++;
  }
  expect(p.task).not.toBe(t);
}
/** A day in the gardens (the beasts kept off, unless `pests`). */
function gardenDay(s: Sim, doy: number, pests = false) {
  const x = s as unknown as { gardens(d: number): void; pests: unknown };
  const was = x.pests;
  if (!pests) x.pests = () => {};
  try { x.gardens(doy); } finally { x.pests = was; }
}

describe('gardens', () => {
  it('are not dug before the band thinks of them', () => {
    const s = sim(2);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'garden');
    for (let i = 0; i < 6 * 4; i++) {
      runTo(s, s.tick + TICKS_PER_SEASON / 4);
      for (const c of s.camps) if (!c.knows.includes('garden')) expect(s.plots(c, true).length).toBe(0);
    }
  });

  it('are dug, sown only in spring, and harvested once the band knows them', () => {
    const s = sim(1);
    s.camp.knows.push('garden');
    const sownIn = new Set<number>();
    const end = s.tick + 2 * TICKS_PER_YEAR;
    while (s.tick < end) {
      s.step();
      if (s.tick % 20 === 0) for (const p of s.living()) if (p.task?.kind === 'sow' && p.task.stage >= 1) sownIn.add(seasonOf(s.tick));
    }
    expect(s.plots(s.camp).length).toBeGreaterThanOrEqual(2);
    expect([...sownIn]).toEqual([0]);
    expect(total(s, 'gathered.roots')).toBeGreaterThan(0);
    // nothing is left growing through the winter
    runTo(s, s.tick + 3 * TICKS_PER_SEASON + TICKS_PER_DAY);
    expect(seasonOf(s.tick)).toBe(3);
    for (const b of s.plots(s.camp)) expect(b.plot!.crop).toBe(CROP.None);
  });

  it('give grain from kept seed, and the band keeps back seed for next year', () => {
    const s = sim(1);
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = SEED_PER_PLOT * 4;
    runYears(s, 2);
    expect(total(s, 'gathered.grain')).toBeGreaterThan(20);
    // the seed kept back from the harvest is what the next spring's grain is sown from
    expect(total(s, 'seed')).toBeGreaterThan(SEED_PER_PLOT * 4);
    expect(s.camps.some((c) => s.plots(c).filter((b) => b.plot?.crop === CROP.Grain).length > 3)).toBe(true);
  });

  it('lose to the frost whatever is still in the ground', () => {
    const s = sim(3);
    runTo(s, s.tick + 3 * TICKS_PER_SEASON - 2 * TICKS_PER_DAY);
    const b = plot(s);
    Object.assign(b.plot!, { crop: CROP.Roots, growth: 0.5, sown: s.tick });
    runTo(s, s.tick + 3 * TICKS_PER_DAY);
    expect(seasonOf(s.tick)).toBe(3);
    expect(b.plot!.crop).toBe(CROP.None);
    expect(total(s, 'spoiled.roots')).toBeGreaterThan(0);
  });

  it('are spared by the beasts behind a fence', () => {
    const raids = (fenced: boolean) => {
      const s = sim(4);
      const b = plot(s, 9, 0);
      if (fenced) { const f = s.newBuilding('fence', b.tile, -1); f.built = true; }
      let n = 0;
      for (let i = 0; i < 3000; i++) {
        Object.assign(b.plot!, { crop: CROP.Roots, cond: 1, raided: -1 });
        (s as unknown as { pests(c: unknown, b: Building, dogs: boolean): void }).pests(s.camp, b, false);
        if (b.plot!.raided >= 0) n++;
      }
      return n;
    };
    const open = raids(false);
    expect(open).toBeGreaterThan(30);
    expect(raids(true)).toBeLessThan(open / 5);
  });

  it('keep roots and grain longer in a storage pit', () => {
    const lost = (pit: boolean) => {
      const s = sim(1);
      if (pit) { const b = s.newBuilding('pit', s.camp.tile + 4, -1); b.built = true; }
      const st = s.camp.stock;
      st.roots = 100; st.grain = 100;
      (s as unknown as { spoilNow(x: typeof st): void }).spoilNow(st);
      return { roots: 100 - st.roots, grain: 100 - st.grain };
    };
    const a = lost(false), b = lost(true);
    expect(b.roots).toBeLessThan(a.roots);
    expect(b.grain).toBeLessThan(a.grain);
    // grain keeps far better than roots even without one
    expect(a.grain).toBeLessThan(a.roots);
  });

  it('come through a save and load', () => {
    const s = sim(1);
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = SEED_PER_PLOT * 2;
    runTo(s, s.tick + TICKS_PER_SEASON + 2 * TICKS_PER_DAY);
    const sown = s.plots(s.camp).filter((b) => b.plot?.crop);
    expect(sown.length).toBeGreaterThan(0);
    const t = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())));
    expect(t.plots(t.camp).map((b) => b.plot)).toEqual(s.plots(s.camp).map((b) => b.plot));
    expect(t.camp.seed).toBe(s.camp.seed);
    runYears(t, 1);
    expect(Object.values(t.camp.stock).every((v) => Number.isFinite(v as number))).toBe(true);
  });

  it('can be sown only early in spring, in rested ground not harvested this year', () => {
    const s = sim(1);
    const b = plot(s);
    const at = (doy: number) => dayTick(s, doy);
    expect(s.sowable(b, CROP.Roots, at(0))).toBe(true);
    expect(s.sowable(b, CROP.Roots, at(7))).toBe(true);
    // roots take longer to come on than grain: they must be in the ground sooner
    expect(s.sowable(b, CROP.Roots, at(8))).toBe(false);
    expect(s.sowable(b, CROP.Grain, at(11))).toBe(true);
    expect(s.sowable(b, CROP.Grain, at(12))).toBe(false);
    for (const d of [20, 30, 40]) expect(s.sowable(b, CROP.Grain, at(d))).toBe(false);
    // and either crop sown on its last day ripens before the first frost (day 36)
    expect(7 + GROW_DAYS[CROP.Roots]).toBeLessThan(36);
    expect(11 + GROW_DAYS[CROP.Grain]).toBeLessThan(36);
    b.plot!.soil = SOIL_FALLOW - 0.05;
    expect(s.sowable(b, CROP.Roots, at(2))).toBe(false);
    b.plot!.soil = 1;
    b.plot!.reaped = yearOf(at(2));
    expect(s.sowable(b, CROP.Roots, at(2))).toBe(false);
    b.plot!.crop = CROP.Roots;
    b.plot!.reaped = 0;
    expect(s.sowable(b, CROP.Roots, at(2))).toBe(false);
  });

  it('are sown with grain while there is seed for it, and with roots once it runs out', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = SEED_PER_PLOT + 2;
    s.tick = dayTick(s, 3);
    const a = plot(s, 3, 2), b = plot(s, 4, 2);
    work(s, p, 'sow', a, SEED_PER_PLOT);
    expect(a.plot!.crop).toBe(CROP.Grain);
    expect(s.camp.seed).toBeCloseTo(2, 6);
    expect(a.plot!.care).toBeCloseTo(gardenSkill(p.skills[SK.garden]), 1);
    expect(s.nextCrop(s.camp)).toBe(CROP.Roots);
    work(s, p, 'sow', b, 0);
    expect(b.plot!.crop).toBe(CROP.Roots);
    expect(s.camp.seed).toBeCloseTo(2, 6);
  });

  it('are not sown by someone who gets there too late in the spring', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.knows.push('garden');
    s.tick = dayTick(s, 8);
    const b = plot(s);
    work(s, p, 'sow', b, 0);
    expect(b.plot!.crop).toBe(CROP.None);
  });

  it('count seed others are on their way to sow with, so two sowers never sow the same seed', () => {
    const s = sim(1);
    const [p, q] = [adult(s), adult(s, [adult(s)])];
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = SEED_PER_PLOT;
    s.tick = dayTick(s, 2);
    plot(s, 3, 2);
    plot(s, 4, 2);
    // one is set to sow grain with the band's only seed: the other can only plan on roots
    q.task = { kind: 'sow', stage: 0, goal: 0, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: SEED_PER_PLOT, near: false };
    expect(s.nextCrop(s.camp, SEED_PER_PLOT)).toBe(CROP.Roots);
    expect(p).not.toBe(q);
  });

  it('give greens off root plots in summer, picked and carried home while weeding', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.knows.push('garden');
    const b = plot(s);
    Object.assign(b.plot!, { crop: CROP.Roots, sown: s.tick, growth: 0.4 });
    for (let d = 12; d < 20; d++) gardenDay(s, d);
    expect(b.plot!.greens).toBeGreaterThan(3);
    s.tick = dayTick(s, 20);
    const before = s.camp.stock.greens;
    work(s, p, 'tend', b);
    expect(s.camp.stock.greens).toBeGreaterThan(before + 2);
    expect(b.plot!.weeds).toBe(0);
    expect(b.plot!.guarded).toBeGreaterThan(s.tick - TICKS_PER_DAY);
    // grain gives no greens
    const g = plot(s, 5, 2);
    Object.assign(g.plot!, { crop: CROP.Grain, sown: s.tick, growth: 0.2 });
    for (let d = 12; d < 20; d++) gardenDay(s, d);
    expect(g.plot!.greens).toBe(0);
  });

  it('give less for being left to the weeds, and less in a lean year', () => {
    const s = sim(1);
    const weeded = plot(s, 3, 2), choked = plot(s, 4, 2);
    for (const b of [weeded, choked]) Object.assign(b.plot!, { crop: CROP.Grain, sown: s.tick });
    for (let d = 0; d < GROW_DAYS[CROP.Grain]; d++) {
      gardenDay(s, d);
      weeded.plot!.weeds = 0;
    }
    // ripe on the day: not a day late for the fractions of a day adding up a hair short
    expect(weeded.plot!.growth).toBe(1);
    expect(choked.plot!.growth).toBe(1);
    expect(weeded.plot!.left).toBeCloseTo(PLOT_YIELD[CROP.Grain] * s.gardenYear(), 4);
    expect(choked.plot!.left).toBeLessThan(weeded.plot!.left * 0.8);
    // a blight on the land: the gardens suffer with everything else
    s.blightYear = yearOf(s.tick);
    expect(s.plotYield(weeded)).toBeCloseTo(PLOT_YIELD[CROP.Grain] * LEAN_GARDEN, 4);
  });

  it('are harvested a load at a time; the grain goes to the stores, with seed kept back for every plot', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = 0;
    const b = plot(s, 3, 2);
    plot(s, 4, 2);
    s.tick = dayTick(s, 30);
    Object.assign(b.plot!, { crop: CROP.Grain, growth: 1, left: 30, sown: s.tick - 20 * TICKS_PER_DAY });
    const grain0 = s.camp.stock.grain;
    let loads = 0;
    while (b.plot!.crop && loads < 10) { work(s, p, 'harvest', b); loads++; }
    expect(loads).toBeGreaterThan(1);
    expect(b.plot!.crop).toBe(CROP.None);
    const kept = s.camp.seed!;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThanOrEqual(2 * SEED_PER_PLOT + 1e-6);
    expect(s.camp.stock.grain - grain0 + kept).toBeCloseTo(30, 0);
    // the reaped plot: stubble on it, the ground a little tired, not to be sown again this year
    expect(b.plot!.reaped).toBe(yearOf(s.tick));
    expect(b.plot!.last).toBe(CROP.Grain);
    expect(b.plot!.soil).toBeCloseTo(1 - SOIL_TIRE, 6);
    expect(s.plotLook(b)).toBe('plotStubble');
    expect(s.sowable(b, CROP.Roots, dayTick(s, 2) - TICKS_PER_YEAR)).toBe(false);
  });

  it('make news of the first harvest only once, however many plots and years', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.knows.push('garden');
    const b = plot(s);
    const harvests = () => s.events.filter((e) => e.kind === 'harvest').length;
    for (let y = 0; y < 3; y++) {
      s.tick = dayTick(s, 30);
      Object.assign(b.plot!, { crop: CROP.Roots, growth: 1, left: 5 });
      work(s, p, 'harvest', b);
      expect(b.plot!.crop).toBe(CROP.None);
    }
    expect(harvests()).toBe(1);
  });

  it('wear out with harvest after harvest, are left fallow, and rest for it', () => {
    const s = sim(1);
    const b = plot(s);
    const pl = b.plot!;
    pl.soil = SOIL_FALLOW - 0.02;
    pl.reaped = yearOf(s.tick);
    s.tick = dayTick(s, 0);
    // the year after the harvest: too tired to sow, and not yet rested
    gardenDay(s, 0);
    expect(pl.soil).toBeCloseTo(SOIL_FALLOW - 0.02, 6);
    expect(s.sowable(b, CROP.Roots)).toBe(false);
    // a whole year left alone: rested
    s.tick = dayTick(s, 0);
    gardenDay(s, 0);
    expect(pl.soil).toBeGreaterThanOrEqual(SOIL_FALLOW);
    expect(s.sowable(b, CROP.Roots)).toBe(true);
  });

  it('show what is in them: bare, sown, in leaf, ripe', () => {
    const s = sim(1);
    const b = plot(s);
    const pl = b.plot!;
    expect(s.plotLook(b)).toBe('plot');
    Object.assign(pl, { crop: CROP.Roots, growth: 0.1 });
    expect(s.plotLook(b)).toBe('plotSown');
    pl.growth = 0.6;
    expect(s.plotLook(b)).toBe('plotRoots');
    Object.assign(pl, { crop: CROP.Grain, growth: 0.6 });
    expect(s.plotLook(b)).toBe('plotGrain');
    pl.growth = 1;
    expect(s.plotLook(b)).toBe('plotRipe');
    // (a plot not yet dug looks like bare ground)
    b.built = false;
    expect(s.plotLook(b)).toBe('plot');
  });

  it('are described on their card, as are fences and pits', () => {
    const s = sim(1);
    s.camp.knows.push('garden');
    const b = plot(s);
    Object.assign(b.plot!, { crop: CROP.Roots, sown: s.tick, growth: 0.5, weeds: 0.5, raided: s.tick, raider: 'deer' });
    const card = s.inspectThing({ kind: 'building', id: b.id })!;
    const line = (l: string) => card.lines.find((q) => q.label === l)?.value ?? '';
    expect(card.title).toContain('Garden plot');
    expect(line('Growing')).toContain('Roots');
    expect(line('Weeds')).toBe('Choking the crop');
    expect(line('Raided')).toContain('deer');
    expect(line('Fence')).toContain('None');
    const pit = s.newBuilding('pit', s.camp.tile + 4, -1);
    pit.built = true;
    s.camp.stock.grain = 12;
    const pc = s.inspectThing({ kind: 'building', id: pit.id })!;
    expect(pc.lines.find((q) => q.label === 'Holding')!.value).toContain('12 meals of grain');
    // a plot site is all work: no wood to bring
    const site = s.newBuilding('plot', s.camp.tile + 6, -1);
    expect(s.inspectThing({ kind: 'building', id: site.id })!.lines.some((q) => q.label === 'Wood')).toBe(false);
  });

  it('are fenced, the last raided first, once the band knows how', () => {
    const s = sim(1);
    s.camp.knows.push('garden', 'fences');
    const a = plot(s, 3, 2), b = plot(s, 4, 2);
    b.plot!.raided = s.tick - 5;
    (s as unknown as { planGardens(c: unknown, s: number): void }).planGardens(s.camp, 1);
    const fences = s.buildings.filter((q) => q.kind === 'fence');
    expect(fences.map((f) => f.tile)).toEqual([b.tile]);
    expect(knowHowFor(fences[0])).toEqual(['fences']);
    // one at a time
    (s as unknown as { planGardens(c: unknown, s: number): void }).planGardens(s.camp, 1);
    expect(s.buildings.filter((q) => q.kind === 'fence').length).toBe(1);
    expect(a.id).not.toBe(b.id);
  });

  it('need the right stuff to build: a plot is only digging, a fence wood and cordage, a pit clay and grass', () => {
    expect(specOf({ kind: 'plot' }).wood + specOf({ kind: 'plot' }).fiber + specOf({ kind: 'plot' }).mud).toBe(0);
    expect(specOf({ kind: 'fence' }).wood).toBeGreaterThan(0);
    expect(specOf({ kind: 'fence' }).cordage).toBeGreaterThan(0);
    expect(specOf({ kind: 'pit' }).mud).toBeGreaterThan(0);
    expect(specOf({ kind: 'pit' }).keep).toBeLessThan(1);
    expect(knowHowFor({ kind: 'plot' })).toEqual(['garden']);
    expect(knowHowFor({ kind: 'pit' })).toEqual(['pits']);
  });

  it('are found in order: gardens first, then grain, and fences and pits after', () => {
    expect(DISCOVERY.get('garden')!.needs).toEqual([]);
    expect(DISCOVERY.get('grain')!.needs).toContain('garden');
    expect(DISCOVERY.get('fences')!.needs).toContain('garden');
    expect(DISCOVERY.get('pits')!.needs).toContain('grain');
    // working out how to sow grain comes with the first handfuls of seed
    const s = sim(1);
    s.camp.knows.push('garden');
    (s as unknown as { learn(c: unknown, k: string, how: string): void }).learn(s.camp, 'grain', 'found');
    expect(s.camp.seed).toBeGreaterThanOrEqual(SEED_PER_PLOT * 2);
  });

  it('lose their seed to a starving band, which eats it', () => {
    const s = sim(1);
    const c = s.camp;
    c.seed = 18;
    for (const k of Object.keys(c.stock) as (keyof Stock)[]) if (k !== 'wood') c.stock[k] = 0;
    for (const p of s.members(c)) p.food = 2;
    gardenDay(s, 40);
    expect(c.seed).toBe(0);
    expect(c.stock.grain).toBeCloseTo(18, 6);
    expect(s.events.at(-1)!.kind).toBe('seed');
    // with food in the store, the seed is left alone
    c.seed = 18;
    c.stock.meat = 20;
    gardenDay(s, 41);
    expect(c.seed).toBe(18);
  });

  it('take their seed with them when the band gives up its camp, and leave the gardens to the weeds', () => {
    const s = sim(1);
    const home = s.camp;
    home.knows.push('garden', 'grain');
    home.seed = 30;
    const b = plot(s);
    Object.assign(b.plot!, { crop: CROP.Grain, growth: 0.5 });
    // giving up the camp: the gardens are left to the weeds, the seed goes with them
    home.leanWinters = 3;
    home.settled = s.tick - 3 * TICKS_PER_YEAR;
    const r = (s as any).rLife;
    const chance = r.chance;
    r.chance = () => true;
    let moved = false;
    try { moved = (s as any).considerMove(home); } finally { r.chance = chance; }
    expect(moved).toBe(true);
    const nc = s.camps.at(-1)!;
    expect(nc.seed).toBe(30);
    expect(home.seed).toBe(0);
    expect(b.plot!.crop).toBe(CROP.None);
  });

  it('tie a band to its camp: it is far slower to leave gardens behind', () => {
    // (a band moves on a roll of the dice; with two plots dug the odds are a fifth of what they were)
    const odds = (plots: number) => {
      const s = sim(1);
      const c = s.camp;
      for (let i = 0; i < plots; i++) plot(s, 3 + i, 2);
      c.leanWinters = 3;
      c.settled = s.tick - 3 * TICKS_PER_YEAR;
      const r = (s as any).rLife;
      const chance = r.chance;
      let asked = -1;
      r.chance = (p: number) => { if (asked < 0) asked = p; return false; };
      try { (s as any).considerMove(c); } finally { r.chance = chance; }
      return asked;
    };
    const none = odds(0), two = odds(2);
    expect(none).toBeGreaterThan(0);
    expect(two).toBeCloseTo(none * 0.2, 6);
  });

  it('read saves from before gardening: no gardening skill yet, the other skills as they were, empty grain stores', () => {
    const s = runYears(sim(2), 1);
    const save = s.serialize();
    for (const p of save.people) (p as any).skills = (p.skills as unknown as number[]).slice(0, SK.garden);
    for (const c of save.camps ?? []) { delete (c.stock as any).grain; delete (c.stock as any).greens; }
    const p0 = save.people.find((p) => p.alive)!;
    const weave = (p0.skills as unknown as number[])[SK.weave];
    const t = new (s.constructor as any)(s.world, save) as Sim;
    const p = t.byId.get(p0.id)!;
    expect(p.skills.length).toBe(SKILLS.length);
    expect(p.skills[SK.weave]).toBeCloseTo(weave, 5);
    expect(p.skills[SK.garden]).toBe(0);
    expect(t.camp.stock.grain).toBe(0);
    expect(Number.isFinite(foodTotal(t.camp.stock))).toBe(true);
    runTo(t, t.tick + 3 * TICKS_PER_DAY);
  });

  it('are only worked by people old enough: children weed, but sowing and the harvest are for the older ones', () => {
    const s = sim(3);
    s.camp.knows.push('garden', 'grain');
    s.camp.seed = SEED_PER_PLOT * 4;
    const end = s.tick + 2 * TICKS_PER_YEAR;
    const kinds = new Set<string>();
    while (s.tick < end) {
      s.step();
      if (s.tick % 10) continue;
      for (const p of s.living()) {
        const k = p.task?.kind;
        if (k !== 'sow' && k !== 'tend' && k !== 'harvest') continue;
        kinds.add(k);
        expect(s.age(p)).toBeGreaterThanOrEqual(k === 'tend' ? 9 : 11);
      }
    }
    expect([...kinds].sort()).toEqual(['harvest', 'sow', 'tend']);
  });

  it('break none of the rules of the world over years of gardening', () => {
    for (const seed of [2, 5]) {
      const s = sim(seed);
      s.camp.knows.push('garden', 'grain', 'fences', 'pits');
      s.camp.seed = SEED_PER_PLOT * 3;
      const ch = runChecked(s, 6, `gardens ${seed}`);
      expect(ch.problems).toEqual(new Map());
      expect(s.buildings.some((b) => b.kind === 'pit' && b.built)).toBe(true);
      expect(s.buildings.some((b) => b.kind === 'fence' && b.built)).toBe(true);
    }
  });

  it('sown on the last day they can be, ripen in time to be brought in before the frost', () => {
    const s = sim(1);
    for (const [crop, last] of [[CROP.Roots, 7], [CROP.Grain, 11]] as const) {
      const b = plot(s, crop === CROP.Roots ? 3 : 4, 2);
      Object.assign(b.plot!, { crop, sown: s.tick });
      let ripe = -1;
      for (let d = last; d < 36 && ripe < 0; d++) {
        gardenDay(s, d);
        if (b.plot!.growth >= 1) ripe = d;
      }
      expect(ripe).toBe(last + GROW_DAYS[crop] - 1);
      // with at least a few days to bring it in
      expect(36 - ripe).toBeGreaterThanOrEqual(3);
    }
  });

  it('are sown no more than the band wants, and fewer with years of grain put by', () => {
    const s = sim(1);
    const c = s.camp;
    c.knows.push('garden', 'grain');
    c.seed = 200;
    const want = s.plotsWanted(c);
    expect(want).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < want + 4; i++) plot(s, 2 + (i % 6), 1 + Math.floor(i / 6));
    s.tick = dayTick(s, 2);
    expect(s.toSow(c)).toBe(want);
    s.plan();
    expect(c.jobs.sow).toBeGreaterThan(0);
    // once that many are in, nobody goes out to sow another
    for (const b of s.plots(c).slice(0, want)) Object.assign(b.plot!, { crop: CROP.Grain, sown: s.tick });
    expect(s.toSow(c)).toBe(0);
    s.plan();
    expect(c.jobs.sow).toBe(0);
    const p = adult(s);
    s.camp = c;
    work(s, p, 'sow', s.plots(c)[want], SEED_PER_PLOT);
    expect(s.plots(c).filter((b) => b.plot!.crop).length).toBe(want);
    // with two years' grain in the store, half as many plots will do
    c.stock.grain = 100000;
    expect(s.plotsWanted(c)).toBe(Math.max(2, Math.ceil(want / 2)));
  });

  it('are not dug without end: a band with plots resting digs a few more, not a field to the horizon', () => {
    const s = sim(1);
    const c = s.camp;
    c.knows.push('garden', 'grain');
    const want = s.plotsWanted(c);
    for (let i = 0; i < Math.ceil(want * 1.7); i++) { const b = plot(s, 2 + (i % 6), 1 + Math.floor(i / 6)); b.plot!.soil = 0.45; }
    const n = s.plots(c, true).length;
    s.tick = dayTick(s, 14);
    (s as unknown as { planGardens(c: unknown, s: number): void }).planGardens(c, 1);
    expect(s.plots(c, true).length).toBe(n);
  });

  it('keep back seed for the plots they will sow, not for every plot they have dug', () => {
    const s = sim(1);
    const c = s.camp;
    const p = adult(s);
    c.knows.push('garden', 'grain');
    c.seed = 0;
    const want = s.plotsWanted(c);
    const plots = Array.from({ length: want + 5 }, (_, i) => plot(s, 2 + (i % 6), 1 + Math.floor(i / 6)));
    s.tick = dayTick(s, 30);
    const b = plots[0];
    for (let n = 0; n < 12; n++) {
      Object.assign(b.plot!, { crop: CROP.Grain, growth: 1, left: 40, reaped: 0 });
      while (b.plot!.crop) work(s, p, 'harvest', b);
    }
    expect(c.seed).toBeCloseTo(want * SEED_PER_PLOT, 6);
  });
});
