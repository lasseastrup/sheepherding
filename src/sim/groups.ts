import type { Flock } from './flock';
import type { UniformGrid } from './grid';

/**
 * Connected sub-groups of the flock, by union-find over pairs closer than `linkDist`.
 *
 * What comes out of it is group size, which decides how badly a sheep wants to be somewhere else.
 * That is a question of absolute size, not of what share of the flock it can see: a pair is
 * frightened wherever it is, while half a flock is a flock and does not pine for the other half.
 * Getting that wrong is what makes a flock impossible to cut in two.
 */
export class Groups {
  private readonly parent: Int32Array;
  private readonly size: Int32Array;
  private readonly sumX: Float32Array;
  private readonly sumY: Float32Array;
  readonly groupOf: Int32Array;
  readonly groupSize: Int32Array;
  /** 0 when my group can stand on its own, 1 when I am alone */
  readonly seekRest: Float32Array;
  /** true when my group is small enough to abandon and I am away from the rest */
  readonly mustRejoin: Uint8Array;
  /** centre of my own group: what plain cohesion pulls toward */
  readonly groupX: Float32Array;
  readonly groupY: Float32Array;
  /**
   * Centre of everyone who is not in my group: the thing a sheep means by "the rest of the flock".
   * A sheep in one half of a cut flock is not drawn to the midpoint of both halves, which is where
   * the dog is standing; it is drawn to the other half. With a single group this is that group's
   * own centre, so nothing changes until the flock is actually divided.
   */
  readonly restX: Float32Array;
  readonly restY: Float32Array;
  groupCount = 1;
  /** centre of the whole flock */
  flockX = 0;
  flockY = 0;

  constructor(capacity: number) {
    this.parent = new Int32Array(capacity);
    this.size = new Int32Array(capacity);
    this.groupOf = new Int32Array(capacity);
    this.groupSize = new Int32Array(capacity);
    this.seekRest = new Float32Array(capacity);
    this.mustRejoin = new Uint8Array(capacity);
    this.groupX = new Float32Array(capacity);
    this.groupY = new Float32Array(capacity);
    this.restX = new Float32Array(capacity);
    this.restY = new Float32Array(capacity);
    this.sumX = new Float32Array(capacity);
    this.sumY = new Float32Array(capacity);
  }

  private find(a: number): number {
    const p = this.parent;
    while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; }
    return a;
  }

  private union(a: number, b: number): void {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return;
    if (this.size[a] < this.size[b]) { this.parent[a] = b; this.size[b] += this.size[a]; }
    else { this.parent[b] = a; this.size[a] += this.size[b]; }
  }

  /**
   * @param linkDist       sheep closer than this count as being in the same group
   * @param shedTolerance  group size at which a group stands on its own and stops seeking the rest
   * @param strayDist      how far from the flock a small group must be before it walks back
   */
  update(flock: Flock, grid: UniformGrid, linkDist: number, shedTolerance: number, strayDist: number): void {
    const n = flock.count;
    let fx = 0;
    let fy = 0;
    for (let i = 0; i < n; i++) { fx += flock.px[i]; fy += flock.py[i]; }
    this.flockX = fx / Math.max(1, n);
    this.flockY = fy / Math.max(1, n);

    for (let i = 0; i < n; i++) { this.parent[i] = i; this.size[i] = 1; }

    // Link over the grid, not the contact lists: those only reach about two body lengths, so
    // building groups from them ignored linkDist and split an ordinary grazing flock into a
    // handful of "groups", each of which then behaved as though it had lost the others.
    const rings = Math.max(1, Math.ceil(linkDist / grid.cellSize));
    const link2 = linkDist * linkDist;
    for (let i = 0; i < n; i++) {
      const cx = grid.cellX(flock.px[i]);
      const cy = grid.cellY(flock.py[i]);
      for (let gy = cy - rings; gy <= cy + rings; gy++) {
        if (gy < 0 || gy >= grid.rows) continue;
        for (let gx = cx - rings; gx <= cx + rings; gx++) {
          if (gx < 0 || gx >= grid.cols) continue;
          const c = gy * grid.cols + gx;
          for (let q = grid.cellStart[c]; q < grid.cellStart[c + 1]; q++) {
            const j = grid.cellItems[q];
            if (j <= i) continue;
            const dx = flock.px[i] - flock.px[j];
            const dy = flock.py[i] - flock.py[j];
            if (dx * dx + dy * dy <= link2) this.union(i, j);
          }
        }
      }
    }

    let count = 0;
    for (let i = 0; i < n; i++) { this.sumX[i] = 0; this.sumY[i] = 0; }
    for (let i = 0; i < n; i++) {
      const r = this.find(i);
      this.groupOf[i] = r;
      this.sumX[r] += flock.px[i];
      this.sumY[r] += flock.py[i];
    }

    // Scale with the flock: in a flock of five hundred, fifty sheep are still a fragment. At
    // ordinary flock sizes this leaves shedTolerance as written.
    const tol = Math.max(shedTolerance, n / 4);
    const span = Math.max(1, tol - 1);
    for (let i = 0; i < n; i++) {
      const r = this.groupOf[i];
      if (r === i) count++;
      const gs = this.size[r];
      this.groupSize[i] = gs;
      this.groupX[i] = this.sumX[r] / gs;
      this.groupY[i] = this.sumY[r] / gs;
      const others = n - gs;
      if (others > 0) {
        this.restX[i] = (fx - this.sumX[r]) / others;
        this.restY[i] = (fy - this.sumY[r]) / others;
      } else {
        this.restX[i] = this.groupX[i];
        this.restY[i] = this.groupY[i];
      }
      const seek = Math.min(1, Math.max(0, (tol - gs) / span));
      this.seekRest[i] = seek;
      const stray = Math.hypot(flock.px[i] - this.restX[i], flock.py[i] - this.restY[i]) > strayDist;
      this.mustRejoin[i] = seek > 0.5 && stray ? 1 : 0;
    }
    this.groupCount = count;
  }
}
