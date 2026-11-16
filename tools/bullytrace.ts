// How often the same person mocks the same victim (peak count in any window, a year by default) and what came of it.
// Usage: npx tsx tools/bullytrace.ts --seed 1 [--years 30] [--w ticks]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR } from '../src/sim/time';
const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '1')), years = Number(get('--years', '30'));
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const log: [number, number, number][] = [];
const rem = sim.remember.bind(sim);
sim.remember = (p, kind, w, y, subj, text) => { if (kind === 'insulted') log.push([sim.tick, subj, p.id]); return rem(p, kind, w, y, subj, text); };
const end = sim.tick + years * TICKS_PER_YEAR;
while (sim.tick < end) sim.step();
const W = Number(get("--w", String(TICKS_PER_YEAR)));
const peaks = new Map<string, number>();
for (let i = 0; i < log.length; i++) {
  const [t, a, b] = log[i];
  let n = 0;
  for (let j = i; j < log.length && log[j][0] - t < W; j++) if (log[j][1] === a && log[j][2] === b) n++;
  const k = `${a}>${b}`;
  peaks.set(k, Math.max(peaks.get(k) ?? 0, n));
}
const hist: Record<number, number> = {};
for (const v of peaks.values()) hist[v] = (hist[v] ?? 0) + 1;
const ev: Record<string, number> = {};
for (const e of sim.events) if (['bully_defend','bully_snap','bully_shun','bully_flee','exile','fight','split'].includes(e.kind)) ev[e.kind] = (ev[e.kind] ?? 0) + 1;
console.log(JSON.stringify({ seed, mockings: log.length, pairs: peaks.size, peakPerWindow: hist, events: ev, pop: sim.living().length }));
for (const e of sim.events) if (e.kind.startsWith('bully_') || (e.kind === 'exile' && e.text.includes('torment'))) console.log('  y' + Math.floor(e.tick / TICKS_PER_YEAR), e.text);
