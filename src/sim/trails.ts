// Footpaths that wear in where people walk often. Every step onto a tile treads it a little; the
// grass grows back over the ground nobody uses, quickly in spring and summer and hardly at all
// under winter's frost. Every few hours the wear is read off as a trail on each tile, which the
// renderer draws as trampled grass and then bare packed earth (and, with TRAIL_EASE, which makes
// the going a little easier, so people drift onto the paths already there).
import { WorldData, WATER } from './types';
import { Grid } from './path';
import { TICKS_PER_HOUR, seasonOf } from './time';

/** How often the wear is read off as trails (and the grass gets to grow back), in ticks. */
export const TRAIL_EVERY = 6 * TICKS_PER_HOUR;
/**
 * Wear before a tile shows any trail at all. Above it the trail is read off on a log scale, up to
 * CAP: a path walked a few times a day is worn plain to see, and only the most trodden ground (the
 * middle of the camp, the way to the water) is beaten bare. Wear never builds past CAP, so even a
 * camp's yard grows over within a year of leaving it.
 */
const FAINT = 2;
const CAP = 200;
const LOG_SPAN = Math.log(CAP / FAINT);
/** Of each day's wear, what is left after a day (by season: spring, summer, autumn, winter). */
const KEEP_PER_DAY = [0.88, 0.9, 0.94, 0.99];
const KEEP = KEEP_PER_DAY.map((k) => Math.pow(k, TRAIL_EVERY / (24 * TICKS_PER_HOUR)));
/**
 * How much a beaten path lowers the cost of entering a tile (grass costs 10, woods 15, x10), so that
 * people keep to the paths already there and are quicker along them through the woods. 0 for now: the
 * paths are only drawn, and go where people already walk.
 */
export const TRAIL_EASE = 0;

export class Trails {
  /** how trodden each tile is: about one per footstep, fading as the grass grows back */
  wear: Float32Array;
  /** the trail on each tile as last read off (0 none .. 255 beaten earth): what is drawn and what eases walking */
  level: Uint8Array;
  /** bumped whenever `level` is read off again */
  version = 1;
  private land: Uint8Array;

  constructor(world: WorldData, private grid: Grid) {
    const NN = world.size * world.size;
    this.wear = new Float32Array(NN);
    this.level = new Uint8Array(NN);
    this.land = new Uint8Array(NN);
    for (let i = 0; i < NN; i++) this.land[i] = world.water[i] === WATER.None && grid.walkable(i) ? 1 : 0;
  }

  /** Someone has walked onto tile i. */
  tread(i: number, k = 1) {
    if (!this.land[i]) return;
    const w = this.wear[i] + k;
    this.wear[i] = w > CAP ? CAP : w;
  }

  /** Let the grass grow back a little, and read the wear off as trails. */
  update(tick: number) {
    const keep = KEEP[seasonOf(tick)];
    const { wear, level } = this;
    let changed = false;
    for (let i = 0; i < wear.length; i++) {
      let w = wear[i];
      if (w === 0) {
        if (level[i]) { level[i] = 0; changed = true; }
        continue;
      }
      w *= keep;
      if (w < 0.5) w = 0;
      wear[i] = w;
      const t = w <= FAINT ? 0 : Math.log(w / FAINT) / LOG_SPAN;
      const v = Math.round(t * 255);
      if (v !== level[i]) { level[i] = v; changed = true; }
    }
    if (changed) this.apply();
  }

  /** Make the trails count for walking (after a change, or on loading a save). */
  apply() {
    this.version++;
    if (!TRAIL_EASE) return;
    const traffic = this.grid.traffic, level = this.level;
    for (let i = 0; i < level.length; i++) traffic[i] = (level[i] / 255) * TRAIL_EASE;
    // the paths people would take may be different now
    this.grid.invalidate();
  }
}
