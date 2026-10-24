// Headless world-generation check: timing, determinism, stats, and a top-down preview image.
// Usage: npx tsx tools/gentest.ts [seed...] [--size 256] [--out dir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS, WATER } from '../src/sim/types';

const args = process.argv.slice(2);
let size = DEFAULT_PARAMS.size;
let out = 'out';
const seeds: number[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') size = Number(args[++i]);
  else if (args[i] === '--out') out = args[++i];
  else seeds.push(Number(args[i]));
}
if (!seeds.length) seeds.push(1, 2, 3);
mkdirSync(out, { recursive: true });

for (const seed of seeds) {
  const params = { ...DEFAULT_PARAMS, size, seed };
  const a = generateWorld(params);
  const b = generateWorld(params);
  const same = a.hash === b.hash;
  console.log(
    JSON.stringify({ seed, size, ms: Math.round(a.genMs), ms2: Math.round(b.genMs), hash: a.hash, deterministic: same, ...a.stats }),
  );
  // top-down preview: ground colour, tinted where water lies, as raw RGB for a PNG converter
  const S = a.texSize, tpt = S / size;
  const rgb = Buffer.alloc(S * S * 3);
  for (let v = 0; v < S; v++)
    for (let u = 0; u < S; u++) {
      const o = (v * S + u) * 4, q = (v * S + u) * 3;
      const ti = Math.floor(v / tpt) * size + Math.floor(u / tpt);
      let r = a.colorTex[o], g = a.colorTex[o + 1], bl = a.colorTex[o + 2];
      const w = a.water[ti];
      if (w !== WATER.None) {
        const depth = a.waterY[ti] - a.groundY[ti];
        const k = Math.min(0.85, 0.45 + depth * 0.3);
        r = r * (1 - k) + 40 * k; g = g * (1 - k) + 120 * k; bl = bl * (1 - k) + 170 * k;
      }
      // shade by level so terraces read
      const sh = 0.75 + a.level[ti] / 60;
      rgb[q] = Math.min(255, r * sh); rgb[q + 1] = Math.min(255, g * sh); rgb[q + 2] = Math.min(255, bl * sh);
    }
  // props as dots
  for (let k = 0; k < a.propCount; k++) {
    const t = a.propType[k];
    if (t >= 36) continue; // trees only
    const u = Math.floor(a.propPos[k * 3] * tpt), v = Math.floor(a.propPos[k * 3 + 2] * tpt);
    const q = (v * S + u) * 3;
    rgb[q] = 30; rgb[q + 1] = 70; rgb[q + 2] = 30;
  }
  writeFileSync(`${out}/seed${seed}_${size}.rgb`, rgb);
  writeFileSync(`${out}/seed${seed}_${size}.json`, JSON.stringify({ S }));
}
