// Headless screenshots of the debug view at several simulated times.
// Usage: node tools/screenshot.mjs [--seed 1] [--count 20] [--times 0,60,180,420] [--out screenshots]
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
    return acc;
  }, []),
);
const seed = args.seed ?? '1';
const count = args.count ?? '20';
const times = (args.times ?? '0,60,180,420').split(',').map(Number);
const out = args.out ?? 'screenshots';
const port = 5199;
mkdirSync(out, { recursive: true });

const server = await createServer({ configFile: 'vite.config.ts', server: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const executablePath = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
for (const t of times) {
  const url = `http://127.0.0.1:${port}/?seed=${seed}&count=${count}&warmup=${t}&paused=1&links=1`;
  await page.goto(url);
  await page.waitForFunction(() => window.__sheep && window.__sheep.ready, null, { timeout: 120_000 });
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => window.__sheep.metrics);
  const file = `${out}/seed${seed}_n${count}_t${String(t).padStart(4, '0')}.png`;
  await page.screenshot({ path: file });
  console.log(file, metrics ? `cohesion=${metrics.cohesion.toFixed(2)} nnd=${metrics.nnd.toFixed(2)} splits=${metrics.splits}` : '');
}
await browser.close();
await server.close();
