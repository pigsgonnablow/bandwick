// The sweat lodge: a low dome of withies under hides, stones heated in the fire carried into it, water poured over
// them. On cold evenings the band sweats in it: they come out warmed through, a fever breaks sooner in it and is
// slower to take hold after, and in the dark people talk over what they believe the signs foretell.
import { describe, it, expect } from 'vitest';
import { SK, Person, Building, BUILD, SWEAT_HIDES, SWEAT_BREAK, SWEAT_HOLDS, SWEAT_WOOD, SWEAT_TICKS, CARRY } from '../../src/sim/band';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { TICKS_PER_DAY, seasonOf, hourOf } from '../../src/sim/time';
import { setup, runTask, completeBuilding, lodgeDoor } from '../../src/sim/ai';
import { lodgeTales, sight, omenOutcome } from '../../src/sim/omen';
import { Sim } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band a few years on, fed and with wood put by, knowing huts and the healing herbs. */
function band(seed = 2) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of ['huts', 'herbs']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.wood += 80;
  c.stock.grain += 2000;
  c.stock.preserved += 500;
  return s;
}
/** The same band with a sweat lodge standing a little way from its fire. */
function withLodge(s: Sim) {
  if (!s.camp.knows.includes('sweat')) s.camp.knows.push('sweat');
  const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
  const lodge: Building = { ...pile, id: s.newId(), kind: 'sweat', built: true, x: pile.x + 3, tile: pile.tile + 3, builders: [] };
  delete lodge.hot;
  s.buildings.push(lodge);
  return lodge;
}
const adults = (s: Sim) => s.members().filter((q) => s.age(q) >= 18 && s.age(q) <= 50);
/** Walk someone through a sweat from start to finish: heating the stones if nobody has, then in and out again. */
function sweat(s: Sim, p: Person) {
  p.task = setup(s, p, 'sweat');
  expect(p.task).not.toBeNull();
  let inside = false;
  for (let k = 0; k < 2000 && p.task?.kind === 'sweat'; k++) {
    runTask(s, p);
    if (p.indoors) inside = true;
    s.tick++;
  }
  return inside;
}

describe('sweat lodge', () => {
  it('is thought of by a healer who can build, sitting with the sick, once the band has huts and herbs', () => {
    const d = DISCOVERY.get('sweat')!;
    expect(d.needs).toEqual(['huts', 'herbs']);
    expect(d.requires).toEqual([{ kind: 'skill', skill: SK.forage, level: 12 }, { kind: 'skill', skill: SK.build, level: 8 }]);
    expect(d.practice.sickbed).toBe(1);
    expect(knowHowFor({ kind: 'sweat' })).toEqual(['sweat']);
    expect(BUILD.sweat.wood).toBeGreaterThan(0);
    expect(BUILD.sweat.stone).toBeGreaterThan(0);
  });

  it('is planned once the band knows it, and covered with the band\'s hides when it is finished', () => {
    const s = band();
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.some((b) => b.band === s.camp.id && b.kind === 'sweat')).toBe(false);
    s.camp.knows.push('sweat');
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    const sites = s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'sweat');
    expect(sites.length).toBe(1);
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'sweat').length).toBe(1);
    // finished: covered with hides from the stores, as many as it takes
    s.camp.stock.hides = SWEAT_HIDES + 2;
    completeBuilding(s, sites[0], adults(s)[0]);
    expect(s.camp.stock.hides).toBe(2);
  });

  it('heats the stones in the fire, carries them in, and warms whoever sits in it through', () => {
    const s = band();
    const lodge = withLodge(s);
    const [p, q] = adults(s);
    s.hearth().fuel = 10;
    p.warmth = 30;
    const wood = s.camp.stock.wood;
    // the first to go heats the stones
    p.task = setup(s, p, 'sweat');
    expect(p.task!.stage).toBe(5);
    let carried = false;
    for (let k = 0; k < 2000 && p.task?.kind === 'sweat' && !p.indoors; k++) {
      runTask(s, p);
      if (p.carry === CARRY.Stone) carried = true;
      s.tick++;
    }
    expect(carried).toBe(true);
    expect(s.lodgeHot(lodge)).toBe(true);
    expect(s.camp.stock.wood).toBeCloseTo(wood - SWEAT_WOOD, 5);
    expect(p.indoors).toBe(true);
    // the next goes straight in while the stones are hot
    q.task = setup(s, q, 'sweat');
    expect(q.task!.stage).toBe(0);
    const d = lodgeDoor(lodge);
    expect(Math.hypot(q.task!.gx - d.x, q.task!.gz - d.z)).toBeLessThan(1e-6);
    // and when the time is up they come out warmed, and the cold bites less for a while
    for (let k = 0; k < 400 && p.task?.kind === 'sweat'; k++) { runTask(s, p); s.tick++; }
    expect(p.indoors).toBe(false);
    expect(p.warmth).toBeGreaterThan(60);
    expect(p.sweat).toBeDefined();
    expect(s.sweatWarded(p)).toBe(true);
    expect(p.warmed ?? 0).toBeGreaterThan(s.tick);
    expect(s.camp.ledger?.total?.['sweat.sat']).toBeGreaterThan(0);
  });

  it('breaks a fever sooner, and wards one off for a few days after', () => {
    const s = band();
    withLodge(s);
    s.hearth().fuel = 10;
    const p = adults(s)[0];
    p.sick = SWEAT_BREAK + 3;
    expect(sweat(s, p)).toBe(true);
    expect(p.sick).toBe(3);
    // sweated out entirely: remembered for it
    p.sick = SWEAT_BREAK;
    delete p.sweat;
    sweat(s, p);
    expect(p.sick).toBe(0);
    expect(p.memories.some((m) => m.text === 'Sweated out a fever in the lodge.')).toBe(true);
    // (and the ward wears off)
    expect(s.sweatWarded(p)).toBe(true);
    s.tick += 10 * TICKS_PER_DAY;
    expect(s.sweatWarded(p)).toBe(false);
  });

  it('holds no more than it can', () => {
    const s = band();
    const lodge = withLodge(s);
    lodge.hot = s.tick + 100;
    const ms = s.members().filter((q) => s.age(q) >= 12);
    let inside = 0;
    for (const q of ms) {
      q.task = setup(s, q, 'sweat');
      q.x = lodgeDoor(lodge).x;
      q.z = lodgeDoor(lodge).z;
      runTask(s, q);
      if (q.indoors) inside++;
    }
    expect(inside).toBeLessThanOrEqual(SWEAT_HOLDS);
    expect(inside).toBeGreaterThan(0);
  });

  it('is where the band goes to sweat on cold evenings, through a winter', () => {
    const s = band(1);
    withLodge(s);
    // on to the winter
    while (seasonOf(s.tick) !== 3) runTo(s, s.tick + TICKS_PER_DAY);
    runTo(s, s.tick + 12 * TICKS_PER_DAY);
    const sat = s.camp.ledger?.total?.['sweat.sat'] ?? 0;
    expect(sat).toBeGreaterThan(5);
    // and evenings only, unless a sign sends them in
    for (let k = 0; k < 3 * TICKS_PER_DAY; k++) {
      s.step();
      for (const q of s.members()) if (q.task?.kind === 'sweat' && q.task.stage === 1 && q.task.timer === SWEAT_TICKS - 1) {
        const h = hourOf(s.tick);
        expect(h >= 15 && h < 24).toBe(true);
      }
    }
  });

  it('is where beliefs pass between those who sweat together', () => {
    const s = band();
    withLodge(s);
    // the band comes to believe a sign: the odds forced, so the whole band sees it and one believes
    const ms = s.members().filter((q) => s.age(q) >= 14);
    s.rOmen = { chance: () => true, next: () => 0, int: (lo: number) => lo } as unknown as Sim['rOmen'];
    sight(s, s.camp, 'comet', ms);
    s.tick += 5;
    omenOutcome(s, 'death', [ms[0].id]);
    const l = s.camp.lore?.find((x) => x.sign === 'comet');
    expect(l).toBeDefined();
    // (one of them holds it, the rest not yet)
    const believer = ms.find((q) => q.beliefs?.includes(l!.key))!;
    expect(believer).toBeDefined();
    for (const q of ms) if (q !== believer) delete q.beliefs;
    const doubter = ms.find((q) => q !== believer)!;
    let k = 0;
    while (!doubter.beliefs?.includes(l!.key) && k++ < 500) lodgeTales(s, doubter, [believer]);
    expect(doubter.beliefs).toContain(l!.key);
    expect(doubter.memories.some((m) => /sweat lodge/.test(m.text))).toBe(true);
    // (with nobody inside who believes it, nothing passes)
    const other = ms.find((q) => q !== doubter && q !== believer && !q.beliefs?.length);
    if (other) {
      for (let j = 0; j < 200; j++) lodgeTales(s, other, []);
      expect(other.beliefs ?? []).not.toContain(l!.key);
    }
  });
});
