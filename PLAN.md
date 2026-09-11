# Desktop Sheep Herding — Feasibility & Plan

**Verdict: feasible.** Windows lets a program draw a transparent, always-on-top window over
the whole desktop while passing every mouse click straight through to whatever is underneath.
The herding mechanic never needs to *consume* input: the sheep only need to *know where the
pointer is*, and Windows exposes the global cursor position to any process at any time.
So the core loop ("sheep run away from the pointer while you keep using your PC") is
low-risk. Selective interaction (clicking a sheep, a HUD button) is also possible by toggling
click-through on and off per frame based on what is under the cursor. This is the same
technique used by desktop-pet apps, VTuber avatar overlays, and Electron's
`setIgnoreMouseEvents(true, { forward: true })`.

The remaining risk is not *whether* it works but **engine-specific rendering quirks** and
**performance** of a full-screen transparent surface. Both are handled by a short spike
(Phase 0) before real development starts.

---

## 1. How it works on Windows

Three Win32 ingredients, independent of engine:

| Need | Mechanism |
|---|---|
| Draw over everything, with per-pixel alpha | Borderless `WS_POPUP` window, `WS_EX_TOPMOST`, `WS_EX_LAYERED`, and DWM per-pixel transparency (`DwmExtendFrameIntoClientArea` with `-1` margins for a D3D swap chain, or an engine's "transparent window" flag). Clear color alpha = 0. |
| Let clicks go to the apps underneath | `WS_EX_TRANSPARENT` on the window. Mouse messages skip the window entirely and land on whatever is below, in any process. |
| Know where the pointer is anyway | Poll `GetCursorPos()` every frame (no hooks, no admin rights). Works even though our window receives no mouse messages. |

Supporting styles: `WS_EX_TOOLWINDOW` (hidden from taskbar and Alt+Tab), `WS_EX_NOACTIVATE`
(never steals keyboard focus from the user's app, even when a sheep is clicked).

**Selective interaction** (later phases): each frame, raycast from the cursor into the 3D scene.
If it hits a sheep or a HUD element, remove `WS_EX_TRANSPARENT` so the next click reaches us;
otherwise re-add it. A registered hotkey (e.g. hold a modifier) can also force "game mode" where
the whole window is interactive.

Things that do **not** work and are avoided:
- Returning `HTTRANSPARENT` from `WM_NCHITTEST`: only passes through to windows in the *same
  thread*, useless for cross-process click-through.
- Alpha-based automatic hit testing of layered windows: only applies to GDI
  `UpdateLayeredWindow` bitmaps, not to GPU swap chains; and it requires CPU readback of every frame.

## 2. Engine choice

The Win32 mechanics work with any engine that exposes the native window handle. Candidates:

| Option | Pros | Cons / known issues |
|---|---|---|
| **Unity (recommended)** | Best-documented path for exactly this use case (desktop overlays, VTuber apps ship with it). Full 3D, animation, C#, P/Invoke trivial. | Runtime ~150–250 MB RAM. Community threads report a transparency regression in Unity 6.1 and CPU cost of transparent windows; pin the Unity version in the spike. |
| **Godot 4** | Free/open source, small runtime, built-in window flags: `transparent`, `borderless`, `always_on_top`, `mouse_passthrough`, `mouse_passthrough_polygon`. C# available. | Per-pixel transparency on Windows is **broken in Forward+/Mobile (Vulkan/D3D12)** and only works with the **Compatibility (OpenGL) renderer** (godot#89205, #111513). Passthrough polygon on Windows uses `SetWindowRgn`, which also clips rendering outside the polygon. Hybrid-GPU laptops have had opaque-black issues (#76167). |
| Bevy (Rust) | Tiny footprint, `transparent`, `window_level: AlwaysOnTop`, `cursor_options.hit_test` built in. | Young 3D toolchain (animation, editor). Windows premultiplied-alpha compositing via wgpu needs verification. |
| Electron / Tauri + Three.js | Fastest prototype; click-through with mousemove forwarding is a one-liner. | Not a game engine; heaviest memory; awkward path to "more gameplay later". |
| Custom C++/Rust + DirectComposition | Total control, lowest overhead. | Build a 3D pipeline from scratch. Not justified for this project. |

**Recommendation:** Unity, pinned to a specific LTS version that the spike proves working,
D3D11 first. If the team prefers open source or a smaller footprint, Godot 4 with the
Compatibility renderer is the alternative; the plan below applies equally, only the setup code
differs (see `docs/windows-overlay-reference.md`).

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Overlay window (borderless, topmost, transparent, click-through)│
│                                                                │
│  Win32 layer (C# P/Invoke)      Game                            │
│  • window styles, DPI          • Flock sim (boids + fear)      │
│  • GetCursorPos → world pos    • Sheep: 3D models, anim        │
│  • click-through toggle        • Top-down ortho camera         │
│  • work-area / monitor info    • Blob shadows, premult. alpha  │
│  • fullscreen/lock detection   • Idle/active frame pacing      │
│  • tray icon, hotkeys                                          │
└────────────────────────────────────────────────────────────────┘
```

Key design points:

- **Coordinate mapping.** Cursor is in physical screen pixels. Subtract the window origin,
  convert to the camera's viewport, ray-cast onto the ground plane (y = 0). Use Per-Monitor V2
  DPI awareness so pixels map 1:1 on scaled displays.
- **Play area = monitor work area** (excludes the taskbar, which is itself topmost). Sheep
  treat the edges as fences.
- **Rendering.** Orthographic (or very mild perspective) top-down camera. Clear color
  `(0,0,0,0)`. No post effects that write alpha = 1 (bloom, some AA, tonemapping). DWM expects
  **premultiplied alpha**, so the final output must be premultiplied (final blit
  `rgb *= a`) or edges look fringed. Shadows: soft blob decals or a shadow-only ground shader
  that writes alpha only where shadowed; a full opaque ground plane is not an option.
- **Frame pacing.** The window is never focused, so the engine must run in background.
  Cap at 30 fps while sheep move; drop to ~5–10 fps (or skip rendering) when the flock is
  idle and the cursor is far away. This keeps CPU/GPU cost negligible on battery.
- **Compositing cost.** A full-monitor alpha surface is the main GPU/bandwidth cost,
  especially at 4K. If the spike shows it matters, shrink the window to the flock's
  bounding box plus margin, moved/resized with hysteresis (a few times per second, not per
  frame).
- **Desktop citizenship.**
  - Hide when a fullscreen app / presentation is running: `SHQueryUserNotificationState`
    (`QUNS_RUNNING_D3D_FULL_SCREEN`, `QUNS_PRESENTATION_MODE`, and `QUNS_BUSY`, which
    Windows returns for borderless-fullscreen games) plus a fallback that compares the
    foreground window's rect to its monitor.
  - Pause on session lock / remote desktop (`WTSRegisterSessionNotification`).
  - System tray icon: pause, settings, quit. Optional global hotkey to toggle.
  - Re-assert `HWND_TOPMOST` when another topmost window pushes us down.
  - Multi-monitor: start on the primary monitor's work area; later one window per monitor
    (a single spanning window breaks with mixed DPI).
- **Flock simulation.** Classic boids (separation, alignment, cohesion) + grazing wander +
  a fear field around the cursor whose strength scales with cursor speed. Sheep have a
  bounded max speed and turn rate so they read as animals, not particles. Deterministic
  fixed-step sim so gameplay later can be tuned independently of frame rate.

## 4. Phases

### Phase 0 — Spike (go/no-go, ~2–3 days)
Goal: prove the stack on real machines before writing game code.
1. Empty scene, one animated placeholder sheep (capsule), top-down camera, clear alpha 0.
2. Apply window styles; window covers the primary work area; taskbar and Alt+Tab do not
   show it; clicking anywhere reaches the desktop/browser underneath.
3. Sheep follows / flees from the cursor using `GetCursorPos`.
4. Toggle click-through when hovering the sheep; click on it changes its color.
5. Measure idle and active CPU %, GPU %, and RAM at 1080p and 4K.
6. Test matrix: Windows 10 and 11; NVIDIA, AMD, Intel iGPU, hybrid laptop; 100 % and 150 %
   DPI; two monitors.
7. Verify edge quality (premultiplied alpha), and that Unity runs unfocused (`runInBackground`).

Exit criteria: all of the above pass on ≥2 GPU vendors, idle CPU < 1 %, active < 3 % on a
mid-range laptop. If Unity fails, repeat with Godot 4 Compatibility before deciding.

### Phase 1 — Herding prototype (~1–2 weeks)
- Flock of 8–20 sheep with boids + cursor fear, grazing idle behaviour, fences at work-area edges.
- Real low-poly sheep model with walk/idle/eat animations, blob shadows.
- Tray icon with Quit; 30 fps cap; idle throttling.
- Tuning UI (hidden, hotkey) for flock parameters.

### Phase 2 — Desktop citizenship & robustness (~1 week)
- Fullscreen / presentation detection and auto-hide; session-lock pause.
- Multi-monitor and mixed-DPI handling; monitor hot-plug (`WM_DISPLAYCHANGE`).
- Topmost re-assertion; graceful behaviour when a fullscreen-exclusive game runs.
- Crash-safe: sheep never leave the user with an invisible input-blocking window
  (watchdog resets click-through on every frame; on exception, the window closes).
- Settings persisted (flock size, monitor, autostart).

### Phase 3 — Selective interaction (~1 week)
- Per-frame hover hit-test → click-through toggle; clicking a sheep (pet, pick up, mark).
- Small HUD (corner widget) that is always interactive; game-mode hotkey.
- Latency test: a click landing in the first frame over a sheep must not "leak" to the app
  below (compare toggle timing; if needed, pre-expand the hit radius).

### Phase 4 — Gameplay hooks (open-ended)
Candidates, to be scoped with the design team:
- Pens / goal zones drawn on the desktop; herd the flock in under a timer.
- Sheep react to the user's windows: `EnumWindows` rects as obstacles or "grass" to graze on,
  scatter when a window pops up, sleep on top of an idle window.
- Predators, a sheepdog you control indirectly, day/night with the system clock.

### Phase 5 — Packaging & distribution (~1 week)
- Installer (MSIX or Inno Setup), code signing (avoid SmartScreen warnings), optional
  autostart via Startup folder / Task Scheduler, update channel.
- Telemetry-free crash logs to a local file.

## 5. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Engine version breaks transparent windows (seen in Unity 6.1 threads and Godot Forward+) | Medium | Pin engine version in Phase 0; keep the Win32 layer isolated so an engine swap is cheap. |
| Full-screen alpha composition costs noticeable GPU on 4K / laptops | Medium | Idle throttling, 30 fps cap, bounding-box window shrink, lower internal render resolution. |
| Hybrid GPU laptops render opaque black | Low–Medium | Test in Phase 0; force D3D11; Godot has documented this failure mode. |
| Window blocks input if the app hangs | Low | `WS_EX_TRANSPARENT` is the default state and re-asserted every frame; tray Quit; watchdog. |
| Windows Defender / SmartScreen flags an unsigned always-on-top overlay | Medium | Code signing in Phase 5. |
| Another topmost app (or the taskbar) covers sheep | Low | Restrict to work area; re-assert topmost on z-order change. |
| Anti-cheat in games treats the overlay as suspicious | Low | Auto-hide when a fullscreen game is detected; never inject into other processes. |

## 6. Open questions

1. Engine: Unity as recommended, or Godot 4 (Compatibility) for a smaller footprint?
2. Single monitor at launch, or multi-monitor from day one?
3. Should sheep be clickable in the first version, or is pure pointer-herding enough for v1?
4. Distribution target (internal toy, itch.io, Steam) — affects packaging and signing.
5. Art direction: low-poly stylised vs. realistic; this also sets the shadow approach.

## 7. References

- Godot passthrough polygon uses `SetWindowRgn` on Windows and clips rendering:
  https://github.com/godotengine/godot/issues/57835 , https://github.com/godotengine/godot/pull/39944
- Godot Forward+ transparency broken on Windows, Compatibility works:
  https://github.com/godotengine/godot/issues/89205 , https://github.com/godotengine/godot/issues/111513 ,
  https://github.com/godotengine/godot/issues/76167
- Godot partially click-through window tutorial:
  https://medium.com/@chewedgumah/godot-4-partially-clickthrough-window-with-transparent-background-3de637cdf95b
- Electron click-through with mousemove forwarding (Windows):
  https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions
- Unity transparent overlay (DwmExtendFrameIntoClientArea + WS_EX_LAYERED/TRANSPARENT):
  https://unitycodemonkey.com/tutorial_text_contents_tinymce.php?v=RqgsGaMPZTw
- Unity transparent-window performance and Unity 6.1 regression threads:
  https://discussions.unity.com/t/windows-how-to-achieve-a-better-performing-transparent-window/1537418 ,
  https://discussions.unity.com/t/unity-6-1-and-transparent-applications/1653872
- Bevy transparent window example:
  https://github.com/bevyengine/bevy/blob/main/examples/window/transparent_window.rs
- Fullscreen detection caveats (`QUNS_BUSY` under fullscreen optimisations):
  https://learn.microsoft.com/en-us/answers/questions/1086527/shqueryusernotificationstate-returns-quns-busy-ins ,
  https://github.com/microsoft/PowerToys/pull/45891
