import type { SimConfig } from './config';
import { Flock, MAX_NEIGHBOURS } from './flock';
import type { Groups } from './groups';
import type { Rng } from './rng';
import { SheepState } from './types';

/** P(event in dt) for a Poisson hazard rate. */
function hazard(rate: number, dt: number): number {
  return rate <= 0 ? 0 : 1 - Math.exp(-rate * dt);
}

function wrapAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Behaviour {
  constructor(private readonly cfg: SimConfig, private readonly rng: Rng) {}

  schedule(flock: Flock, i: number, s: SheepState, delay: number, time: number): void {
    if (flock.state[i] === s) return;
    if (flock.pendingState[i] === s) return;
    flock.pendingState[i] = s;
    flock.pendingAt[i] = time + delay;
  }

  enter(flock: Flock, i: number, s: SheepState, time: number): void {
    const cfg = this.cfg;
    const rng = this.rng;
    flock.state[i] = s;
    flock.stateTime[i] = 0;
    flock.pendingState[i] = -1;
    switch (s) {
      case SheepState.Graze: {
        flock.leader[i] = -1;
        flock.stepRemaining[i] = 0;
        flock.nextStepAt[i] = time + rng.range(cfg.graze.stepInterval[0], cfg.graze.stepInterval[1]) * flock.grazeBias[i];
        flock.episodeId[i] = -1;
        break;
      }
      case SheepState.Alert: {
        flock.leader[i] = -1;
        // timid sheep stay alert longer
        const t = (flock.boldness[i] - cfg.personality.boldness[0]) / Math.max(1e-3, cfg.personality.boldness[1] - cfg.personality.boldness[0]);
        const calm = cfg.alert.calmTime[1] + (cfg.alert.calmTime[0] - cfg.alert.calmTime[1]) * Math.min(1, Math.max(0, t));
        flock.alertUntil[i] = time + rng.range(cfg.alert.duration[0], cfg.alert.duration[1]) * 0.5 + calm * 0.5;
        break;
      }
      case SheepState.Walk: {
        this.pickLeader(flock, i);
        flock.aloneTime[i] = 0;
        flock.stepRemaining[i] = 0;
        if (flock.leader[i] < 0) {
          flock.wanderHeading[i] = flock.heading[i] + rng.normal() * (cfg.walk.headingNoiseDeg * Math.PI / 180);
          flock.walkUntil[i] = time + rng.range(cfg.walk.initiatorDuration[0], cfg.walk.initiatorDuration[1]);
          flock.episodeId[i] = ++flock.episodeCounter;
        } else {
          flock.episodeId[i] = flock.episodeId[flock.leader[i]];
        }
        break;
      }
      case SheepState.Run: {
        flock.leader[i] = -1;
        flock.stepRemaining[i] = 0;
        flock.episodeId[i] = -1;
        flock.stuckTime[i] = 0;
        break;
      }
      case SheepState.Rest:
        break;
    }
  }

  /** Choose the sheep to follow: nearest visible mover in the front hemisphere, else any visible mover. */
  private pickLeader(flock: Flock, i: number): void {
    const hx = Math.cos(flock.heading[i]);
    const hy = Math.sin(flock.heading[i]);
    let best = -1;
    let bestD = 1e9;
    let bestAny = -1;
    let bestAnyD = 1e9;
    const base = i * MAX_NEIGHBOURS;
    for (let q = 0; q < flock.nbrCount[i]; q++) {
      const j = flock.nbr[base + q];
      const sj = flock.state[j];
      if (sj !== SheepState.Walk && sj !== SheepState.Run) continue;
      if (flock.leader[j] === i) continue; // no direct cycles
      const d = flock.nbrDist[base + q];
      const dx = flock.px[j] - flock.px[i];
      const dy = flock.py[j] - flock.py[i];
      if (dx * hx + dy * hy > 0) {
        if (d < bestD) { bestD = d; best = j; }
      }
      if (d < bestAnyD) { bestAnyD = d; bestAny = j; }
    }
    const L = best >= 0 ? best : bestAny;
    flock.leader[i] = L;
    if (L >= 0) {
      if (this.rng.chance(this.cfg.walk.behindProb)) {
        flock.leaderSide[i] = 0;
      } else {
        // beside: on whichever side I already am relative to the leader's heading
        const lx = Math.cos(flock.heading[L]);
        const ly = Math.sin(flock.heading[L]);
        const rx = flock.px[i] - flock.px[L];
        const ry = flock.py[i] - flock.py[L];
        flock.leaderSide[i] = lx * ry - ly * rx >= 0 ? 1 : -1;
      }
    }
  }

  update(flock: Flock, time: number, dt: number, groups: Groups): void {
    const cfg = this.cfg;
    const rng = this.rng;
    const n = flock.count;
    const W = cfg.walk;
    const R = cfg.run;

    for (let i = 0; i < n; i++) {
      flock.stateTime[i] += dt;
      if (flock.pendingState[i] >= 0 && flock.pendingAt[i] <= time) {
        this.enter(flock, i, flock.pendingState[i] as SheepState, time);
      }

      // neighbour state counts over the visible set
      let nS = 0;
      let nW = 0;
      let nR = 0;
      let nClose = 0; // non-running within run.stop.closeDist
      let nAlert = 0;
      let allPacked = flock.nbrCount[i] > 0;
      const base = i * MAX_NEIGHBOURS;
      for (let q = 0; q < flock.nbrCount[i]; q++) {
        const j = flock.nbr[base + q];
        const sj = flock.state[j];
        const d = flock.nbrDist[base + q];
        if (sj === SheepState.Walk) nW++;
        else if (sj === SheepState.Run) nR++;
        else { nS++; if (sj === SheepState.Alert) nAlert++; }
        if (sj !== SheepState.Run && d < R.stop.closeDist) nClose++;
        if (d > R.stop.packedDist) allPacked = false;
      }
      const nM = nW + nR;
      const reaction = flock.reactionDelay[i] / (1 + flock.arousal[i]);
      const st = flock.state[i] as SheepState;

      const F = cfg.fear;
      const fear = flock.fear[i];

      // --- startle: a sudden jump in pressure skips the alert stage entirely ---
      if (st !== SheepState.Run && fear >= F.startleEnter && flock.fearJump[i] >= F.startleJump) {
        this.schedule(flock, i, SheepState.Run, reaction * 0.5, time);
        continue;
      }

      // --- run triggers (shared by Graze / Alert / Walk) ---
      if (st !== SheepState.Run) {
        let rr = 0;
        const nd = flock.nearestDist[i];
        if (nd < 1e5) rr += R.isolationRate * Math.max(0, nd - R.isolationDist);
        // peripheral sheep: further from their visible neighbours than the flock's own spacing
        const mv = flock.meanVisDist[i];
        const dispRef = Math.max(R.dispersalRef, R.dispersalRatio * flock.meanNnd);
        if (mv < 1e5) {
          const ex = Math.max(0, mv - dispRef);
          rr += R.dispersalRate * ex * ex;
        }
        // imitation of runners, inhibited by stationary neighbours (fraction-like rule); sheep that just
        // stopped running are refractory so a dying cascade does not re-ignite itself
        let mimeticRun = 0;
        const refractory = st === SheepState.Alert && flock.stateTime[i] < R.mimetic.refractory;
        if (nR > 0 && !refractory) {
          // a dispersed sheep (far from its neighbours) is not held back by stationary ones, so a
          // packing run sweeps the loose periphery and dies out in the dense core (Ginelli 2015)
          const disp = mv < 1e5 ? Math.min(1, Math.max(0, (mv - dispRef) / dispRef)) : 0;
          const gEff = R.mimetic.g * (1 - disp);
          mimeticRun = (Math.pow(1 + R.mimetic.a * nR, R.mimetic.d) - 1) / R.mimetic.tau / Math.pow(1 + nS, gEff);
        }
        if (rng.chance(hazard(rr + mimeticRun, dt))) {
          this.schedule(flock, i, SheepState.Run, nR > 0 ? reaction : 0, time);
          continue;
        }
      }

      switch (st) {
        case SheepState.Graze: {
          if (fear >= F.alertEnter || flock.lonely[i]) {
            this.schedule(flock, i, SheepState.Alert, reaction, time);
            break;
          }
          if (groups.mustRejoin[i]) {
            this.schedule(flock, i, SheepState.Walk, reaction, time);
            break;
          }
          // a neighbour that has gone alert is itself a reason to look up
          if (nAlert > 0 && fear > 0.05) {
            const r = F.alertMimeticRate * (nAlert / Math.max(1, flock.nbrCount[i]));
            if (rng.chance(hazard(r, dt))) {
              this.schedule(flock, i, SheepState.Alert, reaction, time);
              break;
            }
          }
          // Azaïs et al: the *group* initiates at a size-independent rate, so each individual's
          // spontaneous rate scales as 1/N. A big flock is no more restless than a small one.
          let rate = (W.spontaneousRate / Math.max(1, groups.groupSize[i])) * flock.boldness[i];
          if (nM > 0) rate += (W.mimetic.a * Math.pow(nM, W.mimetic.b)) / Math.pow(Math.max(1, nS), W.mimetic.g);
          if (rng.chance(hazard(rate, dt))) {
            this.schedule(flock, i, SheepState.Walk, nM > 0 ? reaction : 0, time);
            break;
          }
          // grazing step timer
          if (flock.stepRemaining[i] <= 0 && time >= flock.nextStepAt[i]) {
            flock.stepRemaining[i] = rng.range(cfg.graze.stepDist[0], cfg.graze.stepDist[1]);
            flock.wanderHeading[i] = wrapAngle(flock.heading[i] + rng.normal() * (cfg.graze.headingNoiseDeg * Math.PI / 180));
            flock.nextStepAt[i] = time + rng.range(cfg.graze.stepInterval[0], cfg.graze.stepInterval[1]) * flock.grazeBias[i];
          }
          break;
        }
        case SheepState.Alert: {
          if (fear >= F.runEnter && flock.stuckTime[i] < R.stop.stuckTime) {
            this.schedule(flock, i, SheepState.Run, reaction * 0.5, time);
            break;
          }
          if (flock.speed[i] > R.stop.stuckSpeed) flock.stuckTime[i] = Math.max(0, flock.stuckTime[i] - dt);
          // standing still cannot fix being alone: go and rejoin
          if (groups.mustRejoin[i] && flock.stateTime[i] > 0.5) {
            this.schedule(flock, i, SheepState.Walk, reaction, time);
            break;
          }
          if (fear >= F.walkEnter && flock.stateTime[i] > 1) {
            // gentle pressure: walk away rather than bolt
            if (rng.chance(hazard(F.walkRate, dt))) {
              this.schedule(flock, i, SheepState.Walk, reaction, time);
              break;
            }
          }
          if (fear >= F.alertExit) flock.alertUntil[i] = Math.max(flock.alertUntil[i], time + 1);
          if (nM > 0) {
            const rate = (W.mimetic.a * Math.pow(nM, W.mimetic.b)) / Math.pow(Math.max(1, nS), W.mimetic.g);
            if (rng.chance(hazard(rate, dt))) {
              this.schedule(flock, i, SheepState.Walk, reaction, time);
              break;
            }
          }
          if (time >= flock.alertUntil[i] && !flock.lonely[i]) this.schedule(flock, i, SheepState.Graze, 0, time);
          break;
          break;
        }
        case SheepState.Walk: {
          if (fear >= F.runEnter) {
            this.schedule(flock, i, SheepState.Run, reaction * 0.5, time);
            break;
          }
          let srate = (W.stop.a * Math.pow(nS, W.stop.b)) / Math.pow(Math.max(1, nM), W.stop.g);
          srate += W.spontaneousStopRate / (flock.nbrCount[i] + 1);
          if (groups.mustRejoin[i]) srate *= 0.2;
          const L = flock.leader[i];
          if (L >= 0) {
            const dx = flock.px[L] - flock.px[i];
            const dy = flock.py[L] - flock.py[i];
            const gap = Math.sqrt(dx * dx + dy * dy);
            const sL = flock.state[L];
            if (sL !== SheepState.Walk && sL !== SheepState.Run) {
              if (gap < W.arrivalDist) srate += W.arrivalRate;
              else { flock.leader[i] = -1; flock.wanderHeading[i] = flock.heading[i]; flock.walkUntil[i] = time + 5; }
            } else if (gap > 12) {
              flock.leader[i] = -1;
              flock.wanderHeading[i] = flock.heading[i];
              flock.walkUntil[i] = time + 5;
            }
          } else {
            if (flock.stateTime[i] < W.initiatorPersistTime) srate *= W.initiatorPersistence;
            if (nM === 0) flock.aloneTime[i] += dt; else flock.aloneTime[i] = 0;
            if (flock.aloneTime[i] > W.initiatorTimeout) srate += 1;
            if (time > flock.walkUntil[i]) srate += 1; // reached the patch it set out for
          }
          if (rng.chance(hazard(srate, dt))) {
            this.schedule(flock, i, SheepState.Graze, flock.leader[i] < 0 ? 0 : reaction * 0.5, time);
          }
          break;
        }
        case SheepState.Run: {
          let stopRate = Math.pow(1 + R.stop.a * nClose, R.stop.d) / R.stop.tau;
          if (flock.stateTime[i] > R.stop.maxDuration && fear < 0.5) stopRate += 2;
          // Cornered: a sheep that cannot make progress stops and faces the threat rather than
          // running on the spot. Real flocks pressed against a fence hold and watch.
          if (flock.speed[i] < R.stop.stuckSpeed) flock.stuckTime[i] += dt;
          else flock.stuckTime[i] = 0;
          const stuck = flock.stuckTime[i] > R.stop.stuckTime;
          // still under real pressure and still able to move: keep going
          if (fear >= F.runEnter && !stuck) stopRate = 0;
          else if (stuck) stopRate += 1.5;
          if (fear < 0.2 && allPacked && flock.stateTime[i] > 0.5) {
            this.schedule(flock, i, SheepState.Alert, 0, time);
          } else if (rng.chance(hazard(stopRate, dt))) {
            this.schedule(flock, i, SheepState.Alert, reaction * 0.5, time);
          }
          break;
        }
        case SheepState.Rest:
          break;
      }
    }
  }
}
