/** Messages between the Electron main process and the overlay renderer. */

import type { DeepPartial, SimConfig } from '../src/sim';

export interface OverlayConfig {
  count: number;
  seed: number;
  debugColours: boolean;
  /** CSS pixels per sheep body length */
  pxPerBL: number;
  paused: boolean;
  /** camera pitch away from straight down, degrees */
  tiltDeg: number;
  /** draw a line from each follower to the sheep it is following */
  links: boolean;
  /** behavioural overrides on top of the simulation defaults */
  sim: DeepPartial<SimConfig>;
}

export interface OverlayMetrics {
  fps: number;
  cohesion: number;
  nnd: number;
  polarisation: number;
  splits: number;
  fractions: number[];
}

export interface PointerMsg {
  /** CSS pixels relative to the overlay window's top-left */
  x: number;
  y: number;
  active: boolean;
}

export interface ReadyMsg {
  ok: boolean;
  webgl: boolean;
  sheep: number;
  width: number;
  height: number;
  error?: string;
}

export interface OverlayBridge {
  onPointer(cb: (p: PointerMsg) => void): void;
  onConfig(cb: (c: OverlayConfig, rebuild: boolean) => void): void;
  ready(msg: ReadyMsg): void;
  /** the renderer reports whether the pointer is over a sheep, for selective click-through later */
  hover(overSheep: boolean): void;
  metrics(m: OverlayMetrics): void;
}

/** The tuning window's side of the bridge. */
export interface TuningBridge {
  onState(cb: (c: OverlayConfig) => void): void;
  onMetrics(cb: (m: OverlayMetrics) => void): void;
  setSim(path: string, value: unknown, rebuild: boolean): void;
  setFlock(key: string, value: number | boolean): void;
  action(name: 'reset' | 'respawn' | 'save', payload?: unknown): void;
}

export const CHANNELS = {
  pointer: 'overlay:pointer',
  config: 'overlay:config',
  ready: 'overlay:ready',
  hover: 'overlay:hover',
  metrics: 'overlay:metrics',
  tuningState: 'tuning:state',
  tuningMetrics: 'tuning:metrics',
  tuningSim: 'tuning:sim',
  tuningFlock: 'tuning:flock',
  tuningAction: 'tuning:action',
} as const;

/** The renderer keeps up with a flock this size; past it, expect the frame rate to fall away. */
export const MAX_SHEEP = 500;

export const DEFAULT_CONFIG: OverlayConfig = {
  count: 16,
  seed: 3,
  debugColours: false,
  pxPerBL: 44,
  paused: false,
  tiltDeg: 12,
  links: false,
  sim: {},
};
