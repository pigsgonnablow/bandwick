// Per-tick movement of every person: distance walked, net displacement and direction reversals
// (a reversal = walking back the way they just came, the signature of indecision).
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed: Number(process.argv[2] ?? 4471) }));
const ticks = Number(process.argv[3] ?? 2400);
const st = new Map<number, { walked: number; rev: number; moves: number; px: number; pz: number; dx: number; dz: number; tasks: string[] }>();
for (let t = 0; t < ticks; t++) {
  sim.step();
  for (const p of sim.people) {
    if (!p.alive || sim.age(p) < 2) continue;
    let s = st.get(p.id);
    if (!s) { s = { walked: 0, rev: 0, moves: 0, px: p.x, pz: p.z, dx: 0, dz: 0, tasks: [] }; st.set(p.id, s); }
    const dx = p.x - s.px, dz = p.z - s.pz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      s.walked += d;
      s.moves++;
      if (s.dx * dx + s.dz * dz < -0.5 * Math.hypot(s.dx, s.dz) * d) s.rev++;
      s.dx = dx; s.dz = dz;
    }
    s.px = p.x; s.pz = p.z;
    const k = p.task?.kind ?? '-';
    if (s.tasks[s.tasks.length - 1] !== k) s.tasks.push(k);
  }
}
for (const [id, s] of st) {
  const p = sim.byId.get(id)!;
  console.log(`${p.name.padEnd(10)} walked ${s.walked.toFixed(0).padStart(4)} tiles in ${s.moves} moving ticks, reversals ${s.rev} (${(100 * s.rev / Math.max(1, s.moves)).toFixed(1)}%), task changes ${s.tasks.length}`);
}
