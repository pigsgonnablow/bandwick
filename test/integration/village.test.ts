// Village life: acorns in autumn, cooking at the hearth, healing herbs, bone needles, gifts of ornaments
// and the midwinter feast.
import { describe, it, expect } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_SEASON, TICKS_PER_YEAR, seasonOf, dayOf, hourOf, DAYS_PER_YEAR } from '../../src/sim/time';
import { ACT, CARRY, RECIPE_KEYS, COOK_GAIN, GIFT_DAYS, MIDWINTER, NEEDLE_SPEED, BONES_PER_DEER, TEETH_PER_DEER, Person, Task, TaskKind, foodTotal } from '../../src/sim/band';
import { DISCOVERY } from '../../src/sim/know';
import { decide, deposit, runTask } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo } from '../helpers';

const task = (s: Sim, kind: TaskKind, at: { x: number; z: number }, ref = -1, stage = 0): Task =>
  ({ kind, stage, goal: s.tileOf(at), gx: at.x, gz: at.z, ref, timer: 0, started: s.tick, amount: 0, near: false });
/** Run someone's current task to its end (or for at most `n` ticks), advancing the clock as it goes. */
function finishTask(s: Sim, p: Person, n = 400) {
  const t = p.task;
  for (let i = 0; i < n && p.task === t; i++) {
    runTask(s, p);
    s.tick++;
  }
}
const adult = (s: Sim, skip: Person[] = []) => {
  const p = s.living().find((q) => s.age(q) >= 18 && s.age(q) <= 50 && !skip.includes(q))!;
  s.camp = s.campOf(p);
  return p;
};
const kindOf = (p: Person) => (p.task as Task | null)?.kind;
const total = (s: Sim, k: string) => s.camps.reduce((n, c) => n + (c.ledger?.total?.[k] ?? 0), 0);

describe('acorns', () => {
  it('are gathered under the oaks in autumn only, and keep well', () => {
    const s = sim(1);
    s.camp.knows.push('nuts');
    const seasons = new Set<number>();
    const end = s.tick + TICKS_PER_YEAR;
    while (s.tick < end) {
      s.step();
      if (s.tick % 20 === 0) for (const p of s.living()) if (p.task?.kind === 'nuts' && p.task.stage >= 1) seasons.add(seasonOf(p.task.started));
    }
    expect(total(s, 'gathered.nuts')).toBeGreaterThan(10);
    expect([...seasons]).toEqual([2]);
    // an oak picked over is left alone for the rest of the season
    for (const until of s.nutsTaken.values()) expect(until).toBeLessThanOrEqual(s.tick + 40 * TICKS_PER_DAY);
    const st = s.camp.stock;
    st.nuts = 100;
    st.berries = 100;
    (s as unknown as { spoilNow(x: typeof st): void }).spoilNow(st);
    expect(100 - st.nuts).toBeLessThan((100 - st.berries) / 5);
    expect(foodTotal({ ...st, berries: 0, fish: 0, meat: 0, roots: 0, preserved: 0, eggs: 0, honey: 0, mushrooms: 0 })).toBeCloseTo(st.nuts, 5);
  });

  it('are not something a band thinks of gathering before it knows them', () => {
    const s = sim(1);
    runTo(s, s.tick + 2 * TICKS_PER_SEASON + 2 * TICKS_PER_DAY);
    expect(seasonOf(s.tick)).toBe(2);
    // (with the winter's wood laid in, so that the woodpile isn't what everyone turns to)
    s.camp.stock.wood = 300;
    // (and the food stores low, so that food is what the band is after)
    for (const k of ['berries', 'meat', 'fish', 'preserved', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms'] as const) s.camp.stock[k] = Math.min(s.camp.stock[k], 5);
    s.camp.knows = s.camp.knows.filter((k) => k !== 'nuts');
    s.plan();
    for (const p of s.members(s.camp).filter((q) => s.age(q) >= 12)) for (let i = 0; i < 10; i++) { p.task = null; decide(s, p); expect(kindOf(p)).not.toBe('nuts'); }
    s.camp.knows.push('nuts');
    let chose = 0;
    for (const p of s.members(s.camp).filter((q) => s.age(q) >= 12)) for (let i = 0; i < 10; i++) { p.task = null; decide(s, p); if (kindOf(p) === 'nuts') chose++; }
    expect(chose).toBeGreaterThan(0);
  });
});

describe('cooking', () => {
  const meal = (s: Sim, p: Person, lit: boolean, cooking: boolean) => {
    const c = s.camp;
    if (cooking && !c.knows.includes('cooking')) c.knows.push('cooking');
    if (!cooking) c.knows = c.knows.filter((k) => k !== 'cooking');
    const hearth = s.buildings.find((b) => b.band === c.id && b.kind === 'hearth')!;
    hearth.fuel = lit ? 40 : 0;
    expect(s.hearthLit()).toBe(lit);
    const st = c.stock;
    st.berries = 0; st.fish = 0; st.roots = 0; st.nuts = 0; st.preserved = 0;
    st.meat = 50;
    p.food = 20;
    p.x = c.x + 1; p.z = c.z;
    p.task = task(s, 'eat', p);
    finishTask(s, p);
    return 50 - st.meat;
  };

  it('roasts meat at a lit fire, so less of it makes the same meal', () => {
    const s = sim(1);
    const p = adult(s);
    const raw = meal(s, p, true, false);
    const cooked = meal(s, p, true, true);
    expect(raw).toBeGreaterThan(0);
    expect(cooked).toBeCloseTo(raw / COOK_GAIN, 5);
    // with the fire out, there is nothing to cook on
    expect(meal(s, p, false, true)).toBeCloseTo(raw, 5);
  });

  it('takes a little longer, tending the embers first', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.knows.push('cooking');
    s.buildings.find((b) => b.band === s.camp.id && b.kind === 'hearth')!.fuel = 40;
    s.camp.stock.meat = 50;
    p.x = s.camp.x + 1; p.z = s.camp.z;
    p.task = task(s, 'eat', p);
    let tended = 0;
    const t = p.task;
    for (let i = 0; i < 100 && p.task === t; i++) { runTask(s, p); s.tick++; if (p.act === ACT.Tend) tended++; }
    expect(tended).toBeGreaterThan(0);
  });

  it('comes to someone sitting at the evening fire', () => {
    const d = DISCOVERY.get('cooking')!;
    expect(Object.keys(d.practice)).toContain('evening_fire');
    expect(d.needs).toEqual([]);
  });
});

describe('healing herbs', () => {
  it('are gathered from the undergrowth, and kept a few at a time', () => {
    const s = sim(1);
    s.camp.knows.push('herbs');
    runTo(s, s.tick + 20 * TICKS_PER_DAY);
    expect(total(s, 'gathered.herbs')).toBeGreaterThan(0);
    expect(s.camp.stock.herbs).toBeLessThan(12);
  });

  it('are taken to the sick, whose fever does less harm and breaks sooner', () => {
    const s = sim(1);
    s.camp.knows.push('herbs');
    const nurse = adult(s);
    const sick = adult(s, [nurse]);
    s.camp.stock.herbs = 3;
    sick.sick = 6;
    sick.task = null;
    sick.x = s.camp.x + 2; sick.z = s.camp.z + 1;
    nurse.x = sick.x + 0.5; nurse.z = sick.z;
    // someone grown at camp, with herbs in the stores, thinks to nurse them
    let chose = false;
    for (let i = 0; i < 40 && !chose; i++) {
      nurse.task = null;
      nurse.nextThink = s.tick;
      decide(s, nurse);
      chose = kindOf(nurse) === 'nurse';
    }
    expect(chose).toBe(true);
    expect(nurse.task!.ref).toBe(sick.id);
    expect(s.camp.stock.herbs).toBe(2);
    const before = sick.rel.get(nurse.id) ?? 0;
    finishTask(s, nurse);
    expect(sick.tended).toBeGreaterThan(s.tick);
    expect(sick.rel.get(nurse.id) ?? 0).toBeGreaterThan(before);
    expect(total(s, 'herbs.used')).toBe(1);
    // nobody else goes to someone already nursed
    const other = adult(s, [nurse, sick]);
    other.x = sick.x; other.z = sick.z + 0.5;
    for (let i = 0; i < 20; i++) { other.task = null; decide(s, other); expect(kindOf(other)).not.toBe('nurse'); }
    // the harm a fever does in an hour, nursed and not
    const needs = (q: Person) => (s as unknown as { needs(q: Person): void }).needs(q);
    const harm = (tended: boolean) => {
      sick.tended = tended ? s.tick + TICKS_PER_DAY : 0;
      sick.health = 80; sick.food = 80; sick.warmth = 80;
      needs(sick);
      return 80 - sick.health;
    };
    // a nursed fever does a little over half the harm
    expect(harm(true) / harm(false)).toBeCloseTo(0.017 / 0.03, 3);
  });

  it('come back to the stores if the sick get better first', () => {
    const s = sim(1);
    s.camp.knows.push('herbs');
    const nurse = adult(s);
    const sick = adult(s, [nurse]);
    s.camp.stock.herbs = 1;
    sick.sick = 3;
    nurse.task = { ...task(s, 'nurse', sick, sick.id), amount: 1, near: true };
    s.camp.stock.herbs = 0;
    sick.sick = 0;
    runTask(s, nurse);
    expect(nurse.task?.kind).not.toBe('nurse');
    expect(s.camp.stock.herbs).toBe(1);
  });
});

describe('bone needles', () => {
  const hunt = (s: Sim, p: Person) => {
    p.task = task(s, 'hunt', p, -1, 1);
    p.carry = CARRY.Meat;
    p.carryAmt = 8;
    deposit(s, p);
  };

  it('come from the bones of deer, kept once the band knows how to make them', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.knows.push('preserving', 'cloaks');
    hunt(s, p);
    expect(s.camp.stock.bones).toBe(0);
    s.camp.knows.push('needles');
    hunt(s, p);
    expect(s.camp.stock.bones).toBe(BONES_PER_DEER);
  });

  it('are ground from bone, and make the sewing quicker, wearing as they go', () => {
    const s = sim(2);
    runTo(s, s.tick + 1.6 * TICKS_PER_SEASON);
    s.camp.knows.push('preserving', 'cloaks', 'needles');
    s.camp.stock.bones = 4;
    for (let d = 0; d < 20 && !s.toolsOf(s.camp, 'needle').length; d++) runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.toolsOf(s.camp, 'needle').length).toBeGreaterThan(0);
    expect(total(s, 'made.needle')).toBeGreaterThan(0);
    // a cloak sewn with and without one
    const p = adult(s);
    const sew = () => {
      s.camp.stock.hides = 2; s.camp.stock.cordage = 1;
      p.task = task(s, 'craft', p, RECIPE_KEYS.indexOf('cloak'));
      p.x = s.camp.x + 1; p.z = s.camp.z;
      p.task.goal = s.tileOf(p); p.task.gx = p.x; p.task.gz = p.z;
      // (and forget any path they were already following)
      p.path = null;
      for (let i = 0; i < 60 && p.task!.stage === 0; i++) { runTask(s, p); s.tick++; }
      expect(p.task!.stage).toBe(1);
      return p.task!.timer;
    };
    const needle = s.toolsOf(s.camp, 'needle')[0];
    const withIt = sew();
    const worn = needle.wear;
    finishTask(s, p);
    expect(needle.wear).toBeGreaterThan(worn);
    for (const it of s.toolsOf(s.camp, 'needle')) s.items.splice(s.items.indexOf(it), 1);
    const without = sew();
    expect(withIt).toBeCloseTo(without * NEEDLE_SPEED, -0.5);
    expect(withIt).toBeLessThan(without);
  });

  it('are thought of only once the band sews cloaks', () => {
    expect(DISCOVERY.get('needles')!.needs).toContain('cloaks');
  });
});

describe('necklaces of teeth and shells', () => {
  it('are strung from the teeth of deer brought home', () => {
    const s = sim(1);
    const p = adult(s);
    s.camp.stock.trinkets = 0;
    p.task = task(s, 'hunt', p, -1, 1);
    p.carry = CARRY.Meat;
    p.carryAmt = 8;
    deposit(s, p);
    expect(s.camp.stock.trinkets).toBe(TEETH_PER_DEER);
  });

  it('are given to a partner or close friend, who thinks the better of the giver for it', () => {
    const s = sim(1);
    const p = adult(s);
    const q = adult(s, [p]);
    p.partner = -1;
    p.rel.clear();
    p.rel.set(q.id, 70);
    q.x = s.camp.x + 3; q.z = s.camp.z;
    q.task = { ...task(s, 'idle', q), stage: 1, timer: 9999 };
    p.x = s.camp.x + 1.4; p.z = s.camp.z;
    // (stringing one takes a tooth or shell and a twist of fiber from the stores)
    p.task = { ...task(s, 'gift', p, q.id), amount: 1 };
    const fondness = q.rel.get(p.id) ?? 0;
    const belonging = q.belonging = 40;
    finishTask(s, p, 2000);
    // a thing worn at the neck, like anything else worn, that remembers who gave it
    const it = s.wornIn(q, 'neck')!;
    expect(it.kind).toBe('necklace');
    expect(it.maker).toBe(p.id);
    expect(it.wearer).toBe(q.id);
    expect(s.wornBy(q)).toContain(it);
    expect(q.rel.get(p.id) ?? 0).toBeGreaterThan(fondness + 5);
    expect(q.belonging).toBeGreaterThan(belonging);
    expect(q.memories.some((m) => m.kind === 'gift' && m.subject === p.id)).toBe(true);
    expect(total(s, 'gifts.given')).toBe(1);
  });

  it('are made now and then in a band with teeth and fiber to spare, and not again soon by the same hand', () => {
    const s = sim(1);
    const givers = new Map<number, number[]>();
    const end = s.tick + TICKS_PER_YEAR;
    while (s.tick < end) {
      s.step();
      for (const p of s.living()) if (p.task?.kind === 'gift' && p.task.started === s.tick - 1) (givers.get(p.id) ?? givers.set(p.id, []).get(p.id)!).push(s.tick);
      if (s.tick % TICKS_PER_DAY === 0) s.camp.stock.trinkets = Math.max(s.camp.stock.trinkets, 4);
    }
    expect(total(s, 'gifts.given')).toBeGreaterThan(0);
    expect(s.living().some((p) => s.wornIn(p, 'neck')?.kind === 'necklace')).toBe(true);
    for (const ts of givers.values()) for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThan(GIFT_DAYS * TICKS_PER_DAY);
  });

  it('go into the grave with whoever wore one', () => {
    const s = sim(1);
    const [p, q] = [adult(s), adult(s)];
    const it = s.giveNecklace(q, p.id);
    s.kill(q, 'old age');
    runTo(s, s.tick + TICKS_PER_DAY + 1);
    expect(s.items).not.toContain(it);
  });

  it('worn in an old save, where only the giver was kept, become one', () => {
    const s = sim(1);
    const [p, q] = [adult(s), adult(s)];
    const save = JSON.parse(JSON.stringify(s.serialize()));
    save.people.find((o: { id: number }) => o.id === q.id).necklace = p.id;
    const r = new Sim(s.world, save);
    const it = r.wornIn(r.byId.get(q.id)!, 'neck')!;
    expect(it.kind).toBe('necklace');
    expect(it.maker).toBe(p.id);
    expect('necklace' in r.byId.get(q.id)!).toBe(false);
  });

  it('give the materials back if the one they were for is gone', () => {
    const s = sim(1);
    const p = adult(s);
    const q = adult(s, [p]);
    s.camp.stock.trinkets = 0;
    s.camp.stock.fiber = 0;
    p.task = { ...task(s, 'gift', p, q.id), amount: 1 };
    s.kill(q, 'test');
    runTask(s, p);
    expect(p.task?.kind).not.toBe('gift');
    expect(s.camp.stock.trinkets).toBe(1);
    expect(s.camp.stock.fiber).toBe(1);
  });
});

describe('the midwinter feast', () => {
  const toMidwinter = (s: Sim) => {
    while (dayOf(s.tick) % DAYS_PER_YEAR !== MIDWINTER - 1 || hourOf(s.tick) < 12) s.step();
  };

  it('is held on the longest night when the stores will bear it, and everyone comes', () => {
    const s = sim(1);
    toMidwinter(s);
    const st = s.camp.stock;
    st.meat += 60; st.fish += 30;
    const n = s.members(s.camp).length;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(s.camp.feastDay).toBeDefined();
    expect(s.events.some((e) => e.kind === 'feast')).toBe(true);
    runTo(s, s.tick + TICKS_PER_DAY);
    const ate = total(s, 'feast.ate');
    expect(ate).toBeGreaterThanOrEqual(Math.ceil(n * 0.6));
    const feasted = s.living().filter((p) => p.memories.some((m) => m.kind === 'midwinter'));
    expect(feasted.length).toBeGreaterThanOrEqual(Math.ceil(n * 0.5));
  });

  it('is let pass when the stores are thin', () => {
    const s = sim(1);
    toMidwinter(s);
    const st = s.camp.stock;
    st.meat = 0; st.fish = 0; st.berries = 0; st.preserved = 0; st.roots = 0; st.nuts = 0;
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.camp.feastDay).toBeUndefined();
    expect(s.events.some((e) => e.kind === 'feast_none')).toBe(true);
    expect(total(s, 'feast.ate')).toBe(0);
  });

  it('is a full meal and good company for each who comes', () => {
    const s = sim(1);
    const p = adult(s);
    const c = s.camp;
    c.feastDay = dayOf(s.tick);
    c.stock.meat = 40;
    p.food = 30;
    p.belonging = 20;
    p.x = c.x + 1.2; p.z = c.z;
    p.task = task(s, 'feast', p);
    finishTask(s, p);
    expect(40 - c.stock.meat).toBeCloseTo(1.5, 5);
    expect(p.food).toBeGreaterThan(90);
    expect(p.belonging).toBeGreaterThanOrEqual(50);
    expect(p.memories.some((m) => m.kind === 'midwinter')).toBe(true);
  });
});

describe('saving', () => {
  it('keeps the new stores and the picked-over oaks', () => {
    const s = sim(1);
    s.camp.knows.push('nuts');
    runTo(s, s.tick + 2 * TICKS_PER_SEASON + 6 * TICKS_PER_DAY);
    Object.assign(s.camp.stock, { nuts: 3, herbs: 2, bones: 4, trinkets: 5 });
    const r = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())));
    expect(r.camp.stock.nuts).toBe(3);
    expect(r.camp.stock.herbs).toBe(2);
    expect(r.camp.stock.bones).toBe(4);
    expect(r.camp.stock.trinkets).toBe(5);
    expect(r.nutsTaken.size).toBe(s.nutsTaken.size);
  });
});
