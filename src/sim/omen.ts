// Omens and superstitions. Now and then the people of a band see something they have never seen before: the
// sun going dark at midday, a red moon, a star with a tail, a white deer among the herd, a wolf walking up to
// the fire, lightning splitting a tree, someone dying who was well the day before. Whatever happens to the band
// soon after, good or bad, someone may take the sight for a sign of it, the pious most of all. That notion is
// theirs at first; the elders tell of it at the fire, children take it from their parents, and once most of the
// grown-ups hold it, it is the band's. A belief the band holds changes what it does when the sign comes again:
// they leave their work and keep to the fire, leave food at the stone ring, will not hunt the white deer, or keep
// away from the struck tree. One that has come true again and again, and that everyone has held for years,
// hardens into a custom that holds whether or not the sign is seen: a day of the year when no work is done, a
// season when nobody takes a partner, food left out at every midwinter. Beliefs go where the people who hold
// them go (to a new band when a band splits, or with someone who marries in), and fade from a band where
// nothing proves them for a generation. Customs stay.
import type { Sim, Camp } from './sim';
import { isTreeType, treeStage } from './sim';
import type { Person } from './band';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_YEAR, DAYS_PER_YEAR, dayOf, hourOf, seasonOf, yearOf, isDark } from './time';

export type SignKind = 'eclipse' | 'blood_moon' | 'comet' | 'lights' | 'white_deer' | 'wolf' | 'geese' | 'strange_death' | 'two_deaths' | 'lightning' | 'hail';
export type SkyKind = 'eclipse' | 'blood_moon' | 'comet' | 'lights';
/** What believers do when the sign is seen again. */
export type Habit = 'shelter' | 'offer' | 'spare' | 'shun';
/** What a belief can harden into. */
export type CustomKind = 'rest_day' | 'no_pairing' | 'offering' | 'spare_white' | 'shun_place';

export interface SignSpec {
  group: 'sky' | 'beast' | 'death' | 'weather';
  /** the sign, as a believer names it ("a white deer"), and whether that is more than one thing ("lights": they foretell) */
  label: string;
  many?: boolean;
  /** what someone did who saw it, for their memories ("Saw the sun go dark at midday.") */
  saw: string;
  habit: Habit;
  /** for believers keeping to the fire: how many hours, and what they think meanwhile */
  hours?: number;
  custom: CustomKind;
  /** the day of rest, or the season without partnering, named after it */
  dayName?: string;
  seasonName?: string;
}

export const SIGNS: Record<SignKind, SignSpec> = {
  eclipse: { group: 'sky', label: 'the sun going dark', saw: 'Saw the sun go dark at midday.', habit: 'shelter', hours: 2, custom: 'rest_day', dayName: 'the day the sun went dark' },
  blood_moon: { group: 'sky', label: 'a red moon', saw: 'Saw the moon rise red as blood.', habit: 'shelter', hours: 4, custom: 'no_pairing', seasonName: 'the season of the red moon' },
  comet: { group: 'sky', label: 'a star with a tail', saw: 'Saw a star with a long tail in the night sky.', habit: 'offer', custom: 'offering' },
  lights: { group: 'sky', label: 'lights in the northern sky', many: true, saw: 'Saw green lights ripple across the northern sky.', habit: 'offer', custom: 'offering' },
  white_deer: { group: 'beast', label: 'a white deer', saw: 'Saw a white deer.', habit: 'spare', custom: 'spare_white' },
  wolf: { group: 'beast', label: 'a wolf coming to the fire', saw: 'Saw a lone wolf walk up to the fire and stand watching.', habit: 'shelter', hours: 3, custom: 'rest_day', dayName: 'the day of the wolf' },
  geese: { group: 'beast', label: 'geese flying north in autumn', many: true, saw: 'Saw the geese fly north in autumn, the wrong way.', habit: 'offer', custom: 'offering' },
  strange_death: { group: 'death', label: 'a death nobody can explain', saw: 'Saw someone die who was well the day before.', habit: 'shelter', hours: 4, custom: 'rest_day', dayName: 'the day of the strange death' },
  two_deaths: { group: 'death', label: 'two deaths on one day', many: true, saw: 'Saw two of the band die on the same day.', habit: 'offer', custom: 'offering' },
  lightning: { group: 'weather', label: 'lightning striking a tree', saw: 'Saw lightning split a tree by camp.', habit: 'shun', custom: 'shun_place' },
  hail: { group: 'weather', label: 'hail in summer', saw: 'Saw hail fall in high summer.', habit: 'shelter', hours: 2, custom: 'no_pairing', seasonName: 'the season the hail fell' },
};

/** A belief someone in a band holds: that a sign foretells something. */
export interface Lore {
  /** sign and meaning ("white_deer:bad") */
  key: string;
  sign: SignKind;
  good: boolean;
  /** what it foretells ("a death") */
  of: string;
  /** when it first took hold, who first held it, and the band where they did */
  since: number;
  by: number;
  origin: string;
  /** when most of the band's grown-ups came to hold it (absent while only a few do) */
  held?: number;
  /** how often it has come true (counting the first), and when it last did */
  proven: number;
  lastTrue: number;
  /** the day of the year and the season it was first seen, and the place (the struck tree's tile), if it has one */
  day: number;
  season: number;
  at?: number;
}

/** A custom a belief has hardened into: the band keeps it whether or not the sign is seen. */
export interface Custom {
  kind: CustomKind;
  /** the belief it came from (Lore.key) */
  from: string;
  since: number;
  /** the custom, in words */
  text: string;
  day?: number;
  season?: number;
  at?: number;
}

/** A sign seen, waiting to see what follows it. */
export interface Omen {
  sign: SignKind;
  tick: number;
  until: number;
  /** who saw it (or was there when it was told of) */
  seen: number[];
  at?: number;
}

/** A sight in the sky, for everyone in the land: when it begins and ends (ticks). */
export interface Sky {
  kind: SkyKind;
  from: number;
  until: number;
  told?: boolean;
}

/** How often each sky sight comes, as a chance a day (lights only on winter nights). */
export const SKY_CHANCE: Record<SkyKind, number> = {
  eclipse: 1 / (DAYS_PER_YEAR * 25),
  blood_moon: 1 / (DAYS_PER_YEAR * 8),
  comet: 1 / (DAYS_PER_YEAR * 30),
  lights: 1 / (12 * 5),
};
/** After a sight in the sky, none comes again for this long (ticks). */
export const SKY_QUIET = TICKS_PER_YEAR / 2;
/** A comet hangs in the sky this many nights. */
export const COMET_NIGHTS = 10;
/** The chance a year that a white fawn is born into one of the herds (at most one white deer at a time). */
export const WHITE_FAWN = 1 / 14;
/** How close someone has to come to a white deer to see it, and how far off the band hears of it from them. */
export const WHITE_SEEN = 10;
/** The chance a winter day that a lone wolf walks to the edge of a band's camp at dusk (while there are wolves). */
export const WOLF_CHANCE = 1 / (12 * 18);
/** The chance a year that the geese fly north in autumn. */
export const GEESE_CHANCE = 1 / 8;
/** The chance a summer day that lightning strikes a tree by a band's camp, or that hail falls on it. */
export const LIGHTNING_CHANCE = 1 / (12 * 14);
export const HAIL_CHANCE = 1 / (12 * 18);
/** How much of a plot's crop a summer hail beats down. */
export const HAIL_HARM = 0.15;
/** How long after a sign the band is watching for what it meant (days). */
export const OMEN_DAYS = 12;
/** The chance each grown-up who saw a sign takes what followed for its meaning; the pious and the cautious more. */
export const LINK = 0.035;
export const LINK_PIOUS = 3;
export const LINK_CAUTIOUS = 1.5;
/** When a belief comes true again: the chance each who saw it and didn't believe comes to. */
export const PROVEN_CONVERT = 0.4;
/** At a story night about an omen, the chance each listener comes to believe it (the pious twice that). */
export const TOLD_CONVERT = 0.05;
/** The chance a story night's tale is of an omen, when the teller believes one. */
export const TELL_OMEN = 0.25;
/** The chance a year a child (6 to 15) takes a parent's belief, and a partner their partner's. */
export const CHILD_TAKES = 0.4;
export const PARTNER_TAKES = 0.1;
/** A belief nothing has proven for this many years starts to be doubted: the chance a year each believer lets it go. */
export const DOUBT_YEARS = 15;
export const DOUBT = 0.12;
export const DOUBT_PIOUS = 0.25;
/** The share of the grown-ups who must hold a belief for it to be the band's, and below which it stops being. */
export const HELD_SHARE = 0.5;
export const UNHELD_SHARE = 0.25;
/** A belief the band has held this many years, that has come true this often, and that this share holds, may become a custom (this chance a year). */
export const CUSTOM_YEARS = 8;
export const CUSTOM_PROVEN = 2;
export const CUSTOM_SHARE = 0.65;
export const CUSTOM_CHANCE = 0.35;
/** At most this many beliefs a band has going, and one person holds. */
export const LORE_MAX = 6;
export const BELIEFS_MAX = 4;
/** Food left out at an offering: meals for each person of the band. */
export const OFFER_MEALS = 0.25;
/** How much an offering lifts the believers' sense of belonging. */
export const OFFER_BELONG = 8;
/** How far from a struck tree the believers will not cut wood. */
export const SHUN_RANGE = 5;
/** How much the believers think less of someone who kills a white deer they hold sacred. */
export const WHITE_KILL_SCORN = 12;
/** How much harder a habit pulls someone to the fire than their work does. */
export const SHELTER_PULL = 1.7;

/** What the events that can follow a sign mean, and how strongly they strike people (a birth is common). */
const MEANING: Record<string, { good: boolean; of: string; k: number }> = {
  death: { good: false, of: 'a death', k: 1 },
  stillbirth: { good: false, of: 'a child born dead', k: 1 },
  epidemic: { good: false, of: 'sickness', k: 1.3 },
  famine: { good: false, of: 'hunger', k: 1.2 },
  blight: { good: false, of: 'a lean year', k: 1.2 },
  attack: { good: false, of: 'an attack', k: 1 },
  murrain: { good: false, of: 'death among the deer', k: 1 },
  fight: { good: false, of: 'blood spilled', k: 1 },
  twins: { good: true, of: 'twins', k: 1.3 },
  great_hunt: { good: true, of: 'a great hunt', k: 1.3 },
  plenty: { good: true, of: 'a year of plenty', k: 1.3 },
  birth: { good: true, of: 'a birth', k: 0.35 },
  provided: { good: true, of: 'full stores', k: 0.8 },
};
/** The kinds of event this module makes, which are never taken for what a sign meant. */
export const OMEN_KINDS = new Set(['omen', 'omen_belief', 'omen_true', 'omen_held', 'omen_habit', 'omen_fade', 'custom']);

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** "a white deer foretells a death" */
export function loreText(l: Pick<Lore, 'sign' | 'of'>) {
  return `${SIGNS[l.sign].label} ${SIGNS[l.sign].many ? 'foretell' : 'foretells'} ${l.of}`;
}
/** Whether someone holds a belief. */
export function believes(p: Person, key: string) {
  return !!p.beliefs?.includes(key);
}
const signOf = (key: string) => key.split(':')[0] as SignKind;
/** Whether someone holds any belief about this sign. */
export function believesSign(p: Person, sign: SignKind) {
  return !!p.beliefs?.some((k) => signOf(k) === sign);
}

/** Someone comes to hold a belief (not if they hold the opposite one about the same sign, or already hold as many as they can). */
function adopt(s: Sim, p: Person, l: Lore, how: string) {
  if (!p.alive || believes(p, l.key) || believesSign(p, l.sign) || (p.beliefs?.length ?? 0) >= BELIEFS_MAX) return false;
  (p.beliefs ??= []).push(l.key);
  s.remember(p, 'belief', 4, 8, -1, `${how} that ${loreText(l)}.`);
  return true;
}
function drop(p: Person, key: string) {
  if (!p.beliefs) return;
  p.beliefs = p.beliefs.filter((k) => k !== key);
  if (!p.beliefs.length) delete p.beliefs;
}

/** The grown-ups of a band (14 and over), and those of them who hold a belief. */
function holders(s: Sim, c: Camp, key: string) {
  const grown = s.members(c).filter((p) => s.age(p) >= 14);
  return { grown, hold: grown.filter((p) => believes(p, key)) };
}

/** Where a band leaves its offerings: at its stone ring, its barrow, its graves, or else by the fire. */
function offeringPlace(s: Sim, c: Camp) {
  const built = (k: string) => s.buildings.some((b) => b.band === c.id && b.kind === k && b.built);
  return built('stones') ? 'at the stone ring' : built('barrow') ? 'at the barrow' : s.people.some((p) => !p.alive && p.buried && p.band === c.id) ? 'at the graves' : 'by the fire';
}

/** The band leaves food out for whatever sent the sign: taken from the stores, things that keep first. */
function offer(s: Sim, c: Camp, why: string) {
  const ms = s.members(c);
  let want = ms.length * OFFER_MEALS;
  const st = c.stock as unknown as Record<string, number>;
  for (const k of ['preserved', 'meat', 'fish', 'berries', 'roots', 'nuts', 'grain', 'eggs', 'mushrooms', 'greens'] as const) {
    if (want <= 0) break;
    const n = Math.min(st[k] ?? 0, want);
    if (n <= 0) continue;
    st[k] -= n;
    want -= n;
    s.book(`offered.${k}`, n, c);
  }
  if (want >= ms.length * OFFER_MEALS * 0.99) return false;
  for (const p of ms) if (p.beliefs?.length) p.belonging = Math.min(100, p.belonging + OFFER_BELONG);
  s.event('omen_habit', `${why}, the people of ${c.name} left food ${offeringPlace(s, c)}.`, [], c.x, c.z, 2);
  return true;
}

/** Believers (or, on a day of custom, everyone) leave their work and keep to the fire until `until`. */
function shelter(s: Sim, c: Camp, until: number, why: string, all = false) {
  c.shelter = { until, why, ...(all ? { all } : {}) };
  for (const p of s.members(c)) if (all || p.beliefs?.length) p.nextThink = s.tick;
}

/** Why someone is keeping to the fire just now, if they are: a sign they believe in, or the band's day of rest. */
export function sheltering(s: Sim, p: Person): string | null {
  const c = s.campById(p.band);
  const sh = c?.shelter;
  if (!sh || sh.until <= s.tick) return null;
  if (sh.all) return sh.why;
  return sh.sign && believesSign(p, sh.sign) ? sh.why : null;
}

/** Whether someone would let a white deer be: they hold a belief about white deer, or their band's custom forbids it. */
export function sparesWhite(s: Sim, p: Person) {
  if (believesSign(p, 'white_deer')) return true;
  return !!s.campById(p.band)?.customs?.some((k) => k.kind === 'spare_white');
}

/** Whether someone keeps away from wood near this place: a struck tree they believe in, or one the band's custom keeps them from. */
export function shunned(s: Sim, p: Person, x: number, z: number) {
  const c = s.campById(p.band);
  if (!c) return false;
  const N = s.N;
  const near = (t: number | undefined) => t !== undefined && Math.hypot((t % N) + 0.5 - x, Math.floor(t / N) + 0.5 - z) < SHUN_RANGE;
  if (c.customs?.some((k) => k.kind === 'shun_place' && near(k.at))) return true;
  if (!believesSign(p, 'lightning')) return false;
  return !!c.lore?.some((l) => l.sign === 'lightning' && believes(p, l.key) && near(l.at));
}

/** Whether a band's customs keep anyone from taking a partner this season. */
export function noPairing(s: Sim, c: Camp) {
  const season = seasonOf(s.tick);
  return !!c.customs?.some((k) => k.kind === 'no_pairing' && k.season === season);
}

/**
 * A band sees a sign. Those who already believe something of it act on it (if the band holds the belief, the
 * whole band does what it asks), and the band watches what follows.
 */
export function sight(s: Sim, c: Camp, sign: SignKind, seen: Person[], at?: number) {
  const spec = SIGNS[sign];
  for (const p of seen) s.remember(p, 'omen', 0, 3, -1, spec.saw);
  c.omen = { sign, tick: s.tick, until: s.tick + OMEN_DAYS * TICKS_PER_DAY, seen: seen.map((p) => p.id), ...(at !== undefined ? { at } : {}) };
  const known = c.lore?.filter((l) => l.sign === sign) ?? [];
  if (!known.length) return;
  const l = known[0];
  const { grown, hold } = holders(s, c, l.key);
  if (spec.habit === 'shelter' && hold.length) {
    const sh = { until: s.tick + (spec.hours ?? 2) * TICKS_PER_HOUR, why: `Keeping close to the fire: ${loreText(l)}.`, sign };
    c.shelter = sh;
    for (const p of hold) p.nextThink = s.tick;
    if (l.held) s.event('omen_habit', `At ${c.name}, ${hold.length >= grown.length * 0.8 ? 'everyone' : 'most of the band'} left their work and kept close to the fire, for ${loreText(l)}.`, [], c.x, c.z, 2);
  } else if (spec.habit === 'offer' && l.held) {
    offer(s, c, `Fearing what ${spec.label} foretold`);
  }
}

/** A thing seen in the sky: every band sees it, and the land's chronicle tells of it once. */
function skySign(s: Sim, kind: SkyKind) {
  const text: Record<SkyKind, string> = {
    eclipse: 'The sun went dark at midday. For a while it was night, and the birds fell silent.',
    blood_moon: 'The moon rose red as blood.',
    comet: 'A star with a long tail appeared in the night sky, and hung there night after night.',
    lights: 'Green lights rippled across the northern sky all night.',
  };
  const live = s.liveCamps();
  const here = live[0];
  if (!here) return;
  s.event('omen', text[kind], [], here.x, here.z, kind === 'lights' ? 2 : 3);
  for (const c of live) sight(s, c, kind, s.members(c).filter((p) => s.age(p) >= 4));
}

/**
 * Each hour: the sky sights begin and end, a white deer may be seen, and, at their hour, a wolf at the fire,
 * hail or lightning in a summer storm, or the geese going the wrong way.
 */
export function omenHourly(s: Sim) {
  const hour = Math.round(hourOf(s.tick));
  const r = s.rOmen;
  if (s.sky && s.tick >= s.sky.from && !s.sky.told) {
    s.sky.told = true;
    skySign(s, s.sky.kind);
  }
  // a white deer seen by someone out and about
  for (const d of s.deer) {
    if (!d.alive || !d.white) continue;
    for (const c of s.liveCamps()) {
      if (c.whiteSeen?.includes(d.id)) continue;
      const ms = s.members(c);
      const spotter = ms.find((p) => !p.indoors && p.task?.kind !== 'sleep' && s.age(p) >= 6 && Math.hypot(p.x - d.x, p.z - d.z) < WHITE_SEEN);
      if (!spotter) continue;
      (c.whiteSeen ??= []).push(d.id);
      s.event('omen', `${spotter.name} saw a white ${d.fawn ? 'fawn' : 'deer'} among the herd near ${c.name}, and came home to tell of it.`, [spotter.id], d.x, d.z, 3);
      sight(s, c, 'white_deer', ms.filter((p) => s.age(p) >= 4));
    }
  }
  const season = seasonOf(s.tick);
  const doy = dayOf(s.tick) % DAYS_PER_YEAR;
  if (hour === 18 && season === 3 && s.wolves.some((w) => w.alive)) {
    for (const c of s.liveCamps()) {
      if (!r.chance(WOLF_CHANCE)) continue;
      s.event('omen', `At dusk a lone wolf walked up to the edge of ${c.name} and stood looking at the fire. Then it turned and went.`, [], c.x, c.z, 3);
      sight(s, c, 'wolf', s.members(c).filter((p) => s.age(p) >= 4));
    }
  }
  if (hour === 15 && season === 1) {
    for (const c of s.liveCamps()) {
      if (!r.chance(HAIL_CHANCE)) continue;
      const plots = s.plots(c).filter((b) => b.plot?.crop);
      for (const b of plots) b.plot!.cond *= 1 - HAIL_HARM;
      s.event('omen', `Hail fell on ${c.name} in high summer${plots.length ? ', and beat down the crops' : ''}.`, [], c.x, c.z, 3);
      sight(s, c, 'hail', s.members(c).filter((p) => s.age(p) >= 4));
    }
  }
  if (hour === 16 && season === 1) {
    for (const c of s.liveCamps()) {
      if (!r.chance(LIGHTNING_CHANCE)) continue;
      // the tallest tree near camp takes it
      const k = s.nearestProp(c.x, c.z, 14, (k) => isTreeType(s.propType[k]) && treeStage(s.propType[k]) >= 3 && Math.hypot(s.propX[k] - c.x, s.propZ[k] - c.z) > 4);
      if (k < 0) continue;
      s.propNote.set(k, `Struck by lightning in year ${yearOf(s.tick)}.`);
      s.event('omen', `In a summer storm, lightning split a great tree by ${c.name}.`, [], s.propX[k], s.propZ[k], 3);
      sight(s, c, 'lightning', s.members(c).filter((p) => s.age(p) >= 4), s.propTile[k]);
    }
  }
  if (hour === 10 && doy === 28 && r.chance(GEESE_CHANCE)) {
    const live = s.liveCamps();
    if (live.length) {
      s.event('omen', 'The geese flew north over the land in autumn, the wrong way.', [], live[0].x, live[0].z, 2);
      for (const c of live) sight(s, c, 'geese', s.members(c).filter((p) => s.age(p) >= 4));
    }
  }
}

/**
 * Someone has died: noted on their band, so that the next morning a death nobody can account for, or two on one
 * day, is taken for a sign (after the deaths have been told of and mourned).
 */
export function deathSign(s: Sim, p: Person, cause: string) {
  const c = s.campById(p.band);
  if (!c || c.gone) return;
  const age = s.age(p);
  const day = dayOf(s.tick);
  const d = c.deaths?.day === day ? c.deaths : (c.deaths = { day, n: 0 });
  if (age >= 2) d.n++;
  if ((cause === 'weakness' && age < 50) || (cause === 'fever' && age >= 16 && age < 45)) d.strange ??= p.id;
}

/** Yesterday's deaths, if they were strange: a sign. (In a famine or a sickness, deaths come together and nobody wonders at it.) */
function deathsSeen(s: Sim, c: Camp) {
  const d = c.deaths;
  if (!d || d.day >= dayOf(s.tick)) return;
  delete c.deaths;
  if (c.famine || (c.sickUntil ?? 0) > s.tick) return;
  const ms = s.members(c).filter((q) => s.age(q) >= 4);
  if (!ms.length) return;
  const dead = d.strange !== undefined ? s.byId.get(d.strange) : undefined;
  if (dead) {
    s.event('omen', `Nobody could say what took ${dead.name}, who had been well only days before.`, [dead.id], c.x, c.z, 2);
    sight(s, c, 'strange_death', ms);
  } else if (d.n >= 2) {
    s.event('omen', `Two of ${c.name} died on the same day.`, [], c.x, c.z, 2);
    sight(s, c, 'two_deaths', ms);
  }
}

/** A hunter has killed a white deer: those who hold it sacred think the less of them, and it is a sign in itself. */
export function whiteKilled(s: Sim, hunter: Person) {
  const c = s.campById(hunter.band);
  if (!c) return;
  const ms = s.members(c);
  const scorn = ms.filter((q) => q !== hunter && believesSign(q, 'white_deer'));
  for (const q of scorn) s.adjust(q, hunter, -WHITE_KILL_SCORN);
  s.remember(hunter, 'white_kill', scorn.length ? -6 : 6, 3, -1, 'Killed a white deer.');
  s.event('omen', scorn.length ? `${hunter.name} killed the white deer. Many at ${c.name} were afraid of what would come of it.` : `${hunter.name} brought down a white deer.`, [hunter.id], hunter.x, hunter.z, 3);
  sight(s, c, 'white_deer', ms.filter((p) => s.age(p) >= 4));
}

/** Something has happened: if a band is watching for what a sign meant, this may be it. */
export function omenOutcome(s: Sim, kind: string, people: number[]) {
  const m = MEANING[kind];
  if (!m) return;
  // a world-wide event (a lean year, plenty) falls on every band; else on the band of the first person in it
  let bands: Camp[];
  if (!people.length) bands = s.liveCamps();
  else {
    const p = s.byId.get(people[0]);
    const c = p ? s.campById(p.band) : undefined;
    bands = c && !c.gone ? [c] : [];
  }
  for (const c of bands) {
    const o = c.omen;
    if (!o || o.tick >= s.tick) continue;
    if (o.until < s.tick) { delete c.omen; continue; }
    delete c.omen;
    const seen = o.seen.map((id) => s.byId.get(id)).filter((p): p is Person => !!p && p.alive && p.band === c.id);
    const key = `${o.sign}:${m.good ? 'good' : 'bad'}`;
    const l = c.lore?.find((x) => x.key === key);
    if (l) {
      // it has come true again: the believers are sure of it now, and some who doubted come round
      l.proven++;
      l.lastTrue = s.tick;
      const won = seen.filter((p) => s.age(p) >= 10 && s.rOmen.chance(PROVEN_CONVERT * m.k * (s.has(p, 'pious') ? 1.5 : 1)) && adopt(s, p, l, 'Came round to believing'));
      s.event('omen_true', `Again ${SIGNS[o.sign].label} came before ${m.of} at ${c.name}.${won.length ? ` ${won.length === 1 ? `${won[0].name} believed it now too.` : 'Fewer doubted it now.'}` : ''}`,
        won.slice(0, 4).map((p) => p.id), c.x, c.z, 3);
      continue;
    }
    if (c.lore && c.lore.length >= LORE_MAX) continue;
    // a new notion: someone who saw the sign takes this for what it meant
    const linked = seen.filter((p) => s.age(p) >= 12 && s.rOmen.chance(LINK * m.k * (s.has(p, 'pious') ? LINK_PIOUS : 1) * (s.has(p, 'cautious') ? LINK_CAUTIOUS : 1)));
    if (!linked.length) continue;
    const first = linked[0];
    const nl: Lore = {
      key, sign: o.sign, good: m.good, of: m.of, since: s.tick, by: first.id, origin: c.name, proven: 1, lastTrue: s.tick,
      day: dayOf(o.tick) % DAYS_PER_YEAR, season: seasonOf(o.tick), ...(o.at !== undefined ? { at: o.at } : {}),
    };
    (c.lore ??= []).push(nl);
    for (const p of linked) adopt(s, p, nl, p === first ? 'Took it for a sign' : 'Came to believe');
    const others = linked.length > 1 ? ` ${linked.length === 2 ? `${linked[1].name} thought so too` : 'Others thought so too'}.` : '';
    s.event('omen_belief', `${first.name} took it for a sign: not long after ${SIGNS[o.sign].label}, ${m.of} at ${c.name}.${others}`, linked.slice(0, 4).map((p) => p.id), c.x, c.z, 3);
  }
}

/** A story-night tale of an omen the teller believes (the lore's key), if they tell one. */
export function omenTale(s: Sim, teller: Person): Lore | null {
  const c = s.campById(teller.band);
  const mine = c?.lore?.filter((l) => believes(teller, l.key)) ?? [];
  if (!mine.length || !s.rAi.chance(TELL_OMEN)) return null;
  return mine[s.rAi.int(0, mine.length)];
}
/** Someone listens to a tale of an omen: they may come to believe it. */
export function heardTale(s: Sim, p: Person, key: string) {
  const c = s.campById(p.band);
  const l = c?.lore?.find((x) => x.key === key);
  if (!l || believes(p, key) || s.age(p) < 6) return;
  if (s.rAi.chance(TOLD_CONVERT * (s.has(p, 'pious') ? 2 : 1))) adopt(s, p, l, 'Heard the tale and came to believe');
}

/** The thought of someone telling (or hearing) a tale of an omen. */
export function taleOf(l: Lore) {
  return `the tale of how ${SIGNS[l.sign].label} came before ${l.of}`;
}

/** Each band's beliefs: brought in by newcomers, taken up by the children, held by the band or no longer, forgotten, hardened into customs. */
function upkeep(s: Sim, c: Camp, dayOfYear: number) {
  const ms = s.members(c);
  // a belief someone brought with them (from the band they came from) is one more of this band's
  for (const p of ms) for (const key of p.beliefs ?? []) {
    if (c.lore?.some((l) => l.key === key)) continue;
    const src = s.camps.map((x) => x.lore?.find((l) => l.key === key)).find((l) => !!l);
    if (!src || (c.lore?.length ?? 0) >= LORE_MAX) { drop(p, key); continue; }
    const copy: Lore = { ...src };
    delete copy.held;
    (c.lore ??= []).push(copy);
  }
  if (!c.lore?.length) return;
  const yearly = dayOfYear === 1;
  for (const l of c.lore.slice()) {
    if (yearly) {
      // children take their parents' beliefs, partners each other's; those nothing has proven for long begin to doubt
      for (const p of ms) {
        const age = s.age(p);
        if (believes(p, l.key)) {
          if (s.tick - l.lastTrue > DOUBT_YEARS * TICKS_PER_YEAR && s.rOmen.chance(DOUBT * (s.has(p, 'pious') ? DOUBT_PIOUS : 1))) {
            drop(p, l.key);
            s.remember(p, 'doubt', 0, 4, -1, `Stopped believing that ${loreText(l)}.`);
          }
          continue;
        }
        const kin = [p.mother, p.father, p.carer].map((id) => s.byId.get(id)).some((q) => q && q.alive && believes(q, l.key));
        const partner = s.byId.get(p.partner);
        if (age >= 6 && age < 16 && kin && s.rOmen.chance(CHILD_TAKES)) adopt(s, p, l, 'Grew up believing');
        else if (age >= 16 && partner?.alive && believes(partner, l.key) && s.rOmen.chance(PARTNER_TAKES)) adopt(s, p, l, `Came to believe, as ${partner.name} did,`);
      }
    }
    const { grown, hold } = holders(s, c, l.key);
    const share = grown.length ? hold.length / grown.length : 0;
    const custom = c.customs?.some((k) => k.from === l.key);
    if (!hold.length && !ms.some((p) => believes(p, l.key))) {
      c.lore.splice(c.lore.indexOf(l), 1);
      if (l.held && !custom) s.event('omen_fade', `No one at ${c.name} believes any more that ${loreText(l)}.`, [], c.x, c.z, 2);
      continue;
    }
    if (!l.held && share >= HELD_SHARE && grown.length >= 3) {
      l.held = s.tick;
      s.event('omen_held', `It came to be known by all at ${c.name}: ${loreText(l)}.`, hold.slice(0, 3).map((p) => p.id), c.x, c.z, 3);
    } else if (l.held && share < UNHELD_SHARE) {
      delete l.held;
      s.event('omen_fade', `Few at ${c.name} still believe that ${loreText(l)}.`, [], c.x, c.z, 2);
    }
    if (yearly && l.held && !custom && s.tick - l.held >= CUSTOM_YEARS * TICKS_PER_YEAR && l.proven >= CUSTOM_PROVEN && share >= CUSTOM_SHARE && s.rOmen.chance(CUSTOM_CHANCE)) harden(s, c, l);
  }
}

/** A belief the band has long held hardens into a custom. */
function harden(s: Sim, c: Camp, l: Lore) {
  const spec = SIGNS[l.sign];
  let text: string;
  const k: Custom = { kind: spec.custom, from: l.key, since: s.tick, text: '' };
  switch (spec.custom) {
    case 'rest_day':
      k.day = l.day;
      text = `No work is done on ${spec.dayName}`;
      break;
    case 'no_pairing':
      k.season = l.season;
      text = `No one takes a partner in ${SEASONS[l.season]}, ${spec.seasonName}`;
      break;
    case 'offering':
      text = `Food is left ${offeringPlace(s, c)} every midwinter, against ${l.of}`;
      break;
    case 'spare_white':
      text = 'No one may hunt a white deer';
      break;
    case 'shun_place':
      k.at = l.at;
      text = 'No one cuts wood by the tree the lightning struck';
      break;
  }
  k.text = text;
  (c.customs ??= []).push(k);
  s.event('custom', `${text}: so it has always been at ${c.name}, they say, for ${loreText(l)}.`, [], c.x, c.z, 4);
}

/**
 * Each day: now and then a sight in the sky is coming; each spring a white fawn may be born; and each band
 * keeps its beliefs and its customs (a day of rest falls on its day).
 */
export function omenDaily(s: Sim, dayOfYear: number) {
  const r = s.rOmen;
  const day = dayOf(s.tick);
  if (!s.sky || s.tick > s.sky.until + SKY_QUIET) {
    delete s.sky;
    const at = (h: number) => day * TICKS_PER_DAY + Math.round(h * TICKS_PER_HOUR);
    if (r.chance(SKY_CHANCE.eclipse)) { const h = r.int(11, 15); s.sky = { kind: 'eclipse', from: at(h), until: at(h + 1.5) }; }
    else if (r.chance(SKY_CHANCE.blood_moon)) s.sky = { kind: 'blood_moon', from: at(20), until: at(26) };
    else if (r.chance(SKY_CHANCE.comet)) s.sky = { kind: 'comet', from: at(19), until: at(19 + COMET_NIGHTS * 24) };
    else if (seasonOf(s.tick) === 3 && r.chance(SKY_CHANCE.lights)) s.sky = { kind: 'lights', from: at(21), until: at(25) };
  }
  // a white fawn in the spring, now and then
  if (dayOfYear === 6 && !s.deer.some((d) => d.alive && d.white) && r.chance(WHITE_FAWN)) {
    const fawns = s.deer.filter((d) => d.alive && d.fawn);
    if (fawns.length) fawns[r.int(0, fawns.length)].white = true;
  }
  for (const c of s.liveCamps()) {
    if (c.omen && c.omen.until < s.tick) delete c.omen;
    if (c.shelter && c.shelter.until <= s.tick) delete c.shelter;
    deathsSeen(s, c);
    upkeep(s, c, dayOfYear);
    for (const k of c.customs ?? []) {
      if (k.kind === 'rest_day' && k.day === dayOfYear) {
        shelter(s, c, day * TICKS_PER_DAY + 18 * TICKS_PER_HOUR, `Keeping the day of rest, as is the custom: ${k.text.toLowerCase()}.`, true);
        s.event('omen_habit', `No work was done at ${c.name} today, as is the custom.`, [], c.x, c.z, 1);
      }
    }
  }
}

/** At midwinter, a band whose custom it is leaves food out. */
export function midwinterOffering(s: Sim, c: Camp) {
  const k = c.customs?.find((x) => x.kind === 'offering');
  if (k) offer(s, c, 'At midwinter, as is the custom');
}

/** When a band splits, the new band keeps the old one's customs (its beliefs go with the people who hold them). */
export function carryCustoms(from: Camp, to: Camp) {
  if (from.customs?.length) to.customs = from.customs.map((k) => ({ ...k }));
}

/** A band's beliefs and customs, for the band panel. */
export function loreSummary(s: Sim, c: Camp) {
  return {
    beliefs: (c.lore ?? []).map((l) => {
      const { grown, hold } = holders(s, c, l.key);
      return { text: cap(loreText(l)), held: !!l.held, hold: hold.length, of: grown.length, since: yearOf(l.since), origin: l.origin, proven: l.proven };
    }),
    customs: (c.customs ?? []).map((k) => ({ text: k.text, since: yearOf(k.since) })),
  };
}

/** What someone believes, in words. */
export function beliefsOf(s: Sim, p: Person) {
  const c = s.campById(p.band);
  return (p.beliefs ?? []).map((key) => {
    const l = c?.lore?.find((x) => x.key === key) ?? s.camps.map((x) => x.lore?.find((y) => y.key === key)).find((y) => !!y);
    return l ? cap(loreText(l)) : null;
  }).filter((t): t is string => !!t);
}

/** The sight in the sky now, for the renderer (null: none, or not yet, or the comet by day). */
export function skyNow(s: Sim): SkyKind | null {
  const k = s.sky;
  if (!k || s.tick < k.from || s.tick > k.until) return null;
  if (k.kind === 'comet' && !isDark(s.tick)) return null;
  return k.kind;
}
