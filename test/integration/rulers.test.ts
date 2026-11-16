// Rulers: most bands live loosely, but now and then someone the band looks up to takes hold of it. The builder
// sets the band to raising things that last; when they go, a grown child or someone of the same mind may take it
// up, or the band goes back to its loose ways; and a band that chafes under its ruler throws them off.
import { describe, it, expect } from 'vitest';
import { Person, Trait } from '../../src/sim/band';
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_YEAR } from '../../src/sim/time';
import {
  ruleDaily, rulerOf, standing, ruledDrive, ruledIdeas, ruleSummary, RISE_DAY, BUILDER_DRIVE, BUILDER_OWN_DRIVE, BUILDER_IDEAS, STRAIN_LIMIT,
} from '../../src/sim/rule';
import { sim, runYears } from '../helpers';

/** Odds that always (or never) come up, for the rulers' own stream. */
const always = (s: Sim, yes = true) => { s.rRule = { chance: () => yes, next: () => (yes ? 0 : 0.999) } as unknown as Sim['rRule']; };
const adults = (s: Sim) => s.members().filter((q) => s.age(q) >= 16);
const setTraits = (p: Person, t: Trait[]) => { p.traits = t.slice(); };

/** A band some years on, knowing huts, with nobody in it fit to rule. */
function band(seed = 1) {
  const s = runYears(sim(seed), 3);
  const c = s.camp;
  if (!c.knows.includes('huts')) c.knows.push('huts');
  for (const p of s.members()) p.traits = p.traits.filter((t) => t !== 'ambitious');
  return s;
}
/** Make someone of ruling age, ambitious, and the band's best thought of. */
function contender(s: Sim, traits: Trait[] = ['ambitious', 'industrious']) {
  const p = adults(s).filter((q) => s.age(q) >= 25 && s.age(q) <= 55).sort((a, b) => a.id - b.id)[0];
  setTraits(p, traits);
  p.health = 100;
  for (const q of adults(s)) {
    if (q === p) continue;
    s.adjust(q, p, 200);
    // (and everyone else thought less of)
    for (const o of adults(s)) if (o !== p && o !== q) s.adjust(q, o, -200);
  }
  return p;
}

describe('rulers', () => {
  it('most bands stay loose: nobody takes hold without someone ambitious the band looks up to', () => {
    const s = band();
    always(s);
    expect(s.members().length).toBeGreaterThanOrEqual(8);
    ruleDaily(s, RISE_DAY);
    expect(s.camp.rule).toBeUndefined();
    // and someone ambitious but cruel or greedy is not a builder
    contender(s, ['ambitious', 'cruel']);
    ruleDaily(s, RISE_DAY);
    expect(s.camp.rule).toBeUndefined();
  });

  it('an ambitious leader the band looks up to takes hold as a builder, in spring, by chance', () => {
    const s = band();
    const p = contender(s);
    always(s, false);
    ruleDaily(s, RISE_DAY);
    expect(s.camp.rule).toBeUndefined();
    always(s);
    ruleDaily(s, RISE_DAY + 1);
    expect(s.camp.rule).toBeUndefined();
    ruleDaily(s, RISE_DAY);
    expect(s.camp.rule).toMatchObject({ kind: 'builder', ruler: p.id });
    expect(rulerOf(s, s.camp)).toBe(p);
    expect(s.events.at(-1)!.kind).toBe('rule');
    expect(s.events.at(-1)!.text).toContain(`${p.name} took hold of ${s.camp.name}`);
    // the band panel and the person card say so
    expect(ruleSummary(s, s.camp)).toMatchObject({ label: 'builder', ruler: { id: p.id, name: p.name } });
    expect(s.inspect(p.id)!.rules).toBe(`rules ${s.camp.name} as its builder`);
    expect(s.summary().rule?.ruler.id).toBe(p.id);
  });

  it("a builder's band works harder, thinks of new ways to build sooner, and gives more to its monument", () => {
    const s = band();
    const p = contender(s);
    const q = adults(s).find((x) => x !== p)!;
    expect(ruledDrive(s, q)).toBe(1);
    expect(ruledIdeas(s.camp, 'build')).toBe(1);
    for (const k of ['preserving', 'storehouse', 'barrow']) if (!s.camp.knows.includes(k)) s.camp.knows.push(k);
    s.camp.stock.grain += 3000;
    s.camp.stock.preserved += 800;
    s.camp.stock.wood += 300;
    // (the first morning marks the mound out; the next gives the band's spare hours to it)
    s.plan();
    s.plan();
    const loose = s.camp.jobs.raise ?? 0;
    always(s);
    ruleDaily(s, RISE_DAY);
    expect(ruledDrive(s, q)).toBe(BUILDER_DRIVE);
    expect(ruledDrive(s, p)).toBe(BUILDER_OWN_DRIVE);
    expect(ruledIdeas(s.camp, 'build')).toBe(BUILDER_IDEAS);
    expect(ruledIdeas(s.camp, 'raise')).toBe(BUILDER_IDEAS);
    expect(ruledIdeas(s.camp, 'hunt')).toBe(1);
    s.plan();
    expect(loose).toBeGreaterThan(0);
    expect(s.camp.jobs.raise).toBeGreaterThan(loose);
  });

  it('a grown child takes up the rule when the ruler dies', () => {
    const s = band();
    const p = contender(s);
    always(s);
    ruleDaily(s, RISE_DAY);
    const kid = s.members().find((q) => q !== p && s.age(q) >= 18 && q.mother !== p.id && q.father !== p.id)!;
    if (p.sex) kid.father = p.id; else kid.mother = p.id;
    kid.health = 100;
    // (a child the band doesn't dislike)
    for (const q of adults(s)) if (q !== kid) s.adjust(q, kid, 100);
    s.kill(p, 'fever');
    ruleDaily(s, RISE_DAY + 3);
    expect(s.camp.rule?.ruler).toBe(kid.id);
    expect(s.events.at(-1)!.text).toContain(`${kid.name} took up the rule of ${s.camp.name}`);
  });

  it('with no heir and nobody of the same mind, the band goes back to its loose ways', () => {
    const s = band();
    const p = contender(s);
    always(s);
    ruleDaily(s, RISE_DAY);
    for (const q of s.members()) if (q.mother === p.id || q.father === p.id) q.health = 10;
    s.kill(p, 'fever');
    ruleDaily(s, RISE_DAY + 3);
    expect(s.camp.rule).toBeUndefined();
    expect(s.events.at(-1)!.kind).toBe('rule_end');
    expect(s.summary().rule).toBeNull();
  });

  it('a band that chafes under its ruler throws them off, and does not take them back', () => {
    const s = band();
    const p = contender(s);
    always(s);
    ruleDaily(s, RISE_DAY);
    // the lazy chafe at the pace: strain builds up day by day
    for (const q of adults(s)) if (q !== p && q.partner !== p.id) setTraits(q, ['lazy']);
    for (let d = 0; d < 6; d++) ruleDaily(s, 13 + d);
    expect(s.camp.rule!.strain).toBeGreaterThan(3);
    // not enough yet: the seasonal reckoning passes
    ruleDaily(s, 19);
    expect(s.camp.rule).toBeDefined();
    s.camp.rule!.strain = STRAIN_LIMIT + 5;
    ruleDaily(s, 19);
    expect(s.camp.rule).toBeUndefined();
    expect(s.camp.deposed).toContain(p.id);
    const e = s.events.at(-1)!;
    expect(e.kind).toBe('rule_end');
    expect(e.text).toContain(`would no longer do as ${p.name} said`);
    expect(p.memories.some((m) => m.kind === 'overthrown')).toBe(true);
    // however well thought of, they don't get to rule it again
    for (const q of adults(s)) if (q !== p) s.adjust(q, p, 200);
    expect(standing(s, s.camp, p)).toBeGreaterThan(50);
    ruleDaily(s, RISE_DAY);
    expect(s.camp.rule).toBeUndefined();
  });

  it('a ruler leads their band when it moves camp, and still rules it there', () => {
    const s = band();
    const p = contender(s);
    always(s);
    ruleDaily(s, RISE_DAY);
    const before = s.camp;
    before.leanWinters = 5;
    before.settled = s.tick - TICKS_PER_YEAR * 5;
    // (a hard year with the wood gone, so the band gives up the camp)
    const moved = (s as unknown as { considerMove(c: unknown): boolean });
    before.lastFamine = s.tick;
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) ok = moved.considerMove(before);
    expect(ok).toBe(true);
    const nc = s.campOf(p);
    expect(nc).not.toBe(before);
    expect(nc.rule?.ruler).toBe(p.id);
    expect(nc.leader).toBe(p.id);
  });

  it('keeps its own odds: a world where nobody ever rules runs as before', () => {
    // (the rulers draw from a stream of their own, so the others are untouched until a ruler changes something)
    const a = runYears(sim(2), 1), b = sim(2);
    always(b, false);
    runYears(b, 1);
    expect(b.historyHash()).toBe(a.historyHash());
  });
});
