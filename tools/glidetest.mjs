import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
await page.goto(`${process.env.URL ?? 'http://localhost:4173/index.html'}#w4471-128`);
await page.waitForSelector('#ui > .loading.done', { timeout: 120000 });
const res = await page.evaluate(async () => {
  const e = window.__lw;
  e.setPaused(true);
  await new Promise((r) => setTimeout(r, 500));
  const band = e.view.band;
  // one walker moving 0.42 tiles per tick along x, one frame per 400 ms (1x: 2.5 ticks a second).
  // The drawing step runs here at a steady 60 a second, so the result doesn't depend on how fast
  // this machine can actually render.
  const mk = (tick, x) => ({ type: 'frame', tick, speed: 2.5, skipping: false, deer: new Float32Array(0),
    people: Float32Array.from([999, x, 60, x + 1, 60, 1, 0, 0, 30, 1, 5, 5, 0]) });
  const samples = [];
  let x = 40, tick = 100000;
  band.onFrame(mk(tick, x), 2.5, performance.now());
  const t0 = performance.now();
  await new Promise((done) => {
    let nextFrame = t0 + 400;
    let last = t0;
    const iv = setInterval(() => {
      const now = performance.now();
      if (now >= nextFrame) { x += 0.42; tick++; band.onFrame(mk(tick, x), 2.5, now); nextFrame += 400; }
      band.update(Math.min(0.1, (now - last) / 1000), now, 0, e.view.cam.target);
      last = now;
      const p = band.positionOf(999);
      samples.push([now - t0, p.x]);
      if (now - t0 > 6000) { clearInterval(iv); done(); }
    }, 16);
  });
  let back = 0, maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i][1] - samples[i - 1][1];
    if (d < -1e-6) back++;
    maxStep = Math.max(maxStep, d);
  }
  return { samples: samples.length, start: samples[0][1].toFixed(2), end: samples[samples.length - 1][1].toFixed(2), travelled: (samples[samples.length - 1][1] - samples[0][1]).toFixed(2), expected: (x - 40).toFixed(2), backwardSteps: back, maxStepPerSample: maxStep.toFixed(3) };
});
console.log(JSON.stringify(res));
await browser.close();
