/** Behaviour states. Numeric so they fit in a Uint8Array and the snapshot. */
export const enum SheepState {
  Graze = 0,
  Alert = 1,
  Walk = 2,
  Run = 3,
  Rest = 4,
}

export const STATE_NAMES = ['graze', 'alert', 'walk', 'run', 'rest'] as const;

/** Snapshot layout: header then SNAP_STRIDE floats per sheep. */
export const SNAP_HEADER = 4; // [count, time, step, reserved]
export const SNAP_STRIDE = 8; // [x, y, heading, speed, state, fear, scale, leader]

export function snapshotLength(count: number): number {
  return SNAP_HEADER + count * SNAP_STRIDE;
}
