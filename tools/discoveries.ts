// When each band made each discovery: N seeds x Y years, the first band's day of discovery for each.
// Usage: npx tsx tools/discoveries.ts [--seeds 1,2,3] [--years 6]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { DISCOVERIES } from '../src/sim/know';
import { TICKS_PER_YEAR, TICKS_PER_DAY, DAYS_PER_YEAR, START_TICK } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seeds = get('--seeds', '1,2,3,4,5,6,7,8').split(',').map(Number);
const years = Number(get('--years', '6'));
const when = (t: number) => { const d = Math.floor((t - START_TICK) / TICKS_PER_DAY); return `y${Math.floor(d / DAYS_PER_YEAR) + 1}d${d % DAYS_PER_YEAR}`; };
const days: Record<string, number[]> = {};
for (const seed of seeds) {
  const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, size: 128, seed }));
  let first = sim.camps[0];
  const seen = new Set<string>();
  const out: string[] = [];
  const end = sim.tick + years * TICKS_PER_YEAR;
  while (sim.tick < end) {
    sim.step();
    for (const k of first.knows) if (!seen.has(k)) { seen.add(k); out.push(`${k} ${when(sim.tick)}`); (days[k] ??= []).push((sim.tick - START_TICK) / TICKS_PER_DAY); }
    // a band that moves on is the same people: follow them
    if (first.gone) { const next = sim.camps.find((c) => c.parent === first.id && c.origin === 'moved'); if (!next) break; first = next; }
  }
  const xp = Object.entries(first.practice).map(([k, v]) => `${k}=${Math.round(v)}`).join(' ');
  console.log(`seed ${seed}: ${out.join(', ')}${xp ? `  | still learning: ${xp}` : ''}  froze ${sim.stats.froze} pop ${sim.summary().pop}`);
}
for (const d of DISCOVERIES) {
  const v = (days[d.key] ?? []).sort((a, b) => a - b);
  console.log(`${d.key.padEnd(11)} found in ${v.length}/${seeds.length}, median day ${v.length ? Math.round(v[Math.floor(v.length / 2)]) : '-'}`);
}
