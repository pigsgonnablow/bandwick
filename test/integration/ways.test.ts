// Customs: the ways a band lives by. A band brings some over the hills, takes up others from what it lives
// through, and a daughter band keeps most and drops some. Each changes what people do.
import { describe, it, expect } from 'vitest';
import { Sim, SaveData } from '../../src/sim/sim';
import { TICKS_PER_YEAR, TICKS_PER_DAY } from '../../src/sim/time';
import { deposit } from '../../src/sim/ai';
import { CARRY } from '../../src/sim/band';
import {
  WayKind, WAYS, holds, takeUp, foundWays, carryWays, mayLead, mayPair, mayRule, takeInChance, matchChance, quarrelChance, riseChance,
  huntDrive, lived, waysDaily, feastPeace, newcomer, belongingKept, WAY_DAY, BEST_CUT, ELDER_AGE, ELDER_RULE, WARY_COLD, WELCOME_WARM, FEAST_DAYS, BEST_DRIVE,
  buriedWithThings, firstSalmon, salmonThanks, SALMON_THANKS, SALMON_NEAR, twinsBorn, TWINS_SHUN, childGrief, childBelong, RAISED_GRIEF, RAISED_BELONG,
  guestFed, GUEST_FED, sweatsToHunt, sweatAim, SWEAT_HUNTER, SWEAT_AIM, whoGoes, theftDaily, THEFT_SCORN, BURIALS, WAY_KINDS, FOUND_LEAN,
} from '../../src/sim/ways';
import { sparesWhite } from '../../src/sim/omen';
import { SK, Person } from '../../src/sim/band';
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
    expect(holds(c, 'share_meat') && holds(c, 'hunter_best')).toBe(false);
    expect(holds(c, 'welcome') && holds(c, 'wary')).toBe(false);
    expect(holds(c, leader.sex ? 'women_lead' : 'men_lead')).toBe(false);
  });

  it('taking up a custom drops the one against it, and is told in the chronicle', () => {
    const s = band(1, ['share_meat']);
    const n = s.events.length;
    takeUp(s, s.camp, 'hunter_best', 'after a test', 'After a test,');
    expect(holds(s.camp, 'hunter_best')).toBe(true);
    expect(holds(s.camp, 'share_meat')).toBe(false);
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

  it('the hunter keeps the best: eats the best of the kill, and the band\'s hunters go out more readily', () => {
    const s = band(1, ['hunter_best']);
    const p = adults(s)[0];
    p.food = 40;
    p.task = { kind: 'hunt', stage: 0, goal: 0, gx: 0, gz: 0, ref: -1, timer: 0, started: s.tick, amount: 0, near: false };
    p.carry = CARRY.Carcass;
    p.carryAmt = 10;
    deposit(s, p);
    expect(p.food).toBe(40 + BEST_CUT);
    expect(huntDrive(s.camp)).toBe(BEST_DRIVE);
    s.camp.ways = [];
    expect(huntDrive(s.camp)).toBe(1);
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
  it('the dead are buried with their things: the tool in their hand goes into the ground with them, and their kin remember it', () => {
    const s = band(1, ['buried_things']);
    const dead = adults(s).find((q) => s.members().some((k) => k !== q && k.alive && s.isKin(k, q)))!;
    const kin = s.members().find((k) => k !== dead && s.isKin(k, dead))!;
    const axe = { id: s.newId(), kind: 'axe' as const, band: s.camp.id, holder: dead.id, wear: 0, made: s.tick, maker: -1 };
    s.items.push(axe);
    expect(buriedWithThings(s, dead)).toBe(true);
    s.kill(dead, 'fever');
    expect(axe.holder).toBe(dead.id);
    for (let k = 0; k < 6 * TICKS_PER_DAY && !dead.buried; k++) s.step();
    expect(dead.buried).toBe(true);
    expect(s.items.includes(axe)).toBe(false);
    expect(kin.memories.some((m) => m.kind === 'grave_things')).toBe(true);
    // and where it is not the custom, the tool goes back on the pile
    const t = band(1);
    const other = adults(t)[0];
    const stick = { id: t.newId(), kind: 'stick' as const, band: t.camp.id, holder: other.id, wear: 0, made: t.tick, maker: -1 };
    t.items.push(stick);
    t.kill(other, 'fever');
    expect(stick.holder).not.toBe(other.id);
  });

  it('a year of burials may teach a band to bury its dead with their things', () => {
    const s = band(1);
    const old = adults(s).slice(0, BURIALS);
    for (const p of old) s.kill(p, 'fever');
    always(s);
    waysDaily(s, WAY_DAY);
    expect(s.camp.lived!.some((l) => l.kind === 'buried_things')).toBe(true);
    waysDaily(s, WAY_DAY);
    expect(holds(s.camp, 'buried_things')).toBe(true);
  });

  it('the first salmon goes back to the river, once a year, and the run near camp is the thicker for it', () => {
    const s = band(1, ['first_salmon']);
    const p = adults(s)[0];
    expect(salmonThanks(s, s.camp.x, s.camp.z)).toBe(1);
    expect(firstSalmon(s, p)).toBe(true);
    expect(firstSalmon(s, p)).toBe(false);
    expect(s.events.at(-1)!.kind).toBe('way_habit');
    expect(salmonThanks(s, s.camp.x, s.camp.z)).toBe(SALMON_THANKS);
    expect(salmonThanks(s, s.camp.x + SALMON_NEAR + 5, s.camp.z)).toBe(1);
    s.tick += TICKS_PER_YEAR;
    expect(salmonThanks(s, s.camp.x, s.camp.z)).toBe(1);
    expect(firstSalmon(s, p)).toBe(true);
    s.camp.ways = [];
    s.tick += TICKS_PER_YEAR;
    expect(firstSalmon(s, p)).toBe(false);
  });

  it('the white deer is never hunted, where that is the custom', () => {
    const s = band(1);
    const p = adults(s)[0];
    p.beliefs = [];
    s.camp.customs = [];
    expect(sparesWhite(s, p)).toBe(false);
    takeUp(s, s.camp, 'white_deer', 'for the test', null);
    expect(sparesWhite(s, p)).toBe(true);
  });

  it('twins are a bad sign: the grown-ups think the less of them, and a twin lost may teach the band so', () => {
    const s = band(1, ['twins_bad']);
    const mother = adults(s).find((q) => q.sex === 0)!;
    const [a, b] = s.members().filter((q) => s.age(q) < 12).slice(0, 2);
    const grown = adults(s).find((q) => q !== mother)!;
    const before = s.opinion(grown, a);
    const n = s.events.length;
    twinsBorn(s, mother, [a, b]);
    expect(s.opinion(grown, a)).toBe(Math.max(-100, before - TWINS_SHUN));
    expect(s.events.slice(n).some((e) => e.kind === 'way_habit')).toBe(true);
    expect(grown.memories.some((m) => m.kind === 'twins_omen')).toBe(true);
    // no custom, no omen
    const t = band(1);
    const m2 = adults(t).find((q) => q.sex === 0)!;
    const [c2, d2] = t.members().filter((q) => t.age(q) < 12).slice(0, 2);
    const g2 = adults(t).find((q) => q !== m2)!;
    const b2 = t.opinion(g2, c2);
    twinsBorn(t, m2, [c2, d2]);
    expect(t.opinion(g2, c2)).toBe(b2);
    // a twin baby who dies: the band may come to take twins for a bad sign
    const baby = t.members().find((q) => t.age(q) < 2) ?? t.members().filter((q) => t.age(q) < 12)[0];
    const mum = t.byId.get(baby.mother)!;
    baby.birth = t.tick - 100;
    const twin = t.members().find((q) => q !== baby && q.mother === mum.id) ?? t.members().find((q) => q !== baby && t.age(q) < 12)!;
    twin.birth = baby.birth;
    if (!mum.children.includes(twin.id)) mum.children.push(twin.id);
    t.kill(baby, 'infancy');
    expect(t.camp.lived!.some((l) => l.kind === 'twins_bad')).toBe(true);
  });

  it('children are raised by everyone: a child grieves less for a parent and keeps belonging, and an orphan may teach it', () => {
    const s = band(1, ['raised_by_all']);
    const child = s.members().find((q) => s.age(q) < 12)!;
    const grown = adults(s)[0];
    expect(childGrief(s, child)).toBe(RAISED_GRIEF);
    expect(childBelong(s, child)).toBe(RAISED_BELONG);
    expect(childGrief(s, grown)).toBe(1);
    s.camp.ways = [];
    expect(childGrief(s, child)).toBe(1);
    // both parents dead: the band may come to raise its children together
    const mum = s.byId.get(child.mother), dad = s.byId.get(child.father);
    if (dad?.alive) s.kill(dad, 'fever');
    if (mum?.alive) s.kill(mum, 'fever');
    expect(s.camp.lived!.some((l) => l.kind === 'raised_by_all')).toBe(true);
  });

  it('a thief is cast out: someone greedy who steals in a hungry time and is caught is driven out, or else the band may come to it', () => {
    const s = band(1, ['thief_out']);
    const c = s.camp;
    c.rationing = true;
    c.stock.preserved = 100;
    const thief = adults(s)[0];
    thief.traits = ['greedy'];
    thief.food = 20;
    for (const q of adults(s)) if (q !== thief) q.traits = q.traits.filter((t) => t !== 'greedy');
    always(s);
    const exiled: Person[] = [];
    theftDaily(s, (p) => exiled.push(p));
    expect(thief.food).toBeGreaterThan(20);
    expect(c.stock.preserved).toBe(99);
    expect(exiled).toEqual([thief]);
    // without the custom: thought the less of, told in the chronicle, and the band may come to cast thieves out
    const t = band(1);
    const tc = t.camp;
    tc.rationing = true;
    tc.stock.preserved = 100;
    const th = adults(t)[0];
    th.traits = ['greedy'];
    th.food = 20;
    for (const q of adults(t)) if (q !== th) q.traits = q.traits.filter((x) => x !== 'greedy');
    const other = adults(t).find((q) => q !== th)!;
    const before = t.opinion(other, th);
    always(t);
    theftDaily(t, () => { throw new Error('not cast out without the custom'); });
    expect(t.opinion(other, th)).toBe(Math.max(-100, before - THEFT_SCORN));
    expect(t.events.at(-1)!.kind).toBe('theft');
    expect(tc.lived!.some((l) => l.kind === 'thief_out')).toBe(true);
    // and never in a time of plenty
    tc.rationing = false; tc.famine = false;
    th.food = 20;
    theftDaily(t, () => undefined);
    expect(th.food).toBe(20);
  });

  it('a thief cast out makes a camp of their own', () => {
    const s = band(1, ['thief_out', 'elders']);
    const c = s.camp;
    const [thief, by] = adults(s);
    (s as unknown as { exile(a: Person, v: Person, c: typeof s.camp, why: string): void }).exile(thief, by, c, 'thief');
    const nc = s.campById(thief.band)!;
    expect(nc).not.toBe(c);
    const e = s.events.filter((x) => x.kind === 'exile').at(-1)!;
    expect(e.text).toContain('stealing from the stores');
  });

  it('guests are fed first: those taken in are fed full, and think the better of the band', () => {
    const s = band(1, ['guests_first']);
    const c = s.camp;
    c.stock.preserved = 200;
    expect(guestFed(c)).toBe(GUEST_FED);
    const [guest, host] = adults(s);
    guest.food = 20;
    const before = s.opinion(guest, host);
    (s as unknown as { feedNewcomers(ms: Person[], to: typeof c): void }).feedNewcomers([guest], c);
    expect(guest.food).toBeGreaterThanOrEqual(GUEST_FED - 1e-6);
    expect(s.opinion(guest, host)).toBeGreaterThan(before);
    expect(s.events.at(-1)!.kind).toBe('way_habit');
    // (and no word of it when nobody needed feeding)
    const n = s.events.length;
    (s as unknown as { feedNewcomers(ms: Person[], to: typeof c): void }).feedNewcomers([guest], c);
    expect(s.events.length).toBe(n);
    c.ways = [];
    expect(guestFed(c)).toBe(0);
  });

  it('a sweat before the hunt: a skilled hunter goes to the lodge on any evening, and strikes the better after', () => {
    const s = band(1, ['sweat_hunt']);
    const p = adults(s)[0];
    p.skills[SK.hunt] = SWEAT_HUNTER;
    expect(sweatsToHunt(s, p)).toBe(true);
    p.skills[SK.hunt] = SWEAT_HUNTER - 1;
    expect(sweatsToHunt(s, p)).toBe(false);
    p.sweat = undefined;
    expect(sweatAim(s, p)).toBe(0);
    p.sweat = s.tick;
    expect(sweatAim(s, p)).toBe(SWEAT_AIM);
    s.camp.ways = [];
    expect(sweatAim(s, p)).toBe(0);
  });

  it('brides move to the man\'s band, or grooms to the woman\'s, by the custom of either band', () => {
    const s = band(1);
    const man = adults(s).find((q) => q.sex === 1)!, woman = adults(s).find((q) => q.sex === 0)!;
    expect(whoGoes(s, man, woman)).toBeNull();
    takeUp(s, s.camp, 'brides_go', 'for the test', null);
    expect(whoGoes(s, man, woman)).toEqual([woman, man]);
    expect(whoGoes(s, woman, man)).toEqual([woman, man]);
    takeUp(s, s.camp, 'grooms_go', 'for the test', null);
    expect(holds(s.camp, 'brides_go')).toBe(false);
    expect(whoGoes(s, man, woman)).toEqual([man, woman]);
    expect(whoGoes(s, man, adults(s).find((q) => q.sex === 1 && q !== man)!)).toBeNull();
  });

  it('every new custom can come with a founding band, from its leader\'s leanings', () => {
    const seen = new Set<WayKind>();
    for (const traits of [['pious', 'cautious'], ['kind', 'charismatic'], ['cruel'], ['brave', 'pious'], ['ambitious']]) {
      for (const sex of [0, 1]) {
        const s = sim(1);
        const c = s.camps[0];
        const leader = s.byId.get(c.leader)!;
        leader.traits = traits as Person['traits'];
        leader.sex = sex as Person['sex'];
        // (only what the leader leans to comes up)
        s.rWays = { chance: (p: number) => p >= FOUND_LEAN, next: () => 0.999, int: (a: number) => a } as unknown as Sim['rWays'];
        foundWays(s, c, leader);
        for (const w of c.ways!) seen.add(w.kind);
      }
    }
    for (const k of ['buried_things', 'first_salmon', 'white_deer', 'twins_bad', 'raised_by_all', 'thief_out', 'guests_first', 'sweat_hunt', 'brides_go', 'grooms_go'] as WayKind[])
      expect(seen.has(k), k).toBe(true);
    expect(WAY_KINDS.length).toBe(20);
  });
});
