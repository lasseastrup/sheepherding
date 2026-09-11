import type { SimConfig } from './config';
import { Flock, FEAR_HIST, MAX_NEIGHBOURS } from './flock';
import type { Groups } from './groups';
import { SheepState } from './types';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The threat the flock reacts to: the pointer, with a lookahead along its own velocity. */
export interface Threat {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

/**
 * Direct pressure from the threat plus visual contagion between sheep, integrated into the
 * fast `fear` and slow `arousal` variables. See docs/flock-design.md §3.
 */
export class Perception {
  constructor(private cfg: SimConfig) {}

  setConfig(cfg: SimConfig): void {
    this.cfg = cfg;
  }

  update(flock: Flock, threat: Threat, dt: number, groups: Groups): void {
    const cfg = this.cfg;
    const P = cfg.pressure;
    const n = flock.count;
    const cosBlind = Math.cos(((360 - cfg.sheep.fovDeg) / 2) * (Math.PI / 180));
    const histSlot = flock.histHead;

    // running-toward-me test needs the previous slot's values, so read history before writing
    for (let i = 0; i < n; i++) {
      const x = flock.px[i];
      const y = flock.py[i];
      let pressure = 0;

      if (threat.active) {
        const tx = threat.x + threat.vx * P.lookahead;
        const ty = threat.y + threat.vy * P.lookahead;
        const dx = tx - x;
        const dy = ty - y;
        const d = Math.hypot(dx, dy);
        // a still pointer is a standing human; a moving one is a dog
        const motion = Math.min(1, Math.max(0, (threat.speed - P.idleSpeed) / (P.dogSpeed - P.idleSpeed)));
        const baseZone = P.zoneIdle + (P.zoneDog - P.zoneIdle) * motion;
        const zone = (baseZone * (0.8 + 0.4 * flock.arousal[i])) / flock.boldness[i];
        // is the threat closing on me?
        let toward = 0;
        if (threat.speed > 1e-3 && d > 1e-3) {
          toward = -((dx / d) * (threat.vx / threat.speed) + (dy / d) * (threat.vy / threat.speed));
        }
        const speedFactor = 1 + P.speedGain * Math.min(2, threat.speed / cfg.run.speed);
        const directness = 1 + P.directnessGain * Math.max(0, toward);
        // behind me and out of sight: only proximity registers
        const hx = Math.cos(flock.heading[i]);
        const hy = Math.sin(flock.heading[i]);
        const facing = d > 1e-3 ? (hx * dx + hy * dy) / d : 1;
        const angleFactor = facing < -cosBlind && d > P.blindProximity ? P.blindFactor : 1;
        pressure = Math.min(1, smoothstep(zone * P.outerScale, zone * P.innerScale, d) * speedFactor * directness * angleFactor);
      }
      flock.pressure[i] = pressure;

      // visual contagion over the delayed fear of visible neighbours
      let social = 0;
      const base = i * MAX_NEIGHBOURS;
      const nc = flock.nbrCount[i];
      if (nc > 0) {
        const delaySteps = Math.min(FEAR_HIST - 1, Math.max(1, Math.round(flock.reactionDelay[i] / dt)));
        const readSlot = (histSlot - delaySteps + FEAR_HIST) % FEAR_HIST;
        let alarmed = 0;
        let best = 0;
        for (let q = 0; q < nc; q++) {
          const j = flock.nbr[base + q];
          const fj = flock.fearHist[j * FEAR_HIST + readSlot];
          const running = flock.state[j] === SheepState.Run;
          if (fj > P.alarmedThreshold || running) alarmed++;
          if (fj <= 0.01) continue;
          const dist = flock.nbrDist[base + q];
          const w = 1 / Math.log(2 + dist);
          // a neighbour running toward me is always a stimulus, whatever the fraction rule says
          let towardMe = false;
          if (running) {
            const jx = flock.px[j] - flock.px[i];
            const jy = flock.py[j] - flock.py[i];
            const jd = Math.hypot(jx, jy);
            if (jd > 1e-3) {
              const jh = flock.heading[j];
              towardMe = -(Math.cos(jh) * jx + Math.sin(jh) * jy) / jd > 0.5;
            }
          }
          // contagion transmits alarm, it never amplifies it: a sheep can be as frightened as
          // the neighbour it copied, never more, or the flock feeds back into a runaway panic
          // Transmission is lossy: a copied alarm is always weaker than its source. Without this
          // the flock is a perfect memory cell and holds itself at maximum fear indefinitely.
          const v = Math.min(fj * P.transmitCeiling, P.contagionGain * w * fj * (towardMe ? P.towardBoost : 1));
          if (v > best) best = v;
        }
        const fraction = alarmed / nc;
        const threshold = P.contagionThreshold * flock.boldness[i];
        if (fraction >= threshold || flock.fear[i] > P.contagionBypassFear) social = best;
      }

      // lonely sheep are permanently uneasy
      const lonely = flock.nearestDist[i] > cfg.run.isolationDist;
      flock.lonely[i] = lonely ? 1 : 0;
      // Unease at being in too small a group is NOT fear: it makes a sheep want to rejoin, not
      // to freeze. Only real isolation raises alarm. Keeping the two separate is what lets a
      // scattered flock walk back together instead of standing alert forever.
      void groups;
      const floor = lonely ? P.lonelyFear : 0;

      const prev = flock.fear[i];
      let fear = Math.min(1, Math.max(prev, pressure, social, floor));
      const packed = flock.meanVisDist[i] < P.packedDist;
      const tau = (packed ? P.fearTauPacked : P.fearTau) * flock.fearDecay[i];
      fear *= Math.exp(-dt / tau);
      if (fear < floor) fear = floor;
      flock.fearJump[i] = fear - prev;
      flock.fear[i] = fear;

      let arousal = Math.min(1, Math.max(flock.arousal[i], P.arousalGain * fear));
      arousal *= Math.exp(-dt / P.arousalTau);
      flock.arousal[i] = arousal;
    }

    // publish this step's fear for the neighbours to read next step
    for (let i = 0; i < n; i++) flock.fearHist[i * FEAR_HIST + histSlot] = flock.fear[i];
    flock.histHead = (histSlot + 1) % FEAR_HIST;
  }
}
