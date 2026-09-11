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
      let pd = Infinity;
      for (let i = 0; i < sim.flock.count; i++) {
        fsum += sim.flock.fear[i];
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
      });
    }
  }
  return out;
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
