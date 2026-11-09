// The smaller wild things of the land, kept alongside the deer and the wolves: wild boar rooting through the
// woods in sounders (a few sows and their striped young) and under the oaks for acorns in autumn; foxes
// about their earths, mousing in the grass at dusk and robbing any snare left with a hare in it overnight;
// and beavers at their lodges on the rivers and lakes, out at dusk to swim, to fell the birches along the
// bank (which leaves wood lying for the band) and to build their dam.
import type { Sim } from './sim';
import { isTreeType, treeSpecies, treeStage, LOGS, STUMP_BASE, WOOD_BY_STAGE, STAGE_WORD } from './sim';
import { Beast, Den, BEAST, BOAR, FOX, BEAVER, Person, SK } from './band';
import type { Camp } from './sim';
import { isDark, hourOf, seasonOf, snowLies, freshFrozen, TICKS_PER_DAY } from './time';
import { T, WATER, DIRS4 } from './types';

const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);
const isOak = (t: number) => isTreeType(t) && treeSpecies(t) === 1 && treeStage(t) >= 2;
/** Birches young or mature (beavers leave the saplings and can't manage the old ones). */
const isBeaverTree = (t: number) => isTreeType(t) && treeSpecies(t) === 2 && treeStage(t) >= 1 && treeStage(t) <= 2;

/** How long (ticks) a beaver gnaws at a birch before it comes down, and how often a lodge fells one. */
const GNAW_TICKS = 70;
const FELL_EVERY = 5 * TICKS_PER_DAY;
/** How much one night's work adds to a dam. */
const DAM_WORK = 0.04;

// ------------------------------------------------------------------ helpers
function tileAt(s: Sim, x: number, z: number) {
  const N = s.N, tx = Math.floor(x), tz = Math.floor(z);
  return tx < 0 || tz < 0 || tx >= N || tz >= N ? -1 : tz * N + tx;
}
/** Open water a beaver can swim in (fresh water only, and not while it is iced over). */
function swimmable(s: Sim, i: number) {
  if (i < 0) return false;
  const w = s.world.water[i];
  return (w === WATER.River || w === WATER.Lake) && !freshFrozen(s.tick);
}
/** Land next to fresh water. */
function bank(s: Sim, i: number) {
  if (i < 0 || s.world.water[i] !== WATER.None) return false;
  const N = s.N, x = i % N, z = (i / N) | 0;
  for (const [dx, dz] of DIRS4) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
    const w = s.world.water[nz * N + nx];
    if (w === WATER.River || w === WATER.Lake) return true;
  }
  return false;
}
/** Step a beast toward its target over walkable dry land (as the deer and wolves move). False if it is blocked. */
function walk(s: Sim, b: Beast, speed: number) {
  const dx = b.tx - b.x, dz = b.tz - b.z;
  const len = hyp(dx, dz);
  if (len < 0.12) return true;
  const st = Math.min(speed, len);
  const nx = b.x + (dx / len) * st, nz = b.z + (dz / len) * st;
  const from = s.tileOf(b), to = s.tileOf({ x: nx, z: nz });
  if (to === from || (s.grid.step(from, to) && s.world.water[to] === WATER.None)) {
    b.fx = b.x + dx;
    b.fz = b.z + dz;
    b.x = nx;
    b.z = nz;
    return true;
  }
  return false;
}
/** A beaver goes straight, over water and the bank alike. */
function paddle(b: Beast, speed: number) {
  const dx = b.tx - b.x, dz = b.tz - b.z;
  const len = hyp(dx, dz);
  if (len < 0.08) return;
  const st = Math.min(speed, len);
  b.fx = b.x + dx;
  b.fz = b.z + dz;
  b.x += (dx / len) * st;
  b.z += (dz / len) * st;
}
/** Where the renderer draws a snare in its tile (the same hash): a fox goes to just that spot. */
export function snareSpot(s: Sim, id: number, tile: number) {
  const h = (i: number) => ((id * 7919 + i * 104729) % 1000) / 1000;
  return { x: (tile % s.N) + 0.5 + (h(1) - 0.5) * 0.5, z: Math.floor(tile / s.N) + 0.5 + (h(2) - 0.5) * 0.5 };
}

// ------------------------------------------------------------------ placing
export function placeBeasts(s: Sim) {
  const r = s.rBeast, N = s.N, w = s.world;
  let land = 0;
  for (let i = 0; i < N * N; i++) if (w.water[i] === WATER.None) land++;
  const camps = s.liveCamps();
  const farFromCamps = (x: number, z: number, d: number) => !camps.some((c) => hyp(x - c.x, z - c.z) < d);
  const apart = (kind: number, x: number, z: number, d: number) => !s.dens.some((k) => k.kind === kind && hyp(k.x - x, k.z - z) < d);
  const want = [
    [BEAST.Boar, Math.max(1, Math.min(4, Math.floor(land / 2500)))],
    [BEAST.Fox, Math.max(1, Math.min(5, Math.floor(land / 2000)))],
    [BEAST.Beaver, Math.max(1, Math.min(3, Math.floor(land / 2500)))],
  ];
  for (const [kind, n] of want) {
    let made = 0;
    for (let tries = 0; made < n && tries < 6000; tries++) {
      const i = r.int(0, N * N);
      const x = (i % N) + 0.5, z = ((i / N) | 0) + 0.5;
      if (kind === BEAST.Beaver) {
        // a lodge in the water off a bank where birches grow
        if (!swimmableAtStart(s, i)) continue;
        const shore = DIRS4.map(([dx, dz]) => tileAt(s, x + dx, z + dz)).find((j) => j >= 0 && w.water[j] === WATER.None && s.grid.walkable(j));
        if (shore === undefined) continue;
        if (!farFromCamps(x, z, 9) || !apart(kind, x, z, 18)) continue;
        if (s.nearestProp(x, z, 6, (k) => isBeaverTree(s.propType[k])) < 0) continue;
        // the lodge sits in the water against the bank
        const sx = (shore % N) + 0.5, sz = ((shore / N) | 0) + 0.5;
        const lx = x + (sx - x) * 0.3, lz = z + (sz - z) * 0.3;
        const den: Den = { id: s.dens.length, kind, x: lx, z: lz, tx: lx, tz: lz, next: 0, dam: damSite(s, i), built: 0 };
        s.dens.push(den);
        const m = r.int(2, 5);
        for (let k = 0; k < m; k++) spawnBeast(s, den, lx, lz, false);
      } else {
        const t = w.terrain[i];
        if (w.water[i] !== WATER.None || !s.grid.walkable(i)) continue;
        if (kind === BEAST.Boar ? t !== T.Forest : t !== T.Forest && t !== T.Grass) continue;
        if (!farFromCamps(x, z, kind === BEAST.Boar ? 16 : 11) || !apart(kind, x, z, kind === BEAST.Boar ? 22 : 16)) continue;
        const den: Den = { id: s.dens.length, kind, x, z, tx: x, tz: z, next: 0 };
        s.dens.push(den);
        const m = kind === BEAST.Boar ? r.int(3, 6) : 2;
        for (let k = 0; k < m; k++) spawnBeast(s, den, x + r.range(-1, 1), z + r.range(-1, 1), false);
      }
      made++;
    }
  }
}
function swimmableAtStart(s: Sim, i: number) {
  const wk = s.world.water[i];
  return wk === WATER.River || wk === WATER.Lake;
}
/** A narrow place on a river near a lodge to dam: a river tile with dry land on two opposite sides. */
function damSite(s: Sim, near: number) {
  const N = s.N, x0 = near % N, z0 = (near / N) | 0;
  let best = -1, bd = 99;
  for (let dz = -4; dz <= 4; dz++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = x0 + dx, z = z0 + dz;
      if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
      const i = z * N + x;
      if (s.world.water[i] !== WATER.River) continue;
      const dry = (j: number) => s.world.water[j] === WATER.None;
      const across = (dry(i - 1) && dry(i + 1)) || (dry(i - N) && dry(i + N));
      const d = hyp(dx, dz);
      if (across && d < bd && d >= 1) { bd = d; best = i; }
    }
  return best;
}
export function spawnBeast(s: Sim, den: Den, x: number, z: number, young: boolean) {
  if (den.kind !== BEAST.Beaver && !s.dryLand(x, z)) {
    if (s.dryLand(den.x, den.z)) { x = den.x; z = den.z; } else return;
  }
  const state = den.kind === BEAST.Beaver ? BEAVER.Home : den.kind === BEAST.Fox ? FOX.Curl : BOAR.Stand;
  s.beasts.push({ id: s.newId(), kind: den.kind, den: den.id, x, z, tx: x, tz: z, fx: x + 1, fz: z, state, timer: 0, alive: true, young });
}

// ------------------------------------------------------------------ the tick
export function updateBeasts(s: Sim) {
  if (s.tick % 2) return;
  const people = s.people.filter((p) => p.alive && !p.indoors && s.age(p) >= 2);
  const dark = isDark(s.tick), hour = hourOf(s.tick);
  for (const den of s.dens) {
    const group = s.beasts.filter((b) => b.alive && b.den === den.id);
    if (!group.length) continue;
    if (den.kind === BEAST.Boar) boars(s, den, group, people, hour);
    else if (den.kind === BEAST.Fox) foxes(s, den, group, people, dark, hour);
    else beavers(s, den, group, people, dark, hour);
  }
}

/** Whoever is nearest within reach (a dog makes its keeper seen from further off), and any wolf. */
function nearestThreat(s: Sim, b: Beast, people: Person[], reach: number, wolves = 0) {
  let threat: { x: number; z: number } | null = null, td = 99;
  for (const p of people) {
    if (Math.abs(p.x - b.x) > reach + 2 || Math.abs(p.z - b.z) > reach + 2) continue;
    const r = reach + (s.hasDog(p) ? 1.5 : 0) - (p.task?.kind === 'hunt' ? 1.2 + Math.min(0.8, p.skills[SK.hunt] * 0.05) : 0);
    const d = hyp(p.x - b.x, p.z - b.z);
    if (d < r && d < td) { td = d; threat = p; }
  }
  if (wolves > 0) {
    const nw = s.nearestWolf(b.x, b.z);
    if (nw.wolf && nw.dist < wolves && nw.dist < td) { td = nw.dist; threat = nw.wolf; }
  }
  return { threat, dist: td };
}
function fleeFrom(b: Beast, t: { x: number; z: number }, far: number) {
  const ax = b.x - t.x, az = b.z - t.z, len = hyp(ax, az) || 1;
  b.tx = b.x + (ax / len) * far;
  b.tz = b.z + (az / len) * far;
}

// ------------------------------------------------------------------ wild boar
function boars(s: Sim, den: Den, group: Beast[], people: Person[], hour: number) {
  const r = s.rBeast;
  const autumn = seasonOf(s.tick) === 2;
  if (s.tick >= den.next) {
    den.next = s.tick + r.int(90, 220);
    den.tx = den.x + r.range(-8, 8);
    den.tz = den.z + r.range(-8, 8);
    // in autumn the sounder goes from oak to oak for the acorns
    if (autumn) {
      const k = s.nearestProp(den.x, den.z, 13, (k) => isOak(s.propType[k]) && !s.nutsTaken.has(k), (_k, d) => -d + r.range(0, 6));
      if (k >= 0) { den.tx = s.propX[k] + r.range(-0.6, 0.6); den.tz = s.propZ[k] + r.range(-0.6, 0.6); }
    } else {
      for (let n = 0; n < 4; n++) {
        const i = tileAt(s, den.tx, den.tz);
        if (i >= 0 && s.world.terrain[i] === T.Forest) break;
        den.tx = den.x + r.range(-8, 8);
        den.tz = den.z + r.range(-8, 8);
      }
    }
    if (!s.dryLand(den.tx, den.tz)) { den.tx = den.x; den.tz = den.z; }
  }
  const lead = group.find((b) => !b.young) ?? group[0];
  const midday = hour > 11 && hour < 16;
  for (const b of group) {
    const { threat, dist } = nearestThreat(s, b, people, 3.4, 5);
    if (threat && b.state !== BOAR.Run && b.state !== BOAR.Charge) {
      // a sow with young at heel, or a boar cornered close, turns and charges; the rest bolt for the thickets
      const young = group.some((q) => q.young);
      if (!b.young && dist < 2 && 'name' in threat && r.chance(young ? 0.35 : 0.15)) {
        b.state = BOAR.Charge;
        b.timer = 10;
        b.tx = threat.x;
        b.tz = threat.z;
      } else {
        b.state = BOAR.Run;
        b.timer = 22;
        fleeFrom(b, threat, 8);
      }
    }
    if (b.state === BOAR.Charge) {
      const target = threat ?? { x: b.tx, z: b.tz };
      b.tx = target.x;
      b.tz = target.z;
      walk(s, b, 0.9);
      // whoever it reaches is knocked down and gashed, and then it is off
      if (threat && 'name' in threat && hyp(threat.x - b.x, threat.z - b.z) < 0.45) gash(s, threat as Person);
      if (--b.timer <= 0 || (threat && hyp(threat.x - b.x, threat.z - b.z) < 0.45)) {
        b.state = BOAR.Run;
        b.timer = 20;
        if (threat) fleeFrom(b, threat, 8);
      }
      continue;
    }
    if (b.state === BOAR.Run) {
      if (!walk(s, b, (snowLies(s.tick) ? 0.5 : 0.62) * 2)) { b.tx = b.x + r.range(-4, 4); b.tz = b.z + r.range(-4, 4); }
      if (--b.timer <= 0) { b.state = BOAR.Stand; b.timer = r.int(6, 16); }
      continue;
    }
    if (b.timer > 0) b.timer--;
    else {
      // the young keep close to a sow; the sounder lies up in the heat of the day and roots the rest of it
      const roll = r.next();
      b.state = midday ? (roll < 0.75 ? BOAR.Lie : BOAR.Root) : roll < 0.55 ? BOAR.Root : roll < 0.85 ? BOAR.Walk : BOAR.Stand;
      b.timer = b.state === BOAR.Lie ? r.int(40, 90) : r.int(10, 40);
      const cx = b.young ? lead.x : den.tx, cz = b.young ? lead.z : den.tz;
      const spread = b.young ? 0.6 : 1.6;
      if (b.state === BOAR.Walk || b.state === BOAR.Root) { b.tx = cx + r.range(-spread, spread); b.tz = cz + r.range(-spread, spread); }
    }
    if (b.state === BOAR.Lie || b.state === BOAR.Stand) continue;
    // rooting: shuffling along nose down, turning the ground over
    if (!walk(s, b, (b.state === BOAR.Root ? 0.05 : 0.17) * 2)) { b.tx = b.x + r.range(-2, 2); b.tz = b.z + r.range(-2, 2); }
    // under an oak in autumn the sounder eats the acorns the band would have gathered
    if (autumn && b.state === BOAR.Root && !b.young && r.chance(0.004)) {
      const k = s.nearestProp(b.x, b.z, 1.2, (k) => isOak(s.propType[k]) && !s.nutsTaken.has(k));
      if (k >= 0) {
        s.nutsTaken.set(k, s.tick + TICKS_PER_DAY * 40);
        s.propNote.set(k, `Wild boar rooted up and ate the acorns under this oak, ${s.when(s.tick)}.`);
      }
    }
  }
}
/** A charging boar's tusks: a bad gash, and a story told after. */
function gash(s: Sim, p: Person) {
  if (p.health <= 6) return;
  p.health = Math.max(5, p.health - 28);
  p.safety = 0;
  s.remember(p, 'injured', -18, 2, -1, 'Gashed by a charging wild boar.');
  s.event('injury', `${p.name} was gashed by a charging wild boar.`, [p.id], p.x, p.z, 2);
}

// ------------------------------------------------------------------ foxes
function foxes(s: Sim, den: Den, group: Beast[], people: Person[], dark: boolean, hour: number) {
  const r = s.rBeast;
  const out = dark || hour < 7.5 || hour > 18.5;
  // a snare with a hare in it, close to the earth, draws a fox out to it by night
  if (out && den.raid === undefined && s.tick % 20 === 0) {
    const snare = s.items.find((it) => it.kind === 'snare' && (it.catch ?? 0) > 0 && it.tile !== undefined && it.tile >= 0
      && hyp((it.tile % s.N) + 0.5 - den.x, Math.floor(it.tile / s.N) + 0.5 - den.z) < 14
      // a camp that keeps dogs keeps the foxes off the snares close by it
      && !s.liveCamps().some((c) => hyp((it.tile! % s.N) - c.x, Math.floor(it.tile! / s.N) - c.z) < 14 && s.members(c).some((p) => p.dog !== undefined)));
    if (snare && r.chance(0.35)) den.raid = snare.id;
  }
  const raider = den.raid !== undefined ? group.find((b) => !b.young) : undefined;
  for (const b of group) {
    const { threat } = nearestThreat(s, b, people, 4, 6);
    if (threat && b.state !== FOX.Run) {
      b.state = FOX.Run;
      b.timer = 18;
      fleeFrom(b, threat, 7);
      if (b === raider) den.raid = undefined;
    }
    if (b.state === FOX.Run) {
      if (!walk(s, b, 0.7 * 2)) { b.tx = b.x + r.range(-4, 4); b.tz = b.z + r.range(-4, 4); }
      if (--b.timer <= 0) { b.state = FOX.Sit; b.timer = r.int(6, 14); }
      continue;
    }
    if (b === raider && den.raid !== undefined) {
      const it = s.items.find((q) => q.id === den.raid);
      if (!it || !(it.catch ?? 0) || it.tile === undefined || it.tile < 0) { den.raid = undefined; b.state = FOX.Sit; b.timer = 4; continue; }
      const at = snareSpot(s, it.id, it.tile);
      if (b.state !== FOX.Raid) {
        b.state = FOX.Trot;
        b.tx = at.x - 0.12;
        b.tz = at.z - 0.12;
        if (!walk(s, b, 0.32 * 2)) { den.raid = undefined; b.state = FOX.Sit; b.timer = 8; continue; }
        if (hyp(b.tx - b.x, b.tz - b.z) < 0.15) { b.state = FOX.Raid; b.timer = r.int(16, 26); b.fx = at.x; b.fz = at.z; }
        continue;
      }
      if (--b.timer > 0) continue;
      // the hare is gone from the noose, and the fox off with it
      it.catch = 0;
      robbed(s, it.band, at.x, at.z);
      den.raid = undefined;
      b.state = FOX.Trot;
      b.tx = den.x + r.range(-1, 1);
      b.tz = den.z + r.range(-1, 1);
      continue;
    }
    if (b.timer > 0) b.timer--;
    else if (!out) {
      // the day curled up in the earth's mouth, nose under the brush
      b.state = FOX.Curl;
      b.timer = r.int(30, 80);
      b.tx = den.x + r.range(-0.5, 0.5);
      b.tz = den.z + r.range(-0.5, 0.5);
    } else {
      const roll = r.next();
      b.state = b.young ? (roll < 0.5 ? FOX.Trot : FOX.Sit) : roll < 0.45 ? FOX.Trot : roll < 0.8 ? FOX.Mouse : FOX.Sit;
      b.timer = b.state === FOX.Mouse ? r.int(14, 30) : r.int(8, 26);
      if (b.state === FOX.Trot) {
        const reach = b.young ? 2 : 9;
        b.tx = den.x + r.range(-reach, reach);
        b.tz = den.z + r.range(-reach, reach);
        if (!s.dryLand(b.tx, b.tz)) { b.tx = den.x; b.tz = den.z; }
      }
      // mousing is done in long grass
      if (b.state === FOX.Mouse && s.world.terrain[s.tileOf(b)] !== T.Grass) { b.state = FOX.Sit; }
    }
    if (b.state === FOX.Trot || b.state === FOX.Curl) {
      if (!walk(s, b, 0.26 * 2)) { b.tx = b.x + r.range(-2, 2); b.tz = b.z + r.range(-2, 2); }
      else if (b.state === FOX.Trot && hyp(b.tx - b.x, b.tz - b.z) < 0.15) { b.state = FOX.Sit; b.timer = r.int(4, 12); }
    }
  }
}
function robbed(s: Sim, band: number, x: number, z: number) {
  const c = s.campById(band) as Camp | undefined;
  s.book('robbed.snares', 1, c ?? s.camp);
  if (c && !c.foxNoted) {
    c.foxNoted = true;
    s.event('fox', `A fox has been taking the hares from the snares of ${c.name} in the night.`, [], x, z, 2);
  }
}

// ------------------------------------------------------------------ beavers
function beavers(s: Sim, den: Den, group: Beast[], people: Person[], dark: boolean, hour: number) {
  const r = s.rBeast;
  const iced = freshFrozen(s.tick);
  const out = !iced && (dark || hour < 6.5 || hour > 19);
  const swimSpeed = 0.2 * 2, walkSpeed = 0.1 * 2;
  for (const b of group) {
    const { threat } = nearestThreat(s, b, people, 3, 4);
    // the tail slapped on the water, a dive, and back to the lodge
    if (threat && b.state !== BEAVER.Home && b.state !== BEAVER.Dive) {
      b.state = BEAVER.Dive;
      b.timer = r.int(40, 70);
      b.tx = den.x;
      b.tz = den.z;
    }
    if (b.state === BEAVER.Dive) {
      paddle(b, 0.5 * 2);
      if (hyp(den.x - b.x, den.z - b.z) < 0.1) { b.state = BEAVER.Home; b.timer = r.int(40, 90); }
      continue;
    }
    if (b.timer > 0) b.timer--;
    if (b.state === BEAVER.Home) {
      if (!out || b.timer > 0) continue;
      b.state = BEAVER.Swim;
    }
    if (b.state === BEAVER.Gnaw) {
      if (b.timer > 0) continue;
      // the birch comes down, its wood left lying on the bank (and the beaver back to the water)
      if (s.tick >= den.next) {
        const k = s.nearestProp(b.fx, b.fz, 0.6, (k) => isBeaverTree(s.propType[k]));
        if (k >= 0) {
          fell(s, k);
          den.next = s.tick + FELL_EVERY + r.int(0, TICKS_PER_DAY * 3);
        }
      }
      b.state = BEAVER.Swim;
      b.timer = r.int(20, 50);
      b.tx = den.x + r.range(-1, 1);
      b.tz = den.z + r.range(-1, 1);
      continue;
    }
    if (b.timer <= 0) {
      if (!out) {
        // home to the lodge for the day
        b.state = BEAVER.Swim;
        b.tx = den.x;
        b.tz = den.z;
        b.timer = 400;
      } else {
        const roll = r.next();
        let chosen = false;
        if (!b.young && roll < 0.3 && s.tick >= den.next) {
          // ashore to a birch near the water
          const k = s.nearestProp(den.x, den.z, 7, (k) => isBeaverTree(s.propType[k]) && bank(s, s.propTile[k]), (_k, d) => -d + r.range(0, 3));
          if (k >= 0) {
            b.state = BEAVER.Walk;
            b.fx = s.propX[k];
            b.fz = s.propZ[k];
            const a = r.range(0, Math.PI * 2);
            b.tx = s.propX[k] + Math.cos(a) * 0.14;
            b.tz = s.propZ[k] + Math.sin(a) * 0.14;
            b.timer = 160;
            chosen = true;
          }
        }
        if (!chosen && !b.young && roll < 0.55 && den.dam !== undefined && den.dam >= 0 && (den.built ?? 0) < 1) {
          // off to the dam with a branch
          b.state = BEAVER.Swim;
          b.tx = (den.dam % s.N) + 0.5 + r.range(-0.3, 0.3);
          b.tz = Math.floor(den.dam / s.N) + 0.5 + r.range(-0.3, 0.3);
          b.timer = r.int(60, 110);
          chosen = true;
        }
        if (!chosen) {
          // a swim round the lodge, or a sit on the bank
          b.state = roll < 0.85 ? BEAVER.Swim : BEAVER.Sit;
          b.timer = r.int(20, 60);
          for (let n = 0; n < 5; n++) {
            const x = den.x + r.range(-4, 4), z = den.z + r.range(-4, 4);
            if (swimmable(s, tileAt(s, x, z))) { b.tx = x; b.tz = z; break; }
          }
        }
      }
    }
    if (b.state === BEAVER.Sit) continue;
    const onLand = !swimmable(s, s.tileOf(b));
    paddle(b, onLand ? walkSpeed : swimSpeed);
    b.state = onLand ? BEAVER.Walk : BEAVER.Swim;
    if (hyp(b.tx - b.x, b.tz - b.z) >= 0.1) continue;
    if (!out && hyp(den.x - b.x, den.z - b.z) < 0.1) { b.state = BEAVER.Home; b.timer = 30; continue; }
    const tree = onLand && b.timer > 40 ? s.nearestProp(b.x, b.z, 0.35, (k) => isBeaverTree(s.propType[k])) : -1;
    if (tree >= 0) {
      // at the tree: up on the haunches to gnaw round the trunk
      b.state = BEAVER.Gnaw;
      b.timer = GNAW_TICKS + r.int(0, 30);
      b.fx = s.propX[tree];
      b.fz = s.propZ[tree];
    } else if (den.dam !== undefined && den.dam >= 0 && s.tileOf(b) === den.dam) {
      den.built = Math.min(1, (den.built ?? 0) + DAM_WORK * 0.25);
      b.timer = 0;
    } else if (onLand) b.state = BEAVER.Sit;
  }
}
/** A birch felled by beavers: a gnawed stump, and the trunk left lying for anyone to take. */
function fell(s: Sim, k: number) {
  const t = s.propType[k], sp = treeSpecies(t), stage = treeStage(t);
  const st = s.addProp(STUMP_BASE + sp, s.propX[k], s.propY[k], s.propZ[k], s.propRot[k], s.propScale[k]);
  const logs = s.addProp(LOGS, s.propX[k] + 0.12, s.propY[k], s.propZ[k] + 0.1, s.propRot[k], 0.8);
  s.propNote.set(st, `A ${STAGE_WORD[stage]} birch gnawed through by beavers, ${s.when(s.tick)}.`);
  s.propNote.set(logs, `A birch felled by beavers, ${s.when(s.tick)}.`);
  s.propVal[logs] = Math.round(WOOD_BY_STAGE[stage] * 0.6);
  s.removeProp(k);
}

/** A new range for a sounder: woods well away from every camp and from the other sounders, if there is any. */
function moveRange(s: Sim, den: Den) {
  const r = s.rBeast, N = s.N, camps = s.liveCamps();
  for (let tries = 0; tries < 400; tries++) {
    const i = r.int(0, N * N);
    const x = (i % N) + 0.5, z = ((i / N) | 0) + 0.5;
    if (s.world.water[i] !== WATER.None || s.world.terrain[i] !== T.Forest || !s.grid.walkable(i)) continue;
    if (camps.some((c) => hyp(x - c.x, z - c.z) < 20)) continue;
    if (s.dens.some((d) => d !== den && d.kind === BEAST.Boar && hyp(d.x - x, d.z - z) < 16)) continue;
    den.x = den.tx = x;
    den.z = den.tz = z;
    return;
  }
}

// ------------------------------------------------------------------ each morning
export function beastsDaily(s: Sim, dayOfYear: number) {
  const r = s.rBeast;
  for (const den of s.dens) {
    const group = s.beasts.filter((b) => b.alive && b.den === den.id);
    const grown = group.filter((b) => !b.young);
    if (den.kind === BEAST.Boar) {
      // the farrow comes in early spring, striped piglets that keep at the sows' heels till summer's end
      if (dayOfYear === 3 && grown.length >= 2 && group.length < 7) {
        const n = r.int(2, 6);
        for (let i = 0; i < n && group.length + i < 10; i++) spawnBeast(s, den, grown[0].x + r.range(-0.4, 0.4), grown[0].z + r.range(-0.4, 0.4), true);
      }
      if (dayOfYear === 26) for (const b of group) b.young = false;
      // the sounder splits when it grows too big: the young boars go off on their own
      if (dayOfYear === 30 && group.length > 6) for (const b of group.slice(6)) b.alive = false;
    } else if (den.kind === BEAST.Fox) {
      if (dayOfYear === 6 && grown.length >= 2 && group.length < 4) {
        const n = r.int(2, 5);
        for (let i = 0; i < n; i++) spawnBeast(s, den, den.x + r.range(-0.3, 0.3), den.z + r.range(-0.3, 0.3), true);
      }
      if (dayOfYear === 28) for (const b of group) b.young = false;
      // in autumn the grown cubs go off to find earths of their own
      if (dayOfYear === 32 && group.length > 2) for (const b of group.slice(2)) b.alive = false;
    } else {
      if (dayOfYear === 9 && grown.length >= 2 && group.length < 6) {
        const n = r.int(1, 4);
        for (let i = 0; i < n; i++) spawnBeast(s, den, den.x, den.z, true);
      }
      if (dayOfYear === 40) for (const b of group) b.young = false;
      if (dayOfYear === 44 && group.length > 5) for (const b of group.slice(5)) b.alive = false;
    }
    // a hard winter takes the odd one; an empty range is found again in time (not close to a camp)
    if (seasonOf(s.tick) === 3 && group.length > 2 && r.chance(0.006)) group[r.int(0, group.length)].alive = false;
    // (a sounder's range that people have settled close to is taken up again further off, in the woods)
    if (dayOfYear === 14 && !group.length && den.kind === BEAST.Boar && s.liveCamps().some((c) => hyp(c.x - den.x, c.z - den.z) < 18)) moveRange(s, den);
    if (dayOfYear === 14 && !group.length && r.chance(0.3) && !s.liveCamps().some((c) => hyp(c.x - den.x, c.z - den.z) < 18)) {
      for (let i = 0; i < (den.kind === BEAST.Boar ? 3 : 2); i++) spawnBeast(s, den, den.x + r.range(-0.5, 0.5), den.z + r.range(-0.5, 0.5), false);
    }
    // a sow left with too few to breed is joined by a boar from elsewhere in the spring
    if (den.kind === BEAST.Boar && dayOfYear === 2 && group.length > 0 && grown.length < 2 && r.chance(0.8)) spawnBeast(s, den, group[0].x, group[0].z, false);
    // a camp set down close by drives a sounder or a fox further off
    if (den.kind !== BEAST.Beaver) {
      const near = s.liveCamps().find((c) => hyp(c.x - den.x, c.z - den.z) < (den.kind === BEAST.Boar ? 10 : 7));
      if (near) {
        const len = hyp(den.x - near.x, den.z - near.z) || 1;
        const nx = den.x + ((den.x - near.x) / len) * 2, nz = den.z + ((den.z - near.z) / len) * 2;
        if (s.dryLand(nx, nz)) { den.x = nx; den.z = nz; }
      }
    }
    // the dam settles a little each winter (and is mended through the year)
    if (den.kind === BEAST.Beaver && den.built !== undefined && dayOfYear === 36) den.built = Math.max(0, den.built - 0.05);
  }
  if (s.beasts.length > 200) s.beasts = s.beasts.filter((b) => b.alive);
}

// ------------------------------------------------------------------ for the renderer and the cards
export const BEAST_STRIDE = 7;
/** The beasts: kind, id, where, a point it faces, its state (plus 10 for the young). */
export function packBeasts(s: Sim): Float32Array {
  const list = s.beasts.filter((b) => b.alive);
  const out = new Float32Array(list.length * BEAST_STRIDE);
  list.forEach((b, i) => {
    const o = i * BEAST_STRIDE;
    out[o] = b.kind;
    out[o + 1] = b.id;
    out[o + 2] = b.x;
    out[o + 3] = b.z;
    out[o + 4] = b.fx;
    out[o + 5] = b.fz;
    out[o + 6] = b.state + (b.young ? 10 : 0);
  });
  return out;
}
export const DEN_STRIDE = 5;
/** The beaver lodges and their dams: kind, where, the dam's tile (-1 none) and how far it is built. */
export function packDens(s: Sim): Float32Array {
  const list = s.dens.filter((d) => d.kind === BEAST.Beaver && s.beasts.some((b) => b.alive && b.den === d.id));
  const out = new Float32Array(list.length * DEN_STRIDE);
  list.forEach((d, i) => {
    const o = i * DEN_STRIDE;
    out[o] = d.kind;
    out[o + 1] = d.x;
    out[o + 2] = d.z;
    out[o + 3] = d.dam ?? -1;
    out[o + 4] = d.built ?? 0;
  });
  return out;
}

const DOING: Record<number, string[]> = {
  [BEAST.Boar]: ['Standing still, listening', 'Moving through the trees', 'Bolting for the thickets', 'Rooting for food', 'Lying up in a wallow', 'Charging'],
  [BEAST.Fox]: ['Sitting, watching', 'Trotting about its range', 'Running from people', 'Listening for mice in the grass', 'Curled up by the earth', 'Taking a hare from a snare'],
  [BEAST.Beaver]: ['Sitting on the bank', 'Waddling along the bank', 'Swimming', 'Gnawing through a birch', 'In the lodge', 'Diving with a slap of the tail'],
};
export function beastCard(s: Sim, b: Beast) {
  const den = s.dens[b.den];
  const group = s.beasts.filter((q) => q.alive && q.den === b.den);
  const young = group.filter((q) => q.young).length;
  if (b.kind === BEAST.Boar) {
    const sow = b.id % 3 !== 0;
    return {
      title: b.young ? 'Wild boar piglet' : sow ? 'Wild boar sow' : 'Wild boar',
      lines: [
        ['Sounder', `${group.length} boar${young ? `, ${young} ${young === 1 ? 'piglet' : 'piglets'}` : ''}`],
        ['Doing', !b.alive ? (b.killed ? 'Taken by hunters' : 'Gone') : DOING[b.kind][b.state] ?? ''],
        ['Meat', b.young ? 'About 3 meals' : 'About 10 meals'],
      ] as [string, string][],
      note: `A sounder roots through the woods, and in autumn goes from oak to oak for the acorns. A sow with young will charge anyone who comes too close. Hunters have brought down ${s.stats.boarKills ?? 0}.`,
    };
  }
  if (b.kind === BEAST.Fox) {
    return {
      title: b.young ? 'Fox cub' : 'Red fox',
      lines: [
        ['Earth', `${group.length} ${group.length === 1 ? 'fox' : 'foxes'}${young ? `, ${young} ${young === 1 ? 'cub' : 'cubs'}` : ''}`],
        ['Doing', !b.alive ? 'Gone' : DOING[b.kind][b.state] ?? ''],
      ] as [string, string][],
      note: 'Foxes lie up by day and hunt mice in the grass at dusk. A hare left in a snare overnight near their earth is often gone by morning, unless the camp keeps dogs.',
    };
  }
  const dam = den?.dam !== undefined && den.dam >= 0 ? (den.built ?? 0) >= 0.95 ? 'Built across the river' : `${Math.round((den.built ?? 0) * 100)}% built` : 'None (the lodge is on still water)';
  return {
    title: b.young ? 'Beaver kit' : 'Beaver',
    lines: [
      ['Lodge', `${group.length} ${group.length === 1 ? 'beaver' : 'beavers'}${young ? `, ${young} ${young === 1 ? 'kit' : 'kits'}` : ''}`],
      ['Doing', !b.alive ? 'Gone' : DOING[b.kind][b.state] ?? ''],
      ['Dam', dam],
    ] as [string, string][],
    note: 'Beavers come out at dusk to swim, to mend their dam and to fell the birches by the water. The wood they leave lying on the bank is there for the taking.',
  };
}
