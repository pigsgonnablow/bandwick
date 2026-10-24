// Runs a world to a given tick in Node and prints the history hash (compare with tools/determinism.mjs).
// Usage: npx tsx tools/histhash.ts <seed> <tick> [size]
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
const [seed, tick, size] = [Number(process.argv[2] ?? 4471), Number(process.argv[3]), Number(process.argv[4] ?? 128)];
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, seed, size }));
while (sim.tick < tick) sim.step();
console.log(JSON.stringify({ tick: sim.tick, hash: sim.historyHash() }));
