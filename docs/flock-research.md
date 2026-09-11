# Sheep flock research — synthesis

This is the condensed, decision-oriented summary. The three detailed reports it draws on live in
`docs/research/`:

- `sheep-ethology.md` — how real sheep perceive, move and react; handling and sheepdog practice.
- `collective-motion-science.md` — the published models (Ginelli 2015, Gómez-Nava 2022, King 2012,
  Strömbom 2014, Pillot 2011, Toulet 2015, Azaïs 2018, Jadhav 2024) with equations and fitted values.
- `game-ai-techniques.md` — how shipped games implement herds, and the engineering stack that fits
  a three.js overlay (context steering, PBD separation, spatial hash, worker sim, quadruped animation).

**Sourcing caveat.** The sandbox proxy blocked most publishers, so many numbers come from search-engine
extracts quoting the papers rather than the PDFs. The science report tags every value as confirmed,
recalled or estimated. Recalled values should be checked against the papers before being quoted
externally; for tuning a game they are good enough as starting points.

---

## 1. The ten facts the simulation is built on

| # | Finding | Source | What it forces in the design |
|---|---|---|---|
| 1 | Sheep **do not align velocities** like birds or fish. Cohesion (attraction) and **following the animal in front** are the organising rules; Vicsek/boids alignment models are inconsistent with sheep data. | Gómez-Nava 2022; Ginelli 2015 | No strong alignment term. Follow-the-predecessor for walks; alignment only as a weak term while running. |
| 2 | Behaviour is **intermittent**: long stationary grazing, short walking episodes, rare fast **runs**. States are contagious (**allelomimesis**) with **super-linear** imitation: two moving neighbours are far more than twice as persuasive as one. | Ginelli 2015; Pillot 2011; Azaïs 2018 | Three-state machine with Poisson hazard rates depending on neighbours' states, evaluated over the visible neighbourhood. |
| 3 | Departures and stops are **all-or-none**. First follower after ~1 s; a group of 8 leaves in 5–10 s; departure rate = α·n_moving^β / n_stopped^γ (α≈0.2–0.3 s⁻¹, β≈0.6–1.2, γ≈0.6–0.7). An initiator nobody follows within a stimulus window gives up. | Pillot 2011; Toulet 2015; Azaïs 2018 | Mimetic start/stop rates plus a time-out for lone initiators. |
| 4 | Leadership is **temporary and rotates**: whoever moves first leads that episode, others form a line behind by steering to the predecessor's **position** (gap ~1–2 m), which makes speed matching emerge. | Gómez-Nava 2022 | No permanent leader. Boldness only biases who initiates. |
| 5 | Under threat sheep run **toward the flock centre**, not directly away from the dog (selfish herd). Response starts at ~70 m from a working dog; approach to centre is at constant speed; the pack plateaus at ~4 m mean distance to centroid for 46 sheep, ~1.2 m for a driven flock of 14. | King 2012; Jadhav 2024 | Flee vector = centroid attraction dominated, with modest direct repulsion. Cohesion weight rises with fear. |
| 6 | The proven agent model for "dog + sheep": repulsion from dog within r_s, attraction to the local centre of mass of n nearest, short-range repulsion at 1 body length, inertia 0.5, noise 0.3, weights ρ_a=2, c=1.05, ρ_s=1. Herding fails when n < N/2. Dog only needs to be 1.25–1.5× faster. | Strömbom 2014 | Baseline force weights and neighbour count; also the AI-dog **collect/drive** heuristic. |
| 7 | **Danger spreads visually** as a fractional-threshold contagion through unoccluded neighbours; the wave outruns any individual (~2× max speed); cascades are subcritical when calm (most spooks fizzle) and near-critical under risk; density, not sensitivity, encodes risk. | Rosenthal 2015; Sosna 2019; Poel 2022; Ginelli 2015 | Contagion over the Voronoi/k-nearest graph with per-sheep delay and a fraction threshold; branching ratio tuned by cursor distance. |
| 8 | The **flight zone** is contextual: 5.7–11.4 m from a walking human, ~70 m from a dog; larger for head-on, fast or unfamiliar approaches; zero for tame sheep. **Point of balance** at the shoulder: pressure behind it moves the animal forward, in front stops or turns it. Pressure must be **released** or sheep panic, split or break back. | Grandin; Hutson 1982; King 2012 | Per-sheep flight zone scaled by cursor speed, approach directness and arousal; point-of-balance rule; splits when pressed too deep. |
| 9 | **Perception**: ~300° field of view, ~70° rear blind cone, 30–40° binocular cone with poor depth perception. Alert sheep turn to face a threat before deciding. Alarm sequence: head-up freeze → stamp/snort → bunch → short run → stop as a group and **face the threat** → graze again. Recovery takes minutes. | Ethology report §1, §4 | Blind cone in perception; ALERT state with face-the-threat; staged, timed sequence; slow arousal decay. |
| 10 | **Speeds**: grazing drift ≤0.4 m/s, walk 1.1–1.3 m/s, driven flock 1.3 m/s, run 1–3 m/s, sprint ≤9–11 m/s for seconds. Grazing nearest-neighbour spacing ~5 m, ~1 body length when packed. Undisturbed 100-sheep herd re-packs every ~15 min. | Ginelli 2015; Jadhav 2024; Sibbald | Speed classes, stamina, spacing targets and the idle expansion/contraction cycle. |

## 2. Handling and sheepdog practice, as gameplay rules

- **Wide, curved approach** slips behind the flock without triggering flight; a straight, fast approach triggers flight earlier and in a less predictable direction. Reward the curve.
- **Balance point of the whole flock**, not individuals: the dog sits opposite the desired direction of travel, flanks side to side to steer, walks up to push, and **stops to release**.
- **Collect then drive** (Strömbom): if any sheep is further than r_a·N^(2/3) from the centre, fetch the straggler from behind it; otherwise push from r_a·√N behind the centre relative to the goal. This is also the right AI-dog rule and the basis for hints.
- **Too close splits the flock**; a sub-group breaks off at an angle, tail-enders break back past the dog. Recollecting them is the cost of bad herding.
- **Following through gaps**: the first sheep hesitates, once one is through the rest pour after it. Directional information flows **front to back** even when driven from behind.
- **Isolation is aversive**: a lone sheep bleats, stops grazing and seeks the flock, even past the dog. Groups under ~4 are visibly uneasy.
- **Environmental biases**: toward other sheep, toward light, uphill, around gentle curves; balk at shadows and ground changes; refuse dead ends and anything standing in the intended path.

## 3. What shipped games teach

- **Herdling**, **Come Bye**, **Sheep Dog Sim**: the two-regime rule "spread when calm, bunch when scared", per-animal temperament, and "circle wide and nudge gently; too close and the whole flock scatters" are what players describe as feeling right.
- **Flockers**: dense packs plus per-individual targeting is a UX failure. Act on the group.
- **Horizon Zero Dawn**: herds as a group agent owning intent, individuals executing; stragglers rejoin groups by request. Alarm broadcast by a designated role is a fallback for blind-side detection.
- **Planet Coaster**: believable crowds at scale by limiting animation blending and spreading work across frames.
- **Engineering consensus**: context steering instead of summed forces (no cancellation or oscillation), **position-based dynamics** disc constraints for non-overlap (ORCA jiggles at rest, force separation vibrates), topological k≈6 neighbours (Ballerini) for cohesion and contagion, metric radius only for contact, fixed-step deterministic sim in a Worker, per-sheep reaction delays as the single cheapest realism upgrade.

## 4. Where the literature is thin

- No millisecond-level sheep reaction latencies exist; ~1 s first-follower median from 1 Hz video is the best anchor. We tune 0.3–1.2 s.
- No published trot speed; 2–4 m/s is inferred.
- Real distances (70 m dog response) do not fit on a screen; the design works in **body lengths** and compresses the outer ranges (see `flock-design.md` §1).
- Ginelli's exact rate formulas and Gómez-Nava's model equations were recalled, not fetched. Treat their magnitudes as tuning starts.
