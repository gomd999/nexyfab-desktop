import { describe, expect, it } from 'vitest';
import { createNodeArchitectureExactKernelAdapter as loadNodeAdapter } from './architectureInteriorExactGeometry';
import type { ArchitectureExactKernelAdapter, NodeArchitectureExactKernelResult } from './architectureInteriorExactGeometry';
import { ARCHITECTURE_ROOF_DRAINAGE_EXACT_CONTRACT_VERSION, generateArchitectureRoofDrainageExactGeometry, validateArchitectureRoofDrainageExactGeometryReceipt, type ArchitectureRoofDrainageExactGeometryRequest } from './architectureRoofDrainageExactGeometry';
import type { OcctShape } from '@/lib/occt/types';

const shape = (id: string): OcctShape => ({ id, kind: 'solid' });
function request(overrides: Partial<ArchitectureRoofDrainageExactGeometryRequest> = {}): ArchitectureRoofDrainageExactGeometryRequest {
  return {
    contractVersion: ARCHITECTURE_ROOF_DRAINAGE_EXACT_CONTRACT_VERSION, units: 'mm', toleranceMm: 0.1,
    binding: { projectId: 'project-roof', architectureDocumentId: 'architecture-1', workspaceRevision: 15, workspaceContentHash: 'a'.repeat(64) }, coordinateFrame: { id: 'frame-roof', parentId: 'frame-building', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    roof: { id: 'roof-1', boundaryMm: [[0, 0], [6000, 0], [6000, 4000], [0, 4000]], elevationMm: 3000, thicknessMm: 200, slopeDeg: 0, slopeDirection: 'x', lowPointMm: [3000, 2000], sourceHash: 'b'.repeat(64) }, insulation: { id: 'insulation-1', thicknessMm: 120, sourceHash: 'c'.repeat(64) },
    parapets: [{ id: 'parapet-north', side: 'north', heightMm: 500, thicknessMm: 200, sourceHash: 'd'.repeat(64) }], openings: [{ id: 'roof-opening-1', hostRoofId: 'roof-1', boundaryMm: [[1000, 1000], [1500, 1000], [1500, 1500], [1000, 1500]], sourceHash: 'e'.repeat(64) }], drains: [{ id: 'drain-1', hostRoofId: 'roof-1', centerMm: [3000, 2000], widthMm: 300, depthMm: 180, flowDirection: [0, -1], sourceHash: 'f'.repeat(64) }], scuppers: [],
    ...overrides,
  };
}
function fakeAdapter(): ArchitectureExactKernelAdapter {
  let sequence = 0;
  const boxes = new Map<string, { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>();
  const volumes = new Map<string, number>();
  return {
    identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: 'test-1', buildSha256: '2'.repeat(64), wasmSha256: '3'.repeat(64) },
    buildPrismAt: async (loop, z0, heightMm) => {
      const built = shape(`shape-${++sequence}`); const xs = loop.map(p => p.x), ys = loop.map(p => p.y);
      const box = { min: { x: Math.min(...xs), y: Math.min(...ys), z: z0 }, max: { x: Math.max(...xs), y: Math.max(...ys), z: z0 + heightMm } };
      boxes.set(built.id, box); volumes.set(built.id, (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z));
      return { ok: true, shape: built, warnings: [] };
    },
    subtract: async (base, tool) => {
      const built = shape(`cut-${++sequence}`), baseBox = boxes.get(base.id)!, toolBox = boxes.get(tool.id)!;
      const intersection = Math.max(0, Math.min(baseBox.max.x, toolBox.max.x) - Math.max(baseBox.min.x, toolBox.min.x)) * Math.max(0, Math.min(baseBox.max.y, toolBox.max.y) - Math.max(baseBox.min.y, toolBox.min.y)) * Math.max(0, Math.min(baseBox.max.z, toolBox.max.z) - Math.max(baseBox.min.z, toolBox.min.z));
      boxes.set(built.id, baseBox); volumes.set(built.id, volumes.get(base.id)! - intersection);
      return { ok: true, shape: built, warnings: [] };
    },
    inspectShape: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12 }),
    inspectShapeDetailed: async value => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12, bbox: boxes.get(value.id)!, absoluteVolume: volumes.get(value.id)!, surfaceArea: 1000, centroid: { x: 0, y: 0, z: 0 }, inertia: { status: 'not_run', reason: 'test' }, surfaceTypes: { status: 'not_run', reason: 'test' }, curveTypes: { status: 'not_run', reason: 'test' }, faceAdjacency: { status: 'not_run', reason: 'test' }, maxTolerance: 0 }),
    exportSTEP: async () => 'ISO-10303-21;\nMANIFOLD_SOLID_BREP;\nEND-ISO-10303-21;', release: () => undefined,
  };
}

describe('architecture roof drainage exact geometry contract', () => {
  it('builds roof boolean opening, insulation, parapet, drain and scupper receipts with direction/hash binding', async () => {
    const result = await generateArchitectureRoofDrainageExactGeometry(request(), fakeAdapter()); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.receipt).toMatchObject({ roofId: 'roof-1', slopeDeg: 0, lowPointMm: [3000, 2000], releaseReady: false, hold: expect.arrayContaining(['structure_waterproofing_wind_snow_not_run']) }); expect(result.receipt.roofVolumeAfterCut).toBeLessThan(result.receipt.roofVolumeBeforeCut); expect(result.receipt.drains).toHaveLength(1); expect(result.receipt.scuppers).toHaveLength(0); expect(result.receipt.openingBindings).toEqual([{ id: 'roof-opening-1', boundaryMm: [[1000, 1000], [1500, 1000], [1500, 1500], [1000, 1500]], sourceHash: 'e'.repeat(64) }]); expect(validateArchitectureRoofDrainageExactGeometryReceipt(result.receipt, request())).toBe(true);
  });
  it('fails closed for nonzero slope without an analytic sloped adapter, stale/hash/low-point/drain tamper', async () => {
    expect(await generateArchitectureRoofDrainageExactGeometry(request({ roof: { ...request().roof, slopeDeg: 2 } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_ROOF_SLOPE_UNSUPPORTED' }); const built = await generateArchitectureRoofDrainageExactGeometry(request(), fakeAdapter()); expect(built.ok).toBe(true); if (!built.ok) return;
    expect(validateArchitectureRoofDrainageExactGeometryReceipt(built.receipt, request({ binding: { ...request().binding, workspaceRevision: 16 } }))).toBe(false); expect(validateArchitectureRoofDrainageExactGeometryReceipt({ ...built.receipt, roof: { ...built.receipt.roof, stepText: `${built.receipt.roof.stepText} tampered` } }, request())).toBe(false); expect(await generateArchitectureRoofDrainageExactGeometry(request({ roof: { ...request().roof, lowPointMm: [7000, 2000] } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_ROOF_INVALID_REQUEST' }); expect(await generateArchitectureRoofDrainageExactGeometry(request({ drains: [{ ...request().drains[0]!, flowDirection: [2, 0] as [number, number] }] }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_ROOF_INVALID_REQUEST' });
  });
  it('fails closed for scuppers because the bounded adapter cannot represent their penetration', async () => { const scupper = { id: 'scupper-1', hostRoofId: 'roof-1', side: 'south' as const, centerMm: [3000, 0] as [number, number], widthMm: 300, heightMm: 200, depthMm: 200, flowDirection: [0, -1] as [number, number], sourceHash: '1'.repeat(64) }; expect(await generateArchitectureRoofDrainageExactGeometry(request({ scuppers: [scupper] }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_ROOF_SCUPPER_UNSUPPORTED' }); });
  it('runs the exact flat roof/drain boolean path through real OCCT and retains sloped/HOLD boundaries', async () => {
    const loaded: NodeArchitectureExactKernelResult = await loadNodeAdapter(); expect(loaded.ok).toBe(true); if (!loaded.ok) return; const result = await generateArchitectureRoofDrainageExactGeometry(request(), loaded.adapter); expect(result.ok).toBe(true); if (!result.ok) return; expect(result.receipt.roof.manifoldSolid).toBe(true); expect(result.receipt.roofVolumeAfterCut).toBeLessThan(result.receipt.roofVolumeBeforeCut); expect(result.receipt.insulation.stepText).toContain('MANIFOLD_SOLID_BREP'); expect(result.receipt.releaseReady).toBe(false);
  }, 30_000);
});
