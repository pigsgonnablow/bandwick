import { render } from 'preact';
import natureUrl from './assets/nature.glb?inline';
import bandUrl from './assets/band.glb?inline';
import SimWorker from './sim/sim.worker?worker&inline';
import { Runner, ToSim, FromSim, Frame, refKey } from './sim/runner';
import { DEFAULT_PARAMS, WorldData, WorldParams } from './sim/types';
import type { SimEvent, Ref, Card } from './sim/band';
import { TASK_KINDS, BUILD } from './sim/band';
import { Director } from './render/director';
import { PROP_NAMES, SPECIES, STAGES, TREE_VARIANTS, TERRAIN_NAMES, WATER } from './sim/types';
import { worldName } from './sim/names';
import { WorldView } from './render/view';
import { loadAssetGeometries, PropState } from './render/props';
import { TICKS_PER_DAY, TICKS_PER_SEASON, seasonPos } from './sim/time';
import { App } from './ui/App';
import { SPEEDS, randomSeed, tps } from './ui/shared';
import type { SaveData, Chronicle } from './sim/sim';
import { SAVE_VERSION } from './sim/sim';
import { SaveMeta, listSaves, writeSave, readSave, readSaveBytes, deleteSave as dropSave, downloadSave, unpack, yearSeason } from './saves';
import { TICKS_PER_YEAR } from './sim/time';

export type Summary = NonNullable<Frame['summary']>;
export type PersonDetail = NonNullable<NonNullable<Frame['looks']>[number]['person']>;

/** A floating info window about one thing in the world. */
export interface InfoWin {
  key: string;
  ref: Ref;
  /** pinned windows stay open when you click something else */
  pinned: boolean;
  /** top-left corner, in page pixels */
  x: number;
  y: number;
  /** stacking order: higher is in front */
  z: number;
  tab: string;
  person: PersonDetail | null;
  card: Card | null;
  /** an answer has arrived (person/card null after that means the thing is gone) */
  loaded: boolean;
  /** where the thing is on screen, for the leader line; null when off screen */
  anchor: { x: number; y: number } | null;
}
export const WIN_W = 340;
const WIN_H = 430;
const MAX_PINNED = 4;

/** Everything the UI reads, refreshed a few times a second. */
export interface Snapshot {
  loading: string | null;
  error: string | null;
  world: WorldData | null;
  name: string;
  tick: number;
  speed: number;
  paused: boolean;
  tps: number;
  skipping: boolean;
  hover: number;
  pinned: number;
  quality: number;
  qualityAuto: boolean;
  debug: boolean;
  genMode: string;
  stats: WorldView['stats'];
  summary: Summary | null;
  events: SimEvent[];
  selected: number;
  person: PersonDetail | null;
  follow: boolean;
  labels: { id: number; name: string; x: number; y: number; selected: boolean }[];
  /** whatever is selected (a person, deer, building, prop or tile) */
  sel: Ref | null;
  card: Card | null;
  tip: { text: string; x: number; y: number } | null;
  director: boolean;
  caption: string;
  toast: string;
  /** saved worlds in this browser, newest first (null until read) */
  saves: SaveMeta[] | null;
  savesOpen: boolean;
  /** the last save of this world, if any */
  lastSave: SaveMeta | null;
  /** a save is being written or read */
  saving: boolean;
  /** open info windows */
  wins: InfoWin[];
  /** the band the left panel follows (-1: the largest) */
  focusBand: number;
  /** show every band in its colour */
  colorMode: boolean;
  /** the chronicle (history browser) */
  chronicleOpen: boolean;
  chronicleTab: string;
  chronicle: Chronicle | null;
}

const STAGE_WORDS = ['Sapling', 'Young', 'Mature', 'Old'];
const PHRASE: Record<string, string> = {
  eat: 'eating', eatwild: 'eating berries', sleep: 'asleep', warm: 'warming up', socialize: 'visiting', play: 'playing',
  idle: 'resting', mourn: 'mourning', forage: 'picking berries', fell: 'felling a tree', haul: 'hauling logs', hunt: 'hunting',
  fish: 'fishing', build: 'building', supply: 'carrying wood', fuel: 'feeding the fire', preserve: 'drying food', bury: 'burying the dead', explore: 'exploring', deadwood: 'gathering firewood', swim: 'swimming',
};

/** Talks to the simulation, wherever it runs. */
interface SimLink {
  send(m: ToSim): void;
  stop(): void;
}

export class Engine {
  view!: WorldView;
  snap: Snapshot = {
    loading: 'Shaping the land', error: null, world: null, name: '', tick: 0, speed: 1, paused: false, tps: 0, skipping: false,
    hover: -1, pinned: -1, quality: 2, qualityAuto: true, debug: false, genMode: '', stats: {} as WorldView['stats'],
    summary: null, events: [], selected: -1, person: null, follow: false, labels: [],
    sel: null, card: null, tip: null, director: false, caption: '', toast: '',
    saves: null, savesOpen: false, lastSave: null, saving: false, wins: [],
    chronicleOpen: false, chronicleTab: 'annals', chronicle: null, focusBand: -1, colorMode: false,
  };
  private winZ = 1;
  /** the params of the world now running */
  params: WorldParams | null = null;
  private saveRequests = new Map<number, (s: SaveData | null, err?: string) => void>();
  private saveSeq = 1;
  private lastAutosave = 0;
  private lastAutosaveSeason = -1;
  director!: Director;
  private toastTimer = 0;
  private listeners = new Set<() => void>();
  private link?: SimLink;
  private dayAmp = 1;
  private lastFrameAt = 0;
  private names = new Map<number, string>();
  propsByTile: Int32Array = new Int32Array(0);
  propStart: Int32Array = new Int32Array(0);
  propState: PropState | null = null;
  private pointer: { x: number; y: number } | null = null;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.snap = { ...this.snap, stats: { ...this.view?.stats } };
    this.listeners.forEach((f) => f());
  }

  async boot() {
    const viewEl = document.getElementById('view')!;
    const skyEl = document.getElementById('sky')!;
    const decode = (u: string) => Uint8Array.from(atob(u.slice(u.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
    const [nature, band] = await Promise.all([loadAssetGeometries(decode(natureUrl)), loadAssetGeometries(decode(bandUrl))]);
    this.view = new WorldView(viewEl, skyEl, nature, band);
    viewEl.addEventListener('pointermove', (e) => (this.pointer = { x: e.clientX, y: e.clientY }));
    viewEl.addEventListener('pointerleave', () => (this.pointer = null));
    this.director = new Director(this.view.cam);
    this.view.cam.onClick = (x, y) => {
      const hit = this.pickThing(x, y);
      if (this.director.active) this.setDirector(false, 'Director paused so you can look around. Press C to resume.');
      // bare ground opens only on a double click; a single click there just clears the loose window
      if (!hit || hit.ref.kind === 'tile') {
        this.selectRef(null);
        return;
      }
      const open = this.snap.wins.find((w) => w.key === refKey(hit.ref));
      // clicking the thing in focus again puts its window away (unless it is pinned)
      if (open && !open.pinned && this.snap.sel && refKey(this.snap.sel) === open.key) this.closeWin(open.key);
      else this.selectRef(hit.ref, { x, y });
    };
    this.view.cam.onDoubleClick = (x, y) => {
      const hit = this.pickThing(x, y);
      if (!hit) return;
      // a double click on a thing is just a click on it; on bare ground it opens the land's window
      if (hit.ref.kind !== 'tile') return; // the first click already opened it
      if (this.director.active) this.setDirector(false, 'Director paused so you can look around. Press C to resume.');
      this.selectRef(hit.ref, { x, y });
    };
    this.view.cam.onUserMove = () => {
      if (this.director.active) this.setDirector(false, 'You took the camera. Press C to hand it back to the director.');
    };
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        void this.saveNow(false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave Ctrl+C and friends to the browser
      const c = e.code;
      // Space and Enter on a focused button press the button, nothing more
      if (t && t.tagName === 'BUTTON' && (c === 'Space' || c === 'Enter')) return;
      if (c === 'Space') {
        e.preventDefault();
        this.setPaused(!this.snap.paused);
      } else if (/^(Digit|Numpad)[1-6]$/.test(c)) this.setSpeed(SPEEDS[Number(c.slice(-1)) - 1]);
      else if (c === 'Backquote' || c === 'F3') {
        e.preventDefault();
        this.snap.debug = !this.snap.debug;
        this.emit();
      } else if (c === 'Escape') {
        if (this.snap.savesOpen) this.setSavesOpen(false);
        else if (this.snap.chronicleOpen) this.setChronicleOpen(false);
        else {
          // the loose window first, then pinned ones, front to back
          const loose = this.snap.wins.find((w) => !w.pinned);
          const top = [...this.snap.wins].sort((a, b) => b.z - a.z)[0];
          if (loose) this.closeWin(loose.key);
          else if (top) this.closeWin(top.key);
        }
      }
      else if (c === 'KeyF' && this.snap.selected >= 0) this.setFollow(!this.snap.follow);
      else if (c === 'KeyC') this.setDirector(!this.snap.director);
      else if (c === 'KeyH') this.setChronicleOpen(!this.snap.chronicleOpen);
      else if (c === 'KeyB') this.setColorMode(!this.snap.colorMode);
    });
    viewEl.addEventListener('pointermove', (e) => {
      if (this.snap.follow && e.buttons) {
        this.snap.follow = false;
        this.emit();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.snap.world && performance.now() - this.lastAutosave > 20000) {
        this.lastAutosave = performance.now();
        void this.saveNow(true);
      }
    });
    void this.refreshSaves();
    const fromHash = parseHash(location.hash);
    this.newWorld(fromHash ?? { ...DEFAULT_PARAMS, seed: randomSeed() });
    this.loop();
    setInterval(() => this.emit(), 250);
    // an open chronicle keeps up with the world
    setInterval(() => {
      if (this.snap.chronicleOpen && !document.hidden) this.link?.send({ type: 'chronicle' });
    }, 2000);
  }

  newWorld(params: WorldParams, save?: SaveData) {
    this.link?.stop();
    this.params = params;
    this.lastAutosave = performance.now();
    this.lastAutosaveSeason = -1;
    for (const [, reply] of this.saveRequests) reply(null, 'The world changed before it could be saved.');
    this.saveRequests.clear();
    this.snap = {
      ...this.snap, loading: save ? 'Returning to a saved world' : params.size > 128 ? 'Shaping a larger land' : 'Shaping the land', error: null,
      summary: null, events: [], selected: -1, person: null, follow: false, pinned: -1, world: null, sel: null, card: null, lastSave: null,
      wins: [], chronicle: null, chronicleOpen: false, focusBand: -1,
    };
    this.names.clear();
    this.emit();
    const onMsg = (m: FromSim) => this.onSim(m, params);
    const start = (link: SimLink, mode: string) => {
      this.link = link;
      this.snap.genMode = mode;
      link.send(save ? { type: 'load', save } : { type: 'init', params });
      link.send({ type: 'speed', speed: this.snap.speed, paused: this.snap.paused });
    };
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      start(mainThreadLink(onMsg), 'main thread');
    };
    try {
      const w = new SimWorker();
      const timer = setTimeout(() => {
        w.terminate();
        fallback();
      }, 3000);
      w.onerror = (ev) => {
        clearTimeout(timer);
        w.terminate();
        if (!settled) return fallback();
        // the worker died after it had started: never leave the world silently frozen
        ev.preventDefault?.();
        onMsg({ type: 'error', message: ev.message || 'The simulation worker failed.', stopped: true, tick: this.snap.tick });
      };
      w.onmessage = (e: MessageEvent<FromSim>) => {
        if (e.data.type === 'ready') {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          start({ send: (m) => w.postMessage(m), stop: () => w.terminate() }, 'worker');
          return;
        }
        onMsg(e.data);
      };
      // stop() before the worker answers must still cancel it
      this.link = { send: () => undefined, stop: () => { settled = true; clearTimeout(timer); w.terminate(); } };
    } catch {
      fallback();
    }
  }

  private onSim(m: FromSim, params: WorldParams) {
    if (m.type === 'ready') return;
    if (m.type === 'saved') {
      const reply = this.saveRequests.get(m.id);
      this.saveRequests.delete(m.id);
      reply?.(m.save, m.error);
      return;
    }
    if (m.type === 'chronicle') {
      this.snap.chronicle = m.data;
      this.emit();
      return;
    }
    if (m.type === 'error') {
      this.snap.error = m.load ? m.message : m.stopped
        ? `The simulation hit a bug and stopped (seed ${params.seed}, ${params.size}², tick ${m.tick ?? '?'}). ${m.message}`
        : `The world could not be made: ${m.message}`;
      this.emit();
      return;
    }
    if (m.type === 'world') {
      try {
        this.view.setWorld(m.world);
        if (this.view.band) this.view.band.colorMode = this.snap.colorMode;
      } catch (err) {
        this.snap.error = `The world could not be drawn: ${(err as Error).message}`;
        this.emit();
        return;
      }
      this.snap.world = m.world;
      this.snap.name = worldName(params.seed);
      this.snap.tick = m.tick;
      this.snap.loading = null;
      try {
        history.replaceState(null, '', `#w${params.seed}-${params.size}`);
      } catch {
        /* the viewer may not allow it */
      }
      this.emit();
      return;
    }
    // a frame
    const f = m;
    this.lastFrameAt = performance.now();
    this.snap.tick = f.tick;
    this.snap.tps = f.speed;
    this.snap.skipping = f.skipping;
    this.view.onFrame(f, f.skipping ? 1000 : tps(this.snap.speed));
    if (f.props) this.indexProps(f.props);
    if (f.summary) {
      this.snap.summary = f.summary;
      this.view.band?.setBandColors(f.summary.bands);
      this.learnNames(f.summary.roster);
      this.maybeAutosave(f.summary.tick);
    }
    if (f.looks) {
      const selKey = this.snap.sel ? refKey(this.snap.sel) : '';
      for (const l of f.looks) {
        const w = this.snap.wins.find((q) => q.key === l.key);
        const isPerson = 'person' in l;
        if (w) {
          if (isPerson) w.person = l.person ?? null;
          else w.card = l.card ?? null;
          w.loaded = true;
        }
        if (l.person) this.names.set(l.person.id, l.person.name);
        // clicking someone from another band follows that band
        if (l.person && this.followBandOf === l.key) {
          this.followBandOf = '';
          if (this.snap.summary && l.person.band !== this.snap.summary.band) this.setFocusBand(l.person.band);
        }
        if (l.key === selKey) {
          if (isPerson) this.snap.person = l.person ?? null;
          else this.snap.card = l.card ?? null;
        }
      }
    }
    if (f.events) {
      // only a world's very first founding moves the camera; later bands are news, not a jump cut
      const first = this.snap.events.length === 0;
      this.snap.events = [...this.snap.events, ...f.events];
      if (first) for (const e of f.events) if (e.kind === 'founding' && this.snap.selected < 0) { this.focusCamp(e.x, e.z); break; }
    }
  }

  private focusCamp(x: number, z: number) {
    this.view.cam.frame(x, z, 24);
  }

  private indexProps(st: PropState) {
    const w = this.snap.world;
    if (!w) return;
    const NN = w.size * w.size;
    const start = new Int32Array(NN + 1);
    const tileOf = (k: number) => Math.min(w.size - 1, Math.floor(st.z[k])) * w.size + Math.min(w.size - 1, Math.floor(st.x[k]));
    for (let k = 0; k < st.count; k++) if (st.alive[k]) start[tileOf(k) + 1]++;
    for (let i = 0; i < NN; i++) start[i + 1] += start[i];
    const fillAt = start.slice();
    const list = new Int32Array(start[NN]);
    for (let k = 0; k < st.count; k++) if (st.alive[k]) list[fillAt[tileOf(k)]++] = k;
    this.propStart = start;
    this.propsByTile = list;
    this.propState = st;
  }

  /** Select a person by id (-1 clears). */
  select(id: number) {
    this.selectRef(id >= 0 ? { kind: 'person', id } : null);
  }
  /**
   * Open a window about anything (or bring its window forward); the simulation answers with its details.
   * `at` is the screen point that was clicked, so the window can open beside it. null closes the loose window.
   */
  selectRef(ref: Ref | null, at?: { x: number; y: number }) {
    let wins = this.snap.wins;
    if (ref) {
      const key = refKey(ref);
      const open = wins.find((w) => w.key === key);
      if (ref.kind === 'person') this.followBandOf = key;
      if (open) open.z = ++this.winZ;
      else {
        wins = wins.filter((w) => w.pinned);
        const pos = this.placeWin(ref, at, wins);
        wins.push({ key, ref, pinned: false, x: pos.x, y: pos.y, z: ++this.winZ, tab: 'now', person: null, card: null, loaded: false, anchor: null });
      }
    } else wins = wins.filter((w) => w.pinned);
    this.snap.wins = wins;
    this.focusRef(ref);
  }
  setColorMode(on: boolean) {
    this.snap.colorMode = on;
    if (this.view.band) this.view.band.colorMode = on;
    this.emit();
  }
  /** a person whose band the panel should switch to once we hear which it is */
  private followBandOf = '';
  /** Which band the panel at the left describes (-1: the largest). */
  setFocusBand(id: number) {
    this.snap.focusBand = id;
    this.link?.send({ type: 'focus', band: id });
    this.emit();
  }
  /** Put a window in front and make its thing the one marked on the map (and followed with F). */
  focusWin(key: string) {
    const w = this.snap.wins.find((q) => q.key === key);
    if (!w) return;
    w.z = ++this.winZ;
    if (!this.snap.sel || refKey(this.snap.sel) !== key) this.focusRef(w.ref);
    else this.emit();
  }
  closeWin(key: string) {
    this.snap.wins = this.snap.wins.filter((w) => w.key !== key);
    if (this.snap.sel && refKey(this.snap.sel) === key) {
      const next = [...this.snap.wins].sort((a, b) => b.z - a.z)[0];
      this.focusRef(next?.ref ?? null);
    } else this.sendLooks();
    this.emit();
  }
  pinWin(key: string, on: boolean) {
    const w = this.snap.wins.find((q) => q.key === key);
    if (!w) return;
    w.pinned = on;
    // keep the screen from filling up: the oldest pinned window gives way
    const pinned = this.snap.wins.filter((q) => q.pinned).sort((a, b) => a.z - b.z);
    if (pinned.length > MAX_PINNED) {
      this.closeWin(pinned[0].key);
      this.showToast(`At most ${MAX_PINNED} windows stay pinned; the oldest one closed.`);
    }
    this.emit();
  }
  moveWin(key: string, x: number, y: number) {
    const w = this.snap.wins.find((q) => q.key === key);
    if (!w) return;
    w.x = Math.round(Math.min(Math.max(x, 8 - WIN_W + 80), innerWidth - 80));
    w.y = Math.round(Math.min(Math.max(y, 8), innerHeight - 48));
    this.emit();
  }
  setWinTab(key: string, tab: string) {
    const w = this.snap.wins.find((q) => q.key === key);
    if (w) w.tab = tab;
    this.emit();
  }
  /**
   * Beside the thing, wherever there is the most room: clear of other windows and the side panels,
   * and as close to the thing as that allows.
   */
  private placeWin(ref: Ref, at: { x: number; y: number } | undefined, others: InfoWin[]) {
    let a = at;
    if (!a) {
      const pos = this.positionOfRef(ref);
      a = pos ? this.view.project(pos.x, pos.y, pos.z) : { x: innerWidth / 2, y: innerHeight / 2 };
    }
    const W = WIN_W, H = WIN_H, gap = 44, m = 12;
    type R = { x: number; y: number; w: number; h: number };
    const blocks: [R, number][] = others.map((o) => [{ x: o.x, y: o.y, w: W, h: H }, 1]);
    for (const el of document.querySelectorAll('#ui .panel:not(.info-win)')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) blocks.push([{ x: r.left, y: r.top, w: r.width, h: r.height }, 0.6]);
    }
    const overlap = (p: R, q: R) => Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
    const xs = [a.x + gap, a.x - gap - W, ...others.flatMap((o) => [o.x + W + m, o.x - W - m])];
    const ys = [a.y - 110, a.y - H / 2, a.y - 40, a.y - H + 60, ...others.map((o) => o.y)];
    let best = { x: a.x + gap, y: a.y - 110, score: Infinity };
    for (const x0 of xs)
      for (const y0 of ys) {
        const x = Math.min(Math.max(x0, 16), innerWidth - W - 16);
        const y = Math.min(Math.max(y0, 16), innerHeight - H - 16);
        const r = { x, y, w: W, h: H };
        let score = 0;
        for (const [q, k] of blocks) score += overlap(r, q) * k;
        // covering the thing itself is the worst place of all
        if (a.x > x - 8 && a.x < x + W + 8 && a.y > y - 8 && a.y < y + H + 8) score += W * H;
        score += Math.hypot(x + (x < a.x ? W : 0) - a.x, y + 60 - a.y) * 20;
        if (score < best.score) best = { x, y, score };
      }
    return { x: Math.round(best.x), y: Math.round(best.y) };
  }
  setChronicleOpen(on: boolean, tab?: string) {
    this.snap.chronicleOpen = on;
    if (tab) this.snap.chronicleTab = tab;
    if (on) {
      this.snap.savesOpen = false;
      this.link?.send({ type: 'chronicle' });
    }
    this.emit();
  }
  setChronicleTab(tab: string) {
    this.snap.chronicleTab = tab;
    this.emit();
  }
  /** From the chronicle back to the world: close it, go there, and open a window about it. */
  showInWorld(ref: Ref | null, x: number, z: number) {
    this.setChronicleOpen(false);
    this.flyTo(x, z, ref ? 12 : 18);
    if (ref) setTimeout(() => this.selectRef(ref), 350);
  }
  /** Tell the simulation which things to describe, the one in focus first. */
  private sendLooks() {
    const sel = this.snap.sel;
    const refs = this.snap.wins.map((w) => w.ref);
    if (sel) refs.sort((a, b) => Number(refKey(b) === refKey(sel)) - Number(refKey(a) === refKey(sel)));
    this.link?.send({ type: 'inspect', targets: refs });
  }
  /** Mark a thing on the map as the one in focus. */
  private focusRef(ref: Ref | null) {
    this.snap.sel = ref;
    this.snap.selected = ref?.kind === 'person' ? ref.id : -1;
    this.snap.person = null;
    this.snap.card = null;
    this.snap.pinned = ref?.kind === 'tile' ? ref.id : -1;
    if (!ref || ref.kind !== 'person') this.snap.follow = false;
    // what the windows already know about it shows at once
    const w = ref ? this.snap.wins.find((q) => q.key === refKey(ref)) : undefined;
    if (w?.loaded) {
      this.snap.person = w.person;
      this.snap.card = w.card;
    }
    this.sendLooks();
    const band = this.view.band;
    if (band) {
      band.selected = this.snap.selected;
      band.markerAt = null;
      if (ref) {
        const pos = this.positionOfRef(ref);
        if (pos && ref.kind !== 'person' && ref.kind !== 'tile') band.markerAt = { ...pos, r: ref.kind === 'deer' ? -ref.id : pos.r };
      }
    }
    this.emit();
  }
  /** Where a selectable thing is, with a marker radius. */
  positionOfRef(ref: Ref): { x: number; y: number; z: number; r: number } | null {
    const w = this.snap.world;
    if (!w) return null;
    const gy = (x: number, z: number) => w.groundY[Math.min(w.size - 1, Math.floor(z)) * w.size + Math.min(w.size - 1, Math.floor(x))];
    if (ref.kind === 'person') {
      const p = this.view.band?.positionOf(ref.id);
      return p ? { x: p.x, y: p.y, z: p.z, r: 0.2 } : null;
    }
    if (ref.kind === 'deer') {
      const d = this.view.band?.visibleDeer.find((q) => q.id === ref.id);
      return d ? { x: d.x, y: d.y - 0.2, z: d.z, r: 0.32 } : null;
    }
    if (ref.kind === 'building') {
      const b = this.view.band?.getBuildings().find((q) => q.id === ref.id);
      return b ? { x: b.x + 0.5, y: gy(b.x, b.z), z: b.z + 0.5, r: b.kind === 'hearth' ? 0.4 : 0.55 } : null;
    }
    if (ref.kind === 'prop') {
      const st = this.propState;
      if (!st || ref.id >= st.count) return null;
      const tree = st.type[ref.id] < SPECIES.length * STAGES * TREE_VARIANTS;
      return { x: st.x[ref.id], y: st.y[ref.id], z: st.z[ref.id], r: tree ? 0.34 : 0.22 };
    }
    const x = (ref.id % w.size) + 0.5, z = Math.floor(ref.id / w.size) + 0.5;
    return { x, y: gy(x, z), z, r: 0.5 };
  }

  /** Whatever is under a screen point: people first, then animals, buildings, props, the ground. */
  pickThing(cx: number, cy: number): { ref: Ref; label: string } | null {
    const band = this.view.band;
    const w = this.snap.world;
    if (!band || !w) return null;
    const proj = (x: number, y: number, z: number) => this.view.project(x, y, z);
    let best: { ref: Ref; label: string; d: number } | null = null;
    const offer = (ref: Ref, label: string, d: number) => {
      if (!best || d < best.d) best = { ref, label, d };
    };
    // people
    for (const v of band.visible) {
      const p = proj(v.x, v.y - 0.2, v.z);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < 18) offer({ kind: 'person', id: v.id }, this.personLabel(v.id), d - 8);
    }
    for (const v of band.visibleDeer) {
      const p = proj(v.x, v.y, v.z);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < 18) offer({ kind: 'deer', id: v.id }, v.fawn ? 'Fawn' : v.state === 2 ? 'Deer, running' : 'Deer', d - 4);
    }
    for (const b of band.getBuildings()) {
      const base = w.groundY[b.z * w.size + b.x];
      // the windbreak stands in an arc behind the fire and the woodpile roof over the back of the stockpile,
      // on the same tiles: point at what is drawn, so the fire and the pile can still be clicked
      const back = b.kind === 'windbreak' ? 1.55 : b.kind === 'woodshed' ? 0.22 : 0;
      const turn = (b.rot * Math.PI) / 2;
      const p = proj(b.x + 0.5 - Math.sin(turn) * back, base + (b.kind === 'woodshed' ? 0.55 : 0.22), b.z + 0.5 - Math.cos(turn) * back);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < 30) {
        const owner = this.names.get(b.owner);
        const label = b.empty ? `Empty ${BUILD[b.kind].label.toLowerCase()}`
          : BUILD[b.kind].label + (owner && (b.kind === 'hut' || b.kind === 'leanto') ? ` of ${owner}'s family` : '') + (b.built ? '' : ' (being built)');
        offer({ kind: 'building', id: b.id }, label, d);
      }
    }
    // props on and around the tile under the cursor
    const tile = this.view.pick(cx, cy);
    const st = this.propState;
    if (st && tile >= 0) {
      const N = w.size;
      const tx = tile % N, tz = Math.floor(tile / N);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx, z = tz + dz;
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const t = z * N + x;
          for (let k = this.propStart[t]; k < this.propStart[t + 1]; k++) {
            const pi = this.propsByTile[k];
            const type = st.type[pi];
            const isTree = type < SPECIES.length * STAGES * TREE_VARIANTS;
            const base = PROP_NAMES[type].split('_')[0];
            if (base === 'grass') continue;
            const h = isTree ? [0.35, 0.7, 1.0, 1.25][Math.floor(type / TREE_VARIANTS) % STAGES] * st.scale[pi] : 0.08;
            let d = 1e9;
            for (const f of isTree ? [0.15, 0.5, 0.85] : [0.5]) {
              const p = proj(st.x[pi], st.y[pi] + h * f, st.z[pi]);
              d = Math.min(d, Math.hypot(p.x - cx, p.y - cy));
            }
            const r = isTree ? 26 : 16;
            if (d < r) offer({ kind: 'prop', id: pi }, this.propLabel(pi), d + 2);
          }
        }
    }
    const found = best as { ref: Ref; label: string; d: number } | null;
    if (found) return { ref: found.ref, label: found.label };
    if (tile >= 0) {
      const wk = w.water[tile];
      const label = wk === WATER.Lake ? 'Lake' : wk === WATER.River ? 'River' : wk === WATER.Sea ? 'Sea' : TERRAIN_NAMES[w.terrain[tile]];
      return { ref: { kind: 'tile', id: tile }, label };
    }
    return null;
  }

  private personLabel(id: number) {
    const name = this.names.get(id) ?? 'Someone';
    let task = '';
    this.view.band?.each((pid, p) => {
      if (pid === id && p.task > 0) task = PHRASE[TASK_KINDS[p.task - 1]] ?? '';
    });
    return task ? `${name} · ${task}` : name;
  }
  private propLabel(k: number) {
    const st = this.propState!;
    const type = st.type[k];
    if (type < SPECIES.length * STAGES * TREE_VARIANTS) {
      const sp = SPECIES[Math.floor(type / (STAGES * TREE_VARIANTS))];
      return `${STAGE_WORDS[Math.floor(type / TREE_VARIANTS) % STAGES]} ${sp}`;
    }
    const base = PROP_NAMES[type].split('_')[0];
    const names: Record<string, string> = {
      bush: 'Bush', berry: st.val[k] >= 1 ? 'Berry bush, ripe' : 'Berry bush', reeds: 'Reeds', rock: 'Boulder', outcrop: 'Rock outcrop',
      stump: 'Stump', logs: 'Pile of logs', grave: 'Grave',
    };
    return names[base] ?? base;
  }

  // ---------------------------------------------------------------- saving and loading
  /** Ask the simulation for a snapshot of the running world. */
  private snapshot(): Promise<SaveData> {
    return new Promise((resolve, reject) => {
      if (!this.link || !this.snap.world) return reject(new Error('There is no world to save yet.'));
      const id = this.saveSeq++;
      this.saveRequests.set(id, (save, err) => (save ? resolve(save) : reject(new Error(err || 'The world could not be saved.'))));
      this.link.send({ type: 'save', id });
    });
  }
  async refreshSaves() {
    // (await first, then assign: the snapshot object is replaced while we wait)
    let list: SaveMeta[];
    try {
      list = await listSaves();
    } catch {
      list = [];
    }
    this.snap.saves = list;
    this.emit();
  }
  /** Save the running world. Autosaves keep one slot per world; manual saves each get their own. */
  async saveNow(auto = false, name?: string) {
    if (this.snap.saving || !this.params) return;
    this.snap.saving = true;
    this.emit();
    try {
      const save = await this.snapshot();
      const world = worldName(save.params.seed);
      const camp = this.snap.summary?.camp ?? '';
      const id = auto ? `auto-${save.params.seed}-${save.params.size}` : `save-${Date.now()}`;
      const meta = await writeSave(save, {
        id, auto, world, camp, pop: this.snap.summary?.pop ?? 0,
        name: name?.trim() || (auto ? `${camp || world}, autosave` : `${camp || world}, ${yearSeason(save.tick)}`),
      });
      this.snap.lastSave = meta;
      if (!auto) this.showToast(`Saved: ${meta.name}.`);
      await this.refreshSaves();
    } catch (e) {
      this.showToast(`Couldn't save: ${(e as Error).message}`);
    } finally {
      this.snap.saving = false;
      this.emit();
    }
  }
  /** An autosave at each new season, at most every two minutes of real time. */
  private maybeAutosave(tick: number) {
    const season = Math.floor(tick / (TICKS_PER_YEAR / 4));
    if (this.lastAutosaveSeason < 0) { this.lastAutosaveSeason = season; return; }
    if (season === this.lastAutosaveSeason || performance.now() - this.lastAutosave < 120000 || this.snap.skipping) return;
    this.lastAutosaveSeason = season;
    this.lastAutosave = performance.now();
    void this.saveNow(true);
  }
  async loadSave(id: string) {
    try {
      const save = await readSave(id);
      this.startFromSave(save);
    } catch (e) {
      this.showToast(`Couldn't load that save: ${(e as Error).message}`);
      this.emit();
    }
  }
  async loadFile(file: File) {
    try {
      const save = await unpack(new Uint8Array(await file.arrayBuffer()));
      this.startFromSave(save);
    } catch (e) {
      this.showToast(`Couldn't open ${file.name}: ${(e as Error).message}`);
      this.emit();
    }
  }
  private startFromSave(save: SaveData) {
    if (save.v !== SAVE_VERSION) throw new Error(`it was made by a different version of the game (format ${save.v}).`);
    this.snap.savesOpen = false;
    this.newWorld(save.params, save);
  }
  async exportSave(id: string) {
    try {
      const { meta, data } = await readSaveBytes(id);
      downloadSave(meta, data);
    } catch (e) {
      this.showToast(`Couldn't export: ${(e as Error).message}`);
      this.emit();
    }
  }
  async deleteSave(id: string) {
    try {
      await dropSave(id);
    } catch (e) {
      this.showToast(`Couldn't delete: ${(e as Error).message}`);
    }
    await this.refreshSaves();
  }
  setSavesOpen(open: boolean) {
    this.snap.savesOpen = open;
    if (open) void this.refreshSaves();
    this.emit();
  }

  setDirector(on: boolean, toast = '') {
    if (on) {
      this.snap.follow = false;
      this.director.start(this.snap.events);
    } else this.director.stop();
    this.snap.director = on;
    this.snap.caption = '';
    this.showToast(toast || (on ? 'The director has the camera. Move it yourself any time to take over.' : ''));
    this.emit();
  }
  showToast(text: string) {
    this.snap.toast = text;
    clearTimeout(this.toastTimer);
    if (text) this.toastTimer = window.setTimeout(() => {
      this.snap.toast = '';
      this.emit();
    }, 4500);
  }
  setFollow(on: boolean) {
    this.snap.follow = on;
    this.emit();
  }
  flyTo(x: number, z: number, zoom = 18) {
    this.view.cam.frame(x, z, zoom, false);
  }
  setSpeed(s: number) {
    this.snap.speed = s;
    this.snap.paused = false;
    this.link?.send({ type: 'speed', speed: s, paused: false });
    this.emit();
  }
  setPaused(p: boolean) {
    this.snap.paused = p;
    this.link?.send({ type: 'speed', speed: this.snap.speed, paused: p });
    this.emit();
  }
  /** Fast-forward to the next dawn or the start of the next season. */
  skip(what: 'morning' | 'season') {
    const t = this.snap.tick;
    let target: number;
    if (what === 'morning') {
      target = Math.floor(t / TICKS_PER_DAY) * TICKS_PER_DAY + 70;
      if (target <= t) target += TICKS_PER_DAY;
    } else {
      target = (Math.floor(seasonPos(t)) + 1) * TICKS_PER_SEASON + Math.floor(t / (TICKS_PER_SEASON * 4)) * TICKS_PER_SEASON * 4 + 70;
      if (target <= t) target += TICKS_PER_SEASON;
    }
    this.link?.send({ type: 'skip', ticks: target - t });
  }
  setQuality(level: number, auto: boolean) {
    this.view.setQuality(level, auto);
    this.snap.quality = level;
    this.snap.qualityAuto = auto;
    this.emit();
  }

  private loop() {
    let last = performance.now();
    const t0 = last;
    let lastLabels = 0;
    let lastPick = 0;
    const frame = (now: number) => {
      const rawDt = (now - last) / 1000; // the real frame time, for the fps readout and auto quality
      const dt = Math.min(0.1, rawDt); // animation steps are capped so a stall doesn't jump the scene
      last = now;
      const s = this.snap;
      // smooth time between simulation ticks so the sun glides
      const tickMs = 1000 / Math.max(1, tps(s.speed));
      const frac = s.paused ? 0 : Math.min(1, (now - this.lastFrameAt) / tickMs);
      const minutes = (s.tick + frac) * 6;
      const ampGoal = s.paused ? this.dayAmp : s.skipping ? 0 : tps(s.speed) <= 30 ? 1 : tps(s.speed) <= 100 ? 0.55 : 0;
      this.dayAmp += (ampGoal - this.dayAmp) * (1 - Math.exp(-dt * 1.5));
      const minuteOfDay = minutes % 1440;
      const season = (minutes / 1440 / 12) % 4;
      const wind = 0.5 + 0.5 * Math.sin(now * 0.00011) * Math.sin(now * 0.000043 + 2);
      if (s.world) {
        if (this.pointer && this.view.band && now - lastPick > 60) {
          lastPick = now;
          const hit = this.pickThing(this.pointer.x, this.pointer.y);
          this.view.band.hovered = hit?.ref.kind === 'person' ? hit.ref.id : -1;
          s.hover = hit?.ref.kind === 'tile' ? hit.ref.id : -1;
          s.tip = hit ? { text: hit.label, x: this.pointer.x, y: this.pointer.y } : null;
          this.view.renderer.domElement.style.cursor = hit && hit.ref.kind !== 'tile' ? 'pointer' : '';
        } else if (!this.pointer) s.tip = null;
        if (this.director.active) {
          const sum = s.summary;
          this.director.update(now, this.view.band!, s.events, this.names, {
            tick: s.tick,
            camp: sum && !sum.gone ? { x: sum.x, z: sum.z, name: sum.camp } : null,
            dark: minuteOfDay < 5 * 60 || minuteOfDay > 20.5 * 60,
          });
          s.caption = this.director.shot?.caption ?? '';
          this.view.cam.glide = 2.2;
        } else {
          this.view.cam.glide = 9;
          if (s.follow && s.selected >= 0) {
            const p = this.view.band?.positionOf(s.selected);
            if (p) this.view.cam.frame(p.x, p.z, this.view.cam.zoom, false);
          }
        }
        // keep the marker on moving things
        if (s.sel && s.sel.kind === 'deer' && this.view.band?.markerAt) {
          const d = this.view.band.visibleDeer.find((q) => q.id === s.sel!.id);
          if (d) this.view.band.markerAt = { x: d.x, y: d.y - 0.2, z: d.z, r: -d.id };
        }
        this.view.setHover(s.sel?.kind === 'tile' ? s.sel.id : s.hover);
        this.view.render(dt, (now - t0) / 1000, minuteOfDay, season, this.dayAmp, wind, rawDt);
        // name labels when close in, and always for the selected person
        if (now - lastLabels > 50) {
          lastLabels = now;
          const close = this.view.cam.zoom < 15;
          const labels: Snapshot['labels'] = [];
          for (const v of this.view.band?.visible ?? []) {
            if (!close && v.id !== s.selected) continue;
            const nm = this.names.get(v.id) ?? this.nameFor(v.id);
            if (!nm) continue;
            const sp = this.view.project(v.x, v.y + 0.12, v.z);
            labels.push({ id: v.id, name: nm, x: sp.x, y: sp.y, selected: v.id === s.selected });
          }
          s.labels = labels;
          for (const win of s.wins) {
            const pos = this.positionOfRef(win.ref);
            const sp = pos ? this.view.project(pos.x, pos.y + (win.ref.kind === 'person' ? 0.05 : 0), pos.z) : null;
            win.anchor = sp && sp.x > 0 && sp.y > 0 && sp.x < innerWidth && sp.y < innerHeight ? { x: Math.round(sp.x), y: Math.round(sp.y) } : null;
          }
          this.listeners.forEach((f) => f());
        }
      }
      s.quality = this.view.quality.level;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Names come from the event log (which names everyone who has done anything) and the inspector. */
  private nameFor(id: number): string | undefined {
    return this.names.get(id);
  }
  learnNames(list: { id: number; name: string }[]) {
    for (const p of list) this.names.set(p.id, p.name);
  }
}

function mainThreadLink(onMsg: (m: FromSim) => void): SimLink {
  let on = true;
  // once stopped, nothing from this runner may reach the page (a newer world may be loading)
  const runner = new Runner((m) => {
    if (on) onMsg(m);
  }, () => performance.now());
  // its own timer, not the frame loop: a slow frame must not slow history down with it
  // (short slices, so drawing and input still get most of the thread)
  const loop = () => {
    if (!on) return;
    runner.pump(6);
    setTimeout(loop, 6);
  };
  setTimeout(loop, 0);
  return { send: (m) => setTimeout(() => on && runner.handle(m), 0), stop: () => (on = false) };
}

function parseHash(h: string): WorldParams | null {
  const m = /^#w(\d{1,9})-(128|256)$/.exec(h);
  if (!m) return null;
  return { ...DEFAULT_PARAMS, seed: Number(m[1]), size: Number(m[2]) };
}

const engine = new Engine();
(window as unknown as { __lw: Engine }).__lw = engine; // handy for testing from the console
render(<App engine={engine} />, document.getElementById('ui')!);
engine.boot().catch((err) => {
  console.error(err);
  engine.snap.error = `Something went wrong while starting: ${(err as Error).message}`;
  engine.emit();
});
