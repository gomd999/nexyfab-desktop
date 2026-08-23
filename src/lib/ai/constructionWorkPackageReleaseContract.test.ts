import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import {
  buildConstructionWorkPackageReleaseReceipt,
  claimConstructionWorkPackageReleaseReceipt,
  CONSTRUCTION_WORK_PACKAGE_LIMITS,
  constructionActivityDagIssues,
  constructionWorkPackageReleaseIssues,
  exportConstructionWorkPackageReleaseArtifact,
  parseConstructionWorkPackageReleaseArtifact,
  verifyConstructionWorkPackageRelease,
  type ConstructionWorkPackageReleaseInput,
} from './constructionWorkPackageReleaseContract';

const encoder = new TextEncoder();
const bytesSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const workspaceRevisionValue = { project: 'tower-4d', revision: 7, source: 'federated-ifc' };
const workspaceRevisionId = 'tower-workspace:r7';
const workspaceContentHash = designRevisionSha256(workspaceRevisionValue);
const artifact = (id: string, kind: 'federated_model' | 'quantity' | 'drawing' | 'ifc', body: string) => ({ id, kind, bytes: encoder.encode(body) });

function input(): ConstructionWorkPackageReleaseInput {
  const federatedModel = artifact('artifact-federated-model', 'federated_model', 'IFC-FEDERATED-R7');
  const quantityArtifact = artifact('artifact-quantity', 'quantity', 'QUANTITY-R7');
  const drawingArtifact = artifact('artifact-drawing', 'drawing', 'DRAWING-R7');
  const ifcArtifact = artifact('artifact-ifc', 'ifc', 'IFC-R7');
  const sourceObjectSha256 = 'a'.repeat(64);
  const quantityArtifactSha256 = bytesSha256(quantityArtifact.bytes);
  const drawingArtifactSha256 = bytesSha256(drawingArtifact.bytes);
  const ifcArtifactSha256 = bytesSha256(ifcArtifact.bytes);
  return {
    workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue, expectedWorkspaceContentHash: workspaceContentHash,
    federatedModel, quantityArtifact, drawingArtifact, ifcArtifact,
    elements: [
      { id: 'element:beam-01', kind: 'concrete', zoneId: 'zone:level-01', quantity: { value: 2.5, unit: 'm3' }, sourceObjectSha256, workspaceRevisionId, workspaceContentHash, quantityArtifactSha256, drawingArtifactSha256, ifcArtifactSha256, installationToleranceMm: 3 },
      { id: 'element:rebar-01', kind: 'rebar', zoneId: 'zone:level-01', quantity: { value: 180, unit: 'kg' }, sourceObjectSha256: 'b'.repeat(64), workspaceRevisionId, workspaceContentHash, quantityArtifactSha256, drawingArtifactSha256, ifcArtifactSha256, installationToleranceMm: 5 },
    ],
    activities: [
      { id: 'activity:pour', workPackageId: 'wp:frame', elementIds: ['element:beam-01'], crewId: 'crew:frame', zoneId: 'zone:level-01', startDate: '2026-08-24T08:00:00.000Z', endDate: '2026-08-24T12:00:00.000Z', timezone: 'UTC', predecessors: ['activity:rebar'], installationToleranceMm: 3 },
      { id: 'activity:rebar', workPackageId: 'wp:frame', elementIds: ['element:rebar-01'], crewId: 'crew:frame', zoneId: 'zone:level-01', startDate: '2026-08-24T04:00:00.000Z', endDate: '2026-08-24T07:00:00.000Z', timezone: 'UTC', predecessors: [], installationToleranceMm: 5 },
    ],
    workPackages: [{ id: 'wp:frame', activityIds: ['activity:rebar', 'activity:pour'], crewId: 'crew:frame', zoneId: 'zone:level-01' }],
    crews: [{ id: 'crew:frame', maxConcurrent: 1 }],
    inspections: [
      { id: 'inspection:pour', activityId: 'activity:pour', required: true },
      { id: 'inspection:rebar', activityId: 'activity:rebar', required: true },
    ],
  };
}

describe('construction 4D/work-package release contract', () => {
  it('emits deterministic hash-bound canonical schedule with closed release claims', () => {
    const first = exportConstructionWorkPackageReleaseArtifact(input());
    const second = exportConstructionWorkPackageReleaseArtifact(input());
    expect(first.artifactSha256).toBe(second.artifactSha256);
    expect(first.payload.units).toEqual({ length: 'mm', tolerance: 'mm', quantity: 'm3|kg|m2|each' });
    expect(first.payload.fieldProgress).toBe('NOT_RUN');
    expect(first.payload.releaseReady).toBe(false);
    const parsed = parseConstructionWorkPackageReleaseArtifact(first.bytes, first.payload.binding);
    expect(verifyConstructionWorkPackageRelease({ artifact: parsed, ...first.payload.binding })).toMatchObject({ status: 'passed' });
    const parserOutputBytes = encoder.encode(canonicalDesignJson(parsed));
    const verifierEvidenceBytes = encoder.encode(canonicalDesignJson({ schema: 'nexyfab.construction-work-package-verification.v1', verifierId: 'construction-work-package-structural.v1', status: 'passed', artifactSha256: first.artifactSha256, contentHash: first.contentHash, releaseReady: false }));
    const receiptBytes = buildConstructionWorkPackageReleaseReceipt({ artifact: first, parserOutputBytes, verifierEvidenceBytes });
    expect(claimConstructionWorkPackageReleaseReceipt({ artifact: first, receiptBytes, parserOutputBytes, verifierEvidenceBytes }).claim).toBe('internal-construction-work-package-verified');
  });

  it('fails closed for cycle, dangling references, resource overlap, revision mix and stale artifacts', () => {
    const cyclic = input(); cyclic.activities[1]!.predecessors = ['activity:pour'];
    expect(() => exportConstructionWorkPackageReleaseArtifact(cyclic)).toThrow('DAG_INVALID');
    const dangling = input(); dangling.activities[0]!.predecessors = ['activity:missing'];
    expect(() => exportConstructionWorkPackageReleaseArtifact(dangling)).toThrow('DAG_INVALID');
    const overlap = input(); overlap.activities[1]!.endDate = '2026-08-24T09:00:00.000Z';
    expect(() => exportConstructionWorkPackageReleaseArtifact(overlap)).toThrow('DAG_INVALID');
    const reversed = input(); reversed.activities[1]!.endDate = '2026-08-24T10:00:00.000Z'; reversed.activities[0]!.startDate = '2026-08-24T09:00:00.000Z';
    expect(() => exportConstructionWorkPackageReleaseArtifact(reversed)).toThrow('DAG_INVALID');
    const mixed = input(); mixed.elements[0]!.workspaceRevisionId = 'tower-workspace:r6';
    expect(() => exportConstructionWorkPackageReleaseArtifact(mixed)).toThrow('ELEMENT_BINDING_INVALID');
    const staleQuantity = input(); staleQuantity.quantityArtifact = artifact('artifact-quantity', 'quantity', 'QUANTITY-R8');
    expect(() => exportConstructionWorkPackageReleaseArtifact(staleQuantity)).toThrow('ELEMENT_BINDING_INVALID');
    const stale = input(); stale.expectedWorkspaceContentHash = 'c'.repeat(64);
    expect(() => exportConstructionWorkPackageReleaseArtifact(stale)).toThrow('STALE_REVISION_HASH');
  });

  it('rejects parser tamper, non-canonical bytes and receipt evidence tamper', () => {
    const exported = exportConstructionWorkPackageReleaseArtifact(input());
    const parsed = JSON.parse(new TextDecoder().decode(exported.bytes)) as { payload: Record<string, unknown>; contentHash: string };
    parsed.payload.releaseReady = true;
    const tampered = encoder.encode(canonicalDesignJson(parsed));
    expect(() => parseConstructionWorkPackageReleaseArtifact(tampered, exported.payload.binding)).toThrow('INVALID');
    expect(() => parseConstructionWorkPackageReleaseArtifact(encoder.encode(`${new TextDecoder().decode(exported.bytes)}\n`))).toThrow('NON_CANONICAL');
    const parserOutputBytes = encoder.encode(canonicalDesignJson(parseConstructionWorkPackageReleaseArtifact(exported.bytes)));
    const verifierEvidenceBytes = encoder.encode(canonicalDesignJson({ schema: 'nexyfab.construction-work-package-verification.v1', verifierId: 'construction-work-package-structural.v1', status: 'passed', artifactSha256: exported.artifactSha256, contentHash: exported.contentHash, releaseReady: false }));
    const receiptBytes = buildConstructionWorkPackageReleaseReceipt({ artifact: exported, parserOutputBytes, verifierEvidenceBytes });
    expect(() => claimConstructionWorkPackageReleaseReceipt({ artifact: exported, receiptBytes, parserOutputBytes: encoder.encode('{"tampered":true}'), verifierEvidenceBytes })).toThrow('PARSER_OUTPUT_MISMATCH');
    const payloadSwap = { ...exported, payload: { ...exported.payload, fieldProgress: 'COMPLETE' as never } };
    expect(() => buildConstructionWorkPackageReleaseReceipt({ artifact: payloadSwap, parserOutputBytes, verifierEvidenceBytes })).toThrow('ARTIFACT_BINDING_MISMATCH');
    expect(() => buildConstructionWorkPackageReleaseReceipt({ artifact: exported, parserOutputBytes: encoder.encode('{}'), verifierEvidenceBytes })).toThrow('PARSER_OUTPUT_MISMATCH');
    expect(() => buildConstructionWorkPackageReleaseReceipt({ artifact: exported, parserOutputBytes, verifierEvidenceBytes: encoder.encode('{}') })).toThrow('VERIFIER_EVIDENCE_MISMATCH');
  });

  it('requires one correctly typed artifact in every source slot', () => {
    const duplicateKind = input(); duplicateKind.drawingArtifact = artifact('artifact-drawing', 'quantity', 'DRAWING-R7');
    expect(() => exportConstructionWorkPackageReleaseArtifact(duplicateKind)).toThrow('ARTIFACT_HASH_MISMATCH');
  });

  it('rejects cross-zone elements, duplicate package ownership and missing required inspections', () => {
    const crossZone = input(); crossZone.activities[0]!.zoneId = 'zone:level-02'; crossZone.workPackages[0]!.zoneId = 'zone:level-02';
    expect(() => exportConstructionWorkPackageReleaseArtifact(crossZone)).toThrow('activity_element_zone_mismatch');
    const duplicateOwner = input(); duplicateOwner.workPackages.push({ id: 'wp:duplicate', activityIds: ['activity:pour'], crewId: 'crew:frame', zoneId: 'zone:level-01' });
    expect(() => exportConstructionWorkPackageReleaseArtifact(duplicateOwner)).toThrow('activity_ownership_invalid');
    const missingInspection = input(); missingInspection.inspections = missingInspection.inspections.filter(item => item.activityId !== 'activity:rebar');
    expect(() => exportConstructionWorkPackageReleaseArtifact(missingInspection)).toThrow('required_inspection_invalid');
  });

  it('rejects oversized source/output/parser bytes before decode or hashing claims', () => {
    const oversizedSource = input();
    oversizedSource.federatedModel.bytes = new Uint8Array(CONSTRUCTION_WORK_PACKAGE_LIMITS.sourceArtifactBytes + 1);
    expect(() => exportConstructionWorkPackageReleaseArtifact(oversizedSource)).toThrow('SOURCE_ARTIFACT_TOO_LARGE');

    const oversizedArtifact = new Uint8Array(CONSTRUCTION_WORK_PACKAGE_LIMITS.outputArtifactBytes + 1);
    expect(() => parseConstructionWorkPackageReleaseArtifact(oversizedArtifact)).toThrow('ARTIFACT_TOO_LARGE');

    const exported = exportConstructionWorkPackageReleaseArtifact(input());
    const verifierEvidenceBytes = encoder.encode(canonicalDesignJson({ schema: 'nexyfab.construction-work-package-verification.v1', verifierId: 'construction-work-package-structural.v1', status: 'passed', artifactSha256: exported.artifactSha256, contentHash: exported.contentHash, releaseReady: false }));
    expect(() => buildConstructionWorkPackageReleaseReceipt({
      artifact: exported,
      parserOutputBytes: new Uint8Array(CONSTRUCTION_WORK_PACKAGE_LIMITS.parserOutputBytes + 1),
      verifierEvidenceBytes,
    })).toThrow('PARSER_OUTPUT_INVALID');
  });

  it('rejects over-cap collections and relationship fan-out before expensive validation', () => {
    const tooManyElements = input();
    tooManyElements.elements = Array.from({ length: CONSTRUCTION_WORK_PACKAGE_LIMITS.elements + 1 }, () => structuredClone(tooManyElements.elements[0]!));
    expect(() => exportConstructionWorkPackageReleaseArtifact(tooManyElements)).toThrow('collection_limit_exceeded:elements');

    const tooManyPredecessors = input();
    tooManyPredecessors.activities[0]!.predecessors = Array.from({ length: CONSTRUCTION_WORK_PACKAGE_LIMITS.predecessorsPerActivity + 1 }, () => 'activity:rebar');
    expect(() => exportConstructionWorkPackageReleaseArtifact(tooManyPredecessors)).toThrow('relation_limit_exceeded:activity_predecessors');
  });

  it('validates a maximum-length chain iteratively and detects a cycle without stack recursion', () => {
    const startMs = Date.parse('2026-08-24T00:00:00.000Z');
    const activities = Array.from({ length: CONSTRUCTION_WORK_PACKAGE_LIMITS.activities }, (_, index) => ({
      id: `activity-${String(index).padStart(4, '0')}`,
      workPackageId: 'wp:long-chain', elementIds: ['element:placeholder'], crewId: 'crew:chain', zoneId: 'zone:chain',
      startDate: new Date(startMs + index * 2 * 60 * 60 * 1_000).toISOString(),
      endDate: new Date(startMs + (index * 2 + 1) * 60 * 60 * 1_000).toISOString(),
      timezone: 'UTC' as const,
      predecessors: index === 0 ? [] : [`activity-${String(index - 1).padStart(4, '0')}`],
      installationToleranceMm: 1,
    }));
    expect(constructionActivityDagIssues(activities)).toEqual([]);
    activities[0]!.predecessors = [activities.at(-1)!.id];
    expect(constructionActivityDagIssues(activities)).toContain('activity_predecessor_cycle');
  });

  it('returns bounded validation issues for malformed collection members instead of throwing', () => {
    const exported = exportConstructionWorkPackageReleaseArtifact(input());
    const malformed = { ...exported.payload, activities: [null] };
    expect(() => constructionWorkPackageReleaseIssues(malformed)).not.toThrow();
    expect(constructionWorkPackageReleaseIssues(malformed)).toContain('work_package_activity_shape_invalid');
    expect(constructionActivityDagIssues([null as never])).toContain('activity_dag_shape_invalid');
  });

  it('bounds the workspace revision and output name before canonical release work', () => {
    const tooDeep = input();
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index <= CONSTRUCTION_WORK_PACKAGE_LIMITS.workspaceRevisionDepth + 1; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    tooDeep.workspaceRevisionValue = root;
    expect(() => exportConstructionWorkPackageReleaseArtifact(tooDeep)).toThrow('WORKSPACE_REVISION_TOO_COMPLEX');

    const longName = input();
    longName.artifactName = 'x'.repeat(256);
    expect(() => exportConstructionWorkPackageReleaseArtifact(longName)).toThrow('ARTIFACT_NAME_INVALID');
  });
});
