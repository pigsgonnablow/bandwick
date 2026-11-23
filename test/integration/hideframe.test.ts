// The hide-scraping frame: a deer hide laced taut in a square of poles, scraped standing. Hidework done at the
// band's frame goes quicker and comes out finer, so the clothes sewn from it last longer.
import { describe, it, expect } from 'vitest';
import { SK, Person, ACT, Building, HIDEWORK, FRAME_SPEED, FRAME_FINE, BUILD } from '../../src/sim/band';
import { DISCOVERY, knowHowFor } from '../../src/sim/know';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { setup, runTask } from '../../src/sim/ai';
import { Sim } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band two years on, fed, with hides and cordage in hand, knowing how to sew cloaks. */
function hideworkers(seed = 2) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of ['preserving', 'cloaks']) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.hides += 10;
  c.stock.cordage += 10;
  c.stock.wood += 40;
  c.stock.grain += 2000;
  c.stock.preserved += 500;
  return s;
}
/** The same band with a frame standing beside its camp. */
function withFrame(s: Sim) {
  s.camp.knows.push('hideframe');
  const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
  const frame: Building = { ...pile, id: s.newId(), kind: 'frame', built: true, x: pile.x + 2, tile: pile.tile + 2, builders: [] };
  s.buildings.push(frame);
  return frame;
}
const adult = (s: Sim) => s.members().find((q) => s.age(q) >= 18 && s.age(q) <= 50)!;
/** Start someone on a cloak and walk them to where it is made, returning the task once they sit (or stand) to it. */
function startCloak(s: Sim, p: Person) {
  p.task = setup(s, p, 'craft', 'cloak')!;
  expect(p.task).not.toBeNull();
  for (let k = 0; k < 400 && p.task?.stage === 0; k++) runTask(s, p);
  return p.task!;
}

describe('hide frame', () => {
  it('is thought of by a hideworker who can build, while sewing, once the band sews cloaks', () => {
    const d = DISCOVERY.get('hideframe')!;
    expect(d.needs).toEqual(['cloaks']);
    expect(d.requires).toEqual([{ kind: 'skill', skill: SK.hide, level: 11 }, { kind: 'skill', skill: SK.build, level: 8 }]);
    expect(Object.keys(d.practice).sort()).toEqual(['carcass', 'sew']);
    expect(knowHowFor({ kind: 'frame' })).toEqual(['hideframe']);
    expect(BUILD.frame.wood).toBeGreaterThan(0);
  });

  it('puts up one frame once the band knows how', () => {
    const s = hideworkers();
    s.camp.knows.push('hideframe');
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'frame').length).toBe(1);
    runTo(s, s.tick + 2 * TICKS_PER_DAY);
    expect(s.buildings.filter((b) => b.band === s.camp.id && b.kind === 'frame').length).toBe(1);
  });

  it('sews by the fire without a frame, and stands at the frame to scrape once there is one, in less time', () => {
    const s = hideworkers();
    const p = adult(s);
    p.skills[SK.hide] = 10;
    expect(s.workshopFor('cloak')).toBeUndefined();
    const byFire = startCloak(s, p).timer;
    runTask(s, p);
    expect(p.act).toBe(ACT.Sit);
    p.task = null;

    const frame = withFrame(s);
    for (const k of HIDEWORK) expect(s.workshopFor(k)).toBe(frame);
    expect(s.workshopFor('tunic')).not.toBe(frame);
    const t = startCloak(s, p);
    expect(t.timer).toBeLessThan(byFire);
    expect(t.timer).toBeCloseTo(byFire * FRAME_SPEED, -1);
    runTask(s, p);
    expect(p.act).toBe(ACT.Scrape);
    expect(Math.hypot(p.x - frame.x - 0.5, p.z - frame.z - 0.5)).toBeLessThan(0.4);
    // and the cloak comes off it into the stores
    const before = s.items.filter((i) => i.kind === 'cloak').length;
    t.timer = 1;
    runTask(s, p);
    expect(s.items.filter((i) => i.kind === 'cloak').length).toBe(before + 1);
  });

  it('turns out finer work at the frame, so what is sewn there wears longer', () => {
    const s = hideworkers();
    const p = adult(s);
    p.skills[SK.hide] = 9;
    const fine = () => {
      let q = 0;
      for (let k = 0; k < 400; k++) q += s.qualityFor(p, 'cloak');
      return q;
    };
    const without = fine();
    withFrame(s);
    const at = fine();
    expect(FRAME_FINE).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(without * 1.3);
  });
});
