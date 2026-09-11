import { describe, it } from 'vitest';
import { drive, centroid, settled } from './helpers';

/** TRACE=1 npx vitest run test/pointer.trace.test.ts — inspect the response to a scripted pointer. */
describe('pointer trace', () => {
  it.skipIf(!process.env.TRACE)('straight approach', () => {
    const sim = settled({ seed: 2, count: 20 });
    const c = centroid(sim);
    const speed = Number(process.env.PSPEED ?? 3);
    const start = 30;
    const t0 = sim.time;
    const rows = drive(sim, 40, (t) => {
      const d = Math.max(-4, start - speed * (t - t0));
      return { x: c.x - d, y: c.y };
    });
    console.log('  t  dist  coh  nnd spl  pol graze alert walk  run  fear');
    for (const r of rows) {
      if (Math.round((r.t - t0) * 10) % 10 !== 0) continue;
      console.log(
        `${(r.t - t0).toFixed(0).padStart(3)} ${r.pointerDist.toFixed(1).padStart(5)} ${r.cohesion.toFixed(2).padStart(4)} ${r.nnd.toFixed(2).padStart(4)} ${String(r.splits).padStart(3)} ${r.polarisation.toFixed(2).padStart(4)} ` +
          `${(r.grazeFrac * 100).toFixed(0).padStart(5)} ${(r.alertFrac * 100).toFixed(0).padStart(5)} ${(r.walkFrac * 100).toFixed(0).padStart(4)} ${(r.runFrac * 100).toFixed(0).padStart(4)} ${r.maxFear.toFixed(2).padStart(5)}`,
      );
    }
  });
});
