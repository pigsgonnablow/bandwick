// Floating info windows: click anything in the world and a window opens beside it, joined to it
// by a thin line. Drag a window by its header; pin it to keep it open while you click other
// things, so several can sit side by side for comparison.
import { useEffect, useRef } from 'preact/hooks';
import type { Engine, Snapshot, InfoWin, PersonDetail } from '../main';
import { WIN_W } from '../main';
import { ITEM_PIC_SIZE } from '../render/itempic';
import { SKILLS, HEALTH } from '../sim/band';
import { CARRYING, SLOT_WORDS, gearLine, warmthWords } from './words';
import { TICKS_PER_YEAR } from '../sim/time';
import { when, Bar } from './App';
import { useCollapsed, CollapseBtn } from './Collapse';
import { NEED_TIPS, SKILL_TIPS, SKILLS_NOTE, TRAIT_TIPS, SLOT_TIPS, GEAR_ROW_TIPS, WARMTH_TIP, PERSON_ROW_TIPS, CARD_TIPS } from './tips';

const METERS_PER_UNIT = 6;
/** What is left of someone nobody has buried, by stage (REMAINS in the sim). */
const REMAINS_WORDS = ['lies unburied where they fell', 'rotting where they fell', 'only bones are left', 'their bones lie scattered in the grass'];

const DOING: Record<string, string> = {
  eat: 'Eating by the fire', eatwild: 'Eating berries off the bush', sleep: 'Asleep', warm: 'Warming up by the fire',
  socialize: 'Visiting someone', play: 'Playing', idle: 'Resting', mourn: 'Mourning', forage: 'Picking berries',
  fell: 'Felling a tree', haul: 'Hauling logs home', hunt: 'Hunting deer', fish: 'Fishing', build: 'Building',
  supply: 'Carrying materials to a building site', fuel: 'Feeding the fire', preserve: 'Drying meat and fish',
  bury: 'Burying the dead', explore: 'Exploring', deadwood: 'Gathering fallen branches', swim: 'Swimming to cool off',
  reap: 'Cutting grass and reeds', craft: 'Making things by the fire', dig: 'Digging mud', quarry: 'Quarrying stone', trap: 'Going round the traps',
};
const NEEDS: [keyof PersonDetail['needs'], string][] = [['food', 'Food'], ['rest', 'Rest'], ['warmth', 'Warmth'], ['belonging', 'Company'], ['safety', 'Safety']];
const NEED_WORDS: Record<keyof PersonDetail['needs'], string> = { food: 'hunger', rest: 'tiredness', warmth: 'cold', belonging: 'loneliness', safety: 'fear' };

/** What their health is doing to them right now, in the sim's own thresholds. */
function healthTip(p: PersonDetail) {
  const h = p.health, { food, warmth } = p.needs;
  const effects: string[] = [];
  if (h < HEALTH.weak) effects.push('too weak to do much work, slow on their feet, and more likely to die of fever or old age');
  if (h < HEALTH.hunt) effects.push('too hurt to hunt');
  if (h <= HEALTH.swim) effects.push(h < HEALTH.lead ? 'not up to swimming or leading others away' : 'not up to swimming');
  const harm = [food < HEALTH.starving && 'starving', warmth < HEALTH.cold && 'cold', p.sick && 'sick'].filter(Boolean);
  const trend = harm.length ? `Getting worse (${harm.join(', ')}).`
    : h >= 99.5 ? ''
    : food > HEALTH.mend && warmth > HEALTH.mend ? 'Recovering slowly (fed and warm).'
    : 'Not mending: needs to be fed and warm.';
  if (!effects.length && !trend) return `Health ${Math.round(h)}: healthy. Hunger, cold and fever wear it down; it mends slowly while they are fed and warm.`;
  const now = effects.length ? `${effects.join('; ')}.` : 'no ill effects yet.';
  return `Health ${Math.round(h)}: ${now}${trend ? ` ${trend}` : ''}`;
}

const MOOD_LOW = 30;
/** How their mood is touching their work and family, and what is weighing on it. */
function moodTip(p: PersonDetail) {
  const m = p.mood;
  const state = m < MOOD_LOW ? 'low spirits, so works with less heart and is less keen to start a family.'
    : m >= 70 ? 'in good spirits.' : 'getting by.';
  const weigh = (Object.keys(NEED_WORDS) as (keyof PersonDetail['needs'])[]).filter((k) => p.needs[k] < MOOD_LOW).map((k) => NEED_WORDS[k]);
  if (p.health < HEALTH.weak) weigh.push('poor health');
  return `Mood ${Math.round(m)}: ${state}${weigh.length ? ` Weighing on them: ${weigh.join(', ')}.` : ''}`;
}

const SKILL_WORDS: Record<string, string> = {
  foraging: 'Foraging', woodcutting: 'Woodcutting', building: 'Building', hunting: 'Hunting', fishing: 'Fishing',
  toolmaking: 'Toolmaking', weaving: 'Weaving', pottery: 'Pottery', hidework: 'Hidework',
};
const KIND_WORD: Record<string, string> = { person: 'Person', deer: 'Animal', building: 'Building', prop: 'Thing', tile: 'Land', item: 'Item' };

export function InfoWindows({ s, engine }: { s: Snapshot; engine: Engine }) {
  if (!s.wins.length) return null;
  const focusKey = s.sel ? `${s.sel.kind}:${s.sel.id}` : '';
  return (
    <>
      <svg class="leaders" aria-hidden="true">
        {s.wins.map((w) => <Leader key={w.key} w={w} focus={w.key === focusKey} />)}
      </svg>
      {s.wins.map((w) => <Win key={w.key} w={w} s={s} engine={engine} focus={w.key === focusKey} />)}
    </>
  );
}

/** A line from the thing to the nearest edge of its window. */
function Leader({ w, focus }: { w: InfoWin; focus: boolean }) {
  const a = w.anchor;
  if (!a) return null;
  const x = Math.min(Math.max(a.x, w.x), w.x + WIN_W);
  const y = Math.min(Math.max(a.y, w.y + 18), w.y + 60);
  if (Math.hypot(a.x - x, a.y - y) < 12) return null;
  return (
    <g class={focus ? 'focus' : ''}>
      <line x1={a.x} y1={a.y} x2={x} y2={y} />
      <circle cx={a.x} cy={a.y} r={3.5} />
    </g>
  );
}

function Win({ w, s, engine, focus }: { w: InfoWin; s: Snapshot; engine: Engine; focus: boolean }) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [folded, setFolded] = useCollapsed();
  const p = w.ref.kind === 'person' ? w.person : null;
  const c = w.ref.kind !== 'person' ? w.card : null;
  const gone = w.loaded && !p && !c;
  const title = p ? p.titled : c ? c.title : gone ? 'Gone' : 'Looking closer…';
  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    engine.focusWin(w.key);
    drag.current = { dx: e.clientX - w.x, dy: e.clientY - w.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (drag.current) engine.moveWin(w.key, e.clientX - drag.current.dx, e.clientY - drag.current.dy);
  };
  const onUp = () => (drag.current = null);
  const xy = p ? { x: p.x, z: p.z } : c ? { x: c.x, z: c.z } : null;
  return (
    <aside
      class={`panel info-win${focus ? ' focus' : ''}${w.pinned ? ' pinned' : ''}${folded ? ' collapsed' : ''}`}
      style={{ left: `${w.x}px`, top: `${w.y}px`, zIndex: 20 + w.z, width: `${WIN_W}px` }}
      aria-label={title}
      onPointerDown={() => !focus && engine.focusWin(w.key)}
    >
      <header class="win-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDblClick={(e) => !(e.target as HTMLElement).closest('button') && setFolded(!folded)} title="Drag to move · double-click to fold">
        <div class="win-title">
          <span class="kind">{KIND_WORD[w.ref.kind]}{w.pinned ? ' · pinned' : ''}</span>
          <span class="name">{title}{p && !p.alive ? ' †' : ''}</span>
        </div>
        <div class="row win-tools">
          {p?.alive && focus && (
            <button class="btn small" aria-pressed={s.follow} onClick={() => engine.setFollow(!s.follow)} title="Keep the camera on them (F)">
              {s.follow ? 'Following' : 'Follow'}
            </button>
          )}
          {xy && (
            <button class="btn icon small" onClick={() => { engine.focusWin(w.key); engine.flyTo(xy.x, xy.z, 9); }} title="Bring the camera here" aria-label="Look">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="4.5" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke-linecap="round" /></svg>
            </button>
          )}
          <button class="btn icon small" aria-pressed={w.pinned} onClick={() => engine.pinWin(w.key, !w.pinned)}
            title={w.pinned ? 'Unpin: close when you click something else' : 'Pin: keep this open to compare with other things'} aria-label={w.pinned ? 'Unpin' : 'Pin'}>
            <svg viewBox="0 0 16 16" fill={w.pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h4l-.6 4 2.6 2.4v1.1H4V8.4L6.6 6z" /><path d="M8 9.5V14" stroke-linecap="round" /></svg>
          </button>
          <CollapseBtn collapsed={folded} onToggle={setFolded} what="this window" />
          <button class="btn icon small" onClick={() => engine.closeWin(w.key)} aria-label="Close" title="Close (Esc)">×</button>
        </div>
      </header>
      {folded ? null : p ? <PersonBody p={p} w={w} s={s} engine={engine} /> : c ? <ThingBody c={c} engine={engine} /> : (
        <p class="hint win-body" style={{ margin: 0 }}>{gone ? 'Nothing is here any more.' : 'Looking closer…'}</p>
      )}
    </aside>
  );
}

function ThingBody({ c, engine }: { c: NonNullable<InfoWin['card']>; engine: Engine }) {
  const pic = c.item && engine.hasItemPicture(c.item) ? c.item : null;
  return (
    <div class="win-body scroll">
      {c.subtitle && <div class="sub">{c.subtitle}{c.gone ? ' · gone now' : ''}</div>}
      {pic && <ItemViewer kind={pic} title={c.title} engine={engine} />}
      {c.lines.length > 0 && (
        <dl class="rows compact family">
          {c.lines.map((l, i) => (
            <>
              <dt key={`t${i}`} data-tip={CARD_TIPS[l.label] ?? (l.label.startsWith('This year') ? CARD_TIPS['This year'] : undefined)}>{l.label}</dt>
              <dd key={`d${i}`}>{l.ref ? <button class="link" onClick={() => engine.selectRef(l.ref!)}>{l.value}</button> : l.value}</dd>
            </>
          ))}
        </dl>
      )}
      {c.notes.map((n) => <p key={n} class="note">{n}</p>)}
    </div>
  );
}

/** The thing's model, which turns in hand while you drag over it; a double click sets it back. */
function ItemViewer({ kind, title, engine }: { kind: string; title: string; engine: Engine }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ yaw: 0, pitch: 0, drag: null as null | { x: number; y: number; id: number }, frame: 0 });
  const draw = () => {
    const cv = ref.current;
    if (!cv || st.current.frame) return;
    st.current.frame = requestAnimationFrame(() => {
      st.current.frame = 0;
      if (ref.current) engine.paintItem(kind, st.current.yaw, st.current.pitch, ref.current);
    });
  };
  useEffect(() => {
    const cv = ref.current!;
    const px = Math.round(ITEM_PIC_SIZE * Math.min(2, devicePixelRatio || 1));
    cv.width = px;
    cv.height = px;
    st.current.yaw = 0;
    st.current.pitch = 0;
    draw();
    return () => {
      cancelAnimationFrame(st.current.frame);
      st.current.frame = 0;
    };
  }, [kind]);
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    st.current.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const move = (e: PointerEvent) => {
    const d = st.current.drag;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    const k = Math.PI / ITEM_PIC_SIZE; // dragging across the whole picture turns it half way round
    st.current.yaw += (e.clientX - d.x) * k;
    st.current.pitch = Math.max(-1.4, Math.min(1.4, st.current.pitch + (e.clientY - d.y) * k));
    d.x = e.clientX;
    d.y = e.clientY;
    draw();
  };
  const up = (e: PointerEvent) => {
    if (st.current.drag?.id !== e.pointerId) return;
    st.current.drag = null;
  };
  const reset = () => {
    st.current.yaw = 0;
    st.current.pitch = 0;
    draw();
  };
  return (
    <div class="item-pic">
      <canvas
        ref={ref}
        role="img"
        aria-label={title}
        title="Drag to turn it around · double-click to set it back"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDblClick={reset}
      />
    </div>
  );
}

/** A made thing named in a window: its name opens a window about it, the rest of the line follows. */
function ItemLine({ it, w, engine }: { it: Parameters<typeof gearLine>[0] & { id: number }; w: InfoWin; engine: Engine }) {
  const line = gearLine(it);
  return (
    <>
      <button class="link" onClick={() => engine.openFrom({ kind: 'item', id: it.id }, w.key)} title="Open a window about it">{it.label}</button>
      {line.slice(it.label.length)}
    </>
  );
}

const TABS = [['now', 'Now'], ['gear', 'Gear'], ['family', 'Family'], ['skills', 'Skills'], ['story', 'Story']] as const;

/** A small figure dressed as they are: each place on the body filled in where they wear something. */
function GearFigure({ p }: { p: PersonDetail }) {
  const on = (slot: string) => p.gear.some((g) => g.slot === slot && g.item);
  const kind = (slot: string) => p.gear.find((g) => g.slot === slot)?.item?.kind;
  const fill = (slot: string) => (on(slot) ? (kind(slot) === 'cape' ? '#c9b77a' : '#8a6a46') : 'none');
  return (
    <svg class="gear-figure" viewBox="0 0 60 120" width="48" height="96" role="img" aria-label="What they wear">
      <g fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.55">
        <circle cx="30" cy="16" r="9" />
        <path d="M18 30 h24 l4 40 h-32 z" />
        <path d="M18 32 l-8 30 M42 32 l8 30" />
        <path d="M22 70 l-2 40 M38 70 l2 40" />
      </g>
      <path d="M21 13 a9 9 0 0 1 18 0 v2 h-18 z" fill={fill('head')} />
      {on('torso') && <path d="M19 30 h22 l3 42 h-28 z" fill="#cdc2a2" />}
      <path d="M16 29 h28 l5 44 h-38 z" fill={fill('body')} opacity="0.85" />
      <circle cx="10" cy="64" r="3.5" fill={fill('hands')} /><circle cx="50" cy="64" r="3.5" fill={fill('hands')} />
      <path d="M15 108 h8 v5 h-10 z M37 108 h8 l2 5 h-10 z" fill={fill('feet')} />
      {on('shoulder') && <><path d="M18 32 L46 66" stroke="#5c4630" stroke-width="2" /><rect x="42" y="62" width="10" height="11" rx="2" fill="#8a6a46" /></>}
      {on('neck') && <path d="M24 28 q6 6 12 0" stroke="#e8dcc0" stroke-width="1.6" fill="none" />}
    </svg>
  );
}

function PersonBody({ p, w, s, engine }: { p: PersonDetail; w: InfoWin; s: Snapshot; engine: Engine }) {
  const age = Math.floor(p.age);
  const ageWord = p.age < 2 ? 'infant' : p.age < 14 ? (p.sex ? 'boy' : 'girl') : p.age >= 58 ? (p.sex ? 'old man' : 'old woman') : p.sex ? 'man' : 'woman';
  const tab = p.alive || (w.tab !== 'now' && w.tab !== 'gear') ? w.tab : 'story';
  const who = (r: { id: number; name: string; alive?: boolean } | null) =>
    r ? (
      <button class={`link${r.alive === false ? ' gone' : ''}`} onClick={() => engine.select(r.id)}>
        {r.name}{r.alive === false ? ' †' : ''}
      </button>
    ) : null;
  const list = (rs: { id: number; name: string; alive?: boolean }[]) => rs.map((c, i) => <span key={c.id}>{i > 0 && ', '}{who(c)}</span>);
  return (
    <>
      <div class="win-sub sub">
        {p.alive ? `${age}, ${ageWord} of ${p.bandName}` : `Died ${when(p.death)}, aged ${age} (${p.cause})`}
        {p.remains !== null && ` · ${REMAINS_WORDS[p.remains] ?? ''}`}
        {p.pregnant && ' · with child'}
        {p.sick && ' · feverish'}
        {p.home ? ` · lives in a ${p.home.toLowerCase()}` : p.alive && p.age >= 2 ? ' · no home yet' : ''}
      </div>
      <div class="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" class="tab" aria-selected={tab === k} onClick={() => engine.setWinTab(w.key, k)} disabled={(k === 'now' || k === 'gear') && !p.alive}>
            {label}
          </button>
        ))}
      </div>
      <div class="win-body scroll">
        {tab === 'now' && p.alive && (
          <>
            <p class="thought">“{p.thought}”</p>
            <dl class="rows compact">
              <dt data-tip={PERSON_ROW_TIPS.Doing}>Doing</dt>
              <dd>{p.doing ?? (p.task ? DOING[p.task] ?? p.task : 'Nothing much')}{p.indoors ? ', indoors' : ''}</dd>
              {p.carry > 0 && CARRYING[p.carry] && (<><dt data-tip={GEAR_ROW_TIPS.Carrying}>Carrying</dt><dd>{CARRYING[p.carry]}{p.carryAmt > 1 ? ` (${Math.round(p.carryAmt)})` : ''}</dd></>)}
              {p.tool && (<><dt data-tip={GEAR_ROW_TIPS['In hand']}>In hand</dt><dd>A {p.tool}</dd></>)}
              {p.dog && (<><dt>Dog</dt><dd>{p.dog}</dd></>)}
              {(() => {
                const worn = p.gear.filter((g) => g.item && g.slot !== 'bed').map((g) => g.item!.label.toLowerCase());
                return worn.length > 0 && (<><dt data-tip={PERSON_ROW_TIPS.Wearing}>Wearing</dt><dd>{worn[0][0].toUpperCase() + worn.join(', ').slice(1)}</dd></>);
              })()}
              <dt data-tip={PERSON_ROW_TIPS.Where}>Where</dt>
              <dd>{p.campDist < 3 ? `At ${p.bandName}` : `${Math.round((p.campDist * METERS_PER_UNIT) / 10) * 10} m from ${p.bandName}`}</dd>
            </dl>
            <div class="needs">
              {NEEDS.map(([k, label]) => (
                <div key={k} class="need" data-tip={NEED_TIPS[k]}><span>{label}</span><Bar v={p.needs[k]} /><b>{Math.round(p.needs[k])}</b></div>
              ))}
              <div class="need" data-tip={healthTip(p)}><span>Health</span><Bar v={p.health} warn={HEALTH.weak} /><b>{Math.round(p.health)}</b></div>
              <div class="need" data-tip={moodTip(p)}><span>Mood</span><Bar v={p.mood} warn={MOOD_LOW} /><b>{Math.round(p.mood)}</b></div>
            </div>
            <div class="chips">{p.traits.map((t) => <span key={t} class="chip" data-tip={TRAIT_TIPS[t]}>{t}</span>)}</div>
          </>
        )}
        {tab === 'gear' && p.alive && (
          <>
            <div class="gear">
              <GearFigure p={p} />
              <dl class="rows compact">
                {p.gear.map((g) => (
                  <>
                    <dt data-tip={SLOT_TIPS[g.slot]}>{SLOT_WORDS[g.slot]}</dt>
                    <dd class={g.item ? '' : 'muted'}>{g.item ? <ItemLine it={g.item} w={w} engine={engine} /> : 'Nothing'}</dd>
                  </>
                ))}
                <dt data-tip={GEAR_ROW_TIPS['In hand']}>In hand</dt>
                <dd class={p.toolDetail ? '' : 'muted'}>{p.toolDetail ? <ItemLine it={p.toolDetail} w={w} engine={engine} /> : 'Nothing'}</dd>
                <dt data-tip={GEAR_ROW_TIPS.Carrying}>Carrying</dt>
                <dd class={p.carry > 0 && CARRYING[p.carry] ? '' : 'muted'}>{p.carry > 0 && CARRYING[p.carry] ? `${CARRYING[p.carry][0].toUpperCase()}${CARRYING[p.carry].slice(1)}${p.carryAmt > 1 ? ` (${Math.round(p.carryAmt)})` : ''}` : 'Nothing'}</dd>
              </dl>
            </div>
            <p class="small muted" style={{ margin: '8px 0 0' }}><span data-tip={WARMTH_TIP}>{warmthWords(p.coldKept)}.</span></p>
          </>
        )}
        {tab === 'family' && (
          <dl class="rows compact family">
            {p.partner && (<><dt data-tip={PERSON_ROW_TIPS.Partner}>Partner</dt><dd>{who({ ...p.partner, alive: true })}</dd></>)}
            {(p.mother || p.father) && (<><dt>Parents</dt><dd>{who(p.mother)}{p.mother && p.father ? ' & ' : ''}{who(p.father)}</dd></>)}
            {p.carer && (<><dt data-tip={PERSON_ROW_TIPS['Raised by']}>Raised by</dt><dd>{who(p.carer)}</dd></>)}
            {p.fostering.length > 0 && (<><dt data-tip={PERSON_ROW_TIPS.Fostering}>Fostering</dt><dd>{list(p.fostering)}</dd></>)}
            {p.children.length > 0 && (<><dt>Children</dt><dd>{list(p.children)}</dd></>)}
            {p.descendants > p.children.length && (<><dt data-tip={PERSON_ROW_TIPS.Line}>Line</dt><dd>{p.descendants} descendants in all</dd></>)}
            {p.friends.length > 0 && (<><dt data-tip={PERSON_ROW_TIPS['Close to']}>Close to</dt><dd>{list(p.friends.slice(0, 4))}</dd></>)}
            {p.rivals.length > 0 && (<><dt data-tip={PERSON_ROW_TIPS.Dislikes}>Dislikes</dt><dd>{list(p.rivals)}</dd></>)}
            <dt data-tip={PERSON_ROW_TIPS.Knows}>Knows</dt>
            <dd>{p.knows} {p.knows === 1 ? 'person' : 'people'} among the living</dd>
          </dl>
        )}
        {tab === 'skills' && (
          <>
            <div class="needs">
              {SKILLS.map((k, i) => p.shownSkills.includes(i) && (
                <div key={k} class="need" data-tip={SKILL_TIPS[k]}><span>{SKILL_WORDS[k]}</span><Bar v={p.skills[i]} max={20} warn={-1} /><b>{p.skills[i].toFixed(1)}</b></div>
              ))}
            </div>
            <p class="small muted" style={{ margin: '8px 0 0' }}>
              <span data-tip={SKILLS_NOTE}>Skills grow with practice, up to 20.</span> {p.kills > 0 ? `${p.kills} deer brought down.` : p.age >= 14 ? 'No deer brought down yet.' : ''}
            </p>
          </>
        )}
        {tab === 'story' && (
          <>
            <dl class="rows compact">
              <dt>Born</dt>
              <dd>{p.birth > 0 ? when(p.birth) : 'Before the band came here'}</dd>
              {!p.alive && (<><dt>Died</dt><dd>{when(p.death)}, {p.cause}</dd></>)}
            </dl>
            {p.memories.length > 0 ? (
              <ul class="memories">
                {p.memories.slice(0, 12).map((m) => (
                  <li key={m.tick + m.text} class={m.weight >= 0 ? 'good' : 'bad'} style={{ opacity: 0.45 + 0.55 * Math.min(1, Math.abs(m.now) / Math.max(1, Math.abs(m.weight))) }}>
                    <span class="when">{s.tick - m.tick < TICKS_PER_YEAR ? when(m.tick) : `${Math.floor((s.tick - m.tick) / TICKS_PER_YEAR)} yr ago`}</span>
                    {m.text}
                  </li>
                ))}
              </ul>
            ) : <p class="hint" style={{ margin: '6px 0 0' }}>Nothing much has happened to them yet.</p>}
          </>
        )}
      </div>
    </>
  );
}
