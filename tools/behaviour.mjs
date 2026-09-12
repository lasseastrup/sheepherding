/**
 * One run, every property that matters. Behaviour work on the flock is entangled: a change that
 * helps shedding can quietly destroy driving, and a single failing assertion tells you nothing
 * about which. This prints the whole picture so a change can be judged against all of it at once.
 *
 *   node tools/behaviour.mjs [--seeds 1,2,3] [--json] [--patch '{"run":{"cohesion":0.8}}']
 */
import { Sim } from '../src/sim/index.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const SEEDS = flag('seeds', '1,2,3,4').split(',').map(Number);
const PATCH = JSON.parse(flag('patch', '{}'));
const WORLD = { width: 40, height: 22 };
const START = Number(flag('start', '10'));

const centre = (s) => {
  let x = 0;
  let y = 0;
  for (let i = 0; i < s.flock.count; i++) { x += s.flock.px[i]; y += s.flock.py[i]; }
  return { x: x / s.flock.count, y: y / s.flock.count };
};
const radius = (s) => {
  const c = centre(s);
  let r = 0;
  for (let i = 0; i < s.flock.count; i++) r = Math.max(r, Math.hypot(s.flock.px[i] - c.x, s.flock.py[i] - c.y));
  return r;
};
/** Connected groups at `dist`, as member index lists, largest first. */
const groupsOf = (s, dist = 4) => {
  const n = s.flock.count;
  const p = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(s.flock.px[i] - s.flock.px[j], s.flock.py[i] - s.flock.py[j]) < dist) {
        const a = find(i);
        const b = find(j);
        if (a !== b) p[a] = b;
      }
    }
  }
  const m = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(i); }
  return [...m.values()].sort((a, b) => b.length - a.length);
};
/** Connected group sizes at `dist`, largest first. */
const groupSizes = (s, dist = 4) => groupsOf(s, dist).map((g) => g.length);
const centreOf = (s, ix) => {
  let x = 0;
  let y = 0;
  for (const i of ix) { x += s.flock.px[i]; y += s.flock.py[i]; }
  return { x: x / ix.length, y: y / ix.length };
};
/**
 * Where a shepherd stands to hold a cut open: in the gap between the two halves, or at the
 * middle of the flock while it is still whole.
 */
const gapPoint = (s) => {
  const g = groupsOf(s);
  if (g.length >= 2 && g[1].length >= 3) {
    const a = centreOf(s, g[0]);
    const b = centreOf(s, g[1]);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return centreOf(s, g[0]);
};
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const settled = (seed, count = 20, world = WORLD) => { const s = new Sim({ seed, count, world, ...PATCH }); s.run(45); return s; };

/** Run `seconds` of simulation, calling `path(t)` for the pointer and sampling once a second. */
function play(sim, seconds, path, sample) {
  const t0 = sim.time;
  const out = [];
  for (let k = 0; k < Math.round(seconds * 30); k++) {
    const t = sim.time - t0;
    const p = path(t, sim);
    if (p) sim.setPointer(p.x, p.y); else sim.setPointer(NaN, NaN);
    sim.tick();
    if (k % 30 === 0 && sample) out.push(sample(sim, t));
  }
  return out;
}

const probes = {
  /** An undisturbed flock: mostly grazing, loosely spaced, still, and never overlapping. */
  idle(seed) {
    const sim = new Sim({ seed, count: 20, world: WORLD, ...PATCH });
    const graze = [];
    let overlap = 0;
    let jitter = 0;
    const nnd = [];
    const coh = [];
    for (let s = 0; s < 300; s++) {
      sim.run(1);
      const m = sim.metrics();
      graze.push(m.fractions[0]);
      nnd.push(m.nnd);
      coh.push(m.cohesion);
      overlap = Math.max(overlap, m.overlap);
      jitter = Math.max(jitter, m.jitter);
    }
    return { graze: mean(graze), nnd: mean(nnd), coh: mean(coh), overlap, jitter, whole: groupSizes(sim)[0] / 20 };
  },

  /** A head-on charge: they notice early, pack tight, and flee as one body. */
  charge(seed) {
    const sim = settled(seed);
    const c = centre(sim);
    let responded = 0;
    const rows = play(sim, 16, (t) => ({ x: c.x - Math.max(-2, 30 - 3 * t), y: c.y }), (s, t) => {
      let maxFear = 0;
      let near = Infinity;
      for (let i = 0; i < s.flock.count; i++) {
        maxFear = Math.max(maxFear, s.flock.fear[i]);
        near = Math.min(near, Math.hypot(s.flock.px[i] - s.threat.x, s.flock.py[i] - s.threat.y));
      }
      if (!responded && maxFear >= 0.3) responded = near;
      const m = s.metrics();
      return { t, cohesion: m.cohesion, splits: m.splits, run: m.fractions[3] };
    });
    const late = rows.slice(6);
    return {
      respondAt: responded,
      packsTo: Math.min(...late.map((r) => r.cohesion)),
      splits: median(late.map((r) => r.splits)),
      peakRun: Math.max(...rows.map((r) => r.run)),
    };
  },

  /**
   * Steady pressure from behind: a walk across the paddock, not a stampede.
   *
   * The shepherd keeps walking, whether or not the flock does. An earlier version held station a
   * fixed distance behind the rearmost sheep, which deadlocked: a pointer matching a stalled flock
   * is a *stationary* threat, and a stationary threat carries only a three body length zone, so
   * the pressure was exactly zero for forty-five seconds and the "drive" measured which seeds
   * happened to stampede of their own accord. A steady walk forward regulates itself instead. Dawdle
   * and it closes on you; run and it falls behind and you settle.
   */
  drive(seed) {
    // A paddock long enough to actually drive across. In the 40 BL world the flock reaches the
    // east fence after about fifteen body lengths and spends the rest of the run pinned against
    // it, which reads as a stampede however gently it was pushed.
    const sim = settled(seed, 20, { width: 110, height: 22 });
    const c = centre(sim);
    const rows = play(sim, 45, (t, s) => {
      let cy = 0;
      for (let i = 0; i < s.flock.count; i++) cy += s.flock.py[i];
      cy /= s.flock.count;
      return { x: c.x - START + 1.2 * t, y: cy };
    }, (s) => {
      let sp = 0;
      let fr = 0;
      for (let i = 0; i < s.flock.count; i++) { sp += s.flock.speed[i]; fr += s.flock.fear[i]; }
      return { run: s.metrics().fractions[3], splits: s.metrics().splits, speed: sp / s.flock.count, fear: fr / s.flock.count };
    });
    return {
      driven: centre(sim).x - c.x,
      running: mean(rows.slice(10).map((r) => r.run)),
      speed: mean(rows.slice(10).map((r) => r.speed)),
      fear: mean(rows.slice(10).map((r) => r.fear)),
      splits: median(rows.map((r) => r.splits)),
    };
  },

  /** Circling wide: aware of the threat, but no stampede and no disintegration. */
  circle(seed) {
    const sim = settled(seed);
    const standoff = sim.cfg.pressure.zoneDog * 1.2;
    const rows = play(sim, 60, (t, s) => {
      const a = (t / 50) * Math.PI * 2;
      const live = centre(s);
      const r = radius(s) + standoff;
      return { x: live.x + Math.cos(a) * r, y: live.y + Math.sin(a) * r };
    }, (s) => {
      let maxFear = 0;
      for (let i = 0; i < s.flock.count; i++) maxFear = Math.max(maxFear, s.flock.fear[i]);
      return { run: s.metrics().fractions[3], splits: s.metrics().splits, maxFear };
    });
    const steady = rows.slice(5);
    return {
      peakRun: Math.max(...steady.map((r) => r.run)),
      aware: Math.max(...steady.map((r) => r.maxFear)),
      splits: median(steady.map((r) => r.splits)),
      whole: groupSizes(sim)[0] / 20,
    };
  },

  /** Barge through the middle, then leave: the flock gathers itself back up. */
  recover(seed) {
    const sim = settled(seed);
    const c = centre(sim);
    play(sim, 12, (t) => ({ x: c.x + Math.cos(t * 2.2) * 1.6, y: c.y + Math.sin(t * 3.1) * 1.6 }));
    play(sim, 90, () => null);
    return { whole: groupSizes(sim)[0] / 20, groups: groupSizes(sim).length };
  },

  /**
   * A shed: put yourself in the middle of the flock and hold the gap that opens.
   *
   * The pointer goes in fast, because that is the only way in — walk at a flock from outside and
   * it simply backs away, however slowly you approach, and the earlier version of this probe spent
   * five seconds failing to catch a flock that ran faster than it did. A mouse can move quicker
   * than a sheep, so a player gets in with a flick. After that the pointer holds the gap, which is
   * where a shepherd stands: between the two halves, not where the flock used to be.
   */
  shed(seed) {
    const sim = settled(seed, 24);
    const c = centre(sim);
    play(sim, 0.5, (t) => ({ x: c.x + 14 * (1 - t / 0.5), y: c.y }));
    let best = 0;
    play(sim, 25, (t, s) => {
      const g = gapPoint(s);
      return { x: g.x + Math.sin(t * 2) * 0.8, y: g.y + Math.cos(t * 2.7) * 0.8 };
    }, (s, t) => {
      if (t > 5) { const g = groupSizes(s); if (g.length >= 2) best = Math.max(best, Math.min(g[0], g[1])); }
      return 0;
    });
    const g = groupSizes(sim);
    return { held: g.length >= 2 ? Math.min(g[0], g[1]) : 0, best, shape: g.join('/') };
  },

  /** A shed finished properly: cut, then walk one half off the other and leave. */
  shedDrive(seed) {
    const sim = settled(seed, 24);
    const c = centre(sim);
    play(sim, 0.5, (t) => ({ x: c.x + 14 * (1 - t / 0.5), y: c.y }));
    play(sim, 8, (t, s) => {
      const g = gapPoint(s);
      return { x: g.x + Math.sin(t * 2) * 0.8, y: g.y + Math.cos(t * 2.7) * 0.8 };
    });
    // pick the half that is furthest west and push it further west
    const half = groupsOf(sim).filter((g) => g.length >= 3).sort((a, b) => centreOf(sim, a).x - centreOf(sim, b).x)[0]
      ?? groupsOf(sim)[0];
    const ids = new Set(half);
    play(sim, 18, (t, s) => {
      let sx = 0;
      let sy = 0;
      for (const i of ids) { sx += s.flock.px[i]; sy += s.flock.py[i]; }
      const w = { x: sx / ids.size, y: sy / ids.size };
      return { x: w.x + 5.5 + Math.sin(t * 1.5) * 0.6, y: w.y + Math.cos(t * 1.9) * 2.5 };
    });
    play(sim, 15, () => null);
    const g = groupSizes(sim);
    return { held: g.length >= 2 ? Math.min(g[0], g[1]) : 0, shape: g.join('/') };
  },
};

const results = {};
for (const [name, fn] of Object.entries(probes)) {
  const runs = SEEDS.map((s) => fn(s));
  const keys = Object.keys(runs[0]).filter((k) => typeof runs[0][k] === 'number');
  results[name] = Object.fromEntries(keys.map((k) => [k, mean(runs.map((r) => r[k]))]));
  if (name.startsWith('shed')) results[name].ok = runs.filter((r) => r.held >= 4).length;
  results[name].shapes = runs.map((r) => r.shape).filter(Boolean).join(' ');
}

if (args.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v);
  const want = {
    idle: 'graze .60+  nnd 1.5-4  coh 2.5-7  overlap <.04  jitter ~0  whole 1.0',
    charge: 'respondAt 8-24  packsTo <2.6  splits 1  peakRun .8+',
    drive: 'driven 30+  speed ~1.2  fear <.6  splits <=3',
    circle: 'peakRun <.5  aware .15+  splits <=3  whole .8+',
    recover: 'whole .8+  groups <=2',
    shed: 'held 4+  ok 3+/4',
    shedDrive: 'held 4+  ok 3+/4',
  };
  for (const [name, r] of Object.entries(results)) {
    const body = Object.entries(r).filter(([k]) => k !== 'shapes').map(([k, v]) => `${k} ${fmt(v)}`).join('  ');
    console.log(`${name.padEnd(10)} ${body}`);
    console.log(`${''.padEnd(10)} want: ${want[name]}${r.shapes ? `   got: ${r.shapes}` : ''}`);
  }
}
