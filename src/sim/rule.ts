// Rulers. Most bands live loosely: whoever led them to their camp is remembered for it, but nobody gives
// orders, and each person decides their own day from what they need and what the band is short of. Now and
// then someone the band looks up to takes hold of it, and the band takes on that person's character for as
// long as they rule. When the ruler dies or leaves, a grown child may take up the rule, or someone else of
// the same mind, or the band goes back to its loose ways; and a band that has come to resent its ruler can
// throw them off.
//
// There is one kind of ruler so far, the builder: an ambitious leader who sets the band to raising things
// that last. Its band works harder, gives more of its spare days to its monuments, builds in lasting walls,
// thinks of new ways to build sooner, and holds together rather than splitting. The lazy chafe at the pace,
// and everyone does when they go hungry or unhappy while the stones go up.
import type { Sim, Camp } from './sim';
import type { Person } from './band';
import { TICKS_PER_YEAR, yearOf } from './time';
import type { Practice } from './know';

export type RuleKind = 'builder';
export interface Rule {
  kind: RuleKind;
  /** who rules */
  ruler: number;
  /** the tick their rule began (a successor's rule begins anew) */
  since: number;
  /** how much the band chafes under it: grows on hungry and unhappy days and with the lazy driven to work, fades with time */
  strain?: number;
}

/** What each kind of ruler is called, and who has it in them to be one. */
export const RULERS: Record<RuleKind, { label: string; suits: (s: Sim, p: Person) => boolean }> = {
  // ambitious, and neither cruel nor greedy: those make other kinds of ruler, still to come
  builder: { label: 'builder', suits: (s, p) => s.has(p, 'ambitious') && !s.has(p, 'cruel') && !s.has(p, 'greedy') },
};

/**
 * The high seat at the head of a longhouse. Someone looked up to in a band that sits together under one roof is
 * likelier to take hold of it (HALL_RISE); and a ruler who feasts the band in the hall from the high seat on the
 * longest night eases its strain under them (to HALL_EASE of what it was).
 */
export const HALL_RISE = 1.5;
export const HALL_EASE = 0.7;

/** How often a band that comes over the hills (the first, or strangers) is led by a woman rather than a man. */
export const WOMAN_LEADS = 0.3;
/** The day of the year (spring) a loose band may come under a ruler. */
export const RISE_DAY = 8;
/** The chance a year that someone fit to rule, and looked up to, takes hold. */
export const RISE_CHANCE = 0.08;
/** How well the band has to think of them, on average, to follow them. */
export const RISE_STANDING = 25;
/** And they must be among the band's best thought of: no more than this many grown-ups stand higher. */
export const RISE_RANK = 0.25;
/** How old a ruler can be when they take hold. */
export const RISE_AGE: [number, number] = [25, 60];
/** A band has to be at least this big to need ruling. */
export const RISE_PEOPLE = 8;
/** A grown child of the ruler who isn't of the same mind takes up the rule anyway this often, having been raised to it. */
export const HEIR_CHANCE = 0.5;
/** With no heir, someone else fit to rule and looked up to takes it up this often. */
export const SUCCEED_CHANCE = 0.35;

/** Everyone works this much harder in a builder's band; the builder more. */
export const BUILDER_DRIVE = 1.12;
export const BUILDER_OWN_DRIVE = 1.2;
/** A builder's band gives this much more of its spare days to its monument, and starts on it while a little less comfortable. */
export const BUILDER_RAISE = 1.6;
/** Ideas that come at building work come this much sooner in a builder's band. */
export const BUILDER_IDEAS = 1.6;
const BUILD_WORK: ReadonlySet<Practice> = new Set<Practice>(['build', 'build_poles', 'leanto', 'raise', 'haul_logs', 'dig_hand', 'dig_stick', 'knap']);
/** How much likelier a builder's band is to stay together than to split, when it is time to think of it. */
export const BUILDER_SPLIT = 0.5;
/** A builder pleased with lasting walls: stone most, then split planks and daub. */
export const BUILDER_WALLS: Record<string, number> = { stone: 0.35, plank: 0.2, daub: 0.15, wood: -0.1 };
/** The band's regard for a builder who sees a monument finished, and how much of its strain that lifts. */
export const MONUMENT_PRIDE = 8;
export const MONUMENT_EASE = 0.5;
/**
 * The band's strain under its ruler: each day, for each grown-up (the ruler's own household aside), this much
 * for the lazy driven to work, for a day of famine (half on a day of short shares), and for an unhappy one;
 * the sum shared out over the grown-ups, so it is the share of the band chafing. It fades by STRAIN_FADE a day,
 * so it settles at a hundred times that share.
 */
export const STRAIN_LAZY = 1;
export const STRAIN_HUNGRY = 1;
export const STRAIN_UNHAPPY = 1;
export const UNHAPPY_MOOD = 40;
export const STRAIN_FADE = 0.99;
/** Strain past this, and the band may throw its ruler off; a ruler the band loves holds on longer. */
export const STRAIN_LIMIT = 25;
export const LOVED = 90;
/** The chance each season, once past the limit, that the band throws its ruler off (halved for one it loves). */
export const OVERTHROW_CHANCE = 0.4;

const he = (p: Person) => (p.sex ? 'he' : 'she');
const his = (p: Person) => (p.sex ? 'his' : 'her');

/** The band's ruler, while it has one living among it. */
export function rulerOf(s: Sim, c: Camp): Person | null {
  if (!c.rule) return null;
  const p = s.byId.get(c.rule.ruler);
  return p && p.alive && p.band === c.id ? p : null;
}
/**
 * Who sits in the high seat of a band's longhouse: its ruler, or failing one the one who led the band to its camp,
 * while they are still alive and among it.
 */
export function seatHolder(s: Sim, c: Camp): Person | null {
  const ruler = rulerOf(s, c);
  if (ruler) return ruler;
  const p = s.byId.get(c.leader);
  return p && p.alive && p.band === c.id ? p : null;
}
/** Whether a band lives under a builder. */
export function builderBand(c: Camp | undefined) {
  return c?.rule?.kind === 'builder';
}

/** How well the other grown-ups of a band think of someone, on average. */
export function standing(s: Sim, c: Camp, p: Person) {
  let sum = 0, n = 0;
  for (const q of s.members(c)) {
    if (q === p || s.age(q) < 16) continue;
    sum += s.opinion(q, p);
    n++;
  }
  return n ? sum / n : 0;
}

/** Who has it in them to rule a band, and is looked up to enough to: among the band's best thought of. */
function contender(s: Sim, c: Camp, kind: RuleKind): Person | null {
  const adults = s.members(c).filter((p) => s.age(p) >= 16);
  const st = new Map(adults.map((p) => [p, standing(s, c, p)]));
  let best: Person | null = null, bestS = RISE_STANDING;
  for (const p of adults) {
    const age = s.age(p), mine = st.get(p)!;
    // (one the band has thrown off doesn't get to rule it again)
    if (age < RISE_AGE[0] || age > RISE_AGE[1] || p.health < 40 || !RULERS[kind].suits(s, p) || mine <= bestS || c.deposed?.includes(p.id)) continue;
    const above = adults.filter((q) => st.get(q)! > mine).length;
    if (above > adults.length * RISE_RANK) continue;
    best = p;
    bestS = mine;
  }
  return best;
}

function take(s: Sim, c: Camp, p: Person, kind: RuleKind, after?: Person) {
  c.rule = { kind, ruler: p.id, since: s.tick };
  s.remember(p, 'rules', 15, 6, -1, after ? `Took up the rule of ${c.name} after ${after.name}.` : `Took hold of ${c.name}, and set the band to building.`);
  for (const q of s.members(c)) if (q !== p && s.age(q) >= 14) s.remember(q, 'ruled', 0, 2, p.id, `${p.name} took hold of the band.`);
}

/** A loose band may come under someone who has it in them to rule (once a year, in spring). */
function rise(s: Sim, c: Camp) {
  const ms = s.members(c);
  if (ms.length < RISE_PEOPLE || s.tick - c.founded < TICKS_PER_YEAR * 2 || !c.knows.includes('huts')) return;
  const p = contender(s, c, 'builder');
  if (!p || !s.rRule.chance(RISE_CHANCE * (s.hallOf(c) ? HALL_RISE : 1))) return;
  take(s, c, p, 'builder');
  s.event('rule', `${p.name} took hold of ${c.name}. A builder, ${he(p)} set the band to raising things that would last, and the others did as ${he(p)} said.`, [p.id], p.x, p.z, 4);
}

/** The ruler is dead, or gone from the band: a grown child, or someone else of the same mind, takes it up, or the band goes back to its old ways. */
function succeed(s: Sim, c: Camp) {
  const rule = c.rule!;
  const old = s.byId.get(rule.ruler);
  const gone = old ? (old.alive ? `With ${old.name} gone from ${c.name}` : `With ${old.name} dead`) : 'With their ruler gone';
  // a grown child the band doesn't dislike: of the same mind, or raised to it
  const heir = old ? s.members(c).filter((q) => (q.mother === old.id || q.father === old.id) && s.age(q) >= 18 && q.health >= 40 && standing(s, c, q) >= 0)
    .sort((a, b) => a.birth - b.birth || a.id - b.id)[0] : undefined;
  if (heir && (RULERS[rule.kind].suits(s, heir) || s.rRule.chance(HEIR_CHANCE))) {
    take(s, c, heir, rule.kind, old);
    s.event('rule', `${gone}, ${his(old!)} ${heir.sex ? 'son' : 'daughter'} ${heir.name} took up the rule of ${c.name}.`, [heir.id], heir.x, heir.z, 4);
    return;
  }
  const next = contender(s, c, rule.kind);
  if (next && s.rRule.chance(SUCCEED_CHANCE)) {
    take(s, c, next, rule.kind, old);
    s.event('rule', `${gone}, ${next.name} took up the rule of ${c.name}, and kept the band building.`, [next.id], next.x, next.z, 4);
    return;
  }
  delete c.rule;
  s.event('rule_end', `${gone}, nobody took up the rule of ${c.name}. The band went back to its loose ways.`, old ? [old.id] : [], c.x, c.z, 3);
}

/** The band chafes under its ruler: the lazy driven to work, hungry days, unhappy ones. */
function chafe(s: Sim, c: Camp, p: Person) {
  const mine = s.household(p);
  let sum = 0, n = 0;
  for (const q of s.members(c)) {
    if (s.age(q) < 16 || mine.includes(q)) continue;
    n++;
    if (s.has(q, 'lazy')) sum += STRAIN_LAZY;
    if (c.famine) sum += STRAIN_HUNGRY;
    else if (c.rationing) sum += STRAIN_HUNGRY * 0.5;
    if (q.mood < UNHAPPY_MOOD) sum += STRAIN_UNHAPPY;
  }
  c.rule!.strain = (c.rule!.strain ?? 0) * STRAIN_FADE + (n ? sum / n : 0);
}

/** A band that has come to chafe under its ruler throws them off: those who think least of them lead it. */
function overthrow(s: Sim, c: Camp, p: Person) {
  if ((c.rule!.strain ?? 0) < STRAIN_LIMIT) return;
  const mine = s.household(p);
  const adults = s.members(c).filter((q) => s.age(q) >= 16 && !mine.includes(q));
  if (adults.length < 3) return;
  const loved = standing(s, c, p) >= LOVED;
  if (!s.rRule.chance(OVERTHROW_CHANCE * (loved ? 0.5 : 1))) return;
  const hungry = c.famine || (c.lastFamine ?? -1e9) > s.tick - TICKS_PER_YEAR;
  // (the lazy and the unhappy first, then whoever thinks least of them)
  const fed = (q: Person) => (s.has(q, 'lazy') ? -100 : 0) + (q.mood < UNHAPPY_MOOD ? -50 : 0) + s.opinion(q, p);
  const resent = adults.slice().sort((a, b) => fed(a) - fed(b) || a.id - b.id).slice(0, Math.max(1, Math.ceil(adults.length / 3)));
  const years = Math.max(1, Math.round((s.tick - c.rule!.since) / TICKS_PER_YEAR));
  delete c.rule;
  (c.deposed ??= []).push(p.id);
  s.remember(p, 'overthrown', -25, 5, -1, `Was thrown off by the people of ${c.name}, after ruling them ${years === 1 ? 'a year' : `${years} years`}.`);
  for (const q of adults) s.adjust(p, q, resent.includes(q) ? -15 : -5);
  for (const q of resent) s.remember(q, 'threw_off', 8, 2, p.id, `Stood against ${p.name}, and would not be driven any more.`);
  const why = hungry ? `hungry while the work went on` : `tired of being driven`;
  s.event('rule_end', `The people of ${c.name}, ${why}, would no longer do as ${p.name} said. ${cap(he(p))} ruled them no more, and the band went back to its loose ways.`,
    [p.id, ...resent.slice(0, 5).map((q) => q.id)], p.x, p.z, 4);
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/**
 * Each day: a ruler gone is succeeded, and the band chafes, or not, under one still ruling; and once a season,
 * a band that chafes enough may throw its ruler off. Once a year, in spring, a loose band may
 * come under a ruler.
 */
export function ruleDaily(s: Sim, dayOfYear: number) {
  for (const c of s.liveCamps()) {
    if (!c.rule) {
      if (dayOfYear === RISE_DAY) rise(s, c);
      continue;
    }
    const p = rulerOf(s, c);
    if (!p) { succeed(s, c); continue; }
    chafe(s, c, p);
    if (dayOfYear % 12 === 7) overthrow(s, c, p);
  }
}

/** How much harder someone works under their band's ruler. */
export function ruledDrive(s: Sim, p: Person) {
  const c = s.campById(p.band);
  if (!builderBand(c)) return 1;
  return c!.rule!.ruler === p.id ? BUILDER_OWN_DRIVE : BUILDER_DRIVE;
}

/** How much sooner an idea comes at this work, under the band's ruler. */
export function ruledIdeas(c: Camp, what: Practice) {
  return builderBand(c) && BUILD_WORK.has(what) ? BUILDER_IDEAS : 1;
}

/** A monument finished under a builder: the band is proud of them for it. */
export function monumentRaised(s: Sim, c: Camp) {
  const p = rulerOf(s, c);
  if (!p || !builderBand(c)) return;
  for (const q of s.members(c)) if (q !== p) s.adjust(q, p, MONUMENT_PRIDE);
  c.rule!.strain = (c.rule!.strain ?? 0) * MONUMENT_EASE;
  s.remember(p, 'raised', 20, 6, -1, `Saw the band raise a monument under ${his(p)} rule.`);
}

/** The ruler feasted the band from the high seat of its longhouse: the band chafes the less under them. */
export function heldFeast(s: Sim, c: Camp, p: Person) {
  if (!c.rule || rulerOf(s, c) !== p) return;
  c.rule.strain = (c.rule.strain ?? 0) * HALL_EASE;
}

/** "Ruled by Ada, a builder, since year 12", for the band panel and the person card. */
export function ruleSummary(s: Sim, c: Camp) {
  const p = rulerOf(s, c);
  if (!p) return null;
  return { kind: c.rule!.kind, label: RULERS[c.rule!.kind].label, ruler: { id: p.id, name: p.name }, since: yearOf(c.rule!.since) };
}
