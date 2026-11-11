// Penned pigs: piglets brought home alive from the boar hunt, kept in a pen by the gardens, fed from the stores,
// farrowing in spring and killed for the stores in autumn (or when the band goes hungry).
import { describe, it, expect } from 'vitest';
import { Building, PIG_LOST_DAYS, PIG_MEAT, PIG_MEAT_YOUNG, PIG_SOWS_KEPT } from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR } from '../../src/sim/time';
import { Sim } from '../../src/sim/sim';
import { addPig, feedPigs, killPig, pigsDaily, pigsOf, pigToKill, pigsWanted, packPigs, PIG_ID } from '../../src/sim/pigs';
import { sim, runTo, runYears } from '../helpers';

/** A band two years on that knows its gardens and the boar, and has a pig pen standing by the camp. */
function keepers(seed = 1) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of ['garden', 'boar', 'pigs']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.greens += 400;
  c.stock.nuts += 400;
  const pile = s.buildings.find((b) => b.band === c.id && b.kind === 'stockpile')!;
  const pen: Building = { ...pile, id: s.newId(), kind: 'pen', built: true, x: pile.x + 3, tile: pile.tile + 3, builders: [] };
  s.buildings.push(pen);
  return { s, c, pen };
}
/** Move the clock to a point in the year (0 spring .. 4), without running the world. */
const at = (s: Sim, pos: number) => {
  s.tick = Math.floor(s.tick / TICKS_PER_YEAR + 1) * TICKS_PER_YEAR + Math.round(pos * TICKS_PER_SEASON);
};
/** A pig born some years ago. */
const aged = (s: Sim, g: ReturnType<typeof addPig>, years: number) => {
  g.born = s.tick - Math.round(years * TICKS_PER_YEAR);
  return g;
};

describe('penned pigs', () => {
  it('are found by a hunter with a garden, after the boar, and need a pen', () => {
    const d = DISCOVERY.get('pigs')!;
    expect(d.needs).toEqual(['garden', 'boar']);
    expect(Object.keys(d.practice)).toEqual(['piglet']);
  });

  it('send the hunters for piglets until the pen has a sow, a boar and a few to start with', () => {
    const { s, c, pen } = keepers();
    expect(pigsWanted(s, c)).toBe(true);
    addPig(s, c, pen, true, true);
    addPig(s, c, pen, false, true);
    expect(pigsWanted(s, c)).toBe(true);
    addPig(s, c, pen, true, true);
    expect(pigsWanted(s, c)).toBe(false);
    // and without a pen, none are wanted
    s.buildings.splice(s.buildings.indexOf(pen), 1);
    expect(pigsWanted(s, c)).toBe(false);
  });

  it('eat greens and acorns from the stores, most in winter, and run off when left unfed', () => {
    const { s, c, pen } = keepers();
    const herd = [aged(s, addPig(s, c, pen, true, false), 2), aged(s, addPig(s, c, pen, false, false), 2)];
    at(s, 3.5);
    const before = c.stock.greens + c.stock.nuts;
    expect(feedPigs(s, c)).toBe(1);
    expect(before - (c.stock.greens + c.stock.nuts)).toBeGreaterThan(0);
    expect(herd.every((g) => g.fed === s.tick)).toBe(true);
    // with nothing in store, the pigs go hungry, and break out in the end
    for (const k of ['greens', 'nuts', 'roots', 'berries', 'grain'] as const) c.stock[k] = 0;
    s.tick += TICKS_PER_DAY;
    expect(feedPigs(s, c)).toBe(0);
    s.tick += PIG_LOST_DAYS * TICKS_PER_DAY;
    pigsDaily(s);
    expect(pigsOf(s, c)).toHaveLength(0);
    expect(c.ledger!.now['pigs.lost']).toBe(2);
    expect(s.events.some((e) => e.kind === 'pig_lost')).toBe(true);
  });

  it('farrow in spring, a litter to a fed sow with a boar in the pen', () => {
    const { s, c, pen } = keepers();
    at(s, 0.2);
    aged(s, addPig(s, c, pen, true, false), 2);
    aged(s, addPig(s, c, pen, false, false), 2);
    for (let d = 0; d < 10 && pigsOf(s, c).length === 2; d++) {
      s.tick += TICKS_PER_DAY;
      for (const g of pigsOf(s, c)) g.fed = s.tick;
      pigsDaily(s);
    }
    expect(pigsOf(s, c).length).toBeGreaterThan(2);
    expect(c.ledger!.now['pigs.born']).toBe(pigsOf(s, c).length - 2);
    // and only once a year
    const n = pigsOf(s, c).length;
    for (let d = 0; d < 6; d++) {
      s.tick += TICKS_PER_DAY;
      for (const g of pigsOf(s, c)) g.fed = s.tick;
      pigsDaily(s);
    }
    expect(pigsOf(s, c).length).toBe(n);
  });

  it('are killed for the stores in autumn, all but the sows and a boar kept to breed', () => {
    const { s, c, pen } = keepers();
    at(s, 2.7);
    const sows = [3, 2.5, 2, 1.5].map((y) => aged(s, addPig(s, c, pen, true, false), y));
    const boar = aged(s, addPig(s, c, pen, false, false), 2);
    const young = [0.5, 0.5].map((y) => aged(s, addPig(s, c, pen, false, false), y));
    for (const g of pigsOf(s, c)) g.fed = s.tick;
    const killed: number[] = [];
    let meat = 0;
    for (let g = pigToKill(s, c); g; g = pigToKill(s, c)) {
      killed.push(g.id);
      meat += killPig(s, c, g);
    }
    const left = pigsOf(s, c);
    expect(left.filter((g) => g.sow)).toHaveLength(PIG_SOWS_KEPT);
    expect(left.filter((g) => g.sow).map((g) => g.id)).toEqual(sows.slice(0, PIG_SOWS_KEPT).map((g) => g.id));
    expect(left.some((g) => g.id === boar.id)).toBe(true);
    expect(killed).toEqual(expect.arrayContaining([sows[3].id, ...young.map((g) => g.id)]));
    expect(meat).toBe(PIG_MEAT + 2 * PIG_MEAT_YOUNG);
    expect(c.ledger!.now['pigs.meat']).toBe(meat);
    // out of season, a well-fed band keeps the rest
    at(s, 0.5);
    addPig(s, c, pen, false, false);
    for (const g of pigsOf(s, c)) g.fed = s.tick;
    expect(pigToKill(s, c)).toBeUndefined();
  });

  it('are killed down to a sow and a boar when the band can\'t feed them', () => {
    const { s, c, pen } = keepers();
    at(s, 0.5);
    for (const y of [3, 2]) aged(s, addPig(s, c, pen, true, false), y);
    aged(s, addPig(s, c, pen, false, false), 2);
    for (const g of pigsOf(s, c)) g.fed = s.tick;
    expect(pigToKill(s, c)).toBeUndefined();
    // a band rationing its own food gives them half, and keeps them all
    c.rationing = true;
    feedPigs(s, c);
    expect(pigToKill(s, c)).toBeUndefined();
    // but pigs going thin for want of feed are killed down to a sow and a boar
    for (const g of pigsOf(s, c)) g.fed = s.tick - 4 * TICKS_PER_DAY;
    const g = pigToKill(s, c)!;
    expect(g.sow).toBe(true);
    killPig(s, c, g);
    expect(pigToKill(s, c)).toBeUndefined();
  });

  it('are tended by the band each day, in a pen it builds itself', () => {
    const { s, c, pen } = keepers(8);
    aged(s, addPig(s, c, pen, true, false), 2);
    aged(s, addPig(s, c, pen, false, false), 2);
    const start = s.tick;
    let tended = false;
    while (s.tick < start + TICKS_PER_DAY * 4) {
      s.step();
      if (s.members().some((p) => p.task?.kind === 'pigs')) tended = true;
    }
    expect(tended).toBe(true);
    expect(c.ledger!.now['pigs.fed'] ?? c.ledger!.last['pigs.fed']).toBeGreaterThan(0);
    expect(pigsOf(s, c).every((g) => s.tick - g.fed < TICKS_PER_DAY * 2)).toBe(true);
    // a band that knows pigs and has no pen plans one
    const t = keepers(8);
    t.s.buildings.splice(t.s.buildings.indexOf(t.pen), 1);
    t.c.stock.wood += 40;
    t.c.stock.fiber += 40;
    t.c.stock.cordage += 20;
    runTo(t.s, t.s.tick + TICKS_PER_DAY * 3);
    expect(t.s.buildings.some((b) => b.band === t.c.id && b.kind === 'pen')).toBe(true);
  });

  it('are shown to the renderer, carded, and kept in a save', () => {
    const { s, c, pen } = keepers();
    const g = aged(s, addPig(s, c, pen, true, false), 2);
    addPig(s, c, pen, false, true);
    const packed = packPigs(s);
    expect(packed.length).toBe(14);
    expect(packed[0]).toBe(3);
    expect(packed[1]).toBe(PIG_ID + g.id);
    expect(s.pigsLine(c)).toBe('2 pigs: one sow and one piglet');
    const save = JSON.parse(JSON.stringify(s.serialize()));
    const r = new Sim(s.world, save);
    expect(r.pigs).toEqual(s.pigs);
    for (let k = 0; k < TICKS_PER_DAY; k++) {
      s.step();
      r.step();
    }
    expect(r.pigs).toEqual(s.pigs);
  });

  it('are killed and carried along when the band moves camp', () => {
    const { s, c, pen } = keepers();
    for (const y of [2, 2, 0.6]) aged(s, addPig(s, c, pen, y > 1, false), y);
    for (const b of s.buildings) if (b.band === c.id && b.kind === 'plot') b.built = false;
    c.hungryWinters = 2;
    const meat = c.stock.meat + 2 * PIG_MEAT + PIG_MEAT_YOUNG;
    const move = (s as unknown as { considerMove(c: unknown): boolean }).considerMove.bind(s);
    let moved = false;
    for (let k = 0; k < 400 && !moved; k++) moved = move(c);
    expect(moved).toBe(true);
    expect(s.pigs.filter((g) => g.band === c.id)).toHaveLength(0);
    const nc = s.camps.find((q) => q.parent === c.id && q.origin === 'moved')!;
    // (with whatever meat was in hand when they packed up)
    expect(nc.stock.meat).toBeGreaterThanOrEqual(meat * 0.8 - 1e-6);
  });
});
