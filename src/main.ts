import { render2d, screenToWorld } from './render2d';
import { STATE_NAMES, type DeepPartial, type Metrics, type SimConfig } from './sim';
import type { WorkerIn, WorkerOut } from './sim.worker';

declare global {
  interface Window {
    __sheep?: { ready: boolean; time: number; metrics: Metrics | null; post: (msg: WorkerIn) => void };
  }
}

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const flag = (k: string, d: boolean) => (params.has(k) ? params.get(k) !== '0' : d);

const worldWidth = num('w', 40);
const worldHeight = num('h', 22);
const patch: DeepPartial<SimConfig> = {
  seed: num('seed', 1),
  count: num('count', 20),
  world: { width: worldWidth, height: worldHeight },
};
const warmup = num('warmup', 0);
const speed = num('fast', 1);
let paused = flag('paused', false);
let showLinks = flag('links', true);
let showHeadings = flag('headings', false);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: WorkerIn, transfer?: Transferable[]) => (transfer ? worker.postMessage(msg, transfer) : worker.postMessage(msg));

let prev: Float32Array | null = null;
let cur: Float32Array | null = null;
let curBuffer: ArrayBuffer | null = null;
let prevBuffer: ArrayBuffer | null = null;
let lastRecv = performance.now();
let interval = 1000 / 30;
let metrics: Metrics | null = null;
let ready = false;
let pointer: { x: number; y: number } | null = null;

window.__sheep = { ready: false, time: 0, metrics: null, post };

worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
  const msg = ev.data;
  if (msg.type === 'ready') {
    ready = true;
    window.__sheep!.ready = true;
    window.__sheep!.time = msg.time;
    return;
  }
  const now = performance.now();
  interval = interval * 0.9 + (now - lastRecv) * 0.1;
  lastRecv = now;
  if (prevBuffer) post({ type: 'buffer', buffer: prevBuffer }, [prevBuffer]);
  prevBuffer = curBuffer;
  prev = cur;
  curBuffer = msg.buffer;
  cur = new Float32Array(msg.buffer, 0, msg.length);
  if (msg.metrics) {
    metrics = msg.metrics;
    window.__sheep!.metrics = metrics;
  }
  window.__sheep!.time = cur[1];
};

post({ type: 'init', patch, warmup, speed, paused });

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

canvas.addEventListener('mousemove', (e) => {
  const dpr = canvas.width / innerWidth;
  pointer = screenToWorld(e.clientX * dpr, e.clientY * dpr, canvas.width, canvas.height, worldWidth, worldHeight);
  post({ type: 'pointer', x: pointer.x, y: pointer.y, active: true });
});
canvas.addEventListener('mouseleave', () => {
  pointer = null;
  post({ type: 'pointer', x: 0, y: 0, active: false });
});
addEventListener('keydown', (e) => {
  if (e.key === ' ') { paused = !paused; post({ type: 'pause', paused }); }
  else if (e.key === 'l') showLinks = !showLinks;
  else if (e.key === 'v') showHeadings = !showHeadings;
  else if (e.key === '+' || e.key === '=') post({ type: 'speed', factor: 4 });
  else if (e.key === '-') post({ type: 'speed', factor: 1 });
});

function frame(): void {
  requestAnimationFrame(frame);
  if (!cur) return;
  const alpha = paused ? 1 : Math.min(1, (performance.now() - lastRecv) / Math.max(1, interval));
  render2d(ctx, prev, cur, alpha, { worldWidth, worldHeight, showLinks, showHeadings, pointer });
  const m = metrics;
  const t = cur[1];
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60).toString().padStart(2, '0');
  let text = `t ${mm}:${ss}  n ${cur[0] | 0}${paused ? '  PAUSED' : ''}${ready ? '' : '  loading'}\n`;
  if (m) {
    text += `cohesion ${m.cohesion.toFixed(2)}  nnd ${m.nnd.toFixed(2)}  splits ${m.splits}  pol ${m.polarisation.toFixed(2)}\n`;
    text += `jitter ${m.jitter.toFixed(2)}°  overlap ${m.overlap.toFixed(3)}  moving ${(m.movingFraction * 100).toFixed(0)}%\n`;
    text += m.fractions.map((f, i) => `${STATE_NAMES[i]} ${(f * 100).toFixed(0)}%`).join('  ') + '\n';
  }
  text += 'space pause · l links · v headings · +/- speed';
  hud.textContent = text;
}
requestAnimationFrame(frame);
