import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim';

describe('determinism', () => {
  it('same seed reproduces the same trajectory', () => {
    const a = new Sim({ seed: 7, count: 24 });
    const b = new Sim({ seed: 7, count: 24 });
    a.run(120);
    b.run(120);
    expect(Array.from(a.writeSnapshot())).toEqual(Array.from(b.writeSnapshot()));
  });

  it('different seeds diverge', () => {
    const a = new Sim({ seed: 1, count: 12 });
    const b = new Sim({ seed: 2, count: 12 });
    a.run(30);
    b.run(30);
    expect(Array.from(a.writeSnapshot())).not.toEqual(Array.from(b.writeSnapshot()));
  });
});
