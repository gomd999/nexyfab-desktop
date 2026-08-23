import { describe, expect, it, vi } from 'vitest';
import { ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION, createArchitectureExactKernelAdapter, generateArchitectureExactGeometry, type ArchitectureExactGeometryRequest, type ArchitectureExactKernelAdapter } from './architectureInteriorExactGeometry';
import { ANALYTIC_CYLINDER_WARNING, type OcctBridge } from '@/lib/occt/bridge';
import type { OcctShape } from '@/lib/occt/types';

const shape = (id: string): OcctShape => ({ id, kind: 'solid' });
function adapter(overrides: Partial<ArchitectureExactKernelAdapter> = {}): ArchitectureExactKernelAdapter {
  let sequence = 0;
  return {
    identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: '1.1.1', buildSha256: 'b'.repeat(64), wasmSha256: 'c'.repeat(64) },
    buildPrismAt: async () => ({ ok: true, shape: shape(`s${++sequence}`), warnings: [] }),
    subtract: async () => ({ ok: true, shape: shape(`s${++sequence}`), warnings: [] }),
    inspectShape: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12 }),
    inspectShapeDetailed: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } }, absoluteVolume: 1000, surfaceArea: 600, centroid: { x: 5, y: 5, z: 5 }, inertia: { status: 'not_run', reason: 'test' }, surfaceTypes: { status: 'not_run', reason: 'test' }, curveTypes: { status: 'not_run', reason: 'test' }, faceAdjacency: { status: 'not_run', reason: 'test' }, maxTolerance: 0.01 }),
    exportSTEP: async () => 'ISO-10303-21;\nMANIFOLD_SOLID_BREP;\nEND-ISO-10303-21;',
    release: () => undefined,
    ...overrides,
  };
}

const request = (overrides: Partial<ArchitectureExactGeometryRequest> = {}): ArchitectureExactGeometryRequest => ({ contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION, units: 'mm', binding: { projectId: 'project-1', revision: 4, documentId: 'document-1', documentHash: 'a'.repeat(64) }, toleranceMm: 0.1, walls: [{ id: 'wall-1', kind: 'line', startMm: [0, 0], endMm: [100, 0], thicknessMm: 10, heightMm: 3000, z0Mm: 0 }], slabs: [{ id: 'slab-1', boundaryMm: [[0, 0], [100, 0], [100, 100], [0, 100]], z0Mm: -200, thicknessMm: 200 }], ceilings: [{ id: 'ceiling-1', boundaryMm: [[0, 0], [100, 0], [100, 100], [0, 100]], elevationMm: 3000, thicknessMm: 100 }], openings: [{ id: 'door-1', kind: 'door', hostWallId: 'wall-1', offsetMm: 20, widthMm: 40, heightMm: 2100, sillMm: 0 }], serviceOpenings: [], ...overrides });

describe('architecture/interior exact geometry contract', () => {
  it('uses the kernel adapter for line wall, hosted opening, slab and ceiling and returns bound hashes', async () => {
    const result = await generateArchitectureExactGeometry(request(), adapter());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.exactGeometryProduced).toBe(true);
    expect(result.receipt.binding).toEqual(request().binding);
    expect(result.receipt.shapes.map(item => item.elementId)).toEqual(['wall-1', 'slab-1', 'ceiling-1']);
    expect(result.receipt.shapes.every(item => item.closedSolid && item.shapeHash.length === 64)).toBe(true);
  });

  it('fails closed for arc walls when the real bridge has no analytic arc builder', async () => {
    const result = await generateArchitectureExactGeometry(request({ walls: [{ id: 'arc-1', kind: 'arc', centerMm: [0, 0], radiusMm: 100, startAngleDeg: 0, endAngleDeg: 90, thicknessMm: 10, heightMm: 3000, z0Mm: 0 }], openings: [] }), adapter());
    expect(result).toEqual({ ok: false, code: 'EXACT_GEOMETRY_ARC_WALL_UNSUPPORTED', details: ['arc-1:analytic_arc_builder_unavailable'] });
  });

  it('accepts an analytic arc builder supplied by a real kernel adapter', async () => {
    const result = await generateArchitectureExactGeometry(request({ walls: [{ id: 'arc-1', kind: 'arc', centerMm: [0, 0], radiusMm: 100, startAngleDeg: 0, endAngleDeg: 90, thicknessMm: 10, heightMm: 3000, z0Mm: 0 }], openings: [] }), adapter({ buildArcWall: async () => ({ ok: true, shape: shape('arc-shape'), warnings: [] }) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.receipt.shapes[0]?.elementId).toBe('arc-1');
  });

  it('rejects non-mm and path-like input before invoking the adapter', async () => {
    const build = adapter({ buildPrismAt: async () => { throw new Error('must not run'); } });
    const result = await generateArchitectureExactGeometry(request({ units: 'inch' as 'mm', binding: { ...request().binding, documentId: 'C:\\secret.step' } }), build);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['EXACT_GEOMETRY_UNTRUSTED_INPUT', 'EXACT_GEOMETRY_INVALID_REQUEST']).toContain(result.code);
  });

  it('does not promote an invalid or non-solid inspection to exact geometry', async () => {
    const result = await generateArchitectureExactGeometry(request({ openings: [] }), adapter({ inspectShape: async () => ({ valid: false, solidCount: 0, faceCount: 0, edgeCount: 0 }) }));
    expect(result).toMatchObject({ ok: false, code: 'EXACT_GEOMETRY_VERIFICATION_FAILED' });
  });

  it('requires detailed kernel tolerance evidence before claiming exact geometry', async () => {
    const withoutTolerance = adapter();
    delete (withoutTolerance as { inspectShapeDetailed?: unknown }).inspectShapeDetailed;
    const result = await generateArchitectureExactGeometry(request({ openings: [] }), withoutTolerance);
    expect(result).toMatchObject({ ok: false, code: 'EXACT_GEOMETRY_VERIFICATION_FAILED' });
  });

  it('rejects unbounded coordinates and an unverifiable kernel identity before kernel work', async () => {
    const buildPrismAt = vi.fn(async () => ({ ok: true, shape: shape('unexpected'), warnings: [] }));
    const outOfRange = await generateArchitectureExactGeometry(request({ walls: [{ id: 'wall-1', kind: 'line', startMm: [0, 0], endMm: [1_000_000_001, 0], thicknessMm: 10, heightMm: 3000, z0Mm: 0 }], openings: [] }), adapter({ buildPrismAt }));
    expect(outOfRange).toMatchObject({ ok: false, code: 'EXACT_GEOMETRY_INVALID_REQUEST' });
    expect(buildPrismAt).not.toHaveBeenCalled();

    const badIdentity = adapter({ identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: '', buildSha256: 'not-a-hash', wasmSha256: 'c'.repeat(64) } });
    const unidentified = await generateArchitectureExactGeometry(request({ openings: [] }), badIdentity);
    expect(unidentified).toEqual({ ok: false, code: 'EXACT_GEOMETRY_KERNEL_UNAVAILABLE', details: ['trusted_real_kernel_identity_required'] });
  });

  it('blocks arc openings until an analytic cutter exists', async () => {
    const result = await generateArchitectureExactGeometry(request({ walls: [{ id: 'arc-1', kind: 'arc', centerMm: [0, 0], radiusMm: 100, startAngleDeg: 0, endAngleDeg: 90, thicknessMm: 10, heightMm: 3000, z0Mm: 0 }], openings: [{ id: 'window-1', kind: 'window', hostWallId: 'arc-1', offsetMm: 10, widthMm: 20, heightMm: 20, sillMm: 10 }] }), adapter({ buildArcWall: async () => ({ ok: true, shape: shape('arc-shape'), warnings: [] }) }));
    expect(result).toEqual({ ok: false, code: 'EXACT_GEOMETRY_ARC_OPENING_UNSUPPORTED', details: ['arc-1:analytic_arc_opening_builder_unavailable'] });
  });

  it('releases a built shape when inspection throws', async () => {
    const release = vi.fn();
    const result = await generateArchitectureExactGeometry(request({ openings: [], slabs: [], ceilings: [] }), adapter({ inspectShape: async () => { throw new Error('inspection crash'); }, release }));
    expect(result).toEqual({ ok: false, code: 'EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', details: ['wall-1:inspection_failed'] });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not claim exact geometry for an empty request', async () => {
    const result = await generateArchitectureExactGeometry(request({ walls: [], slabs: [], ceilings: [], openings: [] }), adapter());
    expect(result).toMatchObject({ ok: false, code: 'EXACT_GEOMETRY_INVALID_REQUEST', details: expect.arrayContaining(['exact_shape_required']) });
  });

  it('fails closed for a service opening when the adapter has no analytic cylinder contract', async () => {
    const result = await generateArchitectureExactGeometry(request({ serviceOpenings: [{ id: 'svc-1', hostId: 'slab-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', centerMm: [50, 50, -100], axis: [0, 0, 1], cutDiameterMm: 20, depthMm: 250, firestopAnnulusMm: 5 }] }), adapter());
    expect(result).toEqual({ ok: false, code: 'EXACT_GEOMETRY_SERVICE_OPENING_UNSUPPORTED', details: ['svc-1:analytic_round_cylinder_builder_unavailable'] });
  });

  it('cuts a vertical slab opening only through an explicitly analytic cylinder adapter and binds provenance', async () => {
    const service = { id: 'svc-1', hostId: 'slab-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', centerMm: [50, 50, -100] as [number, number, number], axis: [0, 0, 1] as [number, number, number], cutDiameterMm: 20, depthMm: 250, firestopAnnulusMm: 5, structuralApprovalId: 'approval-1' };
    const result = await generateArchitectureExactGeometry(request({ serviceOpenings: [service] }), adapter({ buildRoundCylinderAt: async () => ({ ok: true, shape: shape('cutter'), warnings: ['analytic-cylinder'] }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.serviceOpenings).toMatchObject([{ openingId: 'svc-1', hostId: 'slab-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', structuralApprovalId: 'approval-1', hostShapeHash: expect.any(String), hostStepSha256: expect.any(String), bindingHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(result.receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [[1, 0, 0] as [number, number, number], 'x'],
    [[0, 1, 0] as [number, number, number], 'y'],
  ])('accepts a horizontal %s cylinder only through an explicit analytic adapter', async (axis, label) => {
    const result = await generateArchitectureExactGeometry(request({ walls: [{ id: 'wall-1', kind: 'line', startMm: [0, 0], endMm: [100, 0], thicknessMm: 10, heightMm: 100, z0Mm: 0 }], slabs: [], ceilings: [], openings: [], serviceOpenings: [{ id: `svc-${label}`, hostId: 'wall-1', sourceRouteId: 'route-1', sourceSleeveId: 'sleeve-1', centerMm: [50, 0, 50], axis, cutDiameterMm: 10, depthMm: 120, firestopAnnulusMm: 5 }] }), adapter({ buildRoundCylinderAt: async (_center, receivedAxis) => ({ ok: true, shape: shape(`cutter-${label}`), warnings: [`analytic-cylinder-${receivedAxis.join(',')}`] }) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.receipt.serviceOpenings![0]).toMatchObject({ openingId: `svc-${label}`, axis });
  });

  it('normalizes an arbitrary cylinder axis before midpoint-to-origin conversion', async () => {
    const buildCylinderAt = vi.fn(async (_origin: [number, number, number], _direction: [number, number, number], _radius: number, _depth: number) => ({ ok: true as const, shape: shape('oblique-cylinder'), warnings: [ANALYTIC_CYLINDER_WARNING] }));
    const exact = createArchitectureExactKernelAdapter({ buildCylinderAt, release: vi.fn() } as unknown as OcctBridge, adapter().identity);
    const result = await exact.buildRoundCylinderAt!([10, 20, 30], [2, 0, 2], 5, 10);
    expect(result.ok).toBe(true);
    const [origin, direction, radius, depth] = buildCylinderAt.mock.calls[0]!;
    expect(origin).toEqual([expect.closeTo(10 - Math.SQRT1_2 * 5), 20, expect.closeTo(30 - Math.SQRT1_2 * 5)]);
    expect(direction).toEqual([expect.closeTo(Math.SQRT1_2), 0, expect.closeTo(Math.SQRT1_2)]);
    expect([radius, depth]).toEqual([5, 10]);
  });
});
