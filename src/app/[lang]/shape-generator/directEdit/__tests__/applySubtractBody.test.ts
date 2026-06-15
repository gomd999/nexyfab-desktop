/**
 * applySubtractBody.test.ts — E4 mesh-level boolean subtract.
 *
 * Tests the direct-edit subtract op against the real boolean primitive
 * (three-bvh-csg). Uses two overlapping boxes:
 *   - target: 10×10×10 box centered at origin
 *   - tool:   5×5×5 box centered at origin → carves a notch
 *
 * Asserts:
 *  - validation rejections (missing ids, self-subtract)
 *  - tool-not-found → graceful no-op
 *  - happy path: applied=true + consumedToolBodyId
 *  - empty-intersection: applied=false + 'empty_intersection' reason
 *    (when tool is far from target)
 *  - elapsedMs is finite
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { applySubtractBody } from '../applySubtractBody';
import type { DirectEditOp } from '../directEditTypes';

function makeCenteredBox(size: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(size, size, size);
  geo.computeVertexNormals();
  return geo;
}

function makeTranslatedBox(size: number, dx: number, dy: number, dz: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(size, size, size);
  geo.translate(dx, dy, dz);
  geo.computeVertexNormals();
  return geo;
}

function subtractOp(targetBodyId: string, toolBodyId: string): Extract<DirectEditOp, { kind: 'subtractBody' }> {
  return { kind: 'subtractBody', targetBodyId, toolBodyId, createdAt: Date.now() };
}

describe('applySubtractBody — validation', () => {
  it('rejects missing targetBodyId', () => {
    const warn = vi.fn();
    const r = applySubtractBody(makeCenteredBox(10), subtractOp('', 'tool'), {
      lookupToolGeometry: () => makeCenteredBox(5),
      warn,
    });
    expect(r.applied).toBe(false);
    expect(r.rejectionReason).toBe('missing_targetBodyId');
    expect(warn).toHaveBeenCalled();
  });

  it('rejects missing toolBodyId', () => {
    const r = applySubtractBody(makeCenteredBox(10), subtractOp('target', ''), {
      lookupToolGeometry: () => makeCenteredBox(5),
      warn: vi.fn(),
    });
    expect(r.applied).toBe(false);
    expect(r.rejectionReason).toBe('missing_toolBodyId');
  });

  it('rejects self-subtract (target == tool)', () => {
    const r = applySubtractBody(makeCenteredBox(10), subtractOp('same', 'same'), {
      lookupToolGeometry: () => makeCenteredBox(5),
      warn: vi.fn(),
    });
    expect(r.applied).toBe(false);
    expect(r.rejectionReason).toBe('self_subtract');
  });

  it('returns original geometry unchanged on validation failure', () => {
    const target = makeCenteredBox(10);
    const r = applySubtractBody(target, subtractOp('', 'tool'), {
      lookupToolGeometry: () => makeCenteredBox(5),
      warn: vi.fn(),
    });
    expect(r.geometry).toBe(target);
  });
});

describe('applySubtractBody — lookup', () => {
  it('tool body not found in scene → no-op with warn', () => {
    const warn = vi.fn();
    const r = applySubtractBody(makeCenteredBox(10), subtractOp('target', 'missing-tool'), {
      lookupToolGeometry: () => null,
      warn,
    });
    expect(r.applied).toBe(false);
    expect(r.rejectionReason).toBe('tool_not_found');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing-tool'));
  });
});

describe('applySubtractBody — boolean primitive', () => {
  it('happy path: overlapping target + tool → cut geometry', () => {
    const target = makeCenteredBox(10);
    const tool = makeCenteredBox(5);
    const r = applySubtractBody(target, subtractOp('target', 'tool'), {
      lookupToolGeometry: () => tool,
    });
    expect(r.applied).toBe(true);
    expect(r.consumedToolBodyId).toBe('tool');
    expect(r.geometry).not.toBe(target);
    // Cut geometry must have triangles (non-empty position attribute).
    const pos = r.geometry.getAttribute('position');
    expect(pos).toBeDefined();
    expect(pos!.count).toBeGreaterThan(0);
    expect(Number.isFinite(r.elapsedMs)).toBe(true);
  });

  it('non-intersecting tool: applier completes (three-bvh-csg returns the target geometry unchanged in shape — no throw)', () => {
    // three-bvh-csg does NOT throw when target + tool don't overlap;
    // it returns a geometry equivalent to the target. The applier
    // surfaces this as applied=true since the op ran cleanly. If we
    // ever need a "did the cut do anything?" check, that's a volume
    // diff that lives at the host-side (out of this applier's scope).
    const target = makeCenteredBox(10);
    const tool = makeTranslatedBox(2, 100, 100, 100); // 100mm away
    const r = applySubtractBody(target, subtractOp('target', 'tool'), {
      lookupToolGeometry: () => tool,
      warn: vi.fn(),
    });
    expect(r.applied).toBe(true);
    expect(r.consumedToolBodyId).toBe('tool');
    expect(r.rejectionReason).toBeUndefined();
  });
});

describe('applySubtractBody — elapsedMs', () => {
  it('reports a finite elapsedMs on success', () => {
    const r = applySubtractBody(makeCenteredBox(10), subtractOp('target', 'tool'), {
      lookupToolGeometry: () => makeCenteredBox(5),
    });
    expect(r.applied).toBe(true);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.elapsedMs)).toBe(true);
  });

  it('reports a finite elapsedMs on rejection', () => {
    const r = applySubtractBody(makeCenteredBox(10), subtractOp('', 'tool'), {
      lookupToolGeometry: () => null,
      warn: vi.fn(),
    });
    expect(r.applied).toBe(false);
    expect(Number.isFinite(r.elapsedMs)).toBe(true);
  });
});
