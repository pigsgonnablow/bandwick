// World generation: seeded, deterministic, and free of browser-dependent math.
// Pipeline: height -> erosion -> terraces -> ocean -> drainage (lakes, rivers)
// -> climate -> terrain types -> resources -> props -> painted ground textures.

import { Rng, hash3, hash01 } from './rng';
import { Simplex } from './noise';
import {
  T, WATER, STEP, SEA, SNOW_LEVEL, LEVELS, surfaceY, SEA_SURFACE,
  WorldParams, WorldData, DIRS4, treeId, smallPropId,
} from './types';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function generateWorld(p: WorldParams): WorldData {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const N = p.size;
  const NN = N * N;
  const S = (name: string) => new Simplex(Rng.stream(p.seed, name));
  const nHeight = S('height'), nWarpX = S('warpx'), nWarpY = S('warpy'), nCoast = S('coast');
  const nRidge = S('ridge'), nRange = S('range'), nMoist = S('moist'), nTemp = S('temp');
  const nRock = S('rock'), nForest = S('forest'), nOre = S('ore'), nDetail = S('detail');
  const F = 1 / 128; // features are sized in tiles, so bigger maps show more land, not bigger land

  // ---------- 1. Raw height ----------
  const h = new Float32Array(NN);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = x * F, fy = y * F;
      const wx = fx + 0.32 * nWarpX.fbm(fx * 1.4, fy * 1.4, 3);
      const wy = fy + 0.32 * nWarpY.fbm(fx * 1.4, fy * 1.4, 3);
      const base = nHeight.fbm(wx * 2.3, wy * 2.3, 6) * 0.5 + 0.5;
      const ridge = nRidge.ridged(wx * 3.1, wy * 3.1, 5);
      const range = smooth(-0.1, 0.4, nRange.fbm(fx * 1.25 + 7.3, fy * 1.25 - 2.1, 3));
      const nx = x / (N - 1) - 0.5, ny = y / (N - 1) - 0.5;
      const d = Math.sqrt(nx * nx + ny * ny) * 2;
      // a noisy falloff sinks the map edges; the interior shape comes from the noise,
      // so coastlines get bays, capes and the odd islet
      const cn = nCoast.fbm(fx * 1.8, fy * 1.8, 4) * 0.34;
      const v = base * 0.6 + ridge * range * 0.68 * p.mountains;
      h[y * N + x] = v - 0.95 * smooth(0.3 + cn, 1.02 + cn * 0.6, d);
    }
  }

  // ---------- 2. Hydraulic erosion (droplets) ----------
  erode(h, N, Rng.stream(p.seed, 'erosion'), Math.floor(NN * 0.55));
  // soften small bumps so terraces follow the big landforms, not the noise
  blur(h, N, 2);

  // ---------- 3. Land, sea and terraces ----------
  const sorted = Float32Array.from(h).sort();
  const seaT = sorted[Math.floor((1 - p.landFraction) * (NN - 1))];
  const hMax = sorted[NN - 1];
  const level = new Uint8Array(NN);
  const landLevels = LEVELS - 1 - SEA; // 11
  const isLandRaw = new Uint8Array(NN);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
      const v = h[i];
      if (v > seaT && edge >= 3) {
        isLandRaw[i] = 1;
        const r = (v - seaT) / (hMax - seaT);
        level[i] = Math.min(LEVELS - 1, SEA + 1 + Math.floor(r * Math.sqrt(r) * 1.02 * landLevels));
      } else level[i] = SEA - 1;
    }
  despeckleLand(level, isLandRaw, N);
  // sink specks of land too small to matter (islets under 8 tiles)
  {
    const comp = new Int32Array(NN).fill(-1);
    for (let i = 0; i < NN; i++) {
      if (!isLandRaw[i] || comp[i] >= 0) continue;
      const cells = [i];
      comp[i] = i;
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        const x = c % N, y = (c / N) | 0;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (isLandRaw[j] && comp[j] < 0) {
            comp[j] = i;
            cells.push(j);
          }
        }
      }
      if (cells.length < 8)
        for (const c of cells) {
          isLandRaw[c] = 0;
          level[c] = SEA - 1;
        }
    }
  }

  // ---------- 4. Ocean: everything below sea level that reaches the map edge ----------
  const water = new Uint8Array(NN);
  const waterY = new Float32Array(NN).fill(-1000);
  {
    const q: number[] = [];
    for (let i = 0; i < NN; i++) {
      const x = i % N, y = (i / N) | 0;
      if ((x === 0 || y === 0 || x === N - 1 || y === N - 1) && !isLandRaw[i]) {
        water[i] = WATER.Sea;
        q.push(i);
      }
    }
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      const x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (water[j] === WATER.None && !isLandRaw[j]) {
          water[j] = WATER.Sea;
          q.push(j);
        }
      }
    }
    // low ground cut off from the sea becomes a lake basin
    for (let i = 0; i < NN; i++)
      if (!isLandRaw[i] && water[i] === WATER.None) {
        water[i] = WATER.Lake;
        level[i] = SEA;
        waterY[i] = surfaceY(SEA + 1);
      }
  }
  // Bathymetry: a shallow shelf hugging the coast, deepening offshore.
  {
    const landDist = bfsDistance(N, (i) => water[i] !== WATER.Sea);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (water[i] !== WATER.Sea) continue;
        const jitter = (nDetail.noise(x * F * 6, y * F * 6) * 0.5 + 0.5) * 2.2;
        const drop = Math.floor((landDist[i] - 1 + jitter) / 2.6);
        level[i] = Math.max(0, SEA - drop);
        waterY[i] = SEA_SURFACE;
      }
  }

  // ---------- 5. Drainage over the smooth heightfield (natural, meandering paths) ----------
  const receiver = new Int32Array(NN).fill(-1);
  const order: number[] = [];
  {
    const fill = new Float64Array(NN);
    const seen = new Uint8Array(NN);
    const heap = new MinHeap(NN);
    for (let i = 0; i < NN; i++)
      if (water[i] === WATER.Sea) {
        seen[i] = 1;
        fill[i] = h[i];
        const x = i % N, y = (i / N) | 0;
        let coast = false;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N && water[ny * N + nx] !== WATER.Sea) coast = true;
        }
        if (coast) heap.push(fill[i], i);
      }
    while (heap.size) {
      const i = heap.pop();
      order.push(i);
      const x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        // a little high-frequency jitter makes rivers meander on smooth slopes
        const hj = h[j] + nDetail.noise(nx * 0.31 + 3.7, ny * 0.31 - 8.1) * 0.012;
        fill[j] = Math.max(hj, fill[i] + 1e-7);
        receiver[j] = i;
        heap.push(fill[j], j);
      }
    }
  }

  // ---------- 6. Rain and flow accumulation ----------
  const rain = new Float32Array(NN);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) rain[y * N + x] = 0.55 + 0.45 * (nMoist.fbm(x * F * 2, y * F * 2, 4) * 0.5 + 0.5);
  const acc = Float32Array.from(rain);
  for (let k = order.length - 1; k >= 0; k--) {
    const r = receiver[order[k]];
    if (r >= 0) acc[r] += acc[order[k]];
  }
  let landCells = 0;
  for (let i = 0; i < NN; i++) if (water[i] === WATER.None) landCells++;
  const riverT = Math.max(28, landCells * 0.01);

  // ---------- 7. Rivers: mark, then carve so water never climbs a terrace ----------
  const flow = new Int8Array(NN).fill(-1);
  const dirTo = (i: number, j: number) => {
    const d = j - i;
    return d === -N ? 0 : d === 1 ? 1 : d === N ? 2 : 3;
  };
  const isRiver = new Uint8Array(NN);
  for (let i = 0; i < NN; i++) {
    if (water[i] !== WATER.None || acc[i] < riverT || receiver[i] < 0) continue;
    isRiver[i] = 1;
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (!isRiver[i]) continue;
    const r = receiver[i];
    if (water[r] !== WATER.Sea && level[r] > level[i]) level[r] = level[i];
  }
  const riverMain: number[] = [];
  for (let i = 0; i < NN; i++)
    if (isRiver[i]) {
      water[i] = WATER.River;
      flow[i] = dirTo(i, receiver[i]);
      riverMain.push(i);
    }

  // ---------- 8. Lakes: rivers pool where they cross a broad, flat terrace ----------
  let lakeCount = 0;
  const lakeTarget = 1 + Math.floor(hash01(p.seed, 5, 5) * 2.2) + Math.floor((N * N) / (160 * 160));
  {
    const candidates = riverMain
      .filter((i) => acc[i] > riverT * 1.4 && acc[i] < riverT * 9 && level[i] >= SEA + 2)
      .sort((a, b) => hash3(a, p.seed, 91) - hash3(b, p.seed, 91));
    const centers: number[] = [];
    for (const c of candidates) {
      if (lakeCount >= lakeTarget) break;
      const cx = c % N, cy = (c / N) | 0;
      if (centers.some((o) => Math.abs((o % N) - cx) + Math.abs(((o / N) | 0) - cy) < 22)) continue;
      const L = level[c];
      const radius = 4 + (hash3(c, p.seed, 3) % 4);
      const cells = [c];
      const inLake = new Set<number>([c]);
      for (let k = 0; k < cells.length && cells.length < 60; k++) {
        const i = cells[k];
        const x = i % N, y = (i / N) | 0;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 2 || ny < 2 || nx >= N - 2 || ny >= N - 2) continue;
          const j = ny * N + nx;
          if (inLake.has(j) || level[j] !== L) continue;
          if (water[j] !== WATER.None && water[j] !== WATER.River) continue;
          const ddx = nx - cx, ddy = ny - cy;
          const wob = nDetail.noise(nx * 0.35 + 17, ny * 0.35) * 0.35 + 1;
          if (ddx * ddx + ddy * ddy > radius * radius * wob * wob) continue;
          inLake.add(j);
          cells.push(j);
        }
      }
      if (cells.length < 10) continue;
      // never let a lake touch the sea or sit beside lower ground (it would spill)
      let ok = true;
      for (const i of cells) {
        const x = i % N, y = (i / N) | 0;
        for (const [dx, dy] of DIRS4) {
          const j = (y + dy) * N + x + dx;
          if (inLake.has(j)) continue;
          if (water[j] === WATER.Sea || (level[j] < L && water[j] !== WATER.River)) ok = false;
        }
      }
      if (!ok) continue;
      centers.push(c);
      lakeCount++;
      for (const i of cells) {
        const x = i % N, y = (i / N) | 0;
        let interior = true;
        for (const [dx, dy] of DIRS4) if (!inLake.has((y + dy) * N + x + dx)) interior = false;
        water[i] = WATER.Lake;
        flow[i] = -1;
        level[i] = L - (interior ? 2 : 1);
        waterY[i] = surfaceY(L);
      }
    }
  }

  // ---------- 9. Widen big rivers, set beds and surfaces ----------
  for (const i of riverMain) {
    if (water[i] !== WATER.River) continue;
    const width = acc[i] >= riverT * 14 ? 2 : acc[i] >= riverT * 5 ? 1 : 0;
    if (!width) continue;
    const x = i % N, y = (i / N) | 0;
    const f = flow[i];
    const sides = [(f + 1) & 3, (f + 3) & 3];
    for (let s = 0; s < width; s++) {
      const side = sides[(hash3(i, p.seed, 77) + s) & 1];
      const nx = x + DIRS4[side][0], ny = y + DIRS4[side][1];
      if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
      const j = ny * N + nx;
      if (water[j] === WATER.None && level[j] === level[i]) {
        water[j] = WATER.River;
        flow[j] = f;
      }
    }
  }
  // banks: dry ground beside a river never sits below the water it holds back
  for (let i = 0; i < NN; i++) {
    if (water[i] !== WATER.River) continue;
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (water[j] === WATER.None && level[j] < level[i]) level[j] = level[i];
    }
  }
  const groundY = new Float32Array(NN);
  for (let i = 0; i < NN; i++) groundY[i] = level[i] * STEP;
  let riverCells = 0;
  for (let i = 0; i < NN; i++) {
    if (water[i] !== WATER.River) continue;
    riverCells++;
    waterY[i] = surfaceY(level[i]);
    groundY[i] = (level[i] - (acc[i] >= riverT * 14 ? 1.7 : 0.85)) * STEP;
  }
  const seaDist = bfsDistance(N, (i) => water[i] === WATER.Sea);

  // ---------- 10. Terrain types ----------
  const moistDist = bfsDistance(N, (i) => water[i] === WATER.Lake || water[i] === WATER.River);
  const moisture = new Uint8Array(NN);
  const temperature = new Uint8Array(NN);
  const terrain = new Uint8Array(NN);
  const fertility = new Uint8Array(NN);
  const elev = (i: number) => clamp01((level[i] - (SEA + 1)) / (LEVELS - 1 - (SEA + 1)));
  const nearWater = (x: number, y: number, kind: (w: number) => boolean, r: number) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if (kind(water[ny * N + nx])) return true;
      }
    return false;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const fx = x * F, fy = y * F;
      const e = elev(i);
      const m = clamp01(
        rain[i] * 0.55 + 0.38 / (1 + moistDist[i] / 3) + 0.12 / (1 + seaDist[i] / 4) - e * 0.18 + 0.08,
      );
      const tmp = clamp01(0.78 - e * 0.72 - (0.5 - y / N) * 0.22 + 0.1 * nTemp.fbm(fx * 2, fy * 2, 3));
      moisture[i] = Math.round(m * 255);
      temperature[i] = Math.round(tmp * 255);

      if (water[i] !== WATER.None) {
        const depth = waterY[i] - groundY[i];
        terrain[i] = depth > 1.2 * STEP ? T.DeepWater : T.ShallowWater;
        continue;
      }
      let maxDiff = 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        maxDiff = Math.max(maxDiff, Math.abs(level[i] - level[ny * N + nx]));
      }
      const rock = nRock.fbm(fx * 4, fy * 4, 3);
      const lvl = level[i];
      if (lvl >= 12 || (lvl >= 10 && rock > 0.05) || (lvl >= 9 && maxDiff >= 3)) terrain[i] = T.Mountain;
      else if ((rock > 0.4 && e > 0.06) || (maxDiff >= 2 && e > 0.22 && rock > -0.1)) terrain[i] = T.Stone;
      else if (
        lvl === SEA + 1 &&
        (nearWater(x, y, (w) => w === WATER.Sea, 1) ||
          (nearWater(x, y, (w) => w === WATER.Sea, 2) && nDetail.noise(fx * 9, fy * 9) > 0.1) ||
          (nearWater(x, y, (w) => w === WATER.Lake, 1) && hash01(i, p.seed, 3) < 0.5))
      )
        terrain[i] = T.Sand;
      else {
        const forestiness = m * 0.95 + nForest.fbm(fx * 3.2, fy * 3.2, 4) * 0.55 - e * 0.3;
        terrain[i] = forestiness > 0.56 && tmp > 0.1 ? T.Forest : T.Grass;
      }
      if (terrain[i] === T.Grass || terrain[i] === T.Forest) {
        const riverside = moistDist[i] <= 2 ? 0.2 : 0;
        fertility[i] = Math.round(clamp01(m * 0.6 + (1 - e) * 0.3 + riverside - (terrain[i] === T.Forest ? 0.1 : 0)) * 255);
      }
    }
  }

  // ---------- 11. Resources ----------
  const stone = new Uint16Array(NN);
  const ore = new Uint8Array(NN);
  const clay = new Uint8Array(NN);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const fx = x * F, fy = y * F;
      const t = terrain[i];
      if (t === T.Stone || t === T.Mountain) {
        stone[i] = Math.round((t === T.Mountain ? 600 : 300) + hash01(i, p.seed, 11) * 600);
        if (nOre.noise(fx * 7, fy * 7) > 0.62) ore[i] = 1;
        else if (nOre.noise(fx * 7 + 40, fy * 7) > 0.74) ore[i] = 2;
        else if (nOre.noise(fx * 6 + 80, fy * 6) > (t === T.Mountain ? 0.55 : 0.68)) ore[i] = 3;
        else if (t === T.Mountain && nOre.noise(fx * 9 + 120, fy * 9) > 0.8) ore[i] = 4;
      }
      if (
        (t === T.Grass || t === T.Sand) &&
        level[i] <= SEA + 2 &&
        nearWater(x, y, (w) => w === WATER.River || w === WATER.Lake, 1) &&
        hash01(i, p.seed, 13) < 0.6
      )
        clay[i] = 1;
    }

  // ---------- 12. Props ----------
  const props = placeProps(p, N, terrain, water, level, groundY, moisture, temperature, nDetail);

  // ---------- 13. Painted ground ----------
  const texPerTile = N <= 128 ? 8 : 4;
  const { colorTex, maskTex } = paintGround(
    p, N, texPerTile, terrain, water, level, groundY, waterY, moisture, nDetail, nForest,
  );

  // ---------- Stats + hash ----------
  const stats: Record<string, number> = { lakes: lakeCount, riverTiles: riverCells, props: props.count };
  const counts = new Array(7).fill(0);
  for (let i = 0; i < NN; i++) counts[terrain[i]]++;
  ['deep', 'shallow', 'sand', 'grass', 'forest', 'stone', 'mountain'].forEach((k, ix) => (stats[k] = counts[ix]));

  const hash = fnvHex([level, terrain, water, props.type, new Uint8Array(props.pos.buffer)]);
  const genMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;

  return {
    params: p, size: N, level, groundY, terrain, water, waterY, flow, moisture, temperature, fertility,
    stone, ore, clay,
    propCount: props.count, propType: props.type, propPos: props.pos, propRot: props.rot,
    propScale: props.scale, propTile: props.tile,
    texSize: N * texPerTile, colorTex, maskTex, hash, genMs, stats,
  };
}

// ----------------------------------------------------------------------------

function erode(h: Float32Array, N: number, rng: Rng, droplets: number) {
  const inertia = 0.06, capacityK = 5, minCap = 0.002, erodeK = 0.35, depositK = 0.3;
  const evaporate = 0.03, gravity = 4, maxSteps = 36;
  const at = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const i = yi * N + xi;
    return h[i] * (1 - fx) * (1 - fy) + h[i + 1] * fx * (1 - fy) + h[i + N] * (1 - fx) * fy + h[i + N + 1] * fx * fy;
  };
  for (let d = 0; d < droplets; d++) {
    let x = rng.range(2, N - 3), y = rng.range(2, N - 3);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let s = 0; s < maxSteps; s++) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const i = yi * N + xi;
      const h00 = h[i], h10 = h[i + 1], h01 = h[i + N], h11 = h[i + N + 1];
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-10) break;
      dx /= len;
      dy /= len;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= N - 2 || ny >= N - 2) break;
      const dh = at(nx, ny) - hOld;
      const cap = Math.max(-dh * speed * water * capacityK, minCap);
      if (sediment > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositK;
        sediment -= amt;
        h[i] += amt * (1 - fx) * (1 - fy);
        h[i + 1] += amt * fx * (1 - fy);
        h[i + N] += amt * (1 - fx) * fy;
        h[i + N + 1] += amt * fx * fy;
      } else {
        const amt = Math.min((cap - sediment) * erodeK, -dh);
        h[i] -= amt * (1 - fx) * (1 - fy);
        h[i + 1] -= amt * fx * (1 - fy);
        h[i + N] -= amt * (1 - fx) * fy;
        h[i + N + 1] -= amt * fx * fy;
        sediment += amt;
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
      x = nx;
      y = ny;
    }
  }
}

/** Box blur (3x3), repeated. */
function blur(h: Float32Array, N: number, passes: number) {
  const tmp = new Float32Array(h.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            sum += h[ny * N + nx];
            n++;
          }
        tmp[y * N + x] = sum / n;
      }
    h.set(tmp);
  }
}

/** Remove single-tile spikes and pits on land so terraces read cleanly. */
function despeckleLand(level: Uint8Array, land: Uint8Array, N: number) {
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 1; y < N - 1; y++)
      for (let x = 1; x < N - 1; x++) {
        const i = y * N + x;
        if (!land[i]) continue;
        const a = land[i - 1] ? level[i - 1] : level[i], b = land[i + 1] ? level[i + 1] : level[i];
        const c = land[i - N] ? level[i - N] : level[i], d = land[i + N] ? level[i + N] : level[i];
        const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
        if (level[i] > hi) level[i] = Math.max(hi, SEA + 1);
        else if (level[i] < lo) level[i] = lo;
        else {
          // thin one-tile ridges or trenches
          let higher = 0, lower = 0;
          if (a < level[i]) lower++; else if (a > level[i]) higher++;
          if (b < level[i]) lower++; else if (b > level[i]) higher++;
          if (c < level[i]) lower++; else if (c > level[i]) higher++;
          if (d < level[i]) lower++; else if (d > level[i]) higher++;
          if (lower >= 3) level[i] = Math.max(lo, level[i] - 1, SEA + 1);
          else if (higher >= 3) level[i] = Math.min(hi, level[i] + 1);
        }
      }
  }
}

function bfsDistance(N: number, isSource: (i: number) => boolean): Uint16Array {
  const NN = N * N;
  const dist = new Uint16Array(NN).fill(65535);
  const q = new Int32Array(NN);
  let qh = 0, qt = 0;
  for (let i = 0; i < NN; i++)
    if (isSource(i)) {
      dist[i] = 0;
      q[qt++] = i;
    }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (dist[j] === 65535) {
        dist[j] = dist[i] + 1;
        q[qt++] = j;
      }
    }
  }
  return dist;
}

function placeProps(
  p: WorldParams, N: number, terrain: Uint8Array, water: Uint8Array, level: Uint8Array,
  groundY: Float32Array, moisture: Uint8Array, temperature: Uint8Array, nDetail: Simplex,
) {
  const type: number[] = [], pos: number[] = [], rot: number[] = [], scale: number[] = [], tile: number[] = [];
  const add = (id: number, tileIdx: number, x: number, z: number, r: Rng, sMin = 0.85, sMax = 1.15) => {
    type.push(id);
    pos.push(x, groundY[tileIdx], z);
    rot.push(r.next() * 6.283185307179586);
    scale.push(r.range(sMin, sMax));
    tile.push(tileIdx);
  };
  // Positions inside a tile are spread on a jittered 2x2 grid so trees don't stack.
  const slots = [[0.28, 0.28], [0.72, 0.3], [0.3, 0.72], [0.7, 0.7]];
  const isLand = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < N && y < N && water[y * N + x] === WATER.None;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const r = new Rng(hash3(p.seed, i, 0x9709));
      const t = terrain[i];
      const m = moisture[i] / 255, tmp = temperature[i] / 255;
      const lvl = level[i];
      const slotOrder = [0, 1, 2, 3];
      for (let k = 3; k > 0; k--) {
        const j = r.int(0, k + 1);
        [slotOrder[k], slotOrder[j]] = [slotOrder[j], slotOrder[k]];
      }
      let slotIx = 0;
      const nextSlot = (jit = 0.12) => {
        const s = slots[slotOrder[slotIx++ & 3]];
        return [x + s[0] + r.range(-jit, jit), y + s[1] + r.range(-jit, jit)];
      };
      const pickSpecies = () => {
        const pine = (1 - tmp) * 1.4 + (lvl >= 10 ? 0.8 : 0);
        const birch = m * 0.9 + (tmp > 0.35 && tmp < 0.7 ? 0.3 : 0);
        const oak = tmp * 1.1 + (m > 0.4 ? 0.2 : 0);
        const total = pine + birch + oak;
        const v = r.next() * total;
        return v < pine ? 0 : v < pine + oak ? 1 : 2;
      };
      const pickStage = (edge: boolean) => {
        const v = r.next();
        if (edge) return v < 0.2 ? 0 : v < 0.55 ? 1 : v < 0.92 ? 2 : 3;
        return v < 0.06 ? 0 : v < 0.2 ? 1 : v < 0.78 ? 2 : 3;
      };
      const tree = (edge: boolean, sp = pickSpecies()) => {
        const [px, pz] = nextSlot();
        add(treeId(sp, pickStage(edge), r.int(0, 3)), i, px, pz, r);
      };

      if (water[i] !== WATER.None) {
        // reeds in shallow, sheltered water next to land
        if (t === T.ShallowWater && tmp > 0.25) {
          const touchesLand = isLand(x - 1, y) || isLand(x + 1, y) || isLand(x, y - 1) || isLand(x, y + 1);
          const chance = water[i] === WATER.Sea ? 0.06 : 0.35;
          if (touchesLand && r.chance(chance)) {
            const [px, pz] = nextSlot(0.18);
            add(smallPropId('reeds', r.int(0, 3)), i, px, pz, r);
            if (r.chance(0.4)) {
              const [qx, qz] = nextSlot(0.18);
              add(smallPropId('reeds', r.int(0, 3)), i, qx, qz, r);
            }
          }
        }
        continue;
      }
      if (lvl >= SNOW_LEVEL) {
        if (r.chance(0.12)) {
          const [px, pz] = nextSlot();
          add(smallPropId('rock', r.int(0, 5)), i, px, pz, r, 0.7, 1.2);
        }
        continue;
      }
      switch (t) {
        case T.Forest: {
          let edge = false;
          for (const [dx, dy] of DIRS4) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < N && ny < N && terrain[ny * N + nx] !== T.Forest) edge = true;
          }
          const dense = m > 0.6 ? 0.35 : 0.15;
          const count = 1 + (r.chance(0.6) ? 1 : 0) + (r.chance(dense) ? 1 : 0);
          for (let k = 0; k < count; k++) tree(edge);
          if (r.chance(0.18)) {
            const [px, pz] = nextSlot(0.2);
            add(smallPropId(r.chance(0.25) ? 'berry' : 'bush', r.int(0, 3)), i, px, pz, r);
          }
          break;
        }
        case T.Grass: {
          if (r.chance(0.035)) tree(false, r.chance(0.7) ? 1 : pickSpecies());
          if (r.chance(0.05)) {
            const [px, pz] = nextSlot(0.2);
            add(smallPropId('bush', r.int(0, 3)), i, px, pz, r);
          }
          if (r.chance(0.012 + m * 0.03)) {
            const [px, pz] = nextSlot(0.2);
            add(smallPropId('berry', r.int(0, 3)), i, px, pz, r);
          }
          const tufts = nDetail.noise(x * 0.11, y * 0.11) > -0.2 ? r.int(0, 3) : 0;
          for (let k = 0; k < tufts; k++) {
            add(smallPropId('grass', r.int(0, 3)), i, x + r.range(0.1, 0.9), y + r.range(0.1, 0.9), r, 0.7, 1.3);
          }
          if (r.chance(0.008)) {
            const [px, pz] = nextSlot(0.2);
            add(smallPropId('rock', r.int(0, 5)), i, px, pz, r, 0.5, 0.9);
          }
          break;
        }
        case T.Sand: {
          if (r.chance(0.1)) add(smallPropId('grass', r.int(0, 3)), i, x + r.range(0.15, 0.85), y + r.range(0.15, 0.85), r, 0.6, 1);
          if (r.chance(0.025)) {
            const [px, pz] = nextSlot(0.2);
            add(smallPropId('rock', r.int(0, 5)), i, px, pz, r, 0.5, 0.9);
          }
          break;
        }
        case T.Stone: {
          if (r.chance(0.4)) {
            const [px, pz] = nextSlot(0.15);
            add(smallPropId('rock', r.int(0, 5)), i, px, pz, r, 0.7, 1.3);
          }
          if (r.chance(0.14)) {
            const [px, pz] = nextSlot(0.1);
            add(smallPropId('outcrop', r.int(0, 3)), i, px, pz, r, 0.8, 1.2);
          }
          if (r.chance(0.18)) add(smallPropId('grass', r.int(0, 3)), i, x + r.range(0.1, 0.9), y + r.range(0.1, 0.9), r, 0.6, 1);
          if (r.chance(0.05)) tree(true, 0);
          break;
        }
        case T.Mountain: {
          if (r.chance(0.16)) {
            const [px, pz] = nextSlot(0.15);
            add(smallPropId('rock', r.int(0, 5)), i, px, pz, r, 0.8, 1.4);
          }
          if (r.chance(0.08)) {
            const [px, pz] = nextSlot(0.1);
            add(smallPropId('outcrop', r.int(0, 3)), i, px, pz, r, 0.9, 1.3);
          }
          if (lvl < 12 && r.chance(0.09)) tree(true, 0);
          break;
        }
      }
    }
  }
  return {
    count: type.length,
    type: Uint16Array.from(type),
    pos: Float32Array.from(pos),
    rot: Float32Array.from(rot),
    scale: Float32Array.from(scale),
    tile: Uint32Array.from(tile),
  };
}

// Base ground colours in sRGB.
const COL: Record<string, [number, number, number]> = {
  grass: [112, 158, 70],
  grassDry: [160, 164, 90],
  grassLush: [86, 140, 62],
  forest: [74, 116, 50],
  sand: [228, 208, 152],
  stone: [158, 150, 134],
  mountain: [142, 132, 120],
  mountainHi: [176, 168, 158],
  snow: [242, 245, 248],
  bedShallow: [200, 186, 138],
  bedDeep: [70, 96, 98],
  riverBed: [146, 136, 104],
};

function paintGround(
  p: WorldParams, N: number, tpt: number, terrain: Uint8Array, water: Uint8Array, level: Uint8Array,
  groundY: Float32Array, waterY: Float32Array, moisture: Uint8Array, nDetail: Simplex, nForest: Simplex,
) {
  const NN = N * N;
  // Per-tile base colour and vegetation, with a little tile-to-tile jitter.
  const tr = new Float32Array(NN), tg = new Float32Array(NN), tb = new Float32Array(NN), tv = new Float32Array(NN);
  const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let i = 0; i < NN; i++) {
    const t = terrain[i];
    const m = moisture[i] / 255;
    let c: number[];
    let veg = 0;
    if (water[i] !== WATER.None) {
      const depth = waterY[i] - groundY[i];
      c = water[i] === WATER.River ? COL.riverBed : mix(COL.bedShallow, COL.bedDeep, clamp01((depth - 0.2) / 1.6));
    } else if (level[i] >= SNOW_LEVEL) {
      c = COL.snow;
    } else if (t === T.Grass) {
      c = m < 0.5 ? mix(COL.grassDry, COL.grass, smooth(0.15, 0.5, m)) : mix(COL.grass, COL.grassLush, smooth(0.5, 0.9, m));
      veg = 1;
    } else if (t === T.Forest) {
      c = COL.forest;
      veg = 0.95;
    } else if (t === T.Sand) {
      c = COL.sand;
      veg = 0.1;
    } else if (t === T.Stone || t === T.Mountain) {
      // rock with patches of hardy grass, thinning with height
      const rockC = t === T.Stone ? COL.stone : mix(COL.mountain, COL.mountainHi, clamp01((level[i] - 10) / 4));
      const x = i % N, y = (i / N) | 0;
      const patch = clamp01(nForest.noise(x * 0.09 + 31, y * 0.09) * 0.9 + 0.5 - (level[i] - SEA - 1) * 0.07);
      const g = patch > 0.55 ? smooth(0.55, 0.85, patch) * 0.75 : 0;
      c = mix(rockC, COL.grassDry, g);
      veg = 0.12 + g * 0.7;
    } else {
      c = COL.grass;
    }
    const j = 1 + (hash01(i, p.seed, 21) - 0.5) * 0.07;
    tr[i] = c[0] * j;
    tg[i] = c[1] * j;
    tb[i] = c[2] * j;
    tv[i] = veg;
  }

  const S = N * tpt;
  const colorTex = new Uint8Array(S * S * 4);
  const maskTex = new Uint8Array(S * S * 4);
  const inv = 1 / tpt;
  for (let v = 0; v < S; v++) {
    for (let u = 0; u < S; u++) {
      const px = (u + 0.5) * inv, pz = (v + 0.5) * inv; // world-space position in tiles
      const ox = Math.floor(px), oz = Math.floor(pz);
      const own = oz * N + ox;
      const gy = groundY[own];
      // bilinear blend over tile centres, restricted to tiles on the same terrace
      const cx = px - 0.5, cz = pz - 0.5;
      const x0 = Math.floor(cx), z0 = Math.floor(cz);
      const fx = cx - x0, fz = cz - z0;
      let wr = 0, wg = 0, wb = 0, wv = 0, ws = 0;
      for (let k = 0; k < 4; k++) {
        const tx = x0 + (k & 1), tz = z0 + (k >> 1);
        if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
        const ti = tz * N + tx;
        if (ti !== own && Math.abs(groundY[ti] - gy) > 0.01) continue;
        const w = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fz : 1 - fz) + 1e-4;
        wr += tr[ti] * w;
        wg += tg[ti] * w;
        wb += tb[ti] * w;
        wv += tv[ti] * w;
        ws += w;
      }
      let r = wr / ws, g = wg / ws, b = wb / ws;
      const veg = wv / ws;

      // mottling: broad patches + fine grain
      const patch = nDetail.noise(px * 0.18, pz * 0.18);
      const grain = (hash01(u, v, p.seed) - 0.5) * 0.06;
      const bright = 1 + patch * 0.06 + grain;
      // grassy patches drift toward yellow-green
      const hue = nForest.noise(px * 0.35 + 50, pz * 0.35) * 0.08 * veg;
      r = r * bright * (1 + hue);
      g = g * bright;
      b = b * bright * (1 - hue);

      // ambient occlusion at the foot of higher neighbours; wet edges near water
      const lx = px - ox, lz = pz - oz;
      let ao = 1;
      const dEdge = [lz, 1 - lx, 1 - lz, lx];
      const isDry = water[own] === WATER.None;
      for (let s = 0; s < 4; s++) {
        const nx = ox + DIRS4[s][0], nz = oz + DIRS4[s][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        const d = dEdge[s];
        if (groundY[ni] > gy + 0.01) {
          const k = Math.max(0, 1 - d / 0.42);
          ao *= 1 - 0.34 * k * k;
        } else if (isDry && water[ni] !== WATER.None && terrain[own] === T.Sand) {
          const k = Math.max(0, 1 - d / 0.3);
          ao *= 1 - 0.18 * k;
        }
      }
      r *= ao;
      g *= ao;
      b *= ao;

      const o = (v * S + u) * 4;
      colorTex[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      colorTex[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      colorTex[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      colorTex[o + 3] = 255;

      // mask: R vegetation, G snow threshold (lower = snows first), B flowers, A elevation
      const lvl = level[own];
      const e = clamp01((lvl - SEA - 1) / 10);
      let snowT = 0.22 + 0.55 * (nDetail.noise(px * 0.9 + 9, pz * 0.9) * 0.5 + 0.5) - e * 0.4;
      if (terrain[own] === T.Forest) snowT += 0.12;
      if (!isDry) snowT = 1.5;
      snowT = Math.max(0.03, snowT);
      if (lvl >= SNOW_LEVEL) snowT = 0;
      const flower =
        terrain[own] === T.Grass && isDry && hash01(u * 7 + 1, v * 13 + 3, p.seed) < 0.07 &&
        nDetail.noise(px * 0.25 + 30, pz * 0.25) > 0.15
          ? 255 : 0;
      maskTex[o] = Math.round(clamp01(veg) * 255);
      maskTex[o + 1] = Math.round(clamp01(snowT) * 255);
      maskTex[o + 2] = flower;
      maskTex[o + 3] = Math.round(e * 255);
    }
  }
  return { colorTex, maskTex };
}

function fnvHex(arrays: ArrayLike<number>[]): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      h1 = Math.imul(h1 ^ a[i], 0x01000193);
      h2 = Math.imul(h2 ^ (a[i] + i), 0x5bd1e995);
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Binary min-heap keyed by (value, index): deterministic tie-breaking. */
class MinHeap {
  private v: Float64Array;
  private ix: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.v = new Float64Array(cap);
    this.ix = new Int32Array(cap);
  }
  private less(a: number, b: number) {
    return this.v[a] < this.v[b] || (this.v[a] === this.v[b] && this.ix[a] < this.ix[b]);
  }
  private swap(a: number, b: number) {
    const tv = this.v[a]; this.v[a] = this.v[b]; this.v[b] = tv;
    const ti = this.ix[a]; this.ix[a] = this.ix[b]; this.ix[b] = ti;
  }
  push(value: number, index: number) {
    let k = this.size++;
    this.v[k] = value;
    this.ix[k] = index;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!this.less(k, parent)) break;
      this.swap(k, parent);
      k = parent;
    }
  }
  pop(): number {
    const top = this.ix[0];
    this.size--;
    if (this.size > 0) {
      this.v[0] = this.v[this.size];
      this.ix[0] = this.ix[this.size];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === k) break;
        this.swap(k, m);
        k = m;
      }
    }
    return top;
  }
}
