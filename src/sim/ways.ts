// Customs: the ways a band lives by. Every band has a few, and they are not beliefs about the signs (those are in
// omen.ts) but rules about how people treat one another: whether the meat is shared out equally or the hunter keeps
// the best of it; whether newcomers are welcomed in or held at arm's length; whether a widow may take another
// partner; who may lead the band; whether the elders have the last word; whether a braggart is mocked down to size;
// whether blood may be spilt at the midwinter feast; how the dead are buried, twins taken, children raised, thieves,
// guests and the first salmon dealt with; and which band a bride or groom goes to.
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
//   The dead keep their things  a tool in the hand and what they wore go into the ground with them (lost to the band),
//                             and their kin feel the better for it. Comes of a year of burials.
//   The first salmon goes     the first fish of the run is let go each year, and the run near camp is the thicker for
//   back                      it. Comes of a year the salmon failed.
//   The white deer is never   nobody hunts it. Comes of a white deer killed and the band scorning it.
//   hunted
//   Twins are a bad sign      the grown-ups think the less of twins, and the band is uneasy. Comes of a twin lost.
//   Children raised by        a child grieves less for a parent and keeps a sense of belonging. Comes of an orphan.
//   everyone
//   A thief is cast out       someone caught stealing from the stores in a hungry time is driven out to make a camp
//                             alone. Comes of a theft (the greedy steal when the band is rationing or starving).
//   Guests are fed first      a band taken in is fed full before the hosts eat, and thinks the better of them.
//                             Comes of being turned away hungry.
//   Sweat before the hunt     skilled hunters go to the lodge on any evening, and strike the better after. Comes of a
//                             kill made just after a sweat.
//   Brides go / grooms go     when two people of different bands pair off, the woman goes to the man's band (or the
//                             man to the woman's), whoever has more kin at home.
import type { Sim, Camp } from './sim';
import type { Person } from './band';
import { SK } from './band';
import { runYear } from './runs';
const SK_HUNT = SK.hunt;
import { TICKS_PER_DAY, TICKS_PER_YEAR, yearOf } from './time';

export type WayKind = 'share_meat' | 'hunter_best' | 'welcome' | 'wary' | 'widows' | 'men_lead' | 'women_lead' | 'elders' | 'humble' | 'feast_peace'
  | 'buried_things' | 'first_salmon' | 'white_deer' | 'twins_bad' | 'raised_by_all' | 'thief_out' | 'guests_first' | 'sweat_hunt' | 'brides_go' | 'grooms_go';

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
  buried_things: { text: 'The dead are buried with their things', took: 'From now on the dead go into the ground with their things' },
  first_salmon: { text: 'The first salmon goes back to the river', took: 'From now on the first salmon of the run is given back to the river' },
  white_deer: { text: 'The white deer is never hunted', took: 'From now on nobody may hunt the white deer' },
  twins_bad: { text: 'Twins are a bad sign', took: 'From now on twins are taken for a bad sign' },
  raised_by_all: { text: 'Children are raised by everyone', took: 'From now on every child is everyone\'s to raise' },
  thief_out: { text: 'A thief is cast out', took: 'From now on anyone who steals from the stores is cast out' },
  guests_first: { text: 'Guests are fed first', took: 'From now on guests are fed before the band eats' },
  sweat_hunt: { text: 'Hunters sweat in the lodge before a hunt', took: 'From now on the hunters sweat in the lodge before they hunt' },
  brides_go: { text: 'A bride goes to live with her husband\'s band', took: 'From now on a bride goes to live with her husband\'s band', against: 'grooms_go' },
  grooms_go: { text: 'A groom goes to live with his wife\'s band', took: 'From now on a groom goes to live with his wife\'s band', against: 'brides_go' },
};
export const WAY_KINDS = Object.keys(WAYS) as WayKind[];

/** How readily a band founded by someone takes up a custom from their own character (and its elder's age). */
export const FOUND_LEAN = 0.45;
/** And the chance of each custom with nothing in the founder's character for or against it. */
export const FOUND_PLAIN = 0.06;
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
/** A year with this many burials, or a run that failed (only a blighted year runs this thin), may set a band to a custom. */
export const BURIALS = 3;
export const THIN_RUN = 0.6;

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

/** Whether a salmon river runs near a band's camp. */
function salmonRiverNear(s: Sim, c: Camp) {
  for (const i of s.runs.tiles) if (s.runs.salmon[i] >= 0 && Math.hypot((i % s.N) + 0.5 - c.x, Math.floor(i / s.N) + 0.5 - c.z) < SALMON_NEAR) return true;
  return false;
}

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
  if (s.has(p, 'pious')) out.push('buried_things', 'first_salmon', 'white_deer');
  if (s.has(p, 'pious') && s.has(p, 'cautious')) out.push('twins_bad');
  if (s.has(p, 'kind') || s.has(p, 'charismatic')) out.push('raised_by_all', 'guests_first');
  if (s.has(p, 'cruel') || (s.has(p, 'cautious') && !s.has(p, 'kind'))) out.push('thief_out');
  if (s.has(p, 'brave') && s.has(p, 'pious')) out.push('sweat_hunt');
  if (s.has(p, 'ambitious') && !s.has(p, 'kind')) out.push(p.sex ? 'brides_go' : 'grooms_go');
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
    // a year of burials: the band comes to send its dead into the ground with their things
    const buried = s.people.filter((q) => !q.alive && q.band === c.id && s.tick - q.death < TICKS_PER_YEAR && s.age(q) >= 3).length;
    if (!has('buried_things') && buried >= BURIALS) lived(s, c, 'buried_things', 'after a year of burials');
    // a thin run up the river by camp: the band comes to give the first salmon back, so that they return
    const last = yearOf(s.tick) - 1;
    if (!has('first_salmon') && last >= 1 && runYear(s, last) < THIN_RUN && salmonRiverNear(s, c)) lived(s, c, 'first_salmon', `after the salmon failed in year ${last}`);
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

// ------------------------------------------------------------------ the later customs

/** The dead buried with their things: the kin of someone so buried remember it, and feel the better for it. */
export const GRAVE_THINGS_EASE = 8;
/** The first salmon given back: the run is this much thicker in the rivers near a band that gave it back this year. */
export const SALMON_THANKS = 1.2;
export const SALMON_NEAR = 30;
/** Twins a bad sign: the band remembers their birth with this unease, and the grown-ups think this much less of the twins. */
export const TWINS_UNEASE = 10;
export const TWINS_SHUN = 12;
/** Children raised by everyone: a child's grief for a parent is this share of what it would be, and their belonging fades this much slower. */
export const RAISED_GRIEF = 0.55;
export const RAISED_BELONG = 0.5;
/** Theft: in a hungry time, a greedy grown-up who is hungry steals from the stores this often a day, eating this much, and is caught this often. */
export const THEFT_CHANCE = 0.015;
export const THEFT_FOOD = 40;
export const THEFT_CAUGHT = 0.5;
export const THEFT_SCORN = 20;
/** Guests fed first: newcomers taken in are fed to this, and think this much better of the band for it. */
export const GUEST_FED = 95;
export const GUEST_THANKS = 8;
/** Hunters sweat before the hunt: a hunter this skilled goes to the lodge on any evening, and one who has sweated lately strikes this much more often. */
export const SWEAT_HUNTER = 8;
export const SWEAT_AIM = 0.06;

/** Whether the band would bury someone with their things (their tool and what they wear stay with the body). */
export function buriedWithThings(s: Sim, p: Person) {
  return holdsP(s, p, 'buried_things');
}
/** Someone was laid in the ground with their things: their kin remember it. */
export function laidWithThings(s: Sim, body: Person, n: number) {
  if (!n) return;
  for (const q of s.people) if (q.alive && q.band === body.band && (s.isKin(q, body) || q.id === body.partner))
    s.remember(q, 'grave_things', GRAVE_THINGS_EASE, 2, body.id, `Saw ${body.name} laid in the ground with ${n === 1 ? 'their own tool' : 'their own things'}, as is right.`);
}

/** A fish caught from a run: the band's first of the year goes back to the river, if that is the custom (true: let go). */
export function firstSalmon(s: Sim, p: Person) {
  const c = s.campById(p.band);
  if (!c || !holds(c, 'first_salmon') || c.salmonFreed === yearOf(s.tick)) return false;
  c.salmonFreed = yearOf(s.tick);
  s.remember(p, 'first_salmon', 4, 1, -1, 'Caught the first salmon of the run, and gave it back to the river.');
  s.event('way_habit', `${p.name} caught the first salmon of the run and gave it back to the river, as is the custom at ${c.name}.`, [p.id], p.x, p.z, 2);
  return true;
}
/** How much thicker a run is at a river tile: near a band that gave the first salmon back this year. */
export function salmonThanks(s: Sim, x: number, z: number) {
  const y = yearOf(s.tick);
  for (const c of s.liveCamps()) if (c.salmonFreed === y && Math.hypot(c.x - x, c.z - z) < SALMON_NEAR) return SALMON_THANKS;
  return 1;
}

/** Whether someone would let a white deer be, by their band's custom. */
export function spareWhite(s: Sim, p: Person) {
  return holdsP(s, p, 'white_deer');
}

/** Twins born in a band that takes them for a bad sign. */
export function twinsBorn(s: Sim, mother: Person, twins: Person[]) {
  const c = s.campById(mother.band);
  if (!c || !holds(c, 'twins_bad')) return;
  for (const q of s.members(c)) {
    if (twins.includes(q) || s.age(q) < 12) continue;
    s.remember(q, 'twins_omen', -TWINS_UNEASE, 1, mother.id, `Twins were born to ${mother.name}: a bad sign.`);
    if (s.age(q) >= 16) for (const t of twins) s.adjust(q, t, -TWINS_SHUN);
  }
  s.event('way_habit', `Twins were born at ${c.name}, and the band took it for a bad sign.`, [mother.id, ...twins.map((t) => t.id)], mother.x, mother.z, 2);
}

/** How hard a child takes a parent's death, by the band's customs (a share of the usual grief). */
export function childGrief(s: Sim, q: Person) {
  return s.age(q) < 14 && holdsP(s, q, 'raised_by_all') ? RAISED_GRIEF : 1;
}
/** How fast a child's sense of belonging fades, by the band's customs. */
export function childBelong(s: Sim, q: Person) {
  return s.age(q) < 14 && holdsP(s, q, 'raised_by_all') ? RAISED_BELONG : 1;
}

/** Guests fed first: how well those taken in are fed, and whether they think the better of the band for it. */
export function guestFed(to: Camp) {
  return holds(to, 'guests_first') ? GUEST_FED : 0;
}

/** Whether a hunter goes to sweat before a hunt on a mild evening, and how much better a hunter who has sweated strikes. */
export function sweatsToHunt(s: Sim, p: Person) {
  return p.skills[SK_HUNT] >= SWEAT_HUNTER && holdsP(s, p, 'sweat_hunt');
}
export function sweatAim(s: Sim, p: Person) {
  return holdsP(s, p, 'sweat_hunt') && s.sweatWarded(p) ? SWEAT_AIM : 0;
}

/** Who goes to live with whom when two young people of different bands pair off: by the bands' customs, or (null) by ties. */
export function whoGoes(s: Sim, p: Person, q: Person): [Person, Person] | null {
  if (p.sex === q.sex) return null;
  const [man, woman] = p.sex ? [p, q] : [q, p];
  const bm = s.campById(man.band), bw = s.campById(woman.band);
  const brides = holds(bm, 'brides_go') || holds(bw, 'brides_go'), grooms = holds(bm, 'grooms_go') || holds(bw, 'grooms_go');
  if (brides && !grooms) return [woman, man];
  if (grooms && !brides) return [man, woman];
  return null;
}

/**
 * Each day: in a hungry time a greedy grown-up may steal from the stores; caught, they are cast out where that is the
 * custom, and otherwise the band thinks the less of them and may come to make it the custom.
 */
export function theftDaily(s: Sim, exile: (thief: Person, by: Person, c: Camp) => void) {
  const r = s.rWays;
  for (const c of s.liveCamps()) {
    if (!c.famine && !c.rationing) continue;
    const ms = s.members(c);
    for (const p of ms) {
      if (!p.alive || s.age(p) < 16 || !s.has(p, 'greedy') || p.food >= 50 || !r.chance(THEFT_CHANCE)) continue;
      const food = (['preserved', 'grain', 'nuts', 'roots', 'meat', 'fish', 'berries'] as const).find((k) => c.stock[k] >= 1);
      if (!food) continue;
      c.stock[food] -= 1;
      s.book(`eaten.${food}`, 1, c);
      p.food = Math.min(100, p.food + THEFT_FOOD);
      if (!r.chance(THEFT_CAUGHT)) continue;
      const by = ms.filter((q) => q !== p && q.alive && s.age(q) >= 14 && !s.isKin(q, p) && q.id !== p.partner)[0];
      if (!by) continue;
      for (const q of ms) if (q !== p && s.age(q) >= 14) s.adjust(q, p, -THEFT_SCORN);
      s.remember(p, 'thief', -10, 2, by.id, `Was caught taking food from the stores.`);
      if (holds(c, 'thief_out')) { exile(p, by, c); break; }
      s.event('theft', `${by.name} caught ${p.name} taking food from the stores at ${c.name} in the hungry time.`, [p.id, by.id], p.x, p.z, 3);
      lived(s, c, 'thief_out', `after ${p.name} stole from the stores`);
    }
  }
}

/** The band's customs, for the band panel: in words, with the year each was taken up and how it came about. */
export function waysSummary(c: Camp) {
  return (c.ways ?? []).map((w) => ({ text: WAYS[w.kind].text, since: yearOf(w.since), why: w.why }));
}
