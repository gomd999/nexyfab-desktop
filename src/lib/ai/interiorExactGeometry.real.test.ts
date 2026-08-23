import { describe, expect, it } from 'vitest';
import { createNodeArchitectureExactKernelAdapter } from './architectureInteriorExactGeometry';
import { buildInteriorExactGeometryRequest, generateInteriorExactGeometry } from './interiorExactGeometry';
import type { InteriorDocument } from './architectureInteriorDocuments';

describe('interior exact geometry real OCCT integration', () => {
  it('produces a verified rotated clearance-envelope STEP solid', async () => {
    const kernel = await createNodeArchitectureExactKernelAdapter();
    expect(kernel.ok).toBe(true);
    if (!kernel.ok) return;
    const document: InteriorDocument = {
      schema: 'nexyfab.interior.v1',
      revision: 2,
      architectureDocumentId: 'architecture-real-1',
      lights: [],
      furniture: [{
        id: 'desk-real-1',
        spaceId: 'space-real-1',
        positionMm: [2_000, 1_500, 0],
        sizeMm: [1_600, 800, 750],
        clearanceMm: 100,
        rotationDeg: 27,
      }],
      finishes: [],
    };
    const built = buildInteriorExactGeometryRequest({
      projectId: 'project-real-1',
      revision: 2,
      interiorDocumentId: 'interior-real-1',
      interiorDocument: document,
      architectureDocumentId: document.architectureDocumentId,
      architectureRevision: 2,
      architectureDocumentHash: 'a'.repeat(64),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = await generateInteriorExactGeometry(built.request, kernel.adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.shapes).toHaveLength(1);
    expect(result.receipt.shapes[0]).toMatchObject({
      elementId: 'desk-real-1',
      abstraction: 'clearance_envelope_box',
      vendorShapeFidelity: 'not_claimed',
      closedSolid: true,
      verification: { toleranceVerified: true },
    });
    expect(result.receipt.shapes[0]!.stepText).toContain('MANIFOLD_SOLID_BREP');
  }, 30_000);
});
