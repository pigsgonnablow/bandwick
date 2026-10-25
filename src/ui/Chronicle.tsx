// The Chronicle: the history of the world, told four ways. Annals (each year in a few lines),
// a Timeline (the band's numbers over time, with what happened marked along it), the Family
// (everyone who ever lived, by generation) and Records. Every name and mark leads back to the world.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Engine, Snapshot } from '../main';
import type { Chronicle as Chron, HistorySample } from '../sim/sim';
import type { SimEvent, Ref } from '../sim/band';
import { TICKS_PER_YEAR, TICKS_PER_SEASON } from '../sim/time';
import { SEASON_NAMES } from '../render/env';

type Person = Chron['people'][number];
type Seg = string | { id: number; name: string; dead?: boolean };

const yearOf = (t: number) => Math.floor(t / TICKS_PER_YEAR) + 1;
const seasonOf = (t: number) => Math.floor((t % TICKS_PER_YEAR) / TICKS_PER_SEASON);
const ageAt = (p: Person, t: number) => Math.floor((t - p.birth) / TICKS_PER_YEAR);
const lifeEnd = (p: Person, now: number) => (p.alive ? now : p.death);
const CAUSE: Record<string, string> = {
  starvation: 'hunger', cold: 'the cold', fever: 'fever', 'old age': 'old age', weakness: 'weakness', childbirth: 'childbirth',
  hunting: 'a hunting wound', infancy: 'infancy', accident: 'an accident', sickness: 'the sickness', drowning: 'drowning',
  wolves: 'wolves', bear: 'a bear', killed: 'violence',
};
/** How a death reads after a name and age: ", of fever", ", drowned", ", killed by wolves". */
function howDied(p: { cause: string }, byId?: Map<number, Person>, killer?: number) {
  if (p.cause === 'drowning') return 'drowned';
  if (p.cause === 'wolves' || p.cause === 'bear') return `killed by ${CAUSE[p.cause]}`;
  if (p.cause === 'killed') return `killed by ${(killer !== undefined && byId?.get(killer)?.name) || 'another'}`;
  return `of ${CAUSE[p.cause] ?? p.cause}`;
}
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const num = (n: number) => NUM[n] ?? String(n);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const TABS = [['annals', 'Annals'], ['timeline', 'Timeline'], ['family', 'Family'], ['records', 'Records']] as const;

export function ChronicleView({ s, engine }: { s: Snapshot; engine: Engine }) {
  const c = s.chronicle;
  const byId = useMemo(() => new Map((c?.people ?? []).map((p) => [p.id, p])), [c]);
  const go = (id: number) => {
    const p = byId.get(id);
    if (p) engine.showInWorld({ kind: 'person', id }, p.x, p.z);
  };
  return (
    <div class="chron-back" onClick={(e) => e.target === e.currentTarget && engine.setChronicleOpen(false)}>
      <section class="panel chronicle" role="dialog" aria-label="Chronicle">
        <header class="chron-head">
          <div>
            <div class="label">Chronicle</div>
            <h2>{!c ? 'Reading the past…' : c.camps.length > 1 ? `The bands of ${s.name.replace(/^The /, 'the ')}` : `The people of ${c.camp}`}</h2>
            {c && (
              <div class="sub">
                Year {yearOf(c.tick)}, {SEASON_NAMES[seasonOf(c.tick)].toLowerCase()} · {c.people.length} have lived here · {c.stats.births} born · {c.stats.deaths} died
                {c.camps.length > 1 && ` · ${c.camps.filter((b) => !b.gone).length} of ${c.camps.length} camps still lived in`}
              </div>
            )}
          </div>
          <nav class="tabs chron-tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" class="tab" aria-selected={s.chronicleTab === k} onClick={() => engine.setChronicleTab(k)}>{label}</button>
            ))}
          </nav>
          <button class="btn icon" onClick={() => engine.setChronicleOpen(false)} aria-label="Close" title="Close (H or Esc)">×</button>
        </header>
        <div class="chron-body">
          {!c ? <p class="hint">Reading the past…</p>
            : s.chronicleTab === 'timeline' ? <Timeline c={c} events={s.events} engine={engine} byId={byId} />
            : s.chronicleTab === 'family' ? <Family c={c} go={go} />
            : s.chronicleTab === 'records' ? <Records c={c} go={go} byId={byId} />
            : <Annals c={c} events={s.events} go={go} byId={byId} />}
        </div>
      </section>
    </div>
  );
}

function Segs({ segs, go }: { segs: Seg[]; go: (id: number) => void }) {
  return (
    <>
      {segs.map((g, i) => (typeof g === 'string' ? g : (
        <button key={i} class={`link${g.dead ? ' gone' : ''}`} onClick={() => go(g.id)}>{g.name}</button>
      )))}
    </>
  );
}

/** An event's own sentence, with the names of the people in it made into links. */
function linkify(e: SimEvent, byId: Map<number, Person>): Seg[] {
  let out: Seg[] = [e.text];
  const named = e.people.map((id) => byId.get(id)).filter(Boolean) as Person[];
  for (const p of named.sort((a, b) => b.name.length - a.name.length)) {
    const next: Seg[] = [];
    for (const g of out) {
      if (typeof g !== 'string') { next.push(g); continue; }
      const parts = g.split(p.name);
      parts.forEach((part, i) => {
        if (i) next.push({ id: p.id, name: p.name, dead: !p.alive });
        if (part) next.push(part);
      });
    }
    out = next;
  }
  return out;
}

/** "a, b and c" over segments. */
function list(items: Seg[][]): Seg[] {
  const out: Seg[] = [];
  items.forEach((it, i) => {
    if (i) out.push(i === items.length - 1 ? ' and ' : ', ');
    out.push(...it);
  });
  return out;
}

// ------------------------------------------------------------------ annals

function Annals({ c, events, go, byId }: { c: Chron; events: SimEvent[]; go: (id: number) => void; byId: Map<number, Person> }) {
  const years = useMemo(() => {
    const out: ReturnType<typeof writeYear>[] = [];
    const last = yearOf(c.tick);
    for (let y = last; y >= 1; y--) out.push(writeYear(y, c, events.filter((e) => yearOf(e.tick) === y), byId, y === last));
    return out;
  }, [c, events, byId]);
  return (
    <div class="annals">
      {years.map((y) => (
        <article key={y.year} class="annal">
          <div class="annal-year">
            <span class="yr">Year {y.year}</span>
            {y.current && <span class="pill">so far</span>}
          </div>
          <div>
            <h3>{y.title}</h3>
            {y.story.length > 0 && <p>{y.story.map((sg, i) => <span key={i}><Segs segs={sg} go={go} />{' '}</span>)}</p>}
            {y.lives.length > 0 && <p class="lives">{y.lives.map((sg, i) => <span key={i}><Segs segs={sg} go={go} />{' '}</span>)}</p>}
            {!y.story.length && !y.lives.length && <p class="muted">{c.camps.length > 1 ? 'Nothing anyone would tell stories about.' : 'Nothing the band would tell stories about.'}</p>}
            <div class="annal-facts">{y.facts.join(' · ')}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

function writeYear(year: number, c: Chron, evs: SimEvent[], byId: Map<number, Person>, current: boolean) {
  const P = (id: number): Seg[] => {
    const p = byId.get(id);
    return p ? [{ id, name: p.name, dead: !p.alive }] : ['someone'];
  };
  const kinds = (...k: string[]) => evs.filter((e) => k.includes(e.kind));
  const births = kinds('birth', 'twins');
  const deaths = kinds('death');
  const pairings = kinds('pairing');
  const ofAge = kinds('age');
  const builds = kinds('build');
  const STORY = new Set(['founding', 'discovery', 'famine', 'famine_end', 'winter', 'climate', 'hunt', 'fostering', 'injury', 'stillbirth', 'move',
    'split', 'move_camp', 'merge', 'gone', 'empty', 'exile', 'death_quarrel', 'fight', 'attack', 'epidemic', 'epidemic_end',
    'murrain', 'blight', 'plenty', 'great_hunt', 'quiet', 'elder']);
  const story: Seg[][] = [];
  for (const e of evs) {
    if (STORY.has(e.kind) || (e.kind === 'build' && e.weight >= 3)) story.push(linkify(e, byId));
  }
  const minor = builds.filter((e) => e.weight < 3).length;
  const major = builds.length - minor;
  if (minor) story.push([`${cap(num(minor))}${major ? ' more' : ''} ${minor === 1 ? 'building was' : 'buildings were'} finished.`]);

  const lives: Seg[][] = [];
  const babies = births.flatMap((e) => {
    const kids = e.people.filter((id) => byId.get(id)?.birth === e.tick);
    const parents = e.people.filter((id) => !kids.includes(id));
    return kids.map((k) => ({ k, parents }));
  });
  if (babies.length === 1) {
    const b = babies[0];
    lives.push([...P(b.k), ' was born to ', ...list(b.parents.map(P)), '.']);
  } else if (babies.length > 1) {
    lives.push([`${cap(num(babies.length))} children were born: `, ...babies.flatMap((b, i) => [i ? '; ' : '', ...P(b.k), ' to ', ...list(b.parents.map(P))]), '.']);
  }
  if (pairings.length) lives.push([...list(pairings.map((e) => list(e.people.map(P)))), pairings.length > 1 ? ' paired off.' : ' became partners.']);
  if (ofAge.length) lives.push([...list(ofAge.map((e) => P(e.people[0]))), ' came of age.']);
  if (deaths.length) {
    const d = deaths.map((e) => {
      const p = byId.get(e.people[0]);
      if (!p) return ['someone'] as Seg[];
      const a = ageAt(p, p.death);
      return [...P(p.id), a < 2 ? ' in infancy' : ` at ${a}, ${howDied(p, byId, e.people[1])}`] as Seg[];
    });
    const one = byId.get(deaths[0].people[0]);
    const lone: Seg[] = one ? [...P(one.id), ageAt(one, one.death) < 2 ? ' died in infancy.' : ` died at ${ageAt(one, one.death)}, ${howDied(one, byId, deaths[0].people[1])}.`] : ['Someone died.'];
    lives.push(deaths.length === 1 ? lone : [`${cap(num(deaths.length))} died: `, ...d.flatMap((x, i) => [i ? '; ' : '', ...x]), '.']);
  }

  // numbers from the band's records
  const samples = c.history.filter((h) => yearOf(h.tick) === year);
  const before = [...c.history].reverse().find((h) => yearOf(h.tick) < year);
  const facts: string[] = [];
  if (samples.length) {
    const end = samples[samples.length - 1];
    const start = before ?? samples[0];
    facts.push(start.pop === end.pop ? `${end.pop} people` : `${start.pop} → ${end.pop} people`);
    const kills = end.kills - (before?.kills ?? 0);
    const felled = end.felled - (before?.felled ?? 0);
    if (kills) facts.push(`${kills} deer taken`);
    if (felled) facts.push(`${felled} trees felled`);
    const low = Math.min(...samples.map((h) => h.food));
    facts.push(`food never below ${low} meals`);
    // what the stores took in and gave out this year
    if (end.gFood !== undefined) {
      const d = (k: 'gFood' | 'gWood' | 'eaten' | 'spoiled' | 'burned') => (end[k] ?? 0) - (before?.[k] ?? 0);
      facts.push(`${d('gFood')} food gathered, ${d('eaten')} eaten, ${d('spoiled')} spoiled`);
      facts.push(`${d('gWood')} wood brought in, ${d('burned')} burned`);
    }
    const hungry = samples.filter((h) => h.famine).length;
    if (hungry) facts.push(`hungry for about ${hungry * 4} days`);
  }

  // what the year is remembered for
  const discoveryTitle = (t: string) => / dry and smoke/.test(t) ? 'The year of the drying racks'
    : /taught|showed/.test(t) ? 'The year of new ways'
    : / hut/.test(t) ? 'The year of the first huts'
    : /woodpile/.test(t) ? 'The year of the dry woodpile'
    : /behind the fire/.test(t) ? 'The year of the windbreak'
    : /store/.test(t) ? 'The year of the storehouse'
    : /mud/.test(t) ? 'The year of the mud walls'
    : /stone/.test(t) ? 'The year of the stone walls'
    : 'The year of new ways';
  const has = (k: string) => evs.some((e) => e.kind === k);
  const nBirth = babies.length, nDeath = deaths.length;
  const firstFounding = evs.find((e) => e.kind === 'founding' && !e.text.startsWith('Strangers'));
  const title = firstFounding ? `The founding of ${c.camp}`
    : has('empty') ? 'The year the land fell silent'
    : has('exile') || has('death_quarrel') ? 'The year of the killing'
    : has('epidemic') ? 'The year of the sickness'
    : has('gone') ? 'The year a camp fell silent'
    : has('move_camp') ? 'The year of leaving'
    : has('split') ? 'The year of the parting'
    : has('founding') ? 'The year strangers came'
    : has('blight') && nDeath >= 2 ? 'The year the berries failed'
    : has('plenty') ? 'The year of plenty'
    : has('great_hunt') ? 'The great hunt'
    : has('quiet') ? 'A blessed year'
    : has('discovery') ? discoveryTitle(evs.find((e) => e.kind === 'discovery')!.text)
    : has('famine') && nDeath >= 2 ? 'The year of hunger and graves'
    : has('famine') ? 'The hungry year'
    : has('winter') ? 'The bitter winter'
    : nDeath >= 3 ? 'A year of many graves'
    : has('twins') ? 'The year of the twins'
    : nBirth >= 3 && nDeath === 0 ? 'A year of children'
    : has('hunt') ? 'The first hunt'
    : builds.some((e) => e.weight >= 3) ? 'The year of building'
    : nDeath === 0 && nBirth > 0 ? 'A good year'
    : has('climate') ? 'A cold year'
    : nDeath > 0 && nBirth === 0 ? 'A year of mourning'
    : nDeath > 0 && nBirth > 0 ? 'A year of comings and goings'
    : pairings.length ? 'A year of matches'
    : 'A quiet year';
  return { year, title, story, lives, facts, current };
}

// ------------------------------------------------------------------ timeline

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Event lanes: where a mark sits says what kind of thing it was; colour repeats it. */
const LANES = [
  { key: 'family', label: 'Births & bonds', color: '#199e70', kinds: ['birth', 'twins', 'pairing', 'fostering'] },
  { key: 'death', label: 'Deaths', color: '#e66767', kinds: ['death', 'stillbirth'] },
  { key: 'hard', label: 'Hard times', color: '#3987e5', kinds: ['famine', 'winter', 'climate', 'injury', 'epidemic', 'fight', 'attack', 'murrain', 'blight', 'death_quarrel'] },
  { key: 'works', label: 'Good fortune & works', color: '#c98500', kinds: ['build', 'discovery', 'hunt', 'move', 'plenty', 'great_hunt', 'quiet', 'elder'] },
  { key: 'bands', label: 'Bands', color: '#b3aa96', kinds: ['founding', 'split', 'move_camp', 'merge', 'gone', 'empty', 'exile'] },
];

function Timeline({ c, events, engine, byId }: { c: Chron; events: SimEvent[]; engine: Engine; byId: Map<number, Person> }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<{ x: number; y: number; sample?: HistorySample; ev?: SimEvent } | null>(null);
  const h = c.history;
  if (h.length < 2)
    return <p class="hint">The chronicle needs a few days of history before it can draw anything. Let the world run a little.</p>;
  const L = 150, R = 18;
  const W = Math.max(480, width);
  const t0 = Math.min(c.founded, h[0].tick), t1 = Math.max(c.tick, h[h.length - 1].tick);
  const X = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const panels: { key: string; title: string; h: number; max: number; value: (s: HistorySample) => number; fmt: (s: HistorySample) => string }[] = [
    { key: 'pop', title: 'People', h: 140, max: Math.max(12, ...h.map((s) => s.pop)) * 1.1, value: (s) => s.pop, fmt: (s) => `${s.pop} (${s.children} children)` },
    { key: 'food', title: 'Food stored', h: 100, max: Math.max(40, ...h.map((s) => s.food)) * 1.1, value: (s) => s.food, fmt: (s) => `${s.food} meals` },
    { key: 'mood', title: 'Mood', h: 80, max: 100, value: (s) => s.mood, fmt: (s) => `${s.mood} of 100` },
  ];
  const GAP = 22, CLIMATE_H = 46, LANE_H = 20;
  let y = 8;
  const tops: Record<string, number> = {};
  for (const p of panels) { tops[p.key] = y; y += p.h + GAP; }
  tops.climate = y; y += CLIMATE_H + GAP;
  tops.events = y; y += LANES.length * LANE_H + 8;
  const axisY = y;
  const H = y + 24;
  const last = h[h.length - 1];

  // per-year climate
  const years: { year: number; a: number }[] = [];
  for (let yr = yearOf(t0); yr <= yearOf(t1); yr++) {
    const ss = h.filter((s) => yearOf(s.tick) === yr);
    if (ss.length) years.push({ year: yr, a: ss.reduce((a, s) => a + s.anomaly, 0) / ss.length });
  }
  // against this world's own usual weather, not an absolute
  const usual = years.reduce((a, y) => a + y.a, 0) / Math.max(1, years.length);
  for (const y of years) y.a -= usual;
  const yearW = (TICKS_PER_YEAR / Math.max(1, t1 - t0)) * (W - L - R);
  const step = Math.max(1, Math.ceil(64 / Math.max(1, yearW)));
  const marks = events.filter((e) => (e.weight >= 2 || e.kind === 'build') && LANES.some((l) => l.kinds.includes(e.kind)));

  const onMove = (e: MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const mx = e.clientX - r.left;
    if (mx < L || mx > W - R) return setHover(null);
    const t = t0 + ((mx - L) / (W - L - R)) * (t1 - t0);
    let best = h[0];
    for (const s of h) if (Math.abs(s.tick - t) < Math.abs(best.tick - t)) best = s;
    setHover({ x: X(best.tick), y: e.clientY - r.top, sample: best });
  };
  const evTarget = (e: SimEvent): Ref | null => {
    const id = e.kind === 'birth' || e.kind === 'twins' ? e.people[e.people.length - 1] : e.people[0];
    return id !== undefined && byId.has(id) ? { kind: 'person', id } : null;
  };
  const area = (p: (typeof panels)[number], val: (s: HistorySample) => number) => {
    const top = tops[p.key], Y = (v: number) => top + p.h - (v / p.max) * p.h;
    return `M${X(h[0].tick)},${top + p.h} ` + h.map((s) => `L${X(s.tick).toFixed(1)},${Y(val(s)).toFixed(1)}`).join(' ') + ` L${X(last.tick)},${top + p.h} Z`;
  };
  const line = (p: (typeof panels)[number]) => {
    const top = tops[p.key];
    return h.map((s, i) => `${i ? 'L' : 'M'}${X(s.tick).toFixed(1)},${(top + p.h - (p.value(s) / p.max) * p.h).toFixed(1)}`).join(' ');
  };
  const famineRuns: [number, number][] = [];
  for (let i = 0; i < h.length; i++) if (h[i].famine) {
    let j = i;
    while (j + 1 < h.length && h[j + 1].famine) j++;
    famineRuns.push([h[i].tick, h[Math.min(h.length - 1, j + 1)].tick]);
    i = j;
  }
  return (
    <div class="timeline" ref={ref}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="The band's history over time">
        {/* panel labels and baselines */}
        {panels.map((p) => (
          <g key={p.key}>
            <text x={0} y={tops[p.key] + 12} class="t-title">{p.title}</text>
            <text x={0} y={tops[p.key] + 30} class="t-val">{p.fmt(hover?.sample ?? last)}</text>
            <line x1={L} x2={W - R} y1={tops[p.key] + p.h} y2={tops[p.key] + p.h} class="t-base" />
            <line x1={L} x2={W - R} y1={tops[p.key]} y2={tops[p.key]} class="t-grid" />
            <text x={L - 6} y={tops[p.key] + 4} class="t-tick" text-anchor="end">{Math.round(p.max)}</text>
          </g>
        ))}
        {famineRuns.map(([a, b], i) => (
          <rect key={i} x={X(a)} width={Math.max(2, X(b) - X(a))} y={tops.food} height={panels[1].h} class="t-famine" />
        ))}
        {famineRuns.length > 0 && <text x={0} y={tops.food + 48} class="t-note">shaded: hunger</text>}
        <path d={area(panels[0], (s) => s.pop)} class="t-area" />
        <path d={area(panels[0], (s) => s.children)} class="t-area2" />
        <text x={0} y={tops.pop + 48} class="t-note">darker: children</text>
        <path d={line(panels[1])} class="t-line" />
        <line x1={L} x2={W - R} y1={tops.mood + panels[2].h / 2} y2={tops.mood + panels[2].h / 2} class="t-grid" />
        <path d={line(panels[2])} class="t-line" />
        {/* climate: how far each year ran from the usual */}
        <text x={0} y={tops.climate + 12} class="t-title">Climate</text>
        <text x={0} y={tops.climate + 30} class="t-note">each year against the usual</text>
        <text x={0} y={tops.climate + 44} class="t-note">▲ warmer ▼ colder</text>
        <line x1={L} x2={W - R} y1={tops.climate + CLIMATE_H / 2} y2={tops.climate + CLIMATE_H / 2} class="t-base" />
        {years.map((yr) => {
          const x0 = X(Math.max(t0, (yr.year - 1) * TICKS_PER_YEAR)), x1 = X(Math.min(t1, yr.year * TICKS_PER_YEAR));
          const hh = Math.min(1, Math.abs(yr.a) / 4) * (CLIMATE_H / 2 - 2);
          const mid = tops.climate + CLIMATE_H / 2;
          return <rect key={yr.year} x={x0 + 1} width={Math.max(1, x1 - x0 - 2)} y={yr.a >= 0 ? mid - hh : mid} height={Math.max(1, hh)} rx={1.5}
            class={yr.a >= 0 ? 't-warm' : 't-cold'}><title>{`Year ${yr.year}: ${yr.a >= 0 ? 'warmer' : 'colder'} than usual (${yr.a.toFixed(1)}°)`}</title></rect>;
        })}
        {/* what happened */}
        {LANES.map((l, i) => (
          <g key={l.key}>
            <text x={0} y={tops.events + i * LANE_H + 14} class="t-lane">{l.label}</text>
            <line x1={L} x2={W - R} y1={tops.events + i * LANE_H + 10} y2={tops.events + i * LANE_H + 10} class="t-grid" />
          </g>
        ))}
        {marks.map((e) => {
          const li = LANES.findIndex((l) => l.kinds.includes(e.kind));
          const cx = X(e.tick), cy = tops.events + li * LANE_H + 10;
          return (
            <g key={e.id} class="t-mark" onMouseEnter={(ev) => { ev.stopPropagation(); setHover({ x: cx, y: cy, ev: e }); }}
              onClick={() => engine.showInWorld(evTarget(e), e.x, e.z)}>
              <circle cx={cx} cy={cy} r={10} fill="transparent" />
              <circle cx={cx} cy={cy} r={e.weight >= 4 ? 5.5 : 4} fill={LANES[li].color} class="t-dot" />
            </g>
          );
        })}
        {/* years */}
        {years.filter((yr) => (yr.year - 1) % step === 0 && X((yr.year - 1) * TICKS_PER_YEAR) < W - R - 44).map((yr) => (
          <text key={yr.year} x={X((yr.year - 1) * TICKS_PER_YEAR) + 2} y={axisY + 14} class="t-tick">Year {yr.year}</text>
        ))}
        {hover?.sample && <line x1={hover.x} x2={hover.x} y1={4} y2={axisY} class="t-cross" />}
      </svg>
      {hover && (
        <div class="t-tip" style={{ left: `${Math.min(hover.x + 14, W - 250)}px`, top: `${Math.max(0, hover.y - 10)}px` }}>
          {hover.ev ? (
            <>
              <div class="when">Year {yearOf(hover.ev.tick)}, {SEASON_NAMES[seasonOf(hover.ev.tick)].toLowerCase()}</div>
              {hover.ev.text}
              <div class="t-hint">Click to see where</div>
            </>
          ) : hover.sample && (
            <>
              <div class="when">Year {yearOf(hover.sample.tick)}, {SEASON_NAMES[seasonOf(hover.sample.tick)].toLowerCase()}</div>
              <dl class="rows compact">
                <dt>People</dt><dd>{hover.sample.pop} · {hover.sample.children} children · {hover.sample.elders} elders</dd>
                <dt>Food</dt><dd>{hover.sample.food} meals{hover.sample.preserved ? ` (${hover.sample.preserved} dried)` : ''}</dd>
                <dt>Wood</dt><dd>{hover.sample.wood} loads</dd>
                <dt>Homes</dt><dd>{hover.sample.homes}</dd>
                <dt>Mood</dt><dd>{hover.sample.mood} · health {hover.sample.health}</dd>
                <dt>Deer</dt><dd>{hover.sample.deer} roaming</dd>
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ family

const NW = 122, NH = 42, GX = 10, ROW = NH + 58, PAD = 20, LABEL = 96;

function Family({ c, go }: { c: Chron; go: (id: number) => void }) {
  const [focus, setFocus] = useState<number | null>(null);
  const lay = useMemo(() => layoutFamily(c), [c]);
  const kin = useMemo(() => (focus === null ? null : lineage(focus, c)), [focus, c]);
  const W = lay.width + PAD * 2 + LABEL, H = lay.rows.length * ROW + PAD;
  return (
    <div class="family">
      <div class="small muted family-key">
        <span class="fk living" /> living <span class="fk dead" /> died · point at someone to trace their line · click a name to find them in the world
      </div>
      <div class="family-scroll">
        <svg width={W} height={H} role="img" aria-label="Family tree">
          {lay.rows.map((_, g) => (
            <text key={g} x={PAD} y={PAD + g * ROW + NH / 2 + 4} class="t-lane">{`Generation ${g + 1}`}</text>
          ))}
          {lay.edges.map((e, i) => {
            const on = !kin || (kin.has(e.child) && e.parents.some((p) => kin.has(p)));
            return <path key={i} d={e.d} class={`f-edge${on ? '' : ' dim'}`} />;
          })}
          {lay.couples.map((e, i) => (
            <line key={i} x1={e.x1} x2={e.x2} y1={e.y} y2={e.y} class={`f-couple${!kin || (kin.has(e.a) && kin.has(e.b)) ? '' : ' dim'}`} />
          ))}
          {lay.nodes.map((n) => {
            const p = n.p;
            const dim = kin && !kin.has(p.id);
            const end = lifeEnd(p, c.tick);
            return (
              <g key={p.id} transform={`translate(${n.x},${n.y})`} class={`f-node${p.alive ? ' alive' : ''}${dim ? ' dim' : ''}${focus === p.id ? ' focus' : ''}`}
                onMouseEnter={() => setFocus(p.id)} onMouseLeave={() => setFocus(null)} onClick={() => go(p.id)}>
                <rect width={NW} height={NH} rx={7} />
                <text x={10} y={17} class="f-name">{p.name}{p.alive ? '' : ' †'}</text>
                <text x={10} y={32} class="f-life">
                  {p.birth > 0 ? `Y${yearOf(p.birth)}` : 'founder'}{p.alive ? `, now ${ageAt(p, end)}` : ` – Y${yearOf(end)}, ${ageAt(p, end)}`}
                </text>
                <title>{`${p.name} of ${c.camps.find((b) => b.id === p.band)?.name ?? '?'}: ${p.alive ? `alive, ${ageAt(p, end)}` : `died at ${ageAt(p, end)} of ${CAUSE[p.cause] ?? p.cause}`}${p.children.length ? ` · ${p.children.length} children` : ''}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Ancestors and descendants of one person, and the person. */
function lineage(id: number, c: Chron) {
  const byId = new Map(c.people.map((p) => [p.id, p]));
  const out = new Set<number>([id]);
  const up = (pid: number) => {
    const p = byId.get(pid);
    if (!p) return;
    for (const q of [p.mother, p.father]) if (q >= 0 && !out.has(q)) { out.add(q); up(q); }
  };
  const down = (pid: number) => {
    for (const k of byId.get(pid)?.children ?? []) if (!out.has(k)) { out.add(k); down(k); }
  };
  up(id);
  down(id);
  const p = byId.get(id);
  if (p && p.partner >= 0) out.add(p.partner);
  return out;
}

/** Rows by generation; each child as close under its parents as the row allows. */
function layoutFamily(c: Chron) {
  const byId = new Map(c.people.map((p) => [p.id, p]));
  const gen = new Map<number, number>();
  const genOf = (p: Person): number => {
    const known = gen.get(p.id);
    if (known !== undefined) return known;
    const ps = [p.mother, p.father].map((id) => byId.get(id)).filter(Boolean) as Person[];
    const g = ps.length ? 1 + Math.max(...ps.map(genOf)) : 0;
    gen.set(p.id, g);
    return g;
  };
  const rows: Person[][] = [];
  for (const p of [...c.people].sort((a, b) => a.birth - b.birth || a.id - b.id)) (rows[genOf(p)] ??= []).push(p);
  for (let g = 0; g < rows.length; g++) rows[g] ??= [];
  const xOf = new Map<number, number>();
  const placed: { p: Person; x: number; y: number }[] = [];
  let width = 0;
  const x0 = PAD + LABEL;
  rows.forEach((row, g) => {
    // founders: partners side by side
    let order: { p: Person; want: number }[];
    if (g === 0) {
      const seen = new Set<number>();
      const seq: Person[] = [];
      for (const p of row) {
        if (seen.has(p.id)) continue;
        seq.push(p); seen.add(p.id);
        const pt = row.find((q) => q.id === p.partner && !seen.has(q.id));
        if (pt) { seq.push(pt); seen.add(pt.id); }
      }
      order = seq.map((p, i) => ({ p, want: x0 + i * (NW + GX) }));
    } else {
      order = row.map((p) => {
        const ps = [p.mother, p.father].filter((id) => xOf.has(id)).map((id) => xOf.get(id)!);
        return { p, want: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length - NW / 2 : x0 };
      }).sort((a, b) => a.want - b.want || a.p.birth - b.p.birth);
      // pull partners next to each other when both are in this row
      for (let i = 0; i < order.length; i++) {
        const j = order.findIndex((o, k) => k > i + 1 && o.p.id === order[i].p.partner);
        if (j > 0) order.splice(i + 1, 0, ...order.splice(j, 1));
      }
    }
    // pack left to right, then slide the whole row back so it sits centred under the parents
    let right = x0 - GX;
    const xs = order.map((o) => {
      const x = Math.max(o.want, right + GX);
      right = x + NW;
      return x;
    });
    if (g > 0 && xs.length) {
      const drift = xs.reduce((a, x, i) => a + x - order[i].want, 0) / xs.length;
      const shift = Math.min(drift, xs[0] - x0);
      for (let i = 0; i < xs.length; i++) xs[i] -= shift;
    }
    order.forEach((o, i) => {
      xOf.set(o.p.id, xs[i] + NW / 2);
      placed.push({ p: o.p, x: xs[i], y: PAD / 2 + g * ROW });
    });
    if (xs.length) width = Math.max(width, xs[xs.length - 1] + NW - x0);
  });
  const at = new Map(placed.map((n) => [n.p.id, n]));
  const edges: { d: string; child: number; parents: number[] }[] = [];
  for (const n of placed) {
    const ps = [n.p.mother, n.p.father].map((id) => at.get(id)).filter(Boolean) as typeof placed;
    if (!ps.length) continue;
    const px = ps.reduce((a, q) => a + q.x + NW / 2, 0) / ps.length;
    const py = Math.max(...ps.map((q) => q.y)) + NH;
    const cx = n.x + NW / 2, mid = n.y - 22;
    edges.push({ d: `M${px},${py} V${mid} H${cx} V${n.y}`, child: n.p.id, parents: ps.map((q) => q.p.id) });
  }
  const couples: { x1: number; x2: number; y: number; a: number; b: number }[] = [];
  for (const n of placed) {
    const m = at.get(n.p.partner);
    if (!m || m.y !== n.y || m.x <= n.x || m.x - n.x > NW + GX + 1) continue;
    couples.push({ x1: n.x + NW, x2: m.x, y: n.y + NH / 2, a: n.p.id, b: m.p.id });
  }
  return { rows, nodes: placed, edges, couples, width };
}

// ------------------------------------------------------------------ records

function Records({ c, go, byId }: { c: Chron; go: (id: number) => void; byId: Map<number, Person> }) {
  const now = c.tick;
  const ppl = c.people;
  const dead = ppl.filter((p) => !p.alive);
  const living = ppl.filter((p) => p.alive);
  const desc = (id: number, seen = new Set<number>()): number => {
    for (const k of byId.get(id)?.children ?? []) if (!seen.has(k)) { seen.add(k); desc(k, seen); }
    return seen.size;
  };
  const top = <T,>(xs: T[], f: (x: T) => number) => xs.reduce<T | null>((b, x) => (b === null || f(x) > f(b) ? x : b), null);
  const longest = top(dead, (p) => p.death - p.birth);
  const oldest = top(living, (p) => now - p.birth);
  const mostKids = top(ppl, (p) => p.children.length);
  const line = top(ppl, (p) => desc(p.id));
  const hunter = top(ppl, (p) => p.kills);
  const skilled = top(ppl, (p) => p.topSkill);
  const SKILL = ['forager', 'woodcutter', 'builder', 'hunter', 'fisher', 'crafter'];
  const h = c.history;
  const peak = top(h, (s) => s.pop);
  // by year
  const yrs = new Map<number, { deaths: number; births: number; hungry: number; anomaly: number[] }>();
  for (const p of ppl) {
    if (p.birth > 0) (yrs.get(yearOf(p.birth)) ?? yrs.set(yearOf(p.birth), { deaths: 0, births: 0, hungry: 0, anomaly: [] }).get(yearOf(p.birth))!).births++;
    if (!p.alive) (yrs.get(yearOf(p.death)) ?? yrs.set(yearOf(p.death), { deaths: 0, births: 0, hungry: 0, anomaly: [] }).get(yearOf(p.death))!).deaths++;
  }
  for (const s of h) {
    const y = yrs.get(yearOf(s.tick)) ?? yrs.set(yearOf(s.tick), { deaths: 0, births: 0, hungry: 0, anomaly: [] }).get(yearOf(s.tick))!;
    y.hungry += s.famine ? 4 : 0;
    y.anomaly.push(s.anomaly);
  }
  const ys = [...yrs.entries()].map(([year, v]) => ({ year, ...v, a: v.anomaly.length ? v.anomaly.reduce((a, b) => a + b, 0) / v.anomaly.length : 0 }));
  const deadliest = top(ys, (y) => y.deaths);
  const hungriest = top(ys, (y) => y.hungry);
  const withWeather = ys.filter((y) => y.anomaly.length);
  const usual = withWeather.reduce((a, y) => a + y.a, 0) / Math.max(1, withWeather.length);
  const coldest = top(withWeather, (y) => -y.a);
  const fruitful = top(ys, (y) => y.births);
  const adults = dead.filter((p) => ageAt(p, p.death) >= 14);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const causes = new Map<string, number>();
  for (const p of dead) causes.set(p.cause, (causes.get(p.cause) ?? 0) + 1);
  const causeList = [...causes.entries()].sort((a, b) => b[1] - a[1]);
  const maxCause = Math.max(1, ...causeList.map((x) => x[1]));
  const who = (p: Person | null, extra: string) => p ? <>{<button class={`link${p.alive ? '' : ' gone'}`} onClick={() => go(p.id)}>{p.name}</button>}{extra}</> : '—';

  const tiles: { label: string; big: ComponentChildren; sub: ComponentChildren }[] = [
    { label: 'Most people at once', big: peak?.pop ?? living.length, sub: peak ? `Year ${yearOf(peak.tick)}, ${SEASON_NAMES[seasonOf(peak.tick)].toLowerCase()}` : 'now' },
    { label: 'Longest life', big: longest ? ageAt(longest, longest.death) : '—', sub: who(longest, longest ? `, died of ${CAUSE[longest.cause] ?? longest.cause}` : '') },
    { label: 'Oldest living', big: oldest ? ageAt(oldest, now) : '—', sub: who(oldest, '') },
    { label: 'Most children', big: mostKids?.children.length ?? 0, sub: who(mostKids && mostKids.children.length ? mostKids : null, '') },
    { label: 'Largest family line', big: line ? desc(line.id) : 0, sub: who(line && desc(line.id) ? line : null, ' and descendants') },
    { label: 'Best hunter', big: hunter?.kills ?? 0, sub: who(hunter && hunter.kills ? hunter : null, ' (deer brought down)') },
    { label: 'Most skilled', big: skilled ? skilled.topSkill.toFixed(1) : '—', sub: who(skilled, skilled ? `, ${SKILL[skilled.skills.indexOf(skilled.topSkill)] ?? 'worker'}` : '') },
    { label: 'Deadliest year', big: deadliest?.deaths ?? 0, sub: deadliest && deadliest.deaths ? `deaths in year ${deadliest.year}` : 'no deaths yet' },
    { label: 'Most births in a year', big: fruitful?.births ?? 0, sub: fruitful && fruitful.births ? `year ${fruitful.year}` : 'none yet' },
    { label: 'Longest hunger', big: hungriest?.hungry ?? 0, sub: hungriest && hungriest.hungry ? `days, year ${hungriest.year}` : 'never hungry' },
    { label: 'Coldest year', big: coldest ? `${(coldest.a - usual).toFixed(1)}°` : '—', sub: coldest ? `year ${coldest.year}, against this land's usual` : '' },
    ...(c.camps.length > 1 ? [
      { label: 'Camps', big: c.camps.length, sub: `${c.camps.filter((b) => !b.gone).length} still lived in` },
      (() => {
        const old = top(c.camps, (b) => (b.gone || now) - b.founded);
        return { label: 'Longest-lived camp', big: old ? Math.floor(((old.gone || now) - old.founded) / TICKS_PER_YEAR) : 0, sub: old ? `years, ${old.name}${old.gone ? ' (left)' : ''}` : '' };
      })(),
    ] : []),
    { label: 'Life expectancy', big: adults.length ? Math.round(avg(adults.map((p) => ageAt(p, p.death)))) : '—', sub: adults.length ? `years, for those who reached 14 (${adults.length} lives)` : 'no adult has died yet' },
  ];
  return (
    <div class="records">
      <div class="tiles">
        {tiles.map((t) => (
          <div key={t.label} class="tile">
            <div class="label">{t.label}</div>
            <div class="big">{t.big}</div>
            <div class="small muted">{t.sub}</div>
          </div>
        ))}
      </div>
      <div class="rec-cols">
        <section>
          <div class="label">How people died</div>
          {causeList.length ? (
            <table class="bars">
              <tbody>
                {causeList.map(([k, n]) => (
                  <tr key={k}>
                    <th>{cap(CAUSE[k] ?? k)}</th>
                    <td><i style={{ width: `${(n / maxCause) * 100}%` }} /></td>
                    <td class="n">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p class="muted small">No one has died yet.</p>}
        </section>
        <section>
          <div class="label">Totals</div>
          <dl class="rows compact">
            <dt>Ever lived</dt><dd>{ppl.length} ({ppl.length - ppl.filter((p) => p.birth > 0).length} founders)</dd>
            <dt>Born here</dt><dd>{c.stats.births}</dd>
            <dt>Died</dt><dd>{c.stats.deaths}{c.stats.starved ? `, ${c.stats.starved} of hunger` : ''}{c.stats.froze ? `, ${c.stats.froze} of cold` : ''}</dd>
            <dt>Living now</dt><dd>{living.length}</dd>
            <dt>Deer taken</dt><dd>{c.stats.kills}</dd>
            <dt>Trees felled</dt><dd>{c.stats.felled}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
