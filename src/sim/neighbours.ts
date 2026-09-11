import type { SimConfig } from './config';
import { Flock, MAX_CONTACTS, MAX_NEIGHBOURS } from './flock';
import type { UniformGrid } from './grid';

const MAX_CAND = 96;
const candIdx = new Int32Array(MAX_CAND);
const candDist = new Float32Array(MAX_CAND);
const candDx = new Float32Array(MAX_CAND);
const candDy = new Float32Array(MAX_CAND);
const selDx = new Float32Array(MAX_NEIGHBOURS);
const selDy = new Float32Array(MAX_NEIGHBOURS);

const FAR = 1e6;

/** Insert candidate keeping the list sorted by distance (bounded insertion sort). Returns new count. */
function insertCandidate(count: number, j: number, d: number, ux: number, uy: number): number {
  if (count >= MAX_CAND) {
    if (d >= candDist[count - 1]) return count;
    count--;
  }
  let p = count;
  while (p > 0 && candDist[p - 1] > d) {
    candIdx[p] = candIdx[p - 1];
    candDist[p] = candDist[p - 1];
    candDx[p] = candDx[p - 1];
    candDy[p] = candDy[p - 1];
    p--;
  }
  candIdx[p] = j; candDist[p] = d; candDx[p] = ux; candDy[p] = uy;
  return count + 1;
}

/**
 * For every sheep: contact list (physical + grazing-repulsion range), k nearest visible
 * (topological) neighbours with a field-of-view and occlusion test, nearest distance,
 * mean visible distance and the local centre of mass of the visible neighbours.
 */
export function computeNeighbours(flock: Flock, grid: UniformGrid, cfg: SimConfig): void {
  const n = flock.count;
  const k = Math.min(cfg.sheep.kVisible, MAX_NEIGHBOURS);
  const cosHalfFov = Math.cos((cfg.sheep.fovDeg / 2) * (Math.PI / 180));
  const cosOcc = Math.cos(cfg.sheep.occlusionDeg * (Math.PI / 180));
  const contactRange = 1.0; // extra range beyond touching, for grazing repulsion
  const { px, py } = flock;

  let nndSum = 0;
  for (let i = 0; i < n; i++) {
    const xi = px[i];
    const yi = py[i];
    let cc = 0;

    // gather from the 3x3 cells
    const cx = grid.cellX(xi);
    const cy = grid.cellY(yi);
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= grid.rows) continue;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= grid.cols) continue;
        const c = gy * grid.cols + gx;
        for (let q = grid.cellStart[c]; q < grid.cellStart[c + 1]; q++) {
          const j = grid.cellItems[q];
          if (j === i) continue;
          const dx = px[j] - xi;
          const dy = py[j] - yi;
          const d = Math.sqrt(dx * dx + dy * dy);
          const inv = d > 1e-6 ? 1 / d : 0;
          cc = insertCandidate(cc, j, d, dx * inv, dy * inv);
        }
      }
    }
    // topological neighbours need k candidates; fall back to a full scan when the cells are sparse
    if (cc < k && n > 1) {
      cc = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = px[j] - xi;
        const dy = py[j] - yi;
        const d = Math.sqrt(dx * dx + dy * dy);
        const inv = d > 1e-6 ? 1 / d : 0;
        cc = insertCandidate(cc, j, d, dx * inv, dy * inv);
      }
    }

    flock.nearestDist[i] = cc > 0 ? candDist[0] : FAR;
    if (cc > 0) nndSum += candDist[0];

    // contacts
    let nc = 0;
    const ri = flock.radius[i];
    for (let q = 0; q < cc && nc < MAX_CONTACTS; q++) {
      const j = candIdx[q];
      if (candDist[q] < ri + flock.radius[j] + contactRange) {
        flock.contacts[i * MAX_CONTACTS + nc] = j;
        flock.contactDist[i * MAX_CONTACTS + nc] = candDist[q];
        nc++;
      } else break; // sorted by distance
    }
    flock.contactCount[i] = nc;

    // visible k nearest with FOV + occlusion
    const hx = Math.cos(flock.heading[i]);
    const hy = Math.sin(flock.heading[i]);
    let ns = 0;
    let sumD = 0;
    let lx = 0;
    let ly = 0;
    for (let q = 0; q < cc && ns < k; q++) {
      const ux = candDx[q];
      const uy = candDy[q];
      if (hx * ux + hy * uy < cosHalfFov) continue; // in the blind cone
      let occluded = false;
      for (let s = 0; s < ns; s++) {
        if (selDx[s] * ux + selDy[s] * uy > cosOcc) { occluded = true; break; }
      }
      if (occluded) continue;
      selDx[ns] = ux; selDy[ns] = uy;
      const j = candIdx[q];
      flock.nbr[i * MAX_NEIGHBOURS + ns] = j;
      flock.nbrDist[i * MAX_NEIGHBOURS + ns] = candDist[q];
      sumD += candDist[q];
      lx += px[j]; ly += py[j];
      ns++;
    }
    if (ns === 0 && cc > 0) {
      // sees nobody (all behind): fall back to nearest by hearing/awareness
      const m = Math.min(k, cc);
      for (let q = 0; q < m; q++) {
        const j = candIdx[q];
        flock.nbr[i * MAX_NEIGHBOURS + q] = j;
        flock.nbrDist[i * MAX_NEIGHBOURS + q] = candDist[q];
        sumD += candDist[q];
        lx += px[j]; ly += py[j];
      }
      ns = m;
    }
    flock.nbrCount[i] = ns;
    if (ns > 0) {
      flock.meanVisDist[i] = sumD / ns;
      flock.lcmX[i] = lx / ns;
      flock.lcmY[i] = ly / ns;
    } else {
      flock.meanVisDist[i] = FAR;
      flock.lcmX[i] = xi;
      flock.lcmY[i] = yi;
    }
  }
  flock.meanNnd = n > 1 ? nndSum / n : 1;
}
