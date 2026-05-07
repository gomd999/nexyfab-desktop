import { describe, it, expect } from 'vitest';
import { preflightSketchConstraints } from '@/lib/sketchConstraintPreflight';

describe('preflightSketchConstraints', () => {
  it('warns when points exist without constraints', () => {
    const r = preflightSketchConstraints([{ id: 'p1' }, { id: 'p2' }], []);
    expect(r.warningCodes).toContain('points_no_constraints');
  });

  it('warns on large constraint sets', () => {
    const constraints = Array.from({ length: 81 }, (_, i) => ({ id: `c${i}`, type: 'coincident' }));
    const r = preflightSketchConstraints([{ id: 'p1' }], constraints);
    expect(r.warningCodes).toContain('large_constraint_set');
  });
});
