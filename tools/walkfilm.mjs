// Films people walking frame by frame on a fake clock, so the result is smooth however slowly
// this machine draws. The simulation runs on the page (no worker) so it shares the fake clock.
// Usage: node tools/walkfilm.mjs <outdir> [seconds=4] [speed=1] [zoom=5]   (needs `npm run preview` or URL=)
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [out = 'film', secs = '4', speed = '1', zoom = '5'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Shader Error|WebGL|THREE\./.test(m.text())) errs.push(m.text().slice(0, 300)); });
// a hand-wound clock: page time only moves when the script says so
await page.addInitScript(() => {
  window.Worker = function () { throw new Error('no workers in the film studio'); };
  let now = 0, seq = 1;
  const timers = new Map(), rafs = new Map();
  performance.now = () => now;
  window.setTimeout = (f, ms = 0, ...a) => { const id = seq++; timers.set(id, { at: now + Math.max(0, ms), f, a }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = (f, ms = 0, ...a) => { const id = seq++; const t = { at: now + ms, f, a, every: Math.max(1, ms) }; timers.set(id, t); return id; };
  window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (f) => { const id = seq++; rafs.set(id, f); return id; };
  window.cancelAnimationFrame = (id) => rafs.delete(id);
  window.__advance = (ms) => {
    const end = now + ms;
    for (let guard = 0; guard < 100000; guard++) {
      let next = null, nid = 0;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && id < nid))) { next = t; nid = id; }
      if (!next) break;
      now = Math.max(now, next.at);
      if (next.every) next.at += next.every; else timers.delete(nid);
      try { next.f(...next.a); } catch (e) { console.error(e); }
    }
    now = end;
    const due = [...rafs.values()];
    rafs.clear();
    for (const f of due) try { f(now); } catch (e) { console.error(e); }
  };
});
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
const runFor = (ms) => page.evaluate((ms) => { for (let t = 0; t < ms; t += 33) window.__advance(Math.min(33, ms - t)); }, ms);
const until = async (fn, step = 100, max = 600) => {
  for (let k = 0; k < max; k++) { if (await page.evaluate(fn)) return true; await runFor(step); }
  return false;
};
await page.waitForFunction(() => !!window.__lw && !!window.__advance);
await until(() => document.querySelector('#ui > .loading.done') !== null, 200, 3000);
await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '#ui > *:not(.loading) { display: none !important; }'; document.head.appendChild(st); });
// a little way into the first summer, mid-morning
await page.evaluate(() => window.__lw.skip('season'));
await until(() => !window.__lw.snap.skipping && window.__lw.snap.tick > 3000, 100);
await page.evaluate(() => window.__lw.setSpeed(30));
await until(() => { const t = window.__lw.snap.tick % 240; return t > 100 && t < 130; }, 50);
await page.evaluate((s) => window.__lw.setSpeed(Number(s)), speed);
await runFor(1500);
// someone on the move, followed closely
let id = -1;
for (let k = 0; k < 200 && id < 0; k++) {
  // someone walking on dry ground (not wading), heading somewhere a little way off
  id = await page.evaluate(() => {
    const e = window.__lw, w = e.snap.world, N = w.size;
    let best = -1;
    e.view.band.each((id, p) => {
      const tile = Math.floor(p.z) * N + Math.floor(p.x);
      if (best < 0 && p.act === 1 && p.age > 14 && !p.indoors && !w.water[tile]) best = id;
    });
    return best;
  });
  if (id < 0) await runFor(100);
}
await page.evaluate(([id, z]) => { const e = window.__lw; e.view.cam.minZoom = 1; e.select(id); e.setFollow(true); const p = e.view.band.positionOf(id); e.view.cam.frame(p.x, p.z, Number(z), true); }, [id, zoom]);
// no selection ring in the film
await page.evaluate(() => { window.__lw.view.band.selected = -2; });
await runFor(400);
const frames = Math.round(Number(secs) * 30);
const cdp = await page.context().newCDPSession(page);
rmSync(`${out}/f`, { recursive: true, force: true });
mkdirSync(`${out}/f`, { recursive: true });
for (let k = 0; k < frames; k++) {
  await runFor(1000 / 30);
  // straight from the compositor (Playwright's own screenshot waits on a frame callback we have taken over)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 300, y: 170, width: 300, height: 300, scale: 1 } });
  writeFileSync(`${out}/f/${String(k).padStart(4, '0')}.png`, Buffer.from(shot.data, 'base64'));
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${out}/f/%04d.png`, '-vf', 'scale=600:-1:flags=lanczos', '-pix_fmt', 'yuv420p', `${out}/walk.mp4`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${out}/f/%04d.png`, '-vf', 'fps=15,scale=300:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', `${out}/walk.gif`]);
console.log(JSON.stringify({ walker: id, frames, errs }));
await browser.close();
