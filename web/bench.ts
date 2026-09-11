/** Headless render benchmark: builds the 3D view at several flock sizes and times frames. */
import { SheepRenderer } from '../src/render3d/sheepRenderer';
import { Sim } from '../src/sim';
import { SHEEP_GLB_BASE64 } from './generated/sheep-glb';

function decode(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b.buffer;
}

/**
 * One measurement per page load. Creating several WebGL contexts on one canvas makes later
 * measurements meaningless, because the browser drops the oldest contexts as new ones appear.
 */
export async function benchOne(n: number, frames = 60): Promise<Record<string, number>> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  {
    const area = n * 12;
    const world = { width: Math.sqrt(area * 1.8), height: area / Math.sqrt(area * 1.8) };
    const r = new SheepRenderer({ canvas, world, ground: 'paddock', clearColour: '#dfe2d8' });
    await r.load(decode(SHEEP_GLB_BASE64));
    r.resize(1280, 720, 1);
    const sim = new Sim({ count: n, seed: 1, world });
    sim.run(15);
    r.setCount(n);
    let prev = sim.writeSnapshot();
    let cur = sim.writeSnapshot();
    // warm up
    for (let k = 0; k < 10; k++) { sim.tick(); prev = cur; cur = sim.writeSnapshot(); r.render(prev, cur, 0.5, 1 / 30, { debugColours: false, links: false }); }
    // Split the work: our own per-sheep JavaScript (animation, matrices, look-at) against the
    // draw itself, so a slow software rasteriser cannot hide a regression in the CPU path.
    const w = window as unknown as { BENCH_CALM?: boolean; BENCH_OFFSCREEN?: boolean };
    const disturb = !w.BENCH_CALM;
    // Point the camera away to strip out rasterisation and leave only the CPU work: animation,
    // matrices and draw submission. A software rasteriser is otherwise the only thing you measure.
    if (w.BENCH_OFFSCREEN) r.camera.position.set(1e5, 1e5, 1e5);
    const gl = r.renderer.getContext();
    let simMs = 0;
    let jsMs = 0;
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) {
      const a = performance.now();
      if (disturb) sim.setPointer(world.width * 0.3, world.height * 0.5);
      sim.tick();
      prev = cur;
      cur = sim.writeSnapshot();
      const b = performance.now();
      simMs += b - a;
      r.render(prev, cur, 0.5, 1 / 30, { debugColours: false, links: false });
      jsMs += performance.now() - b;
    }
    gl.finish();
    const ms = (performance.now() - t0) / frames;
    const info = r.renderer.info;
    return { n, ms, sim: simMs / frames, draw: jsMs / frames, calls: info.render.calls, tris: info.render.triangles };
  }
}

declare global { interface Window { benchOne: typeof benchOne } }
window.benchOne = benchOne;
