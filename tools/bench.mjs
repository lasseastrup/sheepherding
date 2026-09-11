// Headless render benchmark. Reports ms/frame, draw calls and triangles at several flock sizes.
// Software WebGL here, so absolute numbers are pessimistic; the comparisons are what matter.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const counts = (args.find((a) => !a.startsWith('--')) ?? '20,60,150,300,500').split(',').map(Number);
const server = await createServer({ configFile: 'vite.config.ts', server: { port: 5219, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const executablePath = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const calm = args.includes('--calm');
const offscreen = args.includes('--offscreen');
console.log(`  n   ms/frame   fps    sim   render   calls   triangles   (${calm ? 'calm flock' : 'pointer chasing'}${offscreen ? ', camera away: CPU only' : ''})`);
for (const n of counts) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
  await page.goto('http://127.0.0.1:5219/web/bench.html');
  await page.waitForFunction(() => !!window.benchOne, null, { timeout: 60_000 });
  const r = await page.evaluate(([c, q, o]) => { window.BENCH_CALM = q; window.BENCH_OFFSCREEN = o; return window.benchOne(c, 40); }, [n, calm, offscreen]);
  console.log(`${String(r.n).padStart(3)} ${r.ms.toFixed(1).padStart(8)} ${(1000 / r.ms).toFixed(0).padStart(6)} ${r.sim.toFixed(1).padStart(6)} ${r.draw.toFixed(1).padStart(7)} ${String(r.calls).padStart(8)} ${String(r.tris).padStart(10)}`);
  await page.close();
}
await browser.close();
await server.close();
