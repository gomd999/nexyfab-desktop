/**
 * Phase 2 — advanced mates survive .nfab (de)serialization.
 *
 * Mates serialize wholesale (the assembly snapshot is embedded verbatim), so
 * the new fields (min/max/faceA2/value-as-ratio) ride free; what CAN drop
 * them is `normalizeAssemblySnapshot`'s MATE_TYPES allowlist — which silently
 * discarded hinge/slider/gear mates before this phase.
 */
import { describe, it, expect } from 'vitest';
import { normalizeAssemblySnapshot } from '../nfabFormat';
import type { AssemblyMate } from '../../assembly/AssemblyMates';

const base = { partA: 'p1', partB: 'p2', locked: false };

describe('normalizeAssemblySnapshot · Phase 2 mate types', () => {
  it('keeps limitDistance / limitAngle / width / gear mates with their fields', () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', type: 'limitDistance', ...base, min: 5, max: 25 },
      { id: 'm2', type: 'limitAngle', ...base, min: 0, max: 90 },
      { id: 'm3', type: 'width', ...base, faceA: 0, faceA2: 2, faceB: 4 },
      { id: 'm4', type: 'gear', ...base, value: -2 },
    ];
    const snap = normalizeAssemblySnapshot({ placedParts: [], mates });
    expect(snap.mates).toHaveLength(4);
    const byId = new Map(snap.mates.map(m => [m.id, m]));
    expect(byId.get('m1')?.min).toBe(5);
    expect(byId.get('m1')?.max).toBe(25);
    expect(byId.get('m2')?.max).toBe(90);
    expect(byId.get('m3')?.faceA2).toBe(2);
    expect(byId.get('m4')?.value).toBe(-2);
  });

  it('keeps hinge and slider mates (regression: previously dropped on load)', () => {
    const mates: AssemblyMate[] = [
      { id: 'h', type: 'hinge', ...base },
      { id: 's', type: 'slider', ...base },
    ];
    const snap = normalizeAssemblySnapshot({ placedParts: [], mates });
    expect(snap.mates.map(m => m.id).sort()).toEqual(['h', 's']);
  });

  it('still rejects unknown mate types', () => {
    const snap = normalizeAssemblySnapshot({
      placedParts: [],
      mates: [{ id: 'x', type: 'magnetic', ...base }],
    });
    expect(snap.mates).toHaveLength(0);
  });
});
