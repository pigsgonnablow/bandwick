import { generateWorld } from '../src/sim/worldgen';
import { DEFAULT_PARAMS } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_YEAR } from '../src/sim/time';
const seed = Number(process.argv[2] ?? 1), years = Number(process.argv[3] ?? 8);
const sim = new Sim(generateWorld({ ...DEFAULT_PARAMS, size: 128, seed }));
const end = sim.tick + years * TICKS_PER_YEAR;
let last = 0;
while (sim.tick < end) {
  sim.step();
  if (sim.tick - last >= TICKS_PER_YEAR / 4) {
    last = sim.tick;
    for (const c of sim.liveCamps()) {
      const plots = sim.plots(c, true);
      if (!c.knows.includes('garden')) continue;
      console.log(`t${(sim.tick/TICKS_PER_YEAR).toFixed(2)} ${c.name} pop ${sim.members(c).length} plots ${plots.filter(b=>b.built).length}/${plots.length} crops ${plots.map(b=>b.plot ? `${b.plot.crop}:${b.plot.growth.toFixed(1)}:${b.plot.cond.toFixed(2)}:w${b.plot.weeds.toFixed(1)}:L${b.plot.left.toFixed(0)}:s${b.plot.soil.toFixed(2)}` : '-').join(' ')} seed ${(c.seed??0).toFixed(1)} grain ${c.stock.grain.toFixed(0)} roots ${c.stock.roots.toFixed(0)} greens ${c.stock.greens.toFixed(0)} knows ${c.knows.filter(k=>['garden','grain','fences','pits'].includes(k)).join(',')} gath ${JSON.stringify(c.ledger?.total ? {g: Math.round(c.ledger.total['gathered.grain']??0), r: Math.round(c.ledger.total['gathered.roots']??0), gr: Math.round(c.ledger.total['gathered.greens']??0), raid: c.ledger.total['garden.raided']??0} : {})}`);
    }
  }
}
for (const e of sim.events.filter(e => /garden|grain|harvest|seed|frost|sow|plot/i.test(e.text)).slice(0, 40)) console.log(sim.when(e.tick), e.text);
