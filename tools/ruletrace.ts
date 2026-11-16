// Rulers over a run: who took hold of which band and when, who succeeded them, who was thrown off, and how ruled
// bands fared next to loose ones (band-years, monuments finished, splits, stone walls).
// Usage: npx tsx tools/ruletrace.ts --seed 1 [--years 40] [--quiet]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR, TICKS_PER_DAY } from '../src/sim/time';
import { isMonument } from '../src/sim/band';
import { standing } from '../src/sim/rule';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '1')), years = Number(get('--years', '40'));
const quiet = args.includes('--quiet');
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const log: string[] = [];
const kinds: Record<string, number> = {};
const ev = sim.event.bind(sim);
sim.event = (kind, text, people, x, z, w) => {
  const y = Math.floor(sim.tick / TICKS_PER_YEAR);
  if (kind === 'rule' || kind === 'rule_end') log.push(`  y${y} ${text}`);
  if (kind === 'monument') log.push(`  y${y} ${text}${sim.camp.rule ? ' (ruled)' : ''}`);
  kinds[kind] = (kinds[kind] ?? 0) + 1;
  return ev(kind, text, people, x, z, w);
};
const end = sim.tick + years * TICKS_PER_YEAR;
let ruledDays = 0, looseDays = 0;
const standings: number[] = [], strains: number[] = [];
while (sim.tick < end) {
  sim.step();
  if (sim.tick % TICKS_PER_DAY === 0) {
    for (const c of sim.liveCamps()) {
      if (c.rule) {
        ruledDays++;
        const p = sim.byId.get(c.rule.ruler);
        if (p?.alive && sim.tick % (TICKS_PER_DAY * 12) === 0) { standings.push(Math.round(standing(sim, c, p))); strains.push(Math.round(c.rule.strain ?? 0)); }
      } else looseDays++;
    }
  }
}
const D = 48;
const huts = sim.buildings.filter((b) => (b.kind === 'hut' || b.kind === 'storehouse') && b.built);
const ruledNow = sim.liveCamps().filter((c) => c.rule).length;
console.log(JSON.stringify({
  seed, pop: sim.living().length, bands: sim.liveCamps().length, ruledNow,
  ruledBandYears: +(ruledDays / D).toFixed(1), looseBandYears: +(looseDays / D).toFixed(1),
  rises: log.filter((l) => l.includes('took hold')).length, successions: log.filter((l) => l.includes('took up the rule')).length,
  lapses: log.filter((l) => l.includes('loose ways') && l.includes('nobody')).length, overthrows: log.filter((l) => l.includes('no longer')).length,
  monuments: sim.buildings.filter((b) => isMonument(b.kind) && b.built).length, splits: kinds.split ?? 0,
  stoneHuts: huts.filter((b) => b.walls === 'stone').length, huts: huts.length,
  strain: strains.length ? { mean: Math.round(strains.reduce((a, b) => a + b, 0) / strains.length), max: Math.max(...strains), over30: strains.filter((v) => v >= 30).length + '/' + strains.length } : null,
  standing: standings.length ? { min: Math.min(...standings), mean: Math.round(standings.reduce((a, b) => a + b, 0) / standings.length), max: Math.max(...standings) } : null,
}));
if (!quiet) for (const l of log) console.log(l);
