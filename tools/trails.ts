// How the footpaths come and go: run a world and print, every few days, how many tiles are faintly
// worn, how many are beaten paths, and a little map around the camp.
//   npx tsx tools/trails.ts [seed] [years]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_DAY, DAYS_PER_YEAR, seasonOf } from '../src/sim/time';

const seed = Number(process.argv[2] ?? 1);
const years = Number(process.argv[3] ?? 2);
const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
const N = s.N;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const end = s.tick + years * DAYS_PER_YEAR * TICKS_PER_DAY;
while (s.tick < end) {
  for (let k = 0; k < 6 * TICKS_PER_DAY; k++) s.step();
  let faint = 0, mid = 0, beaten = 0;
  for (const v of s.trails.level) if (v >= 230) beaten++; else if (v >= 90) mid++; else if (v > 0) faint++;
  console.log(`day ${Math.floor(s.tick / TICKS_PER_DAY)} ${SEASONS[seasonOf(s.tick)]}: ${s.living().length} people, worn ${faint} / ${mid} / ${beaten} (faint / trail / beaten)`);
}
const c = s.liveCamps()[0] ?? s.camp;
const R = 22;
const ch = ' .:-=+*#%@';
for (let z = Math.round(c.z) - R; z <= Math.round(c.z) + R; z++) {
  let line = '';
  for (let x = Math.round(c.x) - R; x <= Math.round(c.x) + R; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) { line += '  '; continue; }
    const v = s.trails.level[z * N + x];
    line += ch[Math.min(9, Math.ceil(v / 255 * 9))].repeat(2);
  }
  console.log(line);
}
