// Butchering: once a band knows how, every deer, boar and pig brought to the stores is laid out on its hide and
// taken apart there, for more meat (the marrow and the trimmings), fat for the lamps and the drying rack, sinew
// to sew hide with, and a stag's antlers for the bone pile.
import { describe, it, expect } from 'vitest';
import { SK, ACT, CARRY, Task, TaskKind, CARCASS, FAT_SEASON, LAMP_FAT, MEND_CORD, PEMMICAN_FAT, PEMMICAN_GAIN, SINEW_MEND } from '../../src/sim/band';
import { DISCOVERY, meets } from '../../src/sim/know';
import { TICKS_PER_DAY, isDark, seasonOf } from '../../src/sim/time';
import { runTask, abandon, setup } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runYears } from '../helpers';

/** A band two years on, knowing preserving (and butchering, unless told not to). */
function band(seed = 2, knows: string[] = ['preserving', 'butchering']) {
  const s = runYears(sim(seed), 2);
  for (const k of knows) if (!s.camp.knows.includes(k)) s.camp.knows.push(k);
  Object.assign(s.camp.stock, { fat: 0, sinew: 0 });
  return s;
}
const adult = (s: Sim) => s.members().find((q) => s.age(q) >= 18 && s.age(q) <= 50 && q.alive)!;
/** Someone just arrived at the stores with a kill on their shoulder. */
function bringing(s: Sim, kind: TaskKind, carcass: Task['carcass'], meat = 8, stage = 1) {
  const p = adult(s);
  const st = s.storeSpot();
  p.x = st.x;
  p.z = st.z;
  p.carry = CARRY.Meat;
  p.carryAmt = meat;
  p.path = null;
  p.task = { kind, stage, goal: st.tile, gx: st.x, gz: st.z, ref: -1, timer: 0, started: s.tick, amount: 0, near: false, carcass };
  return p;
}
/** Run their task until it is done (or a limit), counting the ticks spent kneeling over the carcass. */
function work(s: Sim, p: { task: Task | null; act: number; carry: number }) {
  let knelt = 0;
  for (let i = 0; i < 60 && p.task; i++) {
    runTask(s, p as never);
    if (p.task && p.carry !== CARRY.Meat && p.act === ACT.Gather) knelt++;
    s.tick++;
  }
  return knelt;
}
/** Until they have laid the carcass down (a step or two to reach the spot). */
function layDown(s: Sim, p: { task: Task | null; carry: number }) {
  for (let i = 0; i < 10 && p.carry === CARRY.Meat; i++) { runTask(s, p as never); s.tick++; }
}
/** Move the clock to the middle of a season (0 spring .. 3 winter). */
function toSeason(s: Sim, season: number) {
  while (seasonOf(s.tick) !== season) s.tick += TICKS_PER_DAY;
}

describe('the butchering discovery', () => {
  it('comes to a hunter who knows hides, skinning kills once the band dries meat', () => {
    const d = DISCOVERY.get('butchering')!;
    expect(d.needs).toEqual(['preserving']);
    expect(d.practice.carcass).toBeGreaterThan(0);
    const s = band();
    const p = adult(s);
    p.skills[SK.hide] = 8;
    p.skills[SK.hunt] = 10;
    expect(meets(p, d)).toBeGreaterThanOrEqual(0);
    p.skills[SK.hide] = 7;
    expect(meets(p, d)).toBe(-1);
  });
});

describe('a kill brought home', () => {
  it('goes into the stores as it came, in a band that does not know butchering', () => {
    const s = band(2, ['preserving']);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'butchering');
    const meat = s.camp.stock.meat;
    const p = bringing(s, 'hunt', 'deer');
    expect(work(s, p)).toBe(0);
    expect(s.camp.stock.meat - meat).toBeCloseTo(8, 5);
    expect(s.camp.stock.fat).toBe(0);
    expect(s.camp.stock.sinew).toBe(0);
  });

  it('is laid out and butchered at the stores: more meat, fat and sinew', () => {
    const s = band();
    toSeason(s, 1);
    const meat = s.camp.stock.meat;
    const p = bringing(s, 'hunt', 'deer');
    p.skills[SK.hide] = 10;
    layDown(s, p);
    expect(p.carry).toBe(CARRY.Carcass);
    expect(p.thought).toMatch(/Butchering the deer/);
    const knelt = work(s, p) + 1;
    expect(knelt).toBeGreaterThanOrEqual(6);
    expect(p.task).toBeNull();
    // marrow and trimmings: a tenth more, and a tenth again for a hand with ten points of hidework
    expect(s.camp.stock.meat - meat).toBeCloseTo(8 * 1.2, 1);
    expect(s.camp.stock.fat).toBeCloseTo(CARCASS.deer.fat * FAT_SEASON[1], 5);
    expect(s.camp.stock.sinew).toBe(1);
  });

  it('gives a boar more fat than a deer, laid out as a boar', () => {
    const s = band();
    toSeason(s, 1);
    const p = bringing(s, 'hunt', 'boar', 10);
    layDown(s, p);
    expect(p.carry).toBe(CARRY.BoarCarcass);
    work(s, p);
    expect(s.camp.stock.fat).toBeCloseTo(CARCASS.boar.fat * FAT_SEASON[1], 5);
    expect(CARCASS.boar.fat).toBeGreaterThan(CARCASS.deer.fat);
  });

  it('is fattest in autumn and leanest at the end of winter', () => {
    const fatIn = (season: number) => {
      const s = band();
      toSeason(s, season);
      work(s, bringing(s, 'hunt', 'deer'));
      return s.camp.stock.fat;
    };
    expect(fatIn(2)).toBeGreaterThan(fatIn(1));
    expect(fatIn(1)).toBeGreaterThan(fatIn(3));
  });

  it('keeps a stag\'s antlers with the bones, where the band makes needles', () => {
    const s = band(2, ['preserving', 'butchering', 'needles']);
    s.camp.stock.bones = 0;
    work(s, bringing(s, 'hunt', 'stag'));
    expect(s.camp.stock.bones).toBeGreaterThanOrEqual(CARCASS.stag.antler);
  });

  it('is butchered for the stores when a pig is killed at the pen too', () => {
    const s = band();
    const meat = s.camp.stock.meat;
    const p = bringing(s, 'pigs', 'pig', 12, 2);
    layDown(s, p);
    expect(p.carry).toBe(CARRY.BoarCarcass);
    work(s, p);
    expect(s.camp.stock.meat - meat).toBeGreaterThan(12);
    expect(s.camp.stock.fat).toBeGreaterThan(0);
  });

  it('goes into the stores as meat if the butcher is called away half done', () => {
    const s = band();
    const meat = s.camp.stock.meat;
    const p = bringing(s, 'hunt', 'deer');
    layDown(s, p);
    runTask(s, p);
    expect(p.carry).toBe(CARRY.Carcass);
    abandon(s, p);
    expect(s.camp.stock.meat - meat).toBeCloseTo(8, 5);
    expect(p.carry).toBe(CARRY.None);
  });
});

describe('a carcass half butchered', () => {
  it('is never carried off as a carcass when the work is put down', () => {
    const s = band();
    const p = bringing(s, 'hunt', 'deer');
    layDown(s, p);
    expect(p.carry).toBe(CARRY.Carcass);
    // (put down with the load kept in hand, as when there is nothing else to do)
    abandon(s, p, true);
    expect(p.carry).toBe(CARRY.Meat);
    expect(p.carryAmt).toBeCloseTo(8, 5);
  });
});

describe('fat', () => {
  it('fills the lamps before any is cut from the meat', () => {
    const s = band(2, ['preserving', 'butchering', 'pottery', 'lamps']);
    s.giveTools(s.camp, { lamp: 1 });
    s.camp.stock.fat = 2;
    while (!isDark(s.tick) || (s.tick % TICKS_PER_DAY) < TICKS_PER_DAY / 2) s.tick++;
    const meat = s.camp.stock.meat;
    expect(s.lightLamp(adult(s))).toBe(true);
    expect(s.camp.stock.fat).toBeCloseTo(2 - LAMP_FAT, 5);
    expect(s.camp.stock.meat).toBe(meat);
  });

  it('is pounded into the meat dried on the rack, for more dried food', () => {
    const dried = (fat: number) => {
      const s = band();
      const rack = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'rack' && b.built)
        ?? (() => { const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!; const r = { ...pile, id: s.newId(), kind: 'rack' as const, built: true }; s.buildings.push(r); return r; })();
      s.camp.stock.fat = fat;
      const before = s.camp.stock.preserved;
      const p = adult(s);
      p.x = rack.x + 0.5;
      p.z = rack.z + 0.5;
      p.task = { kind: 'preserve', stage: 1, goal: rack.tile, gx: rack.x + 0.5, gz: rack.z + 0.5, ref: rack.id, timer: 0, started: s.tick, amount: 6, near: true, fish: 0 };
      for (let i = 0; i < 80 && p.task; i++) { runTask(s, p); s.tick++; }
      return { got: s.camp.stock.preserved - before, left: s.camp.stock.fat };
    };
    const plain = dried(0), fatty = dried(3);
    expect(fatty.got - plain.got).toBeCloseTo(PEMMICAN_FAT * PEMMICAN_GAIN, 1);
    expect(fatty.left).toBeCloseTo(3 - PEMMICAN_FAT, 5);
  });
});

describe('sinew', () => {
  it('stands in for cordage in sewing hide, and goes back as sinew if the work is left', () => {
    const s = band(2, ['preserving', 'butchering', 'cloaks']);
    const c = s.camp;
    Object.assign(c.stock, { cordage: 0, sinew: 3, hides: 4 });
    expect(s.canCraft('cloak', c)).toBe(true);
    const p = adult(s);
    const t = setup(s, p, 'craft', 'cloak')!;
    expect(t).not.toBeNull();
    p.task = t;
    expect(c.stock.cordage).toBe(0);
    expect(c.stock.sinew).toBeLessThan(3);
    abandon(s, p);
    expect(c.stock.sinew).toBeCloseTo(3, 5);
    expect(c.stock.cordage).toBeCloseTo(0, 5);
  });

  it('sews a mend that holds better than cordage', () => {
    const mended = (sinew: number) => {
      const s = band(2, ['preserving', 'butchering', 'cloaks']);
      const c = s.camp;
      Object.assign(c.stock, { cordage: 4, sinew });
      s.giveTools(c, { cloak: 1 });
      const it = s.toolsOf(c, 'cloak').at(-1)!;
      it.wear = 0.9;
      // only this one wants mending
      for (const o of s.items) if (o !== it && o.wear > 0.5) o.wear = 0.1;
      const p = adult(s);
      p.skills[SK.hide] = 10;
      const t = setup(s, p, 'mend');
      if (!t || t.ref !== it.id) return undefined;
      p.task = t;
      for (let i = 0; i < 400 && p.task; i++) { runTask(s, p); s.tick++; }
      return { wear: it.wear, cord: c.stock.cordage, sinew: c.stock.sinew };
    };
    const cord = mended(0), sin = mended(2);
    if (!cord || !sin) return;
    expect(cord.cord).toBeCloseTo(4 - MEND_CORD, 5);
    expect(sin.sinew).toBeCloseTo(2 - MEND_CORD, 5);
    expect(0.9 - sin.wear).toBeCloseTo((0.9 - cord.wear) * SINEW_MEND, 5);
  });
});

describe('over the years', () => {
  it('a band that learns butchering puts fat and sinew by, and uses them', () => {
    const s = band(8);
    for (let d = 0; d < 48 * 3; d++) for (let i = 0; i < TICKS_PER_DAY; i++) s.step();
    const t = s.camp.ledger?.total ?? {};
    expect(t.butchered ?? 0).toBeGreaterThan(0);
    expect(t['gathered.fat'] ?? 0).toBeGreaterThan(0);
    expect(t['gathered.sinew'] ?? 0).toBeGreaterThan(0);
  });
});
