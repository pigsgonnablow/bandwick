// Grid pathfinding over the terraces. 8-way moves, no corner cutting, one-level steps
// only (taller cliffs block), shallow water can be waded, deep water cannot.
import { WorldData, WATER, T, STEP } from './types';

export class Grid {
  N: number;
  /** Cost to enter a tile, x10. 0 = blocked. */
  cost: Uint16Array;
  /** Walking level used for the one-step rule. */
  walkLevel: Int8Array;
  private cache = new Map<number, Int32Array | null>();
  /** Extra cost from the people themselves (roads lower it later). */
  traffic: Float32Array;

  constructor(w: WorldData) {
    const N = (this.N = w.size);
    this.cost = new Uint16Array(N * N);
    this.walkLevel = new Int8Array(N * N);
    this.traffic = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const t = w.terrain[i];
      const wk = w.water[i];
      if (wk !== WATER.None) {
        // wading or swimming through shallow water: fords, the lake's edge, the calm sea shallows
        // (slow going, and the sea slowest); deep water is off limits
        this.cost[i] = t !== T.ShallowWater ? 0 : wk === WATER.Sea ? 60 : 45;
        this.walkLevel[i] = Math.round(w.waterY[i] / STEP + 0.25);
      } else {
        this.cost[i] =
          t === T.Grass || t === T.Sand ? 10 : t === T.Forest ? 15 : t === T.Stone ? 14 : w.level[i] >= 15 ? 45 : 28;
        this.walkLevel[i] = w.level[i];
      }
    }
  }

  walkable(i: number) {
    return this.cost[i] > 0;
  }

  /** Can you step from tile a to its neighbour b? */
  step(a: number, b: number) {
    return this.cost[b] > 0 && Math.abs(this.walkLevel[a] - this.walkLevel[b]) <= 1;
  }

  invalidate() {
    this.cache.clear();
  }

  /**
   * A* from `from` to `to`. With `near`, any tile within one step of the goal ends the search
   * (for reaching water or a busy spot). Returns tile indices excluding the start, or null.
   */
  find(from: number, to: number, near = false, maxExpand = 9000): Int32Array | null {
    if (from === to) return new Int32Array(0);
    const key = (from * 131071 + to) * 2 + (near ? 1 : 0);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const res = this.search(from, to, near, maxExpand);
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(key, res);
    return res;
  }

  private gScore = new Float64Array(0);
  private came = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closedStamp = new Uint32Array(0);
  private run = 0;
  private heapI: number[] = [];
  private heapF: number[] = [];

  private search(from: number, to: number, near: boolean, maxExpand: number): Int32Array | null {
    const N = this.N;
    if (this.gScore.length !== N * N) {
      this.gScore = new Float64Array(N * N);
      this.came = new Int32Array(N * N);
      this.stamp = new Uint32Array(N * N);
      this.closedStamp = new Uint32Array(N * N);
    }
    if (!near && !this.walkable(to)) return null;
    const run = ++this.run;
    const tx = to % N, tz = (to / N) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % N) - tx), dz = Math.abs(((i / N) | 0) - tz);
      return 10 * (dx + dz) - 6 * Math.min(dx, dz);
    };
    const g = this.gScore, came = this.came, st = this.stamp, cl = this.closedStamp;
    const hi = this.heapI, hf = this.heapF;
    hi.length = 0;
    hf.length = 0;
    const push = (i: number, f: number) => {
      let k = hi.length;
      hi.push(i);
      hf.push(f);
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hf[p] < f || (hf[p] === f && hi[p] < i)) break;
        hi[k] = hi[p];
        hf[k] = hf[p];
        k = p;
      }
      hi[k] = i;
      hf[k] = f;
    };
    const pop = () => {
      const top = hi[0];
      const li = hi.pop()!, lf = hf.pop()!;
      if (hi.length) {
        let k = 0;
        const n = hi.length;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = -1;
          let mf = lf, mi = li;
          if (l < n && (hf[l] < mf || (hf[l] === mf && hi[l] < mi))) { m = l; mf = hf[l]; mi = hi[l]; }
          if (r < n && (hf[r] < mf || (hf[r] === mf && hi[r] < mi))) { m = r; }
          if (m < 0) break;
          hi[k] = hi[m];
          hf[k] = hf[m];
          k = m;
        }
        hi[k] = li;
        hf[k] = lf;
      }
      return top;
    };
    st[from] = run;
    g[from] = 0;
    came[from] = -1;
    push(from, h(from));
    let expanded = 0;
    const isGoal = (i: number) => {
      if (i === to) return true;
      if (!near) return false;
      const dx = Math.abs((i % N) - tx), dz = Math.abs(((i / N) | 0) - tz);
      return dx <= 1 && dz <= 1;
    };
    while (hi.length) {
      const cur = pop();
      if (cl[cur] === run) continue;
      cl[cur] = run;
      if (isGoal(cur)) return this.rebuild(cur, from);
      if (++expanded > maxExpand) return null;
      const cx = cur % N, cz = (cur / N) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const nb = nz * N + nx;
          if (!this.step(cur, nb)) continue;
          if (dx && dz) {
            // diagonal: both side tiles must be passable and level
            const a = cz * N + nx, b = nz * N + cx;
            if (!this.step(cur, a) || !this.step(cur, b)) continue;
            if (this.walkLevel[a] !== this.walkLevel[cur] || this.walkLevel[b] !== this.walkLevel[cur]) continue;
          }
          const climb = this.walkLevel[nb] !== this.walkLevel[cur] ? 9 : 0;
          const base = this.cost[nb] - Math.min(6, this.traffic[nb]);
          const ng = g[cur] + (dx && dz ? base * 1.414 : base) + climb;
          if (st[nb] !== run || ng < g[nb]) {
            st[nb] = run;
            g[nb] = ng;
            came[nb] = cur;
            push(nb, ng + h(nb));
          }
        }
    }
    return null;
  }

  private rebuild(end: number, from: number) {
    const out: number[] = [];
    let c = end;
    while (c !== from && c >= 0) {
      out.push(c);
      c = this.came[c];
    }
    out.reverse();
    return Int32Array.from(out);
  }
}
