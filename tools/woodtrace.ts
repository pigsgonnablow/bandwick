import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim, isTreeType, treeStage, hyp } from '../src/sim/sim';
import { TICKS_PER_YEAR, yearOf } from '../src/sim/time';
const seed = Number(process.argv[2] ?? 3);
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
const tasks: Record<string, number> = {};
let felled0 = 0, woodIn = 0;
let lastY = yearOf(sim.tick);
while (sim.tick < 21 * TICKS_PER_YEAR) {
  const before = sim.camp.stock.wood;
  sim.step();
  const after = sim.camp.stock.wood;
  if (after > before) woodIn += after - before;
  if (sim.tick % 10 === 0) for (const p of sim.living()) if (sim.age(p) >= 14) { const k = p.task?.kind ?? '-'; tasks[k] = (tasks[k] ?? 0) + 1; }
  const y = yearOf(sim.tick);
  if (y !== lastY) {
    let near = 0, mid = 0, young = 0;
    for (let k = 0; k < sim.propCount; k++) {
      if (!sim.propAlive[k] || !isTreeType(sim.propType[k])) continue;
      const d = hyp(sim.propX[k] - sim.camp.x, sim.propZ[k] - sim.camp.z);
      if (treeStage(sim.propType[k]) >= 2) { if (d < 26) near++; else if (d < 48) mid++; } else if (d < 30) young++;
    }
    const tot = Object.values(tasks).reduce((a, b) => a + b, 0);
    const top = Object.entries(tasks).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(0)}%`).join(' ');
    console.log(`y${lastY}: mature trees <26: ${near}, 26-48: ${mid}, young <30: ${young} | felled ${sim.stats.felled - felled0} wood in ${woodIn.toFixed(0)} | adult time: ${top}`);
    felled0 = sim.stats.felled; woodIn = 0;
    for (const k in tasks) delete tasks[k];
    lastY = y;
  }
}
