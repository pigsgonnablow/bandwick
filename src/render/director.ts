// The camera director: when switched on, it chooses what is worth watching (fresh events,
// the most interesting work under way, the camp at dusk, a grazing herd), frames it, holds the
// shot for a while, and writes a one-line caption. Any user camera input hands control back.
import type { BandLayer } from './band';
import type { IsoCamera } from './camera';
import type { SimEvent } from '../sim/band';
import { TASK_KINDS, ACT } from '../sim/band';

export interface Shot {
  key: string;
  personId: number; // -1 for a place
  x: number;
  z: number;
  zoom: number;
  until: number; // real ms
  caption: string;
  why: string;
}

const PHRASE: Record<string, string> = {
  eat: 'is eating by the fire', eatwild: 'is eating berries straight off the bush', sleep: 'is asleep', warm: 'is warming up by the fire',
  socialize: 'is off to talk with someone', play: 'is playing', idle: 'is resting by the fire', mourn: 'is mourning',
  forage: 'is picking berries', fell: 'is felling a tree', haul: 'is hauling logs home', hunt: 'is hunting deer',
  fish: 'is fishing', build: 'is building', supply: 'is carrying materials to a building site', fuel: 'is feeding the fire',
  preserve: 'is drying meat and fish', bury: 'is burying the dead', explore: 'is exploring', deadwood: 'is gathering fallen branches', swim: 'is swimming to cool off',
  reap: 'is cutting grass and reeds', twist: 'is twisting cordage by the fire',
};
/** How much a viewer would want to see each task. */
const INTEREST: Record<string, number> = {
  hunt: 6, bury: 6.5, mourn: 4.5, build: 3.5, fell: 3.2, fish: 2.8, haul: 2, supply: 2, forage: 2.2, preserve: 2.2,
  socialize: 1.8, play: 2.2, eat: 1.4, fuel: 1.6, eatwild: 1.6, warm: 1.2, idle: 0.6, sleep: 0.1, explore: 2, deadwood: 1.8, swim: 3.4,
  reap: 1.8, twist: 1.2,
};

export class Director {
  active = false;
  shot: Shot | null = null;
  private seenEvents = new Set<number>();
  private lastShown = new Map<string, number>();
  private shots = 0;

  constructor(private cam: IsoCamera) {}

  start(events: SimEvent[]) {
    this.active = true;
    this.shot = null;
    // don't replay the whole history: only what happens from now on (and the last big moment)
    for (const e of events) this.seenEvents.add(e.id);
    const last = [...events].reverse().find((e) => e.weight >= 3);
    if (last) this.seenEvents.delete(last.id);
  }
  stop() {
    this.active = false;
    this.shot = null;
  }

  update(now: number, band: BandLayer, events: SimEvent[], names: Map<number, string>, ctx: { tick: number; camp: { x: number; z: number; name: string } | null; dark: boolean }) {
    if (!this.active) return;
    const s = this.shot;
    // keep framing a followed person
    if (s && s.personId >= 0) {
      const p = band.positionOf(s.personId);
      if (!p || (p.indoors && now > s.until - 4000)) {
        this.shot = null;
      } else {
        s.x = p.x;
        s.z = p.z;
      }
    }
    // a big new event cuts in
    const fresh = events.filter((e) => e.weight >= 3 && !this.seenEvents.has(e.id));
    if (this.shot && fresh.length && this.shot.why !== 'event') this.shot.until = Math.min(this.shot.until, now + 1500);
    if (!this.shot || now > this.shot.until) this.shot = this.next(now, band, events, names, ctx);
    if (this.shot) this.cam.frame(this.shot.x, this.shot.z, this.shot.zoom, false);
  }

  private next(now: number, band: BandLayer, events: SimEvent[], names: Map<number, string>, ctx: { tick: number; camp: { x: number; z: number; name: string } | null; dark: boolean }): Shot | null {
    this.shots++;
    const recently = (key: string, ms: number) => now - (this.lastShown.get(key) ?? -1e9) < ms;
    const take = (shot: Shot) => {
      this.lastShown.set(shot.key, now);
      return shot;
    };
    // 1. something notable just happened
    const fresh = events.filter((e) => e.weight >= 2 && !this.seenEvents.has(e.id) && ctx.tick - e.tick < 240 * 2);
    fresh.sort((a, b) => b.weight - a.weight || b.tick - a.tick);
    for (const e of events) if (e.weight < 2) this.seenEvents.add(e.id);
    const ev = fresh[0];
    if (ev) {
      for (const e of fresh) this.seenEvents.add(e.id);
      const who = ev.people.find((id) => band.positionOf(id) && !band.positionOf(id)!.indoors);
      const pos = who !== undefined ? band.positionOf(who)! : { x: ev.x, z: ev.z };
      return take({ key: `event${ev.id}`, personId: who ?? -1, x: pos.x, z: pos.z, zoom: 11, until: now + 9000, caption: ev.text, why: 'event' });
    }
    // 2. now and then, the camp as a whole (always at night: the fire is the place to be)
    if (ctx.camp && ((ctx.dark && !recently('camp', 25000)) || (this.shots % 6 === 0 && !recently('camp', 40000)))) {
      return take({
        key: 'camp', personId: -1, x: ctx.camp.x, z: ctx.camp.z, zoom: ctx.dark ? 13 : 20, until: now + (ctx.dark ? 14000 : 9000),
        caption: ctx.dark ? `Night over ${ctx.camp.name}. The fire keeps the dark back.` : `${ctx.camp.name}, going about its day.`, why: 'camp',
      });
    }
    // 3. the most interesting person to watch, favouring people we haven't seen lately
    let best: { id: number; score: number; task: string; x: number; z: number } | null = null;
    band.each((id, p) => {
      if (p.indoors || p.act === ACT.Dead || p.age < 2) return;
      const task = p.task > 0 ? TASK_KINDS[p.task - 1] : 'idle';
      let score = INTEREST[task] ?? 1;
      if (p.act === ACT.Chop || p.act === ACT.Hunt || p.act === ACT.Build || p.act === ACT.Dig) score += 1.2;
      if (p.age < 14 && task === 'play') score += 0.5;
      if (recently(`p${id}`, 60000)) score -= 3.5;
      if (recently(`t${task}`, 30000)) score -= 1.2;
      score += ((id * 7919 + this.shots * 31) % 100) / 400;
      if (!best || score > best.score) best = { id, score, task, x: p.x, z: p.z };
    });
    const b = best as { id: number; score: number; task: string; x: number; z: number } | null;
    if (b && b.score > 0.4) {
      this.lastShown.set(`t${b.task}`, now);
      const nm = names.get(b.id) ?? 'Someone';
      const close = b.task === 'hunt' || b.task === 'fish' ? 13 : 9.5;
      return take({ key: `p${b.id}`, personId: b.id, x: b.x, z: b.z, zoom: close, until: now + 12000, caption: `${nm} ${PHRASE[b.task] ?? 'is about'}.`, why: 'person' });
    }
    // 4. the wild: a herd
    const deer = band.visibleDeer;
    if (deer.length && !recently('deer', 60000)) {
      const d = deer[(this.shots * 13) % deer.length];
      return take({ key: 'deer', personId: -1, x: d.x, z: d.z, zoom: 12, until: now + 8000, caption: 'Deer graze at the edge of the woods.', why: 'deer' });
    }
    if (ctx.camp) return take({ key: 'camp', personId: -1, x: ctx.camp.x, z: ctx.camp.z, zoom: 18, until: now + 9000, caption: `${ctx.camp.name}.`, why: 'camp' });
    return null;
  }
}
