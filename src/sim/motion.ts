import type { SimConfig } from './config';
import { Flock, MAX_CONTACTS } from './flock';
import { SheepState } from './types';

/** Integration, position-based non-overlap, fences, velocity recovery and smoothing. */
export class Motion {
  private readonly tmpVx: Float32Array;
  private readonly tmpVy: Float32Array;

  constructor(private readonly cfg: SimConfig, capacity: number) {
    this.tmpVx = new Float32Array(capacity);
    this.tmpVy = new Float32Array(capacity);
  }

  update(flock: Flock, dt: number): void {
    const cfg = this.cfg;
    const n = flock.count;
    const K = cfg.kinematics;
    const { px, py, vx, vy, prevX, prevY } = flock;

    // 1. velocity relaxes toward heading * desiredSpeed
    for (let i = 0; i < n; i++) {
      const st = flock.state[i];
      const ds = flock.desiredSpeed[i];
      const tx = Math.cos(flock.heading[i]) * ds;
      const ty = Math.sin(flock.heading[i]) * ds;
      const accelerating = ds > flock.speed[i];
      const tau = st === SheepState.Run
        ? (accelerating ? K.accelTau.run : K.decelTau.run)
        : st === SheepState.Walk
          ? (accelerating ? K.accelTau.walk : K.decelTau.walk)
          : (accelerating ? K.accelTau.graze : K.decelTau.graze);
      const k = 1 - Math.exp(-dt / tau);
      vx[i] += (tx - vx[i]) * k;
      vy[i] += (ty - vy[i]) * k;
      prevX[i] = px[i];
      prevY[i] = py[i];
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
    }

    // 2. position-based dynamics: disc non-overlap with friction, then fences
    this.solveContacts(flock, n);

    // 3. velocity recovery
    for (let i = 0; i < n; i++) {
      vx[i] = (px[i] - prevX[i]) / dt;
      vy[i] = (py[i] - prevY[i]) / dt;
    }

    // 4. XSPH smoothing for stationary states
    const xs = cfg.pbd.xsph;
    if (xs > 0) {
      for (let i = 0; i < n; i++) {
        this.tmpVx[i] = vx[i];
        this.tmpVy[i] = vy[i];
        const st = flock.state[i];
        if (st !== SheepState.Graze && st !== SheepState.Alert && st !== SheepState.Rest) continue;
        const cb = i * MAX_CONTACTS;
        let sx = 0;
        let sy = 0;
        let c = 0;
        for (let q = 0; q < flock.contactCount[i]; q++) {
          const j = flock.contacts[cb + q];
          const rr = flock.radius[i] + flock.radius[j] + 0.2;
          if (flock.contactDist[cb + q] > rr) continue;
          sx += vx[j] - vx[i];
          sy += vy[j] - vy[i];
          c++;
        }
        if (c > 0) {
          this.tmpVx[i] += (xs * sx) / c;
          this.tmpVy[i] += (xs * sy) / c;
        }
      }
      for (let i = 0; i < n; i++) { vx[i] = this.tmpVx[i]; vy[i] = this.tmpVy[i]; }
    }

    // 5. bookkeeping
    for (let i = 0; i < n; i++) {
      const sp = Math.hypot(vx[i], vy[i]);
      flock.speed[i] = sp;
      if (flock.state[i] === SheepState.Graze && flock.stepRemaining[i] > 0) {
        flock.stepRemaining[i] -= sp * dt;
      }
      if (flock.state[i] === SheepState.Run && sp > cfg.run.speed * 1.1) {
        flock.stamina[i] = Math.max(0, flock.stamina[i] - cfg.run.staminaDrain * dt);
      } else {
        flock.stamina[i] = Math.min(1, flock.stamina[i] + cfg.run.staminaRefill * dt);
      }
    }
  }

  /** Gauss–Seidel projection of pairwise disc constraints and world bounds. */
  solveContacts(flock: Flock, n: number): void {
    const cfg = this.cfg;
    const P = cfg.pbd;
    const { px, py, prevX, prevY, radius } = flock;
    const W = cfg.world;
    for (let it = 0; it < P.iterations; it++) {
      for (let i = 0; i < n; i++) {
        const cb = i * MAX_CONTACTS;
        for (let q = 0; q < flock.contactCount[i]; q++) {
          const j = flock.contacts[cb + q];
          if (j <= i) continue; // each pair once
          let dx = px[i] - px[j];
          let dy = py[i] - py[j];
          let d = Math.sqrt(dx * dx + dy * dy);
          const minD = (radius[i] + radius[j]) * P.slack;
          if (d >= minD) continue;
          if (d < 1e-5) { dx = Math.cos(flock.heading[i]); dy = Math.sin(flock.heading[i]); d = 1e-5; }
          const nx = dx / d;
          const ny = dy / d;
          const corr = (minD - d) * P.stiffness * 0.5;
          px[i] += nx * corr; py[i] += ny * corr;
          px[j] -= nx * corr; py[j] -= ny * corr;
          if (P.friction > 0) {
            // damp relative tangential displacement this step
            const rx = (px[i] - prevX[i]) - (px[j] - prevX[j]);
            const ry = (py[i] - prevY[i]) - (py[j] - prevY[j]);
            const tx = -ny;
            const ty = nx;
            const rt = (rx * tx + ry * ty) * P.friction * 0.5;
            px[i] -= tx * rt; py[i] -= ty * rt;
            px[j] += tx * rt; py[j] += ty * rt;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const r = radius[i];
        if (px[i] < r) px[i] = r; else if (px[i] > W.width - r) px[i] = W.width - r;
        if (py[i] < r) py[i] = r; else if (py[i] > W.height - r) py[i] = W.height - r;
      }
    }
  }
}
