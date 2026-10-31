// Children learn by watching the grown-ups at work, and the band's eldest tells stories by the evening fire.
import { describe, it, expect } from 'vitest';
import { SK } from '../../src/sim/band';
import { STORY_AGE, workSkill } from '../../src/sim/ai';
import { TICKS_PER_DAY, dayOf } from '../../src/sim/time';
import { sim, runTo } from '../helpers';

describe('childhood', () => {
  it('sends children to watch a grown-up at work, and they pick up the craft but never past the one they watch', () => {
    const s = sim(2);
    const kids = () => s.members().filter((p) => s.age(p) >= 5 && s.age(p) < 11);
    const start = new Map(kids().map((p) => [p.id, Array.from(p.skills)]));
    expect(start.size).toBeGreaterThan(0);
    let watched = 0;
    for (let i = 0; i < 60 * TICKS_PER_DAY; i++) {
      runTo(s, s.tick + 1);
      for (const p of s.members()) {
        if (p.task?.kind !== 'watch' || p.task.stage !== 1) continue;
        watched++;
        const q = s.byId.get(p.task.ref)!;
        expect(s.age(q)).toBeGreaterThanOrEqual(16);
        const k = workSkill(q);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(p.skills[k]).toBeLessThanOrEqual(q.skills[k] + 1e-6);
      }
    }
    expect(watched).toBeGreaterThan(0);
    // too young to fell, fish or build themselves: what they have of those crafts they learned by watching
    const learned = [...start].some(([id, before]) => {
      const p = s.byId.get(id)!;
      return [SK.wood, SK.fish, SK.build].some((k) => p.skills[k] > before[k] + 0.01);
    });
    expect(learned).toBe(true);
  });

  it("has the band's eldest tell one story an evening by the fire, and those who listen remember it", () => {
    const s = sim(1);
    const tellers = new Map<number, number>();
    for (let i = 0; i < 40 * TICKS_PER_DAY; i++) {
      runTo(s, s.tick + 1);
      const now = s.members().filter((p) => p.task?.kind === 'tell');
      expect(now.length).toBeLessThanOrEqual(1);
      for (const p of now) {
        expect(s.age(p)).toBeGreaterThanOrEqual(STORY_AGE);
        // one story a night: a teller who has started is the only one that day
        const day = dayOf(s.tick);
        if (!tellers.has(day)) tellers.set(day, p.id);
        expect(tellers.get(day)).toBe(p.id);
      }
    }
    expect(tellers.size).toBeGreaterThan(0);
    const heard = s.members().filter((p) => p.memories.some((m) => m.kind === 'story'));
    expect(heard.length).toBeGreaterThan(0);
    expect(heard[0].memories.find((m) => m.kind === 'story')!.text).toMatch(/^Heard \S+ tell /);
  });
});
