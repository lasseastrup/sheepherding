# How games implement herds, flocks and crowds — research notes for a three.js sheep-flock overlay

Target: top-down three.js/TypeScript, 10–60 sheep (design headroom to ~500), mouse pointer acts as dog/predator, must run in a small fraction of one CPU core (desktop overlay).

A note on sourcing: the research proxy blocked most primary hosts (gameaipro.com, gdcvault.com, gamedeveloper.com, andrewfray.wordpress.com, arxiv.org, PNAS/Nature, Steam, itch.io, etc.). Where a source could only be reached via search-engine snippets or a GitHub mirror, that is stated. Everything in the "Recommended architecture" section is a synthesis of verified material plus standard practice; nothing there requires a blocked source.

---

## 1. Steering and flocking in shipped games

### 1.1 Reynolds steering and its known failure modes

Craig Reynolds' GDC 1999 paper ("Steering Behaviors For Autonomous Characters", red3d.com) defines the vocabulary every game still uses: a point-mass vehicle (mass, position, velocity, max_force, max_speed), and behaviours that each return a desired steering force: seek, flee, arrival, pursuit/evasion, wander, obstacle avoidance, path following, separation, cohesion, alignment, leader following. Combination is either a *weighted sum* (truncated to max_force) or *prioritised dithering* (evaluate behaviours in priority order, stop at the first that returns a non-trivial force, with a per-behaviour probability of being skipped to add variety).

The failure modes are well documented and were the motivation for everything that came later:

- **Oscillation / bouncing.** Seek + obstacle-avoid alternate: avoid pushes the agent off the line to the target, seek pulls it back, avoid fires again. The GameDev.net thread "seek and avoid jitter problem" and the libGDX gdx-ai wiki both describe this; the gdx-ai wiki also notes that with weighted blending "an agent backed up against a wall by several agents" can have separation forces exceed the wall's repulsion and be pushed *through* the wall.
- **Equilibria / cancellation.** Two opposed forces of similar magnitude sum to ~zero and the agent freezes or twitches ("deadlock"). Reynolds himself notes that potential-field style avoidance "tends to push boids perpendicular to their direction of motion", causing local-minima traps and "steady oscillations in agent trajectories".
- **Weight tuning hell.** gdx-ai: manual experimentation "remains the most practical approach"; every added behaviour changes the balance of all the others.
- **Wander jitter.** Naive random steering produces high-frequency noise; the standard fix is Reynolds' wander circle (a target on a circle projected ahead, displaced by a small random amount each tick) or low-frequency noise (Perlin) rather than white noise.

The classic mitigation kit, all still relevant for sheep:

1. **Two radii** per obstacle/agent: a hard radius (true collision) and a soft radius (steer around). Prevents the hard on/off avoidance that causes bouncing.
2. **Priority groups with blending inside each group** (gdx-ai "priority steering"): e.g. [collision avoidance] > [separation] > [flee, cohesion, alignment] > [wander/graze]. If a higher group's output magnitude is below epsilon, fall through.
3. **Limit turn rate and acceleration** rather than applying the raw force; treat the steering output as a *desired velocity* and approach it with a first-order lag.
4. **Hysteresis on any discrete decision** (which side to pass, which state to be in).

### 1.2 Context steering (Andrew Fray, Game AI Pro 2, ch. 18)

Fray's chapter "Context Steering: Behavior-Driven Steering at the Macro Scale" (Game AI Pro 2, 2015; free PDF on gameaipro.com; grew out of his work on Codemasters' F1 racing AI) is the most-cited answer to the problems above. The PDF itself was blocked here; the description below is assembled from Fray's blog snippet ("Context Behaviours Know How To Share"), the Game AI Pro table of contents, and three open implementations that were fetched (RubenFrans/ContextSteering-Unity, friedforfun/ContextSteering, wqaetly/ContextSteering) plus Godot/GameMaker community threads.

Core mechanics:

- Two **context maps**, each an array of N scalar slots, one per evenly spaced direction around the agent (N = 8–32 typical; 360/N degrees per slot). An **interest map** ("I would like to go this way, this much") and a **danger map** ("going this way would be bad, this much").
- **Behaviours never return a vector.** Each behaviour writes into the maps. Typically: for each target, compute `dot(slotDir, toTarget)` and write a value shaped by distance (e.g. `max(0, dot) * falloff(dist)`), optionally spreading to adjacent slots. A chase/cohesion behaviour writes interest; an avoid/predator behaviour writes danger (a threat straight ahead writes high danger in the slots toward it, and can also write *interest* in the opposite slots).
- **Combination is per slot, not per behaviour.** Implementations use `max` per slot for each map (Fray's chapter also discusses per-slot max as the default); this is what makes behaviours "know how to share": nothing cancels out because nothing is summed.
- **Resolution.** Find the *lowest* danger value; mask out (set interest to 0 in) every slot whose danger exceeds that minimum (or exceeds a threshold). Among remaining slots pick the highest interest. Some simple ports (RubenFrans) do `interest - danger` per slot and take the max instead; masking is the more robust Fray approach because it makes danger a hard veto.
- **Sub-slot interpolation.** Take the winning slot and its two neighbours and fit a parabola (or weight the three directions by their values) so the output direction is continuous as targets move; without it the output snaps between slot directions (the Godot forum thread "Context Based Steering, Enemy direction instantly snapping, and getting stuck problems" is exactly this).
- **Direction, then speed.** Context steering yields a direction; speed is decided separately (e.g. by the interest value, the danger in the chosen direction, or the behaviour state). Fray's racing use case scales speed by the danger ahead.
- **Inertia / hysteresis.** friedforfun's port offers a `WITH_INERTIA` selector that caps the angle change per tick via a minimum dot product with the previous direction; wqaetly's port does the same. This is the context-steering equivalent of turn-rate limiting and kills residual jitter.
- Cost: O(behaviours × targets × N) with N small; trivially cheap for 60 agents.

Pseudo-code (2D, N slots):

```ts
// per agent, per fixed step
interest.fill(0); danger.fill(0);
for (const n of neighbours) {                     // cohesion/alignment write interest
  const d = dirTo(n), w = cohesionWeight(dist(n));
  for (let s = 0; s < N; s++) interest[s] = max(interest[s], w * max(0, dot(slotDir[s], d)));
}
for (const t of threats) {                         // predator writes danger (+ interest away)
  const d = dirTo(t), w = threatWeight(dist(t), t.speedTowardMe);
  for (let s = 0; s < N; s++) {
    danger[s]   = max(danger[s],   w * max(0, dot(slotDir[s], d)));
    interest[s] = max(interest[s], w * max(0, -dot(slotDir[s], d)));
  }
}
const minD = min(danger);
for (let s = 0; s < N; s++) if (danger[s] > minD + eps) interest[s] = 0;   // mask
let best = argmax(interest);
dir = parabolicPeak(slotDir, interest, best);      // sub-slot interpolation
dir = rotateToward(prevDir, dir, maxTurnRate * dt); // inertia
```

Limitations, per the implementers: masks reduce but don't guarantee avoidance; it is *not* a replacement for pathfinding; and because a slot only knows about one direction, it does not solve the non-overlap problem for tightly packed agents (that belongs to a separate constraint solve; see §2).

### 1.3 How studios blend behaviours

Three families show up in shipped games:

- **Weighted blending** (Reynolds, gdx-ai `BlendedSteering`) — still used for the "background" flocking layer (separation/cohesion/alignment) because it is cheap and its failure modes are tolerable when all three behaviours want similar things.
- **Prioritised** (gdx-ai `PrioritySteering`, prioritised dithering) — collision/obstacle avoidance always wins; used when behaviours are genuinely mutually exclusive.
- **Utility/state-driven weights** — the weights themselves are functions of a per-agent state (fear, hunger, distance to group). Horizon Zero Dawn (below) is the extreme case: a Hierarchical Task Network planner picks the task, and the task decides what steering is even active.

### 1.4 Herd animals in AAA games (what is documented)

- **Guerrilla — Horizon Zero Dawn.** Julian Berteling, GDC 2018 AI Summit, "Beyond 'Killzone': Creating New AI Systems for 'Horizon Zero Dawn'" (GDC Vault). Herd behaviour is coordinated by a **"Collective"**: group agents own the herd's intent (graze here, move there, flee), individual machines run an HTN planner for their own tasks; each machine carries a **"passport"** of facts (type, level) and *lone machines request to join existing groups* that accept them — this is how isolated stragglers get recycled into herds after a scatter. **Watchers** patrol a circuitous path around the herd, periodically stopping to scan; when a Watcher identifies a threat it sounds a loud alarm and the herd breaks and flees. In other words: the alert state is *propagated explicitly by a designated role*, not diffused organically. Two Game Developer articles ("Behind The AI of Horizon Zero Dawn" parts 1–2, Tommy Thompson's AI and Games) and the GDC Animation Bootcamp talk "Bringing Life to the Machines of Horizon Zero Dawn" cover the same ground. Richard Oud's GDC 2022 "Evolving the Horizon Series: Animating Believable Robots and Characters" covers the Forbidden West animation systems.
- **Rockstar — Red Dead Redemption 2.** No technical talk exists; what is known is from journalism (phys.org "virtual ecology" piece, Game Developer "Rockstar's quest for the ultimate video game horse"): 200 species, deer/bison/pronghorn in large herds, wolves in packs, geese in fixed formations, prey reacting to *unseen* predators (which tips the player off), horses bolting at bears/snakes. The design lesson RDR2 is praised for is *legible cause*: every animal reaction points at something in the world.
- **Ubisoft — Far Cry.** Rich Barham / Ubisoft Montreal GDC 2015 "Grounding Wildlife in the Mountains of Far Cry 4": quadrupeds adapted to rocky terrain through a "symbiosis between animation data and procedural techniques" — additive animations, environment detection, IK and character physics. Chris Seddon (Ubisoft Toronto), nucl.ai 2016 "Animal House: Creating Systemic Animal Companions in Far Cry Primal" and the Game Developer piece "Primal Instinct | Companion AI in Far Cry Primal". Ubisoft Montreal GDC 2018 "Virtual Insanity: Meta AI on Assassin's Creed Origins" — thousands of "virtual" (unsimulated) vs "real" (simulated) humans/animals/vehicles with formations and persistent inventory; relevant as the LOD-of-simulation pattern.
- **Sucker Punch — Ghost of Tsushima.** Nothing technical found on herd AI; the documented animal work is *guide* animals (foxes leading to shrines, golden birds leading to points of interest) — animals as navigation UI, not flocks.
- **Frontier — Planet Zoo / Planet Coaster.** Planet Zoo marketing/dev material: "no scripted behaviours", herd/pack mentalities, a per-species *stress* stance toward crowds. Planet Coaster (Owen McCarthy, "Simulating 10,000 Guests"; Game Developer "Creating believable crowds in Planet Coaster"): guests are particles in **flow/potential fields**, computed in parallel across cores *and across frame boundaries*, and the animation team explicitly *limited animation blending* per guest for budget. Both are useful precedents for "believable at scale on a budget".

### 1.5 Herding games specifically

- **Herdling (Okomotive/Panic, Aug 2025).** Xbox Wire dev post "How We Got the 'Herd' in Herdling" (snippets): herd guiding was the *first* thing built; goals were guiding that feels "intuitive and natural" and calicorns "alive enough to care for"; they explicitly wanted to avoid an escort-mission/obstacle-course feel, with player motivation being the pleasure of pressing forward. Each calicorn has its own temperament producing "small but meaningful" behavioural differences; **stampede** is a distinct high-energy group mode usable to climb slopes. Player is a character *in* the herd who moves around it to push it — physical presence, not a remote cursor.
- **FLOCK! (Proper Games/Capcom, 2009).** UFO herds sheep/chickens/pigs/cows; each species reacts differently to the ship (different flight zones and speeds); physics-based, with beams that flatten crops into paths. Reviews praised the environmental interaction more than the herding itself.
- **Flockers (Team17, 2014).** Lemmings-like; reviews (TheSixthAxis, PCGamesN) complained about a sluggish, inaccurate cursor and that with sheep "crammed" together the chance of applying a power to the wrong sheep was ~1 in 2. Lesson: dense packs plus per-individual targeting is a UX disaster; act on the group, not the individual.
- **Sheep, Dog 'n' Wolf (Infogrames, 2001).** Puzzle-stealth with a single sheep per level; not a flock game.
- **Come Bye: A Sheepdog Simulator (Steam, indie, 2020–).** Whistle commands to a dog; sheep "bunch when scared, spread when calm, and react to pressure like real sheep" — this two-regime description is the most concise design statement of what a flock should do.
- **Sheep Dog Sim (sheepdogsim.com, three.js, open source: matthew-kissinger/sds).** Sheep flee with *speed depending on distance to the dog*; getting too close makes the *whole flock scatter*; the intended skill is to "circle wide and nudge gently". Architecturally: a deterministic `sim/` module with no three.js/DOM imports, imported byte-identically by the browser and a Worker; fixed-step; InstancedMesh rendering; scales to 5,000 sheep. A very close cousin to what this project needs.
- **Kyon (indie, 2017 dev blog).** Passive-guidance mob control "had very few examples to draw from"; lone sheep join the herd on touch.
- **chaser (GitHub, 2D trials game).** Three concentric rings around the dog: outer = awareness (sheep watch the dog and its *movement type*), middle = if the dog is *running* inside it sheep panic regardless, inner = flee. Sheep have three modes: quiet (drift to flock), half-speed (dog walking behind them outside vision), hopeless flee. Simple, and it encodes the key real-world fact that **dog speed matters as much as dog distance**.

---

## 2. Local avoidance and non-overlap for a tightly packed group

### 2.1 Velocity-space methods: RVO / ORCA

Van den Berg et al.'s Reciprocal Velocity Obstacles (2008) and ORCA (2011; RVO2 library, UNC GAMMA) are the standard in crowd middleware and in Unity's NavMeshAgent avoidance. Each agent computes, for each neighbour, a half-plane of permitted velocities (the ORCA line) assuming the neighbour takes half the responsibility; the new velocity is the closest to the preferred velocity inside the intersection of half-planes (a small 2D linear program). Parameters (RVO2): `neighborDist`, `maxNeighbors`, `timeHorizon`, `timeHorizonObst`, `radius`, `maxSpeed`. Its selling point is that it is *provably oscillation-free* for pairwise interactions — the thing RVO was invented to fix in plain velocity obstacles.

Problems for a bunched herd:

- In dense configurations the half-plane intersection becomes empty; ORCA falls back to a 3D LP that minimises penetration, and agents in symmetric packings **jiggle**. The GameDev.net Unity tutorial and Unity forum threads describe exactly this ("around 100 agents ... intersect occasionally and start jiggling around"; "when multiple agents need to encircle a target, the movement gets jittery"). Unity's mitigations are `obstacleAvoidanceType` quality tiers, agent `priority` (lower-priority agents are pushed), and keeping radius slightly smaller than the visual mesh.
- ORCA is designed for agents that *want to get past each other*; sheep mostly want to stay together and stop. It solves the wrong problem well.

### 2.2 Anticipatory force methods

Karamouzas, Skinner & Guy, "Universal Power Law Governing Pedestrian Interactions" (PRL 2014): the interaction energy depends on projected **time to collision** τ, not distance: E(τ) = k · τ⁻² · e^(−τ/τ₀) (published fit k ≈ 1.5, τ₀ ≈ 3 s for humans). The force is the gradient of E w.r.t. position. Because it acts only when trajectories actually converge, it produces far less jitter than distance-based separation and none of the "perpendicular push" Reynolds complained about. Cheap to compute for discs (closed-form τ from relative position/velocity). This is the best drop-in upgrade for the *steering-layer* separation term.

### 2.3 Position-based dynamics (PBD) for crowds

Weiss, Litteneker, Jiang & Terzopoulos, "Position-Based Multi-Agent Dynamics for Real-Time Crowd Simulation" (MiG 2017; extended in Computers & Graphics 2019; code: tomerwei/pbd-crowd-sim; WebGPU port: wayne-wu/webgpu-crowd-simulation). Agents are particles; each step:

1. Predict position `x* = x + dt · blend(v_pref, v)` (they blend preferred and current velocity rather than jumping to preferred).
2. Solve positional constraints by Gauss-Seidel (CPU) or Jacobi (GPU), several iterations:
   - **Short-range collision**: for overlapping discs, `C = |x_i − x_j| − (r_i + r_j) ≥ 0`, projected out with mass weighting, plus a **frictional contact** term (tangential correction damped), as in granular material simulation.
   - **Long-range (anticipatory) collision**: predict both agents forward by τ, resolve the collision at the predicted position, with **adaptive stiffness** that grows as τ shrinks — this is the "preconditioner" that prevents agents from arriving at contact at speed.
   - **Cohesion** constraint for groups; **wall/obstacle** constraints.
3. `v = (x* − x)/dt`, then apply **XSPH viscosity**: `v_i += c · Σ_j w_ij (v_j − v_i)` — an explicit velocity-smoothing term the paper adds "to encourage more coherent agent motions". This is the step that removes vibration.

The WebGPU port adds an "avoidance model" that applies *only the tangential component* of the anticipatory correction so agents are not shoved backward in dense crowds. Results demonstrated: lane formation, groups passing through each other, and — critically for sheep — dense packed groups that stay still without buzzing.

### 2.4 The "vibrating packed crowd" problem and what fixes it

Vibration in a packed group comes from stiff, instantaneous, velocity-level separation forces solved in one pass: every agent pushes, everyone overshoots, everyone pushes back next frame. The fixes, in order of effectiveness:

1. **Solve non-overlap at the position level, iteratively** (PBD, 2–4 Gauss-Seidel iterations), not as a force. Corrections are exact and bounded.
2. **Derive velocity from positions, then smooth it** (XSPH viscosity or a simple exponential blend `v = lerp(v, v_pbd, 0.5)`). Never let a constraint correction inject a velocity larger than the correction itself.
3. **Give the constraint a dead zone / soft radius.** Allow a few percent overlap before correcting, and correct only a fraction (stiffness 0.3–0.8) per iteration. A resting herd should settle into exact contact and stop moving.
4. **Anticipate** (power-law or PBD long-range) so agents decelerate *before* contact rather than being bounced at contact.
5. **Damping on the sheep's own steering when it has no intent**: if the behaviour state is "graze/idle", the preferred velocity is zero and the only motion is constraint resolution, which converges.
6. **Fixed timestep** — jitter is heavily aggravated by variable dt.

For a tightly bunched herd of 10–60 discs, the best-fitting combination is therefore: **context steering (or blended steering) for intent → PBD disc constraints for non-overlap → velocity smoothing**. ORCA is over-engineered for this and misbehaves at rest; pure Reynolds separation is under-engineered and vibrates.

---

## 3. Spatial partitioning and simulation plumbing in TypeScript

### 3.1 Honest cost estimates

- For n = 60, brute force is 60 × 59 / 2 = 1,770 pair checks. At ~5–10 ns per check in a tight typed-array loop that is ~10–20 µs per step. A grid is *unnecessary* at 60; write it anyway only if you want the 500 headroom.
- For n = 500, brute force is ~125k pairs (~1 ms). A uniform grid with cell = interaction radius R and ~9-cell lookups reduces work to `n · avg_neighbours_in_9_cells`; at herd densities (~1 sheep per R²) that is ~500 × 9 ≈ 4.5k candidate checks — ~50 µs.
- Reference points: hughsk/boids (plain JS arrays) ran 1,000 boids at 95 ticks/s brute-force; ercang/boids-js uses a cubic grid and 4 Web Workers to keep the render thread at 60 fps; Sheep Dog Sim runs thousands of boids in a Worker with a deterministic shared module.

### 3.2 Uniform grid / spatial hash with typed arrays (counting sort, zero allocation)

Rebuild every step — for moving agents this is cheaper and simpler than incremental updates.

```ts
// SoA state
const px = new Float32Array(N), py = new Float32Array(N);
const vx = new Float32Array(N), vy = new Float32Array(N);
// grid
const cellStart = new Int32Array(cellsX*cellsY + 1);
const cellItems = new Int32Array(N);
const cellOf    = new Int32Array(N);

function buildGrid() {
  cellStart.fill(0);
  for (let i = 0; i < N; i++) { const c = cellIndex(px[i], py[i]); cellOf[i] = c; cellStart[c + 1]++; }
  for (let c = 0; c < cellStart.length - 1; c++) cellStart[c + 1] += cellStart[c];   // prefix sum
  const fill = cellStart.slice(0, -1);                                                // or reuse a scratch array
  for (let i = 0; i < N; i++) cellItems[fill[cellOf[i]]++] = i;
}
function forNeighbours(i, R, fn) {                    // 3x3 cells around i
  const cx = cellX(px[i]), cy = cellY(py[i]);
  for (let gy = cy-1; gy <= cy+1; gy++) for (let gx = cx-1; gx <= cx+1; gx++) {
    if (gx<0||gy<0||gx>=cellsX||gy>=cellsY) continue;
    const c = gy*cellsX+gx;
    for (let k = cellStart[c]; k < cellStart[c+1]; k++) { const j = cellItems[k]; if (j!==i) fn(j); }
  }
}
```

Use a *hash* (e.g. `(x*73856093 ^ y*19349663) & mask`) instead of a bounded grid if the world is unbounded; for a desktop-sized overlay the bounded grid is fine and faster.

### 3.3 k-nearest / topological neighbours

Ballerini et al. (STARFLAG, PNAS 2008) showed starlings interact with a fixed number (6–7) of nearest neighbours regardless of density; follow-up work ("Efficient flocking: metric versus topological interactions", R. Soc. Open Sci. 2021; Sci. Rep. 2014 on the optimal number of topological neighbours) finds topological interaction keeps cohesion robust as density changes and improves collective response to a predator. The Strömbom sheep model (below) also uses "n nearest neighbours" for attraction. Practical rule: **gather candidates from the 3×3 cells, then partial-select the k = 5–7 nearest** (insertion into a tiny fixed-size sorted buffer per agent; k is small so this is trivial). Use metric radius for *separation* (physical contact) and topological k for *cohesion/alignment/alarm propagation*. This alone fixes "the flock splits and the halves never rejoin", because a straggler always has k neighbours to be attracted to.

### 3.4 Fixed timestep with interpolation (Gaffer on Games, "Fix Your Timestep!")

```ts
let acc = 0, prevT = now();
function frame() {
  let ft = min(now() - prevT, 0.25); prevT += ft;          // clamp: spiral-of-death guard
  acc += ft;
  while (acc >= DT) { swapBuffers(); step(DT); acc -= DT; }  // DT = 1/30 or 1/20 for a herd
  const alpha = acc / DT;
  render(lerp(prevState, curState, alpha));
}
```

For a sheep sim 20–30 Hz is plenty; sheep are slow. Interpolate positions and headings (shortest-arc) for rendering; the animation layer reads *interpolated* speed so blend weights don't step.

### 3.5 Running the sim in a Web Worker

Two viable patterns, both used by the boids projects above:

- **postMessage with transferable ArrayBuffers (double buffer).** The worker owns two state buffers; each step it posts the finished one (transferring ownership), the main thread posts it back when done. Zero-copy, no special headers, ~1 frame of latency — acceptable because rendering interpolates anyway. This is the safe default.
- **SharedArrayBuffer + Atomics.** True shared memory, no message latency; requires cross-origin isolation (COOP/COEP headers) — trivial in an Electron/Tauri overlay, awkward on the open web. Use an `Atomics` frame counter so the renderer reads a complete snapshot (write into buffer `k = frame & 1`, publish the index atomically).

Pointer input goes the other way (main → worker) every frame as `{x, y, t}`; the worker maintains cursor velocity itself so the sim stays deterministic given the input log (see §7).

Structure the code as Sheep Dog Sim does: `sim/` has no DOM/three.js imports and is imported by both the Worker and a headless Node test runner.

---

## 4. Animation for quadrupeds in a top-down 3D game

### 4.1 Locomotion state machine and 1D blend by speed

Minimum clip set for a sheep: `idle`, `graze` (head down, chewing, occasional step), `alert` (head up, ears forward), `walk`, `trot`, `run`, `turn_l/turn_r` in place (optional; top-down cameras hide most foot detail so a procedural yaw over `idle` is usually acceptable), plus additive poses: `head_left/right/up`, `ear_flick`, `startle`.

The industry pattern (MoCap Online's locomotion guides, Unreal/Unity blend trees) is a **1D blend space on speed**: walk at ~1.0–1.5 m/s, trot at ~2.5–3.5, run/gallop at 5+. Blending only looks right if cycles are **phase matched** (left fore-foot plants at the same normalised time in every cycle) — authoring requirement, not code.

### 4.2 Killing foot sliding: stride matching

For each cycle clip measure `strideSpeed = distanceCoveredByRootPerCycle / cycleDuration` (author the clips in place but keep the intended speed as metadata). At runtime, for the dominant clip, `timeScale = agentSpeed / strideSpeed_clip`, clamped to [0.7, 1.4]; blend into the neighbouring gait when the clamp would be exceeded. Unreal's "stride warping" does the same in bone space (scales stride length rather than play rate); play-rate scaling is cheaper and adequate top-down. In three.js: `action.setEffectiveTimeScale(ts)`; when crossfading between gaits use `startAction.crossFadeTo(endAction, duration, /*warp*/ true)` — the warp flag adjusts the two time scales so a 1.2 s walk cycle and a 0.6 s run cycle stay phase-aligned during the blend; `action.syncWith(other)` aligns time and timeScale outright.

### 4.3 Root motion vs simulation-driven movement

For a herd, **simulation-driven** (sim owns position/heading; clips play in place) is the standard choice: root motion cannot be reconciled with a constraint solver moving 60 bodies, and it makes the flock non-deterministic. Root motion is reserved for hero animals (RDR2's horse) where footfall exactness matters. Pay for sim-driven with (a) stride matching above and (b) small procedural corrections below.

### 4.4 Procedural layers on top of clips

- **Turn lean / body roll**: `roll = clamp(k_roll · yawRate · speed, ±12°)` applied to the spine/root bone; `pitch = clamp(k_pitch · forwardAccel, ±6°)`. Smooth yawRate with a 100–150 ms low-pass first.
- **Head look-at**: either a tiny IK (rotate neck+head bones toward the threat with clamped angles, decayed when the threat leaves the field of view), or — cheaper and more art-directable — **additive pose blending**: author `look_left`, `look_right`, `look_up` as single-frame additive clips and set their weights from the target angle. Far Cry 4's wildlife talk describes exactly this hybrid: additive animations + IK + physics over base clips.
- **Secondary motion**: ears and a couple of wool tufts as bones driven by a critically damped spring on the head's acceleration (2–4 bones, ~1 µs each). Or do wool jiggle in the vertex shader from a per-instance acceleration uniform; zero CPU.
- **Idle believability**: graze is a *state*, not a clip: loop graze, with a Poisson-timed (mean 4–8 s) "look up" additive, a random weight-shift step, and a probability of a slow half-step to a new grass spot.

### 4.5 three.js AnimationMixer specifics (verified against src/animation/AnimationAction.js and the additive-blending example)

- One `AnimationMixer` per skinned sheep; `mixer.clipAction(clip)` returns an `AnimationAction` with `weight`, `timeScale`, `loop`, `clampWhenFinished`, `zeroSlopeAtStart/End`.
- Blending: `fadeIn/fadeOut(d)`, `crossFadeTo/From(action, d, warp)`, `setEffectiveWeight`, `setEffectiveTimeScale`, `warp(startTS, endTS, d)`, `halt(d)`, `syncWith(action)`.
- Additive layers: `THREE.AnimationUtils.makeClipAdditive(clip, referenceFrame?, referenceClip?)` converts a clip to deltas against a reference pose; set `action.blendMode = THREE.AdditiveAnimationBlendMode`. The official example `webgl_animation_skinning_additive_blending` keeps base actions mutually exclusive (idle/walk/run, one crossfaded at a time) and stacks independent additive poses (made with `AnimationUtils.subclip(clip, name, 2, 3, 30)` for single-frame poses) at weights 0–1.
- Shared clips: `mixer.clipAction(clip, root)` binds the same clip data to different roots; clips loaded once from one glTF (`GLTFLoader` → `gltf.animations`) and reused across all sheep. `AnimationObjectGroup` lets one action drive many identical skeletons in lockstep — useful only for far LOD where synchrony is invisible.

### 4.6 Animation LOD for many agents

Costs: a `mixer.update()` on a ~20-bone skeleton with 2–3 active actions is roughly 20–60 µs in JS; times 60 sheep at 60 Hz that is 1–4 ms/frame — the *single biggest CPU item* in this project, bigger than the sim. Mitigations, from the crowd-animation literature (GameDev.net "Skeletal Animation Optimization Tips and Tricks", MoCap Online LOD guide, Godot proposal #12142, Planet Coaster's "limit blending"):

1. **Update-rate buckets**: near/moving sheep every frame, mid at 30 Hz, far/idle at 10–15 Hz; call `mixer.update(dt_accumulated)` so time stays correct. Round-robin the buckets so frame cost is flat. Expect 50–70 % savings.
2. **Fewer active actions**: drop additive layers and secondary-motion springs for distant/idle sheep; cap simultaneous base actions at 2.
3. **Fewer bones**: a 12–16 bone sheep rig; skip finger-equivalent detail entirely.
4. **Skip skinning when nothing changed**: an idle sheep at a far LOD can keep the previous skin matrices (`skeleton.update()` is where the matrices are computed; only call when the mixer advanced).
5. **Instanced skinning** for the 500-sheep case: three.js core has instanced skinning in the **WebGPU renderer** (`examples/webgpu_skinning_instancing.html`: 30 instances sharing one animation via `InstancedBufferAttribute`); the WebGL `InstancedSkinnedMesh` PR #22667 was closed (author found bone-matrix update cost per instance exceeded render cost at ~200 instances); the community `@three.ez/instanced-mesh` (agargaro) supports skinning + per-instance LOD + BVH culling. The scalable alternative is **baked vertex-animation textures** (bake each clip's bone matrices or vertex positions to a texture, pick clip + phase per instance in the shader) — no CPU animation cost at all, at the price of no runtime blending beyond crossfading two baked clips. For 10–60 sheep, per-sheep `SkinnedMesh` with update buckets is the right call.

---

## 5. Making a flock read as alive

### 5.1 Variation

Per-sheep parameters drawn once from a seeded RNG (and exposed in the debug panel):

| Parameter | Range | Effect |
|---|---|---|
| scale | 0.9–1.1 | visual + separation radius |
| maxSpeed (walk/trot/run) | ±15 % | staggering in a running flock |
| flightZone | 0.7–1.4 × base | "boldness": how close the cursor may get |
| reactionDelay | 100–400 ms | staggered starts; wave propagation |
| gregariousness | 0.6–1.4 | cohesion gain; low = the one that wanders |
| fearDecay | ±30 % | some calm down first (they become the ones that stop and graze, and the herd follows) |
| grazeBias / lookUpRate | | idle texture |

Flocking literature (agent-based boids refinements; e.g. the survey material summarised by Arboria Labs / Nature of Code) notes that individual parameter variation "spontaneously produces leader-follower relationships nobody designed", and that modelled *response delay* is one of the most effective realism upgrades. Herdling's design rests on exactly this ("each with its own temperament and quirks").

### 5.2 The sheep-specific behavioural model: allelomimesis

Two ethology results are directly implementable:

- **Ginelli, Peruani, Pillot, Chaté, Theraulaz & Bon, PNAS 2015, "Intermittent collective dynamics emerge from conflicting imperatives in sheep herds."** Merino sheep occupy three states — *grazing (stationary, head down)*, *walking*, *running* — and switch with **allelomimetic** (copying) rates: the probability of switching into state S rises steeply with the number of neighbours already in S (their model uses a power of the neighbour count with exponents α, δ controlling gregariousness) and interactions are *metric-free* (topological). The result is intermittent dynamics: slow grazing dispersal punctuated by **avalanche-like regrouping events** where one sheep starts moving, neighbours copy, and the whole group packs in a few seconds. This is the "spread when calm, bunch when scared" behaviour Come Bye advertises, derived from data.
- **Gómez-Nava et al., Nature Physics 2022, "Intermittent collective motion in sheep results from alternating the role of leader and follower."** In small groups, collective motion happens in episodes; each episode has a temporary leader that others follow in a hierarchy, and the leader *changes between episodes*. No permanent leader is needed; "whoever moved first is followed" is enough.

A compact implementation:

```ts
// per sheep: state in {GRAZE, WALK, RUN}, fear in [0,1]
const nGraze = countNeighbours(GRAZE), nMove = countNeighbours(WALK|RUN), k = neighbours.length;
// spontaneous + mimetic rates (per second)
rateToMove  = (r0_move + fear*rFear) * pow(1 + nMove,  alpha) / pow(1 + nGraze, delta);
rateToGraze = (fear < 0.2 ? r0_graze : 0) * pow(1 + nGraze, alpha) / pow(1 + nMove, delta);
// stochastic switch with per-sheep reaction delay queue
if (rand() < rateToMove*dt)  scheduleState(WALK, reactionDelay);
if (rand() < rateToGraze*dt) scheduleState(GRAZE, reactionDelay);
```

With α ≈ 1.5–2 and δ ≈ 1–2 the herd naturally does what real sheep do: stops together, starts together, and a single bold sheep can start a walk-off that the others copy after 0.2–0.5 s each.

### 5.3 Danger propagation

Three mechanisms games use, cheapest first:

1. **Designated alarmer** (Horizon's Watcher): one role detects and broadcasts. Not appropriate for sheep + cursor but a good fallback for "the whole herd notices the dog appears from a blind side".
2. **Contagion over the neighbour graph with delay** (fish-school startle cascades are modelled as SIR contagion; Vicsek-model-with-delay work shows a signal "spreads in steps of the interaction radius" and that delay produces ripple oscillations). Implementation: `fear_i += c · Σ_j w_ij · max(0, fear_j − fear_i)` evaluated against neighbours' *delayed* fear (read from a small ring buffer, ~150–300 ms), so alarm visibly travels across the flock rather than flashing on everywhere at once.
3. **Fear as a scalar field** with diffusion on the spatial grid (a coarse Float32 grid of fear values, `fear += D·laplacian − decay`), sampled by sheep. Smooth, cheap on a 32×32 grid, and it gives the cursor's *history* a footprint (the ground behind the dog "stays scary" for a second), which reads as anticipation.

Combine 2 and 3: direct perception (`fear_direct = pressure(cursor)`), contagion (`fear_social`), and `fear = max(direct, social) decaying at ~0.3–0.5/s`. Thresholds with hysteresis map fear to state: graze < 0.15, alert 0.15–0.4, walk 0.4–0.7, run > 0.7 (enter thresholds higher than exit thresholds).

### 5.4 Anticipation, easing, juice

- Never snap heading: rotate toward the desired direction at a *state-dependent* max turn rate (graze 90°/s, run 360°/s), and start the *head* turning 100–200 ms before the body (head look-at toward the threat is the anticipation pose).
- Acceleration curves: run-up over 0.3–0.5 s, stop over 0.6–1 s with a "settle" step; sheep don't stop dead.
- Bleats: a flock-wide cooldown (≥1.5 s) plus per-sheep probability weighted by fear change (bleat on *entering* alert), pitch-shifted by scale.
- Dust puffs when `speed > trotSpeed` and on state transitions to RUN; head-bob amplitude from speed; a startled "hop" additive when fear jumps by > 0.3 in one step.
- Leader/follower roles emerge from the Nature Physics rule; if you want a readable one, tag the sheep with the lowest reaction delay in the current episode as "leader" for the debug view only — don't hard-code a permanent leader, it looks robotic.

---

## 6. Player pressure: mapping the cursor to sheep response

### 6.1 What real handlers and dogs do (livestock-handling literature: Grandin's flight-zone/point-of-balance material; stock-dog trainers' notes)

- **Flight zone**: personal space; entering its edge makes the animal move away *calmly*; penetrating deeply causes panic and scatter. The zone is **larger when animals are excited and shrinks as they calm** — so pressure should be applied at the edge and *released* (backing off is as important as approaching).
- **Pressure zone**: an outer ring where animals notice and orient toward the handler but don't yet move.
- **Point of balance** (shoulder): pressure behind it moves the animal forward, in front of it stops or turns it back.
- **Handler speed and directness** add pressure; a dog that runs straight in or stares hard splits the flock. Trainers describe sheep as constantly toggling between "follow the group" and "flee the dog" instincts, and good dogs work the *balance point* of the whole flock, not individuals.
- **Strömbom et al., J. R. Soc. Interface 2014 ("Solving the shepherding problem")**, fitted to GPS data of a real dog: sheep only respond within a radius rₛ of the dog (rₛ = 65 in their units vs an inter-sheep repulsion radius rₐ = 2); inside it a sheep is repelled from the dog *and* attracted to the local centre of mass of its n nearest neighbours, with weights ρₛ = 1, c = 1.05, ρₐ = 2, inertia h = 0.5, noise e = 0.3. The dog *collects* (goes behind the furthest straggler) whenever any sheep is farther than f(N) = rₐ·N^(2/3) from the flock centre, and *drives* (goes behind the centre relative to the goal) otherwise. Herding only succeeds if the dog is faster than the sheep. Two implications for design: the *cursor's* effective speed must exceed sheep run speed (or the flock can never be caught), and the "collect vs drive" distinction is what the player should be able to feel.

### 6.2 A pressure field driven by the cursor

```ts
// cursor state (worker side, from input log)
cursorVel  = lowpass((cursor - prevCursor)/dt, 60ms);
threatPos  = cursor + cursorVel * lookahead;            // lookahead 0.15–0.3 s: sheep react to where the dog is *going*
speedGain  = 1 + kSpeed * clamp(|cursorVel| / sheepRunSpeed, 0, 2);

// per sheep
d      = |threatPos - p_i|;
toward = dot(normalize(p_i - threatPos), normalize(cursorVel)); // >0: dog is coming at me
zone   = flightZone_i * (0.8 + 0.4*fear_i);                      // excited sheep have bigger zones
P      = smoothstep(zone*1.6, zone*0.4, d) * speedGain * (1 + kApproach*max(0,toward));
fear_direct_i = clamp(P, 0, 1);
// flee direction: away from threat, bent toward flockmates so the group bunches rather than explodes
away   = normalize(p_i - threatPos);
flee   = normalize(away + lambda(fear_i) * normalize(centroidOfKNearest - p_i));   // lambda 0.6–1.2
// write into the context maps: danger toward threatPos, interest along flee
```

Cursor idle (speed ≈ 0) should generate *pressure zone* only (alert, face the cursor) unless it is very close; motion is what herds. That single rule produces the trainer's advice — circle wide, approach slowly, stop to release — for free, and matches Sheep Dog Sim's "too close and the whole flock scatters".

### 6.3 Pitfalls and the knob that fixes each

| Symptom | Cause | Fix / knob |
|---|---|---|
| Sheep jitter under pressure | per-frame re-evaluation, no inertia | reaction delay 100–400 ms, turn-rate limit, context-map inertia, hysteresis on state thresholds |
| Too obedient / feel like particles | instant, uniform response | boldness variance, refusal probability at low pressure, mimetic start delays, graze attractor pulling back at fear < 0.2 |
| Flock splits constantly | flee is purely radial from cursor | bend flee toward k-nearest centroid (λ), topological neighbours, raise cohesion with fear, "go with the mob" rule: if > 60 % of neighbours move one way, follow them even if your own flee direction differs |
| Never stops | fear never decays / cohesion overshoot | fear decay 0.3–0.5/s, arrival damping into the graze spot, allelomimetic *stop* (one stops → neighbours stop), speed floor = 0 in graze |
| Flock explodes when cursor lands inside it | infinite pressure at d→0 | cap P at 1, make panic radius ≥ 2 sheep radii, PBD keeps them from overlapping while they sort themselves out |
| Can't catch the flock | sheep run speed ≥ cursor speed | sheep run ≈ 60–70 % of comfortable pointer speed; add stamina so run decays to trot after 3–5 s (Strömbom: dog must be faster) |
| Front sheep run into the cursor's path | flee ignores cursor velocity | lookahead threat position; approach term `toward` |

Designer-facing knobs (what Herdling/Come Bye style games and the boids libraries expose): flight-zone radius, panic radius, cursor-speed sensitivity, lookahead time, cohesion gain (calm/afraid), separation radius, alignment gain, fear decay, contagion gain and delay, reaction-delay range, walk/trot/run speeds, turn rates per state, graze break probability, stamina.

---

## 7. Debug and tuning tooling

What AAA does (and cheap web equivalents):

- **Live parameter panels**: every studio has an in-game tweak menu; on the web, **lil-gui** (dat.gui successor) or **Tweakpane** (TypeScript-first, monitors, graphs). Bind the panel to the *sim config object* and post the diff to the worker; persist to `localStorage`/JSON so tuning survives reloads. Typical workflow reported by three.js devs: panel for the first half of development, then bake values.
- **Overlays** (toggle per sheep or for a selected sheep): velocity and desired-velocity arrows; the **context map as a polar histogram** (interest green, danger red, chosen direction white) — this is the single most useful visual for context steering; neighbour links (metric radius vs topological k in different colours); fear as vertex colour or a ring; state as an icon; the pressure field as a coarse heatmap; PBD correction vectors in a third colour so you can see when constraints fight steering.
- **Deterministic seeds and replay**: two schools at GDC. *Deterministic replay* (For Honor "Back to the Future! Working with Deterministic Simulation", Spelunky 2 "Breaking the Ankh") — record seed + input stream, re-simulate; requires a fixed timestep, a seeded PRNG (never `Math.random`), no reliance on iteration order of hash maps, and identical float operation order (fine in JS if the sim is a single module with typed arrays). *Rewindable instant replay* (Mark Wesley, GDC 2013 "Implementing a Rewindable Instant Replay System for Temporal Debugging") — ring-buffer full state snapshots every step (60 sheep × ~16 floats × 30 Hz × 60 s ≈ 7 MB) so you can scrub backwards and forwards while tuning *without* determinism. Wesley argues rewind is better for tuning; do both — they are cheap here — and let the panel scrub time while sheep remain inspectable.
- **Scenario harness**: scripted cursor paths (straight approach, circling, "cursor parked inside flock", zig-zag) replayed against a seeded flock; the same `sim/` module runs headless in Node/vitest.
- **Behaviour metrics** (from the collective-motion literature, all O(n)):
  - polarisation φ = |Σ v̂ᵢ| / N (1 = all aligned; measure only for moving sheep),
  - cohesion = mean distance to centroid, or radius of gyration; normalised by √N·radius,
  - **split count** = connected components of the neighbour graph at threshold 2.5 × radius (should be 1 almost always for a calm flock),
  - overlap count / max penetration (PBD health),
  - **jitter** = mean |Δheading| per step for sheep with speed < walk (should be ≈ 0),
  - response latency = time from cursor entering the flight zone of the nearest sheep to 50 % of the flock leaving GRAZE,
  - settle time = time after the cursor stops until 90 % of the flock is back in GRAZE.

  Unit tests assert ranges on these for each scripted scenario ("circling at 1.5× flight zone keeps splits = 1 and polarisation > 0.7"; "parked cursor: jitter < 0.5°/step after 3 s"). This turns "does it feel right" regressions into red tests.

---

## 8. Recommended architecture for a three.js sheep flock

**Process model.** `sim/` is a pure TypeScript module (no DOM, no three.js) run in a Web Worker at a fixed 30 Hz (20 Hz is acceptable). Main thread: input capture, rendering, animation, interpolation. Transport: two transferable `ArrayBuffer`s ping-ponged with `postMessage` (upgrade to `SharedArrayBuffer` + `Atomics` if the overlay shell allows cross-origin isolation). Budget target for 60 sheep: sim < 0.3 ms per step (≈ 9 ms/s = 1 % of a core), animation + render the rest; throttle animation as in §4.6 so total CPU stays under ~5 % of one core.

**Data layout.** Structure-of-arrays typed arrays, `N` fixed at spawn (capacity 512):
`px, py, vx, vy, heading, speed, fear, state(Uint8), stateTimer, reactionQueue(time, nextState)`, per-sheep constants `radius, maxWalk/Trot/Run, flightZone, gregarious, fearDecay, reactionDelay`, plus scratch `interest[N×16]`, `danger[N×16]`, `nbrIdx[N×8]`, `nbrDist[N×8]`. Ring buffer of the last 8 fear values per sheep for delayed contagion. Uniform grid with counting sort, cell = max interaction radius (~3 sheep radii); rebuilt every step.

**Step order (per fixed step):**

1. Ingest input: cursor position → low-passed velocity → `threatPos = cursor + v·lookahead`, `speedGain`.
2. Build grid; for each sheep gather 3×3 candidates, partial-select k = 6 topological neighbours (and remember all within the contact radius for PBD).
3. Perception: `fear_direct` from the pressure field (§6.2); `fear_social` from neighbours' delayed fear; `fear = max(...)`, decay. Optional 32×32 fear grid diffusion.
4. Allelomimetic state machine (§5.2): GRAZE / ALERT / WALK / RUN with hysteresis thresholds on fear and mimetic transition rates; transitions are *scheduled* through the per-sheep reaction delay.
5. Context steering (§1.2), 16 slots: interest from cohesion-to-k-centroid, alignment (average neighbour heading, weight ∝ fear), graze target (weak wander/arrive when GRAZE), flee (away from threatPos bent toward centroid); danger from threatPos (weight = pressure), obstacles/screen bounds, and anticipatory neighbour danger using time-to-collision (Karamouzas). Mask, pick, parabolic sub-slot, rotate toward it at the state's turn rate. Desired speed from state (0 / 0.3 / walk / run) × per-sheep multiplier × ease-in.
6. Integrate: `v = lerp(v, desiredDir·desiredSpeed, 1 − e^(−dt/τ_accel))`, `x* = x + v·dt`.
7. PBD contact: 3 Gauss-Seidel iterations over contact pairs, `C = |xᵢ−xⱼ| − (rᵢ+rⱼ)(1−slack)` with stiffness 0.6, mass-weighted, plus a tangential friction damp of 0.3; one iteration of screen-bound constraints.
8. Velocity recovery: `v = (x* − x)/dt`, then XSPH smoothing `v += 0.3·mean(vⱼ − v)` over contact neighbours for sheep in GRAZE/ALERT (skip for RUN so running sheep stay lively).
9. Write `x, heading (from v when speed > ε, otherwise hold), speed, state, fear` to the outgoing buffer with the step index; post.

**Rendering/animation (main thread).** Interpolate `x, heading` between the last two snapshots with `alpha = acc/DT`. One glTF, clips shared; per sheep a `SkinnedMesh` + `AnimationMixer` with base actions `idle/graze/walk/trot/run` in a 1D blend by *interpolated speed*, `setEffectiveTimeScale(speed/strideSpeed)` on the dominant gait, `crossFadeTo(..., warp=true)` between gaits; additive layer for `look_left/right/up` weighted by the angle to `threatPos` (clamped, decayed) and a `startle` additive fired on fear jumps; procedural roll from yaw rate on the spine bone; 2-bone ear spring. Animation update buckets: moving or within the pointer's vicinity every frame, others at 15 Hz round-robin. Dust particles (single `Points` system) on RUN and state entry; bleat scheduler with flock cooldown. At 500 sheep, switch far sheep to a baked vertex-animation-texture `InstancedMesh` and keep skinned meshes only for the ~40 nearest to the cursor.

**Tooling.** Tweakpane panel bound to the sim config (posted to the worker on change, saved to JSON); debug overlay of context maps/neighbour links/fear; snapshot ring buffer with a scrub bar; seeded PRNG and an input log so any session can be replayed headless; vitest scenarios asserting polarisation, cohesion, split count, jitter, response and settle time.

---

## Sources

Steering / context steering
- Reynolds, "Steering Behaviors For Autonomous Characters" (GDC 1999): https://www.red3d.com/cwr/steer/gdc99/
- Fray, "Context Steering: Behavior-Driven Steering at the Macro Scale", Game AI Pro 2 ch.18 (free PDF): https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter18_Context_Steering_Behavior-Driven_Steering_at_the_Macro_Scale.pdf
- Fray, "Context Behaviours Know How To Share": https://andrewfray.wordpress.com/2013/03/26/context-behaviours-know-how-to-share/
- Fray, "Game AI Pro chapter on Context Steering": https://andrewfray.wordpress.com/2018/09/10/game-ai-pro-chapter-on-context-steering/
- RubenFrans/ContextSteering-Unity (fetched): https://github.com/RubenFrans/ContextSteering-Unity
- friedforfun/ContextSteering (fetched): https://github.com/friedforfun/ContextSteering
- wqaetly/ContextSteering (fetched): https://github.com/wqaetly/ContextSteering
- Godot forum, "Context Based Steering, Enemy direction instantly snapping, and getting stuck problems": https://forum.godotengine.org/t/context-based-steering-enemy-direction-instantly-snapping-and-getting-stuck-problems/121923
- KidsCanCode, "Context-based steering" (Godot recipe): https://kidscancode.org/godot_recipes/4.x/ai/context_map/index.html
- libGDX gdx-ai wiki, Steering Behaviors (blended vs priority steering; fetched): https://github.com/libgdx/gdx-ai/wiki/Steering-Behaviors
- GameDev.net, "seek and avoid jitter problem": https://www.gamedev.net/forums/topic/521108-seek-and-avoid-jitter-problem/
- Rory Driscoll, "AI Steering": https://www.rorydriscoll.com/2016/10/14/ai-steering/
- Nature of Code, ch.5 Autonomous Agents: https://natureofcode.com/autonomous-agents/

Herd AI in shipped games
- GDC, "Come to GDC for an inside look at the AI driving Horizon Zero Dawn" (Berteling talk): https://gdconf.com/article/come-to-gdc-for-an-inside-look-at-the-ai-driving-horizon-zero-dawn/
- Game Developer, "Behind The AI of Horizon Zero Dawn" pt.1 / pt.2: https://www.gamedeveloper.com/design/behind-the-ai-of-horizon-zero-dawn-part-1- , https://www.gamedeveloper.com/design/behind-the-ai-of-horizon-zero-dawn-part-2-
- Push Square, "AI Analysis of Horizon: Zero Dawn Finds Machines on Their Own Will Request to Join Herds": https://www.pushsquare.com/news/2019/02/ai_analysis_of_horizon_zero_dawn_finds_machines_on_their_own_will_request_to_join_herds
- GDC Vault, "Animation Bootcamp: Bringing Life to the Machines of Horizon Zero Dawn": https://gdcvault.com/play/1025040/Animation-Bootcamp-Bringing-Life-to
- GDC Vault, "Evolving the Horizon Series: Animating Believable Robots and Characters": https://gdcvault.com/play/1027894/Evolving-the-Horizon-Series-Animating
- GDC Vault, "Grounding Wildlife in the Mountains of Far Cry 4": https://www.gdcvault.com/play/1022027/Grounding-Wildlife-in-the-Mountains
- Game Developer, "Primal Instinct | Companion AI in Far Cry Primal": https://www.gamedeveloper.com/design/primal-instinct-companion-ai-in-far-cry-primal
- Game Developer, "The Definition of [Artificial] Insanity: The Systemic AI of Far Cry": https://www.gamedeveloper.com/programming/the-definition-of-artificial-insanity-the-systemic-ai-of-far-cry
- GDC Vault, "Virtual Insanity: Meta AI on Assassin's Creed: Origins": https://gdcvault.com/play/1025410/Virtual-Insanity-Meta-AI-on
- phys.org, "Red Dead Redemption 2: Virtual ecology is making game worlds eerily like our own": https://phys.org/news/2018-11-red-dead-redemption-virtual-ecology.html
- Game Developer, "Rockstar's quest for the ultimate video game horse": https://www.gamedeveloper.com/design/rockstar-s-quest-for-the-ultimate-video-game-horse
- Game Developer, "Designing the simulation of the wild and wonderful Planet Zoo": https://www.gamedeveloper.com/game-platforms/designing-the-simulation-of-the-wild-and-wonderful-i-planet-zoo-i-
- Game Developer, "Game Design Deep Dive: Creating believable crowds in Planet Coaster": https://www.gamedeveloper.com/audio/game-design-deep-dive-creating-believable-crowds-in-i-planet-coaster-i-
- Owen McCarthy, "Simulating 10,000 Guests in Planet Coaster" (slides): https://www.slideshare.net/slideshow/simulating-10000-guests-in-planet-coaster-owen-mc-carthy/101264455
- GDC Vault, "Animating Quadruped Characters in The Flame in The Flood": https://gdcvault.com/play/1023209/Animating-Quadruped-Characters-in-The

Herding games
- Xbox Wire, "How We Got the 'Herd' in Herdling": https://news.xbox.com/en-us/2025/02/27/how-we-got-the-herd-in-herdling/
- Herdling review (Good Game Lobby): https://goodgamelobby.substack.com/p/herdling-review-atmospheric-indie-adventure-calicorns-okomotive-panic-popagenda
- FLOCK! (Giant Bomb wiki): https://giantbomb.com/wiki/Games/FLOCK ; AV Club review: https://www.avclub.com/flock-1798216172
- Flockers review (TheSixthAxis): https://www.thesixthaxis.com/2014/09/11/flockers-review-ps4-xbo-pc/ ; PCGamesN: https://www.pcgamesn.com/flockers/flockers-pc-review
- Sheep, Dog 'n' Wolf (Wikipedia): https://en.wikipedia.org/wiki/Sheep,_Dog_%27n%27_Wolf
- Come Bye: A Sheepdog Simulator (Steam): https://store.steampowered.com/app/1282380/Come_Bye_A_Sheepdog_Simulator/
- Sheep Dog Sim (three.js): https://sheepdogsim.com/ ; source (fetched): https://github.com/matthew-kissinger/sds ; itch: https://mkvision.itch.io/sheep-dog-sim
- Kyon dev blog, "Core Mechanics: Herding Sheep and Having Fun Doing It": https://www.kyon-game.com/blog/2017/1/26/core-mechanics-herding-sheep-and-having-fun-doing-it
- Nuno1123/chaser, 2D sheepdog trials game with three-ring dog model (fetched): https://github.com/Nuno1123/chaser

Sheep behaviour science and shepherding models
- Strömbom et al., "Solving the shepherding problem: heuristics for herding autonomous, interacting agents", J. R. Soc. Interface 2014: https://royalsocietypublishing.org/doi/10.1098/rsif.2014.0719 (open PDF: https://uu.diva-portal.org/smash/get/diva2:645255/FULLTEXT01.pdf ; ScienceDaily summary: https://www.sciencedaily.com/releases/2014/08/140826205519.htm)
- Ginelli et al., "Intermittent collective dynamics emerge from conflicting imperatives in sheep herds", PNAS 2015: https://www.pnas.org/doi/10.1073/pnas.1503749112
- Gómez-Nava et al., "Intermittent collective motion in sheep results from alternating the role of leader and follower", Nature Physics 2022: https://www.nature.com/articles/s41567-022-01769-8
- Gautrais et al., "Allelomimetic synchronization in Merino sheep": https://www.sciencedirect.com/science/article/abs/pii/S0003347207002709
- Ballerini et al. topological neighbours (PLOS One relation to model): https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0126913 ; "Efficient flocking: metric versus topological interactions": https://royalsocietypublishing.org/rsos/article/8/9/202158/96185/Efficient-flocking-metric-versus-topological ; "Influence of the number of topologically interacting neighbors on swarm dynamics": https://www.nature.com/articles/srep04184
- Startle cascades in fish (SIR contagion): https://arxiv.org/pdf/2108.05537 ; delay Vicsek model signal propagation: https://arxiv.org/pdf/2205.12069
- Grandin, "Understanding Flight Zone and Point of Balance": https://www.grandin.com/behaviour/principles/flight.zone.html ; stock-dog view: https://doreriverbordercollies.com/post/flight-zones-explained-how-sheep-really-read-pressure-in-stock-dog-training ; Georgia Tech, "Sheepdogs Reveal a Better Way to Guide Robot Swarms": https://www.chbe.gatech.edu/news/2026/03/sheepdogs-reveal-better-way-guide-robot-swarms

Local avoidance / crowds
- ORCA (UNC GAMMA): https://gamma.cs.unc.edu/ORCA/ ; RVO2 library: https://gamma.cs.unc.edu/RVO2/ , https://github.com/snape/RVO2
- Karamouzas, Skinner, Guy, "Universal Power Law Governing Pedestrian Interactions", PRL 2014: https://pubmed.ncbi.nlm.nih.gov/25526171/ ; supplemental: https://motion.cs.umn.edu/PowerLaw/PRL14_supplemental.pdf
- Weiss et al., "Position-Based Multi-Agent Dynamics for Real-Time Crowd Simulation" (MiG 2017): https://arxiv.org/abs/1802.02673 ; C&G 2019 "Position-based real-time simulation of large crowds": https://www.sciencedirect.com/science/article/abs/pii/S0097849318301699 ; code: https://github.com/tomerwei/pbd-crowd-sim
- wayne-wu/webgpu-crowd-simulation (PBD crowd in WebGPU; fetched): https://github.com/wayne-wu/webgpu-crowd-simulation
- GameDev.net, "Pathfinding and Local Avoidance for RPG/RTS Games using Unity" (RVO jiggling at ~100 agents): https://gamedev.net/tutorials/programming/general-and-gameplay-programming/pathfinding-and-local-avoidance-for-rpgrts-games-using-unity-r3703
- Unity forum, "Obstacle avoidance jittery": https://discussions.unity.com/t/obstacle-avoidance-jittery/837677 ; LlamAcademy NavMeshAgent avoidance deep dive: https://github.com/llamacademy/ai-series-part-32

Spatial partitioning / timestep / workers
- Gaffer on Games, "Fix Your Timestep!": https://gafferongames.com/post/fix_your_timestep/ (mirror fetched: https://github.com/mas-bandwidth/gafferongames/blob/master/content/post/fix_your_timestep.md)
- hughsk/boids (fetched; 1,000 boids benchmarks): https://github.com/hughsk/boids
- ercang/boids-js (grid + WebWorkers; fetched): https://github.com/ercang/boids-js ; write-up: https://medium.com/@ercangercek/experiment-with-3d-boids-and-javascript-fe8fa51707b8
- grumpypixel/SpatialHash-js: https://github.com/grumpypixel/SpatialHash-js
- surma.dev, "Moving a Three.js-based WebXR app off-main-thread": https://surma.dev/things/omt-for-three-xr/
- SharedArrayBuffer + Atomics overview: https://dev.to/rigalpatel001/high-performance-javascript-simplified-web-workers-sharedarraybuffer-and-atomics-3ig1

Animation
- three.js Animation System manual: https://threejs.org/manual/en/animation-system.html
- three.js AnimationAction source (fetched): https://github.com/mrdoob/three.js/blob/dev/src/animation/AnimationAction.js ; docs: https://threejs.org/docs/#api/en/animation/AnimationAction.crossFadeTo
- three.js example, additive blending (fetched): https://github.com/mrdoob/three.js/blob/dev/examples/webgl_animation_skinning_additive_blending.html ; blending: https://threejs.org/examples/webgl_animation_skinning_blending.html
- three.js WebGPU instanced skinning example (fetched): https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_skinning_instancing.html
- three.js PR #22667 InstancedSkinnedMesh (closed; fetched): https://github.com/mrdoob/three.js/pull/22667 ; forum thread: https://discourse.threejs.org/t/animated-instanced-skinned-meshes-gltf/41958
- @three.ez/instanced-mesh (skinning + LOD for instances; fetched): https://github.com/agargaro/instanced-mesh
- GameDev.net, "Skeletal Animation Optimization Tips and Tricks": https://www.gamedev.net/articles/programming/graphics/skeletal-animation-optimization-tips-and-tricks-r3988/
- Godot proposal #12142, animation update slicing / LOD (fetched): https://github.com/godotengine/godot-proposals/issues/12142
- MoCap Online, creature animation / locomotion / animation LOD guides: https://mocaponline.com/blogs/mocap-news/creature-animation-games-guide , https://mocaponline.com/blogs/mocap-news/locomotion-animations-game-dev , https://mocaponline.com/blogs/mocap-news/animation-lod-performance-guide
- Little Polygon, "Procedural Animation: Locomotion (Part 1)": https://blog.littlepolygon.com/posts/loco1/
- Unreal forum, "non-rootmotion turning for quadruped characters": https://forums.unrealengine.com/t/guidance-on-implementing-non-rootmotion-turning-for-quadruped-characters/2692621

Debug / tooling / determinism
- Mark Wesley, GDC 2013 "Implementing a Rewindable Instant Replay System for Temporal Debugging": https://gdcvault.com/play/1018138/Implementing-a-Rewindable-Instant-Replay (video: https://archive.org/details/GDC2013Wesley)
- GDC Vault, "Back to the Future! Working with Deterministic Simulation in For Honor": https://www.gdcvault.com/play/1026322/Back-to-the-Future-Working
- GDC Vault, "Breaking the Ankh: Deterministic Propagation Netcode in Spelunky 2": https://www.gdcvault.com/play/1027119/Breaking-the-Ankh-Deterministic-Propagation
- Tweakpane: https://github.com/cocopon/tweakpane ; lil-gui with three.js: https://svilenkovic.com/3d/lil-gui-three-js ; Three.js Journey "Debug UI": https://threejs-journey.com/lessons/debug-ui
- Flocking order/cohesion metrics (example thesis): https://www.csc.kth.se/utbildning/kth/kurser/DD143X/dkand11/Group5Lars/carl-oscar_erneholm.pdf
