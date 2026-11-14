// Woodcutting past the axe: the band's best woodcutter is known for it, a master gets more from each tree and is
// seldom hurt, firewood seasoned under the woodpile roof burns longer, and charcoal burned in a clamp for the kiln;
// a log sledge, clearing by fire, oak split into planks with wedges, and the dugout canoe.
import { describe, it, expect } from 'vitest';
import { SK, CARRY, CANOE_OPEN, specOf, labelOf, RECIPE_KEYS, Task, TaskKind, Building, SLEDGE_LOAD, SLEDGE_SNOW, SWIDDEN_SOIL, SWIDDEN_GRASS, SEASONED_HEAT, SEASONING, CLAMP_BURN, CHARCOAL_YIELD, CRAFT_TITLES } from '../../src/sim/band';
import { DISCOVERY, ELITE, knowHowFor } from '../../src/sim/know';
import { TICKS_PER_DAY, TICKS_PER_YEAR, seasonOf, snowLies } from '../../src/sim/time';
import { runTask, setup, abandon, completeBuilding } from '../../src/sim/ai';
import { canoeSite, openReach, openWater } from '../../src/sim/canoe';
import { Sim, treeStage, isTreeType, LOGS, FIRE_HOLDS } from '../../src/sim/sim';
import { sim, runTo, runYears } from '../helpers';

/** A band two years on, with wood, clay and food in hand. */
function band(seed = 2, knows: string[] = []) {
  const s = runYears(sim(seed), 2);
  const c = s.camp;
  for (const k of knows) if (!c.knows.includes(k)) c.knows.push(k);
  c.stock.wood += 80;
  c.stock.mud += 30;
  c.stock.meat += 40;
  return s;
}
const task = (s: Sim, kind: TaskKind, at: { x: number; z: number }, ref = -1, stage = 0): Task =>
  ({ kind, stage, goal: s.tileOf(at), gx: at.x, gz: at.z, ref, timer: 0, started: s.tick, amount: 0, near: false });
const adult = (s: Sim) => s.members().find((q) => s.age(q) >= 18 && s.age(q) <= 50)!;
/** A built building of this kind by the band's stockpile. */
function built(s: Sim, kind: Building['kind']) {
  const pile = s.buildings.find((b) => b.band === s.camp.id && b.kind === 'stockpile')!;
  const b = { ...pile, id: s.newId(), kind, built: true, fuel: 0 };
  s.buildings.push(b);
  return b;
}
const hypot = Math.hypot;
const spoil = (s: Sim) => (s as unknown as { spoil(): void }).spoil();

describe('the band\'s woodcutter', () => {
  it('is known by name once clearly the best with an axe', () => {
    expect(CRAFT_TITLES[SK.wood]).toBe('woodcutter');
    const s = band();
    const ms = s.members().filter((q) => s.age(q) >= 16);
    for (const q of ms) q.skills[SK.wood] = 6;
    const p = ms[0];
    p.skills[SK.wood] = 17;
    for (const q of ms) delete q.known;
    s.plan();
    expect(p.known).toBe(SK.wood);
    expect(s.titled(p)).toBe(`${p.name}, the woodcutter`);
  });

  it('gets more wood from a big tree once a master, and the same from a sapling', () => {
    const fell = (skill: number, stage: number) => {
      const s = band();
      const p = adult(s);
      p.skills[SK.wood] = skill;
      let k = -1;
      for (let i = 0; i < s.propType.length && k < 0; i++) if (s.propAlive[i] && isTreeType(s.propType[i]) && treeStage(s.propType[i]) === stage && hypot(s.propX[i] - s.camp.x, s.propZ[i] - s.camp.z) < 30) k = i;
      expect(k).toBeGreaterThanOrEqual(0);
      s.items.push({ id: s.newId(), kind: 'axe', band: s.camp.id, holder: p.id, wear: 0, made: s.tick, maker: -1 });
      p.task = { ...task(s, 'fell', { x: s.propX[k], z: s.propZ[k] }, k, 1), timer: 1 };
      p.x = s.propX[k];
      p.z = s.propZ[k];
      const tx = s.propX[k], tz = s.propZ[k];
      runTask(s, p);
      // (what one can't carry is left lying as logs by the stump)
      let left = 0;
      for (let i = 0; i < s.propType.length; i++) if (s.propAlive[i] && s.propType[i] === LOGS && hypot(s.propX[i] - tx, s.propZ[i] - tz) < 0.4) left += s.propVal[i];
      return p.carryAmt + left;
    };
    // (a master past the mark by five: a grown tree's 14 wood and its bark, and a quarter again from the limbs)
    const plain = fell(ELITE - 1, 2), master = fell(ELITE + 5, 2);
    expect(master).toBeGreaterThan(plain);
    expect(master - plain).toBe(Math.round(14 * 0.06 * 5));
    expect(fell(ELITE + 5, 0)).toBe(fell(ELITE - 1, 0));
  });
});

describe('seasoned firewood', () => {
  it('is thought of by a master woodcutter feeding the fire from under the woodpile roof', () => {
    const d = DISCOVERY.get('seasoning')!;
    expect(d.needs).toEqual(['woodshed']);
    expect(d.practice.dry_fire).toBeGreaterThan(0);
    expect(d.requires).toEqual([{ kind: 'skill', skill: SK.wood, level: 16 }]);
  });

  it('dries under the roof a season ahead, only once the band knows to stack it so', () => {
    const s = band();
    const c = s.camp;
    c.stock.wood = 120;
    c.stock.seasoned = 0;
    spoil(s);
    expect(c.stock.seasoned).toBe(0);
    built(s, 'woodshed');
    spoil(s);
    expect(c.stock.seasoned).toBe(0);
    c.knows.push('seasoning');
    spoil(s);
    expect(c.stock.seasoned).toBeCloseTo(120 * SEASONING, 5);
    for (let d = 0; d < 36; d++) spoil(s);
    expect(c.stock.seasoned / c.stock.wood).toBeGreaterThan(0.9);
    expect(c.stock.seasoned).toBeLessThanOrEqual(c.stock.wood);
  });

  it('takes the damp again in autumn and winter with no roof over it', () => {
    const s = band(2, ['seasoning']);
    const c = s.camp;
    s.buildings = s.buildings.filter((b) => !(b.band === c.id && b.kind === 'woodshed'));
    while (seasonOf(s.tick) < 2) s.tick += TICKS_PER_DAY;
    c.stock.wood = 100;
    c.stock.seasoned = 80;
    spoil(s);
    expect(c.stock.seasoned).toBeLessThan(80);
  });

  it('is burned first, and keeps the fire going longer', () => {
    const s = band();
    const c = s.camp;
    c.stock.wood = 20;
    c.stock.seasoned = 3;
    const dry = s.takeFirewood(c, 4);
    expect(dry).toBe(3);
    expect(c.stock.wood).toBe(16);
    expect(c.stock.seasoned).toBe(0);
    const h = s.hearth();
    h.fuel = 0;
    expect(s.stoke(h, 4, 3)).toBeCloseTo(4 + 3 * (SEASONED_HEAT - 1), 6);
    // (never past what the fire holds)
    h.fuel = FIRE_HOLDS - 1;
    expect(s.stoke(h, 4, 4)).toBeCloseTo(1, 6);
    expect(h.fuel).toBe(FIRE_HOLDS);
  });

  it('carried to the fire, goes on first and what is left goes back seasoned', () => {
    const s = band();
    const c = s.camp;
    const p = adult(s);
    c.stock.wood = 30;
    c.stock.seasoned = 30;
    const h = s.hearth();
    h.fuel = FIRE_HOLDS - 2.5;
    p.task = { ...task(s, 'fuel', { x: c.x, z: c.z }, -1, 2), amount: 4, dry: 4, timer: 1 };
    c.stock.wood -= 4;
    c.stock.seasoned -= 4;
    runTask(s, p);
    expect(h.fuel).toBeCloseTo(FIRE_HOLDS, 6);
    // 2 seasoned went on (2.5 of fuel), and the other 2 went back on the pile, still seasoned
    expect(c.stock.wood).toBeCloseTo(28, 6);
    expect(c.stock.seasoned).toBeCloseTo(28, 6);
  });
});

describe('charcoal', () => {
  it('is thought of by a woodcutter who pots, firing in the kiln', () => {
    const d = DISCOVERY.get('charcoal')!;
    expect(d.needs).toEqual(['kiln']);
    expect(d.practice.fire_kiln).toBeGreaterThan(0);
    expect(knowHowFor({ kind: 'clamp' })).toEqual(['charcoal']);
  });

  it('wants a clamp dug by the kiln, once the band has a kiln', () => {
    const s = band(2, ['pottery', 'kiln', 'charcoal']);
    const c = s.camp;
    s.plan();
    expect(s.buildings.some((b) => b.band === c.id && b.kind === 'clamp')).toBe(false);
    const k = built(s, 'kiln');
    k.x += 3;
    s.plan();
    const clamp = s.buildings.find((b) => b.band === c.id && b.kind === 'clamp');
    expect(clamp).toBeDefined();
    expect(Math.hypot(clamp!.x - k.x, clamp!.z - k.z)).toBeLessThan(4);
    expect(c.plan).toContain('Dig a charcoal clamp by the kiln');
  });

  it('is burned in the clamp: stacked, it smoulders a day, then goes into the stores', () => {
    const s = band(2, ['pottery', 'kiln', 'charcoal']);
    const c = s.camp;
    expect(s.canCraft('charcoal')).toBe(false);
    built(s, 'kiln');
    expect(s.canCraft('charcoal')).toBe(false);
    const clamp = built(s, 'clamp');
    expect(s.canCraft('charcoal')).toBe(true);
    c.stock.charcoal = 0;
    s.plan();
    expect(c.jobs['craft.charcoal']).toBeGreaterThan(0);
    expect(c.plan).toContain('Burn charcoal in the clamp for the kiln');
    const p = adult(s);
    p.skills[SK.wood] = ELITE - 2;
    p.task = { ...task(s, 'craft', s.kilnSeat(clamp, p), RECIPE_KEYS.indexOf('charcoal'), 1), amount: 1, timer: 1 };
    runTask(s, p);
    expect(clamp.burnUntil).toBe(s.tick + CLAMP_BURN);
    expect(clamp.charge).toBe(CHARCOAL_YIELD);
    // (one stack at a time)
    expect(s.canCraft('charcoal')).toBe(false);
    expect(s.packBuildings().find((b) => b.id === clamp.id)!.look).toBe('clampLit');
    runTo(s, s.tick + CLAMP_BURN + 12);
    expect(clamp.burnUntil).toBeUndefined();
    expect(c.stock.charcoal).toBeCloseTo(CHARCOAL_YIELD, 5);
  });

  it('is burned in the kiln, one for each firing, and the pots seldom crack', () => {
    const s = band(2, ['pottery', 'kiln']);
    const c = s.camp;
    built(s, 'kiln');
    const p = adult(s);
    p.skills[SK.pot] = 8;
    const fire = (charcoal: number) => {
      let cracked = 0;
      for (let i = 0; i < 400; i++) {
        c.stock.charcoal = charcoal;
        const before = c.ledger?.now['cracked.bowl'] ?? 0;
        p.task = { ...task(s, 'craft', p, RECIPE_KEYS.indexOf('bowl'), 1), amount: 1, timer: 1 };
        runTask(s, p);
        if ((c.ledger?.now['cracked.bowl'] ?? 0) > before) cracked++;
        if (charcoal) expect(c.stock.charcoal).toBe(charcoal - 1);
      }
      return cracked;
    };
    const wood = fire(0), coal = fire(5);
    expect(wood).toBeGreaterThan(4);
    expect(coal).toBeLessThan(wood);
  });
});

it('a year on, a band that knows it all burns charcoal and keeps its firewood seasoned', () => {
  const s = band(2, ['pottery', 'kiln', 'woodshed', 'seasoning', 'charcoal']);
  const c = s.camp;
  built(s, 'kiln');
  if (!s.hasBuilt('woodshed')) built(s, 'woodshed');
  for (const q of s.members()) if (s.age(q) >= 16) q.skills[SK.wood] = Math.max(q.skills[SK.wood], 12);
  runTo(s, s.tick + TICKS_PER_YEAR);
  expect(s.buildings.some((b) => b.band === c.id && b.kind === 'clamp' && b.built)).toBe(true);
  expect((c.ledger?.now.charcoal ?? 0) + (c.ledger?.last.charcoal ?? 0)).toBeGreaterThan(0);
  expect(s.seasonedShare(c)).toBeGreaterThan(0.3);
});

describe('the log sledge', () => {
  it('is thought of by a woodcutter hauling logs home a load at a time', () => {
    const d = DISCOVERY.get('sledge')!;
    expect(d.needs).toEqual(['axe']);
    expect(d.practice.haul_logs).toBeGreaterThan(0);
  });

  it('is made by the band once it knows how', () => {
    const s = band(2, ['axe']);
    const c = s.camp;
    for (const k of ['axe', 'chopper', 'stick', 'basket', 'pot', 'needle', 'harpoon', 'line', 'net'] as const) s.giveTools(c, { [k]: 10 });
    c.stock.cordage += 10;
    expect(s.toolToMake(c)).not.toBe('sledge');
    c.knows.push('sledge');
    const make = s.toolToMake(c);
    if (make !== 'sledge') expect(['cloak', 'hat', 'mittens', 'shoes', 'bag', 'cape', 'furcloak', 'lamp', 'jar', 'tunic', 'blanket']).toContain(make);
    s.giveTools(c, { sledge: 1 });
    expect(s.toolToMake(c)).not.toBe('sledge');
  });

  const haul = (sledge: boolean, snow = false) => {
    const s = band(2, ['axe', 'sledge']);
    const c = s.camp;
    for (const it of s.toolsOf(c, 'sledge')) s.items.splice(s.items.indexOf(it), 1);
    if (sledge) s.giveTools(c, { sledge: 1 });
    if (snow) while (!snowLies(s.tick)) s.tick += TICKS_PER_DAY;
    else while (snowLies(s.tick)) s.tick += TICKS_PER_DAY;
    const p = adult(s);
    const pile = s.storeSpot(true);
    p.x = pile.x; p.z = pile.z;
    const lp = s.addProp(LOGS, c.x + 6.2, 0, c.z + 0.3, 0, 1);
    s.propVal[lp] = 30;
    p.task = setup(s, p, 'haul');
    expect(p.task?.ref).toBe(lp);
    for (let i = 0; i < 400 && p.task?.kind === 'haul' && p.carry === CARRY.None; i++) { runTask(s, p); s.tick++; }
    return { amt: p.carryAmt, held: s.heldBy(p)?.kind };
  };
  it('drags home far more than a shoulder takes, more again over the snow', () => {
    const plain = haul(false), dragged = haul(true), snow = haul(true, true);
    expect(plain.amt).toBe(6);
    expect(dragged.held).toBe('sledge');
    expect(dragged.amt).toBe(SLEDGE_LOAD);
    expect(snow.amt).toBe(SLEDGE_SNOW);
  });
});

describe('clearing by fire', () => {
  it('is thought of by a gardener who knows the woods, bringing in a harvest from tired ground', () => {
    const d = DISCOVERY.get('swidden')!;
    expect(d.needs).toEqual(['garden']);
    expect(d.practice.tired_ground).toBeGreaterThan(0);
  });

  it('burns a stand of trees off the new plot, and leaves the ground richer than fresh', () => {
    const s = band(2, ['garden', 'swidden']);
    const c = s.camp;
    // (no plots yet: the band digs its first)
    s.buildings = s.buildings.filter((b) => !(b.band === c.id && (b.kind === 'plot' || b.kind === 'fence')));
    const tile = s.plotSite(c);
    expect(tile).toBeGreaterThanOrEqual(0);
    const logsBefore = s.countProps(LOGS);
    (s as unknown as { planGardens(c: unknown, s: number): void }).planGardens(c, 0.5);
    const b = s.buildings.find((q) => q.band === c.id && q.kind === 'plot')!;
    expect(b.plot!.burnt).toBe(true);
    expect([SWIDDEN_SOIL, SWIDDEN_GRASS]).toContain(b.plot!.soil);
    expect(b.plot!.soil).toBeGreaterThan(1);
    // (the trees burned where they stood: no logs left lying from them)
    expect(s.countProps(LOGS)).toBe(logsBefore);
    expect(c.plan).toContain('Clear new garden ground by fire');
    b.built = true;
    expect(s.plotLook(b)).toBe('plotBurnt');
  });

  it('looks for a stand of trees to burn, where a band digging by hand keeps to open ground', () => {
    const s = band(2, ['garden']);
    const c = s.camp;
    s.buildings = s.buildings.filter((b) => !(b.band === c.id && (b.kind === 'plot' || b.kind === 'fence')));
    const open = s.plotSite(c);
    c.knows.push('swidden');
    const fire = s.plotSite(c);
    expect(s.treesOnTile[fire]).toBeGreaterThanOrEqual(s.treesOnTile[open]);
  });
});

describe('wedges and split timber', () => {
  it('is thought of by a master woodcutter raising a hut of round poles', () => {
    const d = DISCOVERY.get('split_timber')!;
    expect(d.needs).toEqual(['huts', 'axe']);
    expect(d.practice.build_poles).toBeGreaterThan(0);
    expect(knowHowFor({ kind: 'hut', walls: 'plank' })).toEqual(['huts', 'split_timber']);
    expect(knowHowFor({ kind: 'storehouse', walls: 'plank' })).toEqual(['storehouse', 'split_timber']);
  });

  it('raises huts and stores from fewer trees, quicker, and tighter', () => {
    for (const kind of ['hut', 'storehouse'] as const) {
      const pole = specOf({ kind }), plank = specOf({ kind, walls: 'plank' });
      expect(plank.wood).toBeLessThan(pole.wood);
      expect(plank.work).toBeLessThan(pole.work);
      if (kind === 'hut') expect(plank.shelter).toBeGreaterThan(pole.shelter);
      else expect(plank.keep).toBeLessThan(pole.keep);
    }
    expect(labelOf({ kind: 'hut', walls: 'plank' })).toBe('Split-plank hut');
  });

  it('wants wedges and a maul made once the band knows how', () => {
    const s = band(2, ['axe']);
    const c = s.camp;
    for (const k of ['axe', 'chopper', 'stick', 'basket', 'pot', 'needle', 'harpoon', 'line', 'net', 'sledge'] as const) s.giveTools(c, { [k]: 10 });
    expect(s.toolToMake(c)).not.toBe('wedges');
    c.knows.push('split_timber');
    expect(s.toolToMake(c)).toBe('wedges');
    s.giveTools(c, { wedges: 1 });
    expect(s.toolToMake(c)).not.toBe('wedges');
  });

  it('splits planks for the walls only with wedges on the pile, and wears them', () => {
    const pick = (wedges: boolean) => {
      const s = band(2, ['huts', 'axe', 'split_timber']);
      const c = s.camp;
      for (const it of s.toolsOf(c, 'wedges')) s.items.splice(s.items.indexOf(it), 1);
      if (wedges) s.giveTools(c, { wedges: 1 });
      const b = s.newBuilding('hut', c.tile + 3, -1);
      s.chooseWalls(b, false);
      return { s, b };
    };
    expect(pick(false).b.walls).not.toBe('plank');
    const { s, b } = pick(true);
    expect(b.walls).toBe('plank');
    const wedges = s.toolsOf(s.camp, 'wedges')[0];
    const p = adult(s);
    b.work = specOf(b).work - 0.5;
    completeBuilding(s, b, p);
    expect(wedges.wear).toBeGreaterThan(0);
  });
});

describe('the dugout canoe', () => {
  it('is thought of by a woodcutter fishing a bank fished thin, with open water beyond', () => {
    const d = DISCOVERY.get('canoe')!;
    expect(d.needs).toEqual(['axe']);
    expect(d.practice.far_water).toBeGreaterThan(0);
    expect(knowHowFor({ kind: 'canoe' })).toEqual(['canoe']);
  });

  /** A band whose canoe is drawn up on the bank, built. */
  function withCanoe() {
    const s = band(2, ['axe', 'canoe']);
    const c = s.camp;
    while (seasonOf(s.tick) === 3) s.tick += TICKS_PER_DAY;
    const tile = canoeSite(s, c);
    expect(tile).toBeGreaterThanOrEqual(0);
    expect(openReach(s, tile).length).toBeGreaterThanOrEqual(CANOE_OPEN);
    const b = s.newBuilding('canoe', tile, -1);
    b.built = true;
    b.wood = 10;
    b.work = specOf(b).work;
    return { s, c, b };
  }

  it('is hollowed out on a bank with open water beyond it, once the band knows how', () => {
    const s = band(2, ['axe']);
    while (seasonOf(s.tick) === 3) s.tick += TICKS_PER_DAY;
    s.plan();
    expect(s.buildings.some((b) => b.kind === 'canoe')).toBe(false);
    s.camp.knows.push('canoe');
    s.plan();
    const b = s.buildings.find((q) => q.kind === 'canoe' && q.band === s.camp.id)!;
    expect(b).toBeDefined();
    expect(s.world.water[b.tile]).toBe(0);
    expect(s.camp.plan).toContain('Hollow out a dugout canoe from a great pine');
  });

  it('takes a fisher out onto the open water, out of reach of the bank, and back with more fish', () => {
    const { s, c, b } = withCanoe();
    for (const it of s.toolsOf(c, 'line')) s.items.splice(s.items.indexOf(it), 1);
    const p = adult(s);
    p.x = b.x + 0.5;
    p.z = b.z + 1.5;
    p.skills[SK.fish] = 10;
    const fish0 = c.stock.fish;
    p.task = setup(s, p, 'canoe');
    expect(p.task?.kind).toBe('canoe');
    const w = p.task!.bank!;
    expect(openWater(s, w)).toBe(true);
    let afloat = false, out = false, caught = 0;
    for (let i = 0; i < 1500 && p.task?.kind === 'canoe'; i++) {
      runTask(s, p);
      s.tick++;
      if (s.world.water[s.tileOf(p)] !== 0) afloat = true;
      if (b.out === p.id) out = true;
      if (p.carry === CARRY.Fish) caught = p.carryAmt;
    }
    expect(afloat).toBe(true);
    expect(out).toBe(true);
    expect(b.out).toBeUndefined();
    expect(caught).toBeGreaterThan(0);
    expect(c.stock.fish).toBeGreaterThan(fish0);
    expect(s.world.water[s.tileOf(p)]).toBe(0);
  });

  it('is never left out on the water: a fisher called away brings it back to the bank', () => {
    const { s, b } = withCanoe();
    const p = adult(s);
    p.x = b.x + 0.5;
    p.z = b.z + 1.5;
    p.task = setup(s, p, 'canoe');
    for (let i = 0; i < 300 && !(p.task?.kind === 'canoe' && p.task.stage === 2); i++) { runTask(s, p); s.tick++; }
    expect(p.task?.stage).toBe(2);
    expect(s.world.water[s.tileOf(p)]).not.toBe(0);
    abandon(s, p);
    expect(b.out).toBeUndefined();
    expect(s.world.water[s.tileOf(p)]).toBe(0);
  });
});
