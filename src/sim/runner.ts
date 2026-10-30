// Runs a Sim at a chosen speed and streams frames to the renderer. Used inside the
// worker, or directly on the main thread when workers are unavailable.
import { generateWorld } from './worldgen';
import { Sim, SaveData } from './sim';
import type { Chronicle } from './sim';
import type { WorldParams, WorldData } from './types';
import type { Ref, Card } from './band';
import { TICKS_PER_HOUR } from './time';

export type ToSim =
  | { type: 'init'; params: WorldParams }
  | { type: 'speed'; speed: number; paused: boolean }
  /** everything with an open info window; the first is the one in focus */
  | { type: 'inspect'; targets: Ref[] }
  | { type: 'skip'; ticks: number }
  /** take a snapshot of the running world */
  | { type: 'save'; id: number }
  /** everything the chronicle needs */
  | { type: 'chronicle' }
  /** which band the summary describes (-1: the largest) */
  | { type: 'focus'; band: number }
  /** carry on from a snapshot */
  | { type: 'load'; save: SaveData };

export interface Frame {
  type: 'frame';
  tick: number;
  speed: number; // effective ticks per second
  people: Float32Array;
  deer: Float32Array;
  buildings?: ReturnType<Sim['packBuildings']>;
  props?: ReturnType<Sim['packProps']>;
  summary?: ReturnType<Sim['summary']>;
  events?: Sim['events'];
  piles?: ReturnType<Sim['packPiles']>;
  traps?: ReturnType<Sim['packTraps']>;
  /** one answer per open info window, in the order asked */
  looks?: Look[];
  skipping: boolean;
}
/** What the simulation knows about one inspected thing (null: it no longer exists). */
export interface Look {
  key: string;
  person?: ReturnType<Sim['inspect']>;
  card?: Card | null;
}
export const refKey = (r: Ref) => `${r.kind}:${r.id}`;
export type FromSim =
  | { type: 'world'; world: WorldData; tick: number }
  | Frame
  /** `stopped`: the simulation was running and hit a bug; it will not advance any further */
  | { type: 'error'; message: string; stopped?: boolean; tick?: number; load?: boolean }
  | { type: 'ready' }
  | { type: 'saved'; id: number; save: SaveData | null; error?: string }
  | { type: 'chronicle'; data: Chronicle };

/** Ticks per real second at 1x: a walking pace (a game day lasts about a minute and a half). */
export const BASE_TPS = 2.5;

export class Runner {
  sim?: Sim;
  private speed = 1;
  private paused = false;
  private owed = 0;
  private last = 0;
  private lastFrame = 0;
  private lastProps = 0;
  private lastSummary = 0;
  private propsVersion = -1;
  private buildingsVersion = -1;
  private eventCursor = 0;
  private targets: Ref[] = [];
  private focusBand = -1;
  private skipTo = -1;
  private ticksThisSecond = 0;
  private tpsWindowStart = 0;
  private measuredTps = 0;
  /** set once the simulation has thrown: nothing more is stepped or sent */
  private crashed = false;

  constructor(private post: (m: FromSim, transfer?: Transferable[]) => void, private now: () => number) {}

  handle(m: ToSim) {
    if (m.type !== 'init' && m.type !== 'load' && this.crashed) return;
    try {
      this.handleInner(m);
    } catch (e) {
      this.fail(e);
    }
  }

  private start(sim: Sim, world: WorldData) {
    this.sim = sim;
    this.crashed = false;
    this.skipTo = -1;
    this.post({ type: 'world', world, tick: sim.tick });
    this.propsVersion = this.buildingsVersion = -1;
    this.eventCursor = 0;
    this.owed = 0;
    this.last = this.now();
    this.emit(true);
  }

  /** A bug in the simulation: say so once, with enough detail to reproduce it, and stop. */
  private fail(e: unknown) {
    if (this.crashed) return;
    this.crashed = true;
    const err = e as Error;
    const where = err?.stack?.split('\n').slice(1, 3).map((l) => l.trim()).join(' · ') ?? '';
    console.error('Simulation stopped:', e);
    this.post({ type: 'error', message: `${err?.message ?? String(e)}${where ? ` (${where})` : ''}`, stopped: true, tick: this.sim?.tick });
  }

  private handleInner(m: ToSim) {
    if (m.type === 'init') {
      this.crashed = false;
      try {
        const world = generateWorld(m.params);
        this.start(new Sim(world), world);
      } catch (e) {
        this.post({ type: 'error', message: (e as Error).message });
      }
    } else if (m.type === 'speed') {
      this.speed = m.speed;
      this.paused = m.paused;
    } else if (m.type === 'inspect') {
      this.targets = m.targets.slice(0, 8);
      this.emit(true);
    } else if (m.type === 'focus') {
      this.focusBand = m.band;
      this.emit(true);
    } else if (m.type === 'chronicle' && this.sim) {
      this.post({ type: 'chronicle', data: this.sim.chronicle() });
    } else if (m.type === 'skip' && this.sim) {
      this.skipTo = this.sim.tick + m.ticks;
    } else if (m.type === 'save') {
      if (!this.sim) this.post({ type: 'saved', id: m.id, save: null, error: 'There is no world to save yet.' });
      else this.post({ type: 'saved', id: m.id, save: this.sim.serialize() });
    } else if (m.type === 'load') {
      try {
        const save = m.save;
        const world = generateWorld(save.params);
        if (world.hash !== save.worldHash) throw new Error('it was made with a different version of the world generator, so the land would not match.');
        this.start(new Sim(world, save), world);
      } catch (e) {
        this.post({ type: 'error', message: `This save could not be loaded: ${(e as Error).message}`, load: true });
      }
    }
  }

  /** Advance the simulation by however many ticks are owed, within a time budget. */
  pump(budgetMs = 10) {
    if (this.crashed) return;
    try {
      this.pumpInner(budgetMs);
    } catch (e) {
      this.fail(e);
    }
  }

  private pumpInner(budgetMs: number) {
    const sim = this.sim;
    if (!sim) return;
    const t = this.now();
    const dt = Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    const skipping = this.skipTo > sim.tick;
    if (!this.paused || skipping) this.owed += dt * BASE_TPS * (skipping ? 0 : this.speed);
    const start = this.now();
    let ran = 0;
    if (skipping) {
      // fast-forward as fast as the budget allows
      while (sim.tick < this.skipTo && this.now() - start < budgetMs * 2.5) {
        sim.step();
        ran++;
      }
      if (sim.tick >= this.skipTo) this.skipTo = -1;
    } else {
      while (this.owed >= 1 && this.now() - start < budgetMs) {
        sim.step();
        this.owed -= 1;
        ran++;
      }
      // never build up a backlog we can't pay off
      if (this.owed > BASE_TPS * this.speed * 0.5) this.owed = 0;
    }
    this.ticksThisSecond += ran;
    if (t - this.tpsWindowStart > 1000) {
      this.measuredTps = (this.ticksThisSecond * 1000) / (t - this.tpsWindowStart);
      this.ticksThisSecond = 0;
      this.tpsWindowStart = t;
    }
    // frames: every tick at low speed, ~30 per second at high speed
    if (ran > 0 && (t - this.lastFrame > 30 || this.speed * BASE_TPS <= 30)) this.emit(false);
  }

  private emit(force: boolean) {
    const sim = this.sim!;
    const t = this.now();
    this.lastFrame = t;
    const f: Frame = {
      type: 'frame',
      tick: sim.tick,
      speed: this.measuredTps,
      people: sim.packPeople(),
      deer: sim.packDeer(),
      skipping: this.skipTo > sim.tick,
    };
    if (force || sim.buildingsVersion !== this.buildingsVersion) {
      this.buildingsVersion = sim.buildingsVersion;
      f.buildings = sim.packBuildings();
    }
    // prop changes are batched: a felled tree can wait half a second to vanish
    if (sim.propsVersion !== this.propsVersion && (force || t - this.lastProps > 450)) {
      this.propsVersion = sim.propsVersion;
      this.lastProps = t;
      f.props = sim.packProps();
    }
    if (force || t - this.lastSummary > 250) {
      this.lastSummary = t;
      f.summary = sim.summary(this.focusBand);
      f.piles = sim.packPiles();
      f.traps = sim.packTraps();
      if (this.targets.length)
        f.looks = this.targets.map((tg) => (tg.kind === 'person' ? { key: refKey(tg), person: sim.inspect(tg.id) } : { key: refKey(tg), card: sim.inspectThing(tg) }));
    }
    if (this.eventCursor < sim.events.length) {
      f.events = sim.events.slice(this.eventCursor);
      this.eventCursor = sim.events.length;
    }
    const transfer: Transferable[] = [f.people.buffer as ArrayBuffer, f.deer.buffer as ArrayBuffer];
    if (f.props) for (const k of ['type', 'x', 'y', 'z', 'rot', 'scale', 'alive', 'val'] as const) transfer.push(f.props[k].buffer as ArrayBuffer);
    this.post(f, transfer);
  }
}

export const TICKS_PER_GAME_HOUR = TICKS_PER_HOUR;
