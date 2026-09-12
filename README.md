# Sheep Herding (desktop overlay)

A flock of 3D sheep, seen from above, lives on top of your Windows desktop. You herd them with
the mouse pointer while continuing to use your normal programs: clicks go straight through to
whatever is underneath.

Stack: three.js + TypeScript in an Electron shell; sheep assets generated with headless Blender.

Try the flock in a browser: https://claude.ai/code/artifact/9e022eef-9750-47ae-b7a3-a64b197f3302

## Running

```
npm install                 # set ELECTRON_SKIP_BINARY_DOWNLOAD=1 if you only want the simulation
npm test                    # 18 simulation tests: determinism, non-overlap, 9 behaviour scenarios
npm run dev                 # 2D debug view of the simulation at http://127.0.0.1:5173
npm run build:page          # rebuilds web/sheepdog-trial.html, the playable 3D page
npm run electron            # the desktop overlay (Windows is the target; needs a display)
npm run dist:win            # unsigned portable exe in release/
npm run assets:sheep        # regenerate assets/sheep.glb (needs `pip install bpy==4.2.*`)
npm run bench               # headless render benchmark (--calm, --offscreen, or a size list)
```

Every push runs the tests on Ubuntu and, on a Windows runner, builds the overlay, launches it in
smoke mode to prove the transparent window comes up, and uploads a portable exe as a workflow
artifact. The exe is unsigned, so Windows SmartScreen will warn on first launch.

Nothing is drawn for the dog: the mouse pointer itself is the threat the sheep keep away from.

A tuning window exposes every behavioural parameter live, with a filter box, per-row reset and a
button that copies just what you changed as JSON. Open it from the tray or with Ctrl+Shift+T in
the desktop app, and with the button or the d key on the web page. Values are derived from the
config defaults in `src/sim/schema.ts`, so a new field appears in the panel without registering it
anywhere; changes apply to the running flock unless they are structural, which respawn it.

Overlay controls: the tray icon has hide, pause, flock size, sheep size, display, new flock and
quit; Ctrl+Shift+S hides and shows the flock. The window is click-through, so everything under
the sheep keeps working.

## Layout

- `src/sim/` the flock simulation, pure TypeScript, no DOM
- `src/render3d/` three.js renderer shared by the web page and the overlay
- `electron/` main process, preload, overlay renderer
- `web/` the playable page (`template.html` + `app.ts` build to `sheepdog-trial.html`)
- `tools/blender/` the sheep model, rig and clips as a Blender Python script
- `test/` vitest scenarios; `TRACE=1 npx vitest run test/trace.test.ts` prints a tuning table

Flocks run to 500. Past about 150 the renderer drops real shadows for blob shadows and animates
sheep in rotation; see `docs/flock-design.md` §12 for the measurements. Zoom with the wheel, the
slider, or the + and - keys, and 0 returns to the whole paddock; once zoomed in the camera
follows the flock.

Status: milestones 1 to 5 of the flock plan done, shell in CI. Documents:

- [PLAN.md](PLAN.md) — feasibility, stack decision, phased plan.
- [docs/flock-design.md](docs/flock-design.md) — the flock behaviour spec (the core of the game).
- [docs/flock-research.md](docs/flock-research.md) — research synthesis behind the spec.
- [docs/research/](docs/research/) — detailed reports: sheep ethology, collective-motion science,
  game AI techniques.
- [docs/windows-overlay-reference.md](docs/windows-overlay-reference.md) — Win32 / Electron shell details.
