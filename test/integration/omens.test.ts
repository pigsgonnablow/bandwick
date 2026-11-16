// Omens and superstitions: a band that sees something rare may take whatever follows for its meaning. The belief
// spreads, the band acts on it when the sign comes again, it fades if nothing proves it, and one long held and
// often proven hardens into a custom that the band keeps, and that a band splitting off takes with it.
import { describe, it, expect } from 'vitest';
import { Sim, SaveData } from '../../src/sim/sim';
import { TICKS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_HOUR, DAYS_PER_YEAR, dayOf, seasonOf } from '../../src/sim/time';
import { foodTotal } from '../../src/sim/band';
import {
  sight, omenOutcome, omenDaily, sheltering, sparesWhite, shunned, noPairing, whiteKilled, carryCustoms, loreSummary, beliefsOf, skyNow,
  midwinterOffering, Lore, HELD_SHARE, DOUBT_YEARS, CUSTOM_YEARS,
} from '../../src/sim/omen';
import { sim, runYears } from '../helpers';

/** Odds that always (or never) come up, for the omens' own stream. */
const always = (s: Sim, yes = true) => { s.rOmen = { chance: () => yes, next: () => (yes ? 0 : 0.999), int: (lo: number) => lo } as unknown as Sim['rOmen']; };
const grown = (s: Sim) => s.members().filter((q) => s.age(q) >= 14);
/** A band a few years on. */
const band = (seed = 1) => runYears(sim(seed), 3);
/** Everyone in the band sees a sign, and then someone dies: with the odds forced, the band takes the one for the other. */
function believeIn(s: Sim, sign: Parameters<typeof sight>[2] = 'eclipse') {
  always(s);
  sight(s, s.camp, sign, s.members());
  s.tick += 5;
  omenOutcome(s, 'death', [s.members()[0].id]);
  return s.camp.lore!.find((l) => l.sign === sign)!;
}
/** The band's daily upkeep of its beliefs, on an ordinary day of the year. */
const upkeep = (s: Sim, doy = 20) => omenDaily(s, doy);

describe('omens', () => {
  it('a sign followed by something that matters can take hold as a belief, the first of it in one mind', () => {
    const s = band();
    always(s, false);
    sight(s, s.camp, 'comet', s.members());
    s.tick += 5;
    omenOutcome(s, 'death', [s.members()[0].id]);
    // (with the odds against it, nobody makes anything of it, and the band stops watching)
    expect(s.camp.lore ?? []).toHaveLength(0);
    expect(s.camp.omen).toBeUndefined();
    const l = believeIn(s, 'comet');
    expect(l.key).toBe('comet:bad');
    expect(l.of).toBe('a death');
    const holders = s.members().filter((p) => p.beliefs?.includes('comet:bad'));
    expect(holders.length).toBeGreaterThan(0);
    expect(s.events.some((e) => e.kind === 'omen_belief')).toBe(true);
    expect(beliefsOf(s, holders[0])[0]).toBe('A star with a tail foretells a death');
  });

  it('what follows is only taken for the meaning while the band is still watching, and never the sign itself', () => {
    const s = band();
    always(s);
    sight(s, s.camp, 'comet', s.members());
    // the same tick: not yet
    omenOutcome(s, 'death', [s.members()[0].id]);
    expect(s.camp.lore ?? []).toHaveLength(0);
    // long after: too late
    s.tick += 30 * TICKS_PER_DAY;
    omenOutcome(s, 'death', [s.members()[0].id]);
    expect(s.camp.lore ?? []).toHaveLength(0);
    // and something that doesn't matter is let pass
    sight(s, s.camp, 'comet', s.members());
    s.tick += 5;
    omenOutcome(s, 'pairing', [s.members()[0].id]);
    expect(s.camp.lore ?? []).toHaveLength(0);
  });

  it('a good thing makes a good omen', () => {
    const s = band();
    always(s);
    sight(s, s.camp, 'white_deer', s.members());
    s.tick += 5;
    omenOutcome(s, 'great_hunt', [s.members()[0].id]);
    expect(s.camp.lore![0].key).toBe('white_deer:good');
    expect(s.camp.lore![0].good).toBe(true);
  });

  it('coming true again: it is proven, and those who saw it come round', () => {
    const s = band();
    const l = believeIn(s);
    // only one believes at first
    for (const p of s.members().slice(1)) delete p.beliefs;
    s.members()[0].beliefs = [l.key];
    sight(s, s.camp, 'eclipse', s.members());
    s.tick += 5;
    omenOutcome(s, 'death', [s.members()[0].id]);
    expect(l.proven).toBe(2);
    expect(s.members().filter((p) => p.beliefs?.includes(l.key)).length).toBeGreaterThan(1);
    expect(s.events.some((e) => e.kind === 'omen_true')).toBe(true);
  });

  it('once most of the grown-ups hold it, it is the band\'s; it stops being when few do, and is forgotten when none do', () => {
    const s = band();
    const l = believeIn(s);
    const g = grown(s);
    for (const p of s.members()) delete p.beliefs;
    for (const p of g.slice(0, Math.ceil(g.length * HELD_SHARE))) p.beliefs = [l.key];
    upkeep(s);
    expect(l.held).toBeDefined();
    expect(loreSummary(s, s.camp).beliefs[0].held).toBe(true);
    for (const p of g.slice(1)) delete p.beliefs;
    upkeep(s);
    expect(l.held).toBeUndefined();
    for (const p of s.members()) delete p.beliefs;
    upkeep(s);
    expect(s.camp.lore).toHaveLength(0);
  });

  it('believers leave their work and keep to the fire when a sign they fear comes again', () => {
    const s = band();
    const l = believeIn(s);
    const believer = s.members().find((p) => p.beliefs?.includes(l.key))!;
    const doubter = s.members().find((p) => !p.beliefs)!;
    if (doubter) expect(sheltering(s, doubter)).toBeNull();
    sight(s, s.camp, 'eclipse', s.members());
    expect(sheltering(s, believer)).toMatch(/fire/);
    if (doubter) expect(sheltering(s, doubter)).toBeNull();
    expect(believer.nextThink).toBe(s.tick);
    // and they do: the next time they think, they go to sit by the fire
    for (let i = 0; i < 3; i++) s.step();
    expect(believer.task?.kind === 'idle' || believer.task?.kind === 'sleep' || believer.task?.kind === 'eat').toBe(true);
    // once it passes, back to work
    s.tick += 3 * TICKS_PER_HOUR;
    expect(sheltering(s, believer)).toBeNull();
  });

  it('a band that holds an omen leaves food out when it comes again', () => {
    const s = band();
    const l = believeIn(s, 'comet');
    for (const p of grown(s)) p.beliefs = [l.key];
    upkeep(s);
    expect(l.held).toBeDefined();
    s.camp.stock.preserved += 20;
    const before = foodTotal(s.camp.stock);
    sight(s, s.camp, 'comet', s.members());
    expect(foodTotal(s.camp.stock)).toBeLessThan(before);
    expect(s.events.some((e) => e.kind === 'omen_habit' && /left food/.test(e.text))).toBe(true);
  });

  it('those who hold the white deer for a sign will not hunt it, and think less of whoever does', () => {
    const s = band();
    const l = believeIn(s, 'white_deer');
    const believer = s.members().find((p) => p.beliefs?.includes(l.key))!;
    const hunter = s.members().find((p) => !p.beliefs && s.age(p) >= 16) ?? s.members().find((p) => p !== believer)!;
    delete hunter.beliefs;
    expect(sparesWhite(s, believer)).toBe(true);
    expect(sparesWhite(s, hunter)).toBe(false);
    const before = s.opinion(believer, hunter);
    whiteKilled(s, hunter);
    expect(s.opinion(believer, hunter)).toBeLessThan(before);
  });

  it('those who hold a struck tree for a sign keep away from the wood by it', () => {
    const s = band();
    const c = s.camp;
    const at = c.tile + 3;
    always(s);
    sight(s, c, 'lightning', s.members(), at);
    s.tick += 5;
    omenOutcome(s, 'death', [s.members()[0].id]);
    const believer = s.members().find((p) => p.beliefs?.length)!;
    const x = (at % s.N) + 0.5, z = Math.floor(at / s.N) + 0.5;
    expect(shunned(s, believer, x, z)).toBe(true);
    expect(shunned(s, believer, x + 20, z)).toBe(false);
  });

  it('children take their parents\' beliefs; a belief nothing proves for a generation is let go', () => {
    const s = band();
    const l = believeIn(s);
    const child = s.members().find((p) => s.age(p) >= 6 && s.age(p) < 14 && s.byId.get(p.mother)?.alive);
    if (child) {
      delete child.beliefs;
      s.byId.get(child.mother)!.beliefs = [l.key];
      always(s);
      upkeep(s, 1);
      expect(child.beliefs).toContain(l.key);
    }
    l.lastTrue = s.tick - (DOUBT_YEARS + 1) * TICKS_PER_YEAR;
    for (const p of s.members()) if (!s.has(p, 'pious')) p.beliefs = [l.key];
    upkeep(s, 1);
    expect(s.members().filter((p) => !s.has(p, 'pious') && p.beliefs?.includes(l.key))).toHaveLength(0);
  });

  it('a belief long held and often proven hardens into a custom: a day of rest', () => {
    const s = band();
    const l = believeIn(s);
    for (const p of grown(s)) p.beliefs = [l.key];
    upkeep(s);
    l.held = s.tick - (CUSTOM_YEARS + 1) * TICKS_PER_YEAR;
    l.proven = 3;
    upkeep(s, 1);
    expect(s.camp.customs).toHaveLength(1);
    expect(s.camp.customs![0].kind).toBe('rest_day');
    expect(s.events.some((e) => e.kind === 'custom')).toBe(true);
    // on its day, everyone keeps to the fire, believer or not
    const p = s.members()[0];
    delete p.beliefs;
    const day = s.camp.customs![0].day!;
    s.tick = (dayOf(s.tick) - (dayOf(s.tick) % DAYS_PER_YEAR) + DAYS_PER_YEAR + day) * TICKS_PER_DAY + 6 * TICKS_PER_HOUR;
    omenDaily(s, day);
    expect(sheltering(s, p)).toMatch(/custom/);
    // a custom stays, even once nobody believes the omen any more
    for (const q of s.members()) delete q.beliefs;
    upkeep(s);
    expect(s.camp.customs).toHaveLength(1);
  });

  it('other customs: no partnering in a season, food at midwinter, a white deer never hunted', () => {
    const s = band();
    const c = s.camp;
    c.customs = [{ kind: 'no_pairing', from: 'hail:bad', since: s.tick, text: 'x', season: seasonOf(s.tick) }];
    expect(noPairing(s, c)).toBe(true);
    c.customs[0].season = (seasonOf(s.tick) + 1) % 4;
    expect(noPairing(s, c)).toBe(false);
    c.customs = [{ kind: 'offering', from: 'comet:bad', since: s.tick, text: 'x' }];
    c.stock.preserved += 20;
    const before = foodTotal(c.stock);
    midwinterOffering(s, c);
    expect(foodTotal(c.stock)).toBeLessThan(before);
    c.customs = [{ kind: 'spare_white', from: 'white_deer:bad', since: s.tick, text: 'x' }];
    const p = s.members()[0];
    delete p.beliefs;
    expect(sparesWhite(s, p)).toBe(true);
  });

  it('a band that splits off keeps the customs, and beliefs go wherever the people who hold them go', () => {
    const s = band();
    const l: Lore = believeIn(s);
    const c = s.camp;
    c.customs = [{ kind: 'rest_day', from: l.key, since: s.tick, text: 'No work is done on the day the sun went dark', day: 5 }];
    const other = { ...c, id: 999, lore: undefined, customs: undefined } as typeof c;
    carryCustoms(c, other);
    expect(other.customs).toEqual(c.customs);
    expect(other.customs).not.toBe(c.customs);
    // someone who believes it moves to a band that doesn't: their new band has the belief now
    s.camps.push(other);
    const p = s.members().find((q) => q.beliefs?.includes(l.key))!;
    p.band = other.id;
    upkeep(s);
    expect(other.lore?.map((x) => x.key)).toContain(l.key);
    expect(other.lore![0].held).toBeUndefined();
  });

  it('the sky: a sight comes for every band, shows while it lasts, and survives a save', () => {
    const s = band();
    s.sky = { kind: 'eclipse', from: s.tick + 1, until: s.tick + 15 };
    expect(skyNow(s)).toBeNull();
    s.step();
    s.step();
    expect(skyNow(s)).toBe('eclipse');
    const real = s.rOmen;
    const l = believeIn(s);
    s.rOmen = real;
    const t = new Sim(s.world, JSON.parse(JSON.stringify(s.serialize())) as SaveData);
    expect(t.sky).toEqual(s.sky);
    expect(t.camp.lore?.[0]).toEqual(l);
    expect(t.people.filter((p) => p.beliefs?.includes(l.key)).length).toBe(s.people.filter((p) => p.beliefs?.includes(l.key)).length);
  });
});
