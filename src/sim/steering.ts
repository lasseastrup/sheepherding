import type { SimConfig } from './config';
import { Flock, MAX_CONTACTS, MAX_NEIGHBOURS } from './flock';
import type { Rng } from './rng';
import { SheepState } from './types';

const DEG = Math.PI / 180;

function wrapAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function rotateToward(from: number, to: number, maxDelta: number): number {
  const d = wrapAngle(to - from);
  if (d > maxDelta) return from + maxDelta;
  if (d < -maxDelta) return from - maxDelta;
  return to;
}

/**
 * Context steering (Fray): behaviours write interest / danger lobes into per-direction slots,
 * combined per slot with max; danger masks interest; winner is interpolated and turn-rate limited.
 */
export class Steering {
  private readonly slotCos: Float32Array;
  private readonly slotSin: Float32Array;
  private readonly slots: number;

  constructor(private readonly cfg: SimConfig, private readonly rng: Rng) {
    this.slots = cfg.steering.slots;
    this.slotCos = new Float32Array(this.slots);
    this.slotSin = new Float32Array(this.slots);
    for (let s = 0; s < this.slots; s++) {
      const a = (s / this.slots) * Math.PI * 2;
      this.slotCos[s] = Math.cos(a);
      this.slotSin[s] = Math.sin(a);
    }
  }

  private lobe(map: Float32Array, base: number, dx: number, dy: number, w: number): void {
    if (w <= 0) return;
    for (let s = 0; s < this.slots; s++) {
      const v = w * (this.slotCos[s] * dx + this.slotSin[s] * dy);
      if (v > map[base + s]) map[base + s] = v;
    }
  }

  /** Returns the chosen direction angle, or NaN when there is no intent. Writes dangerAhead. */
  private resolve(flock: Flock, i: number, base: number): number {
    const N = this.slots;
    const interest = flock.interest;
    const danger = flock.danger;
    let minD = Infinity;
    for (let s = 0; s < N; s++) if (danger[base + s] < minD) minD = danger[base + s];
    const limit = minD + this.cfg.steering.maskMargin;
    let best = -1;
    let bestV = 1e-4;
    for (let s = 0; s < N; s++) {
      if (danger[base + s] > limit) continue;
      const v = interest[base + s];
      if (v > bestV) { bestV = v; best = s; }
    }
    if (best < 0) {
      // no intent: report danger in the current heading
      const cur = Math.round(wrapAngle(flock.heading[i]) / (Math.PI * 2 / N));
      flock.dangerAhead[i] = danger[base + ((cur % N) + N) % N];
      return NaN;
    }
    const l = best === 0 ? N - 1 : best - 1;
    const r = best === N - 1 ? 0 : best + 1;
    const vl = danger[base + l] > limit ? 0 : interest[base + l];
    const vr = danger[base + r] > limit ? 0 : interest[base + r];
    const denom = vl - 2 * bestV + vr;
    let offset = 0;
    if (Math.abs(denom) > 1e-6) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (vl - vr)) / denom));
    flock.dangerAhead[i] = danger[base + best];
    return ((best + offset) / N) * Math.PI * 2;
  }

  update(flock: Flock, dt: number): void {
    const cfg = this.cfg;
    const n = flock.count;
    const N = this.slots;
    const interest = flock.interest;
    const danger = flock.danger;
    const W = cfg.world;
    const F = cfg.fences;
    const K = cfg.kinematics;

    // global centroid for the run state
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < n; i++) { gx += flock.px[i]; gy += flock.py[i]; }
    gx /= Math.max(1, n); gy /= Math.max(1, n);

    for (let i = 0; i < n; i++) {
      const base = i * N;
      interest.fill(0, base, base + N);
      danger.fill(0, base, base + N);
      const st = flock.state[i] as SheepState;
      const x = flock.px[i];
      const y = flock.py[i];
      let desiredSpeed = 0;
      let turnRate = K.turnRateDeg.graze * DEG;

      switch (st) {
        case SheepState.Graze: {
          if (flock.stepRemaining[i] > 0) {
            desiredSpeed = cfg.graze.stepSpeed * flock.speedMult[i];
            this.lobe(interest, base, Math.cos(flock.wanderHeading[i]), Math.sin(flock.wanderHeading[i]), 0.6);
            if (flock.nearestDist[i] > cfg.graze.rejoinDist) {
              const dx = flock.lcmX[i] - x;
              const dy = flock.lcmY[i] - y;
              const d = Math.hypot(dx, dy);
              if (d > 1e-3) this.lobe(interest, base, dx / d, dy / d, cfg.graze.rejoinWeight * flock.gregarious[i]);
            }
            // spread out: crowding is danger
            const cb = i * MAX_CONTACTS;
            for (let q = 0; q < flock.contactCount[i]; q++) {
              const d = flock.contactDist[cb + q];
              if (d < cfg.graze.repelDist) {
                const j = flock.contacts[cb + q];
                const dx = flock.px[j] - x;
                const dy = flock.py[j] - y;
                const inv = d > 1e-3 ? 1 / d : 0;
                this.lobe(danger, base, dx * inv, dy * inv, cfg.graze.repelWeight * (1 - d / cfg.graze.repelDist));
              }
            }
          }
          break;
        }
        case SheepState.Alert: {
          turnRate = K.turnRateDeg.alert * DEG;
          break;
        }
        case SheepState.Walk: {
          turnRate = K.turnRateDeg.walk * DEG;
          const L = flock.leader[i];
          const walkSpeed = cfg.walk.speed * flock.speedMult[i];
          if (L >= 0) {
            const lhx = Math.cos(flock.heading[L]);
            const lhy = Math.sin(flock.heading[L]);
            const gap = cfg.walk.followGap;
            let tx: number;
            let ty: number;
            if (flock.leaderSide[i] === 0) {
              tx = flock.px[L] - lhx * gap;
              ty = flock.py[L] - lhy * gap;
            } else {
              const side = flock.leaderSide[i];
              tx = flock.px[L] - lhx * gap * 0.3 - lhy * gap * 0.8 * side;
              ty = flock.py[L] - lhy * gap * 0.3 + lhx * gap * 0.8 * side;
            }
            const dx = tx - x;
            const dy = ty - y;
            const d = Math.hypot(dx, dy);
            const gapNow = Math.hypot(flock.px[L] - x, flock.py[L] - y);
            if (d > 0.15) this.lobe(interest, base, dx / d, dy / d, 1.0);
            // speed regulates the gap to the leader
            desiredSpeed = Math.max(0, Math.min(walkSpeed * 1.3, walkSpeed * (gapNow / gap)));
            if (d < 0.15) desiredSpeed = 0;
          } else {
            // initiator: persistent random walk with slow heading drift
            flock.wanderHeading[i] += this.rng.normal() * (cfg.walk.headingNoiseDeg * DEG) * Math.sqrt(dt);
            this.lobe(interest, base, Math.cos(flock.wanderHeading[i]), Math.sin(flock.wanderHeading[i]), 0.8);
            const dx = flock.lcmX[i] - x;
            const dy = flock.lcmY[i] - y;
            const d = Math.hypot(dx, dy);
            if (d > 2) this.lobe(interest, base, dx / d, dy / d, cfg.walk.cohesionWeight * flock.gregarious[i]);
            desiredSpeed = walkSpeed;
          }
          this.neighbourDanger(flock, i, base, cfg.steering.neighbourDangerDist, cfg.steering.neighbourDangerWeight);
          break;
        }
        case SheepState.Run: {
          turnRate = K.turnRateDeg.run * DEG;
          const R = cfg.run;
          // cohesion: local centre of mass mixed with the global centroid
          let cxm = flock.lcmX[i] * (1 - R.cohesionCentroidMix) + gx * R.cohesionCentroidMix;
          let cym = flock.lcmY[i] * (1 - R.cohesionCentroidMix) + gy * R.cohesionCentroidMix;
          let vx = 0;
          let vy = 0;
          let dx = cxm - x;
          let dy = cym - y;
          let d = Math.hypot(dx, dy);
          const coh = R.cohesion * (1 + flock.fear[i]) * flock.gregarious[i];
          if (d > 0.5) { vx += (dx / d) * coh; vy += (dy / d) * coh; }
          // short-range repulsion
          let rx = 0;
          let ry = 0;
          const cb = i * MAX_CONTACTS;
          for (let q = 0; q < flock.contactCount[i]; q++) {
            const dd = flock.contactDist[cb + q];
            if (dd < R.repelDist) {
              const j = flock.contacts[cb + q];
              const inv = dd > 1e-3 ? 1 / dd : 0;
              rx += (x - flock.px[j]) * inv;
              ry += (y - flock.py[j]) * inv;
            }
          }
          const rl = Math.hypot(rx, ry);
          if (rl > 1e-6) { vx += (rx / rl) * R.repel * Math.min(1, rl); vy += (ry / rl) * R.repel * Math.min(1, rl); }
          // weak alignment with running neighbours
          let ax = 0;
          let ay = 0;
          const nb = i * MAX_NEIGHBOURS;
          for (let q = 0; q < flock.nbrCount[i]; q++) {
            const j = flock.nbr[nb + q];
            if (flock.state[j] === SheepState.Run) { ax += Math.cos(flock.heading[j]); ay += Math.sin(flock.heading[j]); }
          }
          const al = Math.hypot(ax, ay);
          if (al > 1e-6) { vx += (ax / al) * R.align; vy += (ay / al) * R.align; }
          // low-frequency noise (Ornstein–Uhlenbeck angle around the heading)
          flock.noiseAngle[i] += (-flock.noiseAngle[i] / R.noiseTau) * dt + this.rng.normal() * 0.8 * Math.sqrt(dt);
          const na = flock.heading[i] + flock.noiseAngle[i];
          vx += Math.cos(na) * R.noise; vy += Math.sin(na) * R.noise;
          const vl = Math.hypot(vx, vy);
          if (vl > 1e-6) this.lobe(interest, base, vx / vl, vy / vl, 1.0);
          desiredSpeed = (flock.stamina[i] > 0.2 ? R.speed : R.speed * 0.7) * flock.speedMult[i];
          this.neighbourDanger(flock, i, base, 1.0, 0.6);
          break;
        }
        case SheepState.Rest:
          break;
      }

      // fences: edges become danger as they approach
      if (desiredSpeed > 0) {
        const s0 = F.dangerStart;
        const s1 = F.dangerFull;
        const fw = (d: number) => (d >= s0 ? 0 : d <= s1 ? 1 : (s0 - d) / (s0 - s1));
        this.lobe(danger, base, -1, 0, fw(x));
        this.lobe(danger, base, 1, 0, fw(W.width - x));
        this.lobe(danger, base, 0, -1, fw(y));
        this.lobe(danger, base, 0, 1, fw(W.height - y));
      }

      let chosen = NaN;
      if (desiredSpeed > 0) chosen = this.resolve(flock, i, base);
      if (Number.isNaN(chosen)) {
        if (desiredSpeed > 0) desiredSpeed = 0; // wanted to move but every direction is blocked
        flock.desiredSpeed[i] = 0;
        continue;
      }
      flock.heading[i] = wrapAngle(rotateToward(flock.heading[i], chosen, turnRate * dt));
      flock.desiredSpeed[i] = desiredSpeed * (1 - Math.min(1, flock.dangerAhead[i]));
    }
  }

  private neighbourDanger(flock: Flock, i: number, base: number, dist: number, weight: number): void {
    const cb = i * MAX_CONTACTS;
    const x = flock.px[i];
    const y = flock.py[i];
    for (let q = 0; q < flock.contactCount[i]; q++) {
      const d = flock.contactDist[cb + q];
      if (d < dist) {
        const j = flock.contacts[cb + q];
        const inv = d > 1e-3 ? 1 / d : 0;
        this.lobe(flock.danger, base, (flock.px[j] - x) * inv, (flock.py[j] - y) * inv, weight * (1 - d / dist));
      }
    }
  }
}
