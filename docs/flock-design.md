# Flock behaviour design spec

The flock is the game. This document specifies the simulation to AAA fidelity: what each sheep
perceives, how it decides, how it moves, how fear spreads, how the pointer acts on it, how it is
animated, and how we prove it behaves. Every rule traces back to `flock-research.md`.

Notation: **BL** = one adult sheep body length (the sim's unit of distance), **s** = seconds.
Angles in degrees. Rates are per second and are converted to per-step probabilities with
`P = 1 − exp(−rate·dt)`.

---

## 1. World, units and scale

- The sim runs in **body lengths and seconds**, not pixels or metres. One BL ≈ 1.2 m in the real
  world. The renderer converts with `pxPerBL` (default 48 px at 100 % DPI, so a 1920×1080 work
  area is a ~40 × 22 BL paddock). `pxPerBL` is a setting; behaviour does not change with it.
- Real-world outer ranges are compressed so they fit on a screen. Inner ranges (contact, packing,
  following gaps) keep their real proportions because those are what the eye reads.

| Quantity | Real | Sim (BL) | Note |
|---|---|---|---|
| Body radius (contact disc) | 0.2–0.25 m | 0.5 wide, 1.0 long; contact disc r = 0.45 | PBD uses the disc; visuals are the full model |
| Packed spacing (alarmed) | ~1 BL centre to centre | 1.0–1.2 | Jadhav 1.21 m |
| Relaxed grazing spacing | ~5 m (4 BL) | 2.5–4 | Depends on flock size and screen |
| Dog response distance r_s | ~70 m (58 BL) | 8 base, 5–13 after boldness and arousal | Compressed hard: at 18+ BL the flock reacts across the whole paddock and cannot be approached at all |
| Human flight distance | 5.7–11.4 m (5–10 BL) | 3 base | Used for the *idle* pointer; a still pointer is a standing human, a moving one is a dog |
| Following gap | 1–2 m | 1.2–1.8 | |
| Isolation distance | ~10 m | 8 | Lone-sheep trigger |

- The **work area is the paddock**. Edges are fences: sheep never leave, never clip, and treat
  edges and corners as low-preference (danger in the context map, see §6). Later phases add OS
  windows as obstacles or "grass".
- Ground is flat. "Uphill" and "toward light" biases are reserved for later gameplay and are
  represented by an optional scalar preference field the steering can sample.

## 2. Sheep data model

Structure-of-arrays typed arrays, capacity 512, N active. All per-sheep constants drawn once from
a seeded PRNG.

**Dynamic state**

| Field | Type | Meaning |
|---|---|---|
| `pos`, `vel` | f32 ×2 | BL, BL/s |
| `heading` | f32 | body yaw; may differ from velocity when stationary |
| `headYaw` | f32 | head look direction relative to body (animation only) |
| `state` | u8 | GRAZE, ALERT, WALK, RUN, REST (§4) |
| `stateTime` | f32 | seconds in current state |
| `fear` | f32 0..1 | fast variable, decays in 10–20 s |
| `arousal` | f32 0..1 | slow variable, decays over 60–180 s; widens flight zone, speeds reactions |
| `stamina` | f32 0..1 | depletes while sprinting, refills while not running |
| `pending` | (u8 state, f32 at) | scheduled state change (reaction delay) |
| `leader` | i16 | index of sheep followed in a WALK episode, or −1 |
| `fearHist[8]` | f32 ring | fear over the last ~0.3 s, read by neighbours (delayed contagion) |
| `nbr[8]`, `nbrDist[8]` | i16/f32 | k-nearest visible neighbours this step |
| `interest[16]`, `danger[16]` | f32 | context maps (scratch) |

**Personality constants** (per sheep, drawn once; ranges are multipliers on flock defaults)

| Constant | Range | Effect |
|---|---|---|
| `scale` | 0.9–1.1 | visual size, contact radius, speeds ×(1/scale)^0.3 |
| `boldness` | 0.6–1.4 | shrinks flight zone, raises spontaneous initiation, lowers contagion susceptibility |
| `gregariousness` | 0.7–1.3 | cohesion gain, isolation discomfort |
| `reactionDelay` | 0.3–1.2 s | latency of every state change (bold sheep faster) |
| `fearDecay` | ±30 % | who calms down first |
| `speedMult` | ±12 % | staggering while running |
| `grazeBias` | 0.7–1.3 | time between graze steps, look-up rate |
| `role` | ewe / lamb / (later: ram, ewe-with-lamb) | lambs pronk, lag and sprint; ewes with lambs stamp instead of fleeing cleanly |

**Breed preset** (flock-wide): `merino` = strong cohesion, small spacing, rarely sub-groups;
`hill` = larger spacing, sub-groups tolerated, disperses unless disturbed.

## 3. Perception

Evaluated each step (30 Hz) for the pointer and every 0.2 s for neighbours.

**Neighbours.** Gather candidates from the 3×3 spatial-hash cells (cell = 4 BL), then:
- `contact`: all within 1.3 BL centre to centre (PBD and grazing repulsion).
- `visible`: the k = 6 nearest that are inside the 300° field of view and not occluded (cheap
  occlusion: skip a candidate if another nearer neighbour lies within 12° of the same bearing).
  Used for cohesion, contagion and state imitation. Topological, not metric, so a dispersed flock
  still re-packs and a straggler always has someone to be attracted to.
- `LCM`: centre of mass of `visible` (n = 6) for cohesion; a second, larger centre of the
  n = max(6, N/2) nearest is used for the RUN state so a pressed flock collapses to one pack.

**Field of view.** 300° total; rear blind cone 60° (±30° of the tail). Binocular cone ±20° ahead.
- A pointer inside the blind cone is perceived at 0.3× direct pressure unless within 2 BL
  (hearing/proximity), so approaching a grazing sheep from directly behind gets closer before it
  reacts, and the reaction is a startle (fear jump) rather than a graded increase.
- Sheep in ALERT rotate the body to bring the threat into the binocular cone before deciding
  (§4). While the body rotates the head leads by 100–200 ms (animation §8).

**Pointer as threat.** The main thread supplies pointer position each frame. The worker keeps
`cursorVel` (low-pass 60 ms) and computes:

```
threatPos   = cursor + cursorVel · lookahead          lookahead = 0.2 s
speedFactor = 1 + 0.6 · clamp(|cursorVel| / runSpeed, 0, 2)
```

Per sheep, with `d = |threatPos − pos|` and `toward = dot(normalize(pos − threatPos), normalize(cursorVel))`:

```
zone   = flightZone · (0.8 + 0.4·arousal) / boldness
        flightZone = 3 BL when |cursorVel| < 0.3 BL/s (idle pointer ≈ standing human),
                     rising linearly to r_s = 8 BL at |cursorVel| ≥ 2 BL/s (moving dog)
directness = 1 + 0.5 · max(0, toward)                  head-on approaches count more
angleFactor = 1.0 in front hemisphere, 0.3 in blind cone (see above)
pressure = smoothstep(zone·1.5, zone·0.35, d) · speedFactor · directness · angleFactor
pressure = min(pressure, 1)
```

A pointer that stops moving decays to the small idle zone within ~1 s, which is the
**release**. Movement is what herds.

**Point of balance.** For each sheep, the pointer's bearing relative to the body: behind the
shoulder line (more than 70° off the nose) pushes *forward along heading*; ahead of it stops or
turns the sheep back. This enters the context map as interest ahead vs. danger ahead (§6).

## 4. Behaviour states and transitions

Five states. Every transition is *scheduled* through `reactionDelay` (scaled by 1/(1+arousal)),
so cascades ripple instead of firing in the same step. Fear thresholds use hysteresis (enter
higher than exit).

| State | Speed | Body | What it does |
|---|---|---|---|
| **GRAZE** | 0, with 0.5–2 BL steps at 0.3 BL/s every 5–20 s (× grazeBias) | head down | slow drift, gentle metric repulsion keeps 2.5–4 BL spacing; Poisson look-ups (mean 6 s) |
| **ALERT** | 0 | head up, ears forward, body turns to face threat | 1–5 s freeze and stare; optional stamp/snort for bold or lamb-guarding ewes; decides to RUN, WALK or return to GRAZE |
| **WALK** | 1.0–1.3 BL/s | head level | episodic relocation in a line behind a temporary leader, or the calm drive when the pointer presses gently from behind |
| **RUN** | 2.5–4 BL/s, sprint to 6 BL/s while stamina > 0 | head up, body lowered | selfish-herd pack toward centre, then away from threat as a group |
| **REST** | 0 | lying, ruminating | later phase; long idle texture, synchronised across the flock |

**Transition rates** (n counts are over `visible` neighbours; n_M = walking + running,
n_S = stationary, n_R = running, N_loc = |visible| + 1)

```
GRAZE → WALK    spontaneous: 0.08 / N_loc · boldness            (Azaïs μ* = 0.08 s⁻¹ shared by the group)
                mimetic:     0.3 · n_M^0.8 / max(1, n_S)^0.7    (Pillot/Azaïs; super-linear in movers)
                fear:        fear in [0.25, 0.55) → rate 1.5    (gentle pressure = calm walk-off)

WALK → GRAZE    mimetic:     0.4 · n_S^0.5 / max(1, n_M)^0.5
                time-out:    1/15 if I initiated and nobody follows within 15 s (Toulet)
                arrival:     rate 2 when my leader has stopped and gap < 1.5 BL

GRAZE/WALK → ALERT   fear crosses 0.15 upward, or any visible neighbour enters ALERT/RUN while
                     my fear > 0.05 (rate 1.0 · fraction of visible neighbours alerted)

ALERT → RUN     fear ≥ 0.45, or mimetic (1/2 s) · (1 + 2.5·n_R)^2.5   (Ginelli super-linear)
ALERT → WALK    fear in [0.25, 0.45) after 1–3 s and threat still present
ALERT → GRAZE   fear < 0.12 for 2 s (bold) to 6 s (timid); exit is slower than entry

GRAZE/WALK → RUN   direct:   fear ≥ 0.6 (startle path, skips ALERT; used when pressure jumps
                             > 0.3 in one step, e.g. pointer appears from the blind cone)
                   isolation: 0.02 · max(0, nearestDist − 8 BL)   (lone sheep runs to rejoin)

RUN → ALERT     (1/3 s) · (1 + 2.5 · n_close)^2.5, n_close = visible non-running neighbours < 1.5 BL
                forced when fear < 0.2 and all visible neighbours within 2 BL and threat not
                approaching. On entering ALERT from RUN the flock stops *together* and faces the
                threat (the “stop and stare”), then relaxes to GRAZE.
```

**Fear dynamics** (per step)

```
fearDirect = pressure                                             (§3)
fearSocial = min(0.85 · fear_j, w · fear_j)      capped below the source: transmission is lossy
             w = 0.9 · visibilityWeight(j) · (1.6 if j runs toward me)
             visibilityWeight ∝ 1 / log(2 + dist), read from j's fear one reaction delay ago
             applied only if fraction of visible neighbours alarmed exceeds
             threshold θ = 0.35 · boldness, OR my own fear > 0.5, OR the neighbour is running
             *toward* me (a runner coming at me is always a stimulus)
fear      = min(1, max(fear, fearDirect, fearSocial))
fear     *= exp(−dt / τ_fear)         τ_fear = 12 s · fearDecay, shortened to 6 s when the flock is packed
arousal   = max(arousal, 0.6·fear);  arousal *= exp(−dt / 120 s)
```

The fraction threshold keeps cascades **subcritical** when the pointer is far (one spooked sheep
ripples two or three neighbours and dies out) and **supercritical** when it is close (everyone
runs). This matches the fish-school startle data and Ginelli's peripheral-sheep-triggers-packing.

## 5. Group mechanics

**Selfish herd.** In RUN the desired direction is
`normalize(c·toLCM + ρ_a·awayFromContacts + ρ_s·awayFromThreat + w_al·runnersHeading + e·noise)`
with Strömbom's weights c = 1.05, ρ_a = 2, ρ_s = 1, e = 0.3, inertia h = 0.5, and a small
w_al = 0.3 (sheep barely align). `c` scales up to 1.6 with fear, so the pack collapses first and
drifts away second. Outer sheep therefore travel furthest and fastest, exactly as in the GPS data.

**Following.** On entering WALK, pick `leader` = the nearest visible sheep already in WALK/RUN in
my front hemisphere (probability 0.8 to slot in *behind* it, 0.2 beside). Steer toward
`leader.pos − 1.4 BL · leader.headingVec` and regulate speed by gap:
`speed = clamp(0.9 · (gap − 1.0), 0, walkMax)`. If no such sheep exists I am the initiator and
do a persistent random walk (heading noise 15°/√s) until stop rules fire. Lines and wedges
emerge; funnelling through gaps emerges because followers steer to positions, not headings.

**Front-to-back information flow when driven.** Not scripted. With the pointer behind and every
sheep following the one ahead, direction is decided at the front, matching Jadhav 2024.

**Splitting and break-back.** If `pressure > 0.85` for a sheep whose LCM lies *beyond* the
threat (the pointer is inside the flock), its cohesion target switches to the nearest 3
neighbours only for 3 s. Sub-groups form naturally. A tail-end sheep with the pointer within
1.5 BL and the flock ahead blocked (danger ahead > 0.7) gets interest in the slots past the
pointer: it breaks back. Both are the cost of pushing too hard.

**Sub-groups and homesickness.** Connected components of the flock are found each step by
union-find over pairs within `group.linkDist` (6 BL), searched over the uniform grid — searching
the contact lists instead silently caps the link distance at about 1.9 BL, which was a real bug for
a while and an instructive one (§13). Each group publishes its own centre and a centre of
everyone-but-itself. Cohesion pulls toward the first; homesickness toward the second, and only when
a group is too small to be a flock in its own right (`group.shedTolerance`, absolute size, raised
to a quarter of the count for large flocks). Homesickness is deliberately **not** fear: it makes a
sheep want to rejoin, never to freeze. It adds an interest lobe in GRAZE, WALK and RUN, and a sheep
in a group under half the tolerance and more than 8 BL from the others must leave GRAZE or ALERT
and walk back. A weak long-range `driftTogether` on top of it reunites a divided flock over
minutes, so accidental splits heal while deliberate ones survive being worked with (§13).

**Isolation.** A sheep with no visible neighbour within 8 BL sets `lonely = 1`: bleat (with
cooldown), fear floor 0.3, cohesion gain ×2, GRAZE forbidden. It runs to the flock even past the
pointer if that is the only route (danger from the pointer is scaled by 0.5 while lonely).

**Idle expansion and re-packing.** Grazing repulsion (contact + 1 BL) slowly spreads the flock;
the isolation term and spontaneous runs by peripheral sheep trigger avalanche re-packing every
few minutes. Nothing is scripted; the cycle emerges from §4. Target period at 20 sheep: 3–6 min.

## 6. Steering and movement

**Context steering**, 16 slots (22.5°), per Fray. Behaviours write interest or danger; per-slot
`max`, never sums, so nothing cancels.

| Behaviour | Writes | Active in | Shape |
|---|---|---|---|
| Cohesion to LCM | interest | all moving states; weak in GRAZE | `gain · max(0, dot)`, gain = c·(1 + fear) · gregariousness, falls to 0 inside 1.5 BL of LCM |
| Follow predecessor | interest | WALK | toward the slot position behind the leader; dominates cohesion |
| Flee | interest (away) + danger (toward) | ALERT, RUN | weight = pressure; the interest lobe is bent toward LCM by λ = 0.8·(1+fear) |
| Point of balance | interest ahead / danger ahead | pointer inside zone | pointer behind shoulder line → +0.4 interest along heading; ahead → +0.5 danger along heading |
| Neighbour anticipation | danger | all | Karamouzas time-to-collision: `k · τ⁻² · e^(−τ/τ₀)` on the bearing to each contact neighbour, τ₀ = 1.5 s |
| Fences (edges, corners) | danger | all | rises from 0 at 3 BL to 1 at 0.5 BL from an edge; corners doubled |
| Graze wander | interest | GRAZE steps | low-frequency noise around current heading, ±30° |
| Preference field (later) | interest | WALK | samples uphill / light / grass fields |

Resolution: find min danger, mask every slot with danger > min + 0.1, take the max interest,
fit a parabola over the three neighbouring slots, then rotate the current heading toward it at
the state's turn rate. Speed is decided by state, then multiplied by `(1 − dangerInChosenSlot)`.

**Kinematics** (BL/s; multiply by `speedMult`)

| | GRAZE step | WALK | RUN | Sprint |
|---|---|---|---|---|
| Speed | 0.3 | 1.0–1.3 | 2.5–4.0 | 6.0, while stamina > 0 |
| Turn rate cap | 90°/s | 180°/s | 360°/s | 360°/s |
| Accel τ | 0.4 s | 0.4 s | 0.3 s | 0.25 s |
| Decel τ | 0.8 s | 0.8 s | 0.6 s | 0.6 s |

Stamina drains at 0.35/s while above 4 BL/s and refills at 0.1/s otherwise; below 0.2 the sheep
cannot exceed RUN speed. **Pointer speed is not capped**, but a fast pointer scares more than it
herds (§3), so restraint is the skill. A steady pointer at ~1.5–2 BL/s drives a walking flock,
matching the 1.5–2 m/s working speed of a real dog.

Velocity integration: `v = lerp(v, desiredDir·desiredSpeed, 1 − e^(−dt/τ))`, then
`pos* = pos + v·dt`. Heading follows velocity when speed > 0.15 BL/s; otherwise it holds and
only ALERT's face-the-threat rotates it.

**Non-overlap: position-based dynamics.** After integration, 3 Gauss–Seidel iterations over
contact pairs: constraint `|pᵢ − pⱼ| ≥ (rᵢ + rⱼ)·0.97`, stiffness 0.6, mass-weighted, tangential
friction 0.3; then one fence-constraint pass. Recover `v = (pos* − pos)/dt` and apply XSPH
smoothing `v += 0.3 · mean(vⱼ − v)` over contacts for GRAZE/ALERT sheep only. A packed, resting
flock must sit perfectly still: this pipeline, not ORCA or separation forces, guarantees it.

## 7. Pointer, pressure and the player's skill curve

What the player should discover, in order, without a tutorial:

1. Moving the pointer near the flock makes the nearest sheep look up (ALERT). Stopping calms them.
2. Moving toward them makes them walk away as a group. Moving fast makes them run and bunch.
3. The flock moves away from the pointer *through its own centre*: to move the flock left, be on
   its right. The flock steers from its front, so pushing the tail harder does not turn it.
4. Circling wide gets you behind them without a stampede; cutting straight in scatters them.
5. Diving into the middle splits them; single sheep break back past you. Collect the stragglers,
   then drive.
6. Gentle, steady pressure from ~2 BL behind the balance point produces a smooth walking drive.

Designer knobs, each mapped to a feel:

| Knob | Default | Feel |
|---|---|---|
| `flightZoneIdle` / `r_s` | 7 / 22 BL | how skittish |
| `speedFactorGain` | 0.6 | how much fast pointer movement scares |
| `lookahead` | 0.2 s | anticipation of the pointer's path |
| `cohesionGain` c | 1.05 (→1.6 at fear 1) | stickiness; lower = scatter-prone |
| `kVisible` | 6 | ≥ N/2 for an unsplittable flock, 5–6 for realistic splits |
| `contagionThreshold` θ | 0.35 | how easily one spook becomes a stampede |
| `reactionDelay` range | 0.3–1.2 s | ripple speed |
| `fearDecay` τ | 12 s | how fast they settle |
| `arousalDecay` | 120 s | how long a bad scare keeps them jumpy |
| `spontaneousRate` μ* | 0.08 | wanderlust of the idle flock |
| `runSpeed` / `sprint` | 3.5 / 6 BL/s | catchability |
| `alignWeight` w_al | 0.3 | keep low or they turn like birds |

## 8. Animation layer (renderer, main thread)

Simulation-driven, no root motion. One glTF, clips shared, per-sheep `SkinnedMesh` and
`AnimationMixer`.

- **Clips** (authored in Blender via `tools/blender/`, phase-matched so the left fore-foot plants at
  the same normalised time): `idle`, `graze` (head down, chew, occasional step), `alert` (head
  up, ears forward, weight back), `walk` (1.2 BL/s reference), `trot` (2.5), `run` (4.0),
  `startle` (short hop), `stamp`, `lie_down`/`lie_idle`/`stand_up` (REST), `pronk` (lambs).
  Additive single-frame poses: `look_l`, `look_r`, `look_up`, `ear_flick`.
- **Gait blend**: 1D over *interpolated* speed with `crossFadeTo(..., warp = true)`; dominant clip
  `timeScale = speed / strideSpeed_clip`, clamped to [0.75, 1.35] to kill foot sliding.
- **Head**: additive `look_*` weights from the angle to `threatPos` (or to the leader while
  following), clamped ±70°, smoothed 150 ms; head leads body turns by 100–200 ms.
- **Procedural**: spine roll `clamp(0.06·yawRate·speed, ±12°)`, pitch from acceleration ±6°,
  2-bone ear spring and 2 wool-tuft bones driven by head acceleration.
- **Alert sequence**: `alert` pose + face-the-threat rotation + optional `stamp`; `startle` fires
  when fear jumps > 0.3 in one step.
- **Budget**: mixers for moving sheep and sheep within 8 BL of the pointer update every frame,
  others at 15 Hz round-robin; max 2 base actions + 2 additives active per sheep. At 60 sheep this
  is the largest CPU item, so it is measured in the harness.
- **Juice**: dust puffs on RUN entry and while speed > trot; bleats on ALERT entry with a
  flock-wide 1.5 s cooldown and pitch by `scale`; lonely bleats are higher and repeated.
- **Blob shadow** decal per sheep, scaled by `scale`, slightly offset by a global light direction.

## 9. Architecture

```
renderer (main thread)                     sim (Web Worker, fixed 30 Hz)
  pointer capture ──────── {x,y,t} ───────►  input log, cursorVel, threatPos
  interpolate snapshots  ◄── ArrayBuffer ──  SoA state, spatial hash, perception,
  three.js scene, mixers      (ping-pong)    state machine, context steering,
  debug overlays, Tweakpane ── config ─────► integrate, PBD, XSPH, snapshot
```

- `sim/` has no DOM or three.js imports; the same module runs in the Worker, in Node for tests,
  and in Playwright for screenshots.
- Deterministic: seeded PRNG, fixed step, typed arrays, no hash-map iteration order dependence.
  Seed + input log reproduces any session; a 60 s snapshot ring buffer allows scrubbing.
- Budget at 60 sheep: sim < 0.3 ms/step, animation + render < 3 ms/frame at 30 fps, total
  under ~5 % of one core while active and near zero when the flock is idle and the pointer far.

## 10. Verification: metrics and acceptance tests

Metrics computed by the sim each step and asserted by headless scenario tests (vitest) with a
seeded flock and scripted pointer paths:

| Metric | Definition |
|---|---|
| cohesion | mean distance to centroid, in BL |
| polarisation | `|Σ v̂ᵢ| / N_moving` |
| splits | connected components of the neighbour graph at 4 BL (two relaxed spacings) |
| jitter | mean |Δheading| per step for sheep with no movement intent |
| response distance | pointer distance at which 10 % of the flock leaves GRAZE |
| response latency | time from zone entry to 50 % of the flock leaving GRAZE |
| settle time | time from pointer stop until 90 % back in GRAZE |
| overlap | max disc penetration (PBD health) |

Scenarios and expected ranges (derived from the field data, compressed to sim scale):

1. **Undisturbed, 20 sheep, 10 min**: spacing grows from ~1.5 to 2.5–4 BL; 2–4 spontaneous
   re-packing events; splits = 1 for > 95 % of the time; jitter < 0.3°/step.
2. **Undisturbed, 5 sheep**: intermittent line walks of 8–25 BL every 1–4 min; a different
   leader in ≥ 3 of 5 episodes; first follower within 0.5–2 s; all-or-none in ≥ 80 % of episodes.
3. **Straight fast approach (3 BL/s)**: response at 16–26 BL; RUN fraction > 0.8 within 3 s;
   cohesion falls to 1.2–2.5 BL; the pack moves away through its centroid; polarisation > 0.7.
4. **Wide circle at 1.3 × zone**: no RUN; ALERT fraction 0.3–0.8; flock rotates to face the
   pointer; splits = 1.
5. **Gentle drive from behind at 1.5 BL/s**: WALK dominant; barycentre speed 0.9–1.4 BL/s;
   polarisation 0.75–0.95; cohesion 1.2–2.0 BL; direction decided by front sheep (leading sheep's
   heading change precedes barycentre heading change).
6. **Pointer parked inside the flock**: splits ≥ 2 within 3 s; ≥ 1 break-back; then re-merge
   within 60 s once the pointer leaves.
7. **Blind-cone approach**: reaction 2–3 BL later than frontal; `startle` fires; cascade reaches
   > 80 % of the flock within 2 s.
8. **Pointer stops after a scare**: settle time 15–60 s; the flock ends up facing where the
   pointer was; overlap = 0 and jitter ≈ 0 while settled.
9. **Lone sheep placed 15 BL away**: bleats, reaches the flock within 12 s, even when the pointer
   sits between them at 5 BL.
10. **A shed**: flick the pointer into the middle of 24 sheep and hold the gap for 25 s; the flock
    ends in two groups, the smaller of them a real group of 4+.
11. **A shed driven off**: as above, then walk one half away and leave the flock entirely alone for
    15 s; the two groups are still two groups.

Every scenario also has a Playwright screenshot sequence for visual review from Claude Code.

**The behaviour harness.** `npm run behaviour` runs every one of these properties in a single pass
and prints them together, with the wanted range beside each. Behaviour work on the flock is
entangled — a change that helps shedding quietly destroys driving — and a single failing assertion
says nothing about which. Options: `--seeds 1,2,3`, `--patch '{"run":{"cohesion":0.8}}'` to try a
config change without editing anything, `--json`. Sweep a parameter with a shell loop over
`--patch` before touching a default. Two warnings, both learned the hard way in §13: a probe that
never applies pressure will happily report numbers for forty-five seconds, so instrument before
tuning; and `drive`'s displacement swings between 5 and 15 BL across neighbouring parameter values,
so do not chase it.

## 11. What changed during implementation

Tuning against the metrics harness contradicted the spec in seven places. Each change is in the
code with a comment saying why:

1. **Flight zones are much smaller** (3 BL idle, 8 BL moving, against 7 and 22). At spec scale the
   flock reacts across the whole paddock and cannot be approached at all, so there is no game.
2. **Contagion is lossy.** Copying a neighbour's alarm at full strength makes the flock a perfect
   memory cell: it holds itself at maximum fear indefinitely and never settles. Transmitted fear is
   capped at 0.85 of its source, and fear is clamped to 1.
3. **Unease is separated from fear.** Modelling "my group is too small" as fear parks sheep in
   ALERT, which is a stationary state, so a scattered flock freezes instead of regrouping. Unease
   now drives rejoining only.
4. **Centroid attraction tapers when packed.** A constant pull to the middle makes a packed flock
   mill on the spot under pressure instead of leaving as a group. It fades below ~1.6 BL.
5. **Only non-RUN states get a flee lobe.** RUN already carries escape in its force sum; a second
   competing interest lobe made the two fight and the flock jitter in place.
6. **Cornered sheep stop.** A sheep under pressure with nowhere to go drops to ALERT and faces the
   threat rather than running on the spot against a fence.
7. **Spontaneous walk initiation scales as 1/group size**, per Azaïs et al, so a large flock is no
   more restless than a small one. Dividing by the neighbour count instead made big flocks frantic.

Two metrics were also redefined: splits are counted at 4 BL (relaxed grazing spacing exceeds the
original 2.5 BL threshold), and jitter excludes sheep that are deliberately turning, such as an
alert sheep facing the threat.

Measured time budget for 20 undisturbed sheep: about 69 % grazing, 30 % walking, the rest alert or
running.

Two further behaviours were added while raising the flock ceiling to 500, both from the research
rather than from performance work:

8. **Only closing motion applies pressure.** A pointer circling at a constant distance is read as
   a dog, and widens the flight zone, but does not press: pressure scales with the component of
   its velocity pointing at the sheep. This is why handlers work in arcs.
9. **Habituation.** A threat that hangs about without pressing becomes background over about
   forty seconds, shrinking the effective flight zone by up to 45 %, and that tolerance is lost
   within seconds the moment it presses. Without it, fear feeds arousal, arousal widens the zone
   and the zone feeds fear, so a pointer parked nearby escalates into permanent panic.

## 12. Camera

The paddock view is an orthographic camera tilted about 24 degrees off straight down. At zoom 1
it frames the whole paddock; above that it closes in and eases toward the flock's centroid, so a
herd being driven stays on screen, and panning is clamped so the view never leaves the fences. The
shadow frustum tracks the visible area rather than the whole field, which is what keeps shadows
sharp when zoomed in.

One thing follows from a moving camera and is easy to get wrong: the pointer's world position has
to be re-derived from its screen position every frame, not only when the mouse moves, or the sheep
react to the patch of grass the camera has since panned away from.

Nothing is drawn for the dog. The player's own cursor is the threat, and on a desktop overlay an
extra animal under the arrow is redundant; the flock's reaction is what communicates the pressure.

## 13. Shedding

Cutting a flock in two and keeping it apart is the hardest thing the model does, and it took three
attempts. It works now: sixteen of sixteen seeds cut cleanly and stay cut after one half is walked
off and the pointer leaves (`tools/behaviour.mjs`, probes `shed` and `shedDrive`; scenarios 10 and
11). What follows is why the first two attempts failed, because most of it was measurement error
rather than behaviour, and the same traps are easy to walk back into.

### What was actually wrong

**Cohesion aimed at the middle of everything.** Three separate forces pulled a sheep toward the
whole flock's centre: the rejoin steering, the steady flock pull, and `run.cohesionCentroidMix`,
which blends the global centroid into a running sheep's target. During a shed that centre sits
exactly where the pointer is standing, so all three drew both halves back through it. Disable one
and the others still close the gap, which is why single-parameter sweeps looked flat. The fix is
one idea applied in three places: **cohesion reaches only as far as the group a sheep is actually
in**. `Groups` now publishes a per-group centre (`groupX/groupY`) for cohesion and a centre of
everyone-but-my-group (`restX/restY`) for homesickness. While the flock is whole the two are the
same point and nothing changes; once it is cut they are not.

**Half a flock is a flock.** Homesickness is gated on absolute group size (`group.shedTolerance`,
raised to a quarter of the count for big flocks), not on the share of the flock a sheep can see. A
pair is frightened wherever it is; ten sheep out of twenty are not pining for the other ten. A
single separated sheep still crosses the paddock to rejoin, past the pointer if need be — scenario
9 asserts exactly that, and it is the reason the gate is size and not distance.

**The probes were measuring nothing.** Two of them, both discovered by instrumenting rather than
tuning:

- The shed probe approached at 4 BL/s. `run.speed` is 3.5, so the pointer never caught the flock —
  it herded them across the paddock for five seconds and then "held the gap" behind their backs.
  Every sheep was on the same side for the entire measurement. Approaching more slowly does not
  help and is not more realistic: a flock backs away from anything walking at it, however gently,
  so there is no approach speed that gets you inside from outside. A player gets in with a flick of
  the mouse, which is faster than a sheep, and that is what the probe does now. After the cut the
  pointer holds *the gap* — the midpoint of the two halves — which is where a handler stands.
- The drive probe held station three quarters of a flight zone behind the rearmost sheep. A pointer
  matching a stalled flock is a *stationary* threat, and a stationary threat carries only
  `zoneIdle` (3 BL), so the pressure was exactly zero — for forty-five seconds, on the seeds where
  the flock happened not to move on its own. Flock frozen, pointer frozen, nothing measured. The
  seeds that "drove well" were the ones that spontaneously stampeded. It now walks steadily
  forward, which regulates itself: dawdle and it closes on you, run and it falls behind. That a
  flock ignores a dog standing still 6 BL away is correct, and worth keeping in mind when the
  pointer is parked.

The drive probe also ran in the standard 40 BL paddock, where the flock hits the east fence a third
of the way through and spends the rest of the run pinned against it, which reads as a stampede
however gently it was pushed. It uses a 110 BL paddock now.

### The three forces, and what each is for

| force | target | when |
| --- | --- | --- |
| `group.flockPull` | centre of my own group | always, as a spring with slack |
| `group.rejoinWeight` | centre of everyone else | only when my group is too small to be a flock |
| `group.driftTogether` | centre of everyone else | always, weakly, while nothing is blocking the way |

The spring has slack because a flat pull strong enough to drive a flock with holds a calm one in a
huddle: it fades below `flockSpread * sqrt(groupSize)` and is scaled by fear, so sheep spread out
to graze and bunch when worried. That is the selfish-herd response arriving for free, and it is
what keeps the grazing flock's cohesion radius in the range scenario 1 asks for.

`driftTogether` is the answer to the flip side of shedding: if a cut holds, so does an accidental
one, and a flock barged through once an hour would end the day as clumps in the corners. It is a
deliberately feeble long-range pull, and its weakness is the mechanism, not a compromise — it only
wins in the middle of a group, where the spring above has gone slack, so a whole clump eases over
instead of shedding its own edge sheep. A shed therefore survives the seconds it takes to work
with, and heals if the flock is left in peace for a minute or two.

### The geometric blocking rule

A sheep with the threat between it and the others gives up on rejoining: a corridor test
(`flee.blockedAngleDeg`, `flee.blockedReach`) against `restX/restY`, which suppresses both
homesickness and the drift, and zeroes `run.cohesionCentroidMix`. It is cheap and it is correct,
but on its own it does almost nothing — disabling it entirely still leaves the shed probes passing.
It earns its place by holding the halves apart while the pointer is in the gap, which is when the
player is doing the work.

Two things that turned out not to matter, kept because they are right rather than because they
measure: the threat's obstacle footprint (`flee.obstacleRadius`, `flee.obstacleWeight`), which
makes a sheep path around where the pointer stands whatever it is feeling — setting its weight to
zero changes no probe; and the blocking rule above. Both address the earlier finding that the
pointer is a point of fear rather than a barrier, measured at forty-seven crossings of the dividing
line in a nineteen-second hold. That finding was real, but it was not what made shedding fail.

### The cost

`recover` — barge through the middle, then leave — is the one property that got worse: the flock
comes back to one group 85% of the time instead of always, and the seeds that fail end with the
halves twenty-plus body lengths apart, which is to say the barge shed them by accident. That is the
honest price of a cut that holds, and `driftTogether` buys most of it back. Everything else is at
or better than it was: driving is unchanged (50.6 BL in 45 s against 50.6), the grazing flock is
slightly looser and closer to the mark, and a circling pointer alarms it less.

## 14. Tuning panel

`src/tuning/panel.ts` is a framework-free panel shared by the desktop app's tuning window and the
web page. It builds itself from `src/sim/schema.ts`, which walks the config defaults and derives a
range for every numeric field, so a new parameter appears in the panel without being registered
anywhere. About thirty parameters carry an explicit range, label and note where the derived guess
would be poor or the meaning is not obvious.

Changes apply to the running flock through `Sim.applyConfig`, which pins the seed, count and world
so behaviour can be tuned without disturbing the flock. Parameters the running simulation cannot
pick up (the neighbour count and grid cell, the personality spread, the step size, spawn spacing)
are marked in the schema and respawn the flock instead; the panel labels them.

"Copy changes" puts only the difference from the defaults on the clipboard, as a patch that can be
pasted straight into `defaultConfig()`. In the desktop app the same difference is persisted to the
settings file, so a tuned flock survives a restart.

## 15. Performance and the flock ceiling

The maximum flock is 500. Getting there took one behavioural fix and several engineering ones,
all measured with `npm run bench` (software WebGL, so the absolute figures are pessimistic; the
comparisons are the point) and `tools/../scratchpad` profiling of the simulation by phase.

Simulation, per fixed step:

| Flock | Before | After | What changed |
|---|---|---|---|
| 20 | 111 µs | 91 µs | |
| 150 | 737 µs | 430 µs | |
| 300 | 1999 µs | 830 µs | |
| 500 | 2907 µs | 1287 µs | |

- **Metrics were quadratic**: every pair was compared for split components and overlap, costing
  3.9 ms per call at 500. Overlap now reads the contact lists, and splits run union-find over the
  spatial grid. 3906 µs to 461 µs.
- **The gather grid was too coarse.** At a 4 BL cell a packed flock puts over a hundred sheep in
  every 3×3 block. The cell is now 2 BL, and the neighbour search expands ring by ring until the
  k-th nearest is inside the radius the scanned rings actually guarantee. Stopping merely because
  k candidates exist returns the wrong neighbours, which silently changes who each sheep follows.

Rendering, per frame at 500 sheep: **411 ms to 40 ms**, with draw calls down from 2019 to 514.

- **One material, not two.** The model carries a vertex-colour mask, white for fleece and black
  for skin, and the shader resolves both colours from uniforms. One draw call per sheep, and each
  animal can still be tinted individually.
- **Blob shadows above 64 sheep.** A shadow map costs a second draw call per animal; instanced
  discs cost one for the whole flock.
- **Bone matrices are only recomputed when the pose changed.** Three.js re-uploads every skinned
  mesh's bone texture on every frame it draws; skipping the sheep that did not animate roughly
  halved the remaining cost.
- **Animation runs in round-robin slots** above 80 sheep, with anything moving or frightened still
  animating every frame, and the ground texture is a repeating tile rather than one texture the
  size of the paddock.

What is still true at 500: the frame is CPU-bound in three.js's skinning path, not in the
simulation (1.8 ms) and not in rasterisation. Comfortably smooth flocks are up to about 150.
Going beyond that properly means baked vertex-animation textures and a single instanced draw for
the whole flock, which is the documented next step in `docs/research/game-ai-techniques.md`.

## 12. Build order

| Milestone | Scope | Exit check |
|---|---|---|
| M1 core loop | SoA state, spatial hash, PBD, fixed-step worker, discs on a canvas | Scenario 1 jitter and overlap pass |
| M2 states | GRAZE/WALK/RUN with mimetic rates, following, leaders | Scenarios 1–2 |
| M3 pointer | pressure field, fear, contagion, ALERT, selfish herd, splits, isolation | Scenarios 3–9 |
| M4 steering polish | context steering, point of balance, fences, personalities, breed presets | all scenarios stable across 20 seeds |
| M5 sheep on screen | glTF sheep, gait blend, head look, alert sequence, shadows, juice | screenshots reviewed; 60-sheep CPU budget met |
| M6 tooling | Tweakpane, overlays, replay/scrub, metrics HUD | tuning session possible without code changes |
| M7 depth | REST cycle, lambs, ewe-with-lamb, preference fields, AI dog (collect/drive) | design review |
