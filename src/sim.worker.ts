import { Sim, snapshotLength, type DeepPartial, type Metrics, type SimConfig } from './sim';

interface WorkerCtx {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}
const ctx = self as unknown as WorkerCtx;

export type WorkerIn =
  | { type: 'init'; patch?: DeepPartial<SimConfig>; warmup?: number; speed?: number; paused?: boolean }
  | { type: 'pointer'; x: number; y: number; active: boolean }
  | { type: 'config'; patch: DeepPartial<SimConfig> }
  | { type: 'speed'; factor: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'buffer'; buffer: ArrayBuffer };

export type WorkerOut =
  | { type: 'snapshot'; buffer: ArrayBuffer; length: number; metrics?: Metrics }
  | { type: 'ready'; time: number };

let sim: Sim | null = null;
let speed = 1;
let paused = false;
let last = 0;
let acc = 0;
let sendCount = 0;
const pool: ArrayBuffer[] = [];

function send(): void {
  if (!sim) return;
  const len = snapshotLength(sim.flock.count);
  let buf = pool.pop();
  if (!buf || buf.byteLength < len * 4) buf = new ArrayBuffer(len * 4);
  const arr = new Float32Array(buf, 0, len);
  sim.writeSnapshot(arr);
  const withMetrics = sendCount++ % 5 === 0;
  const msg: WorkerOut = { type: 'snapshot', buffer: buf, length: len, metrics: withMetrics ? sim.metrics() : undefined };
  ctx.postMessage(msg, [buf]);
}

function loop(): void {
  if (!sim) return;
  const now = performance.now();
  let ft = (now - last) / 1000;
  last = now;
  if (paused) return;
  if (ft > 0.25) ft = 0.25;
  acc += ft * speed;
  const dt = sim.cfg.dt;
  let steps = 0;
  while (acc >= dt && steps < 400) {
    sim.tick();
    acc -= dt;
    steps++;
  }
  if (steps > 0) send();
}

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as WorkerIn;
  switch (msg.type) {
    case 'init': {
      sim = new Sim(msg.patch);
      speed = msg.speed ?? 1;
      paused = msg.paused ?? false;
      if (msg.warmup && msg.warmup > 0) sim.run(msg.warmup);
      last = performance.now();
      acc = 0;
      send();
      ctx.postMessage({ type: 'ready', time: sim.time } satisfies WorkerOut);
      setInterval(loop, 1000 / 60);
      break;
    }
    case 'pointer':
      if (sim) sim.setPointer(msg.active ? msg.x : NaN, msg.active ? msg.y : NaN);
      break;
    case 'config':
      if (sim) sim.applyConfig(msg.patch);
      break;
    case 'speed':
      speed = msg.factor;
      break;
    case 'pause':
      paused = msg.paused;
      if (sim && paused) send();
      break;
    case 'buffer':
      if (pool.length < 4) pool.push(msg.buffer);
      break;
  }
};
