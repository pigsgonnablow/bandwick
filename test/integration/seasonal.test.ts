// The wild foods of the seasons: eggs from the nests in spring, honey smoked out of a wild hive in
// summer, and mushrooms in the autumn woods (a bad one makes you sick).
import { describe, it, expect } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR, seasonOf } from '../../src/sim/time';
import { SK, CARRY, COOK_GAIN, HONEY_STING, HONEY_TREAT, BAD_MUSHROOM_DAYS, EGGS_LOAD, Person, Task, TaskKind } from '../../src/sim/band';
import { decide, runTask } from '../../src/sim/ai';
import { Sim, isTreeType, treeStage } from '../../src/sim/sim';
import { sim, runTo } from '../helpers';

const SEASONAL = ['eggs', 'honey', 'mushrooms'] as const;
type Seasonal = (typeof SEASONAL)[number];
const SEASON: Record<Seasonal, number> = { eggs: 0, honey: 1, mushrooms: 2 };

const total = (s: Sim, k: string) => s.camps.reduce((n, c) => n + (c.ledger?.total?.[k] ?? 0), 0);
const kindOf = (p: Person) => (p.task as Task | null)?.kind;
const adult = (s: Sim, skip: Person[] = []) => {
  const p = s.living().find((q) => s.age(q) >= 18 && s.age(q) <= 50 && !skip.includes(q))!;
  s.camp = s.campOf(p);
  return p;
};
const knowAll = (s: Sim) => { for (const k of ['cooking', ...SEASONAL]) if (!s.camp.knows.includes(k)) s.camp.knows.push(k); };
/** Into a season of the first year, a couple of days in, at mid-morning. */
const toSeason = (s: Sim, season: number) => {
  while (seasonOf(s.tick) !== season || Math.floor((s.tick % TICKS_PER_SEASON) / TICKS_PER_DAY) < 2) s.step();
  while ((s.tick % TICKS_PER_DAY) / 10 < 10) s.step();
};
/** A tree near camp of the kind the task looks for, and someone standing at it, just about done. */
function atTree(s: Sim, p: Person, kind: Seasonal) {
  const hive = (k: number) => kind !== 'honey' || (treeStage(s.propType[k]) >= 3 && s.propTile[k] % 9 === 0);
  const k = s.nearestProp(s.camp.x, s.camp.z, 40, (k) => isTreeType(s.propType[k]) && treeStage(s.propType[k]) >= 2 && hive(k));
  expect(k).toBeGreaterThanOrEqual(0);
  for (const m of [s.eggsTaken, s.hivesTaken, s.mushroomsTaken]) m.delete(k);
  p.x = s.propX[k] + 0.35;
  p.z = s.propZ[k] + 0.25;
  p.carry = CARRY.None;
  p.carryAmt = 0;
  p.task = { kind, stage: 1, goal: s.tileOf(p), gx: p.x, gz: p.z, ref: k, timer: 1, started: s.tick, amount: 0, near: false } as Task;
  return k;
}

describe('the wild foods of the seasons', () => {
  for (const kind of SEASONAL) {
    it(`(${kind}) are found only in their season, by a band that knows them`, () => {
      const s = sim(2);
      knowAll(s);
      const seasons = new Set<number>();
      const end = s.tick + TICKS_PER_YEAR;
      while (s.tick < end) {
        s.step();
        if (s.tick % 20 === 0) for (const p of s.living()) if (p.task?.kind === kind && p.task.stage >= 1) seasons.add(seasonOf(p.task.started));
      }
      expect(total(s, `gathered.${kind}`)).toBeGreaterThan(0);
      expect([...seasons]).toEqual([SEASON[kind]]);
    });

    it(`(${kind}) are not thought of by a band that does not know them`, () => {
      const s = sim(2);
      toSeason(s, SEASON[kind]);
      s.camp.knows = s.camp.knows.filter((k) => k !== kind);
      for (const p of s.members(s.camp).filter((q) => s.age(q) >= 7)) for (let i = 0; i < 5; i++) { p.task = null; decide(s, p); expect(kindOf(p)).not.toBe(kind); }
    });

    it(`(${kind}) take a tree once, until it has them again`, () => {
      const s = sim(2);
      knowAll(s);
      toSeason(s, SEASON[kind]);
      const p = adult(s);
      p.skills[SK.forage] = 20;
      const k = atTree(s, p, kind);
      runTask(s, p);
      const taken = kind === 'eggs' ? s.eggsTaken : kind === 'honey' ? s.hivesTaken : s.mushroomsTaken;
      expect(taken.get(k)).toBeGreaterThan(s.tick);
      // a tree picked over is not set out for again while it is bare
      for (let i = 0; i < 20; i++) {
        const q = adult(s, [p]);
        q.task = null;
        decide(s, q);
        if (kindOf(q) === kind) expect(q.task!.ref).not.toBe(k);
      }
    });
  }

  it('saving keeps the stores and the picked-over trees', () => {
    const s = sim(2);
    knowAll(s);
    toSeason(s, 0);
    const p = adult(s);
    const k = atTree(s, p, 'eggs');
    runTask(s, p);
    Object.assign(s.camp.stock, { eggs: 2, honey: 3, mushrooms: 4 });
    s.hivesTaken.set(k, s.tick + 100);
    s.mushroomsTaken.set(k, s.tick + 50);
    const r = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())));
    expect(r.camp.stock.eggs).toBe(2);
    expect(r.camp.stock.honey).toBe(3);
    expect(r.camp.stock.mushrooms).toBe(4);
    expect(r.eggsTaken.size).toBe(s.eggsTaken.size);
    expect([...r.hivesTaken.values()]).toContain(s.tick + 100);
    expect([...r.mushroomsTaken.values()]).toContain(s.tick + 50);
  });
});

describe('eggs', () => {
  it('are a few at a time, children climb for them, and they go off fast', () => {
    const s = sim(2);
    knowAll(s);
    const ages: number[] = [];
    const end = s.tick + TICKS_PER_SEASON;
    let most = 0;
    while (s.tick < end) {
      s.step();
      for (const p of s.living()) if (p.task?.kind === 'eggs') {
        if (p.task.started === s.tick - 1) ages.push(s.age(p));
        if (p.carry === CARRY.Eggs) most = Math.max(most, p.carryAmt);
      }
    }
    expect(ages.length).toBeGreaterThan(0);
    // (children who can climb, where the band has any, go for them too)
    if (s.living().some((p) => s.age(p) >= 8 && s.age(p) < 13)) expect(ages.some((a) => a < 14)).toBe(true);
    expect(Math.min(...ages)).toBeGreaterThanOrEqual(7);
    expect(most).toBeLessThanOrEqual(EGGS_LOAD);
    const st = s.camp.stock;
    Object.assign(st, { eggs: 100, nuts: 100, roots: 100 });
    (s as unknown as { spoilNow(x: typeof st): void }).spoilNow(st);
    expect(100 - st.eggs).toBeGreaterThan((100 - st.roots) * 3);
  });

  it('roasted, fill more', () => {
    const s = sim(2);
    const p = adult(s);
    const c = s.camp;
    const meal = (cooking: boolean) => {
      c.knows = c.knows.filter((k) => k !== 'cooking');
      if (cooking) c.knows.push('cooking');
      s.hearth().fuel = 40;
      for (const k of ['berries', 'fish', 'meat', 'roots', 'nuts', 'preserved', 'mushrooms', 'honey'] as const) c.stock[k] = 0;
      c.stock.eggs = 50;
      p.food = 20;
      p.x = c.x + 1; p.z = c.z;
      p.task = { kind: 'eat', stage: 0, goal: s.tileOf(p), gx: p.x, gz: p.z, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
      for (let i = 0; i < 60 && p.task; i++) { runTask(s, p); s.tick++; }
      return 50 - c.stock.eggs;
    };
    const raw = meal(false);
    expect(meal(true)).toBeCloseTo(raw / COOK_GAIN, 5);
  });
});

describe('honey', () => {
  it('is fetched by one person at a time, only from the old trees with a hive, and only when the band is short of it', () => {
    const s = sim(2);
    knowAll(s);
    toSeason(s, 1);
    let most = 0;
    const end = s.tick + TICKS_PER_SEASON;
    while (s.tick < end) {
      s.step();
      const at = s.living().filter((p) => p.task?.kind === 'honey');
      most = Math.max(most, at.length);
      for (const p of at) {
        expect(treeStage(s.propType[p.task!.ref])).toBeGreaterThanOrEqual(3);
        expect(s.propTile[p.task!.ref] % 9).toBe(0);
      }
    }
    expect(total(s, 'gathered.honey')).toBeGreaterThan(0);
    expect(most).toBe(1);
    // with a good store of it, nobody goes for more
    s.camp.stock.honey = 10;
    runTo(s, s.tick - (s.tick % TICKS_PER_YEAR) + TICKS_PER_YEAR + TICKS_PER_SEASON + 3 * TICKS_PER_DAY);
    for (const p of s.members(s.camp).filter((q) => s.age(q) >= 14)) { p.task = null; decide(s, p); expect(kindOf(p)).not.toBe('honey'); }
  });

  it('stings the unskilled more often, and a stinging hurts and spoils the haul', () => {
    const s = sim(2);
    knowAll(s);
    toSeason(s, 1);
    const p = adult(s);
    const trial = (skill: number) => {
      let stung = 0;
      for (let i = 0; i < 80; i++) {
        p.skills[SK.forage] = skill;
        p.health = 80;
        atTree(s, p, 'honey');
        runTask(s, p);
        if (p.health < 80) {
          stung++;
          expect(p.health).toBeCloseTo(80 - HONEY_STING, 5);
          expect(p.carryAmt).toBe(1);
        } else expect(p.carryAmt).toBeGreaterThan(1.5);
        expect(p.carry).toBe(CARRY.Honey);
      }
      return stung;
    };
    const novice = trial(0), expert = trial(20);
    expect(novice).toBeGreaterThan(expert);
    expect(novice).toBeGreaterThan(10);
    expect(p.memories.some((m) => m.kind === 'stung')).toBe(true);
  });

  it('is a treat with a meal: a spoonful, a little happier, not every day, and not while rationing', () => {
    const s = sim(2);
    const p = adult(s);
    const c = s.camp;
    const eat = () => {
      for (const k of ['berries', 'fish', 'roots', 'nuts', 'preserved', 'eggs', 'mushrooms'] as const) c.stock[k] = 0;
      c.stock.meat = 20;
      p.food = 30;
      p.belonging = 40;
      p.x = c.x + 1; p.z = c.z;
      p.task = { kind: 'eat', stage: 0, goal: s.tileOf(p), gx: p.x, gz: p.z, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
      for (let i = 0; i < 60 && p.task; i++) { runTask(s, p); s.tick++; }
    };
    c.stock.honey = 5;
    p.memories = p.memories.filter((m) => m.kind !== 'honey');
    eat();
    expect(c.stock.honey).toBeCloseTo(5 - HONEY_TREAT, 6);
    expect(p.memories.some((m) => m.kind === 'honey')).toBe(true);
    expect(p.belonging).toBeGreaterThan(40);
    // the next day: none yet
    s.tick += TICKS_PER_DAY;
    eat();
    expect(c.stock.honey).toBeCloseTo(5 - HONEY_TREAT, 6);
    // days later, but the band is rationing
    s.tick += 5 * TICKS_PER_DAY;
    c.rationing = true;
    eat();
    expect(c.stock.honey).toBeCloseTo(5 - HONEY_TREAT, 6);
    c.rationing = false;
    eat();
    expect(c.stock.honey).toBeCloseTo(5 - 2 * HONEY_TREAT, 6);
  });

  it('keeps almost for ever', () => {
    const s = sim(2);
    const st = s.camp.stock;
    st.honey = 100;
    (s as unknown as { spoilNow(x: typeof st): void }).spoilNow(st);
    expect(100 - st.honey).toBeLessThan(0.1);
  });
});

describe('mushrooms', () => {
  it('make a beginner sick now and then: the basket is thrown out and a fever comes on', () => {
    const s = sim(2);
    knowAll(s);
    toSeason(s, 2);
    const p = adult(s);
    const trial = (skill: number) => {
      let bad = 0;
      for (let i = 0; i < 80; i++) {
        p.skills[SK.forage] = skill;
        p.sick = 0;
        atTree(s, p, 'mushrooms');
        p.carry = CARRY.Mushrooms;
        p.carryAmt = 2;
        runTask(s, p);
        if (p.sick > 0) {
          bad++;
          expect(p.sick).toBe(BAD_MUSHROOM_DAYS);
          expect(p.carry).toBe(CARRY.None);
          expect(p.task).toBeNull();
        } else expect(p.carry).toBe(CARRY.Mushrooms);
      }
      return bad;
    };
    const spoiled = total(s, 'spoiled.mushrooms'), before = total(s, 'mushrooms.bad');
    const novice = trial(0), expert = trial(20);
    expect(novice).toBeGreaterThan(5);
    expect(expert).toBeLessThan(novice / 3);
    expect(total(s, 'mushrooms.bad') - before).toBe(novice + expert);
    expect(total(s, 'spoiled.mushrooms') - spoiled).toBeCloseTo(2 * (novice + expert), 5);
    expect(p.memories.some((m) => m.kind === 'bad_mushroom')).toBe(true);
  });

  it('a sickness from them is a fever the band\'s healer will nurse', () => {
    const s = sim(2);
    knowAll(s);
    s.camp.knows.push('herbs');
    s.camp.stock.herbs = 3;
    const sick = adult(s);
    const nurse = adult(s, [sick]);
    sick.sick = BAD_MUSHROOM_DAYS;
    sick.task = null;
    sick.x = s.camp.x + 2; sick.z = s.camp.z;
    nurse.x = sick.x + 0.5; nurse.z = sick.z;
    let chose = false;
    for (let i = 0; i < 40 && !chose; i++) { nurse.task = null; decide(s, nurse); chose = kindOf(nurse) === 'nurse'; }
    expect(chose).toBe(true);
  });
});

describe('the stockpile and the plan', () => {
  it('tell of the seasonal foods', () => {
    const s = sim(2);
    knowAll(s);
    toSeason(s, 0);
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.camp.plan).toContain('Look for eggs in the nests');
    Object.assign(s.camp.stock, { eggs: 3, honey: 2, mushrooms: 4 });
    const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
    const card = s.inspectThing({ kind: 'building', id: pile.id })!;
    const labels = card.lines.map((l) => l.label);
    if (!s.buildings.some((b) => b.band === s.camp.id && b.kind === 'storehouse' && b.built)) {
      expect(labels).toContain('Eggs');
      expect(labels).toContain('Honey');
      expect(labels).toContain('Mushrooms');
    }
  });

  for (const [season, line] of [[1, 'Smoke out a wild hive for honey'], [2, 'Pick mushrooms in the woods']] as const) {
    it(`plan for ${line.toLowerCase()} in its season`, () => {
      const s = sim(2);
      knowAll(s);
      toSeason(s, season);
      runTo(s, s.tick + TICKS_PER_DAY);
      expect(s.camp.plan).toContain(line);
    });
  }
});

// (task kinds are numbered for the renderer; the new ones are there)
describe('task kinds', () => {
  it('include the seasonal foods', async () => {
    const { TASK_KINDS } = await import('../../src/sim/band');
    for (const k of SEASONAL) expect(TASK_KINDS).toContain(k as TaskKind);
  });
});
