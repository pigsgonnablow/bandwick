// Day-by-day view of one winter: stores, fire, warmth, temperature and what adults are doing.
// Usage: npx tsx tools/wintertrace.ts <seed> <year>
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR, TICKS_PER_SEASON, yearOf, hourOf } from '../src/sim/time';
import { foodTotal, BUILD } from '../src/sim/band';
const seed = Number(process.argv[2] ?? 21), year = Number(process.argv[3] ?? 12);
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
const from = (year - 1) * TICKS_PER_YEAR + 2.7 * TICKS_PER_SEASON, to = year * TICKS_PER_YEAR + 0.3 * TICKS_PER_SEASON;
let ev = sim.events.length;
while (sim.tick < to) {
  sim.step();
  if (sim.tick < from) { ev = sim.events.length; continue; }
  if (sim.tick % (TICKS_PER_DAY / 2) === 0) {
    const L = sim.living();
    const adults = L.filter((p) => sim.age(p) >= 14);
    const tasks: Record<string, number> = {};
    for (const p of adults) tasks[p.task?.kind ?? '-'] = (tasks[p.task?.kind ?? '-'] ?? 0) + 1;
    const homeless = L.filter((p) => p.home < 0).map((p) => p.name).join(',');
    const homes = sim.buildings.filter((b) => b.built && BUILD[b.kind].shelter > 0).length;
    console.log(`y${yearOf(sim.tick)} h${hourOf(sim.tick).toFixed(0).padStart(2)} temp ${sim.summary().temp.toFixed(0).padStart(3)} pop ${L.length} food ${foodTotal(sim.camp.stock).toFixed(0)} wood ${sim.camp.stock.wood.toFixed(1)} fire ${sim.hearth().fuel.toFixed(1)} homes ${homes} | warmth min ${Math.min(...L.map((p) => p.warmth)).toFixed(0)} avg ${(L.reduce((a, p) => a + p.warmth, 0) / L.length).toFixed(0)} hp min ${Math.min(...L.map((p) => p.health)).toFixed(0)} | ${JSON.stringify(tasks)}${homeless ? ' | no home: ' + homeless : ''}`);
    for (const e of sim.events.slice(ev)) console.log('   >>', e.text);
    ev = sim.events.length;
  }
}
