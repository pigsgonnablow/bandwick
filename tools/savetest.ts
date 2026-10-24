// Saves a running world at awkward moments, reloads it into a fresh simulation, and runs both
// side by side: their histories must match exactly, tick for tick. Also reports save sizes.
// Usage: npx tsx tools/savetest.ts [--seeds 3,7,21] [--at 2,9,31] [--after 3]
import { gzipSync } from 'node:zlib';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim, SaveData } from '../src/sim/sim';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../src/sim/time';

const args = process.argv.slice(2);
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seeds = get('--seeds', '3,7,21').split(',').map(Number);
const atYears = get('--at', '2,9,31').split(',').map(Number);
const after = Number(get('--after', '3'));
let failures = 0;
for (const seed of seeds) {
  const a = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed }));
  for (const y of atYears) {
    // an odd tick, so people are mid-walk and mid-task
    const at = y * TICKS_PER_YEAR + 137;
    while (a.tick < at) a.step();
    if (!a.living().length) { console.log(`seed ${seed}: band gone before year ${y}`); break; }
    const json = JSON.stringify(a.serialize());
    const save = JSON.parse(json) as SaveData;
    const b = new Sim(generateWorld(save.params), save);
    let diverged = -1;
    if (a.historyHash() !== b.historyHash()) diverged = a.tick;
    const end = a.tick + after * TICKS_PER_YEAR;
    while (a.tick < end && diverged < 0) {
      a.step();
      b.step();
      if (a.tick % TICKS_PER_DAY === 0 && a.historyHash() !== b.historyHash()) diverged = a.tick;
    }
    // the chronicle's records must carry over too
    if (diverged < 0 && JSON.stringify(a.history) !== JSON.stringify(b.history)) diverged = -2;
    const gz = gzipSync(Buffer.from(json)).length;
    const ok = diverged === -1;
    if (!ok) failures++;
    console.log(`seed ${seed} saved in year ${y + 1} (pop ${a.living().length}, ${a.people.length} ever, ${a.events.length} events): ` +
      `${(json.length / 1024).toFixed(0)} KB raw, ${(gz / 1024).toFixed(0)} KB gzipped · ` + (ok ? `identical for ${after} more years, ${b.history.length} history samples` : diverged === -2 ? 'HISTORY DIFFERS' : `DIVERGED at tick ${diverged}`));
  }
}
console.log(failures ? `\n${failures} FAILED` : '\nAll saves continue identically.');
