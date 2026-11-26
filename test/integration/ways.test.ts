// Customs: the ways a band lives by. A band brings some over the hills, takes up others from what it lives
// through, and a daughter band keeps most and drops some. Each changes what people do.
import { describe, it, expect } from 'vitest';
import { Sim, SaveData } from '../../src/sim/sim';
import { TICKS_PER_YEAR, TICKS_PER_DAY } from '../../src/sim/time';
import { deposit } from '../../src/sim/ai';
import { CARRY } from '../../src/sim/band';
import {
  WayKind, WAYS, holds, takeUp, foundWays, carryWays, mayLead, mayPair, mayRule, takeInChance, matchChance, quarrelChance, riseChance,
  lived, waysDaily, feastPeace, newcomer, belongingKept, WAY_DAY, ELDER_AGE, ELDER_RULE, WARY_COLD, WELCOME_WARM, FEAST_DAYS,
} from '../../src/sim/ways';
import { ruleDaily, RISE_DAY } from '../../src/sim/rule';
import { sim, runYears } from '../helpers';

/** Odds that always (or never) come up, for the customs' own stream. */
const always = (s: Sim, yes = true) => { s.rWays = { chance: () => yes, next: () => (yes ? 0 : 0.999), int: (a: number) => a } as unknown as Sim['rWays']; };
const adults = (s: Sim) => s.members().filter((q) => s.age(q) >= 16);
/** A band a couple of years on, with no customs (they are given one at a time). */
function band(seed = 1, ways: WayKind[] = []) {
  const s = runYears(sim(seed), 2);
  s.camp.ways = [];
  s.camp.lived = [];
  for (const k of ways) takeUp(s, s.camp, k, 'for the test', null);
  return s;
}

describe('customs', () => {
  it('a band come over the hills brings the ways its leader leans to', () => {
    const s = sim(1);
    const c = s.camps[0];
    expect(Array.isArray(c.ways)).toBe(true);
    // a kind, pious leader with an old elder, every lean taken up
    const leader = s.byId.get(c.leader)!;
    leader.traits = ['kind', 'pious'];
    const elder = s.members(c).find((q) => s.age(q) >= ELDER_AGE)!;
    always(s);
    foundWays(s, c, leader, elder);
    for (const k of ['share_meat', 'welcome', 'widows', 'elders', 'humble', 'feast_peace'] as WayKind[]) expect(holds(c, k)).toBe(true);
    // never both sides of a pair, and never that only the other sex leads
    expect(holds(c, 'welcome') && holds(c, 'wary')).toBe(false);
    expect(holds(c, leader.sex ? 'women_lead' : 'men_lead')).toBe(false);
  });

  it('taking up a custom drops the one against it, and is told in the chronicle', () => {
    const s = band(1, ['welcome']);
    const n = s.events.length;
    takeUp(s, s.camp, 'wary', 'after a test', 'After a test,');
    expect(holds(s.camp, 'wary')).toBe(true);
    expect(holds(s.camp, 'welcome')).toBe(false);
    expect(s.events.slice(n).some((e) => e.kind === 'way' && e.text.includes(s.camp.name))).toBe(true);
  });

  it('a daughter band keeps most of its parent\'s customs and drops some, and its leader may bring one', () => {
    const s = band(1, ['share_meat', 'elders', 'men_lead']);
    const from = s.camp;
    const to = { ...from, id: 99999, name: 'Testholt', ways: [] } as unknown as typeof from;
    const woman = adults(s).find((q) => q.sex === 0)!;
    woman.traits = ['pious'];
    always(s);
    carryWays(s, from, to, woman);
    expect(holds(to, 'share_meat')).toBe(true);
    expect(holds(to, 'elders')).toBe(true);
    // (a band led away by a woman can't keep that only men lead)
    expect(holds(to, 'men_lead')).toBe(false);
    expect(holds(to, 'widows')).toBe(true);
    always(s, false);
    carryWays(s, from, to, woman);
    expect(to.ways).toEqual([]);
    expect(s.events.some((e) => e.kind === 'way_drift' && e.text.includes('left behind'))).toBe(true);
  });

  it('meat shared equally: the band feels the closer for a deer brought home, and thinks the better of the hunter', () => {
    const s = band(1, ['share_meat']);
    const [p, q] = adults(s);
    q.belonging = 50;
    const before = s.opinion(q, p);
    p.task = { kind: 'hunt', stage: 0, goal: 0, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
    p.carry = CARRY.Carcass;
    p.carryAmt = 10;
    deposit(s, p);
    expect(q.belonging).toBeGreaterThan(50);
    expect(s.opinion(q, p)).toBeGreaterThan(before);
  });

  it('newcomers welcome, or kept at arm\'s length: taken in, matched, and thought of accordingly', () => {
    const s = band(1, ['welcome']);
    const c = s.camp;
    const [p, q] = adults(s);
    expect(takeInChance(c, 0.3)).toBeGreaterThan(0.3);
    let before = s.opinion(q, p);
    newcomer(s, p, c);
    expect(s.opinion(q, p)).toBe(Math.min(100, before + WELCOME_WARM));
    takeUp(s, c, 'wary', 'for the test', null);
    expect(takeInChance(c, 0.3)).toBeLessThan(0.3);
    expect(matchChance(c, c, 0.12)).toBeLessThan(0.12);
    const stranger = adults(s).find((o) => o !== p && o !== q && !s.isKin(o, q) && o.id !== q.partner && !s.isKin(o, p))!;
    before = s.opinion(q, stranger);
    newcomer(s, stranger, c);
    if (!s.isKin(q, stranger) && q.partner !== stranger.id) expect(s.opinion(q, stranger)).toBe(Math.max(-100, before - WARY_COLD));
    expect(belongingKept(s, stranger)).toBeLessThan(1);
    expect(stranger.memories.some((m) => m.kind === 'arms_length')).toBe(true);
  });

  it('a widow does not take another partner, where that is the custom', () => {
    const s = band(1, ['widows']);
    const w = adults(s).find((q) => q.sex === 0)!;
    expect(mayPair(s, w)).toBe(true);
    w.widowed = s.tick;
    expect(mayPair(s, w)).toBe(false);
    s.camp.ways = [];
    expect(mayPair(s, w)).toBe(true);
  });

  it('a death leaves the partner widowed', () => {
    const s = band(1);
    const p = adults(s).find((q) => q.partner >= 0 && s.byId.get(q.partner)?.alive)!;
    const partner = s.byId.get(p.partner)!;
    s.kill(p, 'old age');
    expect(partner.partner).toBe(-1);
    expect(partner.widowed).toBe(s.tick);
  });

  it('only a man, or only a woman, may lead: found a band, rule it, or lead a group away', () => {
    const s = band(1, ['men_lead']);
    const man = adults(s).find((q) => q.sex === 1)!, woman = adults(s).find((q) => q.sex === 0)!;
    expect(mayLead(s.camp, man)).toBe(true);
    expect(mayLead(s.camp, woman)).toBe(false);
    expect(mayRule(s, s.camp, woman)).toBe(false);
    takeUp(s, s.camp, 'women_lead', 'for the test', null);
    expect(holds(s.camp, 'men_lead')).toBe(false);
    expect(mayLead(s.camp, man)).toBe(false);
    expect(mayLead(s.camp, woman)).toBe(true);
  });

  it('the elders\' word is final: quarrels come to blows less often while an elder lives, and nobody young takes hold', () => {
    const s = band(1, ['elders']);
    const c = s.camp;
    const elder = s.members().find((q) => s.age(q) >= ELDER_AGE && q.health > 30);
    if (elder) expect(quarrelChance(s, c, 10, 50, 1)).toBeLessThan(1);
    const young = adults(s).find((q) => s.age(q) < ELDER_RULE)!;
    expect(mayRule(s, c, young)).toBe(false);
  });

  it('braggarts mocked down to size: someone seldom takes hold, and the ambitious are thought the less of each year', () => {
    const s = band(1, ['humble']);
    expect(riseChance(s.camp, 0.1)).toBeLessThan(0.1);
    const p = adults(s)[0], q = adults(s)[1];
    p.traits = ['ambitious'];
    s.adjust(q, p, 50 - s.opinion(q, p));
    waysDaily(s, WAY_DAY);
    expect(s.opinion(q, p)).toBeLessThan(50);
    // (but only down to size: not into a feud)
    for (let y = 0; y < 30; y++) waysDaily(s, WAY_DAY);
    expect(s.opinion(q, p)).toBeGreaterThanOrEqual(10);
  });

  it('no blood at the feast: nobody comes to blows in the days round the longest night, and old quarrels are put aside', () => {
    const s = band(1, ['feast_peace']);
    expect(quarrelChance(s, s.camp, 50, 50 + FEAST_DAYS, 1)).toBe(0);
    expect(quarrelChance(s, s.camp, 30, 50, 1)).toBe(1);
    const [p, q] = adults(s);
    s.adjust(p, q, -200);
    feastPeace(s, s.camp);
    expect(s.opinion(p, q)).toBeGreaterThan(-100);
  });

  it('what a band lives through may harden into a custom, late in the summer', () => {
    const s = band(1);
    lived(s, s.camp, 'share_meat', 'after the hunger of year 3');
    always(s);
    waysDaily(s, WAY_DAY - 1);
    expect(holds(s.camp, 'share_meat')).toBe(false);
    waysDaily(s, WAY_DAY);
    expect(holds(s.camp, 'share_meat')).toBe(true);
    expect(s.camp.ways!.find((w) => w.kind === 'share_meat')!.why).toBe('after the hunger of year 3');
    expect(s.events.some((e) => e.kind === 'way' && e.text.startsWith('After the hunger of year 3,'))).toBe(true);
    // (and what was lived through too long ago is forgotten)
    lived(s, s.camp, 'wary', 'after a test');
    s.camp.lived![0].tick -= 3 * TICKS_PER_YEAR;
    waysDaily(s, WAY_DAY);
    expect(holds(s.camp, 'wary')).toBe(false);
  });

  it('a ruler thrown off teaches the band to mock anyone who puts on airs', () => {
    const s = band(1);
    const c = s.camp;
    const p = adults(s).find((q) => s.age(q) >= 25)!;
    c.rule = { kind: 'builder', ruler: p.id, since: s.tick - TICKS_PER_YEAR, strain: 1000 };
    s.rRule = { chance: () => true, next: () => 0 } as unknown as Sim['rRule'];
    for (let d = 0; d < 12 && c.rule; d++) ruleDaily(s, d);
    expect(c.rule).toBeUndefined();
    expect(c.lived!.some((l) => l.kind === 'humble')).toBe(true);
    // (and a band where that is the custom seldom comes under a ruler)
    expect(RISE_DAY).toBeGreaterThan(0);
  });

  it('every custom has words for the band panel and the chronicle', () => {
    for (const k of Object.keys(WAYS) as WayKind[]) {
      expect(WAYS[k].text.length).toBeGreaterThan(10);
      expect(WAYS[k].took.startsWith('From now on')).toBe(true);
      const a = WAYS[k].against;
      if (a) expect(WAYS[a].against).toBe(k);
    }
  });

  it('is kept in a save, and a world loaded carries on the same', () => {
    const s = runYears(sim(2), 1);
    takeUp(s, s.camp, 'feast_peace', 'for the test', null);
    const t = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())) as SaveData);
    expect(t.camp.ways).toEqual(s.camp.ways);
    expect(t.rWays.getState().map((v) => v >>> 0)).toEqual(s.rWays.getState().map((v) => v >>> 0));
    for (let k = 0; k < 2 * TICKS_PER_DAY; k++) { s.step(); t.step(); }
    expect(t.historyHash()).toBe(s.historyHash());
  });
  it('a killer driven out takes the customs they grew up with to the camp they found', () => {
    const s = band(1, ['elders', 'share_meat']);
    const c = s.camp;
    const [att, vic] = adults(s);
    for (const q of s.members()) if (q !== att) s.adjust(q, att, -200);
    always(s);
    (s as unknown as { exile(a: typeof att, v: typeof att, c: typeof s.camp): void }).exile(att, vic, c);
    const nc = s.campById(att.band)!;
    expect(nc).not.toBe(c);
    expect(holds(nc, 'elders')).toBe(true);
    expect(holds(nc, 'share_meat')).toBe(true);
  });
});
