import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type OverlayBridge, type OverlayConfig, type PointerMsg, type ReadyMsg } from './ipc';

const bridge: OverlayBridge = {
  onPointer(cb) {
    ipcRenderer.on(CHANNELS.pointer, (_e, p: PointerMsg) => cb(p));
  },
  onConfig(cb) {
    ipcRenderer.on(CHANNELS.config, (_e, c: OverlayConfig) => cb(c));
  },
  ready(msg: ReadyMsg) {
    ipcRenderer.send(CHANNELS.ready, msg);
  },
  hover(overSheep: boolean) {
    ipcRenderer.send(CHANNELS.hover, overSheep);
  },
};

contextBridge.exposeInMainWorld('sheepherding', bridge);
