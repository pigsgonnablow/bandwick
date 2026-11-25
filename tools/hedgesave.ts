// Saves for looking at the thorn hedge in the real page: a band a few years on with a hedge laid round its camp, one
// save half way through laying it and one with it finished, on a summer's day. Load them with tools/hedgeshots.mjs.
// Usage: npx tsx tools/hedgesave.ts <outdir> [--seed 4471] [--years 3]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { BUILD } from '../src/sim/band';
import { completeBuilding } from '../src/sim/ai';
import { TICKS_PER_YEAR, seasonOf, hourOf } from '../src/sim/time';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots';
const get = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const seed = Number(get('--seed', '4471')), years = Number(get('--years', '3'));
mkdirSync(out, { recursive: true });
const s = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size: 128 }));
// on to the summer, a few years in
const end = s.tick - (s.tick % TICKS_PER_YEAR) + years * TICKS_PER_YEAR;
while (s.tick < end) s.step();
while (seasonOf(s.tick) !== 1) s.step();
const c = s.camp;
for (const k of ['huts', 'hedge']) if (!c.knows.includes(k)) c.knows.push(k);
c.stock.wood += 60;
while (!s.buildings.some((b) => b.band === c.id && b.kind === 'hedge')) s.step();
const hedge = s.buildings.find((b) => b.band === c.id && b.kind === 'hedge')!;
// half laid, by day
hedge.wood = BUILD.hedge.wood;
hedge.cordage = BUILD.hedge.cordage;
hedge.work = BUILD.hedge.work * 0.55;
while (hourOf(s.tick) < 11 || hourOf(s.tick) > 12) s.step();
hedge.work = Math.max(hedge.work, BUILD.hedge.work * 0.55);
writeFileSync(`${out}/hedge-half.json`, JSON.stringify(s.serialize()));
completeBuilding(s, hedge, s.members(c)[0]);
for (let k = 0; k < 30; k++) s.step();
while (hourOf(s.tick) < 11 || hourOf(s.tick) > 12) s.step();
console.log('hedge at', hedge.x, hedge.z, 'ring', hedge.ring?.length, 'reach', hedge.reach?.toFixed(1), 'season', seasonOf(s.tick));
writeFileSync(`${out}/hedge-done.json`, JSON.stringify(s.serialize()));
