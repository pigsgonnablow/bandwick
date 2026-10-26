import { useEffect, useState } from 'preact/hooks';
import type { Engine, Snapshot, Summary } from '../main';
import { DEFAULT_PARAMS } from '../sim/types';
import { TICKS_PER_DAY, DAYS_PER_SEASON, DAYS_PER_YEAR } from '../sim/time';
import { SEASON_NAMES } from '../render/env';
import { QUALITY_NAMES } from '../render/view';
import { SPEEDS, randomSeed, tps } from './shared';
import { BUILD } from '../build';
import { yearSeason } from '../saves';
import type { SaveMeta } from '../saves';
import { InfoWindows } from './InfoWindows';
import { ChronicleView } from './Chronicle';

const METERS_PER_UNIT = 6;

function useSnap(engine: Engine): Snapshot {
  const [, force] = useState(0);
  useEffect(() => engine.subscribe(() => force((n) => n + 1)), [engine]);
  return engine.snap;
}

export function App({ engine }: { engine: Engine }) {
  const s = useSnap(engine);
  return (
    <>
      {s.world && (
        <>
          <Labels s={s} engine={engine} />
          <div class="col-left">
            <TitleCard s={s} />
            {s.summary && <BandCard sum={s.summary} engine={engine} />}
          </div>
          <Clock s={s} />
          <div class="col-right">
            <SpeedBar s={s} engine={engine} />
            <EventFeed s={s} engine={engine} />
          </div>
          {s.wins.length ? <InfoWindows s={s} engine={engine} /> : <Hint />}
          <DirectorBar s={s} engine={engine} />
          {s.tip && !s.director && <div class="tip" style={{ transform: `translate(${s.tip.x + 14}px, ${s.tip.y + 16}px)` }}>{s.tip.text}</div>}
          {s.toast && <div class="toast" role="status">{s.toast}</div>}
          <WorldPanel s={s} engine={engine} />
          {s.debug && <Debug s={s} />}
          {s.savesOpen && <SavesDialog s={s} engine={engine} />}
          {s.chronicleOpen && <ChronicleView s={s} engine={engine} />}
        </>
      )}
      <Loading s={s} engine={engine} />
    </>
  );
}

export function calendar(tick: number) {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const year = Math.floor(day / DAYS_PER_YEAR) + 1;
  const dayOfYear = day % DAYS_PER_YEAR;
  const season = Math.floor(dayOfYear / DAYS_PER_SEASON);
  const dayOfSeason = (dayOfYear % DAYS_PER_SEASON) + 1;
  const m = Math.floor((tick % TICKS_PER_DAY) * 6);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return { year, season, dayOfSeason, time: `${hh}:${mm}`, hour: m / 60 };
}
export const when = (tick: number) => {
  const c = calendar(tick);
  return `${SEASON_NAMES[c.season]}, year ${c.year}`;
};

function TitleCard({ s }: { s: Snapshot }) {
  const w = s.world!;
  return (
    <header class="panel">
      <h1 class="title">{s.name}</h1>
      <div class="sub">
        Seed {w.params.seed} · {w.size} × {w.size} tiles · {(w.size * METERS_PER_UNIT) / 1000} km across
      </div>
      <div class="build" title="Game version · commit · build date">{BUILD}</div>
    </header>
  );
}

export function Bar({ v, max = 100, warn = 25, wide = false }: { v: number; max?: number; warn?: number; wide?: boolean }) {
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  return (
    <div class={`meter${wide ? ' wide' : ''}`}>
      <i style={{ width: `${pct}%`, background: v < warn ? 'var(--warn)' : undefined }} />
    </div>
  );
}

function BandCard({ sum, engine }: { sum: Summary; engine: Engine }) {
  const adults = sum.pop - sum.children - sum.elders;
  const days = sum.foodDays;
  const st = sum.stock;
  const live = sum.bands.filter((b) => !b.gone);
  const i = live.findIndex((b) => b.id === sum.band);
  const step = (d: number) => {
    if (!live.length) return;
    const next = live[(Math.max(0, i) + d + live.length) % live.length];
    engine.setFocusBand(next.id);
    engine.flyTo(next.x, next.z, 22);
  };
  return (
    <section class="panel band" aria-label="The band">
      <div class="row between">
        <span class="label">
          <i class="swatch" style={{ background: bandCss(sum.bands.find((b) => b.id === sum.band)?.color ?? { h: 30, s: 0.5, l: 0.5 }) }} />
          {sum.gone ? 'Once the people of' : 'The people of'} {sum.camp}
        </span>
        <span class="temp">{Math.round(sum.temp)}°C</span>
      </div>
      {live.length > 1 && (
        <div class="bandnav row">
          <button class="btn icon small" onClick={() => step(-1)} aria-label="Previous band" title="Previous band">‹</button>
          <span class="small muted grow">Band {i + 1} of {live.length} · {sum.worldPop} people in all</span>
          <button class="btn icon small" onClick={() => step(1)} aria-label="Next band" title="Next band">›</button>
          <button class="btn small" onClick={() => engine.flyTo(sum.x, sum.z, 20)} title="Bring the camera to this camp">Look</button>
        </div>
      )}
      {(sum.parent || sum.leader) && !sum.gone && (
        <div class="small muted origin">
          {(() => {
            const me = sum.bands.find((b) => b.id === sum.band);
            if (!sum.parent) return sum.first ? 'The first people of this land' : 'Strangers to this land';
            return me?.origin === 'turmoil' ? `Broke away in anger from ${sum.parent}` : me?.origin === 'moved' ? `Moved here from ${sum.parent}` : `Parted on good terms from ${sum.parent}`;
          })()}
          {sum.leader ? <> {sum.parent ? 'with' : 'led by'} <button class={`link${sum.leader.alive ? '' : ' gone'}`} onClick={() => engine.select(sum.leader!.id)}>{sum.leader.name}</button></> : null}
        </div>
      )}
      {sum.gone ? (
        <p class="hint" style={{ margin: '8px 0 4px' }}>
          No one lives here now. {live.length ? `${sum.worldPop} people live on in ${live.length === 1 ? 'one other band' : `${live.length} other bands`}.` : 'The land is empty of people.'}
        </p>
      ) : (
        <>
          <div class="pop">
            <strong>{sum.pop}</strong> {sum.pop === 1 ? 'person' : 'people'}
            <span class="muted"> · {adults} adults, {sum.children} children{sum.elders ? `, ${sum.elders} elders` : ''}</span>
          </div>
          {sum.famine && <div class="alert">Famine: people are going hungry</div>}
          <dl class="rows compact">
            <dt>Food</dt>
            <dd>
              {days < 1 ? 'less than a day' : `${Math.floor(days)} days`}
              <Bar v={days} max={30} warn={5} />
              <span class="small">
                {Math.round(st.berries)} berries · {Math.round(st.meat)} meat · {Math.round(st.fish)} fish{st.preserved > 0.5 ? ` · ${Math.round(st.preserved)} dried` : ''}
              </span>
            </dd>
            <dt>Wood</dt>
            <dd>{Math.round(st.wood)} loads</dd>
            <dt>Fiber</dt>
            <dd>{Math.floor(st.fiber ?? 0)} bundles · {Math.floor(st.cordage ?? 0)} cordage</dd>
            {((st.mud ?? 0) >= 0.5 || (st.stone ?? 0) >= 0.5) && <><dt>Mud, stone</dt><dd>{Math.floor(st.mud ?? 0)} mud · {Math.floor(st.stone ?? 0)} stone</dd></>}
            <dt>This year</dt>
            <dd class="small">
              <span title="Brought in this year">+{sum.stores.now.food} food, +{sum.stores.now.gathered.wood} wood</span>
              <span class="muted"> · {sum.stores.now.eaten} eaten, {sum.stores.now.spoiled} spoiled, {sum.stores.now.burned} burned</span>
              {sum.pile >= 0 && <> · <button class="link" onClick={() => engine.selectRef({ kind: 'building', id: sum.pile })}>stockpile</button></>}
            </dd>
            <dt>Fire</dt>
            <dd>{sum.fuel > 0 ? (sum.fuel < 2 ? 'Burning low' : 'Burning') : 'Out'}</dd>
            <dt>Homes</dt>
            <dd>
              {sum.homes}
              {sum.building.length > 0 && <span class="muted"> · building {sum.building.join(', ').toLowerCase()}</span>}
            </dd>
            <dt>Tools</dt>
            <dd class="small">{sum.tools || 'None'}</dd>
            <dt>Knows</dt>
            <dd class="small" title="What this band has found out for itself or learned from others, beyond the old ways">
              {sum.knows.length ? sum.knows.join(', ') : 'Only the old ways'}
            </dd>
          </dl>
          {sum.plan.length > 0 && (
            <div class="plan">
              <span class="label">Today the band means to</span>
              <ul>{sum.plan.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </>
      )}
      {sum.dead > 0 && (
        <div class="small muted">
          {sum.dead} buried here since {sum.camp} was founded
        </div>
      )}
    </section>
  );
}

/** CSS colour for a band's colour. */
export const bandCss = (c: { h: number; s: number; l: number }) => `hsl(${Math.round(c.h)} ${Math.round(c.s * 100)}% ${Math.round(c.l * 100)}%)`;
const ORIGIN: Record<string, string> = {
  first: 'the first band', strangers: 'came as strangers', amicable: 'parted on good terms from', turmoil: 'broke away in anger from', moved: 'moved from',
};

function BandLegend({ s, engine }: { s: Snapshot; engine: Engine }) {
  const bands = s.summary!.bands;
  const live = bands.filter((b) => !b.gone);
  const gone = bands.filter((b) => b.gone);
  const name = (id: number) => bands.find((b) => b.id === id)?.name;
  return (
    <div class="panel legend" role="list" aria-label="Bands">
      {live.map((b) => (
        <button key={b.id} role="listitem" class="legend-row" onClick={() => { engine.setFocusBand(b.id); engine.flyTo(b.x, b.z, 22); }}
          title={`${b.name}: ${b.pop} people${b.parent >= 0 && name(b.parent) ? ` · ${ORIGIN[b.origin] ?? 'from'} ${name(b.parent)}` : ` · ${ORIGIN[b.origin] ?? ''}`}`}>
          <i class="swatch" style={{ background: bandCss(b.color) }} />
          <span>{b.name}</span>
          <span class="muted">{b.pop}</span>
        </button>
      ))}
      {gone.length > 0 && <div class="legend-gone small muted">{gone.length} camp{gone.length === 1 ? '' : 's'} left empty</div>}
    </div>
  );
}

function SeasonIcon({ season, night }: { season: number; night: boolean }) {
  const stroke = 'currentColor';
  if (night)
    return (
      <svg class="season-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M16.5 15.8A7 7 0 0 1 8.2 7.5a7 7 0 1 0 8.3 8.3Z" stroke={stroke} stroke-width="1.5" fill="rgba(242,233,212,0.15)" />
      </svg>
    );
  if (season === 0)
    return (
      <svg class="season-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 20v-8" stroke="#9fd07a" stroke-width="1.6" stroke-linecap="round" />
        <path d="M12 13c-4 0-6-2.5-6-6 3.5 0 6 2 6 6Z" fill="#9fd07a" />
        <path d="M12 11c0-3.5 2.4-5.5 6-5.5 0 3.5-2.4 5.5-6 5.5Z" fill="#c3e39a" />
      </svg>
    );
  if (season === 1)
    return (
      <svg class="season-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" fill="#f2c14e" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line key={a} x1="12" y1="3" x2="12" y2="5.6" stroke="#f2c14e" stroke-width="1.6" stroke-linecap="round" transform={`rotate(${a} 12 12)`} />
        ))}
      </svg>
    );
  if (season === 2)
    return (
      <svg class="season-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14Z" fill="#d9822b" />
        <path d="M5 19 14 10" stroke="#7a3d10" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    );
  return (
    <svg class="season-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="#cfe3f2" stroke-width="1.5" stroke-linecap="round">
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M10 5l2 2 2-2M10 19l2-2 2 2" />
    </svg>
  );
}

function Hint() {
  return (
    <aside class="panel bl">
      <div class="label">Look closer</div>
      <p class="hint" style={{ margin: '6px 0 0' }}>
        Click anything to examine it: people, deer, huts, the fire, trees, stumps, graves. Double-click the ground for the land or water itself.
      </p>
    </aside>
  );
}

function DirectorBar({ s, engine }: { s: Snapshot; engine: Engine }) {
  return (
    <div class={`director${s.director ? ' on' : ''}`}>
      <div class="row">
      <button class="btn small" aria-pressed={s.chronicleOpen} onClick={() => engine.setChronicleOpen(!s.chronicleOpen)} title="The history of this world (H)">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
          <path d="M2 3.5c2-.8 4-.8 6 .5 2-1.3 4-1.3 6-.5v9c-2-.8-4-.8-6 .5-2-1.3-4-1.3-6-.5z" /><path d="M8 4v9" />
        </svg>
        Chronicle
      </button>
      <button class="btn small" aria-pressed={s.colorMode} onClick={() => engine.setColorMode(!s.colorMode)} title="Show each band in its own colour (B)">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <circle cx="6" cy="6.5" r="3.6" /><circle cx="10" cy="6.5" r="3.6" /><circle cx="8" cy="10" r="3.6" />
        </svg>
        Band colours
      </button>
      <button class="btn small" aria-pressed={s.director} onClick={() => engine.setDirector(!s.director)} title="Let the director choose what to watch (C)">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <rect x="1.5" y="4" width="9" height="8" rx="1.5" />
          <path d="M10.5 7l4-2.2v6.4l-4-2.2" />
        </svg>
        {s.director ? 'Director on' : 'Director'}
      </button>
      </div>
      {s.director && s.caption && <span class="caption">{s.caption}</span>}
      {s.colorMode && s.summary && <BandLegend s={s} engine={engine} />}
    </div>
  );
}

function Clock({ s }: { s: Snapshot }) {
  const c = calendar(s.tick);
  const night = c.hour < 5.5 || c.hour > 20.5;
  return (
    <div class="panel tc" role="status" aria-live="off">
      <SeasonIcon season={c.season} night={night && tps(s.speed) <= 30 && !s.skipping} />
      <div class="clock">
        Year {c.year} · {SEASON_NAMES[c.season]}, day {c.dayOfSeason}
        {tps(s.speed) <= 100 && !s.skipping && <span class="time">{c.time}</span>}
      </div>
      {s.skipping && <span class="pin">Skipping ahead…</span>}
    </div>
  );
}

function SpeedBar({ s, engine }: { s: Snapshot; engine: Engine }) {
  const lagging = !s.paused && !s.skipping && s.tps > 0 && s.tps < tps(s.speed) * 0.7;
  return (
    <nav class="panel speed" aria-label="Simulation speed">
      <button class="seg" aria-pressed={s.paused} onClick={() => engine.setPaused(!s.paused)} title="Pause (Space)" aria-label="Pause">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
          <rect x="7.4" y="1.5" width="2.6" height="9" rx="0.6" fill="currentColor" />
        </svg>
      </button>
      {SPEEDS.map((v, i) => (
        <button key={v} class="seg" aria-pressed={!s.paused && s.speed === v} onClick={() => engine.setSpeed(v)} title={`${v}× speed (${i + 1})`}>
          {v}×
        </button>
      ))}
      {lagging && <span class="lag" title="The simulation can't keep up at this speed on this computer">≈{Math.round(s.tps / tps(1))}×</span>}
    </nav>
  );
}

const KIND_MARK: Record<string, string> = {
  birth: '#9fd07a', twins: '#9fd07a', death: '#d98a6a', stillbirth: '#d98a6a', famine: '#e0a24a', famine_end: '#9fd07a',
  discovery: '#7fc4e8', build: '#e3ab4e', pairing: '#e7a0c0', founding: '#e3ab4e', hunt: '#c9a46a', winter: '#cfe3f2',
  injury: '#d98a6a', fostering: '#9fd07a', climate: '#cfe3f2', age: '#b3aa96', burial: '#b3aa96',
  split: '#e3ab4e', move_camp: '#e3ab4e', merge: '#b3aa96', gone: '#8a8070', empty: '#8a8070', exile: '#d98a6a',
  epidemic: '#d98a6a', epidemic_end: '#9fd07a', fight: '#d98a6a', death_quarrel: '#d98a6a', attack: '#d98a6a',
  murrain: '#e0a24a', blight: '#e0a24a', plenty: '#9fd07a', great_hunt: '#c9a46a', quiet: '#9fd07a', elder: '#cfe3f2',
};

function EventFeed({ s, engine }: { s: Snapshot; engine: Engine }) {
  const list = s.events.filter((e) => e.weight >= 2).slice(-7).reverse();
  if (!list.length) return null;
  return (
    <section class="panel feed" aria-label="Recent events">
      <div class="label">Lately</div>
      <ol>
        {list.map((e) => (
          <li key={e.id}>
            <button
              class="event"
              onClick={() => {
                engine.flyTo(e.x, e.z, 16);
                const alive = e.people.find((id) => s.summary?.roster.some((r) => r.id === id));
                if (alive !== undefined) engine.select(alive);
              }}
            >
              <i class="mark" style={{ background: KIND_MARK[e.kind] ?? '#b3aa96' }} />
              <span>
                <span class="when">{when(e.tick)}</span>
                {e.text}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Labels({ s, engine }: { s: Snapshot; engine: Engine }) {
  return (
    <div class="labels" aria-hidden="true">
      {s.labels.map((l) => (
        <span
          key={l.id}
          class={`name-tag${l.selected ? ' sel' : ''}`}
          style={{ transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -100%)` }}
          onClick={() => engine.select(l.id)}
        >
          {l.name}
        </span>
      ))}
    </div>
  );
}

function WorldPanel({ s, engine }: { s: Snapshot; engine: Engine }) {
  const w = s.world!;
  const [seed, setSeed] = useState(String(w.params.seed));
  const [size, setSize] = useState(String(w.size));
  useEffect(() => setSeed(String(w.params.seed)), [w]);
  const go = (sd: number) => engine.newWorld({ ...DEFAULT_PARAMS, seed: sd, size: Number(size) });
  const cam = engine.view.cam;
  return (
    <section class="panel br" aria-label="World controls">
      <div class="row">
        <button class="btn icon" onClick={() => cam.rotate(-1)} title="Rotate left (Q)" aria-label="Rotate left">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3.5 6.5A5 5 0 1 1 3 9.5" /><path d="M3.5 2.8v3.7h3.7" /></svg>
        </button>
        <button class="btn icon" onClick={() => cam.rotate(1)} title="Rotate right (E)" aria-label="Rotate right">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M12.5 6.5A5 5 0 1 0 13 9.5" /><path d="M12.5 2.8v3.7H8.8" /></svg>
        </button>
        <button class="btn icon" onClick={() => cam.zoomBy(1.3)} title="Zoom out (-)" aria-label="Zoom out">
          <svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 8h8" /></svg>
        </button>
        <button class="btn icon" onClick={() => cam.zoomBy(0.75)} title="Zoom in (+)" aria-label="Zoom in">
          <svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 8h8M8 4v8" /></svg>
        </button>
        <span class="grow" />
        <select id="quality" class="field" aria-label="Graphics quality" value={s.qualityAuto ? 'auto' : String(s.quality)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v === 'auto') engine.setQuality(s.quality, true);
            else engine.setQuality(Number(v), false);
          }}>
          <option value="auto">Auto ({QUALITY_NAMES[s.quality]})</option>
          {QUALITY_NAMES.map((n, i) => <option key={n} value={String(i)}>{n}</option>)}
        </select>
      </div>
      <SaveRow s={s} engine={engine} />
      <div>
        <div class="label" style={{ marginBottom: 5 }}>Skip ahead</div>
        <div class="row">
          <button class="btn grow" onClick={() => engine.skip('morning')} disabled={s.skipping}>Next morning</button>
          <button class="btn grow" onClick={() => engine.skip('season')} disabled={s.skipping}>Next season</button>
        </div>
      </div>
      <form class="row" onSubmit={(e) => {
        e.preventDefault();
        const digits = seed.replace(/\D/g, '');
        go(digits ? Number(digits) % 1_000_000_000 : randomSeed());
      }}>
        <input id="seed" class="field grow" inputMode="numeric" aria-label="Seed" value={seed} onInput={(e) => setSeed((e.target as HTMLInputElement).value)} style={{ width: 0 }} />
        <select id="size" class="field" aria-label="Map size" value={size} onChange={(e) => setSize((e.target as HTMLSelectElement).value)}>
          <option value="128">128²</option>
          <option value="256">256²</option>
        </select>
        <button class="btn" type="submit">Generate</button>
      </form>
      <button class="btn primary" onClick={() => go(randomSeed())}>New random world</button>
      <div class="keys">
        Click anything to look closer (double-click the ground) · drag to pan · scroll to zoom · <kbd>Q</kbd> <kbd>E</kbd> rotate · <kbd>Space</kbd> pause · <kbd>1</kbd>–<kbd>6</kbd> speed · <kbd>F</kbd> follow · <kbd>H</kbd> chronicle · <kbd>B</kbd> band colours · <kbd>`</kbd> stats
      </div>
    </section>
  );
}

function Debug({ s }: { s: Snapshot }) {
  const w = s.world!;
  const st = s.stats;
  const sum = s.summary;
  const lines = [
    `fps        ${st.fps?.toFixed(0)}`,
    `draws      ${st.calls}`,
    `triangles  ${(st.tris / 1000).toFixed(0)}k`,
    `props      ${st.instances}`,
    `quality    ${QUALITY_NAMES[s.quality]}${s.qualityAuto ? ' (auto)' : ''}`,
    `sim        ${s.genMode}, ${Math.round(s.tps)} ticks/s, tick ${s.tick}`,
    `world hash ${w.hash}  (the land)`,
    sum ? `history    ${sum.historyHash} at tick ${sum.tick}` : '',
    sum ? `deer ${sum.deer}  felled ${sum.stats.felled}  kills ${sum.stats.kills}` : '',
    sum ? `jobs ${Object.entries(sum.jobs).map(([k, v]) => `${k} ${(v as number).toFixed(2)}`).join(' ')}` : '',
  ];
  return <div class="panel debug">{lines.join('\n')}</div>;
}

function Loading({ s, engine }: { s: Snapshot; engine: Engine }) {
  const show = !!s.loading || !!s.error;
  const w = s.world;
  return (
    <div class={`loading${show ? '' : ' done'}`} aria-hidden={!show}>
      <div class="card">
        <h1>Living World</h1>
        {s.error ? <p class="error">{s.error}</p> : <p>{s.loading ?? 'Ready'}…</p>}
        {!s.error && <div class="bar"><i /></div>}
        {s.error && (
          <div class="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            {w && <button class="btn" onClick={() => engine.newWorld({ ...DEFAULT_PARAMS, seed: w.params.seed, size: w.size })}>Restart this world</button>}
            <button class="btn primary" onClick={() => engine.newWorld({ ...DEFAULT_PARAMS, seed: randomSeed() })}>New random world</button>
          </div>
        )}
      </div>
    </div>
  );
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function SaveRow({ s, engine }: { s: Snapshot; engine: Engine }) {
  // in the first hours of a brand-new world, offer to carry on from the most recent save instead
  const fresh = !!s.summary && s.summary.tick < 1700 && !s.lastSave;
  const latest = s.saves && s.saves.length ? s.saves[0] : null;
  const offer = fresh && latest;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {offer && latest && (
        <div class="continue">
          <span>Continue <b>{latest.name}</b> <span class="muted">· {yearSeason(latest.tick)}</span></span>
          <button class="btn small primary" onClick={() => engine.loadSave(latest.id)}>Continue</button>
        </div>
      )}
      <div class="row">
        <button class="btn grow" onClick={() => engine.saveNow(false)} disabled={s.saving} title="Save this world (Ctrl+S)">{s.saving ? 'Saving…' : 'Save'}</button>
        <button class="btn grow" onClick={() => engine.setSavesOpen(true)}>Saves{s.saves && s.saves.length ? ` (${s.saves.length})` : ''}</button>
      </div>
      {s.lastSave && <div class="small muted">Saved {ago(s.lastSave.savedAt)}{s.lastSave.auto ? ' (autosave)' : ''}</div>}
    </div>
  );
}

function SavesDialog({ s, engine }: { s: Snapshot; engine: Engine }) {
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const list = s.saves ?? [];
  const onFile = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void engine.loadFile(f);
    (e.target as HTMLInputElement).value = '';
  };
  const row = (m: SaveMeta) => (
    <li key={m.id} class="save">
      <div class="save-main">
        <div class="save-name">{m.name}{m.auto && <span class="pill">autosave</span>}</div>
        <div class="save-meta">
          {m.world}{m.camp ? ` · ${m.camp}` : ''} · {yearSeason(m.tick)} · {m.pop} {m.pop === 1 ? 'person' : 'people'} · {ago(m.savedAt)} · {Math.max(1, Math.round(m.bytes / 1024))} KB
        </div>
      </div>
      <div class="row save-actions">
        {confirm === m.id ? (
          <>
            <span class="small">Delete for good?</span>
            <button class="btn small danger" onClick={() => { setConfirm(null); void engine.deleteSave(m.id); }}>Delete</button>
            <button class="btn small" onClick={() => setConfirm(null)}>Keep</button>
          </>
        ) : (
          <>
            <button class="btn small primary" onClick={() => engine.loadSave(m.id)}>Load</button>
            <button class="btn small" onClick={() => engine.exportSave(m.id)} title="Download as a .lwsave file">Export</button>
            <button class="btn small" onClick={() => setConfirm(m.id)}>Delete</button>
          </>
        )}
      </div>
    </li>
  );
  return (
    <div class="modal-back" onClick={(e) => { if (e.target === e.currentTarget) engine.setSavesOpen(false); }}>
      <section class="panel modal" role="dialog" aria-modal="true" aria-label="Saved worlds">
        <div class="row between">
          <h2 class="title" style={{ fontSize: 26 }}>Saved worlds</h2>
          <button class="btn icon small" onClick={() => engine.setSavesOpen(false)} aria-label="Close" title="Close (Esc)">×</button>
        </div>
        <form class="row" onSubmit={(e) => { e.preventDefault(); void engine.saveNow(false, name); setName(''); }}>
          <input id="save-name" class="field grow" placeholder={`${s.summary?.camp ?? s.name}, ${yearSeason(s.tick)}`} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Name for this save" />
          <button class="btn primary" type="submit" disabled={s.saving}>{s.saving ? 'Saving…' : 'Save this world'}</button>
        </form>
        {s.saves === null ? <p class="hint">Reading saves…</p> : list.length === 0 ? (
          <p class="hint">No saved worlds yet. Save this one, or open a .lwsave file. The game also saves on its own each new season.</p>
        ) : <ul class="saves">{list.map(row)}</ul>}
        <div class="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label class="btn" htmlFor="save-file">Open a save file…</label>
          <input id="save-file" type="file" accept=".lwsave,.json,application/octet-stream" onChange={onFile} style={{ display: 'none' }} />
          <span class="small muted" style={{ maxWidth: 420 }}>Saves live in this browser. Export one to back it up or move it to another computer (downloads work when you run the game from its file).</span>
        </div>
      </section>
    </div>
  );
}
