import { describe, expect, it } from 'vitest';
import { createNodeArchitectureExactKernelAdapter as loadNodeAdapter } from './architectureInteriorExactGeometry';
import type { ArchitectureExactKernelAdapter, NodeArchitectureExactKernelResult } from './architectureInteriorExactGeometry';
import { ARCHITECTURE_OPENING_EXACT_CONTRACT_VERSION, generateArchitectureOpeningExactGeometry, validateArchitectureOpeningExactGeometryReceipt, type ArchitectureOpeningExactGeometryRequest } from './architectureOpeningExactGeometry';
import type { OcctShape } from '@/lib/occt/types';

const shape = (id: string): OcctShape => ({ id, kind: 'solid' });
function request(overrides: Partial<ArchitectureOpeningExactGeometryRequest> = {}): ArchitectureOpeningExactGeometryRequest {
  return {
    contractVersion: ARCHITECTURE_OPENING_EXACT_CONTRACT_VERSION, units: 'mm', toleranceMm: 0.1,
    binding: { projectId: 'project-opening', architectureDocumentId: 'architecture-1', workspaceRevision: 12, workspaceContentHash: 'a'.repeat(64) },
    coordinateFrame: { id: 'frame-opening', parentId: 'frame-building', originMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
    hostWall: { id: 'wall-1', kind: 'line', startMm: [0, 0], endMm: [5000, 0], thicknessMm: 200, heightMm: 3000, z0Mm: 0 }, hostWallSourceHash: 'b'.repeat(64),
    hostLevel: { storeyId: 'ground', spaceId: 'space-a', elevationMm: 0, heightMm: 3000, sourceHash: 'c'.repeat(64) },
    opening: { id: 'door-1', kind: 'door', hostWallId: 'wall-1', offsetMm: 1800, widthMm: 900, heightMm: 2100, sillMm: 0, handing: 'left', swing: 'in', swingClearanceMm: 900, sourceHash: 'd'.repeat(64) },
    frame: { jambMm: 80, headMm: 80, depthMm: 120, sourceHash: 'e'.repeat(64) }, leaf: { thicknessMm: 45, insetMm: 20, sourceHash: 'f'.repeat(64) },
    ...overrides,
  };
}
function fakeAdapter(): ArchitectureExactKernelAdapter {
  let sequence = 0; const boxes = new Map<string, { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>(); const volumes = new Map<string, number>();
  return {
    identity: { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: 'test-1', buildSha256: '1'.repeat(64), wasmSha256: '2'.repeat(64) },
    buildPrismAt: async (loop, z0, heightMm) => { const built = shape(`shape-${++sequence}`); const xs = loop.map(p => p.x), ys = loop.map(p => p.y); boxes.set(built.id, { min: { x: Math.min(...xs), y: Math.min(...ys), z: z0 }, max: { x: Math.max(...xs), y: Math.max(...ys), z: z0 + heightMm } }); volumes.set(built.id, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) * heightMm); return { ok: true, shape: built, warnings: [] }; },
    subtract: async (base, tool) => { const built = shape(`cut-${++sequence}`); const box = boxes.get(base.id)!; const toolBox = boxes.get(tool.id)!; boxes.set(built.id, { min: box.min, max: { x: box.max.x, y: box.max.y, z: box.max.z } }); const ix = Math.min(box.max.x, toolBox.max.x) - Math.max(box.min.x, toolBox.min.x); const iy = Math.min(box.max.y, toolBox.max.y) - Math.max(box.min.y, toolBox.min.y); const iz = Math.min(box.max.z, toolBox.max.z) - Math.max(box.min.z, toolBox.min.z); volumes.set(built.id, (volumes.get(base.id) ?? 0) - Math.max(0, ix * iy * iz)); return { ok: true, shape: built, warnings: [] }; },
    inspectShape: async () => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12 }),
    inspectShapeDetailed: async shapeValue => ({ valid: true, solidCount: 1, faceCount: 6, edgeCount: 12, bbox: boxes.get(shapeValue.id)!, absoluteVolume: volumes.get(shapeValue.id) ?? 0, surfaceArea: 1000, centroid: { x: 0, y: 0, z: 0 }, inertia: { status: 'not_run', reason: 'test' }, surfaceTypes: { status: 'not_run', reason: 'test' }, curveTypes: { status: 'not_run', reason: 'test' }, faceAdjacency: { status: 'not_run', reason: 'test' }, maxTolerance: 0 }),
    exportSTEP: async () => 'ISO-10303-21;\nMANIFOLD_SOLID_BREP;\nEND-ISO-10303-21;', release: () => undefined,
  };
}

describe('architecture opening exact geometry contract', () => {
  it('cuts the owned wall and builds frame/leaf receipts with handing, sill/head and level binding', async () => {
    const result = await generateArchitectureOpeningExactGeometry(request(), fakeAdapter()); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.receipt).toMatchObject({ hostWallId: 'wall-1', openingId: 'door-1', storeyId: 'ground', spaceId: 'space-a', sillMm: 0, handing: 'left', swing: 'in', releaseReady: false });
    expect(result.receipt.hostVolumeAfterCut).toBeLessThan(result.receipt.hostVolumeBeforeCut); expect(result.receipt.frameJambs).toHaveLength(2); expect(result.receipt.glazing).toBeUndefined();
    expect(validateArchitectureOpeningExactGeometryReceipt(result.receipt, request())).toBe(true);
  });
  it('supports a window glazing prism and fails closed for stale/hash/ownership/clearance tamper', async () => {
    const windowRequest = request({ opening: { ...request().opening, id: 'window-1', kind: 'window', sillMm: 900, heightMm: 1200, handing: 'none', swing: 'none', swingClearanceMm: 0 }, glazing: { thicknessMm: 24, insetMm: 40, sourceHash: '9'.repeat(64) } });
    const built = await generateArchitectureOpeningExactGeometry(windowRequest, fakeAdapter()); expect(built.ok).toBe(true); if (!built.ok) return;
    expect(built.receipt.glazing?.kind).toBe('glazing'); expect(validateArchitectureOpeningExactGeometryReceipt(built.receipt, windowRequest)).toBe(true);
    expect(validateArchitectureOpeningExactGeometryReceipt(built.receipt, request({ binding: { ...request().binding, workspaceRevision: 13 } }))).toBe(false);
    expect(validateArchitectureOpeningExactGeometryReceipt({ ...built.receipt, hostWall: { ...built.receipt.hostWall, stepText: `${built.receipt.hostWall.stepText} tampered` } }, windowRequest)).toBe(false);
    expect(await generateArchitectureOpeningExactGeometry(request({ opening: { ...request().opening, offsetMm: 4500 } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_OPENING_INVALID_REQUEST' });
    expect(await generateArchitectureOpeningExactGeometry(request({ opening: { ...request().opening, swingClearanceMm: 0 } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_OPENING_INVALID_REQUEST' });
  });
  it('fails closed when the frame transform is non-identity and would be ignored', async () => { expect(await generateArchitectureOpeningExactGeometry(request({ coordinateFrame: { ...request().coordinateFrame, originMm: [1, 0, 0] } }), fakeAdapter())).toMatchObject({ ok: false, code: 'EXACT_OPENING_INVALID_REQUEST' }); });
  it('runs door host boolean and window glazing through real OCCT while retaining non-geometric HOLD boundaries', async () => {
    const loaded: NodeArchitectureExactKernelResult = await loadNodeAdapter(); expect(loaded.ok).toBe(true); if (!loaded.ok) return;
    const door = await generateArchitectureOpeningExactGeometry(request(), loaded.adapter); expect(door.ok).toBe(true); if (!door.ok) return;
    expect(door.receipt.hostWall.manifoldSolid).toBe(true); expect(door.receipt.hostVolumeAfterCut).toBeLessThan(door.receipt.hostVolumeBeforeCut); expect(door.receipt.leaf.absoluteVolume).toBeGreaterThan(0); expect(door.receipt.releaseReady).toBe(false);
    const window = await generateArchitectureOpeningExactGeometry({ ...request(), opening: { ...request().opening, id: 'window-real', kind: 'window', sillMm: 900, heightMm: 1200, handing: 'none', swing: 'none', swingClearanceMm: 0 }, glazing: { thicknessMm: 24, insetMm: 40, sourceHash: '9'.repeat(64) } }, loaded.adapter); expect(window.ok).toBe(true); if (!window.ok) return; expect(window.receipt.glazing?.stepText).toContain('MANIFOLD_SOLID_BREP');
  }, 30_000);
});
