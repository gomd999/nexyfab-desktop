import { describe, expect, it } from 'vitest';
import { createNodeArchitectureExactKernelAdapter as loadNodeAdapter } from './architectureInteriorExactGeometry';
import {
  ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION,
  generateArchitectureVerticalTransportExactGeometry,
  validateVerticalTransportExactReceipt,
  type VerticalTransportExactGeometryRequest,
} from './architectureVerticalTransportExactGeometry';
import type { ArchitectureExactKernelAdapter } from './architectureInteriorExactGeometry';
import type { NodeArchitectureExactKernelResult } from './architectureInteriorExactGeometry';
import type { OcctShape } from '@/lib/occt/types';

const fakeShape = (id: string): OcctShape => ({ id, kind: 'solid' });

function request(overrides: Partial<VerticalTransportExactGeometryRequest> = {}): VerticalTransportExactGeometryRequest {
  return {
    contractVersion: ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION,
    units: 'mm', toleranceMm: 0.1,
    binding: { projectId: 'project-vertical', architectureDocumentId: 'architecture-1', workspaceRevision: 4, workspaceContentHash: 'a'.repeat(64) },
    coordinateFrame: { id: 'frame-shaft', parentId: 'frame-building', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    storeys: [{ id: 'ground', name: 'Ground', elevationMm: 0, heightMm: 3000 }, { id: 'upper', name: 'Upper', elevationMm: 3000, heightMm: 3000 }],
    shaft: { id: 'shaft-1', fromStoreyId: 'ground', toStoreyId: 'upper', boundaryMm: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], hostSpaceIds: ['space-ground', 'space-upper'] },
    elevator: { id: 'elevator-1', shaftId: 'shaft-1', servedStoreyIds: ['ground', 'upper'] },
    hostSlabs: [
      { slab: { id: 'slab-ground', storeyId: 'ground', spaceId: 'space-ground', boundaryMm: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], thicknessMm: 200 }, sourceHash: 'b'.repeat(64) },
      { slab: { id: 'slab-upper', storeyId: 'upper', spaceId: 'space-upper', boundaryMm: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], thicknessMm: 200 }, sourceHash: 'c'.repeat(64) },
    ],
    carFootprintMm: { minMm: [200, 200], maxMm: [800, 800] }, carHeightMm: 2200, clearanceMm: { x: 50, y: 50, z: 100 },
    ...overrides,
  };
}

function fakeAdapter(): ArchitectureExactKernelAdapter {
  let sequence = 0;
  const boxes = new Map<string, { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>();
  const volumes = new Map<string, number>();
  const box = (shape: OcctShape) => boxes.get(shape.id) ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 1000, y: 1000, z: 6000 } };
  return {
    identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: 'test-1', buildSha256: 'd'.repeat(64), wasmSha256: 'e'.repeat(64) },
    buildPrismAt: async (loop, z0, heightMm) => { const built = fakeShape(`shape-${++sequence}`); const xs = loop.map(point => point.x), ys = loop.map(point => point.y); const bounds = { min: { x: Math.min(...xs), y: Math.min(...ys), z: z0 }, max: { x: Math.max(...xs), y: Math.max(...ys), z: z0 + heightMm } }; boxes.set(built.id, bounds); volumes.set(built.id, (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y) * heightMm); return { ok: true, shape: built, warnings: [] }; },
    subtract: async (base, tool) => { const built = fakeShape(`cut-${++sequence}`); const baseBox = box(base), toolBox = box(tool); const dx = Math.max(0, Math.min(baseBox.max.x, toolBox.max.x) - Math.max(baseBox.min.x, toolBox.min.x)); const dy = Math.max(0, Math.min(baseBox.max.y, toolBox.max.y) - Math.max(baseBox.min.y, toolBox.min.y)); const dz = Math.max(0, Math.min(baseBox.max.z, toolBox.max.z) - Math.max(baseBox.min.z, toolBox.min.z)); boxes.set(built.id, baseBox); volumes.set(built.id, (volumes.get(base.id) ?? 0) - dx * dy * dz); return { ok: true, shape: built, warnings: [] }; },
    inspectShape: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12 }),
    inspectShapeDetailed: async shape => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12, bbox: box(shape), absoluteVolume: volumes.get(shape.id) ?? 0, surfaceArea: 6_000, centroid: { x: 5, y: 5, z: 5 }, inertia: { status: 'not_run', reason: 'test' }, surfaceTypes: { status: 'not_run', reason: 'test' }, curveTypes: { status: 'not_run', reason: 'test' }, faceAdjacency: { status: 'not_run', reason: 'test' }, maxTolerance: 0 }),
    exportSTEP: async () => 'ISO-10303-21;\nMANIFOLD_SOLID_BREP;\nEND-ISO-10303-21;',
    release: () => undefined,
  };
}

describe('architecture vertical transport exact geometry contract', () => {
  it('builds shaft void, car, envelope and host slab final receipts with release HOLD', async () => {
    const result = await generateArchitectureVerticalTransportExactGeometry(request(), fakeAdapter());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({ shaftId: 'shaft-1', elevatorId: 'elevator-1', absoluteZRangeMm: [0, 6000], releaseReady: false, hold: expect.arrayContaining(['capacity_speed_not_run']) });
    expect(result.receipt.hostSlabs).toHaveLength(2);
    expect(result.receipt.shaftVoid.manifoldSolid).toBe(true);
    expect(validateVerticalTransportExactReceipt(result.receipt, request())).toBe(true);
  });

  it('rejects stale workspace, host hash tamper, served-storey order, overlap and insufficient clearance', async () => {
    const built = await generateArchitectureVerticalTransportExactGeometry(request(), fakeAdapter());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(validateVerticalTransportExactReceipt(built.receipt, request({ binding: { ...request().binding, workspaceRevision: 5 } }))).toBe(false);
    expect(validateVerticalTransportExactReceipt(built.receipt, request({ hostSlabs: [{ ...request().hostSlabs[0]!, sourceHash: 'f'.repeat(64) }, request().hostSlabs[1]!] }))).toBe(false);
    expect(validateVerticalTransportExactReceipt({ ...built.receipt, shaftVoid: { ...built.receipt.shaftVoid, stepText: `${built.receipt.shaftVoid.stepText} tampered` } }, request())).toBe(false);
    expect(await generateArchitectureVerticalTransportExactGeometry(request({ elevator: { ...request().elevator, servedStoreyIds: ['upper', 'ground'] } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_VERTICAL_TRANSPORT_INVALID_REQUEST' });
    expect(await generateArchitectureVerticalTransportExactGeometry(request({ carFootprintMm: { minMm: [-100, 200], maxMm: [800, 800] } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_VERTICAL_TRANSPORT_INVALID_REQUEST' });
    expect(await generateArchitectureVerticalTransportExactGeometry(request({ clearanceMm: { x: 300, y: 300, z: 100 } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_VERTICAL_TRANSPORT_INVALID_REQUEST' });
  });

  it('fails closed when a non-identity frame would be silently ignored', async () => { expect(await generateArchitectureVerticalTransportExactGeometry(request({ coordinateFrame: { ...request().coordinateFrame, rotationDeg: [0, 0, 1] } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_VERTICAL_TRANSPORT_INVALID_REQUEST' }); });
  it('runs the complete shaft/slab boolean path through real OCCT and retains exact HOLD boundaries', async () => {
    const loaded: NodeArchitectureExactKernelResult = await loadNodeAdapter();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const result = await generateArchitectureVerticalTransportExactGeometry(request(), loaded.adapter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.shaftVoid.stepText).toContain('MANIFOLD_SOLID_BREP');
    expect(result.receipt.elevatorCar.absoluteVolume).toBeGreaterThan(0);
    expect(result.receipt.elevatorEnvelope.absoluteVolume).toBeGreaterThan(result.receipt.elevatorCar.absoluteVolume);
    expect(result.receipt.hostSlabs.every(item => item.result.manifoldSolid && item.result.stepSha256 === item.resultingStepSha256)).toBe(true);
    expect(result.receipt.releaseReady).toBe(false);
  }, 30_000);
});
