// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import {
  buildAssemblyDrawingHandoff,
  serializeAssemblyDrawingHandoff,
  validateAssemblyDrawingHandoff,
} from '../assembly/drawingHandoff';
import { enrichServerDrawingHandoffWithExactSinglePart } from './exactSinglePartServerHandoff';

const revisionHash = 'a'.repeat(64);
const independentSha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

async function fixture(kind: 'extrude' | 'sweep' = 'extrude') {
  return buildAssemblyDrawingHandoff({
    projectId: 'project-1', workspaceRevision: 7, workspaceContentSha256: revisionHash,
    state: {
      parts: [{
        id: 'part-1', name: 'Plate', partTemplateId: 'plate', fixed: true,
        position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY_QUAT,
      }],
      mates: [],
    },
    featureTrees: {
      'part-1': { nodes: [{
        id: 'body', name: 'Body', dependencies: [],
        payload: kind === 'extrude'
          ? {
              kind: 'extrude' as const,
              loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
              depth: 5, direction: 'one_sided' as const, mode: 'add' as const,
            }
          : {
              kind: 'sweep' as const,
              profile: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
              path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }],
              mode: 'add' as const,
            },
      }] },
    },
    now: new Date('2026-08-14T00:00:00.000Z'),
  });
}

describe('server exact single-part drawing handoff', () => {
  it('regenerates and reimports exact STEP, emits three HLR views and binds dimension/BOM receipts', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(await fixture());
    expect(result.status, result.status === 'NOT_RUN' ? result.reason : '').toBe('PASS');
    if (result.status !== 'PASS') return;
    const exact = result.handoff.exactSinglePart!;
    expect(result.handoff.artifacts).toMatchObject({
      exactBrepStep: { status: 'PASS', sha256: exact.step.sha256 },
      drawing: { status: 'PASS', sha256: exact.drawing.sha256 },
      bom: { status: 'PASS', sha256: exact.bom.sha256 },
      gdtPmi: { status: 'NOT_RUN', sha256: null },
      manufacturingPackage: { status: 'BLOCKED', sha256: null },
    });
    expect(exact.verification).toMatchObject({ valid: true, solidCount: 1, freeBoundaryEdgeCount: 0, nonManifoldEdgeCount: 0 });
    expect(exact.verification.stepRoundTripVolumeRelError).toBeLessThanOrEqual(1e-9);
    expect(exact.drawing.views.map(view => view.name)).toEqual(['front', 'top', 'right']);
    expect(exact.drawing.views.every(view => view.visiblePathCount > 0)).toBe(true);
    expect(exact.dimensions.overall.x).toBeCloseTo(20, 5);
    expect(exact.dimensions.overall.y).toBeCloseTo(10, 5);
    expect(exact.dimensions.overall.z).toBeCloseTo(5, 5);
    expect({
      step: [independentSha256(exact.step.text), Buffer.byteLength(exact.step.text, 'utf8')],
      drawing: [independentSha256(exact.drawing.svg), Buffer.byteLength(exact.drawing.svg, 'utf8')],
      dimensions: [independentSha256(exact.dimensions.receiptJson), Buffer.byteLength(exact.dimensions.receiptJson, 'utf8')],
      bom: [independentSha256(exact.bom.receiptJson), Buffer.byteLength(exact.bom.receiptJson, 'utf8')],
    }).toEqual({
      step: [exact.step.sha256, exact.step.bytes],
      drawing: [exact.drawing.sha256, exact.drawing.bytes],
      dimensions: [exact.dimensions.sha256, exact.dimensions.bytes],
      bom: [exact.bom.sha256, exact.bom.bytes],
    });
    const bomItem = JSON.parse(exact.bom.receiptJson).items[0];
    expect(bomItem).toMatchObject({ partId: 'part-1', quantity: 1 });
    expect(bomItem.dimensionsMm).toEqual(exact.dimensions.overall);
    expect(await validateAssemblyDrawingHandoff(result.handoff)).toEqual({ ok: true, handoff: result.handoff });
  }, 60_000);

  it('is byte-deterministic for the same revision-bound input', async () => {
    const input = await fixture();
    const first = await enrichServerDrawingHandoffWithExactSinglePart(input);
    const second = await enrichServerDrawingHandoffWithExactSinglePart(input);
    expect(first.status).toBe('PASS');
    expect(second.status).toBe('PASS');
    if (first.status !== 'PASS' || second.status !== 'PASS') return;
    expect({
      step: second.handoff.exactSinglePart!.step.sha256,
      drawing: second.handoff.exactSinglePart!.drawing.sha256,
      dimensions: second.handoff.exactSinglePart!.dimensions.sha256,
      bom: second.handoff.exactSinglePart!.bom.sha256,
      payload: serializeAssemblyDrawingHandoff(second.handoff),
    }).toEqual({
      step: first.handoff.exactSinglePart!.step.sha256,
      drawing: first.handoff.exactSinglePart!.drawing.sha256,
      dimensions: first.handoff.exactSinglePart!.dimensions.sha256,
      bom: first.handoff.exactSinglePart!.bom.sha256,
      payload: serializeAssemblyDrawingHandoff(first.handoff),
    });
  }, 60_000);

  it('keeps unsupported FeatureTrees NOT_RUN and manufacturing BLOCKED', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(await fixture('sweep'));
    expect(result).toMatchObject({ status: 'NOT_RUN', reason: expect.stringContaining('OCCT_FEATURE_UNSUPPORTED') });
    expect(result.handoff.exactSinglePart).toBeUndefined();
    expect(result.handoff.artifacts.exactBrepStep.status).toBe('NOT_RUN');
    expect(result.handoff.artifacts.manufacturingPackage.status).toBe('BLOCKED');
  });

  it('rejects client-forged downstream PASS and detects immutable artifact tampering', async () => {
    const forged = await fixture();
    forged.artifacts.drawing = { status: 'PASS', sha256: 'b'.repeat(64), reason: 'client says pass' };
    expect(await enrichServerDrawingHandoffWithExactSinglePart(forged)).toMatchObject({
      status: 'INVALID_INPUT', reason: 'CLIENT_DOWNSTREAM_EVIDENCE_FORBIDDEN',
    });

    const result = await enrichServerDrawingHandoffWithExactSinglePart(await fixture());
    expect(result.status).toBe('PASS');
    if (result.status !== 'PASS') return;
    const tampered = structuredClone(result.handoff);
    tampered.exactSinglePart!.step.text += ' ';
    expect(await validateAssemblyDrawingHandoff(tampered)).toEqual({
      ok: false, reason: 'ASSEMBLY_DRAWING_HANDOFF_EVIDENCE_INVALID',
    });

    const crossBoundToAnotherStep = structuredClone(result.handoff);
    const bom = JSON.parse(crossBoundToAnotherStep.exactSinglePart!.bom.receiptJson) as Record<string, unknown>;
    bom.sourceStepSha256 = 'c'.repeat(64);
    const receiptJson = serializeAssemblyDrawingHandoff(bom);
    const receiptSha256 = independentSha256(receiptJson);
    crossBoundToAnotherStep.exactSinglePart!.bom.receiptJson = receiptJson;
    crossBoundToAnotherStep.exactSinglePart!.bom.sha256 = receiptSha256;
    crossBoundToAnotherStep.exactSinglePart!.bom.bytes = Buffer.byteLength(receiptJson, 'utf8');
    crossBoundToAnotherStep.artifacts.bom.sha256 = receiptSha256;
    expect(await validateAssemblyDrawingHandoff(crossBoundToAnotherStep)).toEqual({
      ok: false, reason: 'ASSEMBLY_DRAWING_HANDOFF_EVIDENCE_INVALID',
    });
  }, 60_000);
});
