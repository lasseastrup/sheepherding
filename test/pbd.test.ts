import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim';

describe('position-based separation', () => {
  it('a packed idle flock settles with no overlap and no jitter', () => {
    const sim = new Sim({ seed: 3, count: 40, behaviourEnabled: false, spawn: { spacing: 0.6 } });
    sim.run(20);
    const m = sim.metrics();
    // the solver deliberately leaves (1 - slack) of the summed radii as tolerance
    const allowed = (1 - sim.cfg.pbd.slack) * 2 * sim.cfg.sheep.contactRadius * 1.1 + 0.005;
    expect(m.overlap).toBeLessThan(allowed);
    expect(m.jitter).toBeLessThan(0.01);
    expect(m.meanSpeed).toBeLessThan(0.005);
    for (let i = 0; i < sim.flock.count; i++) {
      const r = sim.flock.radius[i];
      expect(sim.flock.px[i]).toBeGreaterThanOrEqual(r - 1e-4);
      expect(sim.flock.px[i]).toBeLessThanOrEqual(sim.cfg.world.width - r + 1e-4);
      expect(sim.flock.py[i]).toBeGreaterThanOrEqual(r - 1e-4);
      expect(sim.flock.py[i]).toBeLessThanOrEqual(sim.cfg.world.height - r + 1e-4);
    }
  });

  it('never leaves the paddock while behaving', () => {
    const sim = new Sim({ seed: 5, count: 30 });
    let maxOverlap = 0;
    for (let s = 0; s < 30 * 300; s++) {
      sim.tick();
      if (s % 30 === 0) {
        const f = sim.flock;
        for (let i = 0; i < f.count; i++) {
          expect(f.px[i]).toBeGreaterThanOrEqual(0);
          expect(f.px[i]).toBeLessThanOrEqual(sim.cfg.world.width);
          expect(f.py[i]).toBeGreaterThanOrEqual(0);
          expect(f.py[i]).toBeLessThanOrEqual(sim.cfg.world.height);
        }
        maxOverlap = Math.max(maxOverlap, sim.metrics().overlap);
      }
    }
    expect(maxOverlap).toBeLessThan(0.25);
  });
});
