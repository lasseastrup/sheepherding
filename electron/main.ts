/**
 * Electron main process: a transparent, click-through, always-on-top window covering the work
 * area of one display; tray menu; global hotkey; hides behind fullscreen apps and the lock screen.
 * See docs/windows-overlay-reference.md for why each flag is set.
 */
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type Display } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fullscreenAppRunning } from './fullscreen';
import { CHANNELS, type OverlayConfig, type PointerMsg, type ReadyMsg } from './ipc';
import { loadSettings, saveSettings, type Settings } from './settings';

const SMOKE = process.argv.includes('--smoke');
const smokeOut = (() => {
  const i = process.argv.indexOf('--smoke-out');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : join(process.cwd(), 'smoke-report.json');
})();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: Settings;
let hiddenReason: 'fullscreen' | 'locked' | 'user' | null = null;
let currentDisplayId = -1;

function overlayConfig(): OverlayConfig {
  const { displayId: _d, ...cfg } = settings;
  void _d;
  return cfg;
}

function chooseDisplay(): Display {
  const displays = screen.getAllDisplays();
  return displays.find((d) => d.id === settings.displayId) ?? screen.getPrimaryDisplay();
}

function createOverlay(): void {
  const display = chooseDisplay();
  currentDisplayId = display.id;
  const { x, y, width, height } = display.workArea;
  win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    title: 'Sheepherding',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // the higher z-band, above ordinary topmost windows
  win.setAlwaysOnTop(true, 'screen-saver');
  // clicks fall through to whatever is underneath; the renderer never needs them
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setMenu(null);
  void win.loadFile(join(__dirname, 'overlay.html'));
  win.once('ready-to-show', () => {
    if (!hiddenReason) win?.showInactive();
  });
  win.on('closed', () => { win = null; });
}

function pushConfig(): void {
  win?.webContents.send(CHANNELS.config, overlayConfig());
}

/** The window is never focused, so it cannot see the mouse: the main process reads the cursor. */
function startCursorPolling(): void {
  let lastSent = { x: NaN, y: NaN, active: false };
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    const msg: PointerMsg = { x: p.x - b.x, y: p.y - b.y, active: inside };
    if (msg.x === lastSent.x && msg.y === lastSent.y && msg.active === lastSent.active) return;
    lastSent = msg;
    win.webContents.send(CHANNELS.pointer, msg);
  }, 1000 / 60);
}

function setHidden(reason: typeof hiddenReason): void {
  hiddenReason = reason;
  if (!win || win.isDestroyed()) return;
  if (reason) win.hide();
  else win.showInactive();
  refreshTray();
}

/** Get out of the way of games and presentations; re-assert topmost the rest of the time. */
function startWatchdog(): void {
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const fs = fullscreenAppRunning();
    if (fs && hiddenReason === null) setHidden('fullscreen');
    else if (!fs && hiddenReason === 'fullscreen') setHidden(null);
    if (win.isVisible()) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setIgnoreMouseEvents(true, { forward: true });
    }
  }, 1000);
}

function watchDisplays(): void {
  const relayout = (): void => {
    if (!win || win.isDestroyed()) return;
    const display = chooseDisplay();
    if (display.id !== currentDisplayId) {
      win.close();
      createOverlay();
      return;
    }
    const { x, y, width, height } = display.workArea;
    win.setBounds({ x, y, width, height });
  };
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);
}

function refreshTray(): void {
  if (!tray) return;
  const displays = screen.getAllDisplays();
  const menu = Menu.buildFromTemplate([
    { label: 'Sheepherding', enabled: false },
    { type: 'separator' },
    {
      label: hiddenReason === 'user' ? 'Show flock' : 'Hide flock',
      accelerator: 'CommandOrControl+Shift+S',
      click: () => setHidden(hiddenReason === 'user' ? null : 'user'),
    },
    {
      label: settings.paused ? 'Resume' : 'Pause',
      click: () => { settings.paused = !settings.paused; saveSettings(settings); pushConfig(); refreshTray(); },
    },
    {
      label: 'Flock size',
      submenu: [8, 16, 24, 48, 100, 200, 350, 500].map((n) => ({
        label: `${n} sheep`, type: 'radio', checked: settings.count === n,
        click: () => { settings.count = n; saveSettings(settings); pushConfig(); },
      })),
    },
    {
      label: 'Sheep size',
      submenu: ([[18, 'Tiny'], [26, 'Small'], [44, 'Normal'], [60, 'Large'], [80, 'Huge']] as const).map(([px, label]) => ({
        label, type: 'radio', checked: settings.pxPerBL === px,
        click: () => { settings.pxPerBL = px; saveSettings(settings); pushConfig(); },
      })),
    },
    {
      label: 'Display',
      submenu: displays.map((d, i) => ({
        label: `${d.label || `Display ${i + 1}`} (${d.size.width}×${d.size.height})`, type: 'radio',
        checked: d.id === currentDisplayId,
        click: () => { settings.displayId = d.id; saveSettings(settings); win?.close(); createOverlay(); refreshTray(); },
      })),
    },
    { label: 'New flock', click: () => { settings.seed = (settings.seed * 7919 + 13) % 100000; saveSettings(settings); pushConfig(); } },
    { label: 'Colour sheep by behaviour', type: 'checkbox', checked: settings.debugColours,
      click: (item) => { settings.debugColours = item.checked; saveSettings(settings); pushConfig(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Sheepherding: ${settings.count} sheep${hiddenReason ? ` (hidden: ${hiddenReason})` : ''}`);
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.on('click', () => setHidden(hiddenReason === 'user' ? null : 'user'));
  refreshTray();
}

function smokeReport(report: ReadyMsg & { platform: string; bounds?: Electron.Rectangle; alwaysOnTop?: boolean }): void {
  writeFileSync(smokeOut, JSON.stringify(report, null, 2));
  console.log('smoke report written to', smokeOut, JSON.stringify(report));
  setTimeout(() => app.exit(report.ok ? 0 : 1), 1200);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setHidden(null));

  app.whenReady().then(() => {
    settings = loadSettings();
    if (SMOKE) {
      // the CI runner has no user: fail loudly if the renderer never comes up
      setTimeout(() => smokeReport({ ok: false, webgl: false, sheep: 0, width: 0, height: 0, error: 'renderer did not report ready within 25 s', platform: process.platform }), 25_000);
    }

    ipcMain.on(CHANNELS.ready, (_e, msg: ReadyMsg) => {
      console.log('overlay ready', JSON.stringify(msg));
      pushConfig();
      if (SMOKE) smokeReport({ ...msg, platform: process.platform, bounds: win?.getBounds(), alwaysOnTop: win?.isAlwaysOnTop() });
    });
    ipcMain.on(CHANNELS.hover, () => {
      // reserved for selective interaction: setIgnoreMouseEvents(false) while over a sheep
    });

    createOverlay();
    if (!SMOKE) createTray();
    startCursorPolling();
    startWatchdog();
    watchDisplays();

    globalShortcut.register('CommandOrControl+Shift+S', () => setHidden(hiddenReason === 'user' ? null : 'user'));

    powerMonitor.on('lock-screen', () => { if (hiddenReason === null) setHidden('locked'); });
    powerMonitor.on('unlock-screen', () => { if (hiddenReason === 'locked') setHidden(null); });
    powerMonitor.on('suspend', () => { if (hiddenReason === null) setHidden('locked'); });
    powerMonitor.on('resume', () => { if (hiddenReason === 'locked') setHidden(null); });
  });

  // a tray app keeps running with no windows
  app.on('window-all-closed', () => { /* stay alive for the tray */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
