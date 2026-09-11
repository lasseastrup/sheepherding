import type { SimConfig } from './config';
import type { Rng } from './rng';
import { SheepState } from './types';

export const MAX_NEIGHBOURS = 8;
export const FEAR_HIST = 40; // ring covering ~1.3 s at 30 Hz, for delayed contagion
export const MAX_CONTACTS = 16;

/** Structure-of-arrays storage for all sheep. */
export class Flock {
  readonly capacity: number;
  count = 0;
  episodeCounter = 0;
  /** flock-wide mean nearest-neighbour distance, refreshed each step */
  meanNnd = 1;
  /** write head of the per-sheep fear ring buffer */
  histHead = 0;

  // kinematics
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly prevX: Float32Array;
  readonly prevY: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly heading: Float32Array;
  readonly speed: Float32Array; // current |v|

  // behaviour
  readonly state: Uint8Array;
  readonly stateTime: Float32Array;
  readonly pendingState: Int8Array;
  readonly pendingAt: Float32Array;
  readonly fear: Float32Array;
  readonly fearHist: Float32Array;
  readonly fearJump: Float32Array;
  readonly pressure: Float32Array;
  readonly lonely: Uint8Array;
  readonly splitUntil: Float32Array;
  readonly arousal: Float32Array;
  /** 0 = the threat is novel, 1 = it has hung about harmlessly and is now background */
  readonly familiarity: Float32Array;
  readonly stamina: Float32Array;
  readonly leader: Int16Array;
  readonly leaderSide: Int8Array; // 0 behind, +1 left, -1 right
  readonly aloneTime: Float32Array;
  readonly stuckTime: Float32Array;
  readonly nextStepAt: Float32Array;
  readonly stepRemaining: Float32Array;
  readonly wanderHeading: Float32Array;
  readonly noiseAngle: Float32Array;
  readonly alertUntil: Float32Array;
  readonly walkUntil: Float32Array;
  readonly episodeId: Int32Array; // walk episode a sheep belongs to (for metrics)

  // personality
  readonly scale: Float32Array;
  readonly radius: Float32Array;
  readonly boldness: Float32Array;
  readonly gregarious: Float32Array;
  readonly reactionDelay: Float32Array;
  readonly fearDecay: Float32Array;
  readonly speedMult: Float32Array;
  readonly grazeBias: Float32Array;

  // neighbourhood (rebuilt each step)
  readonly nbr: Int16Array;
  readonly nbrDist: Float32Array;
  readonly nbrCount: Uint8Array;
  readonly contacts: Int16Array;
  readonly contactDist: Float32Array;
  readonly contactCount: Uint8Array;
  readonly nearestDist: Float32Array;
  readonly meanVisDist: Float32Array;
  readonly lcmX: Float32Array;
  readonly lcmY: Float32Array;

  // steering output
  /** 1 while the sheep is deliberately steering or turning this step */
  readonly intent: Uint8Array;
  readonly desiredSpeed: Float32Array;
  readonly dangerAhead: Float32Array;

  // context maps (scratch, slots per sheep)
  readonly interest: Float32Array;
  readonly danger: Float32Array;
  readonly slots: number;

  constructor(capacity: number, slots: number) {
    this.capacity = capacity;
    this.slots = slots;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.prevX = f(); this.prevY = f();
    this.vx = f(); this.vy = f(); this.heading = f(); this.speed = f();
    this.state = new Uint8Array(capacity);
    this.stateTime = f();
    this.pendingState = new Int8Array(capacity).fill(-1);
    this.pendingAt = f();
    this.fear = f();
    this.fearHist = new Float32Array(capacity * FEAR_HIST);
    this.fearJump = f();
    this.pressure = f();
    this.lonely = new Uint8Array(capacity);
    this.splitUntil = f();
    this.arousal = f(); this.familiarity = f(); this.stamina = f().fill(1);
    this.leader = new Int16Array(capacity).fill(-1);
    this.leaderSide = new Int8Array(capacity);
    this.aloneTime = f(); this.stuckTime = f(); this.nextStepAt = f(); this.stepRemaining = f();
    this.wanderHeading = f(); this.noiseAngle = f(); this.alertUntil = f(); this.walkUntil = f();
    this.episodeId = new Int32Array(capacity).fill(-1);
    this.scale = f(); this.radius = f(); this.boldness = f(); this.gregarious = f();
    this.reactionDelay = f(); this.fearDecay = f(); this.speedMult = f(); this.grazeBias = f();
    this.nbr = new Int16Array(capacity * MAX_NEIGHBOURS);
    this.nbrDist = new Float32Array(capacity * MAX_NEIGHBOURS);
    this.nbrCount = new Uint8Array(capacity);
    this.contacts = new Int16Array(capacity * MAX_CONTACTS);
    this.contactDist = new Float32Array(capacity * MAX_CONTACTS);
    this.contactCount = new Uint8Array(capacity);
    this.nearestDist = f(); this.meanVisDist = f(); this.lcmX = f(); this.lcmY = f();
    this.intent = new Uint8Array(capacity);
    this.desiredSpeed = f(); this.dangerAhead = f();
    this.interest = new Float32Array(capacity * slots);
    this.danger = new Float32Array(capacity * slots);
  }

  /** Place `count` sheep in a loose cluster around the world centre and draw personalities. */
  spawn(cfg: SimConfig, rng: Rng): void {
    const n = Math.min(cfg.count, this.capacity);
    this.count = n;
    const cx = cfg.world.width / 2;
    const cy = cfg.world.height / 2;
    const sigma = Math.sqrt(n) * cfg.spawn.spacing * 0.5;
    const p = cfg.personality;
    for (let i = 0; i < n; i++) {
      this.scale[i] = rng.range(p.scale[0], p.scale[1]);
      this.radius[i] = cfg.sheep.contactRadius * this.scale[i];
      this.boldness[i] = rng.range(p.boldness[0], p.boldness[1]);
      this.gregarious[i] = rng.range(p.gregarious[0], p.gregarious[1]);
      // bold sheep react faster
      const rd = rng.range(p.reactionDelay[0], p.reactionDelay[1]);
      this.reactionDelay[i] = rd / (0.5 + 0.5 * this.boldness[i]);
      this.fearDecay[i] = rng.range(p.fearDecay[0], p.fearDecay[1]);
      this.speedMult[i] = rng.range(p.speedMult[0], p.speedMult[1]) * Math.pow(1 / this.scale[i], 0.3);
      this.grazeBias[i] = rng.range(p.grazeBias[0], p.grazeBias[1]);

      let x = cx + rng.normal() * sigma;
      let y = cy + rng.normal() * sigma;
      x = Math.min(cfg.world.width - 1, Math.max(1, x));
      y = Math.min(cfg.world.height - 1, Math.max(1, y));
      this.px[i] = x; this.py[i] = y; this.prevX[i] = x; this.prevY[i] = y;
      this.vx[i] = 0; this.vy[i] = 0; this.speed[i] = 0;
      this.heading[i] = rng.angle();
      this.wanderHeading[i] = this.heading[i];
      this.state[i] = SheepState.Graze;
      this.stateTime[i] = rng.range(0, 10);
      this.pendingState[i] = -1;
      this.nextStepAt[i] = rng.range(cfg.graze.stepInterval[0], cfg.graze.stepInterval[1]) * this.grazeBias[i] * 0.5;
      this.stamina[i] = 1;
      this.leader[i] = -1;
      this.fear[i] = 0;
      this.arousal[i] = 0;
      this.familiarity[i] = 0;
      this.pressure[i] = 0;
      this.splitUntil[i] = 0;
    }
  }
}
