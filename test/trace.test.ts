import { describe, it } from 'vitest';
import { Sim, STATE_NAMES } from '../src/sim';

/** Tuning aid: TRACE=1 npx vitest run test/trace.test.ts  — prints a metrics table over time. */
describe('trace', () => {
  it.skipIf(!process.env.TRACE)('prints metrics over time', () => {
    const count = Number(process.env.COUNT ?? 20);
    const minutes = Number(process.env.MINUTES ?? 10);
    const seed = Number(process.env.SEED ?? 1);
    const patch = process.env.PATCH ? JSON.parse(process.env.PATCH) : {};
    const sim = new Sim({ seed, count, ...patch });
    const rows: string[] = ['   t   coh   nnd  mvd  mxv  spl  pol  jit   ovl  ' + STATE_NAMES.map((s) => s.padStart(5)).join(' ') + '  eps'];
    let runEvents = 0;
    let inRun = false;
    const budget = [0, 0, 0, 0, 0];
    let samples = 0;
    const episodes = new Map<number, Set<number>>();
    for (let s = 0; s < minutes * 60; s++) {
      sim.run(1);
      const m = sim.metrics();
      const runFrac = m.fractions[3];
      for (let k = 0; k < 5; k++) budget[k] += m.fractions[k];
      samples++;
      if (!inRun && runFrac >= 0.4) { inRun = true; runEvents++; }
      if (inRun && runFrac < 0.1) inRun = false;
      for (let i = 0; i < sim.flock.count; i++) {
        const e = sim.flock.episodeId[i];
        if (e < 0) continue;
        if (!episodes.has(e)) episodes.set(e, new Set());
        episodes.get(e)!.add(i);
      }
      if (s % Number(process.env.EVERY ?? 15) === 0) {
        rows.push(
          `${String(s).padStart(4)} ${m.cohesion.toFixed(2).padStart(5)} ${m.nnd.toFixed(2).padStart(5)} ${m.meanVisDist.toFixed(1).padStart(4)} ${m.maxVisDist.toFixed(1).padStart(4)} ${String(m.splits).padStart(4)} ${m.polarisation.toFixed(2).padStart(4)} ${m.jitter.toFixed(2).padStart(4)} ${m.overlap.toFixed(3).padStart(5)}  ` +
            m.fractions.map((f) => (f * 100).toFixed(0).padStart(5)).join(' ') +
            `  ${episodes.size}`,
        );
      }
    }
    const sizes = [...episodes.values()].map((p) => p.size);
    const full = sizes.filter((z) => z >= count * 0.8).length;
    const tiny = sizes.filter((z) => z === 1).length;
    rows.push(`episodes by size: ${sizes.sort((a, b) => a - b).join(',')}  full(>=80%): ${full}  solo: ${tiny}`);
    const big = sizes.filter((z) => z >= count * 0.5).length;
    const mean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    rows.push('time budget: ' + STATE_NAMES.map((nm, k) => `${nm} ${((budget[k] / samples) * 100).toFixed(0)}%`).join('  '));
    rows.push(`run events (>=40% running): ${runEvents}; walk episodes: ${episodes.size}, group relocations (>=50%): ${big}, mean participants ${mean.toFixed(1)}`);
    console.log(rows.join('\n'));
  });
});
