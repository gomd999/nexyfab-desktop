// @vitest-environment node
/**
 * scadVocabularySync — the agent intent gate (intentSchema) must accept EVERY
 * shape the deterministic compiler (intentToScad.SUPPORTED_SHAPES) can emit.
 *
 * Regression: the gate hand-mirrored the shape list and drifted to 19 while the
 * compiler emitted 39 — so the agent rejected ~18 compiler-supported parts
 * (enclosure, motorMount, heatsink, manifold, brackets, structural beams, …)
 * with `shape-id-unknown` even though the prompt advertised them and the
 * compiler renders them cleanly. The gate now imports SUPPORTED_SHAPES directly;
 * this test pins that no shape is stranded behind it again.
 */
import { describe, it, expect } from 'vitest';
import { validateIntent } from '../intentSchema';
import { SUPPORTED_SHAPES } from '@/lib/openscad-render/intentToScad';

function hasUnknownShapeError(shapeId: string): boolean {
  const r = validateIntent({ shapeId, params: {} });
  return r.issues.some(i => i.code === 'shape-id-unknown');
}

describe('agent gate accepts the full deterministic vocabulary', () => {
  for (const shapeId of SUPPORTED_SHAPES) {
    it(`gate accepts "${shapeId}" (no shape-id-unknown)`, () => {
      expect(hasUnknownShapeError(shapeId)).toBe(false);
    });
  }

  it('previously-stranded parts are now reachable through the agent gate', () => {
    const formerlyStranded = [
      'enclosure', 'motorMount', 'heatsink', 'manifold', 'turbine', 'fanBlade',
      'tBeam', 'uChannel', 'zPurlin', 'hingedBracket', 'shelfBracket', 'rackUnit',
      'nameplate', 'phoneStand', 'coaster', 'wallHook', 'drawerKnob', 'planterPot',
    ];
    for (const s of formerlyStranded) {
      expect(SUPPORTED_SHAPES.has(s), `${s} missing from compiler vocabulary`).toBe(true);
      expect(hasUnknownShapeError(s), `${s} still rejected by gate`).toBe(false);
    }
  });

  it('a genuinely unknown shape is still rejected', () => {
    expect(hasUnknownShapeError('definitely-not-a-real-shape')).toBe(true);
  });
});
