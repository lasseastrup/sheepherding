/**
 * Playable single-page build of the flock simulation: sim on the main thread at a fixed
 * 30 Hz, three.js sheep rendered with interpolation, the pointer as the dog.
 */
import { SheepRenderer } from '../src/render3d/sheepRenderer';
import { Sim, SheepState, STATE_NAMES, type Metrics } from '../src/sim';
import { SHEEP_GLB_BASE64 } from './generated/sheep-glb';

/**
 * The paddock grows with the flock. Grazing sheep occupy roughly 10-45 BL^2 each in the field;
 * hold a figure in that range and a flock of 500 spreads out like a flock of 20 rather than
 * packing into a carpet.
 */
const BL2_PER_SHEEP = 14;
const MIN_WORLD = { width: 30, height: 16.5 };
function worldFor(count: number): { width: number; height: number } {
  const area = Math.max(count * BL2_PER_SHEEP, MIN_WORLD.width * MIN_WORLD.height);
  const width = Math.sqrt(area * (MIN_WORLD.width / MIN_WORLD.height));
  return { width, height: area / width };
}
let WORLD = worldFor(24);

const palette = {
  graze: '#d9d4c2',
  alert: '#e0a92e',
  walk: '#7fa3b8',
  run: '#c05a3e',
};

interface Ui {
  canvas: HTMLCanvasElement;
  census: HTMLElement;
  readouts: Record<string, HTMLElement>;
  hint: HTMLElement;
  zoom: HTMLInputElement;
  zoomVal: HTMLElement;
}

let sim = new Sim({ count: 24, seed: 3, world: WORLD });
let prev = sim.writeSnapshot();
let cur = sim.writeSnapshot();
let acc = 0;
let last = performance.now();
let paused = false;
let debugColours = false;
let showLinks = false;
let pointer: { x: number; y: number } | null = null;
/** last pointer position in canvas pixels; the world point is re-derived every frame */
let pointerScreen: { x: number; y: number } | null = null;
let metrics: Metrics = sim.metrics();
let hasHerded = false;
let renderer: SheepRenderer | null = null;

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function reset(count: number, seed: number): void {
  WORLD = worldFor(count);
  sim = new Sim({ count, seed, world: WORLD });
  sim.run(20);
  prev = sim.writeSnapshot();
  cur = sim.writeSnapshot();
  metrics = sim.metrics();
  acc = 0;
  renderer?.setWorld(WORLD);
  renderer?.setCount(count);
}

function updateReadouts(ui: Ui): void {
  const m = metrics;
  ui.readouts.cohesion.textContent = m.cohesion.toFixed(1);
  ui.readouts.spacing.textContent = m.nnd.toFixed(1);
  ui.readouts.polarisation.textContent = m.polarisation.toFixed(2);
  ui.readouts.groups.textContent = String(m.splits);

  const order = [SheepState.Graze, SheepState.Alert, SheepState.Walk, SheepState.Run];
  const colours = [palette.graze, palette.alert, palette.walk, palette.run];
  const bars = ui.census.querySelectorAll<HTMLElement>('[data-state]');
  bars.forEach((bar, k) => {
    const frac = m.fractions[order[k]];
    bar.style.flexGrow = String(Math.max(0.001, frac));
    bar.style.background = colours[k];
    bar.setAttribute('aria-label', `${STATE_NAMES[order[k]]} ${Math.round(frac * 100)} percent`);
  });
  document.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const st = Number(el.dataset.count);
    el.textContent = `${Math.round(m.fractions[st] * 100)}%`;
  });

  if (!hasHerded && m.fractions[SheepState.Run] > 0.3) {
    hasHerded = true;
    ui.hint.textContent = 'That was a stampede. Back off, let them settle, then try a wide arc instead.';
  }
}

export async function start(ui: Ui): Promise<void> {
  const style = getComputedStyle(document.documentElement);
  try {
    renderer = new SheepRenderer({
      canvas: ui.canvas,
      world: WORLD,
      ground: 'paddock',
      tiltDeg: 24,
      groundColour: style.getPropertyValue('--paddock').trim() || '#6d8b5e',
      tuftColour: style.getPropertyValue('--paddock-tuft').trim() || '#5c7a4f',
      clearColour: style.getPropertyValue('--surface-sunk').trim() || '#dfe2d8',
    });
  } catch (err) {
    ui.hint.textContent = 'This browser could not start WebGL, so the paddock cannot be drawn here.';
    console.error(err);
    return;
  }
  await renderer.load(decodeBase64(SHEEP_GLB_BASE64));

  const size = (): { w: number; h: number } => {
    const r = ui.canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  const resize = (): void => {
    const { w, h } = size();
    renderer!.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
  };
  new ResizeObserver(resize).observe(ui.canvas);
  resize();

  const setPointer = (clientX: number, clientY: number): void => {
    const rect = ui.canvas.getBoundingClientRect();
    pointerScreen = { x: clientX - rect.left, y: clientY - rect.top };
  };
  // The camera pans while the flock moves, so the same screen position is a different patch of
  // grass from one frame to the next. Re-derive the dog's world position every frame or the sheep
  // end up reacting to a spot the pointer left behind.
  const syncPointer = (): void => {
    if (!pointerScreen) { pointer = null; return; }
    const rect = ui.canvas.getBoundingClientRect();
    pointer = renderer!.screenToWorld(pointerScreen.x, pointerScreen.y, rect.width, rect.height);
  };
  ui.canvas.addEventListener('pointermove', (e) => {
    setPointer(e.clientX, e.clientY);
    if (e.pointerType === 'touch') e.preventDefault();
  });
  ui.canvas.addEventListener('pointerdown', (e) => {
    setPointer(e.clientX, e.clientY);
    ui.canvas.setPointerCapture(e.pointerId);
  });
  ui.canvas.addEventListener('pointerleave', () => { pointerScreen = null; pointer = null; });

  const applyZoom = (z: number): void => {
    const applied = renderer!.setZoom(z);
    ui.zoom.value = applied.toFixed(1);
    ui.zoomVal.textContent = `${applied.toFixed(1)}×`;
  };
  ui.zoom.addEventListener('input', () => applyZoom(Number(ui.zoom.value)));
  ui.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      applyZoom(renderer!.zoom * Math.exp(-e.deltaY * 0.0015));
      setPointer(e.clientX, e.clientY);
    },
    { passive: false },
  );
  addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.key === '+' || e.key === '=') applyZoom(renderer!.zoom * 1.25);
    else if (e.key === '-' || e.key === '_') applyZoom(renderer!.zoom / 1.25);
    else if (e.key === '0') applyZoom(1);
  });
  applyZoom(Number(ui.zoom.value) || 1);

  const frame = (): void => {
    requestAnimationFrame(frame);
    const now = performance.now();
    let ft = (now - last) / 1000;
    last = now;
    if (ft > 0.25) ft = 0.25;
    syncPointer();
    if (!paused) {
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
      if (steps > 0) {
        metrics = sim.metrics();
        updateReadouts(ui);
      }
    }
    renderer!.render(prev, cur, paused ? 1 : Math.min(1, acc / sim.cfg.dt), paused ? 0 : ft, {
      debugColours,
      links: showLinks,
    });
  };

  reset(24, 3);
  requestAnimationFrame(frame);
}

export const controls = {
  reset,
  setPaused: (v: boolean) => { paused = v; },
  isPaused: () => paused,
  setDebugColours: (v: boolean) => { debugColours = v; },
  setLinks: (v: boolean) => { showLinks = v; },
  snapshot: () => ({ count: sim.cfg.count, seed: sim.cfg.seed, paused, debugColours, showLinks, zoom: renderer?.zoom ?? 1 }),
};

declare global {
  interface Window {
    Sheep: { start: typeof start; controls: typeof controls };
  }
}
window.Sheep = { start, controls };
