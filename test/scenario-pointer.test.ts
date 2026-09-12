import { describe, expect, it } from 'vitest';
import { SheepState, Sim } from '../src/sim';
import { centreOf, centroid, drive, flockRadius, gapPoint, groupsOf, mean, meanFear, nearestSheep, settled } from './helpers';

/** Scenarios 3-9 of docs/flock-design.md §10: the flock's response to the pointer. */
describe('scenario 3: straight fast approach', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}`, () => {
      const sim = settled({ seed, count: 20 });
      const c = centroid(sim);
      const t0 = sim.time;
      const speed = 3;
      const start = 30;
      let responseDist = 0;
      const rows = drive(sim, 16, (t) => ({ x: c.x - Math.max(-2, start - speed * (t - t0)), y: c.y }));
      for (const r of rows) {
        // Response onset = the first sheep to be clearly alarmed. Fear is unambiguously
        // pointer-driven, where leaving GRAZE is not: an undisturbed flock walks about anyway.
        // Mean fear is the wrong probe, since distant sheep in a spread flock dilute it.
        if (responseDist === 0 && r.maxFear >= 0.3) responseDist = r.pointerDist;
      }
      expect(responseDist, 'the flock notices before the pointer arrives').toBeGreaterThan(5);
      expect(responseDist, 'but not from across the paddock').toBeLessThan(sim.cfg.pressure.zoneDog * 2.5);
      const late = rows.slice(6);
      expect(Math.max(...late.map((r) => r.runFrac)), 'the flock runs').toBeGreaterThan(0.8);
      const minCohesion = Math.min(...late.map((r) => r.cohesion));
      expect(minCohesion, 'selfish herd: the flock packs').toBeLessThan(2.6);
      expect(minCohesion).toBeGreaterThan(0.8);
      expect(Math.max(...late.map((r) => r.polarisation)), 'coherent flight').toBeGreaterThan(0.7);
      // it flees as one group, not as fragments
      expect(Math.max(...late.map((r) => r.splits))).toBeLessThanOrEqual(3);
    });
  }
});

describe('scenario 4: wide slow circle', () => {
  it('alerts the flock without stampeding it', () => {
    const sim = settled({ seed: 2, count: 20 });
    const c = centroid(sim);
    const t0 = sim.time;
    const standoff = sim.cfg.pressure.zoneDog * 1.2;
    const rows = drive(sim, 60, (t) => {
      const a = ((t - t0) / 50) * Math.PI * 2;
      // circle the flock at a constant distance from its nearest edge
      const live = centroid(sim);
      const radius = flockRadius(sim) + standoff;
      return { x: live.x + Math.cos(a) * radius, y: live.y + Math.sin(a) * radius };
    });
    void c;
    const steady = rows.slice(5);
    expect(Math.max(...steady.map((r) => r.runFrac)), 'no stampede').toBeLessThan(0.5);
    expect(Math.max(...steady.map((r) => r.maxFear)), 'but they are aware of it').toBeGreaterThan(0.15);
    expect(Math.max(...steady.map((r) => r.meanFear)), 'without the flock being alarmed').toBeLessThan(0.75);
    expect(Math.max(...steady.map((r) => r.splits)), 'the flock holds together').toBeLessThanOrEqual(3);
  });
});

describe('scenario 5: gentle drive from behind', () => {
  it('walks the flock across the paddock', () => {
    // A paddock long enough to drive across. In the default 40 BL world the flock reaches the
    // fence a third of the way in and spends the rest of the run pinned against it.
    const sim = settled({ seed: 3, count: 20, world: { width: 110, height: 22 } });
    const c = centroid(sim);
    const t0 = sim.time;
    const driveSpeed = 1.2;
    // A handler walking the flock forward keeps walking whether or not the flock does. Holding
    // station a fixed distance behind the rearmost sheep does not work and is not what a handler
    // does: matching a stalled flock makes the pointer a *stationary* threat, and a stationary
    // threat carries only zoneIdle, so the pressure is exactly zero and neither ever moves again.
    // A steady walk regulates itself. Dawdle and it closes on you; run and it falls behind.
    const rows = drive(sim, 45, (t) => {
      let cy = 0;
      for (let i = 0; i < sim.flock.count; i++) cy += sim.flock.py[i];
      return { x: c.x - 10 + driveSpeed * (t - t0), y: cy / sim.flock.count };
    });
    const after = centroid(sim);
    expect(after.x - c.x, 'the flock was driven downfield').toBeGreaterThan(30);
    const steady = rows.slice(10);
    // Not the state label: pressed steadily from behind the flock flickers in and out of RUN,
    // but it travels at the pace it is pushed, which is the thing that matters.
    expect(mean(steady.map((r) => r.speed)), 'at a walk, not a sprint').toBeLessThan(sim.cfg.run.speed * 0.6);
    expect(mean(steady.map((r) => r.speed)), 'but actually moving').toBeGreaterThan(0.6);
    expect(Math.max(...steady.map((r) => r.splits)), 'held together').toBeLessThanOrEqual(3);
  });
});

describe('scenario 6: pointer parked inside the flock', () => {
  it('splits the flock, which re-merges once the pressure is gone', () => {
    const sim = settled({ seed: 2, count: 20 });
    const c = centroid(sim);
    const t0 = sim.time;
    let maxSplits = 0;
    // an active intruder in the middle of the flock, not a stationary object it can settle around
    drive(sim, 12, (t) => ({ x: c.x + Math.cos((t - t0) * 2.2) * 1.6, y: c.y + Math.sin((t - t0) * 3.1) * 1.6 }), () => {
      const m = sim.metrics();
      if (m.splits > maxSplits) maxSplits = m.splits;
    });
    expect(maxSplits, 'pressing into the middle fractures the flock').toBeGreaterThanOrEqual(2);
    // pointer removed: the flock should reunite
    drive(sim, 90, () => null);
    expect(sim.metrics().splits, 'and it re-merges afterwards').toBeLessThanOrEqual(2);
  });
});

describe('scenario 7: approach from the blind cone', () => {
  it('registers less at the same distance, and still triggers flight', () => {
    const gate = 8; // body lengths from where the flock was standing
    const measure = (fromBehind: boolean): { fearAtGate: number; peakRun: number; startles: number } => {
      const sim = settled({ seed: 4, count: 20 });
      const c = centroid(sim);
      // hold every sheep facing away from (or toward) the approach corridor
      const face = fromBehind ? 0 : Math.PI;
      const hold = () => { for (let i = 0; i < sim.flock.count; i++) sim.flock.heading[i] = face; };
      hold();
      const t0 = sim.time;
      let fearAtGate = -1;
      let peakRun = 0;
      let startles = 0;
      drive(
        sim,
        14,
        (t) => ({ x: c.x - Math.max(-2, 26 - 3 * (t - t0)), y: c.y }),
        () => {
          // Gate on the pointer's own position, not on its distance to the nearest sheep: the two
          // runs are of differently shaped flocks, so a shape-dependent gate samples a steeply
          // rising fear at two different moments and compares the slope rather than the effect.
          const px = c.x - Math.max(-2, 26 - 3 * (sim.time - t0));
          if (fearAtGate < 0 && c.x - px <= gate) fearAtGate = meanFear(sim);
          for (let i = 0; i < sim.flock.count; i++) if (sim.flock.fearJump[i] >= sim.cfg.fear.startleJump) startles++;
          peakRun = Math.max(peakRun, sim.metrics().fractions[3]);
          // keep the blind side blind until the sheep react for themselves
          if (fearAtGate < 0) hold();
        },
      );
      return { fearAtGate, peakRun, startles };
    };
    const front = measure(false);
    const behind = measure(true);
    expect(behind.fearAtGate, 'a threat in the blind cone registers less').toBeLessThan(front.fearAtGate * 0.8);
    expect(behind.startles, 'and when it does register it is a startle').toBeGreaterThan(0);
    expect(behind.peakRun, 'which still triggers flight').toBeGreaterThan(0.6);
  });
});

describe('scenario 8: settling after a scare', () => {
  it('returns to grazing and ends up facing where the threat was', () => {
    const sim = settled({ seed: 2, count: 20 });
    const c = centroid(sim);
    const t0 = sim.time;
    drive(sim, 10, (t) => ({ x: c.x - Math.max(2, 20 - 3 * (t - t0)), y: c.y }));
    const threatX = c.x - 2;
    const threatY = c.y;
    const rows = drive(sim, 120, () => null);
    let settleTime = -1;
    for (const r of rows) {
      if (r.grazeFrac >= 0.8) { settleTime = r.t - (t0 + 10); break; }
    }
    expect(settleTime, 'settles').toBeGreaterThan(0);
    expect(settleTime, 'within a minute or so').toBeLessThan(90);
    const m = sim.metrics();
    expect(m.jitter).toBeLessThan(0.05);
    expect(m.overlap).toBeLessThan(0.05);
    // heading check while the flock was still alert, right after the pointer left
    const sim2 = settled({ seed: 2, count: 20 });
    const c2 = centroid(sim2);
    const t2 = sim2.time;
    drive(sim2, 10, (t) => ({ x: c2.x - Math.max(2, 20 - 3 * (t - t2)), y: c2.y }));
    drive(sim2, 6, () => null);
    let facing = 0;
    for (let i = 0; i < sim2.flock.count; i++) {
      const dx = threatX - sim2.flock.px[i];
      const dy = threatY - sim2.flock.py[i];
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) continue;
      if ((Math.cos(sim2.flock.heading[i]) * dx + Math.sin(sim2.flock.heading[i]) * dy) / d > 0) facing++;
    }
    expect(facing / sim2.flock.count, 'stop and stare back at the threat').toBeGreaterThan(0.5);
  });
});

describe('scenario 9: a separated sheep rejoins', () => {
  it('crosses to the flock even with the pointer in between', () => {
    const sim = settled({ seed: 5, count: 12 });
    const c = centroid(sim);
    const lone = 0;
    sim.flock.px[lone] = c.x - 15;
    sim.flock.py[lone] = c.y;
    sim.flock.vx[lone] = 0;
    sim.flock.vy[lone] = 0;
    sim.flock.heading[lone] = 0;
    const t0 = sim.time;
    let rejoinTime = -1;
    drive(sim, 40, () => ({ x: c.x - 5, y: c.y }), () => {
      if (rejoinTime > 0) return;
      let nearest = Infinity;
      for (let i = 0; i < sim.flock.count; i++) {
        if (i === lone) continue;
        nearest = Math.min(nearest, Math.hypot(sim.flock.px[i] - sim.flock.px[lone], sim.flock.py[i] - sim.flock.py[lone]));
      }
      if (nearest < 3) rejoinTime = sim.time - t0;
    });
    expect(rejoinTime, 'rejoins the flock').toBeGreaterThan(0);
    expect(rejoinTime, 'and does it promptly').toBeLessThan(30);
    expect(sim.flock.state[lone]).not.toBe(SheepState.Rest);
  });
});

/**
 * Scenarios 10 and 11: shedding. The flock is cut in two and the halves are kept apart, which is
 * a different thing from merely frightening it into fragments — those heal in a second or two.
 * What makes a cut stick is that cohesion reaches only as far as the group a sheep is actually in,
 * and half a flock is a flock: big enough to stop pining for the other half. A single lost sheep
 * still crosses to the rest (scenario 9), because one sheep is not a flock.
 *
 * The pointer goes in with a flick, because that is the only way in: walk at a flock from outside
 * and it backs away faster than you approach, however slowly you come.
 */
describe('scenario 10: shedding the flock', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: cuts the flock and holds the gap`, () => {
      const sim = settled({ seed, count: 24 });
      const c = centroid(sim);
      const t0 = sim.time;
      drive(sim, 0.5, (t) => ({ x: c.x + 14 * (1 - (t - t0) / 0.5), y: c.y }));
      const t1 = sim.time;
      // hold the gap, where a shepherd stands: between the halves, not where the flock used to be
      drive(sim, 25, (t) => {
        const g = gapPoint(sim);
        return { x: g.x + Math.sin((t - t1) * 2) * 0.8, y: g.y + Math.cos((t - t1) * 2.7) * 0.8 };
      });
      const sizes = groupsOf(sim).map((g) => g.length);
      expect(sizes.length, 'the flock is in pieces').toBeGreaterThanOrEqual(2);
      expect(sizes[1], 'and the second piece is a real group, not a straggler').toBeGreaterThanOrEqual(4);
    });
  }
});

describe('scenario 11: driving off a shed group', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: the halves stay apart once the pointer leaves`, () => {
      const sim = settled({ seed, count: 24 });
      const c = centroid(sim);
      const t0 = sim.time;
      drive(sim, 0.5, (t) => ({ x: c.x + 14 * (1 - (t - t0) / 0.5), y: c.y }));
      const t1 = sim.time;
      drive(sim, 8, (t) => {
        const g = gapPoint(sim);
        return { x: g.x + Math.sin((t - t1) * 2) * 0.8, y: g.y + Math.cos((t - t1) * 2.7) * 0.8 };
      });
      // walk the western half further west, then leave the flock alone entirely
      const half = groupsOf(sim).filter((g) => g.length >= 3).sort((a, b) => centreOf(sim, a).x - centreOf(sim, b).x)[0]
        ?? groupsOf(sim)[0];
      const t2 = sim.time;
      drive(sim, 18, (t) => {
        const w = centreOf(sim, half);
        return { x: w.x + 5.5 + Math.sin((t - t2) * 1.5) * 0.6, y: w.y + Math.cos((t - t2) * 1.9) * 2.5 };
      });
      drive(sim, 15, () => null);
      const sizes = groupsOf(sim).map((g) => g.length);
      expect(sizes.length, 'still two flocks with nothing holding them apart').toBeGreaterThanOrEqual(2);
      expect(sizes[1], 'and the smaller one is a real group').toBeGreaterThanOrEqual(4);
    });
  }
});
