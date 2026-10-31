// Utility AI: each person weighs their own needs against the work the camp needs,
// coloured by traits, skills and age, then carries the chosen task out step by step.
import type { Sim } from './sim';
import { isBerry, isTreeType, isFiberPlant, isReeds, treeStage, treeSpecies, LOGS, GRAVE, STUMP_BASE, WOOD_BY_STAGE, DEADWOOD_BY_STAGE, BARK, CONES, STAGE_WORD, art, clamp, WINTER_CATCH, BITTER_CATCH, PROP_TASKS } from './sim';
import { Person, Task, TaskKind, SK, ACT, CARRY, MATERIALS, Material, FLASH, foodTotal, Building, specOf, labelOf, RECIPES, RECIPE_KEYS, RecipeKey, Item, ItemKind, HEALTH, TRAP_KINDS, BASKET_HOLDS, train, trainSkill } from './band';
import { hourOf, isDark, berriesRipe, freshFrozen, seasonOf, dayOf, TICKS_PER_DAY } from './time';
import { WATER, DIRS4, treeId } from './types';

const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);

interface Option {
  kind: TaskKind;
  score: number;
}

function newTask(s: Sim, kind: TaskKind, goal: number, gx: number, gz: number, ref = -1, near = false): Task {
  return { kind, stage: 0, goal, gx, gz, ref, timer: 0, started: s.tick, amount: 0, near };
}

/**
 * Take a tool for the work. Unless they are standing by the pile, they walk there for it first
 * (stage -1); the task's own case sends them on to the work from there. Returns whether they must.
 */
function takeFromPile(s: Sim, p: Person, t: Task, tool: Item) {
  const pile = s.storeSpot(true);
  const walk = tool.holder !== p.id && hyp(p.x - pile.x, p.z - pile.z) > 3.5;
  if (walk) {
    t.stage = -1;
    t.goal = pile.tile;
    t.gx = pile.x;
    t.gz = pile.z;
  }
  s.takeTool(p, tool);
  return walk;
}

/** A seat around the hearth, different for each person. */
function seat(s: Sim, p: Person, radius = 1.15) {
  const a = ((p.look % 360) / 360) * 6.2831853 + (s.tick % 7) * 0.05;
  // cheap deterministic sin/cos via a rotated unit vector table
  const k = Math.floor(((a % 6.2831853) / 6.2831853) * 16);
  const [cx, cz] = CIRCLE[k];
  return { x: s.camp.x + cx * radius, z: s.camp.z + cz * radius };
}
const CIRCLE: number[][] = Array.from({ length: 16 }, (_, i) => {
  // fixed literal unit vectors (computed once, identical everywhere)
  const t = [1, 0.9239, 0.7071, 0.3827, 0, -0.3827, -0.7071, -0.9239, -1, -0.9239, -0.7071, -0.3827, 0, 0.3827, 0.7071, 0.9239];
  return [t[i], t[(i + 12) % 16]];
});

function workDrive(s: Sim, p: Person) {
  const age = s.age(p);
  let d = 1;
  if (s.has(p, 'industrious')) d *= 1.28;
  if (s.has(p, 'lazy')) d *= 0.72;
  d *= 0.72 + p.mood / 360;
  if (age < 9) return 0;
  if (age < 14) d *= 0.45;
  else if (age >= 60) d *= 0.55;
  else if (age >= 52) d *= 0.8;
  if (p.pregnantUntil > 0 && p.pregnantUntil - s.tick < 4 * TICKS_PER_DAY) d *= 0.5;
  if (p.sick > 0) d *= 0.3;
  if (p.health < HEALTH.weak) d *= 0.5;
  return d;
}
const fit = (p: Person, k: number) => 0.7 + Math.min(20, p.skills[k]) * 0.03;

/**
 * What this person would sit down to make: of the recipes the morning plan wants and the stores allow,
 * the one most wanted, weighed by how good they are at it.
 */
function craftFor(s: Sim, p: Person): { key: RecipeKey; score: number } | null {
  let best: { key: RecipeKey; score: number } | null = null;
  for (const key of RECIPE_KEYS) {
    const w = s.camp.jobs[`craft.${key}`] ?? 0;
    // the morning's plan may be met already: a tool or a trap only while the band is still short of it
    if (w <= 0 || !s.canCraft(key)) continue;
    if (TRAP_KINDS.includes(key as ItemKind) ? !s.trapShort(key as ItemKind) : key !== 'cordage' && s.toolToMake() !== key) continue;
    const score = w * fit(p, RECIPES[key].skill);
    if (!best || score > best.score) best = { key, score };
  }
  return best;
}

function busyWith(s: Sim, kind: TaskKind) {
  let n = 0;
  for (const q of s.people) if (q.alive && q.band === s.camp.id && q.task?.kind === kind) n++;
  return n;
}

export function decide(s: Sim, p: Person) {
  const age = s.age(p);
  const child = age < 14;
  const dark = isDark(s.tick);
  const hour = hourOf(s.tick);
  const c = s.camp;
  const stock = foodTotal(c.stock);
  const temp = s.tempAt(p);
  const r = s.rAi;
  const opts: Option[] = [];
  const add = (kind: TaskKind, score: number) => {
    if (score > 0.01) opts.push({ kind, score: score + r.next() * 0.07 });
  };

  // ---- personal needs
  const hk = (78 - p.food) / 78;
  let hunger = p.food >= 78 ? 0 : hk * hk * 1.9;
  // real hunger beats everything except danger: nobody should starve beside a full store
  if (p.food < 35) hunger = Math.max(hunger, 1.35 + ((35 - p.food) / 35) * 1.7);
  const mealtime = ((hour >= 6.5 && hour < 8.5) || (hour >= 17.5 && hour < 19.5)) && p.food < 82 ? 0.5 : 0;
  if (stock >= 0.4) add('eat', hunger + mealtime);
  else if (berriesRipe(s.tick)) add('eatwild', hunger * 1.1);
  if (dark) add('sleep', p.rest < 94 ? 1.45 + (hour > 21 || hour < 5 ? 0.3 : 0) : 0.2);
  else add('sleep', p.rest < 32 ? ((32 - p.rest) / 32) * 1.7 : 0);
  if (temp < 11 && p.warmth < 62) add('warm', ((62 - p.warmth) / 62) * 1.7 + (dark ? 0.15 : 0));
  add('socialize', p.belonging < 62 ? ((62 - p.belonging) / 62) * 0.95 + (hour > 17 && !dark ? 0.15 : 0) : 0);
  add('idle', 0.16 + (hour > 18 && !dark ? 0.15 : 0) + (s.has(p, 'lazy') ? 0.1 : 0));
  if (child && age >= 2 && !dark) add('play', 0.5 + (age < 9 ? 0.2 : 0));
  // a hot afternoon: the young go down to the water to cool off
  if (!dark && temp >= 21 && age >= 4 && age < 40 && p.health > HEALTH.swim && hour > 10 && hour < 19)
    add('swim', (child ? 0.42 : 0.24) + Math.min(0.3, (temp - 21) * 0.05) + (s.has(p, 'wanderlust') ? 0.05 : 0));
  // far from their own camp (left behind in a move, or newly joined): make for it
  const away = hyp(p.x - c.x, p.z - c.z);
  if (away > 16 && !dark) add('migrate', 1.6 + Math.min(1.5, (away - 16) * 0.05));
  const grief = p.memories.find((m) => m.kind === 'death' && s.tick - m.tick < 2 * TICKS_PER_DAY && m.tick > p.mourned);
  if (grief && !dark) add('mourn', 0.65);

  // ---- work for the camp
  const drive = workDrive(s, p);
  if (drive > 0) {
    const night = dark ? 0.06 : 1;
    // crowding is relative: ten fishers is a crowd for a band of twelve, not for a band of fifty
    const workers = Math.max(1, s.people.reduce((n, q) => n + (q.alive && q.band === p.band && s.age(q) >= 13 ? 1 : 0), 0));
    const share = Math.max(1, workers / 8);
    const crowd = (k: TaskKind) => 1 / (1 + (0.33 * busyWith(s, k)) / share);
    const j = c.jobs;
    // with nothing in the store, the hungry go and find their own (a child left alone would otherwise play until they starve)
    const food = (j.food ?? 0.5) * drive * night * (stock < 0.4 && p.food < 35 ? 1 + hunger : 1);
    if (berriesRipe(s.tick)) add('forage', food * fit(p, SK.forage) * (child ? 1.3 : 1) * crowd('forage'));
    // a hunt can mean a day's walk: not for the sick, the weak or the half-starved
    if (age >= 16 && age < 56 && p.sick === 0 && p.health >= HEALTH.hunt && (p.food >= 50 || stock < 0.4)) {
      const nerve = s.has(p, 'brave') ? 1.4 : s.has(p, 'cautious') ? 0.55 : 1;
      add('hunt', food * fit(p, SK.hunt) * nerve * 0.95 * crowd('hunt'));
    }
    if (age >= 11) add('fish', food * fit(p, SK.fish) * 0.85 * crowd('fish'));
    // grass and reeds for thatch and cordage: work the older children can do too
    if (age >= 9) add('reap', (j.fiber ?? 0) * drive * night * fit(p, SK.forage) * (child ? 1.15 : 1) * crowd('reap'));
    // the round of the snares and fish traps: one person, once a day, by daylight
    if (age >= 12 && !dark && (j.trap ?? 0) > 0 && c.trapRound !== dayOf(s.tick) && busyWith(s, 'trap') === 0)
      add('trap', j.trap * drive * fit(p, SK.hunt));
    // mud for daub, stone for walls: heavy work, for a site that needs it
    if (age >= 13) add('dig', (j.dig ?? 0) * drive * night * fit(p, SK.build) * crowd('dig'));
    if (age >= 16 && age < 56) add('quarry', (j.quarry ?? 0) * drive * night * fit(p, SK.build) * crowd('quarry'));
    // crafting (cordage, tools): sitting work by the fire, the thing they'd make best among what's wanted
    if (age >= 10) {
      const pick = craftFor(s, p);
      if (pick) add('craft', pick.score * drive * (dark ? (s.hearthLit() ? 0.4 : 0.06) : 0.85) * crowd('craft'));
    }
    // logs lying within a walk of camp are fetched before another tree comes down
    const logsNear = logsNearCamp(s);
    if (age >= 13) {
      const wood = (j.wood ?? 0.3) * drive * night * fit(p, SK.wood);
      add(logsNear ? 'haul' : 'fell', wood * crowd('fell') * crowd('haul'));
      // fallen branches near camp: a little wood at a time, and no tree has to come down
      add('deadwood', wood * 0.8 * crowd('deadwood'));
      add('build', (j.build ?? 0) * drive * night * fit(p, SK.build) * crowd('build') * 1.05);
      add('preserve', (j.preserve ?? 0) * drive * night * fit(p, SK.hide) * crowd('preserve'));
    }
    if ((j.fuel ?? 0) > 0.5 && c.stock.wood >= 1 && busyWith(s, 'fuel') === 0) add('fuel', j.fuel * (dark ? 1.1 : 1));
    // from late afternoon, bank the fire with enough to see the night through (in the dark, ahead of sleep)
    // (someone bringing wood from far across the land doesn't stop those at camp from feeding it now)
    const fueling = s.fuelOnHand(c);
    if ((dark || hour >= 15) && age >= 13 && !fueling && busyWith(s, 'fuel') < 2 && s.fireShort()) add('fuel', dark ? 2.0 : 1.0);
    // a dying fire in the cold is everyone's problem: a few go for wood whatever the hour
    const fireLow = s.hearth().fuel < 2;
    // (even the weak: a cold hearth in a hungry winter is how a whole band dies)
    if (fireLow && temp < 9 && age >= 13 && p.health > 12) {
      if (c.stock.wood >= 1 && !fueling && busyWith(s, 'fuel') < 2) add('fuel', 2.1);
      else if (c.stock.wood < 3) {
        const fetching = busyWith(s, 'fell') + busyWith(s, 'haul') + busyWith(s, 'deadwood');
        if (fetching < 4) {
          add(logsNear ? 'haul' : 'fell', 1.95 - fetching * 0.3);
          add('deadwood', 2.0 - fetching * 0.3); // quickest way to get the fire going again
        }
      }
    }
    if ((j.bury ?? 0) > 0 && age >= 15 && !dark) {
      // one burial at a time, unless there are several dead waiting (after a hard winter)
      let waiting = 0;
      for (const q of s.people) if (!q.alive && !q.buried && q.band === p.band) waiting++;
      if (busyWith(s, 'bury') < Math.min(3, waiting)) add('bury', 1.2);
    }
  }

  opts.sort((a, b) => b.score - a.score);
  // keep going with the current job if it is still among the best
  const cur = p.task;
  if (cur && opts.length && opts[0].kind === cur.kind) {
    p.nextThink = s.tick + 30;
    return;
  }
  for (const o of opts) {
    const t = setup(s, p, o.kind);
    if (t) {
      // put down the old task properly (setup may already have reserved things for the new one)
      // and whatever they carry for it, before picking up a spear for a hunt or a day's fishing
      const spear = o.kind === 'hunt' || o.kind === 'fish';
      const keep = spear && p.carry === CARRY.Spear;
      const prev = p.task;
      if (prev) {
        p.task = prev;
        abandon(s, p, keep);
      } else if (!keep && p.carry !== CARRY.None) abandon(s, p);
      if (spear) p.carry = CARRY.Spear;
      p.task = t;
      p.path = null;
      p.indoors = false;
      p.nextThink = s.tick + (['idle', 'play', 'socialize', 'mourn', 'swim'].includes(o.kind) ? 40 : o.kind === 'migrate' ? 300 : 600);
      return;
    }
  }
  // nothing to do: stand where they are a while
  p.task = null;
  p.act = ACT.Idle;
  p.nextThink = s.tick + 15;
}

// ---------------------------------------------------------------- task setup
function setup(s: Sim, p: Person, kind: TaskKind, recipe?: RecipeKey): Task | null {
  const c = s.camp;
  const N = s.N;
  const ti = (x: number, z: number) => Math.floor(z) * N + Math.floor(x);
  switch (kind) {
    case 'eat': {
      const st = seat(s, p, 1.2);
      p.thought = p.food < 30 ? 'Hungry. Heading back to eat.' : 'Time for a meal by the fire.';
      return newTask(s, kind, ti(st.x, st.z), st.x, st.z);
    }
    case 'eatwild': {
      const k = s.nearestProp(p.x, p.z, 20, (k) => isBerry(s.propType[k]) && s.propVal[k] >= 1);
      if (k < 0) return null;
      s.reserved.set(k, p.id);
      p.thought = 'Nothing in the stores. Eating berries off the bush.';
      return newTask(s, kind, s.propTile[k], s.propX[k] + 0.3, s.propZ[k] + 0.2, k);
    }
    case 'sleep': {
      const home = s.buildings.find((b) => b.id === p.home && b.built);
      if (home) {
        p.thought = 'Going home to sleep.';
        return newTask(s, kind, home.tile, home.x + 0.5, home.z + 0.5, home.id);
      }
      const st = seat(s, p, 1.7);
      p.thought = 'Sleeping under the sky by the fire.';
      return newTask(s, kind, ti(st.x, st.z), st.x, st.z);
    }
    case 'warm': {
      if (s.hearthLit()) {
        const st = seat(s, p, 1.0);
        p.thought = 'Cold. Warming up at the fire.';
        return newTask(s, kind, ti(st.x, st.z), st.x, st.z);
      }
      const home = s.buildings.find((b) => b.id === p.home && b.built);
      if (!home) return null;
      p.thought = 'The fire is out. Sheltering at home.';
      return newTask(s, kind, home.tile, home.x + 0.5, home.z + 0.5, home.id);
    }
    case 'socialize': {
      let best: Person | null = null, bestS = -Infinity;
      for (const q of s.people) {
        if (!q.alive || q === p || q.indoors || q.act === ACT.Sleep || s.age(q) < 3) continue;
        const d = hyp(q.x - p.x, q.z - p.z);
        if (d > 18 || (q.band !== p.band && d > 6)) continue;
        const sc = s.opinion(p, q) + (q.id === p.partner ? 30 : 0) - d * 1.5 + s.rAi.next() * 20;
        if (sc > bestS) { bestS = sc; best = q; }
      }
      if (!best) return null;
      p.thought = `Going to talk with ${best.name}.`;
      return newTask(s, kind, s.tileOf(best), best.x, best.z, best.id, true);
    }
    case 'idle': {
      const st = seat(s, p, 1.3);
      p.thought = s.hearthLit() ? 'Sitting by the fire.' : 'Resting near camp.';
      return newTask(s, kind, ti(st.x, st.z), st.x, st.z);
    }
    case 'play': {
      const mom = s.byId.get(p.mother);
      const cx = mom && mom.alive && hyp(mom.x - c.x, mom.z - c.z) < 6 ? mom.x : c.x;
      const cz = mom && mom.alive && hyp(mom.x - c.x, mom.z - c.z) < 6 ? mom.z : c.z;
      // children join a game already going if there is one nearby
      const game = s.people.find((q) => q !== p && q.alive && q.band === p.band && q.task?.kind === 'play' && hyp(q.task.gx - cx, q.task.gz - cz) < 8);
      for (let k = 0; k < 6; k++) {
        const spread = game ? 0.8 : 4;
        const x = (game ? game.task!.gx : cx) + s.rAi.range(-spread, spread), z = (game ? game.task!.gz : cz) + s.rAi.range(-spread, spread);
        const t = ti(x, z);
        if (x > 0 && z > 0 && x < N && z < N && s.grid.walkable(t) && s.world.water[t] === WATER.None) {
          p.thought = s.rAi.chance(0.5) ? 'Playing chase.' : 'Exploring near camp.';
          return newTask(s, kind, t, x, z);
        }
      }
      return null;
    }
    case 'migrate': {
      p.thought = `Heading back to ${c.name}.`;
      return newTask(s, kind, c.tile, c.x, c.z, -1, true);
    }
    case 'swim': {
      // the nearest water a person can swim in, near camp; join others already in it
      const inWater = s.people.find((q) => q !== p && q.alive && q.band === p.band && q.task?.kind === 'swim');
      const cx = inWater ? inWater.task!.gx : c.x, cz = inWater ? inWater.task!.gz : c.z;
      let best = -1, bd = 1e9;
      const R = 14;
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          const x = Math.floor(cx) + dx, z = Math.floor(cz) + dz;
          if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
          const i = z * N + x;
          if (s.world.water[i] === WATER.None || !s.grid.walkable(i)) continue;
          const d = hyp(dx, dz) + s.rAi.next() * 1.5;
          if (d < bd) { bd = d; best = i; }
        }
      if (best < 0 || bd > (inWater ? 4 : R)) return null;
      p.thought = s.rAi.chance(0.5) ? 'Too hot. Off to the water.' : 'Going for a swim.';
      return newTask(s, kind, best, (best % N) + s.rAi.range(0.25, 0.75), Math.floor(best / N) + s.rAi.range(0.25, 0.75));
    }
    case 'mourn': {
      const m = p.memories.filter((m) => m.kind === 'death').sort((a, b) => b.tick - a.tick)[0];
      p.mourned = s.tick;
      if (!m) return null;
      let gk = -1;
      for (let k = 0; k < s.propCount; k++) if (s.propAlive[k] && s.propType[k] >= GRAVE && s.propType[k] < GRAVE + 2 && s.propVal[k] === m.subject) gk = k;
      const dead = s.byId.get(m.subject);
      p.thought = `Mourning ${dead?.name ?? 'the dead'}.`;
      if (gk >= 0) return newTask(s, kind, s.propTile[gk], s.propX[gk] + 0.45, s.propZ[gk] + 0.3, -1);
      const st = seat(s, p, 1.4);
      return newTask(s, kind, ti(st.x, st.z), st.x, st.z);
    }
    case 'forage': {
      const k = s.nearestProp(p.x, p.z, 28, (k) => isBerry(s.propType[k]) && s.propVal[k] >= 1 && hyp(s.propX[k] - c.x, s.propZ[k] - c.z) < 30,
        (k, d) => s.propVal[k] / (d + 5));
      if (k < 0) return null;
      s.reserved.set(k, p.id);
      p.thought = 'Picking berries.';
      const t = newTask(s, kind, s.propTile[k], s.propX[k] + 0.3, s.propZ[k] + 0.22, k);
      // a basket from the pile if there's one to be had: it comes home with several bushes' worth
      const basket = s.toolFor(p, ['basket']);
      if (basket && takeFromPile(s, p, t, basket)) p.thought = 'Fetching a basket to pick berries.';
      return t;
    }
    case 'reap': {
      const k = nextClump(s, c.x, c.z, 26);
      if (k < 0) return null;
      s.reserved.set(k, p.id);
      p.thought = isReeds(s.propType[k]) ? 'Cutting reeds by the water.' : 'Cutting grass for thatch.';
      return newTask(s, kind, s.propTile[k], s.propX[k] + 0.28, s.propZ[k] + 0.2, k);
    }
    case 'dig': {
      // the ground is frozen hard in winter
      if (seasonOf(s.tick) === 3) return null;
      const i = nearestTile(s, s.mudSpots, 22, -1);
      if (i < 0) return null;
      const what = s.world.clay[i] ? 'clay on the riverbank' : 'mud by the water';
      p.thought = `Digging ${what}.`;
      const t = newTask(s, kind, i, (i % N) + 0.5, Math.floor(i / N) + 0.5, i);
      // a digging stick if there's one to be had; bare hands otherwise
      const stick = s.toolFor(p, ['stick']);
      if (stick && takeFromPile(s, p, t, stick)) p.thought = `Fetching a digging stick to dig ${what}.`;
      return t;
    }
    case 'quarry': {
      // a lump of stone for a tool is worth a longer walk than a load for walls
      const make = s.toolToMake();
      const forTools = !!make && (RECIPES[make].uses.stone ?? 0) > c.stock.stone;
      const i = nearestTile(s, s.quarryTiles, forTools ? 36 : 22, -2);
      if (i < 0) return null;
      p.thought = 'Prising stone from the rocks.';
      return newTask(s, kind, i, (i % N) + 0.5, Math.floor(i / N) + 0.5, -1, true);
    }
    case 'trap': {
      const route = trapRoute(s);
      if (!route.length) return null;
      c.trapRound = dayOf(s.tick);
      const t = newTask(s, kind, route[1], (route[1] % N) + 0.5, Math.floor(route[1] / N) + 0.5);
      t.route = route;
      t.step = 0;
      t.amount = 0;
      t.fish = 0;
      // the traps to set out today go into the basket at the pile first
      let fetch = false;
      for (let k = 0; k < route.length; k += 3) {
        const it = s.items.find((i) => i.id === route[k]);
        if (route[k + 2] >= 0 && it && (it.tile ?? -1) === -1) {
          it.tile = -2;
          fetch = true;
        }
      }
      const pile = s.storeSpot(true);
      if (fetch && hyp(p.x - pile.x, p.z - pile.z) > 3.5) {
        t.stage = -1;
        t.goal = pile.tile;
        t.gx = pile.x;
        t.gz = pile.z;
      }
      p.thought = fetch ? 'Taking traps from the pile to set out.' : 'Going round the traps.';
      return t;
    }
    case 'craft': {
      const key = recipe ?? craftFor(s, p)?.key;
      if (!key || !s.canCraft(key)) return null;
      const rc = RECIPES[key];
      const st = seat(s, p, 1.45);
      const t = newTask(s, kind, ti(st.x, st.z), st.x, st.z, RECIPE_KEYS.indexOf(key));
      // set aside now so others don't count it twice
      for (const [m, n] of Object.entries(rc.uses) as [keyof typeof rc.uses, number][]) c.stock[m] -= n;
      t.amount = 1;
      p.thought = rc.thought;
      return t;
    }
    case 'fell': {
      // an axe fells any tree; a hand chopper only saplings and young ones; without either, no felling
      const tool = s.toolFor(p, ['axe', 'chopper']);
      if (!tool) return null;
      const maxStage = tool.kind === 'axe' ? 3 : 1;
      // the nearest good timber first; as the woods around camp thin out, go further or take younger trees
      const score = (k: number, d: number) => treeStage(s.propType[k]) * 3 - d - hyp(s.propX[k] - p.x, s.propZ[k] - p.z) * 0.4 + (s.chopped.has(k) ? 8 : 0);
      const tree = (min: number) => (k: number) => isTreeType(s.propType[k]) && treeStage(s.propType[k]) >= min && treeStage(s.propType[k]) <= maxStage;
      // a dying fire in the cold: the nearest usable wood, young trees included, beats a long walk
      const desperate = s.hearth().fuel < 2 && s.tempAt(p) < 9 && c.stock.wood < 3;
      let k = desperate ? s.nearestProp(c.x, c.z, 18, tree(1), (k, d) => -d + (s.chopped.has(k) ? 6 : 0) + treeStage(s.propType[k])) : -1;
      // otherwise good timber, near first; young trees are left to grow so the woods around camp come back
      if (k < 0) k = s.nearestProp(c.x, c.z, 26, tree(2), score);
      if (k < 0) k = s.nearestProp(c.x, c.z, 48, tree(2), score);
      if (k < 0) k = s.nearestProp(c.x, c.z, 30, tree(1), score);
      if (k < 0) return null;
      s.reserved.set(k, p.id);
      const kindName = ['pine', 'oak', 'birch'][Math.floor(s.propType[k] / 12)];
      const t = newTask(s, kind, s.propTile[k], s.propX[k] + 0.34, s.propZ[k] + 0.18, k);
      // a tool from the pile is fetched first, unless they are standing by it
      if (takeFromPile(s, p, t, tool)) p.thought = `Fetching ${tool.kind === 'axe' ? 'an axe' : 'a chopper'} from the stockpile to fell a ${kindName}.`;
      else p.thought = treeStage(s.propType[k]) === 3 ? `Felling an old ${kindName}.` : tool.kind === 'chopper' ? `Hacking at a young ${kindName} with a chopper.` : `Felling a ${kindName} for wood.`;
      return t;
    }
    case 'deadwood': {
      const k = s.nearestProp(c.x, c.z, 26, (k) => isTreeType(s.propType[k]) && treeStage(s.propType[k]) >= 1 && !s.deadwoodTaken.has(k),
        (k, d) => DEADWOOD_BY_STAGE[treeStage(s.propType[k])] * 4 - d - hyp(s.propX[k] - p.x, s.propZ[k] - p.z) * 0.3);
      if (k < 0) return null;
      s.reserved.set(k, p.id);
      p.thought = 'Gathering fallen branches for the fire.';
      return newTask(s, kind, s.propTile[k], s.propX[k] + 0.3, s.propZ[k] + 0.25, k);
    }
    case 'haul': {
      const k = s.nearestProp(c.x, c.z, HAUL_RANGE, (k) => s.propType[k] === LOGS && s.propVal[k] > 0);
      if (k < 0) return setup(s, p, 'fell');
      s.reserved.set(k, p.id);
      p.thought = 'Hauling logs back to camp.';
      return newTask(s, kind, s.propTile[k], s.propX[k] + 0.25, s.propZ[k] + 0.2, k);
    }
    case 'hunt': {
      let best = -1, bestD = 56;
      s.deer.forEach((d, i) => {
        if (!d.alive) return;
        const dist = hyp(d.x - c.x, d.z - c.z);
        if (dist < bestD && !s.people.some((q) => q !== p && q.alive && q.task?.kind === 'hunt' && q.task.ref === d.id)) {
          bestD = dist;
          best = i;
        }
      });
      if (best < 0) return null;
      const d = s.deer[best];
      p.thought = 'Tracking deer.';
      const t = newTask(s, kind, s.tileOf(d), d.x, d.z, d.id, true);
      // time to walk out there, plus time to stalk and chase
      t.deadline = s.tick + 110 + Math.round(hyp(d.x - p.x, d.z - p.z) / 0.3);
      return t;
    }
    case 'fish': {
      const frozen = freshFrozen(s.tick);
      let best = -1, bestS = -Infinity, bestW = -1;
      for (const spot of s.fishingSpots) {
        const x = (spot % N) + 0.5, z = Math.floor(spot / N) + 0.5;
        const dc = hyp(x - c.x, z - c.z);
        if (dc > 28) continue;
        if (s.people.some((q) => q !== p && q.alive && q.task?.kind === 'fish' && q.task.goal === spot)) continue;
        if ((s.unreachable.get(-(spot + 1)) ?? 0) > s.tick) continue;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (Math.abs(dx) + Math.abs(dz) !== 1) continue;
            const wx = (spot % N) + dx, wz = Math.floor(spot / N) + dz;
            if (wx < 0 || wz < 0 || wx >= N || wz >= N) continue;
            const w = wz * N + wx;
            if (s.fishCap[w] <= 0 || s.fish[w] < 1.5) continue;
            if (frozen && s.world.water[w] !== WATER.Sea) continue;
            const sc = s.fish[w] / (dc + hyp(x - p.x, z - p.z) * 0.5 + 6);
            if (sc > bestS) { bestS = sc; best = spot; bestW = w; }
          }
      }
      if (best < 0) return null;
      p.thought = s.world.water[bestW] === WATER.Sea ? 'Fishing from the shore.' : 'Fishing at the water.';
      const t = newTask(s, kind, best, (best % N) + 0.5, Math.floor(best / N) + 0.5, bestW);
      return t;
    }
    case 'build': {
      const sites = s.buildings.filter((b) => !b.built && b.band === p.band).sort((a, b) => a.started - b.started);
      let short: Material | null = null;
      for (const b of sites) {
        const spec = specOf(b);
        let ready = true;
        for (const m of MATERIALS) {
          const need = spec[m] - b[m] - inTransit(s, b.id, m);
          if (need <= 0.5) continue;
          ready = false;
          if (c.stock[m] < 1) {
            short ??= m;
            continue;
          }
          const st = s.storeSpot(true);
          p.thought = `Carrying ${m === 'fiber' ? 'thatch' : m} to the ${labelOf(b).toLowerCase()}.`;
          const t = newTask(s, 'supply', st.tile, st.x, st.z, b.id);
          t.amount = Math.min(m === 'wood' || m === 'mud' ? 6 : m === 'stone' ? 4 : 8, need, c.stock[m]);
          if (m !== 'wood') t.res = m;
          c.stock[m] -= t.amount; // set aside now so others don't count it twice
          return t;
        }
        // (the same half-load allowance as above: odd scraps short of a full load don't hold the work up)
        if (ready && MATERIALS.every((m) => b[m] >= spec[m] - 0.5)) {
          const owner = s.byId.get(b.owner);
          const label = labelOf(b).toLowerCase();
          p.thought = owner && owner.alive ? `Building a ${label} for ${owner.id === p.id ? 'their family' : owner.name + "'s family"}.` : `Building the ${label}.`;
          return newTask(s, 'build', b.tile, b.x + 0.5, b.z + 0.5, b.id, true);
        }
      }
      // nothing in the stores for any site: go and get what is missing
      if (short === 'wood') return setup(s, p, s.countProps(LOGS) > 0 ? 'haul' : 'fell');
      if (short === 'cordage' && s.canCraft('cordage')) return setup(s, p, 'craft', 'cordage');
      if (short === 'mud') return setup(s, p, 'dig');
      if (short === 'stone') return setup(s, p, 'quarry');
      if (short) return setup(s, p, 'reap');
      return null;
    }
    case 'fuel': {
      if (c.stock.wood < 1) return null;
      const st = s.storeSpot(true);
      const t = newTask(s, kind, st.tile, st.x, st.z);
      t.amount = Math.min(4, Math.floor(c.stock.wood));
      c.stock.wood -= t.amount;
      p.thought = s.hearthLit() ? 'Feeding the fire.' : 'Relighting the fire.';
      return t;
    }
    case 'preserve': {
      const rack = s.buildings.find((b) => b.kind === 'rack' && b.built && b.band === p.band);
      if (!rack || c.stock.meat + c.stock.fish < 3) return null;
      const st = s.storeSpot();
      const t = newTask(s, kind, st.tile, st.x, st.z, rack.id);
      const take = Math.min(6, c.stock.meat + c.stock.fish);
      const fromFish = Math.min(c.stock.fish, take);
      c.stock.fish -= fromFish;
      c.stock.meat -= take - fromFish;
      t.amount = take;
      t.fish = fromFish;
      p.thought = 'Drying meat and fish on the rack.';
      return t;
    }
    case 'bury': {
      const body = s.people.find((q) => !q.alive && !q.buried && q.band === p.band && !s.people.some((o) => o.alive && o.task?.kind === 'bury' && o.task.ref === q.id));
      if (!body) return null;
      // a body far out on the land is a long walk: not on an empty stomach, or hunger turns them back halfway
      const far = hyp(body.x - c.x, body.z - c.z);
      if (far > FAR_GRAVE && p.food < 80) return null;
      // nor in a frost that would chill them through before they were back: the body can wait for a milder day
      if (far > FAR_GRAVE && s.tempAt(p) < 15) {
        const lasts = p.warmth / ((15 - s.tempAt(p)) * 0.018);
        if (lasts < (2 * far) / (speed(s, p) * 0.4) + 40) return null;
      }
      p.thought = `Preparing ${body.name} for burial.`;
      const t = newTask(s, kind, s.tileOf(body), body.x, body.z, body.id, true);
      // a digging stick for the grave, if there's one on the pile
      const stick = s.toolFor(p, ['stick']);
      if (stick && takeFromPile(s, p, t, stick)) p.thought = `Fetching a digging stick to bury ${body.name}.`;
      return t;
    }
  }
  return null;
}

/**
 * Stop whatever they're doing: wood or food set aside for the task goes back to the store,
 * a body being carried is laid down, carried goods are put in the stores if they're close by
 * (otherwise logs are left in a pile and food is lost).
 * @param keepCarry leave carried goods with the person (the caller handles them)
 */
/** Set off for a band's camp (a new one, or home from far away). */
export function sendHome(s: Sim, p: Person, c = s.campOf(p)) {
  p.task = newTask(s, 'migrate', c.tile, c.x, c.z, -1, true);
  p.path = null;
  p.nextThink = s.tick + 400;
  p.thought = c.founded === s.tick ? `Off to make a new home at ${c.name}.` : `Heading for ${c.name}.`;
}

export function abandon(s: Sim, p: Person, keepCarry = false) {
  const t = p.task;
  const st = s.camp.stock;
  if (t) {
    if ((t.kind === 'supply' || t.kind === 'fuel') && t.amount > 0) {
      st[t.res ?? 'wood'] += t.amount;
      t.amount = 0;
      if (p.carry === CARRY.Log || p.carry === CARRY.Fiber || p.carry === CARRY.Mud || p.carry === CARRY.Stone) { p.carry = CARRY.None; p.carryAmt = 0; }
    }
    if (t.kind === 'craft' && t.amount > 0) {
      const uses = RECIPES[RECIPE_KEYS[t.ref]].uses;
      for (const [m, n] of Object.entries(uses) as [keyof typeof uses, number][]) st[m] += n;
      t.amount = 0;
    }
    if (t.kind === 'trap') untakeTraps(s, t);
    if (t.kind === 'preserve' && t.amount > 0) {
      // back as it came: fish to the fish, meat to the meat
      const fish = Math.min(t.amount, t.fish ?? 0);
      st.fish += fish;
      st.meat += t.amount - fish;
      t.amount = 0;
      if (p.carry === CARRY.Meat) { p.carry = CARRY.None; p.carryAmt = 0; }
    }
    if (t.kind === 'bury' && p.carry === CARRY.Body) {
      const body = s.byId.get(t.ref);
      if (body && !body.buried) {
        body.indoors = false;
        body.x = p.x;
        body.z = p.z;
      }
      p.carry = CARRY.None;
    }
  }
  if (p.carry === CARRY.Spear || p.carry === CARRY.Body) p.carry = CARRY.None;
  if (!keepCarry && p.carry !== CARRY.None) {
    // goods only reach the stores if they are carried there: further out, logs are left in a
    // pile for someone to haul in later, and food is lost to the land
    const st = s.storeSpot(toPile(p.carry));
    if (hyp(p.x - st.x, p.z - st.z) <= 3) deposit(s, p);
    else s.dropCarry(p);
  }
  s.releaseTask(p);
  p.task = null;
  p.path = null;
  p.indoors = false;
}

function inTransit(s: Sim, buildingId: number, m: Material) {
  let n = 0;
  for (const q of s.people) if (q.alive && q.task?.kind === 'supply' && q.task.ref === buildingId && (q.task.res ?? 'wood') === m) n += q.task.amount;
  return n;
}

/** Wood and building materials are stacked at the stockpile; only food goes into a storehouse. */
const toPile = (carry: number) => carry === CARRY.Log || carry === CARRY.Fiber || carry === CARRY.Mud || carry === CARRY.Stone;

/** The nearest of some tiles to camp that someone can get to (`tag` keeps each kind's unreachable marks apart). */
function nearestTile(s: Sim, tiles: number[], radius: number, tag: number) {
  const c = s.camp, N = s.N;
  let best = -1, bd = radius;
  for (const i of tiles) {
    const d = hyp((i % N) + 0.5 - c.x, Math.floor(i / N) + 0.5 - c.z);
    if (d >= bd) continue;
    if ((s.unreachable.get(tag * N * N - (i + 1)) ?? 0) > s.tick) continue;
    bd = d;
    best = i;
  }
  return best;
}

/** The best stand of grass or reeds to cut near a spot: fullest and nearest first. */
function nextClump(s: Sim, x: number, z: number, radius: number) {
  return s.nearestProp(x, z, radius, (k) => isFiberPlant(s.propType[k]) && s.propVal[k] >= 1, (k, d) => s.propVal[k] / (d + 4));
}

// ---------------------------------------------------------------- movement
type GoResult = 'arrived' | 'moving' | 'fail';

/** Where to stand at the end of a walk: the spot asked for, unless that is a step over into the lake. */
export function standOn(s: Sim, t: Task): [number, number] {
  const x0 = t.goal % s.N, z0 = Math.floor(t.goal / s.N);
  const k = Math.floor(t.gz) * s.N + Math.floor(t.gx);
  if (k === t.goal || (s.grid.walkable(k) && s.world.water[k] === WATER.None)) return [t.gx, t.gz];
  return [Math.min(x0 + 0.95, Math.max(x0 + 0.05, t.gx)), Math.min(z0 + 0.95, Math.max(z0 + 0.05, t.gz))];
}

function go(s: Sim, p: Person, t: Task, running = false): GoResult {
  const here = s.tileOf(p);
  if (!p.path) {
    if (here === t.goal || (t.near && Math.abs((here % s.N) - (t.goal % s.N)) <= 1 && Math.abs(Math.floor(here / s.N) - Math.floor(t.goal / s.N)) <= 1)) {
      p.path = new Int32Array(0);
    } else {
      const path = s.grid.find(here, t.goal, t.near);
      if (!path) return 'fail';
      p.path = path;
    }
    p.pathIdx = 0;
  }
  const path = p.path;
  let tx: number, tz: number;
  const last = p.pathIdx >= path.length;
  if (!last) {
    const n = path[p.pathIdx];
    // each person keeps to their own side of a tile so groups don't stack up
    const ox = (((p.look >>> 3) & 15) / 15 - 0.5) * 0.45;
    const oz = (((p.look >>> 7) & 15) / 15 - 0.5) * 0.45;
    tx = (n % s.N) + 0.5 + ox;
    tz = Math.floor(n / s.N) + 0.5 + oz;
    if (p.pathIdx === path.length - 1 && !t.near) [tx, tz] = standOn(s, t);
  } else {
    if (t.near) return 'arrived';
    [tx, tz] = standOn(s, t);
  }
  const dx = tx - p.x, dz = tz - p.z;
  const d = hyp(dx, dz);
  const sp = speed(s, p) * (running ? 1.35 : 1);
  if (d <= sp) {
    p.x = tx;
    p.z = tz;
    if (last) return 'arrived';
    p.pathIdx++;
    if (p.pathIdx >= path.length && t.near) return 'arrived';
  } else {
    p.x += (dx / d) * sp;
    p.z += (dz / d) * sp;
  }
  p.fx = tx;
  p.fz = tz;
  p.act = running ? ACT.Run : ACT.Walk;
  return 'moving';
}

function speed(s: Sim, p: Person) {
  const age = s.age(p);
  const cost = s.grid.cost[s.tileOf(p)] || 10;
  let v = 0.42 * Math.min(1, Math.max(0.35, 12 / cost));
  if (age < 8) v *= 0.8;
  else if (age >= 60) v *= 0.75;
  if (p.carry === CARRY.Meat || p.carry === CARRY.Body || p.carry === CARRY.Stone) v *= 0.65;
  else if (p.carry === CARRY.Mud) v *= 0.78;
  else if (p.carry === CARRY.Log) v *= 0.82;
  if (p.health < HEALTH.weak) v *= 0.7;
  return v;
}

function finish(s: Sim, p: Person) {
  s.releaseTask(p);
  p.task = null;
  p.path = null;
  p.nextThink = s.tick;
  if (p.carry === CARRY.Spear) p.carry = CARRY.None;
}

function face(p: Person, x: number, z: number) {
  p.fx = x;
  p.fz = z;
}

/** Put whatever they carry into the camp stores. */
export function deposit(s: Sim, p: Person) {
  const st = s.camp.stock;
  const a = p.carryAmt;
  const kind = p.carry === CARRY.Berries ? 'berries' : p.carry === CARRY.Meat ? 'meat' : p.carry === CARRY.Fish ? 'fish' : p.carry === CARRY.Log ? 'wood'
    : p.carry === CARRY.Fiber ? 'fiber' : p.carry === CARRY.Mud ? 'mud' : p.carry === CARRY.Stone ? 'stone' : '';
  if (kind) {
    st[kind] += a;
    s.book(`gathered.${kind}`, a);
    // wood brought home to a dead fire goes straight onto it, rather than waiting for someone to fetch it
    const h = kind === 'wood' ? s.hearth() : undefined;
    if (h && h.fuel <= 0 && hyp(p.x - s.camp.x, p.z - s.camp.z) < 4) {
      const put = Math.min(4, Math.floor(st.wood));
      st.wood -= put;
      s.book('burned', put);
      h.fuel = Math.min(12, h.fuel + put);
      s.buildingsVersion++;
      p.thought = 'Put an armful of wood straight on the dead fire.';
    }
    // handling the food and the thatch is what gives people ideas about keeping them
    if (kind === 'berries' || kind === 'meat' || kind === 'fish') s.practise(p, 'store_food', a);
    if (kind === 'meat' || kind === 'fish') s.practise(p, 'store_meat', a);
    if (kind === 'berries') s.practise(p, 'store_berries', a);
    if (kind === 'fiber') s.practise(p, 'thatch', a);
  }
  p.carry = CARRY.None;
  p.carryAmt = 0;
}

/** On the way back to the stores with goods: they see the delivery through unless it's an emergency. */
export function delivering(p: Person) {
  return p.task?.homeAt !== undefined && p.carry !== CARRY.None;
}

function goStore(s: Sim, p: Person, t: Task, next: number) {
  const st = s.storeSpot(toPile(p.carry));
  t.goal = st.tile;
  t.gx = st.x + (((p.look >>> 11) & 7) / 7 - 0.5) * 0.6;
  t.gz = st.z + (((p.look >>> 14) & 7) / 7 - 0.5) * 0.6;
  t.near = false;
  t.stage = next;
  t.homeAt = s.tick;
  p.path = null;
}

/** Ask the renderer to play a one-off move (a spear thrust, a stab into the water). */
function flash(p: Person, code: number) {
  p.flash = ((((p.flash ?? 0) >> 2) + 1) % 4096) * 4 + code;
}

/**
 * Plan the day's round of the traps: every trap set out is checked (and taken up where the land around
 * it is trapped or fished out), then traps from the pile, and those taken up, are set where the hares
 * run thickest or the fish are, near camp. Three numbers a stop: trap id, tile to stand on, and the
 * tile to set it on (-1: check it, -3: check it and take it up).
 */
function trapRoute(s: Sim): number[] {
  const c = s.camp, N = s.N;
  const mine = s.toolsOf(c).filter((i) => TRAP_KINDS.includes(i.kind) && i.holder < 0);
  const taken = new Set(s.items.filter((i) => (i.tile ?? -1) >= 0).map((i) => i.tile!));
  const frozen = freshFrozen(s.tick);
  const bad = (stand: number) => (s.unreachable.get(-3 * N * N - (stand + 1)) ?? 0) > s.tick;
  // the bank to stand on to reach a fish trap in the water
  const bankOf = (w: number) => {
    for (const [dx, dz] of DIRS4) {
      const x = (w % N) + dx, z = Math.floor(w / N) + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      if (s.world.water[i] === WATER.None && s.grid.walkable(i)) return i;
    }
    return -1;
  };
  const checks: number[][] = [];
  const toSet: Item[] = [];
  for (const it of mine) {
    const w = it.tile ?? -1;
    if (w >= 0) {
      const stand = it.kind === 'snare' ? w : bankOf(w);
      if (stand < 0 || bad(stand)) continue;
      const spent = !it.catch && (it.kind === 'snare' ? s.game[w] < 1 : s.fish[w] < 1.5 || (frozen && s.world.water[w] !== WATER.Sea));
      checks.push([it.id, stand, spent ? -3 : -1]);
      if (spent) toSet.push(it);
    } else if (w === -1) toSet.push(it);
  }
  const sets: number[][] = [];
  const near = (i: number, r: number) => hyp((i % N) + 0.5 - c.x, Math.floor(i / N) + 0.5 - c.z) < r;
  for (const it of toSet.slice(0, 6)) {
    let best = -1, bestStand = -1, bestS = -Infinity;
    if (it.kind === 'snare') {
      const cx = Math.floor(c.x), cz = Math.floor(c.z);
      for (let z = Math.max(0, cz - 10); z <= Math.min(N - 1, cz + 10); z++)
        for (let x = Math.max(0, cx - 10); x <= Math.min(N - 1, cx + 10); x++) {
          const i = z * N + x;
          if (s.gameCap[i] <= 0 || s.game[i] < 1.5 || taken.has(i) || bad(i)) continue;
          const d = hyp(x + 0.5 - c.x, z + 0.5 - c.z);
          // not in the middle of camp, and spread out: a snare on every bush catches nothing
          if (d < 3 || d > 10) continue;
          if (taken.has(i - 1) || taken.has(i + 1) || taken.has(i - N) || taken.has(i + N)) continue;
          const sc = (s.game[i] / s.gameCap[i]) * 3 - d * 0.15;
          if (sc > bestS) { bestS = sc; best = i; bestStand = i; }
        }
    } else {
      for (const spot of s.fishingSpots) {
        if (!near(spot, 14) || bad(spot)) continue;
        for (const [dx, dz] of DIRS4) {
          const x = (spot % N) + dx, z = Math.floor(spot / N) + dz;
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const w = z * N + x;
          if (s.fishCap[w] <= 0 || s.fish[w] < 2 || taken.has(w) || (frozen && s.world.water[w] !== WATER.Sea)) continue;
          const sc = s.fish[w] - hyp(x + 0.5 - c.x, z + 0.5 - c.z) * 0.2;
          if (sc > bestS) { bestS = sc; best = w; bestStand = spot; }
        }
      }
    }
    if (best < 0) continue;
    taken.add(best);
    sets.push([it.id, bestStand, best]);
  }
  // nearest stop next, from camp: the checks first, then the setting
  const order = (stops: number[][], x: number, z: number) => {
    const out: number[][] = [];
    const left = stops.slice();
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((st, k) => {
        const d = hyp((st[1] % N) + 0.5 - x, Math.floor(st[1] / N) + 0.5 - z);
        if (d < bd) { bd = d; bi = k; }
      });
      const [st] = left.splice(bi, 1);
      out.push(st);
      x = (st[1] % N) + 0.5;
      z = Math.floor(st[1] / N) + 0.5;
    }
    return out;
  };
  const a = order(checks, c.x, c.z);
  const last = a[a.length - 1];
  const b = order(sets, last ? (last[1] % N) + 0.5 : c.x, last ? Math.floor(last[1] / N) + 0.5 : c.z);
  return [...a, ...b].flat();
}

/** Traps still in the basket when the round ends, or is given up, go back on the pile. */
function untakeTraps(s: Sim, t: Task) {
  const route = t.route ?? [];
  for (let k = 0; k < route.length; k += 3) {
    const it = s.items.find((i) => i.id === route[k]);
    if (it?.tile === -2) delete it.tile;
  }
}

/** Off to the bush a picking task is for. */
function aimAtBush(s: Sim, p: Person, t: Task) {
  t.stage = 0;
  t.goal = s.propTile[t.ref];
  t.gx = s.propX[t.ref] + 0.3;
  t.gz = s.propZ[t.ref] + 0.22;
  t.near = false;
  p.path = null;
}

/** A digging trip or a grave wears the stick down; when it breaks, they say so. */
function wearStick(s: Sim, p: Person, stick: Item) {
  if (!s.wearTool(stick)) return;
  s.remember(p, 'tool_broke', -1, 0.2, -1, 'Their digging stick broke.');
  s.event('tool', `${p.name}'s digging stick broke.`, [p.id], p.x, p.z, 1);
}

// ---------------------------------------------------------------- task execution
export function runTask(s: Sim, p: Person) {
  const t = p.task!;
  const c = s.camp;
  const r = s.rAi;
  // anything left half-done for too long is abandoned (the walk home with goods gets its own clock)
  const home = delivering(p);
  if (home ? s.tick - t.homeAt! > 1200 : s.tick - t.started > 520 && t.kind !== 'sleep') {
    abandon(s, p);
    p.nextThink = s.tick;
    return;
  }
  // starving on the way home with food: eat a little of it rather than drop it
  if (home && p.food < 20 && p.carryAmt >= 1 && (p.carry === CARRY.Berries || p.carry === CARRY.Meat || p.carry === CARRY.Fish)) {
    p.carryAmt -= 1;
    p.food = clamp(p.food + 48);
    p.thought = 'Ate some of what they were carrying home.';
  }
  const moving = (res: GoResult) => {
    if (res === 'fail') {
      // nobody tries this target again for a while (it is across a river, up a cliff...)
      const propTask = PROP_TASKS.includes(t.kind);
      if (propTask && t.ref >= 0) s.unreachable.set(t.ref, s.tick + 2 * TICKS_PER_DAY);
      if (t.kind === 'fish') s.unreachable.set(-(t.goal + 1), s.tick + 2 * TICKS_PER_DAY);
      if (t.kind === 'trap' && t.stage >= 0) s.unreachable.set(-3 * s.N * s.N - (t.goal + 1), s.tick + 2 * TICKS_PER_DAY);
      if ((t.kind === 'dig' || t.kind === 'quarry') && t.stage >= 0) s.unreachable.set((t.kind === 'dig' ? -1 : -2) * s.N * s.N - (t.goal + 1), s.tick + 2 * TICKS_PER_DAY);
      abandon(s, p);
      p.nextThink = s.tick;
      return true;
    }
    return res === 'moving';
  };

  switch (t.kind) {
    case 'eat': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 8;
      }
      p.act = ACT.Eat;
      face(p, c.x, c.z);
      if (--t.timer > 0) return;
      // a portion is enough to fill about half a belly: the very hungry eat more, up to two helpings
      const portion = s.age(p) < 12 ? 0.6 : s.has(p, 'greedy') ? 1.25 : 1;
      // while the band rations its stores, only the very hungry get a full share
      const small = c.rationing && p.food >= 35;
      const want = small ? portion * 0.5 : portion * Math.max(1, Math.min(2, (88 - p.food) / 48));
      let got = 0;
      const st = c.stock;
      for (const k of ['berries', 'fish', 'meat', 'preserved'] as const) {
        const take = Math.min(st[k], want - got);
        st[k] -= take;
        s.book(`eaten.${k}`, take);
        got += take;
        if (got >= want - 1e-6) break;
      }
      p.food = clamp(p.food + 48 * (got / portion));
      // a shared meal is good company
      const company = s.people.filter((q) => q !== p && q.alive && (q.act === ACT.Eat || q.act === ACT.Sit || q.act === ACT.Warm) && hyp(q.x - p.x, q.z - p.z) < 2.6);
      if (company.length) {
        p.belonging = clamp(p.belonging + 6 + company.length * 2);
        for (const q of company) s.adjust(p, q, 0.6);
      }
      p.thought = got < want * 0.5 ? 'There was hardly anything to eat.' : small ? 'A small share. The stores have to last till spring.' : 'Ate well.';
      finish(s, p);
      return;
    }
    case 'eatwild': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 10;
      }
      p.act = ACT.Gather;
      face(p, s.propX[t.ref], s.propZ[t.ref]);
      if (--t.timer > 0) return;
      const take = Math.min(2, s.propVal[t.ref]);
      s.propVal[t.ref] -= take;
      s.propsVersion++;
      p.food = clamp(p.food + 22 * take);
      finish(s, p);
      return;
    }
    case 'sleep': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        p.indoors = t.ref >= 0;
      }
      p.act = ACT.Sleep;
      p.rest = clamp(p.rest + (p.indoors ? 1.35 : 0.85));
      p.thought = p.indoors ? 'Asleep at home.' : 'Asleep by the fire.';
      const dark = isDark(s.tick);
      if ((!dark && p.rest >= 96) || (!dark && hourOf(s.tick) > 7.5 && p.rest > 65) || s.tick - t.started > 150) {
        p.indoors = false;
        finish(s, p);
      }
      return;
    }
    case 'warm': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 40;
        p.indoors = t.ref >= 0;
      }
      p.act = t.ref >= 0 ? ACT.Sit : ACT.Warm;
      face(p, c.x, c.z);
      if (t.ref >= 0) p.warmth = clamp(p.warmth + 0.5);
      if (--t.timer <= 0 || p.warmth > 90) {
        p.indoors = false;
        finish(s, p);
      }
      return;
    }
    case 'socialize': {
      const q = s.byId.get(t.ref);
      if (!q || !q.alive || q.indoors) return finish(s, p);
      if (t.stage === 0) {
        // keep up with them as they move about
        if (s.tick % 8 === 0 && s.tileOf(q) !== t.goal) {
          t.goal = s.tileOf(q);
          p.path = null;
        }
        if (hyp(q.x - p.x, q.z - p.z) > 1.3) {
          if (moving(go(s, p, t))) return;
          if (hyp(q.x - p.x, q.z - p.z) > 1.8) return;
        }
        t.stage = 1;
        t.timer = 16;
        p.thought = `Talking with ${q.name}.`;
      }
      p.act = ACT.Chat;
      face(p, q.x, q.z);
      if (q.act === ACT.Idle || q.act === ACT.Sit) {
        q.act = ACT.Chat;
        face(q, p.x, p.z);
      }
      if (--t.timer > 0) return;
      p.belonging = clamp(p.belonging + 24 + (s.has(q, 'charismatic') ? 8 : 0));
      q.belonging = clamp(q.belonging + 12 + (s.has(p, 'charismatic') ? 6 : 0));
      if (s.has(p, 'cruel') && r.chance(0.22)) {
        s.adjust(q, p, -9);
        s.adjust(p, q, -2);
        s.remember(q, 'insulted', -8, 0.6, p.id, `${p.name} mocked them.`);
        p.thought = `Mocked ${q.name}.`;
      } else {
        const gain = 2 + r.int(0, 4) + (s.has(p, 'kind') ? 1 : 0);
        s.adjust(p, q, gain);
        s.adjust(q, p, gain - 1);
      }
      finish(s, p);
      return;
    }
    case 'idle': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 25 + r.int(0, 20);
      }
      p.act = ACT.Sit;
      face(p, c.x, c.z);
      if (--t.timer <= 0) finish(s, p);
      return;
    }
    case 'play': {
      if (t.stage === 0) {
        if (moving(go(s, p, t, true))) return;
        t.stage = 1;
        t.timer = 6 + r.int(0, 10);
      }
      p.act = ACT.Play;
      if (--t.timer <= 0) finish(s, p);
      return;
    }
    case 'migrate': {
      if (moving(go(s, p, t))) return;
      p.thought = `Home at ${c.name}.`;
      finish(s, p);
      return;
    }
    case 'swim': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 50 + r.int(0, 40);
        t.amount = 0;
        p.thought = 'Cooling off in the water.';
      }
      // paddle about a little, then float, then paddle somewhere else
      const w = s.tileOf(p);
      if (t.amount > 0) {
        t.amount--;
        p.act = ACT.Idle;
      } else {
        const dx = t.gx - p.x, dz = t.gz - p.z, d = hyp(dx, dz), sp = speed(s, p);
        if (d <= sp) {
          p.x = t.gx;
          p.z = t.gz;
          t.amount = 4 + r.int(0, 8);
          // somewhere else in this stretch of water
          for (let k = 0; k < 4; k++) {
            const nx = p.x + r.range(-1.2, 1.2), nz = p.z + r.range(-1.2, 1.2);
            const nt = Math.floor(nz) * s.N + Math.floor(nx);
            if (nx > 0 && nz > 0 && nx < s.N && nz < s.N && s.world.water[nt] !== WATER.None && s.grid.step(w, nt)) { t.gx = nx; t.gz = nz; break; }
          }
        } else {
          p.x += (dx / d) * sp;
          p.z += (dz / d) * sp;
          p.fx = t.gx;
          p.fz = t.gz;
          p.act = ACT.Walk;
        }
      }
      p.warmth = clamp(p.warmth - 0.04);
      if (--t.timer <= 0) {
        // the water is not always kind
        if (r.chance(s.age(p) < 12 ? 0.006 : 0.0015)) return s.kill(p, 'drowning');
        p.mood = clamp(p.mood + 4);
        const others = s.people.some((q) => q !== p && q.alive && q.task?.kind === 'swim' && hyp(q.x - p.x, q.z - p.z) < 4);
        if (others) p.belonging = clamp(p.belonging + 6);
        if (!p.memories.some((m) => m.kind === 'swim')) s.remember(p, 'swim', 8, 1, -1, others ? 'Swam with the others on a hot day.' : 'Swam alone on a hot day.');
        finish(s, p);
      }
      return;
    }
    case 'mourn': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 30;
      }
      p.act = ACT.Mourn;
      if (--t.timer <= 0) finish(s, p);
      return;
    }
    case 'forage': {
      if (t.stage === -1) {
        // to the pile for a basket, then out to the bush
        if (moving(go(s, p, t))) return;
        aimAtBush(s, p, t);
        p.thought = 'Off to pick berries with a basket.';
        return;
      }
      if (t.stage === 0) {
        if (!s.propAlive[t.ref] || s.propVal[t.ref] < 0.5) {
          // someone picked it bare first: take what is in the basket home
          if (p.carry !== CARRY.Berries) return finish(s, p);
          s.reserved.delete(t.ref);
          goStore(s, p, t, 2);
          return;
        }
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = Math.max(8, Math.round(16 * (1.2 - p.skills[0] * 0.02)));
      }
      if (t.stage === 1) {
        p.act = ACT.Gather;
        face(p, s.propX[t.ref], s.propZ[t.ref]);
        if (--t.timer > 0) return;
        const basket = s.heldBy(p)?.kind === 'basket';
        const hold = basket ? BASKET_HOLDS : 2.6 + p.skills[SK.forage] * 0.12;
        const had = p.carry === CARRY.Berries ? p.carryAmt : 0;
        const take = Math.min(s.propVal[t.ref], hold - had, 2.6 + p.skills[SK.forage] * 0.12);
        s.propVal[t.ref] -= take;
        s.propsVersion++;
        s.reserved.delete(t.ref);
        p.carry = CARRY.Berries;
        p.carryAmt = had + take;
        // watching the hares in the undergrowth while picking
        s.practise(p, 'forage');
        if (p.food < 45 && take >= 1) {
          p.carryAmt -= 0.5;
          p.food = clamp(p.food + 20);
        }
        train(p, 'forage.pick');
        // with room left in the basket, on to the next bush near by
        const next = basket && p.carryAmt < BASKET_HOLDS - 1
          ? s.nearestProp(p.x, p.z, 5, (k) => isBerry(s.propType[k]) && s.propVal[k] >= 1 && hyp(s.propX[k] - c.x, s.propZ[k] - c.z) < 30)
          : -1;
        if (next >= 0) {
          s.reserved.set(next, p.id);
          t.ref = next;
          // a fresh clock for each bush, so a long round isn't given up as stuck
          t.started = s.tick;
          p.nextThink = s.tick + 600;
          aimAtBush(s, p, t);
          p.thought = 'Picking berries into a basket.';
          return;
        }
        goStore(s, p, t, 2);
        p.thought = basket ? 'Bringing a full basket of berries back to camp.' : 'Bringing berries back to camp.';
      }
      if (t.stage === 2) {
        if (moving(go(s, p, t))) return;
        deposit(s, p);
        const basket = s.heldBy(p);
        if (basket?.kind === 'basket' && s.wearTool(basket)) {
          s.remember(p, 'tool_broke', -1, 0.2, -1, 'Their basket wore through.');
          s.event('tool', `${p.name}'s basket wore through.`, [p.id], p.x, p.z, 1);
        }
        finish(s, p);
      }
      return;
    }
    case 'reap': {
      if (t.stage === 0) {
        if (!s.propAlive[t.ref] || s.propVal[t.ref] < 0.5) {
          // someone cut it first: take what is in hand home
          if (p.carry === CARRY.Fiber) goStore(s, p, t, 2);
          else return finish(s, p);
        } else {
          if (moving(go(s, p, t))) return;
          t.stage = 1;
          t.timer = Math.max(8, Math.round(14 * (1.2 - p.skills[SK.forage] * 0.02)));
        }
      }
      if (t.stage === 1) {
        p.act = ACT.Gather;
        face(p, s.propX[t.ref], s.propZ[t.ref]);
        if (--t.timer > 0) return;
        const take = Math.min(s.propVal[t.ref], 2 + p.skills[SK.forage] * 0.08);
        s.propVal[t.ref] -= take;
        s.propsVersion++;
        s.reserved.delete(t.ref);
        p.carry = CARRY.Fiber;
        p.carryAmt += take;
        train(p, 'reap');
        // an armful is more than one tussock: cut the next one close by before walking back
        const next = p.carryAmt < 5 ? nextClump(s, p.x, p.z, 2.5) : -1;
        if (next >= 0 && !s.reserved.has(next)) {
          s.reserved.set(next, p.id);
          t.ref = next;
          t.goal = s.propTile[next];
          t.gx = s.propX[next] + 0.28;
          t.gz = s.propZ[next] + 0.2;
          t.stage = 0;
          p.path = null;
          return;
        }
        goStore(s, p, t, 2);
        p.thought = 'Bringing an armful of grass back to camp.';
      }
      if (t.stage === 2) {
        if (moving(go(s, p, t))) return;
        deposit(s, p);
        finish(s, p);
      }
      return;
    }
    case 'dig':
    case 'quarry': {
      const dig = t.kind === 'dig';
      if (t.stage === -1) {
        // to the pile for a digging stick, then down to the water
        if (moving(go(s, p, t))) return;
        t.stage = 0;
        t.goal = t.ref;
        t.gx = (t.ref % s.N) + 0.5;
        t.gz = Math.floor(t.ref / s.N) + 0.5;
        p.path = null;
        p.thought = 'Off to dig with a digging stick.';
        return;
      }
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = Math.round((dig ? 22 : 34) * (1.2 - p.skills[SK.build] * 0.02));
      }
      if (t.stage === 1) {
        p.act = dig ? ACT.Dig : ACT.Chop;
        if (--t.timer > 0) return;
        p.carry = dig ? CARRY.Mud : CARRY.Stone;
        // with a digging stick a full basket; scraping with bare hands, two loads
        const stick = dig ? s.heldBy(p) : undefined;
        p.carryAmt = dig ? (stick?.kind === 'stick' ? 3 : 2) : 2;
        if (dig && stick?.kind === 'stick') wearStick(s, p, stick);
        else if (dig) s.practise(p, 'dig_hand');
        train(p, 'dig');
        goStore(s, p, t, 2);
        p.thought = dig ? 'Carrying a basket of mud back to camp.' : 'Carrying stone back to camp.';
      }
      if (moving(go(s, p, t))) return;
      deposit(s, p);
      finish(s, p);
      return;
    }
    case 'trap': {
      const route = t.route ?? [];
      const aim = () => {
        const stand = route[(t.step ?? 0) * 3 + 1];
        t.goal = stand;
        t.gx = (stand % s.N) + 0.5;
        t.gz = Math.floor(stand / s.N) + 0.5;
        t.near = false;
        t.stage = 0;
        p.path = null;
      };
      if (t.stage === -1) {
        if (moving(go(s, p, t))) return;
        aim();
        p.thought = 'Off round the traps.';
        return;
      }
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 8;
      }
      if (t.stage === 1) {
        p.act = ACT.Gather;
        if (--t.timer > 0) return;
        const k = (t.step ?? 0) * 3;
        const it = s.items.find((i) => i.id === route[k]);
        const action = route[k + 2];
        if (it && it.band === p.band) {
          if (action >= 0) {
            if (it.tile === -2) {
              it.tile = action;
              it.catch = 0;
              p.thought = it.kind === 'snare' ? 'Set a snare across a hare run.' : 'Set a fish trap in the shallows.';
            }
          } else if ((it.tile ?? -1) >= 0) {
            const got = it.catch ?? 0;
            if (got > 0) {
              if (it.kind === 'snare') t.amount += got;
              else t.fish = (t.fish ?? 0) + got;
              train(p, 'trap.catch');
            }
            it.catch = 0;
            p.thought = got > 0 ? (it.kind === 'snare' ? 'A hare in the snare.' : `${got} fish in the trap.`) : it.kind === 'snare' ? 'Nothing in this snare.' : 'The trap is empty.';
            // nothing left to catch here: take it up, to set somewhere better
            if (action === -3) it.tile = -2;
          }
        }
        t.step = (t.step ?? 0) + 1;
        if (t.step * 3 < route.length) return aim();
        untakeTraps(s, t);
        const meat = t.amount, fish = t.fish ?? 0;
        if (meat + fish <= 0) {
          p.thought = 'Nothing in the traps today.';
          return finish(s, p);
        }
        s.book('trapped', meat + fish);
        p.carry = meat > 0 ? CARRY.Meat : CARRY.Fish;
        p.carryAmt = meat > 0 ? meat : fish;
        if (meat <= 0) t.fish = 0;
        t.amount = 0;
        goStore(s, p, t, 2);
        p.thought = meat > 0 ? 'Carrying the catch from the snares home.' : 'Carrying fish from the traps home.';
      }
      if (moving(go(s, p, t))) return;
      deposit(s, p);
      // fish carried along with the hares
      if ((t.fish ?? 0) > 0) {
        c.stock.fish += t.fish!;
        s.book('gathered.fish', t.fish!);
        t.fish = 0;
      }
      finish(s, p);
      return;
    }
    case 'craft': {
      const key = RECIPE_KEYS[t.ref], rc = RECIPES[key];
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = Math.max(Math.round(rc.work * 0.42), Math.round(rc.work * (1.2 - p.skills[rc.skill] * 0.025)));
        if (s.hearthLit()) p.thought = rc.thought.replace(/\.$/, ' by the fire.');
      }
      p.act = ACT.Sit;
      face(p, c.x, c.z);
      if (--t.timer > 0) return;
      if (rc.makes === 'cordage') {
        c.stock.cordage += 1;
        s.book('twisted', rc.uses.fiber ?? 0);
      } else {
        s.items.push({ id: s.newId(), kind: rc.makes, band: p.band, holder: -1, wear: 0, made: s.tick, maker: p.id });
        s.book(`made.${rc.makes}`, 1);
      }
      t.amount = 0;
      trainSkill(p, rc.skill, rc.grow);
      p.thought = rc.done;
      finish(s, p);
      return;
    }
    case 'fell': {
      if (t.stage === -1) {
        // to the pile for the tool, then out to the tree
        if (!s.propAlive[t.ref]) return finish(s, p);
        if (moving(go(s, p, t))) return;
        t.stage = 0;
        t.goal = s.propTile[t.ref];
        t.gx = s.propX[t.ref] + 0.34;
        t.gz = s.propZ[t.ref] + 0.18;
        p.path = null;
        p.thought = `Off to fell a tree with ${s.heldBy(p)?.kind === 'axe' ? 'an axe' : 'a chopper'}.`;
        return;
      }
      if (t.stage === 0) {
        if (!s.propAlive[t.ref]) return finish(s, p);
        // the tool went back to the pile (or broke) while they were away: start over
        const tool = s.heldBy(p);
        if (!tool || (tool.kind === 'chopper' && treeStage(s.propType[t.ref]) > 1)) return finish(s, p);
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        const st = treeStage(s.propType[t.ref]);
        // a tree someone already half cut through needs only the rest; a chopper takes twice as long
        const total = Math.round([10, 22, 40, 55][st] * (1.25 - p.skills[SK.wood] * 0.03) * (tool.kind === 'chopper' ? 2 : 1));
        t.timer = Math.max(1, total - (s.chopped.get(t.ref) ?? 0));
        if (s.chopped.has(t.ref)) p.thought = 'Finishing a tree someone started.';
      }
      if (t.stage === 1) {
        p.act = ACT.Chop;
        face(p, s.propX[t.ref], s.propZ[t.ref]);
        s.chopped.set(t.ref, (s.chopped.get(t.ref) ?? 0) + 1);
        if (--t.timer > 0) return;
        const k = t.ref;
        const type = s.propType[k];
        const sp = Math.floor(type / 12);
        // a big tree's bark is stripped too, for kindling
        const wood = WOOD_BY_STAGE[treeStage(type)] + (treeStage(type) >= 2 ? BARK : 0);
        const stump = s.addProp(STUMP_BASE + sp, s.propX[k], s.propY[k], s.propZ[k], s.propRot[k], s.propScale[k]);
        const what = `${STAGE_WORD[treeStage(type)]} ${['pine', 'oak', 'birch'][sp]}`;
        s.propNote.set(stump, `${art(what) === 'an' ? 'An' : 'A'} ${what}, felled by ${p.name} in the ${s.when(s.tick)}.`);
        s.removeProp(k);
        s.stats.felled++;
        train(p, 'fell');
        const tool = s.heldBy(p);
        if (tool) {
          // hacking through a trunk with a stone in the fist is what gives people the idea of a haft
          if (tool.kind === 'chopper') s.practise(p, 'fell_chopper');
          if (s.wearTool(tool)) {
            s.remember(p, 'tool_broke', -2, 0.3, -1, `Their ${tool.kind === 'axe' ? 'axe' : 'chopper'} broke.`);
            s.event('tool', `${p.name}'s ${tool.kind === 'axe' ? 'stone axe' : 'hand chopper'} broke on ${art(what)} ${what}.`, [p.id], p.x, p.z, 1);
          }
        }
        if (r.chance(0.006)) {
          p.health -= 35;
          s.remember(p, 'injured', -15, 1, -1, 'Hurt by a falling tree.');
          s.event('injury', `${p.name} was hurt by a falling tree.`, [p.id], p.x, p.z, 2);
          if (p.health <= 0) return s.kill(p, 'accident');
        }
        const carryNow = Math.min(6, wood);
        if (wood > carryNow) {
          const lp = s.addProp(LOGS, s.propX[k] + 0.15, s.propY[k], s.propZ[k] + 0.12, s.propRot[k], 1);
          s.propNote.set(lp, `Cut from ${art(what)} ${what} that ${p.name} felled.`);
          s.propVal[lp] = wood - carryNow;
        }
        p.carry = CARRY.Log;
        p.carryAmt = carryNow;
        goStore(s, p, t, 2);
        p.thought = 'Carrying logs to camp.';
      }
      if (t.stage === 2) {
        if (moving(go(s, p, t))) return;
        deposit(s, p);
        finish(s, p);
      }
      return;
    }
    case 'deadwood': {
      if (t.stage === 0) {
        if (!s.propAlive[t.ref] || s.deadwoodTaken.has(t.ref)) return finish(s, p);
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 14;
      }
      if (t.stage === 1) {
        p.act = ACT.Gather;
        face(p, s.propX[t.ref], s.propZ[t.ref]);
        if (--t.timer > 0) return;
        const k = t.ref;
        s.deadwoodTaken.set(k, s.tick + TICKS_PER_DAY * 48);
        s.reserved.delete(k);
        p.carry = CARRY.Log;
        // under a pine, a few cones go in with the branches
        const cones = treeSpecies(s.propType[k]) === 0 && treeStage(s.propType[k]) >= 1 ? CONES : 0;
        p.carryAmt = DEADWOOD_BY_STAGE[treeStage(s.propType[k])] + cones;
        train(p, 'deadwood');
        goStore(s, p, t, 2);
        p.thought = cones ? 'Bringing branches and pine cones back to camp.' : 'Bringing firewood back to camp.';
      }
      if (t.stage === 2) {
        if (moving(go(s, p, t))) return;
        deposit(s, p);
        finish(s, p);
      }
      return;
    }
    case 'haul': {
      if (t.stage === 0) {
        if (!s.propAlive[t.ref]) return finish(s, p);
        if (moving(go(s, p, t))) return;
        const take = Math.min(6, s.propVal[t.ref]);
        s.propVal[t.ref] -= take;
        if (s.propVal[t.ref] <= 0.01) s.removeProp(t.ref);
        else s.reserved.delete(t.ref);
        p.carry = CARRY.Log;
        p.carryAmt = take;
        goStore(s, p, t, 1);
      }
      if (moving(go(s, p, t))) return;
      deposit(s, p);
      finish(s, p);
      return;
    }
    case 'hunt': {
      const d = s.deer.find((q) => q.id === t.ref);
      if (t.stage === 0) {
        if (!d || !d.alive) return finish(s, p);
        if (s.tick > (t.deadline ?? t.started + 110)) {
          p.thought = 'The deer got away.';
          return finish(s, p);
        }
        const dist = hyp(d.x - p.x, d.z - p.z);
        if (dist > 2.9) {
          if (s.tick % 10 === 0 && s.tileOf(d) !== t.goal) {
            t.goal = s.tileOf(d);
            p.path = null;
          }
          const res = go(s, p, t);
          if (res === 'fail') return finish(s, p);
          p.act = ACT.Hunt;
          return;
        }
        // in range: throw
        p.act = ACT.Hunt;
        face(p, d.x, d.z);
        if (t.timer > 0) {
          t.timer--;
          return;
        }
        t.timer = 5;
        if (r.chance(0.006)) {
          p.health -= 40;
          s.remember(p, 'injured', -18, 1, -1, 'Gored by a stag.');
          s.event('injury', `${p.name} was gored by a stag.`, [p.id], p.x, p.z, 2);
          if (p.health <= 0) return s.kill(p, 'hunting');
        }
        const chance = 0.15 + p.skills[SK.hunt] * 0.022 + (s.has(p, 'brave') ? 0.05 : 0);
        flash(p, FLASH.Thrust);
        if (r.next() < chance) {
          d.alive = false;
          p.kills++;
          s.stats.kills++;
          // once in a long while the whole herd is driven into the hunters' hands
          if (r.chance(0.02)) {
            const more = s.deer.filter((q) => q.alive && q.herd === d.herd && hyp(q.x - d.x, q.z - d.z) < 4).slice(0, 2);
            // the other hunters close by each shoulder a carcass; any nobody can carry is left to the land
            const bearers = s.people.filter((q) => q !== p && q.alive && q.band === p.band && q.task?.kind === 'hunt' && q.task.stage === 0 && hyp(q.x - d.x, q.z - d.z) < 8);
            for (const q of more) {
              q.alive = false;
              s.stats.kills++;
              const h = bearers.shift();
              if (!h) continue;
              h.carry = CARRY.Meat;
              h.carryAmt = q.fawn ? 4 : 8;
              goStore(s, h, h.task!, 1);
              h.thought = 'Carrying the kill home.';
            }
            if (more.length) {
              s.event('great_hunt', `A great hunt: ${p.name} and the hunters of ${c.name} brought down ${more.length + 1} deer in one day.`, [p.id], p.x, p.z, 4);
              for (const q of s.members()) s.remember(q, 'feast', 15, 1, p.id, `Feasted after ${p.name}'s great hunt.`);
            }
          }
          train(p, 'hunt.kill');
          s.practise(p, 'hunt');
          if (p.kills === 1) s.remember(p, 'first_kill', 18, 2, -1, 'Brought down their first deer.');
          if (s.stats.kills === 1) s.event('hunt', `${p.name} brought down the band's first deer at ${s.camp.name}.`, [p.id], p.x, p.z, 3);
          p.carry = CARRY.Meat;
          p.carryAmt = d.fawn ? 4 : 8;
          goStore(s, p, t, 1);
          p.thought = 'Carrying the kill home.';
        } else {
          train(p, 'hunt.miss');
          s.practise(p, 'hunt', 0.2);
          p.thought = 'Missed. Following the herd.';
          p.path = null;
        }
        return;
      }
      if (moving(go(s, p, t))) return;
      deposit(s, p);
      finish(s, p);
      return;
    }
    case 'fish': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 30;
        t.amount = 0;
      }
      if (t.stage === 1) {
        const w = t.ref;
        p.act = ACT.Fish;
        face(p, (w % s.N) + 0.5, Math.floor(w / s.N) + 0.5);
        // a stab at a fish that got away now and then while waiting (just looks; decides nothing)
        if (t.timer % 9 === 4 && t.timer > 6) flash(p, FLASH.Stab);
        if (--t.timer > 0) return;
        // in winter the fish lie deep and slow, and cold hands miss more
        const chance = 0.42 + p.skills[SK.fish] * 0.028 + (s.fish[w] / Math.max(1, s.fishCap[w])) * 0.18 - (seasonOf(s.tick) === 3 ? 0.12 : 0);
        flash(p, FLASH.Stab);
        if (r.next() < chance) {
          const got = Math.min(s.fish[w], Math.round((3 + Math.floor(p.skills[SK.fish] / 4)) * (seasonOf(s.tick) === 3 ? WINTER_CATCH * (s.bitterWinter() ? BITTER_CATCH : 1) : 1)));
          s.fish[w] -= got;
          train(p, 'fish.catch');
          // standing in the shallows with reeds to hand is what makes someone think of a woven trap
          if (c.stock.fiber >= 3) s.practise(p, 'fish_fiber', got < 3 ? 1.5 : 1);
          p.carry = CARRY.Fish;
          p.carryAmt = got;
          goStore(s, p, t, 2);
          p.thought = 'Bringing fish home.';
        } else if (t.amount === 0) {
          t.amount = 1;
          t.timer = 24;
          p.thought = 'Nothing biting yet.';
          train(p, 'fish.miss');
        } else {
          p.thought = 'Caught nothing today.';
          if (c.stock.fiber >= 3) s.practise(p, 'fish_fiber', 1.5);
          return finish(s, p);
        }
      }
      if (t.stage === 2) {
        if (moving(go(s, p, t))) return;
        deposit(s, p);
        finish(s, p);
      }
      return;
    }
    case 'supply': {
      const b = s.buildings.find((q) => q.id === t.ref);
      if (!b || b.built) {
        // the wood goes back to the store, logs in hand included (and only once)
        abandon(s, p);
        p.nextThink = s.tick;
        return;
      }
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        p.carry = t.res === 'mud' ? CARRY.Mud : t.res === 'stone' ? CARRY.Stone : t.res ? CARRY.Fiber : CARRY.Log;
        p.carryAmt = t.amount;
        t.stage = 1;
        t.goal = b.tile;
        t.gx = b.x + 0.5;
        t.gz = b.z + 0.5;
        t.near = true;
        p.path = null;
      }
      if (moving(go(s, p, t))) return;
      const m = t.res ?? 'wood';
      b[m] += t.amount;
      s.book(m === 'wood' ? 'built' : `built.${m}`, t.amount);
      p.carry = CARRY.None;
      p.carryAmt = 0;
      t.amount = 0;
      s.buildingsVersion++;
      finish(s, p);
      return;
    }
    case 'build': {
      const b = s.buildings.find((q) => q.id === t.ref);
      if (!b || b.built) return finish(s, p);
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 70;
      }
      p.act = ACT.Build;
      face(p, b.x + 0.5, b.z + 0.5);
      b.work += (1 + p.skills[SK.build] * 0.06) * (s.age(p) >= 58 ? 0.7 : 1);
      if (!b.builders.includes(p.id)) b.builders.push(p.id);
      if (s.tick % 10 === 0) s.buildingsVersion++;
      if (s.tick % 20 === 0) {
        train(p, 'build');
        s.practise(p, 'build');
        if (b.kind === 'leanto') s.practise(p, 'leanto');
      }
      if (b.work >= specOf(b).work) completeBuilding(s, b, p);
      if (--t.timer <= 0 || b.built) finish(s, p);
      return;
    }
    case 'fuel': {
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        p.carry = CARRY.Log;
        p.carryAmt = t.amount;
        t.stage = 1;
        const st = seat(s, p, 0.75);
        t.goal = s.tileOf(st);
        t.gx = st.x;
        t.gz = st.z;
        p.path = null;
      }
      if (t.stage === 1) {
        if (moving(go(s, p, t))) return;
        t.stage = 2;
        t.timer = 6;
      }
      p.act = ACT.Tend;
      face(p, c.x, c.z);
      if (--t.timer > 0) return;
      const h = s.hearth();
      const wasOut = h.fuel <= 0;
      s.book('burned', t.amount);
      h.fuel = Math.min(12, h.fuel + t.amount);
      if (s.dampWood()) s.practise(p, 'damp_fire');
      p.carry = CARRY.None;
      p.carryAmt = 0;
      t.amount = 0;
      if (wasOut) s.buildingsVersion++;
      finish(s, p);
      return;
    }
    case 'preserve': {
      const rack = s.buildings.find((q) => q.id === t.ref);
      if (!rack) {
        abandon(s, p);
        p.nextThink = s.tick;
        return;
      }
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        p.carry = CARRY.Meat;
        p.carryAmt = t.amount;
        t.stage = 1;
        t.goal = rack.tile;
        t.gx = rack.x + 0.5;
        t.gz = rack.z + 0.5;
        t.near = true;
        p.path = null;
      }
      if (t.stage === 1) {
        if (moving(go(s, p, t))) return;
        t.stage = 2;
        t.timer = 30;
        p.carry = CARRY.None;
      }
      p.act = ACT.Rack;
      face(p, rack.x + 0.5, rack.z + 0.5);
      if (--t.timer > 0) return;
      c.stock.preserved += t.amount * 0.9;
      s.book('dried', t.amount);
      t.amount = 0;
      train(p, 'preserve');
      finish(s, p);
      return;
    }
    case 'bury': {
      const body = s.byId.get(t.ref);
      if (!body || body.buried) {
        p.carry = CARRY.None;
        return finish(s, p);
      }
      if (t.stage === -1) {
        // to the pile for a digging stick, then to the body
        if (moving(go(s, p, t))) return;
        t.stage = 0;
        t.goal = s.tileOf(body);
        t.gx = body.x;
        t.gz = body.z;
        p.path = null;
        return;
      }
      if (t.stage === 0) {
        if (moving(go(s, p, t))) return;
        t.stage = 1;
        t.timer = 10;
      }
      if (t.stage === 1) {
        p.act = ACT.Mourn;
        face(p, body.x, body.z);
        if (--t.timer > 0) return;
        // far from camp, they are buried where they fell
        if (hyp(body.x - c.x, body.z - c.z) > FAR_GRAVE) {
          t.stage = 3;
          t.timer = s.heldBy(p)?.kind === 'stick' ? 30 : 45;
          p.thought = `Burying ${body.name} where they fell.`;
        } else {
          // lift the body and carry it to the burial ground
          p.carry = CARRY.Body;
          body.indoors = true;
          const spot = graveSpot(s);
          t.goal = s.tileOf(spot);
          t.gx = spot.x;
          t.gz = spot.z;
          t.near = false;
          t.stage = 2;
          p.path = null;
          p.thought = `Carrying ${body.name} to the burial ground.`;
        }
      }
      if (t.stage === 2) {
        body.x = p.x;
        body.z = p.z;
        if (moving(go(s, p, t))) return;
        t.stage = 3;
        // a grave dug with bare hands takes half as long again
        t.timer = s.heldBy(p)?.kind === 'stick' ? 30 : 45;
      }
      p.act = ACT.Dig;
      if (--t.timer > 0) return;
      const tile = s.tileOf(p);
      const g = s.addProp(GRAVE + (r.chance(0.5) ? 1 : 0), p.x - 0.25, s.world.groundY[tile], p.z, r.range(-0.3, 0.3), 1);
      const stick = s.heldBy(p);
      if (stick?.kind === 'stick') wearStick(s, p, stick);
      else s.practise(p, 'grave');
      s.propVal[g] = body.id;
      body.buried = true;
      body.indoors = true;
      // what they had in hand goes back on the pile with whoever buried them
      const tool = s.heldBy(body);
      if (tool) {
        tool.holder = -1;
        tool.band = p.band;
      }
      p.carry = CARRY.None;
      s.event('burial', `${p.name} laid ${body.name} to rest.`, [p.id, body.id], p.x, p.z, 1);
      s.adjust(p, body, 0);
      for (const q of s.people) if (q.alive && (s.isKin(q, body) || q.id === body.partner)) s.adjust(q, p, 6);
      finish(s, p);
      return;
    }
  }
}

/**
 * How far out logs are worth fetching. Logs left further away (by someone who died out there, or a band
 * that moved on) are left to rot: every woodcutter setting out for them turns back before getting there.
 */
const HAUL_RANGE = 30;

const logsSeen = new WeakMap<object, { v: number; near: boolean }>();
/** Logs lying within reach of the current camp (asked again only when the props change). */
function logsNearCamp(s: Sim) {
  const c = s.camp;
  const hit = logsSeen.get(c);
  if (hit && hit.v === s.propsVersion) return hit.near;
  // (whoever has them reserved, or could not reach them, is left to the haul itself: this only asks what is lying there)
  let near = false;
  if (s.countProps(LOGS) > 0)
    for (let k = 0; k < s.propCount && !near; k++)
      near = !!s.propAlive[k] && s.propType[k] === LOGS && s.propVal[k] > 0 && hyp(s.propX[k] - c.x, s.propZ[k] - c.z) <= HAUL_RANGE;
  logsSeen.set(c, { v: s.propsVersion, near });
  return near;
}

/** Beyond this far from camp, the dead are buried where they lie rather than carried home. */
export const FAR_GRAVE = 18;

function graveSpot(s: Sim) {
  const c = s.camp;
  const N = s.N;
  if (c.graveyard < 0) {
    // a quiet spot a little way from the hearth, on the same terrace if possible
    let best = -1, bestS = -Infinity;
    const hx = Math.floor(c.x), hz = Math.floor(c.z);
    for (let dz = -9; dz <= 9; dz++)
      for (let dx = -9; dx <= 9; dx++) {
        const x = hx + dx, z = hz + dz;
        if (x < 2 || z < 2 || x >= N - 2 || z >= N - 2) continue;
        const i = z * N + x;
        if (!s.grid.walkable(i) || s.world.water[i] !== WATER.None) continue;
        if (s.buildings.some((b) => Math.abs(b.x - x) <= 2 && Math.abs(b.z - z) <= 2)) continue;
        const d = hyp(dx, dz);
        const sc = -Math.abs(d - 7.5) - s.treesOnTile[i] * 0.5 + ((x * 31 + z * 17) % 10) * 0.01;
        if (sc > bestS) { bestS = sc; best = i; }
      }
    c.graveyard = best >= 0 ? best : c.tile;
  }
  // graves fill the plot outward from its centre, two to a tile, always on reachable ground
  const g0 = c.graveyard;
  const gx0 = g0 % N, gz0 = Math.floor(g0 / N);
  for (let ring = 0; ring < 7; ring++)
    for (let dz = -ring; dz <= ring; dz++)
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const x = gx0 + dx, z = gz0 + dz;
        if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
        const i = z * N + x;
        if (!s.grid.walkable(i) || s.world.water[i] !== WATER.None) continue;
        if (s.buildings.some((b) => b.tile === i)) continue;
        let graves = 0;
        for (let k = 0; k < s.propCount; k++) if (s.propAlive[k] && s.propTile[k] === i && s.propType[k] >= GRAVE && s.propType[k] < GRAVE + 2) graves++;
        if (graves >= 2) continue;
        if (!s.grid.find(c.tile, i)) continue;
        return { x: x + 0.3 + graves * 0.42, z: z + 0.55 };
      }
  return { x: c.x + 2.5, z: c.z + 2.5 };
}

export function completeBuilding(s: Sim, b: Building, p: Person) {
  b.built = true;
  b.finished = s.tick;
  s.buildingsVersion++;
  const label = labelOf(b).toLowerCase();
  const first = s.buildings.filter((q) => q.kind === b.kind && (q.walls ?? 'wood') === (b.walls ?? 'wood') && q.built && q.band === b.band).length === 1;
  const owner = s.byId.get(b.owner);
  if (b.kind === 'hut' || b.kind === 'leanto') {
    // (one whose owner has since gone to live with another band stands empty for someone here)
    if (owner && owner.alive && owner.band === b.band) {
      // (only those living in this band: a grown child who stayed behind when the family split off keeps their own)
      const household = [owner, s.byId.get(owner.partner)].filter((q): q is Person => !!q && q.alive && q.band === owner.band);
      for (const h of [...household]) for (const cid of h.children) {
        const ch = s.byId.get(cid);
        if (ch && ch.alive && ch.band === owner.band && ch.partner < 0 && s.age(ch) < 22 && !household.includes(ch)) household.push(ch);
      }
      for (const q of s.living()) if (q.band === owner.band && household.some((h) => h.id === q.carer) && s.age(q) < 14 && !household.includes(q)) household.push(q);
      for (const h of household) {
        h.home = b.id;
        s.remember(h, 'home', 20, 2, b.id, `Moved into a new ${label}.`);
      }
      s.event('build', first ? `The first ${label} at ${s.camp.name} stands, home to ${owner.name}'s family.` : `A ${label} was finished for ${owner.name}'s family.`,
        household.map((h) => h.id), b.x + 0.5, b.z + 0.5, first ? 3 : 1);
    } else s.event('build', `A ${label} was finished.`, [p.id], b.x + 0.5, b.z + 0.5, 1);
  } else {
    s.event('build', first ? `${p.name} and the others raised the camp's first ${label}.` : `A ${label} was finished.`, [p.id], b.x + 0.5, b.z + 0.5, first ? 3 : 1);
  }
}

// keep tree ids referenced so bundlers don't drop the import used by tools
void treeId;
