/**
 * Overlay renderer: the whole work area is the paddock. Transparent clear, shadow-only ground,
 * pointer position supplied by the main process (which can read the cursor even though this
 * window never receives mouse events).
 */
import { SheepRenderer } from '../src/render3d/sheepRenderer';
import { mergeConfig, Sim, SheepState, defaultConfig } from '../src/sim';
import { SHEEP_GLB_BASE64 } from '../web/generated/sheep-glb';
import { DEFAULT_CONFIG, MAX_SHEEP, type OverlayBridge, type OverlayConfig } from './ipc';

declare global {
  interface Window {
    sheepherding?: OverlayBridge;
  }
}

const bridge = window.sheepherding;
const canvas = document.getElementById('paddock') as HTMLCanvasElement;

let config: OverlayConfig = { ...DEFAULT_CONFIG };
let sim: Sim;
let renderer: SheepRenderer | null = null;
let prev: Float32Array;
let cur: Float32Array;
let acc = 0;
let last = performance.now();
let pointer: { x: number; y: number } | null = null;
let renderAcc = 0;
let fps = 0;
let lastMetrics = 0;

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function world(): { width: number; height: number } {
  return { width: Math.max(8, innerWidth / config.pxPerBL), height: Math.max(5, innerHeight / config.pxPerBL) };
}

function buildSim(): void {
  const base = mergeConfig(defaultConfig(), config.sim);
  sim = new Sim({ ...base, count: Math.min(config.count, MAX_SHEEP), seed: config.seed, world: world() });
  sim.run(20);
  prev = sim.writeSnapshot();
  cur = sim.writeSnapshot();
  acc = 0;
}

function buildRenderer(): void {
  renderer?.dispose();
  renderer = new SheepRenderer({
    canvas,
    world: world(),
    ground: 'transparent',
    clearColour: null,
    tiltDeg: config.tiltDeg,
  });
}

async function main(): Promise<void> {
  try {
    buildRenderer();
  } catch (err) {
    bridge?.ready({ ok: false, webgl: false, sheep: 0, width: innerWidth, height: innerHeight, error: String(err) });
    return;
  }
  const glb = decodeBase64(SHEEP_GLB_BASE64);
  await renderer!.load(glb);
  buildSim();
  renderer!.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
  renderer!.setCount(Math.min(config.count, MAX_SHEEP));

  bridge?.onPointer((p) => {
    pointer = p.active ? renderer!.screenToWorld(p.x, p.y, innerWidth, innerHeight) : null;
  });
  bridge?.onConfig((c, forceRebuild) => {
    const rebuild = forceRebuild || c.count !== config.count || c.pxPerBL !== config.pxPerBL || c.seed !== config.seed;
    const recam = c.tiltDeg !== config.tiltDeg || c.pxPerBL !== config.pxPerBL;
    const simChanged = JSON.stringify(c.sim) !== JSON.stringify(config.sim);
    config = { ...c };
    // behaviour changes apply to the running flock; only structural ones need a respawn
    if (simChanged && !rebuild) sim.applyConfig(mergeConfig(defaultConfig(), config.sim));
    if (recam) {
      buildRenderer();
      void renderer!.load(glb).then(() => {
        renderer!.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
        renderer!.setCount(Math.min(config.count, MAX_SHEEP));
      });
    }
    if (rebuild) buildSim();
  });

  addEventListener('resize', () => {
    // the paddock is the window: a new size is a new field
    buildRenderer();
    void renderer!.load(glb).then(() => {
      renderer!.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
      buildSim();
      renderer!.setCount(Math.min(config.count, MAX_SHEEP));
    });
  });

  const frame = (): void => {
    requestAnimationFrame(frame);
    const now = performance.now();
    let ft = (now - last) / 1000;
    last = now;
    if (ft > 0.25) ft = 0.25;
    if (config.paused) return;
    acc += ft;
    const dt = sim.cfg.dt;
    let steps = 0;
    while (acc >= dt && steps < 6) {
      prev = cur;
      if (pointer) sim.setPointer(pointer.x, pointer.y);
      else sim.setPointer(NaN, NaN);
      sim.tick();
      cur = sim.writeSnapshot();
      acc -= dt;
      steps++;
    }
    // Render at 30 fps while anything moves; a settled flock with no pointer redraws at 10 fps.
    // DWM keeps the last frame on screen, so skipping frames costs nothing visually.
    const m = sim.metrics();
    const idle = !pointer && m.movingFraction === 0 && m.fractions[SheepState.Graze] > 0.95;
    renderAcc += ft;
    const interval = idle ? 0.1 : 1 / 30;
    if (renderAcc < interval) {
      if (now - lastMetrics > 250) {
        lastMetrics = now;
        bridge?.metrics({ fps, cohesion: m.cohesion, nnd: m.nnd, polarisation: m.polarisation, splits: m.splits, fractions: m.fractions });
      }
      return;
    }
    renderAcc = 0;
    renderer!.render(prev, cur, Math.min(1, acc / dt), ft, {
      debugColours: config.debugColours,
      links: config.links,
    });

    // feed the tuning window
    fps += (1 / Math.max(1e-3, ft) - fps) * 0.1;
    if (now - lastMetrics > 250) {
      lastMetrics = now;
      bridge?.metrics({ fps, cohesion: m.cohesion, nnd: m.nnd, polarisation: m.polarisation, splits: m.splits, fractions: m.fractions });
    }
  };
  requestAnimationFrame(frame);

  bridge?.ready({ ok: true, webgl: true, sheep: config.count, width: innerWidth, height: innerHeight });
}

void main();
