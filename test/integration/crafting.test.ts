// Everything made by the fire is one crafting job with recipes, and crafting is four skills.
import { describe, it, expect } from 'vitest';
import { SK, SKILLS, RECIPE_KEYS } from '../../src/sim/band';
import { TICKS_PER_DAY } from '../../src/sim/time';
import { sim, runTo, runYears } from '../helpers';

describe('crafting', () => {
  it('twists cordage and makes tools as recipes of one job, each growing its own skill', () => {
    const s = sim(2);
    const before = new Map(s.members().map((p) => [p.id, Array.from(p.skills)]));
    const seen = new Set<string>();
    for (let d = 0; d < 48; d++) {
      for (let k = 0; k < TICKS_PER_DAY; k += 20) {
        runTo(s, s.tick + 20);
        for (const p of s.members()) if (p.task?.kind === 'craft') seen.add(RECIPE_KEYS[p.task.ref]);
      }
    }
    expect(seen.has('cordage')).toBe(true);
    expect(s.items.some((i) => i.maker >= 0)).toBe(true);
    const grew = (k: number) => s.members().some((p) => before.has(p.id) && p.skills[k] > before.get(p.id)![k] + 0.05);
    expect(grew(SK.weave)).toBe(true);
    expect(grew(SK.tool)).toBe(true);
    // nobody makes pots yet
    expect(s.members().every((p) => !before.has(p.id) || p.skills[SK.pot] === before.get(p.id)![SK.pot])).toBe(true);
  });

  it('shows pottery and hidework only once the band has a use for them', () => {
    const s = sim(1);
    expect(s.shownSkills()).toEqual([0, 1, 2, 3, 4, SK.tool, SK.weave]);
    s.camp.knows.push('preserving');
    expect(s.shownSkills()).toContain(SK.hide);
    expect(s.shownSkills()).not.toContain(SK.pot);
  });

  it("names the band's clear best at a craft, and takes the name back when someone catches up", () => {
    const s = sim(3);
    runTo(s, s.tick + 3 * TICKS_PER_DAY);
    const adults = s.members().filter((p) => s.age(p) >= 20);
    for (const p of adults) p.skills[SK.tool] = p.skills[SK.weave] = 3;
    const ada = adults[0], other = adults[1];
    ada.skills[SK.tool] = 12;
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(ada.known).toBe(SK.tool);
    expect(s.titled(ada)).toBe(`${ada.name}, the toolmaker`);
    expect(s.events.some((e) => e.kind === 'known' && e.people[0] === ada.id)).toBe(true);
    other.skills[SK.tool] = ada.skills[SK.tool];
    runTo(s, s.tick + TICKS_PER_DAY);
    expect(ada.known).toBeUndefined();
  });

  it('carries old saves over: crafting goes to toolmaking and weaving, and twisting becomes a recipe', () => {
    const s = runYears(sim(2), 1);
    const save = s.serialize();
    for (const p of save.people) {
      (p as any).skills = (p.skills as unknown as number[]).slice(0, 6);
      delete (p as any).known;
    }
    const p0 = save.people.find((p) => p.alive)!;
    (p0 as any).task = { kind: 'twist', stage: 1, goal: 0, gx: 0, gz: 0, ref: -1, timer: 5, started: 0, amount: 3, near: false };
    const t = new (s.constructor as any)(s.world, save);
    const p = t.byId.get(p0.id);
    expect(p.skills.length).toBe(SKILLS.length);
    expect(p.skills[SK.weave]).toBe(p.skills[SK.tool]);
    expect(p.task.kind).toBe('craft');
    expect(RECIPE_KEYS[p.task.ref]).toBe('cordage');
    runTo(t, t.tick + 3 * TICKS_PER_DAY);
  });
});
