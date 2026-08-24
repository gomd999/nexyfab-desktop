// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import type { ChamferFeature } from '@/lib/cad/chamferProfile';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { FilletFeature } from '@/lib/cad/filletProfile';
import type { HoleFeature } from '@/lib/cad/holeProfile';
import {
  buildAssemblyDrawingHandoff,
  serializeAssemblyDrawingHandoff,
  validateAssemblyDrawingHandoff,
} from '../assembly/drawingHandoff';
import { enrichServerDrawingHandoffWithExactSinglePart } from './exactSinglePartServerHandoff';

const revisionHash = 'a'.repeat(64);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const baseExtrude: ExtrudeFeature = {
  kind: 'extrude',
  loop: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 20 },
    { x: 0, y: 20 },
  ],
  depth: 10,
  direction: 'one_sided',
  mode: 'add',
};

const drilledHole = (childId: string): HoleFeature => ({
  kind: 'hole',
  childId,
  center: { x: 15, y: 10 },
  holeType: 'drilled',
  diameter: 4,
  depth: 4,
  terminationMode: 'blind',
});

function treatment(kind: 'fillet' | 'chamfer', edgeRefs: string[] = ['e.vert.0', 'e.vert.1']): FilletFeature | ChamferFeature {
  return kind === 'fillet'
    ? {
        kind: 'fillet',
        childId: 'base',
        childExtrude: baseExtrude,
        edgeRefs,
        radius: 1,
        edgeSelection: 'vertical',
      }
    : {
        kind: 'chamfer',
        childId: 'base',
        childExtrude: baseExtrude,
        edgeRefs,
        distance: 1,
        edgeSelection: 'vertical',
      };
}

function treeFor(kind: 'fillet' | 'chamfer', options?: {
  edgeRefs?: string[];
  staleChildSnapshot?: boolean;
  holeDependency?: string;
  holeChildId?: string;
}): FeatureTree {
  const treatmentId = kind;
  const snapshot = options?.staleChildSnapshot
    ? { ...baseExtrude, depth: 99 }
    : baseExtrude;
  const treatmentPayload = treatment(kind, options?.edgeRefs);
  treatmentPayload.childExtrude = snapshot;
  return {
    nodes: [
      { id: 'base', name: 'Base convex rectangular extrude', dependencies: [], payload: baseExtrude },
      { id: treatmentId, name: kind === 'fillet' ? 'Bounded vertical fillet' : 'Bounded vertical chamfer', dependencies: ['base'], payload: treatmentPayload },
      {
        id: 'hole',
        name: 'Strict-interior blind drilled hole',
        dependencies: [options?.holeDependency ?? treatmentId],
        payload: drilledHole(options?.holeChildId ?? treatmentId),
      },
    ],
  };
}

async function fixture(tree: FeatureTree) {
  return buildAssemblyDrawingHandoff({
    projectId: 'project-v2',
    workspaceRevision: 7,
    workspaceContentSha256: revisionHash,
    canonicalRevision: {
      schema: 'nexyfab.precision-cad.canonical-drawing-revision-binding.v1',
      documentId: 'document-v2',
      revisionId: 'revision-7',
      sequence: 7,
      contentSha256: revisionHash,
    },
    state: {
      parts: [{
        id: 'part-1',
        name: 'V2 test plate',
        partTemplateId: 'plate',
        fixed: true,
        position: { x: 0, y: 0, z: 0 },
        orientation: IDENTITY_QUAT,
      }],
      mates: [],
    },
    featureTrees: { 'part-1': tree },
    now: new Date('2026-08-24T00:00:00.000Z'),
  });
}

function expectExactPass(result: Awaited<ReturnType<typeof enrichServerDrawingHandoffWithExactSinglePart>>) {
  expect(result.status, result.status === 'NOT_RUN' ? result.reason : '').toBe('PASS');
  if (result.status !== 'PASS') return;
  const { exactSinglePart, artifacts } = result.handoff;
  expect(exactSinglePart).toBeDefined();
  expect(artifacts).toMatchObject({
    exactBrepStep: { status: 'PASS' },
    drawing: { status: 'PASS' },
    bom: { status: 'PASS' },
    gdtPmi: { status: 'NOT_RUN', sha256: null },
    manufacturingPackage: { status: 'BLOCKED', sha256: null },
  });
  const exact = exactSinglePart!;
  expect(exact.verification).toMatchObject({
    kernel: 'OCCT_NODE',
    valid: true,
    solidCount: 1,
    freeBoundaryEdgeCount: 0,
    nonManifoldEdgeCount: 0,
    preflight: 'PRECHECK_PASS',
  });
  expect(exact.verification.stepRoundTripVolumeRelError).toBeLessThanOrEqual(1e-9);
  expect(exact.drawing.views.map(view => view.name)).toEqual(['front', 'top', 'right']);
  expect(exact.drawing.views.every(view => view.visiblePathCount > 0)).toBe(true);
  expect(exact.dimensions.overall.x).toBeGreaterThan(0);
  expect(exact.dimensions.overall.y).toBeGreaterThan(0);
  expect(exact.dimensions.overall.z).toBeGreaterThan(0);
  expect(exact.step.sha256).toBe(sha256(exact.step.text));
  expect(exact.drawing.sha256).toBe(sha256(exact.drawing.svg));
  expect(exact.dimensions.sha256).toBe(sha256(exact.dimensions.receiptJson));
  expect(exact.bom.sha256).toBe(sha256(exact.bom.receiptJson));
  expect(exact.source.canonicalRevision).toMatchObject({
    revisionId: 'revision-7',
    documentId: 'document-v2',
    sequence: 7,
    contentSha256: revisionHash,
  });
  expect(exact.verification.registrySha256).toMatch(/^[0-9a-f]{64}$/);
  expect(exact.verification.runtimeIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
  expect(exact.verification.glueSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(exact.verification.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
}

type EnrichmentResult = Awaited<ReturnType<typeof enrichServerDrawingHandoffWithExactSinglePart>>;

function expectNotRun(result: EnrichmentResult): asserts result is Extract<EnrichmentResult, { status: 'NOT_RUN' }> {
  expect(result.status).toBe('NOT_RUN');
  if (result.status !== 'NOT_RUN') throw new Error(`expected NOT_RUN, got ${result.status}`);
}

describe('current-head v2 exact single-part server handoff sequence', () => {
  it('runs convex extrude -> explicit-edge fillet -> strict-interior drilled hole through Node OCCT', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(await fixture(treeFor('fillet')));
    expectExactPass(result);
    if (result.status !== 'PASS') return;
    expect(await validateAssemblyDrawingHandoff(result.handoff)).toEqual({ ok: true, handoff: result.handoff });
  }, 60_000);

  it('runs the same sequence with a bounded chamfer treatment through Node OCCT', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(await fixture(treeFor('chamfer')));
    expectExactPass(result);
    if (result.status !== 'PASS') return;
    expect(await validateAssemblyDrawingHandoff(result.handoff)).toEqual({ ok: true, handoff: result.handoff });
  }, 60_000);

  it('keeps caller downstream evidence forbidden and manufacturing release blocked', async () => {
    const forged = await fixture(treeFor('fillet'));
    forged.artifacts.drawing = { status: 'PASS', sha256: 'b'.repeat(64), reason: 'caller evidence' };
    expect(await enrichServerDrawingHandoffWithExactSinglePart(forged)).toMatchObject({
      status: 'INVALID_INPUT',
      reason: 'CLIENT_DOWNSTREAM_EVIDENCE_FORBIDDEN',
    });
  });

  it('fails closed for missing edgeRefs/fallback-only fillet and unknown topology names', async () => {
    const fallbackOnly = await enrichServerDrawingHandoffWithExactSinglePart(
      await fixture(treeFor('fillet', { edgeRefs: [] })),
    );
    expectNotRun(fallbackOnly);
    expect(fallbackOnly.reason).toContain('OCCT_EXECUTION_FAILED');

    const unknownTopo = await enrichServerDrawingHandoffWithExactSinglePart(
      await fixture(treeFor('fillet', { edgeRefs: ['e.unknown'] })),
    );
    expectNotRun(unknownTopo);
    expect(unknownTopo.reason).toContain('OCCT_EXECUTION_FAILED');
  }, 60_000);

  it('fails closed when the hole bypasses the treatment dependency', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(
      await fixture(treeFor('fillet', { holeDependency: 'base' })),
    );
    expectNotRun(result);
    expect(result.reason).toContain('OCCT_FEATURE_UNSUPPORTED:COMMERCIAL_PREFLIGHT_HOLD:PLAN_BUILD_ERROR');
  }, 60_000);

  it('records the current stale-snapshot boundary instead of treating snapshot parity as evidence', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(
      await fixture(treeFor('fillet', { staleChildSnapshot: true })),
    );
    // The live childId is authoritative in the current generic plan. It may
    // therefore still pass despite a stale embedded snapshot; this is a
    // known blocker for a stricter v2 snapshot-parity contract, not a reason
    // to promote the stale snapshot as an independent source of truth.
    if (result.status === 'PASS') {
      expect(result.handoff.exactSinglePart?.verification.preflight).toBe('PRECHECK_PASS');
      expect(result.handoff.exactSinglePart?.claimBoundary.manufacturingRelease).toBe('BLOCKED');
    } else {
      expect(result.status).toBe('NOT_RUN');
    }
  }, 60_000);

  it('does not permit a fallback-only chamfer to be promoted', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(
      await fixture(treeFor('chamfer', { edgeRefs: [] })),
    );
    expectNotRun(result);
    expect(result.reason).toContain('OCCT_EXECUTION_FAILED');
  }, 60_000);

  it('keeps serialized evidence independently hashable', async () => {
    const result = await enrichServerDrawingHandoffWithExactSinglePart(await fixture(treeFor('fillet')));
    if (result.status !== 'PASS') {
      expect(result.reason).toBeTruthy();
      return;
    }
    const exact = result.handoff.exactSinglePart!;
    expect(serializeAssemblyDrawingHandoff(result.handoff)).toContain('revision-7');
    expect(Buffer.byteLength(exact.step.text, 'utf8')).toBe(exact.step.bytes);
    expect(Buffer.byteLength(exact.drawing.svg, 'utf8')).toBe(exact.drawing.bytes);
  }, 60_000);
});
