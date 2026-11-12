// Pigs kept in a pen. A band that has learned to keep them brings striped piglets home alive from the boar hunt
// and pens them by the gardens; after that the pen keeps itself in pigs. Someone goes out to the pen each
// morning to feed them and muck it out; the sows farrow in spring; and in the autumn the pigs the band can't
// feed through the winter are killed for the stores, a few sows and a boar kept back to breed from. The pigs
// root about the pen by day, crowd the trough when the feed comes, and lie up in the sty at night.
import type { Sim, Camp } from './sim';
import { Pig, Building, BOAR, PEN_HOLDS, PIG_FEED, PIG_MEAT, PIG_MEAT_YOUNG, PIG_SOWS_KEPT, PIG_THIN_DAYS, PIG_LOST_DAYS, LITTER } from './band';
import { TICKS_PER_DAY, TICKS_PER_YEAR, isDark, seasonOf, seasonPos, hourOf, yearOf } from './time';

const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);
/** Pigs share the beasts' frame for the renderer, under ids of their own. */
export const PIG_ID = 8_000_000;
/** The renderer's kind for a penned pig (after the boar, fox and beaver). */
export const PIG_KIND = 3;
/** A pig grows up in its first year; it is old, and goes for the stores, at this many. */
const GROWN_YEARS = 1;
const OLD_YEARS = 7;

/** Where things are in a pen, in its own frame (forward: out through the gate). */
function inPen(b: Building, fwd: number, side: number) {
  const a = (b.rot * Math.PI) / 2;
  return { x: b.x + 0.5 + Math.sin(a) * fwd + Math.cos(a) * side, z: b.z + 0.5 + Math.cos(a) * fwd - Math.sin(a) * side };
}
/** The sty at the back of the pen, the trough by the gate, and where someone stands at the gate. */
export const styOf = (b: Building, k = 0) => inPen(b, -0.24 + ((k * 7) % 3) * 0.04, 0.16 + ((k % 4) - 1.5) * 0.07);
export const troughOf = (b: Building, k = 0) => inPen(b, 0.2, -0.16 + ((k % 5) - 2) * 0.06);
export const gateOf = (b: Building) => inPen(b, 0.66, 0);

export function penOf(s: Sim, c: Camp) {
  return s.buildings.find((b) => b.band === c.id && b.kind === 'pen' && b.built);
}
export function pigsOf(s: Sim, c: Camp) {
  return s.pigs.filter((g) => g.band === c.id);
}
export const grown = (s: Sim, g: Pig) => s.tick - g.born >= GROWN_YEARS * TICKS_PER_YEAR;
const ageOf = (s: Sim, g: Pig) => (s.tick - g.born) / TICKS_PER_YEAR;

/**
 * Whether the band's hunters should bring piglets home alive: it has a pen, and not yet a sow and a boar to
 * breed from (and a few to start with).
 */
export function pigsWanted(s: Sim, c: Camp) {
  if (!penOf(s, c)) return false;
  const herd = pigsOf(s, c);
  const carried = s.people.filter((p) => p.alive && p.band === c.id && p.task?.kind === 'hunt' && p.task.alive && p.task.stage === 2).length;
  return herd.length + carried < 3 || !herd.some((g) => g.sow) || !herd.some((g) => !g.sow);
}

export function addPig(s: Sim, c: Camp, pen: Building, sow: boolean, wild: boolean, at?: { x: number; z: number }) {
  const p0 = at ?? inPen(pen, 0, 0);
  const g: Pig = { id: s.newId(), band: c.id, pen: pen.id, sow, born: s.tick - (wild ? Math.round(TICKS_PER_YEAR * 0.2) : 0), x: p0.x, z: p0.z, tx: p0.x, tz: p0.z, fx: p0.x, fz: p0.z + 0.1, state: BOAR.Stand, timer: 0, fed: s.tick, wild };
  s.pigs.push(g);
  return g;
}

/** The pigs about their pen: rooting and wandering in it by day, at the trough when there is feed, in the sty by night. */
export function updatePigs(s: Sim) {
  if (s.tick % 2 || !s.pigs.length) return;
  const r = s.rPig, dark = isDark(s.tick), hour = hourOf(s.tick);
  const midday = hour > 12 && hour < 15;
  // someone at the gate with the feed
  const feeding = new Set<number>();
  for (const p of s.people) if (p.alive && p.task?.kind === 'pigs' && p.task.stage === 1) feeding.add(p.task.ref);
  for (let i = 0; i < s.pigs.length; i++) {
    const g = s.pigs[i];
    const pen = s.building(g.pen);
    if (!pen) continue;
    if (--g.timer <= 0) {
      if (dark) {
        const st = styOf(pen, i);
        g.tx = st.x; g.tz = st.z;
        g.state = hyp(g.x - st.x, g.z - st.z) < 0.05 ? BOAR.Lie : BOAR.Walk;
        g.timer = g.state === BOAR.Lie ? 60 : 4;
      } else if (feeding.has(pen.id)) {
        const tr = troughOf(pen, i);
        g.tx = tr.x; g.tz = tr.z;
        g.state = hyp(g.x - tr.x, g.z - tr.z) < 0.05 ? BOAR.Root : BOAR.Walk;
        g.timer = 6;
      } else {
        const roll = r.next();
        g.state = midday ? (roll < 0.6 ? BOAR.Lie : BOAR.Root) : roll < 0.5 ? BOAR.Root : roll < 0.8 ? BOAR.Walk : roll < 0.92 ? BOAR.Stand : BOAR.Lie;
        g.timer = g.state === BOAR.Lie ? r.int(30, 80) : r.int(8, 30);
        if (g.state === BOAR.Walk || g.state === BOAR.Root) {
          const pt = inPen(pen, r.range(-0.3, 0.3), r.range(-0.32, 0.32));
          g.tx = pt.x; g.tz = pt.z;
        }
        if (g.state === BOAR.Lie && r.chance(0.6)) {
          const st = styOf(pen, i);
          g.tx = st.x; g.tz = st.z;
          g.state = BOAR.Walk;
          g.timer = 6;
        }
      }
    }
    if (g.state === BOAR.Lie || g.state === BOAR.Stand) continue;
    const dx = g.tx - g.x, dz = g.tz - g.z, len = hyp(dx, dz);
    if (len < 0.02) continue;
    const st = Math.min(len, g.state === BOAR.Root ? 0.006 : 0.03);
    g.fx = g.x + dx;
    g.fz = g.z + dz;
    g.x += (dx / len) * st;
    g.z += (dz / len) * st;
  }
}

/**
 * Each morning: the pigs go hungry when nobody has fed them for days (and in the end break out and are lost),
 * the sows farrow in spring, and a pig too old to keep dies.
 */
export function pigsDaily(s: Sim) {
  if (!s.pigs.length) return;
  const r = s.rPig;
  const spring = seasonOf(s.tick) === 0 && seasonPos(s.tick) > 0.15;
  const lost = new Map<Camp, number>();
  for (const g of s.pigs.slice()) {
    const c = s.campById(g.band);
    const pen = s.building(g.pen);
    if (!c || c.gone || !pen) {
      s.pigs.splice(s.pigs.indexOf(g), 1);
      continue;
    }
    const hungry = (s.tick - g.fed) / TICKS_PER_DAY;
    if (hungry >= PIG_LOST_DAYS) {
      s.pigs.splice(s.pigs.indexOf(g), 1);
      s.book('pigs.lost', 1, c);
      lost.set(c, (lost.get(c) ?? 0) + 1);
      continue;
    }
    if (ageOf(s, g) > OLD_YEARS + 3) {
      s.pigs.splice(s.pigs.indexOf(g), 1);
      continue;
    }
    // a sow farrows once a spring, if there is a boar in the pen and she is fed (and room for the litter)
    if (spring && g.sow && grown(s, g) && hungry < PIG_THIN_DAYS && (g.farrowed ?? 0) < yearOf(s.tick) && r.chance(0.25)) {
      const herd = pigsOf(s, c);
      if (!herd.some((q) => !q.sow && grown(s, q)) || herd.length >= PEN_HOLDS * 2) continue;
      g.farrowed = yearOf(s.tick);
      const n = Math.min(PEN_HOLDS * 2 - herd.length, r.int(LITTER[0], LITTER[1] + 1));
      for (let k = 0; k < n; k++) addPig(s, c, pen, r.chance(0.5), false, { x: g.x + r.range(-0.05, 0.05), z: g.z + r.range(-0.05, 0.05) });
      s.book('pigs.born', n, c);
      if (!s.events.some((e) => e.kind === 'farrow' && e.text.includes(c.name))) s.event('farrow', `The first litter was born in the pig pen at ${c.name}: ${n} piglets.`, [], pen.x + 0.5, pen.z + 0.5, 2);
    }
  }
  for (const [c, n] of lost) {
    const pen = penOf(s, c);
    s.event('pig_lost', n === 1 ? `A hungry pig broke out of the pen at ${c.name} and ran off into the woods.` : `${n} hungry pigs broke out of the pen at ${c.name} and ran off into the woods.`, [], (pen?.x ?? c.x) + 0.5, (pen?.z ?? c.z) + 0.5, 1);
  }
}

/** What a day's feed for the herd takes from the stores (meals): most in winter, little in summer and autumn, when they find their own. */
export function pigFeed(s: Sim, c: Camp) {
  return pigsOf(s, c).reduce((n, g) => n + (grown(s, g) ? 1 : 0.5), 0) * PIG_FEED[seasonOf(s.tick)];
}

/**
 * The morning's feed: acorns, roots and greens from the stores first, then whatever else will do (not the dried
 * meat and fish). Returns the share of the feed that could be found. A band rationing its food gives them only half.
 */
export function feedPigs(s: Sim, c: Camp) {
  const want = pigFeed(s, c);
  // (a band rationing its own food gives them half, enough to keep them, not to fatten them)
  let left = c.rationing ? want * 0.5 : want;
  const order = ['greens', 'nuts', 'roots', 'berries', 'grain'] as const;
  for (const k of order) {
    const n = Math.min(left, Math.max(0, c.stock[k]));
    c.stock[k] -= n;
    left -= n;
    if (left <= 1e-6) break;
  }
  const given = (c.rationing ? want * 0.5 : want) - left;
  const got = want > 0 ? given / want : 1;
  s.book('pigs.fed', given, c);
  // fed if most of it was there (in summer and autumn they are turned out to root for themselves, and do well
  // enough without): a short feed keeps them for a day or two, no more
  const forage = seasonOf(s.tick) === 1 || seasonOf(s.tick) === 2;
  for (const g of pigsOf(s, c)) if (got >= 0.6 || forage) g.fed = s.tick;
  else if (got > 0) g.fed = Math.max(g.fed, s.tick - TICKS_PER_DAY * PIG_THIN_DAYS * 0.5);
  return got;
}

/**
 * The pig to kill for the stores, if any: in the autumn every pig the band will not keep through the winter (it
 * keeps a few young sows and one boar to breed from); any time, the old, or one more than the pen holds; and a band
 * going hungry eats into its herd down to a sow and a boar.
 */
export function pigToKill(s: Sim, c: Camp): Pig | undefined {
  const herd = pigsOf(s, c);
  if (!herd.length) return undefined;
  const autumn = seasonOf(s.tick) === 2 && seasonPos(s.tick) > 2.4 || seasonOf(s.tick) === 3 && seasonPos(s.tick) < 3.2;
  // (a band that has let its pigs go hungry keeps only a sow and a boar)
  const hungry = pigsHungry(s, c);
  // the breeding stock: the grown sows that have farrowed before (or the gilts nearest grown), and a boar
  const keep = new Set<number>();
  const byAge = herd.slice().sort((a, b) => a.born - b.born || a.id - b.id);
  // (the oldest first, even piglets: the first caught are the ones the pen is started with)
  const ready = (g: Pig) => ageOf(s, g) < OLD_YEARS;
  const sows = byAge.filter((g) => g.sow && ready(g)).slice(0, hungry ? 1 : PIG_SOWS_KEPT);
  const boar = byAge.find((g) => !g.sow && ready(g));
  for (const g of sows) keep.add(g.id);
  if (boar) keep.add(boar.id);
  const spare = herd.filter((g) => !keep.has(g.id)).sort((a, b) => a.born - b.born || a.id - b.id);
  if (!spare.length) return undefined;
  const old = spare.find((g) => ageOf(s, g) >= OLD_YEARS);
  if (old) return old;
  const grownN = herd.filter((g) => grown(s, g)).length;
  if (grownN > PEN_HOLDS) return spare.find((g) => grown(s, g)) ?? spare[0];
  // (when hungry, any the band can't feed; in the autumn, the piglets of this spring too, once big enough to be worth it)
  if (hungry) return spare[0];
  if (autumn) return spare.find((g) => ageOf(s, g) >= 0.4);
  return undefined;
}
/** Whether the band is short of feed for its pigs, and kills them down to a sow and a boar rather than let them go. */
export const pigsHungry = (s: Sim, c: Camp) => pigsOf(s, c).some((g) => s.tick - g.fed >= PIG_THIN_DAYS * TICKS_PER_DAY);
/** A pig killed for the stores: its meat (to carry home), with the hide, the bones and the tusks kept as a boar's are. */
export function killPig(s: Sim, c: Camp, g: Pig) {
  const meat = pigMeat(s, g);
  s.pigs.splice(s.pigs.indexOf(g), 1);
  s.book('pigs.killed', 1, c);
  s.book('pigs.meat', meat, c);
  return meat;
}
export const pigMeat = (s: Sim, g: Pig) => (grown(s, g) ? PIG_MEAT : PIG_MEAT_YOUNG);

export const PIG_STRIDE = 7;
/** The penned pigs for the renderer, in the beasts' frame layout (kind 3; a piglet in its first half-year drawn small). */
export function packPigs(s: Sim): Float32Array {
  const out = new Float32Array(s.pigs.length * PIG_STRIDE);
  s.pigs.forEach((g, i) => {
    const o = i * PIG_STRIDE;
    out[o] = PIG_KIND;
    out[o + 1] = PIG_ID + g.id;
    out[o + 2] = g.x;
    out[o + 3] = g.z;
    out[o + 4] = g.fx;
    out[o + 5] = g.fz;
    out[o + 6] = g.state + (ageOf(s, g) < 0.5 ? 10 : 0);
  });
  return out;
}

const DOING = ['Standing about the pen', 'Wandering the pen', 'Running', 'Rooting in the mud of the pen', 'Lying up', 'Charging'];
export function pigCard(s: Sim, g: Pig) {
  const c = s.campById(g.band);
  const herd = c ? pigsOf(s, c) : [];
  const age = ageOf(s, g);
  const young = age < GROWN_YEARS;
  const hungry = (s.tick - g.fed) / TICKS_PER_DAY;
  const pen = s.building(g.pen);
  const feeding = !!pen && s.people.some((p) => p.alive && p.task?.kind === 'pigs' && p.task.ref === pen.id && p.task.stage === 1);
  return {
    title: young ? 'Piglet' : g.sow ? 'Sow' : 'Boar',
    lines: [
      ['Kept by', c ? c.name : 'Nobody'],
      ['Age', age < 1 ? (g.wild ? 'Caught wild this year' : 'Born this spring') : `${Math.floor(age)} ${Math.floor(age) === 1 ? 'year' : 'years'}${g.wild ? ', caught wild as a piglet' : ''}`],
      ['Doing', feeding ? 'At the trough' : DOING[g.state] ?? ''],
      ['Fed', hungry < 1.2 ? 'This morning' : hungry < PIG_THIN_DAYS ? 'A day or two ago' : 'Not for days: it is growing thin'],
      ['Pen', `${herd.length} ${herd.length === 1 ? 'pig' : 'pigs'}, ${herd.filter((q) => ageOf(s, q) < GROWN_YEARS).length} young`],
      ['Meat', `About ${pigMeat(s, g)} meals`],
    ] as [string, string][],
    note: 'Fed each morning on acorns, roots and greens from the stores (in summer and autumn they find much of their own), the pigs breed in the pen. Those the band can\'t keep through the winter are killed in the autumn.',
  };
}
