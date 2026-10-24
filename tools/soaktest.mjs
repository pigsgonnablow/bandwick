// Runs the page at 100x for a while and samples memory, frame rate and errors.
// Usage: node tools/soaktest.mjs [minutes]   (start `npm run preview` first, or set URL=)
import { chromium } from 'playwright';
const minutes = Number(process.argv[2] ?? 4);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(120000); // software rendering on a busy machine can be slow
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
await page.evaluate(() => { window.__lw.setSpeed(400); window.__lw.snap.debug = true; });
const client = await page.context().newCDPSession(page);
const sample = async () => {
  await client.send('HeapProfiler.collectGarbage');
  const heap = (await client.send('Runtime.getHeapUsage')).usedSize;
  const s = await page.evaluate(() => {
    const e = window.__lw, r = e.view.renderer.info;
    return { tick: e.snap.tick, year: Math.floor(e.snap.tick / 11520) + 1, fps: Math.round(e.view.stats.fps), tps: Math.round(e.snap.tps), pop: e.snap.summary?.pop,
      geoms: r.memory.geometries, tex: r.memory.textures, events: e.snap.events.length, err: e.snap.error };
  });
  return { ...s, heapMB: +(heap / 1048576).toFixed(1) };
};
const out = [await sample()];
const t0 = Date.now();
while (Date.now() - t0 < minutes * 60000) {
  await page.waitForTimeout(30000);
  // poke the interface as a person would: hover, click someone, open a card
  await page.mouse.move(640, 400);
  await page.evaluate(() => { const v = window.__lw.view.band.visible[0]; if (v) window.__lw.select(v.id); });
  out.push(await sample());
}
for (const o of out) console.log(JSON.stringify(o));
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await browser.close();
