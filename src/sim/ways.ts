// Customs: the ways a band lives by. Every band has a few, and they are not beliefs about the signs (those are in
// omen.ts) but rules about how people treat one another: whether the meat is shared out equally or the hunter keeps
// the best of it; whether newcomers are welcomed in or held at arm's length; whether a widow may take another
// partner; who may lead the band; whether the elders have the last word; whether a braggart is mocked down to size;
// whether blood may be spilt at the midwinter feast.
//
// A band that comes over the hills brings its ways with it, the ones its leader and its elder hold to. Others come
// of what the band lives through: a hungry year teaches it to share the meat, a newcomer who killed one of them
// teaches it to keep newcomers at arm's length, a ruler thrown off teaches it to mock the ambitious, a killing
// at the feast teaches it that nobody may spill blood there. A band that splits takes most of its ways with it,
// and drops some; its new leader may bring one of their own. So neighbouring bands, born of the same first band,
// drift apart in how they live. Each custom changes what people do:
//
//   Meat shared equally       a deer brought home is shared out: the band feels the closer for it, and thinks the
//                             better of the hunter.
//   The hunter keeps the best the hunter eats the best of it and is proud of it, and the band's hunters go out
//                             more often.
//   Newcomers welcome         a band in need is taken in readily, and someone who marries in is soon one of the band.
//   Newcomers kept at arm's   a starving band is seldom taken in, someone who marries in feels an outsider for a
//   length                    year or two, and young people pair off with other bands less often.
//   Widows do not remarry     a woman whose partner has died takes no other.
//   Only men lead / only      nobody of the other sex founds a band, takes hold of one or takes up its rule, or
//   women lead                leads a group away to found a new camp.
//   The elders' word is final quarrels are settled by the elders before they come to blows, and no one younger
//                             than ELDER_RULE takes hold of the band.
//   Braggarts are mocked      the ambitious are mocked down to size, and someone seldom takes hold of the band.
//   No blood at the feast     on the longest night old quarrels are put aside, and nobody comes to blows in the
//                             days around it.
import type { Sim, Camp } from './sim';
import type { Person } from './band';
import { TICKS_PER_DAY, TICKS_PER_YEAR, yearOf } from './time';

export type WayKind = 'share_meat' | 'hunter_best' | 'welcome' | 'wary' | 'widows' | 'men_lead' | 'women_lead' | 'elders' | 'humble' | 'feast_peace';

/** A custom the band lives by. */
export interface Way {
  kind: WayKind;
  /** the tick it was taken up (a daughter band keeps the date its parent took it up) */
  since: number;
  /** how it came about, for the band panel ("brought over the hills", "after the hungry year of 12") */
  why: string;
}

export const WAYS: Record<WayKind, { text: string; took: string; against?: WayKind }> = {
  share_meat: { text: 'Meat is shared out equally', took: 'From now on the meat is shared out equally, whoever brings it home', against: 'hunter_best' },
  hunter_best: { text: 'The hunter keeps the best of the kill', took: 'From now on whoever makes a kill keeps the best of it', against: 'share_meat' },
  welcome: { text: 'Newcomers are made welcome', took: 'From now on newcomers are made welcome', against: 'wary' },
  wary: { text: 'Newcomers are kept at arm\'s length', took: 'From now on newcomers are kept at arm\'s length', against: 'welcome' },
  widows: { text: 'A widow does not take another partner', took: 'From now on a widow takes no other partner' },
  men_lead: { text: 'Only a man may lead the band', took: 'From now on only a man may lead the band', against: 'women_lead' },
  women_lead: { text: 'Only a woman may lead the band', took: 'From now on only a woman may lead the band', against: 'men_lead' },
  elders: { text: 'The elders\' word is final', took: 'From now on the elders have the last word' },
  humble: { text: 'Braggarts are mocked down to size', took: 'From now on anyone who puts on airs is mocked down to size' },
  feast_peace: { text: 'No blood is spilt at the feast', took: 'From now on no blood may be spilt at the midwinter feast' },
};
export const WAY_KINDS = Object.keys(WAYS) as WayKind[];

/** How readily a band founded by someone takes up a custom from their own character (and its elder's age). */
export const FOUND_LEAN = 0.55;
/** And the chance of each custom with nothing in the founder's character for or against it. */
export const FOUND_PLAIN = 0.12;
/** The chance a daughter band keeps each of its parent's customs (otherwise it drops it), and that its leader brings one of their own. */
export const SPLIT_KEEP = 0.75;
export const SPLIT_OWN = 0.35;
/** The chance a year that what a band has lived through hardens into a custom (for each thing it has lived through). */
export const LIVED_CHANCE = 0.3;
/** How far back what the band lived through still counts. */
export const LIVED_YEARS = 2;
/** The day of the year (late summer, after the year's troubles) a band may take up a custom from what it lived through. */
export const WAY_DAY = 30;
/** A hunter with this many kills is a great one; a band this share of whose grown-ups are pious is a devout one. */
export const GREAT_HUNTER = 15;
export const DEVOUT = 0.5;

/** Meat shared out: each member of the band at home feels this much closer for it, and thinks this much better of the hunter. */
export const SHARE_BELONG = 1.5;
export const SHARE_THANKS = 0.6;
/** The hunter who keeps the best: eats this much of it, and hunts this much more readily. */
export const BEST_CUT = 22;
/** How much hunger one meal's worth of food takes away. */
const MEAL = 48;
export const BEST_DRIVE = 1.15;
/** Newcomers welcome: a starving band is taken in this much more readily; someone marrying in is thought this much better of. */
export const WELCOME_TAKE = 0.25;
export const WELCOME_WARM = 10;
/** Newcomers kept at arm's length: taken in this much less readily (as a share), matches made this much less often,
 * and someone marrying in thought this much less of, and feeling an outsider for ARMS_YEARS. */
export const WARY_TAKE = 0.35;
export const WARY_MATCH = 0.5;
export const WARY_COLD = 10;
export const ARMS_YEARS = 2;
export const ARMS_BELONG = 0.5;
/** The elders' word: how old an elder is, how much less often a quarrel comes to blows while one lives, and the youngest who may take hold of the band. */
export const ELDER_AGE = 50;
export const ELDER_SETTLE = 0.4;
export const ELDER_RULE = 40;
/** Braggarts mocked: how much less often anyone takes hold of the band, and how much the band thinks less of the ambitious each year. */
export const HUMBLE_RISE = 0.35;
export const HUMBLE_MOCK = 6;
export const HUMBLE_FLOOR = 10;
/** No blood at the feast: how many days either side of the longest night nobody comes to blows, and how much old enemies make up. */
export const FEAST_DAYS = 3;
export const FEAST_MEND = 10;

const his = (p: Person) => (p.sex ? 'his' : 'her');

/** Whether a band lives by a custom. */
export function holds(c: Camp | undefined, k: WayKind) {
  return !!c?.ways?.some((w) => w.kind === k);
}
export function holdsP(s: Sim, p: Person, k: WayKind) {
  return holds(s.campById(p.band), k);
}

/** A band takes up a custom (dropping any it had against it). */
export function takeUp(s: Sim, c: Camp, k: WayKind, why: string, tell: string | null) {
  if (holds(c, k)) return false;
  const against = WAYS[k].against;
  c.ways = (c.ways ?? []).filter((w) => w.kind !== against);
  c.ways.push({ kind: k, since: s.tick, why });
  if (tell) s.event('way', `${tell} ${WAYS[k].took.charAt(0).toLowerCase()}${WAYS[k].took.slice(1)} at ${c.name}.`, [], c.x, c.z, 3);
  return true;
}

/** What someone's character leans them to (for a founder bringing their ways, or a leader bringing one to a new band). */
function leanings(s: Sim, p: Person, elder?: Person): WayKind[] {
  const out: WayKind[] = [];
  if (s.has(p, 'kind') && !s.has(p, 'greedy')) out.push('share_meat');
  if (s.has(p, 'greedy') || (s.has(p, 'ambitious') && !s.has(p, 'kind'))) out.push('hunter_best');
  if (s.has(p, 'charismatic') || (s.has(p, 'kind') && !s.has(p, 'cautious'))) out.push('welcome');
  if (s.has(p, 'cautious') || s.has(p, 'cruel')) out.push('wary');
  if (s.has(p, 'pious')) out.push('widows');
  if ((s.has(p, 'ambitious') || s.has(p, 'brave')) && !s.has(p, 'kind')) out.push(p.sex ? 'men_lead' : 'women_lead');
  if (elder && elder.alive && s.age(elder) >= ELDER_AGE) out.push('elders');
  if (s.has(p, 'kind') && !s.has(p, 'ambitious')) out.push('humble');
  if (s.has(p, 'pious') || s.has(p, 'kind')) out.push('feast_peace');
  return out;
}

/** A band come over the hills brings its ways: the ones its leader leans to, and now and then others. */
export function foundWays(s: Sim, c: Camp, leader: Person, elder?: Person) {
  const r = s.rWays;
  const lean = new Set(leanings(s, leader, elder));
  c.ways = [];
  for (const k of WAY_KINDS) {
    const roll = r.chance(lean.has(k) ? FOUND_LEAN : FOUND_PLAIN);
    // (only one of each pair, and a band led by someone wouldn't hold that only the other sex leads)
    const against = WAYS[k].against;
    if (!roll || (against && holds(c, against)) || (k === 'men_lead' && !leader.sex) || (k === 'women_lead' && leader.sex)) continue;
    takeUp(s, c, k, 'brought over the hills', null);
  }
}

/** A band splits: the daughter keeps most of its parent's customs and drops the rest, and its leader may bring one of their own. */
export function carryWays(s: Sim, from: Camp, to: Camp, leader: Person) {
  const r = s.rWays;
  to.ways = [];
  const dropped: WayKind[] = [];
  for (const w of from.ways ?? []) {
    // (a band led away by a woman doesn't keep that only men may lead, nor the other way about)
    const barred = (w.kind === 'men_lead' && !leader.sex) || (w.kind === 'women_lead' && leader.sex);
    if (!barred && r.chance(SPLIT_KEEP)) to.ways.push({ ...w });
    else dropped.push(w.kind);
  }
  const own = leanings(s, leader).filter((k) => !holds(to, k) && !dropped.includes(k) && !holds(to, WAYS[k].against ?? k));
  const brought = own.length && r.chance(SPLIT_OWN) ? own[r.int(0, own.length)] : null;
  if (brought) takeUp(s, to, brought, `brought by ${leader.name}`, null);
  if (dropped.length || brought) {
    const low = (k: WayKind) => `${WAYS[k].text.charAt(0).toLowerCase()}${WAYS[k].text.slice(1)}`;
    const left = dropped.length ? `At ${to.name} they left behind the custom${dropped.length > 1 ? 's' : ''} of ${from.name} (${dropped.map(low).join('; ')})` : '';
    const own = brought ? `${leader.name} made it ${his(leader)} band's way that ${low(brought)}` : '';
    s.event('way_drift', left && own ? `${left}, and ${own}.` : left ? `${left}.` : `At ${to.name}, ${own}.`, [leader.id], to.x, to.z, 2);
  }
}

/** Whether someone may lead a band (found it, rule it, lead a group away), by its customs. */
export function mayLead(c: Camp | undefined, p: Person) {
  if (holds(c, 'men_lead')) return p.sex === 1;
  if (holds(c, 'women_lead')) return p.sex === 0;
  return true;
}

/** Whether someone may take a partner, by their band's customs (a widow may not, where the custom forbids it). */
export function mayPair(s: Sim, p: Person) {
  return !(p.sex === 0 && p.widowed !== undefined && holdsP(s, p, 'widows'));
}

/** A deer brought home: shared out equally, or the best of it kept by the hunter. */
export function meatHome(s: Sim, p: Person) {
  const c = s.campById(p.band);
  if (holds(c, 'share_meat')) {
    for (const q of s.members(c!)) {
      if (q === p) continue;
      q.belonging = Math.min(100, q.belonging + SHARE_BELONG);
      s.adjust(q, p, SHARE_THANKS);
    }
    s.book('way.shared', 1, c!);
  } else if (holds(c, 'hunter_best')) {
    p.food = Math.min(100, p.food + BEST_CUT);
    // (out of the meat brought home: a meal's worth of food is about MEAL of it)
    c!.stock.meat -= BEST_CUT / MEAL;
    s.book('eaten.meat', BEST_CUT / MEAL, c!);
    if (!p.memories.some((m) => m.kind === 'best_cut' && m.tick > s.tick - TICKS_PER_DAY * 12)) s.remember(p, 'best_cut', 4, 0.3, -1, 'Ate the best of the kill, as is the hunter\'s due.');
    s.book('way.kept', 1, c!);
  }
}

/** How much more readily someone goes hunting, by their band's customs. */
export function huntDrive(c: Camp | undefined) {
  return holds(c, 'hunter_best') ? BEST_DRIVE : 1;
}

/** How readily a band takes in a starving neighbour, by its customs: [added, multiplied]. */
export function takeInChance(to: Camp, chance: number) {
  if (holds(to, 'welcome')) return chance + WELCOME_TAKE;
  if (holds(to, 'wary')) return chance * WARY_TAKE;
  return chance;
}

/** How often young people of two bands pair off, by their customs (either band keeping newcomers at arm's length makes it rarer). */
export function matchChance(a: Camp, b: Camp, chance: number) {
  return holds(a, 'wary') || holds(b, 'wary') ? chance * WARY_MATCH : chance;
}

/** Someone has come to live in a band (married in, or taken in): welcomed, or held at arm's length. */
export function newcomer(s: Sim, p: Person, to: Camp) {
  p.joined = s.tick;
  if (holds(to, 'welcome')) for (const m of s.members(to)) if (m !== p) s.adjust(m, p, WELCOME_WARM);
  if (holds(to, 'wary')) {
    for (const m of s.members(to)) if (m !== p && !s.isKin(m, p) && m.id !== p.partner) s.adjust(m, p, -WARY_COLD);
    if (s.age(p) >= 14) s.remember(p, 'arms_length', -8, ARMS_YEARS, -1, `Is still a newcomer at ${to.name}, kept at arm's length.`);
  }
}

/** How much less someone feels part of the band, as a newcomer kept at arm's length. */
export function belongingKept(s: Sim, p: Person) {
  return p.joined !== undefined && s.tick - p.joined < ARMS_YEARS * TICKS_PER_YEAR && holdsP(s, p, 'wary') ? ARMS_BELONG : 1;
}

/** How likely a quarrel in a band is to come to blows today: the elders settle it, and nobody spills blood at the feast. */
export function quarrelChance(s: Sim, c: Camp, dayOfYear: number, midwinter: number, chance: number) {
  if (holds(c, 'feast_peace') && Math.abs(dayOfYear - midwinter) <= FEAST_DAYS) return 0;
  if (holds(c, 'elders') && s.members(c).some((q) => s.age(q) >= ELDER_AGE && q.health > 30)) return chance * ELDER_SETTLE;
  return chance;
}

/** How likely someone is to take hold of a band, by its customs; and whether this person may. */
export function riseChance(c: Camp, chance: number) {
  return holds(c, 'humble') ? chance * HUMBLE_RISE : chance;
}
export function mayRule(s: Sim, c: Camp, p: Person) {
  return mayLead(c, p) && (!holds(c, 'elders') || s.age(p) >= ELDER_RULE);
}

/** On the longest night, a band that keeps the peace of the feast puts its old quarrels aside. */
export function feastPeace(s: Sim, c: Camp) {
  if (!holds(c, 'feast_peace')) return;
  const ms = s.members(c).filter((q) => s.age(q) >= 14);
  let mended = 0;
  for (const a of ms) for (const b of ms) if (a !== b && s.opinion(a, b) < -20) { s.adjust(a, b, FEAST_MEND); mended++; }
  if (mended) s.event('way_habit', `At ${c.name}'s feast old quarrels were put aside, as is the custom.`, [], c.x, c.z, 1);
}

/** Something the band lived through, remembered for a custom it may harden into. */
export function lived(s: Sim, c: Camp, k: WayKind, why: string) {
  if (holds(c, k)) return;
  c.lived = (c.lived ?? []).filter((l) => l.kind !== k);
  c.lived.push({ kind: k, tick: s.tick, why });
}

/**
 * Each year, in late summer: what a band has lived through lately may harden into a custom; and a band that
 * mocks braggarts thinks the less of its ambitious.
 */
export function waysDaily(s: Sim, dayOfYear: number) {
  if (dayOfYear !== WAY_DAY) return;
  const r = s.rWays;
  for (const c of s.liveCamps()) {
    c.lived = (c.lived ?? []).filter((l) => s.tick - l.tick < LIVED_YEARS * TICKS_PER_YEAR);
    // (the newest first, and one custom a year at most)
    const ruler = c.rule ? s.byId.get(c.rule.ruler) : undefined;
    for (const l of c.lived.slice().reverse()) {
      // (not that only one sex may lead, while someone of the other rules the band)
      if (ruler?.alive && ((l.kind === 'men_lead' && !ruler.sex) || (l.kind === 'women_lead' && ruler.sex))) continue;
      if (holds(c, l.kind) || !r.chance(LIVED_CHANCE)) continue;
      takeUp(s, c, l.kind, l.why, `${l.why.charAt(0).toUpperCase()}${l.why.slice(1)},`);
      c.lived = c.lived.filter((x) => x.kind !== l.kind);
      break;
    }
    // an elder the whole band looks up to: the band comes to give the elders the last word
    if (!holds(c, 'elders') && !c.lived.some((l) => l.kind === 'elders')) {
      const elder = s.members(c).filter((q) => s.age(q) >= 60 && q.health > 30).sort((a, b) => a.birth - b.birth || a.id - b.id)[0];
      const rest = s.members(c).filter((q) => q !== elder && s.age(q) >= 16);
      if (elder && rest.length >= 4 && rest.filter((q) => s.opinion(q, elder) >= 40).length >= rest.length * 0.6)
        lived(s, c, 'elders', `with everyone looking up to ${elder.name} in ${his(elder)} old age`);
    }
    // a great hunter who is greedy or grasping: the band comes to let the hunter keep the best of the kill
    const has = (k: WayKind) => holds(c, k) || c.lived!.some((l) => l.kind === k);
    const grown = s.members(c).filter((q) => s.age(q) >= 16);
    const hunter = grown.slice().sort((a, b) => b.kills - a.kills || a.id - b.id)[0];
    if (!has('hunter_best') && !holds(c, 'share_meat') && hunter && hunter.kills >= GREAT_HUNTER && (s.has(hunter, 'greedy') || s.has(hunter, 'ambitious')))
      lived(s, c, 'hunter_best', `with ${hunter.name} bringing home most of the meat`);
    // a devout band: a widow is to keep faith with her dead
    if (!has('widows') && grown.length >= 6 && grown.filter((q) => s.has(q, 'pious')).length >= grown.length * DEVOUT)
      lived(s, c, 'widows', 'with so many of them devout');
    if (holds(c, 'humble')) {
      const ms = s.members(c).filter((q) => s.age(q) >= 16);
      for (const p of ms) if (s.has(p, 'ambitious')) {
        // (down to size, not into a feud: nobody is mocked below plain liking)
        for (const q of ms) if (q !== p && s.opinion(q, p) > HUMBLE_FLOOR) s.adjust(q, p, -Math.min(HUMBLE_MOCK, s.opinion(q, p) - HUMBLE_FLOOR));
        s.remember(p, 'mocked_airs', -6, 1, -1, 'Was laughed at for putting on airs.');
      }
    }
  }
}

/** The band's customs, for the band panel: in words, with the year each was taken up and how it came about. */
export function waysSummary(c: Camp) {
  return (c.ways ?? []).map((w) => ({ text: WAYS[w.kind].text, since: yearOf(w.since), why: w.why }));
}
