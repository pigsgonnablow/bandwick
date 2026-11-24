// Saves for looking at a footbridge in the real page: a band a few years on that has bridged the ford it wades most,
// one save with the bridge half laid and one with it finished and people crossing it. Load them with
// tools/bridgeshots.mjs.
// Usage: npx tsx tools/bridgesave.ts <outdir> [--seed 4471] [--years 2]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { BUILD } from '../src/sim/band';
import { completeBuilding } from '../src/sim/ai';
import { TICKS_PER_YEAR, hourOf, seasonOf } from '../src/sim/time';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots';
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '4471')), years = Number(get('--years', '2'));
mkdirSync(out, { recursive: true });
const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
const end = s.tick - (s.tick % TICKS_PER_YEAR) + years * TICKS_PER_YEAR;
while (s.tick < end) s.step();
while (seasonOf(s.tick) !== 1) s.step();
const c = s.camp;
for (const k of ['axe', 'bridge']) if (!c.knows.includes(k)) c.knows.push(k);
c.stock.wood += 60;
while (!s.buildings.some((b) => b.band === c.id && b.kind === 'bridge')) s.step();
const bridge = s.buildings.find((b) => b.band === c.id && b.kind === 'bridge')!;
bridge.wood = BUILD.bridge.wood;
bridge.cordage = BUILD.bridge.cordage;
while (hourOf(s.tick) < 11 || hourOf(s.tick) > 12) s.step();
if (!bridge.built) bridge.work = Math.max(bridge.work, BUILD.bridge.work * 0.5);
writeFileSync(`${out}/bridge-half.json`, JSON.stringify(s.serialize()));
if (!bridge.built) completeBuilding(s, bridge, s.members(c)[0]);
// on until someone is out on it
for (let k = 0; k < 3000; k++) {
  s.step();
  if (hourOf(s.tick) > 9 && hourOf(s.tick) < 17 && s.people.some((p) => p.alive && bridge.span!.includes(s.tileOf(p)))) break;
}
console.log('bridge at', bridge.x, bridge.z, 'span', bridge.span, 'rot', bridge.rot, 'on it', s.people.filter((p) => p.alive && bridge.span!.includes(s.tileOf(p))).map((p) => p.name), 'hour', hourOf(s.tick).toFixed(1));
writeFileSync(`${out}/bridge-done.json`, JSON.stringify(s.serialize()));
