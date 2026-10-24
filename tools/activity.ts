import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR, yearOf, isDark } from '../src/sim/time';
const seed = Number(process.argv[2] ?? 6);
const years = Number(process.argv[3] ?? 4);
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
const day: Record<string, number> = {}, night: Record<string, number> = {};
const end = sim.tick + years * TICKS_PER_YEAR;
while (sim.tick < end) {
  sim.step();
  if (sim.tick % 5) continue;
  const h = isDark(sim.tick) ? night : day;
  for (const p of sim.people) if (p.alive && sim.age(p) >= 14) { const k = p.task?.kind ?? 'none'; h[k] = (h[k] ?? 0) + 1; }
}
const show = (o: Record<string, number>) => { const t = Object.values(o).reduce((a, b) => a + b, 0); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / t * 100).toFixed(0)}%`).join(', '); };
console.log('DAY  ', show(day));
console.log('NIGHT', show(night));
for (const e of sim.events) console.log(`  y${yearOf(e.tick)} [${e.weight}] ${e.text}`);
