// Monuments: a burial mound beside the band's graves, then a ring of standing stones, each raised over years in
// the hours a settled band can spare, and what they mean to it once they stand.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILD, Building, Person, Task, TaskKind, isMonument, specOf } from '../../src/sim/band';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { runTask, monumentReach } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runYears } from '../helpers';

/** A band some years on, well fed, knowing how to raise a burial mound. */
function settled(seed = 1) {
  const s = runYears(sim(seed), 3);
  const c = s.camp;
  for (const k of ['huts', 'preserving', 'storehouse', 'barrow']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.grain += 3000;
  c.stock.preserved += 800;
  c.stock.wood += 300;
  return s;
}
const monumentOf = (s: Sim, kind?: string) => s.bandBuildings(s.camp).find((b) => isMonument(b.kind) && (!kind || b.kind === kind));
const task = (s: Sim, kind: TaskKind, b: Building, stage = 1, timer = 1): Task =>
  ({ kind, stage, goal: b.tile, gx: b.x + 0.5, gz: b.z + 0.5, ref: b.id, timer, started: s.tick, amount: 0, near: true });
const adult = (s: Sim) => s.members().filter((q: Person) => s.age(q) >= 20 && s.age(q) <= 45).sort((a, b) => b.skills[0] - a.skills[0])[0];
/** Mesh names in the band's models. */
function glbNames() {
  const buf = readFileSync('src/assets/band.glb');
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  return new Set<string>((json.nodes ?? []).map((n: { name: string }) => n.name));
}

describe('monuments', () => {
  it('are found at the graves and at the mound, the mound after the storehouse and the ring after the mound', () => {
    const barrow = DISCOVERY.get('barrow')!, stones = DISCOVERY.get('stones')!;
    expect(barrow.needs).toEqual(['storehouse']);
    expect(Object.keys(barrow.practice)).toEqual(['laid']);
    expect(stones.needs).toEqual(['barrow']);
    expect(Object.keys(stones.practice)).toEqual(['raise', 'laid']);
    expect(knowHowFor({ kind: 'barrow' })).toEqual(['barrow']);
    expect(knowHowFor({ kind: 'stones' })).toEqual(['stones']);
    // (years of work, and stone)
    expect(BUILD.barrow.work).toBeGreaterThan(BUILD.hut.work * 50);
    expect(BUILD.stones.stone).toBeGreaterThan(BUILD.barrow.stone);
  });

  it('are marked out one at a time, the mound beside the graves and not on them', () => {
    const s = settled();
    const c = s.camp;
    s.plan();
    const b = monumentOf(s)!;
    expect(b.kind).toBe('barrow');
    expect(c.plan).toContain('Mark out a burial mound by the graves');
    if (c.graveyard >= 0) {
      const N = s.N;
      expect(Math.hypot(b.x - (c.graveyard % N), b.z - Math.floor(c.graveyard / N))).toBeLessThan(4);
      for (const dz of [-1, 0, 1]) for (const dx of [-1, 0, 1]) expect(s.gravesOn(b.tile + dz * N + dx)).toBe(false);
    }
    // knowing the ring too, nothing more is begun until the mound is finished
    c.knows.push('stones');
    s.plan();
    expect(s.bandBuildings(c).filter((q) => isMonument(q.kind))).toHaveLength(1);
    b.built = true;
    s.plan();
    expect(monumentOf(s, 'stones')).toBeTruthy();
    expect(c.plan).toContain('Mark out a ring of standing stones');
  });

  it('are raised only in the hours the band can spare, and are no job for the builders', () => {
    const s = settled();
    const c = s.camp;
    s.plan();
    const b = monumentOf(s)!;
    // a fed band with nothing else to build: the monument is spare-hours work, the builders have no site
    for (const q of s.bandBuildings(c)) if (q !== b) q.built = true;
    s.plan();
    expect(c.jobs.raise).toBeGreaterThan(0);
    expect(c.jobs.build).toBe(0);
    expect(c.plan.some((l) => l.startsWith('Raise a mound'))).toBe(true);
    // a band going short, rationing into the winter, has no hours to spare (the plan works that out from the stores)
    for (const k of ['grain', 'preserved', 'meat', 'fish', 'roots', 'nuts', 'berries', 'greens', 'eggs', 'honey', 'mushrooms'] as const) c.stock[k] = 0;
    s.tick = Math.floor(s.tick / (TICKS_PER_DAY * 48)) * TICKS_PER_DAY * 48 + TICKS_PER_DAY * 34;
    s.plan();
    expect(c.jobs.raise ?? 0).toBe(0);
  });

  it('go up only as far as the stone brought to them, and are finished with the last of it', () => {
    const s = settled();
    s.plan();
    const b = monumentOf(s)!;
    const spec = specOf(b);
    const p = adult(s);
    // no stone yet: a little of the earth work, then it waits on stone
    p.task = task(s, 'raise', b, 1, 100000);
    for (let k = 0; k < 2000 && p.task; k++) runTask(s, p);
    expect(b.work).toBeCloseTo(monumentReach(b), 5);
    expect(b.work).toBeLessThan(spec.work * 0.2);
    // all the stone there, and the work all but done: the next spell finishes it
    b.stone = spec.stone;
    b.work = spec.work - 0.5;
    const before = s.events.length;
    p.task = task(s, 'raise', b);
    runTask(s, p);
    expect(b.built).toBe(true);
    const ev = s.events.slice(before).find((e) => e.kind === 'monument');
    expect(ev?.text).toMatch(/finished the burial mound/);
    expect(p.memories.some((m) => m.kind === 'monument')).toBe(true);
    for (const q of s.members()) expect(q.memories.some((m) => m.kind === 'monument')).toBe(true);
  });

  it('are finished when the last stone comes in after the rest of the work is done', () => {
    // (the work runs up to the stone it has: when the last stone arrives with nothing else left, someone still
    // goes out to set it, and the monument is finished)
    const s = settled();
    s.plan();
    const b = monumentOf(s)!;
    for (const q of s.bandBuildings(s.camp)) if (q !== b) q.built = true;
    b.work = specOf(b).work;
    b.stone = specOf(b).stone;
    const end = s.tick + TICKS_PER_DAY * 6;
    while (s.tick < end && !b.built) s.step();
    expect(b.built).toBe(true);
  });

  it('outlast the band that raised them, and stand half raised where a band moved on', () => {
    const s = settled();
    const c = s.camp;
    s.plan();
    const b = monumentOf(s)!;
    b.work = 500;
    // the band moves on: what it had begun of its monument is left standing, not cleared away like a building site
    (s as unknown as { dropSites(c: unknown): void }).dropSites(c);
    expect(s.buildings.includes(b)).toBe(true);
    // and once it is finished, it stands long after the huts have fallen in
    b.built = true;
    c.gone = s.tick;
    s.tick += 13 * 48 * TICKS_PER_DAY;
    (s as unknown as { ruinsFall(): void }).ruinsFall();
    expect(s.buildings.includes(b)).toBe(true);
    expect(s.buildings.some((q) => q.band === c.id && q.kind === 'hut')).toBe(false);
  });

  it('draw in stages as they go up, each with its model', () => {
    const s = settled();
    s.plan();
    const b = monumentOf(s)!;
    const spec = specOf(b);
    const look = () => s.packBuildings().find((q) => q.id === b.id)!.look;
    b.work = 1;
    b.stone = 1;
    expect(look()).toBe('barrow1');
    b.work = spec.work * 0.5;
    b.stone = spec.stone * 0.5;
    expect(look()).toBe('barrow2');
    b.work = spec.work * 0.9;
    b.stone = spec.stone * 0.9;
    expect(look()).toBe('barrow3');
    b.built = true;
    expect(look()).toBe('barrow');
    const names = glbNames();
    const src = readFileSync('src/render/band.ts', 'utf8');
    for (const k of ['barrow', 'stones'])
      for (const v of ['1', '2', '3', '']) {
        expect(names.has(`bld__${k}${v}`), `bld__${k}${v}`).toBe(true);
        expect(src.includes(`'${k}${v}'`), `renderer loads ${k}${v}`).toBe(true);
      }
  });

  it('hold a band where it is: the dead laid by the mound, the year seen turn at the stones', () => {
    const s = settled();
    s.plan();
    const b = monumentOf(s)!;
    b.built = true;
    b.stone = specOf(b).stone;
    b.work = specOf(b).work;
    // a death in the band, buried at home: laid by the mound, with those who went before
    const p = adult(s);
    const dead = s.members().find((q) => q !== p && s.age(q) >= 30)!;
    dead.alive = false;
    dead.death = s.tick;
    dead.x = s.camp.x + 1;
    dead.z = s.camp.z + 1;
    p.x = dead.x;
    p.z = dead.z;
    p.task = { ...task(s, 'bury', b, 3, 1), ref: dead.id };
    const before = s.events.length;
    runTask(s, p);
    expect(dead.buried).toBe(true);
    expect(s.events.slice(before).some((e) => /laid .* to rest by the mound/.test(e.text))).toBe(true);
    // a card that says what it is
    const card = s.inspectThing({ kind: 'building', id: b.id })!;
    expect(card.lines.some((l) => l.label === 'Laid by it')).toBe(true);
    // and with a ring of standing stones raised too, the band goes out to them after the midwinter feast
    const ring: Building = { ...b, id: s.newId(), kind: 'stones', tile: b.tile + 3, x: b.x + 3, builders: [] };
    s.buildings.push(ring);
    const q = s.members().find((m) => m.alive && m !== p && s.age(m) >= 14)!;
    const was = q.belonging;
    q.belonging = 10;
    q.task = { ...task(s, 'feast', b, 1, 1), goal: s.camp.tile, gx: s.camp.x, gz: s.camp.z };
    runTask(s, q);
    expect(q.memories.filter((m) => m.kind === 'midwinter').at(-1)?.text).toMatch(/standing stones/);
    expect(q.belonging).toBeGreaterThan(10 + 30 + 10);
    q.belonging = was;
  });
});
