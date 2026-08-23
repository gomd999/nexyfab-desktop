import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION,
  createNodeArchitectureExactKernelAdapter,
  generateArchitectureExactGeometry,
  type ArchitectureExactGeometryRequest,
  type NodeArchitectureExactKernelResult,
} from './architectureInteriorExactGeometry';

describe('architecture/interior exact geometry real OCCT integration', () => {
  let loaded: NodeArchitectureExactKernelResult;

  beforeAll(async () => {
    loaded = await createNodeArchitectureExactKernelAdapter();
  }, 30_000);

  it('produces verified manifold STEP evidence with the installed server kernel', async () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const request: ArchitectureExactGeometryRequest = {
      contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION,
      units: 'mm',
      binding: {
        projectId: 'real-kernel-project',
        revision: 1,
        documentId: 'real-kernel-document',
        documentHash: 'a'.repeat(64),
      },
      toleranceMm: 0.1,
      walls: [{
        id: 'wall-1',
        kind: 'line',
        startMm: [0, 0],
        endMm: [4_000, 0],
        thicknessMm: 200,
        heightMm: 3_000,
        z0Mm: 0,
      }],
      slabs: [{
        id: 'slab-1',
        boundaryMm: [[0, 0], [4_000, 0], [4_000, 3_000], [0, 3_000]],
        z0Mm: -200,
        thicknessMm: 200,
      }],
      ceilings: [],
      openings: [{
        id: 'door-1',
        kind: 'door',
        hostWallId: 'wall-1',
        offsetMm: 1_000,
        widthMm: 900,
        heightMm: 2_100,
        sillMm: 0,
      }],
      serviceOpenings: [],
    };

    const result = await generateArchitectureExactGeometry(request, loaded.adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.kernel.realKernel).toBe(true);
    expect(result.receipt.kernel.buildSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.kernel.wasmSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.shapes).toHaveLength(2);
    expect(result.receipt.shapes.every(item => item.closedSolid && item.verification.toleranceVerified)).toBe(true);
    expect(result.receipt.shapes.every(item => item.stepText.includes('MANIFOLD_SOLID_BREP'))).toBe(true);
  }, 30_000);

  it('keeps an arc wall analytic through the real OCCT adapter', async () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const request: ArchitectureExactGeometryRequest = {
      contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION,
      units: 'mm',
      binding: { projectId: 'real-arc-project', revision: 1, documentId: 'real-arc-document', documentHash: 'b'.repeat(64) },
      toleranceMm: 0.1,
      walls: [{ id: 'arc-wall-1', kind: 'arc', centerMm: [0, 0], radiusMm: 2_000, startAngleDeg: 0, endAngleDeg: 90, thicknessMm: 200, heightMm: 3_000, z0Mm: 0 }],
      slabs: [],
      ceilings: [],
      openings: [],
      serviceOpenings: [],
    };
    const result = await generateArchitectureExactGeometry(request, loaded.adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.shapes).toHaveLength(1);
    expect(result.receipt.shapes[0]).toMatchObject({ elementId: 'arc-wall-1', closedSolid: true, verification: { toleranceVerified: true } });
  }, 30_000);

  it('cuts a vertical slab service opening with the real analytic cylinder path', async () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const request: ArchitectureExactGeometryRequest = {
      contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION,
      units: 'mm',
      binding: { projectId: 'real-service-project', revision: 2, documentId: 'real-service-document', documentHash: 'c'.repeat(64) },
      toleranceMm: 0.1,
      walls: [],
      slabs: [{ id: 'slab-1', boundaryMm: [[0, 0], [4_000, 0], [4_000, 3_000], [0, 3_000]], z0Mm: -200, thicknessMm: 200 }],
      ceilings: [],
      openings: [],
      serviceOpenings: [{ id: 'svc-1', hostId: 'slab-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', centerMm: [2_000, 1_500, -100], axis: [0, 0, 1], cutDiameterMm: 200, depthMm: 250, firestopAnnulusMm: 25, structuralApprovalId: 'approval-ref-1' }],
    };
    const result = await generateArchitectureExactGeometry(request, loaded.adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.shapes).toHaveLength(1);
    expect(result.receipt.serviceOpenings).toMatchObject([{ openingId: 'svc-1', hostId: 'slab-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', structuralApprovalId: 'approval-ref-1' }]);
    expect(result.receipt.shapes[0]!.stepText).toContain('MANIFOLD_SOLID_BREP');
  }, 30_000);

  it.each([
    ['x', [1, 0, 0] as const, [[0, 0], [4_000, 0]] as const, [2_000, 0, 1_500] as const],
    ['y', [0, 1, 0] as const, [[0, 0], [0, 4_000]] as const, [0, 2_000, 1_500] as const],
  ])('cuts an axis-aligned horizontal %s wall service opening with the native OCCT cylinder path', async (axisName, axis, [start, end], center) => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const request: ArchitectureExactGeometryRequest = {
      contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION, units: 'mm',
      binding: { projectId: `real-wall-service-${axisName}`, revision: 2, documentId: `real-wall-service-${axisName}`, documentHash: 'd'.repeat(64) },
      toleranceMm: 0.1,
      walls: [{ id: 'wall-1', kind: 'line', startMm: start, endMm: end, thicknessMm: 200, heightMm: 3_000, z0Mm: 0 }],
      slabs: [],
      ceilings: [],
      openings: [],
      serviceOpenings: [{ id: `svc-wall-${axisName}`, hostId: 'wall-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', centerMm: center, axis, cutDiameterMm: 100, depthMm: 4_200, firestopAnnulusMm: 25 }],
    };
    const result = await generateArchitectureExactGeometry(request, loaded.adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.shapes).toHaveLength(1);
    expect(result.receipt.serviceOpenings).toMatchObject([{ openingId: `svc-wall-${axisName}`, axis, hostId: 'wall-1' }]);
    expect(result.receipt.shapes[0]!.stepText).toContain('MANIFOLD_SOLID_BREP');
  }, 30_000);

  it('cuts an oblique wall service opening with the native arbitrary-axis cylinder path', async () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const request: ArchitectureExactGeometryRequest = {
      contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION, units: 'mm',
      binding: { projectId: 'real-oblique-service', revision: 2, documentId: 'real-oblique-service', documentHash: 'e'.repeat(64) },
      toleranceMm: 0.1,
      walls: [{ id: 'wall-1', kind: 'line', startMm: [0, 0], endMm: [4_000, 0], thicknessMm: 200, heightMm: 3_000, z0Mm: 0 }],
      slabs: [], ceilings: [], openings: [],
      serviceOpenings: [{ id: 'svc-oblique', hostId: 'wall-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', centerMm: [2_000, 0, 1_500], axis: [Math.SQRT1_2, 0, Math.SQRT1_2], cutDiameterMm: 100, depthMm: 6_000, firestopAnnulusMm: 25 }],
    };
    const result = await generateArchitectureExactGeometry(request, loaded.adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.shapes).toHaveLength(1);
    expect(result.receipt.serviceOpenings).toMatchObject([{ openingId: 'svc-oblique', hostId: 'wall-1', axis: [Math.SQRT1_2, 0, Math.SQRT1_2] }]);
    expect(result.receipt.shapes[0]!.closedSolid).toBe(true);
    expect(result.receipt.shapes[0]!.stepText).toContain('MANIFOLD_SOLID_BREP');
  }, 30_000);
});
