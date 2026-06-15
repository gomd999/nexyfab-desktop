/**
 * planegcs WASM smoke test — Phase 1.1 acceptance.
 *
 * Verifies:
 *  1. WASM module loads in node test environment
 *  2. GcsWrapper can be constructed
 *  3. A trivial sketch (line + horizontal_l) solves to status=Success
 *  4. apply_solution mutates the line endpoints toward horizontal alignment
 */
import { describe, it, expect } from 'vitest';
import { createGcsWrapper } from './planegcs';
import { SolveStatus } from '@salusoft89/planegcs';

describe('planegcs smoke', () => {
  it('loads WASM and solves a horizontal line constraint', async () => {
    const w = await createGcsWrapper();

    // Two points + line between them, both unfixed and slightly off-axis.
    // Adding horizontal_l on the line should drive p2.y → p1.y.
    w.push_primitives_and_params([
      { id: '1', type: 'point', x: 0, y: 0, fixed: true },
      { id: '2', type: 'point', x: 10, y: 3, fixed: false },
      { id: '3', type: 'line', p1_id: '1', p2_id: '2' },
      { id: '4', type: 'horizontal_l', l_id: '3' },
    ]);

    const status = w.solve();
    expect(status).toBe(SolveStatus.Success);

    w.apply_solution();

    const p2 = w.sketch_index.get_primitive_or_fail('2') as { type: 'point'; x: number; y: number };
    expect(p2.type).toBe('point');
    // Horizontal: p2.y should match p1.y (=0) within solver tolerance.
    expect(Math.abs(p2.y)).toBeLessThan(1e-6);
    // x preserved (constraint doesn't force x).
    expect(p2.x).toBeCloseTo(10, 5);

    w.destroy_gcs_module();
  });
});
