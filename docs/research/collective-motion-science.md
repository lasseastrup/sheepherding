# Sheep collective motion: the scientific literature, distilled for a herding-game simulation

## 0. How to read this document (access caveats)

The sandbox's egress proxy blocked every publisher and mirror (PNAS, Nature, Cell, PLOS, Royal Society, arXiv, bioRxiv, PMC/EuropePMC, HAL, Semantic Scholar, ResearchGate, GitHub raw). Everything below was assembled from (a) web-search result extracts that quote the papers directly, and (b) prior knowledge of the papers. Each number carries a tag:

- **[C]** = confirmed verbatim in a search extract of the paper (or of a paper that reproduces its table).
- **[R]** = recalled from the paper; structure is right, exact digits should be verified against the PDF before being quoted anywhere.
- **[E]** = engineering estimate / recommendation, not from a paper.

Units: metres, seconds, m/s unless stated. "BL" = body length (adult Merino ≈ 1.2 m nose-to-tail, ≈ 0.4 m wide).

---

## 1. Ginelli, Peruani, Pillot, Chaté, Theraulaz & Bon (2015) PNAS 112:12729 — "Intermittent collective dynamics emerge from conflicting imperatives in sheep herds"

### Experiment [C]
- N = 100 same-age Merino ewes (Merinos d'Arles), flat homogeneous 80 × 80 m fenced arena at Domaine du Merle (S. France), 5 independent 1-hour trials, video at 1 frame/s from a 7 m tower at one corner; every sheep tracked.
- Behavioural state classified from instantaneous speed v: **stationary** (v ≈ 0, grazing/standing), **walking** (0 < v ≤ 0.41 m/s) and **running** (v > 0.41 m/s). The speed histogram is trimodal; 0.41 m/s is the walking/running threshold used in the paper. [C]

### Empirical findings
- The herd alternates **slow dispersion phases** (grazing; the group spreads, mean per-capita area grows for minutes) with **fast, avalanche-like packing events**: one or a few peripheral sheep start running toward the group, neighbours are recruited, and within tens of seconds the whole herd is a tight pack. The dispersed area is then re-expanded by grazing. [C]
- Period of the cycle: roughly one packing event every ≈ 15 min for 100 ewes (Science News report of the paper). [C]
- The size (number of participants / area contraction) of packing events is broadly distributed "on all experimentally accessible scales" — a power-law-like distribution; a best power-law fit exponent of about −2.3(2) is quoted for one of the distributions. The authors call the state "quasi-critical". [C]
- Packing runs are initiated preferentially by individuals **on the outside** of the herd, who run toward the centre "tailed by their neighbours". [C]
- Running behaviour is **inhibited when neighbours become close** — the pack stops when the local distance to neighbours drops below a body-length scale. [C]
- The elongation of the herd increases during packing (runners converge from the periphery); during grazing the herd is roughly isotropic.

### Model (three-state allelomimetic self-propelled particles)
Each sheep i has position **r**_i, heading θ_i and state s_i ∈ {S (stationary), W (walking), R (running)}. Two neighbourhoods are used [C]:

- **Metric neighbours** (within a radius r₀ of ≈ 1 BL): "immediate surroundings", used for the slow grazing-phase interactions (S ↔ W).
- **Voronoi (topological) neighbours** — the first Voronoi shell, "the individuals that can be visually perceived without obstruction from interposing sheep". Its size is ≈ 6 on average independent of density, which is why it is used for the running/packing interactions: a sheep sees runners at any distance as long as no other sheep blocks the view.

State transition rates (all Poisson; per second). Structure is [C] (rates "considerably enhanced by moving neighbours", "allelomimetic parameters α and δ"); the exact algebra is [R]:

```
S -> W :  p_SW = (1/τ₁) · (1 + α · n_W)^δ          n_W = # walking metric neighbours
W -> S :  p_WS = (1/τ₀) · (1 + α · n_S)^δ          n_S = # stationary metric neighbours
S,W -> R: p_xR = (1/τ₂) · (1 + α · n_R)^δ  +  spontaneous term that grows with isolation
                                                    n_R = # running Voronoi neighbours
R -> S :  p_RS = (1/τ₃) · (1 + α · n_S,close)^δ    counts Voronoi neighbours already
                                                    stopped / closer than d_R (≈1 BL)
```
- The **spontaneous** trigger for running is a function of the distance to the Voronoi neighbours (an isolated, peripheral sheep is the most likely initiator) — this is what makes the herd "breathe": dispersion raises the initiation hazard. [C for the qualitative rule, R for functional form]
- α is the allelomimetic gain, δ ≥ 1 the non-linearity; the paper states that α and δ "both control the mean maximum group area needed for sheep to regroup" and that the *intensity* of allelomimesis sets the trade-off between grazing area and regrouping time. The fitted values give strongly super-linear imitation (a sheep with two running neighbours is far more than twice as likely to run as one with a single running neighbour). [C qualitatively; recalled magnitudes α ~ O(10), δ ~ 3–4 — verify]
- τ₁ ~ tens of seconds (grazing bouts), τ₂ ~ a few seconds (recruitment into a run) [R]. The paper explicitly notes that the limit τ₁ → 0 (everybody walking during grazing) gives homogeneous configurations inconsistent with data, i.e. the stop-and-go grazing is needed. [C]

Motion rules [R, structure consistent with the paper]:
```
S: v = 0; heading random-walks slowly (grazing).
W: v = v_W ≈ 0.15–0.3 m/s (grazing drift); heading = previous heading + noise,
   plus weak repulsion from metric neighbours closer than r₀ (keeps grazing spacing).
R: v = v_R ≈ 1.5 m/s (≈ 3–4 × v_W... the paper's running class is >0.41 m/s;
   observed running speeds are 1–3 m/s);
   heading relaxes toward  A·(alignment with running Voronoi neighbours)
                          + B·(attraction toward the Voronoi neighbours / local centre)
                          − C·(short-range repulsion below d_R)  + noise.
```
The essential point (stated in the paper) is that running sheep "combine alignment interactions with attraction/repulsion": a runner both copies the running neighbours' direction and is pulled toward them, so the pack converges.

### Implications for a simulation
1. A herd at rest is **not static**: implement a two-time-scale idle behaviour — slow walk/stop grazing with metric repulsion (spacing 2–5 m) and a rare, spontaneously triggered, contagious run-to-centre.
2. Contagion must be **super-linear in the number of already-running visible neighbours** and use a **visibility/topological neighbourhood** (first Voronoi shell or "k nearest unoccluded", k ≈ 6), not a metric radius — otherwise dispersed herds never re-pack.
3. Runs stop **locally** when neighbours are within ≈ 1 BL; you do not need a global "pack complete" test.
4. Speed classes to display: stationary 0, walking ≤ 0.4, running 1–3 m/s.

---

## 2. Gómez-Nava, Bon & Peruani (2022) Nature Physics 18:1494 — "Intermittent collective motion in sheep results from alternating the role of leader and follower" (+ Azaïs et al. 2018 PLoS ONE; "Collective motion strategies of sheep", Nat. Rev. Phys. 2023)

### Experiment [C]
- Small groups (N = 2, 3, 4) of Merinos d'Arles free in a large field (the same 80 × 80 m Merle pens used by Azaïs et al. 2018 for N = 2, 3, 4, 8 and 100). 
- Behaviour = long grazing phases (individuals essentially motionless, ≈ 0 m/s) interrupted by **collective motion episodes** in which "the group moves off, one individual after the other, before coming to a halt again a little further". Motion episodes are walks (~1 m/s class; see §7), lasting tens of seconds; grazing phases last minutes. [C for the description; durations R]

### Key findings [C]
- Each episode has a **temporal leader**: the sheep at the front. Followers form a **line**, each following the individual immediately in front of it. The inferred interaction network is "strongly hierarchical and directed": information about the leader's *position* propagates down the chain; velocity alignment is *not* the mechanism.
- Leadership is **random and rotates**: any group member is equally likely to lead the next episode (statistically indistinguishable from uniform). The authors frame this as a "democratic" alternation that pools information without permanent negotiation.
- "None of the existing flocking models, or extensions of them (Vicsek-type alignment models), is consistent with the observations", because (i) sheep are intermittent (start/stop), and (ii) the interaction is positional following, not orientation averaging.
- A generalised model for large groups (N ≈ 40) reproduces the intermittent, line-like dynamics; a parameter p₀ ≈ 0.8 is the probability that a follower attaches itself *behind* (rather than beside) its predecessor. [C from a third-party summary of the Extended Data; treat as R]

### Model (data-driven, "leader–follower positional relaxation") [R]
```
Leader (index 0):  moves at v₀ with a persistent heading (rotational noise D_θ);
                   starts an episode spontaneously (rate μ_dep) and stops
                   spontaneously (rate μ_stop).
Follower i (predecessor j = i−1 in the line):
   d_ij  = r_j − r_i ;  φ_ij = angle of d_ij
   θ̇_i   = (1/τ_θ) · sin(φ_ij − θ_i) + noise          (turn toward predecessor's POSITION)
   v_i    = v₀ · g(|d_ij|)   with g increasing in distance and → 0 when |d_ij| < d_min
                                                       (speed regulates gap to ≈1–2 m)
Start/stop:  followers switch to moving with a rate that grows with the number of
             group members already moving and decays with the number still grazing
             (Pillot/Toulet mimetic rule, §5) → all-or-none episodes.
```
"Positional information" means the follower only needs where its predecessor *is*, not where it *points*; the resulting line orientation and speed matching are emergent.

### Azaïs, Blanco, Bon, Fournier, Pillot & Gautrais (2018) PLoS ONE 13:e0206817 — "Traveling pulse emerges from coupled intermittent walks" [C]
- Same Merle data (N = 2, 3, 4, 8; also 100). Each sheep is either stopped (v = 0) or walking at a constant walking speed; the *decision* variables are the start and stop switching rates, which depend on the number of sheep **ahead/behind** and on their states.
- Fitted individual rates (per second, 95 % CI in brackets):
  - departure rate μ = α · n_M^β / n_S^γ with **α = 0.32 s⁻¹ [0.25; 0.41], β = 0.61 [0.44; 0.78], γ = 0.71 [0.53; 0.87]** (n_M = number of moving sheep, n_S = number stopped);
  - stop rate σ = α′ · n_S^β′ / n_M^γ′ with **α′ = 0.42 s⁻¹ [0.33; 0.54], β′ = 0.48 [0.31; 0.65], γ′ = 0.54 [0.36; 0.71]**;
  - spontaneous (uninfluenced) switching rate scales as μ_i = μ_i*/N with **μ_i* = 0.08 s⁻¹**, i.e. the *group* initiates at a size-independent total rate of ~1 per 12 s of "opportunity", but any given individual initiates less often in larger groups.
- The macroscopic limit is a travelling density pulse (sech² profile) moving at constant speed even though every individual is either stopped or walking — the group as a whole "flows" at a fraction of walking speed.

### Implications for a simulation
- Spontaneous group movement should be a **line following a random temporary leader**, followers steering to their predecessor's position with a ~1–2 m gap, not a Vicsek/boids alignment blob.
- Departures and stops should be **all-or-none with mimetic hazard rates** (§5 gives the formulas), producing an intermittent "graze — walk 10–30 m — graze" rhythm.
- Leader identity is re-drawn each episode.

---

## 3. King, Wilson, Wilshin, Lowe, Haddadi, Hailes & Morton (2012) Current Biology 22:R561 — "Selfish-herd behaviour of sheep under threat"

### Experiment [C]
- 46 sheep + 1 trained Australian Kelpie working dog, all wearing GPS backpacks logged at **1 Hz**; South Australian farm; three herding trials on an initially resting/grazing, dispersed flock.
- Metric: distance of each sheep from the flock centroid; mean over sheep = "flock cohesion".

### Findings [C]
- Sheep began to move (**response distance**) when the dog was **≈ 70 m** from the flock.
- Each sheep moved toward the **flock centroid**; those furthest from the centroid moved furthest. Cohesion collapsed from the dispersed state to a plateau of **≈ 4 m mean distance to centroid** (for 46 sheep this is a pack of radius ~5–6 m, ~0.5 sheep/m²).
- Time to collapse was **proportional to the initial dispersion**, i.e. sheep approach the centre at a roughly constant speed across trials.
- Model comparison: a model in which every sheep is attracted to the **centroid** once the dog is within range fit the trajectories better than (i) fleeing in a straight line from the dog, (ii) scattering, (iii) moving toward the nearest neighbour, and even (iv) centroid attraction gated on the dog's distance to the *nearest* sheep. The authors conclude sheep integrate the positions of **multiple neighbours** to estimate the centre (a precise centroid is implausible; a local-crowded-horizon-style estimate suffices).
- The dog's GPS track shows the classic **collect/drive** weaving (this dataset is the empirical anchor of Strömbom et al. 2014).

### Model as used in the paper [R]
```
if dist(dog, sheep_i) < R_resp (≈70 m):  v_i = v · (C − r_i)/|C − r_i|  + noise,  C = flock centroid
else:                                     v_i ≈ 0 (grazing)
```

### Implications for a simulation
- Predator response is **centre-seeking, not directly predator-fleeing** — the flee vector is a by-product of the centroid being on the far side. Add only a modest direct repulsion (Strömbom's ρ_s) to keep the pack drifting away from the dog.
- Use a **large detection radius** (≈ 65–70 m in real units; scale to your world) and a **constant approach speed** to the centre.
- Equilibrium pack: mean distance to centroid ≈ 4 m for ~50 sheep → inter-sheep spacing ≈ 1 BL.

---

## 4. Strömbom, Mann, Wilson, Hailes, Morton, Sumpter & King (2014) J. R. Soc. Interface 11:20140719 — "Solving the shepherding problem" (+ follow-ups)

### Sheep-agent model (discrete time, unit step) [C for rules and most values; ρ_a, ρ_s, δ, δ_s, p, L confirmed via the parameter table reproduced in Nguyen et al. 2020 arXiv:2008.12708 and via recall]
Agent i at **A**_i, current heading **Ĥ**_i, shepherd at **S**, N agents, n = number of nearest neighbours attended to.
```
if |A_i − S| > r_s:                       # shepherd too far: graze
    with probability p: take a step of length δ in a random direction; else stay
else:                                     # shepherd within sensing range
    R̂_s = (A_i − S)/|A_i − S|                                       # repulsion from shepherd
    Ĉ   = (LCM_n(i) − A_i)/|LCM_n(i) − A_i|                         # attraction to local centre of
                                                                    #   mass of n nearest neighbours
    R̂_a = normalise( Σ_{j: |A_i−A_j|<r_a} (A_i − A_j)/|A_i − A_j| ) # short-range repulsion
    ε̂   = random unit vector
    H′  = h·Ĥ_i + c·Ĉ + ρ_a·R̂_a + ρ_s·R̂_s + e·ε̂
    Ĥ_i ← H′/|H′| ;  A_i ← A_i + δ·Ĥ_i
```
**Parameter table (Table 1 of the paper)**

| symbol | meaning | value |
|---|---|---|
| N | number of agents | varied (up to >100) |
| n | nearest neighbours attracted to | varied; success needs n ≳ N/2 |
| r_s | shepherd detection distance | **65** [C] |
| r_a | agent–agent repulsion distance | **2** [C] |
| ρ_a | strength of agent repulsion | **2** [C] |
| c | strength of LCM attraction | **1.05** [C] |
| ρ_s | strength of shepherd repulsion | **1** [C] |
| h | inertia (weight of previous heading) | **0.5** [C] |
| e | noise weight | **0.3** [C] |
| δ | agent step / speed | **1** [C] |
| δ_s | shepherd step / speed | **1.5** [R] |
| p | grazing step probability per tick when undisturbed | **0.05** [R] |
| L | side of the square field | **150** [C] |

Real-world scale: the authors chose r_a = 2 ≈ 1 sheep body length and r_s = 65 to match the King et al. ≈ 70 m response distance, so 1 unit ≈ 1 m and one tick ≈ 1 s at walking pace (δ = 1 → ~1 m/s).

### Shepherd heuristic [C]
```
GCM  = mean of all A_i ;  A_f = agent furthest from GCM
f(N) = r_a · N^(2/3)                       # "flock is cohesive" radius
if |A_f − GCM| > f(N):   COLLECT: target  P_c = A_f  + r_a · (A_f − GCM)/|A_f − GCM|
else:                    DRIVE:   target  P_d = GCM + r_a·√N · (GCM − Goal)/|GCM − Goal|
shepherd moves toward target at speed δ_s (with noise e);
if any |A_i − S| < 3·r_a the shepherd does not advance (avoids splitting the flock)  [R]
task complete when |GCM − Goal| < 10                                                 [C]
```
- Results: a single shepherd can herd >100 agents; the method is "not guaranteed to succeed when n < N/2" (agents attending to too few neighbours fragment into sub-flocks that the collect rule cannot re-merge) [C]. Reported example: 201 agents with n = 20 herded in 56/100 runs when the shepherd acted on its 20 nearest neighbours [C]. Example trajectory: shepherd starts at (15, 170), first target the furthest agent at (245, 140), then alternates collect/drive to the origin [C].
- The simulated shepherd's path reproduces the side-to-side weaving of the real Kelpie GPS track (King data).

### Follow-ups that extend the sheep model
- **Lien, Bayazit, Sowell, Rodriguez & Amato (2004) ICRA "Shepherding behaviors"** [C]: flock = Reynolds boids (separation, cohesion, alignment) plus an *escape* force from shepherds; shepherd uses roadmaps and "steering points" behind the flock, approaching from the side so as not to split it; behaviours herding, covering, patrolling, collecting; later multi-shepherd formations.
- **Long, Sammut, Sgarioto, Garratt & Abbass (2020) IEEE TETCI 4:523 "A comprehensive review of shepherding"** [C]: most swarm-robotics work adopts Strömbom's agent model verbatim; extensions add obstacles, heterogeneous agents, learned shepherds.
- **Nguyen et al. (2020) arXiv:2008.12708** [C]: reproduces the Strömbom table (R_s = 65, R_a = 2, c = 1.05, h = 0.5, e = 0.3, W_ππ = 2, W_πη = 1, S_π = 1, L = 150); finds that noise in the *shepherd's influence* (sheep not reacting) hurts far more than sensor noise.
- **Hu et al.** (adaptive protocols / artificial potential fields) and many robotics papers re-express the same forces as weighted boid terms K₁ separation + K₂ alignment + K₃ attraction + K₄ dog repulsion [C].
- **Strömbom, Hoitt & Cloud (2026) ANTS "Re-Solving the Shepherding Problem: Lead When Possible, Herd When Necessary"** [C]: sheep-like agents are either *evaders* (Strömbom rules) or *followers* of the transporter, mixed in proportion p; the transporter switches to *leading* when it detects followers.
- **Jadhav, Pasqua, Zanon, Roy, Tredan, Bon & Theraulaz (2024) Communications Biology 7:1543 "Collective responses of flocking sheep to a herding dog (border collie)"** [C] — the most relevant modern dataset:
  - 14 sheep + border collie + shepherd, UWB tags, several dozen driving trips.
  - During drives: **cohesion 1.21 ± 0.34 m** (mean distance to barycentre ≈ 1 BL), **polarisation 0.85 ± 0.17**, **barycentre speed 1.3 m/s**, **dog 1.5–2 m/s**.
  - Flock shape "breathes": elongates then contracts along orthogonal axes.
  - **Directional information propagates front → back** even though the dog pushes from behind: front sheep have the largest influence on group heading; sheep change relative positions less when chased; this hierarchy disappears without the dog.
  - Model: sheep repelled by every sheep closer than d_Rep (equal intensity), attracted/aligned to the group, repelled by the dog; dog moves straight at **v_D = 1.5 m/s**, slows to 0.0075·v_D (≈ 0.05 m/s) when a sheep is closer than l_a; dog switches driving vs collecting according to whether the farthest sheep is within l_sep of the barycentre (a Strömbom-type rule). No built-in hierarchy — the front-to-back information flow **emerges** from constant rear pressure.

### Implications for a simulation
- Strömbom's rules are the proven baseline for "mouse = dog": repulsion within r_s, LCM attraction to ~n nearest, 1-BL separation, inertia 0.5, noise 0.3, sheep 1 unit/tick and dog 1.5.
- Use **n ≈ N/2 or more** (or a Voronoi/visibility neighbourhood) to avoid unwanted fragmentation; use *small* n (5–7) if you want the flock to split realistically under bad herding.
- The drive point (behind the GCM, r_a√N out) and the collect point (behind the furthest sheep) are exactly what a good player does — useful for an AI dog or hints.
- Match Jadhav's driven-flock statistics as acceptance tests: spacing ≈ 1.2 m, polarisation ≈ 0.85, speed ≈ 1.3 m/s, dog ≈ 1.5–2 m/s.

---

## 5. Departure/stop following: Pillot et al. (2011) PLoS ONE 6:e14487 and Toulet, Gautrais, Bon & Peruani (2015) PLoS ONE 10:e0140188

### Pillot, Gautrais, Arrufat, Couzin, Bon & Deneubourg (2011) "Scalable rules for coherent group motion in a gregarious vertebrate" [C]
- Groups of 2, 4, 6, 8 Merino sheep = 1 **trained** initiator + 1, 3, 5, 7 naïve ewes. The trained sheep was conditioned (vibrating collar → walks to a raised panel dispensing corn) so its departure could be triggered at will; the naïve sheep's following order and latencies were recorded.
- Latency of the **first follower**: median ≈ **1 s** in groups of 8; latencies shrink as group size grows (more potential first followers), later followers depart faster still.
- Individual rate of departing increases with the number already departed (**positive mimetic feedback**) and, for a given number departed, *decreases* with group size (**inhibition by the still-stationary**). It is *not* a quorum (no threshold).
- Three candidate models were fitted; only **model 3** (attraction to departed + inhibition by non-departed) reproduces the rate distribution:
```
μ(n_M, n_S) = α · n_M^β / n_S^γ          [rate per stationary individual, s⁻¹]
α = 0.19 s⁻¹,  β = 1.16,  γ = 0.60   (r² = 0.94)
```
  n_M = number already moving (incl. initiator), n_S = number still stopped. Expected waiting time for the next departure among n_S stopped sheep = 1 / (n_S · μ).
- The "double mimetic" rule is **scalable**: the same α, β, γ work for all tested group sizes, and predict that a single initiator can pull along arbitrarily large groups, but more slowly the larger the group.

### Toulet, Gautrais, Bon & Peruani (2015) "Imitation combined with a characteristic stimulus duration results in robust collective decision-making" [C]
- Groups N = 8, 16, 32 (one trained initiator, N−1 naïve), 50 × 50 m arenas, trained sheep walks to a 0.5 × 0.5 m yellow panel at the arena periphery on collar vibration; both the **departure** and the subsequent **stop** at the panel act as perturbations. 24 usable trials for N = 32.
- Outcome is **all-or-none**: either every naïve sheep follows (collective motion) or none does; likewise all stop together. The probability that the group follows *decreases with group size*.
- Mechanism: mimetic start/stop rates (Pillot form) **plus a characteristic stimulus duration** — the initiator is only a stimulus while it is walking away (a few tens of seconds, set by distance-to-panel ÷ walking speed). If the mimetic cascade does not "ignite" within that window (more likely in large groups where each stationary sheep is inhibited by many others), nobody follows. Group splitting is possible in the model but the most probable outcome is consensus.
- The Azaïs et al. (2018) re-fit on the pooled small-group data gives the rates quoted in §2 (α = 0.32 s⁻¹, β = 0.61, γ = 0.71 for departures; α′ = 0.42 s⁻¹, β′ = 0.48, γ′ = 0.54 for stops; spontaneous μ_i* = 0.08 s⁻¹ divided by N).

### Implications for a simulation
- Implement start/stop as **hazard rates** evaluated per stationary (resp. moving) sheep each tick: `P(switch in dt) = 1 − exp(−μ·dt)` with μ = α·n_M^β / n_S^γ. With α ≈ 0.2–0.3, β ≈ 0.6–1.2, γ ≈ 0.6–0.7 you get ~1 s first-follower latencies and complete departures of 8 sheep in ~5–10 s, 30 sheep in ~20–40 s.
- Add a **stimulus time-out**: a spontaneous mover that has not recruited anyone within T_stim ≈ 10–30 s stops and returns (this produces the realistic "one sheep wanders off, changes its mind" behaviour).
- Same machinery drives stopping, and a *dog-induced* run can be treated as an initiator with a very high effective α (fear) — see §9.

---

## 6. Alarm / startle propagation in groups

### Rosenthal, Twomey, Hartnett, Wu & Couzin (2015) PNAS 112:4690 — golden shiner startle cascades [C]
- ~1000 juvenile golden shiners filmed in schools of **150 ± 4** fish in a 2.1 × 1.2 m tank; **138 spontaneous** startle (fast-start) cascades analysed; initiator and first responder identified unambiguously for each.
- Fish **do not distinguish** threat-induced from spontaneous startles — a startle is a startle, so false alarms propagate by the same rule.
- Interaction network reconstructed by **ray-casting each fish's visual field** (occlusion matters). The probability that a given fish is the *first responder* is best predicted by **log metric distance** and **ranked angular area** of the initiator on its retina (bigger, closer, unoccluded = more influence). Metric distance alone is a poor predictor.
- Contagion is **complex / fractional-threshold**: a fish's startle probability depends on the *fraction* of its (visually weighted) neighbours that have startled, not the absolute number. Individuals with few but strongly connected neighbours are both the most influential and the most susceptible; the **local weighted clustering coefficient** of the initiator's neighbourhood predicts cascade size.
- Cascades span a broad size distribution (most die after 1–3 fish, a few sweep the whole school); the wave of evasion travels at **≈ 2 × the maximum individual swim speed**; successive frames 167 ms apart already show the front moving several body lengths.

### Sosna et al. (2019) PNAS "Individual and collective encoding of risk in animal groups" [C]
- Under perceived risk (alarm substance) shiners **reduce nearest-neighbour distance**; that spatial change — not any change in individual responsiveness — accounts for the larger cascades. Risk is "encoded in the physical structure of the group".

### Poel et al. (2022) Science Advances "Subcritical escape waves in schooling fish" [C]
- Startle cascades are **subcritical**: average branching ratio b < 1 (each startle triggers on average fewer than one new startle), moving closer to b = 1 when risk is perceived. Sensitivity–robustness trade-off.

### Herbert-Read et al. (2015) R. Soc. Open Sci. 2:140355 "Initiation and spread of escape waves" [C]
- Pacific blue-eyes (2–3 cm), simulated attack: a small percentage of fish that detect the danger change direction and speed; this creates a **dense band** that propagates through the school and turns the rest; in most trials the wave crossed the entire group. In experiments and model the wave travelled at **about the speed of an individual fish**; with a real predator, waves outrun the predator.

### "Trafalgar effect" (Treherne & Foster 1981) [C]
- Group transmission of predator avoidance in the marine insect *Halobates*: the alarm wave propagates through the group **faster than the predator approaches**, so individuals far from the threat react before they could have detected it. This is the general principle behind all of the above (and behind the outer-sheep-triggers-packing observation of Ginelli).

### Sheep-specific alarm propagation
- Jadhav et al. 2024: when a dog approaches, "the behavioural reaction to the perceived threat **propagates within the flock**"; under chase, directional information flows **front → back**, and "the cascade size depends strongly on the movement direction of the initially startled individual". [C]
- Ginelli et al. 2015: packing runs are literally alarm-like cascades started at the periphery and spread through the visual (Voronoi) neighbourhood with super-linear imitation; stopping is also contagious. [C]
- No published sheep study gives millisecond latencies; from 1 Hz video the recruitment delay between neighbouring sheep is of order **~1 s** (Pillot's first-follower median). [C/E]

### Implications for a simulation
- Fright should spread as a **visual contagion on the Voronoi/visibility graph**: `P(startle | k of m visible neighbours startled)` increasing steeply with the fraction k/m, weighted by 1/log-distance or angular size, with a per-sheep reaction delay of ~0.5–1.5 s.
- Direction matters: a neighbour running *toward* me is a strong stimulus; one running *away* still recruits (I follow it). Ginelli's alignment+attraction to runners captures both.
- Keep the cascade **subcritical** when the dog is far (b ≈ 0.7–0.9 so most startles fizzle) and supercritical when the dog is close (b > 1) — this gives believable "one sheep spooks, the flock ripples, settles" versus full stampede.
- The wave should move faster than any sheep (≈ 2 × running speed across the group), i.e. propagate through the flock in ~2–4 s for a 30 m flock.

---

## 7. Sheep-specific spatial and kinematic numbers

| quantity | value | source |
|---|---|---|
| Body length / width | ≈ 1.2 m / 0.4 m | Jadhav 2024 (cohesion "≈ typical body length") [C] |
| Nearest-neighbour distance, undisturbed grazing, same patch | **4.9 m** (mean); 9.6 m on heather; 13.4 m when on different patches | Sibbald et al. (hill sheep) [C] |
| Grazing area per sheep | **15–67 m²** depending on breed | Arnold-type flock studies [C] |
| NND vs group size / enclosure | NND decreases with group size; increases with space allowance; bold > shy groups | [C] |
| Mean distance to centroid, dog-packed flock (46 sheep) | **≈ 4 m** | King 2012 [C] |
| Mean distance to barycentre, driven flock (14 sheep) | **1.21 ± 0.34 m** | Jadhav 2024 [C] |
| Polarisation while driven | **0.85 ± 0.17** | Jadhav 2024 [C] |
| Speed: grazing | 0 (stationary bouts) | Ginelli 2015, Azaïs 2018 [C] |
| Speed: grazing walk / slow walk | 0 < v ≤ **0.41 m/s** | Ginelli 2015 class boundary [C] |
| Speed: steady walking (treadmill/gait) | **1.1–1.3 m/s** | gait studies [C] |
| Speed: driven flock barycentre | **1.3 m/s** | Jadhav 2024 [C] |
| Speed: running/packing | > 0.41 m/s, typically 1–3 m/s | Ginelli 2015 [C/R] |
| Speed: sprint (max) | ≈ 9–11 m/s (20–25 mph) for short bursts | popular sources; treat as upper bound [C, low quality] |
| Border collie working speed | **1.5–2 m/s** mean while driving | Jadhav 2024 [C] |
| Flight/response distance to a working dog | **≈ 70 m** (Kelpie, 46 sheep) | King 2012 [C] |
| Drive-initiation distance to drone + dog bark / siren | **64 m / 36 m** | sky-shepherding, Sci. Rep. 2021 [C] |
| Flight distance from a walking human, flock in laneway | **5.7 m** (2 m lane), **11.4 m** (4 m lane); singles flee earlier than flocks; not affected by flock size/density/approach speed | Hutson 1982 [C] |
| Packing cycle period (100 ewes, 80 × 80 m) | ≈ **15 min** | Ginelli 2015 [C] |
| First-follower latency | median ≈ **1 s** (groups of 8) | Pillot 2011 [C] |
| Small-group departure/stop rates | α = 0.32 s⁻¹, α′ = 0.42 s⁻¹ etc. (§2) | Azaïs 2018 [C] |
| Group shape | elongated along the motion axis when moving (line in small groups; "breathing" ellipse when driven); roughly isotropic when grazing; elongation E = length/width used as an observable | Gómez-Nava 2022, Jadhav 2024 [C] |
| Velocity correlations | long-range correlations spanning the whole flock in dense driven flocks; edge fluctuations propagate as waves | de Marcken & Sarfati 2020 arXiv:2002.09467 [C] |

---

## 8. Classic models and the alignment question

- **Reynolds (1987) boids** [C]: three steering behaviours — *separation* (avoid crowding local flockmates), *alignment* (steer toward average heading of local flockmates), *cohesion* (steer toward average position of local flockmates) — combined by weighted, prioritised acceleration allocation. Neighbourhood = distance + field of view.
- **Vicsek et al. (1995)** [C]: constant speed v; heading update `θ_i(t+Δt) = ⟨θ_j⟩_{|r_j−r_i|<r} + Δθ`, Δθ uniform in [−η/2, η/2]. Three parameters (noise η, density ρ = N/L², speed v); an order–disorder transition in the polarisation. Pure alignment, no attraction — cannot hold a group together without periodic boundaries.
- **Couzin, Krause, James, Ruxton & Franks (2002) J. theor. Biol. 218:1 "Collective memory and spatial sorting"** [C]: zones of repulsion (r < r_r), orientation (r_r < r < r_o), attraction (r_o < r < r_a). Repulsion has priority; otherwise desired direction = normalised sum of orientation and attraction terms. Standard parameters: N = 100, r_r = 1 BL, r_a = 15 BL, r_o varied (≈ 1–15), field of perception α = 270°, max turning rate 40°/s, speed 3 BL/s, Δt = 0.1 s. Varying r_o yields swarm → torus (milling) → dynamic parallel → highly parallel groups, with hysteresis ("collective memory").
- **What sheep data say about alignment** [C]:
  - Gómez-Nava et al. 2022 tested Vicsek-type and extended alignment models and found **none consistent** with sheep; the effective interaction is **attraction to the position of the sheep in front** (hierarchical following), with velocity matching *emerging* from gap regulation. The 2023 Nature Reviews Physics piece on the topic states plainly that "real flocks are not continuously on the move" and that intermittency and following, not alignment, are the organising principles.
  - Ginelli et al. 2015 did include an alignment term, but **only for running sheep and combined with attraction/repulsion** toward running Voronoi neighbours; grazing/walking sheep do not align.
  - King et al. 2012 found centroid attraction beat nearest-neighbour following under threat; Jadhav et al. 2024 fit a model with attraction + alignment + dog repulsion and found the observed front-to-back hierarchy emerges from the dog's pressure without any explicit leader rule.
  - Practical reading: **cohesion (attraction) and following are primary; alignment is at most a weak term used while running, and mostly redundant once following-the-one-in-front is implemented.** Boids-style strong alignment produces bird-like coordinated turning that sheep visibly do not show — real driven flocks lag, bunch, and steer from the front.

---

## 9. Recommended hybrid model for a game

Goal: a flock of 20–150 sheep in a field of ~100–200 m that (i) grazes and drifts realistically, (ii) spontaneously walks off in lines and re-packs in avalanches, (iii) reacts to the mouse "dog" with King/Strömbom selfish-herd dynamics, (iv) propagates fear visually, and (v) can be steered with the collect/drive geometry. Work in metres and seconds; run the behaviour at 5–10 Hz and interpolate rendering.

### 9.1 Per-sheep state
```
state ∈ {GRAZE, WALK, RUN}         # Ginelli three-state
pos, vel, heading θ
alarm ∈ [0,1]                       # decays with τ_alarm ≈ 10–20 s
leader_ref                          # sheep followed during a WALK episode (or null)
reaction_timer                      # 0.5–1.5 s latency before acting on a stimulus
```
Neighbourhoods (recompute every 0.2–0.5 s):
- `metric(i)`: sheep within r₀ = 2 m (repulsion) and within r₁ = 6 m (grazing companions).
- `visible(i)`: first Voronoi shell (Delaunay neighbours) or, cheaper, the k = 6–7 nearest sheep not occluded within a 300° field of view. Used for all contagion.
- `LCM_n(i)`: centre of mass of the n nearest (n = max(6, ~N/2) for a cohesive flock; n = 5–7 if you want splitting to be possible).

### 9.2 Transition hazards (evaluate `P = 1 − exp(−rate·dt)` each tick)
```
n_W, n_R, n_S  = # visible neighbours walking / running / stationary
n_M            = n_W + n_R

GRAZE → WALK :  rate = μ0/N_local            (spontaneous, μ0 ≈ 0.08 s⁻¹, N_local = |visible|+1)
                     + α·n_M^β / max(1,n_S)^γ  (mimetic; α≈0.3, β≈0.6–1.0, γ≈0.7)
WALK  → GRAZE:  rate = α′·n_S^β′ / max(1,n_M)^γ′ (α′≈0.4, β′≈0.5, γ′≈0.5)
                     + 1/T_stim if nobody followed me within T_stim ≈ 15 s (Toulet time-out)
GRAZE/WALK → RUN: rate = (1/τ_R)·(1 + a·n_R)^d        (a≈2–3, d≈2–3: super-linear imitation)
                       + k_iso · max(0, d_nn − d_iso)  (isolation trigger; d_nn = nearest-neighbour
                                                        distance, d_iso ≈ 8–10 m, k_iso ≈ 0.002 s⁻¹/m)
                       + k_dog · alarm                 (dog-induced; k_dog ≈ 2 s⁻¹ → near-instant)
RUN → GRAZE  :  rate = (1/τ_stop)·(1 + a·n_close)^d    (n_close = visible neighbours within 1.5 m
                                                        that are not running; τ_stop ≈ 3 s)
                and force-stop if alarm < 0.1 and all visible neighbours within 2 m
```
Apply every state change through `reaction_timer` (uniform 0.5–1.5 s) so cascades ripple instead of firing synchronously.

### 9.3 Motion per state
```
GRAZE: speed 0; every 5–20 s take a 0.5–2 m step at 0.3 m/s in a heading = previous heading
       + N(0, 30°), plus repulsion from metric(i) closer than 2 m (Ginelli "walking" class).
WALK : speed 1.0–1.3 m/s.  If I have a leader_ref (the visible sheep that started moving
       nearest in front of me, chosen at departure with probability p₀≈0.8 for "behind",
       else beside): steer toward leader_ref.pos − 1.5 m·(its heading) (Gómez-Nava positional
       following); speed = clamp(0.8·|gap|, 0, 1.3).  If I am the initiator: persistent random
       walk (heading noise σ_θ ≈ 15°/√s), stop when rate says so.
RUN  : speed 2.5–3.5 m/s (Ginelli running; ≥ 2 × dog speed for short bursts, but stamina
       decays to 2 m/s after ~20 s).
       desired = normalise( c·Ĉ + ρ_a·R̂_a + ρ_s·R̂_s + w_al·Â + e·ε̂ )
         Ĉ   = unit vector to LCM_n(i)                     (King centroid attraction, c = 1.05)
         R̂_a = summed unit repulsion from sheep < r_a = 2 m (ρ_a = 2)
         R̂_s = unit vector away from dog if dist < r_s      (ρ_s = 1; r_s = 65 m)
         Â   = mean heading of RUNNING visible neighbours    (w_al ≈ 0.3–0.5; small — sheep barely align)
         e   = 0.3
       heading ← normalise(h·heading + desired), h = 0.5; turn-rate cap ≈ 180°/s.
```
This is Strömbom's update with Ginelli's state gating and a light alignment term; in GRAZE/WALK the dog terms are absent because the dog either has not been noticed (alarm low) or the sheep is already transitioning to RUN.

### 9.4 The dog (mouse pointer) and fear
```
for each sheep:  d = dist(pos, dog)
  stimulus = clamp((r_s − d)/(r_s − 5), 0, 1)^2        # 0 at 65 m, 1 at 5 m
           × (1 + 0.5·[dog moving toward me]) × (1 + 0.5·[dog speed > 1.5 m/s])
  alarm  ← max(alarm, stimulus)                          # direct perception
  alarm  ← max(alarm, 0.9·max(alarm of visible neighbours that are RUNNING and started
                        within last 2 s) × w_vis)         # visual contagion; w_vis from
                                                          # 1/log-distance or angular size
  alarm  ← alarm·exp(−dt/τ_alarm)
```
- Use a **fractional threshold** for the contagion path: only inherit alarm if ≥ 30–50 % of visible neighbours (weighted by proximity) are running, unless alarm is already > 0.5. This keeps cascades subcritical when the dog is far and lets one spooked sheep "ripple" without a stampede.
- A sheep with alarm > 0.3 transitions to RUN (via k_dog); running sheep obey the Strömbom forces so the flock **collapses to the centroid (≈ 4 m mean radius for 50 sheep)** and then drifts away from the dog as a pack at 1.3–2 m/s (WALK-speed run once alarm < 0.5).
- After the dog stops pressing (alarm decays over 10–20 s) the pack relaxes: RUN → GRAZE via the close-neighbour rule, then grazing repulsion slowly re-expands spacing to 3–5 m over minutes — exactly Ginelli's cycle.

### 9.5 Emergent things to check (acceptance tests)
1. Undisturbed 100 sheep: spacing grows from ~1.5 m to ~4–5 m over ~10 min; occasional spontaneous re-packing avalanches; per-capita area 15–60 m².
2. Undisturbed small groups (3–8): intermittent "line walks" of 10–30 m every few minutes; random leader; first follower within ~1 s, whole group within ~5–10 s; all-or-none.
3. Dog approach: first movement at ~65–70 m; collapse time ∝ initial dispersion; plateau mean-distance-to-centroid ≈ 4 m (N ≈ 50) or ≈ 1.2 m (N ≈ 14, driven).
4. Driving: polarisation ≈ 0.85, speed ≈ 1.3 m/s, front sheep steer; flock elongates and "breathes".
5. Splitting only when the player presses into the flock (violates 3·r_a) or when n is small.
6. A dog approaching *fast and directly* should get a bigger, faster cascade than a slow, oblique approach (Jadhav: cascade size depends on movement direction).

### 9.6 Tuning knobs mapped to feel
- Sheep skittishness: r_s (50–80 m), alarm gain, contagion threshold.
- Flock "stickiness": c (1.0–1.2) and n; lower c/n for a scatter-prone flock.
- Nervousness of the idle herd: a, d, τ_R, d_iso.
- Wanderlust of the idle herd: μ0 and T_stim.
- How bird-like the turning looks: w_al — keep it low; real sheep lag and bunch.

---

## Sources

Primary papers (full text was behind the proxy; content reconstructed from publisher/repository search extracts and secondary summaries):

- Ginelli F, Peruani F, Pillot M-H, Chaté H, Theraulaz G, Bon R (2015) Intermittent collective dynamics emerge from conflicting imperatives in sheep herds. PNAS 112(41):12729–12734. https://www.pnas.org/doi/10.1073/pnas.1503749112 ; PMC: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4639514/ ; press summary: https://www.sciencenews.org/article/math-describes-sheep-herd-fluctuations
- Gómez-Nava L, Bon R, Peruani F (2022) Intermittent collective motion in sheep results from alternating the role of leader and follower. Nature Physics 18:1494–1501. https://www.nature.com/articles/s41567-022-01769-8 ; HAL: https://cnrs.hal.science/hal-04103925/ ; commentary "Sheep lead the way": https://www.nature.com/articles/s41567-022-01744-3 ; press: https://phys.org/news/2022-11-physics-sheep-flocks-alternate-leader.html
- Collective motion strategies of sheep (2023) Nature Reviews Physics. https://www.nature.com/articles/s42254-023-00556-5
- Azaïs M, Blanco S, Bon R, Fournier R, Pillot M-H, Gautrais J (2018) Traveling pulse emerges from coupled intermittent walks: a case study in sheep. PLoS ONE 13(12):e0206817. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0206817 ; arXiv: https://arxiv.org/abs/1712.05774
- King AJ, Wilson AM, Wilshin SD, Lowe J, Haddadi H, Hailes S, Morton AJ (2012) Selfish-herd behaviour of sheep under threat. Current Biology 22(14):R561–R562. https://www.cell.com/current-biology/fulltext/S0960-9822(12)00529-5 ; UCL Discovery: https://discovery.ucl.ac.uk/1366736/ ; press: https://www.abc.net.au/science/articles/2012/07/24/3551535.htm
- Strömbom D, Mann RP, Wilson AM, Hailes S, Morton AJ, Sumpter DJT, King AJ (2014) Solving the shepherding problem: heuristics for herding autonomous, interacting agents. J. R. Soc. Interface 11(100):20140719. https://royalsocietypublishing.org/doi/10.1098/rsif.2014.0719 ; PMC: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4191104/ ; open PDF: https://www.diva-portal.org/smash/get/diva2:645255/FULLTEXT01.pdf ; author page: https://sites.lafayette.edu/stroembp/shepherding/
- Nguyen H et al. (2020) Disturbances in influence of a shepherding agent is more impactful than sensorial noise during swarm guidance (reproduces Strömbom's parameter table). arXiv:2008.12708 https://arxiv.org/pdf/2008.12708
- Strömbom D, Hoitt J, Cloud C (2026) Re-solving the shepherding problem: lead when possible, herd when necessary. ANTS 2026 / arXiv:2602.16750 https://arxiv.org/abs/2602.16750 ; code: https://github.com/danielstrombom/Lead-Herd
- Lien J-M, Bayazit OB, Sowell RT, Rodriguez S, Amato NM (2004) Shepherding behaviors. ICRA 2004, pp. 4159–4164. https://parasollab.web.illinois.edu/papers/Lien-sb-2004/
- Long NK, Sammut K, Sgarioto D, Garratt M, Abbass HA (2020) A comprehensive review of shepherding as a bio-inspired swarm-robotics guidance approach. IEEE TETCI 4(4):523–537. https://arxiv.org/abs/1912.07796
- Jadhav V, Pasqua R, Zanon C, Roy M, Tredan G, Bon R, Theraulaz G (2024) Collective responses of flocking sheep (Ovis aries) to a herding dog (border collie). Communications Biology 7:1543. https://www.nature.com/articles/s42003-024-07245-8 ; bioRxiv: https://www.biorxiv.org/content/10.1101/2024.05.24.595762v1 ; code/data: https://github.com/tee-lab/collective-responses-of-flocking-sheep-to-herding-dog
- Pillot M-H, Gautrais J, Arrufat P, Couzin ID, Bon R, Deneubourg J-L (2011) Scalable rules for coherent group motion in a gregarious vertebrate. PLoS ONE 6(1):e14487. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0014487 ; PMC: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3016320/
- Toulet S, Gautrais J, Bon R, Peruani F (2015) Imitation combined with a characteristic stimulus duration results in robust collective decision-making. PLoS ONE 10(10):e0140188. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0140188 ; arXiv: https://arxiv.org/abs/1512.07307
- Rosenthal SB, Twomey CR, Hartnett AT, Wu HS, Couzin ID (2015) Revealing the hidden networks of interaction in mobile animal groups allows prediction of complex behavioral contagion. PNAS 112(15):4690–4695. https://www.pnas.org/doi/10.1073/pnas.1420068112 ; open copy: https://kops.uni-konstanz.de/bitstreams/165c8c91-ff62-4008-a6b5-124ff27bf24a/download
- Sosna MMG et al. (2019) Individual and collective encoding of risk in animal groups. PNAS 116:20556. https://www.pnas.org/doi/10.1073/pnas.1905585116
- Poel W et al. (2022) Subcritical escape waves in schooling fish. Science Advances 8:eabm6385. https://www.science.org/doi/10.1126/sciadv.abm6385 ; arXiv: https://arxiv.org/abs/2108.05537
- Herbert-Read JE et al. (2015) Initiation and spread of escape waves within animal groups. R. Soc. Open Sci. 2:140355. https://royalsocietypublishing.org/doi/10.1098/rsos.140355 ; arXiv: https://arxiv.org/abs/1409.6750
- de Marcken M, Sarfati R (2020) Hydrodynamics of a dense flock of sheep: edge motion and long-range correlations. arXiv:2002.09467 https://arxiv.org/abs/2002.09467
- Yaxley KJ et al. (2021) Drone approach parameters leading to lower stress sheep flocking and movement: sky shepherding. Scientific Reports 11. https://www.nature.com/articles/s41598-021-87453-y
- Hutson GD (1982) 'Flight distance' in Merino sheep. Animal Production 35(2):231–235. https://www.cambridge.org/core/journals/animal-science/article/abs/flight-distance-in-merino-sheep/797D9337104EBD2CC304029B0E0E0901
- Sibbald AM et al. — nearest-neighbour distances of grazing sheep (4.9 m same patch; 9.6 m heather; 13.4 m different patches): https://www.sciencedirect.com/science/article/abs/pii/S0168159108001688 ; Arnold-type factors influencing spatial distribution (15–67 m² per sheep): https://www.sciencedirect.com/science/article/abs/pii/0168159185900280
- Couzin ID, Krause J, James R, Ruxton GD, Franks NR (2002) Collective memory and spatial sorting in animal groups. J. theor. Biol. 218:1–11. https://jmvidal.cse.sc.edu/library/couzin02a.pdf
- Reynolds CW (1987) Flocks, herds, and schools: a distributed behavioral model. SIGGRAPH. https://www.red3d.com/cwr/papers/1987/boids.html
- Vicsek T, Czirók A, Ben-Jacob E, Cohen I, Shochet O (1995) Novel type of phase transition in a system of self-driven particles. Phys. Rev. Lett. 75:1226. (equation summarised in https://guava.physics.ucsd.edu/~nigel/Courses/Web%20page%20563/Essays_2017/PDF/Chatterjee.pdf)
- Muñoz MA (2018) Colloquium: Criticality and dynamical scaling in living systems. Rev. Mod. Phys. 90:031001 (discusses the Ginelli sheep model). https://arxiv.org/abs/1712.04499
