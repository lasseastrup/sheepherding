# Windows overlay — technical reference

Companion to `../PLAN.md`. Concrete Win32 details and starter snippets for the
transparent, always-on-top, click-through game window. Everything here is engine-agnostic
except the two "engine setup" sections at the end.

## Window styles

| Style | Why |
|---|---|
| `WS_POPUP` (no `WS_CAPTION`/`WS_THICKFRAME`) | Borderless. |
| `WS_EX_TOPMOST` | Above normal windows. Re-assert with `SetWindowPos(hwnd, HWND_TOPMOST, ...)` when the z-order changes (`WM_WINDOWPOSCHANGED`) or on a slow timer. |
| `WS_EX_LAYERED` | Enables per-pixel alpha composition by DWM. |
| `WS_EX_TRANSPARENT` | Mouse messages pass to the window below, in any process. Default state. |
| `WS_EX_TOOLWINDOW` | Not shown in the taskbar or Alt+Tab. |
| `WS_EX_NOACTIVATE` | Clicking the window does not activate it, so keyboard focus stays with the user's app. |

Transparency of a D3D swap chain: `DwmExtendFrameIntoClientArea(hwnd, MARGINS{-1,-1,-1,-1})`
makes DWM treat the whole client area as "glass" and honour the back buffer's alpha. The
back buffer must be cleared to alpha 0 and DWM interprets the colour as **premultiplied**.

Fallbacks if that fails on some driver: `SetLayeredWindowAttributes(hwnd, colorKey, 0,
LWA_COLORKEY)` (binary transparency, no anti-aliased edges), or a native plugin using
DirectComposition with a `DXGI_ALPHA_MODE_PREMULTIPLIED` swap chain.

## Input

- `GetCursorPos(&pt)` gives the pointer in physical screen pixels regardless of which window
  is under it. Poll it every frame. No hooks needed, works when the foreground app is elevated.
- Cursor speed for the "fear" field: finite difference of successive positions.
- Selective interaction: toggle `WS_EX_TRANSPARENT` per frame:

```csharp
static void SetClickThrough(IntPtr hwnd, bool clickThrough)
{
    long ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
    long want = clickThrough ? (ex | WS_EX_TRANSPARENT) : (ex & ~WS_EX_TRANSPARENT);
    if (want != ex) SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(want));
}
```

  Because the game window is `WS_EX_NOACTIVATE`, a click on a sheep still leaves the user's
  app focused.
- Optional "game mode" hotkey: `RegisterHotKey` + `WM_HOTKEY`, or poll `GetAsyncKeyState`
  for a held modifier, to make the whole window interactive.
- Keyboard input otherwise: none. The window never has focus; use `GetAsyncKeyState` or
  `RegisterHotKey` if gameplay needs keys.

## Placement, monitors, DPI

- Declare **Per-Monitor V2** DPI awareness (manifest or
  `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`) so 1 game pixel
  = 1 screen pixel and `GetCursorPos` maps directly.
- Work area (excludes taskbar): `GetMonitorInfo(MonitorFromPoint(...))` → `rcWork`.
  Position/size the window to it with `SetWindowPos`.
- React to `WM_DISPLAYCHANGE` / `WM_DPICHANGED` (or poll monitor layout once a second) to
  handle hot-plugging and resolution changes.
- Multi-monitor: one overlay window per monitor. A single virtual-screen-spanning window has
  one DPI, which is wrong on mixed-DPI setups.

## When to hide / pause

| Condition | Detection |
|---|---|
| Fullscreen D3D app or presentation | `SHQueryUserNotificationState` → `QUNS_RUNNING_D3D_FULL_SCREEN`, `QUNS_PRESENTATION_MODE`, and `QUNS_BUSY` (returned for borderless-fullscreen games under fullscreen optimisations). |
| Borderless fullscreen window that the above misses | Foreground window rect (`GetForegroundWindow` + `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`) equals its monitor rect, and it is not the desktop/shell (`Progman`, `WorkerW`, `Shell_TrayWnd`). |
| Session locked / remote | `WTSRegisterSessionNotification` → `WM_WTSSESSION_CHANGE`. |
| On battery (optional low-power mode) | `GetSystemPowerStatus`. |
| User asked | Tray icon menu (`Shell_NotifyIcon`), hotkey. |

## Rendering notes

- Clear colour `(0,0,0,0)`; every opaque pixel must have alpha 1, anti-aliased edges
  fractional alpha.
- Output premultiplied alpha. If the engine renders straight alpha, add a final blit that does
  `rgb *= a`; otherwise semi-transparent edges show a light or dark fringe.
- Avoid post-processing that stamps alpha to 1 (bloom, tonemapping, some TAA/FXAA). MSAA is
  fine.
- Shadows: blob decal textures with alpha, or a "shadow-only" ground plane shader writing
  alpha = shadow strength × darkness; no opaque ground.
- Top-down orthographic camera; optionally a slight tilt (10–20°) so sheep read as 3D.

## Performance

- Cap at 30 fps while active; when the flock is idle and the cursor is far, render at 5–10 fps
  or skip rendering entirely (DWM keeps showing the last frame).
- Composition cost is proportional to window area. If needed, shrink the window to the
  flock's bounding box plus margin, updating with hysteresis a few times per second.
- Budget targets (mid-range laptop): idle CPU < 1 %, active < 3 %, RAM as low as the engine
  allows, no measurable battery impact when idle.

## Shell setup: Electron (chosen)

```ts
// main.ts
const { workArea } = screen.getPrimaryDisplay();
const win = new BrowserWindow({
  x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height,
  transparent: true, frame: false, hasShadow: false, resizable: false,
  alwaysOnTop: true, skipTaskbar: true, focusable: false,
  webPreferences: { backgroundThrottling: false, preload: PRELOAD },
});
win.setAlwaysOnTop(true, 'screen-saver');          // higher z-band than 'normal' topmost
win.setIgnoreMouseEvents(true, { forward: true }); // clicks fall through, mousemove still arrives
```

- Electron applies `WS_EX_LAYERED`, `WS_EX_TOPMOST`, `WS_EX_TOOLWINDOW` (via `skipTaskbar`) and
  `WS_EX_NOACTIVATE` (via `focusable:false`) itself, and uses DWM per-pixel alpha.
- **Selective interaction:** renderer raycasts the forwarded `mousemove` against sheep/HUD and
  asks main over IPC to call `setIgnoreMouseEvents(false)` on hover and `(true,{forward:true})`
  on leave. Forwarding does not work while DevTools is open.
- **Cursor when the page is not receiving events:** `screen.getCursorScreenPoint()` in main
  (DIP units; multiply by `display.scaleFactor` for physical pixels), polled at the sim rate
  and sent over IPC, or read in the renderer via a preload bridge.
- Transparent windows cannot be maximised or set fullscreen; always size to `workArea`.
- One `BrowserWindow` per `screen.getAllDisplays()` entry; re-layout on `display-added`,
  `display-removed`, `display-metrics-changed`.
- Tray: `Tray` + `Menu`. Hotkeys: `globalShortcut`. Session lock: `powerMonitor` events
  `lock-screen` / `unlock-screen`, plus `suspend` / `resume`.
- Fullscreen-app detection: `koffi` FFI call to `SHQueryUserNotificationState` in main, polled
  every ~1 s; hide all overlay windows while a fullscreen/presentation state is reported.
- Re-assert topmost on `blur` and on a slow timer with `setAlwaysOnTop(true,'screen-saver')`.
- three.js: `new WebGLRenderer({ alpha: true, premultipliedAlpha: true, antialias: true })`,
  `renderer.setClearColor(0x000000, 0)`, no post-processing pass that writes alpha = 1.
  `document.body { background: transparent }`.

## Shell setup: Tauri (optional later port)

- `tauri.conf.json` window: `transparent`, `decorations:false`, `alwaysOnTop`, `skipTaskbar`,
  `focus:false`; `window.set_ignore_cursor_events(true)`.
- No mousemove forwarding: poll `GetCursorPos` in Rust (`windows` crate) and emit to the
  webview; toggle `set_ignore_cursor_events` from the raycast result.
- WebView2 transparency with WebGL must be verified in a spike before committing to the port.
