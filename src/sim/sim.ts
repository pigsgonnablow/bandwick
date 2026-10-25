// The band simulation: one tick = 6 game minutes. Deterministic given the world seed
// (seeded random streams, stable iteration order, no browser-dependent math).
import { Rng, hash3 } from './rng';
import { Grid } from './path';
import { Tongue } from './names';
import {
  WorldData, WorldParams, WATER, T, SEA, SPECIES, STAGES, TREE_VARIANTS, smallPropId, propId, DIRS4, PROP_NAMES,
} from './types';
const PROP_NAMES_LOCAL = PROP_NAMES.map((n) => n.split('_')[0]);
import {
  Person, Building, BuildKind, BUILD, FIBER_PER_CORD, specOf, labelOf, wallsFor, Walls, Deer, Herd, Stock, SimEvent, Task, TaskKind, Memory,
  TRAITS, OPPOSED, Trait, SK, ACT, CARRY, foodTotal, TASK_KINDS, Ref, Card, CardLine,
} from './band';
import {
  TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_HOUR, START_TICK, DAYS_PER_YEAR,
  isDark, temperature, berriesRipe, freshFrozen, seasonPos, seasonOf, ageYears, yearOf, dayOf,
} from './time';
import { decide, runTask, abandon, sendHome, delivering } from './ai';

export const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);
const TREE_TYPES = SPECIES.length * STAGES * TREE_VARIANTS;
export const isTreeType = (t: number) => t < TREE_TYPES;
export const treeSpecies = (t: number) => Math.floor(t / (STAGES * TREE_VARIANTS));
export const treeStage = (t: number) => Math.floor(t / TREE_VARIANTS) % STAGES;
const WOOD_BY_STAGE = [2, 6, 14, 20];
/** fallen branches a tree drops in a year, gathered without felling it */
export const DEADWOOD_BY_STAGE = [0, 1, 2, 3];
/** kindling: bark stripped from a felled mature or old tree, and the cones picked up with a pine's branches */
export const BARK = 1;
export const CONES = 1;
export const STAGE_WORD = ['sapling', 'young', 'mature', 'old'];
/** Damp firewood (autumn and winter, no roof over the woodpile) burns this much faster. */
export const DAMP_BURN = 1.2;
/** How far a fire's warmth reaches, and with a windbreak behind it. */
export const WARM_RADIUS = 2.6;
export const WARM_RADIUS_SHELTERED = 3.2;
/** 'a' or 'an' for a word. */
export const art = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const SEASON_WORD = ['spring', 'summer', 'autumn', 'winter'];
const BERRY_BASE = smallPropId('berry', 0);
export const isBerry = (t: number) => t >= BERRY_BASE && t < BERRY_BASE + 3;
const GRASS_BASE = smallPropId('grass', 0);
const REEDS_BASE = smallPropId('reeds', 0);
export const isReeds = (t: number) => t >= REEDS_BASE && t < REEDS_BASE + 3;
/** Grass tussocks and reed beds: cut for fiber, and they grow back. */
export const isFiberPlant = (t: number) => isReeds(t) || (t >= GRASS_BASE && t < GRASS_BASE + 3);
/** Most fiber a clump holds when fully grown (reeds stand taller and thicker). */
export const fiberCap = (t: number) => (isReeds(t) ? 5 : 3);
const STUMP_BASE = propId('stump_v0');
const LOGS = propId('logs_v0');
const GRAVE = propId('grave_v0');

/** Annual chance of dying of old age, by age in years (piecewise linear). */
const MORTALITY: number[][] = [[0, 0.03], [2, 0.012], [5, 0.004], [15, 0.003], [35, 0.006], [50, 0.02], [60, 0.05], [70, 0.13], [80, 0.32], [90, 0.7]];
function annualMortality(age: number) {
  for (let i = 0; i < MORTALITY.length - 1; i++) {
    const [a0, m0] = MORTALITY[i], [a1, m1] = MORTALITY[i + 1];
    if (age <= a1) return m0 + ((m1 - m0) * Math.max(0, age - a0)) / (a1 - a0);
  }
  return 0.9;
}

export interface Camp {
  id: number;
  name: string;
  /** tick the camp was left for good (abandoned, emptied, or merged into another); 0 while lived in */
  gone: number;
  /** the camp its founders came from (-1 for the first band, or strangers) */
  parent: number;
  /** who led them here */
  leader: number;
  /** the tick of the last split or move, so a band doesn't break up again at once */
  settled: number;
  /** a sickness going through the band: until when, and how many it has taken (absent in older saves) */
  sickUntil?: number;
  sickDead?: number;
  /** the last death in the band, and the longest stretch without one already told of (in years) */
  lastDeath?: number;
  quietNoted?: number;
  /** what came into and went out of the stores: this year, last year, and since the camp began */
  ledger?: Ledger;
  /** when the band last went hungry, and last saw a fight (absent until it happens) */
  lastFamine?: number;
  lastFight?: number;
  /** the band's colour (hue in degrees, saturation and lightness 0..1); absent in older saves */
  color?: BandColor;
  /** how it came to be: 'first', 'strangers', 'amicable' (a friendly split), 'turmoil' (a bitter one or an exile), 'moved' */
  origin?: string;
  hearth: number; // building id
  x: number;
  z: number;
  tile: number;
  stock: Stock;
  graveyard: number; // tile
  founded: number;
  knowsPreserving: boolean;
  /** how to raise drystone walls (absent in older saves: not yet) */
  knowsStonework?: boolean;
  famine: boolean;
  hungryWinters: number;
  /** job weights from the planner, refreshed each morning */
  jobs: Record<string, number>;
  plan: string[];
}

export class Sim {
  tick = START_TICK;
  grid: Grid;
  N: number;
  people: Person[] = [];
  byId = new Map<number, Person>();
  buildings: Building[] = [];
  deer: Deer[] = [];
  herds: Herd[] = [];
  /** every band that has ever had a camp, in order of founding */
  camps: Camp[] = [];
  /** the band being worked on right now (each person's own while they think and act) */
  camp!: Camp;
  events: SimEvent[] = [];
  tongue: Tongue;
  rLife: Rng;
  rAi: Rng;
  rWild: Rng;
  anomaly = 0;
  private nextId = 1;
  private nextEvent = 1;

  // ---- mutable props (start as the generated world's, then change) ----
  propCount = 0;
  propType: Uint16Array;
  propX: Float32Array;
  propY: Float32Array;
  propZ: Float32Array;
  propRot: Float32Array;
  propScale: Float32Array;
  propAlive: Uint8Array;
  /** berries: fruit left; logs: wood left; trees: years in this stage */
  propVal: Float32Array;
  propTile: Uint32Array;
  propsVersion = 1;
  /** short histories of individual props: who felled a stump, where logs came from */
  propNote = new Map<number, string>();
  buildingsVersion = 1;
  reserved = new Map<number, number>(); // prop index -> person id
  /** trees partly chopped through: prop index -> ticks of work already done */
  chopped = new Map<number, number>();
  /** trees whose fallen branches were gathered: prop index -> tick when there is deadwood again */
  deadwoodTaken = new Map<number, number>();
  /** targets nobody could reach lately (prop index, or -(tile+1) for fishing spots) -> until tick */
  unreachable = new Map<number, number>();
  fish: Float32Array;
  fishCap: Float32Array;
  fishingSpots: number[] = [];
  /** dry land where mud can be dug: riverbank clay, and the banks of rivers and lakes */
  mudSpots: number[] = [];
  /** walkable ground at the foot of (or on) rock that holds stone: where stone can be quarried */
  quarryTiles: number[] = [];
  /** per tile: how many standing trees */
  treesOnTile: Uint8Array;
  stats = { births: 0, deaths: 0, peak: 0, starved: 0, froze: 0, kills: 0, felled: 0 };
  /** fortune's years: a year of plenty, a year the berries failed (year numbers; 0 for none yet) */
  plentyYear = 0;
  blightYear = 0;
  /** Snapshots of the band every few days, for the chronicle's charts. Recording them changes nothing. */
  history: HistorySample[] = [];

  /** @param save a saved game to continue (the world must be the one regenerated from its params) */
  constructor(public world: WorldData, save?: SaveData) {
    this.N = world.size;
    this.grid = new Grid(world);
    const seed = world.params.seed;
    this.rLife = Rng.stream(seed, 'life');
    this.rAi = Rng.stream(seed, 'ai');
    this.rWild = Rng.stream(seed, 'wild');
    this.tongue = new Tongue(Rng.stream(seed, 'tongue'));
    // props
    const cap = world.propCount + 4096;
    this.propType = new Uint16Array(cap);
    this.propX = new Float32Array(cap);
    this.propY = new Float32Array(cap);
    this.propZ = new Float32Array(cap);
    this.propRot = new Float32Array(cap);
    this.propScale = new Float32Array(cap);
    this.propAlive = new Uint8Array(cap);
    this.propVal = new Float32Array(cap);
    this.propTile = new Uint32Array(cap);
    this.treesOnTile = new Uint8Array(this.N * this.N);
    for (let k = 0; k < world.propCount; k++) {
      this.addProp(world.propType[k], world.propPos[k * 3], world.propPos[k * 3 + 1], world.propPos[k * 3 + 2],
        world.propRot[k], world.propScale[k]);
    }
    // fish in shallow water
    const NN = this.N * this.N;
    this.fish = new Float32Array(NN);
    this.fishCap = new Float32Array(NN);
    for (let i = 0; i < NN; i++) {
      if (world.water[i] === WATER.None) continue;
      const cap2 = world.water[i] === WATER.Lake ? 9 : world.water[i] === WATER.River ? 6 : world.terrain[i] === T.ShallowWater ? 7 : 0;
      this.fishCap[i] = cap2;
      this.fish[i] = cap2;
    }
    for (let i = 0; i < NN; i++) {
      if (world.water[i] !== WATER.None || !this.grid.walkable(i)) continue;
      const x = i % this.N, z = (i / this.N) | 0;
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.N || nz >= this.N) continue;
        if (this.fishCap[nz * this.N + nx] > 0) {
          this.fishingSpots.push(i);
          break;
        }
      }
    }
    for (let i = 0; i < NN; i++) {
      if (world.water[i] !== WATER.None || !this.grid.walkable(i)) continue;
      if (world.clay[i]) { this.mudSpots.push(i); continue; }
      const x = i % this.N, z = (i / this.N) | 0;
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= this.N || nz >= this.N) continue;
        const wt = world.water[nz * this.N + nx];
        if (wt === WATER.River || wt === WATER.Lake) {
          this.mudSpots.push(i);
          break;
        }
      }
    }
    for (let i = 0; i < NN; i++) {
      if (world.water[i] !== WATER.None || !this.grid.walkable(i)) continue;
      const x = i % this.N, z = (i / this.N) | 0;
      let rock = world.stone[i] > 0;
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx, nz = z + dz;
        if (nx >= 0 && nz >= 0 && nx < this.N && nz < this.N && world.stone[nz * this.N + nx] > 0) rock = true;
      }
      if (rock) this.quarryTiles.push(i);
    }
    if (save) {
      this.restore(save);
      return;
    }
    this.foundBand();
    this.placeHerds();
    this.plan();
  }

  // ------------------------------------------------------------------ saving
  /**
   * Everything needed to carry on exactly where this left off. The world itself is not saved:
   * it is regenerated from its params (checked against its hash). Continuing a loaded game gives
   * the same history, tick for tick, as never having saved.
   */
  serialize(): SaveData {
    const n = this.propCount;
    const rel = (m: Map<number, number>) => Array.from(m.entries());
    return {
      v: SAVE_VERSION,
      params: { ...this.world.params },
      worldHash: this.world.hash,
      tick: this.tick, anomaly: this.anomaly, nextId: this.nextId, nextEvent: this.nextEvent, eventHash: this.eventHash,
      rng: { life: this.rLife.getState(), ai: this.rAi.getState(), wild: this.rWild.getState(), tongue: this.tongue.r.getState() },
      props: {
        count: n,
        type: b64(this.propType.subarray(0, n)), x: b64(this.propX.subarray(0, n)), y: b64(this.propY.subarray(0, n)),
        z: b64(this.propZ.subarray(0, n)), rot: b64(this.propRot.subarray(0, n)), scale: b64(this.propScale.subarray(0, n)),
        alive: b64(this.propAlive.subarray(0, n)), val: b64(this.propVal.subarray(0, n)), tile: b64(this.propTile.subarray(0, n)),
      },
      propNote: Array.from(this.propNote.entries()),
      reserved: Array.from(this.reserved.entries()),
      unreachable: Array.from(this.unreachable.entries()),
      chopped: Array.from(this.chopped.entries()),
      deadwoodTaken: Array.from(this.deadwoodTaken.entries()),
      fish: b64(this.fish),
      stats: { ...this.stats },
      fortune: { plentyYear: this.plentyYear, blightYear: this.blightYear },
      history: this.history.map((h) => ({ ...h })),
      camps: structuredCloneSafe(this.camps),
      camp: structuredCloneSafe(this.camp),
      events: this.events.map((e) => ({ ...e, people: e.people.slice() })),
      people: this.people.map((p) => ({
        ...p, skills: Array.from(p.skills), rel: rel(p.rel), path: p.path ? b64(p.path) : null,
        task: p.task ? { ...p.task } : null, traits: p.traits.slice(), memories: p.memories.map((m) => ({ ...m })), children: p.children.slice(),
      })),
      buildings: this.buildings.map((b) => ({ ...b, builders: b.builders.slice() })),
      deer: this.deer.map((d) => ({ ...d })),
      herds: this.herds.map((h) => ({ ...h })),
    };
  }

  private restore(d: SaveData) {
    if (d.v !== SAVE_VERSION) throw new Error(`This save is from a different version of the game (format ${d.v}, this game reads ${SAVE_VERSION}).`);
    this.tick = d.tick;
    this.anomaly = d.anomaly;
    this.nextId = d.nextId;
    this.nextEvent = d.nextEvent;
    this.eventHash = d.eventHash;
    this.rLife.setState(d.rng.life);
    this.rAi.setState(d.rng.ai);
    this.rWild.setState(d.rng.wild);
    this.tongue.r.setState(d.rng.tongue);
    // props: replace the freshly generated ones with the saved, lived-in set
    const n = d.props.count;
    const cap = Math.max(n, this.world.propCount) + 4096;
    const into = <A extends Uint8Array | Uint16Array | Uint32Array | Float32Array>(make: { new (k: number): A; new (b: ArrayBuffer): A }, src: string): A => {
      const a = new make(cap);
      a.set(new make(unb64(src).buffer as ArrayBuffer));
      return a;
    };
    this.propType = into(Uint16Array, d.props.type);
    this.propX = into(Float32Array, d.props.x);
    this.propY = into(Float32Array, d.props.y);
    this.propZ = into(Float32Array, d.props.z);
    this.propRot = into(Float32Array, d.props.rot);
    this.propScale = into(Float32Array, d.props.scale);
    this.propAlive = into(Uint8Array, d.props.alive);
    this.propVal = into(Float32Array, d.props.val);
    this.propTile = into(Uint32Array, d.props.tile);
    this.propCount = n;
    this.treesOnTile.fill(0);
    for (let k = 0; k < n; k++) if (this.propAlive[k] && isTreeType(this.propType[k])) this.treesOnTile[this.propTile[k]]++;
    this.propNote = new Map(d.propNote);
    this.reserved = new Map(d.reserved);
    this.unreachable = new Map(d.unreachable);
    this.chopped = new Map(d.chopped);
    this.deadwoodTaken = new Map(d.deadwoodTaken);
    this.fish.set(new Float32Array(unb64(d.fish).buffer as ArrayBuffer));
    this.stats = { ...this.stats, ...d.stats };
    this.history = d.history ?? [];
    this.plentyYear = d.fortune?.plentyYear ?? 0;
    this.blightYear = d.fortune?.blightYear ?? 0;
    // saves from before there could be several bands hold just the one camp
    if (d.camps && d.camps.length) {
      this.camps = d.camps;
      this.camp = this.camps.find((c) => c.id === d.camp.id) ?? this.camps[0];
    } else {
      this.camp = { ...d.camp, id: d.camp.id ?? 0, gone: 0, parent: -1, leader: -1, settled: d.camp.founded };
      this.camps = [this.camp];
    }
    for (const c of this.camps) if (!c.color) { c.color = this.distinctColor(); c.origin ??= c.parent < 0 ? 'first' : 'amicable'; }
    // saves from before fiber and cordage
    for (const c of [...this.camps, this.camp]) { c.stock.fiber ??= 0; c.stock.cordage ??= 0; c.stock.mud ??= 0; c.stock.stone ??= 0; }
    this.events = d.events;
    this.people = d.people.map((p) => ({
      ...p, skills: Float32Array.from(p.skills), rel: new Map(p.rel), path: p.path !== null ? new Int32Array(unb64(p.path).buffer as ArrayBuffer) : null,
    })) as Person[];
    for (const p of this.people) p.band ??= this.camp.id;
    this.byId = new Map(this.people.map((p) => [p.id, p]));
    this.buildings = d.buildings as Building[];
    for (const b of this.buildings) { b.band ??= this.camp.id; b.fiber ??= 0; b.cordage ??= 0; b.mud ??= 0; b.stone ??= 0; }
    this.deer = d.deer as Deer[];
    this.herds = d.herds as Herd[];
    this.propsVersion++;
    this.buildingsVersion++;
  }

  // ------------------------------------------------------------------ props
  addProp(type: number, x: number, y: number, z: number, rot: number, scale: number) {
    if (this.propCount >= this.propType.length) this.growProps();
    const k = this.propCount++;
    this.propType[k] = type;
    this.propX[k] = x;
    this.propY[k] = y;
    this.propZ[k] = z;
    this.propRot[k] = rot;
    this.propScale[k] = scale;
    this.propAlive[k] = 1;
    const tile = Math.min(this.N - 1, Math.floor(z)) * this.N + Math.min(this.N - 1, Math.floor(x));
    this.propTile[k] = tile;
    this.propVal[k] = isFiberPlant(type) ? fiberCap(type) : 0;
    if (isTreeType(type)) this.treesOnTile[tile]++;
    this.propsVersion++;
    return k;
  }
  removeProp(k: number) {
    if (!this.propAlive[k]) return;
    this.propAlive[k] = 0;
    if (isTreeType(this.propType[k])) this.treesOnTile[this.propTile[k]]--;
    this.reserved.delete(k);
    this.chopped.delete(k);
    this.deadwoodTaken.delete(k);
    this.propsVersion++;
  }
  private growProps() {
    const grow = <A extends Float32Array | Uint16Array | Uint8Array | Uint32Array>(a: A): A => {
      const b = new (a.constructor as { new (n: number): A })(a.length * 2);
      b.set(a);
      return b;
    };
    this.propType = grow(this.propType);
    this.propX = grow(this.propX);
    this.propY = grow(this.propY);
    this.propZ = grow(this.propZ);
    this.propRot = grow(this.propRot);
    this.propScale = grow(this.propScale);
    this.propAlive = grow(this.propAlive);
    this.propVal = grow(this.propVal);
    this.propTile = grow(this.propTile);
  }

  // ------------------------------------------------------------------ setup
  /**
   * The best place for a camp: flat walkable grass near fresh water, wood and berries.
   * Optionally within a distance band of an origin, and clear of the other bands' camps.
   */
  chooseSite(opts: { from?: { x: number; z: number }; min?: number; max?: number; avoid?: number; reachFrom?: number } = {}) {
    const w = this.world, N = this.N;
    const berryTiles: number[] = [];
    const treeTiles: number[] = [];
    for (let k = 0; k < this.propCount; k++) {
      if (!this.propAlive[k]) continue;
      if (isBerry(this.propType[k])) berryTiles.push(this.propTile[k]);
      else if (isTreeType(this.propType[k]) && treeStage(this.propType[k]) >= 2) treeTiles.push(this.propTile[k]);
    }
    const near = (list: number[], x: number, z: number, r: number) => {
      let n = 0;
      for (const t of list) {
        const dx = (t % N) - x, dz = ((t / N) | 0) - z;
        if (dx * dx + dz * dz <= r * r) n++;
      }
      return n;
    };
    const freshDist = (x: number, z: number) => {
      let d = 99;
      for (let dz = -6; dz <= 6; dz++)
        for (let dx = -6; dx <= 6; dx++) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const wk = w.water[nz * N + nx];
          if (wk === WATER.River || wk === WATER.Lake) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dz)));
        }
      return d;
    };
    const others = this.camps.filter((c) => !c.gone);
    const avoid = opts.avoid ?? 0;
    const cands: { i: number; score: number }[] = [];
    for (let z = 6; z < N - 6; z += 2)
      for (let x = 6; x < N - 6; x += 2) {
        const i = z * N + x;
        if (w.terrain[i] !== T.Grass || w.water[i] !== WATER.None) continue;
        if (opts.from) {
          const d = hyp(x - opts.from.x, z - opts.from.z);
          if (d < (opts.min ?? 0) || d > (opts.max ?? 1e9)) continue;
        }
        if (avoid && others.some((c) => hyp(x - c.x, z - c.z) < avoid)) continue;
        // and clear of anything left standing where others once lived
        if (this.buildings.some((b) => Math.abs(b.x - x) <= 3 && Math.abs(b.z - z) <= 3)) continue;
        let flat = true;
        for (let dz = -2; dz <= 2 && flat; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const j = (z + dz) * N + x + dx;
            if (w.level[j] !== w.level[i] || w.water[j] !== WATER.None) { flat = false; break; }
          }
        if (!flat) continue;
        const fd = freshDist(x, z);
        if (fd > 6) continue;
        // a camp needs timber: a band burns a big tree every few days through winter
        const timber = near(treeTiles, x, z, 12);
        if (opts.from && timber < 30) continue;
        const score =
          -Math.abs(fd - 2.5) * 2 + Math.min(40, timber) * 0.25 + Math.min(10, near(berryTiles, x, z, 14)) * 0.9 +
          (w.fertility[i] / 255) * 3 - (w.level[i] - SEA) * 0.4 + (hash3(i, w.params.seed, 404 + this.camps.length) % 100) * 0.01;
        cands.push({ i, score });
      }
    cands.sort((a, b) => b.score - a.score);
    // the best few that can actually be walked to
    for (const c of cands.slice(0, 8)) {
      if (opts.reachFrom === undefined || opts.reachFrom === c.i || this.grid.find(opts.reachFrom, c.i, true)) return c.i;
    }
    return -1;
  }

  /** A new camp: a hearth on cleared ground, and a share of stores to start with. */
  foundCamp(tile: number, stock: Stock, parent: number, leader: number): Camp {
    const N = this.N;
    const prev = this.camp;
    const id = this.nextId++;
    const c: Camp = {
      id, name: this.tongue.place(), gone: 0, parent, leader, settled: this.tick,
      hearth: -1, x: (tile % N) + 0.5, z: Math.floor(tile / N) + 0.5, tile,
      stock, graveyard: -1, founded: this.tick, knowsPreserving: prev ? prev.knowsPreserving && parent === prev.id : false,
      knowsStonework: prev ? !!prev.knowsStonework && parent === prev.id : false,
      famine: false, hungryWinters: 0, jobs: {}, plan: [],
    };
    c.color = this.distinctColor();
    this.camps.push(c);
    this.camp = c;
    this.clearTile(tile);
    const hearth = this.newBuilding('hearth', tile, -1);
    hearth.built = true;
    hearth.fuel = 6;
    hearth.finished = this.tick;
    c.hearth = hearth.id;
    this.markStockpile(c);
    if (foodTotal(stock) + stock.wood > 0) this.book('brought', foodTotal(stock) + stock.wood, c);
    return c;
  }

  /** A colour as unlike every living band's as can be found (strangers, or the first band). */
  distinctColor(avoid: number[] = []): BandColor {
    const taken = [...this.liveCamps().map((c) => c.color?.h ?? -999), ...avoid];
    const dist = (h: number) => Math.min(999, ...taken.map((t) => Math.abs(((h - t + 540) % 360) - 180)));
    let best = 0, bd = -1;
    // a fixed starting point per world, so the same seed always paints the same
    const start = (hash3(this.world.params.seed, this.camps.length, 77) % 24) * 15;
    for (let k = 0; k < 24; k++) {
      const h = (start + k * 15) % 360;
      if (dist(h) > bd) { bd = dist(h); best = h; }
    }
    return { h: best, s: 0.68, l: 0.5 };
  }
  /** A friendly split: the parent's colour, lighter (and once as light as it goes, a near neighbour on the wheel). */
  lighterColor(p: BandColor): BandColor {
    if (p.l < 0.72) return { h: (p.h + 6) % 360, s: Math.max(0.45, p.s - 0.06), l: p.l + 0.11 };
    return { h: (p.h + 34) % 360, s: 0.62, l: 0.55 };
  }
  /** A bitter split: the colour across the wheel from the parent's, nudged clear of any band already there. */
  contrastColor(p: BandColor): BandColor {
    const opp = (p.h + 180) % 360;
    const taken = this.liveCamps().map((c) => c.color?.h ?? -999);
    const gap = (h: number) => Math.min(999, ...taken.map((t) => Math.abs(((h - t + 540) % 360) - 180)));
    // the opposite hue, or the nearest to it that stands clear of every living band (staying on the far side of the wheel)
    let h = opp, best = -1;
    for (const d of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
      const cand = (opp + d + 360) % 360;
      const score = Math.min(gap(cand), 40) * 10 - Math.abs(d);
      if (score > best) { best = score; h = cand; }
    }
    return { h, s: 0.72, l: 0.5 };
  }

  /** Mark out where everything gathered is brought: beside the hearth, on open ground. */
  markStockpile(c = this.camp) {
    const prev = this.camp;
    this.camp = c;
    const tile = this.siteFor('stockpile', null);
    if (tile >= 0) {
      this.clearTile(tile);
      const b = this.newBuilding('stockpile', tile, -1);
      b.built = true;
      b.finished = this.tick;
    }
    this.camp = prev;
  }

  /** Write a flow into a band's ledger (a new year starts a fresh page). */
  book(key: string, amount: number, c = this.camp) {
    if (!(amount > 0)) return;
    const year = yearOf(this.tick);
    const l = (c.ledger ??= { year, now: {}, last: {}, total: {} });
    if (l.year !== year) {
      l.last = l.year === year - 1 ? l.now : {};
      l.now = {};
      l.year = year;
    }
    l.now[key] = (l.now[key] ?? 0) + amount;
    l.total[key] = (l.total[key] ?? 0) + amount;
  }

  /** The first band, or a band of strangers come from beyond the map: ten people, two families, an elder. */
  private foundBand(strangers = false) {
    const N = this.N, w = this.world;
    let best = this.chooseSite({ avoid: strangers ? 24 : 0 });
    if (best < 0 && !strangers) {
      // fallback: any walkable grass tile nearest the centre
      for (let r = 0; r < N && best < 0; r++)
        for (let k = 0; k < N * N; k++) {
          const x = k % N, z = (k / N) | 0;
          if (Math.abs(x - N / 2) + Math.abs(z - N / 2) === r && w.terrain[k] === T.Grass) { best = k; break; }
        }
    }
    if (best < 0) return null;
    const cx = best % N, cz = (best / N) | 0;
    const camp = this.foundCamp(best, { berries: 14, meat: 14, fish: 0, preserved: 0, wood: 8, fiber: 4, cordage: 2, mud: 0, stone: 0 }, -1, -1);
    camp.origin = strangers ? 'strangers' : 'first';
    const r = this.rLife;
    const y = TICKS_PER_YEAR;
    const band: Person[] = [];
    const mk = (sex: 0 | 1, age: number, mother = -1, father = -1) => {
      const p = this.newPerson(sex, this.tick - Math.floor(age * y) - r.int(0, y), mother, father);
      band.push(p);
      return p;
    };
    const elder = mk(0, 57);
    const aMan = mk(1, 34), aWoman = mk(0, 31, elder.id);
    mk(0, 9, aWoman.id, aMan.id);
    mk(1, 5, aWoman.id, aMan.id);
    const bWoman = mk(0, 26), bMan = mk(1, 28);
    mk(r.chance(0.5) ? 0 : 1, 1.5, bWoman.id, bMan.id);
    mk(1, 21, elder.id);
    mk(0, 18);
    this.pair(aMan, aWoman, false);
    this.pair(bWoman, bMan, false);
    camp.leader = aMan.id;
    for (const p of band) {
      p.x = cx + 0.5 + r.range(-2, 2);
      p.z = cz + 0.5 + r.range(-2, 2);
      if (!this.grid.walkable(this.tileOf(p))) {
        p.x = cx + 0.5;
        p.z = cz + 0.5;
      }
      for (const q of band) {
        if (q === p) continue;
        const kin = this.isKin(p, q);
        p.rel.set(q.id, kin ? 45 + r.int(0, 20) : 8 + r.int(0, 22));
      }
      this.remember(p, 'arrived', 12, 2, -1, strangers ? `Came over the hills to ${camp.name}.` : `Came with the band to ${camp.name}.`);
    }
    this.event('founding', strangers
      ? `Strangers came over the hills: a band of ten made camp at ${camp.name}.`
      : `The band of ten makes camp at ${camp.name}.`, band.map((p) => p.id), cx + 0.5, cz + 0.5, 5);
    return camp;
  }

  private placeHerds() {
    const w = this.world, N = this.N;
    let land = 0;
    for (let i = 0; i < N * N; i++) if (w.water[i] === WATER.None) land++;
    const target = Math.max(3, Math.floor(land / 1100) + 2);
    const r = this.rWild;
    let tries = 0;
    while (this.herds.length < target && tries++ < 4000) {
      const i = r.int(0, N * N);
      const t = w.terrain[i];
      if ((t !== T.Forest && t !== T.Grass) || !this.grid.walkable(i)) continue;
      const x = (i % N) + 0.5, z = ((i / N) | 0) + 0.5;
      if (hyp(x - this.camp.x, z - this.camp.z) < 14) continue;
      if (this.herds.some((h) => hyp(h.hx - x, h.hz - z) < 16)) continue;
      const herd: Herd = { id: this.herds.length, hx: x, hz: z, tx: x, tz: z, next: 0 };
      this.herds.push(herd);
      const n = r.int(4, 8);
      for (let k = 0; k < n; k++) this.spawnDeer(herd, x + r.range(-1.5, 1.5), z + r.range(-1.5, 1.5), false);
    }
  }

  private spawnDeer(h: Herd, x: number, z: number, fawn: boolean) {
    const i = Math.floor(z) * this.N + Math.floor(x);
    if (!this.grid.walkable(i) || this.world.water[i] !== WATER.None) { x = h.hx; z = h.hz; }
    this.deer.push({ id: this.nextId++, herd: h.id, x, z, tx: x, tz: z, fx: x + 1, fz: z, state: 0, timer: 0, alive: true, fawn });
  }

  // ------------------------------------------------------------------ helpers
  tileOf(p: { x: number; z: number }) {
    const x = Math.min(this.N - 1, Math.max(0, Math.floor(p.x)));
    const z = Math.min(this.N - 1, Math.max(0, Math.floor(p.z)));
    return z * this.N + x;
  }
  age(p: Person) {
    return ageYears(this.tick, p.birth);
  }
  has(p: Person, t: Trait) {
    return p.traits.includes(t);
  }
  hearth(c = this.camp) {
    return this.buildings.find((b) => b.id === c.hearth)!;
  }
  campById(id: number) {
    return this.camps.find((c) => c.id === id);
  }
  /** The camp a person belongs to (their band's). */
  campOf(p: Person) {
    return this.campById(p.band) ?? this.camp;
  }
  /** Bands still living somewhere. */
  liveCamps() {
    return this.camps.filter((c) => !c.gone);
  }
  /** The living members of a band (the current one unless given). */
  members(c = this.camp) {
    return this.people.filter((p) => p.alive && p.band === c.id);
  }
  /** What a band has built. */
  bandBuildings(c = this.camp) {
    return this.buildings.filter((b) => b.band === c.id);
  }
  /** Where to bring things: food into the storehouse once there is one, wood (and everything before that) to the stockpile. */
  storeSpot(wood = false): { tile: number; x: number; z: number } {
    const store = wood ? undefined : this.buildings.find((b) => b.band === this.camp.id && b.kind === 'storehouse' && b.built);
    const s = store ?? this.buildings.find((b) => b.band === this.camp.id && b.kind === 'stockpile');
    if (s) return { tile: s.tile, x: s.x + 0.5, z: s.z + 0.5 };
    return { tile: this.camp.tile, x: this.camp.x + 0.55, z: this.camp.z + 0.8 };
  }
  hearthLit() {
    return this.hearth().fuel > 0;
  }
  isKin(a: Person, b: Person) {
    if (a.mother === b.id || a.father === b.id || b.mother === a.id || b.father === a.id) return true;
    if (a.mother >= 0 && a.mother === b.mother) return true;
    if (a.father >= 0 && a.father === b.father) return true;
    return false;
  }
  opinion(a: Person, b: Person) {
    return a.rel.get(b.id) ?? 0;
  }
  adjust(a: Person, b: Person, d: number) {
    a.rel.set(b.id, Math.max(-100, Math.min(100, (a.rel.get(b.id) ?? 0) + d)));
  }
  living() {
    return this.people.filter((p) => p.alive);
  }
  tempAt(p: Person) {
    const lvl = this.world.level[this.tileOf(p)];
    return temperature(this.tick, this.anomaly, Math.max(0, lvl - SEA - 1));
  }

  newPerson(sex: 0 | 1, birth: number, mother: number, father: number): Person {
    const r = this.rLife;
    const traits: Trait[] = [];
    const nTraits = r.chance(0.35) ? 3 : 2;
    const mom = this.byId.get(mother), dad = this.byId.get(father);
    const inherited = [...(mom?.traits ?? []), ...(dad?.traits ?? [])];
    while (traits.length < nTraits) {
      const t: Trait = inherited.length && r.chance(0.35) ? r.pick(inherited) : r.pick(TRAITS);
      if (traits.includes(t)) continue;
      if (OPPOSED.some(([a, b]) => (t === a && traits.includes(b)) || (t === b && traits.includes(a)))) continue;
      traits.push(t);
    }
    const age = ageYears(this.tick, birth);
    const skills = new Float32Array(6);
    for (let k = 0; k < 6; k++) skills[k] = age < 8 ? 0 : Math.min(14, r.range(1, 4) + Math.max(0, age - 10) * r.range(0.1, 0.35));
    const p: Person = {
      id: this.nextId++, band: this.camp ? this.camp.id : 0, name: this.uniqueName(sex), sex, birth, mother, father, partner: -1,
      samesex: r.chance(0.08), alive: true, death: 0, cause: '', buried: false,
      x: this.camp ? this.camp.x : 0, z: this.camp ? this.camp.z : 0, fx: 0, fz: 0,
      path: null, pathIdx: 0, task: null, nextThink: 0,
      food: 75, rest: 80, warmth: 85, safety: 70, belonging: 70, health: 100, mood: 70, sick: 0,
      traits, skills, carry: CARRY.None, carryAmt: 0, home: -1, indoors: false, act: ACT.Idle,
      thought: 'Looking around.', memories: [], rel: new Map(), pregnantUntil: 0, babyFather: -1,
      look: r.nextU32(), kills: 0, children: [], mourned: 0, carer: -1,
    };
    if (r.chance(0.03)) p.hardy = true;
    this.people.push(p);
    this.byId.set(p.id, p);
    if (mom) mom.children.push(p.id);
    if (dad) dad.children.push(p.id);
    return p;
  }

  private uniqueName(sex: 0 | 1) {
    for (let k = 0; k < 20; k++) {
      const n = this.tongue.name(sex);
      // avoid names that sound alike within the band
      if (!this.people.some((p) => p.alive && p.name.slice(0, 3) === n.slice(0, 3))) return n;
    }
    return this.tongue.name(sex);
  }

  pair(a: Person, b: Person, announce = true) {
    a.partner = b.id;
    b.partner = a.id;
    this.adjust(a, b, 15);
    this.adjust(b, a, 15);
    if (announce) {
      this.remember(a, 'paired', 30, 3, b.id, `Joined with ${b.name}.`);
      this.remember(b, 'paired', 30, 3, a.id, `Joined with ${a.name}.`);
      this.event('pairing', `${a.name} and ${b.name} became partners.`, [a.id, b.id], a.x, a.z, 2);
    }
  }

  remember(p: Person, kind: string, weight: number, years: number, subject: number, text: string) {
    p.memories.push({ kind, tick: this.tick, weight, years, subject, text });
    if (p.memories.length > 12) {
      // forget the faintest memory
      let worst = 0, worstV = Infinity;
      p.memories.forEach((m, i) => {
        const v = Math.abs(this.memoryNow(m));
        if (v < worstV) { worstV = v; worst = i; }
      });
      p.memories.splice(worst, 1);
    }
  }
  memoryNow(m: Memory) {
    const age = (this.tick - m.tick) / TICKS_PER_YEAR;
    return m.weight * Math.max(0, 1 - age / m.years);
  }

  event(kind: string, text: string, people: number[], x: number, z: number, weight: number) {
    this.events.push({ id: this.nextEvent++, tick: this.tick, kind, text, people, x, z, weight });
    let h = this.eventHash;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    this.eventHash = Math.imul(h ^ this.tick, 0x01000193);
  }
  private eventHash = 0x811c9dc5;

  /**
   * A fingerprint of the whole history so far: everything that has happened, and where everyone
   * is and how they are right now. Two runs of the same seed agree on it at the same tick, on any
   * machine or browser.
   */
  historyHash(): string {
    let h = this.eventHash;
    const mix = (v: number) => (h = Math.imul(h ^ (v | 0), 0x01000193));
    mix(this.tick);
    for (const p of this.people) {
      mix(p.id);
      mix(p.alive ? 1 : 0);
      mix(Math.floor(p.x * 256));
      mix(Math.floor(p.z * 256));
      mix(Math.floor(p.food * 16));
      mix(Math.floor(p.health * 16));
    }
    const st = this.camp.stock;
    for (const v of [st.berries, st.meat, st.fish, st.preserved, st.wood]) mix(Math.floor(v * 16));
    mix(this.propCount);
    mix(this.buildings.length);
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  newBuilding(kind: BuildKind, tile: number, owner: number): Building {
    const N = this.N;
    const b: Building = {
      id: this.nextId++, band: this.camp ? this.camp.id : 0, kind, tile, x: tile % N, z: Math.floor(tile / N),
      rot: hash3(tile, this.world.params.seed, 7) & 3, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0, work: 0, built: false, owner,
      fuel: 0, started: this.tick, finished: 0, builders: [],
    };
    this.buildings.push(b);
    this.buildingsVersion++;
    return b;
  }

  /** Remove small props from a tile so something can be built on it. */
  clearTile(tile: number) {
    for (let k = 0; k < this.propCount; k++) {
      if (!this.propAlive[k] || this.propTile[k] !== tile) continue;
      const t = this.propType[k];
      if (isTreeType(t)) {
        // a building site gets a stump and a pile of usable logs
        const sp = treeSpecies(t);
        const st = this.addProp(STUMP_BASE + sp, this.propX[k], this.propY[k], this.propZ[k], this.propRot[k], this.propScale[k]);
        const logs = this.addProp(LOGS, this.propX[k] + 0.12, this.propY[k], this.propZ[k] + 0.1, this.propRot[k], 1);
        const what = `${STAGE_WORD[treeStage(t)]} ${SPECIES[sp]}`;
        this.propNote.set(st, `${art(what) === 'an' ? 'An' : 'A'} ${what} cut down to clear ground for building, ${this.when(this.tick)}.`);
        this.propNote.set(logs, `Wood from ${art(what)} ${what} cleared for building.`);
        this.propVal[logs] = WOOD_BY_STAGE[treeStage(t)];
      }
      this.removeProp(k);
    }
  }

  // ------------------------------------------------------------------ the tick
  step() {
    this.tick++;
    const t = this.tick;
    if (t % TICKS_PER_DAY === 6 * TICKS_PER_HOUR) this.daily();
    if (t % TICKS_PER_HOUR === 0) this.hourly();
    const ppl = this.people;
    for (let i = 0; i < ppl.length; i++) {
      const p = ppl[i];
      if (!p.alive) continue;
      if (p.band !== this.camp.id) this.camp = this.campOf(p);
      this.needs(p);
      if ((t + p.id) % 10 === 0 && p.alive && isDark(t) && !p.indoors && this.age(p) >= 2) this.wildAttack(p);
      if (!p.alive) continue;
      if (this.age(p) < 2) {
        this.carriedInfant(p);
        continue;
      }
      // someone carrying goods home doesn't stop to rethink, only for an emergency
      if (!p.task || (t >= p.nextThink && !delivering(p)) || ((t + p.id) % 10 === 0 && this.urgent(p))) decide(this, p);
      if (p.task) runTask(this, p);
    }
    this.updateDeer();
  }

  /** Infants stay with their mother (or whoever looks after them). */
  private carriedInfant(p: Person) {
    const m = this.byId.get(p.mother), f = this.byId.get(p.father), fo = this.byId.get(p.carer);
    const carer = m && m.alive ? m : f && f.alive ? f : fo;
    p.task = null;
    if (carer && carer.alive) {
      p.x = carer.x + 0.12;
      p.z = carer.z + 0.08;
      p.indoors = carer.indoors;
      p.act = carer.act === ACT.Sleep ? ACT.Sleep : carer.act === ACT.Walk || carer.act === ACT.Run ? ACT.Walk : ACT.Sit;
      p.thought = carer.act === ACT.Sleep ? 'Asleep beside ' + carer.name + '.' : 'With ' + carer.name + '.';
      p.food = Math.max(p.food, carer.food > 20 ? 70 : p.food);
      p.warmth = Math.max(p.warmth, carer.warmth - 5);
    } else {
      // an orphaned infant is taken in by the kindest adult in camp
      const adults = this.members().filter((q) => this.age(q) >= 16);
      adults.sort((a, b) => (this.has(b, 'kind') ? 1 : 0) - (this.has(a, 'kind') ? 1 : 0) || a.id - b.id);
      const foster = adults[0];
      if (foster) {
        // the foster raises the child; the records keep the birth parents (and so who is kin)
        p.carer = foster.id;
        p.home = foster.home;
        this.remember(foster, 'fostered', 20, 3, p.id, `Took in little ${p.name}.`);
        this.event('fostering', `${foster.name} took in the orphaned ${p.name}.`, [foster.id, p.id], foster.x, foster.z, 3);
      }
    }
  }

  private urgent(p: Person) {
    const k = p.task?.kind;
    // starving: go and eat. Only when the store is bare is it worth staying out to hunt, fish or forage
    // (far from camp, turn back sooner: the walk home costs food too)
    const gathering = k === 'hunt' || k === 'fish' || k === 'forage';
    const starveAt = 15 + Math.min(22, hyp(p.x - this.camp.x, p.z - this.camp.z) * 0.6);
    // (carrying food home, they eat from what they carry instead)
    const foodInHand = delivering(p) && p.carryAmt >= 1 && (p.carry === CARRY.Berries || p.carry === CARRY.Meat || p.carry === CARRY.Fish);
    if (p.food < starveAt && !foodInHand && k !== 'eat' && k !== 'eatwild' && (!gathering || foodTotal(this.camp.stock) >= 0.4)) return true;
    const woodRun = (k === 'fell' || k === 'haul' || k === 'deadwood') && this.hearth().fuel < 2;
    if (p.warmth < (woodRun ? 8 : 18) && k !== 'warm' && k !== 'sleep') return true;
    // worn out on the way home with a load: the bed is at camp, where they're going anyway
    if (p.rest < 8 && k !== 'sleep' && !delivering(p)) return true;
    // at nightfall, workers who haven't started back yet call it a day
    // except wood runs in the cold when the store is low: coming home empty-handed means a cold night
    const emergency = (k === 'fell' || k === 'haul' || k === 'deadwood') && (this.hearth().fuel < 2 || this.camp.stock.wood < 20) && this.tempAt(p) < 12;
    // (a burial, once begun, is seen through: a body far out on the land is not left another night)
    if (k && !emergency && p.task!.stage === 0 && isDark(this.tick) && !['sleep', 'warm', 'eat', 'fuel', 'socialize', 'idle', 'bury', 'twist'].includes(k)) return true;
    return false;
  }

  // ------------------------------------------------------------------ needs & health
  private needs(p: Person) {
    const age = this.age(p);
    const working = p.act === ACT.Chop || p.act === ACT.Build || p.act === ACT.Hunt || p.act === ACT.Dig;
    p.food -= (working ? 0.27 : 0.2) * (age < 12 ? 0.8 : 1) * (this.has(p, 'greedy') ? 1.1 : 1);
    if (p.act !== ACT.Sleep) p.rest -= working ? 0.62 : 0.48;
    p.belonging -= 0.09;
    // cold
    const temp = this.tempAt(p);
    // a windbreak behind the fire throws its heat back and keeps the wind off: a wider, warmer circle
    const sheltered = this.hasBuilt('windbreak');
    const nearFire = this.hearthLit() && hyp(p.x - this.camp.x, p.z - this.camp.z) < (sheltered ? WARM_RADIUS_SHELTERED : WARM_RADIUS);
    let shelter = 0;
    if (p.indoors && p.home >= 0) {
      const b = this.buildings.find((q) => q.id === p.home);
      if (b) shelter = specOf(b).shelter;
    }
    if (temp < 15) p.warmth -= (15 - temp) * 0.018 * (1 - shelter) * (age < 3 || age > 60 ? 1.25 : 1);
    else p.warmth += 0.5;
    if (nearFire) p.warmth += sheltered ? 1.7 : 1.3;
    if (p.indoors && shelter > 0 && temp > -2) p.warmth += 0.15;
    // safety: dark without a fire or shelter is unsettling
    const dark = isDark(this.tick);
    const safe = !dark || nearFire || p.indoors;
    p.safety += safe ? 0.4 : -0.35;
    p.food = clamp(p.food);
    p.rest = clamp(p.rest);
    p.warmth = clamp(p.warmth);
    p.belonging = clamp(p.belonging);
    p.safety = clamp(p.safety);

    // health
    let dmg = 0;
    if (p.food < 8) dmg += 0.045;
    if (p.warmth < 22) dmg += 0.05;
    if (p.warmth < 8) dmg += 0.12;
    if (p.sick > 0) dmg += 0.03;
    if (dmg > 0) p.health -= dmg;
    else if (p.food > 30 && p.warmth > 30) p.health += 0.012;
    p.health = clamp(p.health);
    if (p.health <= 0) {
      // whatever was doing the most harm (cold at its worst outweighs hunger)
      const hungerHarm = p.food < 8 ? 0.045 : 0, coldHarm = p.warmth < 8 ? 0.17 : p.warmth < 22 ? 0.05 : 0;
      const cause = hungerHarm || coldHarm ? (coldHarm >= hungerHarm ? 'cold' : 'starvation') : p.sick > 0 ? 'fever' : 'weakness';
      this.kill(p, cause);
      return;
    }
    // mood: needs plus what they remember
    let mem = 0;
    for (const m of p.memories) mem += this.memoryNow(m);
    p.mood = clamp(
      p.food * 0.24 + p.rest * 0.16 + p.warmth * 0.18 + p.belonging * 0.16 + p.safety * 0.1 + p.health * 0.16 + mem * 0.35,
    );
  }

  kill(p: Person, cause: string, killer?: Person) {
    if (!p.alive) return;
    if (killer) p.killer = killer.id;
    const band = this.campById(p.band);
    if (band) band.lastDeath = this.tick;
    p.alive = false;
    p.death = this.tick;
    p.cause = cause;
    p.act = ACT.Dead;
    // return anything set aside for their task, lay down a body they carried; logs drop where they fall
    abandon(this, p, true);
    if (p.carry !== CARRY.None) this.dropCarry(p);
    p.act = ACT.Dead;
    this.stats.deaths++;
    if (cause === 'starvation') this.stats.starved++;
    if (cause === 'cold') this.stats.froze++;
    const age = Math.floor(this.age(p));
    const partner = this.byId.get(p.partner);
    // a home passes to the partner, or else to the eldest adult still living in it
    for (const b of this.buildings) {
      if (b.owner !== p.id) continue;
      const heir = partner && partner.alive ? partner
        : this.living().filter((q) => q.home === b.id && this.age(q) >= 16).sort((a, c) => a.birth - c.birth || a.id - c.id)[0];
      if (heir) {
        b.owner = heir.id;
        this.buildingsVersion++;
      }
    }
    this.buildingsVersion++;
    if (partner) partner.partner = -1;
    // grief spreads through kin and friends
    for (const q of this.living()) {
      const op = this.opinion(q, p);
      const kin = this.isKin(q, p) || q.id === p.partner;
      if (kin || op > 40) {
        const w = kin ? (q.id === p.partner || p.mother === q.id || p.father === q.id ? -55 : -40) : -20;
        this.remember(q, 'death', w, kin ? 4 : 2, p.id, `${p.name} died (${cause}).`);
      }
    }
    const causeText: Record<string, string> = {
      starvation: 'starved', cold: 'froze to death', fever: 'died of fever', 'old age': 'died of old age',
      weakness: 'wasted away', childbirth: 'died giving birth', hunting: 'was killed on a hunt', infancy: 'died in infancy',
      accident: 'died in an accident', sickness: 'was taken by the sickness', drowning: 'drowned', wolves: 'was killed by wolves',
      bear: 'was killed by a bear', killed: `was killed by ${killer?.name ?? 'someone'}`,
    };
    const violent = cause === 'killed' || cause === 'wolves' || cause === 'bear' || cause === 'drowning';
    this.event('death', `${p.name}, ${age}, ${causeText[cause] ?? 'died'}.`, [p.id, ...(killer ? [killer.id] : [])], p.x, p.z, age < 2 ? 2 : violent ? 4 : 3);
    // the infant of a mother who dies may not survive either: handled by the fostering rule
  }

  /** Put down whatever they carry where they stand: logs stay as a pile, food is lost (and booked as spoiled). */
  dropCarry(p: Person) {
    const k = p.carry;
    const food = k === CARRY.Berries ? 'berries' : k === CARRY.Meat ? 'meat' : k === CARRY.Fish ? 'fish' : '';
    if (food && p.carryAmt > 0) this.book(`spoiled.${food}`, p.carryAmt);
    if (k === CARRY.Log && p.carryAmt > 0) {
      const lp = this.addProp(LOGS, p.x, this.world.groundY[this.tileOf(p)], p.z, 0, 0.8);
      this.propVal[lp] = p.carryAmt;
    }
    p.carry = CARRY.None;
    p.carryAmt = 0;
  }

  releaseTask(p: Person) {
    const t = p.task;
    if (!t) return;
    if (t.ref >= 0 && this.reserved.get(t.ref) === p.id) this.reserved.delete(t.ref);
  }

  // ------------------------------------------------------------------ hourly & daily
  private hourly() {
    for (const c of this.liveCamps()) this.burn(this.hearth(c));
    // fish recover slowly
    if (this.tick % (TICKS_PER_HOUR * 6) === 0) {
      for (let i = 0; i < this.fish.length; i++) {
        const c = this.fishCap[i];
        if (c > 0 && this.fish[i] < c) this.fish[i] = Math.min(c, this.fish[i] + 0.06 * c * (1 - this.fish[i] / (c * 1.05)) + 0.02);
      }
    }
  }

  private burn(h: Building) {
    if (h.fuel > 0) {
      h.fuel = Math.max(0, h.fuel - this.burnRate(h));
      if (h.fuel === 0) this.buildingsVersion++;
    }
  }

  /** Wood a fire eats each tick: a big fire through winter nights, in warm weather just a cooking fire; damp wood goes faster. */
  burnRate(h: Building) {
    const season = seasonOf(this.tick);
    const k = season === 3 ? 1.35 : season === 1 ? 0.45 : 0.75;
    return (isDark(this.tick) ? 0.34 : 0.19) * k * (this.dampWood(h.band) ? DAMP_BURN : 1);
  }

  /** Whether a band has finished building something of this kind. */
  hasBuilt(kind: BuildKind, band = this.camp.id) {
    return this.buildings.some((b) => b.band === band && b.kind === kind && b.built);
  }

  /** Firewood stacked in the open is damp through autumn and winter, unless the woodpile has a roof. */
  dampWood(band = this.camp.id) {
    return seasonOf(this.tick) >= 2 && !this.hasBuilt('woodshed', band);
  }

  private daily() {
    const t = this.tick;
    const day = dayOf(t);
    const dayOfYear = day % DAYS_PER_YEAR;
    const r = this.rLife;
    // a new year: new climate
    const here = this.liveCamps()[0] ?? this.camp;
    if (dayOfYear === 0) {
      this.anomaly = this.anomaly * 0.5 + r.range(-3.2, 2.6);
      if (this.anomaly < -3.2) this.event('climate', `Year ${yearOf(t)} turns cold early.`, [], here.x, here.z, 2);
    }
    if (dayOfYear === 36) {
      // winter's first morning
      if (this.anomaly < -2.5) {
        const names = this.liveCamps().map((c) => c.name);
        this.event('winter', `A bitter winter sets in${names.length === 1 ? ` over ${names[0]}` : names.length ? ' over the land' : ''}.`, [], here.x, here.z, 3);
        for (const p of this.living()) this.remember(p, 'harsh_winter', -10, 2, -1, 'Lived through a bitter winter.');
      }
    }
    for (const [k, until] of this.unreachable) if (until <= this.tick) this.unreachable.delete(k);
    for (const [k, until] of this.deadwoodTaken) if (until <= this.tick) this.deadwoodTaken.delete(k);
    this.berries(dayOfYear);
    this.grasses();
    this.trees(dayOfYear);
    this.herdsDaily(dayOfYear);
    // each band's own day: stores, births and deaths, and the morning plan
    for (const c of this.liveCamps()) {
      this.camp = c;
      this.spoil();
      this.life();
    }
    this.bands(dayOfYear);
    this.fortune(dayOfYear);
    for (const c of this.liveCamps()) {
      this.camp = c;
      this.plan();
    }
    this.stats.peak = Math.max(this.stats.peak, this.living().length);
    if (day % HISTORY_EVERY_DAYS === 0) this.sample();
  }

  private spoil() {
    const s = this.camp.stock;
    const before = { ...s };
    this.spoilNow(s);
    for (const k of ['berries', 'meat', 'fish', 'preserved'] as const) this.book(`spoiled.${k}`, before[k] - s[k]);
  }
  private spoilNow(s: Stock) {
    const cold = seasonOf(this.tick) === 3 ? 0.4 : seasonOf(this.tick) === 0 || seasonOf(this.tick) === 2 ? 0.75 : 1;
    const house = this.buildings.find((b) => b.band === this.camp.id && b.kind === 'storehouse' && b.built);
    const store = house ? specOf(house).keep : 1;
    s.berries *= 1 - 0.06 * cold * store;
    s.fish *= 1 - 0.05 * cold * store;
    s.meat *= 1 - 0.035 * cold * store;
    s.preserved *= 1 - 0.004;
  }

  private berries(dayOfYear: number) {
    // bushes fruit at the start of the ripe window and lose what is left when it ends
    const ripe = berriesRipe(this.tick);
    for (let k = 0; k < this.propCount; k++) {
      if (!this.propAlive[k] || !isBerry(this.propType[k])) continue;
      if (ripe && this.propVal[k] === 0 && dayOfYear === 18) {
        const tile = this.propTile[k];
        const m = this.world.moisture[tile] / 255;
        const year = yearOf(this.tick);
        this.propVal[k] = (5 + m * 4 + this.rWild.range(-1, 1.5)) * (this.blightYear === year ? 0.15 : this.plentyYear === year ? 2 : 1);
        this.propsVersion++;
      } else if (!ripe && this.propVal[k] > 0) {
        this.propVal[k] = 0;
        this.propsVersion++;
      }
    }
  }

  /** Cut grass and reeds grow back through spring and summer, slowly in autumn, not at all in winter. */
  private grasses() {
    const rate = [0.3, 0.3, 0.12, 0][seasonOf(this.tick)];
    if (!rate) return;
    for (let k = 0; k < this.propCount; k++) {
      if (!this.propAlive[k] || !isFiberPlant(this.propType[k])) continue;
      const cap = fiberCap(this.propType[k]);
      if (this.propVal[k] < cap) this.propVal[k] = Math.min(cap, this.propVal[k] + rate * (isReeds(this.propType[k]) ? 1.4 : 1));
    }
  }

  private trees(dayOfYear: number) {
    if (dayOfYear !== 2) return;
    // each spring: trees grow up a stage now and then, mature trees seed the ground near them,
    // and old stumps rot away
    const r = this.rWild;
    const N = this.N;
    const n = this.propCount;
    for (let k = 0; k < n; k++) {
      if (!this.propAlive[k]) continue;
      const type = this.propType[k];
      if (type >= STUMP_BASE && type < STUMP_BASE + 3) {
        this.propVal[k] += 1;
        const sp = type - STUMP_BASE;
        // oak and birch stumps often sprout again (coppice); pines do not
        if (sp !== 0 && this.propVal[k] >= 2 && this.propVal[k] <= 5 && r.chance(0.18) && !this.buildings.some((b) => b.tile === this.propTile[k])) {
          const id = sp * STAGES * TREE_VARIANTS + r.int(0, 3);
          const sap = this.addProp(id, this.propX[k] + 0.08, this.propY[k], this.propZ[k] + 0.06, r.range(0, 6.28), r.range(0.85, 1.05));
          this.propNote.set(sap, `Sprouted from the stump of a felled ${SPECIES[sp]}.`);
          this.removeProp(k);
          continue;
        }
        if (this.propVal[k] > 6 && r.chance(0.3)) this.removeProp(k);
        continue;
      }
      if (!isTreeType(type)) continue;
      const st = treeStage(type);
      this.propVal[k] += 1;
      const years = [3, 5, 9][st] ?? 99;
      if (st < 3 && this.propVal[k] >= years && r.chance(0.5)) {
        if (this.reserved.has(k) || this.chopped.has(k)) continue;
        this.propType[k] = type + TREE_VARIANTS;
        this.propVal[k] = 0;
        this.propsVersion++;
      }
      if (st >= 2 && r.chance(0.035)) {
        const tx = Math.floor(this.propX[k]) + r.int(-2, 3), tz = Math.floor(this.propZ[k]) + r.int(-2, 3);
        if (tx < 1 || tz < 1 || tx >= N - 1 || tz >= N - 1) continue;
        const ti = tz * N + tx;
        const tt = this.world.terrain[ti];
        if ((tt !== T.Grass && tt !== T.Forest) || this.world.water[ti] !== WATER.None) continue;
        if (this.treesOnTile[ti] >= 2) continue;
        if (this.camps.some((c) => !c.gone && hyp(tx - c.x, tz - c.z) < 6)) continue;
        if (this.buildings.some((b) => b.tile === ti)) continue;
        const sp = treeSpecies(type);
        const id = sp * STAGES * TREE_VARIANTS + r.int(0, 3);
        this.addProp(id, tx + r.range(0.2, 0.8), this.world.groundY[ti], tz + r.range(0.2, 0.8), r.range(0, 6.28), r.range(0.85, 1.1));
      }
    }
  }

  private herdsDaily(dayOfYear: number) {
    const r = this.rWild;
    for (const h of this.herds) {
      const members = this.deer.filter((d) => d.alive && d.herd === h.id);
      if (dayOfYear === 4 && members.length >= 2) {
        const fawns = Math.floor(members.length / 4) + (r.chance(0.45) ? 1 : 0);
        for (let k = 0; k < fawns && members.length + k < 9; k++) this.spawnDeer(h, members[0].x, members[0].z, true);
      }
      if (dayOfYear === 30) for (const d of members) d.fawn = false;
      if (seasonOf(this.tick) === 3 && r.chance(0.01)) {
        const victim = members[r.int(0, Math.max(1, members.length))];
        if (victim) victim.alive = false;
      }
    }
    // a hunted-out range is slowly refilled by deer drifting in from the wilds (not right beside camp)
    if (dayOfYear === 6) {
      for (const h of this.herds) {
        if (this.deer.some((d) => d.alive && d.herd === h.id)) continue;
        if (this.camps.some((c) => !c.gone && hyp(h.hx - c.x, h.hz - c.z) <= 20) || !r.chance(0.3)) continue;
        for (let k = 0; k < 3; k++) this.spawnDeer(h, h.hx, h.hz, false);
      }
    }
    if (this.deer.length > 400) this.deer = this.deer.filter((d) => d.alive);
  }

  // ------------------------------------------------------------------ births, deaths, pairing
  private life() {
    const r = this.rLife;
    const living = this.members();
    const food = foodTotal(this.camp.stock);
    const pop = living.length;
    const foodDays = food / Math.max(1, pop * 1.8);
    for (const p of living) {
      const age = this.age(p);
      // coming of age
      const prev = age - 1 / DAYS_PER_YEAR;
      if (age >= 14 && prev < 14) {
        this.event('age', `${p.name} came of age.`, [p.id], p.x, p.z, 1);
        this.remember(p, 'came_of_age', 10, 2, -1, 'Came of age.');
      }
      // old age, illness, infancy
      let daily = annualMortality(age) / DAYS_PER_YEAR;
      if (p.health < 40) daily *= 2;
      if (p.hardy && age > 50) daily *= 0.3;
      if (r.next() < daily) {
        this.kill(p, age < 3 ? 'infancy' : age > 50 ? 'old age' : 'fever');
        continue;
      }
      // a sickness going through the camp takes the youngest and the oldest first
      if (p.sick > 0 && (this.camp.sickUntil ?? 0) > this.tick && r.next() < (age < 3 || age > 60 ? 0.03 : age < 12 ? 0.01 : 0.005)) {
        this.camp.sickDead = (this.camp.sickDead ?? 0) + 1;
        this.kill(p, 'sickness');
        continue;
      }
      // the very old are remembered for it
      for (const milestone of [80, 90, 100]) {
        if (age >= milestone && prev < milestone) {
          this.event('elder', milestone >= 90 ? `${p.name} turned ${milestone}. No one has known anyone so old.` : `${p.name} turned ${milestone}.`, [p.id], p.x, p.z, milestone >= 90 ? 4 : 3);
          for (const q of this.members()) if (q !== p) this.adjust(q, p, 5);
        }
      }
      // fevers come with cold and hunger
      if (p.sick > 0) {
        p.sick--;
        if (p.sick === 0) this.remember(p, 'recovered', 5, 1, -1, 'Recovered from a fever.');
      } else {
        let chance = 0.0035;
        if (p.warmth < 35) chance *= 3;
        if (p.food < 30) chance *= 2.5;
        if (seasonOf(this.tick) === 3) chance *= 1.6;
        if (r.next() < chance) {
          p.sick = r.int(3, 9);
          this.remember(p, 'sick', -12, 0.5, -1, 'Fell ill with a fever.');
        }
      }
      // births
      if (p.pregnantUntil > 0 && this.tick >= p.pregnantUntil) this.birth(p);
      else if (
        p.sex === 0 && p.pregnantUntil === 0 && age >= 16 && age <= 44 && p.partner >= 0
      ) {
        const partner = this.byId.get(p.partner)!;
        if (partner.alive && partner.sex === 1) {
          const youngest = p.children.map((c) => this.byId.get(c)!).filter((c) => c.alive).map((c) => this.age(c));
          const baby = youngest.some((a) => a < 2) ? 0.2 : 1;
          const fed = foodDays > 4 ? 1 : foodDays > 1.5 ? 0.6 : 0.25;
          const housed = p.home >= 0 ? 1 : 0.6;
          const crowded = pop > 70 ? 0.5 : 1;
          const plenty = this.plentyYear === yearOf(this.tick) ? 1.35 : 1;
          const yearly = 0.62 * baby * fed * housed * crowded * plenty * (0.6 + p.mood / 250) * (age > 38 ? 0.5 : 1);
          if (r.next() < yearly / DAYS_PER_YEAR) {
            p.pregnantUntil = this.tick + Math.floor(TICKS_PER_YEAR * 0.75);
            p.babyFather = partner.id;
          }
        }
      }
    }
    // pairing (only among those still alive: some may have died above, this very morning)
    const single = living.filter((p) => p.alive && p.partner < 0 && this.age(p) >= 16);
    for (const p of single) {
      if (p.partner >= 0) continue;
      let best: Person | null = null, bestOp = 28;
      for (const q of single) {
        if (q === p || q.partner >= 0 || this.isKin(p, q)) continue;
        const want = p.samesex ? p.sex === q.sex : p.sex !== q.sex;
        const wantBack = q.samesex ? p.sex === q.sex : p.sex !== q.sex;
        if (!want || !wantBack) continue;
        if (Math.abs(this.age(p) - this.age(q)) > 14) continue;
        const op = Math.min(this.opinion(p, q), this.opinion(q, p));
        if (op > bestOp) { bestOp = op; best = q; }
      }
      if (best && r.chance(0.12)) this.pair(p, best);
    }
    // living near each other slowly builds familiarity
    const still = living.filter((p) => p.alive);
    for (const p of still)
      for (const q of still) {
        if (p === q) continue;
        const op = this.opinion(p, q);
        if (op < 20) this.adjust(p, q, 0.25);
        if (this.has(p, 'cruel') && r.chance(0.01)) {
          this.adjust(q, p, -6);
          this.remember(q, 'insulted', -6, 0.5, p.id, `${p.name} was cruel to them.`);
        }
      }
    // famine
    const hungry = still.filter((p) => p.food < 25).length;
    if (!this.camp.famine && food < pop * 0.8 && hungry >= Math.max(2, pop * 0.3)) {
      this.camp.famine = true;
      this.camp.lastFamine = this.tick;
      if (seasonOf(this.tick) === 3) this.camp.hungryWinters++;
      this.event('famine', `Hunger grips ${this.camp.name}.`, [], this.camp.x, this.camp.z, 4);
      for (const p of still) this.remember(p, 'famine', -25, 3, -1, 'Went hungry in the famine.');
    } else if (this.camp.famine && food > pop * 3) {
      this.camp.famine = false;
      this.event('famine_end', `The hunger at ${this.camp.name} eases.`, [], this.camp.x, this.camp.z, 2);
    }
    // discovering how to dry and smoke food, after hunger has taught its lesson
    if (!this.camp.knowsPreserving) {
      const s = seasonPos(this.tick);
      for (const p of still) {
        if (this.age(p) < 14) continue;
        let c = 0.0012;
        if (this.camp.hungryWinters > 0 || p.memories.some((m) => m.kind === 'famine')) c = 0.015;
        if (this.has(p, 'curious')) c *= 2.2;
        if (s > 1.5 && s < 3) c *= 1.5;
        if (r.next() < c) {
          this.camp.knowsPreserving = true;
          this.remember(p, 'discovery', 30, 5, -1, 'Discovered how to dry and smoke meat.');
          this.event('discovery', `${p.name} discovered how to dry and smoke meat and fish.`, [p.id], p.x, p.z, 5);
          break;
        }
      }
    }
    // learning to raise drystone walls: only where there is stone to hand, and sooner by the settled
    if (!this.camp.knowsStonework && this.stoneNear(this.camp, 14) > 0) {
      const years = (this.tick - this.camp.founded) / TICKS_PER_YEAR;
      for (const p of still) {
        if (this.age(p) < 16) continue;
        let c = 0.0006 + Math.min(4, years) * 0.0003;
        if (this.has(p, 'curious')) c *= 2.2;
        if (this.has(p, 'industrious')) c *= 1.4;
        c *= 0.8 + Math.min(20, p.skills[SK.build]) * 0.05;
        if (r.next() < c) {
          this.camp.knowsStonework = true;
          this.remember(p, 'discovery', 30, 5, -1, 'Worked out how to raise walls of stacked stone.');
          this.event('discovery', `${p.name} worked out how to raise walls of stacked stone.`, [p.id], p.x, p.z, 5);
          break;
        }
      }
    }
  }

  private birth(mother: Person) {
    const r = this.rLife;
    mother.pregnantUntil = 0;
    const father = this.byId.get(mother.babyFather);
    const twins = r.chance(0.025);
    const babies: Person[] = [];
    for (let k = 0; k < (twins ? 2 : 1); k++) {
      if (r.chance(0.035)) {
        this.event('stillbirth', `${mother.name}'s child was born still.`, [mother.id], mother.x, mother.z, 2);
        this.remember(mother, 'lost_child', -45, 3, -1, 'Lost a child at birth.');
        if (father) this.remember(father, 'lost_child', -35, 3, -1, 'Lost a child at birth.');
        continue;
      }
      const b = this.newPerson(r.chance(0.5) ? 0 : 1, this.tick, mother.id, father?.id ?? -1);
      b.x = mother.x;
      b.z = mother.z;
      b.home = mother.home;
      for (const q of this.members()) {
        if (q === b) continue;
        b.rel.set(q.id, this.isKin(b, q) ? 50 : 10);
        q.rel.set(b.id, this.isKin(b, q) ? 50 : 8);
      }
      babies.push(b);
      this.stats.births++;
    }
    if (babies.length) {
      const names = babies.map((b) => b.name).join(' and ');
      const parents = father ? `${mother.name} and ${father.name}` : mother.name;
      this.event(twins && babies.length === 2 ? 'twins' : 'birth', twins && babies.length === 2
        ? `Twins! ${names}, born to ${parents}.`
        : `${names} was born to ${parents}.`, [mother.id, ...(father ? [father.id] : []), ...babies.map((b) => b.id)],
      mother.x, mother.z, twins ? 4 : 2);
      this.remember(mother, 'birth', 35, 3, babies[0].id, `Gave birth to ${names}.`);
      if (father) this.remember(father, 'birth', 30, 3, babies[0].id, `Became a parent to ${names}.`);
    }
    if (r.chance(0.018)) this.kill(mother, 'childbirth');
  }

  // ------------------------------------------------------------------ bands: splitting, moving, ending
  /**
   * Bands have lives of their own. A band grown big or quarrelsome splits, and a household follows
   * someone restless to new land. A band whose woods are gone, or that has buried too many, moves on.
   * The last few of a dwindling band go to live with another; an empty camp is left to the weeds.
   * Now and then strangers come over the hills, and young people of neighbouring bands pair off.
   */
  private bands(dayOfYear: number) {
    for (const c of this.liveCamps()) if (!this.members(c).length) this.emptied(c);
    const season = seasonOf(this.tick);
    // setting out is for spring and summer: there has to be time to build and lay in wood before winter
    if (dayOfYear % 6 === 3 && season < 2) {
      for (const c of this.liveCamps()) {
        this.camp = c;
        if (this.tick - c.settled < TICKS_PER_YEAR * 2) continue;
        if (this.considerMerge(c)) continue;
        if (this.considerMove(c)) continue;
        this.considerSplit(c);
      }
    }
    if (dayOfYear === 20) this.considerStrangers();
    if (dayOfYear % 12 === 3 && season < 3) this.considerMatches();
  }

  private treesNear(c: Camp, r: number) {
    let n = 0;
    for (let k = 0; k < this.propCount; k++) {
      if (!this.propAlive[k] || !isTreeType(this.propType[k]) || treeStage(this.propType[k]) < 2) continue;
      if (hyp(this.propX[k] - c.x, this.propZ[k] - c.z) < r) n++;
    }
    return n;
  }

  /** A person, their partner, and the children who still live with them. */
  household(head: Person) {
    const out = [head];
    const partner = this.byId.get(head.partner);
    if (partner && partner.alive && partner.band === head.band) out.push(partner);
    for (const h of [...out])
      for (const cid of h.children) {
        const ch = this.byId.get(cid);
        if (ch && ch.alive && ch.band === head.band && ch.partner < 0 && this.age(ch) < 20 && !out.includes(ch)) out.push(ch);
      }
    for (const q of this.members()) if (out.some((h) => h.id === q.carer) && this.age(q) < 14 && !out.includes(q)) out.push(q);
    return out;
  }

  /** Move people into another band: they set off for its camp and leave their old roof behind. */
  private join(people: Person[], to: Camp) {
    const prev = this.camp;
    for (const p of people) {
      // whatever they had set aside or carried goes back to their own band's stores, not the current camp's
      this.camp = this.campOf(p);
      abandon(this, p);
      p.band = to.id;
      p.home = -1;
      p.indoors = false;
      sendHome(this, p, to);
    }
    this.camp = prev;
    this.buildingsVersion++;
  }

  private considerSplit(c: Camp) {
    const r = this.rLife;
    const ms = this.members(c);
    const adults = ms.filter((p) => this.age(p) >= 16);
    // trouble breaks bands up too, not only crowding: hunger, blood, graves, open rivalry
    const yearAgo0 = this.tick - TICKS_PER_YEAR;
    const trouble = (c.lastFamine ?? -1e9) > yearAgo0 || (c.lastFight ?? -1e9) > this.tick - TICKS_PER_YEAR * 2 ||
      this.people.filter((q) => !q.alive && q.band === c.id && q.death > yearAgo0).length >= 3 ||
      adults.some((a) => adults.some((b) => a !== b && this.opinion(a, b) <= -30));
    if (ms.length < (trouble ? 11 : 14) || adults.length < (trouble ? 6 : 8)) return false;
    // how crowded and how quarrelsome the band has become
    let quarrels = 0, pairs = 0;
    for (const a of adults) for (const b of adults) if (a !== b) { pairs++; if (this.opinion(a, b) <= -25) quarrels++; }
    const tension = pairs ? quarrels / pairs : 0;
    const chance = Math.min(0.45, Math.max(0, (ms.length - 16) * 0.035) + tension * 1.6 + (this.treesNear(c, 10) < 25 ? 0.04 : 0) + (trouble ? 0.12 : 0));
    if (!r.chance(chance)) return false;
    // whoever is most restless (or most at odds with the rest) leads the way
    let leader: Person | null = null, best = -1e9;
    for (const p of adults) {
      const age = this.age(p);
      if (age < 20 || age > 50 || p.health < 50 || p.id === c.leader) continue;
      let warmth = 0;
      for (const q of adults) if (q !== p) warmth += this.opinion(p, q);
      warmth /= Math.max(1, adults.length - 1);
      const sc = (this.has(p, 'ambitious') ? 2 : 0) + (this.has(p, 'wanderlust') ? 2.5 : 0) + (this.has(p, 'charismatic') ? 1 : 0) +
        (this.has(p, 'brave') ? 0.5 : 0) - warmth / 20 + (age < 35 ? 0.5 : 0) + r.next() * 0.6;
      if (sc > best) { best = sc; leader = p; }
    }
    if (!leader) return false;
    const group: Person[] = this.household(leader);
    // others follow if they like the leader (or itch to go): whole households at a time
    const rest = adults.filter((q) => !group.includes(q)).sort((a, b) => this.opinion(b, leader!) - this.opinion(a, leader!) || a.id - b.id);
    for (const q of rest) {
      if (group.length >= ms.length * 0.45) break;
      if (group.includes(q)) continue;
      const op = this.opinion(q, leader);
      if (op > 30 || (this.has(q, 'wanderlust') && op > 0)) for (const h of this.household(q)) if (!group.includes(h)) group.push(h);
    }
    const grown = group.filter((p) => this.age(p) >= 16);
    const stayGrown = adults.length - grown.length;
    if (group.length < (trouble ? 5 : 7) || grown.length < (trouble ? 2 : 3) || ms.length - group.length < (trouble ? 6 : 8) ||
      stayGrown < (trouble ? 4 : 5) || grown.length > adults.length * 0.5) return false;
    const site = this.chooseSite({ from: c, min: 16, max: 44, avoid: 18, reachFrom: this.tileOf(leader) });
    if (site < 0) return false;
    // they take a fair share of the stores with them
    const share = (group.length / ms.length) * 0.85;
    const take: Stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
    for (const k of Object.keys(take) as (keyof Stock)[]) { take[k] = c.stock[k] * share; c.stock[k] -= take[k]; }
    // and the wood to get a fire going and a first roof up
    const wood = Math.min(c.stock.wood * 0.5, Math.max(0, 16 - take.wood));
    take.wood += wood;
    c.stock.wood -= wood;
    const from = c;
    this.book('carried', foodTotal(take) + take.wood, from);
    const nc = this.foundCamp(site, take, from.id, leader.id);
    // a bitter parting (a quarrelsome band, or a leader who has no love for those staying) takes a contrasting colour
    let regard = 0;
    const stayers = this.members(from).filter((q) => !group.includes(q));
    for (const q of stayers) regard += this.opinion(leader, q);
    // or one born of trouble: a grudge against someone staying, a hungry year, blood spilt, too many graves
    const rival = stayers.find((q) => this.opinion(leader!, q) <= -15 || this.opinion(q, leader!) <= -15);
    const yearAgo = this.tick - TICKS_PER_YEAR;
    const hungry = (from.lastFamine ?? -1e9) > yearAgo;
    const blood = (from.lastFight ?? -1e9) > this.tick - TICKS_PER_YEAR * 2;
    const graves = this.people.filter((q) => !q.alive && q.band === from.id && q.death > yearAgo).length >= 3;
    // or by temper: a cruel leader, or an ambitious one without the warmth to part as friends
    const cruel = this.has(leader, 'cruel');
    const grasping = this.has(leader, 'ambitious') && !this.has(leader, 'kind') && !this.has(leader, 'charismatic');
    const bitter = tension > 0.05 || (stayers.length > 0 && regard / stayers.length < 12) || !!rival || hungry || blood || graves || cruel || grasping;
    const why = rival ? ` after falling out with ${rival.name}` : blood ? ' after the bloodshed' : hungry ? ' after the hungry year' : graves ? ' after a year of burials'
      : tension > 0.05 ? ' after a bitter quarrel' : cruel ? ', and few were sorry to see them go' : grasping ? ' to rule a band of their own' : ', glad to be gone';
    const parentColor = from.color ?? this.distinctColor();
    nc.color = bitter ? this.contrastColor(parentColor) : this.lighterColor(parentColor);
    nc.origin = bitter ? 'turmoil' : 'amicable';
    this.camp = from;
    this.join(group, nc);
    from.settled = nc.settled = this.tick;
    const dir = compass(nc.x - from.x, nc.z - from.z);
    for (const p of group) this.remember(p, 'left', 8, 2, leader.id, `Followed ${p === leader ? 'their own heart' : leader.name} away from ${from.name} to found ${nc.name}.`);
    for (const q of this.members(from)) if (group.some((p) => this.isKin(p, q) || p.partner === q.id)) this.remember(q, 'parting', -10, 1, leader.id, `Kin went away with ${leader.name} to ${nc.name}.`);
    this.event('split', `${leader.name} led ${num(group.length - 1)} others away from ${from.name}${bitter ? why : ', parting on good terms'}. They went ${dir} and founded ${nc.name}.`,
      group.map((p) => p.id), leader.x, leader.z, 5);
    this.camp = from;
    return true;
  }

  private considerMove(c: Camp) {
    const r = this.rLife;
    const ms = this.members(c);
    if (ms.length < 3) return false;
    const yearAgo = this.tick - TICKS_PER_YEAR;
    const died = this.people.filter((p) => !p.alive && p.band === c.id && p.death > yearAgo).length;
    // timber within a long walk: once even that is gone, every winter is a losing haul
    const poorWood = this.treesNear(c, 26) < 12;
    const hard = c.hungryWinters >= 2 || died >= Math.max(4, ms.length * 0.4);
    if (!poorWood && !hard) return false;
    if (!r.chance((poorWood ? 0.18 : 0) + (hard ? 0.12 : 0))) return false;
    const site = this.chooseSite({ from: c, min: 12, max: 40, avoid: 18, reachFrom: c.tile });
    if (site < 0) return false;
    const adults = ms.filter((p) => this.age(p) >= 16).sort((a, b) => a.birth - b.birth || a.id - b.id);
    const lead = this.byId.get(c.leader)?.alive && this.byId.get(c.leader)!.band === c.id ? this.byId.get(c.leader)! : adults[0] ?? ms[0];
    // wood and food set aside for a job (or carried in) go back to the stores before they are packed up
    for (const p of ms) abandon(this, p);
    const stock = { ...c.stock };
    for (const k of Object.keys(stock) as (keyof Stock)[]) stock[k] *= 0.8; // not everything can be carried
    const nc = this.foundCamp(site, stock, c.id, lead.id);
    nc.knowsPreserving = c.knowsPreserving;
    nc.knowsStonework = c.knowsStonework;
    // the same people, the same colour
    nc.color = c.color ?? nc.color;
    nc.origin = 'moved';
    this.join(ms, nc);
    c.gone = this.tick;
    c.stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
    this.hearth(c).fuel = 0;
    nc.settled = this.tick;
    for (const p of ms) this.remember(p, 'moved_camp', poorWood ? 4 : 10, 2, -1, `Left ${c.name} behind for ${nc.name}.`);
    this.event('move_camp', `The people of ${c.name} gave up their camp${poorWood ? ': the woods around it were gone' : ' after hard years'}. They went ${compass(nc.x - c.x, nc.z - c.z)} and made a new one at ${nc.name}.`,
      ms.map((p) => p.id), nc.x, nc.z, 5);
    this.camp = nc;
    return true;
  }

  private considerMerge(c: Camp) {
    const ms = this.members(c);
    const adults = ms.filter((p) => this.age(p) >= 16);
    if (adults.length >= 2 && ms.length > 3) return false;
    const to = this.liveCamps().filter((o) => o !== c).sort((a, b) => hyp(a.x - c.x, a.z - c.z) - hyp(b.x - c.x, b.z - c.z))[0];
    if (!to || !ms.length) return false;
    this.join(ms, to);
    c.gone = this.tick;
    this.hearth(c).fuel = 0;
    for (const p of ms) this.remember(p, 'moved_camp', -8, 2, -1, `Left ${c.name}, too few to go on, for ${to.name}.`);
    this.event('merge', `${ms.length === 1 ? `${ms[0].name}, the last of the people of ${c.name},` : `The last ${num(ms.length)} of the people of ${c.name}`} went to live at ${to.name}.`,
      ms.map((p) => p.id), c.x, c.z, 4);
    return true;
  }

  /** No one left: the camp goes back to the land. */
  private emptied(c: Camp) {
    c.gone = this.tick;
    this.hearth(c).fuel = 0;
    this.buildingsVersion++;
    this.event('gone', `No one is left at ${c.name}.`, [], c.x, c.z, 5);
    if (!this.liveCamps().length) this.event('empty', 'The land is empty of people now.', [], c.x, c.z, 5);
  }

  private considerStrangers() {
    const r = this.rLife;
    const live = this.liveCamps().length;
    if (yearOf(this.tick) < 4 && live) return;
    const chance = live === 0 ? 0.5 : live < 3 ? 0.06 : live < 5 ? 0.02 : 0;
    if (!r.chance(chance)) return;
    const prev = this.camp;
    const c = this.foundBand(true);
    if (!c) this.camp = prev;
  }

  /** Young people of neighbouring bands meet, and some pair off: one goes to live with the other. */
  private considerMatches() {
    const r = this.rLife;
    const live = this.liveCamps();
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (hyp(a.x - b.x, a.z - b.z) > 40 || !r.chance(0.12)) continue;
        const singles = (c: Camp) => this.members(c).filter((p) => p.partner < 0 && this.age(p) >= 16 && this.age(p) <= 36);
        const sa = singles(a), sb = singles(b);
        let pick: [Person, Person] | null = null;
        for (const p of sa) {
          for (const q of sb) {
            if (this.isKin(p, q)) continue;
            const want = p.samesex ? p.sex === q.sex : p.sex !== q.sex;
            const wantBack = q.samesex ? p.sex === q.sex : p.sex !== q.sex;
            if (want && wantBack && Math.abs(this.age(p) - this.age(q)) <= 10) { pick = [p, q]; break; }
          }
          if (pick) break;
        }
        if (!pick) continue;
        const [p, q] = pick;
        // whoever has fewer ties at home goes
        const ties = (x: Person) => this.members(this.campById(x.band)!).filter((y) => this.isKin(x, y)).length;
        const [goer, stay] = ties(p) <= ties(q) ? [p, q] : [q, p];
        const home = this.campById(stay.band)!, from = this.campById(goer.band)!;
        this.adjust(p, q, 45);
        this.adjust(q, p, 45);
        this.pair(p, q, false);
        this.join([goer], home);
        for (const m of this.members(home)) if (m !== goer) { this.adjust(goer, m, 12); this.adjust(m, goer, 10); }
        this.remember(goer, 'married_out', 15, 3, stay.id, `Left ${from.name} to live with ${stay.name} at ${home.name}.`);
        this.event('pairing', `${goer.name} of ${from.name} and ${stay.name} of ${home.name} became partners. ${goer.name} went to live at ${home.name}.`,
          [goer.id, stay.id], stay.x, stay.z, 3);
      }
  }

  // ------------------------------------------------------------------ fortune
  /**
   * Most years are ordinary. Now and then they are not: a sickness, a feud that ends in blood, a
   * summer the berries fail; or a year of plenty, a long stretch without a single death.
   */
  private fortune(dayOfYear: number) {
    const r = this.rLife;
    const year = yearOf(this.tick);
    const live = this.liveCamps();
    const here = live[0] ?? this.camp;
    // early summer: how the year's fruit and fish will be
    if (dayOfYear === 14) {
      const roll = this.rWild.next();
      if (roll < 0.05) {
        this.blightYear = year;
        this.event('blight', 'The berry bushes are bare this summer: a late frost took the flowers.', [], here.x, here.z, 4);
      } else if (roll < 0.13) {
        this.plentyYear = year;
        for (let i = 0; i < this.fish.length; i++) this.fish[i] = this.fishCap[i];
        this.event('plenty', 'A year of plenty: the bushes are heavy with fruit and the water thick with fish.', [], here.x, here.z, 4);
        for (const p of this.living()) this.remember(p, 'plenty', 12, 2, -1, 'Lived through a year of plenty.');
      }
    }
    // late autumn: sometimes a sickness runs through the deer
    if (dayOfYear === 30 && this.rWild.chance(0.025)) {
      let n = 0;
      for (const d of this.deer) if (d.alive && this.rWild.chance(0.4)) { d.alive = false; n++; }
      if (n > 3) this.event('murrain', `A sickness swept through the deer. ${cap(num(n))} were found dead in the woods.`, [], here.x, here.z, 4);
    }
    for (const c of live) {
      this.camp = c;
      const ms = this.members(c);
      if (!ms.length) continue;
      // a sickness through the camp: it starts with a few, and spreads
      if ((c.sickUntil ?? 0) > 0 && c.sickUntil! <= this.tick) {
        const n = c.sickDead ?? 0;
        this.event('epidemic_end', n ? `The sickness at ${c.name} has passed. It took ${num(n)}.` : `The sickness at ${c.name} has passed. Everyone lived.`, [], c.x, c.z, n ? 4 : 3);
        c.sickUntil = 0;
        c.sickDead = 0;
      } else if (!c.sickUntil && dayOfYear % 12 === 9 && r.chance(0.012 + (ms.length > 24 ? 0.012 : 0) + (seasonOf(this.tick) === 3 ? 0.008 : 0))) {
        c.sickUntil = this.tick + TICKS_PER_DAY * 20;
        c.sickDead = 0;
        for (const p of ms) if (r.chance(0.7)) { p.sick = Math.max(p.sick, r.int(5, 13)); this.remember(p, 'sick', -18, 1, -1, 'Fell ill in the sickness.'); }
        this.event('epidemic', `A sickness spread through ${c.name}.`, [], c.x, c.z, 4);
      }
      // years without a death
      const quiet = Math.floor((this.tick - (c.lastDeath ?? c.founded)) / TICKS_PER_YEAR);
      if (quiet >= 10 && quiet % 5 === 0 && quiet !== (c.quietNoted ?? 0) && ms.length >= 8) {
        c.quietNoted = quiet;
        this.event('quiet', `${cap(num(quiet))} years without a single death at ${c.name}.`, [], c.x, c.z, 4);
        for (const p of ms) this.remember(p, 'good_years', 10, 2, -1, `Lived through ${quiet} years without a death at ${c.name}.`);
      }
      // a feud that ends in blood
      this.feud(c, ms);
    }
  }

  private feud(c: Camp, ms: Person[]) {
    const r = this.rLife;
    const adults = ms.filter((p) => this.age(p) >= 16 && p.health > 30);
    for (const a of adults)
      for (const b of adults) {
        if (a.id >= b.id || this.opinion(a, b) > -65 || this.opinion(b, a) > -65) continue;
        let chance = 0.015;
        for (const p of [a, b]) chance *= this.has(p, 'cruel') ? 2 : this.has(p, 'greedy') ? 1.4 : this.has(p, 'kind') ? 0.5 : 1;
        if (!r.chance(chance)) continue;
        // the harder of the two strikes first
        const hard = (p: Person) => (this.has(p, 'cruel') ? 2 : 0) + (this.has(p, 'brave') ? 1 : 0) + p.health / 100 + r.next();
        const [att, vic] = hard(a) >= hard(b) ? [a, b] : [b, a];
        c.lastFight = this.tick;
        if (r.chance(0.3)) {
          this.kill(vic, 'killed', att);
          for (const q of this.living()) {
            if (q === att) continue;
            const kin = this.isKin(q, vic) || q.id === vic.partner;
            this.adjust(q, att, kin ? -70 : q.band === att.band ? -30 : -10);
            if (q.band === att.band) this.remember(q, 'murder', kin ? -40 : -15, 3, att.id, `${att.name} killed ${vic.name}.`);
          }
          this.remember(att, 'killed', -20, 5, vic.id, `Killed ${vic.name} in a quarrel.`);
          this.exile(att, vic, c);
        } else {
          vic.health = Math.max(5, vic.health - 40);
          this.adjust(vic, att, -20);
          this.remember(vic, 'beaten', -25, 2, att.id, `Was beaten by ${att.name}.`);
          this.event('fight', `${att.name} and ${vic.name} came to blows. ${vic.name} was badly hurt.`, [att.id, vic.id], att.x, att.z, 3);
        }
        return;
      }
  }

  /** A killer the band can't forgive is driven out, with whoever stands by them. */
  private exile(att: Person, vic: Person, c: Camp) {
    const ms = this.members(c).filter((q) => q !== att);
    let regard = 0;
    for (const q of ms) regard += this.opinion(q, att);
    if (ms.length && regard / ms.length > -15) {
      this.event('death_quarrel', `${att.name} killed ${vic.name} in a quarrel. The band let it lie.`, [att.id, vic.id], att.x, att.z, 4);
      return;
    }
    const partner = this.byId.get(att.partner);
    const loyal = partner && partner.alive && partner.band === att.band && this.opinion(partner, att) > 20;
    const group = loyal ? this.household(att) : [att];
    const site = this.chooseSite({ from: c, min: 14, max: 40, avoid: 14, reachFrom: this.tileOf(att) });
    if (site < 0) {
      this.event('death_quarrel', `${att.name} killed ${vic.name} in a quarrel. There was nowhere to send ${att.sex ? 'him' : 'her'}.`, [att.id, vic.id], att.x, att.z, 4);
      return;
    }
    const take: Stock = { berries: 0, meat: Math.min(6, c.stock.meat), fish: 0, preserved: 0, wood: Math.min(6, c.stock.wood), fiber: 0, cordage: 0, mud: 0, stone: 0 };
    c.stock.meat -= take.meat;
    c.stock.wood -= take.wood;
    this.book('carried', take.meat + take.wood, c);
    const nc = this.foundCamp(site, take, c.id, att.id);
    nc.color = this.contrastColor(c.color ?? this.distinctColor());
    nc.origin = 'turmoil';
    this.camp = c;
    this.join(group, nc);
    nc.settled = this.tick;
    for (const p of group) this.remember(p, 'exiled', -30, 4, -1, p === att ? `Was driven out of ${c.name}.` : `Went into exile with ${att.name}.`);
    this.event('exile', `${att.name} killed ${vic.name} in a quarrel and was driven out of ${c.name}${group.length > 1 ? `. ${group.length === 2 ? `${partner!.name} went too` : `${partner!.name} and the children went too`}` : ''}. They made a camp alone at ${nc.name}.`,
      [att.id, vic.id, ...group.filter((p) => p !== att).map((p) => p.id)], att.x, att.z, 5);
    this.camp = c;
  }

  /** Out on the land alone after dark: sometimes something is out there too. */
  private wildAttack(p: Person) {
    const r = this.rWild;
    for (const c of this.camps) if (!c.gone && hyp(p.x - c.x, p.z - c.z) < 10) return;
    for (const q of this.people) if (q !== p && q.alive && hyp(q.x - p.x, q.z - p.z) < 4) return;
    if (!r.chance(0.00025 * (seasonOf(this.tick) === 3 ? 2 : 1))) return;
    const bear = seasonOf(this.tick) !== 3 && this.world.terrain[this.tileOf(p)] === T.Forest && r.chance(0.4);
    const what = bear ? 'a bear' : 'wolves';
    const escape = 0.62 + (this.has(p, 'brave') ? 0.15 : 0) + (p.carry === CARRY.Spear ? 0.15 : 0) + (this.age(p) < 14 || this.age(p) > 60 ? -0.25 : 0);
    if (r.chance(escape)) {
      p.health = Math.max(5, p.health - 45);
      p.safety = 0;
      this.remember(p, 'attacked', -30, 3, -1, `Was attacked by ${what} and got away.`);
      this.event('attack', `${p.name} was attacked by ${what} and barely got away.`, [p.id], p.x, p.z, 3);
    } else {
      this.kill(p, bear ? 'bear' : 'wolves');
    }
  }

  /** The stores and their year, for the stockpile's card and the band panel. */
  stores(c = this.camp) {
    const l = c.ledger;
    const page = (r: Record<string, number> | undefined) => {
      const g = (k: string) => Math.round(r?.[k] ?? 0);
      const food = (pre: string) => g(`${pre}.berries`) + g(`${pre}.meat`) + g(`${pre}.fish`) + g(`${pre}.preserved`);
      return {
        gathered: { berries: g('gathered.berries'), meat: g('gathered.meat'), fish: g('gathered.fish'), wood: g('gathered.wood'), fiber: g('gathered.fiber') },
        twisted: g('twisted'), thatch: g('built.fiber'), lashed: g('built.cordage'),
        food: g('gathered.berries') + g('gathered.meat') + g('gathered.fish'),
        eaten: food('eaten'), spoiled: food('spoiled'), dried: g('dried'), burned: g('burned'), built: g('built'),
        carried: g('carried'), brought: g('brought'),
      };
    };
    return { year: l?.year ?? yearOf(this.tick), now: page(l?.year === yearOf(this.tick) ? l.now : undefined), last: page(l?.year === yearOf(this.tick) ? l.last : l?.year === yearOf(this.tick) - 1 ? l.now : undefined), total: page(l?.total) };
  }

  // ------------------------------------------------------------------ the planner
  /** Each morning the band takes stock and decides what work matters most today. */
  plan() {
    const c = this.camp;
    const living = this.members();
    const mine = this.bandBuildings();
    const pop = living.length;
    const meals = living.reduce((s, p) => s + (this.age(p) < 12 ? 1.1 : 1.8), 0);
    const s = seasonPos(this.tick);
    const daysToWinterEnd = s < 3 ? (3 - s) * 12 + 12 : (4 - s) * 12;
    const winterNow = s >= 3;
    // berries spoil: count them at half value against the winter
    const lasting = c.stock.meat + c.stock.fish * 0.8 + c.stock.preserved + c.stock.berries * 0.4;
    // from late summer on, the store has to carry the band through to the end of winter
    const need = meals * (winterNow ? daysToWinterEnd + 2 : s >= 1.75 ? daysToWinterEnd : Math.min(daysToWinterEnd, 20));
    const foodP = clamp01(1.15 - (lasting / Math.max(1, need)) * 0.9, winterNow ? 0.3 : 0.1, 1.2);
    // the fire burns about 6 loads a day in winter: lay in enough before the cold comes
    const fuelNeed = (winterNow ? Math.max(14, daysToWinterEnd * 6.5) : s > 2.0 ? 80 : s > 1.4 ? 40 : 12) * (this.hasBuilt('woodshed') ? 1 : s > 1.6 ? DAMP_BURN : 1);
    const sites = mine.filter((b) => !b.built);
    // daub can't wait on frozen ground: a site still short of mud as winter comes is raised in wood
    if (s >= 2.75) for (const b of sites) this.fallBackToWood(b);
    const owed = (m: 'wood' | 'fiber' | 'cordage' | 'mud' | 'stone') => sites.reduce((a, b) => a + Math.max(0, specOf(b)[m] - b[m]), 0);
    const siteWood = owed('wood');
    // thatch and cordage still owed to the sites, counted as fiber; and a little kept in hand for the next roof
    const siteCord = owed('cordage');
    const siteFiber = owed('fiber') + siteCord * FIBER_PER_CORD;
    const siteMud = owed('mud'), siteStone = owed('stone');
    const fiberHave = c.stock.fiber + c.stock.cordage * FIBER_PER_CORD;
    const fiberWant = siteFiber + 8;
    const woodP = clamp01((fuelNeed + siteWood - c.stock.wood) / (fuelNeed + siteWood + 1) * 1.15, 0.08, 1.0);
    const logsLying = this.countProps(LOGS);
    c.jobs = {
      food: foodP,
      wood: woodP + (logsLying > 0 ? 0.1 : 0),
      build: sites.length ? 0.85 : 0,
      fuel: this.hearth().fuel < 5 ? 0.9 : 0.15,
      preserve: c.knowsPreserving && mine.some((b) => b.kind === 'rack' && b.built) && c.stock.meat + c.stock.fish > 6 ? 0.7 : 0,
      fiber: fiberHave < fiberWant ? clamp01((fiberWant - fiberHave) / (fiberWant + 2) * 1.1 + (siteFiber > fiberHave ? 0.25 : 0), 0.1, 0.9) : 0,
      // twisting cordage: what the sites need first, then a few lengths put by
      twist: c.stock.fiber >= FIBER_PER_CORD ? (siteCord > c.stock.cordage ? 0.8 : c.stock.cordage < 4 ? 0.3 : 0) : 0,
      // mud and stone are fetched only for a site that needs them (mud can't be dug from frozen ground)
      dig: siteMud > c.stock.mud && !winterNow ? 0.75 : 0,
      quarry: siteStone > c.stock.stone ? 0.75 : 0,
      bury: this.people.some((p) => !p.alive && !p.buried && p.band === c.id) ? 1 : 0,
    };
    c.plan = [];
    if (foodP > 0.8) c.plan.push(winterNow ? 'Find food to last the winter' : 'Store food before winter');
    if (woodP > 0.5) c.plan.push(s > 2.0 && !winterNow ? 'Lay in firewood for the winter' : 'Gather wood');
    if (siteFiber > fiberHave) c.plan.push('Cut grass and reeds for thatch and cordage');

    if (!mine.some((b) => b.kind === 'stockpile')) this.markStockpile(c);
    // shelter: first fill homes that stand empty (their families died or moved), then build
    this.rehouse();
    if (!sites.some((b) => b.kind === 'hut' || b.kind === 'leanto')) {
      const homeless = this.householdsWithoutHome();
      if (homeless.length) {
        const head = homeless[0];
        const kind: BuildKind = c.stock.wood >= 6 || s < 2.6 ? 'hut' : 'leanto';
        const tile = this.siteFor(kind, head);
        if (tile >= 0) {
          this.clearTile(tile);
          const b = this.newBuilding(kind, tile, head.id);
          const why = this.chooseWalls(b, homeless.some((h) => this.household(h).some((q) => this.age(q) < 4)));
          c.plan.push(`Build a ${labelOf(b).toLowerCase()} for ${head.name}'s household${why ? ` (${why})` : ''}`);
        }
      }
    }
    const day = dayOf(this.tick) - dayOf(c.founded);
    if (!mine.some((b) => b.kind === 'storehouse') && day > 10 && pop >= 9 && mine.some((b) => b.kind === 'hut' && b.built)) {
      const tile = this.siteFor('storehouse', null);
      if (tile >= 0) {
        this.clearTile(tile);
        const b = this.newBuilding('storehouse', tile, -1);
        const why = this.chooseWalls(b, false);
        c.plan.push(`Build a ${labelOf(b).toLowerCase()}${why ? ` (${why})` : ''}`);
      }
    }
    if (c.knowsPreserving && !mine.some((b) => b.kind === 'rack')) {
      const tile = this.siteFor('rack', null);
      if (tile >= 0) {
        this.clearTile(tile);
        this.newBuilding('rack', tile, -1);
        c.plan.push('Build a drying rack');
      }
    }
    // then the comforts of the fire, one at a time once the first hut stands: a roof over the woodpile
    // to keep the firewood dry through autumn and winter, and a windbreak behind the fire
    const now = this.bandBuildings();
    const busy = now.some((b) => !b.built && b.kind !== 'hut' && b.kind !== 'leanto');
    if (!busy && now.some((b) => b.kind === 'hut' && b.built)) {
      const pile = now.find((b) => b.kind === 'stockpile');
      const hearth = this.hearth();
      if (pile && !now.some((b) => b.kind === 'woodshed')) {
        const b = this.newBuilding('woodshed', pile.tile, -1);
        b.rot = pile.rot;
        c.plan.push('Put a roof over the woodpile to keep the firewood dry');
      } else if (hearth && !now.some((b) => b.kind === 'windbreak') && (s >= 1.8 || pop >= 12)) {
        this.newBuilding('windbreak', hearth.tile, -1);
        c.plan.push('Build a windbreak behind the fire');
      }
    }
    // a second hut at once when the band is large
    if (pop > 10 && sites.filter((b) => b.kind === 'hut').length < 2 && this.householdsWithoutHome().length > 1) {
      const head = this.householdsWithoutHome()[1];
      const tile = this.siteFor('hut', head);
      if (tile >= 0) {
        this.clearTile(tile);
        this.chooseWalls(this.newBuilding('hut', tile, head.id), false);
      }
    }
  }

  /** Places to quarry stone within `r` tiles of a camp. */
  stoneNear(c: Camp, r: number) {
    let n = 0;
    for (const i of this.quarryTiles) if (hyp((i % this.N) + 0.5 - c.x, Math.floor(i / this.N) + 0.5 - c.z) < r) n++;
    return n;
  }
  private mudNear(c: Camp, r: number) {
    let n = 0;
    for (const i of this.mudSpots) if (hyp((i % this.N) + 0.5 - c.x, Math.floor(i / this.N) + 0.5 - c.z) < r) n++;
    return n;
  }

  /**
   * What a new hut or storehouse is made of. Every kind of wall the band can raise is weighed on what
   * the land around camp offers, the cold, how hurried the band is, how long it has stayed, what it
   * built before, and its leader. Returns a few words on why, when the walls are not wood.
   */
  chooseWalls(b: Building, hurry: boolean): string {
    const c = this.camp;
    const options = wallsFor(b.kind);
    if (options.length < 2) return '';
    const s = seasonPos(this.tick);
    const trees = this.treesNear(c, 20);
    const mud = this.mudNear(c, 20);
    const stone = this.stoneNear(c, 18);
    // winters up here: how cold the camp's own ground gets at midwinter
    const midwinter = Math.floor(this.tick / TICKS_PER_YEAR) * TICKS_PER_YEAR + Math.round(3.5 * (TICKS_PER_YEAR / 4));
    const cold = clamp01((2 - temperature(midwinter, 0, Math.max(0, this.world.level[c.tile] - SEA - 1))) / 12, 0, 1);
    const years = (this.tick - c.founded) / TICKS_PER_YEAR;
    const settled = clamp01(years / 6) * (this.treesNear(c, 26) < 12 ? 0.4 : 1);
    const workers = this.members(c).filter((p) => this.age(p) >= 14 && this.age(p) < 60).length;
    // the hurry is to have a roof before the snow, or for the very young
    const rush = hurry || (s >= 2.2 && s < 3) ? 1 : s >= 3 ? 0.7 : 0.15;
    const last = this.bandBuildings(c).filter((q) => q.built && (q.kind === 'hut' || q.kind === 'storehouse')).sort((a, q) => q.finished - a.finished)[0];
    const lead = this.byId.get(c.leader);
    const base = specOf({ kind: b.kind });
    let best: Walls = 'wood', bestS = -Infinity;
    const scores: Partial<Record<Walls, number>> = {};
    for (const wall of options) {
      const sp = specOf({ kind: b.kind, walls: wall });
      let supply: number;
      if (wall === 'wood') supply = clamp01(trees / 40, 0.15, 1.2) + (c.stock.wood >= sp.wood + 10 ? 0.15 : 0);
      else if (wall === 'daub') {
        // digging needs thawed ground: not with winter at the door
        if (!mud || s >= 2.5) continue;
        supply = clamp01(0.55 + mud / 30, 0, 1.15) + (c.stock.mud >= sp.mud ? 0.15 : 0);
      } else {
        if (!c.knowsStonework || !stone) continue;
        supply = clamp01(0.5 + stone / 40, 0, 1.2) + (c.stock.stone >= sp.stone ? 0.15 : 0);
      }
      const durable = wall === 'stone' ? 2 : wall === 'daub' ? 1 : 0;
      let sc = Math.log(supply + 1e-3);
      sc += Math.log(sp.shelter > 0 ? sp.shelter / base.shelter : base.keep / sp.keep) * (1 + cold * 5);
      sc -= Math.log(sp.work / base.work) * (0.4 + rush * 2.2) * (workers < 5 ? 1.5 : 1);
      sc += durable * settled * 0.12;
      if (last && (last.walls ?? 'wood') === wall) sc += lead && this.has(lead, 'cautious') ? 0.15 : 0.08;
      if (lead && this.has(lead, 'ambitious') && wall === 'stone') sc += 0.2;
      if (lead && this.has(lead, 'lazy') && wall === 'wood') sc += 0.15;
      scores[wall] = sc;
      if (sc > bestS) { bestS = sc; best = wall; }
    }
    b.walls = best;
    this.buildingsVersion++;
    if (best === 'wood') return '';
    if (trees < 16) return 'the woods are thin here';
    if (cold > 0.5) return 'the winters are hard here';
    if (best === 'stone' && settled > 0.5) return 'they mean to stay';
    return best === 'stone' ? 'there is good stone close by' : 'there is good mud by the water';
  }

  /** A site whose daub can't be finished before the ground freezes is raised in wood instead; what was brought goes back to the store. */
  private fallBackToWood(b: Building) {
    if (b.walls !== 'daub') return;
    const sp = specOf(b), st = this.camp.stock;
    if (b.mud >= sp.mud - 0.5 || st.mud >= sp.mud - b.mud) return;
    st.mud += b.mud;
    st.stone += b.stone;
    b.mud = 0;
    b.stone = 0;
    // the wood, thatch and cordage already there stay, as far as a wooden one needs them
    const wood = BUILD[b.kind];
    for (const m of ['wood', 'fiber', 'cordage'] as const) if (b[m] > wood[m]) { st[m] += b[m] - wood[m]; b[m] = wood[m]; }
    b.work = Math.min(b.work, wood.work * 0.9);
    b.walls = 'wood';
    this.buildingsVersion++;
  }

  /** Built homes nobody lives in any more, huts first. */
  vacantHomes(): Building[] {
    const living = this.living();
    return this.bandBuildings()
      .filter((b) => b.built && (b.kind === 'hut' || b.kind === 'leanto') && !living.some((p) => p.home === b.id))
      .sort((a, b) => (a.kind === 'hut' ? 0 : 1) - (b.kind === 'hut' ? 0 : 1) || a.id - b.id);
  }

  /** Households without a roof take empty homes; families in a lean-to move up to an empty hut. */
  private rehouse() {
    const living = this.living();
    for (const b of this.bandBuildings()) {
      if (!b.built || (b.kind !== 'hut' && b.kind !== 'leanto') || this.byId.get(b.owner)?.alive) continue;
      const heir = living.filter((q) => q.home === b.id).sort((a, c) => a.birth - c.birth || a.id - c.id)[0];
      if (heir) {
        b.owner = heir.id;
        this.buildingsVersion++;
      }
    }
    // children without a roof (their family stayed behind, or is gone) go in with kin, or with whoever takes them
    const members = this.members();
    for (const ch of members) {
      if (ch.home >= 0 || this.age(ch) >= 16 || this.age(ch) < 2) continue;
      const kin = [this.byId.get(ch.carer), this.byId.get(ch.mother), this.byId.get(ch.father)].find((q) => q && q.alive && q.band === ch.band && q.home >= 0);
      const taker = kin ?? members.filter((q) => q.home >= 0 && this.age(q) >= 18).sort((a, b) =>
        (this.isKin(b, ch) ? 2 : 0) + (this.has(b, 'kind') ? 1 : 0) - (this.isKin(a, ch) ? 2 : 0) - (this.has(a, 'kind') ? 1 : 0) || a.id - b.id)[0];
      if (!taker) continue;
      ch.home = taker.home;
      if (!kin) {
        ch.carer = taker.id;
        this.remember(taker, 'fostered', 12, 2, ch.id, `Took ${ch.name} into their home.`);
      }
    }
    const vacant = this.vacantHomes();
    if (!vacant.length) return;
    for (const head of this.householdsWithoutHome()) {
      const b = vacant.shift();
      if (!b) return;
      this.moveIn(head, b);
    }
    const huts = vacant.filter((b) => b.kind === 'hut');
    for (const lean of this.bandBuildings().filter((b) => b.kind === 'leanto' && b.built)) {
      if (!huts.length) return;
      const head = this.byId.get(lean.owner);
      if (head && head.alive && head.home === lean.id) this.moveIn(head, huts.shift()!);
    }
  }

  /** A household (head, partner, their unpartnered young children) makes a building its home. */
  moveIn(head: Person, b: Building) {
    const prev = this.byId.get(b.owner);
    const oldHome = head.home;
    b.owner = head.id;
    const partner = head.partner >= 0 ? this.byId.get(head.partner) : undefined;
    const household = [head, ...(partner && partner.alive ? [partner] : [])];
    for (const h of [...household])
      for (const cid of h.children) {
        const ch = this.byId.get(cid);
        if (ch && ch.alive && ch.band === head.band && ch.partner < 0 && this.age(ch) < 22 && !household.includes(ch) && (ch.home < 0 || ch.home === oldHome || ch.home === h.home))
          household.push(ch);
      }
    for (const q of this.members()) if (household.some((h) => h.id === q.carer) && this.age(q) < 14 && !household.includes(q)) household.push(q);
    const label = labelOf(b).toLowerCase();
    for (const h of household) {
      h.home = b.id;
      this.remember(h, 'home', 12, 2, b.id, `Moved into ${prev && prev.id !== head.id ? `${prev.name}'s old ${label}` : `an empty ${label}`}.`);
    }
    this.buildingsVersion++;
    this.event('move', prev && prev.id !== head.id && !household.includes(prev)
      ? `${head.name}'s family moved into the ${label} that was ${prev.name}'s.`
      : `${head.name}'s family moved into an empty ${label}.`, household.map((h) => h.id), b.x + 0.5, b.z + 0.5, 1);
  }

  private propCounts = new Map<number, { v: number; n: number }>();
  countProps(type: number) {
    // recounted only when the props have changed since last asked
    const hit = this.propCounts.get(type);
    if (hit && hit.v === this.propsVersion) return hit.n;
    const n = this.countPropsNow(type);
    this.propCounts.set(type, { v: this.propsVersion, n });
    return n;
  }
  private countPropsNow(type: number) {
    let n = 0;
    for (let k = 0; k < this.propCount; k++) if (this.propAlive[k] && this.propType[k] === type) n++;
    return n;
  }

  /** Household heads (one per couple, or a single adult) who have no roof yet. */
  householdsWithoutHome(): Person[] {
    const out: Person[] = [];
    const seen = new Set<number>();
    const living = this.members();
    for (const p of living) {
      if (seen.has(p.id) || this.age(p) < 16) continue;
      const partner = p.partner >= 0 ? this.byId.get(p.partner) : undefined;
      seen.add(p.id);
      if (partner) seen.add(partner.id);
      // a couple wants a roof of their own; anyone else is fine where they are unless it is overcrowded
      const owns = (pid: number, hid: number) => this.buildings.some((b) => b.id === hid && b.built && b.owner === pid);
      const home = p.home >= 0 ? p.home : partner?.home ?? -1;
      if (home >= 0) {
        const theirs = owns(p.id, home) || (partner ? owns(partner.id, home) : false);
        const b = this.buildings.find((q) => q.id === home);
        const crowd = b ? living.filter((q) => q.home === home).length > specOf(b).cap : false;
        if (theirs || (!partner && !crowd)) continue;
      }
      // single young adults stay with a parent who has a home
      if (!partner) {
        const parent = [this.byId.get(p.mother), this.byId.get(p.father)].find((q) => q && q.alive && q.home >= 0 && q.band === p.band);
        if (parent && this.age(p) < 24) {
          p.home = parent.home;
          continue;
        }
      }
      out.push(p);
    }
    out.sort((a, b) => b.children.length - a.children.length || a.id - b.id);
    return out;
  }

  /** Pick a building site: organic placement around the hearth. */
  siteFor(kind: BuildKind, head: Person | null): number {
    const N = this.N, w = this.world;
    const hx = Math.floor(this.camp.x), hz = Math.floor(this.camp.z);
    let best = -1, bestS = -Infinity;
    const kinHomes = head
      ? this.bandBuildings().filter((b) => {
          const o = this.byId.get(b.owner);
          return o && (this.isKin(o, head) || o.id === head.mother || o.id === head.father);
        })
      : [];
    for (let dz = -9; dz <= 9; dz++)
      for (let dx = -9; dx <= 9; dx++) {
        const x = hx + dx, z = hz + dz;
        if (x < 2 || z < 2 || x >= N - 2 || z >= N - 2) continue;
        const i = z * N + x;
        if (w.water[i] !== WATER.None || !this.grid.walkable(i)) continue;
        if (this.buildings.some((b) => Math.abs(b.x - x) <= 1 && Math.abs(b.z - z) <= 1)) continue;
        if (i === this.camp.graveyard) continue;
        const d = hyp(dx, dz);
        const want = kind === 'stockpile' ? 1.8 : kind === 'storehouse' ? 2.2 : kind === 'rack' ? 3 : kind === 'leanto' ? 3.5 : 4;
        let sc = -Math.abs(d - want) * 1.6;
        if (w.level[i] !== w.level[this.camp.tile]) sc -= 2.5;
        sc -= this.treesOnTile[i] * 1.2;
        for (const kh of kinHomes) sc -= hyp(kh.x - x, kh.z - z) * 0.25;
        sc += (hash3(i, w.params.seed, 99) % 100) * 0.012;
        if (sc > bestS) { bestS = sc; best = i; }
      }
    return best;
  }

  // ------------------------------------------------------------------ deer
  private updateDeer() {
    if (this.tick % 2) return;
    const r = this.rWild;
    const people = this.people.filter((p) => p.alive && !p.indoors && this.age(p) >= 2);
    for (const h of this.herds) {
      if (this.tick >= h.next) {
        h.tx = h.hx + r.range(-9, 9);
        h.tz = h.hz + r.range(-9, 9);
        h.next = this.tick + r.int(60, 160);
      }
    }
    for (const d of this.deer) {
      if (!d.alive) continue;
      const h = this.herds[d.herd];
      // danger: the nearest person (hunters are stealthier)
      let threat: Person | null = null, td = 99;
      for (const p of people) {
        const dist = hyp(p.x - d.x, p.z - d.z);
        const radius = p.task?.kind === 'hunt' ? Math.max(1.5, 2.6 - p.skills[SK.hunt] * 0.06) : 3.6;
        if (dist < radius && dist < td) { td = dist; threat = p; }
      }
      if (threat) {
        const ax = d.x - threat.x, az = d.z - threat.z;
        const len = hyp(ax, az) || 1;
        d.tx = d.x + (ax / len) * 7;
        d.tz = d.z + (az / len) * 7;
        d.state = 2;
        d.timer = 16;
      } else if (d.state === 2 && --d.timer <= 0) {
        d.state = 0;
        // the herd drifts to wherever they fled
        h.hx = h.hx * 0.7 + d.x * 0.3;
        h.hz = h.hz * 0.7 + d.z * 0.3;
      }
      if (d.state !== 2) {
        if (d.timer > 0) d.timer--;
        else if (r.chance(0.08)) {
          d.state = d.state === 0 ? 1 : 0;
          d.timer = r.int(10, 40);
          d.tx = h.tx + r.range(-2, 2);
          d.tz = h.tz + r.range(-2, 2);
        }
      }
      if (d.state === 0) continue;
      const speed = (d.state === 2 ? 0.7 : 0.16) * 2;
      const dx = d.tx - d.x, dz = d.tz - d.z;
      const len = hyp(dx, dz);
      if (len < 0.2) {
        d.state = 0;
        continue;
      }
      const nx = d.x + (dx / len) * Math.min(speed, len), nz = d.z + (dz / len) * Math.min(speed, len);
      const from = this.tileOf(d), to = this.tileOf({ x: nx, z: nz });
      if (to === from || (this.grid.step(from, to) && this.world.water[to] === WATER.None)) {
        d.fx = d.x + dx;
        d.fz = d.z + dz;
        d.x = nx;
        d.z = nz;
      } else {
        d.tx = d.x + r.range(-4, 4);
        d.tz = d.z + r.range(-4, 4);
      }
    }
  }

  // ------------------------------------------------------------------ queries for the AI
  /** Nearest alive prop matching `test`, within `radius` of (x,z), not reserved. */
  nearestProp(x: number, z: number, radius: number, test: (k: number) => boolean, score?: (k: number, d: number) => number) {
    let best = -1, bestS = -Infinity;
    const r2 = radius * radius;
    for (let k = 0; k < this.propCount; k++) {
      if (!this.propAlive[k] || this.reserved.has(k)) continue;
      const until = this.unreachable.get(k);
      if (until !== undefined && until > this.tick) continue;
      const dx = this.propX[k] - x, dz = this.propZ[k] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2 || !test(k)) continue;
      const s = score ? score(k, Math.sqrt(d2)) : -d2;
      if (s > bestS) { bestS = s; best = k; }
    }
    return best;
  }

  // ------------------------------------------------------------------ snapshots for the renderer
  static PERSON_STRIDE = 15;
  packPeople(): Float32Array {
    const list = this.people.filter((p) => p.alive || !p.buried);
    const out = new Float32Array(list.length * Sim.PERSON_STRIDE);
    list.forEach((p, i) => {
      const o = i * Sim.PERSON_STRIDE;
      const age = this.age(p);
      out[o] = p.id;
      out[o + 1] = p.x;
      out[o + 2] = p.z;
      out[o + 3] = p.fx;
      out[o + 4] = p.fz;
      out[o + 5] = p.alive ? p.act : ACT.Dead;
      out[o + 6] = p.carry;
      out[o + 7] = p.indoors ? 1 : 0;
      out[o + 8] = age;
      out[o + 9] = p.sex;
      out[o + 10] = p.look & 0xffff;
      out[o + 11] = (p.look >>> 16) & 0xffff;
      out[o + 12] = p.task ? TASK_KINDS.indexOf(p.task.kind) + 1 : 0;
      out[o + 13] = p.flash ?? 0;
      out[o + 14] = p.band;
    });
    return out;
  }
  static DEER_STRIDE = 6;
  packDeer(): Float32Array {
    const list = this.deer.filter((d) => d.alive);
    const out = new Float32Array(list.length * Sim.DEER_STRIDE);
    list.forEach((d, i) => {
      const o = i * Sim.DEER_STRIDE;
      out[o] = d.id;
      out[o + 1] = d.x;
      out[o + 2] = d.z;
      out[o + 3] = d.fx;
      out[o + 4] = d.fz;
      out[o + 5] = d.state + (d.fawn ? 10 : 0);
    });
    return out;
  }
  packBuildings() {
    const living = this.living();
    return this.buildings.map((b) => ({
      empty: b.built && (b.kind === 'hut' || b.kind === 'leanto') && !living.some((p) => p.home === b.id),
      id: b.id, band: b.band, kind: b.kind, x: b.x, z: b.z, rot: b.rot, built: b.built,
      progress: b.built ? 1 : Math.min(0.98, (b.work / Math.max(1, specOf(b).work)) * 0.85 + (b.wood / Math.max(1, specOf(b).wood)) * 0.15),
      walls: b.walls ?? 'wood',
      fuel: b.fuel, owner: b.owner,
    }));
  }
  /** What lies on each band's stockpile, for drawing it (food is out of sight once there is a storehouse). */
  packPiles() {
    return this.buildings.filter((b) => b.kind === 'stockpile').map((b) => {
      const c = this.campById(b.band);
      const st = c && !c.gone ? c.stock : { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
      const inside = this.buildings.some((q) => q.band === b.band && q.kind === 'storehouse' && q.built);
      return { id: b.id, wood: st.wood, berries: inside ? 0 : st.berries, meat: inside ? 0 : st.meat, fish: inside ? 0 : st.fish, preserved: inside ? 0 : st.preserved };
    });
  }
  packProps() {
    const n = this.propCount;
    return {
      count: n,
      type: this.propType.slice(0, n),
      x: this.propX.slice(0, n),
      y: this.propY.slice(0, n),
      z: this.propZ.slice(0, n),
      rot: this.propRot.slice(0, n),
      scale: this.propScale.slice(0, n),
      alive: this.propAlive.slice(0, n),
      val: this.propVal.slice(0, n),
    };
  }

  /** The state of one band (the given one, or else the largest still living), and a line on every band. */
  summary(focus = -1) {
    const live = this.liveCamps();
    const c = (focus >= 0 ? this.campById(focus) : undefined) ?? [...live].sort((a, b) => this.members(b).length - this.members(a).length || a.id - b.id)[0] ?? this.camps[this.camps.length - 1];
    const living = this.members(c);
    const mine = this.bandBuildings(c);
    const meals = living.reduce((s, p) => s + (this.age(p) < 12 ? 1.1 : 1.8), 0);
    const food = foodTotal(c.stock);
    return {
      tick: this.tick,
      camp: c.name,
      band: c.id,
      gone: c.gone,
      founded: c.founded,
      x: c.x,
      z: c.z,
      parent: this.campById(c.parent)?.name ?? null,
      first: c === this.camps[0],
      leader: this.byId.get(c.leader) ? { id: c.leader, name: this.byId.get(c.leader)!.name, alive: this.byId.get(c.leader)!.alive } : null,
      /** every band, living ones first */
      bands: [...this.camps].sort((a, b) => (a.gone ? 1 : 0) - (b.gone ? 1 : 0) || a.founded - b.founded).map((b) => ({
        id: b.id, name: b.name, pop: this.members(b).length, gone: b.gone, x: b.x, z: b.z, founded: b.founded,
        color: b.color ?? { h: 30, s: 0.5, l: 0.5 }, origin: b.origin ?? (b.parent < 0 ? 'first' : 'amicable'), parent: b.parent,
      })),
      worldPop: this.living().length,
      pop: living.length,
      children: living.filter((p) => this.age(p) < 14).length,
      elders: living.filter((p) => this.age(p) >= 55).length,
      food: Math.round(food),
      foodDays: food / Math.max(1, meals),
      stock: { ...c.stock },
      fuel: this.hearth(c).fuel,
      homes: mine.filter((b) => (b.kind === 'hut' || b.kind === 'leanto') && b.built).length,
      building: mine.filter((b) => !b.built).map((b) => labelOf(b)),
      plan: c.plan.slice(),
      famine: c.famine,
      knowsPreserving: c.knowsPreserving,
      knowsStonework: !!c.knowsStonework,
      deer: this.deer.filter((d) => d.alive).length,
      stats: { ...this.stats },
      temp: temperature(this.tick, this.anomaly, Math.max(0, this.world.level[c.tile] - SEA - 1)),
      anomaly: this.anomaly,
      dead: this.people.filter((p) => !p.alive && p.band === c.id).length,
      roster: this.people.filter((p) => p.alive || !p.buried).map((p) => ({ id: p.id, name: p.name })),
      jobs: { ...c.jobs },
      stores: this.stores(c),
      pile: this.buildings.find((b) => b.band === c.id && b.kind === 'stockpile')?.id ?? -1,
      historyHash: this.historyHash(),
    };
  }

  when(tick: number) {
    const day = Math.floor(tick / TICKS_PER_DAY);
    return `${SEASON_WORD[Math.floor((day % DAYS_PER_YEAR) / 12)]} of year ${Math.floor(day / DAYS_PER_YEAR) + 1}`;
  }

  /** A card describing any clickable thing that isn't a person. */
  inspectThing(ref: Ref): Card | null {
    const pref = (id: number): Ref => ({ kind: 'person', id });
    const L = (label: string, value: string, ref?: Ref): CardLine => ({ label, value, ref });
    if (ref.kind === 'deer') {
      const d = this.deer.find((q) => q.id === ref.id);
      if (!d) return null;
      const herd = this.deer.filter((q) => q.alive && q.herd === d.herd);
      const hunter = this.people.find((p) => p.alive && p.task?.kind === 'hunt' && p.task.ref === d.id);
      const lines: CardLine[] = [
        L('Herd', `${herd.length} deer${herd.some((q) => q.fawn) ? `, ${herd.filter((q) => q.fawn).length} ${herd.filter((q) => q.fawn).length === 1 ? 'fawn' : 'fawns'}` : ''}`),
        L('Doing', !d.alive ? 'Taken by hunters' : d.state === 2 ? 'Running from people' : d.state === 1 ? 'Moving with the herd' : 'Grazing'),
        L('Meat', d.fawn ? 'About 4 meals' : 'About 8 meals'),
      ];
      if (hunter) lines.push(L('Hunted by', hunter.name, pref(hunter.id)));
      return {
        ref, title: d.fawn ? 'Fawn' : d.id % 2 ? 'Red deer stag' : 'Red deer hind', subtitle: d.alive ? 'Wild deer' : 'Killed',
        lines, notes: [`The band has brought down ${this.stats.kills} deer so far. Herds breed each spring and drift away from danger.`],
        x: d.x, z: d.z, gone: !d.alive,
      };
    }
    if (ref.kind === 'building') {
      const b = this.buildings.find((q) => q.id === ref.id);
      if (!b) return null;
      const prevCamp = this.camp;
      this.camp = this.campById(b.band) ?? this.camp;
      try { return this.buildingCard(ref, b); } finally { this.camp = prevCamp; }
    }
    return this.otherCard(ref);
  }

  private buildingCard(ref: Ref, b: Building): Card {
    const name = (id: number) => this.byId.get(id)?.name ?? 'someone';
    const pref = (id: number): Ref => ({ kind: 'person', id });
    const L = (label: string, value: string, ref?: Ref): CardLine => ({ label, value, ref });
    {
      const spec = specOf(b);
      const label = labelOf(b);
      const owner = this.byId.get(b.owner);
      const lines: CardLine[] = [];
      const notes: string[] = [];
      if (!b.built) {
        lines.push(L('Wood', `${Math.floor(b.wood)} of ${spec.wood} loads delivered`));
        if (spec.fiber) lines.push(L('Thatch', `${Math.floor(b.fiber)} of ${spec.fiber} bundles of grass and reeds`));
        if (spec.cordage) lines.push(L('Cordage', `${Math.floor(b.cordage)} of ${spec.cordage} lengths`));
        if (spec.mud) lines.push(L('Mud', `${Math.floor(b.mud)} of ${spec.mud} loads for the daub`));
        if (spec.stone) lines.push(L('Stone', `${Math.floor(b.stone)} of ${spec.stone} loads for the walls`));
        lines.push(L('Work', `${Math.round((b.work / spec.work) * 100)}% done`));
        const workers = this.people.filter((p) => p.alive && (p.task?.kind === 'build' || p.task?.kind === 'supply') && p.task.ref === b.id);
        const fetching = { wood: 'Fetching wood', fiber: 'Fetching thatch', cordage: 'Fetching cordage', mud: 'Fetching mud', stone: 'Fetching stone' };
        for (const p of workers) lines.push(L(p.task!.kind === 'build' ? 'Building' : fetching[p.task!.res ?? 'wood'], p.name, pref(p.id)));
      }
      if (b.kind === 'hearth') {
        const hours = b.fuel / this.burnRate(b);
        lines.push(L('Fire', b.fuel > 0 ? `Burning, about ${Math.max(1, Math.round(hours))} hours of wood left` : 'Out'));
        lines.push(L('Wood in store', `${Math.floor(this.camp.stock.wood)} loads`));
        const reach = this.hasBuilt('windbreak') ? WARM_RADIUS_SHELTERED : WARM_RADIUS;
        const warm = this.people.filter((p) => p.alive && hyp(p.x - this.camp.x, p.z - this.camp.z) < reach && !p.indoors);
        if (warm.length) lines.push(L('By the fire', warm.map((p) => p.name).join(', ')));
        if (this.dampWood()) lines.push(L('Firewood', 'Damp: it burns a fifth faster without a roof over the woodpile'));
        if (this.hasBuilt('windbreak')) lines.push(L('Windbreak', 'Throws the heat back: a wider, warmer circle'));
        notes.push(`The heart of ${this.camp.name} since ${this.when(this.camp.founded)}. People eat and warm themselves here, and sleep beside it until they have a roof.`);
      }
      if (b.kind === 'hut' || b.kind === 'leanto') {
        const res = this.people.filter((p) => p.alive && p.home === b.id);
        for (const p of res) lines.push(L(res.indexOf(p) === 0 ? 'Home to' : '', `${p.name}, ${Math.floor(this.age(p))}`, pref(p.id)));
        if (b.built) lines.push(L('Shelter', `Keeps out ${Math.round(spec.shelter * 100)}% of the cold`));
      }
      if (b.kind === 'storehouse') {
        const st = this.camp.stock;
        lines.push(L('Holding', `${Math.round(foodTotal(st))} meals: ${Math.round(st.berries)} berries, ${Math.round(st.meat)} meat, ${Math.round(st.fish)} fish, ${Math.round(st.preserved)} dried`));
        const walls = b.walls === 'stone' ? 'Its stone walls keep out damp and vermin' : b.walls === 'daub' ? 'Its daubed walls keep it dry' : 'Raised off the ground, it keeps food dry';
        notes.push(`${walls}: food inside spoils ${Math.round((1 - spec.keep) * 100)}% slower. Firewood stays stacked at the stockpile.`);
      }
      if (b.kind === 'stockpile') {
        const st = this.camp.stock;
        const inside = this.buildings.some((q) => q.band === b.band && q.kind === 'storehouse' && q.built);
        lines.push(L('Wood', `${Math.floor(st.wood)} loads`));
        if (st.fiber >= 0.5 || st.cordage >= 0.5) lines.push(L('Fiber', `${Math.floor(st.fiber)} bundles of grass and reeds, ${Math.floor(st.cordage)} lengths of cordage`));
        if (st.mud >= 0.5) lines.push(L('Mud', `${Math.floor(st.mud)} loads`));
        if (st.stone >= 0.5) lines.push(L('Stone', `${Math.floor(st.stone)} loads`));
        if (inside) lines.push(L('Food', `${Math.round(foodTotal(st))} meals, kept in the storehouse`));
        else {
          lines.push(L('Berries', `${Math.round(st.berries)} handfuls`));
          lines.push(L('Meat', `${Math.round(st.meat)} meals`));
          lines.push(L('Fish', `${Math.round(st.fish)} meals`));
          if (st.preserved > 0.5) lines.push(L('Dried', `${Math.round(st.preserved)} meals`));
        }
        const book = this.stores(this.camp);
        const y = book.now;
        lines.push(L(`This year (${book.year})`, `${y.food} food in (${y.gathered.berries} berries, ${y.gathered.meat} meat, ${y.gathered.fish} fish), ${y.gathered.wood} wood`));
        lines.push(L('Used', `${y.eaten} eaten, ${y.spoiled} spoiled${y.dried ? `, ${y.dried} dried` : ''}; ${y.burned} wood burned, ${y.built} built with`));
        if (y.gathered.fiber + y.twisted > 0) lines.push(L('Fiber', `${y.gathered.fiber} cut, ${y.twisted} twisted into cordage, ${y.thatch} thatch and ${y.lashed} cordage built with`));
        if (book.last.food + book.last.gathered.wood > 0) lines.push(L('Last year', `${book.last.food} food in, ${book.last.eaten} eaten, ${book.last.spoiled} spoiled; ${book.last.gathered.wood} wood in, ${book.last.burned} burned`));
        const t = book.total;
        lines.push(L('Since founding', `${t.food} food and ${t.gathered.wood} wood brought in; ${t.eaten} eaten, ${t.spoiled} spoiled, ${t.burned} burned, ${t.built} built with`));
        if (t.carried) notes.push(`${t.carried} went with those who left to found camps of their own.`);
        notes.push(inside ? 'Everyone brings wood here. Food goes into the storehouse.' : 'Everything gathered is brought here: wood stacked at the back, food on the mat. Food left out spoils fast in the warm months.');
      }
      if (b.kind === 'windbreak' && b.built) notes.push('A screen of stakes and logs behind the fire. It keeps the wind off and throws the heat back, so the fire warms people faster and further out.');
      if (b.kind === 'woodshed' && b.built) notes.push('A thatched roof over the stacked firewood. Wood left in the open is damp through autumn and winter and burns a fifth faster; under the roof it stays dry.');
      if (b.kind === 'rack') {
        lines.push(L('Dried food', `${Math.round(this.camp.stock.preserved)} meals`));
        notes.push('Meat and fish dried here keep for most of a year.');
      }
      if (b.built && b.builders.length) notes.push(`Raised by ${b.builders.map(name).join(', ')}, finished ${this.when(b.finished)}.`);
      else if (!b.built) notes.push(`Begun ${this.when(b.started)}.`);
      const home = b.kind === 'hut' || b.kind === 'leanto';
      const empty = home && b.built && !this.people.some((p) => p.alive && p.home === b.id);
      if (empty && owner) notes.unshift(`Empty now. It was the home of ${owner.name}'s family${owner.alive ? '' : `; ${owner.name} died ${this.when(owner.death)}`}.`);
      if (this.camp.gone) notes.unshift(`Abandoned: no one has lived at ${this.camp.name} since ${this.when(this.camp.gone)}.`);
      return {
        ref, title: empty ? `Empty ${label.toLowerCase()}` : owner && home ? `${label} of ${owner.name}'s family` : label,
        subtitle: b.built ? (b.kind === 'hearth' ? `${this.camp.gone ? 'Cold hearth' : 'Camp fire'} of ${this.camp.name}` : `${this.camp.name} · built ${this.when(b.finished)}`) : 'Under construction',
        lines, notes, x: b.x + 0.5, z: b.z + 0.5,
      };
    }
  }

  private otherCard(ref: Ref): Card | null {
    const N = this.N;
    const w = this.world;
    const name = (id: number) => this.byId.get(id)?.name ?? 'someone';
    const pref = (id: number): Ref => ({ kind: 'person', id });
    const L = (label: string, value: string, ref?: Ref): CardLine => ({ label, value, ref });
    if (ref.kind === 'prop') {
      const k = ref.id;
      if (k < 0 || k >= this.propCount) return null;
      const t = this.propType[k];
      const x = this.propX[k], z = this.propZ[k];
      const gone = !this.propAlive[k];
      const by = this.reserved.get(k);
      const lines: CardLine[] = [];
      const notes: string[] = [];
      const note = this.propNote.get(k);
      if (note) notes.push(note);
      let title = 'Thing', subtitle = '';
      if (isTreeType(t)) {
        const sp = SPECIES[treeSpecies(t)], st = treeStage(t);
        title = `${STAGE_WORD[st][0].toUpperCase()}${STAGE_WORD[st].slice(1)} ${sp}`;
        subtitle = sp === 'pine' ? 'Evergreen' : 'Loses its leaves in autumn';
        const age = [2, 8, 20, 45][st] + Math.floor(this.propVal[k]);
        lines.push(L('Age', `About ${age} years`));
        lines.push(L('Wood if felled', `${WOOD_BY_STAGE[st]} loads`));
        if (st >= 2) lines.push(L('Seeds', 'Scatters saplings nearby each spring'));
        else lines.push(L('Growing', `Next stage in about ${Math.max(1, [3, 5, 9][st] - Math.floor(this.propVal[k]))} years`));
        if (by !== undefined) lines.push(L('Marked for felling by', name(by), pref(by)));
        if (this.chopped.has(k)) notes.push('Someone has started cutting it down: an axe wound in the trunk.');
        lines.push(L('Deadwood', this.deadwoodTaken.has(k) ? 'Gathered this year' : `About ${DEADWOOD_BY_STAGE[st]} ${DEADWOOD_BY_STAGE[st] === 1 ? 'load' : 'loads'} of fallen branches`));
      } else if (isBerry(t)) {
        title = 'Berry bush';
        subtitle = 'Ripens from midsummer to late autumn';
        lines.push(L('Fruit', this.propVal[k] >= 1 ? `${Math.floor(this.propVal[k])} handfuls ripe` : berriesRipe(this.tick) ? 'Picked clean' : 'Not ripe yet'));
        if (by !== undefined) lines.push(L('Being picked by', name(by), pref(by)));
      } else if (isFiberPlant(t)) {
        title = isReeds(t) ? 'Reeds' : 'Tall grass';
        subtitle = isReeds(t) ? 'Cut for thatch and cordage; grows back from the roots' : 'Cut for thatch and cordage; grows back by summer';
        const v = this.propVal[k], cap = fiberCap(t);
        lines.push(L('Fiber', v >= cap - 0.01 ? `${cap} bundles, fully grown` : v >= 1 ? `${Math.floor(v)} of ${cap} bundles` : 'Cut back'));
        if (by !== undefined) lines.push(L('Being cut by', name(by), pref(by)));
      } else if (t >= STUMP_BASE && t < STUMP_BASE + 3) {
        title = `${SPECIES[t - STUMP_BASE][0].toUpperCase()}${SPECIES[t - STUMP_BASE].slice(1)} stump`;
        subtitle = 'Rots away over a few years';
      } else if (t === LOGS || t === LOGS + 1) {
        title = 'Pile of logs';
        subtitle = `${Math.round(this.propVal[k])} loads of wood waiting to be hauled to camp`;
        if (by !== undefined) lines.push(L('Being hauled by', name(by), pref(by)));
      } else if (t === GRAVE || t === GRAVE + 1) {
        const dead = this.byId.get(this.propVal[k]);
        title = dead ? `Grave of ${dead.name}` : 'Grave';
        if (dead) {
          subtitle = `${Math.floor(ageYears(dead.death, dead.birth))} years old, ${dead.cause}`;
          lines.push(L('Born', this.when(dead.birth)));
          lines.push(L('Died', this.when(dead.death)));
          if (dead.partner >= 0 || this.people.some((p) => p.partner === dead.id)) {
            const pt = this.people.find((p) => p.partner === dead.id) ?? this.byId.get(dead.partner);
            if (pt) lines.push(L('Partner', pt.name, pref(pt.id)));
          }
          const kids = dead.children.map((c) => this.byId.get(c)!).filter(Boolean);
          if (kids.length) lines.push(L('Children', kids.map((c) => c.name).join(', '), pref(kids[0].id)));
          const mourners = this.living().filter((p) => p.memories.some((m) => m.kind === 'death' && m.subject === dead.id)).length;
          if (mourners) notes.push(`${mourners} of the living still remember them.`);
          lines.push(L('Life', 'Open their story', pref(dead.id)));
        }
      } else {
        const base = PROP_NAMES_LOCAL[t];
        const D: Record<string, [string, string]> = {
          bush: ['Bush', 'Shelter for birds, no fruit'],
          reeds: ['Reeds', 'Grow in shallow water; later good for baskets and thatch'],
          grass: ['Tuft of grass', ''],
          rock: ['Boulder', 'Stone, once people learn to shape it'],
          outcrop: ['Rock outcrop', 'Bare stone breaking through the soil'],
        };
        [title, subtitle] = D[base] ?? ['Thing', ''];
      }
      return { ref, title, subtitle, lines, notes, x, z, gone };
    }
    if (ref.kind === 'tile') {
      const i = ref.id;
      if (i < 0 || i >= N * N) return null;
      const tx = i % N, tz = Math.floor(i / N);
      const wk = w.water[i];
      const lines: CardLine[] = [];
      const notes: string[] = [];
      let title = ['Deep water', 'Shallow water', 'Shore', 'Grassland', 'Forest floor', 'Stony ground', 'Mountainside'][w.terrain[i]];
      if (wk === WATER.Lake) title = 'Lake';
      if (wk === WATER.River) title = 'River';
      if (wk === WATER.Sea) title = w.terrain[i] === T.DeepWater ? 'Open sea' : 'Coastal shallows';
      const temp = temperature(this.tick, this.anomaly, Math.max(0, w.level[i] - SEA - 1));
      lines.push(L(wk ? 'Depth' : 'Elevation', wk ? `${((w.waterY[i] - w.groundY[i]) * 6).toFixed(1)} m` : `${Math.round((w.groundY[i] - (SEA + 0.75) * 0.45) * 6)} m above the sea`));
      lines.push(L('Air', `${Math.round(temp)}°C right now`));
      if (this.fishCap[i] > 0) {
        const f = this.fish[i] / this.fishCap[i];
        lines.push(L('Fish', f > 0.7 ? 'Plenty' : f > 0.35 ? 'Some' : f > 0.1 ? 'Few, fished out' : 'None left'));
        if (wk !== WATER.Sea && freshFrozen(this.tick)) lines.push(L('Ice', 'Frozen over: no fishing until the thaw'));
      }
      if (wk === WATER.River) notes.push('Shallow enough to wade across.');
      if (!wk) {
        lines.push(L('Moisture', `${Math.round((w.moisture[i] / 255) * 100)}%`));
        if (w.fertility[i] > 0) lines.push(L('Fertility', `${Math.round((w.fertility[i] / 255) * 100)}%`));
        if (w.stone[i]) lines.push(L('Stone', `${w.stone[i]} loads`));
        if (w.clay[i]) lines.push(L('Clay', 'Good riverbank clay'));
        if (w.ore[i]) lines.push(L('Ore', `${['', 'Copper', 'Tin', 'Iron', 'Gold'][w.ore[i]]}, undiscovered`));
        lines.push(L('Trees', `${this.treesOnTile[i]}`));
      }
      const here = this.people.filter((p) => p.alive && !p.indoors && this.tileOf(p) === i);
      for (const p of here) lines.push(L('Here now', p.name, pref(p.id)));
      const near = this.camps.find((c) => hyp(tx + 0.5 - c.x, tz + 0.5 - c.z) < 10);
      if (near) notes.push(near.gone ? `Where ${near.name} stood, until it was left in the ${this.when(near.gone)}.` : `Part of the camp at ${near.name}.`);
      return { ref, title, subtitle: `Tile ${tx}, ${tz}`, lines, notes, x: tx + 0.5, z: tz + 0.5 };
    }
    return null;
  }

  private sample() {
    const living = this.living();
    const n = Math.max(1, living.length);
    // stores across every band
    const st: Stock = { berries: 0, meat: 0, fish: 0, preserved: 0, wood: 0, fiber: 0, cordage: 0, mud: 0, stone: 0 };
    for (const c of this.liveCamps()) for (const k of Object.keys(st) as (keyof Stock)[]) st[k] += c.stock[k];
    this.history.push({
      tick: this.tick,
      pop: living.length,
      children: living.filter((p) => this.age(p) < 14).length,
      elders: living.filter((p) => this.age(p) >= 55).length,
      food: Math.round(foodTotal(st)),
      preserved: Math.round(st.preserved),
      wood: Math.floor(st.wood),
      homes: this.buildings.filter((b) => (b.kind === 'hut' || b.kind === 'leanto') && b.built).length,
      mood: Math.round(living.reduce((a, p) => a + p.mood, 0) / n),
      health: Math.round(living.reduce((a, p) => a + p.health, 0) / n),
      deer: this.deer.filter((d) => d.alive).length,
      anomaly: Math.round(this.anomaly * 10) / 10,
      births: this.stats.births,
      deaths: this.stats.deaths,
      kills: this.stats.kills,
      felled: this.stats.felled,
      famine: this.liveCamps().some((c) => c.famine) ? 1 : 0,
      bands: this.liveCamps().map((c) => ({ id: c.id, pop: this.members(c).length })),
      ...this.ledgerTotals(),
    });
  }

  /** Every band's ledger added up, since the world began (running totals). */
  private ledgerTotals() {
    const t = { gFood: 0, gWood: 0, eaten: 0, spoiled: 0, burned: 0 };
    for (const c of this.camps) {
      const r = c.ledger?.total ?? {};
      const g = (k: string) => r[k] ?? 0;
      t.gFood += g('gathered.berries') + g('gathered.meat') + g('gathered.fish');
      t.gWood += g('gathered.wood');
      for (const k of ['berries', 'meat', 'fish', 'preserved']) { t.eaten += g(`eaten.${k}`); t.spoiled += g(`spoiled.${k}`); }
      t.burned += g('burned');
    }
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = Math.round(t[k]);
    return t;
  }

  /** Everything the chronicle needs that the page doesn't already have. */
  chronicle() {
    const name = (id: number) => this.byId.get(id)?.name ?? '';
    return {
      tick: this.tick,
      camp: this.camps[0].name,
      founded: this.camps[0].founded,
      /** every band there has been */
      camps: this.camps.map((c) => ({ id: c.id, name: c.name, founded: c.founded, gone: c.gone, parent: c.parent, leader: c.leader, x: c.x, z: c.z, pop: this.members(c).length, color: c.color ?? { h: 30, s: 0.5, l: 0.5 }, origin: c.origin ?? '' })),
      stats: { ...this.stats },
      history: this.history.slice(),
      people: this.people.map((p) => ({
        id: p.id, name: p.name, sex: p.sex, birth: p.birth, death: p.alive ? -1 : p.death, alive: p.alive, cause: p.cause,
        mother: p.mother, father: p.father, partner: p.partner, partnerName: name(p.partner), carer: p.carer,
        children: p.children.slice(), kills: p.kills, traits: p.traits.slice(),
        topSkill: Math.max(...Array.from(p.skills)), skills: Array.from(p.skills), x: p.x, z: p.z, band: p.band,
      })),
    };
  }

  /** Children, grandchildren and so on, living and dead. */
  private descendants(id: number) {
    let n = 0;
    const seen = new Set<number>();
    const walk = (pid: number) => {
      for (const c of this.byId.get(pid)?.children ?? []) if (!seen.has(c)) { seen.add(c); n++; walk(c); }
    };
    walk(id);
    return n;
  }

  /** Everything the person card needs. */
  inspect(id: number) {
    const p = this.byId.get(id);
    if (!p) return null;
    const name = (pid: number) => this.byId.get(pid)?.name ?? '';
    const rels = [...p.rel.entries()]
      .map(([q, v]) => ({ id: q, name: name(q), v, alive: this.byId.get(q)?.alive ?? false }))
      .filter((r) => r.alive)
      .sort((a, b) => b.v - a.v);
    const home = this.buildings.find((b) => b.id === p.home);
    return {
      id: p.id, name: p.name, sex: p.sex, age: this.age(p), alive: p.alive, cause: p.cause,
      death: p.death, birth: p.birth,
      needs: { food: p.food, rest: p.rest, warmth: p.warmth, belonging: p.belonging, safety: p.safety },
      health: p.health, mood: p.mood, sick: p.sick > 0, pregnant: p.pregnantUntil > 0,
      traits: p.traits.slice(),
      skills: Array.from(p.skills),
      thought: p.thought,
      task: p.task?.kind ?? null,
      partner: p.partner >= 0 ? { id: p.partner, name: name(p.partner) } : null,
      mother: p.mother >= 0 ? { id: p.mother, name: name(p.mother), alive: this.byId.get(p.mother)?.alive ?? false } : null,
      father: p.father >= 0 ? { id: p.father, name: name(p.father), alive: this.byId.get(p.father)?.alive ?? false } : null,
      children: p.children.map((c) => ({ id: c, name: name(c), alive: this.byId.get(c)?.alive ?? false })),
      carer: p.carer >= 0 ? { id: p.carer, name: name(p.carer), alive: this.byId.get(p.carer)?.alive ?? false } : null,
      fostering: this.people.filter((q) => q.carer === p.id).map((q) => ({ id: q.id, name: q.name, alive: q.alive })),
      friends: rels.filter((r) => r.v >= 40).slice(0, 4),
      rivals: rels.filter((r) => r.v <= -15).slice(-3),
      memories: p.memories
        .map((m) => ({ text: m.text, tick: m.tick, weight: m.weight, now: this.memoryNow(m) }))
        .sort((a, b) => b.tick - a.tick),
      home: home ? labelOf(home) : null,
      kills: p.kills,
      carry: p.carry,
      carryAmt: p.carryAmt,
      indoors: p.indoors,
      campDist: hyp(p.x - this.campOf(p).x, p.z - this.campOf(p).z),
      band: p.band,
      bandName: this.campOf(p).name,
      knows: rels.length,
      descendants: this.descendants(p.id),
      x: p.x,
      z: p.z,
    };
  }
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const num = (n: number) => NUMBERS[n] ?? String(n);
/** Which way, in words, from one point to another (north is toward the top of the map). */
export function compass(dx: number, dz: number) {
  const a = Math.atan2(dx, -dz);
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function clamp(v: number) {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}
export function clamp01(v: number, lo = 0, hi = 1) {
  return v < lo ? lo : v > hi ? hi : v;
}
export type { Task, TaskKind };
export { LOGS, GRAVE, STUMP_BASE, WOOD_BY_STAGE };

export interface BandColor {
  h: number;
  s: number;
  l: number;
}

// ------------------------------------------------------------------ ledger
export interface Ledger {
  year: number;
  /** keyed flows: 'gathered.meat', 'eaten.fish', 'spoiled.berries', 'burned', 'built', 'dried', 'carried', 'brought' */
  now: Record<string, number>;
  last: Record<string, number>;
  total: Record<string, number>;
}

// ------------------------------------------------------------------ history
export const HISTORY_EVERY_DAYS = 4;
export interface HistorySample {
  tick: number;
  pop: number;
  children: number;
  elders: number;
  food: number;
  preserved: number;
  wood: number;
  homes: number;
  mood: number;
  health: number;
  deer: number;
  anomaly: number;
  /** running totals */
  births: number;
  deaths: number;
  kills: number;
  felled: number;
  famine: number;
  /** each living band's numbers (absent in older saves) */
  bands?: { id: number; pop: number }[];
  /** the stores' running totals, all bands together (absent in older saves) */
  gFood?: number;
  gWood?: number;
  eaten?: number;
  spoiled?: number;
  burned?: number;
}
export type Chronicle = ReturnType<Sim['chronicle']>;

// ------------------------------------------------------------------ save format
export const SAVE_VERSION = 1;
type Entries<K, V> = [K, V][];
type SavedPerson = Omit<Person, 'skills' | 'rel' | 'path'> & { skills: number[]; rel: Entries<number, number>; path: string | null };
export interface SaveData {
  v: number;
  params: WorldParams;
  worldHash: string;
  tick: number;
  anomaly: number;
  nextId: number;
  nextEvent: number;
  eventHash: number;
  rng: { life: number[]; ai: number[]; wild: number[]; tongue: number[] };
  props: { count: number; type: string; x: string; y: string; z: string; rot: string; scale: string; alive: string; val: string; tile: string };
  propNote: Entries<number, string>;
  reserved: Entries<number, number>;
  unreachable: Entries<number, number>;
  chopped: Entries<number, number>;
  deadwoodTaken: Entries<number, number>;
  fish: string;
  stats: Sim['stats'];
  /** absent in saves from before the chronicle */
  history?: HistorySample[];
  /** absent in saves from before there could be several bands */
  camps?: Camp[];
  fortune?: { plentyYear: number; blightYear: number };
  camp: Camp;
  events: SimEvent[];
  people: SavedPerson[];
  buildings: Building[];
  deer: Deer[];
  herds: Herd[];
}

/** Typed array bytes as base64 (works in browsers, workers and Node). */
export function b64(a: ArrayBufferView): string {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000)));
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
