import { describe, expect, it } from 'vitest';
import { defaultConfig, mergeConfig } from '../src/sim';
import { diffFromDefaults, getPath, paramCount, setPath, tuningSchema } from '../src/sim/schema';

describe('tuning schema', () => {
  it('every parameter exists in the config and sits inside its own range', () => {
    const cfg = defaultConfig();
    for (const group of tuningSchema()) {
      for (const p of group.params) {
        const v = getPath(cfg, p.path);
        expect(v, `${p.path} missing from config`).not.toBeUndefined();
        const values = p.pair ? (v as [number, number]) : [v as number];
        for (const n of values) {
          if (p.boolean) continue;
          expect(typeof n, `${p.path} is not numeric`).toBe('number');
          expect(n, `${p.path} default ${n} below min ${p.min}`).toBeGreaterThanOrEqual(p.min);
          expect(n, `${p.path} default ${n} above max ${p.max}`).toBeLessThanOrEqual(p.max);
        }
      }
    }
  });

  it('covers the behaviour groups and is not trivially small', () => {
    const keys = tuningSchema().map((g) => g.key);
    for (const k of ['pressure', 'fear', 'flee', 'run', 'walk', 'graze']) expect(keys).toContain(k);
    expect(paramCount()).toBeGreaterThan(60);
  });

  it('diffs only what changed, and the patch round-trips', () => {
    const cfg = defaultConfig();
    expect(diffFromDefaults(cfg)).toEqual({});
    setPath(cfg, 'run.cohesion', 1.5);
    setPath(cfg, 'personality.boldness', [0.5, 1.5]);
    const patch = diffFromDefaults(cfg);
    expect(patch).toEqual({ run: { cohesion: 1.5 }, personality: { boldness: [0.5, 1.5] } });
    const applied = mergeConfig(defaultConfig(), patch as never);
    expect(applied.run.cohesion).toBe(1.5);
    expect(applied.personality.boldness).toEqual([0.5, 1.5]);
    expect(applied.walk.speed).toBe(defaultConfig().walk.speed);
  });
});
