import { Sim, type DeepPartial, type SimConfig } from '../src/sim';

export interface StepSample {
  t: number;
  cohesion: number;
  nnd: number;
  splits: number;
  polarisation: number;
  runFrac: number;
  alertFrac: number;
  grazeFrac: number;
  walkFrac: number;
  meanFear: number;
  maxFear: number;
  pointerDist: number;
  /** mean ground speed of the flock (BL/s) */
  speed: number;
}

/** Drive the sim with a scripted pointer path and sample metrics every simulated second. */
export function drive(
  sim: Sim,
  seconds: number,
  path: (t: number) => { x: number; y: number } | null,
  onStep?: (t: number) => void,
): StepSample[] {
  const dt = sim.cfg.dt;
  const steps = Math.round(seconds / dt);
  const out: StepSample[] = [];
  let nextSample = 0;
  for (let k = 0; k < steps; k++) {
    const t = sim.time;
    const p = path(t);
    if (p) sim.setPointer(p.x, p.y);
    else sim.setPointer(NaN, NaN);
    sim.tick();
    onStep?.(sim.time);
    if (sim.time >= nextSample) {
      nextSample += 1;
      const m = sim.metrics();
      let fsum = 0;
      let fmax = 0;
      let ssum = 0;
      let pd = Infinity;
      for (let i = 0; i < sim.flock.count; i++) {
        fsum += sim.flock.fear[i];
        ssum += sim.flock.speed[i];
        if (sim.flock.fear[i] > fmax) fmax = sim.flock.fear[i];
        if (p) pd = Math.min(pd, Math.hypot(sim.flock.px[i] - p.x, sim.flock.py[i] - p.y));
      }
      out.push({
        t: sim.time,
        cohesion: m.cohesion,
        nnd: m.nnd,
        splits: m.splits,
        polarisation: m.polarisation,
        runFrac: m.fractions[3],
        alertFrac: m.fractions[1],
        grazeFrac: m.fractions[0],
        walkFrac: m.fractions[2],
        meanFear: fsum / sim.flock.count,
        maxFear: fmax,
        pointerDist: pd,
        speed: ssum / sim.flock.count,
      });
    }
  }
  return out;
}

/** Connected groups of the flock at `dist`, as member index lists, largest first. */
export function groupsOf(sim: Sim, dist = 4): number[][] {
  const n = sim.flock.count;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(sim.flock.px[i] - sim.flock.px[j], sim.flock.py[i] - sim.flock.py[j]) < dist) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const m = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!m.has(r)) m.set(r, []);
    m.get(r)!.push(i);
  }
  return [...m.values()].sort((a, b) => b.length - a.length);
}

/** Centre of a set of sheep. */
export function centreOf(sim: Sim, ix: number[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const i of ix) { x += sim.flock.px[i]; y += sim.flock.py[i]; }
  return { x: x / ix.length, y: y / ix.length };
}

/** Where a shepherd stands to hold a cut open: in the gap, or the middle of a whole flock. */
export function gapPoint(sim: Sim): { x: number; y: number } {
  const g = groupsOf(sim);
  if (g.length >= 2 && g[1].length >= 3) {
    const a = centreOf(sim, g[0]);
    const b = centreOf(sim, g[1]);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return centreOf(sim, g[0]);
}

export function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

/** A settled flock: run undisturbed until it is grazing calmly. */
export function settled(patch?: DeepPartial<SimConfig>): Sim {
  const sim = new Sim(patch);
  sim.run(45);
  return sim;
}

/** Distance from a point to the nearest sheep. */
export function nearestSheep(sim: Sim, x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i < sim.flock.count; i++) d = Math.min(d, Math.hypot(sim.flock.px[i] - x, sim.flock.py[i] - y));
  return d;
}

/** Radius of the flock: the furthest sheep from its centroid. */
export function flockRadius(sim: Sim): number {
  const c = centroid(sim);
  let r = 0;
  for (let i = 0; i < sim.flock.count; i++) r = Math.max(r, Math.hypot(sim.flock.px[i] - c.x, sim.flock.py[i] - c.y));
  return r;
}

export function meanFear(sim: Sim): number {
  let f = 0;
  for (let i = 0; i < sim.flock.count; i++) f += sim.flock.fear[i];
  return f / sim.flock.count;
}

export function centroid(sim: Sim): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < sim.flock.count; i++) { x += sim.flock.px[i]; y += sim.flock.py[i]; }
  return { x: x / sim.flock.count, y: y / sim.flock.count };
}
