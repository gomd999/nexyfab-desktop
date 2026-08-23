import { describe, expect, it, vi } from 'vitest';
import type { OcctShape } from '@/lib/occt/types';
import { INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION, buildInteriorExactGeometryRequest, generateInteriorExactGeometry } from './interiorExactGeometry';
import type { ArchitectureExactKernelAdapter } from './architectureInteriorExactGeometry';
import type { InteriorDocument } from './architectureInteriorDocuments';

const shape = (id: string): OcctShape => ({ id, kind: 'solid' });
function adapter(overrides: Partial<ArchitectureExactKernelAdapter> = {}): ArchitectureExactKernelAdapter {
  let n = 0;
  return {
    identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: '7.8.1', buildSha256: 'a'.repeat(64), wasmSha256: 'b'.repeat(64) },
    buildPrismAt: async () => ({ ok: true, shape: shape(`shape-${++n}`), warnings: [] }),
    subtract: async () => ({ ok: true, shape: shape(`subtract-${++n}`), warnings: [] }),
    inspectShape: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12 }),
    inspectShapeDetailed: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, absoluteVolume: 1, surfaceArea: 6, centroid: { x: 0.5, y: 0.5, z: 0.5 }, inertia: { status: 'not_run', reason: 'test' }, surfaceTypes: { status: 'not_run', reason: 'test' }, curveTypes: { status: 'not_run', reason: 'test' }, faceAdjacency: { status: 'not_run', reason: 'test' }, maxTolerance: 0.01 }),
    exportSTEP: async () => 'ISO-10303-21;\nMANIFOLD_SOLID_BREP;\nEND-ISO-10303-21;',
    release: () => undefined,
    ...overrides,
  };
}

const interior = (overrides: Partial<InteriorDocument> = {}): InteriorDocument => ({ schema: 'nexyfab.interior.v1', revision: 4, architectureDocumentId: 'architecture-1', lights: [{ id: 'light-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', positionMm: [1000, 1000, 2800], suspensionMm: 100, lumens: 3000, cctK: 4000 }], furniture: [{ id: 'chair-1', spaceId: 'space-1', positionMm: [2000, 1500, 0], sizeMm: [800, 700, 900], clearanceMm: 100, rotationDeg: 35 }], finishes: [{ id: 'finish-1', spaceId: 'space-1', hostId: 'wall-1', surface: 'wall', material: 'paint' }], millwork: [{ id: 'case-1', spaceId: 'space-1', hostWallId: 'wall-1', positionMm: [3000, 500, 0], sizeMm: [1200, 400, 2400], material: 'oak', clearanceMm: 50 }], ceilingSystems: [{ id: 'grid-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', kind: 'grid', elevationMm: 2900, moduleMm: [600, 600] }], acousticZones: [{ id: 'acoustic-1', spaceId: 'space-1', targetRt60Sec: 0.6 }], ...overrides });
const source = (document = interior()) => ({ projectId: 'project-1', revision: 4, interiorDocumentId: 'interior-1', interiorDocument: document, architectureDocumentId: 'architecture-1', architectureRevision: 9, architectureDocumentHash: 'c'.repeat(64) });

describe('interior exact clearance-envelope geometry', () => {
  it('derives rotated furniture and millwork boxes from the bound document', async () => {
    const built = buildInteriorExactGeometryRequest(source());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const loops: { x: number; y: number }[][] = [];
    const heights: Array<[number, number]> = [];
    const result = await generateInteriorExactGeometry(built.request, adapter({ buildPrismAt: async (loop, z, height) => { loops.push([...loop]); heights.push([z, height]); expect(height).toBeGreaterThan(0); return { ok: true, shape: shape(`s${loops.length}`), warnings: [] }; } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.abstraction).toBe('clearance_envelope_box_brep');
    expect(result.receipt.vendorShapeFidelity).toBe('not_claimed');
    expect(result.receipt.shapes.map(item => item.elementId)).toEqual(['chair-1', 'case-1']);
    expect(new Set(loops[0]!.map(point => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)).size).toBe(4);
    expect(loops[0]![0]).not.toEqual({ x: 1600, y: 1100 });
    expect(heights[0]).toEqual([-100, 1100]);
    expect(heights[1]).toEqual([-50, 2500]);
  });

  it('permits an empty solid set only with complete semantic classification', async () => {
    const built = buildInteriorExactGeometryRequest(source(interior({ furniture: [], millwork: [] })));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const result = await generateInteriorExactGeometry(built.request, adapter());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.shapes).toHaveLength(0);
    expect(result.receipt.emptySolidSetEvidence).toMatchObject({ status: 'verified', reason: 'no_furniture_or_millwork' });
    expect(result.receipt.classifications.map(item => item.id)).toEqual(['light-1', 'finish-1', 'grid-1', 'acoustic-1']);
  });

  it('rejects unsupported/tampered/out-of-bounds requests before kernel work', async () => {
    const built = buildInteriorExactGeometryRequest(source());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const calls = vi.fn();
    const noCall = adapter({ buildPrismAt: async () => { calls(); return { ok: true, shape: shape('never'), warnings: [] }; } });
    // A syntactically valid alternate hash is treated as a different binding;
    // the atomic workspace transaction must compare it with the target document.
    expect(await generateInteriorExactGeometry({ ...built.request, binding: { ...built.request.binding, interiorDocumentHash: 'd'.repeat(64) } }, noCall)).toMatchObject({ ok: true, receipt: { binding: { interiorDocumentHash: 'd'.repeat(64) } } });
    expect(calls).toHaveBeenCalled();
    expect(await generateInteriorExactGeometry({ ...built.request, units: 'm' as 'mm' }, adapter())).toMatchObject({ ok: false, code: 'INTERIOR_EXACT_INVALID_REQUEST' });
    expect(await generateInteriorExactGeometry({ ...built.request, boxes: [{ ...built.request.boxes[0]!, positionMm: [1_000_000_001, 0, 0] }] }, adapter())).toMatchObject({ ok: false, code: 'INTERIOR_EXACT_INVALID_REQUEST' });
    expect(await generateInteriorExactGeometry({ ...built.request, classifications: built.request.classifications.filter(item => item.id !== 'light-1') }, adapter())).toMatchObject({ ok: false, code: 'INTERIOR_EXACT_INVALID_REQUEST' });
    const badIdentity = adapter({ identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: '', buildSha256: 'x', wasmSha256: 'y'.repeat(64) } });
    expect(await generateInteriorExactGeometry(built.request, badIdentity)).toMatchObject({ ok: false, code: 'INTERIOR_EXACT_KERNEL_UNAVAILABLE' });
  });

  it('cleans up and fails closed when inspection or release fails', async () => {
    const built = buildInteriorExactGeometryRequest(source());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const release = vi.fn(() => { throw new Error('release failed'); });
    const result = await generateInteriorExactGeometry(built.request, adapter({ release }));
    expect(result).toMatchObject({ ok: false, code: 'INTERIOR_EXACT_KERNEL_OPERATION_FAILED' });
    expect(release).toHaveBeenCalledTimes(1);
    const inspectResult = await generateInteriorExactGeometry(built.request, adapter({ inspectShape: async () => { throw new Error('inspect failed'); } }));
    expect(inspectResult).toMatchObject({ ok: false, code: 'INTERIOR_EXACT_KERNEL_OPERATION_FAILED' });
  });

  it('receipt is independently bound to interior and architecture hashes and is deterministic', async () => {
    const built = buildInteriorExactGeometryRequest(source());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const one = await generateInteriorExactGeometry(built.request, adapter());
    const two = await generateInteriorExactGeometry(built.request, adapter());
    expect(one).toEqual(two);
    if (!one.ok) return;
    expect(one.receipt.binding.interiorDocumentHash).toBe(built.documentHash);
    expect(one.receipt.binding.architectureDocumentHash).toBe('c'.repeat(64));
    expect(one.receipt.contentHash).toHaveLength(64);
    expect(one.receipt.evidenceHash).toHaveLength(64);
  });
});

void INTERIOR_EXACT_GEOMETRY_CONTRACT_VERSION;
