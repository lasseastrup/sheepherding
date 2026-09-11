import { Behaviour } from './behaviour';
import { defaultConfig, mergeConfig, type DeepPartial, type SimConfig } from './config';
import { Flock } from './flock';
import { UniformGrid } from './grid';
import { Groups } from './groups';
import { computeMetrics, type Metrics } from './metrics';
import { Motion } from './motion';
import { computeNeighbours } from './neighbours';
import { Perception, type Threat } from './perception';
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
  readonly perception: Perception;
  readonly groups: Groups;
  /** where the threat was last seen, and for how long it is still remembered */
  lastThreatX = 0;
  lastThreatY = 0;
  threatMemory = 0;
  readonly threat: Threat = { active: false, x: 0, y: 0, vx: 0, vy: 0, speed: 0 };
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
    this.perception = new Perception(this.cfg);
    this.groups = new Groups(CAPACITY);
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
    this.updateThreat(dt);
    this.groups.update(f, this.cfg.group.linkDist, this.cfg.group.comfortable, this.cfg.group.strayDist);
    this.perception.update(f, this.threat, dt, this.groups);
    if (this.cfg.behaviourEnabled) this.behaviour.update(f, this.time, dt, this.groups);
    this.steering.update(f, this.threat, dt, this.groups, this.lastThreatX, this.lastThreatY, this.threatMemory > 0);
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

  /** Low-pass the pointer into a threat position and velocity. */
  private updateThreat(dt: number): void {
    const t = this.threat;
    const active = Number.isFinite(this.pointerX) && Number.isFinite(this.pointerY);
    this.threatMemory = Math.max(0, this.threatMemory - dt);
    if (!active) {
      t.active = false;
      t.vx = 0; t.vy = 0; t.speed = 0;
      return;
    }
    this.lastThreatX = this.pointerX;
    this.lastThreatY = this.pointerY;
    this.threatMemory = this.cfg.group.threatMemory;
    if (!t.active) {
      t.x = this.pointerX; t.y = this.pointerY;
      t.vx = 0; t.vy = 0; t.speed = 0;
      t.active = true;
      return;
    }
    const rawVx = (this.pointerX - t.x) / dt;
    const rawVy = (this.pointerY - t.y) / dt;
    const k = 1 - Math.exp(-dt / 0.06);
    t.vx += (rawVx - t.vx) * k;
    t.vy += (rawVy - t.vy) * k;
    t.speed = Math.hypot(t.vx, t.vy);
    t.x = this.pointerX;
    t.y = this.pointerY;
  }

  /** Runtime-tunable parameters (world size, count and seed are fixed after construction). */
  applyConfig(patch: DeepPartial<SimConfig>): void {
    const keep = { seed: this.cfg.seed, count: this.cfg.count, world: this.cfg.world, steering: { slots: this.cfg.steering.slots } };
    this.cfg = mergeConfig(mergeConfig(this.cfg, patch), keep);
    // subsystems hold a reference to the config object; refresh them
    (this.behaviour as unknown as { cfg: SimConfig }).cfg = this.cfg;
    (this.steering as unknown as { cfg: SimConfig }).cfg = this.cfg;
    (this.motion as unknown as { cfg: SimConfig }).cfg = this.cfg;
    this.perception.setConfig(this.cfg);
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
    out[3] = this.threat.active ? 1 : 0;
    out[4] = this.threat.x;
    out[5] = this.threat.y;
    out[6] = this.threat.vx;
    out[7] = this.threat.vy;
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
