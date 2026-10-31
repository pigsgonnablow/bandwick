// The runner drives a simulation at the chosen speed and streams frames to the page: how fast it
// steps, skipping ahead, saving and loading, what it sends, and what happens when the sim hits a bug.
// The clock is a fake one the test moves by hand.
import { describe, it, expect } from 'vitest';
import { Runner, FromSim, Frame, BASE_TPS } from '../../src/sim/runner';
import { DEFAULT_PARAMS } from '../../src/sim/types';
import { START_TICK } from '../../src/sim/time';
import type { SaveData } from '../../src/sim/sim';

function runner(seed = 1) {
  let now = 1000;
  const posts: FromSim[] = [];
  const r = new Runner((m) => posts.push(m), () => now);
  r.handle({ type: 'init', params: { ...DEFAULT_PARAMS, seed } });
  /** Let `ms` of real time pass, pumping every 100 ms as the worker's loop does. */
  const wait = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      r.pump();
    }
  };
  const frames = () => posts.filter((m): m is Frame => m.type === 'frame');
  return { r, posts, frames, wait, sim: () => r.sim!, tick: (ms: number) => { now += ms; } };
}

describe('the runner', () => {
  it('makes the world, then sends it and a first full frame', () => {
    const { posts, sim } = runner();
    expect(posts.map((m) => m.type)).toEqual(['world', 'frame']);
    const f = posts[1] as Frame;
    expect(f.tick).toBe(START_TICK);
    expect(sim().tick).toBe(START_TICK);
    expect(f.people.length).toBeGreaterThan(0);
    expect(f.buildings).toBeTruthy();
    expect(f.summary).toBeTruthy();
    expect(f.skipping).toBe(false);
  });

  it('steps at the speed asked, and not at all while paused', () => {
    const { r, wait, sim } = runner();
    r.handle({ type: 'speed', speed: 40, paused: false });
    let t = sim().tick;
    wait(1000);
    expect(sim().tick - t).toBe(40 * BASE_TPS);
    r.handle({ type: 'speed', speed: 40, paused: true });
    t = sim().tick;
    wait(1000);
    expect(sim().tick).toBe(t);
  });

  it('does not race to catch up after a long stall', () => {
    const { r, tick, wait, sim } = runner();
    r.handle({ type: 'speed', speed: 40, paused: false });
    wait(100);
    const t = sim().tick;
    // (a tab in the background for ten seconds)
    tick(10_000);
    r.pump();
    expect(sim().tick - t).toBeLessThanOrEqual(0.25 * 40 * BASE_TPS);
  });

  it('skips ahead to exactly the tick asked, even while paused, and says so in its frames', () => {
    const { r, wait, frames, sim, tick } = runner();
    // (each step takes a millisecond of real time, so a skip runs over several pumps)
    const step = sim().step.bind(sim());
    sim().step = () => { tick(1); step(); };
    r.handle({ type: 'speed', speed: 1, paused: true });
    const to = sim().tick + 600;
    r.handle({ type: 'skip', ticks: 600 });
    wait(100);
    expect(frames().at(-1)!.skipping).toBe(true);
    wait(5000);
    expect(sim().tick).toBe(to);
    expect(frames().at(-1)!.skipping).toBe(false);
    wait(1000);
    expect(sim().tick).toBe(to);
  });

  it('sends each event once, in order', () => {
    const { r, wait, frames, sim } = runner();
    r.handle({ type: 'speed', speed: 400, paused: false });
    wait(4000);
    const sent = frames().flatMap((f) => f.events ?? []);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.map((e) => e.id)).toEqual(sim().events.map((e) => e.id));
  });

  it('answers what is open in the info windows, in the order asked, and null for what is gone', () => {
    const { r, posts, sim } = runner();
    const p = sim().living()[0];
    const b = sim().buildings[0];
    r.handle({ type: 'inspect', targets: [{ kind: 'building', id: b.id }, { kind: 'person', id: p.id }, { kind: 'person', id: 999_999 }] });
    const f = posts.at(-1) as Frame;
    expect(f.looks!.map((l) => l.key)).toEqual([`building:${b.id}`, `person:${p.id}`, 'person:999999']);
    expect(f.looks![0].card!.title).toBeTruthy();
    expect(f.looks![1].person!.name).toBe(p.name);
    expect(f.looks![2].person).toBeNull();
  });

  it('saves the running world, and a save loads and carries on from where it was', () => {
    const { r, posts, wait, sim } = runner(2);
    r.handle({ type: 'speed', speed: 400, paused: false });
    wait(2000);
    r.handle({ type: 'save', id: 7 });
    const saved = posts.at(-1) as Extract<FromSim, { type: 'saved' }>;
    expect(saved.id).toBe(7);
    const save = JSON.parse(JSON.stringify(saved.save)) as SaveData;
    expect(save.tick).toBe(sim().tick);
    const hash = sim().historyHash();
    wait(2000);
    expect(sim().tick).toBeGreaterThan(save.tick);
    r.handle({ type: 'load', save });
    expect(sim().tick).toBe(save.tick);
    expect(sim().historyHash()).toBe(hash);
    expect(posts.filter((m) => m.type === 'world').length).toBe(2);
  });

  it('turns away a save made on different land, and keeps running the world it has', () => {
    const { r, posts, sim } = runner();
    const was = sim();
    r.handle({ type: 'save', id: 1 });
    const save = JSON.parse(JSON.stringify((posts.at(-1) as Extract<FromSim, { type: 'saved' }>).save)) as SaveData;
    save.worldHash = 'not this world';
    r.handle({ type: 'load', save });
    const err = posts.at(-1) as Extract<FromSim, { type: 'error' }>;
    expect(err.type).toBe('error');
    expect(err.load).toBe(true);
    expect(err.message).toMatch(/^This save could not be loaded/);
    expect(r.sim).toBe(was);
  });

  it('has nothing to save before there is a world', () => {
    const posts: FromSim[] = [];
    const r = new Runner((m) => posts.push(m), () => 0);
    r.handle({ type: 'save', id: 3 });
    expect(posts).toEqual([{ type: 'saved', id: 3, save: null, error: 'There is no world to save yet.' }]);
  });

  it('stops on a bug, says so once, and still answers a save', () => {
    const { r, posts, wait, sim } = runner();
    r.handle({ type: 'speed', speed: 40, paused: false });
    wait(200);
    const s = sim();
    s.step = () => { throw new Error('boom'); };
    const before = posts.length;
    wait(1000);
    const after = posts.slice(before);
    expect(after.length).toBe(1);
    expect(after[0]).toMatchObject({ type: 'error', stopped: true, tick: s.tick });
    expect((after[0] as Extract<FromSim, { type: 'error' }>).message).toMatch(/^boom/);
    // a save asked for now gets an answer (the page would otherwise wait on it for ever)
    r.handle({ type: 'save', id: 9 });
    expect(posts.at(-1)).toMatchObject({ type: 'saved', id: 9, save: null });
    expect((posts.at(-1) as Extract<FromSim, { type: 'saved' }>).error).toBeTruthy();
    // nothing else moves it
    r.handle({ type: 'skip', ticks: 100 });
    wait(1000);
    expect(posts.length).toBe(before + 2);
    // a new world starts it again
    r.handle({ type: 'init', params: { ...DEFAULT_PARAMS, seed: 3 } });
    wait(1000);
    expect(r.sim).not.toBe(s);
    expect(r.sim!.tick).toBeGreaterThan(START_TICK);
  });
});
