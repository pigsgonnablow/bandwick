// The thorn hedge: blackthorn and bramble laid in a ring round the camp, the thorns turned outward, with gaps where
// the paths run out. Wolves keep further off, nothing out on the land falls on anyone close to it after dark, nobody
// inside is uneasy in the dark away from the fire, and the foxes are kept off the snares near camp.
import { describe, it, expect } from 'vitest';
import { SK, BUILD, HEDGE_WOLF, HEDGE_LEAST, HEDGE_MOST, UNHEDGED } from '../../src/sim/band';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { WATER } from '../../src/sim/types';
import { TICKS_PER_DAY, isDark } from '../../src/sim/time';
import { setup, runTask, completeBuilding } from '../../src/sim/ai';
import { Sim, isTreeType } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band a couple of years on, with its huts up, wood put by, and the idea of a hedge. */
function band(seed = 2) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of ['huts', 'hedge']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.wood += 60;
  c.stock.grain += 2000;
  c.stock.preserved += 500;
  return s;
}
const hedgeOf = (s: Sim) => s.buildings.find((b) => b.band === s.camp.id && b.kind === 'hedge');
/** Run until the band's hedge is finished. */
function hedged(s: Sim) {
  for (let k = 0; k < 40 * TICKS_PER_DAY && !hedgeOf(s)?.built; k++) s.step();
  const h = hedgeOf(s)!;
  expect(h?.built).toBe(true);
  return h;
}

describe('thorn hedge', () => {
  it('is thought of by a builder who knows the woods, hearing the wolves or finding the garden raided', () => {
    const d = DISCOVERY.get('hedge')!;
    expect(d.needs).toEqual(['huts']);
    expect(d.requires).toEqual([{ kind: 'skill', skill: SK.build, level: 11 }, { kind: 'skill', skill: SK.wood, level: 10 }]);
    expect(d.practice.wolves).toBeGreaterThan(0);
    expect(d.practice.raided).toBeGreaterThan(0);
    expect(knowHowFor({ kind: 'hedge' })).toEqual(['hedge']);
    expect(BUILD.hedge.wood).toBeGreaterThan(0);
  });

  it('is not laid by a band that has not thought of it', () => {
    const s = runYears(sim(2), 2);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'hedge');
    runTo(s, s.tick + 3 * TICKS_PER_DAY);
    expect(hedgeOf(s)).toBeUndefined();
  });

  it('is laid in a ring round the camp\'s buildings, over open dry land, with a gap at the gate', () => {
    const s = band();
    const h = hedged(s);
    const c = s.camp, N = s.N;
    const cx = Math.floor(c.x) + 0.5, cz = Math.floor(c.z) + 0.5;
    expect(h.reach!).toBeGreaterThanOrEqual(HEDGE_LEAST);
    expect(h.reach!).toBeLessThanOrEqual(HEDGE_MOST);
    expect(h.ring!.length).toBeGreaterThan(8);
    // every length of it about the same way from the fire, on dry land, on no building
    for (const i of h.ring!) {
      const d = Math.hypot((i % N) + 0.5 - cx, Math.floor(i / N) + 0.5 - cz);
      expect(Math.abs(d - h.reach!)).toBeLessThan(1.5);
      expect(s.world.water[i]).toBe(WATER.None);
      expect(s.buildings.some((b) => b !== h && b.tile === i)).toBe(false);
    }
    // the huts and the stores are inside it
    for (const b of s.bandBuildings(c).filter((q) => q.kind === 'hut' || q.kind === 'stockpile')) {
      expect(Math.hypot(b.x + 0.5 - cx, b.z + 0.5 - cz)).toBeLessThan(h.reach!);
    }
    const all = new Set(h.ring);
    // and nothing new is built on its line
    for (let k = 0; k < 20; k++) {
      const t = s.siteFor('hut', null);
      if (t < 0) break;
      expect(all.has(t)).toBe(false);
      s.newBuilding('hut', t, -1).built = true;
    }
  });

  it('keeps its line clear of new garden plots', () => {
    const s = band();
    for (let k = 0; k < 10 * TICKS_PER_DAY && !hedgeOf(s); k++) s.step();
    const h = hedgeOf(s)!;
    const all = new Set(h.ring);
    s.camp.knows.push('garden');
    for (let k = 0; k < 30; k++) {
      const t = s.plotSite();
      if (t < 0) break;
      expect(all.has(t)).toBe(false);
      s.newBuilding('plot', t, -1).built = true;
    }
  });

  it('is laid round from its gate: the builders work where it has got to', () => {
    const s = band();
    for (let k = 0; k < 10 * TICKS_PER_DAY && !hedgeOf(s); k++) s.step();
    const h = hedgeOf(s)!;
    expect(h).toBeDefined();
    h.wood = BUILD.hedge.wood;
    h.cordage = BUILD.hedge.cordage;
    h.work = BUILD.hedge.work * 0.5;
    const p = s.members().find((q) => s.age(q) >= 18 && q.sick === 0)!;
    const t = setup(s, p, 'build');
    expect(t?.kind).toBe('build');
    expect(t!.goal).toBe(h.ring![Math.floor(h.ring!.length * 0.5)]);
    // and once it has been laid on past them, they move along with it, rather than lay the whole ring from one spot
    p.task = t;
    p.x = t!.gx; p.z = t!.gz; p.path = null;
    runTask(s, p);
    expect(p.task?.kind).toBe('build');
    h.work = BUILD.hedge.work * 0.7;
    runTask(s, p);
    expect(p.task?.kind === 'build' && p.task.goal === t!.goal).toBe(false);
  });

  it('keeps the wolves further off, and the night outside the fire\'s circle is no longer unsettling inside it', () => {
    const s = band();
    const before = (s as any).wolfShy()[0].r;
    const h = hedged(s);
    expect((s as any).wolfShy()[0].r).toBe(before + HEDGE_WOLF);
    // someone standing in the dark inside the hedge, away from the fire
    while (!isDark(s.tick)) s.step();
    const c = s.camp;
    expect(s.inHedge(c.x + h.reach! - 1.5, c.z)).toBe(true);
    expect(s.inHedge(c.x + h.reach! + 1.5, c.z)).toBe(false);
  });

  it('is left behind when the band moves on: it keeps nothing off from an empty camp', () => {
    const s = band();
    const h = hedged(s);
    const c = s.camp;
    expect(s.hedgeOf(c)).toBe(h);
    c.gone = s.tick;
    expect(s.hedgeOf(c)).toBeUndefined();
    expect(s.inHedge(c.x + 1, c.z)).toBe(false);
  });
  it('clears brush and trees off its line as it is laid round, and nothing grows back up on it', () => {
    const s = band();
    for (let k = 0; k < 10 * TICKS_PER_DAY && !hedgeOf(s); k++) s.step();
    const h = hedgeOf(s)!;
    // a young tree on a length of the line the hedge has not reached yet
    const far = h.ring![h.ring!.length - 2];
    const N = s.N;
    const tree = s.addProp(0, (far % N) + 0.5, s.world.level[far], Math.floor(far / N) + 0.5, 0, 1);
    const on = () => { let n = 0; for (let k = 0; k < s.propCount; k++) if (s.propAlive[k] && isTreeType(s.propType[k]) && h.ring!.includes(s.propTile[k])) n++; return n; };
    expect(s.propAlive[tree]).toBeTruthy();
    h.wood = BUILD.hedge.wood;
    h.cordage = BUILD.hedge.cordage;
    h.work = BUILD.hedge.work * 0.5;
    s.clearHedge(h);
    // half laid: the near half of the line is clear, the tree further round still stands
    expect(s.propAlive[tree]).toBeTruthy();
    for (const i of h.ring!.slice(0, Math.floor(h.ring!.length * 0.5))) for (let k = 0; k < s.propCount; k++) if (s.propAlive[k] && s.propTile[k] === i) expect(isTreeType(s.propType[k])).toBe(false);
    completeBuilding(s, h, s.members()[0]);
    expect(s.propAlive[tree]).toBeFalsy();
    expect(on()).toBe(0);
    expect(s.onHedgeLine(far)).toBe(true);
  });

  it('keeps what is built after it inside it, and is laid again further out round anything that ends up outside', () => {
    const s = band();
    const h = hedged(s);
    const c = s.camp;
    const cx = Math.floor(c.x) + 0.5, cz = Math.floor(c.z) + 0.5;
    const d = (t: number) => Math.hypot((t % s.N) + 0.5 - cx, Math.floor(t / s.N) + 0.5 - cz);
    for (const kind of ['kiln', 'loom', 'sweat', 'longhouse'] as const) expect(d(s.siteFor(kind, null))).toBeLessThan(h.reach!);
    // (a monument still goes up out beyond it)
    expect(UNHEDGED).toContain('stones');
    if (h.reach! >= HEDGE_MOST - 0.5) return;
    // a store put up just outside the hedge, as if there had been no room within
    const t = Math.floor(cz) * s.N + Math.floor(cx + h.reach! + 1);
    const out = s.newBuilding('storehouse', t, -1);
    out.built = true;
    for (let k = 0; k < 3 * TICKS_PER_DAY && !s.buildings.some((b) => b.kind === 'hedge' && b.band === c.id && !b.built); k++) s.step();
    const wider = s.buildings.find((b) => b.kind === 'hedge' && b.band === c.id && !b.built)!;
    expect(wider).toBeDefined();
    expect(wider.reach!).toBeGreaterThan(h.reach!);
    expect(d(t)).toBeLessThan(wider.reach!);
    // the old hedge keeps the camp until the new one is finished, and then is grubbed up
    expect(s.hedgeOf(c)).toBe(h);
    completeBuilding(s, wider, s.members()[0]);
    expect(s.buildings.filter((b) => b.kind === 'hedge' && b.band === c.id)).toEqual([wider]);
    expect(s.hedgeOf(c)).toBe(wider);
  });

  it('only shuts in its own band: someone of another band inside it is as uneasy in the dark as anywhere', () => {
    const s = band();
    const h = hedged(s);
    const c = s.camp;
    expect(s.inHedge(c.x + h.reach! - 1.5, c.z, c.id)).toBe(true);
    expect(s.inHedge(c.x + h.reach! - 1.5, c.z, c.id + 1000)).toBe(false);
  });
});
