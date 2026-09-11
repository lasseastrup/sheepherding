import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim';

/**
 * Scenario 1 (docs/flock-design.md §10): undisturbed flock of 20 for 10 minutes.
 * The flock grazes most of the time, spreads and re-packs, never disintegrates, never jitters.
 */
describe('scenario 1: undisturbed flock of 20', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}`, () => {
      const sim = new Sim({ seed, count: 20 });
      const allowedOverlap = (1 - sim.cfg.pbd.slack) * 2 * sim.cfg.sheep.contactRadius * 1.1 + 0.01;
      const seconds = 600;
      let sumNnd = 0;
      let sumCoh = 0;
      let maxNnd = 0;
      let maxCoh = 0;
      let splitsOk = 0;
      let united = 0;
      const budget = [0, 0, 0, 0, 0];
      let maxRunFrac = 0;
      const episodes = new Map<number, Set<number>>();
      for (let s = 0; s < seconds; s++) {
        for (let k = 0; k < 30; k++) {
          sim.tick();
          const f = sim.flock;
          for (let i = 0; i < f.count; i++) {
            const e = f.episodeId[i];
            if (e < 0) continue;
            let set = episodes.get(e);
            if (!set) { set = new Set(); episodes.set(e, set); }
            set.add(i);
          }
        }
        const m = sim.metrics();
        expect(m.overlap, `overlap at ${s}s`).toBeLessThan(allowedOverlap);
        expect(m.jitter, `jitter at ${s}s`).toBeLessThan(0.05);
        sumNnd += m.nnd;
        sumCoh += m.cohesion;
        maxNnd = Math.max(maxNnd, m.nnd);
        maxCoh = Math.max(maxCoh, m.cohesion);
        if (m.splits <= 4) splitsOk++;
        if (m.splits === 1) united++;
        for (let k = 0; k < 5; k++) budget[k] += m.fractions[k];
        maxRunFrac = Math.max(maxRunFrac, m.fractions[3]);
      }
      const meanNnd = sumNnd / seconds;
      const meanCoh = sumCoh / seconds;
      expect(meanNnd).toBeGreaterThan(1.0);
      expect(meanNnd).toBeLessThan(3.0);
      expect(maxNnd).toBeLessThan(5.0);
      expect(meanCoh).toBeGreaterThan(2.5);
      expect(meanCoh).toBeLessThan(7.0);
      expect(maxCoh).toBeLessThan(11.0);
      expect(splitsOk / seconds).toBeGreaterThan(0.8);
      expect(united / seconds).toBeGreaterThan(0.15);
      expect(budget[0] / seconds, 'graze share').toBeGreaterThan(0.5);
      expect(budget[2] / seconds, 'walk share').toBeLessThan(0.4);
      const multi = [...episodes.values()].filter((p) => p.size >= 3).length;
      expect(multi, 'walk episodes with >= 3 participants').toBeGreaterThanOrEqual(5);
      expect(maxRunFrac, 'at least one small packing run').toBeGreaterThanOrEqual(0.15);
    });
  }
});
