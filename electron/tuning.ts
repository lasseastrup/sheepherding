/** Renderer for the tuning window: hosts the shared panel and relays every change over IPC. */
import { defaultConfig, mergeConfig, type SimConfig } from '../src/sim';
import { createTuningPanel, type FlockState, type TuningPanel } from '../src/tuning/panel';
import type { OverlayConfig, TuningBridge } from './ipc';

declare global {
  interface Window {
    sheepTuning?: TuningBridge;
  }
}

const bridge = window.sheepTuning;
const host = document.getElementById('panel') as HTMLElement;
let panel: TuningPanel | null = null;
let config: SimConfig = defaultConfig();

function flockOf(c: OverlayConfig): FlockState {
  return { count: c.count, seed: c.seed, pxPerBL: c.pxPerBL, paused: c.paused, debugColours: c.debugColours, links: c.links };
}

bridge?.onState((state) => {
  config = mergeConfig(defaultConfig(), state.sim);
  if (!panel) {
    panel = createTuningPanel({
      container: host,
      config,
      flock: flockOf(state),
      showFlock: true,
      showSave: true,
      onSim: (path, value, rebuild) => bridge.setSim(path, value, rebuild),
      onFlock: (key, value) => bridge.setFlock(key, value),
      onAction: (action, payload) => bridge.action(action, payload),
    });
  } else {
    panel.setConfig(config);
    panel.setFlock(flockOf(state));
  }
});

bridge?.onMetrics((m) => panel?.setMetrics(m));

if (!bridge) {
  host.textContent = 'The tuning bridge is unavailable, so this window cannot reach the flock.';
}
