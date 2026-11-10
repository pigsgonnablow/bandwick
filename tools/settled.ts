// How settled a band's life is over the decades: for the first band (followed if it moves), year by year, how
// often people are short of food, how the day is split between food, wood, crafts and rest, how far the
// fellers walk for a tree, the timber and deer left near home, and whether the winter was rationed.
// Usage: npx tsx tools/settled.ts [--seeds 1,2,3] [--years 30] [--json]   (one JSON line per seed-year)
//        npx tsx tools/settled.ts --merge a.jsonl b.jsonl ...               (the table, from saved runs)
import { readFileSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim, hyp } from '../src/sim/sim';
import { TICKS_PER_YEAR, yearOf, isDark } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
type Row = { seed: number; y: number; short: number; food: number; garden: number; wood: number; craft: number; rest: number; walk: number; trees12: number; trees26: number; deer: number; rationed: number; pop: number; moved: number; knows: string[]; prov?: number; grain?: number };
const FOOD = new Set(['forage', 'hunt', 'fish', 'trap', 'preserve', 'roots', 'nuts', 'eggs', 'honey', 'mushrooms', 'eatwild']);
const GARDEN = new Set(['sow', 'tend', 'harvest']);
const WOOD = new Set(['fell', 'haul', 'deadwood', 'fuel']);
const CRAFT = new Set(['craft', 'mend', 'bed', 'reap', 'build', 'dig', 'quarry', 'gift']);
const REST = new Set(['idle', 'socialize', 'play', 'tell', 'listen', 'swim', 'feast', '']);

function run(seed: number, years: number): Row[] {
  const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
  let c = sim.camps[0];
  const rows: Row[] = [];
  const end = sim.tick + years * TICKS_PER_YEAR;
  let y = yearOf(sim.tick), moved = 0;
  let a = { n: 0, short: 0, work: 0, food: 0, garden: 0, wood: 0, craft: 0, rest: 0, walk: 0, walkN: 0, prov: 0, days: 0 };
  while (sim.tick < end) {
    sim.step();
    if (c.gone) {
      const next = sim.camps.find((o) => o.parent === c.id && o.origin === 'moved');
      if (!next) break;
      c = next;
      moved++;
    }
    if (yearOf(sim.tick) !== y) {
      const ms = sim.members(c);
      rows.push({
        seed, y, short: a.short / Math.max(1, a.n), food: a.food / Math.max(1, a.work), garden: a.garden / Math.max(1, a.work), wood: a.wood / Math.max(1, a.work),
        craft: a.craft / Math.max(1, a.work), rest: a.rest / Math.max(1, a.work), walk: a.walk / Math.max(1, a.walkN),
        trees12: (sim as unknown as { treesNear(c: unknown, r: number): number }).treesNear(c, 12), trees26: (sim as unknown as { treesNear(c: unknown, r: number): number }).treesNear(c, 26),
        deer: sim.deer.filter((d) => d.alive && hyp(d.x - c.x, d.z - c.z) < 16).length, rationed: c.rationedIn === y ? 1 : 0, pop: ms.length, moved, knows: c.knows.slice(), prov: a.prov / Math.max(1, a.days), grain: c.stock.grain,
      });
      y = yearOf(sim.tick);
      a = { n: 0, short: 0, work: 0, food: 0, garden: 0, wood: 0, craft: 0, rest: 0, walk: 0, walkN: 0, prov: 0, days: 0 };
    }
    if (sim.tick % 240 === 0) { a.days++; if ((c as { provided?: boolean }).provided) a.prov++; }
    if (sim.tick % 20) continue;
    for (const p of sim.members(c)) {
      if (sim.age(p) < 14) continue;
      a.n++;
      if (p.food < 35) a.short++;
      if (isDark(sim.tick)) continue;
      a.work++;
      const k = p.task?.kind ?? '';
      if (FOOD.has(k)) a.food++;
      else if (GARDEN.has(k)) a.garden++;
      else if (WOOD.has(k)) a.wood++;
      else if (CRAFT.has(k)) a.craft++;
      else if (REST.has(k)) a.rest++;
      if (k === 'fell' && p.task!.stage >= 0) { a.walk += hyp(p.task!.gx - c.x, p.task!.gz - c.z); a.walkN++; }
    }
  }
  return rows;
}

function table(rows: Row[]) {
  const spans = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 30], [31, 40]];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(7);
  const num = (v: number, d = 1) => v.toFixed(d).padStart(6);
  console.log('years   short  food  garden   wood  craft   rest   walk  trees12 trees26  deer  rationed  people  moved  provided  grain  garden/grain/coppice');
  for (const [lo, hi] of spans) {
    const rs = rows.filter((r) => r.y >= lo && r.y <= hi);
    if (!rs.length) continue;
    const m = (f: (r: Row) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
    const seeds = new Set(rs.map((r) => r.seed)).size;
    const knew = (k: string) => new Set(rs.filter((r) => r.knows.includes(k)).map((r) => r.seed)).size;
    console.log(`${String(lo).padStart(2)}-${String(hi).padEnd(4)}${pct(m((r) => r.short))}${pct(m((r) => r.food))}${pct(m((r) => r.garden))}${pct(m((r) => r.wood))}${pct(m((r) => r.craft))}${pct(m((r) => r.rest))}${num(m((r) => r.walk))}${num(m((r) => r.trees12), 0).padStart(9)}${num(m((r) => r.trees26), 0).padStart(8)}${num(m((r) => r.deer))}${`${rs.reduce((s, r) => s + r.rationed, 0)}/${rs.length}`.padStart(10)}${num(m((r) => r.pop)).padStart(8)}${String(Math.max(...rs.map((r) => r.moved))).padStart(7)}${pct(m((r) => r.prov ?? 0)).padStart(10)}${num(m((r) => r.grain ?? 0), 0).padStart(7)}  ${knew('garden')}/${knew('grain')}/${knew('coppice')} of ${seeds}`);
  }
}

if (args[0] === '--merge') {
  table(args.slice(1).flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)));
} else {
  const seeds = get('--seeds', '1,2,3,4').split(',').map(Number);
  const years = Number(get('--years', '30'));
  const rows = seeds.flatMap((s) => run(s, years));
  if (args.includes('--json')) for (const r of rows) console.log(JSON.stringify(r));
  else table(rows);
}
