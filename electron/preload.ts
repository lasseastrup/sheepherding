import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type OverlayBridge, type OverlayConfig, type OverlayMetrics, type PointerMsg, type ReadyMsg, type TuningBridge } from './ipc';

const bridge: OverlayBridge = {
  onPointer(cb) {
    ipcRenderer.on(CHANNELS.pointer, (_e, p: PointerMsg) => cb(p));
  },
  onConfig(cb) {
    ipcRenderer.on(CHANNELS.config, (_e, c: OverlayConfig, rebuild: boolean) => cb(c, rebuild));
  },
  ready(msg: ReadyMsg) {
    ipcRenderer.send(CHANNELS.ready, msg);
  },
  hover(overSheep: boolean) {
    ipcRenderer.send(CHANNELS.hover, overSheep);
  },
  metrics(m: OverlayMetrics) {
    ipcRenderer.send(CHANNELS.metrics, m);
  },
};

const tuning: TuningBridge = {
  onState(cb) {
    ipcRenderer.on(CHANNELS.tuningState, (_e, c: OverlayConfig) => cb(c));
  },
  onMetrics(cb) {
    ipcRenderer.on(CHANNELS.tuningMetrics, (_e, m: OverlayMetrics) => cb(m));
  },
  setSim(path, value, rebuild) {
    ipcRenderer.send(CHANNELS.tuningSim, path, value, rebuild);
  },
  setFlock(key, value) {
    ipcRenderer.send(CHANNELS.tuningFlock, key, value);
  },
  action(name, payload) {
    ipcRenderer.send(CHANNELS.tuningAction, name, payload);
  },
};

contextBridge.exposeInMainWorld('sheepherding', bridge);
contextBridge.exposeInMainWorld('sheepTuning', tuning);
