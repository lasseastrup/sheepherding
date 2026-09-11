/** Deterministic PRNG (mulberry32) with a few distributions. Never use Math.random in the sim. */
export class Rng {
  private s: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.s = (seed | 0) || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal (Box–Muller). */
  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * v;
    this.spare = r * Math.sin(a);
    return r * Math.cos(a);
  }

  /** Exponential waiting time for a Poisson process with the given rate (per second). */
  expo(rate: number): number {
    return -Math.log(1 - this.next()) / rate;
  }

  /** Random unit-vector angle in [0, 2π). */
  angle(): number {
    return this.next() * Math.PI * 2;
  }
}
