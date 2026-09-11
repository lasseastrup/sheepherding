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

## Engine setup: Unity

- Player settings: Windowed, no resizable window, Graphics API D3D11 first (test D3D12
  later). Check the "DXGI flip model swapchain" setting during the spike: transparency via
  `DwmExtendFrameIntoClientArea` has been reported to interact with it.
- `Application.runInBackground = true`, `Application.targetFrameRate = 30`,
  `QualitySettings.vSyncCount = 0`; use `OnDemandRendering.renderFrameInterval` for idle.
- Camera: clear flags Solid Color, background alpha 0, orthographic. URP: disable
  post-processing on this camera, or verify alpha survives.
- Native handle: `GetActiveWindow()` at startup (the Unity window is active on launch), then
  apply styles:

```csharp
IntPtr hwnd = GetActiveWindow();
long ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
ex |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(ex));
var margins = new MARGINS { cxLeftWidth = -1 };
DwmExtendFrameIntoClientArea(hwnd, ref margins);
SetWindowPos(hwnd, HWND_TOPMOST, work.left, work.top, work.width, work.height, SWP_SHOWWINDOW | SWP_NOACTIVATE);
```

- Cursor → world: `GetCursorPos` → subtract window origin → `Camera.ScreenPointToRay`
  (flip Y) → intersect plane y = 0.
- Wrap all P/Invoke in `#if UNITY_STANDALONE_WIN && !UNITY_EDITOR`.

## Engine setup: Godot 4 (alternative)

- Renderer **must** be Compatibility (`rendering/renderer/rendering_method = gl_compatibility`);
  Forward+/Mobile transparency is broken on Windows.
- Project settings: `display/window/per_pixel_transparency/allowed = true`,
  `display/window/size/transparent = true`, `borderless = true`, `always_on_top = true`;
  `get_viewport().transparent_bg = true`; `application/run/low_processor_mode` for idle.
- Whole-window click-through: `get_window().mouse_passthrough = true` (sets
  `WS_EX_TRANSPARENT`). Cursor position via `DisplayServer.mouse_get_position()` (global)
  even when passthrough is on.
- Selective interaction: prefer P/Invoke toggling of `WS_EX_TRANSPARENT` via C# on
  `DisplayServer.window_get_native_handle(DisplayServer.HANDLE_TYPE_WINDOW_HANDLE)`.
  `Window.mouse_passthrough_polygon` also works but on Windows it is implemented with
  `SetWindowRgn`, which clips rendering to the polygon, so pad polygons generously.
- `WS_EX_TOOLWINDOW` / `WS_EX_NOACTIVATE` are not exposed by Godot; set them via P/Invoke.
