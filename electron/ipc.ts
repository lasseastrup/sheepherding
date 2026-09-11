/** Messages between the Electron main process and the overlay renderer. */

export interface OverlayConfig {
  count: number;
  seed: number;
  debugColours: boolean;
  /** CSS pixels per sheep body length */
  pxPerBL: number;
  paused: boolean;
  /** camera pitch away from straight down, degrees */
  tiltDeg: number;
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
  onConfig(cb: (c: OverlayConfig) => void): void;
  ready(msg: ReadyMsg): void;
  /** the renderer reports whether the pointer is over a sheep, for selective click-through later */
  hover(overSheep: boolean): void;
}

export const CHANNELS = {
  pointer: 'overlay:pointer',
  config: 'overlay:config',
  ready: 'overlay:ready',
  hover: 'overlay:hover',
} as const;

export const DEFAULT_CONFIG: OverlayConfig = {
  count: 16,
  seed: 3,
  debugColours: false,
  pxPerBL: 44,
  paused: false,
  tiltDeg: 12,
};
