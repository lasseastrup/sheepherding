import { Behaviour } from './behaviour';
import { defaultConfig, mergeConfig, type DeepPartial, type SimConfig } from './config';
import { Flock } from './flock';
import { UniformGrid } from './grid';
import { computeMetrics, type Metrics } from './metrics';
import { Motion } from './motion';
import { computeNeighbours } from './neighbours';
import { Rng } from './rng';
import { Steering } from './steering';
import { SNAP_HEADER, SNAP_STRIDE, snapshotLength } from './types';

export const CAPACITY = 512;

/** Deterministic fixed-step flock simulation. No DOM, no three.js. */
export class Sim {
  cfg: SimConfig;
  readonly rng: Rng;
  readonly flock: Flock;
  readonly grid: UniformGrid;
  readonly behaviour: Behaviour;
  readonly steering: Steering;
  readonly motion: Motion;
  readonly prevHeading: Float32Array;
  time = 0;
  step = 0;
  pointerX = NaN;
  pointerY = NaN;

  constructor(patch?: DeepPartial<SimConfig>) {
    this.cfg = mergeConfig(defaultConfig(), patch);
    this.rng = new Rng(this.cfg.seed);
    this.flock = new Flock(CAPACITY, this.cfg.steering.slots);
    this.grid = new UniformGrid(this.cfg.world.width, this.cfg.world.height, this.cfg.sheep.gatherCell, CAPACITY);
    this.behaviour = new Behaviour(this.cfg, this.rng);
    this.steering = new Steering(this.cfg, this.rng);
    this.motion = new Motion(this.cfg, CAPACITY);
    this.prevHeading = new Float32Array(CAPACITY);
    this.flock.spawn(this.cfg, this.rng);
    // relax initial overlaps
    for (let k = 0; k < 20; k++) {
      this.grid.build(this.flock.px, this.flock.py, this.flock.count);
      computeNeighbours(this.flock, this.grid, this.cfg);
      this.flock.prevX.set(this.flock.px);
      this.flock.prevY.set(this.flock.py);
      this.motion.solveContacts(this.flock, this.flock.count);
    }
    this.prevHeading.set(this.flock.heading);
  }

  /** Advance one fixed step. */
  tick(): void {
    const f = this.flock;
    const dt = this.cfg.dt;
    this.prevHeading.set(f.heading.subarray(0, f.count));
    this.grid.build(f.px, f.py, f.count);
    computeNeighbours(f, this.grid, this.cfg);
    if (this.cfg.behaviourEnabled) this.behaviour.update(f, this.time, dt);
    this.steering.update(f, dt);
    this.motion.update(f, dt);
    this.time += dt;
    this.step++;
  }

  /** Advance by a number of simulated seconds. */
  run(seconds: number): void {
    const steps = Math.round(seconds / this.cfg.dt);
    for (let k = 0; k < steps; k++) this.tick();
  }

  setPointer(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  /** Runtime-tunable parameters (world size, count and seed are fixed after construction). */
  applyConfig(patch: DeepPartial<SimConfig>): void {
    const keep = { seed: this.cfg.seed, count: this.cfg.count, world: this.cfg.world, steering: { slots: this.cfg.steering.slots } };
    this.cfg = mergeConfig(mergeConfig(this.cfg, patch), keep);
    // subsystems hold a reference to the config object; refresh them
    (this.behaviour as unknown as { cfg: SimConfig }).cfg = this.cfg;
    (this.steering as unknown as { cfg: SimConfig }).cfg = this.cfg;
    (this.motion as unknown as { cfg: SimConfig }).cfg = this.cfg;
  }

  metrics(): Metrics {
    return computeMetrics(this.flock, this.prevHeading, this.time, this.cfg.kinematics.movingThreshold);
  }

  /** Write a render snapshot; allocates when `out` is missing or too small. */
  writeSnapshot(out?: Float32Array): Float32Array {
    const n = this.flock.count;
    const len = snapshotLength(n);
    if (!out || out.length < len) out = new Float32Array(len);
    out[0] = n;
    out[1] = this.time;
    out[2] = this.step;
    out[3] = 0;
    const f = this.flock;
    for (let i = 0; i < n; i++) {
      const o = SNAP_HEADER + i * SNAP_STRIDE;
      out[o] = f.px[i];
      out[o + 1] = f.py[i];
      out[o + 2] = f.heading[i];
      out[o + 3] = f.speed[i];
      out[o + 4] = f.state[i];
      out[o + 5] = f.fear[i];
      out[o + 6] = f.scale[i];
      out[o + 7] = f.leader[i];
    }
    return out;
  }
}
