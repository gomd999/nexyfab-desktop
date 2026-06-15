// @vitest-environment node
/**
 * supportedShapesRender — every shape in the deterministic vocabulary
 * (SUPPORTED_SHAPES) must emit valid SCAD from intentToScad with DEFAULT params
 * (params are defaulted via num(v, fallback)). This is the gate-keeper for
 * expanding the agent allow-list: a shape may only be exposed to the LLM if the
 * compiler reliably produces a non-empty model for it. Catches a shape that's
 * listed-but-broken before it reaches users.
 */
import { describe, it, expect } from 'vitest';
import { intentToScad, SUPPORTED_SHAPES } from './intentToScad';

describe('deterministic SCAD vocabulary — every supported shape renders cleanly', () => {
  for (const shapeId of SUPPORTED_SHAPES) {
    it(`${shapeId} → valid SCAD with default params`, () => {
      const res = intentToScad({ shapeId, params: {}, facets: 32 });
      expect(res.ok, `${shapeId}: ${res.ok ? '' : res.reason}`).toBe(true);
      if (res.ok) {
        // Non-trivial SCAD: at least one module/function call — covers OpenSCAD
        // primitives (cube/cylinder/…) AND BOSL2 module calls (spur_gear,
        // threaded_rod, cuboid, screw, …).
        expect(res.scad.length).toBeGreaterThan(10);
        expect(/[a-z_]+\s*\(/i.test(res.scad), `no module call in: ${res.scad.slice(0, 60)}`).toBe(true);
      }
    });
  }

  it('a shape NOT in the vocabulary is rejected (gate works)', () => {
    const res = intentToScad({ shapeId: 'definitely-not-a-shape', params: {} });
    expect(res.ok).toBe(false);
  });
});
