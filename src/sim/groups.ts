import { Flock, MAX_CONTACTS } from './flock';

/**
 * Connected sub-groups of the flock, by union-find over pairs closer than `linkDist`.
 * Sheep are gregarious: a small sub-group is an uneasy sub-group (groups under about four
 * are visibly stressed), and that unease is what pulls a fragmented flock back together.
 */
export class Groups {
  private readonly parent: Int32Array;
  private readonly size: Int32Array;
  readonly groupOf: Int32Array;
  readonly groupSize: Int32Array;
  /** how much of the flock I am cut off from: 0 with everyone, ~1 when alone */
  readonly unease: Float32Array;
  /** true when my group is both a minority fragment and too small to feel safe in */
  readonly mustRejoin: Uint8Array;
  groupCount = 1;

  constructor(capacity: number) {
    this.parent = new Int32Array(capacity);
    this.size = new Int32Array(capacity);
    this.groupOf = new Int32Array(capacity);
    this.groupSize = new Int32Array(capacity);
    this.unease = new Float32Array(capacity);
    this.mustRejoin = new Uint8Array(capacity);
  }

  private find(a: number): number {
    const p = this.parent;
    while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; }
    return a;
  }

  update(flock: Flock, linkDist: number, comfortable: number, strayDist: number): void {
    const n = flock.count;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) { cx += flock.px[i]; cy += flock.py[i]; }
    cx /= Math.max(1, n);
    cy /= Math.max(1, n);
    for (let i = 0; i < n; i++) { this.parent[i] = i; this.size[i] = 1; }
    for (let i = 0; i < n; i++) {
      const cb = i * MAX_CONTACTS;
      for (let q = 0; q < flock.contactCount[i]; q++) {
        const j = flock.contacts[cb + q];
        if (j <= i) continue;
        if (flock.contactDist[cb + q] > linkDist) continue;
        const a = this.find(i);
        const b = this.find(j);
        if (a === b) continue;
        if (this.size[a] < this.size[b]) { this.parent[a] = b; this.size[b] += this.size[a]; }
        else { this.parent[b] = a; this.size[a] += this.size[b]; }
      }
    }
    let count = 0;
    for (let i = 0; i < n; i++) {
      const r = this.find(i);
      if (r === i) count++;
      this.groupOf[i] = r;
      const gs = this.size[r];
      this.groupSize[i] = gs;
      // Two separate things matter: how much of the flock I am cut off from (drives steering),
      // and whether my group is small enough in absolute terms to be worth abandoning (drives
      // the decision to walk back). A group of eight is viable; a pair is not.
      const fragmentation = 1 - gs / Math.max(1, n);
      this.unease[i] = Math.min(1, Math.max(0, fragmentation));
      // and it only counts as being cut off if I am actually away from the main body: a walking
      // line of sheep is strung out but not lost, and must still be allowed to stop.
      const stray = Math.hypot(flock.px[i] - cx, flock.py[i] - cy) > strayDist;
      this.mustRejoin[i] = fragmentation > 0.5 && gs < comfortable && stray ? 1 : 0;
    }
    this.groupCount = count;
  }
}
