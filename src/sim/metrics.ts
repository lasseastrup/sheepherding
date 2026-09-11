import { Flock, MAX_CONTACTS } from './flock';
import { SheepState } from './types';

export interface Metrics {
  time: number;
  /** mean distance to centroid (BL) */
  cohesion: number;
  /** mean nearest-neighbour distance (BL) */
  nnd: number;
  /** |sum of unit velocities| / moving count, over sheep faster than movingThreshold */
  polarisation: number;
  /** connected components of the neighbour graph at splitDist (default 4 BL) */
  splits: number;
  /** mean |heading change| per step (degrees) for sheep with no movement intent */
  jitter: number;
  /** max disc penetration (BL) */
  overlap: number;
  /** fraction of sheep per state, indexed by SheepState */
  fractions: number[];
  centroidX: number;
  centroidY: number;
  movingFraction: number;
  meanSpeed: number;
  /** mean over sheep of the mean distance to their visible neighbours */
  meanVisDist: number;
  maxVisDist: number;
}

const parent = new Int32Array(1024);

function find(a: number): number {
  while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
  return a;
}

export function computeMetrics(flock: Flock, prevHeading: Float32Array, time: number, movingThreshold = 0.15, splitDist = 4.0): Metrics {
  const n = flock.count;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) { cx += flock.px[i]; cy += flock.py[i]; }
  cx /= Math.max(1, n); cy /= Math.max(1, n);

  let coh = 0;
  let nnd = 0;
  let sx = 0;
  let sy = 0;
  let moving = 0;
  let jit = 0;
  let jitN = 0;
  let meanSpeed = 0;
  let mvd = 0;
  let maxVd = 0;
  const fractions = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    coh += Math.hypot(flock.px[i] - cx, flock.py[i] - cy);
    nnd += Math.min(flock.nearestDist[i], 1e3);
    const sp = flock.speed[i];
    meanSpeed += sp;
    const vd = Math.min(flock.meanVisDist[i], 1e3);
    mvd += vd;
    if (vd > maxVd) maxVd = vd;
    if (sp > movingThreshold) {
      moving++;
      sx += flock.vx[i] / sp;
      sy += flock.vy[i] / sp;
    }
    // jitter: heading changes of sheep that have no intention to move
    if (flock.desiredSpeed[i] <= 1e-4 && sp < movingThreshold) {
      let d = flock.heading[i] - prevHeading[i];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      jit += Math.abs(d) * (180 / Math.PI);
      jitN++;
    }
    fractions[flock.state[i]]++;
  }
  for (let s = 0; s < fractions.length; s++) fractions[s] /= Math.max(1, n);

  // splits via union-find over pairs within splitDist (O(n^2), fine for a few hundred)
  for (let i = 0; i < n; i++) parent[i] = i;
  let overlap = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(flock.px[i] - flock.px[j], flock.py[i] - flock.py[j]);
      if (d < splitDist) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
      const pen = flock.radius[i] + flock.radius[j] - d;
      if (pen > overlap) overlap = pen;
    }
  }
  let comps = 0;
  for (let i = 0; i < n; i++) if (find(i) === i) comps++;
  void MAX_CONTACTS;

  return {
    time,
    cohesion: coh / Math.max(1, n),
    nnd: nnd / Math.max(1, n),
    polarisation: moving > 0 ? Math.hypot(sx, sy) / moving : 0,
    splits: comps,
    jitter: jitN > 0 ? jit / jitN : 0,
    overlap,
    fractions,
    centroidX: cx,
    centroidY: cy,
    movingFraction: moving / Math.max(1, n),
    meanSpeed: meanSpeed / Math.max(1, n),
    meanVisDist: mvd / Math.max(1, n),
    maxVisDist: maxVd,
  };
}

export { SheepState };
