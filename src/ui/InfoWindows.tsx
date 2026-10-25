// Floating info windows: click anything in the world and a window opens beside it, joined to it
// by a thin line. Drag a window by its header; pin it to keep it open while you click other
// things, so several can sit side by side for comparison.
import { useRef } from 'preact/hooks';
import type { Engine, Snapshot, InfoWin, PersonDetail } from '../main';
import { WIN_W } from '../main';
import { SKILLS, CARRY } from '../sim/band';
import { TICKS_PER_YEAR } from '../sim/time';
import { when, Bar } from './App';

const METERS_PER_UNIT = 6;

const DOING: Record<string, string> = {
  eat: 'Eating by the fire', eatwild: 'Eating berries off the bush', sleep: 'Asleep', warm: 'Warming up by the fire',
  socialize: 'Visiting someone', play: 'Playing', idle: 'Resting', mourn: 'Mourning', forage: 'Picking berries',
  fell: 'Felling a tree', haul: 'Hauling logs home', hunt: 'Hunting deer', fish: 'Fishing', build: 'Building',
  supply: 'Carrying materials to a building site', fuel: 'Feeding the fire', preserve: 'Drying meat and fish',
  bury: 'Burying the dead', explore: 'Exploring', deadwood: 'Gathering fallen branches', swim: 'Swimming to cool off',
  reap: 'Cutting grass and reeds', twist: 'Twisting cordage', dig: 'Digging mud', quarry: 'Quarrying stone',
};
const CARRYING: Record<number, string> = {
  [CARRY.Log]: 'a log', [CARRY.Berries]: 'berries', [CARRY.Meat]: 'meat', [CARRY.Fish]: 'fish',
  [CARRY.Body]: 'the body of the dead', [CARRY.Spear]: 'a spear', [CARRY.Baby]: 'a baby', [CARRY.Fiber]: 'grass and cordage', [CARRY.Mud]: 'a basket of mud', [CARRY.Stone]: 'stone',
};
const NEEDS: [keyof PersonDetail['needs'], string][] = [['food', 'Food'], ['rest', 'Rest'], ['warmth', 'Warmth'], ['belonging', 'Company'], ['safety', 'Safety']];
const SKILL_WORDS: Record<string, string> = {
  foraging: 'Foraging', woodcutting: 'Woodcutting', building: 'Building', hunting: 'Hunting', fishing: 'Fishing', crafting: 'Crafting',
};
const KIND_WORD: Record<string, string> = { person: 'Person', deer: 'Animal', building: 'Building', prop: 'Thing', tile: 'Land' };

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
  const p = w.ref.kind === 'person' ? w.person : null;
  const c = w.ref.kind !== 'person' ? w.card : null;
  const gone = w.loaded && !p && !c;
  const title = p ? p.name : c ? c.title : gone ? 'Gone' : 'Looking closer…';
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
      class={`panel info-win${focus ? ' focus' : ''}${w.pinned ? ' pinned' : ''}`}
      style={{ left: `${w.x}px`, top: `${w.y}px`, zIndex: 20 + w.z, width: `${WIN_W}px` }}
      aria-label={title}
      onPointerDown={() => !focus && engine.focusWin(w.key)}
    >
      <header class="win-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title="Drag to move">
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
          <button class="btn icon small" onClick={() => engine.closeWin(w.key)} aria-label="Close" title="Close (Esc)">×</button>
        </div>
      </header>
      {p ? <PersonBody p={p} w={w} s={s} engine={engine} /> : c ? <ThingBody c={c} engine={engine} /> : (
        <p class="hint win-body" style={{ margin: 0 }}>{gone ? 'Nothing is here any more.' : 'Looking closer…'}</p>
      )}
    </aside>
  );
}

function ThingBody({ c, engine }: { c: NonNullable<InfoWin['card']>; engine: Engine }) {
  return (
    <div class="win-body scroll">
      {c.subtitle && <div class="sub">{c.subtitle}{c.gone ? ' · gone now' : ''}</div>}
      {c.lines.length > 0 && (
        <dl class="rows compact family">
          {c.lines.map((l, i) => (
            <>
              <dt key={`t${i}`}>{l.label}</dt>
              <dd key={`d${i}`}>{l.ref ? <button class="link" onClick={() => engine.selectRef(l.ref!)}>{l.value}</button> : l.value}</dd>
            </>
          ))}
        </dl>
      )}
      {c.notes.map((n) => <p key={n} class="note">{n}</p>)}
    </div>
  );
}

const TABS = [['now', 'Now'], ['family', 'Family'], ['skills', 'Skills'], ['story', 'Story']] as const;

function PersonBody({ p, w, s, engine }: { p: PersonDetail; w: InfoWin; s: Snapshot; engine: Engine }) {
  const age = Math.floor(p.age);
  const ageWord = p.age < 2 ? 'infant' : p.age < 14 ? (p.sex ? 'boy' : 'girl') : p.age >= 58 ? (p.sex ? 'old man' : 'old woman') : p.sex ? 'man' : 'woman';
  const tab = p.alive || w.tab !== 'now' ? w.tab : 'story';
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
        {p.pregnant && ' · with child'}
        {p.sick && ' · feverish'}
        {p.home ? ` · lives in a ${p.home.toLowerCase()}` : p.alive && p.age >= 2 ? ' · no home yet' : ''}
      </div>
      <div class="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" class="tab" aria-selected={tab === k} onClick={() => engine.setWinTab(w.key, k)} disabled={k === 'now' && !p.alive}>
            {label}
          </button>
        ))}
      </div>
      <div class="win-body scroll">
        {tab === 'now' && p.alive && (
          <>
            <p class="thought">“{p.thought}”</p>
            <dl class="rows compact">
              <dt>Doing</dt>
              <dd>{p.task ? DOING[p.task] ?? p.task : 'Nothing much'}{p.indoors ? ', indoors' : ''}</dd>
              {p.carry > 0 && CARRYING[p.carry] && (<><dt>Carrying</dt><dd>{CARRYING[p.carry]}{p.carryAmt > 1 ? ` (${Math.round(p.carryAmt)})` : ''}</dd></>)}
              <dt>Where</dt>
              <dd>{p.campDist < 3 ? `At ${p.bandName}` : `${Math.round((p.campDist * METERS_PER_UNIT) / 10) * 10} m from ${p.bandName}`}</dd>
            </dl>
            <div class="needs">
              {NEEDS.map(([k, label]) => (
                <div key={k} class="need"><span>{label}</span><Bar v={p.needs[k]} /><b>{Math.round(p.needs[k])}</b></div>
              ))}
              <div class="need"><span>Health</span><Bar v={p.health} warn={40} /><b>{Math.round(p.health)}</b></div>
              <div class="need"><span>Mood</span><Bar v={p.mood} warn={30} /><b>{Math.round(p.mood)}</b></div>
            </div>
            <div class="chips">{p.traits.map((t) => <span key={t} class="chip">{t}</span>)}</div>
          </>
        )}
        {tab === 'family' && (
          <dl class="rows compact family">
            {p.partner && (<><dt>Partner</dt><dd>{who({ ...p.partner, alive: true })}</dd></>)}
            {(p.mother || p.father) && (<><dt>Parents</dt><dd>{who(p.mother)}{p.mother && p.father ? ' & ' : ''}{who(p.father)}</dd></>)}
            {p.carer && (<><dt>Raised by</dt><dd>{who(p.carer)}</dd></>)}
            {p.fostering.length > 0 && (<><dt>Fostering</dt><dd>{list(p.fostering)}</dd></>)}
            {p.children.length > 0 && (<><dt>Children</dt><dd>{list(p.children)}</dd></>)}
            {p.descendants > p.children.length && (<><dt>Line</dt><dd>{p.descendants} descendants in all</dd></>)}
            {p.friends.length > 0 && (<><dt>Close to</dt><dd>{list(p.friends.slice(0, 4))}</dd></>)}
            {p.rivals.length > 0 && (<><dt>Dislikes</dt><dd>{list(p.rivals)}</dd></>)}
            <dt>Knows</dt>
            <dd>{p.knows} {p.knows === 1 ? 'person' : 'people'} among the living</dd>
          </dl>
        )}
        {tab === 'skills' && (
          <>
            <div class="needs">
              {SKILLS.map((k, i) => (
                <div key={k} class="need"><span>{SKILL_WORDS[k]}</span><Bar v={p.skills[i]} max={20} warn={-1} /><b>{p.skills[i].toFixed(1)}</b></div>
              ))}
            </div>
            <p class="small muted" style={{ margin: '8px 0 0' }}>
              Skills grow with practice, up to 20. {p.kills > 0 ? `${p.kills} deer brought down.` : p.age >= 14 ? 'No deer brought down yet.' : ''}
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
