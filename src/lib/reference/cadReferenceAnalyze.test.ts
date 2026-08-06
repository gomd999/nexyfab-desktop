import { describe, expect, it, vi } from 'vitest';
import type { OcctBridge, OcctDetailedShapeInspection } from '@/lib/occt/bridge';
import type { OcctShape } from '@/lib/occt/types';
import { analyzeCadReference } from './cadReferenceAnalyze';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';

const shape: OcctShape = { id: 'shape-1', kind: 'solid' };
const detail: OcctDetailedShapeInspection = {
  valid: true, solidCount: 1, faceCount: 6, edgeCount: 12,
  shapeTypeCounts: { compound: 0, compsolid: 0, solid: 1, shell: 1 },
  productOccurrences: { status: 'not_run', reason: 'XCAF unavailable in test bridge.' },
  bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 30 } },
  absoluteVolume: 6000, surfaceArea: 2200, centroid: { x: 5, y: 10, z: 15 },
  inertia: { status: 'available', units: 'mm^5', about: 'centroid', matrix: [[1, 0, 0], [0, 2, 0], [0, 0, 3]] },
  surfaceTypes: { status: 'available', counts: { plane: 6 } }, curveTypes: { status: 'available', counts: { line: 12 } },
  faceAdjacency: { status: 'available', faceCount: 6, uniqueEdgeCount: 12, boundaryEdgeCount: 0, manifoldEdgeCount: 12, nonManifoldEdgeCount: 0, faceDegreeHistogram: { '4': 6 } },
};

function mockBridge(options: { inspect?: boolean; importOk?: boolean; inspectError?: Error } = {}): { bridge: OcctBridge; release: ReturnType<typeof vi.fn> } {
  const release = vi.fn();
  const bridge = {
    importSTEP: vi.fn(async () => options.importOk === false ? { ok: false, error: 'bad STEP', warnings: [] } : { ok: true, shape, warnings: [] }),
    release,
    ...(options.inspect === false ? {} : { inspectShapeDetailed: vi.fn(async () => { if (options.inspectError) throw options.inspectError; return detail; }) }),
  } as unknown as OcctBridge;
  return { bridge, release };
}

const input = { format: 'step' as const, source: 'ISO-10303-21;END-ISO-10303-21;', scenarioId: 'box', lengthUnit: { kind: 'mm' as const } };

describe('analyzeCadReference', () => {
  it('creates exact evidence and a scale-aware policy from detailed inspection', async () => {
    const { bridge, release } = mockBridge();
    const result = await analyzeCadReference(input, bridge);
    expect(result.evidence.status).toBe('pass');
    expect(result.evidence.assertions).toHaveLength(17);
    expect(result.evidence.assertions.find(item => item.id === 'geometry.import')).toMatchObject({ status: 'pass', measured: true });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.body-boundaries')).toMatchObject({ status: 'pass', confidence: 1 });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.product-occurrences')).toMatchObject({ status: 'pass', measured: 0, confidence: 1 });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.solid-presence')).toMatchObject({ status: 'pass', measured: 1 });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.assembly-cycle-free')).toMatchObject({ status: 'pass', measured: true });
    expect(result.tolerancePolicy?.characteristicLengthMm).toBeCloseTo(Math.sqrt(1400));
    expect(result.evidence.sideEffects).toMatchObject({ quoteCreated: false, rfqSent: false, sourceModified: false });
    expect(release).toHaveBeenCalledOnce();
  });

  it('reports every exact metric not_run when detailed inspection is unavailable', async () => {
    const { bridge, release } = mockBridge({ inspect: false });
    const result = await analyzeCadReference(input, bridge);
    expect(result.evidence.status).toBe('not_run');
    expect(result.evidence.assertions).toHaveLength(17);
    expect(result.evidence.assertions.find(item => item.id === 'geometry.import')).toMatchObject({ status: 'pass', measured: true });
    expect(result.evidence.assertions.filter(item => item.id !== 'geometry.import').every(item => item.status === 'not_run' && item.confidence === 0)).toBe(true);
    expect(result.tolerancePolicy).toBeNull();
    expect(release).toHaveBeenCalledWith(shape);
  });

  it('fails closed on import failure and does not release a missing shape', async () => {
    const { bridge, release } = mockBridge({ importOk: false });
    const result = await analyzeCadReference(input, bridge);
    expect(result.evidence.status).toBe('fail');
    expect(result.evidence.assertions[0]).toMatchObject({ id: 'geometry.import', status: 'fail', confidence: 1 });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.failure-code')).toMatchObject({ status: 'fail', measured: 'UNKNOWN_IMPORT_FAILURE' });
    expect(result.evidence.assertions.filter(item => !['geometry.import', 'geometry.failure-code'].includes(item.id)).every(item => item.status === 'not_run')).toBe(true);
    expect(release).not.toHaveBeenCalled();
  });

  it('always releases the imported shape when inspection throws', async () => {
    const { bridge, release } = mockBridge({ inspectError: new Error('kernel inspection failed') });
    await expect(analyzeCadReference(input, bridge)).rejects.toThrow('kernel inspection failed');
    expect(release).toHaveBeenCalledWith(shape);
  });

  it('rejects empty input and unsupported formats before touching the bridge', async () => {
    const { bridge } = mockBridge();
    await expect(analyzeCadReference({ ...input, source: ' ' }, bridge)).rejects.toThrow(/non-empty/);
    await expect(analyzeCadReference({ ...input, format: 'iges' as never }, bridge)).rejects.toThrow(/Unsupported/);
    expect(bridge.importSTEP).not.toHaveBeenCalled();
  });

  it('propagates not_run for unavailable inertia and analytic type histograms', async () => {
    const partial = { ...detail, inertia: { status: 'not_run' as const, reason: 'no mass basis' }, surfaceTypes: { status: 'not_run' as const, reason: 'unsupported surface' }, curveTypes: { status: 'not_run' as const, reason: 'unsupported curve' } };
    const release = vi.fn();
    const bridge = { importSTEP: vi.fn(async () => ({ ok: true, shape, warnings: [] })), inspectShapeDetailed: vi.fn(async () => partial), release } as unknown as OcctBridge;
    const result = await analyzeCadReference(input, bridge);
    expect(result.evidence.status).toBe('not_run');
    expect(result.evidence.assertions.filter(item => item.status === 'not_run').map(item => item.id)).toEqual(['geometry.inertia', 'geometry.surface-types', 'geometry.curve-types']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails a valid face or shell that contains no manufacturing solid', async () => {
    const noSolid = { ...detail, solidCount: 0, absoluteVolume: 0, shapeTypeCounts: { compound: 0, compsolid: 0, solid: 0, shell: 1 } };
    const release = vi.fn();
    const bridge = { importSTEP: vi.fn(async () => ({ ok: true, shape, warnings: [] })), inspectShapeDetailed: vi.fn(async () => noSolid), release } as unknown as OcctBridge;
    const result = await analyzeCadReference(input, bridge);
    expect(result.evidence.status).toBe('fail');
    expect(result.evidence.assertions.find(item => item.id === 'geometry.solid-presence')).toMatchObject({ status: 'fail', measured: 0 });
  });

  it('retries one allowed header-only repair and records provenance without claiming repair implies import success', async () => {
    const source = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nFILE_NAME('a','',(''),(''),'','',$);\nFILE_SCHEMA(('AP242'));\nENDSEC;\nDATA;\n#1=PRODUCT('x','',(),());\nENDSEC;\nEND-ISO-10303-21;`;
    const importSTEP = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'header rejected', warnings: [] })
      .mockResolvedValueOnce({ ok: false, error: 'Maximum call stack size exceeded', warnings: [] });
    const bridge = { importSTEP, release: vi.fn() } as unknown as OcctBridge;
    const result = await analyzeCadReference({ ...input, source }, bridge);
    expect(importSTEP).toHaveBeenCalledTimes(2);
    expect(String(importSTEP.mock.calls[1]![0]).slice(String(importSTEP.mock.calls[1]![0]).indexOf('DATA;'))).toBe(source.slice(source.indexOf('DATA;')));
    expect(result.evidence.status).toBe('fail');
    expect(result.evidence.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'import.header-repair', status: 'pass', method: 'conservative STEP header normalizer' }),
      expect.objectContaining({ id: 'geometry.import', status: 'fail' }),
    ]));
    expect(result.evidence.artifacts).toHaveLength(2);
  });

  it('measures an exported STEP box through the real OCCT import path', async () => {
    const loaded = await loadOcctNode();
    expect(loaded.ok, loaded.reason).toBe(true);
    const bridge = createNodeOcctBridge(loaded.oc!);
    const made = await bridge.buildFromExtrude({
      kind: 'extrude', direction: 'one_sided', mode: 'add', depth: 30,
      loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }],
    });
    expect(made.ok).toBe(true);
    const step = await bridge.exportSTEP(made.shape!);
    bridge.release(made.shape!);
    const result = await analyzeCadReference({ ...input, source: step, scenarioId: 'real-box' }, bridge);
    expect(result.evidence.status).toBe('pass');
    const volume = result.evidence.assertions.find(item => item.id === 'geometry.volume');
    const area = result.evidence.assertions.find(item => item.id === 'geometry.area');
    expect(volume).toMatchObject({ status: 'pass' });
    expect(Number(volume?.measured)).toBeCloseTo(6000, 8);
    expect(area).toMatchObject({ status: 'pass' });
    expect(Number(area?.measured)).toBeCloseTo(2200, 8);
    expect(result.evidence.assertions.find(item => item.id === 'geometry.surface-types')).toMatchObject({ status: 'pass', confidence: 1 });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.curve-types')).toMatchObject({ status: 'pass', confidence: 1 });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.body-boundaries')).toMatchObject({ status: 'pass' });
    expect(result.evidence.assertions.find(item => item.id === 'geometry.product-occurrences')).toMatchObject({ status: 'pass', measured: 0 });
  });
});
