import { describe, expect, it } from 'vitest';
import { Sim, SheepState } from '../src/sim';

/**
 * Scenario 2 (docs/flock-design.md §10): undisturbed group of 5 for 15 minutes.
 * Intermittent line walks, rotating leaders, first follower within seconds, all-or-none outcomes.
 */
describe('scenario 2: small group of 5', () => {
  for (const seed of [1, 2]) {
    it(`seed ${seed}`, () => {
      const count = 5;
      const sim = new Sim({ seed, count });
      const seconds = 900;
      interface Episode { initiator: number; start: number; joins: number[]; members: Set<number> }
      const episodes = new Map<number, Episode>();
      let maxJitter = 0;
      for (let s = 0; s < seconds; s++) {
        for (let k = 0; k < 30; k++) {
          sim.tick();
          const f = sim.flock;
          for (let i = 0; i < f.count; i++) {
            const e = f.episodeId[i];
            if (e < 0 || f.state[i] !== SheepState.Walk) continue;
            let ep = episodes.get(e);
            if (!ep) {
              ep = { initiator: i, start: sim.time, joins: [], members: new Set([i]) };
              episodes.set(e, ep);
            } else if (!ep.members.has(i)) {
              ep.members.add(i);
              ep.joins.push(sim.time - ep.start);
            }
          }
        }
        maxJitter = Math.max(maxJitter, sim.metrics().jitter);
      }
      expect(maxJitter).toBeLessThan(0.05);
      const eps = [...episodes.values()];
      const multi = eps.filter((e) => e.members.size >= 2);
      expect(multi.length, 'episodes with followers').toBeGreaterThanOrEqual(5);
      const full = multi.filter((e) => e.members.size >= count - 1).length;
      expect(full / multi.length, 'all-or-none: share of followed episodes that carry the whole group').toBeGreaterThan(0.3);
      const leaders = new Set(multi.map((e) => e.initiator));
      expect(leaders.size, 'rotating leadership').toBeGreaterThanOrEqual(3);
      const firstFollower = multi.map((e) => e.joins[0]).sort((a, b) => a - b);
      const median = firstFollower[Math.floor(firstFollower.length / 2)];
      expect(median).toBeGreaterThan(0.2);
      expect(median).toBeLessThan(5);
    });
  }
});
