// The daily invariant checks, shared by tools/invariants.ts and the test suite.
// Call `check()` once a game day (at a tick that is a multiple of TICKS_PER_DAY): it records
// anything impossible it finds in `problems`, keyed by kind, with the first example of each.
import { WATER } from '../../src/sim/types';
import { Sim, isTreeType } from '../../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR, yearOf } from '../../src/sim/time';
import { CARRY, MATERIALS, specOf, foodTotal, RECIPES } from '../../src/sim/band';
import { knowHowFor } from '../../src/sim/know';

export interface Problem {
  count: number;
  first: string;
}

export class InvariantChecker {
  readonly problems = new Map<string, Problem>();
  /** consecutive daily checks each adult has been without a task (-1: homeless beside an empty home) */
  private idle = new Map<number, number>();

  constructor(readonly sim: Sim, readonly label = `seed ${sim.world.params.seed}`) {}

  private flag(kind: string, detail: string) {
    const p = this.problems.get(kind);
    if (p) p.count++;
    else this.problems.set(kind, { count: 1, first: detail });
  }

  /** The problems found so far, most frequent first, one line each. */
  report(): string[] {
    return [...this.problems].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => `${String(v.count).padStart(6)}  ${k}  e.g. ${v.first}`);
  }

  check() {
    const { sim } = this;
    const flag = this.flag.bind(this);
    const idleAdults = this.idle;
    const N = sim.N;
    const at = `${this.label} y${yearOf(sim.tick)} t${sim.tick}`;
    for (const c of sim.camps) for (const [k, v] of Object.entries(c.stock)) if (!(v >= -1e-6) || !Number.isFinite(v)) flag(`stock.${k} invalid`, `${at} ${c.name}: ${v}`);
    // (a camp is closed at the next morning's count after its last person dies)
    for (const c of sim.liveCamps()) if (!sim.members(c).length && sim.tick - (c.lastDeath ?? 0) > TICKS_PER_DAY) flag('living camp with nobody in it', `${at} ${c.name}`);
    for (const b of sim.buildings) if (!sim.campById(b.band)) flag('building of an unknown band', `${at} ${b.kind} ${b.id}`);
    for (const it of sim.items) {
      const c = sim.campById(it.band);
      if (!c) { flag('tool of an unknown band', `${at} ${it.kind} ${it.id}`); continue; }
      if (!(it.wear >= 0 && it.wear < 1)) flag('tool worn past breaking', `${at} ${it.kind} ${it.id} ${it.wear}`);
      const need = RECIPES[it.kind].knows;
      if (need && !c.knows.includes(need)) flag("tool the band doesn't know how to make", `${at} ${c.name}: ${it.kind}`);
      if (it.holder >= 0) {
        const h = sim.byId.get(it.holder);
        if (!h) flag('tool held by nobody', `${at} ${it.kind} ${it.id}`);
        else if (h.alive && h.band !== it.band) flag("tool held by someone of another band", `${at} ${h.name} ${it.kind}`);
        else if (!h.alive && h.buried) flag('tool held by the buried dead', `${at} ${h.name} ${it.kind}`);
        if (sim.items.filter((j) => j.holder === it.holder).length > 1) flag('two tools in one pair of hands', `${at} ${h?.name}`);
      }
    }
    for (const b of sim.buildings) {
      const c = sim.campById(b.band);
      for (const k of c ? knowHowFor(b) : []) if (!c!.knows.includes(k)) flag("building what the band doesn't know", `${at} ${c!.name}: ${b.kind} needs ${k}`);
    }
    for (const p of sim.people) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) flag('position NaN', `${at} ${p.name}`);
      if (p.x < 0 || p.z < 0 || p.x >= N || p.z >= N) flag('position off map', `${at} ${p.name} ${p.x},${p.z}`);
      if (!p.alive) {
        if (p.task) flag('dead person with a task', `${at} ${p.name}`);
        continue;
      }
      const band = sim.campById(p.band);
      if (!band) flag('person in an unknown band', `${at} ${p.name}`);
      else if (band.gone) flag('person in a band that is gone', `${at} ${p.name} of ${band.name}`);
      const homeB = p.home >= 0 ? sim.buildings.find((b) => b.id === p.home) : undefined;
      if (homeB && homeB.band !== p.band) flag("home in another band's camp", `${at} ${p.name}`);
      const tile = sim.tileOf(p);
      if (!sim.grid.walkable(tile) && sim.world.water[tile] === WATER.None && !p.indoors) flag('standing on unwalkable ground', `${at} ${p.name}`);
      if (sim.world.water[tile] !== WATER.None && sim.grid.cost[tile] === 0 && !p.indoors) flag('standing in deep water', `${at} ${p.name} tile ${tile}`);
      for (const k of ['food', 'rest', 'warmth', 'belonging', 'safety', 'health', 'mood'] as const) {
        const v = p[k];
        if (!(v >= 0 && v <= 100)) flag(`${k} out of range`, `${at} ${p.name} ${v}`);
      }
      if (p.partner >= 0) {
        const q = sim.byId.get(p.partner);
        if (!q) flag('partner missing', `${at} ${p.name}`);
        else if (q.alive && q.partner !== p.id) flag('partnership one-sided', `${at} ${p.name} -> ${q.name} -> ${q.partner}`);
        else if (!q.alive) flag('partnered to the dead', `${at} ${p.name} -> ${q.name}`);
        if (q && sim.isKin(p, q)) flag('partnered with kin', `${at} ${p.name} & ${q.name}`);
      }
      if (p.home >= 0 && !sim.buildings.some((b) => b.id === p.home)) flag('home missing', `${at} ${p.name}`);
      if (p.carer >= 0 && sim.age(p) < 2 && !sim.byId.get(p.carer)?.alive && !sim.byId.get(p.mother)?.alive && !sim.byId.get(p.father)?.alive) flag('infant with nobody caring for them', `${at} ${p.name}`);
      if (p.indoors && p.task?.kind !== 'sleep' && p.task?.kind !== 'warm' && sim.age(p) >= 2) flag('indoors without reason', `${at} ${p.name} ${p.task?.kind}`);
      if (p.carry === CARRY.Body && p.task?.kind !== 'bury') flag('carrying a body outside a burial', `${at} ${p.name} task ${p.task?.kind}`);
      if (p.task && sim.tick - p.task.started > 700 && p.task.kind !== 'sleep') flag('task stuck', `${at} ${p.name} ${p.task.kind} stage ${p.task.stage}`);
      // an adult with no task at several daily checks in a row is looping on something
      if (sim.age(p) >= 14 && !p.task) {
        const n = (idleAdults.get(p.id) ?? 0) + 1;
        idleAdults.set(p.id, n);
        if (n >= 3) flag('adult without a task for days', `${at} ${p.name}`);
      } else idleAdults.set(p.id, 0);
    }
    // unburied bodies should not lie around for long, nor stay hidden
    for (const p of sim.people) {
      if (p.alive || p.buried) continue;
      const buriers = !sim.campById(p.band)?.gone && sim.people.some((q) => q.alive && q.band === p.band && sim.age(q) >= 15);
      if (buriers && sim.tick - p.death > 6 * TICKS_PER_DAY) flag('body unburied for 6+ days', `${at} ${p.name} died t${p.death}`);
      const carried = sim.people.some((q) => q.alive && q.task?.kind === 'bury' && q.task.ref === p.id && q.carry === CARRY.Body);
      if (p.indoors && !carried) flag('body hidden but not carried', `${at} ${p.name}`);
    }
    // reservations must belong to living people still working on that thing
    for (const [k, pid] of sim.reserved) {
      const q = sim.byId.get(pid);
      if (!q || !q.alive || !q.task || q.task.ref !== k) flag('stale reservation', `${at} prop ${k} by ${q?.name} (${q?.task?.kind})`);
      if (!sim.propAlive[k]) flag('reservation on a removed prop', `${at} prop ${k}`);
    }
    // homes: a lived-in home belongs to someone alive; nobody sleeps rough while a home stands empty
    const living = sim.living();
    for (const b of sim.buildings) {
      if (!b.built || (b.kind !== 'hut' && b.kind !== 'leanto')) continue;
      const res = living.filter((p) => p.home === b.id);
      if (res.length && !sim.byId.get(b.owner)?.alive && res.some((p) => sim.age(p) >= 16)) flag('lived-in home owned by the dead', `${at} ${b.kind} ${b.id}`);
    }
    // within one band: an empty hut in an abandoned camp far away is no use to anyone
    // (vacantHomes() looks at the current camp, so switch it and put it back: the history hash reads it)
    const was = sim.camp;
    const homelessBesideEmpty = sim.liveCamps().some((c) => {
      sim.camp = c;
      return sim.vacantHomes().length > 0 && sim.members(c).some((p) => p.home < 0 && sim.age(p) >= 16);
    });
    sim.camp = was;
    if (homelessBesideEmpty) {
      const n = (idleAdults.get(-1) ?? 0) + 1;
      idleAdults.set(-1, n);
      if (n > 3) flag('homeless beside an empty home for days', `${at}`);
    } else idleAdults.set(-1, 0);
    // buildings
    const tiles = new Set<number>();
    // (a windbreak stands at the fire and a woodpile roof over the stockpile, on their tiles)
    const host = { windbreak: 'hearth', woodshed: 'stockpile' } as Record<string, string>;
    for (const b of sim.buildings) {
      if (host[b.kind]) {
        if (!sim.buildings.some((q) => q.band === b.band && q.kind === host[b.kind] && q.tile === b.tile)) flag(`${b.kind} away from its ${host[b.kind]}`, `${at} ${b.kind} ${b.id}`);
      } else {
        if (tiles.has(b.tile)) flag('two buildings on one tile', `${at} tile ${b.tile}`);
        tiles.add(b.tile);
      }
      for (const m of MATERIALS) if (b[m] > specOf(b)[m] + 6) flag('building over-supplied', `${at} ${b.kind} ${m} ${b[m]}`);
      if (!b.built && sim.tick - b.started > 2 * TICKS_PER_YEAR) flag('building unfinished for 2 years', `${at} ${b.kind}`);
    }
    // trees on the tile counter agree with props
    if (sim.tick % (TICKS_PER_DAY * 48) === 0) {
      const count = new Uint8Array(N * N);
      for (let k = 0; k < sim.propCount; k++) if (sim.propAlive[k] && isTreeType(sim.propType[k])) count[sim.propTile[k]]++;
      for (let i = 0; i < N * N; i++) if (count[i] !== sim.treesOnTile[i]) { flag('tree count drift', `${at} tile ${i} ${count[i]} vs ${sim.treesOnTile[i]}`); break; }
    }
    for (const c of sim.liveCamps()) if (foodTotal(c.stock) > 5000) flag('food hoard absurd', `${at} ${c.name} ${foodTotal(c.stock)}`);
    // nobody starves while there is food in their own band's store
    for (const p of sim.people) {
      const st = sim.campById(p.band)?.stock;
      if (st && !p.alive && p.death > sim.tick - TICKS_PER_DAY && p.cause === 'starvation' && foodTotal(st) > 10) flag('starved beside a full store', `${at} ${p.name} store ${foodTotal(st).toFixed(0)}`);
    }
  }
}

/** Run a world for `years`, checking invariants every game day. */
export function runChecked(sim: Sim, years: number, label?: string) {
  const checker = new InvariantChecker(sim, label);
  const end = sim.tick + years * TICKS_PER_YEAR;
  while (sim.tick < end) {
    sim.step();
    if (sim.tick % TICKS_PER_DAY === 0) checker.check();
  }
  return checker;
}
