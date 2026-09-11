/**
 * Playable single-page build of the flock simulation: sim on the main thread at a fixed
 * 30 Hz, canvas rendering with interpolation, pointer as the dog.
 */
import { Sim, SNAP_HEADER, SNAP_STRIDE, SheepState, STATE_NAMES, type Metrics } from '../src/sim';

const WORLD = { width: 40, height: 22 };

const palette = {
  graze: '#f2efe4',
  alert: '#e0a92e',
  walk: '#7fa3b8',
  run: '#c05a3e',
  rest: '#cfd3c8',
};

interface Ui {
  canvas: HTMLCanvasElement;
  census: HTMLElement;
  readouts: Record<string, HTMLElement>;
  hint: HTMLElement;
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
let pointerPx: { x: number; y: number } | null = null;
let pointerVel = { x: 0, y: 0 };
let metrics: Metrics = sim.metrics();
let grass: HTMLCanvasElement | null = null;
let hasHerded = false;

function reset(count: number, seed: number): void {
  sim = new Sim({ count, seed, world: WORLD });
  sim.run(20);
  prev = sim.writeSnapshot();
  cur = sim.writeSnapshot();
  metrics = sim.metrics();
  acc = 0;
}

function layout(canvas: HTMLCanvasElement): { scale: number; ox: number; oy: number } {
  const scale = Math.min(canvas.width / WORLD.width, canvas.height / WORLD.height);
  return { scale, ox: (canvas.width - WORLD.width * scale) / 2, oy: (canvas.height - WORLD.height * scale) / 2 };
}

/** Grass is drawn once into an offscreen canvas: thousands of tufts every frame is wasteful. */
function buildGrass(w: number, h: number, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d')!;
  const style = getComputedStyle(document.documentElement);
  const base = style.getPropertyValue('--paddock').trim() || '#6d8b5e';
  const tuft = style.getPropertyValue('--paddock-tuft').trim() || '#5f7d52';
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = tuft;
  g.lineWidth = Math.max(1, scale * 0.03);
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const n = Math.round((c.width * c.height) / 900);
  for (let i = 0; i < n; i++) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const len = scale * (0.1 + rnd() * 0.18);
    const lean = (rnd() - 0.5) * 0.8;
    g.globalAlpha = 0.25 + rnd() * 0.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + lean * len, y - len);
    g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

function drawSheep(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  scale: number,
  state: number,
  fear: number,
  size: number,
): void {
  const s = scale * size;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);

  g.save();
  g.translate(x, y);

  // shadow, offset against a fixed light from the upper left
  g.fillStyle = 'rgba(20, 30, 18, 0.28)';
  g.beginPath();
  g.ellipse(s * 0.1, s * 0.14, s * 0.52, s * 0.34, heading, 0, Math.PI * 2);
  g.fill();

  g.rotate(heading);

  const stateColour =
    state === SheepState.Alert ? palette.alert : state === SheepState.Walk ? palette.walk : state === SheepState.Run ? palette.run : palette.graze;
  g.fillStyle = debugColours ? stateColour : palette.graze;

  // fleece: an ellipse with a scalloped edge, so it reads as wool rather than a pebble
  g.beginPath();
  const lobes = 9;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const wob = 1 + 0.09 * Math.sin(a * 4.5 + size * 9);
    const px = Math.cos(a) * s * 0.48 * wob;
    const py = Math.sin(a) * s * 0.31 * wob;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();

  if (!debugColours && state !== SheepState.Graze) {
    // behaviour reads as a rim, not a wash: tinting the whole fleece turns sheep into pink blobs
    g.strokeStyle = stateColour;
    g.lineWidth = Math.max(1.2, s * 0.09);
    g.globalAlpha = state === SheepState.Run ? 0.95 : 0.75;
    g.stroke();
    g.globalAlpha = 1;
  }

  // head: always drawn along the heading, so an alert sheep visibly turns to look at you
  const hx = s * 0.52;
  g.fillStyle = '#2f3330';
  g.beginPath();
  g.ellipse(hx, 0, s * 0.17, s * 0.13, 0, 0, Math.PI * 2);
  g.fill();
  // ears
  g.beginPath();
  g.ellipse(hx - s * 0.04, -s * 0.15, s * 0.07, s * 0.045, -0.5, 0, Math.PI * 2);
  g.ellipse(hx - s * 0.04, s * 0.15, s * 0.07, s * 0.045, 0.5, 0, Math.PI * 2);
  g.fill();

  if (fear > 0.45) {
    // ears up and forward when frightened
    g.strokeStyle = 'rgba(47, 51, 48, 0.75)';
    g.lineWidth = Math.max(1, s * 0.045);
    g.beginPath();
    g.moveTo(hx + s * 0.02, -s * 0.16);
    g.lineTo(hx + s * 0.16, -s * 0.24);
    g.moveTo(hx + s * 0.02, s * 0.16);
    g.lineTo(hx + s * 0.16, s * 0.24);
    g.stroke();
  }

  g.restore();
  void cos;
  void sin;
}

function drawDog(g: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const s = scale * 1.5;
  const speed = Math.hypot(pointerVel.x, pointerVel.y);
  const heading = speed > 0.05 ? Math.atan2(pointerVel.y, pointerVel.x) : -Math.PI / 2;
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(20, 30, 18, 0.3)';
  g.beginPath();
  g.ellipse(s * 0.1, s * 0.14, s * 0.42, s * 0.24, heading, 0, Math.PI * 2);
  g.fill();
  // a soft ring so the dog is always findable: the page hides the system cursor over the paddock
  g.strokeStyle = 'rgba(20, 24, 18, 0.35)';
  g.lineWidth = Math.max(1, scale * 0.06);
  g.beginPath();
  g.arc(0, 0, s * 0.78, 0, Math.PI * 2);
  g.stroke();

  g.rotate(heading);
  // collie: dark body, white blaze and tail tip
  g.fillStyle = '#24262a';
  g.beginPath();
  g.ellipse(0, 0, s * 0.42, s * 0.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#eceae2';
  g.beginPath();
  g.ellipse(s * 0.34, 0, s * 0.12, s * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(-s * 0.44, 0, s * 0.1, s * 0.06, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function render(g: CanvasRenderingContext2D, alpha: number): void {
  const canvas = g.canvas;
  const { scale, ox, oy } = layout(canvas);
  const pw = WORLD.width * scale;
  const ph = WORLD.height * scale;

  const style = getComputedStyle(document.documentElement);
  g.fillStyle = style.getPropertyValue('--surface-sunk').trim() || '#1b2119';
  g.fillRect(0, 0, canvas.width, canvas.height);

  if (!grass || grass.width !== Math.round(pw) || grass.height !== Math.round(ph)) {
    grass = buildGrass(pw, ph, scale);
  }
  g.drawImage(grass, ox, oy);

  g.strokeStyle = 'rgba(28, 38, 26, 0.5)';
  g.lineWidth = Math.max(2, scale * 0.08);
  g.strokeRect(ox, oy, pw, ph);

  const n = cur[0] | 0;
  const sx = (x: number) => ox + x * scale;
  const sy = (y: number) => oy + y * scale;
  const lerpAngle = (a: number, b: number, t: number) => {
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * t;
  };
  const usePrev = (prev[0] | 0) === n;

  if (showLinks) {
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const o = SNAP_HEADER + i * SNAP_STRIDE;
      const l = cur[o + 7] | 0;
      if (l < 0 || l >= n) continue;
      const lo = SNAP_HEADER + l * SNAP_STRIDE;
      g.moveTo(sx(cur[o]), sy(cur[o + 1]));
      g.lineTo(sx(cur[lo]), sy(cur[lo + 1]));
    }
    g.stroke();
  }

  for (let i = 0; i < n; i++) {
    const o = SNAP_HEADER + i * SNAP_STRIDE;
    let x = cur[o];
    let y = cur[o + 1];
    let h = cur[o + 2];
    if (usePrev) {
      x = prev[o] + (x - prev[o]) * alpha;
      y = prev[o + 1] + (y - prev[o + 1]) * alpha;
      h = lerpAngle(prev[o + 2], h, alpha);
    }
    drawSheep(g, sx(x), sy(y), h, scale, cur[o + 4] | 0, cur[o + 5], cur[o + 6]);
  }

  if (pointerPx) drawDog(g, pointerPx.x, pointerPx.y, scale);
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
  const counts = document.querySelectorAll<HTMLElement>('[data-count]');
  counts.forEach((el) => {
    const st = Number(el.dataset.count);
    el.textContent = `${Math.round(m.fractions[st] * 100)}%`;
  });

  if (!hasHerded && m.fractions[SheepState.Run] > 0.3) {
    hasHerded = true;
    ui.hint.textContent = 'That was a stampede. Back off, let them settle, then try a wide arc instead.';
  }
}

export function start(ui: Ui): void {
  const g = ui.canvas.getContext('2d')!;

  const resize = (): void => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = ui.canvas.getBoundingClientRect();
    ui.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    ui.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    grass = null;
  };
  new ResizeObserver(resize).observe(ui.canvas);
  resize();

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = ui.canvas.getBoundingClientRect();
    const dpr = ui.canvas.width / rect.width;
    const { scale, ox, oy } = layout(ui.canvas);
    return { x: ((clientX - rect.left) * dpr - ox) / scale, y: ((clientY - rect.top) * dpr - oy) / scale };
  };
  const setPointer = (clientX: number, clientY: number): void => {
    const w = toWorld(clientX, clientY);
    pointer = w;
    const rect = ui.canvas.getBoundingClientRect();
    const dpr = ui.canvas.width / rect.width;
    pointerPx = { x: (clientX - rect.left) * dpr, y: (clientY - rect.top) * dpr };
  };

  ui.canvas.addEventListener('pointermove', (e) => {
    setPointer(e.clientX, e.clientY);
    if (e.pointerType === 'touch') e.preventDefault();
  });
  ui.canvas.addEventListener('pointerdown', (e) => {
    setPointer(e.clientX, e.clientY);
    ui.canvas.setPointerCapture(e.pointerId);
  });
  ui.canvas.addEventListener('pointerleave', () => {
    pointer = null;
    pointerPx = null;
  });

  const frame = (): void => {
    requestAnimationFrame(frame);
    const now = performance.now();
    let ft = (now - last) / 1000;
    last = now;
    if (ft > 0.25) ft = 0.25;
    if (!paused) {
      acc += ft;
      const dt = sim.cfg.dt;
      let steps = 0;
      while (acc >= dt && steps < 6) {
        const before = { x: sim.pointerX, y: sim.pointerY };
        prev = cur;
        if (pointer) sim.setPointer(pointer.x, pointer.y);
        else sim.setPointer(NaN, NaN);
        sim.tick();
        if (pointer && Number.isFinite(before.x)) {
          pointerVel.x = sim.threat.vx;
          pointerVel.y = sim.threat.vy;
        }
        cur = sim.writeSnapshot();
        acc -= dt;
        steps++;
      }
      if (steps > 0) {
        metrics = sim.metrics();
        updateReadouts(ui);
      }
    }
    render(g, paused ? 1 : Math.min(1, acc / sim.cfg.dt));
  };

  reset(24, 3);
  requestAnimationFrame(frame);

  return void 0;
}

export const controls = {
  reset,
  setPaused: (v: boolean) => { paused = v; },
  isPaused: () => paused,
  setDebugColours: (v: boolean) => { debugColours = v; },
  setLinks: (v: boolean) => { showLinks = v; },
  snapshot: () => ({ count: sim.cfg.count, seed: sim.cfg.seed, paused, debugColours, showLinks }),
};

declare global {
  interface Window {
    Sheep: { start: typeof start; controls: typeof controls };
  }
}
window.Sheep = { start, controls };
